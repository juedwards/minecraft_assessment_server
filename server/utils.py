"""Utility helpers shared across modules."""
import json
import logging
from .state import *

logger = logging.getLogger(__name__)


async def broadcast_to_web(message):
    disconnected = set()
    for client in list(web_clients):
        try:
            await client.send(json.dumps(message))
        except Exception:
            disconnected.add(client)
    web_clients.difference_update(disconnected)


async def send_message_to_minecraft(websocket, message):
    from uuid import uuid4
    formatted_message = f"§e§l[Server]§r §f{message}"
    command = {"header": {"version": 1, "requestId": str(uuid4()), "messageType": "commandRequest", "messagePurpose": "commandRequest"}, "body": {"origin": {"type": "player"}, "commandLine": f'tellraw @a {{"rawtext":[{{"text":"{formatted_message}"}}]}}', "version": 1}}
    await websocket.send(json.dumps(command))
    logger.info(f"📢 Sent message to players: {message}")


async def send_command_to_minecraft(websocket, command, target_players=None, is_player_specific=False):
    from uuid import uuid4
    if is_player_specific and target_players:
        for player_name in target_players:
            player_command = command.replace('@t', f'@a[name={player_name}]')
            cmd = {"header": {"version": 1, "requestId": str(uuid4()), "messageType": "commandRequest", "messagePurpose": "commandRequest"}, "body": {"origin": {"type": "player"}, "commandLine": player_command, "version": 1}}
            await websocket.send(json.dumps(cmd))
            logging.info(f"🎮 Sent command for {player_name}: {player_command}")
    else:
        cmd = {"header": {"version": 1, "requestId": str(uuid4()), "messageType": "commandRequest", "messagePurpose": "commandRequest"}, "body": {"origin": {"type": "player"}, "commandLine": command, "version": 1}}
        await websocket.send(json.dumps(cmd))
        logging.info(f"🎮 Sent command: {command}")
