import httpx

import db

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
CHANNEL_ID = "riego"
BATCH_SIZE = 100


def send_plant_push(push):
    """Manda el aviso de una planta a todos los móviles registrados.

    El tag hace que en Android la notificación se sustituya en el sitio en
    lugar de apilarse, así que una planta solo ocupa una entrada en la barra
    por muchos lotes que se acumulen.

    Nunca lanza: un fallo de Expo no puede romper la ingesta del sensor.
    """
    try:
        tokens = db.getPushTokens()
    except Exception as exc:
        print(f"[push] no se pudieron leer los tokens: {exc}")
        return

    if not tokens:
        return

    for start in range(0, len(tokens), BATCH_SIZE):
        batch = tokens[start:start + BATCH_SIZE]
        _send_batch(push, batch)


def _send_batch(push, tokens):
    plant_id = push["plant_id"]

    # Un mensaje por token: Expo devuelve los tickets en el mismo orden que
    # se enviaron, así que el índice del ticket identifica al móvil sin
    # tener que arrancar el token del texto de error.
    messages = [
        {
            "to": token,
            "tag": f"plant-{plant_id}",
            "title": push["title"],
            "body": push["body"],
            "data": {"plant_id": plant_id, "resolved": push["resolved"]},
            "channelId": CHANNEL_ID,
            "priority": "high",
        }
        for token in tokens
    ]

    try:
        response = httpx.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={"Accept": "application/json", "Accept-Encoding": "gzip, deflate"},
            timeout=10.0,
        )
        response.raise_for_status()
    except Exception as exc:
        print(f"[push] no se pudo avisar de la planta {plant_id}: {exc}")
        return

    _forget_dead_tokens(response.json(), tokens)


def _forget_dead_tokens(payload, tokens):
    """Descarta los móviles que Expo da de baja: app desinstalada o sin permiso.

    Si se siguen mandando, Expo responde DeviceNotRegistered una y otra vez
    para siempre y el resto de avisos se ralentiza.
    """
    tickets = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(tickets, list):
        return

    for token, ticket in zip(tokens, tickets):
        if not isinstance(ticket, dict) or ticket.get("status") != "error":
            continue
        details = ticket.get("details") or {}
        if details.get("error") != "DeviceNotRegistered":
            print(f"[push] error enviando a {token}: {ticket.get('message')}")
            continue
        try:
            db.deletePushToken(token)
            print(f"[push] token dado de baja, se elimina: {token}")
        except Exception as exc:
            print(f"[push] no se pudo borrar el token {token}: {exc}")
