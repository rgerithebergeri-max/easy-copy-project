import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Player, GameSettings } from '@/lib/gameTypes';
import { supabase } from '@/integrations/supabase/client';
import ThreeDEditor from './ThreeDEditor';
import { playPop, playSubmit, playNotification } from '@/lib/sounds';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

type CarState = {
  pid: string;
  username: string;
  x: number; z: number;
  angle: number;
  speed: number;
  steerVisual: number;
  lap: number;
  checkpoint: number;
  finished: boolean;
  boostUntil: number;
  // remote interpolation targets
  tx: number; tz: number; tAngle: number;
  snapshot?: string;
  glb?: string;
};

const TRACK_RX = 70;
const TRACK_RZ = 42;
const TRACK_W = 10;
const CHECKPOINTS = 8;
const CHECKPOINT_ANGLES = Array.from({ length: CHECKPOINTS }, (_, i) => (i / CHECKPOINTS) * Math.PI * 2);
const COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#118ab2', '#7c3aed', '#f97316', '#22d3ee', '#e11d48', '#84cc16', '#ec4899'];

// Boost pads positioned along the racing line
const BOOST_PADS = [
  { angle: Math.PI * 0.25 },
  { angle: Math.PI * 0.75 },
  { angle: Math.PI * 1.25 },
  { angle: Math.PI * 1.75 },
];

// === Track presets ===
type TrackDef = {
  id: string;
  name: string;
  emoji: string;
  wobAmp: number;
  wobFreq: number;
  ground: string;
  sky: string;
  accent: string;
  decor: 'trees' | 'palms' | 'rocks';
  asphaltShade: number; // 0-100 base gray
};

const TRACKS: TrackDef[] = [
  { id: 'silverstone', name: 'Klasszikus', emoji: '🏁', wobAmp: 4,  wobFreq: 3, ground: '#3a7a35', sky: '#87ceeb', accent: '#ffffff', decor: 'trees', asphaltShade: 43 },
  { id: 'monza',       name: 'Tekergős',   emoji: '🌀', wobAmp: 10, wobFreq: 5, ground: '#5a6e3a', sky: '#fcd34d', accent: '#fbbf24', decor: 'rocks', asphaltShade: 38 },
  { id: 'tropic',      name: 'Trópusi',    emoji: '🌴', wobAmp: 2,  wobFreq: 2, ground: '#2c8a5b', sky: '#fb923c', accent: '#fb7185', decor: 'palms', asphaltShade: 48 },
  { id: 'desert',      name: 'Sivatag',    emoji: '🏜️', wobAmp: 7,  wobFreq: 4, ground: '#b8884a', sky: '#fde68a', accent: '#fcd34d', decor: 'rocks', asphaltShade: 50 },
];
const RANDOM_VOTE = 'random';
const VOTE_TIME = 20;

function pickTrack(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

function makeAsphaltTexture(shade = 43) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d')!;
  const base = Math.max(20, Math.min(90, shade));
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3000; i++) {
    const v = base - 10 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  ctx.fillStyle = '#f1c40f';
  for (let y = 0; y < 512; y += 32) ctx.fillRect(252, y, 8, 18);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassTexture(hex = '#3a7a35') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 256, 256);
  // Variant shades
  const variants = ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.15)', 'rgba(255,255,255,0.05)'];
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = variants[i % variants.length];
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCurbTexture(accent = '#e11d48') {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? accent : '#ffffff';
    ctx.fillRect(i * 16, 0, 16, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function Decor({ kind, x, z }: { kind: 'trees' | 'palms' | 'rocks'; x: number; z: number }) {
  if (kind === 'palms') {
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0, 2, 0]}><cylinderGeometry args={[0.18, 0.25, 4]} /><meshStandardMaterial color="#8b5a2b" /></mesh>
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 1.1, 4, Math.sin(a) * 1.1]} rotation={[0, -a, 0.5]}>
              <boxGeometry args={[2.2, 0.05, 0.5]} />
              <meshStandardMaterial color="#2c9a3a" />
            </mesh>
          );
        })}
      </group>
    );
  }
  if (kind === 'rocks') {
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0, 0.6, 0]}><dodecahedronGeometry args={[1.1]} /><meshStandardMaterial color="#7a7268" flatShading /></mesh>
        <mesh position={[1.2, 0.3, 0.4]}><dodecahedronGeometry args={[0.6]} /><meshStandardMaterial color="#5e564d" flatShading /></mesh>
      </group>
    );
  }
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1, 0]}><cylinderGeometry args={[0.3, 0.4, 2]} /><meshStandardMaterial color="#5b3a1c" /></mesh>
      <mesh position={[0, 2.5, 0]}><coneGeometry args={[1.2, 2.5, 8]} /><meshStandardMaterial color="#2c7a3a" /></mesh>
    </group>
  );
}

