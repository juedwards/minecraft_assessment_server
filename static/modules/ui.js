// ui.js
// Responsibilities:
// - DOM bindings: session info, export button, modals, sliders, checkboxes
// - parseMarkdownToHTML, displayAnalysisResults, downloadAssessment helpers
// - Small UI helpers like showSaveIndicator, updateSessionInfo

import * as events from './events.js';
import * as state from './state.js';
import * as players from './players.js';
import * as websocket from './websocket.js';
import * as chunks from './chunks.js';
import { getScene } from './scene.js';

export function showSaveIndicator() {
    const indicator = document.getElementById('saveIndicator');
    if (!indicator) return;
    indicator.classList.add('show');
    setTimeout(() => {
        indicator.classList.remove('show');
    }, 1000);
}

export function updateSessionInfo() {
    const sessionStart = state.getSessionStartTime();
    if (sessionStart) {
        const duration = Math.floor((Date.now() - sessionStart) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const durationElem = document.getElementById('sessionDuration');
        if (durationElem) durationElem.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    const eventCountElem = document.getElementById('eventCount');
    if (eventCountElem) eventCountElem.textContent = state.getTotalEvents() || 0;
}

export function exportSessionData() {
    const sessionId = state.getSessionId();
    if (!sessionId) {
        alert('No active session to export. Start a session by connecting a Minecraft player first.');
        return;
    }
    const exportButton = document.getElementById('exportButton');
    const originalText = exportButton ? exportButton.textContent : '';
    if (exportButton) { exportButton.disabled = true; exportButton.textContent = 'Exporting...'; }

    const fileName = sessionId + '.json';
    const downloadUrl = `/api/export-session/${sessionId}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);

    link.onclick = function() {
        setTimeout(() => {
            if (exportButton) { exportButton.disabled = false; exportButton.textContent = originalText; }
            document.body.removeChild(link);
        }, 2000);
    };

    link.click();
    console.log(`Exporting session: ${fileName}`);

    const fileName_display = document.getElementById('fileName');
    const originalFileName = fileName_display ? fileName_display.textContent : '';
    if (fileName_display) { fileName_display.textContent = '✓ Exported'; fileName_display.style.color = '#4CAF50'; }
    setTimeout(() => {
        if (fileName_display) { fileName_display.textContent = originalFileName; fileName_display.style.color = ''; }
    }, 3000);
}

export function parseMarkdownToHTML(text) {
    // Full parser migrated from app.js
    let html = text;
    html = html.replace(/^#### (.*?)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/```(.*?)```/gs, '<pre><code>$1</code></pre>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    html = html.replace(/^\* (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>\s*)+/gs, function(match) { return '<ul>' + match + '</ul>'; });
    html = html.split('\n\n').map(para => {
        if (!para.trim()) return '';
        if (para.includes('<h') || para.includes('<ul') || para.includes('<ol')) {
            return para;
        }
        return '<p>' + para + '</p>';
    }).join('\n');
    html = html.replace(/\n/g, '<br>');
    return html;
}

export function displayAnalysisResults(data) {
    const button = document.getElementById('assessmentButton');
    const contentDiv = document.getElementById('assessmentContent');
    const resultsDiv = document.getElementById('assessmentResults');
    if (button) { button.disabled = false; button.textContent = 'Analyze Players with AI'; }

    if (data.error) {
        if (contentDiv) contentDiv.innerHTML = `<div style="color: #f44336;">Error: ${data.error}</div>`;
        return;
    }

    if (!data.analyses || Object.keys(data.analyses).length === 0) {
        if (contentDiv) contentDiv.innerHTML = '<p>No player data available for analysis.</p>';
        if (resultsDiv) { resultsDiv.style.display = 'block'; resultsDiv.classList.add('show'); }
        return;
    }

    let html = `
        <div style="text-align: center; margin-bottom: 20px;">
            <button id="downloadAssessmentBtn" class="download-assessment-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download as Word Document
            </button>
        </div>
    `;

    for (const [player, analysis] of Object.entries(data.analyses)) {
        const parsedContent = parseMarkdownToHTML(analysis);
        html += `
            <div class="assessment-player">
                <h3>${player}</h3>
                <div class="assessment-content">${parsedContent}</div>
            </div>
        `;
    }

    if (contentDiv) {
        contentDiv.innerHTML = html;
        const dl = document.getElementById('downloadAssessmentBtn');
        if (dl) dl.addEventListener('click', downloadAssessment);
    }
}

export function downloadAssessment() {
    const button = document.getElementById('downloadAssessmentBtn');
    if (!button) return;
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; animation: spin 1s linear infinite;">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            <path d="M9 12l2 2 4-4"></path>
        </svg>
        Generating Document...
    `;

    const link = document.createElement('a');
    link.href = '/api/download-assessment';
    link.style.display = 'none';
    document.body.appendChild(link);

    link.onclick = function() {
        setTimeout(() => {
            button.disabled = false;
            button.innerHTML = originalText;
            document.body.removeChild(link);
        }, 1000);
    };

    link.click();
}

export async function openRubricEditor() {
    const modal = document.getElementById('rubricEditor');
    const textarea = document.getElementById('rubricContent');
    if (modal) modal.style.display = 'block';
    try {
        const response = await fetch('/api/rubric');
        const data = await response.json();
        if (textarea) { textarea.value = data.content || ''; textarea.disabled = false; }
    } catch (error) {
        if (textarea) { textarea.value = 'Error loading rubric: ' + error.message; textarea.disabled = true; }
    }
}

export function closeRubricEditor() {
    const modal = document.getElementById('rubricEditor');
    if (modal) modal.style.display = 'none';
}

export async function saveRubric() {
    const textarea = document.getElementById('rubricContent');
    const saveButton = document.querySelector('.save-button');
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving...'; }
    try {
        const response = await fetch('/api/rubric', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: textarea ? textarea.value : '' })
        });
        if (response.ok) {
            if (events && typeof events.addEventToLog === 'function') events.addEventToLog('<span style="color: #4CAF50;">✓</span> Rubric saved successfully');
            if (typeof closeRubricEditor === 'function') closeRubricEditor();
        } else {
            throw new Error('Failed to save rubric');
        }
    } catch (error) {
        alert('Error saving rubric: ' + error.message);
    } finally {
        if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Changes'; }
    }
}

