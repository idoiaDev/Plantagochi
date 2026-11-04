#include <TFT_eSPI.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <SPIFFS.h>
#include "esp_wifi.h"

#include "config.h"  // credenciales y config local
#ifndef SCREEN_WIDTH
#define SCREEN_WIDTH 240
#endif
#ifndef SCREEN_HEIGHT
#define SCREEN_HEIGHT 240
#endif
static int g_width = SCREEN_WIDTH;
static int g_height = SCREEN_HEIGHT;
static size_t g_frame_bytes = (size_t)SCREEN_WIDTH * (size_t)SCREEN_HEIGHT * 2; // bytes RGB565
#define WIDTH g_width
#define HEIGHT g_height
#define FRAME_BYTES g_frame_bytes

// Cada X(definido en config.h) min se lee humedad, se hace POST /state y se comprueban avisos.
const unsigned long INTERVALO_MS = MINUTE_INTERVAL * 60 * 1000L;

// Tiempos de wifi
static const unsigned long WIFI_TIMEOUT_MS = 20000;   // espera por intento
static const unsigned long WIFI_REINTENTO_MS = 30000; // pausa entre intentos

// --- variables globales ---
float humedad = 100;
int minHumedad = -1;        // -1 = desconocido (aún no se ha consultado /device)
int typeId = -1;            // -1 = desconocido
String plantVersion = "";   // valor de plant.updated_at que tenemos aplicado
String imagesVersion = "";  // valor de images_updated_at que tenemos aplicado
String plantTypeWidth = "";
String plantTypeHeight = "";
const char* currentState = "happy";

unsigned long lastCiclo = 0;
unsigned long lastWifiIntento = 0;

// Buffer de dibujo: UNA fila (max * 2 bytes). La pantalla se pinta fila a fila
static uint16_t rowBuf[320];

// Gris de emergencia RGB565 (#9CA3AF) cuando no hay imagen.
static const uint16_t GRAY_EMERG = 0x9D15;

// Auto-reparación: marcar estado para redescarga en el siguiente ciclo
bool repararEstadoPendiente = false;
const char* estadoAReparar = nullptr;

TFT_eSPI tft = TFT_eSPI();

// ---- wifi ----
// Log de eventos: IP obtenida y MOTIVO de cada desconexión.
void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.printf("[wifi] conectada, IP=%s\n",
                    WiFi.localIP().toString().c_str());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
      Serial.printf("[wifi] desconectada, motivo=%d\n",
                    info.wifi_sta_disconnected.reason);

      uint8_t apMac[6];
      wifi_ap_record_t apInfo;

      if (esp_wifi_sta_get_ap_info(&apInfo) == ESP_OK) {
        Serial.printf("[wifi] AP: %02X:%02X:%02X:%02X:%02X:%02X canal=%d RSSI=%d\n",
                      apInfo.bssid[0], apInfo.bssid[1], apInfo.bssid[2],
                      apInfo.bssid[3], apInfo.bssid[4], apInfo.bssid[5],
                      apInfo.primary, apInfo.rssi);
      } else {
        Serial.println("[wifi] no hay AP asociado");
      }
      break;
    }
    default:
      break;
  }
}

// Un intento de conexión: limpia estado anterior, llama a begin() UNA vez y
// espera. No se vuelve a llamar a begin()/reconnect() mientras espera.
bool conectarWifi() {
  Serial.println("[wifi] conectando...");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.disconnect();
  delay(500);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - inicio < WIFI_TIMEOUT_MS) {
    delay(250);
  }

  bool ok = (WiFi.status() == WL_CONNECTED);

  if (ok) {
    Serial.printf("[wifi] conectada, IP=%s\n",
                  WiFi.localIP().toString().c_str());
  } else {
    Serial.printf("[wifi] sin conexion (status=%d)\n", WiFi.status());
  }

  return ok;
}

// --- http ---
String httpGet(const String& url) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin(url);
  http.setTimeout(15000);
  int code = http.GET();
  if (code != 200) Serial.printf("[http] GET %s -> %d\n", url.c_str(), code);
  String body = (code == 200) ? http.getString() : "";
  http.end();
  return body;
}

