#!/usr/bin/env python3
"""
Minecraft Education - 3D Tracker with AI Assessment
"""

import asyncio
import json
import logging
import websockets
from uuid import uuid4
from datetime import datetime
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import time
import os
from dotenv import load_dotenv
import openai

# Load environment variables
load_dotenv()

# Initialize OpenAI
openai.api_key = os.getenv('OPENAI_API_KEY')

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

# Global storage
player_positions = {}
web_clients = set()
block_events = []
active_players = set()  # Track active players

# Event recording
session_events = []
session_start_time = None
session_id = None
session_file = None
event_buffer = []  # Buffer for batch writing
last_save_time = time.time()

def start_session():
    """Start a new recording session"""
    global session_start_time, session_id, session_events, session_file
    session_start_time = datetime.utcnow()
    session_id = f"minecraft_session_{session_start_time.strftime('%Y%m%d_%H%M%S')}"
    session_events = []
    
    # Record session start event
    initial_event = {
        "timestamp": session_start_time.isoformat(),
        "event_type": "session_start",
        "data": {
            "session_id": session_id,
            "server_version": "1.0",
            "user": "juedwards"
        }
    }
    session_events.append(initial_event)
    
    # Create initial JSON file
    session_file = f"{session_id}.json"
    save_session_realtime()
    
    logger.info(f"📝 Started new session: {session_id}")
    logger.info(f"💾 Real-time saving to: {session_file}")

def save_session_realtime():
    """Save the current session to JSON file (used during active session)"""
    global session_events, session_start_time, session_id, session_file
    
    if not session_file:
        return
    
    current_time = datetime.utcnow()
    
    # Create session data structure
    session_data = {
        "session_info": {
            "id": session_id,
            "start_time": session_start_time.isoformat(),
            "last_update": current_time.isoformat(),
            "duration_seconds": (current_time - session_start_time).total_seconds(),
            "total_events": len(session_events),
            "user": "juedwards",
            "status": "active" if active_players else "ended"
        },
        "events": session_events
    }
    
    # Write to temporary file first, then rename (atomic operation)
    temp_file = f"{session_file}.tmp"
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(session_data, f, indent=2)
    
    # Rename temp file to actual file (atomic on most systems)
    if os.path.exists(session_file):
        os.remove(session_file)
    os.rename(temp_file, session_file)

def end_session():
    """Mark session as ended and do final save"""
    global session_events
    
    if not session_id:
        return
    
    session_end_time = datetime.utcnow()
    
    # Add session end event
    session_events.append({
        "timestamp": session_end_time.isoformat(),
        "event_type": "session_end",
        "data": {
            "session_id": session_id,
            "duration_seconds": (session_end_time - session_start_time).total_seconds(),
            "total_events": len(session_events)
        }
    })
    
    # Final save with ended status
    save_session_realtime()
    
    logger.info(f"💾 Session ended and saved: {session_file} ({len(session_events)} events)")

def record_event(event_type, data):
    """Record an event to the session with real-time saving"""
    global session_events, event_buffer, last_save_time
    
    if session_id:  # Only record if session is active
        event = {
            "timestamp": datetime.utcnow().isoformat(),
            "event_type": event_type,
            "data": data
        }
        session_events.append(event)
        event_buffer.append(event)
        
        # Save every 5 seconds or every 50 events
        current_time = time.time()
        if (current_time - last_save_time > 5) or (len(event_buffer) >= 50):
            save_session_realtime()
            event_buffer = []
            last_save_time = current_time
            logger.debug(f"💾 Auto-saved session with {len(session_events)} events")

