// DUSTLINE boot and the one loop: a fixed 60 Hz simulation feeding a render at
// the display's rate. ?shot=start|play|end with &seed=N sets up a deterministic
// frame for a capture, renders it twice, then freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp } from './rng.js';
import { createMap } from './map.js';
import { createNav } from './nav.js';
import { createMover, wishFromYaw } from './physics.js';
import { WEAPONS, GRENADES, createWeaponSet } from './weapons.js';
import { createCombat, createGrenade } from './combat.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const nav = createNav(map);
const combat = createCombat(scene);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);

const playerMover = createMover(map.colliders, { x: -12, z: 20 }, { yaw: 0 });
const player = {
  team: 'attackers',
  alive: true,
  health: 100,
  armor: 0,
  eye: new THREE.Vector3(0, 1.6, 19),
  get position() { return playerMover.state.position; },
  get velocity() { return playerMover.state.velocity; },
};
const weaponSet = createWeaponSet(camera);
weaponSet.equip(WEAPONS.rifle);
// Ammo is kept per weapon, so swapping to the sidearm and back does not refill.
const ammoStore = {};
function equipWeapon(id) {
  const cur = weaponSet.state.def;
  ammoStore[cur.id] = { mag: weaponSet.state.mag, reserve: weaponSet.state.reserve };
  const saved = ammoStore[id];
  weaponSet.equip(WEAPONS[id], saved ? saved.mag : undefined, saved ? saved.reserve : undefined);
  hud.setAmmo(weaponSet.state.mag, weaponSet.state.reserve, WEAPONS[id].name);
}
const grenades = { frag: 0, flash: 0 };
let slot = 'weapon'; // weapon | pistol | frag | flash
let throwCooldown = 0;

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootDir = new THREE.Vector3();
const shootOrigin = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

// The bomb in the world: a small case with a blinking light, shown when the
// bomb is dropped or planted.
const bombGroup = new THREE.Group();
const bombCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.2, 0.24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.5, metalness: 0.4 }),
);
const bombLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2e1f') }),
);
bombLamp.position.y = 0.14;
bombGroup.add(bombCase, bombLamp);
bombGroup.visible = false;
scene.add(bombGroup);

const bots = createBots(scene, map, nav, camera, {
  colliders: map.colliders,
  shootables: map.shootables,
  random,
});
const combatants = [player, ...bots.bots];

let score = { attackers: 0, defenders: 0 };
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let shake = 0;
let beepTimer = 0;
const liveGrenades = [];

