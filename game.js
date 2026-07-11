import * as THREE from 'https://unpkg.com/three@0.147.0/build/three.module.js';

// ==========================================================================
// GAME CONFIGURATION & CONSTANTS
// ==========================================================================
const GAME_CONFIG = {
  player: {
    speed: 25,          // Movement speed (units per second)
    rangeX: 18,         // Maximum X boundary
    rangeY: 12,         // Maximum Y boundary
    rollLimit: 0.5,     // Roll angle (radians) when moving sideways
    pitchLimit: 0.25,   // Pitch angle (radians) when moving vertically
    lerpSpeed: 10,      // Smoothing factor for ship movement/rotation
  },
  laser: {
    speed: 150,         // Laser flight speed
    fireRate: 150,      // Minimum time between shots in ms (standard)
    cooldown: 0,
  },
  starfield: {
    count: 800,        // Number of background stars
    speed: 180,         // Warp speed of stars
    depth: 400,         // Depth of star spawn field (Z range)
  },
  spawn: {
    asteroidRate: 0.02, // Base spawn chance per frame for asteroids
    enemyShipRate: 0.01,// Base spawn chance per frame for enemy drones
    itemRate: 0.003,    // Base spawn chance per frame for powerups
  }
};

// ==========================================================================
// GAME STATE MANAGEMENT
// ==========================================================================
let state = {
  mode: 'TITLE',        // TITLE, PLAYING, GAMEOVER
  gameMode: '3D',       // 3D, 2D
  score: 0,
  highScore: parseInt(localStorage.getItem('neon_starfighter_high') || '0'),
  kills: 0,
  shield: 100,
  maxShield: 100,
  weaponLevel: 1,
  lastFireTime: 0,
  difficultyMultiplier: 1.0
};

// Controls tracking
const keys = {
  w: false, a: false, s: false, d: false,
  ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
  Space: false, Enter: false
};

// Pointer/Touch Controls State
let pointerControl = {
  active: false,
  targetX: 0,
  targetY: 0 // Will map to Y in 3D, Z in 2D
};

// Cinematic Camera Intro State
let cameraIntro = {
  active: false,
  timer: 0,
  duration: 1.3, // seconds
  startPos: new THREE.Vector3(),
  endPos: new THREE.Vector3()
};

// WebGL Global Objects
let scene, camera, renderer, clock;
let starPoints, starGeometry;

// Game Object Groups
let playerGroup;        // Contains cockpit, wings, engines, lights
let engineFlameParticles = [];
const lasers = [];
const enemies = [];
const enemyProjectiles = []; // Track enemy bullet meshes and velocities
const explosions = [];
const items = [];

// Lights
let dirLight, ambientLight, playerEngineLight;

// Audio Context (Initialized on user interaction)
let audioCtx = null;

// DOM Elements (Using getters for lazy loading to prevent early null values)
const dom = {
  get hud() { return document.getElementById('hud'); },
  get hudShieldBar() { return document.getElementById('hud-shield-bar'); },
  get hudScore() { return document.getElementById('hud-score'); },
  get hudWeaponType() { return document.getElementById('hud-weapon-type'); },
  get weaponStatusDot() { return document.getElementById('weapon-status-dot'); },
  get titleScreen() { return document.getElementById('title-screen'); },
  get titleHighScore() { return document.getElementById('title-highscore'); },
  get btnStart3d() { return document.getElementById('btn-start-3d'); },
  get btnStart2d() { return document.getElementById('btn-start-2d'); },
  get gameoverScreen() { return document.getElementById('gameover-screen'); },
  get gameoverScore() { return document.getElementById('gameover-score'); },
  get gameoverKills() { return document.getElementById('gameover-kills'); },
  get gameoverHighScore() { return document.getElementById('gameover-highscore'); },
  get btnRestart3d() { return document.getElementById('btn-restart-3d'); },
  get btnRestart2d() { return document.getElementById('btn-restart-2d'); },
  get damageFlashLayer() { return document.getElementById('damage-flash-layer'); }
};

// ==========================================================================
// AUDIO SYSTEM (WEB AUDIO API SYNTHESIS)
// ==========================================================================
function initAudio() {
  if (audioCtx) return;
  // Initialize on first click/keypress
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();
}

function playLaserSound() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    // Laser "pew" frequency sweep
    const now = audioCtx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
    
    // Rapid volume decay
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    osc.start(now);
    osc.stop(now + 0.16);
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

function playExplosionSound() {
  if (!audioCtx) return;
  try {
    // Generate white noise for explosion sound
    const bufferSize = audioCtx.sampleRate * 0.4; // 0.4 seconds
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;
    
    // Filter noise for low-end rumble
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.35);
    
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.38);
    
    noiseNode.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    
    noiseNode.start();
    noiseNode.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

function playDamageSound() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(60, now + 0.25);
    
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    
    osc.start(now);
    osc.stop(now + 0.26);
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

function playPowerUpSound() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    // Play a shiny 3-note arpeggio
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      
      gain.gain.setValueAtTime(0, now + idx * 0.06);
      gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.2);
      
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.22);
    });
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

function playGameOverSound() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const notes = [330, 293, 220, 165]; // Descending sad melody
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.15);
      
      gain.gain.setValueAtTime(0.2, now + idx * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.15 + 0.3);
      
      osc.start(now + idx * 0.15);
      osc.stop(now + idx * 0.15 + 0.35);
    });
  } catch (e) {
    console.warn("Audio synthesis error", e);
  }
}

// ==========================================================================
// 3D MODEL GENERATION (BUILDING STATELY PROCEDURAL MESHES)
// ==========================================================================

/**
 * Creates the player's starfighter. Combines geometric shapes into a sleek design.
 */
