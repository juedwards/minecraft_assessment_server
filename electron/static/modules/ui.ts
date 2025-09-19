// UI helper utilities for the static viewer
import * as events from './events';
import * as state from './state';
import * as players from './players';
import * as websocket from './websocket.js';
import * as chunks from './chunks';
import { getScene } from './scene';

export function showSaveIndicator() {
    const indicator = document.getElementById('saveIndicator');
    if (!indicator) return;
    indicator.classList.add('show');
    setTimeout(() => { indicator.classList.remove('show'); }, 1000);
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
    if (eventCountElem) eventCountElem.textContent = String(state.getTotalEvents() || 0);
}

export function exportSessionData() {
    const sessionId = state.getSessionId();
    if (!sessionId) { alert('No active session to export. Start a session by connecting a Minecraft player first.'); return; }
    const exportButton = document.getElementById('exportButton') as HTMLButtonElement | null;
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
    const originalFileName = fileName_display ? fileName_display.textContent || '' : '';
    if (fileName_display) { fileName_display.textContent = '✓ Exported'; fileName_display.style.color = '#4CAF50'; }
    setTimeout(() => { if (fileName_display) { fileName_display.textContent = originalFileName; fileName_display.style.color = ''; } }, 3000);
}

export function parseMarkdownToHTML(text: string) {
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
        if (para.includes('<h') || para.includes('<ul') || para.includes('<ol')) return para;
        return '<p>' + para + '</p>';
    }).join('\n');
    html = html.replace(/\n/g, '<br>');
    return html;
}

export function displayAnalysisResults(data: any) {
    console.log('displayAnalysisResults invoked', { hasAnalyses: !!(data && data.analyses), analysesKeys: data && data.analyses ? Object.keys(data.analyses) : null });
    const button = document.getElementById('assessmentButton') as HTMLButtonElement | null;
    const contentDiv = document.getElementById('assessmentContent');
    const resultsDiv = document.getElementById('assessmentResults');
    const backdrop = document.getElementById('assessmentBackdrop');
    if (button) { button.disabled = false; button.textContent = 'Analyze Players with AI'; }

    try { if (resultsDiv) { resultsDiv.style.display = 'block'; resultsDiv.classList.add('show'); } if (backdrop) backdrop.classList.add('show'); } catch (e) { console.error('Failed to show assessment modal elements', e); }

    if (data.error) { if (contentDiv) contentDiv.innerHTML = `<div style="color: #f44336;">Error: ${data.error}</div>`; return; }

    if (!data.analyses || Object.keys(data.analyses).length === 0) {
        if (contentDiv) contentDiv.innerHTML = '<p>No player data available for analysis.</p>';
        if (resultsDiv) { resultsDiv.style.display = 'block'; resultsDiv.classList.add('show'); }
        return;
    }

    let html = `
        <div style="text-align: center; margin-bottom: 20px;">
            <button id="downloadAssessmentBtn" class="download-assessment-btn">Download as Word Document</button>
        </div>
    `;

    try {
        for (const [player, analysis] of Object.entries(data.analyses)) {
            let parsedContent = '';
            try { parsedContent = parseMarkdownToHTML(String(analysis || '')); } catch (parseErr) { console.error('Markdown parsing failed for player', player, parseErr); parsedContent = `<div style="color: #f44336;">(Failed to parse analysis content for ${player})</div>`; }
            html += `\n            <div class="assessment-player">\n                <h3>${player}</h3>\n                <div class="assessment-content">${parsedContent}</div>\n            </div>\n        `;
        }
    } catch (e) { console.error('Failed while building analysis HTML', e); if (contentDiv) contentDiv.innerHTML = `<div style="color: #f44336;">Error rendering analysis results: ${e.message || e}</div>`; return; }

    if (contentDiv) {
        contentDiv.innerHTML = html;
        const dl = document.getElementById('downloadAssessmentBtn'); if (dl) dl.addEventListener('click', downloadAssessment);
    }
}

