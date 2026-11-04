import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from routes.plantagochi import router as plantagochi_router
from fastapi.middleware.cors import CORSMiddleware

from exports import export_previous_month_if_due, segundos_hasta_proximo_mes

load_dotenv(Path(__file__).parent / '.env')

frontend_url = os.getenv('FRONTEND_URL')


async def _ciclo_export_mensual():
    """Espera al día 1 y exporta plant_log. Nunca muere por un fallo puntual."""
    while True:
        try:
            await asyncio.sleep(segundos_hasta_proximo_mes())
            await asyncio.to_thread(export_previous_month_if_due)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Si el export falla, el mes que viene se vuelve a intentar. El
            # fichero ya escrito es lo que impide repetir un mes bueno.
            print(f"[exports] el ciclo mensual falló: {exc}")


@asynccontextmanager
async def lifespan(app):
    # Al arrancar se comprueba si toca. Es lo que rescata el caso de que el
    # servidor estuviera apagado la madrugada del día 1: el export pendiente se
    # hace en el siguiente arranque, sin esperar otro mes.
    try:
        await asyncio.to_thread(export_previous_month_if_due)
    except Exception as exc:
        print(f"[exports] la comprobación de arranque falló: {exc}")

    tarea = asyncio.create_task(_ciclo_export_mensual())
    yield
    tarea.cancel()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(plantagochi_router)
