import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Grid, TransformControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { playClick } from '@/lib/sounds';

type ShapeKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'tetrahedron'
  | 'capsule' | 'octahedron' | 'icosahedron' | 'dodecahedron' | 'plane' | 'ring' | 'torusKnot' | 'text';

type Mode = 'translate' | 'rotate' | 'scale';

interface ShapeItem {
  id: string;
  kind: ShapeKind;
  position: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number];
  color: string;
  textureUrl?: string;
  textValue?: string;
  groupId?: string | null;
}

const SHAPE_BUTTONS: { id: ShapeKind; icon: string; label: string }[] = [
  { id: 'box', icon: '🟦', label: 'Kocka' },
  { id: 'sphere', icon: '⚪', label: 'Gömb' },
  { id: 'cylinder', icon: '🥫', label: 'Henger' },
  { id: 'cone', icon: '🔺', label: 'Kúp' },
  { id: 'torus', icon: '🍩', label: 'Tórusz' },
  { id: 'torusKnot', icon: '🪢', label: 'Csomó' },
  { id: 'tetrahedron', icon: '🔻', label: 'Tetra' },
  { id: 'octahedron', icon: '💎', label: 'Okta' },
  { id: 'icosahedron', icon: '⬢', label: 'Ikoza' },
  { id: 'dodecahedron', icon: '🎲', label: 'Dodeka' },
  { id: 'capsule', icon: '💊', label: 'Kapszula' },
  { id: 'plane', icon: '🟨', label: 'Sík' },
  { id: 'ring', icon: '⭕', label: 'Gyűrű' },
  { id: 'text', icon: '🔤', label: 'Szöveg' },
];

const COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#118ab2', '#7c3aed', '#000000', '#ffffff', '#f97316'];

// ============ TEMPLATE CATALOG ============
// Each template is a list of shape descriptors (no ids — generated on add).
type TemplatePart = {
  kind: ShapeKind;
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  textValue?: string;
};
type Template = { id: string; icon: string; label: string; parts: TemplatePart[] };

