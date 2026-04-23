import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import Stats from 'stats.js';

// Constants
const TABLE_WIDTH = 2.5; 
const TABLE_LENGTH = 4.5;
const TABLE_HEIGHT = 0.76;
const BALL_RADIUS = 0.06;
const PADDLE_RADIUS = 0.18;
const PADDLE_THICKNESS = 0.03;
const NET_HEIGHT = 0.25;

// State
let score = { player: 0, ai: 0 };
let gameState = 'menu'; // menu, playing, paused, gameOver, turnBasedMenu, aiming
let winner = null;
let currentServer = 'player';
let selectedActionType = null;

// Trajectory Visualization
let trajectoryLine = null;
let landingIndicator = null;
const TRAJECTORY_POINTS = 60;
const trajectoryPositions = new Float32Array(TRAJECTORY_POINTS * 3);

// Ball Effects
let ballLight;
const ballEchoes = [];
const MAX_ECHOES = 10;

// Rules tracking
let lastHitter = null; // 'player', 'ai'
let bounceSide = null; // 'player', 'ai'
let bounceCount = 0;
let isFirstServeBounceOnServerSide = true;

// Refs
let world, scene, camera, renderer, stats;
let ball = { mesh: null, body: null };
let playerPaddle = { mesh: null, body: null };
let aiPaddle = { mesh: null, body: null };
let mouse = { x: 0, y: 0 };
let requestID = null;

// Camera Shake & Dynamic Camera
let shakeIntensity = 0;
const shakeDecay = 0.9;
const defaultCameraPos = new THREE.Vector3(0, 2.6, 4.2);
const defaultCameraTarget = new THREE.Vector3(0, 0.5, 0);

let currentCameraPos = defaultCameraPos.clone();
let currentCameraTarget = defaultCameraTarget.clone();

// Particles
let particles = [];
const MAX_PARTICLES = 100;
const particleGeometry = new THREE.SphereGeometry(0.02, 4, 4);

// UI
const hud = document.getElementById('hud');
const playerScoreEl = document.getElementById('player-score');
const aiScoreEl = document.getElementById('ai-score');
const gameStateTextEl = document.getElementById('game-state-text');
const ballDistTextEl = document.getElementById('ball-dist-text');
const ballSpeedTextEl = document.getElementById('ball-speed-text');
const menuScreen = document.getElementById('menu-screen');
const pausedScreen = document.getElementById('paused-screen');
const gameOverScreen = document.getElementById('gameover-screen');
const actionMenu = document.getElementById('action-menu');
const aimingHint = document.getElementById('aiming-hint');
const aimXValEl = document.getElementById('aim-x-val');
const aimYValEl = document.getElementById('aim-y-val');
const wininnerTextEl = document.getElementById('winner-text');
const finalPlayerScoreEl = document.getElementById('final-player-score');
const finalAiScoreEl = document.getElementById('final-ai-score');

//Buttons
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('resume-btn').addEventListener('click', togglePause);
document.getElementById('rematch-btn').addEventListener('click', startGame);

//Action Menu
document.getElementById('power-shot-btn').addEventListener('click', () => performTurnBasedAction('power'));
document.getElementById('spin-shot-btn').addEventListener('click', () => performTurnBasedAction('precision'));
document.getElementById('lob-shot-btn').addEventListener('click', () => performTurnBasedAction('lob'));

let hasTakenTurnThisRound = false;

function setGameState(newState) {
    gameState = newState;
    gameStateTextEl.innerText = newState.toUpperCase();
    
    //UI
    menuScreen.classList.toggle('hidden', gameState !== 'menu');
    pausedScreen.classList.toggle('hidden', gameState !== 'paused');
    gameOverScreen.classList.toggle('hidden', gameState !== 'gameOver');
    actionMenu.classList.toggle('hidden', gameState !== 'turnBasedMenu');
    aimingHint.classList.toggle('hidden', gameState !== 'aiming');
    
    if (trajectoryLine) trajectoryLine.visible = (gameState === 'aiming');
    
    if (gameState === 'playing') {
        hud.style.opacity = '1';
    } else if (gameState === 'menu') {
        hud.style.opacity = '0';
    }
}

