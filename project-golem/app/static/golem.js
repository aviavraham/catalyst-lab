// Project Golem - Three.js Visualization
// Neural memory cortex visualization with WebGL

let scene, camera, renderer, controls, composer;
let nodes = [];
let edges = [];
let nodeObjects = [];
let edgeObjects = [];

// Camera dynamics (mimicking reference GIF)
let cameraTarget = new THREE.Vector3(0, 0, 0);
let clusterRadius = 5;
const lookSensitivity = 0.05;
const noiseScale = 0.3;
const baseFOV = 75;
let orbitAngle = 0;  // Current orbital position (radians)
const orbitSpeed = 0.03;  // Very slow counterclockwise orbit (radians per second, ~1.7°/sec)
let orbitDistance = 10;  // Distance from centroid (dynamic based on cluster size)
const orbitElevation = 0.4;  // Elevation angle (slightly above, in radians ~23 degrees)
let highlightedNodes = new Set();
let highlightedEdges = new Set();
let cortexData = null;
let traceSequence = [];  // Ordered sequence for trace propagation
let traceStartTime = 0;  // When the trace animation started
let cameraAnimating = false;
let cameraAnimationStart = 0;
let cameraHoldUntil = 0;  // Hold camera at zoomed position until this time
let cameraStartPos, cameraTargetPos, cameraStartTarget, cameraEndTarget;  // Initialized on first use
let autoRotateEnabled = true;  // Auto-rotate the cortex
let isLocalOrbit = false;  // Whether we're orbiting around query results
let localOrbitCenter = new THREE.Vector3(0, 0, 0);  // Center point for local orbit
let localOrbitDistance = 10;  // Distance for local orbit
let zoomOutStartTime = 0;  // When to start zooming out
let zoomOutDuration = 2.0;  // Duration of zoom-out transition in seconds
let userInteracting = false;  // Whether user is manually controlling the camera
let lastInteractionTime = 0;  // Last time user interacted
const interactionTimeout = 5.0;  // Resume auto-orbit after 5 seconds of inactivity

// Category colors - Wikipedia categories
const categoryColors = {
    'AI & Machine Learning': 0x00ffff,        // Bright cyan
    'Robotics & Automation': 0x4169e1,        // Royal blue
    'Quantum & Physics': 0x8b00ff,            // Violet
    'Neuroscience & Cognition': 0xff1493,     // Hot pink
    'Space & Astronomy': 0x1e3a8a,            // Midnight blue
    'Cryptography & Security': 0xff0000,      // Red
    'Renaissance & Art': 0xffd700,            // Gold
    'Biology & Genetics': 0x00ff00,           // Lime green
    'Computer Science': 0x0088ff,             // Electric blue
    'Mathematics': 0xff6600,                  // Orange
    'Philosophy & Logic': 0x9933ff,           // Purple
    'History': 0xd2691e,                      // Chocolate
    'Economics & Finance': 0x50c878,          // Emerald
    'Chemistry': 0x00ced1,                    // Aqua
    'Climate & Environment': 0x228b22,        // Forest green
    'Medicine & Healthcare': 0xdc143c,        // Crimson
    'Linguistics & Language': 0xffa500,       // Bright orange
    'Music & Acoustics': 0xff00ff,            // Magenta
    'Materials Science': 0x708090,            // Slate gray
    'Psychology & Behavior': 0xffc0cb,        // Pink
    'default': 0xffffff                       // White (fallback)
};

// Animation state
let frameCount = 0;
const clock = new THREE.Clock();

