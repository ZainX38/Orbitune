// First-person controller for walking on the planet (Role 4 takes this over).
//
//   const player = createPlayer({ camera, domElement, planet });
//   player.enable(startDirection);   // stand at that point of the planet and start taking input
//   player.update(dt);               // every frame while enabled
//   player.disable();                // stop taking input, release the mouse
//   player.getDirection();           // unit vector from the planet centre to the player (planet space):
//                                    // feed it to songPosition.update() and planet.update()
//
// How it works:
// - All state lives in the PLANET'S LOCAL SPACE: `dir` (unit vector from the planet centre to the
//   player), a yaw angle and a pitch angle. The camera is written in world space every frame via
//   planet.group.matrixWorld, so it keeps working if the planet group is rotated or moved.
//   (Assumes the group is not scaled and the camera is a direct child of the scene.)
// - Ground height comes ONLY from planet.getHeight(dir) (Contract 3). No raycasting against the mesh.
// - The camera orientation is REBUILT every frame from up + yaw + pitch. It is never an
//   accumulated quaternion, so the horizon cannot drift or tilt.

import * as THREE from 'three';

// THE knob for how big the world feels: the player's size relative to the planet (radius 50).
// 1 = the original human-sized player (eyes 1.7 above the ground, the whole equator in 29 s at a run).
// Smaller = a smaller player = a bigger planet. Eye height, speeds and every distance below scale with it,
// and so do the things in mvp/main.js that depend on the player's size (near plane, landmark range).
export const PLAYER_SCALE = 0.35;

const DEFAULTS = {
  eyeHeight: 1.7 * PLAYER_SCALE, // 0.6
  walkSpeed: 5 * PLAYER_SCALE,   // 1.75 units per second: once around the equator in about 3 minutes
  runSpeed: 11 * PLAYER_SCALE,   // 3.85 with Shift: about 80 s around the equator.
                                 // A 30 s song moves along the equator at 2*PI*50/30 = 10.5 units per second, so the
                                 // music is now faster than a run: walking east it repeats bars while you catch up
                                 // (songPosition.js). At PLAYER_SCALE 1 a run kept up with it.
  smoothing: 8,        // higher = snappier start/stop
  sensitivity: 0.0022, // radians per pixel of mouse movement
  maxPitch: THREE.MathUtils.degToRad(85),
  pointerLock: true,   // false = never capture the mouse (drag to look, click to walk)
  onUnlock: null,      // called when the browser releases pointer lock (Esc) while enabled
  debug: true,
};

const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
const CLICK_SLOP = 5;    // px the mouse may move and still count as a click
const ARRIVE_DIST = 0.6 * PLAYER_SCALE; // click-to-walk stops this close to the target
// The eye keeps this much room from the ground AROUND it, not only below it (both as a share of the eye height).
// On a steep slope the ground beside you is closer than the ground under you; without this the camera's near
// plane cuts into the hillside and you see through it.
const HEAD_RING = 0.35;  // how far around the eye to look
const HEAD_ROOM = 0.2;   // the eye stays at least this far above the ground found there
const RING = Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * Math.PI * 2), Math.sin((i / 6) * Math.PI * 2)]);

