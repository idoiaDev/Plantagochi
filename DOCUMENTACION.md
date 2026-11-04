# Plantagochi — Documentación técnica

Este documento explica **cómo funciona Plantagochi** (el flujo de datos de punta a
punta) y **dónde vive cada funcionalidad** en el código (`archivo:línea`).

Para instalar y arrancar cada pieza, ver el [`README.md`](README.md) de la raíz.

---

## 1. Flujo de Plantagochi

Plantagochi es un "tamagotchi" de plantas. Un **ESP32** con un sensor de humedad
mide la tierra, manda la lectura a una **API** (FastAPI + PostgreSQL), y esa
lectura acaba pintada como el **estado de ánimo** de la planta en tres sitios: la
**app móvil**, el **dashboard web** y el **propio ESP32** (que muestra una cara
animada). Además, si la planta se seca, la API lanza una **notificación push**.

### 1.1 Vista general

```
                 POST /plantagochi/state
   ┌─────────┐   {device_id, humidity}   ┌──────────────────┐
   │  ESP32  │ ────────────────────────▶ │       API        │
   │ (sensor)│                           │    (FastAPI)     │
   └─────────┘                           └────────┬─────────┘
        ▲                                          │
        │ GET .../images/{state}/all/raw           │ INSERT/UPDATE
        │ (RGB565 de las caras)                    ▼
        │                                 ┌──────────────────┐
        │                                 │    PostgreSQL    │
        │   GET /plantagochi/all          │  plant,          │
        │   GET .../images/.../png        │  plant_state,    │
        │                                 │  plant_log,      │
   ┌────┴──────┐                          │  plant_type,     │
   │ App móvil │ ◀────────────────────────┤  plant_push,     │
   │  (Expo)   │                          │  push_token      │
   └───────────┘  POST/PUT/PATCH/DELETE   └──────────────────┘
   ┌───────────┐   (CRUD plantas y tipos)         ▲
   │ Web (React)│ ◀──────────────────────────────┘
   └───────────┘        (solo tipos de planta)
```

### 1.2 El ciclo, paso a paso

1. **El ESP32 mide.** Cada `MINUTE_INTERVAL` minutos (`esp32_code/plantagochi/plantagochi.ino:12`)
   lee el sensor de humedad y hace `POST /plantagochi/state` con
   `{ device_id, humidity }`.

2. **La API ingesta.** `ingest_state` (`api/routes/plantagochi.py:149`) llama a
   `insertStatusByDevice` (`api/db.py:381`), que:
   - busca la planta por `device_id` (`api/db.py:384`);
   - decide si toca push (`decide_push`, `api/db.py:329`);
   - escribe la lectura (`_write_state`, `api/db.py:71`);
   - devuelve `plant_version` e `images_version` (para que el ESP32 sepa si su
     planta o las imágenes de su tipo cambiaron) **y** el push pendiente.

3. **Se guarda la lectura.** `_write_state` (`api/db.py:71`) actualiza
   `plant_state` (una fila por planta) y, **solo si la humedad cambió**, inserta
   una fila en `plant_log` (el histórico). El `FOR UPDATE` serializa lecturas
   simultáneas de la misma planta.

4. **Sale el push (si toca).** El push va en `BackgroundTasks`
   (`api/routes/plantagochi.py:154`) para que el ESP32 no espere a Expo.
   `send_plant_push` (`api/push.py:10`) avisa a todos los móviles registrados y
   da de baja los tokens muertos (`DeviceNotRegistered`).

5. **El clima se calcula al leer.** El estado de ánimo **no se guarda**: se
   calcula con `getMoodStatus` (`api/db.py:106`) cada vez que se construye el
   dict de una planta (`_plant_dict`, `api/db.py:164`). Así el estado siempre
   viaja al día, junto con `needs_water` y `status_label`.

6. **La app móvil y la web leen.** `GET /plantagochi/all` devuelve la lista.
   La app móvil además refresca sola cada 15 min comprobando
   `GET /plantagochi/last-update` (`mobile/src/hooks/usePlants.js:4,74`).

7. **El ESP32 pinta la cara.** Según el estado de humedad, descarga los 3 frames
   RGB565 del estado correspondiente (`GET .../images/{state}/all/raw`,
   `api/routes/plantagochi.py:330`) y los anima en su pantalla.

### 1.3 Reglas de negocio clave

- **Estado de ánimo** (`api/db.py:105`): cuatro niveles
  (`superhappy`, `happy`, `sad`, `supersad`) más `unknown`. Usa cortes fijos
  (80 / 50 / 30 %), igual que el ESP32. Si la planta tiene umbral de riego > 0
  y la humedad baja de ese umbral, el estado pasa a `supersad`.
