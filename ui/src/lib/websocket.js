import * as players from './players'

let ws = null

export function connect(host = (window && window.WS_CONFIG && window.WS_CONFIG.host) ? window.WS_CONFIG.host : 'localhost', port = (window && window.WS_CONFIG && window.WS_CONFIG.port) ? window.WS_CONFIG.port : 8081, path = 'live') {
  const wsUrl = `ws://${host}:${port}/${path}`
  ws = new WebSocket(wsUrl)

  ws.onopen = () => { console.log('WS connected to', wsUrl) }
  ws.onmessage = (ev) => {
    let data
    try { data = JSON.parse(ev.data) } catch (e) { console.error('bad ws json', e); return }
    switch (data.type) {
      case 'player_join': try { players.createPlayer(data.playerId, data.playerName) } catch (e) {} break
      case 'position': try { players.updatePlayer(data.playerId, data.playerName, data.x, data.y, data.z, false) } catch (e) {} break
      case 'disconnect': try { players.removePlayer(data.playerId) } catch (e) {} break
      case 'block_place': /* pass for now */ break
      default: break
    }
  }
  ws.onclose = () => { console.log('WS closed, retry in 2s'); setTimeout(() => connect(host, port, path), 2000) }
  ws.onerror = (err) => { console.error('WS error', err) }
}

export function disconnect() { try { if (ws) ws.close(); ws = null } catch (e) {} }

export function send(obj) { try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)) } catch (e) {} }