async def analyze_player_data():
    """Analyze current player data against rubric using AI"""
    try:
        # Read rubric
        rubric_path = os.path.join(os.path.dirname(__file__), 'rubric.md')
        if not os.path.exists(rubric_path):
            return {"error": "Rubric file not found"}
        
        with open(rubric_path, 'r') as f:
            rubric_content = f.read()
        
        # Prepare player data for analysis
        player_analysis_data = {}
        
        # Extract relevant events for each player
        for event in session_events:
            if event['event_type'] in ['player_position', 'block_placed', 'block_broken', 'player_join', 'player_leave']:
                player_id = event['data'].get('player_id')
                player_name = event['data'].get('player_name', player_id)
                
                if player_name not in player_analysis_data:
                    player_analysis_data[player_name] = {
                        'positions': [],
                        'blocks_placed': [],
                        'blocks_broken': [],
                        'join_time': None,
                        'leave_time': None,
                        'total_distance': 0
                    }
                
                if event['event_type'] == 'player_position':
                    player_analysis_data[player_name]['positions'].append(event['data']['position'])
                elif event['event_type'] == 'block_placed':
                    player_analysis_data[player_name]['blocks_placed'].append({
                        'type': event['data']['block_type'],
                        'position': event['data']['estimated_block_position'],
                        'time': event['timestamp']
                    })
                elif event['event_type'] == 'block_broken':
                    player_analysis_data[player_name]['blocks_broken'].append({
                        'type': event['data']['block_type'],
                        'position': event['data']['estimated_block_position'],
                        'time': event['timestamp']
                    })
                elif event['event_type'] == 'player_join':
                    player_analysis_data[player_name]['join_time'] = event['timestamp']
                elif event['event_type'] == 'player_leave':
                    player_analysis_data[player_name]['leave_time'] = event['timestamp']
        
        # Calculate additional metrics
        for player_name, data in player_analysis_data.items():
            # Calculate total distance traveled
            positions = data['positions']
            if len(positions) > 1:
                total_distance = 0
                for i in range(1, len(positions)):
                    prev = positions[i-1]
                    curr = positions[i]
                    distance = ((curr['x'] - prev['x'])**2 + 
                              (curr['y'] - prev['y'])**2 + 
                              (curr['z'] - prev['z'])**2) ** 0.5
                    total_distance += distance
                data['total_distance'] = round(total_distance, 2)
        
        # Analyze each player
        analyses = {}
        
        for player_name, player_data in player_analysis_data.items():
            # Prepare summary for ChatGPT
            summary = f"""
Player Activity Summary:
- Total positions recorded: {len(player_data['positions'])}
- Total distance traveled: {player_data['total_distance']} blocks
- Blocks placed: {len(player_data['blocks_placed'])}
- Blocks broken: {len(player_data['blocks_broken'])}
- Session duration: {player_data['join_time']} to {player_data['leave_time'] or 'still active'}

Block Placement Details:
"""
            for block in player_data['blocks_placed'][:10]:  # Show first 10
                summary += f"- {block['type']} at ({block['position']['x']}, {block['position']['y']}, {block['position']['z']})\n"
            
            if len(player_data['blocks_placed']) > 10:
                summary += f"... and {len(player_data['blocks_placed']) - 10} more blocks\n"
            
            summary += "\nBlock Breaking Details:\n"
            for block in player_data['blocks_broken'][:10]:  # Show first 10
                summary += f"- {block['type']} at ({block['position']['x']}, {block['position']['y']}, {block['position']['z']})\n"
            
            if len(player_data['blocks_broken']) > 10:
                summary += f"... and {len(player_data['blocks_broken']) - 10} more blocks\n"
            
            # Prepare prompt for ChatGPT
            prompt = f"""
Please analyze the following Minecraft player's gameplay data against the provided rubric.

RUBRIC:
{rubric_content}

PLAYER: {player_name}

{summary}

Please provide a detailed assessment of this player's performance based on the rubric criteria. 
Include specific examples from their gameplay data and suggestions for improvement.
Format the response in a clear, structured way with sections for different rubric criteria.
"""
            
            # Call OpenAI API
            try:
                response = openai.ChatCompletion.create(
                    model="gpt-3.5-turbo",
                    messages=[
                        {"role": "system", "content": "You are a Minecraft gameplay assessment expert. Analyze player data against the provided rubric and give constructive feedback. Be specific and reference actual gameplay data."},
                        {"role": "user", "content": prompt}
                    ],
                    max_tokens=1000,
                    temperature=0.7
                )
                
                analysis = response.choices[0].message.content
                analyses[player_name] = analysis
                
            except Exception as e:
                analyses[player_name] = f"Error analyzing player: {str(e)}"
        
        return {"analyses": analyses}
        
    except Exception as e:
        logger.error(f"Error in analyze_player_data: {str(e)}")
        return {"error": str(e)}

