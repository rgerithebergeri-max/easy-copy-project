import { useRef, useState, useEffect, useCallback } from 'react';
import { playClick } from '@/lib/sounds';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ===== Overlay object types (text / image / gif / video) =====
type OverlayKind = 'text' | 'image' | 'video';
interface Overlay {
  id: string;
  kind: OverlayKind;
  x: number; y: number; w: number; h: number; rot: number; // in CANVAS coords
  // text
  text?: string;
  font?: string;
  fontSize?: number;
  color?: string;
  // image / video / gif src
  src?: string;
  // gif frames (decoded animated)
  gifFrames?: ImageBitmap[];
  gifDelays?: number[];
  // video element (live)
  _video?: HTMLVideoElement;
  _img?: HTMLImageElement;
}

type Tool =
  | 'brush' | 'eraser' | 'fill' | 'line' | 'rect' | 'circle'
  | 'triangle' | 'star' | 'arrow' | 'polygon'
  | 'eyebrow' | 'fur' | 'spray';

type FaceStamp = 'nose' | 'eye' | 'mouth' | 'mustache' | 'ear' | 'hair';

const COLORS = [
  '#000000', '#808080', '#C0C0C0', '#FFFFFF',
  '#FF0000', '#FF6600', '#FFFF00', '#66FF00',
  '#00FF00', '#00FF66', '#00FFFF', '#0066FF',
  '#0000FF', '#6600FF', '#FF00FF', '#FF0066',
  '#800000', '#804000', '#808000', '#408000',
  '#008000', '#008040', '#008080', '#004080',
  '#000080', '#400080', '#800080', '#800040',
  '#FFE4C4', '#F5DEB3', '#D2B48C', '#A0522D',
];

const DISPLAY_W = 800;
const DISPLAY_H = 500;
const CANVAS_W = 1600;
const CANVAS_H = 1000;

const TOOL_BUTTONS: { id: Tool; icon: string; label: string }[] = [
  { id: 'brush', icon: '✏️', label: 'Ecset' },
  { id: 'eraser', icon: '🧹', label: 'Radír' },
  { id: 'fill', icon: '🪣', label: 'Kitöltés' },
  { id: 'line', icon: '📏', label: 'Vonal' },
  { id: 'rect', icon: '⬜', label: 'Téglalap' },
  { id: 'circle', icon: '⭕', label: 'Kör' },
  { id: 'triangle', icon: '🔺', label: 'Háromszög' },
  { id: 'star', icon: '⭐', label: 'Csillag' },
  { id: 'arrow', icon: '➡️', label: 'Nyíl' },
  { id: 'polygon', icon: '⬟', label: 'Sokszög' },
  { id: 'eyebrow', icon: '🪶', label: 'Szemöldök' },
  { id: 'fur', icon: '🐾', label: 'Szőrzet' },
  { id: 'spray', icon: '💨', label: 'Spray' },
];

const FACE_STAMPS: { id: FaceStamp; icon: string; label: string }[] = [
  { id: 'nose', icon: '👃', label: 'Orr' },
  { id: 'eye', icon: '👁️', label: 'Szem' },
  { id: 'mouth', icon: '👄', label: 'Száj' },
  { id: 'mustache', icon: '🥸', label: 'Bajusz' },
  { id: 'ear', icon: '👂', label: 'Fül' },
  { id: 'hair', icon: '💇', label: 'Haj' },
];

const TEMPLATES: { id: string; label: string; icon: string }[] = [
  { id: 'face', label: 'Arc kontúr', icon: '😶' },
  { id: 'house', label: 'Ház', icon: '🏠' },
  { id: 'tree', label: 'Fa', icon: '🌳' },
  { id: 'cat', label: 'Macska', icon: '🐱' },
];

interface Point { x: number; y: number; }
interface Layer {
  id: string;
  name: string;
  visible: boolean;
  canvas: HTMLCanvasElement;
}

function makeLayer(name: string): Layer {
  const c = document.createElement('canvas');
  c.width = CANVAS_W; c.height = CANVAS_H;
  return { id: crypto.randomUUID(), name, visible: true, canvas: c };
}

interface Props {
  onSubmit: (dataUrl: string) => void;
  isSecret?: boolean;
  disabled?: boolean;
  allowImageImport?: boolean;
  hideSubmit?: boolean;
  onChange?: (dataUrl: string) => void;
  darknessOverlay?: number; // 0..1 dark veil over canvas
  compact?: boolean;
}

