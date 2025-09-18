"""Minecraft WebSocket handler moved from app.py"""
import json
import logging
import math
import time
import os
from uuid import uuid4
import websockets
from . import state
from .session import start_session, record_event, end_session
from .utils import broadcast_to_web
from . import chunk_store

logger = logging.getLogger(__name__)

async def send_welcome_message(websocket):
    welcome_command = {
        'header': {'version':1,'requestId':str(uuid4()),'messageType':'commandRequest','messagePurpose':'commandRequest'},
        'body': {'origin':{'type':'player'}, 'commandLine': 'tellraw @a {"rawtext":[{"text":"§6§l======\\n§r§e§lWelcome to Playtrace AI\n§r§eYour game data is being recorded.\n§eIf you do not want this please exit now.\n§6§l======"}]}}', 'version':1}
    }
    await websocket.send(json.dumps(welcome_command))
    logger.info('📢 Sent welcome message')


async def handle_minecraft_client(websocket):
    """Handle Minecraft client connections"""
    # Use state.active_players from the shared state module
    state.minecraft_connections.add(websocket)
    try:
        client_addr = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
    except:
        client_addr = 'unknown'
    logger.info(f"🎮 Minecraft connected from {client_addr}")
    player_id = None
    player_name = None
    welcome_sent = False
    if len(state.active_players) == 0:
        start_session()
        # Prepare session info safely
        start_time_iso = state.session_start_time.isoformat() if state.session_start_time else None
        file_name = os.path.basename(state.session_file) if state.session_file else None
        await broadcast_to_web({'type':'session_info','sessionId': state.session_id, 'startTime': start_time_iso, 'fileName': file_name})
    try:
        await websocket.send(json.dumps({'header':{'messagePurpose':'commandResponse'}, 'body':{'statusMessage': f"Connected to Playtrace AI! Session: {os.path.basename(state.session_file) if state.session_file else 'N/A'}"}}))
        events_to_subscribe = ["BlockPlaced","BlockBroken","PlayerTravelled","PlayerMessage","ItemUsed","ItemInteracted","ItemCrafted","ItemSmelted","ItemEquipped","ItemDropped","ItemPickedUp","PlayerDied","MobKilled","PlayerHurt","PlayerAttack","DoorUsed","ChestOpened","ContainerClosed","ButtonPressed","LeverUsed","PressurePlateActivated","PlayerJump","PlayerSneak","PlayerSprint","PlayerSwim","PlayerClimb","PlayerGlide","PlayerTeleport","AwardAchievement","PlayerTransform","EntitySpawned","EntityRemoved","EntityInteracted","WeatherChanged","TimeChanged","GameRulesUpdated","PlayerEat","PlayerSleep","PlayerWake","CameraUsed","BookEdited","BossKilled","RaidCompleted","TradeCompleted"]

        for event_name in events_to_subscribe:
            await websocket.send(json.dumps({'header':{'version':1,'requestId':str(uuid4()),'messageType':'commandRequest','messagePurpose':'subscribe'}, 'body':{'eventName':event_name}}))
        logger.info(f"📋 Subscribed to {len(events_to_subscribe)} event types")

        position_update_counter = 0
        async for message in websocket:
            try:
                msg = json.loads(message)
                header = msg.get('header', {})
                body = msg.get('body', {})
                event_name = header.get('eventName', '')
                # Try to detect a chunk response from the Minecraft client and store/broadcast it
                try:
                    # Many chunk responses include a 'data' field containing the compact token stream
                    if (header.get('messagePurpose') in ('commandResponse', 'commandResult') or header.get('messageType') == 'commandResponse') and ('data' in body):
                        # let chunk_store decode & store the chunk and return a record
                        rec = chunk_store.handle_chunk_response(header, body)
                        if rec:
                            # Broadcast a compact message the web UI can consume
                            try:
                                await broadcast_to_web({
                                    'type': 'chunk',
                                    'dimension': rec.get('dimension'),
                                    'x': rec.get('x'),
                                    'z': rec.get('z'),
                                    'y': rec.get('y'),
                                    'pixels': rec.get('pixels'),
                                    'heights': rec.get('heights'),
                                    'requestId': rec.get('request_id'),
                                    'timestamp': rec.get('timestamp')
                                })
                                logger.info(f"📦 Broadcasted chunk {rec.get('dimension')} {rec.get('x')} {rec.get('z')} y={rec.get('y')}")
                            except Exception:
                                logger.exception('failed to broadcast chunk to web clients')
                except Exception:
                    logger.exception('error handling potential chunk response')

                if 'player' in body and player_id is None:
                    player_data = body['player']
                    player_id = str(player_data.get('id', f"Player_{int(time.time()) % 1000}"))
                    player_name = player_data.get('name', player_id)
                    state.active_players.add(player_id)
                    logger.info(f"🎯 Identified player: {player_name}")
                    if not welcome_sent:
                        await send_welcome_message(websocket)
                        welcome_sent = True
                    record_event('player_join', {'player_id': player_id, 'player_name': player_name, 'address': client_addr})
                    try:
                        if 'position' in player_data:
                            pos = player_data['position']
                            pos_x = float(pos.get('x', 0))
                            pos_y = float(pos.get('y', 0))
                            pos_z = float(pos.get('z', 0))
                            state.player_positions[player_id] = {'x': pos_x, 'y': pos_y, 'z': pos_z, 'name': player_name}
                            await broadcast_to_web({'type': 'position', 'playerId': player_id, 'playerName': player_name, 'x': pos_x, 'y': pos_y, 'z': pos_z})
                        # Always send authoritative snapshot so web clients have the canonical list
                        await broadcast_active_players()
                    except Exception:
                        logger.exception('failed to broadcast initial player info')
                if header.get('messagePurpose') == 'event':
                    player_data = body.get('player', {})
                    current_player_id = str(player_data.get('id', player_id)) if player_data else player_id
                    current_player_name = player_data.get('name', player_name) if player_data else player_name
                    if event_name == 'PlayerMessage':
                        message_type = body.get('type', '')
                        message_text = body.get('message', '')
                        sender = body.get('sender', 'Unknown')
                        record_event('player_chat', {'player_id': current_player_id, 'player_name': current_player_name, 'message': message_text, 'message_type': message_type, 'sender': sender})
                        await broadcast_to_web({'type': 'player_chat', 'playerId': current_player_id, 'playerName': current_player_name, 'message': message_text})
                        logger.info(f"💬 Chat from {current_player_name}: {message_text}")
                    elif event_name == 'PlayerTravelled':
                        if 'position' in player_data:
                            pos = player_data['position']
                            pos_x = float(pos['x'])
                            pos_y = float(pos['y'])
                            pos_z = float(pos['z'])
                            state.player_positions[current_player_id] = {'x': pos_x, 'y': pos_y, 'z': pos_z, 'name': current_player_name}
                            position_update_counter += 1
                            if (position_update_counter % 10) == 0:
                                record_event('player_position', {'player_id': current_player_id, 'player_name': current_player_name, 'position': {'x': pos_x, 'y': pos_y, 'z': pos_z}, 'dimension': player_data.get('dimension', 'overworld')})
                        await broadcast_to_web({'type': 'position', 'playerId': current_player_id, 'playerName': current_player_name, 'x': pos_x, 'y': pos_y, 'z': pos_z})
                        # Request chunk data for the player's current chunk (and y slice)
                        try:
                            chunk_x = int(math.floor(pos_x / 16.0))
                            chunk_z = int(math.floor(pos_z / 16.0))
                            dim = player_data.get('dimension', 'overworld')
                            # Use player's Y as the requested slice and centralize
                            # presence/request logic in chunk_store.ensure_chunk_present.
                            y_slice = int(pos_y)
                            await chunk_store.ensure_chunk_present(websocket, dim, chunk_x, chunk_z, y=y_slice, radius=1)
                        except Exception:
                            logger.exception('failed to request chunk for player position')
                    elif event_name == 'BlockPlaced':
                        player_pos = body.get('player', {}).get('position', {})
                        block_x = int(player_pos.get('x', 0))
                        block_y = int(player_pos.get('y', 0))
                        block_z = int(player_pos.get('z', 0))
                        block_info = body.get('block', {})
                        block_id = block_info.get('id', 'unknown')
                        block_namespace = block_info.get('namespace', 'minecraft')
                        block_type = f"{block_namespace}:{block_id}"
                        record_event('block_placed', {'player_id': player_id, 'player_name': player_name, 'block_type': block_type, 'player_position': {'x': player_pos.get('x', 0), 'y': player_pos.get('y', 0), 'z': player_pos.get('z', 0)}, 'estimated_block_position': {'x': block_x, 'y': block_y + 1, 'z': block_z}})
                        await broadcast_to_web({'type': 'block_place', 'x': player_pos.get('x', 0), 'y': player_pos.get('y', 0), 'z': player_pos.get('z', 0), 'blockPos': {'x': block_x, 'y': block_y + 1, 'z': block_z}, 'blockType': block_type, 'playerName': player_name or 'Unknown'})
                        logger.info(f"🟩 Block placed: {block_type} near ({block_x}, {block_y}, {block_z}) by {player_name}")
                    elif event_name == 'BlockBroken':
                        player_pos = body.get('player', {}).get('position', {})
                        block_x = int(player_pos.get('x', 0))
                        block_y = int(player_pos.get('y', 0))
                        block_z = int(player_pos.get('z', 0))
                        block_info = body.get('block', {})
                        block_id = block_info.get('id', 'unknown')
                        block_namespace = block_info.get('namespace', 'minecraft')
                        block_type = f"{block_namespace}:{block_id}"
                        record_event('block_broken', {'player_id': player_id, 'player_name': player_name, 'block_type': block_type, 'player_position': {'x': player_pos.get('x', 0), 'y': player_pos.get('y', 0), 'z': player_pos.get('z', 0)}, 'estimated_block_position': {'x': block_x, 'y': block_y, 'z': block_z}})
                        await broadcast_to_web({'type': 'block_break', 'x': player_pos.get('x', 0), 'y': player_pos.get('y', 0), 'z': player_pos.get('z', 0), 'blockPos': {'x': block_x, 'y': block_y, 'z': block_z}, 'blockType': block_type, 'playerName': player_name or 'Unknown'})
                        logger.info(f"🟥 Block broken: {block_type} near ({block_x}, {block_y}, {block_z}) by {player_name}")
                    else:
                        if event_name and event_name not in ['PlayerTravelled']:
                            record_event(event_name.lower(), {'player_id': current_player_id, 'player_name': current_player_name, 'event_data': body})
                if len(state.event_buffer) > 0 and (time.time() - (state.last_save_time or 0) > 5):
                    await broadcast_to_web({'type': 'save_notification'})
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                logger.error(f"Message content: {message}")
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"🎮 Minecraft disconnected: {player_name or 'Unknown'}")
    finally:
        if player_id:
            record_event('player_leave', {'player_id': player_id, 'player_name': player_name})
            if player_id in state.player_positions:
                del state.player_positions[player_id]
            if player_id in state.active_players:
                state.active_players.remove(player_id)
            await broadcast_to_web({'type':'disconnect','playerId': player_id})
            try:
                # Also broadcast the updated authoritative active players list after a disconnect
                await broadcast_active_players()
            except Exception:
                logger.exception('failed to broadcast active players list after disconnect')
            if len(state.active_players) == 0:
                logger.info('📤 Last player left, ending session...')
                end_session()

async def broadcast_active_players():
    try:
        players_list = []
        for pid in state.active_players:
            pname = state.player_positions.get(pid, {}).get('name', pid)
            entry = {'playerId': pid, 'playerName': pname}
            pos = state.player_positions.get(pid)
            if pos:
                entry.update({'x': pos['x'], 'y': pos['y'], 'z': pos['z']})
            players_list.append(entry)
        await broadcast_to_web({'type': 'active_players', 'players': players_list})
    except Exception:
        logger.exception('broadcast_active_players failed')
