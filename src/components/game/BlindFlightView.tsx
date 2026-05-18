import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings } from '@/lib/gameTypes';
import { pickScribbleWord } from '@/lib/scribbleWords';
import DrawingCanvas from './DrawingCanvas';
import { playClick, playNotification } from '@/lib/sounds';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

type Round = { drawerId: string; word: string; deadlineAt: number; idx: number };

export default function BlindFlightView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const rounds = settings.blindRounds ?? 3;
  const drawTime = settings.blindDrawTime ?? 45;
  const darkness = settings.blindDarkness ?? 0.85;
  const channelRef = useRef<any>(null);
  const endedRef = useRef(false);
  const ratedRef = useRef<Set<string>>(new Set());
  const scoresRef = useRef<Record<string, number>>({});

  const [roundIdx, setRoundIdx] = useState(0);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<'play' | 'rate' | 'end'>('play');
  const [drawing, setDrawing] = useState<string | null>(null);
  const [liveDrawing, setLiveDrawing] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [myRating, setMyRating] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(drawTime);

  useEffect(() => { scoresRef.current = scores; }, [scores]);

  const totalRounds = rounds * players.length;
  const currentDrawerId = round?.drawerId ?? players[roundIdx % players.length]?.player_id;
  const isDrawer = currentDrawerId === playerId;

  function startRound(idx: number) {
    endedRef.current = false;
    ratedRef.current = new Set();
    const drawer = players[idx % players.length];
    const r: Round = {
      drawerId: drawer.player_id,
      word: pickScribbleWord(),
      deadlineAt: Date.now() + drawTime * 1000,
      idx,
    };
    setRound(r); setRoundIdx(idx); setPhase('play');
    setDrawing(null); setLiveDrawing(null); setMyRating(null);
    channelRef.current?.send({ type: 'broadcast', event: 'round:start', payload: r });
  }

  function goNext(nextIdx: number) {
    if (nextIdx >= totalRounds) {
      channelRef.current?.send({ type: 'broadcast', event: 'game:end', payload: { scores: scoresRef.current } });
      setPhase('end');
      return;
    }
    if (isHost) startRound(nextIdx);
  }

  function endRoundTimeout() {
    if (endedRef.current || !isDrawer) return;
    // drawer auto-submits whatever they have
    submitDrawing(liveDrawing || '');
  }

  useEffect(() => {
    const ch = supabase.channel(`blind-${code}`);
    ch.on('broadcast', { event: 'round:start' }, ({ payload }) => {
      endedRef.current = false;
      ratedRef.current = new Set();
      setRound(payload); setRoundIdx(payload.idx); setPhase('play');
      setDrawing(null); setLiveDrawing(null); setMyRating(null);
      playNotification();
    });
    ch.on('broadcast', { event: 'live:draw' }, ({ payload }) => {
      if (payload.drawerId !== playerId) setLiveDrawing(payload.dataUrl);
    });
    ch.on('broadcast', { event: 'round:final' }, ({ payload }) => {
      setDrawing(payload.dataUrl); setPhase('rate'); setLiveDrawing(payload.dataUrl);
    });
    ch.on('broadcast', { event: 'rate' }, ({ payload }) => {
      if (ratedRef.current.has(payload.raterId)) return;
      ratedRef.current.add(payload.raterId);
      setScores((sc) => {
        const updated = { ...sc, [payload.drawerId]: (sc[payload.drawerId] || 0) + payload.stars };
        scoresRef.current = updated;
        return updated;
      });
      // host: if all non-drawers rated, advance
      if (isHost) {
        const guessers = players.filter((p) => p.player_id !== payload.drawerId).length;
        if (ratedRef.current.size >= guessers) {
          setTimeout(() => {
            channelRef.current?.send({ type: 'broadcast', event: 'round:next', payload: { idx: payload.idx + 1 } });
            goNext(payload.idx + 1);
          }, 1500);
        }
      }
    });
    ch.on('broadcast', { event: 'round:next' }, ({ payload }) => {
      if (payload.idx >= totalRounds) setPhase('end');
      else if (isHost) startRound(payload.idx);
      else setPhase('play');
    });
    ch.on('broadcast', { event: 'game:end' }, ({ payload }) => {
      setScores(payload.scores || scoresRef.current);
      setPhase('end');
    });
    ch.subscribe((s) => { if (s === 'SUBSCRIBED' && isHost) setTimeout(() => startRound(0), 700); });
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    if (phase !== 'play' || !round) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((round.deadlineAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(t);
        endRoundTimeout();
      }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  function submitDrawing(dataUrl: string) {
    if (endedRef.current) return;
    endedRef.current = true;
    channelRef.current?.send({ type: 'broadcast', event: 'round:final', payload: { dataUrl, drawerId: playerId, word: round?.word, idx: roundIdx } });
    setDrawing(dataUrl); setPhase('rate');
  }

  function handleLiveDraw(dataUrl: string) {
    if (!isDrawer) return;
    setLiveDrawing(dataUrl);
    channelRef.current?.send({ type: 'broadcast', event: 'live:draw', payload: { drawerId: playerId, dataUrl } });
  }

  function rate(stars: number) {
    if (isDrawer || myRating !== null) return;
    setMyRating(stars);
    ratedRef.current.add(playerId);
    setScores((sc) => ({ ...sc, [currentDrawerId]: (sc[currentDrawerId] || 0) + stars }));
    channelRef.current?.send({ type: 'broadcast', event: 'rate', payload: { drawerId: currentDrawerId, stars, raterId: playerId, idx: roundIdx } });
    playClick();
    // host: check end condition
    if (isHost) {
      const guessers = players.filter((p) => p.player_id !== currentDrawerId).length;
      if (ratedRef.current.size >= guessers) {
        setTimeout(() => {
          channelRef.current?.send({ type: 'broadcast', event: 'round:next', payload: { idx: roundIdx + 1 } });
          goNext(roundIdx + 1);
        }, 1500);
      }
    }
  }

  if (phase === 'end') {
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <h2 className="text-3xl font-bold text-center">🌑 Vakrepülés eredmények</h2>
        <div className="game-card space-y-2">
          {sorted.length === 0 && <p className="text-center text-muted-foreground">Nincs pontszám.</p>}
          {sorted.map(([pid, sc], i) => {
            const p = players.find((x) => x.player_id === pid);
            return <div key={pid} className="player-slot"><span className="font-bold w-8">{i + 1}.</span><span className="flex-1 font-bold">{p?.username}</span><span className="text-primary font-bold">⭐ {sc}</span></div>;
          })}
        </div>
        {isHost && <button className="game-btn-primary w-full" onClick={onFinish}>Vissza a lobbyba</button>}
      </div>
    );
  }

  const drawer = players.find((p) => p.player_id === currentDrawerId);

  return (
    <div className="max-w-5xl mx-auto p-3 space-y-3">
      <div className="game-card flex items-center justify-between py-2 px-4">
        <div className="font-bold">Kör {roundIdx + 1}/{totalRounds}</div>
        <div className="font-bold">{drawer?.username} rajzol</div>
        {phase === 'play' && <div className={`font-bold text-xl ${timeLeft <= 10 ? 'text-destructive animate-pulse' : ''}`}>⏱️ {timeLeft}mp</div>}
      </div>

      {phase === 'play' && isDrawer && round && (
        <>
          <div className="game-card text-center py-2">
            <p className="text-sm text-muted-foreground">Rajzold le (sötétben):</p>
            <p className="text-2xl font-bold">{round.word}</p>
          </div>
          <DrawingCanvas onSubmit={submitDrawing} darknessOverlay={darkness} onChange={handleLiveDraw} hideSubmit={false} />
        </>
      )}
      {phase === 'play' && !isDrawer && (
        <div className="space-y-2">
          <div className="game-card text-center py-2 text-muted-foreground">A többiek tisztán látják a rajzot 👀</div>
          <div className="game-card p-2">
            <div className="rounded-xl overflow-hidden bg-white" style={{ aspectRatio: '16/10' }}>
              {liveDrawing ? (
                <img src={liveDrawing} alt="" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">A rajzoló kezd...</div>
              )}
            </div>
          </div>
        </div>
      )}
      {phase === 'rate' && (
        <div className="space-y-3">
          <div className="game-card text-center"><p className="font-bold">A szó: {round?.word}</p></div>
          {drawing && <div className="game-card p-2"><img src={drawing} alt="" className="w-full rounded-lg" /></div>}
          {!isDrawer && (
            <div className="game-card text-center space-y-2">
              <p className="font-bold">Pontozd a rajzot!</p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button key={s} className={`text-3xl transition-all ${myRating !== null && s <= myRating ? '' : 'opacity-30'} ${myRating === null ? 'hover:scale-125' : ''}`}
                    onClick={() => rate(s)} disabled={myRating !== null}>⭐</button>
                ))}
              </div>
              {myRating !== null && <p className="text-xs text-muted-foreground">Pontozva: {myRating}⭐ — várakozás a többiekre...</p>}
            </div>
          )}
          {isDrawer && <div className="game-card text-center text-muted-foreground">Várakozás pontozásra...</div>}
        </div>
      )}
    </div>
  );
}