function Track({ track }: { track: TrackDef }) {
  const asphalt = useMemo(() => makeAsphaltTexture(track.asphaltShade), [track.asphaltShade]);
  const grass = useMemo(() => makeGrassTexture(track.ground), [track.ground]);
  const curb = useMemo(() => makeCurbTexture(track.accent), [track.accent]);

  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 240; i++) {
      const a = (i / 240) * Math.PI * 2;
      const wob = Math.sin(a * track.wobFreq) * track.wobAmp;
      pts.push(new THREE.Vector3(Math.cos(a) * (TRACK_RX + wob * 0.2), 0.02, Math.sin(a) * (TRACK_RZ + wob * 0.15)));
    }
    return pts;
  }, [track.wobAmp, track.wobFreq]);

  const inner = useMemo(() => points.map((p) => {
    const len = Math.hypot(p.x, p.z) || 1;
    return new THREE.Vector3(p.x * (1 - TRACK_W / len), 0.03, p.z * (1 - TRACK_W / len));
  }), [points]);
  const outer = useMemo(() => points.map((p) => {
    const len = Math.hypot(p.x, p.z) || 1;
    return new THREE.Vector3(p.x * (1 + TRACK_W / len), 0.03, p.z * (1 + TRACK_W / len));
  }), [points]);

  const trackGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = inner[i], b = outer[i], c = inner[i + 1], d = outer[i + 1];
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      verts.push(b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
      const u0 = i / points.length * 80, u1 = (i + 1) / points.length * 80;
      uvs.push(0, u0, 1, u0, 0, u1, 1, u0, 1, u1, 0, u1);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    return geo;
  }, [inner, outer, points]);

  const buildCurb = (pts: THREE.Vector3[], outward: number) => {
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const la = Math.hypot(a.x, a.z) || 1, lc = Math.hypot(c.x, c.z) || 1;
      const b = new THREE.Vector3(a.x * (1 + outward / la), 0.06, a.z * (1 + outward / la));
      const d = new THREE.Vector3(c.x * (1 + outward / lc), 0.06, c.z * (1 + outward / lc));
      verts.push(a.x, 0.05, a.z, b.x, b.y, b.z, c.x, 0.05, c.z);
      verts.push(b.x, b.y, b.z, d.x, d.y, d.z, c.x, 0.05, c.z);
      const u0 = i, u1 = i + 1;
      uvs.push(0, u0, 1, u0, 0, u1, 1, u0, 1, u1, 0, u1);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    return geo;
  };
  const outerCurbGeo = useMemo(() => buildCurb(outer, 1.2), [outer]);
  const innerCurbGeo = useMemo(() => buildCurb(inner, -1.2), [inner]);

  // Stable decor positions, varied per track via seed
  const decors = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    const N = 36;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (track.wobFreq * 0.13);
      const r = 35 + ((i * 7 + track.wobAmp * 3) % 18);
      out.push({ x: Math.cos(a) * (TRACK_RX + r), z: Math.sin(a) * (TRACK_RZ + r) });
    }
    return out;
  }, [track.wobAmp, track.wobFreq]);

  // Rolling hill ground (displaced plane). Track stays flat at y≈0; hills only outside the track ring.
  const groundGeo = useMemo(() => {
    const SIZE = 600, SEG = 80;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const pos = geo.attributes.position;
    const TRACK_OUTER = Math.max(TRACK_RX, TRACK_RZ) + TRACK_W + 3;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.hypot(x, y);
      // Fade hills smoothly outside the track
      const k = Math.min(1, Math.max(0, (r - TRACK_OUTER) / 25));
      const h =
        Math.sin(x * 0.045 + track.wobFreq) * 2.2 +
        Math.cos(y * 0.04 - track.wobFreq * 0.8) * 1.8 +
        Math.sin((x + y) * 0.02) * 1.1;
      pos.setZ(i, h * k * (0.6 + track.wobAmp * 0.05));
    }
    geo.computeVertexNormals();
    return geo;
  }, [track.wobAmp, track.wobFreq]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow geometry={groundGeo}>
        <meshStandardMaterial map={grass} roughness={1} />
      </mesh>
      <mesh geometry={trackGeo} receiveShadow>
        <meshStandardMaterial map={asphalt} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
      <mesh geometry={outerCurbGeo}>
        <meshStandardMaterial map={curb} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={innerCurbGeo}>
        <meshStandardMaterial map={curb} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[TRACK_RX, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TRACK_W * 2, 1.5]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {BOOST_PADS.map((p, i) => {
        const x = Math.cos(p.angle) * TRACK_RX;
        const z = Math.sin(p.angle) * TRACK_RZ;
        return (
          <mesh key={i} position={[x, 0.07, z]} rotation={[-Math.PI / 2, 0, -p.angle]}>
            <planeGeometry args={[6, TRACK_W * 1.4]} />
            <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.7} transparent opacity={0.85} />
          </mesh>
        );
      })}
      {decors.map((d, i) => <Decor key={i} kind={track.decor} x={d.x} z={d.z} />)}
      <mesh position={[TRACK_RX + 18, 2, 0]}>
        <boxGeometry args={[6, 4, 30]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
    </>
  );
}