export async function analyzeWithChatGPT() {
    const button = document.getElementById('assessmentButton');
    const resultsDiv = document.getElementById('assessmentResults');
    const contentDiv = document.getElementById('assessmentContent');
    const backdrop = document.getElementById('assessmentBackdrop');
    if (button) { button.disabled = true; button.textContent = 'Analyzing...'; }
    if (backdrop) backdrop.classList.add('show');
    if (resultsDiv) { resultsDiv.style.display = 'block'; resultsDiv.classList.add('show'); }
    if (contentDiv) contentDiv.innerHTML = '<div class="loading-spinner"></div><p style="text-align:center;">Analyzing player data with AI...</p>';
    try {
        if (websocket && websocket.isOpen && websocket.isOpen()) {
            websocket.send({ type: 'analyze_request' });
        } else {
            throw new Error('WebSocket not connected');
        }
    } catch (error) {
        if (contentDiv) contentDiv.innerHTML = `<div style="color: #f44336;">Error: ${error.message}</div>`;
        if (button) { button.disabled = false; button.textContent = 'Analyze Players with AI'; }
    }
}

export function sendGameCommand(command, isPlayerSpecific = false) {
    // Determine target players
    const targetMode = document.querySelector('input[name="targetPlayers"]:checked') ? document.querySelector('input[name="targetPlayers"]:checked').value : 'all';
    let targetPlayers = [];
    if (targetMode === 'selected') {
        const checkboxes = document.querySelectorAll('#playerSelectionList input[type="checkbox"]:checked');
        targetPlayers = Array.from(checkboxes).map(cb => cb.value);
        if (targetPlayers.length === 0) {
            alert('Please select at least one player');
            return;
        }
    }

    // Build payload and send via websocket
    const payload = {
        type: 'game_command',
        command: command,
        targetMode: targetMode,
        targetPlayers: targetPlayers,
        playerSpecific: !!isPlayerSpecific
    };

    try {
        if (websocket && websocket.isOpen && websocket.isOpen()) {
            websocket.send(payload);
            if (events && typeof events.addEventToLog === 'function') events.addEventToLog(`<span style="color: #2196F3;">🕹️</span> Sent command: ${command}`);
        } else {
            alert('WebSocket not connected. Cannot send command.');
        }
    } catch (e) {
        console.error('sendGameCommand failed', e);
    }
}

export function openGameControls() {
    const modal = document.getElementById('gameControlsModal');
    if (modal) modal.style.display = 'block';
    updatePlayerSelectionList();
    const allRadio = document.querySelector('input[name="targetPlayers"][value="all"]');
    if (allRadio) allRadio.checked = true;
    const list = document.getElementById('playerSelectionList'); if (list) list.style.display = 'none';
}

