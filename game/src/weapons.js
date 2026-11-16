// Weapons: the numbers and the view models. The simulation owns the ray and the
// damage; this module owns fire rate, magazine, reload, spread and the gun in
// the player's hands.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P-9 Sidearm', price: 0, kind: 'pistol',
    damage: 26, headMult: 3, mag: 12, reserve: 48, fireGap: 0.22,
    reloadTime: 1.4, spreadStill: 0.003, spreadMove: 0.02, auto: false, range: 60,
  },
  smg: {
    id: 'smg', name: 'Jackal-9 SMG', price: 1500, kind: 'smg',
    damage: 22, headMult: 3, mag: 30, reserve: 120, fireGap: 0.075,
    reloadTime: 1.7, spreadStill: 0.004, spreadMove: 0.03, auto: true, range: 55,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Rifle', price: 2700, kind: 'rifle',
    damage: 34, headMult: 4, mag: 30, reserve: 90, fireGap: 0.1,
    reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028, auto: true, range: 80,
  },
  sniper: {
    id: 'sniper', name: 'Longbow DMR', price: 4750, kind: 'sniper',
    damage: 88, headMult: 4, mag: 10, reserve: 30, fireGap: 0.85,
    reloadTime: 2.6, spreadStill: 0.0006, spreadMove: 0.05, auto: false, range: 90,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300 },
  flash: { id: 'flash', name: 'Flashbang', price: 200 },
};

const ARMOR_PRICE = 650;

export function createWeaponSet(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });

  const model = new THREE.Group();
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.16, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  let current = null;
  let parts = [];

  function buildModel(def) {
    for (const part of parts) model.remove(part);
    parts = [];
    const add = (mesh) => { model.add(mesh); parts.push(mesh); return mesh; };
    if (def.kind === 'pistol') {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.26), bodyMat);
      slide.position.set(0, 0.02, -0.1);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.08), grip);
      handle.position.set(0, -0.07, 0.02);
      handle.rotation.x = 0.2;
      add(slide); add(handle);
    } else if (def.kind === 'smg') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), bodyMat);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), grip);
      barrel.position.set(0, 0.02, -0.3);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), darkMat);
      mag.position.set(0, -0.1, -0.05);
      add(receiver); add(barrel); add(mag);
    } else if (def.kind === 'sniper') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.5), bodyMat);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.55), grip);
      barrel.position.set(0, 0.03, -0.5);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), darkMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.09, -0.05);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.26), grip);
      stock.position.set(0, -0.02, 0.32);
      add(receiver); add(barrel); add(scope); add(stock);
    } else { // rifle
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), bodyMat);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
      barrel.position.set(0, 0.025, -0.38);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
      stock.position.set(0, -0.02, 0.3);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08), darkMat);
      sight.position.set(0, 0.08, -0.1);
      add(receiver); add(barrel); add(stock); add(sight);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.rotation.set(0, 0, 0);
  }

  const state = {
    def: WEAPONS.rifle,
    mag: WEAPONS.rifle.mag,
    reserve: WEAPONS.rifle.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
  };

  function equip(def, mag, reserve) {
    state.def = def;
    state.mag = mag ?? def.mag;
    state.reserve = reserve ?? def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    buildModel(def);
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = state.def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    equip,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = state.def.fireGap;
      state.flash = 0.06;
      state.kick = state.def.kind === 'sniper' ? 0.11 : 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return false;
      state.reloadLeft = state.def.reloadTime;
      return true;
    },
    spread(speed) {
      const ref = 5.2;
      return state.def.spreadStill + Math.min(1, speed / ref) * state.def.spreadMove;
    },
    refill() {
      state.mag = state.def.mag;
      state.reserve = state.def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    armorPrice() { return ARMOR_PRICE; },
  };
}