function CarMesh({ car, color, isMe }: { car: CarState; color: string; isMe: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const wheelsRef = useRef<THREE.Group[]>([]);
  const [model, setModel] = useState<THREE.Group | null>(null);

  // Load GLB model from the user's 3D editor
  useEffect(() => {
    if (!car.glb) { setModel(null); return; }
    const loader = new GLTFLoader();
    loader.load(car.glb, (gltf) => {
      const g = gltf.scene;
      // Auto-scale to fit a ~3m car
      const box = new THREE.Box3().setFromObject(g);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const target = 3.2;
      const scale = target / maxDim;
      g.scale.setScalar(scale);
      // Re-center on ground
      box.setFromObject(g);
      const center = new THREE.Vector3();
      box.getCenter(center);
      g.position.x -= center.x;
      g.position.z -= center.z;
      g.position.y -= box.min.y;
      g.traverse((o: any) => { o.castShadow = true; });
      setModel(g);
    });
  }, [car.glb]);

  const snapshotTexture = useMemo(() => {
    if (!car.snapshot || car.glb) return null;
    return new THREE.TextureLoader().load(car.snapshot);
  }, [car.snapshot, car.glb]);

  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.position.set(car.x, 0.4, car.z);
    ref.current.rotation.y = -car.angle + Math.PI / 2;
    // Wheel steering visual
    wheelsRef.current.forEach((w, i) => {
      if (!w) return;
      if (i < 2) w.rotation.y = car.steerVisual;
      w.rotation.x += Math.abs(car.speed) * dt * 2;
    });
  });

  return (
    <group ref={ref}>
      {model ? (
        <primitive object={model} />
      ) : (
        <>
          {/* Fallback stylish car */}
          <mesh position={[0, 0.25, 0]} castShadow>
            <boxGeometry args={[1.4, 0.45, 2.8]} />
            <meshStandardMaterial color={color} metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.7, -0.2]} castShadow>
            <boxGeometry args={[1.1, 0.5, 1.2]} />
            <meshStandardMaterial color={color} metalness={0.7} roughness={0.25} />
          </mesh>
          {/* spoiler */}
          <mesh position={[0, 0.7, 1.3]}>
            <boxGeometry args={[1.5, 0.08, 0.3]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          {snapshotTexture && (
            <mesh position={[0, 0.96, -0.2]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[1.0, 1.1]} />
              <meshBasicMaterial map={snapshotTexture} transparent />
            </mesh>
          )}
        </>
      )}
      {/* Wheels — only for fallback car (custom model has its own wheels) */}
      {!model && [
        { x: -0.7, z: -0.95 }, { x: 0.7, z: -0.95 },
        { x: -0.7, z: 0.95 }, { x: 0.7, z: 0.95 },
      ].map((p, i) => (
        <group key={i} position={[p.x, 0.25, p.z]} ref={(el) => { if (el) wheelsRef.current[i] = el; }}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.28, 0.28, 0.22, 16]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
        </group>
      ))}
      {/* Boost flames */}
      {car.boostUntil > Date.now() && (
        <mesh position={[0, 0.4, 1.5]}>
          <coneGeometry args={[0.35, 1.4, 8]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.8} />
        </mesh>
      )}
      {/* Player indicator */}
      {isMe && (
        <mesh position={[0, 2.2, 0]}>
          <coneGeometry args={[0.35, 0.7, 8]} />
          <meshBasicMaterial color="#ffd166" />
        </mesh>
      )}
    </group>
  );
}

function ChaseCamera({ target }: { target: React.MutableRefObject<CarState | null> }) {
  const { camera } = useThree();
  const lookRef = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    const me = target.current;
    if (!me) return;
    // Forza Horizon style: low, close behind, slightly above
    const speedFactor = Math.min(1, Math.abs(me.speed) / 40);
    const camDist = 6.5 + speedFactor * 1.8;
    const camHeight = 2.4 + speedFactor * 0.4;
    const tx = me.x - Math.cos(me.angle) * camDist;
    const tz = me.z + Math.sin(me.angle) * camDist;
    const target3 = new THREE.Vector3(tx, camHeight, tz);
    camera.position.lerp(target3, Math.min(1, dt * 7));
    // Look slightly ahead of the car
    const lookAhead = 4 + speedFactor * 3;
    const lx = me.x + Math.cos(me.angle) * lookAhead;
    const lz = me.z - Math.sin(me.angle) * lookAhead;
    lookRef.current.lerp(new THREE.Vector3(lx, 0.9, lz), Math.min(1, dt * 8));
    camera.lookAt(lookRef.current);
  });
  return null;
}

