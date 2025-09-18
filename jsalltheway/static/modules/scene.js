// scene.js
// Responsibilities:
// - Create and configure the Three.js scene, camera, renderer, and controls
// - Provide getters for other modules to access scene/camera/controls

let _scene = null;
let _camera = null;
let _renderer = null;
let _controls = null;
let _groundMesh = null;
let _gridHelper = null;
let _axesHelper = null;

export function createScene(options = {}) {
    // Options allow consumers to opt into the legacy helpers if needed.
    const { showDefaultGround = false, showGrid = false, showAxes = true } = options;
    if (_scene) {
        // If the scene already exists, create any missing legacy helpers on demand.
        if (showDefaultGround && !_groundMesh) _createDefaultGround();
        if (showGrid && !_gridHelper) _createGridHelper();
        if (showAxes && !_axesHelper) {
            _axesHelper = new THREE.AxesHelper(5);
            _scene.add(_axesHelper);
        }
        return { scene: _scene, camera: _camera, renderer: _renderer, controls: _controls, groundMesh: _groundMesh, gridHelper: _gridHelper, axesHelper: _axesHelper };
    }

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x87CEEB);
    _scene.fog = new THREE.Fog(0x87CEEB, 200, 500);

    _camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    _camera.position.set(30, 50, 30);
    _camera.lookAt(0, 0, 0);

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setSize(window.innerWidth, window.innerHeight);
    _renderer.shadowMap.enabled = true;
    document.body.appendChild(_renderer.domElement);

    _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
    _controls.enableDamping = true;
    _controls.dampingFactor = 0.05;
    _controls.target.set(0, 0, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    _scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    _scene.add(directionalLight);

    // Legacy: default ground. Create only if consumer requests it (see options).
    if (showDefaultGround) {
        _createDefaultGround();
    }

    // Legacy: grid helper. Create only if consumer requests it (see options).
    if (showGrid) {
        _createGridHelper();
    }

    return { scene: _scene, camera: _camera, renderer: _renderer, controls: _controls, groundMesh: _groundMesh, gridHelper: _gridHelper, axesHelper: _axesHelper };
}

// Helper to create the legacy default ground (kept for backwards compatibility).
function _createDefaultGround() {
    if (!_scene || _groundMesh) return;
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshLambertMaterial({
        color: 0x7CFC00,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
    });
    _groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    _groundMesh.rotation.x = -Math.PI / 2;
    _groundMesh.receiveShadow = true;
    _scene.add(_groundMesh);
}

// Helper to create the legacy grid helper.
function _createGridHelper() {
    if (!_scene || !_gridHelper) return;
    _gridHelper = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
    _gridHelper.material.opacity = 0.2;
    _gridHelper.material.transparent = true;
    _scene.add(_gridHelper);
}

// Safe material disposer covering common texture slots.
function _disposeMaterial(mat) {
    if (!mat) return;
    [
        'map', 'lightMap', 'aoMap', 'emissiveMap', 'bumpMap', 'normalMap', 'specularMap', 'alphaMap'
    ].forEach(slot => {
        if (mat[slot]) {
            try { mat[slot].dispose(); } catch (e) { /* ignore */ }
        }
    });
    try { mat.dispose(); } catch (e) { /* ignore */ }
}

// Public cleanup APIs — useful when you replace the legacy helpers with chunk-based geometry.
export function removeDefaultGround() {
    if (!_scene || !_groundMesh) return;
    _scene.remove(_groundMesh);
    if (_groundMesh.geometry) _groundMesh.geometry.dispose();
    if (Array.isArray(_groundMesh.material)) {
        _groundMesh.material.forEach(m => _disposeMaterial(m));
    } else {
        _disposeMaterial(_groundMesh.material);
    }
    _groundMesh = null;
}

export function removeGridHelper() {
    if (!_scene || !_gridHelper) return;
    _scene.remove(_gridHelper);
    if (_gridHelper.geometry) _gridHelper.geometry.dispose();
    if (_gridHelper.material) _disposeMaterial(_gridHelper.material);
    _gridHelper = null;
}

export function getScene() { return _scene; }
export function getCamera() { return _camera; }
export function getRenderer() { return _renderer; }
export function getControls() { return _controls; }
export function getGroundMesh() { return _groundMesh; }
export function getGridHelper() { return _gridHelper; }
export function getAxesHelper() { return _axesHelper; }
