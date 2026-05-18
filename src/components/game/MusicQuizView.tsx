import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings } from '@/lib/gameTypes';
import { playClick, playNotification, playPop, playSubmit } from '@/lib/sounds';
import { getAvatarDisplay } from '@/lib/avatars';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

type Track = {
  trackId: number;
  trackName: string;
  artistName: string;
  previewUrl: string;
  artworkUrl100?: string;
};

type RoundData = {
  idx: number;
  preview: string;
  options: { id: number; label: string }[];
  correctId: number;
  deadline: number;
  artwork?: string;
};

type Phase = 'loading' | 'play' | 'reveal' | 'end';

const GENRES: Record<string, string[]> = {
  pop: ['taylor swift', 'dua lipa', 'ed sheeran', 'billie eilish', 'the weeknd', 'ariana grande', 'harry styles', 'olivia rodrigo', 'bruno mars', 'shawn mendes'],
  rock: ['queen', 'imagine dragons', 'coldplay', 'foo fighters', 'muse', 'linkin park', 'green day', 'arctic monkeys', 'nirvana', 'metallica'],
  hungarian: ['halott pénz', 'wellhello', 'punnany massif', 'majka', 'tankcsapda', 'follow the flow', 'azahriah', 'krúbi', 'desh', 'beton.hofi'],
  rap: ['drake', 'kendrick lamar', 'eminem', 'travis scott', 'post malone', 'j cole', 'lil baby', 'kanye west', 'tyler the creator', '21 savage'],
  classic: ['michael jackson', 'abba', 'queen', 'elvis presley', 'beatles', 'madonna', 'bee gees', 'fleetwood mac', 'phil collins', 'whitney houston'],
};