const rounds = createRounds(map, {
  onRoundStart(round) {
    resetPositions();
    hud.setScore(score.attackers, score.defenders, round);
    hud.announce(`Round ${round} — ${round === 1 ? 'attackers plant at A or B' : 'buy phase: press B'}`);
    hud.hideDead();
    hud.setBomb(null);
  },
  onRoundLive() {
    hud.announce('Round live — go!');
    hud.hideBuy();
  },
  onRoundEnd(winner, reason, newScore) {
    score = newScore;
    hud.setScore(score.attackers, score.defenders, rounds.state.round);
    hud.showRoundEnd(winner === 'attackers' ? 'Round won' : 'Round lost', reason, score);
    if (winner === 'attackers') audio.roundWin(); else audio.roundLose();
    hud.hideBuy();
  },
  onNextRound(round) {
    rounds.startRound(bots.bots);
  },
  onMatchEnd(finalScore) {
    const won = finalScore.attackers > finalScore.defenders;
    hud.showMatchEnd(won ? 'Match won' : 'Match lost',
      won ? 'Site 7 is yours. The attackers take the match.' : 'The defenders held Site 7.',
      finalScore);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onBombPlanted(site) {
    hud.setBomb(`BOMB PLANTED — Site ${site}`, 40);
    hud.announce(`Bomb planted at Site ${site}!`);
    audio.plantBeep();
  },
  onBombExploded(pos) {
    combat.explode(new THREE.Vector3(pos.x, 0.5, pos.z), 12, 200, () => {});
    audio.explosion();
    shake = 1.2;
    hud.setBomb(null);
  },
  onBombDefused() {},
});

function resetPositions() {
  // Player back to the attacker spawn, fresh health and a full loadout.
  // The player's spawn is on the west side, off the mid firing lane, and
  // south of the bots' so nobody starts inside anyone.
  const spawn = { x: -12, z: 20, yaw: 0 };
  playerMover.state.position.set(spawn.x, 0, spawn.z);
  playerMover.state.velocity.set(0, 0, 0);
  playerMover.state.yaw = spawn.yaw;
  playerMover.state.pitch = 0;
  player.alive = true;
  player.health = 100;
  player.armor = rounds.state.loadout.armor ? 50 : 0;
  const def = WEAPONS[rounds.state.loadout.weapon];
  for (const key of Object.keys(ammoStore)) delete ammoStore[key];
  weaponSet.equip(def);
  grenades.frag = rounds.state.loadout.frag;
  grenades.flash = rounds.state.loadout.flash;
  slot = 'weapon';
  bots.reset();
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(weaponSet.state.mag, weaponSet.state.reserve, def.name);
  hud.setMoney(rounds.state.money);
}

// --- Damage ----------------------------------------------------------------
function damageBot(bot, amount) {
  if (!bot.alive) return false;
  let remaining = amount;
  if (bot.armor > 0) {
    const absorbed = Math.min(bot.armor, remaining * 0.5);
    bot.armor -= absorbed;
    remaining -= absorbed;
  }
  bot.health -= remaining;
  if (bot.health > 0) return false;
  bot.alive = false;
  bot.fall = 0;
  if (bot.isCarrier && rounds.state.bomb.state === 'carried' && rounds.state.bomb.carrier === bot) {
    rounds.dropBomb({ x: bot.mover.state.position.x, z: bot.mover.state.position.z });
    hud.announce('The bomb was dropped!');
  }
  return true;
}

function damagePlayer(amount, fromBot) {
  if (!player.alive) return;
  // Captures never kill the player: a ?shot= frame is a still, not a fight.
  if (shot) return;
  // Spawn protection: the first two seconds of the live round are safe, so
  // nobody dies to stray fire down mid before they have moved. The live
  // round is 100 s, so phaseTime above 98 means it just went live.
  if (rounds.state.phase === 'live' && rounds.state.phaseTime > 98) return;
  let remaining = amount;
  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, remaining * 0.5);
    player.armor -= absorbed;
    remaining -= absorbed;
  }
  player.health -= remaining;
  hud.damage();
  audio.hurt();
  hud.setHealth(player.health, player.armor);
  if (player.health <= 0) {
    player.alive = false;
    if (rounds.state.bomb.carrier === 'player') {
      rounds.dropBomb({ x: player.position.x, z: player.position.z });
    }
    hud.showDead('You are down. Your team fights on — the round will settle itself.');
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// Ray vs a vertical capsule (the player): returns the distance along the ray,
// or Infinity when the ray misses.
function rayCapsule(origin, dir, center, height, radius) {
  const ox = center.x - origin.x;
  const oz = center.z - origin.z;
  const denom = dir.x * dir.x + dir.z * dir.z;
  if (denom < 1e-8) return Infinity;
  let t = (ox * dir.x + oz * dir.z) / denom;
  if (t < 0) return Infinity;
  const px = origin.x + dir.x * t;
  const pz = origin.z + dir.z * t;
  const dx = px - center.x;
  const dz = pz - center.z;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal > radius) return Infinity;
  const py = origin.y + dir.y * t;
  const top = center.y + height;
  if (py < center.y || py > top) return Infinity;
  return t;
}

// --- Shooting ---------------------------------------------------------------
function playerShoot() {
  if (!weaponSet.takeRound()) { audio.dryFire(); return false; }
  camera.getWorldDirection(shootDir);
  const spread = weaponSet.spread(playerMover.groundSpeed());
  shootDir.x += (random() * 2 - 1) * spread;
  shootDir.y += (random() * 2 - 1) * spread;
  shootDir.z += (random() * 2 - 1) * spread;
  shootDir.normalize();
  playerMover.eyePosition(shootOrigin);
  scene.updateMatrixWorld(true);
  raycaster.set(shootOrigin, shootDir);
  const targets = map.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  const end = hit ? hit.point : tmpVec.copy(shootOrigin).addScaledVector(shootDir, 80);
  combat.tracer(shootOrigin, end);
  weaponSet.pullTrigger();
  playerMover.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(weaponSet.state.def.kind);
  bots.hearShot(player.position, 25);
  hud.setAmmo(weaponSet.state.mag, weaponSet.state.reserve, weaponSet.state.def.name);
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const isHead = hit.object.userData.part === 'head';
    const def = weaponSet.state.def;
    const dist = hit.distance;
    const falloff = dist > 30 ? 0.7 : 1;
    const damage = def.damage * (isHead ? def.headMult : 1) * falloff;
    const killed = damageBot(bot, damage);
    hud.hitMarker(killed, 4000);
    if (killed) {
      rounds.addKillMoney();
      hud.setMoney(rounds.state.money);
      hud.killFeed(`You ▸ ${bot.name}${isHead ? ' (headshot)' : ''}`);
      audio.kill();
    } else {
      audio.hit();
    }
  }
  return true;
}