// Extrae string simple de JSON (sin escapados complejos)
String jsonStringSimple(const String& body, const char* clave) {
  String token = "\"" + String(clave) + "\":";
  int i = body.indexOf(token);
  if (i < 0) return "";
  i += token.length();
  while (i < (int)body.length() && (body.charAt(i) == ' ' || body.charAt(i) == '\t')) i++;
  if (i < (int)body.length() && body.charAt(i) == '"') {
    i++;
    int fin = body.indexOf('"', i);
    if (fin < 0) return "";
    return body.substring(i, fin);
  }
  // numero
  int start = i;
  if (i < (int)body.length() && body.charAt(i) == '-') i++;
  while (i < (int)body.length() && body.charAt(i) >= '0' && body.charAt(i) <= '9') i++;
  if (body.charAt(i) == '.') {
    i++;
    while (i < (int)body.length() && body.charAt(i) >= '0' && body.charAt(i) <= '9') i++;
  }
  return body.substring(start, i);
}

bool httpGetToFile(const String& url, const String& path) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(url);
  http.setTimeout(30000);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[http] GET %s -> %d\n", url.c_str(), code);
    http.end();
    return false;
  }
  fs::File f = SPIFFS.open(path, "w");
  if (!f) { http.end(); return false; }
  http.writeToStream(&f);
  f.close();
  http.end();
  return true;
}

// ------------------------------------------------------------- SPIFFS frames
String framePath(const char* state, int frame) {
  return String("/frames/") + state + "_" + frame + ".bin";
}

void limpiarFrames() {
  fs::File dir = SPIFFS.open("/frames");
  if (!dir) return;
  fs::File f = dir.openNextFile();
  while (f) {
    String name = String("/frames/") + String(f.name());
    f.close();
    SPIFFS.remove(name);
    f = dir.openNextFile();
  }
  dir.close();
}

// Descarga SOLO los frames del estado pedido desde
// GET /types/{id}/images/{state}/all/raw y los guarda en SPIFFS.
void descargarEstado(const char* state) {
  if (typeId <= 0) return;
  if (WiFi.status() != WL_CONNECTED) return;

  String url = String(BASE_URL) + "/types/" + String(typeId) +
               "/images/" + state + "/all/raw";
  String tmp = "/frames/_tmp_" + String(state);
  if (!httpGetToFile(url, tmp)) {
    return;
  }

  fs::File f = SPIFFS.open(tmp, "r");
  if (!f) return;
  for (int i = 0; i < 3; i++) {
    uint8_t hdr[4];
    if (f.read(hdr, 4) != 4) break;
    uint32_t len = hdr[0] | ((uint32_t)hdr[1] << 8) |
                   ((uint32_t)hdr[2] << 16) | ((uint32_t)hdr[3] << 24);
    String out = framePath(state, i);
    if (len == 0) {
      if (SPIFFS.exists(out)) SPIFFS.remove(out);
      continue;
    }
    fs::File of = SPIFFS.open(out, "w");
    if (!of) { f.close(); return; }
    uint8_t chunk[4096];
    uint32_t rest = len;
    while (rest > 0) {
      size_t n = (rest < sizeof(chunk)) ? rest : sizeof(chunk);
      n = f.read(chunk, n);
      if (n == 0) break;
      of.write(chunk, n);
      rest -= n;
    }
    of.close();
  }
  f.close();
  SPIFFS.remove(tmp);
}

// Descarga el estado si no lo tenemos cacheado (misma versión de imágenes).
void asegurarEstado(const char* state) {
  if (typeId <= 0) return;
  if (SPIFFS.exists(framePath(state, 0))) return;
  descargarEstado(state);
}

// --- renderizado ---
// Pinta una fila cada vez (solo 480 B de RAM) leyendo el frame de SPIFFS.
void mostrarFrame(const char* state, int frame) {
  String path = framePath(state, frame);
  fs::File f = SPIFFS.open(path, "r");
  if (!f) {
    if (frame > 0) { mostrarFrame(state, 0); return; }
    tft.fillRect(0, 0, WIDTH, HEIGHT, GRAY_EMERG); // gris de emergencia
    return;
  }
  tft.startWrite();
  for (int y = 0; y < HEIGHT; y++) {
    size_t n = f.read((uint8_t*)rowBuf, WIDTH * 2);
    if (n != WIDTH * 2) {
      for (int i = 0; i < WIDTH; i++) rowBuf[i] = GRAY_EMERG;
    }
    tft.pushImage(0, y, WIDTH, 1, rowBuf);
  }
  tft.endWrite();
  f.close();
}

// --- estado ---
// Umbrales fijos: >=80 superhappy, >=50 happy, >=30 sad.
// supersad cuando humedad < min_humedad (umbral de la planta) o humedad < 30.
void calcularEstado() {
  if (humedad >= 80) {
    currentState = "superhappy";
  } else if (humedad >= 50) {
    currentState = "happy";
  } else if (minHumedad > 0 && humedad < minHumedad) {
    currentState = "supersad";
  } else if (humedad >= 30) {
    currentState = "sad";
  } else {
    currentState = "supersad";
  }
}