function createPlayerShip() {
  const group = new THREE.Group();

  // Cockpit/Nose (Glowing glass canopy + metallic tip)
  const canopyGeom = new THREE.ConeGeometry(0.7, 3, 8);
  canopyGeom.rotateX(Math.PI / 2); // Orient forward
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x00d8ff,
    emissive: 0x004c80,
    roughness: 0.1,
    metalness: 0.9,
    transparent: true,
    opacity: 0.8
  });
  const canopy = new THREE.Mesh(canopyGeom, canopyMat);
  canopy.position.set(0, 0, -0.5);
  group.add(canopy);

  // Main fuselage / body structure
  const bodyGeom = new THREE.CylinderGeometry(0.8, 0.4, 4, 8);
  bodyGeom.rotateX(Math.PI / 2);
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x222530,
    roughness: 0.4,
    metalness: 0.8
  });
  const body = new THREE.Mesh(bodyGeom, metalMat);
  body.position.set(0, 0, 1.2);
  group.add(body);

  // Wings (Left and Right)
  const wingGeom = new THREE.BoxGeometry(6, 0.15, 2.5);
  // Custom shear / angle for wings
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x3a3f55,
    roughness: 0.5,
    metalness: 0.7
  });
  const wings = new THREE.Mesh(wingGeom, wingMat);
  wings.position.set(0, -0.1, 1.5);
  group.add(wings);

  // Wing panels / stabilizers (Fins at wing tips pointing slightly up)
  const leftFinGeom = new THREE.BoxGeometry(0.1, 1.2, 2);
  const finMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x003f44,
    metalness: 0.5
  });
  const leftFin = new THREE.Mesh(leftFinGeom, finMat);
  leftFin.position.set(-3, 0.4, 1.5);
  leftFin.rotation.z = -0.15;
  group.add(leftFin);

  const rightFin = leftFin.clone();
  rightFin.position.x = 3;
  rightFin.rotation.z = 0.15;
  group.add(rightFin);

  // Laser cannons on wingtips
  const cannonGeom = new THREE.CylinderGeometry(0.1, 0.1, 1.5, 6);
  cannonGeom.rotateX(Math.PI / 2);
  const cannonMat = new THREE.MeshStandardMaterial({ color: 0x111115, metalness: 0.9, roughness: 0.1 });
  
  const leftCannon = new THREE.Mesh(cannonGeom, cannonMat);
  leftCannon.position.set(-2.8, -0.1, 0.5);
  group.add(leftCannon);

  const rightCannon = leftCannon.clone();
  rightCannon.position.x = 2.8;
  group.add(rightCannon);

  // Laser Cannon Tips (Cyber Cyan Emissive indicators)
  const tipGeom = new THREE.CylinderGeometry(0.12, 0.08, 0.3, 6);
  tipGeom.rotateX(Math.PI / 2);
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00f0ff,
    emissiveIntensity: 1.5
  });
  const leftTip = new THREE.Mesh(tipGeom, tipMat);
  leftTip.position.set(-2.8, -0.1, -0.3);
  group.add(leftTip);

  const rightTip = leftTip.clone();
  rightTip.position.x = 2.8;
  group.add(rightTip);

  // Main Thruster Node (Behind the body)
  const thrusterGeom = new THREE.CylinderGeometry(0.5, 0.6, 0.8, 8);
  thrusterGeom.rotateX(Math.PI / 2);
  const thruster = new THREE.Mesh(thrusterGeom, cannonMat);
  thruster.position.set(0, 0, 3.4);
  group.add(thruster);

  // Thruster Glow (Inside)
  const glowGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 8);
  glowGeom.rotateX(Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
  const thrusterGlow = new THREE.Mesh(glowGeom, glowMat);
  thrusterGlow.position.set(0, 0, 3.8);
  group.add(thrusterGlow);

  // Engine PointLight attached to player to project glow on nearby objects
  playerEngineLight = new THREE.PointLight(0x00f0ff, 3, 10);
  playerEngineLight.position.set(0, 0, 4.2);
  group.add(playerEngineLight);

  return group;
}

/**
 * Creates an enemy drone ship
 */
function createEnemyDrone() {
  const group = new THREE.Group();

  // Core Sphere / Cockpit (Ominous Red glowing core)
  const coreGeom = new THREE.SphereGeometry(1.0, 10, 10);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff0044,
    emissive: 0xff0044,
    emissiveIntensity: 1.5,
    roughness: 0.2
  });
  const core = new THREE.Mesh(coreGeom, coreMat);
  group.add(core);

  // Outer armor ring/blades (Procedural dark metal wings)
  const ringGeom = new THREE.CylinderGeometry(1.6, 1.6, 0.3, 3, 1, true); // Open triangle ring
  ringGeom.rotateX(Math.PI / 2);
  const armorMat = new THREE.MeshStandardMaterial({
    color: 0x181822,
    roughness: 0.6,
    metalness: 0.9
  });
  const ring = new THREE.Mesh(ringGeom, armorMat);
  group.add(ring);

  // Forward spikes (Antennae/Lasers)
  const spikeGeom = new THREE.ConeGeometry(0.12, 1.8, 5);
  spikeGeom.rotateX(-Math.PI / 2);
  const spike1 = new THREE.Mesh(spikeGeom, armorMat);
  spike1.position.set(-0.7, 0, -1.2);
  spike1.rotation.y = 0.2;
  group.add(spike1);

  const spike2 = spike1.clone();
  spike2.position.x = 0.7;
  spike2.rotation.y = -0.2;
  group.add(spike2);

  // Thruster back glow
  const thrGeom = new THREE.ConeGeometry(0.4, 0.8, 8);
  thrGeom.rotateX(Math.PI / 2);
  const thrMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
  const thr = new THREE.Mesh(thrGeom, thrMat);
  thr.position.set(0, 0, 1.0);
  group.add(thr);

  // Scale down a bit to match gameplay scale
  group.scale.set(0.9, 0.9, 0.9);

  return group;
}

/**
 * Creates an asteroid mesh
 */
function createAsteroidMesh() {
  // Use Dodecahedron for jagged low-poly space rock look
  const radius = 1.2 + Math.random() * 1.5;
  const geom = new THREE.DodecahedronGeometry(radius, 1);
  
  // Randomly perturb vertices to make asteroid uniquely irregular
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    
    // Shift slightly in random direction
    const factor = 0.15;
    pos.setXYZ(
      i, 
      x + (Math.random() - 0.5) * radius * factor, 
      y + (Math.random() - 0.5) * radius * factor, 
      z + (Math.random() - 0.5) * radius * factor
    );
  }
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a4745,
    roughness: 0.95,
    metalness: 0.1,
    bumpScale: 0.05
  });

  const mesh = new THREE.Mesh(geom, mat);
  
  // Pre-rotate randomly
  mesh.rotation.set(
    Math.random() * Math.PI,
    Math.random() * Math.PI,
    Math.random() * Math.PI
  );

  return { mesh, radius };
}

/**
 * Creates a glowing power-up/collectible
 */
function createItemMesh(type) {
  const group = new THREE.Group();
  let geom, mat, coreColor;

  if (type === 'SHIELD') {
    // Octahedron representing shield restore
    geom = new THREE.OctahedronGeometry(1.0, 0);
    coreColor = 0x39ff14; // Green
    mat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9
    });
  } else {
    // Icosahedron representing weapon power-up
    geom = new THREE.IcosahedronGeometry(0.9, 0);
    coreColor = 0xffea00; // Yellow
    mat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9
    });
  }

  const core = new THREE.Mesh(geom, mat);
  group.add(core);

  // Outer wireframe container for high-tech look
  const wireGeom = geom.clone();
  const wireMat = new THREE.MeshBasicMaterial({
    color: coreColor,
    wireframe: true,
    transparent: true,
    opacity: 0.4
  });
  const outerWire = new THREE.Mesh(wireGeom, wireMat);
  outerWire.scale.set(1.4, 1.4, 1.4);
  group.add(outerWire);

  // Point light to cast color on surroundings
  const light = new THREE.PointLight(coreColor, 1.5, 5);
  group.add(light);

  return group;
}

// ==========================================================================
// SCENE SETUP
// ==========================================================================
function initScene() {
  const container = dom.canvasContainer; // Will resolve below
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Scene
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06060e, 0.0035);

  // Camera
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(0, 0, 15); // Place camera behind ship

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false; // Disable shadows for high performance
  
  const canvasHost = document.getElementById('canvas-container');
  canvasHost.appendChild(renderer.domElement);

  // Clock
  clock = new THREE.Clock();

  // Lights
  ambientLight = new THREE.AmbientLight(0x181830, 1.2);
  scene.add(ambientLight);

  dirLight = new THREE.DirectionalLight(0x00f0ff, 1.5);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  // Red/Magenta accent light coming from the far deep
  const redDirectional = new THREE.DirectionalLight(0xff0055, 0.8);
  redDirectional.position.set(-5, -5, -30);
  scene.add(redDirectional);

  // Build backgrounds and initial items
  buildStarfield();
  
  // Set up resize listener
  window.addEventListener('resize', onWindowResize);
}