const TEMPLATES: Template[] = [
  {
    id: 'head', icon: '🗿', label: 'Emberi fej',
    parts: [
      { kind: 'sphere', position: [0, 1, 0], scale: [1.1, 1.2, 1.05], color: '#f1c27d' },                  // head
      { kind: 'sphere', position: [-0.32, 1.15, 0.78], scale: [0.13, 0.13, 0.13], color: '#ffffff' },      // L eye white
      { kind: 'sphere', position: [0.32, 1.15, 0.78], scale: [0.13, 0.13, 0.13], color: '#ffffff' },       // R eye white
      { kind: 'sphere', position: [-0.32, 1.15, 0.86], scale: [0.06, 0.06, 0.06], color: '#1a1a1a' },      // L pupil
      { kind: 'sphere', position: [0.32, 1.15, 0.86], scale: [0.06, 0.06, 0.06], color: '#1a1a1a' },       // R pupil
      { kind: 'cone', position: [0, 0.95, 0.92], scale: [0.18, 0.35, 0.18], rotation: [Math.PI / 2, 0, 0], color: '#e0a86c' }, // nose
      { kind: 'torus', position: [0, 0.65, 0.85], scale: [0.25, 0.08, 0.25], rotation: [Math.PI / 2, 0, 0], color: '#aa3344' }, // mouth
      { kind: 'cylinder', position: [0, 0.05, 0], scale: [0.65, 0.4, 0.65], color: '#f1c27d' },            // neck
    ],
  },
  {
    id: 'snowman', icon: '⛄', label: 'Hóember',
    parts: [
      { kind: 'sphere', position: [0, 0.6, 0], scale: [1.3, 1.3, 1.3], color: '#ffffff' },
      { kind: 'sphere', position: [0, 1.7, 0], scale: [0.95, 0.95, 0.95], color: '#ffffff' },
      { kind: 'sphere', position: [0, 2.55, 0], scale: [0.7, 0.7, 0.7], color: '#ffffff' },
      { kind: 'cone', position: [0, 2.6, 0.65], scale: [0.1, 0.3, 0.1], rotation: [Math.PI / 2, 0, 0], color: '#ff8c1a' },
      { kind: 'sphere', position: [-0.18, 2.7, 0.55], scale: [0.06, 0.06, 0.06], color: '#000' },
      { kind: 'sphere', position: [0.18, 2.7, 0.55], scale: [0.06, 0.06, 0.06], color: '#000' },
      { kind: 'cylinder', position: [0, 3.05, 0], scale: [0.55, 0.08, 0.55], color: '#1a1a1a' },
      { kind: 'cylinder', position: [0, 3.2, 0], scale: [0.4, 0.5, 0.4], color: '#1a1a1a' },
    ],
  },
  {
    id: 'tree', icon: '🌳', label: 'Fa',
    parts: [
      { kind: 'cylinder', position: [0, 0.5, 0], scale: [0.3, 1, 0.3], color: '#7a4a23' },
      { kind: 'cone', position: [0, 1.6, 0], scale: [1, 1.2, 1], color: '#2c7a3a' },
      { kind: 'cone', position: [0, 2.4, 0], scale: [0.8, 1, 0.8], color: '#3aa04a' },
      { kind: 'cone', position: [0, 3.1, 0], scale: [0.55, 0.8, 0.55], color: '#4dba5a' },
    ],
  },
  {
    id: 'house', icon: '🏠', label: 'Ház',
    parts: [
      { kind: 'box', position: [0, 1, 0], scale: [2, 2, 2], color: '#f4d6b0' },
      { kind: 'cone', position: [0, 2.6, 0], scale: [1.5, 1, 1.5], rotation: [0, Math.PI / 4, 0], color: '#b9302a' },
      { kind: 'box', position: [0, 0.6, 1.01], scale: [0.45, 1.2, 0.05], color: '#5b3a1c' },
      { kind: 'box', position: [-0.65, 1.3, 1.01], scale: [0.45, 0.45, 0.05], color: '#9fd6ff' },
      { kind: 'box', position: [0.65, 1.3, 1.01], scale: [0.45, 0.45, 0.05], color: '#9fd6ff' },
    ],
  },
  {
    id: 'car', icon: '🚗', label: 'Autó',
    parts: [
      { kind: 'box', position: [0, 0.45, 0], scale: [2.4, 0.5, 1.1], color: '#e63946' },
      { kind: 'box', position: [0, 0.95, 0], scale: [1.4, 0.5, 1.0], color: '#e63946' },
      { kind: 'cylinder', position: [-0.75, 0.2, 0.6], scale: [0.3, 0.18, 0.3], rotation: [Math.PI / 2, 0, 0], color: '#1a1a1a' },
      { kind: 'cylinder', position: [0.75, 0.2, 0.6], scale: [0.3, 0.18, 0.3], rotation: [Math.PI / 2, 0, 0], color: '#1a1a1a' },
      { kind: 'cylinder', position: [-0.75, 0.2, -0.6], scale: [0.3, 0.18, 0.3], rotation: [Math.PI / 2, 0, 0], color: '#1a1a1a' },
      { kind: 'cylinder', position: [0.75, 0.2, -0.6], scale: [0.3, 0.18, 0.3], rotation: [Math.PI / 2, 0, 0], color: '#1a1a1a' },
    ],
  },
  {
    id: 'robot', icon: '🤖', label: 'Robot',
    parts: [
      { kind: 'box', position: [0, 1.2, 0], scale: [1.4, 1.4, 1], color: '#cdd6dd' }, // torso
      { kind: 'box', position: [0, 2.3, 0], scale: [0.9, 0.9, 0.9], color: '#cdd6dd' }, // head
      { kind: 'sphere', position: [-0.2, 2.4, 0.46], scale: [0.1, 0.1, 0.1], color: '#ff4d6d' },
      { kind: 'sphere', position: [0.2, 2.4, 0.46], scale: [0.1, 0.1, 0.1], color: '#ff4d6d' },
      { kind: 'cylinder', position: [-1, 1.2, 0], scale: [0.18, 0.9, 0.18], color: '#7a8085' }, // L arm
      { kind: 'cylinder', position: [1, 1.2, 0], scale: [0.18, 0.9, 0.18], color: '#7a8085' },  // R arm
      { kind: 'box', position: [-0.35, 0.25, 0], scale: [0.4, 0.7, 0.4], color: '#7a8085' },     // L leg
      { kind: 'box', position: [0.35, 0.25, 0], scale: [0.4, 0.7, 0.4], color: '#7a8085' },      // R leg
    ],
  },
  {
    id: 'flower', icon: '🌸', label: 'Virág',
    parts: [
      { kind: 'cylinder', position: [0, 0.8, 0], scale: [0.05, 0.8, 0.05], color: '#2f8a3a' },
      { kind: 'sphere', position: [0, 1.6, 0], scale: [0.25, 0.25, 0.25], color: '#ffeb3b' },
      ...Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return {
          kind: 'sphere' as ShapeKind,
          position: [Math.cos(a) * 0.45, 1.6, Math.sin(a) * 0.45] as [number, number, number],
          scale: [0.28, 0.18, 0.28] as [number, number, number],
          color: '#ff5e9a',
        };
      }),
    ],
  },
  {
    id: 'rocket', icon: '🚀', label: 'Rakéta',
    parts: [
      { kind: 'cylinder', position: [0, 1.5, 0], scale: [0.45, 1.5, 0.45], color: '#f5f5f5' },
      { kind: 'cone', position: [0, 3.3, 0], scale: [0.45, 0.6, 0.45], color: '#e63946' },
      { kind: 'cone', position: [-0.5, 0.4, 0], scale: [0.2, 0.6, 0.4], rotation: [0, 0, -0.3], color: '#e63946' },
      { kind: 'cone', position: [0.5, 0.4, 0], scale: [0.2, 0.6, 0.4], rotation: [0, 0, 0.3], color: '#e63946' },
      { kind: 'sphere', position: [0, 1.9, 0.46], scale: [0.18, 0.18, 0.05], color: '#5cb8ff' },
      { kind: 'cone', position: [0, -0.05, 0], scale: [0.3, 0.5, 0.3], rotation: [Math.PI, 0, 0], color: '#ff7b00' },
    ],
  },
];