// --- parseo JSON ---
// Extrae el valor de una clave de texto: `"clave":"valor"`. Devuelve "" si
// no está.
String jsonString(const String& body, const char* clave) {
  String token = "\"" + String(clave) + "\":\"";
  int i = body.indexOf(token);
  if (i < 0) return "";
  i += token.length();
  int fin = body.indexOf('"', i);
  if (fin < 0) return "";
  return body.substring(i, fin);
}

// Extrae una clave numérica: `"clave":123` o `"clave":30.0`. Devuelve -1 si
// no está (un valor válido siempre es >= 0).
int jsonInt(const String& body, const char* clave) {
  String token = "\"" + String(clave) + "\":";
  int i = body.indexOf(token);
  if (i < 0) return -1;
  i += token.length();
  while (i < (int)body.length() &&
         (body.charAt(i) == ' ' || body.charAt(i) == '\t')) {
    i++;
  }
  bool neg = i < (int)body.length() && body.charAt(i) == '-';
  if (neg) i++;
  long v = 0;
  bool hayDigitos = false;
  while (i < (int)body.length() && body.charAt(i) >= '0' &&
         body.charAt(i) <= '9') {
    v = v * 10 + (long)(body.charAt(i) - '0');
    hayDigitos = true;
    i++;
  }
  if (!hayDigitos) return -1;
  return (int)(neg ? -v : v);
}

void actualizarResolucionTipo(int tid) {
  if (tid <= 0) return;
  if (WiFi.status() != WL_CONNECTED) return;
  String body = httpGet(String(BASE_URL) + "/types/" + String(tid) + "/manifest");
  if (body.length() == 0) return;
  String w = jsonStringSimple(body, "width");
  String h = jsonStringSimple(body, "height");
  if (w.length() == 0 || h.length() == 0) return;
  int nw = w.toInt();
  int nh = h.toInt();
  if (nw <= 0 || nh <= 0) return;
  if (nw != g_width || nh != g_height) {
    Serial.printf("[img] resolucion tipo %d: %dx%d -> actualizando\n", tid, nw, nh);
    g_width = nw;
    g_height = nh;
    g_frame_bytes = (size_t)g_width * (size_t)g_height * 2;
    // Al cambiar resolución, los frames cacheados no coinciden: los borramos y re-descargamos
    limpiarFrames();
    asegurarEstado(currentState);
    tft.fillScreen(TFT_BLACK);
    mostrarFrame(currentState, 0);
  }
}

// --- avisos servidor ---
// Solo se llama cuando plant_version cambió. Actualiza minHumedad únicamente
// si el valor difiere. Devuelve true si typeId cambió (implica re-bajar
// imágenes).
bool actualizarDispositivo() {
  if (WiFi.status() != WL_CONNECTED) return false;
  String body = httpGet(String(BASE_URL) + "/device/" + DEVICE_ID);
  if (body.length() == 0) return false;

  int nuevoTipo = jsonInt(body, "type_id");
  int nuevoMin = jsonInt(body, "min_humidity");

  if (nuevoMin != minHumedad && nuevoMin >= 0) {
    minHumedad = nuevoMin;
  }
  bool cambio = nuevoTipo != typeId && nuevoTipo > 0;
  if (cambio) {
    typeId = nuevoTipo;
    actualizarResolucionTipo(typeId);
  } else if (typeId > 0) {
    actualizarResolucionTipo(typeId);
  }
  return cambio;
}

// Procesa la respuesta del POST /state: compara versiones y actúa SOLO si
// hay cambios (cero GETs cuando no los hay).
void procesarRespuesta(const String& resp) {
  if (resp.length() == 0) return;

  String newPlantVer = jsonString(resp, "plant_version");
  String newImagesVer = jsonString(resp, "images_version");
  bool tipoCambio = false;

  if (newPlantVer != plantVersion) {
    tipoCambio = actualizarDispositivo();
    if (tipoCambio) plantVersion = newPlantVer; // solo avanza si se leyó el dispositivo
  }

  bool imagenesDesactualizadas = (newImagesVer != imagesVersion) || tipoCambio;
  if (imagenesDesactualizadas) {
    if (typeId > 0) actualizarResolucionTipo(typeId);
    limpiarFrames();
    asegurarEstado(currentState);
    imagesVersion = newImagesVer;
  } else if (typeId > 0) {
    // Comprobar resolución por si ha cambiado
    static unsigned long lastCheckRes = 0;
    if (millis() - lastCheckRes > 60000) {
      lastCheckRes = millis();
      actualizarResolucionTipo(typeId);
    }
  }
}

