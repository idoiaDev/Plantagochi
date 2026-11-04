import csv
import os
from datetime import datetime, timedelta
from pathlib import Path

import db

# Montado como volumen en docker-compose.yml. Si el CSV se escribiera dentro del
# contenedor se perdería en el siguiente docker compose build.
EXPORT_DIR = Path(os.getenv("EXPORT_DIR", "exports"))

# El mes anterior al actual, tal y como lo entiende el propio Postgres. Todos
# los límites se calculan en SQL con date_trunc y no en Python, para que no
# pueda haber desacuerdo entre el reloj del código y el del servidor de datos
# sobre qué mes es "octubre".
INICIO_MES_ANTERIOR = "date_trunc('month', now()) - interval '1 month'"
FIN_MES_ANTERIOR = "date_trunc('month', now())"
RANGO_MES_ANTERIOR = (
    f"created_at >= {INICIO_MES_ANTERIOR} AND created_at < {FIN_MES_ANTERIOR}"
)

CABECERA = ["id", "plant_id", "planta", "humidity", "created_at"]


def export_previous_month_if_due():
    """Exporta a CSV el mes anterior si todavía no se ha exportado.

    Devuelve None si no toca, o un resumen de lo exportado.
    """
    conn, cursor = db.createConexion()
    try:
        cursor.execute(
            f"SELECT to_char({INICIO_MES_ANTERIOR}, 'YYYY-MM')"
        )
        mes = cursor.fetchone()[0]
    finally:
        cursor.close()
        conn.close()

    destino = EXPORT_DIR / f"plant_log_{mes}.csv"
    if destino.exists():
        # Ya se exportó este mes. Además evita que un reintento sobrescriba un
        # CSV bueno con uno vacío, que sería perder los datos sin avisar.
        return None

    return _exportar(mes, destino)


def list_exports():
    """Qué CSV hay en el directorio de exports, para poder verlo."""
    if not EXPORT_DIR.is_dir():
        return []
    salidas = []
    for path in sorted(EXPORT_DIR.glob("plant_log_*.csv")):
        stat = path.stat()
        salidas.append(
            {
                "archivo": path.name,
                "bytes": stat.st_size,
                "modificado": datetime.fromtimestamp(stat.st_mtime).isoformat(
                    timespec="seconds"
                ),
            }
        )
    return salidas


def _exportar(mes, destino):
    filas = _leer_mes()
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    temporal = destino.with_suffix(".csv.tmp")
    try:
        with temporal.open("w", newline="", encoding="utf-8") as f:
            escritor = csv.writer(f)
            escritor.writerow(CABECERA)
            for fila in filas:
                creado = fila[4].isoformat() if fila[4] is not None else ""
                escritor.writerow([fila[0], fila[1], fila[2], fila[3], creado])
        # Renombrar es atómico: o el CSV está entero, o no está. Un fallo a
        # medio escribir deja un .tmp y el destino sigue sin existir.
        temporal.replace(destino)
    except Exception:
        temporal.unlink(missing_ok=True)
        raise

    # Solo se borra cuando el fichero está en su sitio. Nunca TRUNCATE: si el
    # job falla dos meses seguidos los datos se acumulan en vez de evaporarse.
    borradas = _vaciar_mes()

    print(f"[exports] {destino.name}: {len(filas)} filas, {borradas} borradas")
    return {
        "mes": mes,
        "archivo": destino.name,
        "filas": len(filas),
        "borradas": borradas,
    }


def _leer_mes():
    conn, cursor = db.createConexion()
    try:
        cursor.execute(
            "SELECT l.id, l.plant_id, p.name, l.humidity, l.created_at "
            "FROM plant_log l "
            "LEFT JOIN plant p ON p.id = l.plant_id "
            f"WHERE {RANGO_MES_ANTERIOR} "
            "ORDER BY l.id"
        )
        return cursor.fetchall()
    finally:
        cursor.close()
        conn.close()


def _vaciar_mes():
    conn, cursor = db.createConexion()
    try:
        cursor.execute(f"DELETE FROM plant_log WHERE {RANGO_MES_ANTERIOR}")
        borradas = cursor.rowcount
        conn.commit()
        return borradas
    finally:
        cursor.close()
        conn.close()


def segundos_hasta_proximo_mes(now=None):
    """Cuánto falta para el día 1 siguiente, a las 00:05.

    Se usa +timedelta(days=31) y luego replace(day=1) en vez de relativedelta
    para no meter python-dateutil como dependencia por una sola cuenta.
    """
    now = now or datetime.now()
    objetivo = now.replace(day=1, hour=0, minute=5, second=0, microsecond=0)
    if objetivo <= now:
        objetivo = (objetivo + timedelta(days=31)).replace(day=1)
    return (objetivo - now).total_seconds()
