// Project Golem - Three.js Visualization
// Neural memory cortex visualization with WebGL

let scene, camera, renderer, controls;
let nodes = [];
let edges = [];
let nodeObjects = [];
let edgeObjects = [];
let highlightedNodes = new Set();
let cortexData = null;

// Category colors
const categoryColors = {
    'default': 0x00ff00,
    'documentation': 0x0088ff,
    'code': 0xff8800,
    'notes': 0xff00ff,
    'research': 0x00ffff
};

// Animation state
let frameCount = 0;
const clock = new THREE.Clock();

// Initialize scene
function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 10, 50);

    // Create camera
    const container = document.getElementById('canvas-container');
    camera = new THREE.PerspectiveCamera(
        75,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
    );
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Add orbit controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 30;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0x404040, 1);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00ff00, 1, 100);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Setup search
    setupSearch();

    // Load cortex data
    loadCortex();
}

// Load cortex data from server
async function loadCortex() {
    try {
        const response = await fetch('/cortex');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        cortexData = await response.json();
        console.log('Cortex loaded:', cortexData.stats);

        // Update UI
        document.getElementById('node-count').textContent =
            `Nodes: ${cortexData.stats.total_nodes} | Edges: ${cortexData.stats.total_edges}`;

        // Build visualization
        buildCortex(cortexData);

        // Hide loading screen
        document.getElementById('loading').style.display = 'none';

        // Start animation
        animate();

    } catch (error) {
        console.error('Failed to load cortex:', error);
        showError(`Failed to load cortex: ${error.message}`);
    }
}

// Build 3D cortex from data
function buildCortex(data) {
    nodes = data.nodes;
    edges = data.edges;

    // Create node meshes
    const nodeGeometry = new THREE.SphereGeometry(0.05, 16, 16);

    nodes.forEach((node, index) => {
        const color = categoryColors[node.category] || categoryColors['default'];

        const nodeMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.3,
            metalness: 0.5,
            roughness: 0.5
        });

        const mesh = new THREE.Mesh(nodeGeometry, nodeMaterial);
        mesh.position.set(
            node.position[0],
            node.position[1],
            node.position[2]
        );

        // Store node data
        mesh.userData = {
            nodeIndex: index,
            id: node.id,
            content: node.content,
            full_content: node.full_content,
            category: node.category
        };

        scene.add(mesh);
        nodeObjects.push(mesh);
    });

    // Create edge lines
    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x444444,
        opacity: 0.3,
        transparent: true
    });

    edges.forEach(edge => {
        const sourcePos = nodes[edge.source].position;
        const targetPos = nodes[edge.target].position;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array([
            sourcePos[0], sourcePos[1], sourcePos[2],
            targetPos[0], targetPos[1], targetPos[2]
        ]);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const line = new THREE.Line(geometry, edgeMaterial);

        scene.add(line);
        edgeObjects.push(line);
    });

    console.log(`Built cortex: ${nodeObjects.length} nodes, ${edgeObjects.length} edges`);
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Update controls
    controls.update();

    // Pulse highlighted nodes
    const time = clock.getElapsedTime();
    highlightedNodes.forEach(index => {
        const node = nodeObjects[index];
        if (node) {
            const pulse = Math.sin(time * 3) * 0.5 + 1.0;
            node.material.emissiveIntensity = pulse;
            node.scale.set(1 + pulse * 0.3, 1 + pulse * 0.3, 1 + pulse * 0.3);
        }
    });

    // Render
    renderer.render(scene, camera);

    // Update FPS
    frameCount++;
    if (frameCount % 60 === 0) {
        const fps = Math.round(1 / clock.getDelta());
        document.getElementById('fps').textContent = `FPS: ${fps}`;
    }
}

// Handle window resize
function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// Setup search functionality
function setupSearch() {
    const searchBox = document.getElementById('search-box');

    searchBox.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const query = searchBox.value.trim();
            if (query) {
                await searchCortex(query);
            }
        }
    });
}