/**
 * Builds the warping star background
 */
function buildStarfield() {
  const count = GAME_CONFIG.starfield.count;
  starGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Distribute star coordinates in a tunnel around the path
    const angle = Math.random() * Math.PI * 2;
    // Radial distance from center (don't place inside the gameplay area too much)
    const radius = 10 + Math.random() * 90;
    
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    
    // Spread along Z axis
    positions[i * 3 + 2] = -Math.random() * GAME_CONFIG.starfield.depth;
    
    // Velocity: stars farther out can move slightly slower/faster for depth illusion
    velocities[i] = GAME_CONFIG.starfield.speed * (0.6 + Math.random() * 0.5);
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Simple round glowing dot material using Canvas texture (independent of external images)
  const starTexture = createCircleTexture('#ffffff');
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.8,
    transparent: true,
    opacity: 0.8,
    map: starTexture,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  starPoints = new THREE.Points(starGeometry, starMat);
  scene.add(starPoints);
}

/**
 * Helper to generate canvas texture of a soft circle
 */
function createCircleTexture(colorStr) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, colorStr);
  grad.addColorStop(0.3, colorStr);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  
  return new THREE.CanvasTexture(canvas);
}

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  
  renderer.setSize(width, height);
}

// ==========================================================================
// PARTICLES & EFFECTS ENGINE
// ==========================================================================

/**
 * Instantiates a particle explosion at the specified position
 */
