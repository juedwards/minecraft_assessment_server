"""Web browser WebSocket handler moved from app.py"""
import json
import logging
import time
import os
import websockets
from . import state
from .session import analyze_player_data, record_event, start_session, end_session
from .utils import broadcast_to_web, send_message_to_minecraft, send_command_to_minecraft

logger = logging.getLogger(__name__)


async def handle_web_client(websocket):
    logger.info('Web client connected for live updates')
    state.web_clients.add(websocket)
    try:
        if state.session_id:
            await websocket.send(json.dumps({'type':'session_info','sessionId': state.session_id,'startTime': state.session_start_time.isoformat() if state.session_start_time else None,'fileName': os.path.basename(state.session_file) if state.session_file else None}))
        for player_id, pos in state.player_positions.items():
            await websocket.send(json.dumps({'type':'position','playerId': player_id,'playerName': pos.get('name', player_id),'x': pos['x'],'y': pos['y'],'z': pos['z']}))
        async for message in websocket:
            try:
                msg = json.loads(message)
                if msg.get('type') == 'analyze_request':
                    logger.info('Received AI analysis request')
                    analysis_result = await analyze_player_data()
                    await websocket.send(json.dumps({'type':'analysis_result', **analysis_result}))
                elif msg.get('type') == 'clear_session':
                    logger.info('Received clear session request')
                    if state.session_id and state.active_players:
                        end_session()
                    # Clear shared session state
                    state.session_events = []
                    state.event_buffer = []
                    state.last_save_time = time.time()
                    if state.active_players:
                        start_session()
                        await broadcast_to_web({'type':'session_cleared','sessionId': state.session_id,'startTime': state.session_start_time.isoformat() if state.session_start_time else None,'fileName': os.path.basename(state.session_file) if state.session_file else None})
                    else:
                        await broadcast_to_web({'type':'session_cleared','sessionId': None,'startTime': None,'fileName': None})
                    logger.info('✨ Session cleared and ready for new recording')
                elif msg.get('type') == 'send_message':
                    message_text = msg.get('message', '')
                    if message_text:
                        record_event('server_message', {'message': message_text, 'sender': 'web_interface'})
                        disconnected = set()
                        for mc_client in state.minecraft_connections:
                            try:
                                await send_message_to_minecraft(mc_client, message_text)
                            except:
                                disconnected.add(mc_client)
                        state.minecraft_connections.difference_update(disconnected)
                        logger.info(f"📨 Message sent to {len(state.minecraft_connections)} Minecraft clients")
                elif msg.get('type') == 'game_command':
                    command = msg.get('command', '')
                    target_mode = msg.get('targetMode', 'all')
                    target_players = msg.get('targetPlayers', [])
                    is_player_specific = msg.get('isPlayerSpecific', False)
                    if command:
                        record_event('game_command', {'command': command, 'target_mode': target_mode, 'target_players': target_players, 'sender': 'web_interface'})
                        disconnected = set()
                        selected_player_names = []
                        if target_mode == 'selected' and target_players:
                            for player_id in target_players:
                                for pid, pos in state.player_positions.items():
                                    if pid == player_id:
                                        selected_player_names.append(pos.get('name', player_id))
                        for mc_client in state.minecraft_connections:
                            try:
                                if target_mode == 'all' or not is_player_specific:
                                    await send_command_to_minecraft(mc_client, command)
                                else:
                                    await send_command_to_minecraft(mc_client, command, selected_player_names, is_player_specific)
                            except:
                                disconnected.add(mc_client)
                        state.minecraft_connections.difference_update(disconnected)
                        logger.info(f"🎮 Command sent to {len(state.minecraft_connections)} Minecraft clients")
            except Exception as e:
                logger.error(f"Error handling web client message: {e}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        state.web_clients.discard(websocket)
        logger.info('Web client disconnected')