function ShapeMesh({
  shape, selected, onPick, registerRef, draggingRef,
}: {
  shape: ShapeItem; selected: boolean; onPick: (additive: boolean) => void;
  registerRef: (id: string, m: THREE.Object3D | null) => void;
  draggingRef: React.MutableRefObject<boolean>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const textRef = useRef<THREE.Object3D>(null);

  useEffect(() => {
    const obj = shape.kind === 'text' ? textRef.current : meshRef.current;
    registerRef(shape.id, obj || null);
    return () => registerRef(shape.id, null);
  });

  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!shape.textureUrl) { setTexture(null); return; }
    const loader = new THREE.TextureLoader();
    const tex = loader.load(shape.textureUrl, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.needsUpdate = true;
      setTexture(loaded);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    setTexture(tex);
    return () => { tex.dispose(); };
  }, [shape.textureUrl]);

  // Use onClick (pointerup with no drag) instead of onPointerDown so that
  // dragging the TransformControls gizmo over a background mesh does NOT
  // steal the selection. Click only fires when no movement happened.
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (draggingRef.current) return;
    e.stopPropagation();
    const native = e.nativeEvent as MouseEvent;
    onPick(native.shiftKey || native.ctrlKey || native.metaKey);
  };
  // Note: raycast disabling during drag is handled centrally via draggingRef;
  // onClick won't fire if the gizmo absorbed the drag.

  if (shape.kind === 'text') {
    return (
      <group ref={textRef as any} position={shape.position} rotation={shape.rotation} scale={shape.scale}
        onClick={handleClick}>
        <Text fontSize={0.6} color={shape.color} anchorX="center" anchorY="middle" outlineWidth={selected ? 0.02 : 0} outlineColor="#888">
          {shape.textValue || 'Szöveg'}
        </Text>
      </group>
    );
  }

  const material = (
    <meshStandardMaterial
      color={texture ? '#ffffff' : shape.color}
      map={texture || null}
      emissive={selected ? '#444' : '#000'}
      emissiveIntensity={selected ? 0.25 : 0}
      side={shape.kind === 'plane' ? THREE.DoubleSide : THREE.FrontSide}
    />
  );

  const common = {
    ref: meshRef,
    position: shape.position,
    rotation: shape.rotation,
    scale: shape.scale,
    onClick: handleClick,
    castShadow: true,
    receiveShadow: true,
  };

  switch (shape.kind) {
    case 'box': return <mesh {...common}><boxGeometry args={[1, 1, 1]} />{material}</mesh>;
    case 'sphere': return <mesh {...common}><sphereGeometry args={[0.6, 32, 32]} />{material}</mesh>;
    case 'cylinder': return <mesh {...common}><cylinderGeometry args={[0.5, 0.5, 1, 32]} />{material}</mesh>;
    case 'cone': return <mesh {...common}><coneGeometry args={[0.5, 1, 32]} />{material}</mesh>;
    case 'torus': return <mesh {...common}><torusGeometry args={[0.5, 0.2, 16, 32]} />{material}</mesh>;
    case 'torusKnot': return <mesh {...common}><torusKnotGeometry args={[0.4, 0.13, 100, 16]} />{material}</mesh>;
    case 'tetrahedron': return <mesh {...common}><tetrahedronGeometry args={[0.7]} />{material}</mesh>;
    case 'octahedron': return <mesh {...common}><octahedronGeometry args={[0.7]} />{material}</mesh>;
    case 'icosahedron': return <mesh {...common}><icosahedronGeometry args={[0.7]} />{material}</mesh>;
    case 'dodecahedron': return <mesh {...common}><dodecahedronGeometry args={[0.7]} />{material}</mesh>;
    case 'capsule': return <mesh {...common}><capsuleGeometry args={[0.35, 0.7, 8, 16]} />{material}</mesh>;
    case 'plane': return <mesh {...common}><planeGeometry args={[1.2, 1.2]} />{material}</mesh>;
    case 'ring': return <mesh {...common}><ringGeometry args={[0.3, 0.6, 32]} />{material}</mesh>;
  }
  return null;
}

