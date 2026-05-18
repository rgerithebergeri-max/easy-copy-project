import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings, speakHungarian } from '@/lib/gameTypes';
import {
  playClick, playNotification, playPop, playWhoosh, playApplause,
  playSlideChange, fireConfetti, playMagic,
  playSwoosh, playImpact, playRiser, playDrumroll, playStingChord, playTransition,
} from '@/lib/sounds';
import {
  presAudio, PRES_MUSIC, PRES_SFX, PRESET_IMAGES, parseYouTubeId,
  parseYouTubeTimestamp, PresMusicId, PresSfxId,
} from '@/lib/presentationAudio';
import { getAvatarDisplay } from '@/lib/avatars';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

const SLIDE_EMOJIS = ['🦒','🚀','🎩','🐉','🍕','🌈','🦄','💻','📈','🧠','🪐','🐙','🍩','🎲','💡','🦖','🎤','🪩','🧙','🥑','🐢','🍔','🛸','🔥','💎','🌵'];

type Phase = 'intro' | 'collect' | 'build' | 'presIntro' | 'pres' | 'notes' | 'rate' | 'recap';

type Slide = {
  emoji: string;
  caption: string;
  img: string;
  musicAtStart?: PresMusicId | null;
  sfxAtStart?: PresSfxId[];
  ytId?: string | null;
  ytStart?: number;
  ytEnd?: number;
};

type Deck = {
  presenterId: string;
  helperId: string;
  helperName: string;
  slides: Slide[];
};

type Stroke = { from: string; color: string; w: number; pts: { x: number; y: number }[] };
type ScoreSample = { t: number; avg: number };
const INTRO_MS = 4800;

