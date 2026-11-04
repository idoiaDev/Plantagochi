from io import BytesIO
from struct import pack

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from PIL import Image

import default_images
import embeddings
from default_images import STATES

from exports import list_exports
from push import send_plant_push

from db import (
    getAll,
    createPlant,
    updatePlant,
    updateMinHumidity,
    deletePlant,
    insertStatus,
    insertStatusByDevice,
    registerPushToken,
    getTypes,
    createType,
    deleteType,
    getPlantByDevice,
    getLastUpdate,
    getType,
    refreshTypeImages,
    updateTypeImages,
    searchPlantsByEmbedding,
    PlantNotFound,
    PlantTypeNotFound,
    DeviceIdAlreadyExists,
    PlantTypeNameExists,
    PlantTypeInUse,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Modelos / validación
# ---------------------------------------------------------------------------

class PlantCreate(BaseModel):
    name: str
    device_id: str
    min_humidity: float = Field(default=30, ge=0, le=100)
    type_id: int
    description: str | None = None


class PlantUpdate(BaseModel):
    name: str
    device_id: str
    min_humidity: float = Field(ge=0, le=100)
    type_id: int
    description: str | None = None


class SearchQuery(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=5, ge=1, le=50)
    max_distance: float = Field(default=0.6, ge=0.0, le=2.0)


class MinHumidityUpdate(BaseModel):
    min_humidity: float = Field(ge=0, le=100)


class HumidityUpdate(BaseModel):
    humidity: float = Field(ge=0, le=100)


class DeviceHumidityUpdate(BaseModel):
    device_id: str
    humidity: float = Field(ge=0, le=100)


class PushTokenCreate(BaseModel):
    token: str = Field(min_length=1)


class TypeCreate(BaseModel):
    name: str


class TypeImagesUpdate(BaseModel):
    id: int
    name: str
    images_updated_at: str | None = None


def _run(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except PlantNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Planta no encontrada: {exc}")
    except PlantTypeNotFound as exc:
        raise HTTPException(status_code=400, detail=f"Tipo de planta no válido: {exc}")
    except DeviceIdAlreadyExists as exc:
        raise HTTPException(status_code=409, detail=f"device_id ya en uso: {exc}")
    except PlantTypeNameExists as exc:
        raise HTTPException(status_code=409, detail=f"Nombre de tipo ya en uso: {exc}")
    except PlantTypeInUse as exc:
        raise HTTPException(
            status_code=409,
            detail="Ese tipo está asignado a una o más plantas. Cámbialas de tipo antes de eliminarlo.",
        )
    except embeddings.EmbeddingError as exc:
        raise HTTPException(status_code=503, detail=f"Embeddings no disponibles: {exc}")


# ---------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------

@router.get("/plantagochi/all")
async def all():
    return getAll()


@router.get("/plantagochi/types")
async def types():
    return getTypes()


@router.get("/plantagochi/last-update")
async def last_update():
    return getLastUpdate()


@router.get("/plantagochi/exports")
async def exports():
    # Solo lectura: el export mensual lo dispara el planificador de main.py.
    # Esto está para poder ver qué se ha generado y cuándo, sin meterse por SSH.
    return list_exports()


@router.get("/plantagochi/device/{device_id}")
async def device(device_id: str):
    plant = getPlantByDevice(device_id)
    if plant is None:
        raise HTTPException(status_code=404, detail="device_id desconocido")
    return plant


# ---------------------------------------------------------------------------
# Escritura
# ---------------------------------------------------------------------------

@router.post("/plantagochi/state", status_code=201)
async def ingest_state(body: DeviceHumidityUpdate, background: BackgroundTasks):
    result, push = _run(insertStatusByDevice, body.device_id, body.humidity)
    # En segundo plano: el ESP32 no tiene por qué esperar los ~400 ms de Expo
    # para que le confirmemos su lectura de humedad.
    if push is not None:
        background.add_task(send_plant_push, push)
    return result


# Antes que POST /plantagochi/{plant_id}, que al esperar un int se quedaría
# con este tramo de la ruta y devolvería 422 en vez de llegar aquí.
@router.post("/plantagochi/push-token")
async def register_push_token(body: PushTokenCreate):
    registerPushToken(body.token)
    return {"registered": True}


@router.post("/plantagochi", status_code=201)
async def create(body: PlantCreate):
    plant_id = _run(
        createPlant, body.name, body.device_id, body.min_humidity, body.type_id,
        body.description,
    )
    embedded = await embeddings.refresh_plant_embedding(plant_id)
    return {"id": plant_id, "embedded": embedded}


@router.post("/plantagochi/types", status_code=201)
async def create_type(body: TypeCreate):
    type_id = _run(createType, body.name)
    return {"id": type_id, "name": body.name}


@router.delete("/plantagochi/types/{type_id}")
async def delete_plant_type(type_id: int):
    return _run(deleteType, type_id)


@router.put("/plantagochi/{plant_id}")
async def update(plant_id: int, body: PlantUpdate):
    _run(
        updatePlant,
        plant_id,
        body.name,
        body.device_id,
        body.min_humidity,
        body.type_id,
        body.description,
    )
    embedded = await embeddings.refresh_plant_embedding(plant_id)
    return {"id": plant_id, "embedded": embedded}


@router.patch("/plantagochi/{plant_id}/threshold")
async def update_threshold(plant_id: int, body: MinHumidityUpdate):
    _run(updateMinHumidity, plant_id, body.min_humidity)
    # El umbral forma parte del texto del embedding, así que hay que rehacerlo.
    embedded = await embeddings.refresh_plant_embedding(plant_id)
    return {"id": plant_id, "min_humidity": body.min_humidity, "embedded": embedded}


@router.delete("/plantagochi/{plant_id}")
async def delete(plant_id: int):
    return _run(deletePlant, plant_id)


# ---------------------------------------------------------------------------
# Búsqueda semántica
# ---------------------------------------------------------------------------
# Esta ruta se declara ANTES de "POST /plantagochi/{plant_id}" de abajo: FastAPI
# resuelve en orden de registro y ese path captura cualquier POST, así que
# /plantagochi/search se interpretaría como un plant_id entero (422).

@router.post("/plantagochi/search")
async def search(body: SearchQuery):
    """Plantas más parecidas a una descripción en lenguaje natural.

    Devuelve el mismo dict que GET /plantagochi/all más ``distance``: distancia
    coseno donde 0 = idéntico y 1 = nada que ver. Sin resultados si no hay
    ninguna planta dentro de ``max_distance``.
    """
    vector = await _run(embeddings.embed_text, body.query)
    return _run(searchPlantsByEmbedding, vector, body.limit, body.max_distance)


# ---------------------------------------------------------------------------
# Ingesta antigua (compatibilidad mientras se adapta el ESP32)
# ---------------------------------------------------------------------------

@router.post("/plantagochi/{plant_id}")
async def set_humidity(plant_id: int, body: HumidityUpdate):
    return _run(insertStatus, plant_id, body.humidity)


# ---------------------------------------------------------------------------
# Imágenes del tipo (RGB565 raw para ESP32, PNG para el dashboard)
# ---------------------------------------------------------------------------

def _get_type_or_404(type_id: int):
    type_data = getType(type_id)
    if type_data is None:
        raise HTTPException(status_code=404, detail="Tipo de planta no encontrado")
    return type_data


@router.get("/plantagochi/types/{type_id}/manifest")
async def manifest(type_id: int):
    type_data = _get_type_or_404(type_id)
    states = {}
    for state in STATES:
        frames = type_data["frames"][state]
        states[state] = {
            "frames": [
                {"available": data is not None, "size": len(data) if data else 0}
                for data in frames
            ]
        }
    return {
        "id": type_data["id"],
        "name": type_data["name"],
        "width": type_data["width"],
        "height": type_data["height"],
        "images_updated_at": type_data.get("images_updated_at"),
        "states": states,
    }


def _frame_or_404(type_data, state: str, frame: int):
    if state not in STATES:
        raise HTTPException(status_code=400, detail=f"Estado no válido: {state}")
    if frame not in (0, 1, 2):
        raise HTTPException(status_code=400, detail="frame debe ser 0, 1 o 2")
    data = type_data["frames"][state][frame]
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"No existe frame {frame} para el estado '{state}'",
        )
    return data


def _rgb565_to_png(frame: bytes, width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height))
    px = img.load()
    for y in range(height):
        base = y * width * 2
        for x in range(width):
            i = base + x * 2
            value = frame[i] | (frame[i + 1] << 8)
            r5 = (value >> 11) & 0x1F
            g6 = (value >> 5) & 0x3F
            b5 = value & 0x1F
            px[x, y] = (
                (r5 << 3) | (r5 >> 2),
                (g6 << 2) | (g6 >> 4),
                (b5 << 3) | (b5 >> 2),
            )
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@router.get("/plantagochi/types/{type_id}/images/{state}/raw")
async def image_raw(
    type_id: int,
    state: str,
    frame: int = Query(default=0, ge=0, le=2),
):
    type_data = _get_type_or_404(type_id)
    data = _frame_or_404(type_data, state, frame)
    return Response(content=data, media_type="application/octet-stream")