function spawnExplosion(position, colorHex, particleCount = 35) {
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const velocities = [];
  
  for (let i = 0; i < particleCount; i++) {
    // Position starts at origin of impact
    positions.push(position.x, position.y, position.z);
    
    // Fly in spherical distribution
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const speed = 5 + Math.random() * 25;
    
    velocities.push(
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.sin(phi) * Math.sin(theta) * speed,
      Math.cos(phi) * speed
    );
  }
  
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  
  const texture = createCircleTexture('#ffffff');
  const mat = new THREE.PointsMaterial({
    color: colorHex,
    size: 1.2,
    transparent: true,
    opacity: 1.0,
    map: texture,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  
  const points = new THREE.Points(geom, mat);
  scene.add(points);
  
  explosions.push({
    points,
    velocities,
    life: 0,
    maxLife: 0.65 // seconds
  });

  // Dynamic light flash at explosion location
  const light = new THREE.PointLight(colorHex, 6, 25);
  light.position.copy(position);
  scene.add(light);
  
  // Fade light quickly
  const lightTimer = setInterval(() => {
    light.intensity -= 0.6;
    if (light.intensity <= 0) {
      scene.remove(light);
      clearInterval(lightTimer);
    }
  }, 30);
}

/**
 * Creates dynamic engine trail particles behind the player ship
 */
function updateEngineFlame(dt, playerPos) {
  // Spawn rate limit
  if (Math.random() < 0.35 && state.mode === 'PLAYING') {
    const size = 0.5 + Math.random() * 0.5;
    const geom = new THREE.BoxGeometry(size, size, size);
    
    // Alternate thruster colors: Cyan glow
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    
    const flame = new THREE.Mesh(geom, mat);
    
    // Spawn just behind engine nozzle
    flame.position.set(
      playerPos.x + (Math.random() - 0.5) * 0.3,
      playerPos.y + (Math.random() - 0.5) * 0.3,
      playerPos.z + 3.9
    );
    
    scene.add(flame);
    
    // Random spin
    const spinSpeed = {
      x: Math.random() * 5,
      y: Math.random() * 5,
      z: Math.random() * 5
    };
    
    engineFlameParticles.push({
      mesh: flame,
      spinSpeed,
      velocityZ: 35 + Math.random() * 20, // Fly backwards
      life: 0.0,
      maxLife: 0.25 // Fade quickly
    });
  }

  // Update existing engine particles
  for (let i = engineFlameParticles.length - 1; i >= 0; i--) {
    const p = engineFlameParticles[i];
    p.life += dt;
    
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      engineFlameParticles.splice(i, 1);
    } else {
      // Progressively shrink and fade out
      const pct = p.life / p.maxLife;
      p.mesh.scale.setScalar(1.0 - pct);
      p.mesh.material.opacity = (1.0 - pct) * 0.8;
      
      // Move backwards
      p.mesh.position.z += p.velocityZ * dt;
      p.mesh.rotation.x += p.spinSpeed.x * dt;
      p.mesh.rotation.y += p.spinSpeed.y * dt;
    }
  }
}

// ==========================================================================
// SPAWNING SYSTEM (RANDOM ENCOUNTERS FROM DEEP SPACE)
// ==========================================================================
function spawnEnemy() {
  if (state.mode !== 'PLAYING') return;

  const roll = Math.random();
  const adjustedAsteroidRate = GAME_CONFIG.spawn.asteroidRate * state.difficultyMultiplier;
  const adjustedDroneRate = GAME_CONFIG.spawn.enemyShipRate * state.difficultyMultiplier;

  const scale = state.gameMode === '2D' ? 0.6 : 1.0;

  // Spawn asteroid
  if (roll < adjustedAsteroidRate) {
    const data = createAsteroidMesh();
    // Spawn in random X/Y within playfield, far back in Z
    const rx = (Math.random() - 0.5) * GAME_CONFIG.player.rangeX * 2.2;
    const ry = state.gameMode === '3D' ? (Math.random() - 0.5) * GAME_CONFIG.player.rangeY * 2.2 : 0;
    
    data.mesh.position.set(rx, ry, -280);
    data.mesh.scale.set(scale, scale, scale);
    scene.add(data.mesh);

    // Cache original materials for hit flash
    const originalMaterials = new Map();
    data.mesh.traverse(child => {
      if (child.isMesh) originalMaterials.set(child, child.material);
    });

    enemies.push({
      mesh: data.mesh,
      type: 'ASTEROID',
      radius: data.radius * scale,
      speed: 40 + Math.random() * 50 * state.difficultyMultiplier,
      hp: Math.ceil(data.radius * 2), // Larger rocks need more hits
      maxHp: Math.ceil(data.radius * 2),
      rotationSpeed: {
        x: (Math.random() - 0.5) * 1.5,
        y: (Math.random() - 0.5) * 1.5,
        z: (Math.random() - 0.5) * 1.5
      },
      originalMaterials,
      flashTime: 0
    });
  } 
  // Spawn enemy flight drone
  else if (roll < adjustedAsteroidRate + adjustedDroneRate) {
    const droneMesh = createEnemyDrone();
    const rx = (Math.random() - 0.5) * GAME_CONFIG.player.rangeX * 1.8;
    const ry = state.gameMode === '3D' ? (Math.random() - 0.5) * GAME_CONFIG.player.rangeY * 1.8 : 0;
    
    droneMesh.position.set(rx, ry, -280);
    droneMesh.scale.set(scale, scale, scale);
    scene.add(droneMesh);

    // Cache original materials for hit flash
    const originalMaterials = new Map();
    droneMesh.traverse(child => {
      if (child.isMesh) originalMaterials.set(child, child.material);
    });

    enemies.push({
      mesh: droneMesh,
      type: 'DRONE',
      radius: 1.1 * scale,
      speed: 65 + Math.random() * 45 * state.difficultyMultiplier,
      hp: 2, // 2 HP so player sees hit flash
      maxHp: 2,
      hoverOffset: Math.random() * Math.PI * 2, // Smooth sinusoidal hovering
      rotationSpeed: { x: 0, y: 0, z: (Math.random() - 0.5) * 2 },
      originalMaterials,
      flashTime: 0,
      lastShootTime: performance.now() + Math.random() * 1500 // Delay first shot
    });
  }

  // Spawn Power-up items
  if (Math.random() < GAME_CONFIG.spawn.itemRate) {
    const itemType = Math.random() < 0.6 ? 'SHIELD' : 'WEAPON';
    const itemMesh = createItemMesh(itemType);
    
    const rx = (Math.random() - 0.5) * GAME_CONFIG.player.rangeX * 1.5;
    const ry = state.gameMode === '3D' ? (Math.random() - 0.5) * GAME_CONFIG.player.rangeY * 1.5 : 0;
    
    itemMesh.position.set(rx, ry, -260);
    itemMesh.scale.set(scale, scale, scale);
    scene.add(itemMesh);

    items.push({
      mesh: itemMesh,
      type: itemType,
      speed: 35,
      radius: 1.2 * scale,
      pulseTime: 0
    });
  }
}

// ==========================================================================
// CORE GAME PLAY MECHANICS (FIRE, DAMAGE, SCORE)
// ==========================================================================
function fireLaser() {
  const now = performance.now();
  if (now - state.lastFireTime < GAME_CONFIG.laser.fireRate) return;
  
  state.lastFireTime = now;
  playLaserSound();

  const laserColor = state.weaponLevel === 1 ? 0x00f0ff : (state.weaponLevel === 2 ? 0xffea00 : 0x39ff14);
  const laserMat = new THREE.MeshBasicMaterial({ color: laserColor });
  
  // Dimension of laser bolt
  const laserGeom = new THREE.CylinderGeometry(0.12, 0.12, 4.0, 6);
  laserGeom.rotateX(Math.PI / 2);

  const shipPos = playerGroup.position;
  const launchY = state.gameMode === '3D' ? shipPos.y : 0;
  
  // Get ship current yaw (always 0 in 3D mode)
  const shipYaw = playerGroup.rotation.y;
  const upAxis = new THREE.Vector3(0, 1, 0);
  const scale = state.gameMode === '2D' ? 0.6 : 1.0;

  if (state.weaponLevel === 1 || state.weaponLevel === 3) {
    // Center shot: offset (0, 0, -2) in local space, scaled
    const localOffset = new THREE.Vector3(0, state.gameMode === '3D' ? 0.1 : 0, -2 * scale);
    localOffset.applyAxisAngle(upAxis, shipYaw);

    const laserMesh = new THREE.Mesh(laserGeom, laserMat);
    laserMesh.position.copy(shipPos).add(localOffset);
    laserMesh.rotation.y = shipYaw; // Align cylinder mesh rotation
    laserMesh.scale.set(scale, scale, scale); // Scale laser mesh
    scene.add(laserMesh);
    
    const velocity = new THREE.Vector3(0, 0, -GAME_CONFIG.laser.speed);
    velocity.applyAxisAngle(upAxis, shipYaw);

    lasers.push({
      mesh: laserMesh,
      velocity: velocity
    });
  }

  if (state.weaponLevel >= 2) {
    // Left Cannon local offset, scaled
    const leftOffset = new THREE.Vector3(-2.8 * scale, state.gameMode === '3D' ? -0.1 : 0, -0.5 * scale);
    leftOffset.applyAxisAngle(upAxis, shipYaw);
    
    const leftLaser = new THREE.Mesh(laserGeom, laserMat);
    leftLaser.position.copy(shipPos).add(leftOffset);
    leftLaser.rotation.y = shipYaw;
    leftLaser.scale.set(scale, scale, scale); // Scale laser mesh
    scene.add(leftLaser);
    
    // Right Cannon local offset, scaled
    const rightOffset = new THREE.Vector3(2.8 * scale, state.gameMode === '3D' ? -0.1 : 0, -0.5 * scale);
    rightOffset.applyAxisAngle(upAxis, shipYaw);
    
    const rightLaser = new THREE.Mesh(laserGeom, laserMat);
    rightLaser.position.copy(shipPos).add(rightOffset);
    rightLaser.rotation.y = shipYaw;
    rightLaser.scale.set(scale, scale, scale); // Scale laser mesh
    scene.add(rightLaser);

    // Spread slightly outward in LV3
    const spreadX = state.weaponLevel === 3 ? 6.0 : 0.0;
    
    const leftVelocity = new THREE.Vector3(-spreadX, 0, -GAME_CONFIG.laser.speed);
    leftVelocity.applyAxisAngle(upAxis, shipYaw);
    
    const rightVelocity = new THREE.Vector3(spreadX, 0, -GAME_CONFIG.laser.speed);
    rightVelocity.applyAxisAngle(upAxis, shipYaw);

    lasers.push({
      mesh: leftLaser,
      velocity: leftVelocity
    });
    lasers.push({
      mesh: rightLaser,
      velocity: rightVelocity
    });
  }
}

function triggerScreenFlash(colorRGBA, durationMs) {
  const flash = dom.damageFlashLayer;
  if (!flash) return;
  
  flash.style.display = 'block';
  flash.style.backgroundColor = colorRGBA;
  flash.style.transition = 'none';
  flash.style.opacity = '1';
  
  // Force browser layout reflow
  flash.offsetHeight;
  
  flash.style.transition = `background-color ${durationMs}ms ease-out, opacity ${durationMs}ms ease-out`;
  flash.style.backgroundColor = 'rgba(0,0,0,0)';
  flash.style.opacity = '0';
  
  setTimeout(() => {
    if (flash.style.opacity === '0') {
      flash.style.display = 'none';
    }
  }, durationMs);
}

function damagePlayer(amount) {
  if (state.mode !== 'PLAYING') return;

  state.shield = Math.max(0, state.shield - amount);
  playDamageSound();
  
  // Flash Screen UI Red
  triggerScreenFlash('rgba(255, 0, 85, 0.35)', 250);

  // Camera Shake (Respects mode dimensions)
  const baseCamX = camera.position.x;
  const baseCamY = camera.position.y;
  const baseCamZ = camera.position.z;

  const shakeTimer = setInterval(() => {
    if (state.gameMode === '3D') {
      camera.position.x = baseCamX + (Math.random() - 0.5) * 0.8;
      camera.position.y = baseCamY + (Math.random() - 0.5) * 0.8;
    } else {
      camera.position.x = baseCamX + (Math.random() - 0.5) * 0.8;
      camera.position.z = baseCamZ + (Math.random() - 0.5) * 0.8;
    }
  }, 30);

  setTimeout(() => {
    clearInterval(shakeTimer);
    if (state.gameMode === '3D') {
      camera.position.set(0, 0, 15);
    } else {
      camera.position.set(0, 42, -5);
    }
  }, 250);

  // Downgrade weapon level on hit (adds risk/reward)
  if (state.weaponLevel > 1) {
    state.weaponLevel--;
  }

  updateHUD();

  if (state.shield <= 0) {
    gameOver();
  }
}

function collectPowerup(itemType) {
  playPowerUpSound();
  
  if (itemType === 'SHIELD') {
    state.shield = Math.min(state.maxShield, state.shield + 35);
    addScore(150);
    triggerScreenFlash('rgba(57, 255, 20, 0.15)', 200); // Shiny green flash on recovery
  } else if (itemType === 'WEAPON') {
    state.weaponLevel = Math.min(3, state.weaponLevel + 1);
    addScore(250);
    triggerScreenFlash('rgba(255, 234, 0, 0.15)', 200); // Cyber yellow flash on weapon upgrade
  }
  updateHUD();
}

function addScore(amount) {
  state.score += amount;
  
  // Increase difficulty multiplier slowly based on score
  state.difficultyMultiplier = 1.0 + (state.score / 15000);
  
  updateHUD();
}

// ==========================================================================
// UI & LIFE CYCLE ENGINE
// ==========================================================================
function updateHUD() {
  // Score display padding
  dom.hudScore.textContent = String(state.score).padStart(6, '0');
  
  // Shield percentage and styling warning class
  dom.hudShieldBar.style.width = `${state.shield}%`;
  
  if (state.shield <= 30) {
    dom.hudShieldBar.classList.add('warning');
  } else {
    dom.hudShieldBar.classList.remove('warning');
  }

  // Weapon Level string
  let wName = "LASER LV1";
  let dotColor = '#ffea00';
  if (state.weaponLevel === 2) {
    wName = "DUAL BLASTER";
    dotColor = '#ffea00';
  } else if (state.weaponLevel === 3) {
    wName = "TRIP-BOLT STRIKER";
    dotColor = '#39ff14';
  }
  
  dom.hudWeaponType.textContent = wName;
  dom.weaponStatusDot.style.backgroundColor = dotColor;
  dom.weaponStatusDot.style.boxShadow = `0 0 10px ${dotColor}`;
}

function startGame(mode = '3D') {
  console.log("startGame: Launching game in mode: " + mode);
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  state.mode = 'PLAYING';
  state.gameMode = mode;
  state.score = 0;
  state.kills = 0;
  state.shield = 100;
  state.weaponLevel = 1;
  state.difficultyMultiplier = 1.0;
  
  updateHUD();

  // Clear existing scene elements
  enemies.forEach(e => scene.remove(e.mesh));
  enemies.length = 0;
  lasers.forEach(l => scene.remove(l.mesh));
  lasers.length = 0;
  enemyProjectiles.forEach(p => scene.remove(p.mesh));
  enemyProjectiles.length = 0;
  items.forEach(i => scene.remove(i.mesh));
  items.length = 0;
  explosions.forEach(exp => scene.remove(exp.points));
  explosions.length = 0;

  // Add/Reset Player Ship
  if (!playerGroup) {
    playerGroup = createPlayerShip();
  }

  // Camera Cinematic Intro setup
  cameraIntro.active = true;
  cameraIntro.timer = 0;

  if (state.gameMode === '3D') {
    scene.fog = new THREE.FogExp2(0x06060e, 0.0035);
    
    // Start camera far away and high up
    cameraIntro.startPos.set(0, 22, 50);
    cameraIntro.endPos.set(0, 0, 15);
    
    camera.position.copy(cameraIntro.startPos);
    playerGroup.position.set(0, 0, 15); // Start far back to glide in
    playerGroup.scale.set(1.0, 1.0, 1.0); // Full size in 3D
  } else {
    // 2D Top-Down Mode
    scene.fog = null;
    
    // Start camera high up in orbit
    cameraIntro.startPos.set(0, 95, 20);
    cameraIntro.endPos.set(0, 42, -5);
    
    camera.position.copy(cameraIntro.startPos);
    playerGroup.position.set(0, 0, 15); // Start far back to glide in
    playerGroup.scale.set(0.6, 0.6, 0.6); // Compact size in 2D
  }
  
  playerGroup.rotation.set(0, 0, 0);
  scene.add(playerGroup);

  // Transitions UI
  dom.titleScreen.classList.remove('active');
  dom.gameoverScreen.classList.remove('active');
  dom.hud.classList.add('active');

  // Short cool transition
  let rollStart = 0;
  const launchAnim = () => {
    if (state.mode !== 'PLAYING') return;
    rollStart += 0.15;
    if (rollStart < Math.PI * 2) {
      if (state.gameMode === '3D') {
        playerGroup.rotation.z = rollStart;
      } else {
        playerGroup.rotation.y = rollStart;
      }
      requestAnimationFrame(launchAnim);
    } else {
      playerGroup.rotation.set(0, 0, 0);
    }
  };
  launchAnim();

  // Re-align stars based on mode
  resetStarfieldForMode();
}

function resetStarfieldForMode() {
  if (!starGeometry) return;
  const posArr = starGeometry.attributes.position.array;
  const count = GAME_CONFIG.starfield.count;

  for (let i = 0; i < count; i++) {
    if (state.gameMode === '3D') {
      const angle = Math.random() * Math.PI * 2;
      const radius = 10 + Math.random() * 90;
      posArr[i * 3] = Math.cos(angle) * radius;
      posArr[i * 3 + 1] = Math.sin(angle) * radius;
      posArr[i * 3 + 2] = -Math.random() * GAME_CONFIG.starfield.depth;
    } else {
      // 2D Mode: Distribute stars on a flat plane below the player (Y = -15)
      posArr[i * 3] = (Math.random() - 0.5) * 80;
      posArr[i * 3 + 1] = -15; // Flat plane below gameplay
      posArr[i * 3 + 2] = -Math.random() * GAME_CONFIG.starfield.depth;
    }
  }
  starGeometry.attributes.position.needsUpdate = true;
}

function gameOver() {
  state.mode = 'GAMEOVER';
  playGameOverSound();
  
  // Register Highscore
  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem('neon_starfighter_high', state.highScore);
  }

  // Large firey explosion at player death
  spawnExplosion(playerGroup.position, 0xff0055, 75);
  scene.remove(playerGroup);

  // Update Game Over Result HUD
  dom.gameoverScore.textContent = String(state.score).padStart(6, '0');
  dom.gameoverKills.textContent = state.kills;
  dom.gameoverHighScore.textContent = String(state.highScore).padStart(6, '0');

  // UI State toggling
  dom.hud.classList.remove('active');
  dom.gameoverScreen.classList.add('active');
}