function SceneContent({
  shapes, selectedIds, mode, onPickShape, registerRef, onTransformStart, onTransformDelta, onTransformEnd, orbitRef, transformAttach, draggingRef,
}: {
  shapes: ShapeItem[];
  selectedIds: string[];
  mode: Mode;
  onPickShape: (id: string, additive: boolean) => void;
  registerRef: (id: string, m: THREE.Object3D | null) => void;
  onTransformStart: () => void;
  onTransformDelta: () => void;
  onTransformEnd: () => void;
  orbitRef: React.MutableRefObject<any>;
  transformAttach: THREE.Object3D | null;
  draggingRef: React.MutableRefObject<boolean>;
}) {
  return (
    <>
      <color attach="background" args={['#1b1b2a']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
      <Grid args={[20, 20]} cellColor="#444" sectionColor="#888" infiniteGrid />
      {shapes.map((s) => (
        <ShapeMesh key={s.id} shape={s} selected={selectedIds.includes(s.id)}
          onPick={(additive) => onPickShape(s.id, additive)}
          registerRef={registerRef}
          draggingRef={draggingRef} />
      ))}
      {transformAttach && (
        <TransformControls
          object={transformAttach}
          mode={mode}
          onMouseDown={() => { draggingRef.current = true; if (orbitRef.current) orbitRef.current.enabled = false; onTransformStart(); }}
          onMouseUp={() => { draggingRef.current = false; if (orbitRef.current) orbitRef.current.enabled = true; onTransformEnd(); }}
          onObjectChange={onTransformDelta}
        />
      )}
      <OrbitControls ref={orbitRef} makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#ff6b6b', '#6bff8c', '#6b8cff']} labelColor="white" />
      </GizmoHelper>
    </>
  );
}

// ===== 3D Paint modal — paint directly on the selected mesh =====
function PaintableMesh({ shape, canvasRef, color, size, eraser, enabled = true }: {
  shape: ShapeItem;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  color: string;
  size: number;
  eraser: boolean;
  enabled?: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const paintingRef = useRef(false);

  // Create offscreen canvas with existing texture or white
  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    canvasRef.current = c;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    setTexture(tex);
    if (shape.textureUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { ctx.drawImage(img, 0, 0, c.width, c.height); tex.needsUpdate = true; };
      img.src = shape.textureUrl;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paintAt = (uv: THREE.Vector2) => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const x = uv.x * c.width;
    const y = (1 - uv.y) * c.height;
    ctx.save();
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (texture) texture.needsUpdate = true;
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || !enabled) return;
    paintingRef.current = true;
    if (e.uv) paintAt(e.uv.clone());
  };
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!paintingRef.current || !enabled) return;
    if (e.uv) paintAt(e.uv.clone());
  };
  const onPointerUp = () => { paintingRef.current = false; };

  const args = (() => {
    switch (shape.kind) {
      case 'sphere': return ['sphereGeometry', [1, 64, 64]] as const;
      case 'cylinder': return ['cylinderGeometry', [0.8, 0.8, 1.5, 64]] as const;
      case 'cone': return ['coneGeometry', [0.8, 1.5, 64]] as const;
      case 'torus': return ['torusGeometry', [0.7, 0.3, 32, 64]] as const;
      case 'torusKnot': return ['torusKnotGeometry', [0.6, 0.2, 128, 32]] as const;
      case 'capsule': return ['capsuleGeometry', [0.5, 1, 16, 32]] as const;
      case 'plane': return ['planeGeometry', [2, 2]] as const;
      case 'ring': return ['ringGeometry', [0.4, 1, 64]] as const;
      case 'tetrahedron': return ['tetrahedronGeometry', [1]] as const;
      case 'octahedron': return ['octahedronGeometry', [1]] as const;
      case 'icosahedron': return ['icosahedronGeometry', [1]] as const;
      case 'dodecahedron': return ['dodecahedronGeometry', [1]] as const;
      default: return ['boxGeometry', [1.2, 1.2, 1.2]] as const;
    }
  })();
  const [Geom, geomArgs] = args;

  return (
    <mesh ref={meshRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}>
      {/* @ts-expect-error dynamic geometry tag */}
      <Geom args={geomArgs} />
      <meshStandardMaterial map={texture ?? undefined} side={THREE.DoubleSide} />
    </mesh>
  );
}

