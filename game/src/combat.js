// Combat: hitscan shots with tracers, thrown grenades, and the bomb explosion.
// The shooter owns the ray; this module owns the effects and the area damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 24;
const TRACER_LIFE = 0.09;

export function createCombat(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  const flashLight = new THREE.PointLight(new THREE.Color('#ffb45e'), 0, 30);
  scene.add(flashLight);
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8c2e'), transparent: true, opacity: 0, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  let blastLife = 0;

  function tracer(from, to) {
    const entry = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_POOL;
    const attr = entry.line.geometry.getAttribute('position');
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    entry.line.visible = true;
    entry.line.material.opacity = 0.85;
    entry.life = TRACER_LIFE;
  }

  function explode(center, radius, damageAtCenter, damageFn) {
    blast.position.copy(center);
    blast.scale.setScalar(0.5);
    blast.visible = true;
    blast.material.opacity = 0.75;
    blastLife = 0.45;
    flashLight.position.copy(center);
    flashLight.position.y += 1;
    flashLight.intensity = 60;
    damageFn(center, radius, damageAtCenter);
  }

  function step(dt) {
    for (const entry of tracers) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      if (entry.life <= 0) { entry.line.visible = false; continue; }
      entry.line.material.opacity = 0.85 * (entry.life / TRACER_LIFE);
    }
    if (blastLife > 0) {
      blastLife -= dt;
      const t = Math.max(0, blastLife / 0.45);
      blast.scale.setScalar(0.5 + (1 - t) * 9);
      blast.material.opacity = 0.75 * t;
      flashLight.intensity = 60 * t;
      if (blastLife <= 0) { blast.visible = false; flashLight.intensity = 0; }
    }
  }

  return { tracer, explode, step };
}

// A thrown grenade: a small arcing body that bounces once and then goes off.
// The owner decides what the explosion does.
export function createGrenade(scene, start, velocity, kind, onDetonate) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(kind === 'flash' ? PALETTE.ink : PALETTE.rust), roughness: 0.5, metalness: 0.4 }),
  );
  mesh.position.copy(start);
  scene.add(mesh);
  const vel = velocity.clone();
  let age = 0;
  let done = false;
  const fuse = kind === 'flash' ? 1.5 : 1.8;

  return {
    mesh,
    kind,
    step(dt, colliders) {
      if (done) return;
      age += dt;
      vel.y -= 12 * dt;
      mesh.position.addScaledVector(vel, dt);
      if (mesh.position.y < 0.09) {
        mesh.position.y = 0.09;
        vel.y = Math.abs(vel.y) * 0.35;
        vel.x *= 0.7;
        vel.z *= 0.7;
      }
      // Cheap wall bounce: if inside a collider, push back out along the velocity.
      if (age > fuse) {
        done = true;
        scene.remove(mesh);
        onDetonate(mesh.position.clone(), kind);
      }
    },
    get done() { return done; },
  };
}
