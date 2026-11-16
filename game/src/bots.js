// Bots: the two teams around the player. Attackers push a site and plant;
// defenders hold, rotate to the planted bomb, and defuse. Each bot walks the
// waypoint graph, sees with a raycast, hears nearby gunfire, and fires hitscan
// bursts with an aim error that shrinks the longer it holds a target.
import * as THREE from 'three';
import { createMover } from './physics.js';
import { PALETTE } from './palette.js';
import { clamp, pick, range } from './rng.js';

const BOT_DEFS = [
  { name: 'Vex', team: 'attackers', weapon: 'rifle', carrier: true },
  { name: 'Rook', team: 'attackers', weapon: 'smg', carrier: false },
  { name: 'Ash', team: 'defenders', weapon: 'rifle', carrier: false },
  { name: 'Bishop', team: 'defenders', weapon: 'smg', carrier: false },
  { name: 'Cypher', team: 'defenders', weapon: 'rifle', carrier: false },
  { name: 'Dagger', team: 'defenders', weapon: 'smg', carrier: false },
];

export function createBots(scene, map, nav, camera, opts) {
  const { colliders, shootables, random } = opts;
  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const aimFrom = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const bots = [];

  function buildModel(team) {
    const group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({
      color: new THREE.Color(team === 'attackers' ? PALETTE.accent : PALETTE.teal),
      roughness: 0.75, metalness: 0.05,
    });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sand), roughness: 0.7 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), cloth);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), skin);
    head.position.y = 1.53;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.16), dark);
    legL.position.set(-0.13, 0.31, 0);
    const legR = legL.clone();
    legR.position.x = 0.13;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
    gun.position.set(0.2, 1.15, -0.3);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), dark);
    visor.position.set(0, 1.56, -0.14);
    group.add(torso, head, legL, legR, gun, visor);
    group.traverse((mesh) => { if (mesh.isMesh) { mesh.castShadow = true; } });
    // Health bar above the head, always facing the camera.
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    barBg.position.y = 1.85;
    const barFg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x7ec850, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    barFg.position.set(0, 1.85, 0.001);
    group.add(barBg, barFg);
    return { group, torso, head, barBg, barFg };
  }

  for (const def of BOT_DEFS) {
    const spawn = def.team === 'attackers'
      ? map.spawns.attackers[bots.filter((b) => b.team === 'attackers').length % map.spawns.attackers.length]
      : map.spawns.defenders[bots.filter((b) => b.team === 'defenders').length % map.spawns.defenders.length];
    const mover = createMover(colliders, { x: spawn.x, z: spawn.z }, { yaw: spawn.yaw, walkSpeed: 4.1 });
    const model = buildModel(def.team);
    scene.add(model.group);
    const bot = {
      id: def.name,
      name: def.name,
      team: def.team,
      weaponId: def.weapon,
      isCarrier: def.carrier,
      mover,
      model,
      health: 100,
      armor: 0,
      alive: true,
      fall: 0,
      state: 'push',
      path: [],
      pathIndex: 0,
      target: null,
      aimTime: 0,
      burstLeft: 0,
      burstTimer: 0,
      fireTimer: 0,
      perceiveTimer: range(random, 0, 0.2),
      repathTimer: 0,
      suspect: null,
      site: def.team === 'attackers' ? pick(random, ['A', 'B']) : null,
      holdNode: null,
      channel: null, // { kind: 'plant'|'defuse', progress: 0 }
      blindUntil: 0,
      reaction: range(random, 0.35, 0.6),
      walkPhase: range(random, 0, Math.PI * 2),
      home: { x: spawn.x, z: spawn.z },
    };
    model.torso.userData.bot = bot;
    model.torso.userData.part = 'torso';
    model.head.userData.bot = bot;
    model.head.userData.part = 'head';
    bots.push(bot);
  }

  // The eye point of an enemy: the player carries one, a bot's is its head height.
  function enemyEye(enemy, out) {
    if (enemy.eye) return out.copy(enemy.eye);
    const p = enemy.mover.state.position;
    return out.set(p.x, p.y + 1.5, p.z);
  }

  function enemySpeed(enemy) {
    if (enemy.velocity) return Math.hypot(enemy.velocity.x, enemy.velocity.z);
    if (enemy.mover) return Math.hypot(enemy.mover.state.velocity.x, enemy.mover.state.velocity.z);
    return 0;
  }

  function nearestVisibleEnemy(bot, enemies, time) {
    let best = null;
    let bestDist = Infinity;
    const from = bot.mover.eyePosition(eye);
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const target = enemyEye(enemy, toTarget);
      const dist = target.distanceTo(from);
      // Bots only notice enemies inside 30 m: the attacker spawn sits ~37 m
      // from the defenders' hold, so nobody gets shot leaving spawn.
      if (dist > 30 || dist < 0.5) continue;
      // Rough field of view: only notice what is in front, unless very close.
      const forward = { x: -Math.sin(bot.mover.state.yaw), z: -Math.cos(bot.mover.state.yaw) };
      const dot = ((target.x - from.x) * forward.x + (target.z - from.z) * forward.z) / dist;
      if (dist > 6 && dot < 0.35) continue;
      if (!nav.hasLineOfSight(from, target, shootables)) continue;
      if (dist < bestDist) { bestDist = dist; best = enemy; }
    }
    return best ? { enemy: best, dist: bestDist } : null;
  }

  function setPath(bot, goalNode) {
    const from = nav.nearestWaypoint(bot.mover.state.position.x, bot.mover.state.position.z);
    bot.path = nav.findPath(from, goalNode);
    bot.pathIndex = 0;
  }

  function objectiveNode(bot, bomb) {
    if (bot.team === 'attackers') {
      if (bomb.planted) return nav.nearestWaypoint(bomb.position.x, bomb.position.z);
      const site = map.sites[bot.site];
      return nav.nearestWaypoint(site.center.x, site.center.z);
    }
    if (bomb.planted) return nav.nearestWaypoint(bomb.position.x, bomb.position.z);
    if (bot.holdNode === null) {
      const siteNodes = bot.site === 'A' ? [22, 23, 29] : [24, 25, 30];
      bot.holdNode = pick(random, siteNodes.concat([26, 27, 28]));
    }
    return bot.holdNode;
  }

  function stepBot(bot, dt, time, enemies, bomb, events) {
    const body = bot.mover.state;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.model.group.rotation.x = -bot.fall * 1.45;
      bot.model.group.position.y = -bot.fall * 0.08;
      return;
    }
    const blinded = time < bot.blindUntil;

    // Nobody fights outside the live round: freeze time and the post-round
    // breather are safe — bots hold their spawn and do not shoot.
    if (bomb.state !== 'live') {
      bot.target = null;
      bot.aimTime = 0;
      bot.burstLeft = 0;
      return;
    }

    // Perception, a few times a second.
    bot.perceiveTimer -= dt;
    if (bot.perceiveTimer <= 0 && !blinded) {
      bot.perceiveTimer = 0.2;
      const seen = nearestVisibleEnemy(bot, enemies, time);
      if (seen) {
        bot.target = seen.enemy;
        bot.targetDist = seen.dist;
      } else if (bot.target) {
        bot.target = null;
        bot.aimTime = 0;
        bot.burstLeft = 0;
      }
    }
    if (blinded) { bot.target = null; bot.aimTime = 0; }

    // Channeling a plant or a defuse: stand still and commit.
    if (bot.channel) {
      const need = bot.channel.kind === 'plant' ? 3 : 5;
      bot.channel.progress += dt;
      if (bot.channel.progress >= need) {
        const kind = bot.channel.kind;
        bot.channel = null;
        if (kind === 'plant') events.onPlanted(bot);
        else events.onDefused(bot);
      }
      return;
    }

    if (bot.target && !blinded) {
      // Engage: face the target, aim, fire in bursts.
      const target = bot.target;
      enemyEye(target, aimPoint);
      bot.mover.eyePosition(aimFrom);
      aimDir.subVectors(aimPoint, aimFrom);
      const dist = aimDir.length();
      const wantYaw = Math.atan2(-aimDir.x, -aimDir.z);
      let dyaw = wantYaw - body.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      body.yaw += clamp(dyaw, -3.2 * dt, 3.2 * dt);
      bot.aimTime += dt;
      // Strafe a little while firing so the bot is not a standing target.
      const strafeDir = Math.sin(time * 1.3 + bot.walkPhase) > 0 ? 1 : -1;
      const strafe = bot.aimTime > 0.8 ? strafeDir * 0.5 : 0;
      const wish = { x: Math.cos(body.yaw) * strafe, z: -Math.sin(body.yaw) * strafe };
      bot.mover.step(dt, wish.x, wish.z, false, false);
      bot.fireTimer -= dt;
      bot.burstTimer -= dt;
      if (bot.burstLeft === 0 && bot.burstTimer <= 0) {
        bot.burstLeft = 3 + Math.floor(random() * 3);
        bot.burstTimer = 0.6 + random() * 0.5;
      }
      if (bot.aimTime > bot.reaction && bot.burstLeft > 0 && bot.fireTimer <= 0) {
        bot.fireTimer = 0.11;
        bot.burstLeft -= 1;
        const speed = enemySpeed(target);
        const error = Math.max(0.008, 0.015 + dist * 0.0009 + speed * 0.004 - bot.aimTime * 0.008);
        const aimAtHead = random() < 0.15;
        aimPoint.y += aimAtHead ? 0.35 : -0.15;
        events.onBotShoot(bot, aimPoint, error);
      }
      return;
    }

    // No target: walk the objective.
    bot.repathTimer -= dt;
    const goal = objectiveNode(bot, bomb);
    if (bot.repathTimer <= 0 || bot.path.length === 0) {
      bot.repathTimer = 2.5;
      setPath(bot, goal);
    }
    const node = bot.path[Math.min(bot.pathIndex, bot.path.length - 1)];
    if (node !== undefined) {
      const wp = nav.waypoints[node];
      const dx = wp.x - body.position.x;
      const dz = wp.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.9) {
        bot.pathIndex += 1;
        if (bot.pathIndex >= bot.path.length) {
          // Arrived: attackers with the bomb plant; defenders hold the spot.
          if (bot.team === 'attackers' && bot.isCarrier && !bomb.planted && bomb.state === 'live') {
            const site = map.sites[bot.site];
            const inSite = Math.hypot(body.position.x - site.center.x, body.position.z - site.center.z) < site.radius;
            if (inSite) bot.channel = { kind: 'plant', progress: 0 };
          }
          bot.path = [];
        }
      } else {
        const wantYaw = Math.atan2(-dx, -dz);
        let dyaw = wantYaw - body.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        body.yaw += clamp(dyaw, -4 * dt, 4 * dt);
        bot.mover.step(dt, dx / dist, dz / dist, false, false);
      }
    }

    // Defenders near a planted bomb defuse it.
    if (bot.team === 'defenders' && bomb.planted && !bot.channel) {
      const d = Math.hypot(body.position.x - bomb.position.x, body.position.z - bomb.position.z);
      if (d < 2.2) bot.channel = { kind: 'defuse', progress: 0 };
    }
  }

  function syncModels(dt, time) {
    for (const bot of bots) {
      const body = bot.mover.state;
      const group = bot.model.group;
      if (bot.alive) {
        group.position.set(body.position.x, body.position.y, body.position.z);
        group.rotation.set(0, body.yaw, 0);
        // Walk cycle: a small bob on the legs.
        const speed = Math.hypot(body.velocity.x, body.velocity.z);
        bot.walkPhase += dt * speed * 2.4;
        group.children[2].rotation.x = Math.sin(bot.walkPhase) * 0.5 * Math.min(1, speed / 4);
        group.children[3].rotation.x = -Math.sin(bot.walkPhase) * 0.5 * Math.min(1, speed / 4);
        bot.model.barBg.quaternion.copy(camera.quaternion);
        bot.model.barFg.quaternion.copy(camera.quaternion);
        const frac = clamp(bot.health / 100, 0, 1);
        bot.model.barFg.scale.x = frac;
        bot.model.barFg.position.x = -0.29 * (1 - frac);
        bot.model.barFg.material.color.setHex(frac > 0.5 ? 0x7ec850 : frac > 0.25 ? 0xf0a830 : 0xd9553c);
        bot.model.barBg.visible = frac < 1;
        bot.model.barFg.visible = frac < 1;
      }
    }
  }

  function reset(round) {
    for (const bot of bots) {
      const spawn = bot.team === 'attackers'
        ? map.spawns.attackers[bots.filter((b) => b.team === 'attackers').indexOf(bot) % map.spawns.attackers.length]
        : map.spawns.defenders[bots.filter((b) => b.team === 'defenders').indexOf(bot) % map.spawns.defenders.length];
      bot.mover.state.position.set(spawn.x, 0, spawn.z);
      bot.mover.state.velocity.set(0, 0, 0);
      bot.mover.state.yaw = spawn.yaw;
      bot.mover.state.pitch = 0;
      bot.health = 100;
      bot.armor = 0;
      bot.alive = true;
      bot.fall = 0;
      bot.model.group.rotation.set(0, spawn.yaw, 0);
      bot.model.group.position.set(spawn.x, 0, spawn.z);
      bot.target = null;
      bot.aimTime = 0;
      bot.burstLeft = 0;
      bot.channel = null;
      bot.path = [];
      bot.pathIndex = 0;
      bot.holdNode = null;
      bot.blindUntil = 0;
      if (bot.team === 'attackers') bot.site = pick(random, ['A', 'B']);
    }
  }

  return {
    bots,
    hitMeshes: bots.flatMap((b) => [b.model.torso, b.model.head]),
    step(dt, time, enemies, bomb, events) {
      for (const bot of bots) stepBot(bot, dt, time, enemies, bomb, events);
      syncModels(dt, time);
    },
    reset,
    hearShot(position, rangeMeters) {
      for (const bot of bots) {
        if (!bot.alive || bot.target) continue;
        const d = Math.hypot(bot.mover.state.position.x - position.x, bot.mover.state.position.z - position.z);
        if (d < rangeMeters) {
          bot.suspect = { x: position.x, z: position.z };
          bot.repathTimer = 0;
          const node = nav.nearestWaypoint(position.x, position.z);
          setPath(bot, node);
        }
      }
    },
  };
}
