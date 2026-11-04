"""Imágenes base por defecto (fuente única: carpeta api/images).

Las variables apuntan a ficheros de imagen que viven en api/images/. Para
sustituir un default, reemplaza el fichero o edita la variable. get_default_images()
las convierte a 240x240 (recorte central) y a RGB565 little-endian para la BD.

Cadena de reserva:
- un estado sin frame de cambio usa la base repetida;
- un fichero ausente o ilegible usa el rectángulo gris de emergencia.

Las columnas img_*_change1/change2 de la BD siguen siendo NULL-ables: si un tipo
se deja sin change, la API solo sirve el frame 0 (el original).
"""

from io import BytesIO
from pathlib import Path

from PIL import Image

API_DIR = Path(__file__).parent

WIDTH = 240
HEIGHT = 240

STATES = ["superhappy", "happy", "sad", "supersad"]

IMG_SUPERHAPPY = "images/superhappy.jpg"
IMG_HAPPY = "images/happy.jpg"
IMG_HAPPY_CHANGE1 = "images/happy_change1.jpg"
IMG_HAPPY_CHANGE2 = "images/happy_change2.jpg"
IMG_SAD = "images/sad.jpg"
IMG_SAD_CHANGE1 = "images/sad_change1.jpg"
IMG_SAD_CHANGE2 = "images/sad_change2.jpg"
IMG_SUPERSAD = "images/supersad.jpg"

# estado -> (frame base, frame cambio 1, frame cambio 2)
STATE_FILES = {
    "superhappy": (IMG_SUPERHAPPY, None, None),
    "happy": (IMG_HAPPY, IMG_HAPPY_CHANGE1, IMG_HAPPY_CHANGE2),
    "sad": (IMG_SAD, IMG_SAD_CHANGE1, IMG_SAD_CHANGE2),
    "supersad": (IMG_SUPERSAD, None, None),
}


def _rgb888_to_565(r, g, b):
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def _solid_frame(r, g, b):
    value = _rgb888_to_565(r, g, b)
    return bytes([value & 0xFF, (value >> 8) & 0xFF]) * (WIDTH * HEIGHT)


# Rectángulo gris de emergencia (#9CA3AF).
GRAY_FRAME = _solid_frame(156, 163, 175)


def _pil_to_rgb565(img):
    """Recorta a cuadrado central 240x240 y convierte un PIL Image a RGB565 LE."""
    width, height = img.size
    side = max(width, height)
    if side > WIDTH:
        scale = WIDTH / side
        img = img.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.Resampling.LANCZOS,
        )
    width, height = img.size

    left = (width - WIDTH) // 2
    top = (height - HEIGHT) // 2
    img = img.crop((left, top, left + WIDTH, top + HEIGHT))
    img = img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)

    raw = img.tobytes()
    frame = bytearray()
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        value = _rgb888_to_565(r, g, b)
        frame.append(value & 0xFF)
        frame.append((value >> 8) & 0xFF)
    return bytes(frame)


def _image_to_rgb565(path):
    """Carga un fichero de imagen y lo convierte al formato BD."""
    with Image.open(path) as img:
        return _pil_to_rgb565(img.convert("RGB"))


def bytes_to_rgb565(data):
    """Convierte los bytes de una imagen (JPEG/PNG/...) al formato BD.

    Puede lanzar cualquier excepción de PIL si los bytes no son una imagen
    válida; el llamador decide cómo responder al cliente.
    """
    with Image.open(BytesIO(data)) as img:
        return _pil_to_rgb565(img.convert("RGB"))


def _load_frame(file_name):
    if file_name is None:
        return None
    path = API_DIR / file_name
    if not path.exists():
        return None
    try:
        return _image_to_rgb565(path)
    except Exception as exc:
        print(f"[default_images] no se pudo leer '{path}': {exc} -> gris de emergencia")
        return None


def get_default_images():
    """12 frames listos para la BD: {estado: [base, change1, change2]}."""
    images = {}
    for state in STATES:
        base_file, change1_file, change2_file = STATE_FILES[state]
        base = _load_frame(base_file)
        if base is None:
            print(f"[default_images] sin imagen base para '{state}' -> gris de emergencia")
            images[state] = [GRAY_FRAME, GRAY_FRAME, GRAY_FRAME]
            continue
        change1 = _load_frame(change1_file)
        change2 = _load_frame(change2_file)
        images[state] = [
            base,
            change1 if change1 is not None else base,
            change2 if change2 is not None else base,
        ]
    return images