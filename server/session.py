"""Session management: start, save, end, and record events."""
import os
import json
import time
from datetime import datetime, timezone
from . import state
import logging
import asyncio
from .ai_client import analyze_prompt

logger = logging.getLogger(__name__)


def start_session(user='juedwards'):
    # Use the shared state module to set session attributes so all modules see updates
    state.session_start_time = state.now_utc()
    state.session_id = f"minecraft_session_{state.session_start_time.strftime('%Y%m%d_%H%M%S')}"
    state.session_events = []
    initial_event = {
        'timestamp': state.session_start_time.isoformat(),
        'event_type': 'session_start',
        'data': {'session_id': state.session_id, 'server_version': '1.0', 'user': user}
    }
    state.session_events.append(initial_event)
    state.session_file = os.path.join(state.DATA_DIR, f"{state.session_id}.json")
    save_session_realtime()
    logger.info(f"📝 Started new session: {state.session_id}")


def save_session_realtime():
    if not state.session_file:
        return
    current_time = state.now_utc()
    session_data = {
        'session_info': {
            'id': state.session_id,
            'start_time': state.session_start_time.isoformat() if state.session_start_time else None,
            'last_update': current_time.isoformat(),
            'duration_seconds': (current_time - state.session_start_time).total_seconds() if state.session_start_time else 0,
            'total_events': len(state.session_events),
            'user': 'juedwards',
            'status': 'active' if state.active_players else 'ended'
        },
        'events': state.session_events
    }
    temp_file = f"{state.session_file}.tmp"
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(session_data, f, indent=2)
    if os.path.exists(state.session_file):
        os.remove(state.session_file)
    os.rename(temp_file, state.session_file)
    state.last_save_time = time.time()


def end_session():
    if not state.session_id:
        return
    session_end_time = state.now_utc()
    state.session_events.append({
        'timestamp': session_end_time.isoformat(),
        'event_type': 'session_end',
        'data': {
            'session_id': state.session_id,
            'duration_seconds': (session_end_time - state.session_start_time).total_seconds() if state.session_start_time else 0,
            'total_events': len(state.session_events)
        }
    })
    save_session_realtime()
    logger.info(f"💾 Session ended and saved: {state.session_file} ({len(state.session_events)} events)")


def record_event(event_type, data):
    if state.session_id:
        event = {'timestamp': state.now_utc().isoformat(), 'event_type': event_type, 'data': data}
        state.session_events.append(event)
        state.event_buffer.append(event)
        current_time = time.time()
        if (current_time - (state.last_save_time or 0) > 5) or (len(state.event_buffer) >= 50):
            save_session_realtime()
            state.event_buffer = []
            state.last_save_time = current_time
            logger.debug(f"💾 Auto-saved session with {len(state.session_events)} events")


async def analyze_player_data():
    """Analyze current player data against rubric using the ai_client.analyze_prompt wrapper."""
    global latest_assessment_results
    try:
        rubric_path = os.path.join(os.path.dirname(__file__), '..', 'rubric.md')
        if not os.path.exists(rubric_path):
            return {'error': 'Rubric file not found'}

        with open(rubric_path, 'r', encoding='utf-8') as f:
            rubric_content = f.read()

        # Aggregate events by player
        player_analysis_data = {}
        for event in state.session_events:
            if event['event_type'] in ['player_position', 'block_placed', 'block_broken', 'player_join', 'player_leave', 'player_chat']:
                pdata = event.get('data', {})
                player_id = pdata.get('player_id') or pdata.get('player_name')
                player_name = pdata.get('player_name', player_id)
                if player_name not in player_analysis_data:
                    player_analysis_data[player_name] = {'positions': [], 'blocks_placed': [], 'blocks_broken': [], 'join_time': None, 'leave_time': None, 'total_distance': 0}

                entry = player_analysis_data[player_name]
                etype = event['event_type']
                if etype == 'player_position':
                    pos = pdata.get('position')
                    if pos:
                        entry['positions'].append(pos)
                elif etype == 'block_placed':
                    entry['blocks_placed'].append({'type': pdata.get('block_type'), 'position': pdata.get('estimated_block_position'), 'time': event.get('timestamp')})
                elif etype == 'block_broken':
                    entry['blocks_broken'].append({'type': pdata.get('block_type'), 'position': pdata.get('estimated_block_position'), 'time': event.get('timestamp')})
                elif etype == 'player_join':
                    entry['join_time'] = event.get('timestamp')
                elif etype == 'player_leave':
                    entry['leave_time'] = event.get('timestamp')

        # compute distances
        for pname, pdata in player_analysis_data.items():
            positions = pdata['positions']
            if len(positions) > 1:
                total_distance = 0
                for i in range(1, len(positions)):
                    prev = positions[i-1]
                    curr = positions[i]
                    try:
                        distance = ((curr['x'] - prev['x'])**2 + (curr['y'] - prev['y'])**2 + (curr['z'] - prev['z'])**2) ** 0.5
                    except Exception:
                        distance = 0
                    total_distance += distance
                pdata['total_distance'] = round(total_distance, 2)

        # Generate analysis per player using AI client
        analyses = {}
        for pname, pdata in player_analysis_data.items():
            summary = f"Player Activity Summary:\n- Total positions recorded: {len(pdata['positions'])}\n- Total distance traveled: {pdata.get('total_distance', 0)} blocks\n- Blocks placed: {len(pdata['blocks_placed'])}\n- Blocks broken: {len(pdata['blocks_broken'])}\n- Session duration: {pdata['join_time']} to {pdata['leave_time'] or 'still active'}\n\nBlock Placement Details:\n"
            for block in pdata['blocks_placed'][:10]:
                pos = block.get('position') or {'x':0,'y':0,'z':0}
                summary += f"- {block.get('type')} at ({pos.get('x')}, {pos.get('y')}, {pos.get('z')})\n"
            if len(pdata['blocks_placed']) > 10:
                summary += f"... and {len(pdata['blocks_placed']) - 10} more blocks\n"
            summary += "\nBlock Breaking Details:\n"
            for block in pdata['blocks_broken'][:10]:
                pos = block.get('position') or {'x':0,'y':0,'z':0}
                summary += f"- {block.get('type')} at ({pos.get('x')}, {pos.get('y')}, {pos.get('z')})\n"
            if len(pdata['blocks_broken']) > 10:
                summary += f"... and {len(pdata['blocks_broken']) - 10} more blocks\n"

            prompt = f"""
Please analyze the following Minecraft player's gameplay data against the provided rubric.

RUBRIC:
{rubric_content}

PLAYER: {pname}

{summary}

Please provide a detailed assessment of this player's performance based on the rubric criteria. Include specific examples from their gameplay data and suggestions for improvement. Format the response in a clear, structured way with sections for different rubric criteria.
"""

            try:
                analysis_text = await analyze_prompt(prompt)
            except Exception as e:
                analysis_text = f"Error analyzing player: {e}"

            analyses[pname] = analysis_text

        state.latest_assessment_results = {'analyses': analyses}
        return {'analyses': analyses}

    except Exception as e:
        logger.error(f"Error in analyze_player_data: {e}")
        return {'error': str(e)}