function botShoot(bot, aimPoint, error) {
  const def = WEAPONS[bot.weaponId];
  bot.mover.eyePosition(shootOrigin);
  shootDir.subVectors(aimPoint, shootOrigin).normalize();
  shootDir.x += (random() * 2 - 1) * error;
  shootDir.y += (random() * 2 - 1) * error;
  shootDir.z += (random() * 2 - 1) * error;
  shootDir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(shootOrigin, shootDir);
  const wallHit = raycaster.intersectObjects(map.shootables, false)[0];
  const wallDist = wallHit ? wallHit.distance : Infinity;
  const botHit = raycaster.intersectObjects(bots.hitMeshes, false)[0];
  const botDist = botHit ? botHit.distance : Infinity;
  // The player is a capsule, not a mesh: test the ray against it by hand.
  const playerDist = player.alive
    ? rayCapsule(shootOrigin, shootDir, tmpVec2.set(player.position.x, player.position.y, player.position.z), 1.72, 0.45)
    : Infinity;
  const nearest = Math.min(wallDist, botDist, playerDist);
  const end = tmpVec.copy(shootOrigin).addScaledVector(shootDir, nearest === Infinity ? 80 : nearest);
  combat.tracer(shootOrigin, end);
  audio.enemyShot();
  if (playerDist < wallDist && playerDist < botDist && playerDist !== Infinity) {
    const head = shootOrigin.y + shootDir.y * playerDist > player.position.y + 1.4;
    const dist = playerDist;
    const falloff = dist > 30 ? 0.7 : 1;
    damagePlayer(def.damage * (head ? def.headMult : 1) * falloff, bot);
  } else if (botHit && botDist < wallDist) {
    const other = botHit.object.userData.bot;
    if (other && other.team !== bot.team) {
      const isHead = botHit.object.userData.part === 'head';
      const falloff = botDist > 30 ? 0.7 : 1;
      const killed = damageBot(other, def.damage * (isHead ? def.headMult : 1) * falloff);
      if (killed) hud.killFeed(`${bot.name} ▸ ${other.name}${isHead ? ' (headshot)' : ''}`);
    }
  }
}

// --- Grenades ---------------------------------------------------------------
function throwGrenade(kind) {
  if (grenades[kind] <= 0 || throwCooldown > 0) return;
  grenades[kind] -= 1;
  throwCooldown = 0.9;
  camera.getWorldDirection(shootDir);
  playerMover.eyePosition(shootOrigin);
  const velocity = shootDir.clone().multiplyScalar(14);
  velocity.y += 3.5;
  const g = createGrenade(scene, shootOrigin.clone(), velocity, kind, (pos, k) => detonateGrenade(pos, k));
  liveGrenades.push(g);
  audio.shot('pistol');
}

