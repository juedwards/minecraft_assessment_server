const clients = new Map();

function updateUI() {
  document.getElementById('playerCount').textContent = String(clients.size);
  const sel = document.getElementById('clientSelect'); sel.innerHTML = '';
  const list = document.getElementById('clientList'); list.innerHTML = '';
  for (const [id] of clients.entries()) {
    const opt = document.createElement('option'); opt.value = id; opt.textContent = id; sel.appendChild(opt);
    const div = document.createElement('div'); div.textContent = `Client ${id}`; list.appendChild(div);
  }
}

window.electronAPI.onClientConnected(({ id }) => {
  clients.set(id, true);
  document.getElementById('status').textContent = 'Client connected';
  updateUI();
});

window.electronAPI.onClientDisconnected(({ id }) => {
  clients.delete(id);
  document.getElementById('status').textContent = 'Client disconnected';
  updateUI();
});

window.electronAPI.onClientMessage(({ id, data }) => {
  const list = document.getElementById('clientList');
  const p = document.createElement('div');
  p.textContent = `${id}: ${JSON.stringify(data)}`;
  list.appendChild(p);
});

document.getElementById('sendBtn').addEventListener('click', async () => {
  const id = Number(document.getElementById('clientSelect').value);
  let payload = document.getElementById('cmdInput').value;
  try { payload = JSON.parse(payload); } catch (e) { alert('invalid json'); return }
  await window.electronAPI.sendToClient(id, payload);
});

document.getElementById('broadcastBtn').addEventListener('click', async () => {
  let payload = document.getElementById('cmdInput').value;
  try { payload = JSON.parse(payload); } catch (e) { alert('invalid json'); return }
  await window.electronAPI.broadcast(payload);
});

updateUI();