@router.get("/plantagochi/types/{type_id}/images/{state}/png")
async def image_png(
    type_id: int,
    state: str,
    frame: int = Query(default=0, ge=0, le=2),
):
    type_data = _get_type_or_404(type_id)
    data = _frame_or_404(type_data, state, frame)
    png = _rgb565_to_png(data, type_data["width"], type_data["height"])
    return Response(content=png, media_type="image/png")


@router.get("/plantagochi/types/{type_id}/images/{state}/all/raw")
async def images_all_raw(type_id: int, state: str):
    """Los 3 frames de un estado concatenados.

    Formato: por cada frame (base, change1, change2) 4 bytes de longitud
    little-endian seguidos de los bytes RGB565; longitud 0 = no disponible.
    """
    type_data = _get_type_or_404(type_id)
    if state not in STATES:
        raise HTTPException(status_code=400, detail=f"Estado no válido: {state}")

    frames = type_data["frames"][state]
    buf = BytesIO()
    for data in frames:
        if data is None:
            buf.write(pack("<I", 0))
        else:
            buf.write(pack("<I", len(data)))
            buf.write(data)
    return Response(content=buf.getvalue(), media_type="application/octet-stream")


# ---------------------------------------------------------------------------
# Actualización de tipo: nombre y/o imágenes subidas por el usuario
# ---------------------------------------------------------------------------