function init() {
    //Stats
    stats = new Stats();
    stats.showPanel(0);
    stats.dom.style.position = 'absolute';
    stats.dom.style.top = '10px';
    stats.dom.style.left = '10px';
    stats.dom.style.zIndex = '100';
    document.body.appendChild(stats.dom);

    //Physics
    world = new CANNON.World({
        gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    world.allowSleep = false;

    //Materials
    const tableMaterial = new CANNON.Material('table');
    const ballMaterial = new CANNON.Material('ball');
    const paddleMaterial = new CANNON.Material('paddle');

    const ballTableContact = new CANNON.ContactMaterial(ballMaterial, tableMaterial, {
        friction: 0.3,
        restitution: 0.8,
    });
    const ballPaddleContact = new CANNON.ContactMaterial(ballMaterial, paddleMaterial, {
        friction: 0.5,
        restitution: 0.9,
    });
    world.addContactMaterial(ballTableContact);
    world.addContactMaterial(ballPaddleContact);

    //Scene 
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe0e7ff); // sky blue
    scene.fog = new THREE.FogExp2(0xe0e7ff, 0.05);

    //Particles
    const pMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffff, 
        transparent: true,
        blending: THREE.NormalBlending
    });
    for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = new THREE.Mesh(particleGeometry, pMaterial.clone());
        p.visible = false;
        scene.add(p);
        particles.push(p);
    }

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.copy(defaultCameraPos);
    camera.lookAt(defaultCameraTarget);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('game-container').appendChild(renderer.domElement);

    //Light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x88aaff, 1.2); //blue
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(5, 10, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.left = -10;
    keyLight.shadow.camera.right = 10;
    keyLight.shadow.camera.top = 10;
    keyLight.shadow.camera.bottom = -10;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xddeeff, 0.8);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xffffff, 15, 15);
    rimLight.position.set(0, 3, -10);
    scene.add(rimLight);

    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xf8fafc,
        roughness: 0.9,
        metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(40, 40, 0xccd6e0, 0xdde6f0);
    gridHelper.position.y = -0.49;
    scene.add(gridHelper);

    const decorativeGeo = new THREE.IcosahedronGeometry(1, 2);
    const backgroundGroup = new THREE.Group();
    backgroundGroup.name = "backgroundDecorative";
    
    for (let i = 0; i < 27; i++) {
        const opacity = i < 15 ? 0.08 : 0.12;
        const scaleBase = i < 15 ? 8 : 5;
        const scaleRange = i < 15 ? 12 : 10;
        
        // Use soft pastel tints
        const tint = new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 0.3, 0.9);
        
        const blobMat = new THREE.MeshStandardMaterial({ 
            color: tint, 
            transparent: true, 
            opacity: opacity,
            roughness: 1
        });
        const blob = new THREE.Mesh(decorativeGeo, blobMat);
        const radius = 25 + Math.random() * 30;
        const angle = Math.random() * Math.PI * 2;
        blob.position.set(Math.cos(angle) * radius, 5 + Math.random() * 20, Math.sin(angle) * radius);
        blob.scale.setScalar(scaleBase + Math.random() * scaleRange);
        
        blob.userData.rotSpeed = {
            x: (Math.random() - 0.5) * 0.005,
            y: (Math.random() - 0.5) * 0.005,
            z: (Math.random() - 0.5) * 0.005
        };
        
        backgroundGroup.add(blob);
    }
    scene.add(backgroundGroup);

    //Table
    const tableGeometry = new THREE.BoxGeometry(TABLE_WIDTH, 0.05, TABLE_LENGTH);
    const tableMeshMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x1b5e20,
        roughness: 0.8,
        metalness: 0.1
    });
    const tableMesh = new THREE.Mesh(tableGeometry, tableMeshMaterial);
    tableMesh.position.y = TABLE_HEIGHT;
    tableMesh.receiveShadow = true;
    scene.add(tableMesh);

    const tableBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(TABLE_WIDTH / 2, 0.025, TABLE_LENGTH / 2)),
        position: new CANNON.Vec3(0, TABLE_HEIGHT, 0),
        material: tableMaterial,
    });
    tableBody.name = 'table';
    world.addBody(tableBody);

    //Table
    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.02, TABLE_LENGTH), lineMaterial);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = TABLE_HEIGHT + 0.026;
    scene.add(centerLine);

    //Trajectory 
    const trajectoryGeometry = new THREE.BufferGeometry();
    trajectoryGeometry.setAttribute('position', new THREE.BufferAttribute(trajectoryPositions, 3));
    const trajectoryMaterial = new THREE.LineDashedMaterial({ 
        color: 0xffffff, 
        transparent: true, 
        opacity: 0.6,
        dashSize: 0.1,
        gapSize: 0.05
    });
    trajectoryLine = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
    trajectoryLine.visible = false;
    scene.add(trajectoryLine);

    //Net
    const netGeometry = new THREE.PlaneGeometry(TABLE_WIDTH, NET_HEIGHT);
    const netMeshMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffffff, 
        transparent: true, 
        opacity: 0.6,
        side: THREE.DoubleSide,
        roughness: 0.5,
        metalness: 0.0
    });
    const netMesh = new THREE.Mesh(netGeometry, netMeshMaterial);
    netMesh.position.y = TABLE_HEIGHT + NET_HEIGHT / 2;
    scene.add(netMesh);

    const netBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(TABLE_WIDTH / 2, NET_HEIGHT / 2, 0.01)),
        position: new CANNON.Vec3(0, TABLE_HEIGHT + NET_HEIGHT / 2, 0),
    });
    world.addBody(netBody);

    //Ball
    const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
    const ballMeshMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xff9800,
        emissive: 0xff9800,
        emissiveIntensity: 0.5,
        roughness: 0.4,
        metalness: 0.3
    });
    const ballMesh = new THREE.Mesh(ballGeometry, ballMeshMaterial);
    ballMesh.castShadow = true;
    scene.add(ballMesh);

    ballLight = new THREE.PointLight(0xff9800, 5, 0.8);
    scene.add(ballLight);

    const echoMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xff9800, 
        transparent: true, 
        opacity: 0.3 
    });
    for (let i = 0; i < MAX_ECHOES; i++) {
        const echo = new THREE.Mesh(ballGeometry, echoMaterial.clone());
        echo.visible = false;
        scene.add(echo);
        ballEchoes.push(echo);
    }

    const ballBody = new CANNON.Body({
        mass: 0.0027,
        shape: new CANNON.Sphere(BALL_RADIUS),
        position: new CANNON.Vec3(0, 1.5, 0),
        material: ballMaterial,
    });
    world.addBody(ballBody);
    ballBody.name = 'ball';
    ball = { mesh: ballMesh, body: ballBody };

    //Collision detection
    ballBody.addEventListener('collide', (e) => {
        if (gameState !== 'playing') return;
        const other = e.body;
        if (!other) return;

        if (other.name === 'playerPaddle') {
            handlePaddleHit('player');
        } else if (other.name === 'aiPaddle') {
            handlePaddleHit('ai');
        } else if (other.name === 'table') {
            handleTableBounce();
        }
    });

    function createPaddleObj(color, zPos) {
        const paddleGeometry = new THREE.CylinderGeometry(PADDLE_RADIUS, PADDLE_RADIUS, PADDLE_THICKNESS, 32);
        const paddleMeshMaterial = new THREE.MeshStandardMaterial({ 
            color,
            roughness: 0.6,
            metalness: 0.2
        });
        const paddleMesh = new THREE.Mesh(paddleGeometry, paddleMeshMaterial);
        paddleMesh.rotation.x = Math.PI / 2;
        paddleMesh.castShadow = true;
        scene.add(paddleMesh);

        const paddleBody = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Cylinder(PADDLE_RADIUS, PADDLE_RADIUS, PADDLE_THICKNESS, 32),
            position: new CANNON.Vec3(0, TABLE_HEIGHT + 0.2, zPos),
            material: paddleMaterial,
        });
        paddleBody.name = zPos > 0 ? 'playerPaddle' : 'aiPaddle';
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
        paddleBody.quaternion.copy(q);
        
        world.addBody(paddleBody);
        return { mesh: paddleMesh, body: paddleBody };
    }

    playerPaddle = createPaddleObj(0xf44336, TABLE_LENGTH / 2 + 0.2);
    aiPaddle = createPaddleObj(0x2196f3, -TABLE_LENGTH / 2 - 0.2);

    const floorGeometry = new THREE.PlaneGeometry(30, 30);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x333a4d, // Deep slate blue/grey
        roughness: 0.9,
        metalness: 0.1 
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);

    const landingGeo = new THREE.RingGeometry(0.1, 0.12, 32);
    const landingMat = new THREE.MeshBasicMaterial({ 
        color: 0xffffff, 
        transparent: true, 
        opacity: 0.8,
        side: THREE.DoubleSide
    });
    landingIndicator = new THREE.Mesh(landingGeo, landingMat);
    landingIndicator.rotation.x = -Math.PI / 2;
    landingIndicator.visible = false;
    scene.add(landingIndicator);

    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function onMouseDown(e) {
    if (gameState === 'aiming') {
        confirmShot();
    }
}