function PaintModal({ shape, onClose, onSave }: {
  shape: ShapeItem;
  onClose: () => void;
  onSave: (url: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState(shape.color || '#ff4d6d');
  const [size, setSize] = useState(24);
  const [eraser, setEraser] = useState(false);
  const [mode, setMode] = useState<'paint' | 'rotate'>('paint');

  const save = () => {
    if (!canvasRef.current) return;
    onSave(canvasRef.current.toDataURL('image/png'));
    onClose();
  };

  const clearAll = () => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
  };

  const importTexture = (f: File) => {
    const c = canvasRef.current; if (!c) return;
    const r = new FileReader();
    r.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0, c.width, c.height);
      };
      img.src = ev.target?.result as string;
    };
    r.readAsDataURL(f);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 md:p-4">
      <div className="game-card ios-glass w-full max-w-5xl space-y-3 animate-zoom-in">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">🎨 3D Textúra festő — {shape.kind}</h3>
          <button className="game-btn bg-card text-sm py-1 px-3" onClick={onClose}>✕</button>
        </div>
        <div className="grid md:grid-cols-[260px_1fr] gap-3">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1">
              <button type="button" className={`game-btn text-xs py-2 ${mode === 'paint' ? 'bg-primary text-primary-foreground' : 'bg-card'}`} onClick={() => setMode('paint')}>🖌️ Festés</button>
              <button type="button" className={`game-btn text-xs py-2 ${mode === 'rotate' ? 'bg-primary text-primary-foreground' : 'bg-card'}`} onClick={() => setMode('rotate')}>🔄 Forgatás</button>
            </div>
            <div>
              <div className="text-xs font-bold mb-1">Szín</div>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-full h-10 rounded border border-border" />
            </div>
            <div>
              <div className="text-xs font-bold mb-1">Ecset méret: {size}px</div>
              <input type="range" min={2} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" className={`game-btn text-xs py-2 ${eraser ? 'bg-card' : 'bg-primary text-primary-foreground'}`} onClick={() => setEraser(false)}>✏️ Ecset</button>
              <button type="button" className={`game-btn text-xs py-2 ${eraser ? 'bg-primary text-primary-foreground' : 'bg-card'}`} onClick={() => setEraser(true)}>🧹 Radír</button>
            </div>
            <button type="button" className="game-btn bg-card text-xs py-2 w-full" onClick={clearAll}>🗑️ Üres</button>
            <label className="block">
              <span className="text-xs font-bold block mb-1">🖼️ Textúra import</span>
              <input type="file" accept="image/*" className="text-xs w-full file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:font-bold cursor-pointer"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importTexture(f); e.target.value = ''; }} />
            </label>
            <button type="button" className="game-btn-primary text-sm py-2 w-full" onClick={save}>✅ Alkalmaz</button>
            <p className="text-[10px] text-muted-foreground">Festés módban a bal egérrel rajzolsz. Forgatás módban a kamera mozog.</p>
          </div>
          <div className="rounded-2xl overflow-hidden bg-[#1b1b2a] h-[60vh] shadow-inner">
            <Canvas camera={{ position: [3, 2, 3], fov: 45 }} dpr={[1, 2]}>
              <ambientLight intensity={0.7} />
              <directionalLight position={[5, 5, 5]} intensity={0.9} />
              <PaintableMesh shape={shape} canvasRef={canvasRef} color={color} size={size} eraser={eraser} enabled={mode === 'paint'} />
              <OrbitControls makeDefault enableRotate={mode === 'rotate'} enablePan={mode === 'rotate'} enableZoom mouseButtons={{ LEFT: mode === 'rotate' ? THREE.MOUSE.ROTATE : (undefined as any), MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }} />
            </Canvas>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  onSubmit: (dataUrl: string) => void;
  onSubmitWithModel?: (data: { snapshot: string; glb: string }) => void;
  disabled?: boolean;
}

