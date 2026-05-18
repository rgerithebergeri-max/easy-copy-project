export interface Player {
  id: string;
  player_id: string;
  party_id: string;
  username: string;
  avatar: string;
  joined_at: string;
}

export interface GameSettings {
  drawTime: number;
  writeTime: number;
  describeTime: number;
  gameMode: string;
  maxPlayers: number;
  allowImageImport?: boolean;
  // Scribble
  scribbleRounds?: number;
  scribbleDrawTime?: number;
  scribbleCustomWords?: string;
  // Blind Flight
  blindRounds?: number;
  blindDrawTime?: number;
  blindDarkness?: number; // 0..1
  // Animation
  animFrames?: number;
  animFrameTime?: number;
  // Presentation
  presSlides?: number;
  presSlideTime?: number;
  // 3D Shooter
  shooterTime?: number;
  shooterTargets?: number;
  // GeoGuesser
  geoRounds?: number;
  geoTime?: number;
  // Music Quiz
  musicRounds?: number;
  musicGenre?: string;
  // Slither
  slitherDuration?: number;
  // F1 Race
  f1Laps?: number;
  f1DesignTime?: number;
  // PVP
  pvpDuration?: number;
  // Deepfake Sync
  deepfakeRoundTime?: number;
  deepfakeRounds?: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  drawTime: 60,
  writeTime: 30,
  describeTime: 30,
  gameMode: 'normal',
  maxPlayers: 14,
  allowImageImport: false,
  scribbleRounds: 3,
  scribbleDrawTime: 60,
  scribbleCustomWords: '',
  blindRounds: 3,
  blindDrawTime: 45,
  blindDarkness: 0.85,
  animFrames: 6,
  animFrameTime: 30,
  presSlides: 5,
  presSlideTime: 25,
  shooterTime: 90,
  shooterTargets: 28,
  geoRounds: 5,
  geoTime: 90,
  musicRounds: 8,
  musicGenre: 'pop',
  slitherDuration: 120,
  f1Laps: 3,
  f1DesignTime: 90,
  pvpDuration: 120,
  deepfakeRoundTime: 45,
  deepfakeRounds: 1,
};

export interface GameEntry {
  id?: string;
  party_id: string;
  session_number: number;
  chain_index: number;
  step: number;
  player_id: string;
  player_name: string;
  entry_type: string;
  content: string;
  created_at?: string;
}

export interface Reaction {
  id: string;
  type: string;
  x: number;
  y: number;
  timestamp: number;
}

export type GamePhase = 'lobby' | 'writing' | 'drawing' | 'describing' | 'album' | 'waiting' | 'custom-mode';

export const GAME_MODES = [
  { id: 'normal', name: 'NORMÁL', description: 'Klasszikus rajzolás és leírás', icon: '✏️' },
  { id: 'secret', name: 'TITOK', description: 'Nem látod mit rajzolsz!', icon: '🔒' },
  { id: 'modeling-3d', name: '3D MODELL', description: 'Rajz helyett 3D modellt építs', icon: '🧊' },
  { id: 'scribble', name: 'SCRIBBLE', description: 'Tippelős rajz, élő chat', icon: '✍️' },
  { id: 'blind-flight', name: 'VAKREPÜLÉS', description: 'Sötétben rajzolsz, csillagok', icon: '🌑' },
  { id: 'animation', name: 'ANIMÁCIÓ', description: 'Képkockás GIF, exportálható', icon: '🎬' },
  { id: 'presentation', name: 'PREZENTÁCIÓ', description: 'Vicces prezi, közönség reakció', icon: '🎤' },
  { id: 'shooter-3d', name: '3D SHOOTER', description: 'Célbalövős 3D minijáték zenével', icon: '🎯' },
  { id: 'geoguesser', name: 'GEOGUESSER', description: 'Találd ki hol vagy a térképen!', icon: '🌍' },
  { id: 'music-quiz', name: 'ZENEKITALÁLÓ', description: 'Halld a részletet, tippeld meg!', icon: '🎵' },
  { id: 'slither', name: 'KUKAC', description: 'Slither.io stílusú multiplayer', icon: '🐍' },
  { id: 'f1-race', name: 'F1 VERSENY', description: 'Tervezd az autód, majd verseny WASD-vel!', icon: '🏎️' },
  { id: 'mc-pvp', name: 'KARD PVP', description: 'Karddal és aranyalmával FPS harc', icon: '⚔️' },
  { id: 'fortnite-br', name: 'FORTNITE BR', description: 'Battle royale: busz, loot, építés, vihar', icon: '🪂' },
  { id: 'deepfake-sync', name: 'DEEPFAKE SZINKRON', description: 'YT linket adsz, kapsz egyet, némán le kell szinkronizálni!', icon: '🎤' },
];

export const TIME_OPTIONS = [
  { label: '15mp', value: 15 },
  { label: '30mp', value: 30 },
  { label: '45mp', value: 45 },
  { label: '60mp', value: 60 },
  { label: '90mp', value: 90 },
  { label: '120mp', value: 120 },
  { label: 'Korlátlan', value: 0 },
];

export function generatePartyCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function getPhaseLabel(phase: GamePhase): string {
  switch (phase) {
    case 'writing': return 'ÍRJ EGY MONDATOT!';
    case 'drawing': return 'RAJZOLD LE!';
    case 'describing': return 'ÍRD LE MIT LÁTSZ!';
    case 'album': return 'ALBUM';
    default: return '';
  }
}

export function speakHungarian(text: string) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'hu-HU';
  utterance.rate = 0.9;
  utterance.pitch = 1.1;
  window.speechSynthesis.speak(utterance);
}

let blankCanvasCache: string | null = null;
export function getBlankCanvas(): string {
  if (!blankCanvasCache) {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 500;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 800, 500);
    blankCanvasCache = c.toDataURL('image/jpeg', 0.5);
  }
  return blankCanvasCache;
}
