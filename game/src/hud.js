// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill
// feed, bomb banner, and the overlay panels (start, buy, round end, match end,
// down). It never touches the simulation; main.js pushes numbers in and reads
// the button callbacks out.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buyMenu: $('buy-menu'), buyMoney: $('buy-money'),
    roundPanel: $('round-panel'), roundTitle: $('round-title'), roundCopy: $('round-copy'),
    roundScore: $('round-score'), matchPanel: $('match-panel'), matchTitle: $('match-title'),
    matchCopy: $('match-copy'), matchScore: $('match-score'), restart: $('restart'),
    deadPanel: $('dead-panel'), deadCopy: $('dead-copy'),
    healthNum: $('health-num'), armorNum: $('armor-num'), healthBar: $('health-bar'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money'), timer: $('timer'), phase: $('phase'), scoreA: $('score-a'), scoreB: $('score-b'),
    roundNum: $('round-num'), killfeed: $('killfeed'), bombBanner: $('bomb-banner'),
    bombText: $('bomb-text'), bombTimer: $('bomb-timer'), plantWrap: $('plant-wrap'), plantFill: $('plant-fill'),
    plantLabel: $('plant-label'), vignette: $('vignette'), flashOverlay: $('flash-overlay'),
    announce: $('announce'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
  };
  let last = {};
  let hitTimer = 0;
  let announceTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(hp, armor) {
      setText(els.healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      setText(els.armorNum, 'armor', armor > 0 ? `+${Math.ceil(armor)}` : '');
      const frac = Math.max(0, Math.min(1, hp / 100));
      if (last.hpf !== frac) {
        last.hpf = frac;
        els.healthBar.style.width = `${frac * 100}%`;
        els.healthBar.style.background = frac > 0.5 ? '#7ec850' : frac > 0.25 ? '#f0a830' : '#d9553c';
      }
    },
    setAmmo(mag, reserve, name) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'res', `/ ${reserve}`);
      setText(els.weaponName, 'wname', name);
    },
    setMoney(n) { setText(els.money, 'money', `$${n}`); },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      setText(els.timer, 'timer', `${mm}:${ss}`);
      const label = phase === 'freeze' ? 'BUY PHASE' : phase === 'live' ? 'ROUND' : '—';
      setText(els.phase, 'phase', label);
      els.timer.classList.toggle('urgent', phase === 'live' && s <= 10);
    },
    setScore(a, b, round) {
      setText(els.scoreA, 'sa', String(a));
      setText(els.scoreB, 'sb', String(b));
      setText(els.roundNum, 'round', `ROUND ${round}`);
    },
    setBomb(text, seconds) {
      if (text === null) {
        if (last.bomb !== null) { last.bomb = null; els.bombBanner.hidden = true; }
        return;
      }
      last.bomb = text;
      els.bombBanner.hidden = false;
      setText(els.bombText, 'bombtext', text);
      setText(els.bombTimer, 'bombtimer', seconds !== undefined ? `${Math.ceil(seconds)}s` : '');
    },
    setChannel(label, frac) {
      if (frac === null) {
        if (last.channel !== null) { last.channel = null; els.plantWrap.hidden = true; }
        return;
      }
      last.channel = label;
      els.plantWrap.hidden = false;
      setText(els.plantLabel, 'chlabel', label);
      els.plantFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    },
    hitMarker(killed, holdMs = 90) {
      els.hitmarker.classList.add('on');
      els.hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        els.hitmarker.classList.remove('on');
        els.hitmarker.style.transform = '';
      }, holdMs);
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      els.killfeed.prepend(line);
      while (els.killfeed.children.length > 5) els.killfeed.removeChild(els.killfeed.lastChild);
      setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 6000);
    },
    announce(text, ms = 2600) {
      setText(els.announce, 'ann', text);
      els.announce.classList.add('on');
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => els.announce.classList.remove('on'), ms);
    },
    damage() {
      els.vignette.classList.add('on');
      setTimeout(() => els.vignette.classList.remove('on'), 180);
    },
    flashBlind(strength) {
      els.flashOverlay.style.opacity = String(Math.max(0, Math.min(1, strength)));
      if (strength > 0) {
        setTimeout(() => { els.flashOverlay.style.opacity = '0'; }, 1200);
      }
    },
    showStart() {
      els.overlay.hidden = false;
      els.buyMenu.hidden = true;
      els.roundPanel.hidden = true;
      els.matchPanel.hidden = true;
      els.deadPanel.hidden = true;
      els.overlayTitle.textContent = 'DUSTLINE — Site 7';
      els.overlayCopy.textContent = 'Attackers plant the bomb at A or B. Defenders hold the sites. First to 8 rounds takes the match.';
      els.play.textContent = 'Click to play';
    },
    showPaused() {
      els.overlay.hidden = false;
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = 'Click to resume.';
      els.play.textContent = 'Click to resume';
    },
    hideOverlay() { els.overlay.hidden = true; },
    showBuy(money, loadout, onBuy) {
      // The buy menu needs a free cursor: release the pointer lock so the
      // player can click the cards. The round going live hides the menu and
      // the player clicks back into the game to re-lock.
      if (document.pointerLockElement) document.exitPointerLock();
      els.buyMenu.hidden = false;
      setText(els.buyMoney, 'buymoney', `$${money}`);
      els.buyMenu.querySelectorAll('[data-buy]').forEach((btn) => {
        const item = btn.getAttribute('data-buy');
        const owned = (item === loadout.weapon) || (item === 'armor' && loadout.armor)
          || (item === 'frag' && loadout.frag > 0) || (item === 'flash' && loadout.flash > 0);
        btn.classList.toggle('owned', owned);
        btn.onclick = () => onBuy(item);
      });
    },
    hideBuy() { els.buyMenu.hidden = true; },
    isBuyOpen() { return !els.buyMenu.hidden; },
    updateBuy(money) { setText(els.buyMoney, 'buymoney', `$${money}`); },
    showRoundEnd(title, copy, score) {
      els.roundPanel.hidden = false;
      els.roundTitle.textContent = title;
      els.roundCopy.textContent = copy;
      els.roundScore.textContent = `Attackers ${score.attackers} — ${score.defenders} Defenders`;
      setTimeout(() => { els.roundPanel.hidden = true; }, 3800);
    },
    showMatchEnd(title, copy, score) {
      els.matchPanel.hidden = false;
      els.matchTitle.textContent = title;
      els.matchCopy.textContent = copy;
      els.matchScore.textContent = `Final — Attackers ${score.attackers} : ${score.defenders} Defenders`;
    },
    showDead(copy) {
      els.deadPanel.hidden = false;
      els.deadCopy.textContent = copy;
    },
    hideDead() { els.deadPanel.hidden = true; },
    onPlay(handler) { els.play.addEventListener('click', handler); },
    onRestart(handler) { els.restart.addEventListener('click', handler); },
  };
}