// Initialize scene
function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.015);  // Exponential fog for more atmospheric depth

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

    // Setup post-processing for bloom effect
    composer = new THREE.EffectComposer(renderer);
    const renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(container.clientWidth, container.clientHeight),
        0.9,  // strength - low so only bright highlighted nodes bloom intensely
        6.0,  // radius - extremely large to completely obscure sphere geometry
        0.4   // threshold - higher so only bright nodes bloom, keeping background dark
    );
    composer.addPass(bloomPass);

    // Add orbit controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 30;
    controls.autoRotate = false;  // Using custom dynamic orbital camera instead

    // Add lights - soft ambient for nebula effect
    const ambientLight = new THREE.AmbientLight(0x202020, 0.5);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x004400, 0.3, 100);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Track user interaction to pause auto-orbit
    setupInteractionDetection();

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

        // Update context count
        document.getElementById('context-count').textContent = cortexData.stats.total_nodes;

        // Build visualization
        buildCortex(cortexData);

        // Build category legend
        buildLegend(cortexData.stats.categories);

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

    // Create node meshes - tiny points, bloom creates massive glowing orbs
    const nodeGeometry = new THREE.SphereGeometry(0.02, 8, 8);

    nodes.forEach((node, index) => {
        const color = categoryColors[node.category] || categoryColors['default'];

        const nodeMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.3,  // Very low intensity - dark background, only highlighted nodes bloom
            metalness: 0.2,
            roughness: 0.7,
            transparent: false
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

    // Create edge lines - each with individual material for highlighting
    edges.forEach(edge => {
        const sourcePos = nodes[edge.source].position;
        const targetPos = nodes[edge.target].position;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array([
            sourcePos[0], sourcePos[1], sourcePos[2],
            targetPos[0], targetPos[1], targetPos[2]
        ]);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Individual material per edge for independent color control - subtle glow
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0x333333,
            opacity: 0.15,  // More transparent for ethereal effect
            transparent: true,
            linewidth: 1
        });

        const line = new THREE.Line(geometry, edgeMaterial);

        // Store edge metadata
        line.userData = {
            source: edge.source,
            target: edge.target,
            edgeIndex: edgeObjects.length
        };

        scene.add(line);
        edgeObjects.push(line);
    });

    console.log(`Built cortex: ${nodeObjects.length} nodes, ${edgeObjects.length} edges`);
}

