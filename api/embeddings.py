"""Embeddings de planta vía Ollama (nomic-embed-text) + búsqueda por similitud.

El embedding de una planta es un resumen en lenguaje natural de su nombre, su
descripción, su device_id y su umbral de riego. El tipo de planta y el estado de
ánimo NO van aquí: se calculan o se leen al responder la API, y así siempre
viajan al día (ver db._plant_dict).
"""

import os

import httpx

import db

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
EMBEDDING_DIMENSIONS = 768
EMBEDDING_TIMEOUT = float(os.getenv("EMBEDDING_TIMEOUT", "30"))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")


class EmbeddingError(Exception):
    pass


def build_plant_text(source):
    """Resume la info de una planta en una frase, a partir de getPlantEmbeddingSource().

    Entran solo datos que identifican a la planta: nombre, descripción,
    device_id y umbral de riego. El tipo de planta y el estado de ánimo NO van
    aquí; el tipo porque renombrarlo dejaría viejos los embeddings de todas sus
    plantas, y el estado porque cambia con cada lectura de humedad. Los dos van
    en la respuesta de la API, calculados al momento (ver db._plant_dict).
    """
    name = (source.get("name") or "").strip()
    description = (source.get("description") or "").strip()
    device_id = (source.get("device_id") or "").strip()
    threshold = source.get("min_humidity")

    parts = [f"Planta llamada {name}"]
    if description:
        parts.append(description)
    if device_id:
        parts.append(f"dispositivo {device_id}")
    if threshold is not None:
        parts.append(f"umbral de riego del {int(threshold)} por ciento de humedad")

    return ". ".join(parts) + "."


async def embed_text(text):
    """Vector de embeddings de un texto. Lanza EmbeddingError si falla."""
    try:
        async with httpx.AsyncClient(timeout=EMBEDDING_TIMEOUT) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBEDDING_MODEL, "prompt": text},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise EmbeddingError(f"Ollama no responde: {exc}")

    vector = response.json().get("embedding")
    if not vector:
        raise EmbeddingError("Ollama no ha devuelto embedding")
    if len(vector) != EMBEDDING_DIMENSIONS:
        raise EmbeddingError(
            f"{EMBEDDING_MODEL} devuelve {len(vector)} dimensiones, "
            f"se esperaban {EMBEDDING_DIMENSIONS}"
        )
    return vector


async def refresh_plant_embedding(plant_id):
    """Regenera el embedding de una planta a partir de sus datos actuales.

    Best-effort: si Ollama falla, lo avisa por consola y devuelve False en lugar
    de propagar el error, para que la escritura de la planta no se caiga.
    Devuelve True si el embedding quedó actualizado.
    """
    try:
        source = db.getPlantEmbeddingSource(plant_id)
        vector = await embed_text(build_plant_text(source))
        db.savePlantEmbedding(plant_id, vector)
        return True
    except EmbeddingError as exc:
        print(f"[EMBEDDINGS] planta {plant_id}: {exc}")
        return False