export function createPlayer({ camera, domElement, planet, ...options }) {
  const opt = { ...DEFAULTS, ...options };
  const log = (...a) => opt.debug && console.log('[player]', ...a);

  // ---------- State (planet-local) ----------
  const dir = new THREE.Vector3(1, 0, 0); // where we stand; also our `up`
  const ref = new THREE.Vector3(0, 1, 0); // "yaw = 0" direction on the ground, carried along as we walk
  let yaw = 0, pitch = 0;
  const vel = new THREE.Vector2();        // smoothed input: x = strafe right, y = forward
  let walkTarget = null;                  // unit direction we are click-walking towards
  let enabled = false, locked = false;
  const held = { f: false, b: false, l: false, r: false, run: false };
  const drag = { active: false, moved: 0, x: 0, y: 0 };

  // Derived every frame by computeBasis()
  const up = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
  const localPosition = new THREE.Vector3();

  // Scratch
  const tmp = new THREE.Vector3(), look = new THREE.Vector3(), camUp = new THREE.Vector3(), probe = new THREE.Vector3();
  const basis = new THREE.Matrix4(), localQuat = new THREE.Quaternion(), groupQuat = new THREE.Quaternion();
  const inverse = new THREE.Matrix4(), rayO = new THREE.Vector3(), rayD = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();

  const groundRadius = (d) => planet.radius + planet.getHeight(d);

  // up, forward and right from dir + ref + yaw. Always an exact right-angled set.
  function computeBasis() {
    up.copy(dir);
    ref.addScaledVector(up, -ref.dot(up)); // flatten the reference onto the ground here
    if (ref.lengthSq() < 1e-8) {           // degenerate (should not happen): pick any ground direction
      ref.set(0, 1, 0).addScaledVector(up, -up.y);
      if (ref.lengthSq() < 1e-8) ref.set(1, 0, 0).addScaledVector(up, -up.x);
    }
    ref.normalize();
    tmp.crossVectors(up, ref);             // 90 degrees to the left of ref
    forward.copy(ref).multiplyScalar(Math.cos(yaw)).addScaledVector(tmp, Math.sin(yaw));
    right.crossVectors(forward, up);
  }

  // Distance of the eye from the planet's centre: eye height above the ground under us, or higher if the ground
  // right next to us (a steep slope) would come too close. getHeight only. Needs computeBasis() first.
  function eyeRadius() {
    const ground = groundRadius(dir);
    let r = ground + opt.eyeHeight;
    for (const [c, s] of RING) {
      probe.copy(dir).multiplyScalar(ground)
        .addScaledVector(forward, c * HEAD_RING * opt.eyeHeight).addScaledVector(right, s * HEAD_RING * opt.eyeHeight).normalize();
      r = Math.max(r, groundRadius(probe) + HEAD_ROOM * opt.eyeHeight);
    }
    return r;
  }

  // Write the camera from scratch: position from getHeight, orientation from up + yaw + pitch.
  function writeCamera() {
    computeBasis();
    localPosition.copy(dir).multiplyScalar(eyeRadius());
    look.copy(forward).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
    camUp.copy(up).multiplyScalar(Math.cos(pitch)).addScaledVector(forward, -Math.sin(pitch));
    basis.makeBasis(right, camUp, look.negate()); // cameras look down their -Z
    localQuat.setFromRotationMatrix(basis);

    planet.group.updateWorldMatrix(true, false);
    planet.group.getWorldQuaternion(groupQuat);
    camera.position.copy(localPosition).applyMatrix4(planet.group.matrixWorld);
    camera.quaternion.copy(groupQuat).multiply(localQuat);
  }

  // Step `distance` along the ground in direction `move` (a unit vector on the ground), then snap to the surface.
  function step(move, distance) {
    dir.multiplyScalar(groundRadius(dir)).addScaledVector(move, distance).normalize();
  }

  // ---------- Public: placing ----------
  // Stand at `direction` (planet-local, any length). `facing` (optional, planet-local) is flattened
  // onto the ground and becomes straight ahead. Does not touch input, so it is safe to call while disabled
  // (mvp.js uses it to find where the landing camera move should end).
  function place(direction, facing) {
    dir.copy(direction).normalize();
    if (facing) ref.copy(facing);
    yaw = 0; pitch = 0;
    vel.set(0, 0);
    walkTarget = null;
    writeCamera();
  }

  // ---------- Public: click-to-walk ----------
  // Walk towards a point of the planet (planet-local direction). WASD cancels it.
  function walkTo(direction) {
    walkTarget = direction.clone().normalize();
    log('walking to clicked point');
  }

  // Where does a screen point hit the ground? Marches the view ray against getHeight (no mesh raycast).
  function pickGround(clientX, clientY) {
    const rect = domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    inverse.copy(planet.group.matrixWorld).invert();
    rayO.copy(raycaster.ray.origin).applyMatrix4(inverse);
    rayD.copy(raycaster.ray.direction).transformDirection(inverse);

    const above = (t) => { tmp.copy(rayO).addScaledVector(rayD, t); const r = tmp.length(); return r - groundRadius(tmp.divideScalar(r)); };
    // Steps are short near the ground (so a ray grazing it from a low eye does not skip a ridge) and longer the
    // higher the ray is above it.
    const maxT = planet.radius * 3, minStep = 0.25 * opt.eyeHeight;
    let t0 = 0, t = minStep;
    while (t < maxT) {
      const height = above(t);
      if (height <= 0) {
        let lo = t0, hi = t; // crossed the ground between lo and hi: narrow it down
        for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (above(m) <= 0) hi = m; else lo = m; }
        return rayO.clone().addScaledVector(rayD, hi).normalize();
      }
      t0 = t;
      t += Math.max(minStep, height * 0.5);
    }
    return null; // clicked the sky
  }

  // ---------- Input ----------
  function turn(dx, dy) {
    yaw -= dx * opt.sensitivity; // yaw spins around `up`
    pitch = THREE.MathUtils.clamp(pitch - dy * opt.sensitivity, -opt.maxPitch, opt.maxPitch); // pitch tilts only the camera
  }

  function onMouseMove(e) {
    if (locked) return turn(e.movementX, e.movementY);
    if (drag.active) { // no pointer lock: drag to look
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (drag.moved > CLICK_SLOP) turn(-e.movementX * 1.5, -e.movementY * 1.5); // drag the world, like a touch screen
    }
  }

  function onMouseDown(e) {
    if (locked || e.button !== 0) return;
    drag.active = true; drag.moved = 0; drag.x = e.clientX; drag.y = e.clientY;
  }

  function onMouseUp(e) {
    if (!drag.active || e.button !== 0) return;
    drag.active = false;
    if (locked || drag.moved > CLICK_SLOP) return;
    const target = pickGround(e.clientX, e.clientY);
    if (target) walkTo(target);
  }

  function onKey(e) {
    const down = e.type === 'keydown';
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { held.run = down; return; }
    const k = KEYS[e.code];
    if (!k) return;
    held[k] = down;
    if (down) walkTarget = null; // the keyboard always wins over click-to-walk
    e.preventDefault();
  }

  function releaseKeys() { held.f = held.b = held.l = held.r = held.run = false; }

  function onLockChange() {
    const now = document.pointerLockElement === domElement;
    if (now === locked) return;
    locked = now;
    log(locked ? 'pointer locked' : 'pointer unlocked');
    if (!locked && enabled) opt.onUnlock?.();
  }

  function onLockError() { log('pointer lock refused: drag to look, click the ground to walk'); }

  function requestLock() {
    try {
      const p = domElement.requestPointerLock();
      if (p?.catch) p.catch(onLockError);
    } catch { onLockError(); }
  }

  // ---------- Public: enable / disable / update ----------
  // startDirection: planet-local direction of the point to stand on (e.g. where the planet was clicked).
  // Leave it out to keep the current spot (e.g. after place()).
  function enable(startDirection, facing) {
    if (startDirection) place(startDirection, facing);
    if (enabled) return;
    enabled = true;
    releaseKeys();
    drag.active = false;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockError);
    domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('blur', releaseKeys);
    if (opt.pointerLock) requestLock();
    writeCamera();
  }

  function disable() {
    if (!enabled) return;
    enabled = false; // set first, so the unlock below does not fire onUnlock
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKey);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('pointerlockerror', onLockError);
    domElement.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('blur', releaseKeys);
    if (document.pointerLockElement === domElement) document.exitPointerLock();
    locked = false;
    releaseKeys();
    walkTarget = null;
    vel.set(0, 0);
  }

  function update(dt) {
    if (!enabled) return;
    dt = Math.min(dt, 0.1); // a long pause (tab switch) must not become one huge step
    computeBasis();

    // What we want: keyboard, or else the click-to-walk target
    let wantX = (held.r ? 1 : 0) - (held.l ? 1 : 0);
    let wantY = (held.f ? 1 : 0) - (held.b ? 1 : 0);
    let speed = held.run ? opt.runSpeed : opt.walkSpeed;

    if (!wantX && !wantY && walkTarget) {
      tmp.copy(walkTarget).addScaledVector(up, -walkTarget.dot(up)); // direction to the target, along the ground
      const flat = tmp.length();
      const distance = Math.atan2(flat, walkTarget.dot(up)) * planet.radius;
      if (distance < ARRIVE_DIST || flat < 1e-6) {
        walkTarget = null;
      } else {
        tmp.divideScalar(flat);
        wantX = tmp.dot(right);
        wantY = tmp.dot(forward);
        speed = Math.min(speed, distance * 2 + 0.5 * PLAYER_SCALE); // ease in to the target
      }
    }

    const len = Math.hypot(wantX, wantY);
    if (len > 1) { wantX /= len; wantY /= len; }

    // Smooth start and stop
    const k = 1 - Math.exp(-opt.smoothing * dt);
    vel.x += (wantX * speed - vel.x) * k;
    vel.y += (wantY * speed - vel.y) * k;

    const v = vel.length();
    if (v > 1e-4) {
      tmp.copy(forward).multiplyScalar(vel.y / v).addScaledVector(right, vel.x / v);
      step(tmp, v * dt);
    }
    writeCamera();
  }

  // Unit vector from the planet centre to the player, in the planet's own space. Read only (do not change it).
  const getDirection = () => dir;

  return {
    enable, disable, update, getDirection, place, walkTo,
    get enabled() { return enabled; },
    get locked() { return locked; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get direction() { return dir; },          // unit vector, planet-local. Read only.
    get position() { return localPosition; }, // eye position, planet-local. Read only. Compare with landmark.position.
    eyeHeight: opt.eyeHeight,
  };
}
