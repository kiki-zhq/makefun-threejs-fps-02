// Rounds: freeze time, the live round, the bomb, and the economy. The round is
// won by eliminating the other team, by the bomb going off, or by a defuse;
// the timer running out with no plant gives it to the defenders. First to 8
// rounds takes the match (15 rounds at most).
import { clamp } from './rng.js';

const FREEZE_SECONDS = 8;
const ROUND_SECONDS = 100;
const PLANT_SECONDS = 40;
const PLANT_CHANNEL = 3;
const DEFUSE_CHANNEL = 5;
const WIN_ROUNDS = 8;
const MAX_ROUNDS = 15;

export function createRounds(map, events) {
  const state = {
    phase: 'freeze', // freeze | live | post
    phaseTime: FREEZE_SECONDS,
    round: 1,
    score: { attackers: 0, defenders: 0 },
    money: 800,
    loadout: { weapon: 'rifle', armor: false, frag: 0, flash: 0 },
    bomb: {
      state: 'carried', // carried | dropped | planted
      carrier: null, // a bot, or the string 'player'
      position: { x: 0, z: 0 },
      site: null,
      timer: PLANT_SECONDS,
    },
    plantChannel: null, // { by: 'player' | bot, progress: number, site: 'A'|'B' }
    defuseChannel: null,
    lastReason: '',
    matchOver: false,
  };

  function startRound(bots) {
    state.phase = 'freeze';
    state.phaseTime = FREEZE_SECONDS;
    state.bomb.state = 'carried';
    const carrier = bots.find((b) => b.isCarrier && b.alive) || bots.find((b) => b.team === 'attackers');
    state.bomb.carrier = carrier || null;
    state.bomb.position = { x: 0, z: 0 };
    state.bomb.site = null;
    state.bomb.timer = PLANT_SECONDS;
    state.plantChannel = null;
    state.defuseChannel = null;
    events.onRoundStart(state.round);
  }

  function endRound(winner, reason) {
    if (state.phase === 'post') return;
    state.phase = 'post';
    state.phaseTime = 4;
    state.lastReason = reason;
    state.score[winner] += 1;
    const playerWon = winner === 'attackers';
    state.money += playerWon ? 3250 : 1900;
    state.money = clamp(state.money, 0, 16000);
    events.onRoundEnd(winner, reason, state.score);
  }

  function step(dt, world) {
    if (state.matchOver) return;
    state.phaseTime -= dt;

    // The bomb's fuse runs once it is planted.
    if (state.bomb.state === 'planted') {
      state.bomb.timer -= dt;
      if (state.bomb.timer <= 0) {
        state.bomb.timer = 0;
        events.onBombExploded({ x: state.bomb.position.x, z: state.bomb.position.z });
        endRound('attackers', 'The bomb went off — Site ' + state.bomb.site + ' is gone.');
        return;
      }
    }

    // A plant channel only counts while the carrier stands in a site.
    if (state.plantChannel) {
      const ch = state.plantChannel;
      const site = map.sites[ch.site];
      const at = ch.by === 'player'
        ? world.playerPos
        : { x: ch.by.mover.state.position.x, z: ch.by.mover.state.position.z };
      const inSite = Math.hypot(at.x - site.center.x, at.z - site.center.z) < site.radius;
      const stillCarrier = ch.by === 'player' ? state.bomb.carrier === 'player' : state.bomb.carrier === ch.by;
      if (inSite && stillCarrier && ch.by.alive !== false) {
        ch.progress += dt;
        if (ch.progress >= PLANT_CHANNEL) {
          state.bomb.state = 'planted';
          state.bomb.site = ch.site;
          state.bomb.position = { x: site.center.x, z: site.center.z };
          state.bomb.timer = PLANT_SECONDS;
          state.plantChannel = null;
          events.onBombPlanted(ch.site);
        }
      } else {
        state.plantChannel = null;
      }
    }

    if (state.phase === 'freeze') {
      if (state.phaseTime <= 0) {
        state.phase = 'live';
        state.phaseTime = ROUND_SECONDS;
        events.onRoundLive();
      }
      return;
    }

    if (state.phase === 'live') {
      const attackersAlive = world.attackersAlive;
      const defendersAlive = world.defendersAlive;
      if (state.bomb.state === 'planted') {
        // Once planted, only the fuse ends the round: an explosion or a defuse.
        if (defendersAlive === 0) endRound('attackers', 'All defenders down — the bomb will finish the job.');
      } else {
        if (defendersAlive === 0) endRound('attackers', 'Enemy team eliminated.');
        else if (attackersAlive === 0) endRound('defenders', 'Attackers eliminated.');
        else if (state.phaseTime <= 0) endRound('defenders', 'Time expired — the bomb was never planted.');
      }
      return;
    }

    if (state.phase === 'post') {
      if (state.phaseTime <= 0) {
        if (state.score.attackers >= WIN_ROUNDS || state.score.defenders >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
          state.matchOver = true;
          events.onMatchEnd(state.score);
        } else {
          state.round += 1;
          events.onNextRound(state.round);
        }
      }
    }
  }

  return {
    state,
    startRound,
    step,
    endRound,
    // Economy: buying happens in the freeze phase (and only then).
    buy(item) {
      const prices = { smg: 1500, rifle: 2700, sniper: 4750, frag: 300, flash: 200, armor: 650 };
      const price = prices[item];
      if (price === undefined || state.phase !== 'freeze') return false;
      if (state.money < price) return false;
      if (item === 'smg' || item === 'rifle' || item === 'sniper') state.loadout.weapon = item;
      else if (item === 'frag') state.loadout.frag += 1;
      else if (item === 'flash') state.loadout.flash += 1;
      else if (item === 'armor') state.loadout.armor = true;
      state.money -= price;
      return true;
    },
    addKillMoney() {
      state.money = clamp(state.money + 300, 0, 16000);
    },
    dropBomb(position) {
      if (state.bomb.state === 'planted') return;
      state.bomb.state = 'dropped';
      state.bomb.carrier = null;
      state.bomb.position = { x: position.x, z: position.z };
      state.plantChannel = null;
    },
    pickupBomb() {
      if (state.bomb.state !== 'dropped') return false;
      state.bomb.state = 'carried';
      state.bomb.carrier = 'player';
      return true;
    },
    plantBomb(site, position) {
      state.bomb.state = 'planted';
      state.bomb.site = site;
      state.bomb.position = { x: position.x, z: position.z };
      state.bomb.timer = PLANT_SECONDS;
      state.plantChannel = null;
    },
    defuseBomb() {
      state.bomb.state = 'carried';
      state.bomb.carrier = null;
      state.bomb.site = null;
      endRound('defenders', 'The bomb was defused.');
    },
    roundTimeLeft() {
      return Math.max(0, state.phaseTime);
    },
  };
}