// Build category legend
function buildLegend(categories) {
    const legendContainer = document.getElementById('legend-items');
    legendContainer.innerHTML = '';

    // Sort categories alphabetically, but put 'default' last
    const sortedCategories = categories.sort((a, b) => {
        if (a === 'default') return 1;
        if (b === 'default') return -1;
        return a.localeCompare(b);
    });

    sortedCategories.forEach(category => {
        const color = categoryColors[category] || categoryColors['default'];
        const hexColor = '#' + color.toString(16).padStart(6, '0');

        const item = document.createElement('div');
        item.className = 'legend-item';

        const colorBox = document.createElement('div');
        colorBox.className = 'legend-color';
        colorBox.style.backgroundColor = hexColor;
        colorBox.style.color = hexColor;

        const label = document.createElement('span');
        label.textContent = category.toUpperCase();

        item.appendChild(colorBox);
        item.appendChild(label);
        legendContainer.appendChild(item);
    });

    console.log(`Legend built: ${sortedCategories.length} categories`);
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Animate trace propagation
    const time = clock.getElapsedTime();
    const deltaTime = 1 / 60;  // Assume 60fps for consistent orbital speed

    // Animate camera zoom if active
    if (cameraAnimating && cameraStartPos) {
        const animDuration = 1.5;  // 1.5 seconds
        const elapsed = time - cameraAnimationStart;
        const t = Math.min(elapsed / animDuration, 1.0);

        // Smooth easing (ease-in-out)
        const smoothT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        // Interpolate camera position
        camera.position.lerpVectors(cameraStartPos, cameraTargetPos, smoothT);

        // Interpolate orbit target
        const currentTarget = new THREE.Vector3();
        currentTarget.lerpVectors(cameraStartTarget, cameraEndTarget, smoothT);

        // Safely update controls target
        if (controls.target && typeof controls.target.copy === 'function') {
            controls.target.copy(currentTarget);
        }

        if (t >= 1.0) {
            cameraAnimating = false;
            // Hold the zoomed position for 8 seconds before resuming orbital camera
            cameraHoldUntil = time + 8.0;
            zoomOutStartTime = time + 8.0;  // Start zooming out after hold period

            // Enable local orbit mode around query results
            isLocalOrbit = true;
            localOrbitCenter.copy(cameraEndTarget);

            // Calculate current distance from camera to target
            const currentDistance = camera.position.distanceTo(cameraEndTarget);
            localOrbitDistance = Math.max(currentDistance, 3);  // Minimum distance of 3

            // Sync camera target to prevent jump when transitioning to orbit
            cameraTarget.copy(localOrbitCenter);

            // Calculate orbit angle from current camera position to ensure smooth continuation
            const offset = new THREE.Vector3().subVectors(camera.position, cameraTarget);
            orbitAngle = Math.atan2(offset.z, offset.x);
        }
    }

    // Check if user interaction has timed out
    if (userInteracting && time - lastInteractionTime > interactionTimeout) {
        userInteracting = false;
    }

    // Update camera with dynamic orbital movement (only when not animating and not under user control)
    if (!cameraAnimating && !userInteracting) {
        updateCameraDynamics(time, deltaTime);
    }

    // Update controls
    controls.update();

    // Animate nodes - sequential trace propagation like OpenTelemetry spans
    const timeSinceTraceStart = time - traceStartTime;

    traceSequence.forEach(({nodeIndex, delay}) => {
        const node = nodeObjects[nodeIndex];
        if (node && timeSinceTraceStart >= delay) {
            // Calculate time this specific node has been active
            const nodeActiveTime = timeSinceTraceStart - delay;

            // Pulse effect for this node (starts when its delay is reached)
            const nodePulse = Math.sin(nodeActiveTime * 3) * 0.5 + 1.0;

            // Fade in effect (0 to 1 over 0.3 seconds)
            const fadeIn = Math.min(nodeActiveTime / 0.3, 1.0);

            node.material.emissive.setHex(0x00ffff);
            node.material.emissiveIntensity = fadeIn * nodePulse * 45.0;  // Massive burst - pure glowing orb like reference image
            node.scale.set(1 + nodePulse * 0.5, 1 + nodePulse * 0.5, 1 + nodePulse * 0.5);
        } else if (node) {
            // Not yet active - keep at idle state
            const color = categoryColors[node.userData.category] || categoryColors['default'];
            node.material.emissive.setHex(color);
            node.material.emissiveIntensity = 0.3;
            node.scale.set(1, 1, 1);
        }
    });

    // Animate edges - propagating trace flow
    highlightedEdges.forEach(index => {
        const edge = edgeObjects[index];
        if (edge) {
            // Stagger edge activation based on index (like trace spans flowing through system)
            const edgeDelay = index * 0.05;  // Each edge starts slightly later
            const edgeActiveTime = Math.max(0, timeSinceTraceStart - edgeDelay);

            // Traveling wave effect along edge
            const flowPulse = Math.sin(time * 4 + index * 0.3) * 0.3 + 0.7;

            // Fade in over 0.2 seconds
            const fadeIn = Math.min(edgeActiveTime / 0.2, 1.0);

            edge.material.opacity = fadeIn * flowPulse;

            // Brighten color during pulse
            const brightness = Math.floor(255 * flowPulse);
            edge.material.color.setRGB(0, brightness / 255 * fadeIn, brightness / 255 * fadeIn);
        }
    });

    // Render with bloom post-processing
    composer.render();

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
    composer.setSize(container.clientWidth, container.clientHeight);
}