export function downloadAssessment() {
    const button = document.getElementById('downloadAssessmentBtn') as HTMLButtonElement | null;
    if (!button) return;
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Generating Document...';

    const link = document.createElement('a');
    link.href = '/api/download-assessment'; link.style.display = 'none'; document.body.appendChild(link);

    link.onclick = function() { setTimeout(() => { button.disabled = false; button.innerHTML = originalText; document.body.removeChild(link); }, 1000); };
    link.click();
}

export async function openRubricEditor() {
    const modal = document.getElementById('rubricEditor');
    const textarea = document.getElementById('rubricContent') as HTMLTextAreaElement | null;
    if (modal) modal.style.display = 'block';
    try {
        const response = await fetch('/api/rubric');
        const data = await response.json();
        if (textarea) { textarea.value = data.content || ''; textarea.disabled = false; }
    } catch (error) { if (textarea) { textarea.value = 'Error loading rubric: ' + (error as Error).message; textarea.disabled = true; } }
}

export function closeRubricEditor() { const modal = document.getElementById('rubricEditor'); if (modal) modal.style.display = 'none'; }

export async function saveRubric() {
    const textarea = document.getElementById('rubricContent') as HTMLTextAreaElement | null;
    const saveButton = document.querySelector('.save-button') as HTMLButtonElement | null;
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving...'; }
    try {
        const response = await fetch('/api/rubric', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: textarea ? textarea.value : '' }) });
        if (response.ok) {
            if (events && typeof (events as any).addEventToLog === 'function') (events as any).addEventToLog('<span style="color: #4CAF50;">✓</span> Rubric saved successfully');
            if (typeof closeRubricEditor === 'function') closeRubricEditor();
        } else { throw new Error('Failed to save rubric'); }
    } catch (error) { alert('Error saving rubric: ' + (error as Error).message); } finally { if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Changes'; } }
}

export async function analyzeWithChatGPT() {
    const button = document.getElementById('assessmentButton') as HTMLButtonElement | null;
    const resultsDiv = document.getElementById('assessmentResults');
    const contentDiv = document.getElementById('assessmentContent');
    const backdrop = document.getElementById('assessmentBackdrop');
    if (button) { button.disabled = true; button.textContent = 'Analyzing...'; }
    if (backdrop) backdrop.classList.add('show');
    if (resultsDiv) { resultsDiv.style.display = 'block'; resultsDiv.classList.add('show'); }
    if (contentDiv) contentDiv.innerHTML = '<div class="loading-spinner"></div><p style="text-align:center;">Analyzing player data with AI...</p>';

    console.log('analyzeWithChatGPT: websocket object', websocket, 'isOpen?', (websocket && (websocket as any).isOpen && (websocket as any).isOpen()));

    try {
        if (websocket && (websocket as any).isOpen && (websocket as any).isOpen()) {
            websocket.send({ type: 'analyze_request' });
        } else { throw new Error('WebSocket not connected'); }
    } catch (error) {
        if (contentDiv) contentDiv.innerHTML = `<div style="color: #f44336;">Error: ${(error as Error).message}</div>`;
        if (button) { button.disabled = false; button.textContent = 'Analyze Players with AI'; }
    }
}

export function sendGameCommand(command: string, isPlayerSpecific = false) {
    const targetModeRadio = document.querySelector('input[name="targetPlayers"]:checked') as HTMLInputElement | null;
    const targetMode = targetModeRadio ? targetModeRadio.value : 'all';
    let targetPlayers: string[] = [];
    if (targetMode === 'selected') {
        const checkboxes = document.querySelectorAll('#playerSelectionList input[type="checkbox"]:checked');
        targetPlayers = Array.from(checkboxes).map((cb: any) => cb.value);
        if (targetPlayers.length === 0) { alert('Please select at least one player'); return; }
    }

    const payload = { type: 'game_command', command, targetMode, targetPlayers, playerSpecific: !!isPlayerSpecific };
    try {
        if (websocket && (websocket as any).isOpen && (websocket as any).isOpen()) {
            websocket.send(payload);
            if (events && typeof (events as any).addEventToLog === 'function') (events as any).addEventToLog(`<span style="color: #2196F3;">🕹️</span> Sent command: ${command}`);
        } else { alert('WebSocket not connected. Cannot send command.'); }
    } catch (e) { console.error('sendGameCommand failed', e); }
}

