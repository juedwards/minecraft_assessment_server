import * as THREE from 'three'
import { getScene, getCamera, getControls } from './scene'
import * as utils from '../../static/modules/utils.js' // reuse existing helper (if compatible)

export const players = new Map()
const playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F']
let colorIndex = 0
let firstPlayerPositioned = false

const _playerChangeHandlers = []
export function onPlayersChanged(cb) { if (typeof cb === 'function') _playerChangeHandlers.push(cb) }
function triggerPlayersChanged() { _playerChangeHandlers.forEach(h => { try { h() } catch (e) {} }) }

export function createPlayer(playerId, playerName) {
  const scene = getScene()
  if (!scene) { console.warn('createPlayer: scene not ready'); return }

  const geometry = new THREE.BoxGeometry(1,2,1)
  const color = playerColors[colorIndex % playerColors.length]
  const material = new THREE.MeshLambertMaterial({ color: color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.position.y = 1

  // label sprite omitted for brevity

  const pathGeometry = new THREE.BufferGeometry()
  const pathMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 2, opacity: 0.8, transparent: true })
  const pathLine = new THREE.Line(pathGeometry, pathMaterial)
  scene.add(pathLine)

  players.set(playerId, { mesh, targetPos: mesh.position.clone(), name: playerName || playerId, color, lastUpdate: Date.now(), path: [mesh.position.clone()], pathLine, maxPathPoints: 500 })
  scene.add(mesh)
  colorIndex++
  try { triggerPlayersChanged() } catch (e) {}
}

export function updatePlayer(playerId, playerName, x, y, z, alreadyWorld = false) {
  const scene = getScene(); if (!scene) return
  if (!players.has(playerId)) createPlayer(playerId, playerName)
  const player = players.get(playerId)

  let worldX, worldY, worldZ
  if (alreadyWorld) { worldX = x; worldY = y; worldZ = z } else { const p = utils.mcToThreeCoords(x,y,z); worldX = p.x; worldY = p.y; worldZ = p.z }

  let halfHeight = 1
  if (player.mesh && player.mesh.geometry && player.mesh.geometry.parameters && player.mesh.geometry.parameters.height) halfHeight = player.mesh.geometry.parameters.height / 2
  let meshCenterY = worldY + halfHeight

  player.targetPos.set(worldX, meshCenterY, worldZ)
  player.lastUpdate = Date.now()

  if (Number.isFinite(worldX) && Number.isFinite(meshCenterY) && Number.isFinite(worldZ)) {
    if (player.path.length === 0 || player.path[player.path.length - 1].distanceTo(player.targetPos) > 0.5) {
      player.path.push(new THREE.Vector3(worldX, meshCenterY, worldZ))
      if (player.path.length > player.maxPathPoints) player.path.shift()
      updatePathLine(player)
    }
  }

  try {
    if (!firstPlayerPositioned && players.size === 1) {
      firstPlayerPositioned = true
      const controls = getControls(); const camera = getCamera()
      if (controls && camera) {
        controls.target.copy(player.targetPos)
        const offset = new THREE.Vector3(20,30,20)
        const cameraPos = player.targetPos.clone().add(offset)
        camera.position.copy(cameraPos)
        controls.update()
      }
    }
  } catch (e) {}

  try { triggerPlayersChanged() } catch (e) {}
}

export function removePlayer(playerId) {
  const player = players.get(playerId)
  if (player) {
    if (player.mesh && player.mesh.parent) player.mesh.parent.remove(player.mesh)
    if (player.pathLine && player.pathLine.parent) player.pathLine.parent.remove(player.pathLine)
    players.delete(playerId)
    try { triggerPlayersChanged() } catch (e) {}
  }
}

export function updatePathLine(player) {
  try {
    if (!player.path || player.path.length === 0) { player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([],3)); return }
    const validPoints = player.path.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
    if (validPoints.length === 0) { player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([],3)); return }
    if (validPoints.length === 1) { const p = validPoints[0]; player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([p.x,p.y+0.1,p.z],3)); return }
    try {
      const curve = new THREE.CatmullRomCurve3(validPoints)
      const divisions = Math.min(Math.max(validPoints.length * 6, 16), 256)
      const sampled = curve.getPoints(divisions)
      const positions = []
      sampled.forEach(pt => positions.push(pt.x, pt.y + 0.1, pt.z))
      player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    } catch (e) { const positions = []; validPoints.forEach(point => positions.push(point.x, point.y + 0.1, point.z)); player.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3)) }
  } catch (e) {}
}

export function updatePlayerCount() { /* UI-driven, React will read players.size */ }
export function updatePlayerList() { /* React renders list */ }
export function clearPath() { players.forEach(p => { p.path = []; updatePathLine(p) }) }
export function clearPlayers() { players.forEach(p => { if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh); if (p.pathLine && p.pathLine.parent) p.pathLine.parent.remove(p.pathLine) }); players.clear(); }