function IntroCamera({ cars, focusIdx }: { cars: CarState[]; focusIdx: number }) {
  const { camera } = useThree();
  useFrame(() => {
    const c = cars[focusIdx];
    if (!c) return;
    const t = Date.now() / 1000;
    const rad = 6;
    const cx = c.x + Math.cos(t * 0.7) * rad;
    const cz = c.z + Math.sin(t * 0.7) * rad;
    camera.position.lerp(new THREE.Vector3(cx, 2.5, cz), 0.08);
    camera.lookAt(c.x, 0.6, c.z);
  });
  return null;
}

function RaceScene({ carsRef, playerId, colorMap, meRef, phase, introIdx, track }: {
  carsRef: React.MutableRefObject<Map<string, CarState>>;
  playerId: string;
  colorMap: Map<string, string>;
  meRef: React.MutableRefObject<CarState | null>;
  phase: string;
  introIdx: number;
  track: TrackDef;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((v) => v + 1), 33);
    return () => clearInterval(t);
  }, []);
  const carsArr = Array.from(carsRef.current.values());
  return (
    <>
      <color attach="background" args={[track.sky]} />
      <fog attach="fog" args={[track.sky, 80, 340]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[40, 60, 20]} intensity={1.3} castShadow shadow-mapSize={[1024, 1024]} />
      <Track track={track} />
      {carsArr.map((c) => (
        <CarMesh key={c.pid} car={c} color={colorMap.get(c.pid) || '#fff'} isMe={c.pid === playerId} />
      ))}
      {phase === 'intro' ? <IntroCamera cars={carsArr} focusIdx={introIdx} /> : <ChaseCamera target={meRef} />}
    </>
  );
}

// === Engine audio ===
function useEngineAudio(active: boolean, speedRef: React.MutableRefObject<number>, boostRef: React.MutableRefObject<boolean>) {
  useEffect(() => {
    if (!active) return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Soft triangle base + sine overtone, low-passed for a mellow rumble
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.type = 'triangle';
    osc2.type = 'sine';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    osc.connect(filter); osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(); osc2.start();
    let raf = 0;
    const tick = () => {
      const s = Math.abs(speedRef.current);
      // Lower base frequency = less whiny, more rumble
      const freq = 55 + s * 4 + (boostRef.current ? 25 : 0);
      osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.08);
      osc2.frequency.setTargetAtTime(freq * 2, ctx.currentTime, 0.08);
      filter.frequency.setTargetAtTime(500 + s * 25, ctx.currentTime, 0.1);
      // Much quieter overall
      gain.gain.setTargetAtTime(0.008 + Math.min(0.022, s * 0.0018), ctx.currentTime, 0.08);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try { osc.stop(); osc2.stop(); ctx.close(); } catch {}
    };
  }, [active, speedRef, boostRef]);
}