// Setup interaction detection to pause auto-orbit during manual control
function setupInteractionDetection() {
    const canvas = renderer.domElement;

    function onUserInteraction() {
        userInteracting = true;
        lastInteractionTime = clock.getElapsedTime();
    }

    // Mouse events
    canvas.addEventListener('mousedown', onUserInteraction, false);
    canvas.addEventListener('wheel', onUserInteraction, false);

    // Touch events
    canvas.addEventListener('touchstart', onUserInteraction, false);
    canvas.addEventListener('touchmove', onUserInteraction, false);
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

        // Show top match in header
        displaySearchResults(data.results);

    } catch (error) {
        console.error('Search failed:', error);
        showError(`Search failed: ${error.message}`);
    }
}

// Highlight nodes in search results - with trace-style sequential propagation
function highlightSearchResults(results) {
    // Clear previous highlights
    clearHighlights();

    // Build trace sequence - ordered by similarity (mimics trace execution order)
    traceSequence = [];
    const matchedIndices = [];

    results.forEach((result, i) => {
        // Find node by id
        const nodeIndex = nodes.findIndex(n => n.id === result.id);
        if (nodeIndex !== -1) {
            highlightedNodes.add(nodeIndex);
            matchedIndices.push(nodeIndex);

            // Store in sequence with timing offset
            traceSequence.push({
                nodeIndex: nodeIndex,
                delay: i * 0.15  // Stagger each result by 150ms (like spans executing)
            });
        }
    });

    // Start trace animation
    traceStartTime = clock.getElapsedTime();

    // Highlight edges between matched nodes
    highlightConnectingEdges(matchedIndices);

    // Zoom camera to highlighted region
    focusCameraOnResults(matchedIndices);
}

// Zoom camera to show search results
function focusCameraOnResults(matchedIndices) {
    if (matchedIndices.length === 0) return;

    // Initialize camera animation vectors on first use
    if (!cameraStartPos) {
        cameraStartPos = new THREE.Vector3();
        cameraTargetPos = new THREE.Vector3();
        cameraStartTarget = new THREE.Vector3();
        cameraEndTarget = new THREE.Vector3();
    }

    // Calculate bounding box of matched nodes
    const bounds = {
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minZ: Infinity, maxZ: -Infinity
    };

    matchedIndices.forEach(index => {
        const pos = nodes[index].position;
        bounds.minX = Math.min(bounds.minX, pos[0]);
        bounds.maxX = Math.max(bounds.maxX, pos[0]);
        bounds.minY = Math.min(bounds.minY, pos[1]);
        bounds.maxY = Math.max(bounds.maxY, pos[1]);
        bounds.minZ = Math.min(bounds.minZ, pos[2]);
        bounds.maxZ = Math.max(bounds.maxZ, pos[2]);
    });

    // Center of results
    const center = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2
    );

    // Size of cluster
    const size = Math.max(
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
        bounds.maxZ - bounds.minZ,
        2  // Minimum size to avoid zooming too close
    );

    // Calculate camera distance to fit all nodes
    const distance = Math.max(size * 2.5, 3);  // Minimum distance of 3

    // Camera offset from center - position for smooth orbit transition
    // Use current orbit angle to maintain continuity
    const currentAngle = orbitAngle;
    const offset = new THREE.Vector3(
        distance * Math.cos(currentAngle) * Math.cos(orbitElevation),
        distance * Math.sin(orbitElevation),
        distance * Math.sin(currentAngle) * Math.cos(orbitElevation)
    );

    // Save current state
    cameraStartPos.copy(camera.position);

    // Safely get current orbit target
    if (controls.target && typeof controls.target.x === 'number') {
        cameraStartTarget.copy(controls.target);
    } else {
        cameraStartTarget.set(0, 0, 0);
    }

    // Set target state
    cameraTargetPos.copy(center).add(offset);
    cameraEndTarget.copy(center);

    // Start animation
    cameraAnimating = true;
    cameraAnimationStart = clock.getElapsedTime();
}