// --- ciclo ---
void leerHumedad() {
  // Media de varias lecturas para estabilizar el ADC con el WiFi activo.
  int valor = 0;
  for (int i = 0; i < 8; i++) {
    valor += analogRead(HUMIDITY_PIN);
    delay(2);
  }
  valor /= 8;

  // Los sensores de humedad típicos dan menos voltaje cuanto más húmedo.
  // Mapeamos «en agua => 100%, en seco => 0%» (ver HUM_RAW_* en config.h).
  humedad = constrain(
      map(valor, HUM_RAW_WET, HUM_RAW_DRY, 100, 0), 0, 100);
  calcularEstado();

  // Temporal para calibrar HUM_RAW_DRY/HUM_RAW_WET: borra esta línea al acabar.
  Serial.printf("[hum] raw=%d hum=%.0f\n", valor, humedad);

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[API] sin wifi, no se envia");
    return;
  }
  HTTPClient http;
  http.begin(String(BASE_URL) + "/state");
  http.addHeader("Content-Type", "application/json");
  String body = "{\"device_id\":\"" + String(DEVICE_ID) +
                "\",\"humidity\":" + String(humedad, 0) + "}";
  int code = http.POST(body);
  // code < 0 = no se pudo conectar al server (wifi ok pero ruta/puerto mal)
  Serial.printf("[API] POST %s/state -> %d\n", BASE_URL, code);
  if (code == 200 || code == 201) {
    String resp = http.getString();
    http.end();
    procesarRespuesta(resp);
    return;
  }
  http.end();
}

// --- setup ---
void setup() {
  Serial.begin(115200);
  tft.init();
  tft.setRotation(0);
  tft.setSwapBytes(true);

  analogReadResolution(12);
  analogSetPinAttenuation(HUMIDITY_PIN, ADC_11db);

  tft.fillScreen(TFT_BLACK);
  SPIFFS.begin(true);
  randomSeed(esp_random());

  mostrarFrame(currentState, 0); // arranque (gris si aún no hay imágenes)

  // Wifi: sin guardar config en flash, sin reconexión automática (la
  // gestionamos nosotros para que no se pisen los intentos).
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.onEvent(onWifiEvent);

  if (String(WIFI_SSID).length() > 0) {
    conectarWifi();
    lastWifiIntento = millis();
  }

  lastCiclo = millis() - INTERVALO_MS; // fuerza el primer ciclo inmediato
  leerHumedad();                       // humedad + POST + procesar avisos
  if (typeId <= 0) actualizarDispositivo(); // reintento directo si aún no hay tipo
  else actualizarResolucionTipo(typeId);
  asegurarEstado(currentState);
  mostrarFrame(currentState, 0);
  Serial.println("ESP32 iniciado");
}

// --- loop ---
void loop() {
  // Reintento de wifi como mucho cada 30 s (nunca en cada vuelta del loop).
  if (WiFi.status() != WL_CONNECTED &&
      millis() - lastWifiIntento >= WIFI_REINTENTO_MS) {
    conectarWifi();
    lastWifiIntento = millis();
  }

  if (millis() - lastCiclo >= INTERVALO_MS) {
    lastCiclo = millis();
    leerHumedad();
    if (typeId > 0) {
      static unsigned long lastCheckRes2 = 0;
      if (millis() - lastCheckRes2 > 300000) {
        lastCheckRes2 = millis();
        actualizarResolucionTipo(typeId);
      }
    }
    if (repararEstadoPendiente && estadoAReparar != nullptr) {
      const char* st = estadoAReparar;
      repararEstadoPendiente = false;
      estadoAReparar = nullptr;
      Serial.printf("[img] reparando estado %s\n", st);
      asegurarEstado(st);
    }
    asegurarEstado(currentState);
  }

  // Animación: si el estado tiene frames de cambio guardados, parpadea.
  if (SPIFFS.exists(framePath(currentState, 1)) &&
      SPIFFS.exists(framePath(currentState, 2))) {
    int rep = random(5);
    for (int x = 0; x < rep; x++) {
      mostrarFrame(currentState, 1);
      delay(1000);
      mostrarFrame(currentState, 2);
      delay(1000);
    }
  }
  mostrarFrame(currentState, 0);
  delay(random(7) * 1000);
}