export default function F1RaceView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const totalLaps = Math.max(1, settings.f1Laps ?? 3);
  const designTime = Math.max(30, settings.f1DesignTime ?? 90);
  const [phase, setPhase] = useState<'vote' | 'design' | 'intro' | 'countdown' | 'race' | 'end'>('vote');
  const [voteLeft, setVoteLeft] = useState(VOTE_TIME);
  const [votes, setVotes] = useState<Map<string, string>>(new Map()); // pid -> trackId
  const [selectedTrack, setSelectedTrack] = useState<TrackDef>(TRACKS[0]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [designLeft, setDesignLeft] = useState(designTime);
  const [countdown, setCountdown] = useState(3);
  const [myTexture, setMyTexture] = useState<string | null>(null);
  const [submittedSet, setSubmittedSet] = useState<Set<string>>(new Set());
  const [finishers, setFinishers] = useState<{ pid: string; username: string; time: number }[]>([]);
  const [introIdx, setIntroIdx] = useState(0);
  const carsRef = useRef<Map<string, CarState>>(new Map());
  const meRef = useRef<CarState | null>(null);
  const channelRef = useRef<any>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const lastBcRef = useRef(0);
  const raceStartRef = useRef(0);
  const speedRef = useRef(0);
  const boostRef = useRef(false);
  // GLB chunk reassembly: pid -> { chunks: string[], total: number }
  const glbChunksRef = useRef<Map<string, { chunks: string[]; total: number; snapshot?: string }>>(new Map());

  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    players.forEach((p, i) => m.set(p.player_id, COLORS[i % COLORS.length]));
    return m;
  }, [players]);

  useEffect(() => {
    players.forEach((p, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const x = TRACK_RX + (col === 0 ? -2 : 2);
      const z = -3 - row * 4;
      const car: CarState = {
        pid: p.player_id, username: p.username,
        x, z, angle: Math.PI / 2, speed: 0, steerVisual: 0,
        lap: 0, checkpoint: -1, finished: false, boostUntil: 0,
        tx: x, tz: z, tAngle: Math.PI / 2,
      };
      carsRef.current.set(p.player_id, car);
      if (p.player_id === playerId) meRef.current = car;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Channel
  useEffect(() => {
    const ch = supabase.channel(`f1-${code}`);
    // Small designs (no GLB or tiny) sent in one shot
    ch.on('broadcast', { event: 'f1:design' }, ({ payload }) => {
      const car = carsRef.current.get(payload.pid);
      if (car) { car.snapshot = payload.snapshot; car.glb = payload.glb; }
      setSubmittedSet((s) => new Set(s).add(payload.pid));
    });
    // Chunked GLB transfer for larger custom models
    ch.on('broadcast', { event: 'f1:glb-start' }, ({ payload }) => {
      glbChunksRef.current.set(payload.pid, { chunks: new Array(payload.total), total: payload.total, snapshot: payload.snapshot });
      const car = carsRef.current.get(payload.pid);
      if (car && payload.snapshot) car.snapshot = payload.snapshot;
    });
    ch.on('broadcast', { event: 'f1:glb-chunk' }, ({ payload }) => {
      const entry = glbChunksRef.current.get(payload.pid);
      if (!entry) return;
      entry.chunks[payload.index] = payload.data;
      const received = entry.chunks.filter(Boolean).length;
      if (received >= entry.total) {
        const glb = entry.chunks.join('');
        const car = carsRef.current.get(payload.pid);
        if (car) { car.glb = glb; if (entry.snapshot) car.snapshot = entry.snapshot; }
        glbChunksRef.current.delete(payload.pid);
        setSubmittedSet((s) => new Set(s).add(payload.pid));
      }
    });
    ch.on('broadcast', { event: 'f1:vote' }, ({ payload }) => {
      setVotes((m) => { const n = new Map(m); n.set(payload.pid, payload.trackId); return n; });
    });
    ch.on('broadcast', { event: 'f1:track-decided' }, ({ payload }) => {
      setSelectedTrack(pickTrack(payload.trackId));
      setPhase('design');
    });
    ch.on('broadcast', { event: 'f1:intro' }, ({ payload }) => {
      raceStartRef.current = payload.startAt;
      setPhase('intro');
    });
    ch.on('broadcast', { event: 'f1:countdown' }, ({ payload }) => {
      raceStartRef.current = payload.startAt;
      setPhase('countdown');
    });
    ch.on('broadcast', { event: 'f1:car' }, ({ payload }) => {
      if (payload.pid === playerId) return;
      const c = carsRef.current.get(payload.pid);
      if (c) {
        c.tx = payload.x; c.tz = payload.z; c.tAngle = payload.angle;
        c.lap = payload.lap; c.finished = payload.finished;
        c.speed = payload.speed ?? c.speed;
      }
    });
    ch.on('broadcast', { event: 'f1:finish' }, ({ payload }) => {
      setFinishers((arr) => arr.find((f) => f.pid === payload.pid) ? arr : [...arr, payload]);
      const c = carsRef.current.get(payload.pid);
      if (c) c.finished = true;
      playNotification();
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Vote timer: host tallies at end and broadcasts winning track
  useEffect(() => {
    if (phase !== 'vote') return;
    const deadline = Date.now() + VOTE_TIME * 1000;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setVoteLeft(left);
      const allVoted = players.every((p) => votes.has(p.player_id));
      if (left <= 0 || allVoted) {
        clearInterval(t);
        if (isHost) {
          // Tally
          const tally = new Map<string, number>();
          votes.forEach((tid) => tally.set(tid, (tally.get(tid) ?? 0) + 1));
          let winner: string;
          const randomCount = tally.get(RANDOM_VOTE) ?? 0;
          // If random wins or tied for top, roll random
          let topId = TRACKS[0].id, topCount = -1;
          tally.forEach((c, id) => {
            if (id === RANDOM_VOTE) return;
            if (c > topCount) { topCount = c; topId = id; }
          });
          if (randomCount > topCount) {
            winner = TRACKS[Math.floor(Math.random() * TRACKS.length)].id;
          } else {
            winner = topId;
          }
          channelRef.current?.send({ type: 'broadcast', event: 'f1:track-decided', payload: { trackId: winner } });
          setSelectedTrack(pickTrack(winner));
          setPhase('design');
        }
      }
    }, 300);
    return () => clearInterval(t);
  }, [phase, players, votes, isHost]);

  // Design timer — INFINITE: waits until everyone submits
  useEffect(() => {
    if (phase !== 'design') return;
    const startedAt = Date.now();
    const t = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setDesignLeft(elapsed); // count UP, no deadline
      const allSubmitted = players.length > 0 && players.every((p) => submittedSet.has(p.player_id));
      if (allSubmitted) {
        clearInterval(t);
        if (isHost) {
          const startAt = Date.now() + players.length * 2200 + 1000;
          channelRef.current?.send({ type: 'broadcast', event: 'f1:intro', payload: { startAt } });
          raceStartRef.current = startAt;
          setPhase('intro');
        }
      }
    }, 300);
    return () => clearInterval(t);
  }, [phase, designTime, players, submittedSet, isHost]);

  // Intro phase: rotate through each car
  useEffect(() => {
    if (phase !== 'intro') return;
    setIntroIdx(0);
    const per = 2200;
    const t = setInterval(() => {
      setIntroIdx((i) => {
        if (i + 1 >= players.length) {
          clearInterval(t);
          if (isHost) {
            const startAt = Date.now() + 4000;
            channelRef.current?.send({ type: 'broadcast', event: 'f1:countdown', payload: { startAt } });
            raceStartRef.current = startAt;
            setPhase('countdown');
          }
          return i;
        }
        return i + 1;
      });
    }, per);
    return () => clearInterval(t);
  }, [phase, players.length, isHost]);

  // Countdown
  useEffect(() => {
    if (phase !== 'countdown') return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((raceStartRef.current - Date.now()) / 1000));
      setCountdown(left);
      if (left <= 0) {
        clearInterval(t);
        raceStartRef.current = Date.now();
        setPhase('race');
      }
    }, 200);
    return () => clearInterval(t);
  }, [phase]);

  // Keyboard
  useEffect(() => {
    const dn = (e: KeyboardEvent) => keysRef.current.add(e.key.toLowerCase());
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  // Physics + interpolation loop
  useEffect(() => {
    if (phase !== 'race' && phase !== 'intro' && phase !== 'countdown') return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const me = meRef.current;
      if (me && !me.finished && phase === 'race') {
        const keys = keysRef.current;
        const accel = (keys.has('w') || keys.has('arrowup')) ? 26 : 0;
        const brake = (keys.has('s') || keys.has('arrowdown')) ? 32 : 0;
        const steerL = (keys.has('a') || keys.has('arrowleft')) ? 1 : 0;
        const steerR = (keys.has('d') || keys.has('arrowright')) ? 1 : 0;
        const boosting = me.boostUntil > Date.now();
        boostRef.current = boosting;
        const topSpeed = boosting ? 52 : 36;
        me.speed += accel * dt * (boosting ? 1.6 : 1);
        me.speed -= brake * dt * (me.speed > 0 ? 1 : -0.4);
        me.speed *= 0.985;
        me.speed = Math.max(-15, Math.min(topSpeed, me.speed));
        // Smooth steering visual
        const targetSteer = (steerL - steerR) * 1.0;
        me.steerVisual += (targetSteer * 0.5 - me.steerVisual) * Math.min(1, dt * 8);
        // Only steer when actually moving — prevents spinning in place / on the spot
        const speedAbs = Math.abs(me.speed);
        const steerEnable = Math.min(1, Math.max(0, (speedAbs - 2) / 6));
        const steerStrength = me.steerVisual * 1.6 * steerEnable;
        me.angle += steerStrength * dt;
        // Off-track penalty using elliptical distance
        const distRatio = Math.hypot(me.x / TRACK_RX, me.z / TRACK_RZ);
        const inner = 1 - TRACK_W / Math.min(TRACK_RX, TRACK_RZ);
        const outer = 1 + TRACK_W / Math.min(TRACK_RX, TRACK_RZ);
        const onTrack = distRatio > inner && distRatio < outer;
        if (!onTrack) me.speed *= 0.93;
        me.x += Math.cos(me.angle) * me.speed * dt;
        me.z -= Math.sin(me.angle) * me.speed * dt;
        speedRef.current = me.speed;
        // Boost pad detection
        BOOST_PADS.forEach((p) => {
          const px = Math.cos(p.angle) * TRACK_RX;
          const pz = Math.sin(p.angle) * TRACK_RZ;
          if (Math.hypot(me.x - px, me.z - pz) < 4 && me.boostUntil < Date.now() - 500) {
            me.boostUntil = Date.now() + 1800;
            me.speed = Math.max(me.speed, 38);
            playPop();
          }
        });
        // Checkpoints
        const carAngle = Math.atan2(me.z, me.x);
        const norm = (carAngle + Math.PI * 2) % (Math.PI * 2);
        const nextCp = (me.checkpoint + 1) % CHECKPOINT_ANGLES.length;
        const cpAngle = CHECKPOINT_ANGLES[nextCp];
        if (Math.abs(((norm - cpAngle + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.35) {
          me.checkpoint = nextCp;
          if (nextCp === 0) {
            me.lap += 1;
            playPop();
            if (me.lap >= totalLaps && !me.finished) {
              me.finished = true;
              const time = (Date.now() - raceStartRef.current) / 1000;
              const payload = { pid: playerId, username, time };
              channelRef.current?.send({ type: 'broadcast', event: 'f1:finish', payload });
              setFinishers((arr) => arr.find((f) => f.pid === playerId) ? arr : [...arr, payload]);
              playSubmit();
            }
          }
        }
        if (now - lastBcRef.current > 60) {
          lastBcRef.current = now;
          channelRef.current?.send({
            type: 'broadcast', event: 'f1:car',
            payload: { pid: playerId, x: me.x, z: me.z, angle: me.angle, lap: me.lap, finished: me.finished, speed: me.speed },
          });
        }
      }
      // Interpolate remote cars smoothly
      carsRef.current.forEach((c) => {
        if (c.pid === playerId) return;
        const a = Math.min(1, dt * 10);
        c.x += (c.tx - c.x) * a;
        c.z += (c.tz - c.z) * a;
        // angle wrap
        let da = c.tAngle - c.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        c.angle += da * a;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Engine audio active only during race
  useEngineAudio(phase === 'race', speedRef, boostRef);

  // End check
  useEffect(() => {
    if (phase === 'race' && finishers.length >= players.length) {
      setTimeout(() => setPhase('end'), 1500);
    }
  }, [finishers, phase, players.length]);

  const submitDesign = async (snapshot: string, glb?: string) => {
    setMyTexture(snapshot);
    const car = carsRef.current.get(playerId);
    if (car) { car.snapshot = snapshot; car.glb = glb; }
    setSubmittedSet((s) => new Set(s).add(playerId));
    if (!glb || glb.length < 60_000) {
      // Small payload — single broadcast
      channelRef.current?.send({ type: 'broadcast', event: 'f1:design', payload: { pid: playerId, snapshot, glb } });
    } else {
      // Chunk the GLB so realtime broadcast doesn't drop it
      const CHUNK = 50_000;
      const total = Math.ceil(glb.length / CHUNK);
      channelRef.current?.send({
        type: 'broadcast', event: 'f1:glb-start',
        payload: { pid: playerId, total, snapshot },
      });
      for (let i = 0; i < total; i++) {
        const data = glb.slice(i * CHUNK, (i + 1) * CHUNK);
        channelRef.current?.send({
          type: 'broadcast', event: 'f1:glb-chunk',
          payload: { pid: playerId, index: i, data },
        });
        // Tiny delay so realtime doesn't drop bursts
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    playSubmit();
  };

  const castVote = (trackId: string) => {
    setMyVote(trackId);
    setVotes((m) => { const n = new Map(m); n.set(playerId, trackId); return n; });
    channelRef.current?.send({ type: 'broadcast', event: 'f1:vote', payload: { pid: playerId, trackId } });
    playPop();
  };

  if (phase === 'vote') {
    const tally = new Map<string, number>();
    votes.forEach((tid) => tally.set(tid, (tally.get(tid) ?? 0) + 1));
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-3">
        <div className="game-card p-3 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-xl font-bold">🗳️ Szavazz a pályára! ({voteLeft}mp)</h2>
          <div className="text-sm font-bold">Szavazott: {votes.size}/{players.length}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TRACKS.map((t) => (
            <button
              key={t.id}
              onClick={() => castVote(t.id)}
              className={`game-card p-4 text-center transition-all hover:scale-105 ${myVote === t.id ? 'ring-4 ring-primary' : ''}`}
            >
              <div className="text-5xl mb-2">{t.emoji}</div>
              <div className="font-bold">{t.name}</div>
              <div className="text-xs opacity-70 mt-1">{tally.get(t.id) ?? 0} szavazat</div>
            </button>
          ))}
          <button
            onClick={() => castVote(RANDOM_VOTE)}
            className={`game-card p-4 text-center transition-all hover:scale-105 ${myVote === RANDOM_VOTE ? 'ring-4 ring-primary' : ''}`}
          >
            <div className="text-5xl mb-2">🎲</div>
            <div className="font-bold">Random</div>
            <div className="text-xs opacity-70 mt-1">{tally.get(RANDOM_VOTE) ?? 0} szavazat</div>
          </button>
        </div>
        {!isHost && voteLeft === 0 && (
          <div className="text-center text-sm opacity-70">Várunk a házigazdára...</div>
        )}
      </div>
    );
  }

  if (phase === 'design') {
    return (
      <div className="max-w-7xl mx-auto p-4 space-y-3">
        <div className="game-card p-3 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-xl font-bold">🏎️ Tervezd meg az autód! (várunk mindenkire... {designLeft}mp)</h2>
          <div className="text-sm font-bold flex items-center gap-3">
            <span>{selectedTrack.emoji} {selectedTrack.name}</span>
            <span>Kész: {submittedSet.size}/{players.length}</span>
          </div>
        </div>
        {myTexture ? (
          <div className="game-card p-4 text-center space-y-3">
            <img src={myTexture} alt="autó" className="mx-auto max-h-64 rounded border-2 border-border" />
            <p className="font-bold">Autód beküldve! Várunk a többiekre... 🏁</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {players.map((p) => (
                <div key={p.player_id} className={`px-3 py-1 rounded-full text-xs font-bold ${submittedSet.has(p.player_id) ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  {p.username} {submittedSet.has(p.player_id) ? '✅' : '⏳'}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ThreeDEditor
            onSubmit={(d) => submitDesign(d)}
            onSubmitWithModel={({ snapshot, glb }) => submitDesign(snapshot, glb)}
          />
        )}
      </div>
    );
  }

  if (phase === 'end') {
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-3">
        <div className="game-card p-4 text-center">
          <h2 className="text-3xl font-bold mb-3">🏆 VÉGEREDMÉNY</h2>
          <div className="space-y-2">
            {finishers.map((f, i) => (
              <div key={f.pid} className="flex items-center justify-between p-3 rounded bg-card border-2 border-border">
                <span className="text-2xl font-bold">{['🥇', '🥈', '🥉'][i] || `${i + 1}.`}</span>
                <span className="font-bold flex-1 text-center">{f.username}</span>
                <span className="font-mono">{f.time.toFixed(2)}s</span>
              </div>
            ))}
            {players.filter((p) => !finishers.find((f) => f.pid === p.player_id)).map((p) => (
              <div key={p.player_id} className="flex items-center justify-between p-2 rounded bg-muted/40">
                <span>DNF</span>
                <span className="font-bold">{p.username}</span>
                <span>—</span>
              </div>
            ))}
          </div>
          <button className="game-btn-primary mt-4" onClick={onFinish}>🔄 Új játék</button>
        </div>
      </div>
    );
  }

  const introCar = phase === 'intro' ? Array.from(carsRef.current.values())[introIdx] : null;

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        shadows
        camera={{ fov: 70, position: [TRACK_RX, 8, -10] }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
          gl.setClearColor('#000000', 1);
        }}
      >
        <RaceScene carsRef={carsRef} playerId={playerId} colorMap={colorMap} meRef={meRef} phase={phase} introIdx={introIdx} track={selectedTrack} />
      </Canvas>
      {phase === 'intro' && introCar && (
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-20 pointer-events-none">
          <div className="game-card px-8 py-4 text-center animate-zoom-in">
            <div className="text-sm uppercase tracking-widest opacity-70">Versenyző bemutatása</div>
            <div className="text-5xl font-bold mt-1">{introCar.username}</div>
            <div className="text-xs mt-1 opacity-70">#{introIdx + 1} / {players.length}</div>
          </div>
        </div>
      )}
      {phase !== 'intro' && (
        <>
          <div className="absolute top-4 left-4 game-card p-3 text-sm font-bold pointer-events-none">
            <div>🏁 Kör: {Math.min(totalLaps, (meRef.current?.lap ?? 0) + 1)}/{totalLaps}</div>
            <div>💨 {Math.abs(Math.round((meRef.current?.speed ?? 0) * 8))} km/h</div>
            {meRef.current && meRef.current.boostUntil > Date.now() && (
              <div className="text-cyan-400">⚡ BOOST!</div>
            )}
          </div>
          <div className="absolute top-4 right-4 game-card p-3 text-xs font-bold pointer-events-none max-w-[200px]">
            <div className="mb-1">🏆 Ranglista</div>
            {Array.from(carsRef.current.values()).sort((a, b) => (b.lap - a.lap) || (a.pid === playerId ? -1 : 1)).map((c) => (
              <div key={c.pid} className="flex justify-between">
                <span>{c.username}</span>
                <span>{c.finished ? '🏁' : `L${c.lap + 1}`}</span>
              </div>
            ))}
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 game-card p-2 text-xs font-bold pointer-events-none">
            WASD / nyilak vezetés · ⚡ cián padokon boost
          </div>
        </>
      )}
      {phase === 'countdown' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
          <div className="text-9xl font-bold text-primary animate-zoom-in">{countdown > 0 ? countdown : 'GO!'}</div>
        </div>
      )}
    </div>
  );
}