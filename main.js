// ==================== IMPORTS ====================
import * as THREE from './asset/three.module.js';
import { OrbitControls } from './asset/OrbitControls.js';
import CSG from './asset/three-csg.js';

// ==================== GLOBALS ====================
let scene, camera, renderer, controls;

// array to update door pivots each frame
const doorPivots = [];

// ==================== INIT ====================
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(10, 10, 15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(5, 0, 5);
  controls.update();

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('click', onClick);

  animate();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);

  // update door pivots (smooth lerp)
  for (const dp of doorPivots) {
    const cur = dp.rotation.y;
    const target = dp.userData.targetAngle;
    // simple lerp
    dp.rotation.y = THREE.MathUtils.lerp(cur, target, 0.18);
  }

  controls.update();
  renderer.render(scene, camera);
}

// ==================== HELPERS ====================
function pointAlongWall(from, to, offset) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.sqrt(dx * dx + dz * dz);
  return [from[0] + (dx / length) * offset, from[1] + (dz / length) * offset];
}

// ==================== WALLS ====================
function createWallWithOpenings(from, to, height, thickness, openings = []) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.sqrt(dx * dx + dz * dz);

  // base wall mesh
  const wallGeom = new THREE.BoxGeometry(length, height, thickness);
  const wallMat = new THREE.MeshPhongMaterial({ color: 0x999999 });
  const wall = new THREE.Mesh(wallGeom, wallMat);

  // rotation math
  const angle = Math.atan2(dz, dx); // angle along +X
  wall.position.set((from[0] + to[0]) / 2, height / 2, (from[1] + to[1]) / 2);
  wall.rotation.y = -angle; // negative because world Z/X orientation
  wall.updateMatrix();

  // convert to CSG
  let wallCSG = CSG.fromMesh(wall);

  // process openings
  openings.forEach(op => {
    // compute hole placement
    const pos = pointAlongWall(from, to, op.offset);

    // default sill (windows) or ground (doors)
    const sill = (op.sill !== undefined) ? op.sill : (op.type === 'window' ? 1 : 0);

    // create hole (centered at pos.x,pos.z but lifted by sill)
    const holeGeom = new THREE.BoxGeometry(op.width, op.height, thickness + 0.05);
    const hole = new THREE.Mesh(holeGeom);
    hole.position.set(pos[0], sill + op.height / 2, pos[1]);
    hole.rotation.y = -angle;
    hole.updateMatrix();

    wallCSG = wallCSG.subtract(CSG.fromMesh(hole));

    // ---------- create visible door or window meshes ----------
    if (op.type === 'door') {
      // door depth ~ wall thickness * 0.9
      const doorDepth = Math.max(0.02, thickness * 0.9);
      const doorGeom = new THREE.BoxGeometry(op.width, op.height, doorDepth);
      const doorMat = new THREE.MeshPhongMaterial({ color: 0x8b4513 });
      const doorMesh = new THREE.Mesh(doorGeom, doorMat);

      // We want hinge on the LEFT edge (when looking at hole from outside along wall direction).
      // Approach: place a pivot at the hinge edge, rotate pivot, and inside pivot place doorMesh offset so it occupies the hole.
      // doorMesh is centered at its geometry center; to move mesh so hinge aligns, we offset doorMesh along local X by +op.width/2
      doorMesh.position.set(op.width / 2, 0, 0); // local to pivot

      // small inward offset to sit inside the wall thickness
      const inset = (thickness - doorDepth) / 2; // how much the door should be pushed into the wall
      doorMesh.position.z = -inset; // negative along local Z to go into wall

      // create pivot group
      const doorPivot = new THREE.Group();
      doorPivot.add(doorMesh);

      // compute hinge world position: hinge is at hole center minus half-width along wall direction
      const hingeWorldX = pos[0] - Math.cos(angle) * (op.width / 2);
      const hingeWorldZ = pos[1] - Math.sin(angle) * (op.width / 2);
      const hingeWorldY = sill + op.height / 2;

      doorPivot.position.set(hingeWorldX, hingeWorldY, hingeWorldZ);

      // set pivot base rotation to align with wall
      const baseRotation = -angle;
      doorPivot.rotation.y = baseRotation;

      // userData for animation: closed = baseRotation, open = baseRotation + swing (default +90deg)
      const swing = (op.hinge === 'right') ? -Math.PI / 2 : Math.PI / 2; // allow JSON override hinge:right
      doorPivot.userData = {
        closedAngle: baseRotation,
        openAngle: baseRotation + swing,
        targetAngle: baseRotation,
        isOpen: false
      };

      // use name so click traversal can detect it
      doorPivot.name = 'doorPivot';

      // add to scene & tracking array for animation updates
      scene.add(doorPivot);
      doorPivots.push(doorPivot);
    }

    if (op.type === 'window') {
      const winGeom = new THREE.BoxGeometry(op.width, op.height, 0.05);
      const winMat = new THREE.MeshPhongMaterial({ color: 0x87ceeb, transparent: true, opacity: 0.5 });
      const win = new THREE.Mesh(winGeom, winMat);
      win.position.set(pos[0], sill + op.height / 2, pos[1]);
      win.rotation.y = -angle;
      scene.add(win);
    }
  });

  // return final wall mesh from CSG
  const finalWall = CSG.toMesh(wallCSG, wall.matrix, wall.material);
  finalWall.castShadow = true;
  finalWall.receiveShadow = true;
  return finalWall;
}

// ==================== FLOOR ====================
function createFloor(points) {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshPhongMaterial({
    color: 0xe0e0e0,
    side: THREE.DoubleSide
  });

  // Place geometry directly in XZ plane
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = Math.PI / 2; // flip to XZ plane
  floor.position.y = 0.01; // small lift so it doesn’t Z-fight with walls

  scene.add(floor);
  return floor;
}


// ==================== BUILD FROM JSON ====================
function buildFromBlueprint(bp) {
  const h = bp.wallHeight;
  const t = bp.wallThickness;

  bp.rooms.forEach(room => {
    // add walls
    room.walls.forEach(w => {
      const wallMesh = createWallWithOpenings(w.from, w.to, h, t, w.openings || []);
      scene.add(wallMesh);
    });

    // add floor if provided
    if (room.floor) {
      createFloor(room.floor);
    }
  });
}

// ==================== CLICK HANDLING (doors) ====================
function onClick(event) {
  const mouse = new THREE.Vector2(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  // we want to detect door meshes too (they are children of doorPivot)
  const intersects = raycaster.intersectObjects(scene.children, true);
  if (intersects.length === 0) return;

  let obj = intersects[0].object;
  // climb up parents to find a doorPivot
  while (obj && obj.parent) {
    if (obj.parent.name === 'doorPivot') {
      obj = obj.parent;
      break;
    }
    obj = obj.parent;
  }

  if (obj && obj.name === 'doorPivot') {
    // toggle target angle
    const dp = obj;
    if (dp.userData) {
      dp.userData.isOpen = !dp.userData.isOpen;
      dp.userData.targetAngle = dp.userData.isOpen ? dp.userData.openAngle : dp.userData.closedAngle;
    }
  }
}

// ==================== LOAD JSON ====================
fetch('./example2.json')
  .then(res => res.json())
  .then(data => {
    init();
    buildFromBlueprint(data);
  })
  .catch(err => console.error("Error loading JSON:", err));