async function fetchTracks(genre: string, count: number): Promise<Track[]> {
  const artists = (GENRES[genre] || GENRES.pop).slice().sort(() => Math.random() - 0.5);
  const results: Track[] = [];
  const seen = new Set<number>();
  for (const a of artists) {
    if (results.length >= count + 12) break;
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(a)}&media=music&entity=song&limit=8`);
      const j = await r.json();
      for (const t of j.results || []) {
        if (!t.previewUrl || seen.has(t.trackId)) continue;
        seen.add(t.trackId);
        results.push({
          trackId: t.trackId,
          trackName: t.trackName,
          artistName: t.artistName,
          previewUrl: t.previewUrl,
          artworkUrl100: t.artworkUrl100,
        });
      }
    } catch (e) { console.warn(e); }
  }
  return results.sort(() => Math.random() - 0.5);
}

export default function MusicQuizView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const totalRounds = Math.max(3, Math.min(20, settings.musicRounds ?? 8));
  const channelRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [pool, setPool] = useState<Track[]>([]);
  const [round, setRound] = useState<RoundData | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [scores, setScores] = useState<Record<string, number>>({});
  const scoresRef = useRef<Record<string, number>>({});
  const [answered, setAnswered] = useState<Record<string, { id: number; t: number }>>({});
  const [myPick, setMyPick] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(20);
  const [volume, setVolume] = useState(0.7);

  useEffect(() => { scoresRef.current = scores; }, [scores]);

  useEffect(() => {
    if (!isHost) return;
    fetchTracks(settings.musicGenre || 'pop', totalRounds).then((tracks) => {
      if (tracks.length < totalRounds + 4) {
        console.warn('Few tracks loaded:', tracks.length);
      }
      setPool(tracks);
    });
  }, [isHost, settings.musicGenre, totalRounds]);

  function hostStartRound(idx: number, currentPool: Track[]) {
    if (idx > totalRounds) {
      channelRef.current?.send({ type: 'broadcast', event: 'music:end', payload: { scores: scoresRef.current } });
      setPhase('end');
      return;
    }
    const correct = currentPool[idx - 1];
    if (!correct) return;
    const wrongs = currentPool.filter((t) => t.trackId !== correct.trackId).sort(() => Math.random() - 0.5).slice(0, 2);
    const opts = [correct, ...wrongs].sort(() => Math.random() - 0.5).map((t) => ({ id: t.trackId, label: `${t.trackName} — ${t.artistName}` }));
    const r: RoundData = {
      idx,
      preview: correct.previewUrl,
      options: opts,
      correctId: correct.trackId,
      deadline: Date.now() + 20000,
      artwork: correct.artworkUrl100,
    };
    channelRef.current?.send({ type: 'broadcast', event: 'music:round', payload: r });
    applyRound(r);
  }

  function applyRound(r: RoundData) {
    setRound(r);
    setPhase('play');
    setAnswered({});
    setMyPick(null);
    playNotification();
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = r.preview;
        audioRef.current.volume = volume;
        audioRef.current.currentTime = Math.random() * 5;
        audioRef.current.play().catch(() => {});
      }
    }, 200);
  }

  useEffect(() => {
    const ch = supabase.channel(`music-${code}`);
    ch.on('broadcast', { event: 'music:round' }, ({ payload }) => applyRound(payload));
    ch.on('broadcast', { event: 'music:answer' }, ({ payload }) => {
      setAnswered((all) => ({ ...all, [payload.pid]: { id: payload.id, t: payload.t } }));
      playPop();
    });
    ch.on('broadcast', { event: 'music:reveal' }, ({ payload }) => {
      setScores(payload.scores);
      scoresRef.current = payload.scores;
      setPhase('reveal');
      if (audioRef.current) audioRef.current.pause();
      playSubmit();
    });
    ch.on('broadcast', { event: 'music:end' }, ({ payload }) => {
      setScores(payload.scores);
      setPhase('end');
      if (audioRef.current) audioRef.current.pause();
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // host: kick off when pool ready
  useEffect(() => {
    if (!isHost || pool.length === 0 || round) return;
    setTimeout(() => hostStartRound(1, pool), 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, pool]);

  // timer
  useEffect(() => {
    if (phase !== 'play' || !round) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((round.deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(t);
        if (isHost) setTimeout(() => hostReveal(), 300);
      }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  // host: early reveal when all answered
  useEffect(() => {
    if (!isHost || phase !== 'play' || !round) return;
    if (Object.keys(answered).length >= players.length) {
      setTimeout(() => hostReveal(), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, isHost, phase, round, players.length]);

  function hostReveal() {
    if (!round || phase === 'reveal') return;
    const next = { ...scoresRef.current };
    Object.entries(answered).forEach(([pid, a]) => {
      if (a.id === round.correctId) {
        const speed = Math.max(0, 20000 - (a.t - (round.deadline - 20000)));
        const pts = 500 + Math.floor((speed / 20000) * 500);
        next[pid] = (next[pid] || 0) + pts;
      }
    });
    scoresRef.current = next;
    channelRef.current?.send({ type: 'broadcast', event: 'music:reveal', payload: { scores: next } });
    setScores(next);
    setPhase('reveal');
    if (audioRef.current) audioRef.current.pause();
    setTimeout(() => hostStartRound(round.idx + 1, pool), 3500);
  }

  function submitAnswer(optId: number) {
    if (!round || myPick !== null || phase !== 'play') return;
    setMyPick(optId);
    const payload = { pid: playerId, id: optId, t: Date.now() };
    channelRef.current?.send({ type: 'broadcast', event: 'music:answer', payload });
    setAnswered((all) => ({ ...all, [playerId]: { id: optId, t: payload.t } }));
    playClick();
  }

  const sorted = useMemo(() => players.map((p) => ({ ...p, score: scores[p.player_id] || 0 })).sort((a, b) => b.score - a.score), [players, scores]);

  if (phase === 'loading') {
    return (
      <div className="max-w-xl mx-auto p-4 text-center">
        <div className="text-6xl animate-bounce">🎵</div>
        <p className="mt-3 font-bold">Zenék betöltése...</p>
      </div>
    );
  }

  if (phase === 'end') {
    return (
      <div className="max-w-xl mx-auto p-4 space-y-4 text-center animate-zoom-in">
        <div className="text-6xl">🏆</div>
        <h2 className="text-3xl font-bold">Zenekitaláló vége!</h2>
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
    <div className="max-w-3xl mx-auto p-3 space-y-3">
      <audio ref={audioRef} />
      <div className="game-card ios-glass py-2 px-4 flex items-center justify-between gap-3">
        <div className="font-bold">🎵 Kör {round?.idx}/{totalRounds}</div>
        <div className={`font-bold text-xl ${timeLeft <= 5 ? 'text-destructive animate-pulse' : ''}`}>⏱️ {timeLeft}mp</div>
        <div className="flex items-center gap-1 text-xs">
          <span>🔊</span>
          <input type="range" min={0} max={1} step={0.05} value={volume}
            onChange={(e) => { const v = Number(e.target.value); setVolume(v); if (audioRef.current) audioRef.current.volume = v; }}
            className="w-20" />
        </div>
      </div>

      <div className="game-card text-center py-6">
        <div className="text-6xl mb-2 animate-pulse">{phase === 'reveal' && round?.artwork ? '' : '🎶'}</div>
        {phase === 'reveal' && round?.artwork && (
          <img src={round.artwork.replace('100x100', '300x300')} alt="" className="w-32 h-32 mx-auto rounded-xl shadow-lg" />
        )}
        <p className="text-sm text-muted-foreground mt-2">{phase === 'reveal' ? 'A helyes válasz:' : 'Halld meg, tippelj!'}</p>
        {phase === 'reveal' && round && (
          <p className="font-bold text-lg mt-1">{round.options.find((o) => o.id === round.correctId)?.label}</p>
        )}
      </div>

      <div className="grid gap-2">
        {round?.options.map((opt) => {
          const isCorrect = phase === 'reveal' && opt.id === round.correctId;
          const isWrong = phase === 'reveal' && myPick === opt.id && opt.id !== round.correctId;
          const picked = myPick === opt.id;
          return (
            <button key={opt.id} disabled={myPick !== null || phase === 'reveal'}
              onClick={() => submitAnswer(opt.id)}
              className={`game-card text-left py-3 px-4 font-bold border-2 transition-all ${
                isCorrect ? 'border-primary bg-primary/30' :
                isWrong ? 'border-destructive bg-destructive/30' :
                picked ? 'border-primary' : 'border-border hover:border-primary/60'
              }`}>
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="game-card ios-glass">
        <div className="font-bold text-sm mb-1">🏆 Pontok</div>
        <div className="grid grid-cols-2 gap-1 text-xs">
          {sorted.map((p) => {
            const av = getAvatarDisplay(p.avatar);
            const ans = answered[p.player_id];
            return (
              <div key={p.player_id} className="flex items-center gap-2 p-1 bg-card/50 rounded">
                {av.src ? <img src={av.src} alt="" className="w-6 h-6 rounded" /> : <span className="text-base">{av.emoji}</span>}
                <span className="flex-1 truncate">{p.username}</span>
                {ans && phase === 'play' && <span>✓</span>}
                <span className="font-bold">{p.score}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}