- **Umbral de riego** (`needs_water`, `api/db.py:131`): una planta "necesita
  agua" si `min_humidity > 0` y `humidity < min_humidity`.
- **Push con anti-duplicados** (`decide_push`, `api/db.py:329`): se avisa solo
  con el estado *actual* (seco + sin aviso vivo → avisa; húmedo + aviso vivo →
  resuelve). No depende de la humedad anterior, así el aviso sobrevive a un
  reinicio de la API.
- **Embeddings** (`api/embeddings.py`): el vector de una planta resume nombre,
  descripción, `device_id` y umbral (no el tipo ni el estado, que cambian). Se
  regenera al crear/editar/eliminar la planta o cambiar el umbral, y alimenta la
  búsqueda semántica.
- **Export mensual** (`api/exports.py`, `api/main.py:18`): el día 1 a las 00:05
  se vuelca `plant_log` del mes anterior a CSV y luego se borra ese mes. El
  fichero ya escrito evita repetir un mes bueno.

---

## 2. Funcionalidades y dónde están

### 2.1 API (`api/`) — FastAPI + PostgreSQL

**Entrada y configuración**

| Funcionalidad | Ubicación |
|---|---|
| App FastAPI, CORS, planificador mensual | `api/main.py:47`, `api/main.py:49`, `api/main.py:32` |
| Router de negocio (21 endpoints) | `api/routes/plantagochi.py:38` |
| Conexión a PostgreSQL | `api/db.py` (`createConexion`) |

**Lectura**

| Endpoint | Ubicación |
|---|---|
| `GET /plantagochi/all` (lista de plantas) | `api/routes/plantagochi.py:115` → `getAll` (`api/db.py:190`) |
| `GET /plantagochi/types` | `api/routes/plantagochi.py:120` → `getTypes` (`api/db.py:420`) |
| `GET /plantagochi/last-update` | `api/routes/plantagochi.py:125` → `getLastUpdate` (`api/db.py`) |
| `GET /plantagochi/exports` | `api/routes/plantagochi.py:130` → `list_exports` (`api/exports.py:49`) |
| `GET /plantagochi/device/{device_id}` | `api/routes/plantagochi.py:137` → `getPlantByDevice` (`api/db.py`) |

**Escritura**

| Endpoint | Ubicación |
|---|---|
| `POST /plantagochi/state` (ingesta del sensor) | `api/routes/plantagochi.py:149` → `insertStatusByDevice` (`api/db.py:381`) |
| `POST /plantagochi/push-token` | `api/routes/plantagochi.py:161` → `registerPushToken` (`api/db.py`) |
| `POST /plantagochi` (crear planta) | `api/routes/plantagochi.py:167` → `createPlant` (`api/db.py:204`) |
| `POST /plantagochi/types` (crear tipo) | `api/routes/plantagochi.py:177` → `createType` (`api/db.py:435`) |
| `PUT /plantagochi/{plant_id}` | `api/routes/plantagochi.py:183` → `updatePlant` (`api/db.py`) |
| `PATCH /plantagochi/{plant_id}/threshold` | `api/routes/plantagochi.py:198` → `updateMinHumidity` (`api/db.py`) |
| `DELETE /plantagochi/{plant_id}` | `api/routes/plantagochi.py:206` → `deletePlant` (`api/db.py`) |
| `POST /plantagochi/{plant_id}` (ingesta antigua) | `api/routes/plantagochi.py:234` → `insertStatus` (`api/db.py:370`) |

**Búsqueda semántica**

| Endpoint | Ubicación |
|---|---|
| `POST /plantagochi/search` | `api/routes/plantagochi.py:218` → `searchPlantsByEmbedding` (`api/db.py`) |

**Imágenes de tipo (RGB565 raw para el ESP32, PNG para la web/app)**

| Endpoint | Ubicación |
|---|---|
| `GET .../types/{id}/manifest` | `api/routes/plantagochi.py:250` |
| `GET .../images/{state}/raw` (1 frame) | `api/routes/plantagochi.py:307` |
| `GET .../images/{state}/png` (1 frame) | `api/routes/plantagochi.py:318` |
| `GET .../images/{state}/all/raw` (3 frames) | `api/routes/plantagochi.py:330` |
| `POST .../types/{id}/images` (subir imágenes/nombre) | `api/routes/plantagochi.py:374` |
| `POST .../types/images/refresh` (refresco masivo) | `api/routes/plantagochi.py:462` |
| `POST .../types/{id}/images/refresh` | `api/routes/plantagochi.py:468` |
| Conversión RGB565 → PNG | `api/routes/plantagochi.py:286` |