function detonateGrenade(pos, kind) {
  if (kind === 'frag') {
    combat.explode(new THREE.Vector3(pos.x, Math.max(0.4, pos.y), pos.z), 10, 120, (center, radius) => {
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        const p = bot.mover.state.position;
        const d = Math.hypot(p.x - center.x, p.z - center.z);
        if (d > radius) continue;
        tmpVec.set(p.x, p.y + 1.2, p.z);
        if (!nav.hasLineOfSight(center, tmpVec, map.shootables)) continue;
        const damage = 120 * (1 - (d / radius) * 0.9);
        const killed = damageBot(bot, damage);
        if (killed) {
          rounds.addKillMoney();
          hud.killFeed(`You ▸ ${bot.name} (frag)`);
        }
      }
      if (player.alive) {
        const d = Math.hypot(player.position.x - center.x, player.position.z - center.z);
        if (d < radius) {
          tmpVec.set(player.position.x, player.position.y + 1.2, player.position.z);
          if (nav.hasLineOfSight(center, tmpVec, map.shootables)) {
            damagePlayer(120 * (1 - (d / radius) * 0.9), null);
            shake = Math.max(shake, 0.8);
          }
        }
      }
    });
    audio.explosion();
    shake = Math.max(shake, 0.9);
  } else {
    // Flash: anyone with a line of sight to the pop and facing it is blinded.
    audio.flash();
    const flashPos = new THREE.Vector3(pos.x, Math.max(0.5, pos.y), pos.z);
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const p = bot.mover.state.position;
      const d = Math.hypot(p.x - flashPos.x, p.z - flashPos.z);
      if (d > 25) continue;
      tmpVec.set(p.x, p.y + 1.5, p.z);
      if (!nav.hasLineOfSight(flashPos, tmpVec, map.shootables)) continue;
      bot.blindUntil = elapsed + clamp(3.2 - d * 0.1, 0.8, 3.2);
    }
    if (player.alive) {
      const d = Math.hypot(player.position.x - flashPos.x, player.position.z - flashPos.z);
      if (d < 25) {
        tmpVec.set(player.position.x, player.position.y + 1.5, player.position.z);
        if (nav.hasLineOfSight(flashPos, tmpVec, map.shootables)) {
          camera.getWorldDirection(shootDir);
          tmpVec2.subVectors(flashPos, tmpVec).normalize();
          const facing = shootDir.dot(tmpVec2);
          if (facing > 0.1) hud.flashBlind(clamp(1.1 - d * 0.03, 0.3, 1));
        }
      }
    }
  }
}

// --- Input handling ----------------------------------------------------------
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    hud.hideBuy();
  } else if (player.alive && rounds.state.phase === 'live' && !rounds.state.matchOver) {
    // Losing the lock mid-round pauses; losing it in freeze just means the
    // buy menu is open, which is not a pause.
    hud.showPaused();
  }
}

// Clicking the game re-locks the pointer after buying or pausing.
document.getElementById('game').addEventListener('click', () => {
  if (shot || !started || hud.isBuyOpen()) return;
  if (!document.pointerLockElement && player.alive && !rounds.state.matchOver) {
    input.requestLock();
  }
});

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.matchOver) {
    restartMatch();
    return;
  }
  input.requestLock();
});
hud.onRestart(() => restartMatch());

function restartMatch() {
  score = { attackers: 0, defenders: 0 };
  rounds.state.round = 1;
  rounds.state.score = { attackers: 0, defenders: 0 };
  rounds.state.money = 800;
  rounds.state.loadout = { weapon: 'rifle', armor: false, frag: 0, flash: 0 };
  rounds.state.matchOver = false;
  rounds.startRound(bots.bots);
  input.requestLock();
}

function handleBuy(item) {
  if (rounds.buy(item)) {
    audio.buy();
    const loadout = rounds.state.loadout;
    if (item === 'smg' || item === 'rifle' || item === 'sniper') {
      delete ammoStore[item];
      equipWeapon(item);
    }
    if (item === 'armor') player.armor = 50;
    if (item === 'frag') grenades.frag = loadout.frag;
    if (item === 'flash') grenades.flash = loadout.flash;
    hud.setMoney(rounds.state.money);
    hud.updateBuy(rounds.state.money);
    hud.setHealth(player.health, player.armor);
  }
}

