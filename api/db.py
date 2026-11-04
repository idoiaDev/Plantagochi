import os
from dotenv import load_dotenv
from pathlib import Path
import psycopg2
import psycopg2.errors

import default_images
from default_images import STATES

load_dotenv(Path(__file__).parent / '.env')

# Lee las variables de entorno asignándolas a variables de Python
db_host = os.getenv('DB_HOST')
db_user = os.getenv('DB_USER')
db_password = os.getenv('DB_PASSWORD')
db_port = os.getenv('DB_PORT')
db_name = os.getenv('DB_NAME')

# Traducción de cada estado a lenguaje natural. Se usa para el campo
# status_label de las respuestas y para el texto que se convierte en embedding.
STATUS_LABELS = {
    "superhappy": "Súper feliz",
    "happy": "Feliz",
    "sad": "Triste",
    "supersad": "Súper triste",
    "unknown": "Sin datos",
}

IMAGE_COLUMNS = [
    "img_superhappy", "img_superhappy_change1", "img_superhappy_change2",
    "img_happy", "img_happy_change1", "img_happy_change2",
    "img_sad", "img_sad_change1", "img_sad_change2",
    "img_supersad", "img_supersad_change1", "img_supersad_change2",
]


class PlantNotFound(Exception):
    pass


class PlantTypeNotFound(Exception):
    pass


class DeviceIdAlreadyExists(Exception):
    pass


class PlantTypeNameExists(Exception):
    pass


class PlantTypeInUse(Exception):
    pass


def createConexion():
    conn = psycopg2.connect(
        database=db_name,
        user=db_user,
        password=db_password,
        host=db_host,
        port=db_port
    )

    cursor = conn.cursor()
    return conn, cursor


def _iso(value):
    return value.isoformat() if value is not None else None


def _write_state(cursor, plant_id, humidity):
    """Deja en plant_state la última lectura y anota en plant_log si cambió.

    El FOR UPDATE serializa dos lecturas simultáneas de la misma planta: sin él,
    las dos verían el mismo valor anterior y las dos meterían fila en el log.

    created_at de plant_state avanza en cada lectura aunque la humedad no
    cambie: es la señal de que el sensor sigue vivo. El de plant_log es la
    fecha del cambio.
    """
    cursor.execute(
        "SELECT humidity FROM plant_state WHERE plant_id = %s FOR UPDATE",
        (plant_id,),
    )
    anterior = cursor.fetchone()

    if anterior is None or anterior[0] != humidity:
        cursor.execute(
            "INSERT INTO plant_log (plant_id, humidity) VALUES (%s, %s)",
            (plant_id, humidity),
        )

    cursor.execute(
        "INSERT INTO plant_state (plant_id, humidity, created_at) "
        "VALUES (%s, %s, NOW()) "
        "ON CONFLICT (plant_id) DO UPDATE "
        "SET humidity = EXCLUDED.humidity, created_at = NOW()",
        (plant_id, humidity),
    )


def _b(data):
    return bytes(data) if data is not None else None


def getMoodStatus(humidity, min_humidity):
    """Estado de ánimo con cortes fijos, igual que el ESP32.

    >=80 superhappy, >=50 happy, >=30 sad. Por debajo del umbral de riego de la
    planta (si es > 0) se fuerza supersad.
    """
    if humidity is None:
        return "unknown"

    if humidity >= 80:
        return "superhappy"
    if humidity >= 50:
        return "happy"
    if min_humidity is not None and min_humidity > 0 and humidity < min_humidity:
        return "supersad"
    if humidity >= 30:
        return "sad"
    return "supersad"


def needs_water(humidity, min_humidity):
    if humidity is None or min_humidity is None:
        return False
    return min_humidity > 0 and humidity < min_humidity


# Columnas y JOIN que comparten getAll() y la búsqueda por embedding, para que
# ambas respuestas tengan siempre la misma forma. El estado de ánimo y el
# umbral de riego viajan ya calculados en el dict, no se guardan.
#
# El JOIN con plant_state es un LEFT JOIN normal porque plant_state tiene una
# única fila por planta. Antes hacía falta un LATERAL con ORDER BY id DESC para
# quedarse con la última lectura de un histórico; ya no.
PLANT_FIELDS = """
    p.id,
    p.name,
    p.description,
    p.type_id,
    t.name AS type_name,
    p.device_id,
    p.min_humidity,
    p.updated_at,
    s.humidity,
    s.created_at AS measured_at
"""