MAX_UPLOAD_BYTES = 8 * 1024 * 1024

UPLOAD_FIELDS = [
    "superhappy",
    "superhappy_change1",
    "superhappy_change2",
    "happy",
    "happy_change1",
    "happy_change2",
    "sad",
    "sad_change1",
    "sad_change2",
    "supersad",
    "supersad_change1",
    "supersad_change2",
]


@router.post("/plantagochi/types/{type_id}/images", response_model=TypeImagesUpdate)
async def update_type_images(
    type_id: int,
    name: str | None = Form(default=None),
    superhappy: UploadFile | None = File(default=None),
    superhappy_change1: UploadFile | None = File(default=None),
    superhappy_change2: UploadFile | None = File(default=None),
    happy: UploadFile | None = File(default=None),
    happy_change1: UploadFile | None = File(default=None),
    happy_change2: UploadFile | None = File(default=None),
    sad: UploadFile | None = File(default=None),
    sad_change1: UploadFile | None = File(default=None),
    sad_change2: UploadFile | None = File(default=None),
    supersad: UploadFile | None = File(default=None),
    supersad_change1: UploadFile | None = File(default=None),
    supersad_change2: UploadFile | None = File(default=None),
):
    """Sube/actualiza las imágenes (o el nombre) de un tipo de planta.

    Regla de resolución de cada frame cuando se sube al menos una imagen:
    - base del estado: si se sube fichero, se convierte; si no, se mantiene la
      imagen previa y, a falta de esta, el default del estado;
    - change1/change2: si se sube fichero, se convierte; si no, se mantiene la
      imagen previa (no se borra).
    Si no se sube ninguna imagen, solo se actualiza el nombre.
    """
    uploads = {
        "superhappy": superhappy,
        "superhappy_change1": superhappy_change1,
        "superhappy_change2": superhappy_change2,
        "happy": happy,
        "happy_change1": happy_change1,
        "happy_change2": happy_change2,
        "sad": sad,
        "sad_change1": sad_change1,
        "sad_change2": sad_change2,
        "supersad": supersad,
        "supersad_change1": supersad_change1,
        "supersad_change2": supersad_change2,
    }

    type_data = _get_type_or_404(type_id)
    previous = type_data["frames"]
    defaults = default_images.get_default_images()

    converted = {}
    for field, upload in uploads.items():
        if upload is None:
            continue
        data = await upload.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"'{field}' supera los {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
            )
        if not data:
            continue
        try:
            converted[field] = default_images.bytes_to_rgb565(data)
        except Exception:
            raise HTTPException(
                status_code=422,
                detail=f"'{field}' no es una imagen válida",
            )

    if not converted and name is None:
        raise HTTPException(
            status_code=400,
            detail="Nada que actualizar: envía al menos una imagen o un nombre",
        )

    frames = None
    if converted:
        frames = []
        for state in STATES:
            for idx in range(3):
                field = state if idx == 0 else f"{state}_change{idx}"
                if field in converted:
                    frames.append(converted[field])
                    continue
                prev = previous[state][idx]
                if prev is None and idx == 0:
                    prev = defaults[state][0]
                frames.append(prev)

    return _run(updateTypeImages, type_id, name=name, frames=frames)


# ---------------------------------------------------------------------------
# Refresco de imágenes desde api/images/ (solo afecta a plant_type)
# ---------------------------------------------------------------------------

@router.post("/plantagochi/types/images/refresh")
async def refresh_all_type_images():
    updated = refreshTypeImages()
    return {"updated": updated}


@router.post("/plantagochi/types/{type_id}/images/refresh")
async def refresh_type_images(type_id: int):
    updated = _run(refreshTypeImages, type_id)
    return {"updated": updated, "type_id": type_id}