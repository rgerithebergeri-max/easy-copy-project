let audioCtx: AudioContext | null = null;

function getCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function playClick() {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.start(); osc.stop(ctx.currentTime + 0.08);
  } catch {}
}

export function playSubmit() {
  try {
    const ctx = getCtx();
    [600, 900, 1200].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.15);
      osc.start(ctx.currentTime + i * 0.08);
      osc.stop(ctx.currentTime + i * 0.08 + 0.15);
    });
  } catch {}
}

export function playNotification() {
  try {
    const ctx = getCtx();
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
  } catch {}
}

export function playTimerWarning() {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
  } catch {}
}

export function playFootstep() {
  try {
    const ctx = getCtx();
    const bufferSize = ctx.sampleRate * 0.08;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) * 0.5;
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 600;
    const gain = ctx.createGain(); gain.gain.value = 0.05;
    noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    noise.start();
  } catch {}
}

export function playPop() {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(); osc.stop(ctx.currentTime + 0.12);
  } catch {}
}

export function playSlideChange() {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(); osc.stop(ctx.currentTime + 0.2);
  } catch {}
}

export function playSuccess() {
  try {
    const ctx = getCtx();
    [659, 784, 988, 1318].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.07;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.3);
    });
  } catch {}
}

export function playError() {
  try {
    const ctx = getCtx();
    [220, 180].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sawtooth'; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.2);
    });
  } catch {}
}

export function playWhoosh() {
  try {
    const ctx = getCtx();
    const bufferSize = ctx.sampleRate * 0.35;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.35);
    const gain = ctx.createGain(); gain.gain.value = 0.12;
    noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    noise.start(); noise.stop(ctx.currentTime + 0.35);
  } catch {}
}

export function playApplause() {
  try {
    const ctx = getCtx();
    const len = ctx.sampleRate * 1.6;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (ctx.sampleRate * 0.2)) * Math.max(0, 1 - (i - ctx.sampleRate * 0.3) / (ctx.sampleRate * 1.3));
      data[i] = (Math.random() * 2 - 1) * env * 0.35;
    }
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 800;
    const gain = ctx.createGain(); gain.gain.value = 0.45;
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    src.start();
  } catch {}
}

export function playMagic() {
  try {
    const ctx = getCtx();
    [523, 698, 880, 1175, 1568].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'triangle'; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.05;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.start(t); o.stop(t + 0.42);
    });
  } catch {}
}

export function playSwoosh() {
  // longer dramatic whoosh
  try {
    const ctx = getCtx();
    const len = ctx.sampleRate * 0.6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(3500, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.6);
    const g = ctx.createGain(); g.gain.value = 0.18;
    src.connect(filter); filter.connect(g); g.connect(ctx.destination);
    src.start(); src.stop(ctx.currentTime + 0.6);
  } catch {}
}

export function playImpact() {
  // boom + low rumble
  try {
    const ctx = getCtx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(180, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.35);
    g.gain.setValueAtTime(0.45, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.5);
    // noise burst
    const len = ctx.sampleRate * 0.18;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const ns = ctx.createBufferSource(); ns.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 800;
    const ng = ctx.createGain(); ng.gain.value = 0.3;
    ns.connect(filt); filt.connect(ng); ng.connect(ctx.destination);
    ns.start();
  } catch {}
}

export function playRiser() {
  // rising tension sweep
  try {
    const ctx = getCtx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 1.2);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.25);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(6000, ctx.currentTime + 1.2);
    o.connect(filter); filter.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 1.3);
  } catch {}
}

export function playDrumroll(duration = 1.2) {
  try {
    const ctx = getCtx();
    const len = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (ctx.sampleRate * 0.05));
      d[i] = (Math.random() * 2 - 1) * env * 0.35;
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 250; filt.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start(); src.stop(ctx.currentTime + duration);
  } catch {}
}

export function playStingChord() {
  // dramatic minor chord stab
  try {
    const ctx = getCtx();
    [110, 165, 220, 277].forEach((f) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.75);
    });
  } catch {}
}

export function playTransition() {
  // short swooshy phase transition
  try {
    const ctx = getCtx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.32);
    // sparkle layer
    [1320, 1760, 2200].forEach((f, i) => {
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.type = 'triangle'; o2.frequency.value = f;
      const t = ctx.currentTime + i * 0.04;
      g2.gain.setValueAtTime(0.001, t);
      g2.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o2.connect(g2); g2.connect(ctx.destination);
      o2.start(t); o2.stop(t + 0.22);
    });
  } catch {}
}


export function fireConfetti(count = 60) {
  try {
    const colors = ['#ffb800', '#00c853', '#ff4d6d', '#2196f3', '#9c27b0', '#ff9800'];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.animationDelay = Math.random() * 0.6 + 's';
      el.style.animationDuration = (1.8 + Math.random() * 1.4) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 4200);
    }
  } catch {}
}
