import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings } from '@/lib/gameTypes';
import { getAvatarDisplay } from '@/lib/avatars';
import { playNotification, playPop } from '@/lib/sounds';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

type WormState = {
  pid: string;
  username: string;
  avatar: string;
  x: number;
  y: number;
  angle: number;
  length: number;
  segments: { x: number; y: number }[];
  color: string;
  alive: boolean;
  score: number;
};

type Food = { id: number; x: number; y: number; v: number };

const WORLD = 2000;
const SPEED = 2.6;
const TURN = 0.09;
const SEG_SPACING = 8;
const PLAYER_COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#118ab2', '#7c3aed', '#f97316', '#22d3ee', '#e11d48', '#84cc16', '#ec4899', '#f59e0b', '#0ea5e9', '#a855f7', '#10b981'];

export default function SlitherGameView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const duration = Math.max(60, Math.min(300, settings.slitherDuration ?? 120));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const channelRef = useRef<any>(null);
  const wormsRef = useRef<Map<string, WormState>>(new Map());
  const foodsRef = useRef<Map<number, Food>>(new Map());
  const targetAngleRef = useRef(0);
  const avatarImgRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastBroadcastRef = useRef(0);
  const startedAtRef = useRef(Date.now());
  const [phase, setPhase] = useState<'play' | 'end'>('play');
  const [timeLeft, setTimeLeft] = useState(duration);
  const [, force] = useState(0);
  const rerender = () => force((v) => v + 1);

  // init worm + load avatar images
  useEffect(() => {
    players.forEach((p, i) => {
      const angle = Math.random() * Math.PI * 2;
      const w: WormState = {
        pid: p.player_id,
        username: p.username,
        avatar: p.avatar,
        x: WORLD / 2 + Math.cos(angle) * 200,
        y: WORLD / 2 + Math.sin(angle) * 200,
        angle,
        length: 30,
        segments: [],
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        alive: true,
        score: 0,
      };
      wormsRef.current.set(p.player_id, w);
      const av = getAvatarDisplay(p.avatar);
      if (av.src) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = av.src;
        avatarImgRef.current.set(p.player_id, img);
      }
    });
    // food
    if (isHost) {
      for (let i = 0; i < 200; i++) spawnFood(i);
      broadcastFoods();
    }
    startedAtRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function spawnFood(id: number) {
    foodsRef.current.set(id, {
      id,
      x: 50 + Math.random() * (WORLD - 100),
      y: 50 + Math.random() * (WORLD - 100),
      v: 1 + Math.floor(Math.random() * 3),
    });
  }

  function broadcastFoods() {
    const arr = Array.from(foodsRef.current.values());
    channelRef.current?.send({ type: 'broadcast', event: 'slither:foods', payload: arr });
  }

  // channel
  useEffect(() => {
    const ch = supabase.channel(`slither-${code}`);
    ch.on('broadcast', { event: 'slither:worm' }, ({ payload }) => {
      const w: WormState = payload;
      if (w.pid === playerId) return;
      const existing = wormsRef.current.get(w.pid);
      if (existing) {
        existing.x = w.x; existing.y = w.y; existing.angle = w.angle;
        existing.length = w.length; existing.segments = w.segments; existing.alive = w.alive;
        existing.score = w.score;
      } else {
        wormsRef.current.set(w.pid, w);
      }
    });
    ch.on('broadcast', { event: 'slither:foods' }, ({ payload }) => {
      foodsRef.current.clear();
      (payload as Food[]).forEach((f) => foodsRef.current.set(f.id, f));
    });
    ch.on('broadcast', { event: 'slither:food:eaten' }, ({ payload }) => {
      foodsRef.current.delete(payload.id);
      if (isHost) {
        spawnFood(payload.id);
        // re-broadcast new food only
        setTimeout(() => {
          channelRef.current?.send({ type: 'broadcast', event: 'slither:food:new', payload: foodsRef.current.get(payload.id) });
        }, 50);
      }
    });
    ch.on('broadcast', { event: 'slither:food:new' }, ({ payload }) => {
      if (payload) foodsRef.current.set(payload.id, payload);
    });
    ch.on('broadcast', { event: 'slither:hello' }, ({ payload }) => {
      // Host re-broadcasts full food set to newcomers
      if (isHost && payload?.pid !== playerId) {
        broadcastFoods();
      }
    });
    ch.on('broadcast', { event: 'slither:end' }, ({ payload }) => {
      players.forEach((p) => {
        const w = wormsRef.current.get(p.player_id);
        if (w) w.score = payload.scores[p.player_id] || w.score;
      });
      setPhase('end');
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Non-host requests the current food set; host re-broadcasts to ensure everyone sees them
        if (!isHost) {
          ch.send({ type: 'broadcast', event: 'slither:hello', payload: { pid: playerId } });
        } else {
          // Host broadcasts foods once subscribed so late joiners get them
          setTimeout(() => broadcastFoods(), 200);
        }
      }
    });
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // input
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const c = canvasRef.current; if (!c) return;
      const rect = c.getBoundingClientRect();
      const isTouch = 'touches' in e;
      const px = isTouch ? (e as TouchEvent).touches[0]?.clientX : (e as MouseEvent).clientX;
      const py = isTouch ? (e as TouchEvent).touches[0]?.clientY : (e as MouseEvent).clientY;
      if (px == null) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      targetAngleRef.current = Math.atan2(py - cy, px - cx);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('touchmove', onMove); };
  }, []);

  // game loop
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const me = wormsRef.current.get(playerId);
      if (me && me.alive) {
        // turn toward target
        let d = targetAngleRef.current - me.angle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        me.angle += Math.max(-TURN, Math.min(TURN, d));
        me.x += Math.cos(me.angle) * SPEED;
        me.y += Math.sin(me.angle) * SPEED;
        // wall bounce -> die
        if (me.x < 10 || me.x > WORLD - 10 || me.y < 10 || me.y > WORLD - 10) {
          me.alive = false;
          playPop();
        }
        // build segments
        me.segments.unshift({ x: me.x, y: me.y });
        const maxLen = Math.floor(me.length);
        if (me.segments.length > maxLen * (SEG_SPACING / 2)) me.segments.length = maxLen * (SEG_SPACING / 2);
        // eat food
        foodsRef.current.forEach((f) => {
          const dx = f.x - me.x, dy = f.y - me.y;
          if (dx * dx + dy * dy < 250) {
            me.length += f.v;
            me.score += f.v;
            channelRef.current?.send({ type: 'broadcast', event: 'slither:food:eaten', payload: { id: f.id } });
            foodsRef.current.delete(f.id);
            playPop();
          }
        });
        // collide with other worms' bodies
        wormsRef.current.forEach((other) => {
          if (other.pid === playerId || !other.alive) return;
          for (const seg of other.segments) {
            const dx = seg.x - me.x, dy = seg.y - me.y;
            if (dx * dx + dy * dy < 180) {
              me.alive = false;
              // drop food where I died
              if (isHost) {
                const baseId = Date.now() % 1000000;
                for (let i = 0; i < Math.min(20, Math.floor(me.length / 3)); i++) {
                  const id = baseId + i;
                  foodsRef.current.set(id, {
                    id, x: me.x + (Math.random() - 0.5) * 80, y: me.y + (Math.random() - 0.5) * 80, v: 2,
                  });
                }
                broadcastFoods();
              }
              return;
            }
          }
        });
        // broadcast my state ~12hz
        const now = Date.now();
        if (now - lastBroadcastRef.current > 85) {
          lastBroadcastRef.current = now;
          channelRef.current?.send({ type: 'broadcast', event: 'slither:worm', payload: me });
        }
      }
      // Respawn dead worm after 3s
      if (me && !me.alive) {
        const since = (me as any)._diedAt as number | undefined;
        if (!since) {
          (me as any)._diedAt = Date.now();
        } else if (Date.now() - since > 3000) {
          const angle = Math.random() * Math.PI * 2;
          me.x = WORLD / 2 + Math.cos(angle) * 200;
          me.y = WORLD / 2 + Math.sin(angle) * 200;
          me.angle = angle;
          me.length = 30;
          me.segments = [];
          me.alive = true;
          (me as any)._diedAt = undefined;
          playNotification();
          channelRef.current?.send({ type: 'broadcast', event: 'slither:worm', payload: me });
        }
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  function draw() {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const W = c.width = c.clientWidth;
    const H = c.height = c.clientHeight;
    const me = wormsRef.current.get(playerId);
    const camX = me ? me.x : WORLD / 2;
    const camY = me ? me.y : WORLD / 2;
    const zoom = me ? Math.max(0.55, 1 - me.length / 400) : 1;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    // grid
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    const gs = 100;
    for (let x = 0; x < WORLD; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD); ctx.stroke(); }
    for (let y = 0; y < WORLD; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD, y); ctx.stroke(); }
    // border
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, WORLD, WORLD);
    // food
    foodsRef.current.forEach((f) => {
      ctx.fillStyle = `hsl(${(f.id * 47) % 360}, 80%, 60%)`;
      ctx.beginPath(); ctx.arc(f.x, f.y, 3 + f.v, 0, Math.PI * 2); ctx.fill();
    });
    // worms
    wormsRef.current.forEach((w) => {
      if (!w.alive) return;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(w.x, w.y);
      for (let i = 0; i < w.segments.length; i += SEG_SPACING) {
        ctx.lineTo(w.segments[i].x, w.segments[i].y);
      }
      ctx.stroke();
      // head: avatar circle
      const img = avatarImgRef.current.get(w.pid);
      ctx.save();
      ctx.beginPath();
      ctx.arc(w.x, w.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = w.color;
      ctx.fill();
      ctx.clip();
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, w.x - 14, w.y - 14, 28, 28);
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(w.username[0]?.toUpperCase() || '?', w.x, w.y);
      }
      ctx.restore();
      // name
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.username, w.x, w.y - 22);
    });
    ctx.restore();
  }

  // timer
  useEffect(() => {
    const t = setInterval(() => {
      const left = Math.max(0, duration - Math.floor((Date.now() - startedAtRef.current) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(t);
        if (isHost) {
          const scores: Record<string, number> = {};
          wormsRef.current.forEach((w) => { scores[w.pid] = w.score; });
          channelRef.current?.send({ type: 'broadcast', event: 'slither:end', payload: { scores } });
          setPhase('end');
        }
      }
      rerender();
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    return players.map((p) => {
      const w = wormsRef.current.get(p.player_id);
      return { ...p, score: w?.score || 0, alive: w?.alive ?? false };
    }).sort((a, b) => b.score - a.score);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, timeLeft]);

  const me = wormsRef.current.get(playerId);

  if (phase === 'end') {
    return (
      <div className="max-w-xl mx-auto p-4 space-y-4 text-center animate-zoom-in">
        <div className="text-6xl">🏆</div>
        <h2 className="text-3xl font-bold">Kukac vége!</h2>
        <div className="game-card ios-glass text-left">
          {sorted.map((p, i) => (
            <div key={p.player_id} className="flex justify-between border-b border-border/40 py-1">
              <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {p.username}</span>
              <span className="font-bold text-primary">{p.score} pt</span>
            </div>
          ))}
        </div>
        {isHost && <button className="game-btn-primary w-full" onClick={onFinish}>Vissza a lobbyba</button>}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-40">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-crosshair" />
      <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between pointer-events-none">
        <div className="ios-glass rounded-xl px-3 py-1.5 text-sm font-bold pointer-events-auto">
          🐍 Méret: {Math.floor(me?.length || 0)}
        </div>
        <div className={`ios-glass rounded-xl px-3 py-1.5 text-base font-bold ${timeLeft <= 10 ? 'text-destructive animate-pulse' : ''}`}>
          ⏱️ {timeLeft}mp
        </div>
      </div>
      <div className="absolute top-14 left-2 z-10 ios-glass rounded-xl p-2 text-xs space-y-0.5 max-w-[180px]">
        <div className="font-bold mb-1">🏆 Toplista</div>
        {sorted.slice(0, 8).map((p, i) => (
          <div key={p.player_id} className={`flex items-center gap-1 ${p.player_id === playerId ? 'text-primary font-bold' : ''}`}>
            <span>{i + 1}.</span>
            <span className="flex-1 truncate">{p.username} {!p.alive && '💀'}</span>
            <span className="font-bold">{p.score}</span>
          </div>
        ))}
      </div>
      {me && !me.alive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="ios-glass rounded-2xl px-6 py-4 text-center">
            <div className="text-5xl">💀</div>
            <div className="font-bold mt-2">Meghaltál!</div>
            <div className="text-xs text-muted-foreground">3mp múlva újraéledsz...</div>
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2 ios-glass rounded-xl px-3 py-1.5 text-center text-xs pointer-events-none">
        🖱️ Mozgasd az egeret az irányításhoz · ne menj a falba, ne ütközz másokba!
      </div>
    </div>
  );
}