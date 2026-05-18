import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Player, GameSettings } from '@/lib/gameTypes';
import { supabase } from '@/integrations/supabase/client';
import { playPop, playSubmit, playNotification, playFootstep } from '@/lib/sounds';
import { getAvatarDisplay } from '@/lib/avatars';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

type Weapon = 'sword' | 'bow';

type PlayerState = {
  pid: string; username: string; avatar: string;
  x: number; y: number; z: number;
  tx: number; ty: number; tz: number;
  yaw: number; tyaw: number;
  hp: number;
  apples: number;
  blocks: number;
  arrows: number;
  weapon: Weapon;
  alive: boolean;
};

type Block = { x: number; y: number; z: number; mat: 'cobble' | 'wood' | 'dirt' };
type ArrowVis = { id: string; from: [number, number, number]; to: [number, number, number]; t0: number };

const ARENA = 30;
const GRAVITY = 22;
const JUMP = 8;
const MOVE_SPEED = 6;
const MAX_HP = 20;
const SWORD_DMG = 5;
const SWORD_RANGE = 3.4;
const BOW_DMG = 7;
const BOW_RANGE = 25;
const APPLE_HEAL = 8;
const REACH = 4.5;

// === Procedural textures ===
function makeGrassTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3e8a3a'; ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#4ca046' : '#2d6028';
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function makeCobbleTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#6e6e6e'; ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * 64, y = Math.random() * 64;
    const r = 6 + Math.random() * 8;
    ctx.fillStyle = `rgb(${80 + Math.random() * 50},${80 + Math.random() * 50},${80 + Math.random() * 50})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function makeWoodTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7a4a23'; ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) {
    ctx.fillStyle = y % 8 === 0 ? '#5b3416' : '#8a5630';
    ctx.fillRect(0, y, 64, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return t;
}
function makeDirtTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7a5230'; ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return t;
}

const useTextures = () => useMemo(() => ({
  grass: makeGrassTex(), cobble: makeCobbleTex(), wood: makeWoodTex(), dirt: makeDirtTex(),
}), []);

function Arena({ tex }: { tex: ReturnType<typeof useTextures> }) {
  tex.grass.repeat.set(ARENA, ARENA);
  const pillars = useMemo(() => {
    const out: { pos: [number, number, number]; mat: 'cobble' | 'wood' }[] = [];
    let s = 12345;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 14; i++) {
      const x = Math.floor((rnd() - 0.5) * (ARENA - 6)) * 2;
      const z = Math.floor((rnd() - 0.5) * (ARENA - 6)) * 2;
      const h = 1 + Math.floor(rnd() * 3);
      for (let y = 0; y < h; y++) {
        out.push({ pos: [x, 0.5 + y, z], mat: rnd() > 0.5 ? 'cobble' : 'wood' });
      }
    }
    return out;
  }, []);
  // walls
  const walls = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let x = -ARENA; x <= ARENA; x += 1) {
      for (let y = 0; y < 3; y++) {
        out.push([x, 0.5 + y, -ARENA]);
        out.push([x, 0.5 + y, ARENA]);
      }
    }
    for (let z = -ARENA + 1; z < ARENA; z += 1) {
      for (let y = 0; y < 3; y++) {
        out.push([-ARENA, 0.5 + y, z]);
        out.push([ARENA, 0.5 + y, z]);
      }
    }
    return out;
  }, []);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ARENA * 2 + 4, ARENA * 2 + 4]} />
        <meshStandardMaterial map={tex.grass} />
      </mesh>
      {walls.map((p, i) => (
        <mesh key={i} position={p} castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial map={tex.cobble} />
        </mesh>
      ))}
      {pillars.map((b, i) => (
        <mesh key={`p${i}`} position={b.pos} castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial map={b.mat === 'cobble' ? tex.cobble : tex.wood} />
        </mesh>
      ))}
    </>
  );
}

function PlacedBlocks({ blocks, tex }: { blocks: Block[]; tex: ReturnType<typeof useTextures> }) {
  return (
    <>
      {blocks.map((b, i) => (
        <mesh key={`${b.x}_${b.y}_${b.z}_${i}`} position={[b.x, b.y, b.z]} castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial map={b.mat === 'cobble' ? tex.cobble : b.mat === 'wood' ? tex.wood : tex.dirt} />
        </mesh>
      ))}
    </>
  );
}

function AvatarTexture(avatar: string) {
  const av = getAvatarDisplay(avatar);
  if (!av.src) return null;
  const tex = new THREE.TextureLoader().load(av.src);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function OtherPlayer({ p }: { p: PlayerState }) {
  const ref = useRef<THREE.Group>(null);
  const headTex = useMemo(() => AvatarTexture(p.avatar), [p.avatar]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const a = Math.min(1, dt * 12);
    // Smooth interpolation
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
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.7, 1.6, 0.4]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.7, 0.7, 0.7]} />
        {headTex ? (
          <meshStandardMaterial map={headTex} />
        ) : (
          <meshStandardMaterial color="#f1c27d" />
        )}
      </mesh>
      <mesh position={[0.5, 0.2, 0.3]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[0.1, 1, 0.1]} />
        <meshStandardMaterial color="#dddddd" metalness={0.7} />
      </mesh>
      <Billboard text={`${p.username} ❤️${p.hp}`} y={2} />
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
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }, [text]);
  useFrame(() => { if (ref.current) ref.current.lookAt(camera.position); });
  return (
    <sprite ref={ref} position={[0, y, 0]} scale={[2, 0.5, 1]}>
      <spriteMaterial map={texture} transparent />
    </sprite>
  );
}

function FirstPersonController({
  meRef, keysRef, onShake, alive, blocksRef,
}: {
  meRef: React.MutableRefObject<PlayerState | null>;
  keysRef: React.MutableRefObject<Set<string>>;
  onShake: React.MutableRefObject<number>;
  alive: boolean;
  blocksRef: React.MutableRefObject<Block[]>;
}) {
  const { camera } = useThree();
  const vyRef = useRef(0);
  const groundedRef = useRef(true);
  const stepRef = useRef(0);

  useFrame((_, dt) => {
    const me = meRef.current;
    if (!me || !alive) return;
    const keys = keysRef.current;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // Horizontal forward direction the camera looks at
    const fx = dir.x, fz = dir.z;
    const flen = Math.hypot(fx, fz) || 1;
    const forward = new THREE.Vector3(fx / flen, 0, fz / flen);
    // Right = forward rotated -90° around Y → (forward.z, 0, -forward.x)
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    me.yaw = Math.atan2(forward.x, forward.z);
    let dx = 0, dz = 0;
    if (keys.has('w')) { dx += forward.x; dz += forward.z; }
    if (keys.has('s')) { dx -= forward.x; dz -= forward.z; }
    if (keys.has('a')) { dx += right.x; dz += right.z; }
    if (keys.has('d')) { dx -= right.x; dz -= right.z; }
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }
    const newX = me.x + dx * MOVE_SPEED * dt;
    const newZ = me.z + dz * MOVE_SPEED * dt;
    // Block collision (simple): block at (round(newX), me.y, round(newZ))
    const blockAt = (x: number, y: number, z: number) =>
      blocksRef.current.some((b) => b.x === Math.round(x) && b.y === Math.round(y) && b.z === Math.round(z));
    if (!blockAt(newX, me.y, me.z)) me.x = newX;
    if (!blockAt(me.x, me.y, newZ)) me.z = newZ;
    // gravity
    vyRef.current -= GRAVITY * dt;
    if (keys.has(' ') && groundedRef.current) {
      vyRef.current = JUMP;
      groundedRef.current = false;
    }
    me.y += vyRef.current * dt;
    // ground check: floor or top of block beneath
    const standY = blocksRef.current
      .filter((b) => Math.round(b.x) === Math.round(me.x) && Math.round(b.z) === Math.round(me.z) && b.y < me.y)
      .reduce((m, b) => Math.max(m, b.y + 1), 0) + 0.9;
    if (me.y <= standY) { me.y = standY; vyRef.current = 0; groundedRef.current = true; }
    // Footsteps
    if (len > 0 && groundedRef.current) {
      stepRef.current += dt * 2.4;
      if (stepRef.current >= 1) { stepRef.current = 0; playFootstep(); }
    }
    const lim = ARENA - 1.2;
    me.x = Math.max(-lim, Math.min(lim, me.x));
    me.z = Math.max(-lim, Math.min(lim, me.z));
    let shake = 0;
    if (onShake.current > 0) {
      shake = Math.sin(Date.now() / 30) * 0.1 * onShake.current;
      onShake.current = Math.max(0, onShake.current - dt * 4);
    }
    camera.position.set(me.x + shake, me.y + 0.8, me.z);
  });
  return null;
}

function LookOutline({ meRef, blocksRef }: {
  meRef: React.MutableRefObject<PlayerState | null>;
  blocksRef: React.MutableRefObject<Block[]>;
}) {
  const { camera } = useThree();
  const ref = useRef<THREE.LineSegments>(null);
  const [pos, setPos] = useState<[number, number, number] | null>(null);
  useFrame(() => {
    const me = meRef.current; if (!me) return;
    const origin = new THREE.Vector3(me.x, me.y + 0.8, me.z);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // Raycast through up to REACH meters in small steps, find nearest block
    let hit: [number, number, number] | null = null;
    for (let t = 0.5; t < REACH; t += 0.15) {
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      const bx = Math.round(px), by = Math.round(py), bz = Math.round(pz);
      const found = blocksRef.current.some((b) => b.x === bx && b.y === by && b.z === bz);
      if (found) { hit = [bx, by, bz]; break; }
    }
    setPos(hit);
  });
  if (!pos) return null;
  return (
    <lineSegments ref={ref} position={pos}>
      <edgesGeometry args={[new THREE.BoxGeometry(1.02, 1.02, 1.02)]} />
      <lineBasicMaterial color="#000000" linewidth={2} />
    </lineSegments>
  );
}

function HandWeapon({ swingRef, weapon }: { swingRef: React.MutableRefObject<number>; weapon: Weapon }) {
  const { camera } = useThree();
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const offset = new THREE.Vector3(0.35, -0.35, -0.7);
    offset.applyQuaternion(camera.quaternion);
    ref.current.position.copy(camera.position).add(offset);
    ref.current.quaternion.copy(camera.quaternion);
    const swing = swingRef.current;
    if (swing > 0) {
      const a = Math.sin((1 - swing) * Math.PI) * 1.2;
      ref.current.rotateX(-a);
      ref.current.rotateZ(a * 0.5);
      swingRef.current = Math.max(0, swing - 0.05);
    }
  });
  if (weapon === 'bow') {
    return (
      <group ref={ref}>
        {/* Bow arc */}
        <mesh rotation={[0, 0, 0]}><torusGeometry args={[0.35, 0.025, 6, 12, Math.PI]} /><meshStandardMaterial color="#7c3a1d" /></mesh>
        {/* String */}
        <mesh position={[0, 0, 0.02]}><boxGeometry args={[0.02, 0.7, 0.005]} /><meshStandardMaterial color="#eeeeee" /></mesh>
        {/* Notched arrow */}
        <mesh position={[0, 0, -0.25]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.015, 0.015, 0.55]} /><meshStandardMaterial color="#d4a373" /></mesh>
        <mesh position={[0, 0, -0.5]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.04, 0.08, 4]} /><meshStandardMaterial color="#9ca3af" metalness={0.8} /></mesh>
      </group>
    );
  }
  return (
    <group ref={ref}>
      <mesh><boxGeometry args={[0.08, 0.7, 0.08]} /><meshStandardMaterial color="#e5e7eb" metalness={0.8} roughness={0.3} /></mesh>
      <mesh position={[0, -0.4, 0]}><boxGeometry args={[0.12, 0.2, 0.12]} /><meshStandardMaterial color="#7c3a1d" /></mesh>
    </group>
  );
}

function ArrowTrails({ arrowsRef }: { arrowsRef: React.MutableRefObject<ArrowVis[]> }) {
  const [, force] = useState(0);
  useFrame(() => {
    const now = Date.now();
    const before = arrowsRef.current.length;
    arrowsRef.current = arrowsRef.current.filter((a) => now - a.t0 < 600);
    if (arrowsRef.current.length !== before) force((v) => v + 1);
  });
  return (
    <>
      {arrowsRef.current.map((a) => {
        const dx = a.to[0] - a.from[0], dy = a.to[1] - a.from[1], dz = a.to[2] - a.from[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        const mid: [number, number, number] = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2, (a.from[2] + a.to[2]) / 2];
        const yaw = Math.atan2(dx, dz);
        const pitch = -Math.asin(dy / len);
        return (
          <group key={a.id} position={mid} rotation={[pitch, yaw, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.025, 0.025, len]} /><meshStandardMaterial color="#d4a373" /></mesh>
          </group>
        );
      })}
    </>
  );
}

function IntroPan({ done }: { done: () => void }) {
  const { camera } = useThree();
  const t0 = useRef(Date.now());
  useFrame(() => {
    const t = (Date.now() - t0.current) / 1000;
    const ang = t * 0.3;
    camera.position.set(Math.cos(ang) * 45, 25 - t * 1.5, Math.sin(ang) * 45);
    camera.lookAt(0, 1, 0);
    if (t > 5) done();
  });
  return null;
}

export default function McPvpView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const duration = Math.max(60, Math.min(600, settings.pvpDuration ?? 180));
  const tex = useTextures();
  const statesRef = useRef<Map<string, PlayerState>>(new Map());
  const meRef = useRef<PlayerState | null>(null);
  const channelRef = useRef<any>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const swingRef = useRef(0);
  const shakeRef = useRef(0);
  const lastAttackRef = useRef(0);
  const lastBuildRef = useRef(0);
  const blocksRef = useRef<Block[]>([]);
  const arrowsRef = useRef<ArrowVis[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [, force] = useState(0);
  const rerender = () => force((v) => v + 1);
  const [phase, setPhase] = useState<'intro' | 'play' | 'end'>('intro');
  const [winner, setWinner] = useState<PlayerState | null>(null);
  const [timeLeft, setTimeLeft] = useState(duration);
  const [killFeed, setKillFeed] = useState<{ killer: string; victim: string; t: number }[]>([]);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    players.forEach((p, i) => {
      const a = (i / players.length) * Math.PI * 2;
      const r = ARENA * 0.6;
      const ps: PlayerState = {
        pid: p.player_id, username: p.username, avatar: p.avatar,
        x: Math.cos(a) * r, y: 0.9, z: Math.sin(a) * r,
        tx: Math.cos(a) * r, ty: 0.9, tz: Math.sin(a) * r,
        yaw: 0, tyaw: 0, hp: MAX_HP, apples: 3, blocks: 32, arrows: 10, weapon: 'sword', alive: true,
      };
      statesRef.current.set(p.player_id, ps);
      if (p.player_id === playerId) meRef.current = ps;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Channel
  useEffect(() => {
    const ch = supabase.channel(`pvp-${code}`);
    ch.on('broadcast', { event: 'pvp:pos' }, ({ payload }) => {
      if (payload.pid === playerId) return;
      const p = statesRef.current.get(payload.pid);
      if (p) { p.tx = payload.x; p.ty = payload.y; p.tz = payload.z; p.tyaw = payload.yaw; }
    });
    ch.on('broadcast', { event: 'pvp:hit' }, ({ payload }) => {
      if (payload.victim === playerId) {
        const me = meRef.current;
        if (!me || !me.alive) return;
        me.hp = Math.max(0, me.hp - (payload.dmg ?? SWORD_DMG));
        shakeRef.current = 1;
        playPop();
        if (me.hp <= 0) {
          me.alive = false;
          channelRef.current?.send({ type: 'broadcast', event: 'pvp:died', payload: { victim: playerId, killer: payload.killer, killerName: payload.killerName } });
        }
        rerender();
      }
    });
    ch.on('broadcast', { event: 'pvp:arrow' }, ({ payload }) => {
      arrowsRef.current.push({ id: payload.id, from: payload.from, to: payload.to, t0: Date.now() });
    });
    ch.on('broadcast', { event: 'pvp:died' }, ({ payload }) => {
      const p = statesRef.current.get(payload.victim);
      if (p) p.alive = false;
      setKillFeed((f) => [...f.slice(-4), { killer: payload.killerName, victim: p?.username || '?', t: Date.now() }]);
      playNotification();
    });
    ch.on('broadcast', { event: 'pvp:heal' }, ({ payload }) => {
      const p = statesRef.current.get(payload.pid);
      if (p) { p.hp = payload.hp; p.apples = payload.apples; }
    });
    ch.on('broadcast', { event: 'pvp:build' }, ({ payload }) => {
      blocksRef.current.push(payload.block);
      setBlocks([...blocksRef.current]);
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Input
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keysRef.current.add(k);
      if (k === 'e') eatApple();
      const me = meRef.current;
      if (me && me.alive) {
        if (k === '1') { me.weapon = 'sword'; rerender(); }
        if (k === '2') { me.weapon = 'bow'; rerender(); }
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    const md = (e: MouseEvent) => {
      if (e.button === 0) attack();
      else if (e.button === 2) placeBlock();
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
  }, []);

  // Broadcast pos
  useEffect(() => {
    const t = setInterval(() => {
      const me = meRef.current;
      if (!me) return;
      channelRef.current?.send({
        type: 'broadcast', event: 'pvp:pos',
        payload: { pid: playerId, x: me.x, y: me.y, z: me.z, yaw: me.yaw },
      });
    }, 60);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer + end check
  useEffect(() => {
    if (phase !== 'play') return;
    startedAtRef.current = Date.now();
    const t = setInterval(() => {
      const left = Math.max(0, duration - Math.floor((Date.now() - startedAtRef.current) / 1000));
      setTimeLeft(left);
      const alivePlayers = Array.from(statesRef.current.values()).filter((p) => p.alive);
      if ((alivePlayers.length <= 1 && players.length > 1) || left <= 0) {
        clearInterval(t);
        const all = Array.from(statesRef.current.values());
        const w = alivePlayers[0] || all.sort((a, b) => b.hp - a.hp)[0];
        setWinner(w);
        setPhase('end');
      }
      rerender();
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, players.length, phase]);

  const attack = () => {
    const me = meRef.current;
    if (!me || !me.alive) return;
    const now = Date.now();
    if (me.weapon === 'bow') {
      if (now - lastAttackRef.current < 700) return;
      if (me.arrows <= 0) { playPop(); return; }
      lastAttackRef.current = now;
      me.arrows -= 1;
      swingRef.current = 1;
      playSubmit();
      const fwd = new THREE.Vector3(Math.sin(me.yaw), 0, Math.cos(me.yaw));
      let bestPid: string | null = null;
      let bestDist = BOW_RANGE;
      statesRef.current.forEach((p) => {
        if (p.pid === playerId || !p.alive) return;
        const dx = p.x - me.x, dz = p.z - me.z;
        const dist = Math.hypot(dx, dz);
        if (dist > bestDist) return;
        const ndx = dx / dist, ndz = dz / dist;
        const dot = ndx * fwd.x + ndz * fwd.z;
        if (dot > 0.985) { bestDist = dist; bestPid = p.pid; }
      });
      const from: [number, number, number] = [me.x + fwd.x * 0.5, me.y + 0.6, me.z + fwd.z * 0.5];
      const endDist = bestPid ? bestDist : BOW_RANGE;
      const to: [number, number, number] = [me.x + fwd.x * endDist, me.y + 0.6, me.z + fwd.z * endDist];
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      arrowsRef.current.push({ id, from, to, t0: Date.now() });
      channelRef.current?.send({ type: 'broadcast', event: 'pvp:arrow', payload: { id, from, to } });
      if (bestPid) {
        channelRef.current?.send({
          type: 'broadcast', event: 'pvp:hit',
          payload: { victim: bestPid, killer: playerId, killerName: username, dmg: BOW_DMG },
        });
      }
      rerender();
      return;
    }
    // sword
    if (now - lastAttackRef.current < 500) return;
    lastAttackRef.current = now;
    swingRef.current = 1;
    playSubmit();
    const fwd = new THREE.Vector3(Math.sin(me.yaw), 0, Math.cos(me.yaw));
    let bestPid: string | null = null;
    let bestDist = SWORD_RANGE;
    statesRef.current.forEach((p) => {
      if (p.pid === playerId || !p.alive) return;
      const dx = p.x - me.x, dz = p.z - me.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bestDist) return;
      const ndx = dx / dist, ndz = dz / dist;
      const dot = ndx * fwd.x + ndz * fwd.z;
      if (dot > 0.65) { bestDist = dist; bestPid = p.pid; }
    });
    if (bestPid) {
      channelRef.current?.send({
        type: 'broadcast', event: 'pvp:hit',
        payload: { victim: bestPid, killer: playerId, killerName: username, dmg: SWORD_DMG },
      });
    }
  };

  const placeBlock = () => {
    const me = meRef.current;
    if (!me || !me.alive || me.blocks <= 0) return;
    const now = Date.now();
    if (now - lastBuildRef.current < 200) return;
    lastBuildRef.current = now;
    const fwd = new THREE.Vector3(Math.sin(me.yaw), 0, Math.cos(me.yaw));
    const bx = Math.round(me.x + fwd.x * 2);
    const bz = Math.round(me.z + fwd.z * 2);
    const by = Math.round(me.y - 0.5);
    // Avoid placing inside player
    if (Math.abs(bx - me.x) < 0.6 && Math.abs(bz - me.z) < 0.6 && Math.abs(by - me.y) < 1) return;
    const block: Block = { x: bx, y: by, z: bz, mat: 'cobble' };
    blocksRef.current.push(block);
    setBlocks([...blocksRef.current]);
    me.blocks -= 1;
    playPop();
    channelRef.current?.send({ type: 'broadcast', event: 'pvp:build', payload: { block } });
    rerender();
  };

  const eatApple = () => {
    const me = meRef.current;
    if (!me || !me.alive || me.apples <= 0 || me.hp >= MAX_HP) return;
    me.apples -= 1;
    me.hp = Math.min(MAX_HP, me.hp + APPLE_HEAL);
    playPop();
    channelRef.current?.send({
      type: 'broadcast', event: 'pvp:heal',
      payload: { pid: playerId, hp: me.hp, apples: me.apples },
    });
    rerender();
  };

  if (phase === 'end') {
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-3">
        <div className="game-card p-6 text-center">
          <h2 className="text-4xl font-bold mb-3">⚔️ VÉGE!</h2>
          {winner ? (
            <div className="text-2xl font-bold mb-4">🏆 Győztes: {winner.username}</div>
          ) : (
            <div>Döntetlen</div>
          )}
          <div className="space-y-1 max-w-md mx-auto">
            {Array.from(statesRef.current.values())
              .sort((a, b) => (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || b.hp - a.hp)
              .map((p) => (
                <div key={p.pid} className="flex justify-between p-2 rounded bg-card border-2 border-border">
                  <span className="font-bold">{p.username}</span>
                  <span>{p.alive ? `❤️ ${p.hp}` : '💀'}</span>
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

  return (
    <div className="fixed inset-0 bg-black select-none">
      <Canvas
        shadows
        camera={{ fov: 75, position: [0, 1.7, 0] }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
          gl.setClearColor('#000000', 1);
        }}
      >
        <color attach="background" args={['#87ceeb']} />
        <fog attach="fog" args={['#87ceeb', 30, 80]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[20, 30, 10]} intensity={1.2} castShadow shadow-mapSize={[1024, 1024]} />
        <Arena tex={tex} />
        <PlacedBlocks blocks={blocks} tex={tex} />
        {phase === 'play' && alive && <LookOutline meRef={meRef} blocksRef={blocksRef} />}
        {Array.from(statesRef.current.values()).filter((p) => p.pid !== playerId).map((p) => (
          <OtherPlayer key={p.pid} p={p} />
        ))}
        {phase === 'intro' ? (
          <IntroPan done={() => setPhase('play')} />
        ) : (
          <>
            <FirstPersonController meRef={meRef} keysRef={keysRef} onShake={shakeRef} alive={alive} blocksRef={blocksRef} />
            {alive && <HandWeapon swingRef={swingRef} weapon={me?.weapon ?? 'sword'} />}
            <ArrowTrails arrowsRef={arrowsRef} />
            {alive && <PointerLockControls />}
          </>
        )}
      </Canvas>
      {phase === 'intro' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none bg-gradient-to-b from-black/40 to-transparent">
          <div className="text-6xl font-bold animate-zoom-in text-yellow-400">⚔️ KARD PVP</div>
          <div className="text-xl mt-3 opacity-80">Az utolsó túlélő nyer!</div>
          <div className="mt-6 game-card px-4 py-2 text-sm">
            {players.map((p) => p.username).join(' · ')}
          </div>
        </div>
      )}
      {phase === 'play' && (
        <>
          <div className="absolute top-4 left-4 game-card p-3 text-sm font-bold pointer-events-none space-y-1">
            <div>❤️ HP: {me?.hp ?? 0}/{MAX_HP}</div>
            <div>🍎 Aranyalma: {me?.apples ?? 0} (E)</div>
            <div>🧱 Blokk: {me?.blocks ?? 0} (jobb klikk)</div>
            <div>🏹 Nyíl: {me?.arrows ?? 0}</div>
            <div>🗡️ Fegyver: <span className="text-yellow-400">{me?.weapon === 'bow' ? 'ÍJ (2)' : 'KARD (1)'}</span></div>
            <div>⏱️ {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</div>
          </div>
          <div className="absolute top-4 right-4 game-card p-3 text-xs font-bold pointer-events-none max-w-[220px]">
            <div className="mb-1">⚔️ Életben</div>
            {Array.from(statesRef.current.values()).filter((p) => p.alive).map((p) => (
              <div key={p.pid} className="flex justify-between">
                <span>{p.username}</span>
                <span>❤️{p.hp}</span>
              </div>
            ))}
          </div>
          <div className="absolute bottom-4 right-4 game-card p-2 text-[11px] font-bold pointer-events-none max-w-[260px]">
            {killFeed.slice(-4).map((k, i) => (
              <div key={i}>{k.killer} 🗡️ {k.victim}</div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-2 h-2 bg-white rounded-full opacity-70" />
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 game-card p-2 text-xs font-bold pointer-events-none">
            WASD · SPACE ugrás · LMB támadás · RMB blokk · E alma · 1 kard / 2 íj · Klikk a képre
          </div>
          {!alive && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-destructive text-6xl font-bold">
              💀 KIESTÉL
            </div>
          )}
        </>
      )}
    </div>
  );
}