// Highlight edges connecting matched nodes
function highlightConnectingEdges(matchedIndices) {
    const matchedSet = new Set(matchedIndices);

    edges.forEach((edge, edgeIndex) => {
        const sourceMatched = matchedSet.has(edge.source);
        const targetMatched = matchedSet.has(edge.target);

        // Highlight edges where both nodes are matched
        if (sourceMatched && targetMatched) {
            highlightedEdges.add(edgeIndex);
            const edgeLine = edgeObjects[edgeIndex];
            edgeLine.material.color.setHex(0x00ffff);  // Bright cyan
            edgeLine.material.opacity = 1.0;
            edgeLine.material.linewidth = 3;
        }
        // Also highlight edges where at least one node is matched (dimmer)
        else if (sourceMatched || targetMatched) {
            highlightedEdges.add(edgeIndex);
            const edgeLine = edgeObjects[edgeIndex];
            edgeLine.material.color.setHex(0x00aaaa);  // Medium cyan
            edgeLine.material.opacity = 0.7;
            edgeLine.material.linewidth = 2;
        }
    });
}

// Clear all highlights
function clearHighlights() {
    // Clear node highlights
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

    // Clear edge highlights
    highlightedEdges.forEach(index => {
        const edge = edgeObjects[index];
        if (edge) {
            edge.material.color.setHex(0x333333);
            edge.material.opacity = 0.15;
            edge.material.linewidth = 1;
        }
    });
    highlightedEdges.clear();

    // Clear trace sequence
    traceSequence = [];
    traceStartTime = 0;
}

