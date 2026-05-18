import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Player, GameSettings } from '@/lib/gameTypes';
import { supabase } from '@/integrations/supabase/client';
import { playPop, playSubmit, playNotification, playClick, playFootstep } from '@/lib/sounds';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

// =========================== Constants ===========================
const MAP = 120;             // half-extent of map
const GRAVITY = 22;
const JUMP = 8;
const RUN_SPEED = 7;
const MAX_HP = 100;
const MAX_SHIELD = 100;
const BUS_ALT = 60;
const PARACHUTE_FALL = 6;

type Weapon = 'fists' | 'pistol' | 'ar' | 'shotgun';
const WEAPONS: Record<Weapon, { dmg: number; rof: number; range: number; spread: number; pellets: number; mag: number; reload: number; auto: boolean; color: string }> = {
  fists:   { dmg: 8,  rof: 400, range: 2.5, spread: 0,   pellets: 1, mag: 999, reload: 0,    auto: false, color: '#888' },
  pistol:  { dmg: 22, rof: 280, range: 50,  spread: 0.02,pellets: 1, mag: 12,  reload: 1200, auto: false, color: '#777' },
  ar:      { dmg: 18, rof: 95,  range: 80,  spread: 0.05,pellets: 1, mag: 30,  reload: 1800, auto: true,  color: '#3b3b3b' },
  shotgun: { dmg: 12, rof: 700, range: 18,  spread: 0.18,pellets: 8, mag: 6,   reload: 2200, auto: false, color: '#5a3a1a' },
};

type BuildMat = 'wood' | 'stone' | 'metal';
const BUILD_HP: Record<BuildMat, number> = { wood: 80, stone: 140, metal: 220 };

type Build = { id: string; mat: BuildMat; gx: number; gy: number; gz: number; ori: 'wall' | 'floor'; hp: number };
type Chest = { id: string; x: number; z: number; opened: boolean };
type Loot = { x: number; z: number; w: Weapon; ammo: number };

type PlayerState = {
  pid: string; username: string;
  x: number; y: number; z: number;
  tx: number; ty: number; tz: number;
  yaw: number; tyaw: number;
  hp: number; shield: number;
  weapon: Weapon; ammo: number; mag: number;
  inv: Record<Weapon, { ammo: number; mag: number } | null>;
  mats: Record<BuildMat, number>;
  inBus: boolean; parachuting: boolean; alive: boolean;
  kills: number;
};

// =========================== Textures ===========================
function makeNoiseTex(base: string, dots: string, count: number, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = dots;
    ctx.globalAlpha = 0.3 + Math.random() * 0.5;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const useTextures = () => useMemo(() => ({
  grass: (() => { const t = makeNoiseTex('#4a8a3e', '#2d5a2a', 250); t.repeat.set(40, 40); return t; })(),
  wood: makeNoiseTex('#9a6b3a', '#5a3a1a', 40),
  stone: makeNoiseTex('#8a8a8a', '#5a5a5a', 80),
  metal: makeNoiseTex('#c0c4cc', '#6a7080', 30),
  chest: makeNoiseTex('#d4a040', '#7a5010', 50),
  bus: makeNoiseTex('#3a86ff', '#1e4a99', 30),
}), []);

// =========================== Sounds ===========================
function playGunshot(weapon: Weapon) {
  try {
    const ctx = new AudioContext();
    const dur = weapon === 'shotgun' ? 0.25 : 0.08;
    // noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = weapon === 'shotgun' ? 600 : weapon === 'ar' ? 1500 : 2000;
    const gain = ctx.createGain(); gain.gain.value = 0.25;
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    src.start();
    setTimeout(() => ctx.close(), (dur + 0.05) * 1000);
  } catch {}
}
function playBuildSound() { playPop(); }
function playChestOpen() {
  try {
    const ctx = new AudioContext();
    [400, 600, 800, 1000].forEach((f, i) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.06 + 0.18);
      osc.start(ctx.currentTime + i * 0.06); osc.stop(ctx.currentTime + i * 0.06 + 0.2);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {}
}
function playBusEngine(active: boolean, busRef: React.MutableRefObject<{ ctx: AudioContext | null; osc: OscillatorNode | null }>) {
  if (active && !busRef.current.ctx) {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = 70;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400;
      osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      gain.gain.value = 0.06;
      osc.start();
      busRef.current = { ctx, osc };
    } catch {}
  } else if (!active && busRef.current.ctx) {
    try { busRef.current.osc?.stop(); busRef.current.ctx.close(); } catch {}
    busRef.current = { ctx: null, osc: null };
  }
}

// =========================== Map ===========================
function MapTerrain({ tex }: { tex: ReturnType<typeof useTextures> }) {
  // Static buildings + trees scattered deterministically
  const props = useMemo(() => {
    let s = 7777;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const trees: [number, number][] = [];
    const buildings: { x: number; z: number; w: number; d: number; h: number }[] = [];
    for (let i = 0; i < 80; i++) {
      const x = (rnd() - 0.5) * MAP * 2 * 0.9;
      const z = (rnd() - 0.5) * MAP * 2 * 0.9;
      trees.push([x, z]);
    }
    for (let i = 0; i < 14; i++) {
      const x = (rnd() - 0.5) * MAP * 2 * 0.8;
      const z = (rnd() - 0.5) * MAP * 2 * 0.8;
      buildings.push({ x, z, w: 6 + rnd() * 4, d: 6 + rnd() * 4, h: 3 + Math.floor(rnd() * 3) });
    }
    return { trees, buildings };
  }, []);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[MAP * 2, MAP * 2]} />
        <meshStandardMaterial map={tex.grass} />
      </mesh>
      {props.trees.map(([x, z], i) => (
        <group key={`t${i}`} position={[x, 0, z]}>
          <mesh position={[0, 1.5, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.4, 3]} />
            <meshStandardMaterial color="#5a3a1a" />
          </mesh>
          <mesh position={[0, 4, 0]} castShadow>
            <sphereGeometry args={[1.8, 8, 6]} />
            <meshStandardMaterial color="#2d6a2d" />
          </mesh>
        </group>
      ))}
      {props.buildings.map((b, i) => (
        <mesh key={`b${i}`} position={[b.x, b.h / 2, b.z]} castShadow receiveShadow>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial map={tex.stone} />
        </mesh>
      ))}
    </>
  );
}

