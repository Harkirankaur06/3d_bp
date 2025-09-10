// ==================== IMPORTS ====================
import * as THREE from './asset/three.module.js';
import { OrbitControls } from './asset/OrbitControls.js';
import CSG from './asset/three-csg.js';

// ==================== GLOBALS ====================
let scene, camera, renderer, controls;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let clickableObjects = [];

// ==================== INIT ====================
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(15, 20, 25);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(5, 0, 5);
  controls.update();

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Resize & click
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
  controls.update();
  renderer.render(scene, camera);
}

// ==================== HELPERS ====================

// Floor
function createFloor(points) {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshPhongMaterial({ color: 0xe0e0e0, side: THREE.DoubleSide });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  return floor;
}

// Wall with CSG for doors/windows
function createWallWithOpenings(from, to, height, thickness, openings = []) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.sqrt(dx*dx + dz*dz);

  const wallGeom = new THREE.BoxGeometry(length, height, thickness);
  const wallMat = new THREE.MeshPhongMaterial({ color: 0x999999 });
  let wall = new THREE.Mesh(wallGeom, wallMat);

  wall.position.set((from[0] + to[0]) / 2, height / 2, (from[1] + to[1]) / 2);
  wall.rotation.y = Math.atan2(dz, dx);
  wall.updateMatrix();

  let wallCSG = CSG.fromMesh(wall);

  openings.forEach(op => {
    const holeGeom = new THREE.BoxGeometry(op.width, op.height, thickness + 0.05);
    const hole = new THREE.Mesh(holeGeom);
    hole.position.set(op.at[0], op.height / 2, op.at[1]);
    hole.rotation.y = wall.rotation.y;
    hole.updateMatrix();

    wallCSG = wallCSG.subtract(CSG.fromMesh(hole));
  });

  // Pass wall.matrix here, material as third argument
  wall = CSG.toMesh(wallCSG, wall.matrix, wallMat);
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);
  return wall;
}

// Simple wall
function createWall(from, to, height, thickness) {
  return createWallWithOpenings(from, to, height, thickness, []);
}

// Doors
function createDoor(at, width, height) {
  const geometry = new THREE.BoxGeometry(width, height, 0.1);
  const material = new THREE.MeshPhongMaterial({ color: 0x8b4513 });
  const door = new THREE.Mesh(geometry, material);
  door.position.set(at[0], height / 2, at[1]);
  door.userData.type = "door";
  door.userData.isOpen = false;
  clickableObjects.push(door);
  scene.add(door);
  return door;
}

// Windows
function createWindow(at, width, height) {
  const geometry = new THREE.BoxGeometry(width, height, 0.05);
  const material = new THREE.MeshPhongMaterial({
    color: 0x87ceeb,
    opacity: 0.6,
    transparent: true
  });
  const win = new THREE.Mesh(geometry, material);
  win.position.set(at[0], height / 2 + 1.2, at[1]);
  win.userData.type = "window";
  clickableObjects.push(win);
  scene.add(win);
  return win;
}

// ==================== INTERACTIVITY ====================
function onClick(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(clickableObjects, true);

  if (intersects.length > 0) {
    const obj = intersects[0].object;
    if (obj.userData.type === "door") {
      obj.rotation.y += obj.userData.isOpen ? -Math.PI / 2 : Math.PI / 2;
      obj.userData.isOpen = !obj.userData.isOpen;
    } else {
      obj.material.color.set(0xff0000);
    }
  }
}

// ==================== BUILD FROM JSON ====================
function buildFromBlueprint(bp) {
  bp.rooms.forEach(room => {
    if (room.floor) createFloor(room.floor);

    if (room.walls) {
      room.walls.forEach(w => {
        // Pass openings as doors/windows in this wall
        const openings = [];
        if (room.doors) {
          room.doors.forEach(d => openings.push({ at: d.at, width: d.width, height: d.height }));
        }
        if (room.windows) {
          room.windows.forEach(win => openings.push({ at: win.at, width: win.width, height: win.height }));
        }

        createWallWithOpenings(w.from, w.to, w.height, w.thickness, openings);
      });
    }

    // Add doors and windows as interactive meshes
    if (room.doors) room.doors.forEach(d => createDoor(d.at, d.width, d.height));
    if (room.windows) room.windows.forEach(win => createWindow(win.at, win.width, win.height));
  });
}

// ==================== LOAD JSON ====================
fetch("example.json")
  .then(res => res.json())
  .then(data => {
    init();
    buildFromBlueprint(data);
  })
  .catch(err => console.error("Error loading JSON:", err));
