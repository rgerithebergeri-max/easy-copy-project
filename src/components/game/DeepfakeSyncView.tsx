import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings } from '@/lib/gameTypes';
import { parseYouTubeId, PRES_MUSIC, PRES_SFX, presAudio } from '@/lib/presentationAudio';
import { YT_CATALOG, YT_CATEGORIES, searchCatalog, YtCatalogItem } from '@/lib/deepfakeCatalog';
import { getAvatarDisplay } from '@/lib/avatars';
import { playClick, playNotification, playPop } from '@/lib/sounds';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

type Phase = 'submit' | 'record' | 'album' | 'end';
type Submission = { pid: string; name: string; videoId: string; title?: string };
type Assignment = { performerId: string; performerName: string; videoId: string; submitterName: string };
type Recording = {
  performerId: string;
  performerName: string;
  videoId: string;
  audioUrl: string;
  sfxEvents: { t: number; sfxId: string }[];
  musicId?: string | null;
};

const REACTIONS = ['😂', '🔥', '🤯', '👏', '💀', '🎤'];

export default function DeepfakeSyncView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const recordSeconds = settings.deepfakeRoundTime ?? 45;

  const channelRef = useRef<any>(null);
  const [phase, setPhase] = useState<Phase>('submit');

  // ---------- SUBMIT phase state ----------
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [linkInput, setLinkInput] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCat, setCatalogCat] = useState<string>('all');
  const [submitted, setSubmitted] = useState(false);

  // ---------- RECORD phase state ----------
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const myAssignment = useMemo(
    () => assignments.find((a) => a.performerId === playerId) || null,
    [assignments, playerId],
  );
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [micGranted, setMicGranted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [myRecordingUrl, setMyRecordingUrl] = useState<string | null>(null);
  const [myUploaded, setMyUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [myMusic, setMyMusic] = useState<string | null>(null);
  const [mySfxEvents, setMySfxEvents] = useState<{ t: number; sfxId: string }[]>([]);
  const [completedRecorders, setCompletedRecorders] = useState<Set<string>>(new Set());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef<number>(0);
  const recTimerRef = useRef<number | null>(null);
  const ytPreviewRef = useRef<HTMLIFrameElement | null>(null);

  // ---------- ALBUM phase state ----------
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [albumIdx, setAlbumIdx] = useState(0);
  const [albumTimeLeft, setAlbumTimeLeft] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [myRating, setMyRating] = useState<number | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [floats, setFloats] = useState<{ id: string; emoji: string; x: number; y: number }[]>([]);
  const albumAudioRef = useRef<HTMLAudioElement | null>(null);
  const albumSfxTimersRef = useRef<number[]>([]);

  // ============== CHANNEL ==============
  useEffect(() => {
    const ch = supabase.channel(`deepfake-${code}`, { config: { broadcast: { self: false } } });

    ch.on('broadcast', { event: 'submit' }, ({ payload }) => {
      setSubmissions((s) => ({ ...s, [payload.pid]: payload }));
    });
    ch.on('broadcast', { event: 'request-state' }, ({ payload }) => {
      // host re-broadcasts current submissions to late joiner
      if (!isHost) return;
      Object.values(submissionsRef.current).forEach((sub) =>
        ch.send({ type: 'broadcast', event: 'submit', payload: sub }),
      );
    });
    ch.on('broadcast', { event: 'start-record' }, ({ payload }) => {
      setAssignments(payload.assignments);
      setPhase('record');
      setCompletedRecorders(new Set());
      playNotification();
    });
    ch.on('broadcast', { event: 'recorder-done' }, ({ payload }) => {
      setCompletedRecorders((s) => {
        const n = new Set(s); n.add(payload.performerId); return n;
      });
    });
    ch.on('broadcast', { event: 'start-album' }, ({ payload }) => {
      setRecordings(payload.recordings);
      setAlbumIdx(0);
      setPhase('album');
      setMyRating(null);
      setRatings({});
      playNotification();
    });
    ch.on('broadcast', { event: 'album-next' }, ({ payload }) => {
      setAlbumIdx(payload.idx);
      setScores(payload.scores);
      setMyRating(null);
      setRatings({});
      if (payload.idx >= payload.total) setPhase('end');
    });
    ch.on('broadcast', { event: 'rating' }, ({ payload }) => {
      setRatings((r) => ({ ...r, [payload.pid]: payload.score }));
    });
    ch.on('broadcast', { event: 'reaction' }, ({ payload }) => {
      const f = { id: crypto.randomUUID(), emoji: payload.emoji, x: 10 + Math.random() * 80, y: 60 + Math.random() * 30 };
      setFloats((s) => [...s, f]);
      setTimeout(() => setFloats((s) => s.filter((x) => x.id !== f.id)), 2400);
      playPop();
    });

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // request current state from host
        ch.send({ type: 'broadcast', event: 'request-state', payload: { pid: playerId } });
      }
    });
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); cleanupStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const submissionsRef = useRef(submissions);
  useEffect(() => { submissionsRef.current = submissions; }, [submissions]);

  // ============== SUBMIT ==============
  function submitWith(videoId: string, title?: string) {
    if (submitted) return;
    const sub: Submission = { pid: playerId, name: username, videoId, title };
    setSubmissions((s) => ({ ...s, [playerId]: sub }));
    channelRef.current?.send({ type: 'broadcast', event: 'submit', payload: sub });
    setSubmitted(true);
    playClick();
  }
  function submitLink() {
    const id = parseYouTubeId(linkInput);
    if (!id) { alert('Érvénytelen YouTube link!'); return; }
    submitWith(id);
  }

  function startRecordPhase() {
    if (!isHost) return;
    const subs = Object.values(submissions);
    if (subs.length < 1) return;
    // assign: each player gets a video that is NOT theirs (if possible)
    const shuffled = [...subs].sort(() => Math.random() - 0.5);
    const assigns: Assignment[] = players.map((p, i) => {
      let v = shuffled[i % shuffled.length];
      if (v.pid === p.player_id && shuffled.length > 1) {
        v = shuffled[(i + 1) % shuffled.length];
      }
      return {
        performerId: p.player_id,
        performerName: p.username,
        videoId: v.videoId,
        submitterName: v.name,
      };
    });
    channelRef.current?.send({
      type: 'broadcast', event: 'start-record',
      payload: { assignments: assigns },
    });
    setAssignments(assigns);
    setPhase('record');
  }

  // ============== RECORD ==============
  async function enumerateMics() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const mics = devs.filter((d) => d.kind === 'audioinput');
      setMicDevices(mics);
      if (mics.length && !selectedMic) setSelectedMic(mics[0].deviceId);
    } catch (e) { console.warn(e); }
  }

  async function requestMic() {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMic
          ? { deviceId: { exact: selectedMic }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
      });
      // drop preview stream — we only wanted permission for enumerate
      stream.getTracks().forEach((t) => t.stop());
      setMicGranted(true);
      await enumerateMics();
    } catch (err: any) {
      if (err.name === 'NotAllowedError') setMicError('Mikrofon hozzáférés megtagadva.');
      else if (err.name === 'NotFoundError') setMicError('Nincs mikrofon.');
      else setMicError('Mikrofon hiba: ' + err.message);
    }
  }

  function cleanupStream() {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    presAudio.stopMusic();
    presAudio.setDucked(false);
  }

  async function startRecording() {
    if (!myAssignment) return;
    setMicError(null);
    chunksRef.current = [];
    setMySfxEvents([]);
    setMyRecordingUrl(null);
    setMyUploaded(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMic
          ? { deviceId: { exact: selectedMic }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setMyRecordingUrl(url);
        setIsRecording(false);
        if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
        // stop background music
        presAudio.stopMusic();
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      recStartRef.current = Date.now();
      setIsRecording(true);
      setRecElapsed(0);
      recTimerRef.current = window.setInterval(() => {
        const el = (Date.now() - recStartRef.current) / 1000;
        setRecElapsed(el);
        if (el >= recordSeconds) stopRecording();
      }, 100);
      // start music if selected (will be audible to user — but we record only mic, so it won't be in audio file unless system loopback). Music in album phase is added separately.
      if (myMusic) presAudio.playMusic(myMusic as any);
    } catch (err: any) {
      setMicError(err.message || 'Mikrofon hiba');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    presAudio.stopMusic();
  }

  function triggerSfx(sfxId: string) {
    if (!isRecording) return;
    const t = (Date.now() - recStartRef.current) / 1000;
    setMySfxEvents((s) => [...s, { t, sfxId }]);
    presAudio.playSfx(sfxId as any);
  }

  function resetMyRecording() {
    setMyRecordingUrl(null);
    setMySfxEvents([]);
    setMyUploaded(false);
  }

  async function uploadMyRecording() {
    if (!myRecordingUrl || !myAssignment) return;
    setUploading(true);
    try {
      const blob = await fetch(myRecordingUrl).then((r) => r.blob());
      const path = `deepfake/${code}/${playerId}-${Date.now()}.webm`;
      const { error } = await supabase.storage.from('pres-uploads').upload(path, blob, {
        contentType: blob.type || 'audio/webm', upsert: true,
      });
      if (error) throw error;
      const { data } = supabase.storage.from('pres-uploads').getPublicUrl(path);
      const rec: Recording = {
        performerId: playerId,
        performerName: username,
        videoId: myAssignment.videoId,
        audioUrl: data.publicUrl,
        sfxEvents: mySfxEvents,
        musicId: myMusic,
      };
      channelRef.current?.send({ type: 'broadcast', event: 'recorder-done', payload: { ...rec, performerId: playerId } });
      setCompletedRecorders((s) => { const n = new Set(s); n.add(playerId); return n; });
      // host stores it
      hostRecordingsRef.current[playerId] = rec;
      setMyUploaded(true);
      playClick();
    } catch (e: any) {
      alert('Feltöltés sikertelen: ' + e.message);
    } finally {
      setUploading(false);
    }
  }

  // host collects all recordings
  const hostRecordingsRef = useRef<Record<string, Recording>>({});
  useEffect(() => {
    if (!isHost) return;
    const ch = channelRef.current;
    if (!ch) return;
    const handler = ({ payload }: any) => {
      hostRecordingsRef.current[payload.performerId] = {
        performerId: payload.performerId,
        performerName: payload.performerName,
        videoId: payload.videoId,
        audioUrl: payload.audioUrl,
        sfxEvents: payload.sfxEvents || [],
        musicId: payload.musicId || null,
      };
    };
    ch.on('broadcast', { event: 'recorder-done' }, handler);
    return () => {};
  }, [isHost]);

  function startAlbum() {
    if (!isHost) return;
    const recs = Object.values(hostRecordingsRef.current);
    if (!recs.length) { alert('Nincs egy felvétel sem!'); return; }
    // shuffle for fun
    const shuffled = [...recs].sort(() => Math.random() - 0.5);
    channelRef.current?.send({
      type: 'broadcast', event: 'start-album', payload: { recordings: shuffled },
    });
    setRecordings(shuffled); setPhase('album'); setAlbumIdx(0);
  }

  // ============== ALBUM PLAYBACK ==============
  const currentRec = recordings[albumIdx];
  const isMyTurn = currentRec?.performerId === playerId;

  useEffect(() => {
    if (phase !== 'album' || !currentRec) return;
    // play recorded audio
    const a = new Audio(currentRec.audioUrl);
    a.volume = 1;
    albumAudioRef.current = a;
    a.play().catch(() => {});
    // schedule SFX
    albumSfxTimersRef.current.forEach((id) => clearTimeout(id));
    albumSfxTimersRef.current = currentRec.sfxEvents.map((ev) =>
      window.setTimeout(() => presAudio.playSfx(ev.sfxId as any), ev.t * 1000),
    );
    // background music
    if (currentRec.musicId) {
      presAudio.setVolume(0.3);
      presAudio.playMusic(currentRec.musicId as any);
    }
    // playback timer (use recordSeconds as max)
    setAlbumTimeLeft(recordSeconds + 5);
    const timer = window.setInterval(() => {
      setAlbumTimeLeft((s) => {
        if (s <= 1) { clearInterval(timer); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => {
      try { a.pause(); } catch {}
      albumSfxTimersRef.current.forEach((id) => clearTimeout(id));
      albumSfxTimersRef.current = [];
      presAudio.stopMusic();
      clearInterval(timer);
    };
  }, [phase, albumIdx, currentRec, recordSeconds]);

  function sendRating(score: number) {
    if (isMyTurn || myRating !== null) return;
    setMyRating(score);
    setRatings((r) => ({ ...r, [playerId]: score }));
    channelRef.current?.send({ type: 'broadcast', event: 'rating', payload: { pid: playerId, score } });
  }
  function sendReaction(emoji: string) {
    channelRef.current?.send({ type: 'broadcast', event: 'reaction', payload: { emoji } });
  }
  function nextAlbumSlide() {
    if (!isHost || !currentRec) return;
    const ratingValues = Object.values(ratings);
    const avg = ratingValues.length ? Math.round(ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length * 20) : 0;
    const newScores = { ...scores, [currentRec.performerId]: (scores[currentRec.performerId] || 0) + avg };
    const nextIdx = albumIdx + 1;
    channelRef.current?.send({
      type: 'broadcast', event: 'album-next',
      payload: { idx: nextIdx, total: recordings.length, scores: newScores },
    });
    setScores(newScores); setAlbumIdx(nextIdx);
    if (nextIdx >= recordings.length) setPhase('end');
  }

  // ============== RENDER ==============
  if (phase === 'submit') return renderSubmit();
  if (phase === 'record') return renderRecord();
  if (phase === 'album') return renderAlbum();
  return renderEnd();

  // ------------- SUBMIT UI -------------
  function renderSubmit() {
    const submittedCount = Object.keys(submissions).length;
    const filtered = searchCatalog(catalogQuery, catalogCat);
    return (
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        <div className="game-card text-center py-3">
          <h2 className="text-3xl neon-text-magenta animate-flicker">🎤 DEEPFAKE SZINKRON</h2>
          <p className="text-sm text-muted-foreground">
            Válassz YouTube videót a katalógusból vagy paste-elj sajátot. Mindenki kap egy randomot, amit némán le kell SZINKRONIZÁLNI mikrofonnal!
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 game-card p-3 space-y-2">
            <div className="flex gap-2">
              <input
                className="game-input flex-1"
                placeholder="🔎 Keresés a katalógusban..."
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
              />
              <select
                className="game-input"
                value={catalogCat}
                onChange={(e) => setCatalogCat(e.target.value)}
              >
                {YT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[55vh] overflow-y-auto pr-1">
              {filtered.map((it) => (
                <button
                  key={it.id}
                  onClick={() => submitWith(it.id, it.title)}
                  disabled={submitted}
                  className="cyber-panel p-2 text-left hover:scale-[1.02] transition disabled:opacity-40"
                >
                  <img
                    src={`https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`}
                    className="w-full aspect-video object-cover rounded mb-1"
                    alt=""
                    loading="lazy"
                  />
                  <div className="text-xs font-bold line-clamp-2">{it.title}</div>
                </button>
              ))}
              {!filtered.length && <p className="col-span-3 text-center text-muted-foreground text-sm">Nincs találat.</p>}
            </div>
            <div className="flex gap-2 pt-2 border-t border-border/30">
              <input
                className="game-input flex-1"
                placeholder="vagy: paste YouTube link..."
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                disabled={submitted}
              />
              <button className="game-btn-primary" onClick={submitLink} disabled={submitted || !linkInput.trim()}>
                {submitted ? '✅' : 'BEKÜLD'}
              </button>
            </div>
          </div>

          <div className="game-card p-3 space-y-2">
            <h3 className="font-bold text-sm">Játékosok ({submittedCount}/{players.length})</h3>
            <div className="space-y-1 max-h-[55vh] overflow-y-auto">
              {players.map((p) => {
                const av = getAvatarDisplay(p.avatar);
                const sub = submissions[p.player_id];
                return (
                  <div key={p.player_id} className={`player-slot ${sub ? 'border-primary' : 'opacity-70'}`}>
                    {av.src ? <img src={av.src} className="w-8 h-8 rounded-lg" alt="" />
                      : <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-card">{av.emoji}</span>}
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">{p.username}</div>
                      {sub?.title && <div className="text-[10px] text-muted-foreground truncate">{sub.title}</div>}
                    </div>
                    <span className={sub ? 'text-primary' : 'text-muted-foreground'}>{sub ? '✅' : '⏳'}</span>
                  </div>
                );
              })}
            </div>
            {isHost && (
              <button
                className="game-btn-primary w-full text-lg animate-pulse-glow"
                onClick={startRecordPhase}
                disabled={Object.keys(submissions).length < 1}
              >▶️ INDÍTÁS</button>
            )}
            {!isHost && <p className="text-xs text-center text-muted-foreground">Várj a hostra...</p>}
          </div>
        </div>
      </div>
    );
  }

  // ------------- RECORD UI -------------
  function renderRecord() {
    if (!myAssignment) {
      return <div className="game-card max-w-xl mx-auto m-4 p-4 text-center">Várakozás kiosztásra...</div>;
    }
    const ytSrc = `https://www.youtube.com/embed/${myAssignment.videoId}?autoplay=${isRecording ? 1 : 0}&mute=1&controls=1&modestbranding=1&rel=0&playsinline=1`;
    const allDone = completedRecorders.size >= players.length;
    return (
      <div className="max-w-6xl mx-auto p-3 space-y-3">
        <div className="game-card flex items-center justify-between py-2 px-4">
          <div>
            <div className="text-xs text-muted-foreground">A te videód ({myAssignment.submitterName} küldte)</div>
            <div className="font-bold text-lg neon-text">🎬 Szinkronizáld!</div>
          </div>
          <div className="text-sm">Készen: {completedRecorders.size}/{players.length}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 space-y-2">
            <div className="album-slide aspect-video relative">
              <iframe
                ref={ytPreviewRef}
                key={myAssignment.videoId}
                src={ytSrc}
                className="absolute inset-0 w-full h-full"
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
              {isRecording && (
                <div className="absolute top-2 left-2 bg-destructive text-white px-3 py-1 rounded-full font-bold text-sm animate-pulse">
                  🔴 REC {recElapsed.toFixed(1)}s / {recordSeconds}s
                </div>
              )}
            </div>

            {/* SFX bar */}
            <div className="game-card p-2">
              <div className="text-xs font-bold mb-1">🔊 Hangeffekt katalógus (kattints felvétel közben):</div>
              <div className="flex gap-2 flex-wrap">
                {PRES_SFX.map((s) => (
                  <button key={s.id}
                    className="game-btn-secondary text-sm px-3 py-2"
                    onClick={() => triggerSfx(s.id)}
                    disabled={!isRecording}
                  >{s.label}</button>
                ))}
              </div>
            </div>

            {/* Music selector */}
            <div className="game-card p-2">
              <div className="text-xs font-bold mb-1">🎵 Háttérzene (album lejátszáskor szól):</div>
              <div className="flex gap-2 flex-wrap">
                <button className={`game-btn ${myMusic === null ? 'game-btn-magenta' : 'game-btn-secondary'} text-sm`}
                  onClick={() => setMyMusic(null)}>🔇 Nincs</button>
                {PRES_MUSIC.map((m) => (
                  <button key={m.id}
                    className={`game-btn ${myMusic === m.id ? 'game-btn-magenta' : 'game-btn-secondary'} text-sm`}
                    onClick={() => setMyMusic(m.id)}
                  >{m.label}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="game-card p-3 space-y-2">
              <h3 className="font-bold text-sm">🎙️ Mikrofon</h3>
              {!micGranted ? (
                <button className="game-btn-primary w-full" onClick={requestMic}>🎤 Mikrofon engedélyezése</button>
              ) : (
                <select
                  className="game-input w-full text-xs"
                  value={selectedMic}
                  onChange={(e) => setSelectedMic(e.target.value)}
                  disabled={isRecording}
                >
                  {micDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mikrofon ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              )}
              {micError && <p className="text-xs text-destructive">{micError}</p>}

              {!isRecording && !myRecordingUrl && micGranted && (
                <button className="game-btn-primary w-full animate-pulse-glow" onClick={startRecording}>
                  🔴 FELVÉTEL ({recordSeconds}s)
                </button>
              )}
              {isRecording && (
                <button className="game-btn w-full bg-destructive" onClick={stopRecording}>
                  ⏹ STOP
                </button>
              )}
              {myRecordingUrl && !myUploaded && (
                <>
                  <audio src={myRecordingUrl} controls className="w-full" />
                  <div className="text-xs text-muted-foreground">SFX-ek: {mySfxEvents.length}</div>
                  <div className="flex gap-2">
                    <button className="game-btn-secondary flex-1" onClick={resetMyRecording}>↺ Újra</button>
                    <button className="game-btn-primary flex-1" onClick={uploadMyRecording} disabled={uploading}>
                      {uploading ? '⏳' : '✅ KÉSZ'}
                    </button>
                  </div>
                </>
              )}
              {myUploaded && (
                <div className="text-center text-primary font-bold">✅ Beküldve! Várj a többiekre...</div>
              )}
            </div>

            <div className="game-card p-3">
              <h3 className="font-bold text-sm mb-2">Készenléti lista</h3>
              <div className="space-y-1 max-h-[35vh] overflow-y-auto">
                {players.map((p) => {
                  const av = getAvatarDisplay(p.avatar);
                  const done = completedRecorders.has(p.player_id);
                  return (
                    <div key={p.player_id} className={`player-slot ${done ? 'border-primary' : 'opacity-70'}`}>
                      {av.src ? <img src={av.src} className="w-7 h-7 rounded-lg" alt="" />
                        : <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-card text-sm">{av.emoji}</span>}
                      <span className="flex-1 text-sm truncate">{p.username}</span>
                      <span>{done ? '✅' : '🎙️'}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {isHost && (
              <button
                className="game-btn-primary w-full"
                onClick={startAlbum}
                disabled={completedRecorders.size === 0}
              >
                🎬 ALBUM INDÍTÁS ({completedRecorders.size})
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ------------- ALBUM UI -------------
  function renderAlbum() {
    if (!currentRec) return <div className="game-card m-4 p-4 text-center">Betöltés...</div>;
    const performer = players.find((p) => p.player_id === currentRec.performerId);
    const av = performer ? getAvatarDisplay(performer.avatar) : null;
    // mute YT — we play recorded audio over it
    const ytSrc = `https://www.youtube.com/embed/${currentRec.videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1`;
    return (
      <div className="max-w-5xl mx-auto p-3 space-y-3">
        <div className="game-card flex items-center justify-between py-2 px-4">
          <div className="flex items-center gap-3">
            {av?.src ? <img src={av.src} className="w-10 h-10 rounded-lg" alt="" />
              : <span className="w-10 h-10 rounded-lg flex items-center justify-center bg-card text-xl">{av?.emoji}</span>}
            <div>
              <div className="text-xs text-muted-foreground">SZINKRON</div>
              <div className="font-bold text-lg">{currentRec.performerName}{isMyTurn && ' (TE!)'}</div>
            </div>
          </div>
          <div className="text-sm">{albumIdx + 1}/{recordings.length}</div>
          <div className="font-bold text-2xl neon-text">⏱ {albumTimeLeft}s</div>
        </div>

        <div className="relative album-slide aspect-video">
          <iframe
            key={currentRec.videoId + albumIdx}
            src={ytSrc}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
          {floats.map((f) => (
            <span key={f.id} className="absolute text-4xl animate-float-up pointer-events-none"
              style={{ left: `${f.x}%`, top: `${f.y}%` }}>{f.emoji}</span>
          ))}
        </div>

        <div className="flex justify-center gap-2 flex-wrap">
          {REACTIONS.map((e) => (
            <button key={e} className="game-btn-secondary text-2xl py-1 px-3" onClick={() => sendReaction(e)}>{e}</button>
          ))}
        </div>

        <div className="game-card text-center space-y-2 p-3">
          <h3 className="text-lg font-bold neon-text-magenta">⭐ ÉRTÉKELD!</h3>
          {isMyTurn ? (
            <p className="text-muted-foreground text-sm">Várjuk a játékosok pontjait...</p>
          ) : (
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n}
                  className={`game-btn ${myRating === n ? 'game-btn-magenta' : 'game-btn-secondary'} text-xl`}
                  onClick={() => sendRating(n)} disabled={myRating !== null}
                >{'⭐'.repeat(n)}</button>
              ))}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Pontok: {Object.keys(ratings).length}/{Math.max(0, players.length - 1)}
          </div>
          {isHost && (
            <button className="game-btn-primary w-full" onClick={nextAlbumSlide}>
              {albumIdx + 1 >= recordings.length ? '🏆 EREDMÉNY' : '➡️ KÖVETKEZŐ'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ------------- END UI -------------
  function renderEnd() {
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-3">
        <h2 className="text-3xl text-center neon-text-magenta animate-flicker">🏆 EREDMÉNY</h2>
        {sorted.map(([pid, sc], i) => {
          const p = players.find((x) => x.player_id === pid);
          const av = p ? getAvatarDisplay(p.avatar) : null;
          return (
            <div key={pid} className="player-slot animate-slide-in" style={{ animationDelay: `${i * 80}ms` }}>
              <span className="text-2xl w-8 text-center">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}</span>
              {av?.src ? <img src={av.src} className="w-10 h-10 rounded-lg" alt="" />
                : <span className="w-10 h-10 rounded-lg flex items-center justify-center bg-card text-xl">{av?.emoji}</span>}
              <span className="font-bold flex-1">{p?.username || 'Játékos'}</span>
              <span className="neon-text font-bold text-xl">{sc}</span>
            </div>
          );
        })}
        {isHost && <button className="game-btn-primary w-full" onClick={onFinish}>🔄 ÚJ JÁTÉK</button>}
      </div>
    );
  }
}