// ==========================================================================
// KEYBOARD CONTROLLER & MOUSE BINDINGS
// ==========================================================================
function setupControls() {
  // Keyboard Listeners
  window.addEventListener('keydown', (e) => {
    let key = e.key;
    if (key === ' ') key = 'Space';
    
    if (key in keys) {
      keys[key] = true;
      e.preventDefault(); // Stop scrolling with arrows/space
    }

    if (e.key === 'Enter') {
      if (state.mode === 'TITLE' || state.mode === 'GAMEOVER') {
        startGame(state.gameMode || '3D');
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    let key = e.key;
    if (key === ' ') key = 'Space';
    
    if (key in keys) {
      keys[key] = false;
    }
  });

  // Unified Pointer (Mouse/Touch) Controls for Mobile & Desktop Drag-to-Move
  const handlePointerDown = (e) => {
    if (state.mode !== 'PLAYING' || cameraIntro.active) return;
    // Don't intercept UI button clicks
    if (e.target.closest('button') || e.target.closest('.menu-panel')) return;
    
    initAudio();
    pointerControl.active = true;
    keys.Space = true; // Auto-fire while dragging
    updatePointerTarget(e);
  };

  const handlePointerMove = (e) => {
    if (!pointerControl.active) return;
    updatePointerTarget(e);
  };

  const handlePointerUp = () => {
    pointerControl.active = false;
    keys.Space = false;
  };

  function updatePointerTarget(e) {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    
    pointerControl.targetX = nx * GAME_CONFIG.player.rangeX * 1.35;
    if (state.gameMode === '3D') {
      pointerControl.targetY = -ny * GAME_CONFIG.player.rangeY * 1.25;
    } else {
      // Map vertical screen coordinate ny [-1, 1] to Z bounds [-25, 8]
      pointerControl.targetY = ny * 16.5 - 8.5;
    }
  }

  window.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);

  // Screen interactive click buttons
  console.log("setupControls: Binding btnStart3d: " + !!dom.btnStart3d);
  dom.btnStart3d.addEventListener('click', () => {
    console.log("setupControls: btnStart3d clicked!");
    startGame('3D');
  });

  dom.btnStart2d.addEventListener('click', () => {
    console.log("setupControls: btnStart2d clicked!");
    startGame('2D');
  });

  dom.btnRestart3d.addEventListener('click', () => {
    startGame('3D');
  });

  dom.btnRestart2d.addEventListener('click', () => {
    startGame('2D');
  });

  // Display highscore on Title Screen initially
  dom.titleHighScore.textContent = String(state.highScore).padStart(6, '0');
}

// ==========================================================================
// CORE RECURSIVE RENDER LOOP
// ==========================================================================
function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // Clamp delta time to avoid huge leaps
  
  if (state.mode === 'PLAYING') {
    if (cameraIntro.active) {
      updateCameraIntro(dt);
      
      // Auto-glide ship forward from bottom during cinematic camera entrance
      if (playerGroup) {
        // Smoothly bring ship from starting Z position (15) to Z=0 position
        playerGroup.position.z = THREE.MathUtils.lerp(playerGroup.position.z, 0, 4 * dt);
        updateEngineFlame(dt, playerGroup.position);
      }
    } else {
      handlePlayerMovement(dt);
      
      if (keys.Space) {
        fireLaser();
      }
      
      spawnEnemy();
    }
  }

  // Universal Updates running regardless of game mode
  updateStarfield(dt);
  updateLasers(dt);
  updateEnemies(dt);
  updateEnemyProjectiles(dt); // Run enemy bullet movements & hits
  updateItems(dt);
  updateExplosions(dt);

  // Render Scene
  renderer.render(scene, camera);

  // Expose debug hooks for automated tests
  window.gameDebug = {
    playerGroup,
    lasers,
    enemies,
    state,
    keys
  };
}