export function openGameControls() {
    const modal = document.getElementById('gameControlsModal'); if (modal) modal.style.display = 'block'; updatePlayerSelectionList(); const allRadio = document.querySelector('input[name="targetPlayers"][value="all"]') as HTMLInputElement | null; if (allRadio) allRadio.checked = true; const list = document.getElementById('playerSelectionList'); if (list) list.style.display = 'none'; }

export function closeGameControls() { const modal = document.getElementById('gameControlsModal'); if (modal) modal.style.display = 'none'; }

export function updatePlayerSelectionList() {
    const listDiv = document.getElementById('playerSelectionList'); if (!listDiv) return;
    listDiv.innerHTML = '';
    const playersMap = (players && (players as any).players) ? (players as any).players : null;
    if (!playersMap || playersMap.size === 0) { listDiv.innerHTML = '<div style="color: #999; font-size: 13px;">No players connected</div>'; return; }
    playersMap.forEach((player: any, playerId: string) => { const label = document.createElement('label'); label.className = 'player-checkbox'; label.innerHTML = `<input type="checkbox" value="${playerId}" checked><span style="background-color: ${player.color}"></span>${player.name}`; listDiv.appendChild(label); });
}

export function clearSessionData() {
    if (!confirm('Are you sure you want to clear the current session data? This will start a new recording session.')) return;
    try {
        if (websocket && (websocket as any).isOpen && (websocket as any).isOpen()) {
            websocket.send({ type: 'clear_session' });
            try { if (players && typeof (players as any).clearPlayers === 'function') (players as any).clearPlayers(); } catch (e) {}
            try { if (events && typeof (events as any).clearBlocks === 'function') (events as any).clearBlocks(); } catch (e) {}
            try { if (chunks && typeof (chunks as any).clearAllChunkMeshes === 'function') (chunks as any).clearAllChunkMeshes(getScene()); } catch (e) {}
            try {
                const scene = getScene();
                if (scene) {
                    scene.children = scene.children.filter((child: any) => {
                        if (child.userData && (child.userData.isPlayer || child.userData.isPath || child.userData.isBlock || child.userData.isChunk)) {
                            return false;
                        }
                        return true;
                    });
                }
            } catch (e) {}
            try { const ev = document.getElementById('eventList'); if (ev) ev.innerHTML=''; } catch (e) {}
            try { const pc = document.getElementById('playerCount'); if (pc) pc.textContent='0'; } catch (e) {}
            try { const ec = document.getElementById('eventCount'); if (ec) ec.textContent='0'; } catch (e) {}
            const indicator = document.getElementById('saveIndicator'); if (indicator) { indicator.textContent='🔄 Session Cleared'; indicator.style.display='block'; setTimeout(()=>{ indicator.style.display='none'; },2000); }
        } else { alert('WebSocket is not connected. Cannot clear session.'); }
    } catch (e) { console.error('clearSessionData failed', e); }
}

export function closeAssessment() {
    try {
        const resultsDiv = document.getElementById('assessmentResults');
        const backdrop = document.getElementById('assessmentBackdrop');
        const button = document.getElementById('assessmentButton') as HTMLButtonElement | null;
        if (resultsDiv) { resultsDiv.style.display = 'none'; resultsDiv.classList.remove('show'); }
        if (backdrop) backdrop.classList.remove('show');
        if (button) { button.disabled = false; button.textContent = 'Analyze Players with AI'; }
    } catch (e) { console.error('closeAssessment failed', e); }
}