export default function DrawingCanvas({ onSubmit, isSecret, disabled, allowImageImport, hideSubmit, onChange, darknessOverlay, compact }: Props) {
  const composedRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null); // floating preview for shape drag
  const [layers, setLayers] = useState<Layer[]>(() => {
    const bg = makeLayer('Háttér');
    const ctx = bg.canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const l1 = makeLayer('Réteg 1');
    return [bg, l1];
  });
  const [activeLayerId, setActiveLayerId] = useState<string>('');

  // Overlays (positioned/scalable text & media)
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const overlaysRef = useRef<Overlay[]>([]);
  useEffect(() => { overlaysRef.current = overlays; }, [overlays]);

  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(6);
  const [zoom, setZoom] = useState(1);
  const [zoomMul, setZoomMul] = useState(1); // user multiplier on top of auto-fit
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [symmetry, setSymmetry] = useState<'off' | 'h' | 'v' | 'both'>('off');

  // Auto-fit zoom so canvas always fits without scrollbars
  useEffect(() => {
    const recalc = () => {
      const el = canvasWrapRef.current;
      if (!el) return;
      const availW = Math.max(220, el.clientWidth - 16);
      const maxH = Math.max(220, Math.min(window.innerHeight * (compact ? 0.52 : 0.62), 720));
      const fit = Math.min(availW / DISPLAY_W, maxH / DISPLAY_H);
      setZoom(Math.max(0.2, Math.min(2, fit * zoomMul)));
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    if (canvasWrapRef.current) ro.observe(canvasWrapRef.current);
    window.addEventListener('resize', recalc);
    return () => { ro.disconnect(); window.removeEventListener('resize', recalc); };
  }, [compact, zoomMul]);
  const [undoStack, setUndoStack] = useState<{ layerId: string; data: ImageData }[]>([]);
  const [redoStack, setRedoStack] = useState<{ layerId: string; data: ImageData }[]>([]);
  const isDrawingRef = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const lastPos = useRef<Point | null>(null);

  useEffect(() => {
    if (layers.length && !activeLayerId) setActiveLayerId(layers[layers.length - 1].id);
  }, [layers, activeLayerId]);

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[layers.length - 1];

  const compose = useCallback(() => {
    const c = composedRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    layers.forEach((layer) => {
      if (layer.visible) ctx.drawImage(layer.canvas, 0, 0);
    });
    // overlays drawn on top
    overlaysRef.current.forEach((ov) => drawOverlay(ctx, ov));
    // preview overlay
    if (previewRef.current) ctx.drawImage(previewRef.current, 0, 0);
  }, [layers]);

  // Throttled live broadcast for modes that need it
  const lastLiveRef = useRef(0);
  useEffect(() => {
    if (!onChange) return;
    const id = setInterval(() => {
      const now = Date.now();
      if (now - lastLiveRef.current < 700) return;
      lastLiveRef.current = now;
      const c = composedRef.current;
      if (!c) return;
      try { onChange(c.toDataURL('image/jpeg', 0.55)); } catch {}
    }, 750);
    return () => clearInterval(id);
  }, [onChange]);

  // Animation loop for video / gif overlays
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (overlaysRef.current.some((o) => o.kind === 'video' || (o.kind === 'image' && o.gifFrames))) {
        compose();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [compose]);

  const drawOverlay = (ctx: CanvasRenderingContext2D, ov: Overlay) => {
    ctx.save();
    ctx.translate(ov.x + ov.w / 2, ov.y + ov.h / 2);
    ctx.rotate(ov.rot);
    if (ov.kind === 'text') {
      ctx.fillStyle = ov.color || '#000';
      ctx.font = `${ov.fontSize || 48}px ${ov.font || 'sans-serif'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = (ov.text || '').split('\n');
      const lh = (ov.fontSize || 48) * 1.1;
      lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * lh));
    } else if (ov.kind === 'image') {
      if (ov.gifFrames && ov.gifFrames.length) {
        const total = ov.gifDelays?.reduce((a, b) => a + b, 0) || 1000;
        const t = (performance.now() % total);
        let acc = 0; let idx = 0;
        for (let i = 0; i < ov.gifFrames.length; i++) {
          acc += ov.gifDelays?.[i] || 100;
          if (t < acc) { idx = i; break; }
        }
        ctx.drawImage(ov.gifFrames[idx], -ov.w / 2, -ov.h / 2, ov.w, ov.h);
      } else if (ov._img) {
        ctx.drawImage(ov._img, -ov.w / 2, -ov.h / 2, ov.w, ov.h);
      }
    } else if (ov.kind === 'video' && ov._video && ov._video.readyState >= 2) {
      ctx.drawImage(ov._video, -ov.w / 2, -ov.h / 2, ov.w, ov.h);
    }
    ctx.restore();
  };

  useEffect(() => { compose(); }, [compose, layers, overlays]);

  useEffect(() => {
    // init preview canvas
    const c = document.createElement('canvas');
    c.width = CANVAS_W; c.height = CANVAS_H;
    (previewRef as any).current = c;
  }, []);

  const saveState = useCallback(() => {
    if (!activeLayer) return;
    const ctx = activeLayer.canvas.getContext('2d')!;
    setUndoStack((s) => [...s.slice(-29), { layerId: activeLayer.id, data: ctx.getImageData(0, 0, CANVAS_W, CANVAS_H) }]);
    setRedoStack([]);
  }, [activeLayer]);

  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const last = s[s.length - 1];
      const layer = layers.find((l) => l.id === last.layerId);
      if (!layer) return s.slice(0, -1);
      const ctx = layer.canvas.getContext('2d')!;
      const current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      setRedoStack((r) => [...r, { layerId: last.layerId, data: current }]);
      ctx.putImageData(last.data, 0, 0);
      compose();
      return s.slice(0, -1);
    });
    playClick();
  }, [layers, compose]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const last = r[r.length - 1];
      const layer = layers.find((l) => l.id === last.layerId);
      if (!layer) return r.slice(0, -1);
      const ctx = layer.canvas.getContext('2d')!;
      const current = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      setUndoStack((u) => [...u, { layerId: last.layerId, data: current }]);
      ctx.putImageData(last.data, 0, 0);
      compose();
      return r.slice(0, -1);
    });
    playClick();
  }, [layers, compose]);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const clearActive = useCallback(() => {
    if (!activeLayer) return;
    saveState();
    const ctx = activeLayer.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    compose();
  }, [activeLayer, saveState, compose]);

  const addLayer = () => {
    const l = makeLayer(`Réteg ${layers.length}`);
    setLayers((s) => [...s, l]);
    setActiveLayerId(l.id);
    playClick();
  };
  const deleteLayer = (id: string) => {
    if (layers.length <= 1) return;
    setLayers((s) => s.filter((l) => l.id !== id));
    if (activeLayerId === id) setActiveLayerId(layers[0].id);
    setTimeout(compose, 0);
  };
  const moveLayer = (id: string, dir: -1 | 1) => {
    setLayers((s) => {
      const idx = s.findIndex((l) => l.id === id);
      if (idx < 0) return s;
      const ni = Math.max(0, Math.min(s.length - 1, idx + dir));
      if (ni === idx) return s;
      const copy = s.slice();
      const [item] = copy.splice(idx, 1);
      copy.splice(ni, 0, item);
      return copy;
    });
  };
  const toggleLayer = (id: string) => {
    setLayers((s) => s.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  };

  // ===== draw utils =====
  const prepareStroke = (ctx: CanvasRenderingContext2D, activeTool: Tool) => {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = activeTool === 'eraser' ? 'rgba(0,0,0,1)' : color;
    ctx.fillStyle = activeTool === 'eraser' ? 'rgba(0,0,0,1)' : color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';

    switch (activeTool) {
      case 'eraser': ctx.lineWidth = brushSize * 2; break;
      case 'eyebrow': ctx.lineWidth = Math.max(1, brushSize * 0.6); ctx.globalAlpha = 0.8; break;
      case 'fur':     ctx.lineWidth = Math.max(1, brushSize * 0.35); ctx.globalAlpha = 0.9; break;
      default:        ctx.lineWidth = brushSize;
    }
  };

  const drawSegment = (ctx: CanvasRenderingContext2D, from: Point, to: Point) => {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(from.x, from.y, midX, midY);
    ctx.stroke();
  };

  const mirror = (p: Point): Point[] => {
    const out: Point[] = [p];
    if (symmetry === 'h' || symmetry === 'both') out.push({ x: CANVAS_W - p.x, y: p.y });
    if (symmetry === 'v' || symmetry === 'both') out.push({ x: p.x, y: CANVAS_H - p.y });
    if (symmetry === 'both') out.push({ x: CANVAS_W - p.x, y: CANVAS_H - p.y });
    return out;
  };

  const paintSegment = (ctx: CanvasRenderingContext2D, from: Point, to: Point) => {
    prepareStroke(ctx, tool);
    const froms = mirror(from);
    const tos = mirror(to);

    for (let i = 0; i < froms.length; i++) {
      const f = froms[i];
      const t = tos[i];
      if (tool === 'fur') {
        const hairs = Math.max(4, Math.round(brushSize * 1.4));
        for (let j = 0; j < hairs; j++) {
          const ox = (Math.random() - 0.5) * brushSize * 2.2;
          const oy = (Math.random() - 0.5) * brushSize * 2.2;
          ctx.beginPath();
          ctx.moveTo(f.x + ox * 0.2, f.y + oy * 0.2);
          ctx.lineTo(t.x + ox, t.y + oy);
          ctx.stroke();
        }
      } else if (tool === 'spray') {
        const count = Math.max(8, brushSize * 4);
        const r = brushSize * 2;
        for (let j = 0; j < count; j++) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.random() * r;
          ctx.fillRect(t.x + Math.cos(a) * rr, t.y + Math.sin(a) * rr, 1, 1);
        }
      } else if (tool === 'eyebrow') {
        drawSegment(ctx, f, t);
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(1, brushSize * 0.3);
        drawSegment(ctx, { x: f.x + 1.5, y: f.y + 0.5 }, { x: t.x + 1.5, y: t.y + 0.5 });
        ctx.globalAlpha = 1;
        ctx.lineWidth = Math.max(1, brushSize * 0.6);
      } else {
        drawSegment(ctx, f, t);
      }
    }
  };

  // shape drawing on preview, committed on mouseup
  const drawShapePreview = (from: Point, to: Point) => {
    const pctx = previewRef.current!.getContext('2d')!;
    pctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    pctx.strokeStyle = color;
    pctx.fillStyle = color;
    pctx.lineWidth = brushSize;
    pctx.lineCap = 'round';

    const drawOne = (a: Point, b: Point) => {
      pctx.beginPath();
      const w = b.x - a.x, h = b.y - a.y;
      const cx = a.x + w / 2, cy = a.y + h / 2;
      switch (tool) {
        case 'line': pctx.moveTo(a.x, a.y); pctx.lineTo(b.x, b.y); pctx.stroke(); break;
        case 'rect': pctx.rect(a.x, a.y, w, h); pctx.stroke(); break;
        case 'circle': {
          pctx.ellipse(cx, cy, Math.abs(w / 2) || 1, Math.abs(h / 2) || 1, 0, 0, Math.PI * 2);
          pctx.stroke();
          break;
        }
        case 'triangle': {
          pctx.moveTo(cx, a.y);
          pctx.lineTo(b.x, b.y);
          pctx.lineTo(a.x, b.y);
          pctx.closePath();
          pctx.stroke();
          break;
        }
        case 'star': {
          const spikes = 5;
          const r = Math.min(Math.abs(w), Math.abs(h)) / 2 || 1;
          for (let i = 0; i < spikes * 2; i++) {
            const ang = (Math.PI / spikes) * i - Math.PI / 2;
            const rr = i % 2 === 0 ? r : r / 2;
            const px = cx + Math.cos(ang) * rr;
            const py = cy + Math.sin(ang) * rr;
            if (i === 0) pctx.moveTo(px, py); else pctx.lineTo(px, py);
          }
          pctx.closePath();
          pctx.stroke();
          break;
        }
        case 'arrow': {
          pctx.moveTo(a.x, a.y);
          pctx.lineTo(b.x, b.y);
          pctx.stroke();
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const head = Math.max(10, brushSize * 2);
          pctx.beginPath();
          pctx.moveTo(b.x, b.y);
          pctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
          pctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
          pctx.closePath();
          pctx.fill();
          break;
        }
        case 'polygon': {
          const sides = 6;
          const r = Math.min(Math.abs(w), Math.abs(h)) / 2 || 1;
          for (let i = 0; i < sides; i++) {
            const ang = (Math.PI * 2 / sides) * i - Math.PI / 2;
            const px = cx + Math.cos(ang) * r;
            const py = cy + Math.sin(ang) * r;
            if (i === 0) pctx.moveTo(px, py); else pctx.lineTo(px, py);
          }
          pctx.closePath();
          pctx.stroke();
          break;
        }
      }
    };

    const froms = mirror(from);
    const tos = mirror(to);
    for (let i = 0; i < froms.length; i++) drawOne(froms[i], tos[i]);

    compose();
  };

  const commitPreview = () => {
    if (!activeLayer || !previewRef.current) return;
    const ctx = activeLayer.canvas.getContext('2d')!;
    ctx.drawImage(previewRef.current, 0, 0);
    previewRef.current.getContext('2d')!.clearRect(0, 0, CANVAS_W, CANVAS_H);
    compose();
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = composedRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    if ('touches' in e && e.touches.length > 0) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    const me = e as React.MouseEvent;
    return {
      x: (me.clientX - rect.left) * scaleX,
      y: (me.clientY - rect.top) * scaleY,
    };
  };

  const hexToRgb = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });

  const floodFill = (sx: number, sy: number) => {
    if (!activeLayer) return;
    const ctx = activeLayer.canvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const d = imgData.data;
    const tIdx = (sy * CANVAS_W + sx) * 4;
    const tR = d[tIdx], tG = d[tIdx + 1], tB = d[tIdx + 2], tA = d[tIdx + 3];
    const fill = hexToRgb(color);
    if (tR === fill.r && tG === fill.g && tB === fill.b && tA === 255) return;
    const visited = new Uint8Array(CANVAS_W * CANVAS_H);
    const stack: number[] = [sx, sy];
    while (stack.length > 0) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      if (x < 0 || x >= CANVAS_W || y < 0 || y >= CANVAS_H) continue;
      const key = y * CANVAS_W + x;
      if (visited[key]) continue;
      const idx = key * 4;
      const diff = Math.abs(d[idx] - tR) + Math.abs(d[idx + 1] - tG) + Math.abs(d[idx + 2] - tB) + Math.abs(d[idx + 3] - tA);
      if (diff > 60) continue;
      visited[key] = 1;
      d[idx] = fill.r; d[idx + 1] = fill.g; d[idx + 2] = fill.b; d[idx + 3] = 255;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    ctx.putImageData(imgData, 0, 0);
    compose();
  };

  const stampFace = (kind: FaceStamp, cx: number, cy: number, size: number) => {
    if (!activeLayer) return;
    saveState();
    const ctx = activeLayer.canvas.getContext('2d')!;
    ctx.save();
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (kind) {
      case 'nose': {
        ctx.beginPath();
        ctx.moveTo(cx, cy - size);
        ctx.lineTo(cx - size * 0.5, cy + size * 0.4);
        ctx.quadraticCurveTo(cx, cy + size * 0.6, cx + size * 0.5, cy + size * 0.4);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx - size * 0.2, cy + size * 0.3, size * 0.12, size * 0.18, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + size * 0.2, cy + size * 0.3, size * 0.12, size * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'eye': {
        ctx.beginPath();
        ctx.ellipse(cx, cy, size, size * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.ellipse(cx, cy, size * 0.95, size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(cx, cy, size * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = '#000';
        ctx.arc(cx, cy, size * 0.18, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'mouth': {
        ctx.beginPath();
        ctx.moveTo(cx - size, cy);
        ctx.quadraticCurveTo(cx, cy + size * 0.7, cx + size, cy);
        ctx.quadraticCurveTo(cx, cy + size * 0.3, cx - size, cy);
        ctx.fillStyle = '#c62828';
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'mustache': {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.bezierCurveTo(cx - size * 0.4, cy - size * 0.5, cx - size, cy - size * 0.3, cx - size * 1.2, cy + size * 0.2);
        ctx.bezierCurveTo(cx - size * 0.7, cy + size * 0.1, cx - size * 0.3, cy + size * 0.1, cx, cy);
        ctx.bezierCurveTo(cx + size * 0.4, cy - size * 0.5, cx + size, cy - size * 0.3, cx + size * 1.2, cy + size * 0.2);
        ctx.bezierCurveTo(cx + size * 0.7, cy + size * 0.1, cx + size * 0.3, cy + size * 0.1, cx, cy);
        ctx.fill();
        break;
      }
      case 'ear': {
        ctx.beginPath();
        ctx.ellipse(cx, cy, size * 0.6, size, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, size * 0.3, size * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'hair': {
        for (let i = -6; i <= 6; i++) {
          ctx.beginPath();
          ctx.moveTo(cx + i * size * 0.18, cy);
          ctx.quadraticCurveTo(cx + i * size * 0.18 + size * 0.1, cy - size * 0.7, cx + i * size * 0.18 + size * 0.05, cy - size);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
    compose();
    playClick();
  };

  // Templates
  const loadTemplate = (id: string) => {
    if (!activeLayer) return;
    saveState();
    const ctx = activeLayer.canvas.getContext('2d')!;
    ctx.save();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
    if (id === 'face') {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 300, 380, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx - 110, cy - 80, 35, 25, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 110, cy - 80, 35, 25, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - 40);
      ctx.lineTo(cx, cy + 60);
      ctx.moveTo(cx - 80, cy + 150);
      ctx.quadraticCurveTo(cx, cy + 220, cx + 80, cy + 150);
      ctx.stroke();
    } else if (id === 'house') {
      ctx.beginPath();
      ctx.rect(cx - 200, cy - 100, 400, 300);
      ctx.moveTo(cx - 230, cy - 100);
      ctx.lineTo(cx, cy - 280);
      ctx.lineTo(cx + 230, cy - 100);
      ctx.stroke();
    } else if (id === 'tree') {
      ctx.beginPath();
      ctx.rect(cx - 35, cy + 50, 70, 200);
      ctx.moveTo(cx, cy - 200);
      ctx.arc(cx, cy - 50, 200, 0, Math.PI * 2);
      ctx.stroke();
    } else if (id === 'cat') {
      ctx.beginPath();
      ctx.arc(cx, cy, 200, 0, Math.PI * 2);
      ctx.moveTo(cx - 200, cy - 100);
      ctx.lineTo(cx - 120, cy - 250);
      ctx.lineTo(cx - 60, cy - 130);
      ctx.moveTo(cx + 200, cy - 100);
      ctx.lineTo(cx + 120, cy - 250);
      ctx.lineTo(cx + 60, cy - 130);
      ctx.stroke();
    }
    ctx.restore();
    compose();
    playClick();
  };

  // ===== Image import (új réteg) =====
  const importImageFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const layer = makeLayer(`Kép ${layers.length}`);
        const ctx = layer.canvas.getContext('2d')!;
        const scale = Math.min((CANVAS_W * 0.7) / img.width, (CANVAS_H * 0.7) / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
        setLayers((s) => [...s, layer]);
        setActiveLayerId(layer.id);
        setTimeout(compose, 0);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleImageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) importImageFromFile(f);
    e.target.value = '';
    playClick();
  };

  // ===== Ctrl+V paste image support =====
  useEffect(() => {
    if (!allowImageImport) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            // gif → overlay (animated), else new layer
            if (f.type === 'image/gif') addImageOverlayFromFile(f);
            else addImageOverlayFromFile(f);
            playClick();
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowImageImport]);

  // ===== Overlay helpers (movable/resizable text + media) =====
  const addOverlay = (ov: Overlay) => {
    setOverlays((s) => [...s, ov]);
    setSelectedOverlayId(ov.id);
  };

  const updateOverlay = (id: string, patch: Partial<Overlay>) => {
    setOverlays((s) => s.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const deleteOverlay = (id: string) => {
    setOverlays((s) => s.filter((o) => o.id !== id));
    if (selectedOverlayId === id) setSelectedOverlayId(null);
  };

  const addTextOverlay = () => {
    addOverlay({
      id: crypto.randomUUID(),
      kind: 'text',
      x: CANVAS_W / 2 - 200, y: CANVAS_H / 2 - 40, w: 400, h: 80, rot: 0,
      text: 'Szöveg', fontSize: 64, color, font: 'Impact, sans-serif',
    });
    playClick();
  };

  const addImageOverlayFromFile = async (file: File) => {
    const url = await new Promise<string>((res) => {
      const r = new FileReader(); r.onload = (e) => res(e.target?.result as string); r.readAsDataURL(file);
    });
    if (file.type === 'image/gif') {
      // decode all frames using ImageDecoder if available, fallback to single frame
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const dec = new (window as any).ImageDecoder({ data: buf, type: 'image/gif' });
        await dec.tracks.ready;
        const track = dec.tracks.selectedTrack;
        const total = track?.frameCount || 1;
        const frames: ImageBitmap[] = [];
        const delays: number[] = [];
        for (let i = 0; i < total; i++) {
          const f = await dec.decode({ frameIndex: i });
          const bmp = await createImageBitmap(f.image);
          frames.push(bmp);
          delays.push((f.image.duration ? f.image.duration / 1000 : 100));
        }
        const w = frames[0].width; const h = frames[0].height;
        const scale = Math.min(CANVAS_W * 0.5 / w, CANVAS_H * 0.5 / h, 1);
        addOverlay({
          id: crypto.randomUUID(), kind: 'image',
          x: CANVAS_W / 2 - (w * scale) / 2, y: CANVAS_H / 2 - (h * scale) / 2,
          w: w * scale, h: h * scale, rot: 0,
          gifFrames: frames, gifDelays: delays, src: url,
        });
        return;
      } catch (e) {
        // fallback to static image
      }
    }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(CANVAS_W * 0.5 / img.width, CANVAS_H * 0.5 / img.height, 1);
      const w = img.width * scale; const h = img.height * scale;
      const ov: Overlay = {
        id: crypto.randomUUID(), kind: 'image',
        x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 - h / 2, w, h, rot: 0,
        src: url, _img: img,
      };
      addOverlay(ov);
    };
    img.src = url;
  };

  const addVideoOverlayFromFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.onloadeddata = () => {
      const w = v.videoWidth || 480; const h = v.videoHeight || 270;
      const scale = Math.min(CANVAS_W * 0.5 / w, CANVAS_H * 0.5 / h, 1);
      v.play().catch(() => {});
      addOverlay({
        id: crypto.randomUUID(), kind: 'video',
        x: CANVAS_W / 2 - (w * scale) / 2, y: CANVAS_H / 2 - (h * scale) / 2,
        w: w * scale, h: h * scale, rot: 0,
        src: url, _video: v,
      });
    };
  };

  // pointer hit-test for overlays (returns top-most hit)
  const hitOverlay = (p: Point): Overlay | null => {
    for (let i = overlays.length - 1; i >= 0; i--) {
      const o = overlays[i];
      // rough AABB ignoring rotation for picking; good enough
      if (p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h) return o;
    }
    return null;
  };

  // Overlay drag/handle interaction state
  const overlayDragRef = useRef<{ id: string; mode: 'move' | 'scale' | 'rotate'; start: Point; orig: Overlay } | null>(null);

  const startOverlayInteraction = (e: React.MouseEvent | React.TouchEvent, id: string, mode: 'move' | 'scale' | 'rotate') => {
    e.stopPropagation();
    e.preventDefault();
    const orig = overlays.find((o) => o.id === id);
    if (!orig) return;
    overlayDragRef.current = { id, mode, start: getPos(e), orig: { ...orig } };
    setSelectedOverlayId(id);

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const ref = overlayDragRef.current; if (!ref) return;
      const point = getPosFromNative(ev);
      const dx = point.x - ref.start.x;
      const dy = point.y - ref.start.y;
      if (ref.mode === 'move') {
        updateOverlay(ref.id, { x: ref.orig.x + dx, y: ref.orig.y + dy });
      } else if (ref.mode === 'scale') {
        const newW = Math.max(20, ref.orig.w + dx);
        const newH = Math.max(20, ref.orig.h + dy);
        updateOverlay(ref.id, { w: newW, h: newH });
      } else if (ref.mode === 'rotate') {
        const cx = ref.orig.x + ref.orig.w / 2;
        const cy = ref.orig.y + ref.orig.h / 2;
        const ang = Math.atan2(point.y - cy, point.x - cx);
        updateOverlay(ref.id, { rot: ang + Math.PI / 2 });
      }
    };
    const onUp = () => {
      overlayDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove as any);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove as any, { passive: false });
    window.addEventListener('touchend', onUp);
  };

  const getPosFromNative = (e: MouseEvent | TouchEvent): Point => {
    const canvas = composedRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    if ('touches' in e && e.touches.length > 0) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    const m = e as MouseEvent;
    return { x: (m.clientX - rect.left) * scaleX, y: (m.clientY - rect.top) * scaleY };
  };

  // ===== input handlers =====
  const SHAPE_TOOLS: Tool[] = ['line', 'rect', 'circle', 'triangle', 'star', 'arrow', 'polygon'];

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    e.preventDefault();
    const pos = getPos(e);

    // If we click on an overlay, drag it instead of painting
    const hit = hitOverlay(pos);
    if (hit) {
      startOverlayInteraction(e, hit.id, 'move');
      return;
    } else if (selectedOverlayId) {
      setSelectedOverlayId(null);
    }

    if (tool === 'fill') {
      saveState();
      floodFill(Math.floor(pos.x), Math.floor(pos.y));
      return;
    }

    saveState();

    if (SHAPE_TOOLS.includes(tool)) {
      startPos.current = pos;
      isDrawingRef.current = true;
      return;
    }

    lastPos.current = pos;
    isDrawingRef.current = true;
    if (!activeLayer) return;
    const ctx = activeLayer.canvas.getContext('2d')!;
    paintSegment(ctx, pos, { x: pos.x + 0.1, y: pos.y + 0.1 });
    compose();
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current || disabled) return;
    e.preventDefault();
    const pos = getPos(e);

    if (SHAPE_TOOLS.includes(tool)) {
      drawShapePreview(startPos.current, pos);
      return;
    }
    if (!activeLayer) return;
    const ctx = activeLayer.canvas.getContext('2d')!;
    if (lastPos.current) paintSegment(ctx, lastPos.current, pos);
    lastPos.current = pos;
    compose();
  };

  const handleEnd = () => {
    if (!isDrawingRef.current) return;
    if (SHAPE_TOOLS.includes(tool)) commitPreview();
    isDrawingRef.current = false;
    lastPos.current = null;
  };

  // face stamp double-click on canvas
  const [stampTool, setStampTool] = useState<FaceStamp | null>(null);
  const handleClick = (e: React.MouseEvent) => {
    if (!stampTool) return;
    const pos = getPos(e);
    stampFace(stampTool, pos.x, pos.y, brushSize * 6);
  };

  const handleSubmit = () => {
    const canvas = composedRef.current;
    if (!canvas) return;
    // flatten with white background
    const out = document.createElement('canvas');
    out.width = CANVAS_W; out.height = CANVAS_H;
    const octx = out.getContext('2d')!;
    octx.fillStyle = '#FFFFFF';
    octx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    octx.drawImage(canvas, 0, 0);
    onSubmit(out.toDataURL('image/jpeg', 0.92));
  };

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="grid w-full max-w-[1200px] gap-2 md:gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* SIDEBAR */}
        <div className={`game-card space-y-3 p-3 overflow-y-auto ${compact ? 'max-h-[42vh] xl:max-h-[80vh]' : 'max-h-[80vh]'}`}>
          {/* Colors */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm">Színpaletta</span>
              <span className="text-xs text-muted-foreground">{color.toUpperCase()}</span>
            </div>
            <div className="grid grid-cols-8 gap-1">
              {COLORS.map((c) => (
                <button key={c} className={`w-7 h-7 rounded border-2 transition-transform ${c === color ? 'border-foreground scale-110' : 'border-border/40'}`}
                  style={{ backgroundColor: c }} type="button" onClick={() => { setColor(c); playClick(); }} />
              ))}
            </div>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="h-9 w-full mt-2 cursor-pointer rounded-lg border border-border bg-card p-1" />
          </div>

          {/* Width slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-sm">Vonalvastagság</span>
              <span className="text-xs">{brushSize}px</span>
            </div>
            <input type="range" min={1} max={80} value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
          </div>

          {/* Symmetry */}
          <div>
            <div className="font-bold text-sm mb-1">🪞 Szimmetria</div>
            <div className="grid grid-cols-4 gap-1">
              {([
                { id: 'off', label: 'Ki' },
                { id: 'h', label: '↔' },
                { id: 'v', label: '↕' },
                { id: 'both', label: '✚' },
              ] as const).map((o) => (
                <button key={o.id} type="button"
                  className={`text-xs py-2 rounded-lg border-2 font-bold ${symmetry === o.id ? 'border-primary bg-primary/20' : 'border-border bg-card'}`}
                  onClick={() => setSymmetry(o.id as any)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tools */}
          <div>
            <div className="font-bold text-sm mb-1">🧰 Eszközök</div>
            <div className="grid grid-cols-3 gap-1">
              {TOOL_BUTTONS.map((t) => (
                <button key={t.id} type="button"
                  className={`text-xs py-2 px-1 rounded-lg border-2 font-bold ${tool === t.id ? 'border-primary bg-primary/20' : 'border-border bg-card'}`}
                  onClick={() => { setTool(t.id); setStampTool(null); playClick(); }}>
                  {t.icon} <span className="block text-[10px]">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Face stamps */}
          <div>
            <div className="font-bold text-sm mb-1">😀 Arc elemek (kattints a canvasra)</div>
            <div className="grid grid-cols-3 gap-1">
              {FACE_STAMPS.map((s) => (
                <button key={s.id} type="button"
                  className={`text-xs py-2 px-1 rounded-lg border-2 font-bold ${stampTool === s.id ? 'border-accent bg-accent/30' : 'border-border bg-card'}`}
                  onClick={() => { setStampTool(stampTool === s.id ? null : s.id); playClick(); }}>
                  {s.icon} <span className="block text-[10px]">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Templates */}
          <div>
            <div className="font-bold text-sm mb-1">📐 Rajzsablon</div>
            <div className="grid grid-cols-2 gap-1">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="text-xs py-2 rounded-lg border-2 border-border bg-card font-bold"
                  onClick={() => loadTemplate(t.id)}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Layers */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-sm">📚 Rétegek</span>
              <button type="button" className="text-xs py-1 px-2 rounded border-2 border-border bg-card font-bold" onClick={addLayer}>+ Új</button>
            </div>
            {allowImageImport && (
              <label className="block mt-1 mb-2">
                <span className="text-[11px] text-muted-foreground mb-1 block">🖼️ Importálj egy képet új rétegként:</span>
                <input type="file" accept="image/*" onChange={handleImageInput}
                  className="text-xs w-full file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:font-bold cursor-pointer" />
              </label>
            )}
            <div className="space-y-1">
              {[...layers].reverse().map((l) => (
                <div key={l.id} className={`flex items-center gap-1 p-1 rounded border-2 ${activeLayerId === l.id ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}>
                  <button className="text-xs" type="button" onClick={() => toggleLayer(l.id)} title="Láthatóság">
                    {l.visible ? '👁️' : '🚫'}
                  </button>
                  <button type="button" className="flex-1 text-left text-xs font-bold truncate"
                    onClick={() => setActiveLayerId(l.id)}>{l.name}</button>
                  <button type="button" className="text-xs" onClick={() => moveLayer(l.id, 1)}>⬆</button>
                  <button type="button" className="text-xs" onClick={() => moveLayer(l.id, -1)}>⬇</button>
                  <button type="button" className="text-xs" onClick={() => deleteLayer(l.id)} disabled={layers.length <= 1}>🗑️</button>
                </div>
              ))}
            </div>
          </div>

          {/* Overlay objects: text + media import */}
          <div>
            <div className="font-bold text-sm mb-1">🆎 Szöveg / Média</div>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" className="game-btn bg-card text-xs py-2" onClick={addTextOverlay}>🔤 Szöveg</button>
              <label className="game-btn bg-card text-xs py-2 cursor-pointer text-center">
                🖼️/GIF
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) addImageOverlayFromFile(f); e.target.value = ''; }} />
              </label>
              <label className="game-btn bg-card text-xs py-2 cursor-pointer text-center col-span-2">
                🎬 Videó import
                <input type="file" accept="video/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) addVideoOverlayFromFile(f); e.target.value = ''; }} />
              </label>
            </div>
            {selectedOverlayId && (() => {
              const sel = overlays.find((o) => o.id === selectedOverlayId);
              if (!sel) return null;
              return (
                <div className="mt-2 space-y-2 p-2 rounded border-2 border-primary/40 bg-primary/5">
                  <div className="text-[11px] font-bold">Kijelölt: {sel.kind}</div>
                  {sel.kind === 'text' && (
                    <>
                      <textarea value={sel.text || ''} onChange={(e) => updateOverlay(sel.id, { text: e.target.value })}
                        className="w-full text-xs p-1 rounded border border-border bg-card" rows={2} />
                      <div className="flex gap-1 items-center">
                        <input type="color" value={sel.color || '#000'} onChange={(e) => updateOverlay(sel.id, { color: e.target.value })}
                          className="h-7 w-10 rounded border border-border" />
                        <input type="range" min={12} max={240} value={sel.fontSize || 64}
                          onChange={(e) => updateOverlay(sel.id, { fontSize: Number(e.target.value) })} className="flex-1" />
                      </div>
                      <select value={sel.font || 'Impact, sans-serif'} onChange={(e) => updateOverlay(sel.id, { font: e.target.value })}
                        className="w-full text-xs p-1 rounded border border-border bg-card">
                        <option value="Impact, sans-serif">Impact</option>
                        <option value="Arial, sans-serif">Arial</option>
                        <option value="Comic Sans MS, cursive">Comic Sans</option>
                        <option value="Georgia, serif">Georgia</option>
                        <option value="Courier New, monospace">Courier</option>
                      </select>
                    </>
                  )}
                  <button type="button" className="game-btn bg-destructive text-destructive-foreground text-xs py-1 w-full"
                    onClick={() => deleteOverlay(sel.id)}>🗑️ Törlés</button>
                </div>
              );
            })()}
          </div>

          {/* Zoom */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-sm">Zoom</span>
              <span className="text-xs text-primary font-bold">{Math.round(zoom * 100)}%</span>
            </div>
            <input type="range" min={0.5} max={3} step={0.05} value={zoomMul}
              onChange={(e) => setZoomMul(Number(e.target.value))} className="w-full" />
            <button type="button" className="game-btn bg-card text-xs py-1 px-2 mt-1 w-full" onClick={() => setZoomMul(1)}>↺ Igazítás</button>
          </div>
        </div>

        {/* CANVAS */}
        <div className="game-card p-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap text-sm">
            <button className="game-btn bg-card py-1 px-3" onClick={undo} disabled={undoStack.length === 0}>↩️ Vissza (Ctrl+Z)</button>
            <button className="game-btn bg-card py-1 px-3" onClick={redo} disabled={redoStack.length === 0}>↪️ Előre</button>
            <button className="game-btn bg-card py-1 px-3" onClick={clearActive}>🗑️ Réteg törlése</button>
            <div className="flex-1" />
            {!hideSubmit && (
              <button className="game-btn-primary py-1 px-4" onClick={handleSubmit} disabled={disabled}>✅ KÉSZ!</button>
            )}
          </div>

          <div ref={canvasWrapRef} className={`rounded-xl border border-border bg-card/50 flex items-center justify-center ${zoomMul > 1 ? 'overflow-auto' : 'overflow-hidden'} ${compact ? 'max-h-[55vh]' : 'max-h-[65vh]'}`}>
            <div className="p-1 md:p-2">
              <div
                className={`relative overflow-hidden rounded-lg bg-white ${isSecret ? 'blur-md' : ''}`}
                style={{ width: `${DISPLAY_W * zoom}px`, height: `${DISPLAY_H * zoom}px` }}
              >
                <canvas
                  ref={composedRef}
                  width={CANVAS_W}
                  height={CANVAS_H}
                  className="w-full h-full cursor-crosshair touch-none"
                  onMouseDown={handleStart}
                  onMouseMove={handleMove}
                  onMouseUp={handleEnd}
                  onMouseLeave={handleEnd}
                  onTouchStart={handleStart}
                  onTouchMove={handleMove}
                  onTouchEnd={handleEnd}
                  onClick={handleClick}
                />
                {/* Overlay handles for selected overlay */}
                {overlays.map((ov) => {
                  const sx = (DISPLAY_W * zoom) / CANVAS_W;
                  const sy = (DISPLAY_H * zoom) / CANVAS_H;
                  const isSel = ov.id === selectedOverlayId;
                  return (
                    <div key={ov.id}
                      style={{
                        position: 'absolute',
                        left: ov.x * sx,
                        top: ov.y * sy,
                        width: ov.w * sx,
                        height: ov.h * sy,
                        transform: `rotate(${ov.rot}rad)`,
                        transformOrigin: 'center center',
                        border: isSel ? '2px dashed hsl(var(--primary))' : '1px dashed transparent',
                        pointerEvents: 'none',
                      }}
                    >
                      {isSel && (
                        <>
                          {/* scale handle bottom-right */}
                          <div onMouseDown={(e) => startOverlayInteraction(e, ov.id, 'scale')}
                            onTouchStart={(e) => startOverlayInteraction(e, ov.id, 'scale')}
                            style={{ position: 'absolute', right: -8, bottom: -8, width: 16, height: 16, background: 'hsl(var(--primary))', cursor: 'nwse-resize', pointerEvents: 'auto', borderRadius: 4 }} />
                          {/* rotate handle top */}
                          <div onMouseDown={(e) => startOverlayInteraction(e, ov.id, 'rotate')}
                            onTouchStart={(e) => startOverlayInteraction(e, ov.id, 'rotate')}
                            style={{ position: 'absolute', left: '50%', top: -28, width: 18, height: 18, background: 'hsl(var(--accent))', cursor: 'grab', pointerEvents: 'auto', borderRadius: '50%', transform: 'translateX(-50%)' }} />
                        </>
                      )}
                    </div>
                  );
                })}
                {darknessOverlay && darknessOverlay > 0 && (
                  <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: darknessOverlay, pointerEvents: 'none', borderRadius: 8 }} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}