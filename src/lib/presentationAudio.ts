// Presentation helper audio engine: looping background music + one-shot SFX.

export const PRES_MUSIC = [
  { id: 'dramatic', label: '🎻 Dramatic', src: '/music/dramatic.mp3' },
  { id: 'elades',   label: '💰 Eladás',   src: '/music/elades.mp3' },
  { id: 'meta',     label: '🌀 Meta',     src: '/music/meta.mp3' },
  { id: 'montagem', label: '🔥 Montagem', src: '/music/montagem.mp3' },
] as const;

export const PRES_SFX = [
  { id: 'faaah', label: '😱 FAAAH', src: '/sfx/faaah.mp3' },
  { id: 'wow',   label: '🤩 WOW',   src: '/sfx/wow.mp3' },
  { id: 'bell',  label: '🔔 BELL',  src: '/sfx/bell.mp3' },
] as const;

export type PresMusicId = typeof PRES_MUSIC[number]['id'];
export type PresSfxId   = typeof PRES_SFX[number]['id'];

class PresAudioEngine {
  private musicEl: HTMLAudioElement | null = null;
  private current: PresMusicId | null = null;
  private vol = 0.55;
  private muted = false;
  private ducked = false; // temporary duck (e.g. while YT overlay plays) — does NOT change user mute
  private preloaded = false;

  private effectiveVol() {
    if (this.muted) return 0;
    if (this.ducked) return this.vol * 0.15;
    return this.vol;
  }

  ensure() {
    if (!this.musicEl) {
      const a = new Audio();
      a.loop = true;
      a.preload = 'auto';
      a.volume = this.effectiveVol();
      this.musicEl = a;
    }
    return this.musicEl;
  }

  preload() {
    if (this.preloaded) return;
    this.preloaded = true;
    [...PRES_MUSIC, ...PRES_SFX].forEach((def) => {
      try {
        const a = new Audio(def.src);
        a.preload = 'auto';
        a.load();
      } catch {}
    });
    this.ensure();
  }

  // Call on a user gesture so subsequent .play() works without being blocked.
  unlock() {
    this.preload();
    const el = this.ensure();
    const wasPaused = el.paused;
    const prev = el.volume;
    try {
      el.volume = 0;
      el.play().then(() => { if (wasPaused) el.pause(); el.volume = this.effectiveVol(); }).catch(() => { el.volume = prev; });
    } catch { el.volume = prev; }
  }

  playMusic(id: PresMusicId | null) {
    const el = this.ensure();
    if (!id) { el.pause(); this.current = null; return; }
    if (this.current === id && !el.paused) { el.volume = this.effectiveVol(); return; }
    const def = PRES_MUSIC.find((m) => m.id === id);
    if (!def) return;
    el.src = def.src;
    el.volume = this.effectiveVol();
    el.currentTime = 0;
    el.play().catch(() => {
      setTimeout(() => el.play().catch(() => {}), 180);
    });
    this.current = id;
  }

  stopMusic() {
    if (this.musicEl) this.musicEl.pause();
    this.current = null;
  }

  setVolume(v: number) {
    this.vol = Math.max(0, Math.min(1, v));
    if (this.musicEl) this.musicEl.volume = this.effectiveVol();
  }

  setDucked(d: boolean) {
    this.ducked = d;
    if (this.musicEl) this.musicEl.volume = this.effectiveVol();
  }
  isDucked() { return this.ducked; }

  getVolume() { return this.vol; }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.musicEl) this.musicEl.volume = this.effectiveVol();
  }

  isMuted() { return this.muted; }
  currentMusic() { return this.current; }

  playSfx(id: PresSfxId) {
    const def = PRES_SFX.find((s) => s.id === id);
    if (!def) return;
    const a = new Audio(def.src);
    a.preload = 'auto';
    a.volume = this.muted ? 0 : Math.min(1, this.vol + 0.2);
    a.play().catch(() => {
      setTimeout(() => a.play().catch(() => {}), 120);
    });
  }
}

export const presAudio = new PresAudioEngine();

// Build a randomized preset image library (real funny photos via loremflickr)
const PRESET_KEYWORDS = [
  'funny+cat','silly+dog','clown','funny+baby','pug','llama',
  'rubber+duck','funny+hat','sloth','grumpy+cat','penguin','capybara',
  'funny+goat','funny+monkey','wig','mustache','funny+frog','funny+pig',
  'funny+horse','disco','funny+sheep','funny+kid','funny+old+man','costume',
];
export const PRESET_IMAGES: { id: string; url: string; thumb: string; label: string }[] =
  PRESET_KEYWORDS.map((kw, i) => {
    const lock = 1000 + i * 37;
    return {
      id: `${kw}-${lock}`,
      url:   `https://loremflickr.com/1280/720/${kw}?lock=${lock}`,
      thumb: `https://loremflickr.com/320/180/${kw}?lock=${lock}`,
      label: kw.replace(/\+/g, ' '),
    };
  });

// Parse a YouTube URL / id into a clean video id
export function parseYouTubeId(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0] || null;
    const v = url.searchParams.get('v');
    if (v) return v;
    const m = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  } catch {}
  return null;
}

function parseTimeToken(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const text = raw.trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  const hours = Number(text.match(/(\d+)h/)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)m/)?.[1] || 0);
  const seconds = Number(text.match(/(\d+)s/)?.[1] || 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : undefined;
}

export function parseYouTubeTimestamp(input: string): number | undefined {
  if (!input) return undefined;
  try {
    const url = new URL(input.trim());
    return parseTimeToken(url.searchParams.get('t') || url.searchParams.get('start'));
  } catch {
    const match = input.match(/[?&#](?:t|start)=([^&#]+)/i);
    return parseTimeToken(match?.[1] || null);
  }
}