PLANT_FROM = """
    FROM plant p
    LEFT JOIN plant_type t ON t.id = p.type_id
    LEFT JOIN plant_state s ON s.plant_id = p.id
"""


def _plant_dict(row, distance=None):
    """Convierte una fila de PLANT_FIELDS en el dict que ve el cliente."""
    (plant_id, name, description, type_id, type_name, device_id,
     min_humidity, updated_at, humidity, measured_at) = row

    status = getMoodStatus(humidity, min_humidity)
    result = {
        "id": plant_id,
        "name": name,
        "description": description,
        "type_id": type_id,
        "type": type_name,
        "image": f"types/{type_id}/images" if type_id else None,
        "device_id": device_id,
        "min_humidity": min_humidity,
        "humidity": humidity,
        "status": status,
        "status_label": STATUS_LABELS[status],
        "needs_water": needs_water(humidity, min_humidity),
        "last_updated": _iso(measured_at) or _iso(updated_at),
    }
    if distance is not None:
        result["distance"] = float(distance)
    return result


def getAll():
    conn, cursor = createConexion()
    try:
        cursor.execute(f"SELECT {PLANT_FIELDS} {PLANT_FROM} ORDER BY p.id")
        return [_plant_dict(row) for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------
# CRUD plantas
# ---------------------------------------------------------------------------

def createPlant(name, device_id, min_humidity, type_id, description=None):
    conn, cursor = createConexion()
    try:
        cursor.execute("SELECT id FROM plant_type WHERE id = %s", (type_id,))
        if cursor.fetchone() is None:
            raise PlantTypeNotFound(type_id)

        try:
            cursor.execute(
                "INSERT INTO plant (name, device_id, min_humidity, type_id, description) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (name, device_id, min_humidity, type_id, description),
            )
        except psycopg2.errors.UniqueViolation:
            raise DeviceIdAlreadyExists(device_id)

        plant_id = cursor.fetchone()[0]
        conn.commit()
        return plant_id
    finally:
        cursor.close()
        conn.close()


def updatePlant(id, name, device_id, min_humidity, type_id, description=None):
    conn, cursor = createConexion()
    try:
        cursor.execute("SELECT id FROM plant_type WHERE id = %s", (type_id,))
        if cursor.fetchone() is None:
            raise PlantTypeNotFound(type_id)

        try:
            cursor.execute(
                "UPDATE plant SET "
                "  name = %s, device_id = %s, min_humidity = %s, "
                "  type_id = %s, description = %s, updated_at = NOW() "
                "WHERE id = %s",
                (name, device_id, min_humidity, type_id, description, id),
            )
        except psycopg2.errors.UniqueViolation:
            raise DeviceIdAlreadyExists(device_id)

        if cursor.rowcount == 0:
            raise PlantNotFound(id)
        conn.commit()
        return True
    finally:
        cursor.close()
        conn.close()


def updateMinHumidity(id, min_humidity):
    conn, cursor = createConexion()
    try:
        cursor.execute(
            "UPDATE plant SET min_humidity = %s, updated_at = NOW() "
            "WHERE id = %s",
            (min_humidity, id),
        )
        if cursor.rowcount == 0:
            raise PlantNotFound(id)
        conn.commit()
        return True
    finally:
        cursor.close()
        conn.close()


def deletePlant(id):
    conn, cursor = createConexion()
    try:
        cursor.execute("SELECT 1 FROM plant WHERE id = %s", (id,))
        if cursor.fetchone() is None:
            raise PlantNotFound(id)

        cursor.execute("DELETE FROM plant WHERE id = %s", (id,))
        conn.commit()
        return True
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------
# Notificaciones push
# ---------------------------------------------------------------------------

def registerPushToken(token):
    """Guarda la dirección de push de un móvil. Reregistros no duplican fila."""
    conn, cursor = createConexion()
    try:
        cursor.execute(
            "INSERT INTO push_token (token) VALUES (%s) "
            "ON CONFLICT (token) DO UPDATE SET created_at = now()",
            (token,),
        )
        conn.commit()
        return True
    finally:
        cursor.close()
        conn.close()


def getPushTokens():
    conn, cursor = createConexion()
    try:
        cursor.execute("SELECT token FROM push_token ORDER BY id")
        return [row[0] for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def deletePushToken(token):
    """Olvida un móvil que Expo da de baja (app desinstalada o sin permiso)."""
    conn, cursor = createConexion()
    try:
        cursor.execute("DELETE FROM push_token WHERE token = %s", (token,))
        conn.commit()
        return True
    finally:
        cursor.close()
        conn.close()


def decide_push(cursor, plant_id, plant_name, humidity, min_humidity):
    """Decide si toca avisar por push y deja plant_push al día.

    Se apoya solo en dos cosas: si la planta está seca ahora y si ya tiene una
    notificación viva. Nunca en la humedad anterior, que es lo que haría que el
    aviso se pierda si la API se reinicia entre dos lecturas del sensor.

    Devuelve el push a enviar, o None si no hay que avisar.
    """
    cursor.execute("SELECT 1 FROM plant_push WHERE plant_id = %s", (plant_id,))
    has_push = cursor.fetchone() is not None
    is_dry = needs_water(humidity, min_humidity)

    if is_dry and not has_push:
        cursor.execute(
            "INSERT INTO plant_push (plant_id) VALUES (%s) ON CONFLICT DO NOTHING",
            (plant_id,),
        )
        return {
            "plant_id": plant_id,
            "resolved": False,
            "title": f"{plant_name} necesita agua",
            "body": f"Humedad {humidity:g}% · necesita {min_humidity:g}%",
        }

    if not is_dry and has_push:
        cursor.execute("DELETE FROM plant_push WHERE plant_id = %s", (plant_id,))
        return {
            "plant_id": plant_id,
            "resolved": True,
            "title": f"{plant_name} ya no necesita agua",
            "body": f"Humedad {humidity:g}% · umbral {min_humidity:g}%",
        }

    return None


# ---------------------------------------------------------------------------
# Estado / humedad
# ---------------------------------------------------------------------------

def insertStatus(id, humidity):
    conn, cursor = createConexion()
    try:
        _write_state(cursor, id, humidity)
        conn.commit()
        return True
    finally:
        cursor.close()
        conn.close()


def insertStatusByDevice(device_id, humidity):
    conn, cursor = createConexion()
    try:
        cursor.execute(
            "SELECT id, name, min_humidity FROM plant WHERE device_id = %s",
            (device_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise PlantNotFound(device_id)
        plant_id, plant_name, min_humidity = row

        cursor.execute(
            "SELECT p.updated_at, t.images_updated_at "
            "FROM plant p "
            "LEFT JOIN plant_type t ON t.id = p.type_id "
            "WHERE p.id = %s",
            (plant_id,),
        )
        updated_at, images_updated_at = cursor.fetchone()

        push = decide_push(cursor, plant_id, plant_name, humidity, min_humidity)

        _write_state(cursor, plant_id, humidity)
        conn.commit()

        return {
            "plant_version": _iso(updated_at) or "",
            "images_version": _iso(images_updated_at) or "",
        }, push
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------
# Tipos de planta
# ---------------------------------------------------------------------------

def getTypes():
    conn, cursor = createConexion()
    try:
        cursor.execute(
            "SELECT id, name, images_updated_at FROM plant_type ORDER BY name"
        )
        return [
            {"id": row[0], "name": row[1], "images_updated_at": _iso(row[2])}
            for row in cursor.fetchall()
        ]
    finally:
        cursor.close()
        conn.close()


def createType(name):
    conn, cursor = createConexion()
    try:
        images = default_images.get_default_images()
        values = []
        for state in STATES:
            values.extend(images[state])
        assert len(values) == len(IMAGE_COLUMNS), "default_images debe cubrir 3 frames por estado"

        columns = ", ".join(IMAGE_COLUMNS)
        placeholders = ", ".join(["%s"] * len(IMAGE_COLUMNS))
        sql = (
            f"INSERT INTO plant_type "
            f"(name, img_width, img_height, {columns}) "
            f"VALUES (%s, %s, %s, {placeholders}) RETURNING id"
        )
        params = [
            name,
            default_images.WIDTH,
            default_images.HEIGHT,
            *values,
        ]

        try:
            cursor.execute(sql, params)
        except psycopg2.errors.UniqueViolation:
            raise PlantTypeNameExists(name)

        new_id = cursor.fetchone()[0]
        conn.commit()
        return new_id
    finally:
        cursor.close()
        conn.close()


def deleteType(id):
    conn, cursor = createConexion()
    try:
        cursor.execute("SELECT 1 FROM plant_type WHERE id = %s", (id,))
        if cursor.fetchone() is None:
            raise PlantTypeNotFound(id)

        try:
            cursor.execute("DELETE FROM plant_type WHERE id = %s", (id,))
        except psycopg2.errors.ForeignKeyViolation:
            conn.rollback()
            raise PlantTypeInUse(id)

        conn.commit()
        return True
    finally:
        cursor.close()
        conn.close()


def getPlantByDevice(device_id):
    conn, cursor = createConexion()
    try:
        cursor.execute(
            "SELECT p.id, p.name, p.type_id, t.name, p.min_humidity, "
            "       t.img_width, t.img_height "
            "FROM plant p "
            "LEFT JOIN plant_type t ON t.id = p.type_id "
            "WHERE p.device_id = %s",
            (device_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "name": row[1],
            "type_id": row[2],
            "type": row[3],
            "min_humidity": row[4],
            "img_width": row[5],
            "img_height": row[6],
        }
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------
# Embeddings (pgvector)
# ---------------------------------------------------------------------------
# El embedding solo se construye con datos estables (identidad y umbral de
# riego). El estado de ánimo y si necesita agua no se guardan ni se embeben: se
# calculan aquí, en _plant_dict(), cada vez que se responde.

def getPlantEmbeddingSource(plant_id):
    """Datos que alimentan el embedding de una planta.

    Devuelve nombre, descripción, device_id y umbral de riego. Ni el tipo ni el
    estado de ánimo: el tipo renombraría embeddings viejos en cascada y el estado
    se calcula al responder la API. Lanza PlantNotFound si no existe.
    """
    conn, cursor = createConexion()
    try:
        cursor.execute(
            "SELECT name, description, device_id, min_humidity FROM plant "
            "WHERE id = %s",
            (plant_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise PlantNotFound(plant_id)
        name, description, device_id, min_humidity = row
        return {
            "name": name,
            "description": description,
            "device_id": device_id,
            "min_humidity": min_humidity,
        }
    finally:
        cursor.close()
        conn.close()


def savePlantEmbedding(plant_id, embedding):
    """Guarda el vector de la planta. ``embedding`` es una lista de floats."""
    conn, cursor = createConexion()
    try:
        cursor.execute(
            "UPDATE plant SET embedding = %s::vector WHERE id = %s",
            (str(embedding), plant_id),
        )
        conn.commit()
        return True
    finally:
        cursor.close()
        conn.close()


def searchPlantsByEmbedding(embedding, limit, max_distance):
    """Plantas más parecidas a un embedding, usando distancia coseno (<=>).

    Devuelve el mismo dict que getAll() más ``distance``: 0 = idéntico, 1 = nada
    que ver. Las plantas sin embedding se descartan.
    """
    vector = str(embedding)
    sql = (
        f"SELECT {PLANT_FIELDS},\n"
        "       p.embedding <=> %s::vector AS distance\n"
        f"{PLANT_FROM}"
        "WHERE p.embedding IS NOT NULL\n"
        "  AND p.embedding <=> %s::vector <= %s\n"
        "ORDER BY p.embedding <=> %s::vector\n"
        "LIMIT %s"
    )
    params = (vector, vector, max_distance, vector, limit)

    conn, cursor = createConexion()
    try:
        cursor.execute(sql, params)
        return [_plant_dict(row, row[-1]) for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------
# Polling
# ---------------------------------------------------------------------------

def getLastUpdate():
    conn, cursor = createConexion()
    try:
        # Antes era MAX(id) de plant_state, que cambiaba en cada lectura porque
        # cada una insertaba fila. Con una fila por planta lo que avanza en cada
        # lectura es created_at, y es justo lo que necesita el móvil como firma
        # para saber si tiene que recargar.
        cursor.execute("SELECT MAX(created_at) FROM plant_state")
        last_state_time = cursor.fetchone()[0]

        cursor.execute(
            "SELECT COALESCE(MAX(id), 0), MAX(updated_at) FROM plant"
        )
        row = cursor.fetchone()

        cursor.execute("SELECT MAX(images_updated_at) FROM plant_type")
        last_images_update = cursor.fetchone()[0]

        return {
            "last_state_time": _iso(last_state_time),
            "last_plant_id": row[0],
            "last_plant_update": _iso(row[1]),
            "last_images_update": _iso(last_images_update),
        }
    finally:
        cursor.close()
        conn.close()


# ---------------------------------------------------------------------------
# Imágenes de tipo (RGB565 en BYTEA)
# ---------------------------------------------------------------------------

def getType(type_id):
    conn, cursor = createConexion()
    try:
        cursor.execute(
            "SELECT name, img_width, img_height, images_updated_at, "
            + ", ".join(IMAGE_COLUMNS) + " "
            "FROM plant_type WHERE id = %s",
            (type_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        name, width, height, images_updated_at, *images = row
        frame_cols = {
            "superhappy": (0, 1, 2),
            "happy": (3, 4, 5),
            "sad": (6, 7, 8),
            "supersad": (9, 10, 11),
        }
        frames = {
            state: [_b(images[i]) for i in idxs]
            for state, idxs in frame_cols.items()
        }
        return {
            "id": type_id,
            "name": name,
            "width": width,
            "height": height,
            "images_updated_at": _iso(images_updated_at),
            "frames": frames,
        }
    finally:
        cursor.close()
        conn.close()


def updateTypeImages(type_id, name=None, frames=None):
    """Guarda las imágenes (u otros cambios) de un tipo de planta.

    ``frames`` es una lista de 12 bytes opcionales — un valor por columna de
    IMAGE_COLUMNS (None = NULL en la BD). ``name`` se actualiza solo si viene y
    las imágenes solo si ``frames`` no es None. Devuelve {"id", "name",
    "images_updated_at"} o lanza PlantTypeNotFound.
    """
    assert frames is None or len(frames) == len(IMAGE_COLUMNS)
    assert name is not None or frames is not None

    sets = []
    params = []

    if name is not None:
        sets.append("name = %s")
        params.append(name)

    if frames is not None:
        sets.extend(["img_width = %s", "img_height = %s"])
        params.extend([default_images.WIDTH, default_images.HEIGHT])
        sets.extend(f"{col} = %s" for col in IMAGE_COLUMNS)
        params.extend(frames)
        sets.append("images_updated_at = NOW()")

    sql = f"UPDATE plant_type SET {', '.join(sets)} WHERE id = %s RETURNING name, images_updated_at"
    params.append(type_id)

    conn, cursor = createConexion()
    try:
        cursor.execute(sql, params)
        row = cursor.fetchone()
        if row is None:
            raise PlantTypeNotFound(type_id)
        name_after, updated_at = row
        conn.commit()
        return {
            "id": type_id,
            "name": name_after,
            "images_updated_at": _iso(updated_at),
        }
    finally:
        cursor.close()
        conn.close()


def refreshTypeImages(type_id=None):
    """Relee default_images (api/images/*.jpg) y actualiza los frames en la BD.

    Con type_id refresca un tipo concreto; sin él, todos los tipos.
    Devuelve el número de filas actualizadas.
    """
    images = default_images.get_default_images()
    values = []
    for state in STATES:
        values.extend(images[state])
    assert len(values) == len(IMAGE_COLUMNS), "default_images debe cubrir 3 frames por estado"

    columns = ", ".join(f"{col} = %s" for col in IMAGE_COLUMNS)
    sql = (
        "UPDATE plant_type "
        f"SET img_width = %s, img_height = %s, {columns}, images_updated_at = NOW()"
    )
    params = [default_images.WIDTH, default_images.HEIGHT, *values]
    if type_id is not None:
        sql += " WHERE id = %s"
        params.append(type_id)

    conn, cursor = createConexion()
    try:
        cursor.execute(sql, params)
        updated = cursor.rowcount
        conn.commit()
        if type_id is not None and updated == 0:
            raise PlantTypeNotFound(type_id)
        return updated
    finally:
        cursor.close()
        conn.close()