export function closeGameControls() {
    const modal = document.getElementById('gameControlsModal');
    if (modal) modal.style.display = 'none';
}

export function updatePlayerSelectionList() {
    const listDiv = document.getElementById('playerSelectionList');
    if (!listDiv) return;
    listDiv.innerHTML = '';
    const playersMap = (players && players.players) ? players.players : null;
    if (!playersMap || playersMap.size === 0) {
        listDiv.innerHTML = '<div style="color: #999; font-size: 13px;">No players connected</div>';
        return;
    }
    playersMap.forEach((player, playerId) => {
        const label = document.createElement('label'); label.className = 'player-checkbox';
        label.innerHTML = `<input type="checkbox" value="${playerId}" checked><span style="background-color: ${player.color}"></span>${player.name}`;
        listDiv.appendChild(label);
    });
}

export function clearSessionData() {
    if (!confirm('Are you sure you want to clear the current session data? This will start a new recording session.')) return;
    try {
        if (websocket && websocket.isOpen && websocket.isOpen()) {
            websocket.send({ type: 'clear_session' });

            // Clear local data via modules
            try { if (players && typeof players.clearPlayers === 'function') players.clearPlayers(); } catch (e) {}
            try { if (events && typeof events.clearBlocks === 'function') events.clearBlocks(); } catch (e) {}
            try { if (chunks && typeof chunks.clearAllChunkMeshes === 'function') chunks.clearAllChunkMeshes(getScene()); } catch (e) {}

            // Clear 3D scene children produced by players/events
            try {
                const scene = getScene();
                if (scene) {
                    scene.children = scene.children.filter(child => {
                        if (child.userData && (child.userData.isPlayer || child.userData.isPath || child.userData.isBlock || child.userData.isChunk)) {
                            return false;
                        }
                        return true;
                    });
                }
            } catch (e) {}

            // Clear event log UI
            try { const ev = document.getElementById('eventList'); if (ev) ev.innerHTML=''; } catch (e) {}

            // Reset counters
            try { const pc = document.getElementById('playerCount'); if (pc) pc.textContent='0'; } catch (e) {}
            try { const ec = document.getElementById('eventCount'); if (ec) ec.textContent='0'; } catch (e) {}

            // Show brief success indicator
            const indicator = document.getElementById('saveIndicator'); if (indicator) { indicator.textContent='🔄 Session Cleared'; indicator.style.display='block'; setTimeout(()=>{ indicator.style.display='none'; },2000); }

        } else {
            alert('WebSocket is not connected. Cannot clear session.');
        }
    } catch (e) { console.error('clearSessionData failed', e); }
}