# HTML/JavaScript for 3D visualization with ChatGPT assessment
HTML_CONTENT = """
<!DOCTYPE html>
<html>
<head>
    <title>Minecraft Live 3D Tracker with AI Assessment</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
    <style>
        body { margin: 0; font-family: Arial; overflow: hidden; }
        #info {
            position: absolute;
            top: 10px;
            left: 10px;
            color: white;
            background: rgba(0,0,0,0.7);
            padding: 15px;
            border-radius: 5px;
            z-index: 100;
            max-width: 250px;
        }
        #status {
            position: absolute;
            top: 10px;
            right: 10px;
            padding: 10px 20px;
            border-radius: 5px;
            font-weight: bold;
            z-index: 100;
        }
        .connected { background: #4CAF50; color: white; }
        .disconnected { background: #f44336; color: white; }
        #playerList {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 15px;
            border-radius: 5px;
            max-width: 300px;
        }
        .player-item {
            margin: 5px 0;
            padding: 5px;
            background: rgba(255,255,255,0.1);
            border-radius: 3px;
        }
        #controls {
            position: absolute;
            top: 10px;
            left: 320px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 15px;
            border-radius: 5px;
        }
        .control-item {
            margin: 5px 0;
        }
        #legend {
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 15px;
            border-radius: 5px;
        }
        .legend-item {
            margin: 5px 0;
            display: flex;
            align-items: center;
        }
        .legend-icon {
            width: 16px;
            height: 16px;
            margin-right: 8px;
            border: 1px solid #333;
            display: inline-block;
        }
        .legend-icon.player { background-color: #4169E1; }
        .legend-icon.placed { background-color: #00FF00; }
        .legend-icon.broken { background-color: #FF0000; }
        .legend-icon.path { 
            background-color: #FFFFFF; 
            border-radius: 50%;
            width: 8px;
            height: 8px;
            margin: 4px 8px 4px 4px;
        }
        #eventLog {
            position: absolute;
            top: 200px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 15px;
            border-radius: 5px;
            max-width: 300px;
            max-height: 200px;
            overflow-y: auto;
            font-size: 12px;
        }
        .event-icon {
            display: inline-block;
            width: 12px;
            height: 12px;
            margin-right: 5px;
            border: 1px solid #333;
        }
        .event-icon.placed { background-color: #00FF00; }
        .event-icon.broken { background-color: #FF0000; }
        #sessionInfo {
            position: absolute;
            bottom: 10px;
            left: 350px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
        }
        #saveIndicator {
            position: absolute;
            top: 60px;
            right: 10px;
            padding: 5px 10px;
            background: rgba(0,0,0,0.7);
            color: #0f0;
            border-radius: 3px;
            font-size: 11px;
            opacity: 0;
            transition: opacity 0.3s;
        }
        #saveIndicator.show {
            opacity: 1;
        }
        #groundControls {
            position: absolute;
            top: 250px;
            left: 320px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
        }
        .slider-container {
            margin: 5px 0;
        }
        .slider {
            width: 120px;
        }
        
        /* ChatGPT Assessment Styles */
        #assessmentControls {
            position: absolute;
            top: 380px;
            left: 320px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 15px;
            border-radius: 5px;
        }
        #assessmentButton {
            background-color: #2196F3;
            color: white;
            border: none;
            padding: 10px 20px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
            width: 100%;
        }
        #assessmentButton:hover {
            background-color: #1976D2;
        }
        #assessmentButton:disabled {
            background-color: #cccccc;
            cursor: not-allowed;
        }
        #assessmentResults {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.95);
            color: white;
            padding: 20px;
            border-radius: 10px;
            max-width: 80%;
            max-height: 80%;
            overflow-y: auto;
            display: none;
            z-index: 1000;
        }
        #assessmentResults.show {
            display: block;
        }
        .close-button {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #f44336;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
        }
        .assessment-player {
            background: rgba(255,255,255,0.1);
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            border-left: 4px solid #2196F3;
        }
        .assessment-player h3 {
            margin-top: 0;
            color: #64B5F6;
        }
        .assessment-content {
            white-space: pre-wrap;
            line-height: 1.6;
            font-size: 14px;
        }
        .loading-spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #2196F3;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div id="info">
        <h3 style="margin-top:0">Minecraft Live 3D Tracker</h3>
        <div>Players: <span id="playerCount">0</span></div>
        <div>Status: <span id="wsStatus">Connecting...</span></div>
        <hr>
        <div style="font-size:12px">
            🖱️ Left-drag: Rotate | Scroll: Zoom | Right-drag: Pan<br>
            📍 Connect from Minecraft: /connect localhost:19131
        </div>
    </div>
    
    <div id="controls">
        <h4 style="margin-top:0">Controls</h4>
        <div class="control-item">
            <label><input type="checkbox" id="showPath" checked> Show Path</label>
        </div>
        <div class="control-item">
            <label><input type="checkbox" id="showBlocks" checked> Show Block Events</label>
        </div>
        <div class="control-item">
            <label><input type="checkbox" id="showGrid" checked> Show Grid</label>
        </div>
        <div class="control-item">
            <button onclick="clearPath()">Clear Path</button>
        </div>
        <div class="control-item">
            <button onclick="clearBlocks()">Clear Blocks</button>
        </div>
    </div>
    
    <div id="groundControls">
        <h4 style="margin-top:0">Ground Settings</h4>
        <div class="slider-container">
            <label>Opacity: <span id="opacityValue">0.8</span></label><br>
            <input type="range" id="groundOpacity" class="slider" min="0" max="100" value="80">
        </div>
        <div class="control-item">
            <label><input type="checkbox" id="showGround" checked> Show Ground</label>
        </div>
    </div>
    
    <div id="assessmentControls">
        <h4 style="margin-top:0">AI Assessment</h4>
        <button id="assessmentButton" onclick="analyzeWithChatGPT()">Analyze Players with AI</button>
        <div style="font-size:11px; margin-top:5px; text-align:center;">
            Assess gameplay against rubric
        </div>
    </div>
    
    <div id="legend">
        <h4 style="margin-top:0">Legend</h4>
        <div class="legend-item">
            <span class="legend-icon player"></span>
            <span>Player</span>
        </div>
        <div class="legend-item">
            <span class="legend-icon placed"></span>
            <span>Placed Block</span>
        </div>
        <div class="legend-item">
            <span class="legend-icon broken"></span>
            <span>Broken Block</span>
        </div>
        <div class="legend-item">
            <span class="legend-icon path"></span>
            <span>Path Trail</span>
        </div>
    </div>
    
    <div id="eventLog">
        <h4 style="margin-top:0">Recent Events</h4>
        <div id="eventList"></div>
    </div>
    
    <div id="sessionInfo">
        <div>Session: <span id="sessionId">-</span></div>
        <div>Duration: <span id="sessionDuration">00:00</span></div>
        <div>Events: <span id="eventCount">0</span></div>
        <div>File: <span id="fileName">-</span></div>
    </div>
    
    <div id="saveIndicator">💾 Saved</div>
    
    <div id="assessmentResults">
        <button class="close-button" onclick="closeAssessment()">✕</button>
        <h2>AI Player Assessment</h2>
        <div id="assessmentContent"></div>
    </div>
    
    <div id="status" class="disconnected">WebSocket Disconnected</div>
    <div id="playerList"></div>

    <script>
        // Three.js setup
        let scene, camera, renderer, controls;
        const players = new Map();
        const playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
        let colorIndex = 0;
        const blockEvents = [];
        let gridHelper;
        let groundMesh;
        const recentEvents = [];
        let sessionStartTime = null;
        let sessionId = null;
        let totalEvents = 0;
        let ws = null;

        function init() {
            // Scene
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x87CEEB);
            scene.fog = new THREE.Fog(0x87CEEB, 200, 500);

            // Camera
            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(30, 50, 30);

            // Renderer
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.shadowMap.enabled = true;
            document.body.appendChild(renderer.domElement);

            // Controls
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;

            // Lighting
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);

            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(50, 100, 50);
            directionalLight.castShadow = true;
            scene.add(directionalLight);

            // Ground - now with transparency
            const groundGeometry = new THREE.PlaneGeometry(200, 200);
            const groundMaterial = new THREE.MeshLambertMaterial({ 
                color: 0x7CFC00,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide  // Visible from both sides
            });
            groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
            groundMesh.rotation.x = -Math.PI / 2;
            groundMesh.receiveShadow = true;
            scene.add(groundMesh);

            // Grid
            gridHelper = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
            gridHelper.material.opacity = 0.2;
            gridHelper.material.transparent = true;
            scene.add(gridHelper);

            // Add axis helper
            const axesHelper = new THREE.AxesHelper(5);
            scene.add(axesHelper);

            // Setup ground opacity slider
            const opacitySlider = document.getElementById('groundOpacity');
            const opacityValue = document.getElementById('opacityValue');
            
            opacitySlider.addEventListener('input', (e) => {
                const opacity = e.target.value / 100;
                groundMesh.material.opacity = opacity;
                opacityValue.textContent = opacity.toFixed(2);
            });

            // Setup ground visibility checkbox
            const showGroundCheckbox = document.getElementById('showGround');
            showGroundCheckbox.addEventListener('change', (e) => {
                groundMesh.visible = e.target.checked;
            });

            // Start animation
            animate();
        }

        function showSaveIndicator() {
            const indicator = document.getElementById('saveIndicator');
            indicator.classList.add('show');
            setTimeout(() => {
                indicator.classList.remove('show');
            }, 1000);
        }

        function updateSessionInfo() {
            if (sessionStartTime) {
                const duration = Math.floor((Date.now() - sessionStartTime) / 1000);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                document.getElementById('sessionDuration').textContent = 
                    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
            document.getElementById('eventCount').textContent = totalEvents;
        }

        function createPlayer(playerId, playerName) {
            const geometry = new THREE.BoxGeometry(1, 2, 1);
            const color = playerColors[colorIndex % playerColors.length];
            const material = new THREE.MeshLambertMaterial({ color: color });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.position.y = 1;

            // Add player label
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 256;
            canvas.height = 64;
            context.fillStyle = color;
            context.fillRect(0, 0, 256, 64);
            context.fillStyle = 'white';
            context.font = 'bold 36px Arial';
            context.textAlign = 'center';
            context.fillText(playerName || playerId, 128, 45);

            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(5, 1.25, 1);
            sprite.position.y = 3;
            mesh.add(sprite);

            // Create path line
            const pathGeometry = new THREE.BufferGeometry();
            const pathMaterial = new THREE.LineBasicMaterial({ 
                color: color, 
                linewidth: 2,
                opacity: 0.8,
                transparent: true 
            });
            const pathLine = new THREE.Line(pathGeometry, pathMaterial);
            scene.add(pathLine);

            players.set(playerId, {
                mesh: mesh,
                targetPos: new THREE.Vector3(),
                name: playerName || playerId,
                color: color,
                lastUpdate: Date.now(),
                path: [],
                pathLine: pathLine,
                maxPathPoints: 500 // Limit path length
            });

            scene.add(mesh);
            colorIndex++;
            
            updatePlayerCount();
            updatePlayerList();
        }

        function updatePlayer(playerId, playerName, x, y, z) {
            if (!players.has(playerId)) {
                createPlayer(playerId, playerName);
            }
            
            const player = players.get(playerId);
            
            // Convert Minecraft coords to Three.js coords
            const worldX = x - 200;
            const worldY = y - 80;
            const worldZ = -(z + 85);
            
            player.targetPos.set(worldX, worldY, worldZ);
            player.lastUpdate = Date.now();
            
            // Add to path if moved significantly
            if (player.path.length === 0 || 
                player.path[player.path.length - 1].distanceTo(player.targetPos) > 0.5) {
                
                player.path.push(new THREE.Vector3(worldX, worldY, worldZ));
                
                // Limit path length
                if (player.path.length > player.maxPathPoints) {
                    player.path.shift();
                }
                
                // Update path line
                updatePathLine(player);
            }
            
            updatePlayerList();
        }

        function updatePathLine(player) {
            if (!document.getElementById('showPath').checked) {
                player.pathLine.visible = false;
                return;
            }
            
            player.pathLine.visible = true;
            const positions = [];
            player.path.forEach(point => {
                positions.push(point.x, point.y + 0.1, point.z); // Slightly above ground
            });
            
            player.pathLine.geometry.setAttribute('position', 
                new THREE.Float32BufferAttribute(positions, 3));
        }

        function addBlockEvent(type, x, y, z, blockType, playerName, blockPos) {
            // Use the block's actual position
            const worldX = blockPos.x - 200;
            const worldY = blockPos.y - 80;
            const worldZ = -(blockPos.z + 85);
            
            // Create block visualization
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            const material = new THREE.MeshLambertMaterial({
                color: type === 'place' ? 0x00ff00 : 0xff0000,
                transparent: true,
                opacity: 0.7
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(worldX, worldY, worldZ);
            mesh.castShadow = true;
            
            // Add wireframe
            const wireframe = new THREE.LineSegments(
                new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
            );
            mesh.add(wireframe);
            
            scene.add(mesh);
            
            blockEvents.push({
                mesh: mesh,
                type: type,
                blockType: blockType,
                position: { x: worldX, y: worldY, z: worldZ },
                timestamp: Date.now()
            });
            
            // Add to event log with colored squares
            const iconClass = type === 'place' ? 'placed' : 'broken';
            const actionText = type === 'place' ? 'placed' : 'broke';
            addEventToLog(`<span class="event-icon ${iconClass}"></span>${playerName || 'Player'} ${actionText} ${blockType} at (${blockPos.x.toFixed(0)}, ${blockPos.y.toFixed(0)}, ${blockPos.z.toFixed(0)})`);
            
            // Fade out animation
            const fadeOut = () => {
                mesh.material.opacity -= 0.01;
                if (mesh.material.opacity > 0.1) {
                    setTimeout(fadeOut, 100);
                }
            };
            setTimeout(fadeOut, 30000); // Start fading after 30 seconds
        }

        function addEventToLog(message) {
            recentEvents.unshift({
                message: message,
                timestamp: new Date().toLocaleTimeString()
            });
            
            // Keep only last 10 events
            if (recentEvents.length > 10) {
                recentEvents.pop();
            }
            
            updateEventLog();
        }

        function updateEventLog() {
            const eventListDiv = document.getElementById('eventList');
            let html = '';
            
            recentEvents.forEach(event => {
                html += `<div style="margin: 2px 0;">${event.timestamp} - ${event.message}</div>`;
            });
            
            eventListDiv.innerHTML = html;
        }

        function removePlayer(playerId) {
            const player = players.get(playerId);
            if (player) {
                scene.remove(player.mesh);
                scene.remove(player.pathLine);
                players.delete(playerId);
                updatePlayerCount();
                updatePlayerList();
            }
        }

        function updatePlayerCount() {
            document.getElementById('playerCount').textContent = players.size;
        }

        function updatePlayerList() {
            const playerListDiv = document.getElementById('playerList');
            let html = '<h4 style="margin-top:0">Active Players</h4>';
            
            players.forEach((player, playerId) => {
                const pos = player.targetPos;
                html += `<div class="player-item" style="border-left: 4px solid ${player.color}">
                    <strong>${player.name}</strong><br>
                    X: ${(pos.x + 200).toFixed(1)}, Y: ${(pos.y + 80).toFixed(1)}, Z: ${(-pos.z - 85).toFixed(1)}<br>
                    Path Points: ${player.path.length}
                </div>`;
            });
            
            playerListDiv.innerHTML = html;
        }

        function clearPath() {
            players.forEach(player => {
                player.path = [];
                updatePathLine(player);
            });
        }

        function clearBlocks() {
            blockEvents.forEach(event => {
                scene.remove(event.mesh);
            });
            blockEvents.length = 0;
        }

        // ChatGPT Analysis Functions
        async function analyzeWithChatGPT() {
            const button = document.getElementById('assessmentButton');
            const resultsDiv = document.getElementById('assessmentResults');
            const contentDiv = document.getElementById('assessmentContent');
            
            button.disabled = true;
            button.textContent = 'Analyzing...';
            
            // Show results with loading spinner
            resultsDiv.classList.add('show');
            contentDiv.innerHTML = '<div class="loading-spinner"></div><p style="text-align:center;">Analyzing player data with AI...</p>';
            
            try {
                // Send analysis request via WebSocket
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'analyze_request'
                    }));
                } else {
                    throw new Error('WebSocket not connected');
                }
            } catch (error) {
                contentDiv.innerHTML = `<div style="color: #f44336;">Error: ${error.message}</div>`;
                button.disabled = false;
                button.textContent = 'Analyze Players with AI';
            }
        }

        function displayAnalysisResults(data) {
            const button = document.getElementById('assessmentButton');
            const contentDiv = document.getElementById('assessmentContent');
            
            button.disabled = false;
            button.textContent = 'Analyze Players with AI';
            
            if (data.error) {
                contentDiv.innerHTML = `<div style="color: #f44336;">Error: ${data.error}</div>`;
                return;
            }
            
            let html = '';
            for (const [player, analysis] of Object.entries(data.analyses)) {
                html += `
                    <div class="assessment-player">
                        <h3>${player}</h3>
                        <div class="assessment-content">${analysis}</div>
                    </div>
                `;
            }
            
            if (Object.keys(data.analyses).length === 0) {
                html = '<p>No player data available for analysis.</p>';
            }
            
            contentDiv.innerHTML = html;
        }

        function closeAssessment() {
            document.getElementById('assessmentResults').classList.remove('show');
        }

        function animate() {
            requestAnimationFrame(animate);

            // Smooth movement interpolation
            players.forEach(player => {
                player.mesh.position.lerp(player.targetPos, 0.1);
            });

            // Update block visibility
            const showBlocks = document.getElementById('showBlocks').checked;
            blockEvents.forEach(event => {
                event.mesh.visible = showBlocks;
            });

            // Update grid visibility
            gridHelper.visible = document.getElementById('showGrid').checked;

            // Update session info
            updateSessionInfo();

            controls.update();
            renderer.render(scene, camera);
        }

        // WebSocket connection to get live updates
        function connectWebSocket() {
            ws = new WebSocket('ws://localhost:8081/live');
            
            ws.onopen = () => {
                console.log('Connected to live updates');
                document.getElementById('wsStatus').textContent = 'Connected';
                document.getElementById('status').className = 'connected';
                document.getElementById('status').textContent = 'WebSocket Connected';
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'session_info') {
                    sessionId = data.sessionId;
                    sessionStartTime = new Date(data.startTime).getTime();
                    document.getElementById('sessionId').textContent = sessionId.split('_').slice(-2).join('_');
                    document.getElementById('fileName').textContent = data.fileName;
                } else if (data.type === 'save_notification') {
                    showSaveIndicator();
                } else if (data.type === 'position') {
                    updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z);
                    totalEvents++;
                } else if (data.type === 'block_place') {
                    addBlockEvent('place', data.x, data.y, data.z, data.blockType, data.playerName, data.blockPos);
                    console.log(`Block placed: ${data.blockType} at (${data.blockPos.x}, ${data.blockPos.y}, ${data.blockPos.z})`);
                    totalEvents++;
                } else if (data.type === 'block_break') {
                    addBlockEvent('break', data.x, data.y, data.z, data.blockType, data.playerName, data.blockPos);
                    console.log(`Block broken: ${data.blockType} at (${data.blockPos.x}, ${data.blockPos.y}, ${data.blockPos.z})`);
                    totalEvents++;
                } else if (data.type === 'disconnect') {
                    removePlayer(data.playerId);
                    totalEvents++;
                } else if (data.type === 'analysis_result') {
                    displayAnalysisResults(data);
                }
            };

            ws.onclose = () => {
                console.log('Disconnected from live updates');
                document.getElementById('wsStatus').textContent = 'Disconnected';
                document.getElementById('status').className = 'disconnected';
                document.getElementById('status').textContent = 'WebSocket Disconnected';
                
                // Reconnect after 2 seconds
                setTimeout(connectWebSocket, 2000);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Initialize
        init();
        connectWebSocket();
    </script>
</body>
</html>
"""

class SimpleHTTPHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler to serve the 3D visualization"""
    
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(HTML_CONTENT.encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        # Suppress HTTP logs
        pass

async def broadcast_to_web(message):
    """Broadcast updates to all connected web clients"""
    disconnected = set()
    for client in web_clients:
        try:
            await client.send(json.dumps(message))
        except:
            disconnected.add(client)
    # Remove disconnected clients
    web_clients.difference_update(disconnected)

async def handle_web_client(websocket):
    """Handle web browser WebSocket connections for live updates"""
    logger.info("Web client connected for live updates")
    web_clients.add(websocket)
    
    try:
        # Send session info
        if session_id:
            await websocket.send(json.dumps({
                'type': 'session_info',
                'sessionId': session_id,
                'startTime': session_start_time.isoformat(),
                'fileName': session_file
            }))
        
        # Send current player positions
        for player_id, pos in player_positions.items():
            await websocket.send(json.dumps({
                'type': 'position',
                'playerId': player_id,
                'playerName': pos.get('name', player_id),
                'x': pos['x'],
                'y': pos['y'],
                'z': pos['z']
            }))
        
        # Keep connection alive and handle messages
        async for message in websocket:
            try:
                msg = json.loads(message)
                if msg.get('type') == 'analyze_request':
                    # Perform analysis
                    logger.info("Received AI analysis request")
                    analysis_result = await analyze_player_data()
                    
                    # Send result back
                    await websocket.send(json.dumps({
                        'type': 'analysis_result',
                        **analysis_result
                    }))
            except Exception as e:
                logger.error(f"Error handling web client message: {e}")
            
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        web_clients.discard(websocket)
        logger.info("Web client disconnected")

async def handle_minecraft_client(websocket):
    """Handle Minecraft Education Edition connections"""
    global active_players
    
    try:
        client_addr = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
    except:
        client_addr = "unknown"
        
    logger.info(f"🎮 Minecraft connected from {client_addr}")
    
    player_id = None
    player_name = None
    
    # Start session when first player connects
    if len(active_players) == 0:
        start_session()
        # Broadcast session info to web clients
        await broadcast_to_web({
            'type': 'session_info',
            'sessionId': session_id,
            'startTime': session_start_time.isoformat(),
            'fileName': session_file
        })
    
    try:
        # Send welcome message
        await websocket.send(json.dumps({
            "header": {"messagePurpose": "commandResponse"},
            "body": {"statusMessage": f"Connected! Recording to {session_file}"}
        }))
        
        # Subscribe to BlockPlaced and BlockBroken events
        for event_name in ["BlockPlaced", "BlockBroken"]:
            await websocket.send(json.dumps({
                "header": {
                    "version": 1,
                    "requestId": str(uuid4()),
                    "messageType": "commandRequest",
                    "messagePurpose": "subscribe"
                },
                "body": {
                    "eventName": event_name
                }
            }))
            logger.info(f"📋 Subscribed to {event_name}")
        
        # Position update counter for throttling
        position_update_counter = 0
        
        async for message in websocket:
            try:
                msg = json.loads(message)
                
                # Extract header and body
                header = msg.get('header', {})
                body = msg.get('body', {})
                
                # Track player from any message that includes player data
                if 'player' in body:
                    player_data = body['player']
                    if player_id is None:
                        player_id = str(player_data.get('id', f"Player_{int(time.time()) % 1000}"))
                        player_name = player_data.get('name', player_id)
                        active_players.add(player_id)
                        logger.info(f"🎯 Identified player: {player_name}")
                        
                        # Record player join event
                        record_event("player_join", {
                            "player_id": player_id,
                            "player_name": player_name,
                            "address": client_addr
                        })
                    
                    if 'position' in player_data:
                        pos = player_data['position']
                        pos_x = float(pos['x'])
                        pos_y = float(pos['y'])
                        pos_z = float(pos['z'])
                        
                        player_positions[player_id] = {
                            'x': pos_x,
                            'y': pos_y,
                            'z': pos_z,
                            'name': player_name
                        }
                        
                        # Only record position every 10 updates to avoid spam
                        position_update_counter += 1
                        if position_update_counter % 10 == 0:
                            record_event("player_position", {
                                "player_id": player_id,
                                "player_name": player_name,
                                "position": {"x": pos_x, "y": pos_y, "z": pos_z}
                            })
                        
                        await broadcast_to_web({
                            'type': 'position',
                            'playerId': player_id,
                            'playerName': player_name,
                            'x': pos_x,
                            'y': pos_y,
                            'z': pos_z
                        })
                
                # Handle block events
                if header.get('eventName') == 'BlockPlaced' and header.get('messagePurpose') == 'event':
                    player_pos = body.get('player', {}).get('position', {})
                    block_x = int(player_pos.get('x', 0))
                    block_y = int(player_pos.get('y', 0))
                    block_z = int(player_pos.get('z', 0))
                    
                    block_info = body.get('block', {})
                    block_id = block_info.get('id', 'unknown')
                    block_namespace = block_info.get('namespace', 'minecraft')
                    block_type = f"{block_namespace}:{block_id}"
                    
                    # Record block placed event
                    record_event("block_placed", {
                        "player_id": player_id,
                        "player_name": player_name,
                        "block_type": block_type,
                        "player_position": {"x": player_pos.get('x', 0), "y": player_pos.get('y', 0), "z": player_pos.get('z', 0)},
                        "estimated_block_position": {"x": block_x, "y": block_y + 1, "z": block_z}
                    })
                    
                    await broadcast_to_web({
                        'type': 'block_place',
                        'x': player_pos.get('x', 0),
                        'y': player_pos.get('y', 0),
                        'z': player_pos.get('z', 0),
                        'blockPos': {
                            'x': block_x,
                            'y': block_y + 1,
                            'z': block_z
                        },
                        'blockType': block_type,
                        'playerName': player_name or 'Unknown'
                    })
                    
                    logger.info(f"🟩 Block placed: {block_type} near ({block_x}, {block_y}, {block_z}) by {player_name}")
                
                elif header.get('eventName') == 'BlockBroken' and header.get('messagePurpose') == 'event':
                    player_pos = body.get('player', {}).get('position', {})
                    block_x = int(player_pos.get('x', 0))
                    block_y = int(player_pos.get('y', 0))
                    block_z = int(player_pos.get('z', 0))
                    
                    block_info = body.get('block', {})
                    block_id = block_info.get('id', 'unknown')
                    block_namespace = block_info.get('namespace', 'minecraft')
                    block_type = f"{block_namespace}:{block_id}"
                    
                    # Record block broken event
                    record_event("block_broken", {
                        "player_id": player_id,
                        "player_name": player_name,
                        "block_type": block_type,
                        "player_position": {"x": player_pos.get('x', 0), "y": player_pos.get('y', 0), "z": player_pos.get('z', 0)},
                        "estimated_block_position": {"x": block_x, "y": block_y, "z": block_z}
                    })
                    
                    await broadcast_to_web({
                        'type': 'block_break',
                        'x': player_pos.get('x', 0),
                        'y': player_pos.get('y', 0),
                        'z': player_pos.get('z', 0),
                        'blockPos': {
                            'x': block_x,
                            'y': block_y,
                            'z': block_z
                        },
                        'blockType': block_type,
                        'playerName': player_name or 'Unknown'
                    })
                    
                    logger.info(f"🟥 Block broken: {block_type} near ({block_x}, {block_y}, {block_z}) by {player_name}")
                
                # Check if we need to save
                if len(event_buffer) > 0 and (time.time() - last_save_time > 5):
                    await broadcast_to_web({'type': 'save_notification'})
                
            except Exception as e:
                logger.error(f"Error processing message: {e}")
    
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"🎮 Minecraft disconnected: {player_name or 'Unknown'}")
    finally:
        # Clean up player
        if player_id:
            # Record player leave event
            record_event("player_leave", {
                "player_id": player_id,
                "player_name": player_name
            })
            
            if player_id in player_positions:
                del player_positions[player_id]
            
            if player_id in active_players:
                active_players.remove(player_id)
            
            await broadcast_to_web({
                'type': 'disconnect',
                'playerId': player_id
            })
            
            # End session when last player leaves
            if len(active_players) == 0:
                logger.info("📤 Last player left, ending session...")
                end_session()

def run_http_server():
    """Run HTTP server in a separate thread"""
    server = HTTPServer(('localhost', 8080), SimpleHTTPHandler)
    logger.info("🌐 Web interface running at http://localhost:8080")
    server.serve_forever()

async def main():
    """Main function to run both servers"""
    logger.info("=" * 60)
    logger.info("🎮 Minecraft 3D Live Tracker with AI Assessment")
    logger.info("=" * 60)
    
    # Check for OpenAI API key
    if not os.getenv('OPENAI_API_KEY'):
        logger.warning("⚠️  OpenAI API key not found! AI assessment will not work.")
        logger.warning("   Set OPENAI_API_KEY in your .env file")
    
    # Start HTTP server in background thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    
    # Start WebSocket servers
    minecraft_server = await websockets.serve(
        handle_minecraft_client, 
        '0.0.0.0', 
        19131  # Minecraft port
    )
    
    web_server = await websockets.serve(
        handle_web_client,
        'localhost',
        8081  # Web updates port
    )
    
    logger.info("✅ Servers started successfully!")
    logger.info("")
    logger.info("📡 Minecraft: Connect with /connect localhost:19131")
    logger.info("🌐 3D Viewer: Open http://localhost:8080 in your browser")
    logger.info("🤖 AI: Click 'Analyze Players with AI' button")
    logger.info("💾 JSON file updates in real-time every 5 seconds")
    logger.info("=" * 60)
    
    # Run forever
    await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n👋 Server stopped")
        # Save any active session
        if active_players:
            logger.info("💾 Saving active session before shutdown...")
            end_session()