function syncCamera() {
  const body = playerMover.state;
  const sx = (random() - 0.5) * shake * 0.05;
  const sy = (random() - 0.5) * shake * 0.05;
  camera.position.set(body.position.x + sx, body.position.y + body.eye + sy, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  shake = Math.max(0, shake - 0.03);
}

// --- The simulation step -----------------------------------------------------
function step(dt) {
  elapsed += dt;
  throwCooldown = Math.max(0, throwCooldown - dt);

  const pressed = input.takePressed();
  const keys = input.state.keys;

  // Slot selection: 1 primary, 2 pistol, 3 frag, 4 flash.
  if (pressed.has('Digit1')) slot = 'weapon';
  if (pressed.has('Digit2')) slot = 'pistol';
  if (pressed.has('Digit3') && grenades.frag > 0) slot = 'frag';
  if (pressed.has('Digit4') && grenades.flash > 0) slot = 'flash';
  if (pressed.has('KeyB') && rounds.state.phase === 'freeze' && player.alive) {
    // B toggles the buy menu during freeze time.
    if (hud.isBuyOpen()) hud.hideBuy();
    else hud.showBuy(rounds.state.money, rounds.state.loadout, handleBuy);
  }
  if (pressed.has('KeyR')) {
    if (weaponSet.reload()) audio.reload();
  }

  // Player movement (dead players do not move).
  if (player.alive) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const wish = wishFromYaw(playerMover.state.yaw, forward, strafe);
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    playerMover.step(dt, wish.x, wish.z, keys.has('Space'), crouch);
    const look = input.takeLook();
    playerMover.look(look.x, look.y);
    // Firing / throwing — only once the round is live (freeze time is safe).
    if (input.state.firing && player.alive && rounds.state.phase === 'live') {
      if (slot === 'frag' || slot === 'flash') {
        throwGrenade(slot);
        input.setFiring(false);
      } else if (weaponSet.state.def.id === 'pistol' && slot === 'pistol') {
        // Semi-auto: one shot per click is handled by the firing flag reset below.
        if (weaponSet.ready()) playerShoot();
      } else if (weaponSet.ready()) {
        playerShoot();
      }
    }
    if (slot === 'pistol' && weaponSet.state.def.id !== 'pistol') {
      // Switching to the sidearm swaps the weapon set to the pistol.
      equipWeapon('pistol');
    } else if (slot === 'weapon' && weaponSet.state.def.id === 'pistol') {
      equipWeapon(rounds.state.loadout.weapon);
    }
  }
  weaponSet.step(dt);

  // Bomb pickup and planting.
  const bomb = rounds.state.bomb;
  if (bomb.state === 'dropped' && player.alive) {
    const d = Math.hypot(player.position.x - bomb.position.x, player.position.z - bomb.position.z);
    if (d < 1.4) {
      rounds.pickupBomb();
      hud.announce('You have the bomb — plant it at A or B.');
      hud.setBomb('BOMB — plant at A or B');
    }
  }
  if (bomb.state === 'carried' && bomb.carrier === 'player' && player.alive && keys.has('KeyE')) {
    const site = inSite(player.position);
    if (site) {
      if (!rounds.state.plantChannel) rounds.state.plantChannel = { by: 'player', progress: 0, site };
      hud.setChannel(`Planting at ${site}…`, rounds.state.plantChannel.progress / 3);
    } else {
      rounds.state.plantChannel = null;
      hud.setChannel(null, null);
    }
  } else if (rounds.state.plantChannel && rounds.state.plantChannel.by === 'player') {
    rounds.state.plantChannel = null;
    hud.setChannel(null, null);
  }
  if (bomb.state === 'planted') {
    beepTimer -= dt;
    if (beepTimer <= 0) {
      beepTimer = bomb.timer < 10 ? 0.5 : 1;
      audio.plantBeep();
    }
    hud.setBomb(`BOMB PLANTED — Site ${bomb.site}`, bomb.timer);
    bombLamp.material.color.setHex(Math.floor(elapsed * 4) % 2 === 0 ? 0xff2e1f : 0x551111);
  } else if (bomb.state === 'dropped') {
    hud.setBomb('BOMB DROPPED — pick it up');
  } else if (bomb.state === 'carried' && bomb.carrier === 'player') {
    hud.setBomb('BOMB — plant at A or B');
  } else {
    hud.setBomb(null);
  }

  // Bots fight the round.
  const bombView = {
    planted: bomb.state === 'planted',
    state: rounds.state.phase === 'live' ? 'live' : 'freeze',
    position: bomb.state === 'planted' || bomb.state === 'dropped'
      ? { x: bomb.position.x, z: bomb.position.z } : { x: 0, z: 0 },
  };
  bots.step(dt, elapsed, combatants, bombView, {
    onBotShoot: (bot, aimPoint, error) => botShoot(bot, aimPoint, error),
    onPlanted: (bot) => {
      rounds.plantBomb(bot.site, { x: bot.mover.state.position.x, z: bot.mover.state.position.z });
    },
    onDefused: () => rounds.defuseBomb(),
  });

  // Grenades in flight.
  for (let i = liveGrenades.length - 1; i >= 0; i -= 1) {
    liveGrenades[i].step(dt, map.colliders);
    if (liveGrenades[i].done) liveGrenades.splice(i, 1);
  }
  combat.step(dt);

  // The bomb mesh follows the bomb state.
  if (bomb.state === 'dropped' || bomb.state === 'planted') {
    bombGroup.visible = true;
    bombGroup.position.set(bomb.position.x, 0.12, bomb.position.z);
  } else {
    bombGroup.visible = false;
  }

  // Round state machine.
  rounds.step(dt, {
    playerAlive: player.alive,
    playerPos: { x: player.position.x, z: player.position.z },
    attackersAlive: (player.alive ? 1 : 0) + bots.bots.filter((b) => b.team === 'attackers' && b.alive).length,
    defendersAlive: bots.bots.filter((b) => b.team === 'defenders' && b.alive).length,
  });

  // HUD numbers.
  playerMover.eyePosition(player.eye);
  hud.setHealth(player.health, player.armor);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.roundTimeLeft(), rounds.state.phase);
  hud.setScore(score.attackers, score.defenders, rounds.state.round);
}