**Lógica de negocio y servicios**

| Funcionalidad | Ubicación |
|---|---|
| Estado de ánimo (fórmula) | `api/db.py:106` |
| Necesita agua (=) | `api/db.py:131` |
| Persistencia de lectura + log | `api/db.py:71` (`_write_state`) |
| Decisión de push (anti-duplicados) | `api/db.py:329` (`decide_push`) |
| Envío a Expo + limpieza de tokens muertos | `api/push.py:10`, `api/push.py:67` |
| Embeddings vía Ollama (nomic-embed-text) | `api/embeddings.py:50`, `api/embeddings.py:25` |
| Export CSV del mes anterior | `api/exports.py:25`, `api/exports.py:68` |
| Imágenes por defecto / RGB565 | `api/default_images.py` |

### 2.2 App móvil (`mobile/`) — Expo / React Native

| Funcionalidad | Ubicación |
|---|---|
| Pantalla principal (lista, tabs, modal) | `mobile/src/app/index.jsx` |
| Carga, refresco y polling cada 15 min | `mobile/src/hooks/usePlants.js:26`, `mobile/src/hooks/usePlants.js:74` |
| Cliente HTTP de la API | `mobile/src/api.js` (objeto `api`) |
| Campana de avisos "necesita agua" | `mobile/src/components/NotificationBell.jsx:10`, `:66` |
| Filtros (texto, tipo, humedad, necesita agua) | `mobile/src/components/FilterBar.jsx:12` |
| Tarjeta de planta | `mobile/src/components/PlantCard.jsx` |
| Formulario crear/editar planta | `mobile/src/components/PlantFormModal.jsx` |
| Registro de push notifications | `mobile/src/lib/notifications.js` (llamado en `mobile/src/app/_layout.jsx:10`) |

**CRUD disponible solo desde el móvil:** crear, editar, eliminar planta
(`mobile/src/api.js:74,80,89`) y cambiar el umbral (`mobile/src/api.js:83`).
La app **no** tiene gestión de tipos de planta más allá de subir imágenes.

### 2.3 Dashboard web (`web/`) — React + Vite

| Funcionalidad | Ubicación |
|---|---|
| Lista de plantas (solo lectura) + pestaña de tipos | `web/src/App.jsx:10` |
| Crear tipo de planta | `web/src/App.jsx:55` |
| Subir imágenes de un tipo | `web/src/App.jsx:67` |
| Tarjeta de planta | `web/src/components/PlantCard.jsx` |
| Modal de tipo (crear/editar imágenes) | `web/src/components/TypeFormModal.jsx` |

**La web NO crea plantas**: solo gestiona *tipos* (`POST /types`,
`POST /types/{id}/images`). Crear/editar/eliminar plantas es exclusivo del móvil.

### 2.4 Firmware ESP32 (`esp32_code/plantagochi/`)

| Funcionalidad | Ubicación |
|---|---|
| Bucle principal, temporizador de lectura | `esp32_code/plantagochi/plantagochi.ino:12` |
| Manejo de eventos WiFi | `esp32_code/plantagochi/plantagochi.ino:41` |
| Cálculo de estado en el dispositivo | `esp32_code/plantagochi/plantagochi.ino:223` |
| Configuración (WiFi, `DEVICE_ID`, API) | `config.h` (no se versiona), plantilla en `config.example.h` |

> **Nota (`DEVICE_ID`):** el `DEVICE_ID` del ESP32 debe ser **idéntico** al
> `device_id` de la planta creada en la app móvil. Es lo que une el sensor con
> la planta.

### 2.5 Base de datos

| Funcionalidad | Ubicación |
|---|---|
| Esquema completo (v1–v4) | fichero `db` en la raíz |
| v4: `push_token(token UNIQUE)`, `plant_push`, `plant_type.images_updated_at`, extensión `vector` | fichero `db` |

---

## 3. Estado de ánimo duplicado

La misma fórmula vive en dos sitios, a propósito, para que el ESP32 mantenga su
autonomía:

- API: `api/db.py:105` (`getMoodStatus`)
- ESP32: `esp32_code/plantagochi/plantagochi.ino:223` (`calcularEstado`)

Ambas usan cortes fijos (80 / 50 / 30 %) y `supersad` por debajo del umbral de
riego, así que deben devolver el mismo estado. Si se cambia una, hay que cambiar
la otra.

(La lista de estados `STATES` sí está centralizada: se define una única vez en
`api/default_images.py:25` y se importa en `api/db.py` y
`api/routes/plantagochi.py`, que son sus consumidores.)
