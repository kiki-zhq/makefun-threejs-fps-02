// Shared first-person movement: acceleration, friction, gravity, crouch and jump,
// resolved as a box against the world's colliders one axis at a time, so a wall
// never swallows the mover. Both the player and the bots step through this.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createMover(colliders, start, opts = {}) {
  const walkSpeed = opts.walkSpeed ?? 5.2;
  const crouchSpeed = opts.crouchSpeed ?? 2.4;
  const groundAccel = opts.groundAccel ?? 42;
  const airAccel = opts.airAccel ?? 9;
  const friction = opts.friction ?? 9;

  const body = {
    position: new THREE.Vector3(start.x, 0, start.z),
    velocity: new THREE.Vector3(),
    yaw: opts.yaw ?? 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing
  // on the floor is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  // wishX/wishZ are world-space unit wishes (already rotated by yaw by the caller).
  function step(dt, wishX, wishZ, wantJump, wantCrouch) {
    const crouching = wantCrouch;
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const len = Math.hypot(wishX, wishZ);
    if (len > 0.001) { wish.set(wishX / len, 0, wishZ / len); } else { wish.set(0, 0, 0); }

    const speed = body.crouching ? crouchSpeed : walkSpeed;
    const blend = Math.min(1, ((body.onGround ? groundAccel : airAccel) * dt) / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && len <= 0.001) {
      const damp = Math.max(0, 1 - friction * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (wantJump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  return {
    state: body,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    eyePosition(out) {
      out.set(body.position.x, body.position.y + body.eye, body.position.z);
      return out;
    },
  };
}

// Turn a yaw + forward/strafe intent into a world-space wish vector.
export function wishFromYaw(yaw, forward, strafe) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: -sin * forward + cos * strafe,
    z: -cos * forward - sin * strafe,
  };
}
