import * as THREE from "three";
import { createPlayer } from "./experience/player.js";
import { createLandmarkTrigger } from "./experience/trigger.js";
import { createLandmarkSound } from "./experience/sound.js";    

const radius = 10;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101827);

const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

// The wireframe makes it easy to see yourself moving across the surface.
function getHeight(direction) {
    return 1.2 * Math.sin(5 * direction.x) * Math.cos(5 * direction.z);
}

const geometry = new THREE.IcosahedronGeometry(radius, 24);
const positions = geometry.getAttribute("position");
const direction = new THREE.Vector3();

for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const surfaceRadius = radius + getHeight(direction);

    positions.setXYZ(
        i,
        direction.x * surfaceRadius,
        direction.y * surfaceRadius,
        direction.z * surfaceRadius,
    );
}

geometry.computeBoundingSphere();

const planet = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x66d9a0, wireframe: true }),
);
scene.add(planet);

const landmarkDirection = new THREE.Vector3(1, 1, 1).normalize();
const surfaceRadius = radius + getHeight(landmarkDirection);

const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc44 }),
);

// Lift the marker by its own radius so it sits above the ground.
marker.position.copy(landmarkDirection).multiplyScalar(surfaceRadius + 0.4);
scene.add(marker);
const landmarkSound = createLandmarkSound({
    camera,
    marker,
    url: "/audio/hollow-choir.mp3",
});

const landmarkLabel = document.createElement("div");
landmarkLabel.textContent = "The Hollow Choir";
landmarkLabel.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 24px;
    padding: 10px 14px;
    background: #101827;
    color: white;
    font: 16px sans-serif;
    pointer-events: none;
`;
landmarkLabel.hidden = true;
document.body.appendChild(landmarkLabel);

const landmarkTrigger = createLandmarkTrigger({
    position: marker.position,
    range: 3,
    onEnter: () => { 
        landmarkLabel.hidden = false;
        landmarkSound.enter();
     },
    onExit: () => { 
        landmarkLabel.hidden = true;
    landmarkSound.exit();
 },
});

const canvas = renderer.domElement;
const controlsHint = document.createElement("div");
controlsHint.style.cssText = `
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 32px);
    padding: 8px 14px;
    border-radius: 8px;
    background: rgba(16, 24, 39, 0.9);
    color: white;
    font: 14px system-ui, sans-serif;
    text-align: center;
    pointer-events: none;
    z-index: 1;
`;
document.body.appendChild(controlsHint);
const crosshair = document.createElement("div");
crosshair.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 0 0 1px #101827;
    pointer-events: none;
    z-index: 1;
`;
crosshair.hidden = true;
document.body.appendChild(crosshair);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let player = null;
let descent = null;
const landingDuration = 0.9;
const eyeHeight = 1.6;

function showOrbit() {
    camera.position.set(radius * 1.5, radius * 0.8, radius * 1.8);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    controlsHint.textContent = "Click the planet to land";
    controlsHint.hidden = false;
    crosshair.hidden = true; 
}

function land(event) {
    if (player) {
        if (document.pointerLockElement !== canvas) return;

    // With the mouse captured, aim from the centre of the screen.
        pointer.set(0, 0);
        camera.updateMatrixWorld();
        raycaster.setFromCamera(pointer, camera);

        const [groundHit] = raycaster.intersectObject(planet);

        if (groundHit) {
            player.walkTo(groundHit.point.clone().normalize());
        }

    return;
}

if (descent) return;
    landmarkSound.unlock().catch((error) => {
        console.error("Could not enable landmark audio", error);
    });

    // Convert the click into a ray and check whether it hits the planet.
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = 1 - ((event.clientY - bounds.top) / bounds.height) * 2;
    
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObject(planet);
    if (!hit) return;

    const spawnDirection = hit.point.clone().normalize();
    const landingPosition = spawnDirection.clone().multiplyScalar(
        radius + getHeight(spawnDirection) + eyeHeight,
    );

    // Match the starting view in player.js for a smooth handoff.
    const forward = new THREE.Vector3(0, 0, -1);
    if (Math.abs(forward.dot(spawnDirection)) > 0.95) {
        forward.set(1, 0, 0);
    }
    forward.addScaledVector(
        spawnDirection,
        -forward.dot(spawnDirection),
    ).normalize();

    const landingCamera = new THREE.PerspectiveCamera();
    landingCamera.position.copy(landingPosition);
    landingCamera.up.copy(spawnDirection);
    landingCamera.lookAt(landingPosition.clone().add(forward));

    descent = {
        elapsed: 0,
        spawnDirection,
        startPosition: camera.position.clone(),
        startRotation: camera.quaternion.clone(),
        landingPosition,
        landingRotation: landingCamera.quaternion.clone(),
    };

    // Ask for pointer lock while the browser is still handling the click.
    controlsHint.hidden = true;
    canvas.requestPointerLock();
}

function updateDescent(deltaSeconds) {
    if (!descent || document.pointerLockElement !== canvas) return;

    descent.elapsed += deltaSeconds;
    const progress = Math.min(descent.elapsed / landingDuration, 1);
    const eased = progress * progress * (3 - 2 * progress);

    camera.position.lerpVectors(
        descent.startPosition,
        descent.landingPosition,
        eased,
    );
    camera.quaternion.slerpQuaternions(
        descent.startRotation,
        descent.landingRotation,
        eased,
    );

    if (progress === 1) {
        const { spawnDirection } = descent;
        descent = null;

        player = createPlayer({
            camera,
            canvas,
            radius,
            getHeight,
            spawnDirection,
            eyeHeight,
        });

       controlsHint.textContent = "WASD to move · Aim at the ground and click to walk · E to visit landmark · Esc to return";
       controlsHint.hidden = false;
       crosshair.hidden = false;
    }
}

function returnToOrbit() {
    if (!player && !descent) return;

    descent = null;
    player?.dispose();
    player = null;
    showOrbit();
}


canvas.addEventListener("click", land);

document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== canvas) {
        returnToOrbit();
    }
});

document.addEventListener("pointerlockerror", returnToOrbit);

showOrbit();

function updateOrbit(deltaSeconds) {
    if (player || descent) return;

    const angle = 0.15 * Math.min(deltaSeconds, 0.05);
    const { x, z } = camera.position;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    camera.position.x = x * cos - z * sin;
    camera.position.z = x * sin + z * cos;

    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
}


window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("keydown", (event) => {
    if (event.code === "KeyE" && !event.repeat && player) {
        player.walkTo(landmarkDirection);
    }
});

let previousTime = performance.now();

function animate(now) {
    const deltaSeconds = (now - previousTime) / 1000;
    previousTime = now;

    updateOrbit(deltaSeconds);
    updateDescent(deltaSeconds);
    player?.update(deltaSeconds);

    if (player) {
        landmarkTrigger.update(camera.position);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

requestAnimationFrame(animate);