#ifndef CONFIG_H
#define CONFIG_H

// Plantilla de configuración para subir al repositorio. Copia este fichero
// como config.h y rellena tus valores (config.h está en .gitignore).

// Identificador de esta planta (debe existir en la BD, campo device_id).
#define DEVICE_ID "TU_DEVICE_ID"
// URL base del backend FastAPI (IP del servidor).
#define BASE_URL "http://192.168.1.XXX:8000/plantagochi"

#define WIFI_SSID "TU_NOMBRE_WIFI"
#define WIFI_PASSWORD "TU_CONTRASEÑA"

const int HUMIDITY_PIN = 32; // Pin GPIO32 del ESP32
const int MINUTE_INTERVAL = 30; // Minutos entre mediciones y llamadas al servidor

// Calibración del sensor de humedad (valor CRUDO del ADC, 0..4095):
//   HUM_RAW_DRY = lectura con el sensor en el aire / suelo seco
//   HUM_RAW_WET = lectura con el sensor en agua
// Mapeo: en agua => 100%, en seco => 0%. En sensores que den la señal
// invertida, intercambia los dos valores.
const int HUM_RAW_DRY = 3035;
const int HUM_RAW_WET = 2174;

#endif