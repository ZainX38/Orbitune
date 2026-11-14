import * as THREE from "three";

export function createPlayer({
    camera,
    canvas,
    radius,
    spawnDirection,
    getHeight = () => 0,
    eyeHeight = 1.6,
    speed = 4,
})
    {
    const keys = new Set();
    const movementKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

    // Start on top of the sphere, facing along its surface.
    const up = spawnDirection?.clone().normalize() ?? new THREE.Vector3(0, 1, 0);

    const forward = new THREE.Vector3(0, 0, -1);

    // Use a different starting axis if the first one is nearly parallel to up.
    if (Math.abs(forward.dot(up)) > 0.95) {
        forward.set(1, 0, 0);
    }

    // Flatten forward against the ground at the landing spot.
    forward.addScaledVector(up, -forward.dot(up)).normalize();
    const right = new THREE.Vector3();
    const movement = new THREE.Vector3();
    const previousUp = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const lookTarget = new THREE.Vector3();
    let pitch = 0;

    const walkTarget = new THREE.Vector3();
    let hasWalkTarget = false;

    function walkTo(direction) {
        walkTarget.copy(direction).normalize();
        hasWalkTarget = true;
}

function lockMouse() {
    canvas.requestPointerLock();
}

function onMouseMove(event) {
    if (document.pointerLockElement !== canvas) return;

    // Turn around the player's local up direction.
    forward.applyAxisAngle(up, -event.movementX * 0.002);

    // Tilt the camera while keeping WASD movement along the ground.
    pitch = THREE.MathUtils.clamp(
        pitch - event.movementY * 0.002,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01,
    );

    placeCamera();
}

    function onKeyDown(event) {
        if (movementKeys.has(event.code)) {
            keys.add(event.code);
        }
    }

    function onKeyUp(event) {
        keys.delete(event.code);
    }

    function clearKeys() {
        keys.clear();
    }

   function placeCamera() {
    const groundRadius = radius + getHeight(up);
    camera.position.copy(up).multiplyScalar(groundRadius + eyeHeight);
    camera.up.copy(up);

    lookTarget.copy(camera.position)
        .addScaledVector(forward, Math.cos(pitch))
        .addScaledVector(up, Math.sin(pitch));

    camera.lookAt(lookTarget);
}

    function update(deltaSeconds) {
    const ahead = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const sideways = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    let step = speed * Math.min(deltaSeconds, 0.05);

    if (ahead !== 0 || sideways !== 0) {
        // Manual movement cancels the click destination.
        hasWalkTarget = false;
        right.crossVectors(forward, up).normalize();
        movement.copy(forward).multiplyScalar(ahead);
        movement.addScaledVector(right, sideways).normalize();
    } else if (hasWalkTarget) {
        const distance = up.angleTo(walkTarget) * radius;

        if (distance < 0.05) {
            hasWalkTarget = false;
            return;
        }

        // Project the target direction onto the ground at the player's feet.
        movement.copy(walkTarget).addScaledVector(up, -walkTarget.dot(up));
        movement.normalize();
        step = Math.min(step, distance);
    } 
    else {
        return;
}

    previousUp.copy(up);
    up.addScaledVector(movement, step / radius).normalize();
    rotation.setFromUnitVectors(previousUp, up);
    forward.applyQuaternion(rotation).normalize();

    placeCamera();
}

    function dispose() {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", clearKeys);
        canvas.removeEventListener("click", lockMouse);
        document.removeEventListener("mousemove", onMouseMove);

        if (document.pointerLockElement === canvas) {
            document.exitPointerLock();
        }

        clearKeys();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    canvas.addEventListener("click", lockMouse);
    document.addEventListener("mousemove", onMouseMove);
    placeCamera();

    return { update, dispose, walkTo };
}