function StormCircle({ radius }: { radius: number }) {
  return (
    <mesh position={[0, 30, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius, radius + 0.5, 64]} />
      <meshBasicMaterial color="#ff00ff" transparent opacity={0.6} side={THREE.DoubleSide} />
    </mesh>
  );
}

function StormDome({ radius }: { radius: number }) {
  return (
    <mesh position={[0, 30, 0]}>
      <cylinderGeometry args={[radius, radius, 60, 64, 1, true]} />
      <meshBasicMaterial color="#a020f0" transparent opacity={0.18} side={THREE.DoubleSide} />
    </mesh>
  );
}

function ChestMesh({ chest, tex }: { chest: Chest; tex: ReturnType<typeof useTextures> }) {
  if (chest.opened) return null;
  return (
    <group position={[chest.x, 0.4, chest.z]}>
      <mesh castShadow>
        <boxGeometry args={[1.2, 0.8, 0.8]} />
        <meshStandardMaterial map={tex.chest} />
      </mesh>
      <pointLight position={[0, 0.6, 0]} intensity={0.8} distance={3} color="#ffe080" />
    </group>
  );
}

function LootMesh({ loot, w }: { loot: Loot; w: Weapon }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = 0.6 + Math.sin(clock.elapsedTime * 3) * 0.15;
      ref.current.rotation.y = clock.elapsedTime;
    }
  });
  return (
    <mesh ref={ref} position={[loot.x, 0.6, loot.z]}>
      <boxGeometry args={[0.6, 0.2, 1.2]} />
      <meshStandardMaterial color={WEAPONS[w].color} emissive={WEAPONS[w].color} emissiveIntensity={0.3} />
    </mesh>
  );
}

function BuildMesh({ b, tex }: { b: Build; tex: ReturnType<typeof useTextures> }) {
  const t = b.mat === 'wood' ? tex.wood : b.mat === 'stone' ? tex.stone : tex.metal;
  if (b.ori === 'floor') {
    return (
      <mesh position={[b.gx, b.gy + 0.05, b.gz]} castShadow receiveShadow>
        <boxGeometry args={[2, 0.2, 2]} />
        <meshStandardMaterial map={t} />
      </mesh>
    );
  }
  return (
    <mesh position={[b.gx, b.gy + 1, b.gz]} castShadow receiveShadow>
      <boxGeometry args={[2, 2, 0.2]} />
      <meshStandardMaterial map={t} />
    </mesh>
  );
}

function Bus({ progress, tex }: { progress: number; tex: ReturnType<typeof useTextures> }) {
  // Bus flies linearly across the map
  const x = -MAP * 0.8 + progress * MAP * 1.6;
  const z = -MAP * 0.4 + progress * MAP * 0.8;
  return (
    <group position={[x, BUS_ALT, z]}>
      <mesh castShadow>
        <boxGeometry args={[8, 3, 4]} />
        <meshStandardMaterial map={tex.bus} />
      </mesh>
      {/* balloon */}
      <mesh position={[0, 6, 0]}>
        <sphereGeometry args={[5, 16, 12]} />
        <meshStandardMaterial color="#ff3b6b" />
      </mesh>
      <mesh position={[-1, 4.5, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 3]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      <mesh position={[1, 4.5, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 3]} />
        <meshStandardMaterial color="#333" />
      </mesh>
    </group>
  );
}

function OtherPlayer({ p }: { p: PlayerState }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const a = Math.min(1, dt * 12);
    p.x += (p.tx - p.x) * a;
    p.y += (p.ty - p.y) * a;
    p.z += (p.tz - p.z) * a;
    let dy = p.tyaw - p.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    p.yaw += dy * a;
    ref.current.position.set(p.x, p.y, p.z);
    ref.current.rotation.y = p.yaw;
  });
  if (!p.alive) return null;
  return (
    <group ref={ref}>
      {p.parachuting && (
        <mesh position={[0, 2.5, 0]}>
          <sphereGeometry args={[1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#ffcc00" side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.7, 1.6, 0.4]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.7, 0.7, 0.7]} />
        <meshStandardMaterial color="#f1c27d" />
      </mesh>
      <Billboard text={`${p.username} ❤️${p.hp}+${p.shield}`} y={2.2} />
    </group>
  );
}

function Billboard({ text, y }: { text: string; y: number }) {
  const { camera } = useThree();
  const ref = useRef<THREE.Sprite>(null);
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c); tex.needsUpdate = true; return tex;
  }, [text]);
  useFrame(() => { if (ref.current) ref.current.lookAt(camera.position); });
  return (
    <sprite ref={ref} position={[0, y, 0]} scale={[3, 0.75, 1]}>
      <spriteMaterial map={texture} transparent />
    </sprite>
  );
}

