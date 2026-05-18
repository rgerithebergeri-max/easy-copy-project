import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings } from '@/lib/gameTypes';
import { pickScribbleWord } from '@/lib/scribbleWords';
import DrawingCanvas from './DrawingCanvas';
import { playClick, playPop, playNotification } from '@/lib/sounds';
import { getAvatarDisplay } from '@/lib/avatars';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

type Msg = { id: string; pid: string; name: string; text: string; correct: boolean; t: number; points?: number };
type Round = { drawerId: string; word: string; startAt: number; deadlineAt: number; idx: number; usedWords: string[] };
type FloatingReaction = { id: string; pid: string; emoji: string; t: number };
const REACTIONS = ['❤️', '😂', '😮', '🔥', '👏', '💩', '🎉', '🤔'];

function maskWord(w: string) {
  return w.split('').map((c) => (c === ' ' ? ' ' : '_')).join('');
}

function mergeScores(current: Record<string, number>, pid: string, points: number) {
  return { ...current, [pid]: Math.max(current[pid] || 0, (current[pid] || 0) + points) };
}

export default function ScribbleGameView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const rounds = settings.scribbleRounds ?? 3;
  const drawTime = settings.scribbleDrawTime ?? 60;
  const channelRef = useRef<any>(null);
  const endedRef = useRef(false);
  const scoresRef = useRef<Record<string, number>>({});
  const roundIdxRef = useRef(0);
  const solvedRef = useRef<Set<string>>(new Set());
  const usedWordsRef = useRef<Set<string>>(new Set());

  const [roundIdx, setRoundIdx] = useState(0);
  const [round, setRound] = useState<Round | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Msg[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [phase, setPhase] = useState<'wait' | 'play' | 'reveal' | 'end'>('wait');
  const [guess, setGuess] = useState('');
  const [liveDrawing, setLiveDrawing] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string>('');
  const [floats, setFloats] = useState<FloatingReaction[]>([]);

  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { roundIdxRef.current = roundIdx; }, [roundIdx]);
  useEffect(() => { solvedRef.current = solved; }, [solved]);

  const totalRounds = rounds * players.length;
  const currentDrawerId = useMemo(
    () => round?.drawerId ?? players[roundIdx % players.length]?.player_id,
    [round, roundIdx, players],
  );
  const isDrawer = currentDrawerId === playerId;

  function startRound(idx: number) {
    endedRef.current = false;
    const drawer = players[idx % players.length];
    const word = pickScribbleWord(settings.scribbleCustomWords, usedWordsRef.current);
    usedWordsRef.current.add(word.toLowerCase());
    const r: Round = {
      drawerId: drawer.player_id,
      word,
      startAt: Date.now(),
      deadlineAt: Date.now() + drawTime * 1000,
      idx,
      usedWords: Array.from(usedWordsRef.current),
    };
    setRoundIdx(idx);
    setRound(r);
    setRevealed(maskWord(r.word));
    setLiveDrawing(null);
    solvedRef.current = new Set();
    setSolved(new Set());
    setMessages([]);
    setPhase('play');
    channelRef.current?.send({ type: 'broadcast', event: 'round:start', payload: r });
  }

  function scheduleNext(nextIdx: number) {
    setTimeout(() => {
      if (nextIdx >= totalRounds) {
        setPhase('end');
        channelRef.current?.send({ type: 'broadcast', event: 'game:end', payload: { scores: scoresRef.current } });
      } else if (isHost) startRound(nextIdx);
    }, 3500);
  }

  function endRound() {
    if (endedRef.current) return;
    endedRef.current = true;
    const nextIdx = roundIdxRef.current + 1;
    const sc = scoresRef.current;
    channelRef.current?.send({ type: 'broadcast', event: 'round:end', payload: { scores: sc, nextIdx } });
    setPhase('reveal');
    scheduleNext(nextIdx);
  }

  useEffect(() => {
    const ch = supabase.channel(`scribble-${code}`);
    ch.on('broadcast', { event: 'round:start' }, ({ payload }) => {
      endedRef.current = false;
      setRound(payload);
      setRoundIdx(payload.idx);
      setRevealed(maskWord(payload.word));
      setSolved(new Set());
      setMessages([]);
      setLiveDrawing(null);
      setPhase('play');
      if (Array.isArray(payload.usedWords)) {
        usedWordsRef.current = new Set(payload.usedWords);
      }
      playNotification();
    });
    ch.on('broadcast', { event: 'guess' }, ({ payload }) => {
      setMessages((m) => [...m, payload].slice(-80));
      if (payload.correct) {
        solvedRef.current = new Set([...Array.from(solvedRef.current), payload.pid]);
        setSolved(new Set(solvedRef.current));
        setScores((sc) => mergeScores(sc, payload.pid, payload.points || 0));
        playPop();
        // host: end early if everyone (except drawer) solved
        if (isHost) {
          setTimeout(() => {
            const drawer = roundIdxRef.current;
            const r = round;
            const drawerId = players[drawer % players.length]?.player_id;
            const guessers = players.filter((p) => p.player_id !== drawerId).length;
            if (solvedRef.current.size >= guessers) endRound();
          }, 500);
        }
      }
    });
    ch.on('broadcast', { event: 'live:draw' }, ({ payload }) => {
      if (payload.drawerId !== playerId) setLiveDrawing(payload.dataUrl);
    });
    ch.on('broadcast', { event: 'reaction' }, ({ payload }) => {
      const f: FloatingReaction = { id: crypto.randomUUID(), pid: payload.pid, emoji: payload.emoji, t: Date.now() };
      setFloats((all) => [...all, f]);
      setTimeout(() => setFloats((all) => all.filter((x) => x.id !== f.id)), 2500);
      playPop();
    });
    ch.on('broadcast', { event: 'reveal' }, ({ payload }) => {
      setRevealed(payload.mask);
    });
    ch.on('broadcast', { event: 'round:end' }, ({ payload }) => {
      setPhase('reveal');
      setScores(payload.scores || {});
      scheduleNext(payload.nextIdx);
    });
    ch.on('broadcast', { event: 'game:end' }, ({ payload }) => {
      setScores(payload.scores || scoresRef.current);
      setPhase('end');
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED' && isHost) {
        setTimeout(() => startRound(0), 700);
      }
    });
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // play-phase timer
  useEffect(() => {
    if (phase !== 'play' || !round) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((round.deadlineAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(t);
        if (isHost) endRound();
      }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  // host: progressive letter reveal
  useEffect(() => {
    if (!isHost || phase !== 'play' || !round) return;
    const word = round.word;
    const letterIdx = word.split('').map((_, i) => i).filter((i) => word[i] !== ' ');
    const total = drawTime;
    const timers: any[] = [];
    [
      { atSecondsIn: Math.round(total * 0.5), pct: 0.25 },
      { atSecondsIn: Math.round(total * 0.75), pct: 0.5 },
    ].forEach(({ atSecondsIn, pct }) => {
      timers.push(setTimeout(() => {
        if (endedRef.current) return;
        const take = Math.max(1, Math.floor(letterIdx.length * pct));
        const shuffled = letterIdx.slice().sort(() => Math.random() - 0.5).slice(0, take);
        const mask = word.split('').map((c, i) => (shuffled.includes(i) || c === ' ' ? c : '_')).join('');
        setRevealed(mask);
        channelRef.current?.send({ type: 'broadcast', event: 'reveal', payload: { mask } });
      }, atSecondsIn * 1000));
    });
    return () => timers.forEach(clearTimeout);
  }, [phase, round, drawTime, isHost]);

  const handleLiveDraw = (dataUrl: string) => {
    if (!isDrawer) return;
    channelRef.current?.send({ type: 'broadcast', event: 'live:draw', payload: { drawerId: playerId, dataUrl } });
  };

  function submitGuess() {
    if (!guess.trim() || !round || isDrawer || solved.has(playerId)) return;
    const text = guess.trim();
    const ok = text.toLowerCase() === round.word.toLowerCase();
    const points = ok ? Math.max(20, Math.round(timeLeft * 2)) : 0;
    const payload: Msg = {
      id: crypto.randomUUID(), pid: playerId, name: username,
      text: ok ? '✅ kitalálta!' : text,
      correct: ok, t: Date.now(), points,
    };
    channelRef.current?.send({ type: 'broadcast', event: 'guess', payload });
    setMessages((m) => [...m, payload].slice(-80));
    if (ok) {
      solvedRef.current = new Set([...Array.from(solvedRef.current), playerId]);
      setSolved(new Set(solvedRef.current));
      setScores((sc) => mergeScores(sc, playerId, points));
      playPop();
      if (isHost) {
        setTimeout(() => {
          const drawerId = players[roundIdxRef.current % players.length]?.player_id;
          const guessers = players.filter((p) => p.player_id !== drawerId).length;
          if (solvedRef.current.size >= guessers) endRound();
        }, 500);
      }
    }
    setGuess('');
    playClick();
  }

  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  const sendReaction = (emoji: string) => {
    const payload = { pid: playerId, emoji };
    channelRef.current?.send({ type: 'broadcast', event: 'reaction', payload });
    const f: FloatingReaction = { id: crypto.randomUUID(), pid: playerId, emoji, t: Date.now() };
    setFloats((all) => [...all, f]);
    setTimeout(() => setFloats((all) => all.filter((x) => x.id !== f.id)), 2500);
    playPop();
  };

  if (phase === 'end') {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <h2 className="text-3xl font-bold text-center">🏁 Scribble eredmények</h2>
        <div className="game-card space-y-2">
          {sortedScores.length === 0 && <p className="text-center text-muted-foreground">Nincs pontszám.</p>}
          {sortedScores.map(([pid, sc], i) => {
            const p = players.find((x) => x.player_id === pid);
            return (
              <div key={pid} className="flex items-center gap-3 player-slot">
                <span className="text-2xl font-bold w-8">{i + 1}.</span>
                <span className="font-bold flex-1">{p?.username || 'Ismeretlen'}</span>
                <span className="font-bold text-primary">{sc} pt</span>
              </div>
            );
          })}
        </div>
        {isHost && <button className="game-btn-primary w-full" onClick={onFinish}>Vissza a lobbyba</button>}
      </div>
    );
  }

  const drawer = players.find((p) => p.player_id === currentDrawerId);

  return (
    <div className="max-w-[1700px] mx-auto p-2 md:p-3 grid xl:grid-cols-[260px_minmax(0,1fr)_340px] gap-3">
      {/* Left: player list + reactions */}
      <div className="game-card ios-glass space-y-2 h-[55vh] xl:h-[75vh] min-h-[360px] flex flex-col">
        <div className="font-bold text-sm">👥 Játékosok</div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {players.map((p) => {
            const av = getAvatarDisplay(p.avatar);
            const sc = scores[p.player_id] || 0;
            const isDrawerNow = currentDrawerId === p.player_id;
            const hasSolved = solved.has(p.player_id);
            const floating = floats.find((f) => f.pid === p.player_id);
            return (
              <div key={p.player_id} className={`relative flex items-center gap-2 p-1.5 rounded-lg ${isDrawerNow ? 'bg-primary/20 border border-primary' : 'bg-card/60'}`}>
                {av.src ? (
                  <img src={av.src} alt="" className="w-8 h-8 rounded-lg object-cover" />
                ) : (
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center text-lg bg-card">{av.emoji}</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate flex items-center gap-1">
                    {p.username}
                    {isDrawerNow && <span title="rajzol">✏️</span>}
                    {hasSolved && <span title="kitalálta">✅</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{sc} pt</div>
                </div>
                {floating && (
                  <span key={floating.id} className="absolute -top-2 right-1 text-2xl animate-bounce pointer-events-none">{floating.emoji}</span>
                )}
              </div>
            );
          })}
        </div>
        <div>
          <div className="text-[10px] font-bold mb-1 text-muted-foreground">REAKCIÓ KÜLDÉSE</div>
          <div className="grid grid-cols-4 gap-1">
            {REACTIONS.map((e) => (
              <button key={e} type="button" onClick={() => sendReaction(e)}
                className="text-xl py-1 rounded-lg bg-card hover:bg-primary/20 active:scale-95 transition">{e}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="game-card py-2 px-3 md:px-4 grid grid-cols-3 items-center gap-2 text-center">
          <div className="font-bold text-sm">Kör {roundIdx + 1}/{totalRounds}</div>
          <div className="font-bold text-sm">✏️ {drawer?.username || '...'}</div>
          <div className={`font-bold text-xl ${timeLeft <= 10 ? 'text-destructive animate-pulse' : ''}`}>⏱️ {timeLeft}mp</div>
        </div>

        {isDrawer && phase === 'play' && round && (
          <>
            <div className="game-card text-center py-2">
              <p className="text-xs text-muted-foreground">A te szavad:</p>
              <p className="text-3xl font-bold">{round.word}</p>
            </div>
            <DrawingCanvas onSubmit={() => {}} hideSubmit onChange={handleLiveDraw} compact />
          </>
        )}

        {!isDrawer && phase === 'play' && (
          <>
            <div className="game-card text-center py-3">
              <p className="text-xs text-muted-foreground">A szó:</p>
              <p className="text-2xl md:text-3xl font-mono font-bold tracking-[0.18em] md:tracking-[0.4em] break-words">{revealed || '_ _ _'}</p>
            </div>
            <div className="game-card p-2">
              <div className="rounded-xl overflow-hidden bg-white" style={{ aspectRatio: '16/10' }}>
                {liveDrawing ? (
                  <img src={liveDrawing} alt="" className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">A rajzoló kezd...</div>
                )}
              </div>
            </div>
          </>
        )}

        {phase === 'reveal' && round && (
          <div className="game-card text-center py-6">
            <p className="text-sm text-muted-foreground">A szó volt:</p>
            <p className="text-4xl font-bold">{round.word}</p>
            <p className="text-muted-foreground mt-2">Következő kör...</p>
          </div>
        )}
      </div>

      <div className="game-card flex flex-col h-[55vh] xl:h-[75vh] min-h-[360px]">
        <div className="font-bold text-sm mb-2">💬 Tippek</div>
        <div className="flex-1 overflow-y-auto space-y-1 text-sm">
          {messages.map((m) => (
            <div key={m.id} className={`px-2 py-1 rounded ${m.correct ? 'bg-primary/20 font-bold' : 'bg-card'}`}>
              <span className="font-bold">{m.name}:</span> {m.text}
            </div>
          ))}
        </div>
        {!isDrawer && phase === 'play' && !solved.has(playerId) && (
          <div className="flex gap-2 mt-2 sticky bottom-0 bg-card pt-2">
            <input value={guess} onChange={(e) => setGuess(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitGuess()}
              className="game-input flex-1" placeholder="Tipp..." autoFocus />
            <button className="game-btn-primary px-3" onClick={submitGuess}>OK</button>
          </div>
        )}
        <div className="mt-3 border-t-2 border-border pt-2">
          <div className="text-xs font-bold mb-1">🏆 Eredmény</div>
          {sortedScores.slice(0, 8).map(([pid, sc]) => {
            const p = players.find((x) => x.player_id === pid);
            return (
              <div key={pid} className="flex justify-between text-xs">
                <span>{p?.username || '...'}</span>
                <span className="font-bold">{sc}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