/**
 * Handle smoothing movement of player based on buttons pressed
 */
function handlePlayerMovement(dt) {
  if (!playerGroup) return;

  let moveX = 0;
  let moveY = 0; // In 2D mode, this maps to Z axis movement

  if (pointerControl.active) {
    // POINTER/DRAG CONTROLS (for Mobile and Drag-to-Move)
    const lerpFactor = 7.0 * dt; // Smooth follow factor
    
    const targetX = Math.max(-GAME_CONFIG.player.rangeX, Math.min(GAME_CONFIG.player.rangeX, pointerControl.targetX));
    
    if (state.gameMode === '3D') {
      const targetY = Math.max(-GAME_CONFIG.player.rangeY, Math.min(GAME_CONFIG.player.rangeY, pointerControl.targetY));
      
      const newX = THREE.MathUtils.lerp(playerGroup.position.x, targetX, lerpFactor);
      const newY = THREE.MathUtils.lerp(playerGroup.position.y, targetY, lerpFactor);
      
      moveX = (newX - playerGroup.position.x) / (GAME_CONFIG.player.speed * dt || 0.001);
      moveY = (newY - playerGroup.position.y) / (GAME_CONFIG.player.speed * dt || 0.001);
      
      playerGroup.position.x = newX;
      playerGroup.position.y = newY;
      playerGroup.position.z = 0;
    } else {
      // 2D Mode: targetY controls the Z coordinate
      const targetZ = Math.max(-25, Math.min(8, pointerControl.targetY));
      
      const newX = THREE.MathUtils.lerp(playerGroup.position.x, targetX, lerpFactor);
      const newZ = THREE.MathUtils.lerp(playerGroup.position.z, targetZ, lerpFactor);
      
      // Calculate movement vector direction for ship yaw facing angle
      const dx = newX - playerGroup.position.x;
      const dz = newZ - playerGroup.position.z;
      const moveLen = Math.sqrt(dx * dx + dz * dz);
      
      if (moveLen > 0.015) {
        // Point towards the finger/mouse drag direction smoothly
        const targetAngle = Math.atan2(-dx, -dz);
        playerGroup.rotation.y = THREE.MathUtils.lerp(playerGroup.rotation.y, targetAngle, 8.0 * dt);
      }
      
      moveX = dx / (GAME_CONFIG.player.speed * dt || 0.001);
      moveY = -dz / (GAME_CONFIG.player.speed * dt || 0.001);
      
      playerGroup.position.x = newX;
      playerGroup.position.z = newZ;
      playerGroup.position.y = 0;
    }
    
    // Clamp simulated inputs for tilts
    moveX = Math.max(-1.0, Math.min(1.0, moveX));
    moveY = Math.max(-1.0, Math.min(1.0, moveY));
  } else {
    // STANDARD KEYBOARD CONTROLS
    if (keys.a || keys.ArrowLeft)  moveX = -1;
    if (keys.d || keys.ArrowRight) moveX = 1;
    if (keys.w || keys.ArrowUp)    moveY = 1;  // Moves forward/up-screen (Z-)
    if (keys.s || keys.ArrowDown)  moveY = -1; // Moves backward/down-screen (Z+)

    if (state.gameMode === '3D') {
      // 3D Mode: Move on XY Plane
      const targetX = playerGroup.position.x + moveX * GAME_CONFIG.player.speed * dt;
      const targetY = playerGroup.position.y + moveY * GAME_CONFIG.player.speed * dt;

      // Clamp target positions strictly to visible bounds
      playerGroup.position.x = Math.max(-GAME_CONFIG.player.rangeX, Math.min(GAME_CONFIG.player.rangeX, targetX));
      playerGroup.position.y = Math.max(-GAME_CONFIG.player.rangeY, Math.min(GAME_CONFIG.player.rangeY, targetY));
      playerGroup.position.z = 0;
    } else {
      // 2D Top-Down Mode
      if (keys.Space) {
        // Angled Firing active: Left/Right keys rotate target yaw direction (no sliding)
        const rotateSpeed = 3.2; // Radians per second
        playerGroup.rotation.y += -moveX * rotateSpeed * dt;
        
        // Forward/backward keyboard moves remain active
        const targetZ = playerGroup.position.z - moveY * GAME_CONFIG.player.speed * dt;
        playerGroup.position.z = Math.max(-25, Math.min(8, targetZ));
        playerGroup.position.y = 0;
      } else {
        // Standard non-firing 2D movement
        const targetX = playerGroup.position.x + moveX * GAME_CONFIG.player.speed * dt;
        const targetZ = playerGroup.position.z - moveY * GAME_CONFIG.player.speed * dt;

        playerGroup.position.x = Math.max(-GAME_CONFIG.player.rangeX, Math.min(GAME_CONFIG.player.rangeX, targetX));
        playerGroup.position.z = Math.max(-25, Math.min(8, targetZ));
        playerGroup.position.y = 0;
      }
    }
  }

  // Common rotation and sway calculations
  if (state.gameMode === '3D') {
    const targetRoll = -moveX * GAME_CONFIG.player.rollLimit;
    const targetPitch = moveY * GAME_CONFIG.player.pitchLimit;

    // Smooth lerp angles for sleek space flight control feel
    playerGroup.rotation.z = THREE.MathUtils.lerp(playerGroup.rotation.z, targetRoll, GAME_CONFIG.player.lerpSpeed * dt);
    playerGroup.rotation.x = THREE.MathUtils.lerp(playerGroup.rotation.x, targetPitch, GAME_CONFIG.player.lerpSpeed * dt);
    playerGroup.rotation.y = THREE.MathUtils.lerp(playerGroup.rotation.y, 0, GAME_CONFIG.player.lerpSpeed * dt);

    // Subtle natural hovering sway (sine wave overlay on Y)
    const hoverOffset = Math.sin(performance.now() * 0.0035) * 0.15;
    playerGroup.position.y += hoverOffset * dt * 6;
  } else {
    // 2D Mode rotations
    if (pointerControl.active) {
      // Flat roll/pitch stability during pointer drag
      playerGroup.rotation.z = THREE.MathUtils.lerp(playerGroup.rotation.z, 0, 8.0 * dt);
      playerGroup.rotation.x = THREE.MathUtils.lerp(playerGroup.rotation.x, 0, 8.0 * dt);
    } else if (keys.Space) {
      // Flat roll/pitch stability while rotating/firing
      playerGroup.rotation.z = THREE.MathUtils.lerp(playerGroup.rotation.z, 0, GAME_CONFIG.player.lerpSpeed * dt);
      playerGroup.rotation.x = THREE.MathUtils.lerp(playerGroup.rotation.x, 0, GAME_CONFIG.player.lerpSpeed * dt);
    } else {
      // Standard movement banking angles
      const targetRoll = -moveX * GAME_CONFIG.player.rollLimit * 0.8;
      const targetYaw = moveX * 0.15;

      playerGroup.rotation.z = THREE.MathUtils.lerp(playerGroup.rotation.z, targetRoll, GAME_CONFIG.player.lerpSpeed * dt);
      playerGroup.rotation.x = THREE.MathUtils.lerp(playerGroup.rotation.x, 0, GAME_CONFIG.player.lerpSpeed * dt);
      
      // Auto-align back to center forward yaw (0) when not firing, plus current turn direction banking
      const baseYaw = THREE.MathUtils.lerp(playerGroup.rotation.y, 0, 5.0 * dt);
      playerGroup.rotation.y = baseYaw + targetYaw;
    }
  }

  // Update dynamic fire plume particles behind jet nozzles
  updateEngineFlame(dt, playerGroup.position);
}

