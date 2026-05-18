import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings } from '@/lib/gameTypes';
import DrawingCanvas from './DrawingCanvas';
import { playClick, playWhoosh, playApplause, fireConfetti } from '@/lib/sounds';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

export default function AnimationGameView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const totalFrames = settings.animFrames ?? 6;
  const frameTime = settings.animFrameTime ?? 30;
  const channelRef = useRef<any>(null);
  const submittedRef = useRef<Set<string>>(new Set());
  const animsRef = useRef<Record<string, string[]>>({});

  const [phase, setPhase] = useState<'draw' | 'show' | 'end'>('draw');
  const [frameIdx, setFrameIdx] = useState(0);
  const [myFrames, setMyFrames] = useState<string[]>([]);
  const [allAnims, setAllAnims] = useState<Record<string, string[]>>({});
  const [timeLeft, setTimeLeft] = useState(frameTime);
  const [deadline, setDeadline] = useState(Date.now() + frameTime * 1000);
  const [showingIdx, setShowingIdx] = useState(0);
  const [playFrame, setPlayFrame] = useState(0);

  useEffect(() => { animsRef.current = allAnims; }, [allAnims]);

  function tryStartShow() {
    if (!isHost) return;
    if (submittedRef.current.size >= players.length) {
      const anims = { ...animsRef.current };
      channelRef.current?.send({ type: 'broadcast', event: 'show:start', payload: { anims } });
      setAllAnims(anims); setPhase('show'); setShowingIdx(0); setPlayFrame(0);
    }
  }

  useEffect(() => {
    const ch = supabase.channel(`anim-${code}`);
    ch.on('broadcast', { event: 'anim:submit' }, ({ payload }) => {
      submittedRef.current.add(payload.playerId);
      const updated = { ...animsRef.current, [payload.playerId]: payload.frames };
      animsRef.current = updated;
      setAllAnims(updated);
      tryStartShow();
    });
    ch.on('broadcast', { event: 'show:start' }, ({ payload }) => {
      setAllAnims(payload.anims); setPhase('show'); setShowingIdx(0); setPlayFrame(0);
    });
    ch.on('broadcast', { event: 'show:next' }, ({ payload }) => {
      setShowingIdx(payload.idx); setPlayFrame(0);
      if (payload.idx >= Object.keys(animsRef.current).length) setPhase('end');
    });
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED' && isHost) {
        const d = Date.now() + frameTime * 1000;
        setDeadline(d);
      }
    });
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // local frame timer (auto-advance own drawing)
  useEffect(() => {
    if (phase !== 'draw') return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(left);
    }, 250);
    return () => clearInterval(t);
  }, [phase, deadline]);

  // playback ticker
  useEffect(() => {
    if (phase !== 'show') return;
    const t = setInterval(() => setPlayFrame((f) => f + 1), 250);
    return () => clearInterval(t);
  }, [phase, showingIdx]);

  function submitFrame(dataUrl: string) {
    const newFrames = [...myFrames, dataUrl];
    setMyFrames(newFrames);
    playClick();
    if (newFrames.length >= totalFrames) {
      // submit full animation
      submittedRef.current.add(playerId);
      const updated = { ...animsRef.current, [playerId]: newFrames };
      animsRef.current = updated;
      setAllAnims(updated);
      channelRef.current?.send({ type: 'broadcast', event: 'anim:submit', payload: { playerId, frames: newFrames } });
      if (isHost) tryStartShow();
    } else {
      // advance my own frame
      setFrameIdx(newFrames.length);
      setDeadline(Date.now() + frameTime * 1000);
    }
  }

  function advanceShow() {
    if (!isHost) return;
    const next = showingIdx + 1;
    channelRef.current?.send({ type: 'broadcast', event: 'show:next', payload: { idx: next } });
    setShowingIdx(next); setPlayFrame(0);
    if (next >= Object.keys(animsRef.current).length) {
      setPhase('end');
      fireConfetti(80);
      playApplause();
    }
  }

  if (phase === 'end') {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-3 animate-zoom-in">
        <h2 className="text-3xl font-bold text-center animate-spring-in">🎬 Animáció vége!</h2>
        {isHost && <button className="game-btn-primary w-full" onClick={onFinish}>Vissza a lobbyba</button>}
      </div>
    );
  }

  if (phase === 'show') {
    const playerIds = Object.keys(allAnims);
    const showingPid = playerIds[showingIdx];
    const frames = allAnims[showingPid] || [];
    const cur = frames[playFrame % Math.max(1, frames.length)];
    const showingPlayer = players.find((p) => p.player_id === showingPid);
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-3">
        <div className="game-card ios-glass text-center font-bold animate-slide-up">🎬 {showingPlayer?.username || '...'} animációja ({showingIdx + 1}/{playerIds.length})</div>
        <div key={showingIdx} className="game-card p-2 bg-white animate-zoom-in" style={{ minHeight: '40vh' }}>
          {cur ? (
            <img src={cur} alt="" className="w-full h-auto rounded-lg block max-h-[70vh] object-contain mx-auto" style={{ background: '#fff' }} />
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground">Betöltés...</div>
          )}
        </div>
        {isHost && (
          <button className="game-btn-primary w-full" onClick={() => { playWhoosh(); advanceShow(); }}>Következő ▶️</button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-2 md:p-4 space-y-3">
      <div className="game-card grid grid-cols-3 gap-2 items-center py-2 px-3 md:px-4 text-center">
        <div className="font-bold">🎬 Képkocka {Math.min(frameIdx + 1, totalFrames)}/{totalFrames}</div>
        <div className="font-bold">{myFrames.length}/{totalFrames} kész</div>
        <div className={`font-bold text-xl ${timeLeft <= 5 ? 'text-destructive animate-pulse' : ''}`}>⏱️ {timeLeft}mp</div>
      </div>
      {myFrames.length >= totalFrames ? (
        <div className="game-card text-center py-8 text-muted-foreground">
          ✅ Készen vagy! Várakozás a többi játékosra... ({submittedRef.current.size}/{players.length})
          {isHost && (
            <div className="mt-3">
              <button className="game-btn bg-card text-xs py-1 px-3" onClick={() => {
                // host force-skip remaining players
                const anims = { ...animsRef.current };
                channelRef.current?.send({ type: 'broadcast', event: 'show:start', payload: { anims } });
                setAllAnims(anims); setPhase('show'); setShowingIdx(0); setPlayFrame(0);
              }}>⏭️ Indítás most</button>
            </div>
          )}
        </div>
      ) : (
        <>
          {myFrames.length > 0 && (
            <div className="game-card p-2 text-center">
              <p className="text-xs text-muted-foreground mb-1">Előző képkocka (átlátszó referencia)</p>
              <img src={myFrames[myFrames.length - 1]} alt="" className="max-h-32 mx-auto opacity-50" />
            </div>
          )}
          <DrawingCanvas onSubmit={submitFrame} compact />
        </>
      )}
      {myFrames.length > 0 && myFrames.length < totalFrames && (
        <div className="game-card">
          <div className="text-xs font-bold mb-1">Eddigi képkockák</div>
          <div className="flex gap-2 overflow-x-auto">
            {myFrames.map((f, i) => <img key={i} src={f} alt="" className="h-16 rounded border border-border" />)}
          </div>
        </div>
      )}
    </div>
  );
}