function onKeyDown(e) {
    if (e.key === 'Escape') {
        togglePause();
    }
    if (e.key === ' ' && gameState === 'playing') {
        serveBall();
    }
}

function serveBall() {
    if (!ball.body) return;
    
    gameStateTextEl.innerText = "PLAYING";

    lastHitter = currentServer;
    bounceSide = null;
    bounceCount = 0;
    isFirstServeBounceOnServerSide = true;

    const zPos = currentServer === 'player' ? (TABLE_LENGTH / 2) : (-TABLE_LENGTH / 2);
    const zDir = currentServer === 'player' ? -1 : 1; // Movement direction
    
    ball.body.position.set(0, TABLE_HEIGHT + 0.3, zPos);
    ball.body.velocity.set(0, 0, 0);
    ball.body.angularVelocity.set(0, 0, 0);
    ball.body.wakeUp();
    
    //towards the opponent
    ball.body.velocity.set((Math.random() - 0.5) * 1, 3, zDir * 4);
}

function resetBall() {
    const totalPoints = score.player + score.ai;
    currentServer = (Math.floor(totalPoints / 2) % 2 === 0) ? 'player' : 'ai';
    hasTakenTurnThisRound = false;
    ballEchoes.forEach(e => e.visible = false);

    const zPos = currentServer === 'player' ? (TABLE_LENGTH / 2) : (-TABLE_LENGTH / 2);
    ball.body.position.set(0, TABLE_HEIGHT + 0.3, zPos);
    ball.body.velocity.set(0, 0, 0);
    ball.body.angularVelocity.set(0, 0, 0);
    ball.body.wakeUp();
    
    if (currentServer === 'ai') {
        setTimeout(() => {
            if (gameState !== 'playing') return;
            serveBall();
        }, 1000);
    } else {
        gameStateTextEl.innerText = "YOUR SERVE";
    }
}