// Display search results below search box
function displaySearchResults(results) {
    const searchResults = document.getElementById('search-results');

    if (results.length === 0) {
        searchResults.innerHTML = `<span style="color: #666;">> No matches found</span>`;
    } else {
        // Get the top match
        const topMatch = results[0];

        // Find the node to get its category
        const node = nodes.find(n => n.id === topMatch.id);
        const category = node ? node.category : 'Unknown';

        // Format: "> Top Match: [content preview] [category]"
        const preview = topMatch.content.substring(0, 60);
        searchResults.innerHTML = `<span id="top-match">> Top Match: ${preview} <span class="category-tag">[${category}]</span></span>`;
    }
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

// Simple Simplex-like noise for organic camera movement
function simplex2D(x, y) {
    // Simple pseudo-Perlin noise using sine waves
    const freq1 = Math.sin(x * 1.5 + y * 1.2) * Math.cos(y * 1.8 - x * 0.7);
    const freq2 = Math.sin(x * 2.3 - y * 1.9) * Math.cos(x * 1.4 + y * 2.1);
    const freq3 = Math.sin(x * 3.1 + y * 0.8) * Math.cos(y * 2.7 - x * 1.3);
    return (freq1 + freq2 * 0.5 + freq3 * 0.25) / 1.75;
}

// Calculate the centroid of the node cluster
function calculateClusterCentroid() {
    if (nodes.length === 0) return new THREE.Vector3(0, 0, 0);

    const centroid = new THREE.Vector3(0, 0, 0);
    let count = 0;

    for (const node of nodes) {
        centroid.add(new THREE.Vector3(node.position[0], node.position[1], node.position[2]));
        count++;
    }

    centroid.divideScalar(count);
    return centroid;
}

// Calculate cluster radius (for dynamic FOV)
function calculateClusterRadius() {
    if (nodes.length === 0) return 5;

    const centroid = calculateClusterCentroid();
    let maxDist = 0;

    for (const node of nodes) {
        const dist = Math.sqrt(
            Math.pow(node.position[0] - centroid.x, 2) +
            Math.pow(node.position[1] - centroid.y, 2) +
            Math.pow(node.position[2] - centroid.z, 2)
        );
        if (dist > maxDist) maxDist = dist;
    }

    return Math.max(maxDist, 2);
}

// Update camera with dynamic orbital movement (mimicking reference GIF)
function updateCameraDynamics(time, deltaTime) {
    // Update global orbit distance to keep cluster on screen
    const radius = calculateClusterRadius();
    const targetGlobalDistance = Math.max(radius * 2.5, 8);  // At least 2.5x cluster radius, minimum 8 units
    orbitDistance += (targetGlobalDistance - orbitDistance) * 0.02;  // Smooth transition

    // Determine orbit parameters based on mode
    let targetCenter, targetDistance;
    let transitionFactor = 0;  // 0 = local orbit, 1 = global orbit

    if (isLocalOrbit && time >= zoomOutStartTime) {
        // Zooming out - transition from local to global orbit
        const elapsed = time - zoomOutStartTime;
        transitionFactor = Math.min(elapsed / zoomOutDuration, 1.0);

        // Smooth easing (ease-in-out)
        const smoothT = transitionFactor < 0.5
            ? 2 * transitionFactor * transitionFactor
            : 1 - Math.pow(-2 * transitionFactor + 2, 2) / 2;

        // Interpolate between local and global
        const globalCenter = calculateClusterCentroid();
        targetCenter = new THREE.Vector3().lerpVectors(localOrbitCenter, globalCenter, smoothT);
        targetDistance = localOrbitDistance + (orbitDistance - localOrbitDistance) * smoothT;

        // End local orbit mode when transition completes
        if (transitionFactor >= 1.0) {
            isLocalOrbit = false;
        }
    } else if (isLocalOrbit) {
        // Local orbit mode - orbit around query results
        targetCenter = localOrbitCenter;
        targetDistance = localOrbitDistance;
    } else {
        // Global orbit mode - orbit around full cluster
        targetCenter = calculateClusterCentroid();
        targetDistance = orbitDistance;
    }

    // Smoothly interpolate camera target
    cameraTarget.x += (targetCenter.x - cameraTarget.x) * lookSensitivity;
    cameraTarget.y += (targetCenter.y - cameraTarget.y) * lookSensitivity;
    cameraTarget.z += (targetCenter.z - cameraTarget.z) * lookSensitivity;

    // Orbital movement (slow counterclockwise orbit)
    orbitAngle += orbitSpeed * deltaTime;

    // Calculate base orbital position using spherical coordinates
    const baseX = cameraTarget.x + targetDistance * Math.cos(orbitAngle) * Math.cos(orbitElevation);
    const baseY = cameraTarget.y + targetDistance * Math.sin(orbitElevation);
    const baseZ = cameraTarget.z + targetDistance * Math.sin(orbitAngle) * Math.cos(orbitElevation);

    // Add organic "float" using Simplex noise (shimmer effect) - reduce during local orbit and transitions
    let shimmerScale = 1;
    if (isLocalOrbit) {
        if (time >= zoomOutStartTime) {
            // Fading out during zoom-out transition
            shimmerScale = 1 - transitionFactor;
        } else {
            // Reduced shimmer during local orbit for smoother viewing
            shimmerScale = 0.3;
        }
    }
    const shimmerX = simplex2D(time * 0.5, 0) * noiseScale * shimmerScale;
    const shimmerY = simplex2D(0, time * 0.3) * noiseScale * shimmerScale;
    const shimmerZ = simplex2D(time * 0.4, time * 0.2) * noiseScale * shimmerScale;

    // Apply orbital position with shimmer
    camera.position.x = baseX + shimmerX;
    camera.position.y = baseY + shimmerY;
    camera.position.z = baseZ + shimmerZ;

    // Dynamic FOV based on cluster size (keeps visual density consistent)
    const newRadius = calculateClusterRadius();
    clusterRadius += (newRadius - clusterRadius) * 0.05;
    const targetFOV = baseFOV * (1 + clusterRadius / 10);
    camera.fov += (targetFOV - camera.fov) * 0.05;
    camera.updateProjectionMatrix();

    // Point camera at the smoothed centroid
    camera.lookAt(cameraTarget);
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
    this.autoRotate = false;
    this.autoRotateSpeed = 2.0;

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

        // Auto-rotation
        if (scope.autoRotate && state === STATE.NONE) {
            sphericalDelta.theta -= 2 * Math.PI / 60 / 60 * scope.autoRotateSpeed;
        }

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