/**
 * Scroll stars in background towards the screen to give warp velocity illusion
 */
function updateStarfield(dt) {
  const posArr = starGeometry.attributes.position.array;
  const warpMultiplier = state.mode === 'PLAYING' ? 1.0 : 0.25; // Slower in menus
  
  for (let i = 0; i < GAME_CONFIG.starfield.count; i++) {
    // Access Z element (3rd element in 3-coord tuple)
    let zIdx = i * 3 + 2;
    posArr[zIdx] += GAME_CONFIG.starfield.speed * warpMultiplier * dt;
    
    // If star flies past camera viewport, recycle it to far back tunnel
    if (posArr[zIdx] > 15) {
      posArr[zIdx] = -GAME_CONFIG.starfield.depth;
    }
  }
  
  starGeometry.attributes.position.needsUpdate = true;
}

/**
 * Update laser positions and manage lifecycle
 */
function updateLasers(dt) {
  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];
    laser.mesh.position.addScaledVector(laser.velocity, dt);

    // Remove off-screen lasers
    if (laser.mesh.position.z < -280) {
      scene.remove(laser.mesh);
      laser.mesh.geometry.dispose();
      laser.mesh.material.dispose();
      lasers.splice(i, 1);
    }
  }
}

/**
 * Update enemy drone and asteroid movements, spin, collisions
 */
function updateEnemies(dt) {
  const now = performance.now();

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    
    // Basic progression toward camera
    enemy.mesh.position.z += enemy.speed * dt;

    // Custom movements:
    if (enemy.type === 'DRONE') {
      // Hovering horizontal wiggle
      enemy.hoverOffset += 4 * dt;
      enemy.mesh.position.x += Math.sin(enemy.hoverOffset) * 8 * dt;
      
      // Face towards player slightly
      enemy.mesh.rotation.y = Math.sin(enemy.hoverOffset) * 0.4;

      // Enemy drone shooting logic (only if active in screen view and player is playing)
      if (state.mode === 'PLAYING' && enemy.mesh.position.z > -220 && enemy.mesh.position.z < -20 && !cameraIntro.active) {
        const shootInterval = 2200 / state.difficultyMultiplier;
        if (now - enemy.lastShootTime > shootInterval) {
          enemy.lastShootTime = now;
          spawnEnemyProjectile(enemy.mesh.position);
        }
      }
    } else {
      // Asteroids rotate chaoticly
      enemy.mesh.rotation.x += enemy.rotationSpeed.x * dt;
      enemy.mesh.rotation.y += enemy.rotationSpeed.y * dt;
      enemy.mesh.rotation.z += enemy.rotationSpeed.z * dt;
    }

    // Update hit flash timer
    if (enemy.flashTime > 0) {
      enemy.flashTime -= dt;
      if (enemy.flashTime <= 0) {
        // Restore original materials
        enemy.mesh.traverse(child => {
          if (child.isMesh && enemy.originalMaterials && enemy.originalMaterials.has(child)) {
            child.material = enemy.originalMaterials.get(child);
          }
        });
      }
    }

    // Check boundary cleanup
    if (enemy.mesh.position.z > 20) {
      scene.remove(enemy.mesh);
      enemies.splice(i, 1);
      continue;
    }

    // COLLISION DETECTION 1: Enemy vs Player
    if (state.mode === 'PLAYING' && playerGroup && !cameraIntro.active) {
      const dist = enemy.mesh.position.distanceTo(playerGroup.position);
      // Average collision boundary threshold
      const colRadius = enemy.type === 'ASTEROID' ? enemy.radius + 1.2 : 2.0;
      
      if (dist < colRadius) {
        // Boom!
        spawnExplosion(enemy.mesh.position, enemy.type === 'ASTEROID' ? 0x8b5a2b : 0xff0055, 30);
        
        // Take major shield damage
        const damage = enemy.type === 'ASTEROID' ? Math.round(enemy.radius * 12) : 25;
        damagePlayer(damage);

        scene.remove(enemy.mesh);
        enemies.splice(i, 1);
        continue;
      }
    }

    // COLLISION DETECTION 2: Enemy vs Player Lasers
    let enemyDestroyed = false;
    for (let j = lasers.length - 1; j >= 0; j--) {
      const laser = lasers[j];
      const distToLaser = enemy.mesh.position.distanceTo(laser.mesh.position);
      
      // Laser hits enemy (scaled in 2D)
      const scale = state.gameMode === '2D' ? 0.6 : 1.0;
      const hitLimit = enemy.type === 'ASTEROID' ? enemy.radius + 0.8 * scale : 1.3 * scale;
      if (distToLaser < hitLimit) {
        // Create small impact spark
        spawnExplosion(laser.mesh.position, 0x00f0ff, 8);
        
        // Destroy laser
        scene.remove(laser.mesh);
        laser.mesh.geometry.dispose();
        laser.mesh.material.dispose();
        lasers.splice(j, 1);

        // Deduct health
        enemy.hp--;
        enemy.flashTime = 0.08; // Flash for 80ms
        
        // Swap material to solid white MeshBasicMaterial
        const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        enemy.mesh.traverse(child => {
          if (child.isMesh) child.material = whiteMat;
        });
        
        if (enemy.hp <= 0) {
          // Total annihilation
          const boomColor = enemy.type === 'ASTEROID' ? 0xb58960 : 0xff0055;
          spawnExplosion(enemy.mesh.position, boomColor, enemy.type === 'ASTEROID' ? 25 : 35);
          playExplosionSound();
          
          // White blast screen flash (adds huge visual crunch!)
          triggerScreenFlash('rgba(255, 255, 255, 0.12)', 100);
          
          scene.remove(enemy.mesh);
          enemies.splice(i, 1);
          
          // Stats updates
          state.kills++;
          const scoreGained = enemy.type === 'ASTEROID' ? 100 : 250;
          addScore(scoreGained);

          enemyDestroyed = true;
        }
        break; // Stop laser checking on this enemy
      }
    }

    if (enemyDestroyed) continue;
  }
}