export function wireDomHandlers() {
    try {
        console.log('ui.wireDomHandlers: registering DOM handlers and subscriptions');
        const clearPathBtn = document.getElementById('clearPathBtn');
        if (clearPathBtn) {
            clearPathBtn.addEventListener('click', () => {
                try { if (window && window.players && typeof window.players.clearPath === 'function') window.players.clearPath(); } catch (e) {}
            });
        }

        const clearBlocksBtn = document.getElementById('clearBlocksBtn');
        if (clearBlocksBtn) {
            clearBlocksBtn.addEventListener('click', () => {
                try { if (window && window.events && typeof window.events.clearBlocks === 'function') window.events.clearBlocks(); } catch (e) {}
            });
        }

        const assessmentBtn = document.getElementById('assessmentButton');
        if (assessmentBtn) assessmentBtn.addEventListener('click', analyzeWithChatGPT);

        const editRubricBtn = document.getElementById('editRubricButton');
        if (editRubricBtn) editRubricBtn.addEventListener('click', openRubricEditor);

        const gameControlsBtn = document.getElementById('gameControlsButton');
        if (gameControlsBtn) gameControlsBtn.addEventListener('click', openGameControls);

        const sendMsgBtn = document.getElementById('sendMessageButton');
        if (sendMsgBtn) {
            sendMsgBtn.addEventListener('click', () => {
                const input = document.getElementById('messageInput');
                if (!input) return;
                const msg = input.value.trim();
                if (!msg) return;
                try {
                    if (websocket && websocket.isOpen && websocket.isOpen()) {
                        websocket.send({ type: 'send_message', message: msg });
                        input.value = '';
                        if (events && typeof events.addEventToLog === 'function') events.addEventToLog(`<span style="color: #2196F3;">📨</span> Message sent: "${msg}"`);
                    } else {
                        alert('WebSocket not connected. Cannot send message.');
                    }
                } catch (e) {
                    console.error('send message failed', e);
                }
            });
        }

        const exportBtn = document.getElementById('exportButton');
        if (exportBtn) exportBtn.addEventListener('click', exportSessionData);

        const clearSessionBtn = document.getElementById('clearButton');
        if (clearSessionBtn) clearSessionBtn.addEventListener('click', clearSessionData);

        const meshBtn = document.getElementById('meshChunkBtn');
        if (meshBtn) {
            meshBtn.addEventListener('click', async () => {
                const cx = parseInt(prompt('Chunk X:', '0'), 10);
                const cz = parseInt(prompt('Chunk Z:', '0'), 10);
                try {
                    const chunkMesher = await import('./chunk_mesher.js');
                    await chunkMesher.renderChunkFromCoords('overworld', cx, cz);
                } catch (e) { console.error('mesh chunk failed', e); alert('Meshing failed: ' + e.message); }
            });
        }

        const closeAssessmentBtn = document.getElementById('closeAssessmentBtn');
        if (closeAssessmentBtn) closeAssessmentBtn.addEventListener('click', () => {
            const resultsDiv = document.getElementById('assessmentResults');
            const backdrop = document.getElementById('assessmentBackdrop');
            if (resultsDiv) resultsDiv.classList.remove('show');
            if (backdrop) backdrop.classList.remove('show');
            setTimeout(() => { if (resultsDiv) resultsDiv.style.display = 'none'; if (resultsDiv) resultsDiv.style.opacity = ''; }, 300);
        });

        const closeRubricBtn = document.getElementById('closeRubricBtn');
        if (closeRubricBtn) closeRubricBtn.addEventListener('click', closeRubricEditor);
        const saveRubricBtn = document.getElementById('saveRubricBtn');
        if (saveRubricBtn) saveRubricBtn.addEventListener('click', saveRubric);
        const cancelRubricBtn = document.getElementById('cancelRubricBtn');
        if (cancelRubricBtn) cancelRubricBtn.addEventListener('click', closeRubricEditor);

        const closeGameControlsBtn = document.getElementById('closeGameControlsBtn');
        if (closeGameControlsBtn) closeGameControlsBtn.addEventListener('click', closeGameControls);

        // Delegate command buttons via event delegation
        document.querySelectorAll('.command-grid').forEach(grid => {
            grid.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.command-btn');
                if (!btn) return;
                const cmd = btn.getAttribute('data-cmd');
                const playerSpecific = btn.getAttribute('data-player-specific') === 'true';
                if (!cmd) return;
                sendGameCommand(cmd, playerSpecific);
            });
        });

        // Register for websocket-published events
        try {
            if (events && typeof events.onAnalysisResult === 'function') events.onAnalysisResult(displayAnalysisResults);
            if (events && typeof events.onSaveNotification === 'function') events.onSaveNotification(showSaveIndicator);
            if (events && typeof events.onSessionUpdated === 'function') events.onSessionUpdated(updateSessionInfo);
        } catch (e) { console.error('failed to register event handlers', e); }

        // Register for player list changes so the UI updates when players change
        try {
            if (players && typeof players.onPlayersChanged === 'function') {
                players.onPlayersChanged(() => { players.updatePlayerCount(); players.updatePlayerList(); updatePlayerSelectionList(); });
            }
        } catch (e) { console.error('failed to register players.onPlayersChanged', e); }

        // If the scene doesn't include the legacy helpers, disable/hide their UI controls
        try {
            const sceneObj = getScene();
            // Ground controls
            const showGroundElem = document.getElementById('showGround');
            const opacitySlider = document.getElementById('groundOpacity');
            const opacityValue = document.getElementById('opacityValue');
            if (!sceneObj || !sceneObj.groundMesh) {
                if (showGroundElem) { showGroundElem.disabled = true; showGroundElem.title = 'Ground not present (using chunk data)'; }
                if (opacitySlider) { opacitySlider.disabled = true; opacitySlider.title = 'Ground not present'; }
                if (opacityValue) { opacityValue.textContent = '—'; }
            }

            // Grid control
            const showGridElem = document.getElementById('showGrid');
            if (!sceneObj || !sceneObj.gridHelper) {
                if (showGridElem) { showGridElem.disabled = true; showGridElem.title = 'Grid not present (using chunk data)'; }
            }
        } catch (e) {
            // non-fatal
        }
    } catch (e) { console.error('ui.wireDomHandlers failed', e); }
}