// Search cortex via API
async function searchCortex(query) {
    console.log('Searching for:', query);

    try {
        const response = await fetch(`/query?q=${encodeURIComponent(query)}&k=10`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Search results:', data.results.length);

        // Highlight matching nodes
        highlightSearchResults(data.results);

        // Show info panel
        displaySearchResults(data.results, query);

    } catch (error) {
        console.error('Search failed:', error);
        showError(`Search failed: ${error.message}`);
    }
}

// Highlight nodes in search results
function highlightSearchResults(results) {
    // Clear previous highlights
    clearHighlights();

    // Highlight new results
    results.forEach(result => {
        // Find node by id
        const nodeIndex = nodes.findIndex(n => n.id === result.id);
        if (nodeIndex !== -1) {
            highlightedNodes.add(nodeIndex);

            // Update node appearance
            const node = nodeObjects[nodeIndex];
            node.material.emissive.setHex(0x00ffff);
            node.material.emissiveIntensity = 1.5;
        }
    });
}

// Clear all highlights
function clearHighlights() {
    highlightedNodes.forEach(index => {
        const node = nodeObjects[index];
        if (node) {
            const color = categoryColors[node.userData.category] || categoryColors['default'];
            node.material.emissive.setHex(color);
            node.material.emissiveIntensity = 0.3;
            node.scale.set(1, 1, 1);
        }
    });
    highlightedNodes.clear();
}

// Display search results in info panel
function displaySearchResults(results, query) {
    const infoPanel = document.getElementById('info-panel');
    const infoContent = document.getElementById('info-content');

    if (results.length === 0) {
        infoContent.innerHTML = `
            <h4>Query: "${query}"</h4>
            <p>No results found.</p>
        `;
    } else {
        let html = `<h4>Query: "${query}"</h4>`;
        html += `<p><strong>${results.length} matches</strong></p>`;
        html += '<hr style="border-color: #0f0; margin: 10px 0;">';

        results.slice(0, 5).forEach((result, i) => {
            const similarity = (result.similarity * 100).toFixed(1);
            const preview = result.content.substring(0, 100) + '...';
            html += `
                <div style="margin-bottom: 10px;">
                    <strong>#${i + 1}</strong> (${similarity}% match)<br>
                    <small>${preview}</small>
                </div>
            `;
        });

        infoContent.innerHTML = html;
    }

    infoPanel.classList.add('visible');

    // Auto-hide after 10 seconds
    setTimeout(() => {
        infoPanel.classList.remove('visible');
    }, 10000);
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');

    errorText.textContent = message;
    errorDiv.classList.add('visible');

    // Hide loading screen
    document.getElementById('loading').style.display = 'none';

    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorDiv.classList.remove('visible');
    }, 5000);
}

// OrbitControls implementation (inlined for simplicity)
THREE.OrbitControls = function(camera, domElement) {
    this.enabled = true;
    this.enableDamping = false;
    this.dampingFactor = 0.05;
    this.minDistance = 0;
    this.maxDistance = Infinity;
    this.enableZoom = true;
    this.enableRotate = true;
    this.enablePan = true;

    const scope = this;
    const spherical = new THREE.Spherical();
    const sphericalDelta = new THREE.Spherical();
    const panOffset = new THREE.Vector3();
    let scale = 1;
    const rotateStart = new THREE.Vector2();
    const rotateEnd = new THREE.Vector2();
    const rotateDelta = new THREE.Vector2();
    const panStart = new THREE.Vector2();
    const panEnd = new THREE.Vector2();
    const panDelta = new THREE.Vector2();

    const STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_PAN: 4, TOUCH_DOLLY_PAN: 5 };
    let state = STATE.NONE;

    function onMouseDown(event) {
        if (!scope.enabled) return;
        event.preventDefault();

        if (event.button === 0) {
            state = STATE.ROTATE;
            rotateStart.set(event.clientX, event.clientY);
        } else if (event.button === 2) {
            state = STATE.PAN;
            panStart.set(event.clientX, event.clientY);
        }

        document.addEventListener('mousemove', onMouseMove, false);
        document.addEventListener('mouseup', onMouseUp, false);
    }

    function onMouseMove(event) {
        if (!scope.enabled) return;
        event.preventDefault();

        if (state === STATE.ROTATE) {
            rotateEnd.set(event.clientX, event.clientY);
            rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(0.005);
            sphericalDelta.theta -= rotateDelta.x;
            sphericalDelta.phi -= rotateDelta.y;
            rotateStart.copy(rotateEnd);
        } else if (state === STATE.PAN) {
            panEnd.set(event.clientX, event.clientY);
            panDelta.subVectors(panEnd, panStart).multiplyScalar(0.01);
            pan(panDelta.x, panDelta.y);
            panStart.copy(panEnd);
        }
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove, false);
        document.removeEventListener('mouseup', onMouseUp, false);
        state = STATE.NONE;
    }

    function onMouseWheel(event) {
        if (!scope.enabled || !scope.enableZoom) return;
        event.preventDefault();
        const delta = event.deltaY;
        if (delta < 0) scale /= 0.95;
        else scale *= 0.95;
    }

    function pan(deltaX, deltaY) {
        const offset = new THREE.Vector3();
        offset.copy(camera.position).sub(camera.target || new THREE.Vector3(0, 0, 0));
        const targetDistance = offset.length();

        offset.x -= deltaX * targetDistance;
        offset.y += deltaY * targetDistance;

        panOffset.copy(offset);
    }

    this.update = function() {
        const offset = new THREE.Vector3();
        const target = camera.target || new THREE.Vector3(0, 0, 0);

        offset.copy(camera.position).sub(target);

        spherical.setFromVector3(offset);
        spherical.theta += sphericalDelta.theta;
        spherical.phi += sphericalDelta.phi;
        spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi));
        spherical.radius *= scale;
        spherical.radius = Math.max(scope.minDistance, Math.min(scope.maxDistance, spherical.radius));

        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset).add(panOffset);
        camera.lookAt(target);

        if (scope.enableDamping) {
            sphericalDelta.theta *= (1 - scope.dampingFactor);
            sphericalDelta.phi *= (1 - scope.dampingFactor);
        } else {
            sphericalDelta.set(0, 0, 0);
        }

        scale = 1;
        panOffset.set(0, 0, 0);
    };

    domElement.addEventListener('mousedown', onMouseDown, false);
    domElement.addEventListener('wheel', onMouseWheel, false);
    domElement.addEventListener('contextmenu', (e) => e.preventDefault(), false);
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