// =========================== Controller ===========================
function FPController({
  meRef, keysRef, alive, buildsRef, bobRef, busRef, thirdPerson,
}: {
  meRef: React.MutableRefObject<PlayerState | null>;
  keysRef: React.MutableRefObject<Set<string>>;
  alive: boolean;
  buildsRef: React.MutableRefObject<Build[]>;
  bobRef: React.MutableRefObject<number>;
  busRef: React.MutableRefObject<{ x: number; z: number; y: number } | null>;
  thirdPerson: boolean;
}) {
  const { camera } = useThree();
  const vyRef = useRef(0);
  const groundedRef = useRef(true);

  useFrame((_, dt) => {
    const me = meRef.current;
    if (!me || !alive) return;
    const keys = keysRef.current;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const fx = dir.x, fz = dir.z;
    const flen = Math.hypot(fx, fz) || 1;
    const forward = new THREE.Vector3(fx / flen, 0, fz / flen);
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    me.yaw = Math.atan2(forward.x, forward.z);

    if (me.inBus) {
      // Stick to the bus while in it
      const bus = busRef.current;
      if (bus) { me.x = bus.x; me.y = bus.y - 2; me.z = bus.z; }
      camera.position.set(me.x, me.y + 1, me.z);
      return;
    }

    if (me.parachuting) {
      let dx = 0, dz = 0;
      if (keys.has('w')) { dx += forward.x; dz += forward.z; }
      if (keys.has('s')) { dx -= forward.x; dz -= forward.z; }
      if (keys.has('a')) { dx += right.x; dz += right.z; }
      if (keys.has('d')) { dx -= right.x; dz -= right.z; }
      const len = Math.hypot(dx, dz);
      if (len > 0) { dx /= len; dz /= len; }
      me.x += dx * 8 * dt;
      me.z += dz * 8 * dt;
      me.y -= PARACHUTE_FALL * dt;
      if (me.y <= 1) { me.y = 1; me.parachuting = false; vyRef.current = 0; groundedRef.current = true; }
      camera.position.set(me.x, me.y + 1.5, me.z);
      return;
    }

    let dx = 0, dz = 0;
    if (keys.has('w')) { dx += forward.x; dz += forward.z; }
    if (keys.has('s')) { dx -= forward.x; dz -= forward.z; }
    if (keys.has('a')) { dx += right.x; dz += right.z; }
    if (keys.has('d')) { dx -= right.x; dz -= right.z; }
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }
    const speed = keys.has('shift') ? RUN_SPEED * 1.3 : RUN_SPEED;
    const newX = me.x + dx * speed * dt;
    const newZ = me.z + dz * speed * dt;

    // Build collision
    const hitsBuild = (x: number, y: number, z: number) =>
      buildsRef.current.some((b) => {
        if (b.ori === 'wall') {
          return Math.abs(x - b.gx) < 1.1 && Math.abs(z - b.gz) < 0.3 && y >= b.gy && y <= b.gy + 2.2;
        }
        return Math.abs(x - b.gx) < 1.1 && Math.abs(z - b.gz) < 1.1 && Math.abs(y - b.gy) < 0.4;
      });
    if (!hitsBuild(newX, me.y, me.z)) me.x = newX;
    if (!hitsBuild(me.x, me.y, newZ)) me.z = newZ;

    vyRef.current -= GRAVITY * dt;
    if (keys.has(' ') && groundedRef.current) {
      vyRef.current = JUMP; groundedRef.current = false;
    }
    me.y += vyRef.current * dt;

    // Floor support from floor builds
    let standY = 0;
    buildsRef.current.forEach((b) => {
      if (b.ori === 'floor' && Math.abs(b.gx - me.x) < 1.1 && Math.abs(b.gz - me.z) < 1.1) {
        if (me.y >= b.gy + 0.05 && b.gy + 0.15 > standY) standY = b.gy + 0.15;
      }
    });
    if (me.y <= standY) { me.y = standY; vyRef.current = 0; groundedRef.current = true; }

    const lim = MAP - 2;
    me.x = Math.max(-lim, Math.min(lim, me.x));
    me.z = Math.max(-lim, Math.min(lim, me.z));

    // Camera bob + footstep trigger
    const wasBob = bobRef.current;
    if (len > 0 && groundedRef.current) bobRef.current += dt * 12;
    // Each ~PI in bob = one footstep
    if (len > 0 && groundedRef.current && Math.floor(wasBob / Math.PI) !== Math.floor(bobRef.current / Math.PI)) {
      playFootstep();
    }
    const bob = Math.sin(bobRef.current) * 0.05 * (len > 0 && groundedRef.current ? 1 : 0);
    if (thirdPerson) {
      // Position camera behind & above player along look direction
      const camX = me.x - forward.x * 4.5;
      const camZ = me.z - forward.z * 4.5;
      camera.position.set(camX, me.y + 2.4 + bob, camZ);
    } else {
      camera.position.set(me.x, me.y + 1.6 + bob, me.z);
    }
  });
  return null;
}

