// Synthesised sound effects: no audio files, everything comes from the Web Audio
// API. The context is created lazily on the first user gesture; in a ?shot= capture
// there is no gesture, so every call is a safe no-op.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(duration);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = filterFreq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(gainValue, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      src.connect(filter).connect(gain).connect(master);
      src.start();
      src.stop(ctx.currentTime + duration);
    } catch { /* audio is cosmetic */ }
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = null) {
    if (!ensure()) return;
    try {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(gainValue, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain).connect(master);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch { /* audio is cosmetic */ }
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'sniper') { burst(0.28, 900, 0.9); tone(140, 0.18, 0.5, 'square', 50); }
      else if (kind === 'smg') { burst(0.09, 1800, 0.5); tone(220, 0.06, 0.25, 'square', 90); }
      else if (kind === 'pistol') { burst(0.11, 1400, 0.55); tone(180, 0.08, 0.3, 'square', 70); }
      else { burst(0.16, 1200, 0.7); tone(160, 0.1, 0.35, 'square', 60); }
    },
    enemyShot() { burst(0.14, 800, 0.35); },
    dryFire() { tone(1200, 0.03, 0.2, 'square'); },
    reload() { tone(500, 0.05, 0.3, 'square'); setTimeout(() => tone(700, 0.05, 0.3, 'square'), 350); },
    hit() { tone(1900, 0.05, 0.35, 'sine'); },
    kill() { tone(660, 0.09, 0.4, 'sine'); setTimeout(() => tone(990, 0.12, 0.4, 'sine'), 90); },
    hurt() { tone(110, 0.18, 0.5, 'sawtooth', 60); },
    step() { burst(0.05, 400, 0.12); },
    plantBeep() { tone(1200, 0.07, 0.35, 'sine'); },
    explosion() {
      burst(1.1, 300, 1.0);
      tone(90, 0.9, 0.8, 'sine', 28);
      tone(55, 1.2, 0.6, 'triangle', 24);
    },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.35, 'triangle'), i * 130)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.3, 'triangle'), i * 150)); },
    buy() { tone(880, 0.06, 0.3, 'sine'); setTimeout(() => tone(1175, 0.08, 0.3, 'sine'), 70); },
    flash() { tone(2400, 0.4, 0.25, 'sine', 300); },
  };
}