export default function ThreeDEditor({ onSubmit, onSubmitWithModel, disabled }: Props) {
  const [shapes, setShapes] = useState<ShapeItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('translate');
  const [paintOpen, setPaintOpen] = useState(false);

  const meshRefsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const orbitRef = useRef<any>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<Map<string, {
    position: THREE.Vector3;
    scale: THREE.Vector3;
    rotation: THREE.Euler;
  }>>(new Map());
  const leadStartRef = useRef<{
    position: THREE.Vector3;
    scale: THREE.Vector3;
    rotation: THREE.Euler;
  } | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);

  const registerRef = useCallback((id: string, m: THREE.Object3D | null) => {
    if (m) meshRefsRef.current.set(id, m); else meshRefsRef.current.delete(id);
  }, []);

  const primaryId = selectedIds[0] || null;

  const handlePickShape = useCallback((id: string, additive: boolean) => {
    setSelectedIds((prev) => {
      // If shape belongs to a group, expand selection to whole group.
      const shape = shapes.find((s) => s.id === id);
      const groupMembers = shape?.groupId
        ? shapes.filter((s) => s.groupId === shape.groupId).map((s) => s.id)
        : [id];
      if (additive) {
        const set = new Set(prev);
        const allIn = groupMembers.every((m) => set.has(m));
        if (allIn) groupMembers.forEach((m) => set.delete(m));
        else groupMembers.forEach((m) => set.add(m));
        return Array.from(set);
      }
      return groupMembers;
    });
  }, [shapes]);

  const addShape = useCallback((kind: ShapeKind) => {
    const item: ShapeItem = {
      id: crypto.randomUUID(),
      kind,
      position: [Math.random() * 2 - 1, 0.5, Math.random() * 2 - 1],
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      textValue: kind === 'text' ? 'Szöveg' : undefined,
      groupId: null,
    };
    setShapes((s) => [...s, item]);
    setSelectedIds([item.id]);
    playClick();
  }, []);

  const addTemplate = useCallback((tpl: Template) => {
    const gid = crypto.randomUUID();
    const offset: [number, number, number] = [Math.random() * 1.5 - 0.75, 0, Math.random() * 1.5 - 0.75];
    const items: ShapeItem[] = tpl.parts.map((p) => ({
      id: crypto.randomUUID(),
      kind: p.kind,
      position: [p.position[0] + offset[0], p.position[1] + offset[1], p.position[2] + offset[2]],
      scale: p.scale,
      rotation: p.rotation || [0, 0, 0],
      color: p.color,
      textValue: p.kind === 'text' ? p.textValue : undefined,
      groupId: gid,
    }));
    setShapes((s) => [...s, ...items]);
    setSelectedIds(items.map((i) => i.id));
    playClick();
  }, []);

  const selected = shapes.find((s) => s.id === primaryId) || null;

  const updateSelected = (patch: Partial<ShapeItem>) => {
    if (!primaryId) return;
    setShapes((all) => all.map((s) => (selectedIds.includes(s.id) ? { ...s, ...patch } : s)));
  };

  const deleteSelected = () => {
    if (selectedIds.length === 0) return;
    setShapes((s) => s.filter((x) => !selectedIds.includes(x.id)));
    setSelectedIds([]);
  };

  const duplicateSelected = () => {
    if (selectedIds.length === 0) return;
    const idMap = new Map<string, string>();
    const copies: ShapeItem[] = selectedIds.map((id) => {
      const src = shapes.find((s) => s.id === id);
      if (!src) return null as any;
      const newId = crypto.randomUUID();
      idMap.set(id, newId);
      return {
        ...src,
        id: newId,
        position: [src.position[0] + 0.5, src.position[1], src.position[2] + 0.5],
      };
    }).filter(Boolean) as ShapeItem[];
    // keep groups together: re-map groupId so duplicated group becomes its own group
    const groupRemap = new Map<string, string>();
    copies.forEach((c) => {
      if (c.groupId) {
        if (!groupRemap.has(c.groupId)) groupRemap.set(c.groupId, crypto.randomUUID());
        c.groupId = groupRemap.get(c.groupId)!;
      }
    });
    setShapes((s) => [...s, ...copies]);
    setSelectedIds(copies.map((c) => c.id));
    playClick();
  };

  const groupSelected = () => {
    if (selectedIds.length < 2) return;
    const gid = crypto.randomUUID();
    setShapes((all) => all.map((s) => selectedIds.includes(s.id) ? { ...s, groupId: gid } : s));
    playClick();
  };
  const ungroupSelected = () => {
    if (selectedIds.length === 0) return;
    setShapes((all) => all.map((s) => selectedIds.includes(s.id) ? { ...s, groupId: null } : s));
    playClick();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'g') setMode('translate');
      else if (e.key.toLowerCase() === 'r') setMode('rotate');
      else if (e.key.toLowerCase() === 's') setMode('scale');
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onTransformStart = useCallback(() => {
    if (!primaryId) return;
    dragStartRef.current.clear();
    selectedIds.forEach((id) => {
      const m = meshRefsRef.current.get(id);
      if (m) dragStartRef.current.set(id, {
        position: m.position.clone(),
        scale: m.scale.clone(),
        rotation: m.rotation.clone(),
      });
    });
    const lead = meshRefsRef.current.get(primaryId);
    if (lead) leadStartRef.current = {
      position: lead.position.clone(),
      scale: lead.scale.clone(),
      rotation: lead.rotation.clone(),
    };
  }, [primaryId, selectedIds]);

  const onTransformDelta = useCallback(() => {
    if (!primaryId) return;
    const lead = meshRefsRef.current.get(primaryId);
    const leadStart = leadStartRef.current;
    if (!lead || !leadStart) return;
    const dPos = lead.position.clone().sub(leadStart.position);
    const dRot = new THREE.Vector3(
      lead.rotation.x - leadStart.rotation.x,
      lead.rotation.y - leadStart.rotation.y,
      lead.rotation.z - leadStart.rotation.z,
    );
    const sScale = new THREE.Vector3(
      leadStart.scale.x !== 0 ? lead.scale.x / leadStart.scale.x : 1,
      leadStart.scale.y !== 0 ? lead.scale.y / leadStart.scale.y : 1,
      leadStart.scale.z !== 0 ? lead.scale.z / leadStart.scale.z : 1,
    );
    selectedIds.forEach((id) => {
      if (id === primaryId) return;
      const m = meshRefsRef.current.get(id);
      const start = dragStartRef.current.get(id);
      if (!m || !start) return;
      m.position.copy(start.position).add(dPos);
      m.rotation.set(start.rotation.x + dRot.x, start.rotation.y + dRot.y, start.rotation.z + dRot.z);
      m.scale.set(start.scale.x * sScale.x, start.scale.y * sScale.y, start.scale.z * sScale.z);
    });
  }, [primaryId, selectedIds]);

  const onTransformEnd = useCallback(() => {
    setShapes((all) => all.map((s) => {
      if (!selectedIds.includes(s.id)) return s;
      const m = meshRefsRef.current.get(s.id);
      if (!m) return s;
      return {
        ...s,
        position: [m.position.x, m.position.y, m.position.z],
        scale: [m.scale.x, m.scale.y, m.scale.z],
        rotation: [m.rotation.x, m.rotation.y, m.rotation.z],
      };
    }));
  }, [selectedIds]);

  const transformAttach = primaryId ? meshRefsRef.current.get(primaryId) ?? null : null;

  const handleSubmit = () => {
    if (!glRef.current || !sceneRef.current || !cameraRef.current) return;
    glRef.current.render(sceneRef.current, cameraRef.current as THREE.Camera);
    const dataUrl = glRef.current.domElement.toDataURL('image/jpeg', 0.92);
    if (onSubmitWithModel) {
      const group = new THREE.Group();
      meshRefsRef.current.forEach((m) => group.add(m.clone(true)));
      const exporter = new GLTFExporter();
      exporter.parse(group, (result) => {
        const buf = result instanceof ArrayBuffer
          ? result
          : new TextEncoder().encode(JSON.stringify(result)).buffer;
        // base64 encode
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        const glb = `data:model/gltf-binary;base64,${b64}`;
        onSubmitWithModel({ snapshot: dataUrl, glb });
      }, () => onSubmit(dataUrl), { binary: true });
    } else {
      onSubmit(dataUrl);
    }
  };

  const exportGLB = () => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    // export only the user meshes (clone), not lights/grid
    const group = new THREE.Group();
    meshRefsRef.current.forEach((m) => group.add(m.clone(true)));
    const exporter = new GLTFExporter();
    exporter.parse(group, (result) => {
      const blob = result instanceof ArrayBuffer
        ? new Blob([result], { type: 'model/gltf-binary' })
        : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'goryon-model.glb';
      a.click();
      URL.revokeObjectURL(url);
    }, (err) => console.error(err), { binary: true });
  };

  const importTextureForSelected = (file: File) => {
    const r = new FileReader();
    r.onload = (ev) => updateSelected({ textureUrl: ev.target?.result as string });
    r.readAsDataURL(file);
  };

  return (
    <div className="grid w-full max-w-[1200px] gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="game-card space-y-4 p-4 max-h-[80vh] overflow-y-auto">
        <div>
          <div className="font-bold text-sm mb-2">🧰 Mód (G/R/S)</div>
          <div className="grid grid-cols-3 gap-1">
            {(['translate', 'rotate', 'scale'] as Mode[]).map((m) => (
              <button key={m} type="button"
                className={`text-xs py-2 rounded-lg border-2 font-bold ${mode === m ? 'border-primary bg-primary/20' : 'border-border bg-card'}`}
                onClick={() => setMode(m)}>
                {m === 'translate' ? '↔ Mozgat' : m === 'rotate' ? '⟳ Forgat' : '⤢ Méret'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="font-bold text-sm mb-2">🧊 Alakzatok</div>
          <div className="grid grid-cols-2 gap-2">
            {SHAPE_BUTTONS.map((s) => (
              <button key={s.id} type="button" className="game-btn bg-card text-xs py-2 px-2 hover-glow" onClick={() => addShape(s.id)}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="font-bold text-sm mb-2">📚 Sablonok</div>
          <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button"
                className="game-btn bg-card text-xs py-3 px-2 hover-glow flex flex-col items-center gap-1"
                onClick={() => addTemplate(t)}>
                <span className="text-2xl">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Egy sablon = egy kész csoport, együtt mozog.</p>
        </div>

        {selected ? (
          <div className="space-y-3 border-t-2 border-border pt-3">
            <div className="font-bold text-sm">
              Kijelölt: {selected.kind}
              {selectedIds.length > 1 && <span className="ml-1 text-primary">+{selectedIds.length - 1}</span>}
              {selected.groupId && <span className="ml-1 text-accent">🧩 csoport</span>}
            </div>

            {selected.kind === 'text' && (
              <div>
                <div className="text-xs font-bold mb-1">Szöveg tartalom</div>
                <input type="text" value={selected.textValue || ''}
                  onChange={(e) => updateSelected({ textValue: e.target.value })}
                  className="w-full px-2 py-1 text-sm rounded border-2 border-border bg-card" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-1">
              <button type="button" className="game-btn bg-card text-xs py-2" onClick={duplicateSelected}>📑 Másol</button>
              <button type="button" className="game-btn bg-destructive text-destructive-foreground text-xs py-2" onClick={deleteSelected}>🗑️ Töröl</button>
            </div>

            <div className="grid grid-cols-2 gap-1">
              <button type="button" className="game-btn bg-card text-xs py-2 disabled:opacity-50"
                disabled={selectedIds.length < 2}
                onClick={groupSelected} title="Ctrl+G">🧩 Csoport</button>
              <button type="button" className="game-btn bg-card text-xs py-2 disabled:opacity-50"
                disabled={!selected.groupId}
                onClick={ungroupSelected} title="Ctrl+Shift+G">💔 Bont</button>
            </div>
            <p className="text-[10px] text-muted-foreground">Shift+kattintás: több kijelölés. Csoportban mozgás együtt.</p>

            {selected.kind !== 'text' && (
              <>
                <button type="button" className="game-btn-primary text-xs py-2 w-full" onClick={() => setPaintOpen(true)}>
                  🎨 3D Textúra festő
                </button>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground mb-1 block">🖼️ Textúra import</span>
                  <input type="file" accept="image/*"
                    className="text-xs w-full file:mr-1 file:py-1 file:px-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:font-bold cursor-pointer"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) importTextureForSelected(f); e.target.value = ''; }} />
                </label>
                {selected.textureUrl && (
                  <button type="button" className="game-btn bg-card text-xs py-1 w-full" onClick={() => updateSelected({ textureUrl: undefined })}>
                    ❌ Textúra eltávolítása
                  </button>
                )}
              </>
            )}

            <div>
              <div className="text-xs font-bold mb-1">Szín</div>
              <div className="grid grid-cols-8 gap-1">
                {COLORS.map((c) => (
                  <button key={c} type="button" style={{ background: c }}
                    className={`h-6 rounded border-2 ${selected.color === c ? 'border-foreground' : 'border-border/40'}`}
                    onClick={() => updateSelected({ color: c })} />
                ))}
              </div>
              <input type="color" value={selected.color} onChange={(e) => updateSelected({ color: e.target.value })}
                className="w-full h-9 mt-2 rounded border border-border" />
            </div>

            <div>
              <div className="text-xs font-bold mb-1">Egyenletes méret</div>
              <input type="range" min={0.1} max={4} step={0.05}
                value={selected.scale[0]}
                onChange={(e) => { const v = Number(e.target.value); updateSelected({ scale: [v, v, v] }); }}
                className="w-full" />
            </div>

            <p className="text-[10px] text-muted-foreground">
              💡 Húzd a gizmot. A háttér alakzatok drag közben nem zavarják be a kijelölést.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Kattints egy alakzatra (vagy adj hozzá újat). Húzd a gizmot a mozgatáshoz.</p>
        )}
      </div>

      <div className="game-card p-2">
        <div className="rounded-xl overflow-hidden bg-[#1b1b2a] h-[60vh] max-h-[600px]">
          <Canvas
            shadows
            camera={{ position: [4, 4, 6], fov: 50 }}
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            onCreated={({ gl, scene, camera }) => {
              glRef.current = gl;
              sceneRef.current = scene;
              cameraRef.current = camera;
            }}
            onPointerMissed={() => { if (!draggingRef.current) setSelectedIds([]); }}
          >
            <SceneContent
              shapes={shapes}
              selectedIds={selectedIds}
              mode={mode}
              onPickShape={handlePickShape}
              registerRef={registerRef}
              onTransformStart={onTransformStart}
              onTransformDelta={onTransformDelta}
              onTransformEnd={onTransformEnd}
              orbitRef={orbitRef}
              transformAttach={transformAttach}
              draggingRef={draggingRef}
            />
          </Canvas>
        </div>

        <div className="flex justify-center gap-2 mt-3 flex-wrap">
          <button type="button" className="game-btn bg-card text-sm py-2 px-3" onClick={() => { setShapes([]); setSelectedIds([]); }}>
            🗑️ Üres
          </button>
          <button type="button" className="game-btn bg-card text-sm py-2 px-3" onClick={exportGLB} disabled={shapes.length === 0}>
            💾 .glb letöltés
          </button>
          <button type="button" className="game-btn-primary text-sm py-2 px-4 hover-glow" onClick={handleSubmit} disabled={disabled || shapes.length === 0}>
            ✅ KÉSZ!
          </button>
        </div>
      </div>

      {paintOpen && selected && selected.kind !== 'text' && (
        <PaintModal
          shape={selected}
          onClose={() => setPaintOpen(false)}
          onSave={(url) => updateSelected({ textureUrl: url })}
        />
      )}
    </div>
  );
}