function HandWeapon({ weapon, recoilRef }: { weapon: Weapon; recoilRef: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const offset = new THREE.Vector3(0.35, -0.35, -0.7);
    offset.applyQuaternion(camera.quaternion);
    ref.current.position.copy(camera.position).add(offset);
    ref.current.quaternion.copy(camera.quaternion);
    if (recoilRef.current > 0) {
      ref.current.rotateX(-recoilRef.current * 0.4);
      recoilRef.current = Math.max(0, recoilRef.current - 0.08);
    }
  });
  if (weapon === 'fists') {
    return (
      <group ref={ref}>
        <mesh><boxGeometry args={[0.2, 0.2, 0.2]} /><meshStandardMaterial color="#f1c27d" /></mesh>
      </group>
    );
  }
  const cfg = WEAPONS[weapon];
  const len = weapon === 'pistol' ? 0.4 : weapon === 'shotgun' ? 0.85 : 0.7;
  return (
    <group ref={ref}>
      <mesh position={[0, 0, -len / 2]}>
        <boxGeometry args={[0.12, 0.12, len]} />
        <meshStandardMaterial color={cfg.color} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.15, -0.05]}>
        <boxGeometry args={[0.1, 0.25, 0.15]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </group>
  );
}

// =========================== Main ===========================
export default function FortniteBrView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const tex = useTextures();
  const statesRef = useRef<Map<string, PlayerState>>(new Map());
  const meRef = useRef<PlayerState | null>(null);
  const channelRef = useRef<any>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const recoilRef = useRef(0);
  const bobRef = useRef(0);
  const lastShotRef = useRef(0);
  const reloadingRef = useRef<number | null>(null);
  const buildsRef = useRef<Build[]>([]);
  const chestsRef = useRef<Chest[]>([]);
  const lootsRef = useRef<Loot[]>([]);
  const busPosRef = useRef<{ x: number; z: number; y: number } | null>(null);
  const busAudioRef = useRef<{ ctx: AudioContext | null; osc: OscillatorNode | null }>({ ctx: null, osc: null });
  const [, force] = useState(0);
  const rerender = () => force((v) => v + 1);

  const [phase, setPhase] = useState<'bus' | 'play' | 'end'>('bus');
  const [buildMode, setBuildMode] = useState(false);
  const [buildMat, setBuildMat] = useState<BuildMat>('wood');
  const [buildOri, setBuildOri] = useState<'wall' | 'floor'>('wall');
  const [stormR, setStormR] = useState(MAP);
  const [busProgress, setBusProgress] = useState(0);
  const [winner, setWinner] = useState<PlayerState | null>(null);
  const [killFeed, setKillFeed] = useState<{ k: string; v: string }[]>([]);
  const [hitMark, setHitMark] = useState(0);
  const [thirdPerson, setThirdPerson] = useState(false);

  // Init states
  useEffect(() => {
    players.forEach((p) => {
      const ps: PlayerState = {
        pid: p.player_id, username: p.username,
        x: 0, y: BUS_ALT - 2, z: 0,
        tx: 0, ty: BUS_ALT - 2, tz: 0,
        yaw: 0, tyaw: 0, hp: MAX_HP, shield: 0,
        weapon: 'fists', ammo: 0, mag: 999,
        inv: { fists: { ammo: 0, mag: 999 }, pistol: null, ar: null, shotgun: null },
        mats: { wood: 100, stone: 50, metal: 30 },
        inBus: true, parachuting: false, alive: true, kills: 0,
      };
      statesRef.current.set(p.player_id, ps);
      if (p.player_id === playerId) meRef.current = ps;
    });

    // Deterministic chests + loot
    let s = 4242;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const chests: Chest[] = [];
    for (let i = 0; i < 30; i++) {
      chests.push({ id: `c${i}`, x: (rnd() - 0.5) * MAP * 1.8, z: (rnd() - 0.5) * MAP * 1.8, opened: false });
    }
    chestsRef.current = chests;
    const loots: Loot[] = [];
    const wpns: Weapon[] = ['pistol', 'ar', 'shotgun'];
    for (let i = 0; i < 12; i++) {
      const w = wpns[Math.floor(rnd() * wpns.length)];
      loots.push({ x: (rnd() - 0.5) * MAP * 1.6, z: (rnd() - 0.5) * MAP * 1.6, w, ammo: WEAPONS[w].mag * 3 });
    }
    lootsRef.current = loots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime channel
  useEffect(() => {
    const ch = supabase.channel(`br-${code}`);
    ch.on('broadcast', { event: 'br:pos' }, ({ payload }) => {
      if (payload.pid === playerId) return;
      const p = statesRef.current.get(payload.pid);
      if (p) {
        p.tx = payload.x; p.ty = payload.y; p.tz = payload.z; p.tyaw = payload.yaw;
        p.parachuting = payload.par; p.inBus = payload.inBus;
      }
    });
    ch.on('broadcast', { event: 'br:hit' }, ({ payload }) => {
      if (payload.victim !== playerId) return;
      const me = meRef.current;
      if (!me || !me.alive) return;
      let dmg = payload.dmg;
      if (me.shield > 0) {
        const absorbed = Math.min(me.shield, dmg / 2);
        me.shield -= absorbed; dmg -= absorbed;
      }
      me.hp = Math.max(0, me.hp - dmg);
      if (me.hp <= 0) {
        me.alive = false;
        channelRef.current?.send({ type: 'broadcast', event: 'br:died', payload: { victim: playerId, killer: payload.killer, killerName: payload.killerName } });
      }
      rerender();
    });
    ch.on('broadcast', { event: 'br:died' }, ({ payload }) => {
      const v = statesRef.current.get(payload.victim);
      const k = statesRef.current.get(payload.killer);
      if (v) v.alive = false;
      if (k) k.kills += 1;
      setKillFeed((f) => [...f.slice(-4), { k: payload.killerName, v: v?.username || '?' }]);
      playNotification();
    });
    ch.on('broadcast', { event: 'br:build' }, ({ payload }) => {
      buildsRef.current.push(payload.b);
      rerender();
    });
    ch.on('broadcast', { event: 'br:buildhit' }, ({ payload }) => {
      const b = buildsRef.current.find((x) => x.id === payload.id);
      if (b) { b.hp -= payload.dmg; if (b.hp <= 0) buildsRef.current = buildsRef.current.filter((x) => x.id !== payload.id); }
      rerender();
    });
    ch.on('broadcast', { event: 'br:chest' }, ({ payload }) => {
      const c = chestsRef.current.find((x) => x.id === payload.id);
      if (c) c.opened = true;
      rerender();
    });
    ch.on('broadcast', { event: 'br:loot' }, ({ payload }) => {
      lootsRef.current = lootsRef.current.filter((l) => !(l.x === payload.x && l.z === payload.z));
      rerender();
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Bus phase
  useEffect(() => {
    if (phase !== 'bus') return;
    playBusEngine(true, busAudioRef);
    const start = Date.now();
    const dur = 15000;
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / dur);
      setBusProgress(p);
      const x = -MAP * 0.8 + p * MAP * 1.6;
      const z = -MAP * 0.4 + p * MAP * 0.8;
      busPosRef.current = { x, y: BUS_ALT, z };
      if (p >= 1) {
        clearInterval(t);
        playBusEngine(false, busAudioRef);
        // Force eject anyone still in bus
        const me = meRef.current;
        if (me && me.inBus) { me.inBus = false; me.parachuting = true; me.y = BUS_ALT - 4; }
        setPhase('play');
      }
    }, 100);
    return () => { clearInterval(t); playBusEngine(false, busAudioRef); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Storm shrink during play
  useEffect(() => {
    if (phase !== 'play') return;
    const t = setInterval(() => {
      setStormR((r) => Math.max(8, r - 0.4));
      const me = meRef.current;
      if (me && me.alive && !me.parachuting && !me.inBus) {
        const d = Math.hypot(me.x, me.z);
        if (d > stormR) {
          me.hp = Math.max(0, me.hp - 2);
          if (me.hp <= 0) {
            me.alive = false;
            channelRef.current?.send({ type: 'broadcast', event: 'br:died', payload: { victim: playerId, killer: playerId, killerName: 'Vihar' } });
          }
          rerender();
        }
      }
      // End check
      const aliveList = Array.from(statesRef.current.values()).filter((p) => p.alive);
      if ((aliveList.length <= 1 && players.length > 1) || (aliveList.length === 0)) {
        setWinner(aliveList[0] || null);
        setPhase('end');
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stormR, players.length]);

  // Broadcast position
  useEffect(() => {
    const t = setInterval(() => {
      const me = meRef.current;
      if (!me) return;
      channelRef.current?.send({
        type: 'broadcast', event: 'br:pos',
        payload: { pid: playerId, x: me.x, y: me.y, z: me.z, yaw: me.yaw, par: me.parachuting, inBus: me.inBus },
      });
    }, 60);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============ Input ============
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keysRef.current.add(k);
      const me = meRef.current; if (!me) return;
      if (k === ' ' && me.inBus) {
        me.inBus = false; me.parachuting = true;
        const bus = busPosRef.current;
        if (bus) { me.x = bus.x; me.y = bus.y - 5; me.z = bus.z; }
        playClick(); rerender();
      }
      if (k >= '1' && k <= '4') {
        const slot: Weapon[] = ['fists', 'pistol', 'ar', 'shotgun'];
        const w = slot[parseInt(k, 10) - 1];
        if (me.inv[w]) { me.weapon = w; rerender(); }
      }
      if (k === 'q') { setBuildMode((v) => !v); }
      if (k === 'f') { setBuildOri((o) => (o === 'wall' ? 'floor' : 'wall')); }
      if (k === 'z') setBuildMat('wood');
      if (k === 'x') setBuildMat('stone');
      if (k === 'c') setBuildMat('metal');
      if (k === 'r') reload();
      if (k === 'e') interact();
      if (k === 'v') { setThirdPerson((v) => !v); playClick(); }
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    const md = (e: MouseEvent) => {
      if (e.button === 0) {
        if (buildMode) placeBuild();
        else shoot();
      } else if (e.button === 2) {
        if (buildMode) placeBuild(); else shoot();
      }
    };
    const ctx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    window.addEventListener('mousedown', md);
    window.addEventListener('contextmenu', ctx);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousedown', md);
      window.removeEventListener('contextmenu', ctx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildMode]);

  // Auto fire for AR while LMB held
  useEffect(() => {
    let down = false;
    const md = (e: MouseEvent) => { if (e.button === 0) down = true; };
    const mu = (e: MouseEvent) => { if (e.button === 0) down = false; };
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    const t = setInterval(() => {
      const me = meRef.current;
      if (!me || !me.alive || !down || buildMode) return;
      if (WEAPONS[me.weapon].auto) shoot();
    }, 30);
    return () => { clearInterval(t); window.removeEventListener('mousedown', md); window.removeEventListener('mouseup', mu); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildMode]);

  const reload = () => {
    const me = meRef.current; if (!me || !me.alive) return;
    if (me.weapon === 'fists') return;
    const cfg = WEAPONS[me.weapon];
    const inv = me.inv[me.weapon]; if (!inv) return;
    if (inv.mag >= cfg.mag || inv.ammo <= 0) return;
    if (reloadingRef.current) return;
    reloadingRef.current = window.setTimeout(() => {
      const need = cfg.mag - inv.mag;
      const take = Math.min(need, inv.ammo);
      inv.mag += take; inv.ammo -= take;
      reloadingRef.current = null;
      rerender();
    }, cfg.reload);
    playClick();
  };

  const shoot = () => {
    const me = meRef.current; if (!me || !me.alive || me.inBus || me.parachuting) return;
    const cfg = WEAPONS[me.weapon];
    const now = Date.now();
    if (now - lastShotRef.current < cfg.rof) return;
    if (me.weapon !== 'fists') {
      const inv = me.inv[me.weapon]; if (!inv) return;
      if (inv.mag <= 0) { playClick(); return; }
      inv.mag -= 1;
    }
    lastShotRef.current = now;
    recoilRef.current = 1;
    if (me.weapon === 'fists') playPop(); else playGunshot(me.weapon);

    // Raycast for each pellet
    for (let p = 0; p < cfg.pellets; p++) {
      const sp = cfg.spread;
      const yaw = me.yaw + (Math.random() - 0.5) * sp;
      const pitch = (Math.random() - 0.5) * sp;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      let bestPid: string | null = null; let bestDist = cfg.range;
      let bestBuild: Build | null = null;
      statesRef.current.forEach((tp) => {
        if (tp.pid === playerId || !tp.alive) return;
        const ox = tp.x - me.x, oy = tp.y - (me.y + 0.6), oz = tp.z - me.z;
        const dist = Math.hypot(ox, oy, oz);
        if (dist > bestDist) return;
        const ndx = ox / dist, ndy = oy / dist, ndz = oz / dist;
        const dot = ndx * dir.x + ndy * dir.y + ndz * dir.z;
        if (dot > 0.985) { bestDist = dist; bestPid = tp.pid; bestBuild = null; }
      });
      // builds
      buildsRef.current.forEach((b) => {
        const bx = b.gx - me.x, by = (b.gy + 1) - (me.y + 0.6), bz = b.gz - me.z;
        const dist = Math.hypot(bx, by, bz);
        if (dist > bestDist) return;
        const ndx = bx / dist, ndy = by / dist, ndz = bz / dist;
        const dot = ndx * dir.x + ndy * dir.y + ndz * dir.z;
        if (dot > 0.97) { bestDist = dist; bestPid = null; bestBuild = b; }
      });
      if (bestPid) {
        setHitMark(Date.now());
        channelRef.current?.send({
          type: 'broadcast', event: 'br:hit',
          payload: { victim: bestPid, dmg: cfg.dmg, killer: playerId, killerName: username },
        });
      } else if (bestBuild) {
        bestBuild.hp -= cfg.dmg;
        if (bestBuild.hp <= 0) {
          buildsRef.current = buildsRef.current.filter((x) => x.id !== bestBuild!.id);
        }
        channelRef.current?.send({ type: 'broadcast', event: 'br:buildhit', payload: { id: bestBuild.id, dmg: cfg.dmg } });
      }
    }
    rerender();
  };

  const placeBuild = () => {
    const me = meRef.current; if (!me || !me.alive) return;
    if (me.mats[buildMat] <= 0) { playClick(); return; }
    const fwd = new THREE.Vector3(Math.sin(me.yaw), 0, Math.cos(me.yaw));
    const gx = Math.round((me.x + fwd.x * 2) / 2) * 2;
    const gz = Math.round((me.z + fwd.z * 2) / 2) * 2;
    const gy = buildOri === 'floor' ? Math.round(me.y) : Math.floor(me.y);
    if (buildsRef.current.some((b) => b.gx === gx && b.gz === gz && b.gy === gy && b.ori === buildOri)) return;
    const b: Build = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, mat: buildMat, gx, gy, gz, ori: buildOri, hp: BUILD_HP[buildMat] };
    buildsRef.current.push(b);
    me.mats[buildMat] -= 1;
    playBuildSound();
    channelRef.current?.send({ type: 'broadcast', event: 'br:build', payload: { b } });
    rerender();
  };

  const interact = () => {
    const me = meRef.current; if (!me || !me.alive) return;
    // Chest within 2.5m
    const chest = chestsRef.current.find((c) => !c.opened && Math.hypot(c.x - me.x, c.z - me.z) < 2.5);
    if (chest) {
      chest.opened = true;
      playChestOpen();
      // 1-2 weapons + materials + maybe shield
      const wpns: Weapon[] = ['pistol', 'ar', 'shotgun'];
      const w = wpns[Math.floor(Math.random() * wpns.length)];
      const cur = me.inv[w];
      const ammo = WEAPONS[w].mag * 2;
      if (cur) { cur.ammo += ammo; } else { me.inv[w] = { ammo, mag: WEAPONS[w].mag }; }
      me.mats.wood += 30; me.mats.stone += 20; me.mats.metal += 10;
      me.shield = Math.min(MAX_SHIELD, me.shield + 50);
      channelRef.current?.send({ type: 'broadcast', event: 'br:chest', payload: { id: chest.id } });
      rerender();
      return;
    }
    // Ground loot
    const loot = lootsRef.current.find((l) => Math.hypot(l.x - me.x, l.z - me.z) < 2);
    if (loot) {
      const cur = me.inv[loot.w];
      if (cur) cur.ammo += loot.ammo; else me.inv[loot.w] = { ammo: loot.ammo, mag: WEAPONS[loot.w].mag };
      lootsRef.current = lootsRef.current.filter((l) => l !== loot);
      playPop();
      channelRef.current?.send({ type: 'broadcast', event: 'br:loot', payload: { x: loot.x, z: loot.z } });
      rerender();
    }
  };

  // ============ Render ============
  if (phase === 'end') {
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-3">
        <div className="game-card p-6 text-center">
          <h2 className="text-4xl font-bold mb-3">🪂 BATTLE ROYALE VÉGE</h2>
          {winner ? (
            <div className="text-2xl font-bold mb-4">🏆 Victory Royale: {winner.username}</div>
          ) : (
            <div className="mb-4">Nincs túlélő</div>
          )}
          <div className="space-y-1 max-w-md mx-auto">
            {Array.from(statesRef.current.values())
              .sort((a, b) => b.kills - a.kills || (b.alive ? 1 : 0) - (a.alive ? 1 : 0))
              .map((p) => (
                <div key={p.pid} className="flex justify-between p-2 rounded bg-card border-2 border-border">
                  <span className="font-bold">{p.username}</span>
                  <span>🎯 {p.kills} {p.alive ? '❤️' : '💀'}</span>
                </div>
              ))}
          </div>
          <button className="game-btn-primary mt-4" onClick={onFinish}>🔄 Új játék</button>
        </div>
      </div>
    );
  }

  const me = meRef.current;
  const alive = me?.alive ?? false;
  const curInv = me && me.weapon !== 'fists' ? me.inv[me.weapon] : null;
  const hitFlash = Date.now() - hitMark < 150;

  return (
    <div className="fixed inset-0 bg-black select-none cursor-none">
      <Canvas
        camera={{ fov: 78, position: [0, BUS_ALT, 0] }}
        dpr={[1, 1.25]}
        performance={{ min: 0.5 }}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
          gl.setClearColor('#000000', 1);
        }}
      >
        <color attach="background" args={['#87ceeb']} />
        <fog attach="fog" args={['#a0d8ff', 40, MAP * 0.9]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[40, 60, 20]} intensity={1.1} />
        <MapTerrain tex={tex} />
        <StormCircle radius={stormR} />
        <StormDome radius={stormR} />
        {phase === 'bus' && <Bus progress={busProgress} tex={tex} />}
        {chestsRef.current.map((c) => <ChestMesh key={c.id} chest={c} tex={tex} />)}
        {lootsRef.current.map((l, i) => <LootMesh key={i} loot={l} w={l.w} />)}
        {buildsRef.current.map((b) => <BuildMesh key={b.id} b={b} tex={tex} />)}
        {Array.from(statesRef.current.values()).filter((p) => p.pid !== playerId).map((p) => (
          <OtherPlayer key={p.pid} p={p} />
        ))}
        {/* Render local player body when in 3rd person */}
        {thirdPerson && me && alive && !me.inBus && (
          <mesh position={[me.x, me.y + 0.3, me.z]} rotation={[0, me.yaw, 0]} castShadow>
            <boxGeometry args={[0.7, 1.6, 0.4]} />
            <meshStandardMaterial color="#22c55e" />
          </mesh>
        )}
        <FPController meRef={meRef} keysRef={keysRef} alive={alive} buildsRef={buildsRef} bobRef={bobRef} busRef={busPosRef} thirdPerson={thirdPerson} />
        {alive && !me?.inBus && !me?.parachuting && !buildMode && !thirdPerson && <HandWeapon weapon={me?.weapon ?? 'fists'} recoilRef={recoilRef} />}
        <PointerLockControls />
      </Canvas>

      {/* HUD */}
      {me?.inBus && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none bg-gradient-to-b from-black/40 to-transparent">
          <div className="text-5xl font-bold text-yellow-300 drop-shadow-lg animate-pulse">🚌 A BUSZBAN VAGY</div>
          <div className="text-xl mt-3 opacity-90">Nyomd meg a SPACE-t a kiugráshoz!</div>
          <div className="mt-2 text-sm opacity-70">{Math.ceil((1 - busProgress) * 15)} mp múlva auto-kidobás</div>
        </div>
      )}
      {me?.parachuting && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 text-3xl font-bold text-yellow-300 pointer-events-none">
          🪂 ESERNYŐ — WASD kormányzás
        </div>
      )}

      {alive && !me?.inBus && (
        <>
          {/* Crosshair */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-3 h-3 border-2 ${hitFlash ? 'border-red-500' : 'border-white'} rounded-full opacity-80`} />
          </div>
          {/* Stats */}
          <div className="absolute bottom-4 left-4 game-card p-3 text-sm font-bold pointer-events-none space-y-1 min-w-[200px]">
            <div className="flex justify-between"><span>❤️ HP</span><span>{me?.hp}/{MAX_HP}</span></div>
            <div className="h-1.5 bg-black/40 rounded"><div className="h-full bg-green-500 rounded" style={{ width: `${(me!.hp / MAX_HP) * 100}%` }} /></div>
            <div className="flex justify-between"><span>🛡️ Pajzs</span><span>{me?.shield}/{MAX_SHIELD}</span></div>
            <div className="h-1.5 bg-black/40 rounded"><div className="h-full bg-blue-500 rounded" style={{ width: `${(me!.shield / MAX_SHIELD) * 100}%` }} /></div>
            <div className="flex justify-between pt-1"><span>🪵 {me?.mats.wood}</span><span>🪨 {me?.mats.stone}</span><span>⚙️ {me?.mats.metal}</span></div>
          </div>
          {/* Weapon */}
          <div className="absolute bottom-4 right-4 game-card p-3 text-sm font-bold pointer-events-none space-y-1 min-w-[200px]">
            <div className="text-lg">🔫 {me?.weapon.toUpperCase()}</div>
            {curInv && <div>{curInv.mag} / {curInv.ammo} {reloadingRef.current ? '⏳' : ''}</div>}
            {buildMode && <div className="text-yellow-400">🔨 ÉPÍTÉS: {buildMat} ({buildOri})</div>}
          </div>
          {/* Inventory bar */}
          <div className="absolute bottom-32 left-1/2 -translate-x-1/2 flex gap-1 pointer-events-none">
            {(['fists', 'pistol', 'ar', 'shotgun'] as Weapon[]).map((w, i) => (
              <div key={w} className={`px-2 py-1 text-xs font-bold rounded border-2 ${me?.weapon === w ? 'border-yellow-400 bg-yellow-400/20' : 'border-border bg-card/80'} ${!me?.inv[w] ? 'opacity-30' : ''}`}>
                {i + 1} {w === 'fists' ? '✊' : w === 'pistol' ? '🔫' : w === 'ar' ? '🎯' : '💥'}
              </div>
            ))}
          </div>
          {/* Alive count + storm */}
          <div className="absolute top-4 right-4 game-card p-2 text-xs font-bold pointer-events-none">
            <div>👥 Életben: {Array.from(statesRef.current.values()).filter((p) => p.alive).length}</div>
            <div>🌪️ Vihar: {Math.round(stormR)}m</div>
            {me && Math.hypot(me.x, me.z) > stormR && <div className="text-red-500 animate-pulse">⚠️ A VIHARBAN VAGY!</div>}
          </div>
          {/* Kill feed */}
          <div className="absolute top-4 left-4 game-card p-2 text-xs font-bold pointer-events-none max-w-[260px]">
            {killFeed.slice(-5).map((k, i) => (<div key={i}>{k.k} 🎯 {k.v}</div>))}
          </div>
          {/* Controls help */}
          <div className="absolute top-1/2 -translate-y-1/2 right-2 game-card p-2 text-[10px] font-bold pointer-events-none opacity-80">
            <div>WASD mozgás · SHIFT futás</div>
            <div>SPACE ugrás · E láda/loot</div>
            <div>LMB lő · R töltés</div>
            <div>1-4 fegyver · Q építés</div>
            <div>Z/X/C anyag · F fal/padló</div>
            <div>V kamera ({thirdPerson ? '3rd' : '1st'})</div>
          </div>
          {!alive && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-destructive text-6xl font-bold">
              💀 KIESTÉL
            </div>
          )}
        </>
      )}
    </div>
  );
}
