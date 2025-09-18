import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

let _scene = null
let _camera = null
let _renderer = null
let _controls = null
let _groundMesh = null
let _gridHelper = null
let _axesHelper = null

export function createScene(options = {}) {
  const { showDefaultGround = false, showGrid = false, showAxes = true, container = null } = options
  if (_scene) {
    if (showDefaultGround && !_groundMesh) _createDefaultGround()
    if (showGrid && !_gridHelper) _createGridHelper()
    if (showAxes && !_axesHelper) { _axesHelper = new THREE.AxesHelper(5); _scene.add(_axesHelper) }
    return { scene: _scene, camera: _camera, renderer: _renderer, controls: _controls, groundMesh: _groundMesh, gridHelper: _gridHelper, axesHelper: _axesHelper }
  }

  _scene = new THREE.Scene()
  _scene.background = new THREE.Color(0x87CEEB)
  _scene.fog = new THREE.Fog(0x87CEEB, 200, 500)

  _camera = new THREE.PerspectiveCamera(75, (container ? container.clientWidth : window.innerWidth) / (container ? container.clientHeight : window.innerHeight), 0.1, 1000)
  _camera.position.set(30, 50, 30)
  _camera.lookAt(0,0,0)

  _renderer = new THREE.WebGLRenderer({ antialias: true })
  _renderer.setSize(container ? container.clientWidth : window.innerWidth, container ? container.clientHeight : window.innerHeight)
  _renderer.shadowMap.enabled = true

  _controls = new OrbitControls(_camera, _renderer.domElement)
  _controls.enableDamping = true
  _controls.dampingFactor = 0.05
  _controls.target.set(0,0,0)

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  _scene.add(ambientLight)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(50, 100, 50)
  directionalLight.castShadow = true
  _scene.add(directionalLight)

  if (showDefaultGround) _createDefaultGround()
  if (showGrid) _createGridHelper()
  if (showAxes) {
    _axesHelper = new THREE.AxesHelper(5)
    _scene.add(_axesHelper)
  }

  // Attach renderer to provided container or to document.body as fallback
  if (container && container.appendChild) {
    container.appendChild(_renderer.domElement)
  } else {
    document.body.appendChild(_renderer.domElement)
  }

  // Update size on resize
  window.addEventListener('resize', () => {
    try {
      const w = container ? container.clientWidth : window.innerWidth
      const h = container ? container.clientHeight : window.innerHeight
      _camera.aspect = w / h
      _camera.updateProjectionMatrix()
      _renderer.setSize(w, h)
    } catch (e) {}
  })

  return { scene: _scene, camera: _camera, renderer: _renderer, controls: _controls, groundMesh: _groundMesh, gridHelper: _gridHelper, axesHelper: _axesHelper }
}

function _createDefaultGround() {
  if (!_scene || _groundMesh) return
  const groundGeometry = new THREE.PlaneGeometry(200, 200)
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x7CFC00, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
  _groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
  _groundMesh.rotation.x = -Math.PI / 2
  _groundMesh.receiveShadow = true
  _scene.add(_groundMesh)
}

function _createGridHelper() {
  if (!_scene || _gridHelper) return
  _gridHelper = new THREE.GridHelper(200, 40, 0x000000, 0x000000)
  _gridHelper.material.opacity = 0.2
  _gridHelper.material.transparent = true
  _scene.add(_gridHelper)
}

export function getScene() { return _scene }
export function getCamera() { return _camera }
export function getRenderer() { return _renderer }
export function getControls() { return _controls }
export function getGroundMesh() { return _groundMesh }
export function getGridHelper() { return _gridHelper }
export function getAxesHelper() { return _axesHelper }
