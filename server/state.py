"""Shared runtime state for the server."""
from datetime import datetime, timezone
import os

DATA_DIR = os.getenv('DATA_DIR', 'data')

# Runtime collections
player_positions = {}
web_clients = set()
minecraft_connections = set()
block_events = []
active_players = set()
session_events = []
latest_assessment_results = {}

# Session tracking
session_start_time = None
session_id = None
session_file = None

# Event buffer
event_buffer = []
last_save_time = None


def ensure_data_directory():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)


def now_utc():
    return datetime.now(timezone.utc)