function triggerCameraShake(intensity) {
    //shakeIntensity = Math.max(shakeIntensity, intensity);
}

function spawnParticle(x, y, z, color = 0x3b82f6, life = 1.0) {
    const p = particles.find(p => !p.visible);
    if (!p) return;
    p.visible = true;
    p.position.set(x, y, z);
    p.material.color.set(color);
    p.material.opacity = 0.9;
    p.userData = { 
        life: life, 
        maxLife: life, 
        velocity: new THREE.Vector3((Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02) 
    };
    p.scale.setScalar(1);
}

function updateParticles() {
    particles.forEach(p => {
        if (!p.visible) return;
        p.userData.life -= 0.02;
        if (p.userData.life <= 0) {
            p.visible = false;
        } else {
            p.position.add(p.userData.velocity);
            const ratio = p.userData.life / p.userData.maxLife;
            p.material.opacity = ratio;
            p.scale.setScalar(ratio);
        }
    });
}

function handlePaddleHit(side) {
    lastHitter = side;
    bounceSide = null;
    bounceCount = 0;
    isFirstServeBounceOnServerSide = false;

    if (side === 'ai') {
        hasTakenTurnThisRound = false; 
    }

    triggerCameraShake(0.05);

    const pos = ball.body.position;
    const speed = ball.body.velocity.length();
    const particleCount = Math.floor(5 + speed * 2); // Scale with speed
    for (let i = 0; i < Math.min(particleCount, 25); i++) {
        spawnParticle(pos.x, pos.y, pos.z, side === 'player' ? 0x2196f3 : 0xf44336, 0.5 + Math.random() * 0.5);
    }
    if (side === 'ai') {
        const targetZDir = 1; // Towards player
        const speedBoost = 6.5;
        const spread = 2.0;
        ball.body.velocity.set(
            (Math.random() - 0.5) * spread,
            2.5 + Math.random() * 1.5,
            targetZDir * speedBoost
        );
    } else if (side === 'player') {
        const targetZDir = -1; // Towards AI
        const speedBoost = 7.5; // Slightly stronger than AI for player advantage/feel
        const spread = 1.5; // More accurate than AI
        
        // Boost the ball back towards the AI
        ball.body.velocity.set(
            (Math.random() - 0.5) * spread,
            2.0 + Math.random() * 1.0, // lower, tighter arc
            targetZDir * speedBoost
        );
    }
}

function performTurnBasedAction(type) {
    if (gameState !== 'turnBasedMenu') return;
    
    selectedActionType = type;
    ball.body.position.set(
        ball.body.position.x,
        ball.body.position.y,
        playerPaddle.body.position.z - 0.1
    );
    ball.body.velocity.set(0, 0, 0);

    if (trajectoryLine) {
        let color = 0xffffff;
        if (type === 'power') color = 0xff4444;
        if (type === 'precision') color = 0x4444ff;
        if (type === 'lob') color = 0x44ff44;
        trajectoryLine.material.color.set(color);
    }

    setGameState('aiming');
}

function confirmShot() {
    if (gameState !== 'aiming') return;

    setGameState('playing');
    hasTakenTurnThisRound = true;

    const physics = getShotPhysics(selectedActionType);

    handlePaddleHit('player');

    ball.body.velocity.set(physics.vx, physics.vy, physics.vz);

    playerPaddle.body.position.z -= 0.45;
}

function getShotPhysics(type) {
    const targetZDir = -1; // Towards AI
    let speedBoost = 8.5;
    let steerPower = 5.0;
    let verticalBase = 2.2;
    let verticalRange = 1.8;

    switch(type) {
        case 'power':
            speedBoost = 11.0;
            steerPower = 4.0;
            verticalBase = 1.8;
            verticalRange = 1.2;
            break;
        case 'precision':
            speedBoost = 7.5;
            steerPower = 3.5;
            verticalBase = 2.2;
            verticalRange = 1.5;
            break;
        case 'lob':
            speedBoost = 6.0;
            steerPower = 2.5;
            verticalBase = 5.0;
            verticalRange = 3.0;
            break;
    }

    // Horizontal aim controlled by mouse during aiming phase
    const aimX = (mouse.x * steerPower)*4;
    // Vertical aim: higher mouse y = higher arc
    const aimY = Math.max(0.8, verticalBase + (mouse.y * verticalRange));

    return {
        vx: aimX,
        vy: aimY,
        vz: targetZDir * speedBoost
    };
}

function handleTableBounce() {
    const ballZ = ball.body.position.z;
    const currentSide = ballZ > 0 ? 'player' : 'ai';

    triggerCameraShake(0.03);

    const pos = ball.body.position;
    const speed = ball.body.velocity.length();
    const particleCount = Math.floor(3 + speed * 1.5); // Scale with speed
    for (let i = 0; i < Math.min(particleCount, 15); i++) {
        spawnParticle(pos.x, pos.y, pos.z, 0xffffff, 0.4 + Math.random() * 0.3);
    }

    /*
    // If serving, the first bounce must be on the server's side
    if (isFirstServeBounceOnServerSide) {
        if (currentSide !== lastHitter) {
            // Serve didn't hit server side first
            awardPoint(lastHitter === 'player' ? 'ai' : 'player');
            return;
        }
        isFirstServeBounceOnServerSide = false;
        bounceSide = currentSide;
        bounceCount = 1;
        return;
    }

    // Normal play collision
    if (currentSide === lastHitter) {
        awardPoint(lastHitter === 'player' ? 'ai' : 'player');
    } else {
        // Ball hit the opponent's side
        if (bounceSide === currentSide) {
            bounceCount++;
            if (bounceCount > 1) {
                awardPoint(lastHitter);
            }
        } else {
            bounceSide = currentSide;
            bounceCount = 1;
        }
    }
    */
}

function awardPoint(pointWinner) {
    if (pointWinner === 'ai') {
        score.ai++;
        aiScoreEl.innerText = score.ai;
        if (score.ai >= 11) {
            winner = 'ai';
            endGame();
        } else {
            resetBall();
        }
    } else {
        score.player++;
        playerScoreEl.innerText = score.player;
        if (score.player >= 11) {
            winner = 'player';
            endGame();
        } else {
            resetBall();
        }
    }
}

function startGame() {
    setGameState('playing');
    score = { player: 0, ai: 0 };
    playerScoreEl.innerText = '0';
    aiScoreEl.innerText = '0';
    currentServer = 'player';
    hasTakenTurnThisRound = false;
    
    // Position ball for initial player serve
    const zPos = TABLE_LENGTH / 2;
    ball.body.position.set(0, TABLE_HEIGHT + 0.3, zPos);
    ball.body.velocity.set(0, 0, 0);
    ball.body.angularVelocity.set(0, 0, 0);
    ball.body.wakeUp();
    gameStateTextEl.innerText = "YOUR SERVE";
}

function togglePause() {
    if (gameState === 'playing') {
        setGameState('paused');
    } else if (gameState === 'paused') {
        setGameState('playing');
    }
}

function animate() {
    requestID = requestAnimationFrame(animate);
    if (stats) stats.begin();

    updateParticles();

    // Animate background elements
    const bgGroup = scene.getObjectByName("backgroundDecorative");
    if (bgGroup) {
        bgGroup.children.forEach(child => {
            if (child.userData.rotSpeed) {
                child.rotation.x += child.userData.rotSpeed.x;
                child.rotation.y += child.userData.rotSpeed.y;
                child.rotation.z += child.userData.rotSpeed.z;
            }
        });
    }

    if ( gameState === 'playing') {
        world.step(1 / 60, 1 / 60, 3);

        // Update Distance Display
        const dist = ball.body.position.distanceTo(playerPaddle.body.position);
        ballDistTextEl.innerText = dist.toFixed(2);

        // Update Speed Display
        const speed = ball.body.velocity.length();
        ballSpeedTextEl.innerText = speed.toFixed(2);

        // Trail particles: more particles at higher speeds
        if (speed > 3) {
            // Calculate a color based on trajectory and speed
            // Blue-ish when moving towards player (Z+), Red-ish towards AI (Z-)
            const baseColor = new THREE.Color(0xffffff);
            const targetColor = ball.body.velocity.z > 0 ? new THREE.Color(0x4fc3f7) : new THREE.Color(0xff8a80);
            const mixAmount = Math.min(1.0, speed / 8.0);
            const trailColor = baseColor.clone().lerp(targetColor, mixAmount).getHex();

            // Spawn probability or count matches speed
            const trailChance = 0.3 + (speed * 0.1);
            if (Math.random() < trailChance) {
                spawnParticle(ball.body.position.x, ball.body.position.y, ball.body.position.z, trailColor, 0.3);
            }
            // Additional burst for very high speeds
            if (speed > 6.0 && Math.random() < 0.2) {
                spawnParticle(ball.body.position.x, ball.body.position.y, ball.body.position.z, trailColor, 0.2);
            }
        }

        // Sync Ball
        ball.mesh.position.set(ball.body.position.x, ball.body.position.y, ball.body.position.z);
        ball.mesh.quaternion.set(
            ball.body.quaternion.x,
            ball.body.quaternion.y,
            ball.body.quaternion.z,
            ball.body.quaternion.w
        );

        // Update Ball Effects
        ballLight.position.copy(ball.mesh.position);
        
        // Color shift for light based on direction
        const lightTargetColor = ball.body.velocity.z > 0 ? new THREE.Color(0x4fc3f7) : new THREE.Color(0xff8a80);
        const lightBaseColor = new THREE.Color(0xff9800);
        const lightMix = Math.min(1.0, speed / 10.0);
        ballLight.color.copy(lightBaseColor.lerp(lightTargetColor, lightMix));

        // Emissive intensity based on speed
        ball.mesh.material.emissiveIntensity = 0.1 + (speed / 80);
        ballLight.intensity = (speed/2);
        ballLight.distance = 0.5;

        // Motion Echoes
        if (speed > 5) {
            // Update echoes
            for (let i = ballEchoes.length - 1; i > 0; i--) {
                ballEchoes[i].position.copy(ballEchoes[i-1].position);
                ballEchoes[i].visible = ballEchoes[i-1].visible;
                ballEchoes[i].material.opacity = ballEchoes[i-1].material.opacity * 0.8;
            }
            ballEchoes[0].position.copy(ball.mesh.position);
            ballEchoes[0].visible = true;
            ballEchoes[0].material.opacity = 0.3;
        } else {
            ballEchoes.forEach(e => e.visible = false);
        }

        

        const playerBaseZ = TABLE_LENGTH / 2 + 0.2;
        const ballDistToPlayer = playerBaseZ - ball.body.position.z;
        
        let playerTargetZ = playerBaseZ;
        
        //Turn-Based Menu
        if (ball.body.velocity.z > 0 && ballDistToPlayer < 0.8 && ballDistToPlayer > 0 && gameState === 'playing' && !hasTakenTurnThisRound) {
            setGameState('turnBasedMenu');
        }

        if (ball.body.velocity.z > 0 && ballDistToPlayer < 1.0 && ballDistToPlayer > 0 && (gameState === 'playing' || gameState === 'turnBasedMenu')) {
            playerTargetZ -= 0.45; // Increased lunge forward
        }

        const targetX = mouse.x * (TABLE_WIDTH / 2 + 0.5);
        
        // Automated height tracking with distance-based influence
        const defaultHeight = TABLE_HEIGHT + 0.2;
        const ballTargetY = Math.max(TABLE_HEIGHT + 0.05, ball.body.position.y);
        
        // Influence drops as ball gets further away (using the already calculated 'dist')
        // Full influence up to 0.5m away, then drops to 0 at 3.5m away
        const influence = Math.max(0, Math.min(1, 1 - (dist - 0.5) / 3.0));
        const targetY = THREE.MathUtils.lerp(defaultHeight, ballTargetY, influence);
        
        // Calculate velocity for dynamic tilt
        const vx = (targetX - playerPaddle.body.position.x) * 0.4;
        // Even if Y is automated, we want a small tilt for forward/backward movement if we add it,
        // but since targetY is now ballY, vy will reflect ball vertical velocity.
        const vy = (targetY - playerPaddle.body.position.y) * 0.4;

        // Smoother but faster movement
        playerPaddle.body.position.x = THREE.MathUtils.lerp(playerPaddle.body.position.x, targetX, 0.25);
        playerPaddle.body.position.y = THREE.MathUtils.lerp(playerPaddle.body.position.y, targetY, 0.25);
        playerPaddle.body.position.z = THREE.MathUtils.lerp(playerPaddle.body.position.z, playerTargetZ, 0.35); // Snappier swing

        // Synchronize position
        playerPaddle.mesh.position.set(playerPaddle.body.position.x, playerPaddle.body.position.y, playerPaddle.body.position.z);
        
        // Apply dynamic tilt/rotation
        // Default rotation is Math.PI / 2 on X
        // We add tilt based on X/Y velocity
        const tiltX = vy * 0.5; // Up/down tilt
        const tiltZ = -vx * 0.5; // Left/right tilt
        
        playerPaddle.mesh.rotation.set(Math.PI / 2 + tiltX, 0, tiltZ);
        
        // Update physics body rotation to match visual (improved collision accuracy)
        playerPaddle.body.quaternion.setFromEuler(playerPaddle.mesh.rotation.x, playerPaddle.mesh.rotation.y, playerPaddle.mesh.rotation.z);

        

        // AI Paddle Logic
        const aiBaseZ = -TABLE_LENGTH / 2 - 0.2;
        const ballDistToAI = ball.body.position.z - aiBaseZ;
        
        // AI "Swings" forward if ball is approaching and close
        let aiTargetZ = aiBaseZ;
        if (ball.body.velocity.z < 0 && ballDistToAI < 1.0 && ballDistToAI > 0) {
            aiTargetZ += 0.3; // Lunge forward
        }

        const aiTargetX = ball.body.position.x;
        const aiTargetY = Math.max(TABLE_HEIGHT + 0.05, ball.body.position.y);
        const aiSpeed = 0.12; // Slightly faster tracking
        
        aiPaddle.body.position.x = THREE.MathUtils.lerp(aiPaddle.body.position.x, aiTargetX, aiSpeed);
        aiPaddle.body.position.y = THREE.MathUtils.lerp(aiPaddle.body.position.y, aiTargetY, aiSpeed);
        aiPaddle.body.position.z = THREE.MathUtils.lerp(aiPaddle.body.position.z, aiTargetZ, 0.2); // Smooth swing

        aiPaddle.mesh.position.set(aiPaddle.body.position.x, aiPaddle.body.position.y, aiPaddle.body.position.z);

        // Scoring Logic
        if (ball.body.position.y < 0) {
            if (ball.body.position.z > 0) {
                awardPoint('ai');
            } else {
                awardPoint('player');
            }
        }

        // Out of bounds
        if (Math.abs(ball.body.position.x) > 5 || Math.abs(ball.body.position.z) > 10) {
            resetBall();
        }
    } else {
        // Menu/Paused/TurnMenu/Aiming
        // Freeze X position during tactical states so aiming doesn't move the paddle
        let targetX = mouse.x * (TABLE_WIDTH / 2 + 0.5);
        if (gameState === 'turnBasedMenu' || gameState === 'aiming') {
            targetX = playerPaddle.body.position.x;
        }

        let targetY = TABLE_HEIGHT + 0.1 + (mouse.y + 1) * 0.4;
        
        // If in turn-based menu or aiming, keep tracking ball altitude for better visual alignment
        if (gameState === 'turnBasedMenu' || gameState === 'aiming') {
            const ballTargetY = Math.max(TABLE_HEIGHT + 0.05, ball.body.position.y);
            targetY = ballTargetY;
        }

        // Trajectory Visualization
        if (gameState === 'aiming') {
            const physics = getShotPhysics(selectedActionType);
            
            // Display Aim values
            aimXValEl.innerText = physics.vx.toFixed(2);
            aimYValEl.innerText = physics.vy.toFixed(2);

            const pos = ball.body.position;
            const gravity = -9.82;
            const dt = 0.05;
            
            let currentP = new THREE.Vector3(pos.x, pos.y, pos.z);
            let currentV = new THREE.Vector3(physics.vx, physics.vy, physics.vz);
            let firstLandingSet = false;

            for (let i = 0; i < TRAJECTORY_POINTS; i++) {
                // Update physics step
                currentV.y += gravity * dt;
                currentP.add(currentV.clone().multiplyScalar(dt));

                // Check for table bounce in prediction
                if (currentP.y < TABLE_HEIGHT + BALL_RADIUS && 
                    Math.abs(currentP.x) < TABLE_WIDTH / 2 && 
                    Math.abs(currentP.z) < TABLE_LENGTH / 2 &&
                    currentV.y < 0) { // Only bounce when falling
                    
                    // Reflection
                    currentV.y = Math.abs(currentV.y) * 0.7;
                    currentP.y = TABLE_HEIGHT + BALL_RADIUS;

                    // Set landing indicator at the first bounce
                    if (!firstLandingSet) {
                        landingIndicator.position.set(currentP.x, currentP.y + 0.01, currentP.z);
                        landingIndicator.visible = true;
                        firstLandingSet = true;
                    }
                }
                
                trajectoryPositions[i * 3] = currentP.x;
                trajectoryPositions[i * 3 + 1] = currentP.y;
                trajectoryPositions[i * 3 + 2] = currentP.z;

                // Stop trajectory if ball leaves general play area or heads too far out
                if (currentP.y < -1 || Math.abs(currentP.z) > TABLE_LENGTH) {
                     for (let j = i + 1; j < TRAJECTORY_POINTS; j++) {
                        trajectoryPositions[j * 3] = currentP.x;
                        trajectoryPositions[j * 3 + 1] = currentP.y;
                        trajectoryPositions[j * 3 + 2] = currentP.z;
                    }
                    break;
                }
            }
            
            if (!firstLandingSet) landingIndicator.visible = false;

            const power = Math.sqrt(physics.vx * physics.vx + physics.vz * physics.vz + physics.vy * physics.vy);
            const hue = Math.max(0, 0.4 - (power / 40)); 
            const color = new THREE.Color().setHSL(hue, 0.9, 0.5);
            trajectoryLine.material.color.copy(color);
            landingIndicator.material.color.copy(color);

            trajectoryLine.geometry.attributes.position.needsUpdate = true;
            trajectoryLine.computeLineDistances();
        } else if (landingIndicator) {
            landingIndicator.visible = false;
        }

        const vx = (targetX - playerPaddle.body.position.x) * 0.4;
        const vy = (targetY - playerPaddle.body.position.y) * 0.4;

        playerPaddle.body.position.x = THREE.MathUtils.lerp(playerPaddle.body.position.x, targetX, 0.25);
        playerPaddle.body.position.y = THREE.MathUtils.lerp(playerPaddle.body.position.y, targetY, 0.25);
        
        playerPaddle.mesh.position.set(playerPaddle.body.position.x, playerPaddle.body.position.y, playerPaddle.body.position.z);
        
        const tiltX = vy * 0.5;
        const tiltZ = -vx * 0.5;
        playerPaddle.mesh.rotation.set(Math.PI / 2 + tiltX, 0, tiltZ);
        
        playerPaddle.body.quaternion.setFromEuler(playerPaddle.mesh.rotation.x, playerPaddle.mesh.rotation.y, playerPaddle.mesh.rotation.z);
        
        const dist = ball.body.position.distanceTo(playerPaddle.body.position);
        ballDistTextEl.innerText = dist.toFixed(2);

        const speed = ball.body.velocity.length();
        ballSpeedTextEl.innerText = speed.toFixed(2);

        ball.mesh.position.set(ball.body.position.x, ball.body.position.y, ball.body.position.z);
        aiPaddle.mesh.position.set(aiPaddle.body.position.x, aiPaddle.body.position.y, aiPaddle.body.position.z);
    }

    renderer.render(scene, camera);

    const ballPos = ball.body.position;
    
    const targetCamX = ballPos.x * 0.35;
    const targetCamY = defaultCameraPos.y + (ballPos.y - TABLE_HEIGHT) * 0.2;
    const targetCamZ = defaultCameraPos.z + (ballPos.z > 0 ? 0.3 : -0.3); // Zoom in slightly when ball is close
    
    const targetLookX = ballPos.x * 0.5;
    const targetLookY = defaultCameraTarget.y;
    const targetLookZ = ballPos.z * 0.1;

    // Smoothly interpolate camera base values
    const camLerpSpeed = 0.05;
    currentCameraPos.x = THREE.MathUtils.lerp(currentCameraPos.x, targetCamX, camLerpSpeed);
    currentCameraPos.y = THREE.MathUtils.lerp(currentCameraPos.y, targetCamY, camLerpSpeed);
    currentCameraPos.z = THREE.MathUtils.lerp(currentCameraPos.z, targetCamZ, camLerpSpeed);
    
    currentCameraTarget.x = THREE.MathUtils.lerp(currentCameraTarget.x, targetLookX, camLerpSpeed);
    currentCameraTarget.z = THREE.MathUtils.lerp(currentCameraTarget.z, targetLookZ, camLerpSpeed);

    // Apply Camera Shake on top of dynamic position
    let finalCamX = currentCameraPos.x;
    let finalCamY = currentCameraPos.y;
    let finalCamZ = currentCameraPos.z;

    if (shakeIntensity > 0.001) {
        finalCamX += (Math.random() - 0.5) * shakeIntensity;
        finalCamY += (Math.random() - 0.5) * shakeIntensity;
        finalCamZ += (Math.random() - 0.5) * shakeIntensity;
        shakeIntensity *= shakeDecay;
    } else {
        shakeIntensity = 0;
    }

    camera.position.set(finalCamX, finalCamY, finalCamZ);
    camera.lookAt(currentCameraTarget.x, currentCameraTarget.y, currentCameraTarget.z);

    if (stats) stats.end();
}

function endGame() {
    setGameState('gameOver');
    wininnerTextEl.innerText = winner === 'player' ? 'VICTORY' : 'DEFEAT';
    finalPlayerScoreEl.innerText = score.player;
    finalAiScoreEl.innerText = score.ai;
}

init();
setGameState('menu');