function inSite(pos) {
  for (const [name, site] of Object.entries(map.sites)) {
    if (Math.hypot(pos.x - site.center.x, pos.z - site.center.z) < site.radius) return name;
  }
  return null;
}

// --- Frame loop --------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const body = playerMover.state;
  playerMover.eyePosition(tmpVec);
  const dx = point.x - tmpVec.x;
  const dy = point.y - tmpVec.y;
  const dz = point.z - tmpVec.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  rounds.state.phase = 'live';
  rounds.state.phaseTime = 62;
  const body = playerMover.state;
  if (name === 'start') {
    body.position.set(-12, 0, 20);
    body.yaw = 0.35;
    body.pitch = 0.02;
    settle(20);
    hud.showBuy(800, rounds.state.loadout, () => {});
    hud.setMoney(800);
    hud.setScore(0, 0, 1);
    hud.setTimer(8, 'freeze');
  } else if (name === 'play') {
    body.position.set(-2, 0, 9);
    body.yaw = 0;
    body.pitch = 0;
    settle(10);
    // A defender holds mid; the player drops it with two aimed shots.
    const defender = bots.bots.find((b) => b.name === 'Ash');
    defender.mover.state.position.set(1.5, 0, -2);
    defender.mover.state.yaw = Math.PI;
    const rook = bots.bots.find((b) => b.name === 'Rook');
    rook.mover.state.position.set(-5, 0, 5);
    rook.mover.state.yaw = -0.4;
    settle(20);
    // Aim at the defender's live position each time: it walks between shots.
    const aim = new THREE.Vector3();
    aim.set(defender.mover.state.position.x, 1.1, defender.mover.state.position.z);
    aimAt(aim);
    playerShoot();
    settle(6);
    aim.set(defender.mover.state.position.x, 1.53, defender.mover.state.position.z);
    aimAt(aim);
    playerShoot();
    // Sync the view model so the muzzle flash is lit in the frozen frame.
    weaponSet.step(0);
    hud.setScore(0, 0, 1);
    hud.setTimer(62, 'live');
    hud.announce('Mid control — one down');
  } else {
    // end: the round is won, the bomb just went off at Site A. The camera looks
    // 20 degrees off the blast so the fireball clears the round panel.
    body.position.set(-10, 0, -2);
    body.yaw = 0.35;
    body.pitch = 0.02;
    settle(20);
    score = { attackers: 2, defenders: 0 };
    hud.setScore(2, 0, 3);
    hud.showRoundEnd('Round won', 'The bomb went off — Site A is gone.', score);
    hud.announce('', 1);
    combat.explode(new THREE.Vector3(-19, 0.6, -13), 12, 200, () => {});
    combat.step(0.25); // grow the fireball so the frozen frame catches it mid-blast
    hud.setTimer(0, 'post');
  }
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(weaponSet.state.mag, weaponSet.state.reserve, weaponSet.state.def.name);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A read-only handle for play-testing and captures (the state the HUD reads).
window.__dustline = { player, playerMover, bots, rounds, weaponSet, map };

// Boot.
hud.showStart();
hud.setHealth(100, 0);
hud.setAmmo(weaponSet.state.mag, weaponSet.state.reserve, WEAPONS.rifle.name);
hud.setMoney(rounds.state.money);
hud.setScore(0, 0, 1);
hud.setTimer(8, 'freeze');
rounds.startRound(bots.bots);
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