// ==========================================================================
// ENEMY PROJECTILES (PLASMA BULLETS FOR DRONES)
// ==========================================================================
function spawnEnemyProjectile(position) {
  const geom = new THREE.SphereGeometry(0.45, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(position);
  
  const scale = state.gameMode === '2D' ? 0.6 : 1.0;
  mesh.scale.set(scale, scale, scale); // Scale enemy bullet size
  scene.add(mesh);

  const velocity = new THREE.Vector3();
  velocity.subVectors(playerGroup.position, position);
  
  if (state.gameMode === '2D') {
    velocity.y = 0; // Lock to flat 2D plane
  }
  
  velocity.normalize().multiplyScalar(42 + state.difficultyMultiplier * 5); // Speed increases with difficulty

  enemyProjectiles.push({ mesh, velocity });
}

function updateEnemyProjectiles(dt) {
  const scale = state.gameMode === '2D' ? 0.6 : 1.0;

  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const proj = enemyProjectiles[i];
    proj.mesh.position.addScaledVector(proj.velocity, dt);

    // Boundary cleanup
    if (proj.mesh.position.z > 25 || proj.mesh.position.z < -300) {
      scene.remove(proj.mesh);
      proj.mesh.geometry.dispose();
      proj.mesh.material.dispose();
      enemyProjectiles.splice(i, 1);
      continue;
    }

    // Collision check: Projectile vs Player (scaled threshold in 2D)
    if (state.mode === 'PLAYING' && playerGroup && !cameraIntro.active) {
      const dist = proj.mesh.position.distanceTo(playerGroup.position);
      const hitLimit = 1.7 * scale;
      if (dist < hitLimit) {
        // Red impact explosion
        spawnExplosion(proj.mesh.position, 0xff0055, 12);
        
        damagePlayer(12); // Take shield hit

        scene.remove(proj.mesh);
        proj.mesh.geometry.dispose();
        proj.mesh.material.dispose();
        enemyProjectiles.splice(i, 1);
      }
    }
  }
}

// ==========================================================================
// CINEMATIC INTRO TRANSITION ENGINE
// ==========================================================================
function updateCameraIntro(dt) {
  if (!cameraIntro.active) return;

  cameraIntro.timer += dt;
  const pct = Math.min(1.0, cameraIntro.timer / cameraIntro.duration);

  // Smooth cubic deceleration (ease-out-cubic)
  const t = 1 - Math.pow(1 - pct, 3);

  camera.position.lerpVectors(cameraIntro.startPos, cameraIntro.endPos, t);
  
  if (state.gameMode === '3D') {
    camera.lookAt(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z - 3);
  } else {
    // 2D look down
    camera.lookAt(playerGroup.position.x, 0, playerGroup.position.z - 5);
  }

  // Stop intro when done
  if (pct >= 1.0) {
    cameraIntro.active = false;
    
    // Lock to precise positions
    if (state.gameMode === '3D') {
      camera.position.set(0, 0, 15);
      camera.rotation.set(0, 0, 0);
    } else {
      camera.position.set(0, 42, -5);
      camera.rotation.set(-Math.PI / 2, 0, 0);
    }
  }
}

/**
 * Powerups floating towards the screen
 */
function updateItems(dt) {
  const baseScale = state.gameMode === '2D' ? 0.6 : 1.0;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    item.mesh.position.z += item.speed * dt;
    
    // Rotate items to make them look alive
    item.mesh.rotation.y += 2.0 * dt;
    item.mesh.rotation.x += 1.0 * dt;

    // Sine pulsation size scaling, respecting baseScale
    item.pulseTime += dt;
    const pulse = baseScale * (1.0 + Math.sin(item.pulseTime * 6) * 0.15);
    item.mesh.scale.set(pulse, pulse, pulse);

    // Boundary cleanup
    if (item.mesh.position.z > 20) {
      scene.remove(item.mesh);
      items.splice(i, 1);
      continue;
    }

    // Collision Detection: Item vs Player (scaled threshold in 2D)
    if (state.mode === 'PLAYING' && playerGroup) {
      const dist = item.mesh.position.distanceTo(playerGroup.position);
      const collectRadius = 2.0 * baseScale;
      if (dist < collectRadius) {
        // Collect!
        collectPowerup(item.type);
        
        // Mini sparks
        const sparkColor = item.type === 'SHIELD' ? 0x39ff14 : 0xffea00;
        spawnExplosion(item.mesh.position, sparkColor, 10);

        scene.remove(item.mesh);
        items.splice(i, 1);
      }
    }
  }
}

/**
 * Handle lifecycle and fading of explosion points
 */
function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const exp = explosions[i];
    exp.life += dt;
    
    if (exp.life >= exp.maxLife) {
      scene.remove(exp.points);
      exp.points.geometry.dispose();
      exp.points.material.dispose();
      explosions.splice(i, 1);
    } else {
      // Diffuse points outward
      const posAttr = exp.points.geometry.attributes.position;
      const count = posAttr.count;
      
      for (let j = 0; j < count; j++) {
        let x = posAttr.getX(j) + exp.velocities[j * 3] * dt;
        let y = posAttr.getY(j) + exp.velocities[j * 3 + 1] * dt;
        let z = posAttr.getZ(j) + exp.velocities[j * 3 + 2] * dt;
        
        posAttr.setXYZ(j, x, y, z);
        
        // Apply slight gravity/friction to explosions
        exp.velocities[j * 3] *= 0.96;
        exp.velocities[j * 3 + 1] *= 0.96;
        exp.velocities[j * 3 + 2] *= 0.96;
      }
      
      posAttr.needsUpdate = true;
      
      // Fade transparency
      const pct = exp.life / exp.maxLife;
      exp.points.material.opacity = 1.0 - pct;
    }
  }
}

// ==========================================================================
// SYSTEM INITIATION
// ==========================================================================
function initGameSystem() {
  console.log("initGameSystem: Starting initial sync...");
  try {
    initScene();
    console.log("initGameSystem: initScene completed.");
    setupControls();
    console.log("initGameSystem: setupControls completed.");
    animate();
    console.log("initGameSystem: animate loop running.");
  } catch (err) {
    console.error("initGameSystem error during startup:", err);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initGameSystem);
} else {
  initGameSystem();
}