// ============= COMPONENT =============
export default function PresentationGameView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const slidesPerTalk = Math.max(3, Math.min(10, settings.presSlides ?? 5));
  const slideTime = Math.max(10, settings.presSlideTime ?? 25);
  const channelRef = useRef<any>(null);

  const [phase, setPhase] = useState<Phase>('intro');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [myTitle, setMyTitle] = useState('');
  const [decks, setDecks] = useState<Record<string, Deck>>({});
  const [presenterIdx, setPresenterIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [slideDeadline, setSlideDeadline] = useState(0);
  const [slideTimeLeft, setSlideTimeLeft] = useState(0);
  const [introUntil, setIntroUntil] = useState(0);

  // Live audience scoring
  const [liveScores, setLiveScores] = useState<Record<string, number>>({}); // playerId -> -10..10
  const [myScore, setMyScore] = useState(0);
  const [scoreSeries, setScoreSeries] = useState<Record<string, ScoreSample[]>>({}); // presenterId -> samples
  const [presenterStartedAt, setPresenterStartedAt] = useState(0);

  // Notes & ratings
  const [notes, setNotes] = useState<Record<string, { from: string; text: string }[]>>({});
  const [noteInput, setNoteInput] = useState('');
  const [submittedNotes, setSubmittedNotes] = useState<Set<string>>(new Set());
  const [ratingList, setRatingList] = useState<Record<string, number[]>>({});
  const [ratingSubmitters, setRatingSubmitters] = useState<Set<string>>(new Set());
  const [myRating, setMyRating] = useState(0);

  // Effects
  const [epicFlash, setEpicFlash] = useState(0);
  const [epicShake, setEpicShake] = useState(0);
  const [floatingReacts, setFloatingReacts] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const [ytOverlay, setYtOverlay] = useState<{ id: string; start?: number; end?: number; nonce: number } | null>(null);
  const ytNonceRef = useRef(0);

  // Drawing strokes per-slide
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef(strokes);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // refs for stale-closure-free broadcasts
  const titlesRef = useRef(titles);
  const decksRef = useRef(decks);
  const phaseRef = useRef(phase);
  const presenterIdxRef = useRef(0);
  const slideIdxRef = useRef(0);
  const slideDeadlineRef = useRef(0);
  const ratingListRef = useRef(ratingList);
  const notesRef = useRef(notes);
  const scoreSeriesRef = useRef(scoreSeries);
  const liveScoresRef = useRef(liveScores);
  useEffect(() => { titlesRef.current = titles; }, [titles]);
  useEffect(() => { decksRef.current = decks; }, [decks]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { presenterIdxRef.current = presenterIdx; }, [presenterIdx]);
  useEffect(() => { slideIdxRef.current = slideIdx; }, [slideIdx]);
  useEffect(() => { slideDeadlineRef.current = slideDeadline; }, [slideDeadline]);
  useEffect(() => { ratingListRef.current = ratingList; }, [ratingList]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { scoreSeriesRef.current = scoreSeries; }, [scoreSeries]);
  useEffect(() => { liveScoresRef.current = liveScores; }, [liveScores]);

  // rotation
  const myIdx = useMemo(() => players.findIndex((p) => p.player_id === playerId), [players, playerId]);
  const targetForMe = players[(myIdx + 1) % players.length];
  const helperForMe = players[(myIdx - 1 + players.length) % players.length];

  const presenter = players[presenterIdx];
  const presenterId = presenter?.player_id;
  const isPresenter = presenterId === playerId;
  const currentDeck = decks[presenterId];
  const helperPlayer = useMemo(
    () => players.find((p) => p.player_id === currentDeck?.helperId),
    [players, currentDeck?.helperId]
  );
  const isHelperOfCurrent = currentDeck?.helperId === playerId;
  const presentedTitle = titles[presenterId] || '(cím nélkül)';

  function triggerEpic(kind: 'flash' | 'shake' | 'sparkle' = 'flash') {
    if (kind === 'shake') setEpicShake((n) => n + 1);
    else setEpicFlash((n) => n + 1);
    if (kind === 'sparkle') playMagic();
    else playWhoosh();
  }

  // ============ CHANNEL ============
  useEffect(() => {
    const ch = supabase.channel(`pres-${code}`);
    ch.on('broadcast', { event: 'title' }, ({ payload }) => {
      setTitles((t) => {
        const u = { ...t, [payload.targetId]: payload.title };
        titlesRef.current = u;
        return u;
      });
    });
    ch.on('broadcast', { event: 'titles:done' }, ({ payload }) => {
      setTitles(payload.titles);
      titlesRef.current = payload.titles;
      setPhase('build');
    });
    ch.on('broadcast', { event: 'deck' }, ({ payload }) => {
      setDecks((d) => {
        const u = { ...d, [payload.deck.presenterId]: payload.deck };
        decksRef.current = u;
        return u;
      });
    });
    ch.on('broadcast', { event: 'pres:start' }, ({ payload }) => {
      setDecks(payload.decks); decksRef.current = payload.decks;
      setTitles(payload.titles); titlesRef.current = payload.titles;
      setPresenterIdx(payload.idx);
      setSlideIdx(0);
      setLiveScores({}); liveScoresRef.current = {};
      setMyScore(0);
      setStrokes([]);
      setYtOverlay(null);
      // INTRO first, then slides
      const until = Date.now() + INTRO_MS;
      setIntroUntil(until);
      setPhase('presIntro');
      const p = players[payload.idx];
      if (p) speakHungarian(`És most következik ${p.username}, prezentációjának címe: ${payload.titles[p.player_id] || 'titokzatos téma'}. Segédje: ${payload.decks[p.player_id]?.helperName || 'ismeretlen'}.`);
      playMagic();
      // After intro, jump to pres
      setTimeout(() => {
        setPhase('pres');
        setPresenterStartedAt(Date.now());
        setSlideDeadline(Date.now() + slideTime * 1000);
        playNotification();
        triggerEpic('flash');
        const deck = payload.decks[p?.player_id];
        applySlideCues(deck, 0, Date.now() + 150);
      }, INTRO_MS);
    });
    ch.on('broadcast', { event: 'pres:slide' }, ({ payload }) => {
      setSlideIdx(payload.idx);
      setSlideDeadline(Date.now() + slideTime * 1000);
      setStrokes([]); strokesRef.current = [];
      setYtOverlay(null);
      presAudio.setDucked(false);
      playSlideChange(); triggerEpic('flash');
      const pid = players[presenterIdxRef.current]?.player_id;
      const deck = pid ? decksRef.current[pid] : undefined;
      applySlideCues(deck, payload.idx, payload.cueAt);
    });
    ch.on('broadcast', { event: 'pres:audio' }, ({ payload }) => {
      if (payload.stopMusic) presAudio.stopMusic();
      if (payload.music) presAudio.playMusic(payload.music);
      if (payload.sfx) presAudio.playSfx(payload.sfx);
    });
    ch.on('broadcast', { event: 'pres:yt' }, ({ payload }) => {
      if (!payload.ytId) {
        setYtOverlay(null);
        presAudio.setDucked(false);
      } else {
        showYouTubeOverlay(payload.ytId, payload.start, payload.end);
        presAudio.setDucked(true);
      }
    });
    ch.on('broadcast', { event: 'pres:epic' }, ({ payload }) => {
      const kind = payload?.kind || 'flash';
      triggerEpic(kind);
      if (kind === 'sparkle') fireConfetti(30);
    });
    ch.on('broadcast', { event: 'pres:draw' }, ({ payload }) => {
      // Receive a fully closed stroke (broadcast on pointer up)
      if (!payload?.stroke) return;
      setStrokes((s) => [...s, payload.stroke]);
    });
    ch.on('broadcast', { event: 'pres:drawClear' }, () => {
      setStrokes([]);
    });
    ch.on('broadcast', { event: 'react' }, ({ payload }) => {
      // Legacy +/- click reactions (kept for emoji floaters)
      spawnFloat(payload.delta > 0 ? '🔥' : '😬');
      playPop();
    });
    ch.on('broadcast', { event: 'pres:slider' }, ({ payload }) => {
      setLiveScores((m) => {
        const u = { ...m, [payload.from]: payload.value };
        liveScoresRef.current = u;
        return u;
      });
    });
    ch.on('broadcast', { event: 'pres:notes' }, ({ payload }) => {
      setPhase('notes');
      setPresenterIdx(payload.idx);
      setSubmittedNotes(new Set());
      // store final series for this presenter (host already accumulated it)
      if (payload.series) {
        setScoreSeries((s) => {
          const u = { ...s, [payload.presenterId]: payload.series };
          scoreSeriesRef.current = u;
          return u;
        });
      }
      presAudio.stopMusic(); setYtOverlay(null);
    });
    ch.on('broadcast', { event: 'note' }, ({ payload }) => {
      setNotes((all) => {
        const list = all[payload.presenterId] || [];
        return { ...all, [payload.presenterId]: [...list, { from: payload.from, text: payload.text }] };
      });
      setSubmittedNotes((s) => new Set([...Array.from(s), payload.fromId]));
    });
    ch.on('broadcast', { event: 'pres:rate' }, ({ payload }) => {
      setPhase('rate');
      setPresenterIdx(payload.idx);
      setMyRating(0);
      setRatingSubmitters(new Set());
    });
    ch.on('broadcast', { event: 'rating' }, ({ payload }) => {
      setRatingList((r) => {
        const u = { ...r, [payload.helperId]: [...(r[payload.helperId] || []), payload.stars] };
        ratingListRef.current = u;
        return u;
      });
      setRatingSubmitters((s) => new Set([...Array.from(s), payload.from]));
    });
    ch.on('broadcast', { event: 'pres:next' }, ({ payload }) => {
      if (payload.idx >= players.length) {
        setPhase('recap'); fireConfetti(120); playApplause();
      } else if (isHost) {
        startPresentation(payload.idx);
      }
    });
    ch.on('broadcast', { event: 'state:request' }, ({ payload }) => {
      if (!isHost) return;
      channelRef.current?.send({
        type: 'broadcast', event: 'state:sync',
        payload: {
          to: payload?.from,
          phase: phaseRef.current,
          titles: titlesRef.current,
          decks: decksRef.current,
          presenterIdx: presenterIdxRef.current,
          slideIdx: slideIdxRef.current,
          slideDeadline: slideDeadlineRef.current,
          ratingList: ratingListRef.current,
          notes: notesRef.current,
          scoreSeries: scoreSeriesRef.current,
        },
      });
    });
    ch.on('broadcast', { event: 'state:sync' }, ({ payload }) => {
      if (payload?.to && payload.to !== playerId) return;
      if (payload.titles) { setTitles(payload.titles); titlesRef.current = payload.titles; }
      if (payload.decks) { setDecks(payload.decks); decksRef.current = payload.decks; }
      if (typeof payload.presenterIdx === 'number') setPresenterIdx(payload.presenterIdx);
      if (typeof payload.slideIdx === 'number') setSlideIdx(payload.slideIdx);
      if (typeof payload.slideDeadline === 'number') setSlideDeadline(payload.slideDeadline);
      if (payload.ratingList) setRatingList(payload.ratingList);
      if (payload.notes) setNotes(payload.notes);
      if (payload.scoreSeries) setScoreSeries(payload.scoreSeries);
      if (payload.phase) setPhase(payload.phase);
    });
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED' && !isHost) {
        setTimeout(() => {
          channelRef.current?.send({ type: 'broadcast', event: 'state:request', payload: { from: playerId } });
        }, 400);
      }
    });
    channelRef.current = ch;
    return () => { presAudio.stopMusic(); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ============ helpers ============
  function showYouTubeOverlay(id: string, start?: number, end?: number) {
    ytNonceRef.current += 1;
    setYtOverlay({ id, start, end, nonce: ytNonceRef.current });
  }

  function applySlideCues(deck: Deck | undefined, idx: number, cueAt = Date.now()) {
    const s = deck?.slides?.[idx];
    if (!s) return;
    const delay = Math.max(0, cueAt - Date.now());
    if (s.musicAtStart === null) presAudio.stopMusic();
    else if (s.musicAtStart) setTimeout(() => presAudio.playMusic(s.musicAtStart!), delay);
    (s.sfxAtStart || []).forEach((id) => setTimeout(() => presAudio.playSfx(id), delay));
    if (s.ytId) {
      presAudio.setDucked(true);
      setTimeout(() => showYouTubeOverlay(s.ytId!, s.ytStart, s.ytEnd), delay);
    }
  }

  function spawnFloat(emoji: string) {
    const id = Date.now() + Math.random();
    const x = 20 + Math.random() * 60;
    setFloatingReacts((r) => [...r, { id, emoji, x }]);
    setTimeout(() => setFloatingReacts((r) => r.filter((f) => f.id !== id)), 1800);
  }

  // ============ slider broadcast (throttled) ============
  const sliderTimerRef = useRef<number | null>(null);
  const pendingScoreRef = useRef<number | null>(null);
  const sendSliderValue = useCallback((v: number) => {
    setMyScore(v);
    setLiveScores((m) => ({ ...m, [playerId]: v }));
    pendingScoreRef.current = v;
    if (sliderTimerRef.current) return;
    sliderTimerRef.current = window.setTimeout(() => {
      const val = pendingScoreRef.current;
      sliderTimerRef.current = null;
      if (val == null) return;
      channelRef.current?.send({ type: 'broadcast', event: 'pres:slider', payload: { from: playerId, value: val } });
    }, 150);
  }, [playerId]);

  // ============ Host: sample average every 1s for current presenter ============
  useEffect(() => {
    if (phase !== 'pres' || !isHost || !presenterId) return;
    const startedAt = presenterStartedAt || Date.now();
    const id = window.setInterval(() => {
      const audience = players.filter((p) => p.player_id !== presenterId);
      if (audience.length === 0) return;
      const sum = audience.reduce((acc, p) => acc + (liveScoresRef.current[p.player_id] || 0), 0);
      const avg = sum / audience.length;
      const sample: ScoreSample = { t: Math.round((Date.now() - startedAt) / 1000), avg };
      setScoreSeries((s) => {
        const prev = s[presenterId] || [];
        const u = { ...s, [presenterId]: [...prev, sample] };
        scoreSeriesRef.current = u;
        return u;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, isHost, presenterId, presenterStartedAt, players]);

  // ============ intro one-time ============
  useEffect(() => {
    if (phase !== 'intro') return;
    speakHungarian('Üdv a Vicces Prezentáció módban! Mindenki kap egy témát és egy segédet. A közönség egy csúszkával értékeli folyamatosan az előadást.');
    const t = setTimeout(() => setPhase('collect'), 6500);
    return () => clearTimeout(t);
  }, [phase]);

  // ============ audio unlock ============
  useEffect(() => {
    presAudio.preload();
    const handler = () => { presAudio.unlock(); };
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
  }, []);
  useEffect(() => {
    if (phase === 'pres' || phase === 'presIntro' || phase === 'intro' || phase === 'collect' || phase === 'build') {
      presAudio.setDucked(false);
    }
  }, [phase]);

  useEffect(() => {
    if (!ytOverlay?.end) return;
    const start = ytOverlay.start ?? 0;
    const duration = Math.max(2, ytOverlay.end - start);
    const t = setTimeout(() => {
      setYtOverlay(null);
      presAudio.setDucked(false);
    }, duration * 1000);
    return () => clearTimeout(t);
  }, [ytOverlay]);

  // slide timer
  useEffect(() => {
    if (phase !== 'pres' || !slideDeadline) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((slideDeadline - Date.now()) / 1000));
      setSlideTimeLeft(left);
      if (left <= 0) { clearInterval(t); if (isPresenter) nextSlide(); }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, slideDeadline, isPresenter]);

  // ============ collect ============
  function submitTitle() {
    if (!myTitle.trim() || !targetForMe) return;
    const updated = { ...titles, [targetForMe.player_id]: myTitle.trim() };
    setTitles(updated); titlesRef.current = updated;
    channelRef.current?.send({ type: 'broadcast', event: 'title', payload: { targetId: targetForMe.player_id, title: myTitle.trim() } });
    setMyTitle('');
    playClick();
  }
  useEffect(() => {
    if (phase !== 'collect' || !isHost) return;
    if (Object.keys(titles).length >= players.length) {
      const t = setTimeout(() => {
        channelRef.current?.send({ type: 'broadcast', event: 'titles:done', payload: { titles } });
        setPhase('build');
      }, 500);
      return () => clearTimeout(t);
    }
  }, [titles, phase, isHost, players.length]);
  function forceStartBuild() {
    const filled: Record<string, string> = { ...titles };
    players.forEach((p) => { if (!filled[p.player_id]) filled[p.player_id] = '(meglepetés téma)'; });
    setTitles(filled); titlesRef.current = filled;
    channelRef.current?.send({ type: 'broadcast', event: 'titles:done', payload: { titles: filled } });
    setPhase('build');
  }

  // ============ deck submission ============
  function submitDeck(deck: Deck) {
    setDecks((d) => ({ ...d, [deck.presenterId]: deck }));
    channelRef.current?.send({ type: 'broadcast', event: 'deck', payload: { deck } });
    playClick();
  }

  useEffect(() => {
    if (phase !== 'build' || !isHost) return;
    if (Object.keys(decks).length >= players.length) {
      const t = setTimeout(() => startPresentation(0), 800);
      return () => clearTimeout(t);
    }
  }, [decks, phase, isHost, players.length]);

  function startPresentation(idx: number) {
    const until = Date.now() + INTRO_MS;
    setIntroUntil(until);
    setPresenterIdx(idx);
    setSlideIdx(0);
    setLiveScores({}); liveScoresRef.current = {};
    setMyScore(0);
    setStrokes([]);
    setYtOverlay(null);
    setPhase('presIntro');
    channelRef.current?.send({
      type: 'broadcast', event: 'pres:start',
      payload: { idx, decks: decksRef.current, titles: titlesRef.current },
    });
    setTimeout(() => {
      setPhase('pres');
      setPresenterStartedAt(Date.now());
      setSlideDeadline(Date.now() + slideTime * 1000);
      const pid = players[idx]?.player_id;
      applySlideCues(pid ? decksRef.current[pid] : undefined, 0, Date.now() + 150);
    }, INTRO_MS);
  }

  function forceStartPresentations() {
    const filled = { ...decksRef.current };
    players.forEach((p) => {
      if (!filled[p.player_id]) {
        const helperIdx = (players.findIndex((x) => x.player_id === p.player_id) - 1 + players.length) % players.length;
        const helper = players[helperIdx];
        filled[p.player_id] = autoDeck(p.player_id, helper);
      }
    });
    setDecks(filled); decksRef.current = filled;
    setTimeout(() => startPresentation(0), 300);
  }

  function nextSlide() {
    if (!isPresenter) return;
    const ni = slideIdx + 1;
    if (ni >= (currentDeck?.slides.length || slidesPerTalk)) {
      const series = scoreSeriesRef.current[presenterId] || [];
      channelRef.current?.send({
        type: 'broadcast', event: 'pres:notes',
        payload: { idx: presenterIdx, presenterId, series },
      });
      setPhase('notes'); setSubmittedNotes(new Set());
      presAudio.stopMusic(); setYtOverlay(null);
      return;
    }
    setSlideIdx(ni);
    setSlideDeadline(Date.now() + slideTime * 1000);
    setStrokes([]); strokesRef.current = [];
    setYtOverlay(null); presAudio.setDucked(false);
    const cueAt = Date.now() + 300;
    channelRef.current?.send({ type: 'broadcast', event: 'pres:slide', payload: { idx: ni, cueAt } });
    applySlideCues(currentDeck, ni, cueAt);
  }

  function submitNote() {
    if (submittedNotes.has(playerId)) return;
    const text = noteInput.trim();
    if (text) {
      channelRef.current?.send({ type: 'broadcast', event: 'note', payload: {
        presenterId, fromId: playerId, from: username, text,
      } });
      setNotes((all) => {
        const list = all[presenterId] || [];
        return { ...all, [presenterId]: [...list, { from: username, text }] };
      });
    }
    setSubmittedNotes((s) => new Set([...Array.from(s), playerId]));
    setNoteInput(''); playClick();
  }

  useEffect(() => {
    if (phase !== 'notes' || !isHost) return;
    if (submittedNotes.size >= players.length) {
      const t = setTimeout(() => {
        channelRef.current?.send({ type: 'broadcast', event: 'pres:rate', payload: { idx: presenterIdx } });
        setPhase('rate'); setMyRating(0); setRatingSubmitters(new Set());
      }, 600);
      return () => clearTimeout(t);
    }
  }, [submittedNotes, phase, isHost, presenterIdx, players.length]);

  function submitRating(stars: number) {
    if (myRating > 0) return;
    const helperId = currentDeck?.helperId;
    if (!helperId) return;
    channelRef.current?.send({ type: 'broadcast', event: 'rating', payload: { helperId, stars, from: playerId } });
    setRatingList((r) => ({ ...r, [helperId]: [...(r[helperId] || []), stars] }));
    setRatingSubmitters((s) => new Set([...Array.from(s), playerId]));
    setMyRating(stars);
    playClick();
  }

  useEffect(() => {
    if (phase !== 'rate' || !isHost) return;
    if (ratingSubmitters.size >= players.length) {
      const t = setTimeout(() => advanceToNextPresenter(), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingSubmitters, phase, isHost, players.length]);

  function advanceToNextPresenter() {
    const next = presenterIdx + 1;
    channelRef.current?.send({ type: 'broadcast', event: 'pres:next', payload: { idx: next } });
    if (next >= players.length) { setPhase('recap'); fireConfetti(120); playApplause(); }
    else startPresentation(next);
  }

  function broadcastStroke(stroke: Stroke) {
    setStrokes((s) => [...s, stroke]);
    channelRef.current?.send({ type: 'broadcast', event: 'pres:draw', payload: { stroke } });
  }
  function clearStrokes() {
    setStrokes([]);
    channelRef.current?.send({ type: 'broadcast', event: 'pres:drawClear', payload: {} });
  }
  function helperEpic(kind: 'flash' | 'shake' | 'sparkle') {
    triggerEpic(kind);
    if (kind === 'sparkle') fireConfetti(30);
    channelRef.current?.send({ type: 'broadcast', event: 'pres:epic', payload: { kind } });
  }

  // ============ RENDER ============
  if (phase === 'intro') {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center space-y-4">
        <div className="text-7xl animate-bounce">🎤</div>
        <h2 className="text-3xl font-bold">Vicces Prezentáció <span className="text-primary">3.0</span></h2>
        <p className="text-muted-foreground">Csúszkás közönség-értékelés · grafikon · podium · konfetti · rajz a slide-ra · függönyös bemutató.</p>
        {isHost && <button className="game-btn-primary" onClick={() => setPhase('collect')}>⏭️ Kezdés</button>}
      </div>
    );
  }

  if (phase === 'collect') {
    const myAlreadySubmitted = !!titles[targetForMe?.player_id];
    return (
      <div className="max-w-xl mx-auto p-4 space-y-3">
        <h2 className="text-2xl font-bold text-center">🎤 Adj témát {targetForMe?.username}-nak</h2>
        <p className="text-center text-muted-foreground text-sm">Minél viccesebb, annál jobb!</p>
        {!myAlreadySubmitted ? (
          <>
            <input className="game-input" value={myTitle} onChange={(e) => setMyTitle(e.target.value)}
              placeholder="pl. A pizza új vallása..." onKeyDown={(e) => e.key === 'Enter' && submitTitle()} autoFocus />
            <button className="game-btn-primary w-full" onClick={submitTitle} disabled={!myTitle.trim()}>Küldés</button>
          </>
        ) : (
          <div className="game-card text-center">✅ Küldve! Várakozás a többiekre...</div>
        )}
        <div className="text-xs text-muted-foreground text-center">Beérkezett: {Object.keys(titles).length}/{players.length}</div>
        {isHost && (
          <button className="game-btn bg-card text-xs py-2 w-full" onClick={forceStartBuild}>
            ⏭️ Indítás most ({Object.keys(titles).length}/{players.length})
          </button>
        )}
      </div>
    );
  }

  if (phase === 'build') {
    return (
      <BuildPhase
        code={code}
        targetForMe={targetForMe}
        helperForMe={helperForMe}
        targetTitle={titles[targetForMe?.player_id] || '(cím nélkül)'}
        slidesPerTalk={slidesPerTalk}
        meName={username} myId={playerId}
        alreadySubmitted={!!decks[targetForMe?.player_id]}
        submittedCount={Object.keys(decks).length}
        totalCount={players.length}
        onSubmit={submitDeck}
        isHost={isHost}
        onForceStart={forceStartPresentations}
      />
    );
  }

  if (phase === 'presIntro') {
    return (
      <IntroCurtain
        presenter={presenter}
        helper={helperPlayer}
        title={presentedTitle}
        untilMs={introUntil}
      />
    );
  }

  if (phase === 'pres') {
    return (
      <>
        {epicFlash > 0 && <div key={`gflash-${epicFlash}`} className="animate-epic-flash" />}
        <div className={epicShake ? 'animate-epic-shake' : ''} key={`shake-${epicShake}`}>
          <PresPhase
            deck={currentDeck}
            slideIdx={slideIdx}
            slideTimeLeft={slideTimeLeft}
            presenterName={presenter?.username || ''}
            presentedTitle={presentedTitle}
            presenter={presenter}
            helper={helperPlayer}
            audience={players.filter((p) => p.player_id !== presenterId)}
            liveScores={liveScores}
            myScore={myScore}
            isPresenter={isPresenter}
            isHelper={isHelperOfCurrent}
            playerId={playerId}
            floatingReacts={floatingReacts}
            ytOverlay={ytOverlay}
            strokes={strokes}
            slidesTotal={currentDeck?.slides.length || slidesPerTalk}
            onSlider={sendSliderValue}
            onNext={() => { playWhoosh(); nextSlide(); }}
            onHelperAudio={(p) => channelRef.current?.send({ type: 'broadcast', event: 'pres:audio', payload: p })}
            onHelperYt={(yt) => channelRef.current?.send({ type: 'broadcast', event: 'pres:yt', payload: yt })}
            onStroke={broadcastStroke}
            onClearStrokes={clearStrokes}
            onEpic={helperEpic}
          />
        </div>
      </>
    );
  }

  if (phase === 'notes') {
    const mineSent = submittedNotes.has(playerId);
    const series = scoreSeries[presenterId] || [];
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-3">
        <div className="game-card ios-glass text-center">
          <p className="text-xs text-muted-foreground">prezentáció vége</p>
          <p className="text-xl font-bold">{presenter?.username} — "{presentedTitle}"</p>
        </div>
        <div className="game-card">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">📈 Hangulat grafikon (csúszkák átlaga)</div>
          <ScoreGraph series={series} />
        </div>
        <h2 className="text-xl font-bold text-center">📝 Tűzd ki a jegyzeted</h2>
        {!mineSent ? (
          <>
            <textarea className="game-input min-h-[90px] text-base"
              value={noteInput} onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Vicces visszajelzés? Kérdés? Bók?" />
            <button className="game-btn-primary w-full" onClick={submitNote}>📌 Tűzd ki</button>
          </>
        ) : (
          <div className="game-card text-center animate-zoom-in">✅ Kitűzve. Várakozás a többiekre...</div>
        )}
        <div className="text-xs text-muted-foreground text-center">Kitűzve: {submittedNotes.size}/{players.length}</div>
        <NotesBoard notes={notes[presenterId] || []} />
        {isHost && (
          <button className="game-btn bg-card text-xs py-2 w-full"
            onClick={() => { channelRef.current?.send({ type: 'broadcast', event: 'pres:rate', payload: { idx: presenterIdx } }); setPhase('rate'); }}>
            ⏭️ Tovább értékelésre
          </button>
        )}
      </div>
    );
  }

  if (phase === 'rate') {
    const helperId = currentDeck?.helperId;
    const helperName = currentDeck?.helperName || '?';
    const myRated = myRating > 0;
    return (
      <div className="max-w-md mx-auto p-4 space-y-4 text-center">
        <div className="text-6xl animate-bounce">⭐</div>
        <h2 className="text-2xl font-bold">Értékeld {helperName} munkáját!</h2>
        <p className="text-sm text-muted-foreground">Mindenki értékelhet 1–5 csillaggal.</p>
        <div className="flex justify-center gap-2 text-5xl">
          {[1,2,3,4,5].map((s) => (
            <button key={s}
              disabled={myRated}
              onClick={() => submitRating(s)}
              className={`transition-transform hover:scale-125 ${myRating >= s ? '' : 'opacity-40'} disabled:cursor-not-allowed`}>
              ⭐
            </button>
          ))}
        </div>
        {myRated && <div className="text-sm text-primary">Köszi! Várakozás...</div>}
        <div className="text-xs text-muted-foreground">Értékelte: {ratingSubmitters.size}/{players.length}</div>
        {helperId && (ratingList[helperId] || []).length > 0 && (
          <div className="text-xs text-muted-foreground">
            Átlag: {((ratingList[helperId]!.reduce((a,b)=>a+b,0))/ratingList[helperId]!.length).toFixed(2)}⭐
          </div>
        )}
        {isHost && (
          <button className="game-btn bg-card text-xs py-2 w-full" onClick={advanceToNextPresenter}>
            ⏭️ Tovább most
          </button>
        )}
      </div>
    );
  }

  // ====== RECAP ======
  const scoreboard = players.map((p) => {
    const series = scoreSeries[p.player_id] || [];
    const avgScore = series.length ? series.reduce((acc, s) => acc + s.avg, 0) / series.length : 0;
    const presenterPts = Math.round(avgScore * 2); // -20..20-ish
    const helperRatings = ratingList[p.player_id] || [];
    const helperAvg = helperRatings.length ? helperRatings.reduce((a, b) => a + b, 0) / helperRatings.length : 0;
    const helperPts = Math.round(helperAvg * 10);
    return { p, presenterPts, helperRatings, helperAvg, helperPts, avgScore, series, total: presenterPts + helperPts };
  }).sort((a, b) => b.total - a.total);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4 animate-zoom-in">
      <h2 className="text-4xl font-extrabold text-center animate-spring-in">🏆 EREDMÉNYEK</h2>
      <PodiumReveal top={scoreboard.slice(0, 3)} />
      <div className="game-card space-y-2">
        {scoreboard.map((s, i) => {
          const av = getAvatarDisplay(s.p.avatar);
          return (
            <div key={s.p.player_id} className={`flex items-center gap-3 p-3 rounded-xl ${i === 0 ? 'bg-primary/15 border border-primary/30' : 'bg-card'}`}>
              <div className="text-2xl font-bold w-8 text-center">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</div>
              <div className="w-10 h-10 rounded-full overflow-hidden border border-border bg-muted flex items-center justify-center text-xl">
                {av.src ? <img src={av.src} alt="" className="w-full h-full object-cover" /> : av.emoji}
              </div>
              <div className="flex-1">
                <div className="font-bold">{s.p.username}</div>
                <div className="text-[11px] text-muted-foreground">
                  prezi átlag: {s.avgScore.toFixed(1)} → +{s.presenterPts} · segéd: {s.helperAvg.toFixed(1)}⭐ ({s.helperRatings.length}) → +{s.helperPts}
                </div>
              </div>
              <div className="text-2xl font-extrabold text-primary">{s.total}</div>
            </div>
          );
        })}
      </div>
      <div className="game-card space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Grafikonok & jegyzetek</div>
        {players.map((p) => (
          <div key={p.player_id} className="border-b border-border pb-3 last:border-0 space-y-1">
            <div className="font-bold text-sm">{p.username} — "{titles[p.player_id] || '?'}"</div>
            <ScoreGraph series={scoreSeries[p.player_id] || []} compact />
            {(notes[p.player_id] || []).length > 0 && (
              <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                {(notes[p.player_id] || []).map((n, i) => <li key={i}>📝 <b>{n.from}:</b> {n.text}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      {isHost && <button className="game-btn-primary w-full" onClick={onFinish}>Vissza a lobbyba</button>}
    </div>
  );
}

// =================================================================
//                        SUIT AVATAR + INTRO CURTAIN
// =================================================================

function SuitAvatar({ player, label, color = '#1a1f2e' }: { player?: Player; label: string; color?: string }) {
  const av = player ? getAvatarDisplay(player.avatar) : { emoji: '👤' };
  return (
    <div className="flex flex-col items-center gap-2 animate-intro-bob">
      <div className="relative">
        {/* head (avatar) */}
        <div className="w-28 h-28 md:w-32 md:h-32 rounded-full overflow-hidden border-4 border-primary shadow-[0_0_30px_rgba(0,255,255,0.5)] bg-muted flex items-center justify-center text-5xl relative z-10">
          {av.src ? <img src={av.src} alt="" className="w-full h-full object-cover" /> : <span>{av.emoji}</span>}
        </div>
        {/* suit body */}
        <svg viewBox="0 0 200 200" className="w-44 md:w-52 -mt-6" aria-hidden>
          {/* shoulders / jacket */}
          <path d="M30,110 Q100,60 170,110 L180,200 L20,200 Z" fill={color} stroke="#0c0f18" strokeWidth="3" />
          {/* lapels */}
          <path d="M85,80 L100,180 L70,160 Z" fill="#0a0d14" />
          <path d="M115,80 L100,180 L130,160 Z" fill="#0a0d14" />
          {/* shirt */}
          <path d="M85,80 Q100,100 115,80 L115,140 L85,140 Z" fill="#f4f6fb" />
          {/* tie */}
          <path d="M97,80 L103,80 L108,100 L100,150 L92,100 Z" fill="#e63946" />
          {/* tie knot */}
          <path d="M94,76 L106,76 L108,86 L92,86 Z" fill="#c1121f" />
        </svg>
      </div>
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[0.25em] text-primary/80">{label}</div>
        <div className="text-lg font-extrabold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">{player?.username || '?'}</div>
      </div>
    </div>
  );
}

function IntroCurtain({ presenter, helper, title, untilMs }: { presenter?: Player; helper?: Player; title: string; untilMs: number }) {
  const [left, setLeft] = useState(Math.max(0, untilMs - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, untilMs - Date.now())), 100);
    return () => clearInterval(id);
  }, [untilMs]);
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-gradient-to-b from-[#0a0612] via-[#120821] to-[#06030c]">
      {/* stage floor */}
      <div className="absolute bottom-0 left-0 right-0 h-1/3"
        style={{ background: 'linear-gradient(180deg, #2a1b0a 0%, #120a04 100%)' }} />
      {/* spotlights */}
      <div className="absolute top-0 left-1/4 w-[60%] h-full animate-spotlight"
        style={{ background: 'radial-gradient(ellipse at top, rgba(255,255,200,0.35), transparent 60%)' }} />
      <div className="absolute top-0 right-1/4 w-[60%] h-full animate-spotlight"
        style={{ background: 'radial-gradient(ellipse at top, rgba(255,200,255,0.3), transparent 60%)', animationDelay: '0.6s' }} />

      {/* characters */}
      <div className="absolute inset-0 flex items-end justify-center gap-10 md:gap-24 pb-32">
        <div className="text-center">
          <SuitAvatar player={helper} label="A SEGÉD" color="#16213a" />
        </div>
        <div className="text-center">
          <SuitAvatar player={presenter} label="A PREZENTÁLÓ" color="#2a1638" />
        </div>
      </div>

      {/* title banner */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 text-center animate-spring-in">
        <div className="text-[11px] uppercase tracking-[0.4em] text-primary/80 mb-1">most következik</div>
        <div className="text-3xl md:text-5xl font-black text-white drop-shadow-[0_0_20px_rgba(0,255,255,0.5)]">
          "{title}"
        </div>
        <div className="text-xs text-muted-foreground mt-2">{Math.ceil(left / 1000)}s...</div>
      </div>

      {/* curtains overlay (open) */}
      <div className="absolute inset-y-0 left-0 w-1/2 curtain-panel curtain-left z-40" />
      <div className="absolute inset-y-0 right-0 w-1/2 curtain-panel curtain-right z-40" />
    </div>
  );
}

// =================================================================
//                        SCORE GRAPH
// =================================================================

function ScoreGraph({ series, compact = false }: { series: ScoreSample[]; compact?: boolean }) {
  const h = compact ? 60 : 110;
  const w = 600;
  if (!series.length) {
    return <div className={`text-xs text-muted-foreground italic`}>Még nincs adat.</div>;
  }
  const maxT = Math.max(1, series[series.length - 1].t);
  const pts = series.map((s, i) => {
    const x = (s.t / maxT) * w;
    const y = h / 2 - (s.avg / 10) * (h / 2 - 6);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = series[series.length - 1];
  return (
    <div className="w-full bg-card/60 rounded-xl border border-border p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        <line x1="0" y1={h/2} x2={w} y2={h/2} stroke="hsl(var(--muted-foreground))" strokeOpacity="0.35" strokeDasharray="3 4" />
        <line x1="0" y1={6} x2={w} y2={6} stroke="hsl(var(--primary))" strokeOpacity="0.2" />
        <line x1="0" y1={h-6} x2={w} y2={h-6} stroke="hsl(var(--destructive))" strokeOpacity="0.2" />
        <path d={`${pts} L${w},${h/2} L0,${h/2} Z`} fill="hsl(var(--primary))" fillOpacity="0.15" />
        <path d={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* end marker */}
        <circle cx={(last.t / maxT) * w} cy={h/2 - (last.avg/10) * (h/2 - 6)} r="4" fill="hsl(var(--primary))" />
      </svg>
      {!compact && (
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>0s · 😬</span>
          <span>átlag végén: <b className={last.avg >= 0 ? 'text-primary' : 'text-destructive'}>{last.avg.toFixed(1)}</b></span>
          <span>{maxT}s · 🔥</span>
        </div>
      )}
    </div>
  );
}

// =================================================================
//                        NOTES BOARD (corkboard)
// =================================================================

function NotesBoard({ notes }: { notes: { from: string; text: string }[] }) {
  if (!notes.length) return null;
  const colors = ['#fff48a', '#ffb3c1', '#a0e7e5', '#bdb2ff', '#ffd6a5', '#caffbf'];
  const rotations = [-4, 3, -2, 5, -6, 2, -3, 4];
  return (
    <div className="relative rounded-xl p-4 min-h-[160px]"
      style={{
        background:
          'repeating-linear-gradient(45deg, #6b3410 0 6px, #5a2b0c 6px 12px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.15) 0 8px, transparent 8px 16px)',
        backgroundBlendMode: 'multiply',
        boxShadow: 'inset 0 0 30px rgba(0,0,0,0.5)',
      }}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {notes.map((n, i) => (
          <div key={i}
            className="relative p-3 text-[#222] shadow-lg animate-pin-drop"
            style={{
              background: colors[i % colors.length],
              ['--pin-rot' as any]: `${rotations[i % rotations.length]}deg`,
              animationDelay: `${i * 0.12}s`,
              transform: `rotate(${rotations[i % rotations.length]}deg)`,
              fontFamily: '"Patrick Hand", "Comic Sans MS", cursive',
            }}>
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-red-600 shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />
            <div className="text-[10px] font-bold uppercase opacity-70">{n.from}</div>
            <div className="text-sm font-semibold leading-tight">{n.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =================================================================
//                        PODIUM REVEAL
// =================================================================

function PodiumReveal({ top }: { top: { p: Player; total: number }[] }) {
  if (!top.length) return null;
  // order: 2nd, 1st, 3rd (visual)
  const slots = [top[1], top[0], top[2]].filter(Boolean);
  const heights = ['h-24', 'h-36', 'h-20'];
  const colors = ['from-slate-400 to-slate-600', 'from-yellow-300 to-yellow-600', 'from-amber-600 to-amber-800'];
  const medals = ['🥈', '🥇', '🥉'];
  const delays = ['0.1s', '0.35s', '0.55s'];
  return (
    <div className="relative game-card overflow-hidden py-6"
      style={{ background: 'radial-gradient(ellipse at top, rgba(255,255,200,0.2), transparent 60%), linear-gradient(180deg, hsl(232 65% 9%), hsl(224 60% 6%))' }}>
      <div className="absolute inset-0 animate-spotlight" style={{ background: 'radial-gradient(ellipse at center top, rgba(255,255,200,0.35), transparent 65%)' }} />
      <div className="relative flex items-end justify-center gap-2 md:gap-6">
        {slots.map((s, i) => {
          if (!s) return null;
          const av = getAvatarDisplay(s.p.avatar);
          return (
            <div key={s.p.player_id} className="flex flex-col items-center animate-podium-rise" style={{ animationDelay: delays[i] }}>
              {i === 1 && <div className="text-4xl animate-crown" style={{ animationDelay: '0.9s' }}>👑</div>}
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border-4 border-primary bg-muted flex items-center justify-center text-3xl shadow-[0_0_24px_rgba(0,255,255,0.45)] mb-1">
                {av.src ? <img src={av.src} alt="" className="w-full h-full object-cover" /> : av.emoji}
              </div>
              <div className="text-xs font-bold text-white">{s.p.username}</div>
              <div className="text-[10px] text-primary">{s.total} pont</div>
              <div className={`mt-1 w-20 md:w-28 ${heights[i]} rounded-t-lg bg-gradient-to-b ${colors[i]} flex items-center justify-center text-3xl shadow-lg`}>
                {medals[i]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =================================================================
//                        BUILD PHASE
// =================================================================

interface BuildProps {
  code: string;
  targetForMe: Player | undefined;
  helperForMe: Player | undefined;
  targetTitle: string;
  slidesPerTalk: number;
  meName: string; myId: string;
  alreadySubmitted: boolean;
  submittedCount: number; totalCount: number;
  isHost: boolean;
  onSubmit: (d: Deck) => void;
  onForceStart: () => void;
}

function BuildPhase(props: BuildProps) {
  const { targetForMe, helperForMe, targetTitle, slidesPerTalk, meName, myId, alreadySubmitted, submittedCount, totalCount, isHost, onSubmit, onForceStart } = props;
  const [slides, setSlides] = useState<Slide[]>(() => Array.from({ length: slidesPerTalk }, (_, i) => ({
    emoji: SLIDE_EMOJIS[i % SLIDE_EMOJIS.length],
    caption: '',
    img: PRESET_IMAGES[Math.floor(Math.random() * PRESET_IMAGES.length)].url,
    musicAtStart: i === 0 ? 'dramatic' : undefined,
    sfxAtStart: [],
    ytId: null,
  })));
  const [active, setActive] = useState(0);
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function update(i: number, patch: Partial<Slide>) {
    setSlides((s) => s.map((sl, j) => j === i ? { ...sl, ...patch } : sl));
  }

  async function generateCaptions(count: number): Promise<string[] | null> {
    try {
      const prompt = `Adj ${count} vicces, rövid magyar prezentáció-szöveget (max 8 szó / slide) a "${targetTitle}" témáról. Csak a ${count} mondatot add vissza, soronként egyet, számozás nélkül, idézőjelek nélkül.`;
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const j = await res.json();
      const txt: string = j?.choices?.[0]?.message?.content || '';
      const lines = txt.split('\n').map((l) => l.replace(/^[\d\.\-\)\s"'*]+/, '').replace(/["'*]+$/, '').trim()).filter(Boolean);
      return lines.slice(0, count);
    } catch (e) { console.error('ai caption failed', e); return null; }
  }

  async function aiCaptionAll() {
    if (aiBusy) return;
    setAiBusy(true);
    const lines = await generateCaptions(slides.length);
    if (lines && lines.length) {
      setSlides((s) => s.map((sl, i) => ({ ...sl, caption: lines[i] || sl.caption })));
    } else { alert('AI hiba — próbáld újra.'); }
    setAiBusy(false);
  }

  async function aiCaptionOne(i: number) {
    if (aiBusy) return;
    setAiBusy(true);
    const lines = await generateCaptions(1);
    if (lines && lines[0]) update(i, { caption: lines[0] });
    else alert('AI hiba — próbáld újra.');
    setAiBusy(false);
  }

  async function handleUpload(file: File) {
    setUploadBusy(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${props.code}/${myId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('pres-uploads').upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('pres-uploads').getPublicUrl(path);
      update(active, { img: data.publicUrl });
    } catch (e) { console.error('upload failed', e); alert('Feltöltés sikertelen. Próbáld újra.'); }
    finally { setUploadBusy(false); }
  }

  function doSubmit() {
    if (!targetForMe) return;
    const deck: Deck = {
      presenterId: targetForMe.player_id,
      helperId: myId, helperName: meName,
      slides,
    };
    onSubmit(deck);
  }

  if (!targetForMe) return <div className="p-4 text-center">Várakozás...</div>;

  if (alreadySubmitted) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-3 text-center">
        <div className="text-6xl">🎬</div>
        <h2 className="text-2xl font-bold">Kész! Megküldve.</h2>
        <p className="text-muted-foreground text-sm">{targetForMe.username} prezijét építetted "{targetTitle}" témáról.</p>
        <p className="text-xs text-muted-foreground">A segéded ({helperForMe?.username || '?'}) most a TIÉD prezijét építi 👀</p>
        <div className="game-card">{submittedCount}/{totalCount} kész</div>
        {isHost && submittedCount < totalCount && (
          <button className="game-btn bg-card text-xs py-2 w-full" onClick={onForceStart}>⏭️ Indítás most</button>
        )}
      </div>
    );
  }

  const s = slides[active];

  return (
    <div className="max-w-5xl mx-auto p-3 space-y-3">
      <div className="game-card ios-glass">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-xs text-muted-foreground">SEGÉD: te vagy <b>{meName}</b></div>
            <div className="text-lg font-bold">🎬 Épitsd fel: {targetForMe.username} → "{targetTitle}"</div>
            <div className="text-[11px] text-muted-foreground">Végtelen idő. A te segéded: <b>{helperForMe?.username || '?'}</b></div>
          </div>
          <button className="game-btn-primary py-2 px-4" onClick={doSubmit}>✅ Mentés és küldés</button>
        </div>
      </div>

      <div className="game-card overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {slides.map((sl, i) => (
            <button key={i} onClick={() => setActive(i)}
              className={`relative w-28 h-20 rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all ${active === i ? 'border-primary scale-105 shadow-lg' : 'border-border opacity-80 hover:opacity-100'}`}>
              <img src={sl.img} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute top-1 left-1 text-xl drop-shadow">{sl.emoji}</div>
              <div className="absolute bottom-0 left-0 right-0 text-[10px] text-white px-1 truncate">#{i+1} {sl.caption || '…'}</div>
              <div className="absolute top-1 right-1 flex gap-0.5">
                {sl.musicAtStart && <span className="text-[9px] bg-primary/80 text-primary-foreground px-1 rounded">♪</span>}
                {(sl.sfxAtStart||[]).length > 0 && <span className="text-[9px] bg-accent/80 text-accent-foreground px-1 rounded">{sl.sfxAtStart!.length}🔊</span>}
                {sl.ytId && <span className="text-[9px] bg-destructive/80 text-destructive-foreground px-1 rounded">▶</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="game-card space-y-2">
          <div className="text-xs uppercase text-muted-foreground">Slide {active + 1}/{slides.length}</div>
          <div className="relative aspect-video rounded-xl overflow-hidden shadow-lg">
            <img src={s.img} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.65) 100%)' }} />
            <div className="absolute inset-0 flex flex-col items-center justify-end text-white p-4 text-center space-y-1">
              <div className="text-5xl drop-shadow-lg">{s.emoji}</div>
              <div className="text-xl font-bold drop-shadow-lg" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.7)' }}>{s.caption || 'írj egy feliratot…'}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <input className="game-input flex-1" placeholder="Slide felirat / kérdés"
              value={s.caption} onChange={(e) => update(active, { caption: e.target.value })} />
            <button className="game-btn bg-card text-xs px-3 whitespace-nowrap" disabled={aiBusy}
              onClick={() => aiCaptionOne(active)} title="AI feliratot generál erre a slide-ra">
              {aiBusy ? '…' : '🤖 Auto'}
            </button>
          </div>
          <button className="game-btn bg-card text-xs py-1.5 w-full" disabled={aiBusy} onClick={aiCaptionAll}>
            {aiBusy ? '🤖 Generálás…' : '🤖 Auto-szöveg az összes slide-ra'}
          </button>
          <div className="flex gap-2">
            <select className="game-input flex-1" value={s.emoji} onChange={(e) => update(active, { emoji: e.target.value })}>
              {SLIDE_EMOJIS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <button className="game-btn bg-card flex-1" onClick={() => setImgPickerOpen((v) => !v)}>🖼️ Kép váltása</button>
          </div>
          {imgPickerOpen && (
            <div className="space-y-2 border-t border-border pt-2">
              <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                {PRESET_IMAGES.map((p) => (
                  <button key={p.id} onClick={() => { update(active, { img: p.url }); setImgPickerOpen(false); }}
                    className="aspect-video rounded-lg overflow-hidden border border-border hover:border-primary transition-all">
                    <img src={p.thumb} alt={p.label} className="w-full h-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
              <input className="game-input text-xs" placeholder="Egyéni URL beillesztése..." onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) { update(active, { img: val }); setImgPickerOpen(false); }
                }
              }} />
              <div className="flex gap-2">
                <button className="game-btn bg-card text-xs flex-1" onClick={() => fileRef.current?.click()} disabled={uploadBusy}>
                  {uploadBusy ? 'Töltés...' : '📤 Saját kép feltöltése'}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value=''; }} />
              </div>
            </div>
          )}
        </div>

        <div className="game-card space-y-3">
          <div className="text-xs uppercase text-muted-foreground">🎚️ Audio cue (slide eleje)</div>
          <div>
            <div className="text-xs mb-1 font-bold">Zene</div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => update(active, { musicAtStart: undefined })}
                className={`px-2.5 py-1.5 rounded-lg text-xs border ${s.musicAtStart === undefined ? 'bg-card border-border' : 'bg-card border-border opacity-50'}`}>—</button>
              <button onClick={() => update(active, { musicAtStart: null })}
                className={`px-2.5 py-1.5 rounded-lg text-xs border ${s.musicAtStart === null ? 'bg-destructive/30 border-destructive' : 'bg-card border-border opacity-60'}`}>⏹ stop</button>
              {PRES_MUSIC.map((m) => (
                <button key={m.id} onClick={() => { update(active, { musicAtStart: m.id }); presAudio.playMusic(m.id); }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs border ${s.musicAtStart === m.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button className="game-btn bg-card text-xs py-1.5 px-2" onClick={() => presAudio.stopMusic()}>⏹ Preview stop</button>
            </div>
          </div>
          <div>
            <div className="text-xs mb-1 font-bold">Hangeffekt (több is)</div>
            <div className="flex flex-wrap gap-1.5">
              {PRES_SFX.map((sx) => {
                const active2 = (s.sfxAtStart || []).includes(sx.id);
                return (
                  <button key={sx.id} onClick={() => {
                    const arr = s.sfxAtStart || [];
                    update(active, { sfxAtStart: active2 ? arr.filter((x) => x !== sx.id) : [...arr, sx.id] });
                    presAudio.playSfx(sx.id);
                  }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs border ${active2 ? 'bg-accent text-accent-foreground border-accent' : 'bg-card border-border'}`}>
                    {sx.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-xs mb-1 font-bold">YouTube videó (átfedés a slide elején)</div>
            <input className="game-input text-sm" placeholder="YouTube link vagy ID..."
              defaultValue={s.ytId || ''}
              onBlur={(e) => update(active, { ytId: parseYouTubeId(e.target.value) })} />
            {s.ytId && (
              <>
                <div className="flex gap-2 mt-2">
                  <label className="text-[10px] flex-1">
                    <span className="block text-muted-foreground mb-0.5">⏱️ Start (mp)</span>
                    <input type="number" min={0} className="game-input text-xs"
                      defaultValue={s.ytStart ?? ''}
                      onBlur={(e) => update(active, { ytStart: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })} />
                  </label>
                  <label className="text-[10px] flex-1">
                    <span className="block text-muted-foreground mb-0.5">⏱️ End (mp)</span>
                    <input type="number" min={0} className="game-input text-xs"
                      defaultValue={s.ytEnd ?? ''}
                      onBlur={(e) => update(active, { ytEnd: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })} />
                  </label>
                </div>
                <div className="text-[10px] text-primary mt-1">
                  ✓ ID: {s.ytId}{s.ytStart != null ? ` · ${s.ytStart}s` : ''}{s.ytEnd != null ? ` → ${s.ytEnd}s` : ''}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-muted-foreground">{submittedCount}/{totalCount} segéd megküldte</div>
      {isHost && (
        <button className="game-btn bg-card text-xs py-2 w-full" onClick={onForceStart}>
          ⏭️ Indítás most ({submittedCount}/{totalCount})
        </button>
      )}
    </div>
  );
}

function autoDeck(presenterId: string, helper: Player): Deck {
  return {
    presenterId, helperId: helper.player_id, helperName: helper.username,
    slides: Array.from({ length: 5 }, (_, i) => ({
      emoji: SLIDE_EMOJIS[i % SLIDE_EMOJIS.length],
      caption: ['Bevezetés', 'Probléma', 'Megoldás', 'Demó', 'Köszönöm!'][i] || '...',
      img: PRESET_IMAGES[Math.floor(Math.random() * PRESET_IMAGES.length)].url,
      musicAtStart: i === 0 ? 'dramatic' : undefined,
      sfxAtStart: i === 4 ? ['bell'] : [],
      ytId: null,
    })),
  };
}

// =================================================================
//                        PRES PHASE
// =================================================================

interface PresProps {
  deck: Deck | undefined;
  slideIdx: number; slideTimeLeft: number;
  presenterName: string; presentedTitle: string;
  presenter?: Player; helper?: Player;
  audience: Player[];
  liveScores: Record<string, number>;
  myScore: number;
  isPresenter: boolean; isHelper: boolean;
  playerId: string;
  floatingReacts: { id: number; emoji: string; x: number }[];
  ytOverlay: { id: string; start?: number; end?: number; nonce: number } | null;
  strokes: Stroke[];
  slidesTotal: number;
  onSlider: (v: number) => void;
  onNext: () => void;
  onHelperAudio: (p: { music?: PresMusicId | null; sfx?: PresSfxId; stopMusic?: boolean }) => void;
  onHelperYt: (yt: { ytId: string | null; start?: number; end?: number }) => void;
  onStroke: (s: Stroke) => void;
  onClearStrokes: () => void;
  onEpic: (kind: 'flash' | 'shake' | 'sparkle') => void;
}

function PresPhase(props: PresProps) {
  const {
    deck, slideIdx, slideTimeLeft, presenterName, presentedTitle,
    presenter, helper, audience, liveScores, myScore, isPresenter, isHelper, playerId,
    floatingReacts, ytOverlay, strokes, slidesTotal,
    onSlider, onNext, onHelperAudio, onHelperYt, onStroke, onClearStrokes, onEpic,
  } = props;
  const slide = deck?.slides[slideIdx];
  const [vol, setVol] = useState(() => Math.round(presAudio.getVolume() * 100));
  const [muted, setMuted] = useState(() => presAudio.isMuted());
  const [ytInput, setYtInput] = useState('');
  const [penOn, setPenOn] = useState(false);
  const [penColor, setPenColor] = useState('#ff3b6b');

  function changeVol(v: number) { setVol(v); presAudio.setVolume(v / 100); }
  function toggleMute() { const m = !muted; setMuted(m); presAudio.setMuted(m); }

  const bgGradients = [
    'linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)',
    'linear-gradient(135deg, #48dbfb 0%, #1dd1a1 100%)',
    'linear-gradient(135deg, #5f27cd 0%, #ee5253 100%)',
    'linear-gradient(135deg, #00d2d3 0%, #54a0ff 100%)',
    'linear-gradient(135deg, #feca57 0%, #ff9ff3 100%)',
    'linear-gradient(135deg, #1dd1a1 0%, #5f27cd 100%)',
  ];
  const bg = bgGradients[slideIdx % bgGradients.length];

  // average gauge from live scores
  const audienceIds = audience.map((p) => p.player_id);
  const audienceScores = audienceIds.map((id) => liveScores[id] || 0);
  const avg = audienceScores.length ? audienceScores.reduce((a, b) => a + b, 0) / audienceScores.length : 0;

  // can-draw = helper or presenter
  const canDraw = isHelper || isPresenter;

  return (
    <div className="max-w-7xl mx-auto p-3 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 relative">
      {/* MAIN */}
      <div className="space-y-3">
        <div className="game-card ios-glass text-center py-2 px-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-left">
              {presenter && <Avatar player={presenter} size={36} />}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">prezentál</div>
                <div className="text-base font-extrabold leading-tight">{presenterName}</div>
              </div>
            </div>
            <div className="text-xl md:text-2xl font-extrabold tracking-tight">"{presentedTitle}"</div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted-foreground">slide {slideIdx + 1}/{slidesTotal}</div>
              <div className={`text-base font-bold ${slideTimeLeft <= 5 ? 'text-destructive animate-pulse' : 'text-primary'}`}>⏱️ {slideTimeLeft}mp</div>
            </div>
          </div>
        </div>

        {slide && (
          <div key={slideIdx}
            className="relative rounded-2xl overflow-hidden text-center animate-epic-in shadow-2xl"
            style={{ background: bg, color: '#fff', aspectRatio: '16 / 9', minHeight: 'min(62vh, 70vw)' }}>
            <img src={slide.img} alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
            <div className="animate-epic-streak" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 75%, rgba(0,0,0,0.82) 100%)' }} />
            <div className="relative z-10 flex flex-col items-center justify-end h-full px-4 py-10 md:py-14 space-y-4">
              <div className="text-7xl md:text-9xl animate-spring-in drop-shadow-lg">{slide.emoji}</div>
              <div className="text-3xl md:text-5xl font-extrabold drop-shadow-lg" style={{ textShadow: '0 2px 14px rgba(0,0,0,0.75)' }}>{slide.caption}</div>
            </div>

            {/* drawing layer (always rendered for everyone) */}
            <DrawLayer
              strokes={strokes}
              canDraw={canDraw && penOn}
              color={penColor}
              onStrokeCommit={onStroke}
              fromId={playerId}
            />

            {floatingReacts.map((f) => (
              <div key={f.id} className="absolute bottom-4 text-4xl pointer-events-none animate-float-up"
                style={{ left: `${f.x}%` }}>{f.emoji}</div>
            ))}

            {ytOverlay && (
              <div className="absolute inset-0 bg-black/90 z-30 flex flex-col">
                <iframe key={ytOverlay.nonce} className="flex-1 w-full"
                  src={`https://www.youtube.com/embed/${ytOverlay.id}?autoplay=1&rel=0&playsinline=1&enablejsapi=1${ytOverlay.start != null ? `&start=${ytOverlay.start}` : ''}${ytOverlay.end != null ? `&end=${ytOverlay.end}` : ''}`}
                  title="overlay" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                {isHelper && (
                  <button className="game-btn-primary m-2" onClick={() => onHelperYt({ ytId: null })}>❌ Videó leállítása</button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live audience gauge */}
        <div className="game-card ios-glass space-y-2 py-3 px-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">😬 unalmas</span>
            <span className="font-bold text-primary">élő átlag: {avg.toFixed(1)}</span>
            <span className="text-muted-foreground">epikus 🔥</span>
          </div>
          <div className="relative h-10 bg-muted/60 rounded-full overflow-visible border border-border">
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-foreground/40" />
            {/* avg fill */}
            <div className={`absolute top-0 bottom-0 transition-all ${avg >= 0 ? 'bg-primary/30' : 'bg-destructive/30'}`}
              style={{ left: avg >= 0 ? '50%' : `${50 + avg * 5}%`, width: `${Math.abs(avg) * 5}%` }} />
            {/* per-audience dots with arrows */}
            {audience.map((p) => {
              const v = liveScores[p.player_id] || 0;
              const left = 50 + v * 5;
              const isMe = p.player_id === playerId;
              return (
                <div key={p.player_id}
                  className="absolute -top-2 -translate-x-1/2 transition-all duration-200"
                  style={{ left: `${Math.max(0, Math.min(100, left))}%` }}
                  title={`${p.username}: ${v}`}>
                  <Avatar player={p} size={isMe ? 30 : 22} ring={isMe ? 'ring-2 ring-primary' : ''} />
                  {isMe && <div className="text-[10px] text-primary font-bold text-center mt-0.5">▲</div>}
                </div>
              );
            })}
          </div>
          {!isPresenter && (
            <div className="pt-1">
              <input type="range" min={-10} max={10} step={1} value={myScore}
                onChange={(e) => onSlider(Number(e.target.value))}
                className="w-full accent-primary cursor-grab" />
              <div className="text-[10px] text-center text-muted-foreground">
                Húzd a csúszkát — folyamatosan értékelheted a prezentációt
              </div>
            </div>
          )}
          {isPresenter && (
            <div className="text-[11px] text-center text-muted-foreground">Te prezentálsz — nézd a csúszkákat!</div>
          )}
        </div>

        {isPresenter && (
          <button className="game-btn-primary w-full text-lg py-3" onClick={onNext}>Következő slide ▶️</button>
        )}
      </div>

      {/* SIDE PANEL (helper/audience controls) */}
      <div className="space-y-3">
        {/* Helper avatar header */}
        <div className="game-card ios-glass flex items-center gap-3 py-2 px-3">
          {helper && <Avatar player={helper} size={42} />}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">segéd</div>
            <div className="text-sm font-extrabold">{helper?.username || '?'}</div>
          </div>
        </div>

        {/* Draw controls (anyone who can draw) */}
        {canDraw && (
          <div className="game-card ios-glass space-y-2">
            <div className="text-xs uppercase text-muted-foreground">✏️ Rajz a slide-ra</div>
            <div className="flex flex-wrap gap-2 items-center">
              <button className={`game-btn text-xs px-3 py-2 ${penOn ? 'game-btn-primary' : 'bg-card'}`}
                onClick={() => setPenOn((v) => !v)}>
                {penOn ? '✏️ Toll BE' : '✏️ Toll KI'}
              </button>
              {['#ff3b6b', '#ffd93d', '#1dd1a1', '#54a0ff', '#ffffff'].map((c) => (
                <button key={c} onClick={() => setPenColor(c)}
                  className={`w-7 h-7 rounded-full border-2 ${penColor === c ? 'border-foreground scale-110' : 'border-border'}`}
                  style={{ background: c }} />
              ))}
              <button className="game-btn bg-card text-xs px-3 py-2 ml-auto" onClick={onClearStrokes}>🧽 Törlés</button>
            </div>
          </div>
        )}

        {isHelper && (
          <>
            <div className="game-card ios-glass space-y-2">
              <div className="text-xs uppercase text-muted-foreground">💥 Epikus effekt</div>
              <div className="grid grid-cols-3 gap-1.5">
                <button className="game-btn bg-card text-xs py-2" onClick={() => onEpic('flash')}>⚡ Flash</button>
                <button className="game-btn bg-card text-xs py-2" onClick={() => onEpic('shake')}>🌪️ Shake</button>
                <button className="game-btn bg-card text-xs py-2" onClick={() => onEpic('sparkle')}>✨ Sparkle</button>
              </div>
            </div>

            <div className="game-card ios-glass space-y-3 border-2 border-primary/40">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold">🎛️ Segéd vezérlő</div>
                <div className="flex items-center gap-2">
                  <button onClick={toggleMute} className="game-btn bg-card text-xs py-1 px-2">{muted ? '🔇' : '🔊'}</button>
                  <input type="range" min={0} max={100} value={vol} onChange={(e) => changeVol(Number(e.target.value))} className="w-20" />
                  <span className="text-xs w-8 text-right">{vol}%</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-muted-foreground mb-1">Zene most</div>
                <div className="flex flex-wrap gap-1.5">
                  <button className="px-2 py-1 text-xs rounded-lg bg-card border border-border"
                    onClick={() => onHelperAudio({ stopMusic: true })}>⏹ stop</button>
                  {PRES_MUSIC.map((m) => (
                    <button key={m.id} className="px-2 py-1 text-xs rounded-lg bg-card border border-border hover:border-primary"
                      onClick={() => onHelperAudio({ music: m.id })}>{m.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-muted-foreground mb-1">SFX (nyomd most)</div>
                <div className="flex flex-wrap gap-1.5">
                  {PRES_SFX.map((sx) => (
                    <button key={sx.id} className="px-3 py-1.5 text-sm rounded-lg bg-accent text-accent-foreground hover:scale-105 transition-transform"
                      onClick={() => onHelperAudio({ sfx: sx.id })}>{sx.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-muted-foreground mb-1">YouTube live</div>
                <div className="flex gap-1.5">
                  <input className="game-input text-xs flex-1" placeholder="https://youtu.be/xxx?t=42"
                    value={ytInput} onChange={(e) => setYtInput(e.target.value)} />
                  <button className="game-btn bg-card text-xs px-3"
                    onClick={() => {
                      const id = parseYouTubeId(ytInput);
                      if (!id) return;
                      const start = parseYouTubeTimestamp(ytInput);
                      onHelperYt({ ytId: id, start });
                    }}>▶</button>
                  <button className="game-btn bg-card text-xs px-3" onClick={() => onHelperYt({ ytId: null })}>❌</button>
                </div>
              </div>
            </div>
          </>
        )}

        {!isPresenter && !isHelper && (
          <div className="game-card text-center text-xs text-muted-foreground">
            Te a közönségben vagy. Mozgasd a csúszkát, és figyelj a prezire!
          </div>
        )}
      </div>
    </div>
  );
}

// Small avatar helper
function Avatar({ player, size = 32, ring = '' }: { player: Player; size?: number; ring?: string }) {
  const av = getAvatarDisplay(player.avatar);
  return (
    <div
      className={`rounded-full overflow-hidden border border-border bg-muted flex items-center justify-center ${ring}`}
      style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {av.src ? <img src={av.src} alt="" className="w-full h-full object-cover" /> : av.emoji}
    </div>
  );
}

// =================================================================
// DRAW LAYER - SVG over slide
// =================================================================

function DrawLayer({
  strokes, canDraw, color, onStrokeCommit, fromId,
}: {
  strokes: Stroke[]; canDraw: boolean; color: string; onStrokeCommit: (s: Stroke) => void; fromId: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const drawingRef = useRef(false);

  function toLocal(e: React.PointerEvent) {
    const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 1000,
      y: ((e.clientY - rect.top) / rect.height) * 562, // 16:9
    };
  }

  function pointerDown(e: React.PointerEvent) {
    if (!canDraw) return;
    e.preventDefault(); e.stopPropagation();
    drawingRef.current = true;
    const p = toLocal(e);
    setCurrent({ from: fromId, color, w: 4, pts: [p] });
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch {}
  }
  function pointerMove(e: React.PointerEvent) {
    if (!drawingRef.current || !current) return;
    const p = toLocal(e);
    setCurrent({ ...current, pts: [...current.pts, p] });
  }
  function pointerUp() {
    if (!drawingRef.current || !current) return;
    drawingRef.current = false;
    if (current.pts.length > 1) onStrokeCommit(current);
    setCurrent(null);
  }

  function pathFor(s: Stroke) {
    return s.pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
  }

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1000 562"
      preserveAspectRatio="none"
      className={`absolute inset-0 w-full h-full z-20 ${canDraw ? 'pen-cursor' : 'pointer-events-none'}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerLeave={pointerUp}
    >
      {strokes.map((s, i) => (
        <path key={i} d={pathFor(s)} stroke={s.color} strokeWidth={s.w} fill="none"
          strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${s.color})` }} />
      ))}
      {current && (
        <path d={pathFor(current)} stroke={current.color} strokeWidth={current.w} fill="none"
          strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${current.color})` }} />
      )}
    </svg>
  );
}