export function wireDomHandlers() {
    try {
        console.log('ui.wireDomHandlers: registering DOM handlers and subscriptions');
        const clearPathBtn = document.getElementById('clearPathBtn'); if (clearPathBtn) clearPathBtn.addEventListener('click', () => { try { if (window && (window as any).players && typeof (window as any).players.clearPath === 'function') (window as any).players.clearPath(); } catch (e) {} });
        const clearBlocksBtn = document.getElementById('clearBlocksBtn'); if (clearBlocksBtn) clearBlocksBtn.addEventListener('click', () => { try { if (window && (window as any).events && typeof (window as any).events.clearBlocks === 'function') (window as any).events.clearBlocks(); } catch (e) {} });
        const assessmentBtn = document.getElementById('assessmentButton'); if (assessmentBtn) assessmentBtn.addEventListener('click', analyzeWithChatGPT);
        const closeAssessmentBtn = document.getElementById('closeAssessmentBtn'); if (closeAssessmentBtn) closeAssessmentBtn.addEventListener('click', closeAssessment);
        const assessmentBackdrop = document.getElementById('assessmentBackdrop'); if (assessmentBackdrop) assessmentBackdrop.addEventListener('click', closeAssessment);
        const editRubricBtn = document.getElementById('editRubricButton'); if (editRubricBtn) editRubricBtn.addEventListener('click', openRubricEditor);
        const gameControlsBtn = document.getElementById('gameControlsButton'); if (gameControlsBtn) gameControlsBtn.addEventListener('click', openGameControls);
        const sendMsgBtn = document.getElementById('sendMessageButton'); if (sendMsgBtn) { sendMsgBtn.addEventListener('click', () => { const input = document.getElementById('messageInput') as HTMLInputElement | null; if (!input) return; const msg = input.value.trim(); if (!msg) return; try { if (websocket && (websocket as any).isOpen && (websocket as any).isOpen()) { websocket.send({ type: 'send_message', message: msg }); input.value = ''; if (events && typeof (events as any).addEventToLog === 'function') (events as any).addEventToLog(`<span style="color: #2196F3;">📨</span> Message sent: "${msg}"`); } else { alert('WebSocket not connected. Cannot send message.'); } } catch (e) { console.error('send message failed', e); } }); }
        const exportBtn = document.getElementById('exportButton'); if (exportBtn) exportBtn.addEventListener('click', exportSessionData);
        const downloadBtn = document.getElementById('downloadAssessmentBtn'); if (downloadBtn) downloadBtn.addEventListener('click', downloadAssessment);
        const rubricSaveBtn = document.querySelector('.save-button') as HTMLButtonElement | null; if (rubricSaveBtn) rubricSaveBtn.addEventListener('click', () => { try { saveRubric(); } catch (e) { console.error('saveRubric handler error', e); } });
        try { if (events && typeof (events as any).onSessionUpdated === 'function') (events as any).onSessionUpdated(updateSessionInfo); } catch (e) {}
        try { if (events && typeof (events as any).onSaveNotification === 'function') (events as any).onSaveNotification(showSaveIndicator); } catch (e) {}
        try { if (events && typeof (events as any).onAnalysisResult === 'function') (events as any).onAnalysisResult(displayAnalysisResults); } catch (e) {}
        try { if (players && typeof (players as any).onPlayersChanged === 'function') (players as any).onPlayersChanged(() => { try { (players as any).updatePlayerCount(); (players as any).updatePlayerList(); updatePlayerSelectionList(); } catch (e) {} }); } catch (e) {}
        window.addEventListener('resize', () => { try { const rend = getScene() && getScene().renderer; if (rend && rend.setSize) rend.setSize(window.innerWidth, window.innerHeight); } catch (e) {} });
    } catch (e) { console.error('ui.wireDomHandlers failed', e); }
}

export {};
