import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings } from '@/lib/gameTypes';
import { playClick, playNotification, playPop, playSubmit } from '@/lib/sounds';

interface Props {
  code: string; players: Player[]; playerId: string; username: string;
  isHost: boolean; settings: GameSettings; onFinish: () => void;
}

type LatLng = { lat: number; lng: number };
type Loc = { id: string; lat: number; lng: number };
type Guess = { playerId: string; username: string; lat: number; lng: number; distance: number; score: number };
type Phase = 'loading' | 'guessing' | 'reveal' | 'end';

declare global { interface Window { google?: any; __initGeoMaps?: () => void; __geoMapsLoaded?: boolean; } }

// ============ Google Maps loader ============
let mapsPromise: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (mapsPromise) return mapsPromise;
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve();
  mapsPromise = new Promise<void>((resolve, reject) => {
    const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
    const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
    if (!key) return reject(new Error('Missing Google Maps key'));
    window.__initGeoMaps = () => { window.__geoMapsLoaded = true; resolve(); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__initGeoMaps&channel=${channel ?? ''}`;
    s.async = true; s.defer = true; s.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(s);
  });
  return mapsPromise;
}

// ============ Random location finder (uses StreetViewService) ============
// Pool of broad regions known to have street view. We pick a random region, then a random point inside,
// then ask the StreetViewService for the nearest pano within a radius.
const REGIONS: { name: string; latMin: number; latMax: number; lngMin: number; lngMax: number }[] = [
  { name: 'Europe', latMin: 36, latMax: 60, lngMin: -10, lngMax: 30 },
  { name: 'USA', latMin: 26, latMax: 48, lngMin: -123, lngMax: -73 },
  { name: 'Japan', latMin: 31, latMax: 43, lngMin: 130, lngMax: 144 },
  { name: 'Brazil', latMin: -30, latMax: -5, lngMin: -58, lngMax: -38 },
  { name: 'SE Asia', latMin: -5, latMax: 22, lngMin: 95, lngMax: 130 },
  { name: 'Australia', latMin: -38, latMax: -22, lngMin: 115, lngMax: 153 },
  { name: 'Mexico', latMin: 16, latMax: 31, lngMin: -110, lngMax: -88 },
  { name: 'Argentina', latMin: -45, latMax: -25, lngMin: -72, lngMax: -58 },
  { name: 'South Africa', latMin: -34, latMax: -25, lngMin: 18, lngMax: 32 },
  { name: 'Turkey', latMin: 36, latMax: 41, lngMin: 27, lngMax: 44 },
  { name: 'UK', latMin: 50, latMax: 58, lngMin: -6, lngMax: 1 },
  { name: 'Canada', latMin: 43, latMax: 55, lngMin: -125, lngMax: -65 },
];

async function findRandomStreetViewLoc(svc: any, maxTries = 15): Promise<LatLng> {
  for (let i = 0; i < maxTries; i++) {
    const r = REGIONS[Math.floor(Math.random() * REGIONS.length)];
    const lat = r.latMin + Math.random() * (r.latMax - r.latMin);
    const lng = r.lngMin + Math.random() * (r.lngMax - r.lngMin);
    const found = await new Promise<LatLng | null>((resolve) => {
      svc.getPanorama({ location: { lat, lng }, radius: 50000, source: 'outdoor' }, (data: any, status: any) => {
        if (status === 'OK' && data?.location?.latLng) {
          resolve({ lat: data.location.latLng.lat(), lng: data.location.latLng.lng() });
        } else resolve(null);
      });
    });
    if (found) return found;
  }
  // fallback: a known place
  return { lat: 48.8584, lng: 2.2945 };
}

function haversine(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function scoreForDistance(km: number) { return Math.max(0, Math.round(5000 * Math.exp(-km / 2000))); }

export default function GeoGuesserView({ code, players, playerId, username, isHost, settings, onFinish }: Props) {
  const totalRounds = Math.max(1, Math.min(10, settings.geoRounds ?? 5));
  const roundTime = Math.max(20, Math.min(180, settings.geoTime ?? 90));

  const channelRef = useRef<any>(null);
  const panoDivRef = useRef<HTMLDivElement>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const resultMapDivRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const guessMarkerRef = useRef<any>(null);
  const svcRef = useRef<any>(null);
  const resultMapRef = useRef<any>(null);

  const [mapsReady, setMapsReady] = useState(false);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loc, setLoc] = useState<Loc | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [timeLeft, setTimeLeft] = useState(roundTime);
  const [myGuess, setMyGuess] = useState<LatLng | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const guessesRef = useRef<Guess[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const scoresRef = useRef<Record<string, number>>({});
  const [mapExpanded, setMapExpanded] = useState(false);

  useEffect(() => { guessesRef.current = guesses; }, [guesses]);
  useEffect(() => { scoresRef.current = scores; }, [scores]);

  // Load Google Maps once
  useEffect(() => {
    loadMaps().then(() => { svcRef.current = new window.google.maps.StreetViewService(); setMapsReady(true); })
      .catch((e) => console.error('Maps load failed', e));
  }, []);

  // Setup channel
  useEffect(() => {
    const ch = supabase.channel(`geo-${code}`);
    ch.on('broadcast', { event: 'geo:round' }, ({ payload }) => {
      applyRoundStart(payload.round, payload.loc, payload.deadline);
    });
    ch.on('broadcast', { event: 'geo:guess' }, ({ payload }) => {
      setGuesses((all) => {
        if (all.find((g) => g.playerId === payload.playerId)) return all;
        const next = [...all, payload as Guess]; guessesRef.current = next;
        if (isHost && next.length >= players.length) setTimeout(() => hostReveal(next), 400);
        return next;
      });
      playPop();
    });
    ch.on('broadcast', { event: 'geo:reveal' }, ({ payload }) => {
      setGuesses(payload.guesses); setScores(payload.scores); scoresRef.current = payload.scores;
      setPhase('reveal'); playSubmit();
    });
    ch.on('broadcast', { event: 'geo:end' }, ({ payload }) => { setScores(payload.scores); setPhase('end'); });
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED' && isHost && round === 0 && !loc) {
        // wait for maps
        const tryStart = () => {
          if (svcRef.current) hostStartRound(1);
          else setTimeout(tryStart, 300);
        };
        setTimeout(tryStart, 500);
      }
    });
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function hostStartRound(idx: number) {
    if (!svcRef.current) return;
    const p = await findRandomStreetViewLoc(svcRef.current);
    const l: Loc = { id: `r${idx}-${Date.now()}`, lat: p.lat, lng: p.lng };
    const d = Date.now() + roundTime * 1000;
    channelRef.current?.send({ type: 'broadcast', event: 'geo:round', payload: { round: idx, loc: l, deadline: d } });
    applyRoundStart(idx, l, d);
  }

  function applyRoundStart(idx: number, l: Loc, d: number) {
    setRound(idx); setLoc(l); setDeadline(d); setPhase('guessing');
    setMyGuess(null); setSubmitted(false); setGuesses([]); guessesRef.current = [];
    playNotification();
  }

  function hostReveal(currentGuesses?: Guess[]) {
    const gs = currentGuesses || guessesRef.current;
    const filled = players.map((p) => {
      const g = gs.find((x) => x.playerId === p.player_id);
      return g || ({ playerId: p.player_id, username: p.username, lat: 0, lng: 0, distance: 99999, score: 0 } as Guess);
    });
    const next = { ...scoresRef.current };
    filled.forEach((g) => { next[g.playerId] = (next[g.playerId] || 0) + g.score; });
    scoresRef.current = next;
    channelRef.current?.send({ type: 'broadcast', event: 'geo:reveal', payload: { guesses: filled, scores: next } });
    setGuesses(filled); setScores(next); setPhase('reveal');
  }

  // timer
  useEffect(() => {
    if (phase !== 'guessing' || !deadline) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) { clearInterval(t); if (isHost) setTimeout(() => hostReveal(), 400); }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deadline, isHost]);

  // ===== Init StreetViewPanorama when a new round starts =====
  useEffect(() => {
    if (!mapsReady || phase !== 'guessing' || !loc || !panoDivRef.current) return;
    const g = window.google;
    // Always create a fresh panorama for each round so old DOM never leaks
    try { panoRef.current?.setVisible?.(false); } catch {}
    panoDivRef.current.innerHTML = '';
    panoRef.current = new g.maps.StreetViewPanorama(panoDivRef.current, {
        position: { lat: loc.lat, lng: loc.lng },
        pov: { heading: Math.random() * 360, pitch: 0 },
        zoom: 0,
        addressControl: false,
        showRoadLabels: false,
        linksControl: true,
        panControl: true,
        zoomControl: true,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        enableCloseButton: false,
    });
  }, [mapsReady, phase, loc?.id]);

  // ===== Hard cleanup: kill the panorama whenever we leave the guessing phase =====
  useEffect(() => {
    if (phase === 'guessing') return;
    try { panoRef.current?.setVisible?.(false); } catch {}
    panoRef.current = null;
    if (panoDivRef.current) panoDivRef.current.innerHTML = '';
    if (mapRef.current) {
      mapRef.current = null;
    }
    if (guessMarkerRef.current) {
      try { guessMarkerRef.current.setMap(null); } catch {}
      guessMarkerRef.current = null;
    }
  }, [phase]);

  // Unmount-time cleanup
  useEffect(() => () => {
    try { panoRef.current?.setVisible?.(false); } catch {}
    panoRef.current = null;
  }, []);

  // ===== Init guessing mini-map =====
  useEffect(() => {
    if (!mapsReady || phase !== 'guessing' || !mapDivRef.current) return;
    const g = window.google;
    if (!mapRef.current) {
      mapRef.current = new g.maps.Map(mapDivRef.current, {
        center: { lat: 20, lng: 0 }, zoom: 1, streetViewControl: false, fullscreenControl: false,
        mapTypeControl: false, gestureHandling: 'greedy', minZoom: 1,
        zoomControl: true, disableDefaultUI: false,
      });
      mapRef.current.addListener('click', (e: any) => {
        if (submittedRef.current) return;
        const lat = e.latLng.lat(); const lng = e.latLng.lng();
        setMyGuess({ lat, lng });
        if (guessMarkerRef.current) guessMarkerRef.current.setPosition({ lat, lng });
        else guessMarkerRef.current = new g.maps.Marker({ position: { lat, lng }, map: mapRef.current });
        playClick();
      });
    } else {
      mapRef.current.setCenter({ lat: 20, lng: 0 }); mapRef.current.setZoom(1);
      if (guessMarkerRef.current) { guessMarkerRef.current.setMap(null); guessMarkerRef.current = null; }
    }
  }, [mapsReady, phase, loc?.id]);

  // keep submitted ref
  const submittedRef = useRef(false);
  useEffect(() => { submittedRef.current = submitted; }, [submitted]);

  // trigger map resize when toggling expanded
  useEffect(() => {
    if (!mapRef.current) return;
    setTimeout(() => window.google?.maps?.event?.trigger(mapRef.current, 'resize'), 200);
  }, [mapExpanded]);

  // ===== Reveal map =====
  useEffect(() => {
    if (!mapsReady || phase !== 'reveal' || !loc || !resultMapDivRef.current) return;
    const g = window.google;
    const map = new g.maps.Map(resultMapDivRef.current, {
      center: { lat: loc.lat, lng: loc.lng }, zoom: 3, mapTypeControl: false, streetViewControl: false,
      fullscreenControl: false,
    });
    resultMapRef.current = map;
    new g.maps.Marker({ position: { lat: loc.lat, lng: loc.lng }, map, label: '🎯', title: 'Igazi hely' });
    const bounds = new g.maps.LatLngBounds();
    bounds.extend({ lat: loc.lat, lng: loc.lng });
    guesses.forEach((gu) => {
      if (gu.lat === 0 && gu.lng === 0) return;
      const m = new g.maps.Marker({ position: { lat: gu.lat, lng: gu.lng }, map, label: gu.username[0]?.toUpperCase() });
      bounds.extend({ lat: gu.lat, lng: gu.lng });
      new g.maps.Polyline({
        path: [{ lat: gu.lat, lng: gu.lng }, { lat: loc.lat, lng: loc.lng }],
        map, strokeColor: '#3b82f6', strokeOpacity: 0.7, strokeWeight: 2,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '12px' }],
      });
      m.setMap(map);
    });
    map.fitBounds(bounds, 60);
  }, [mapsReady, phase, loc?.id, guesses]);

  function submitGuess() {
    if (!myGuess || !loc || submitted) return;
    const distance = haversine(myGuess, loc);
    const score = scoreForDistance(distance);
    const payload: Guess = { playerId, username, lat: myGuess.lat, lng: myGuess.lng, distance, score };
    channelRef.current?.send({ type: 'broadcast', event: 'geo:guess', payload });
    setGuesses((all) => {
      if (all.find((g) => g.playerId === playerId)) return all;
      const next = [...all, payload]; guessesRef.current = next;
      if (isHost && next.length >= players.length) setTimeout(() => hostReveal(next), 400);
      return next;
    });
    setSubmitted(true); playSubmit();
  }

  function hostNext() {
    if (round >= totalRounds) {
      channelRef.current?.send({ type: 'broadcast', event: 'geo:end', payload: { scores: scoresRef.current } });
      setPhase('end'); return;
    }
    hostStartRound(round + 1);
  }

  const sortedScores = useMemo(() => (
    players.map((p) => ({ playerId: p.player_id, username: p.username, score: scores[p.player_id] || 0 }))
      .sort((a, b) => b.score - a.score)
  ), [players, scores]);

  // ============ RENDER ============

  if (phase === 'end') {
    return (
      <div className="max-w-xl mx-auto p-4 space-y-4 text-center animate-zoom-in">
        <div className="text-6xl animate-bounce">🌍</div>
        <h2 className="text-3xl font-bold">GeoGuesser vége!</h2>
        <div className="game-card ios-glass text-left">
          <div className="font-bold mb-2">🏆 Végeredmény</div>
          {sortedScores.map((s, i) => (
            <div key={s.playerId} className="flex justify-between border-b border-border/40 py-1">
              <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {s.username}</span>
              <span className="font-bold text-primary">{s.score} pt</span>
            </div>
          ))}
        </div>
        {isHost && <button className="game-btn-primary w-full" onClick={onFinish}>Vissza a lobbyba</button>}
      </div>
    );
  }

  if (phase === 'reveal') {
    return (
      <div className="max-w-5xl mx-auto p-2 md:p-4 space-y-3 animate-blur-in">
        <div className="game-card ios-glass text-center py-2">
          <div className="font-bold">🌍 Kör {round}/{totalRounds} — eredmény</div>
        </div>
        <div className="rounded-2xl overflow-hidden border-2 border-border shadow-2xl" style={{ height: '55vh' }}>
          <div key={`result-${round}-${loc?.id ?? 'x'}`} ref={resultMapDivRef} className="w-full h-full bg-muted" />
        </div>
        <div className="game-card ios-glass space-y-1 text-sm">
          {[...guesses].sort((a, b) => b.score - a.score).map((g) => (
            <div key={g.playerId} className="flex justify-between items-center border-b border-border/40 py-1">
              <span className="font-medium">{g.username}</span>
              <span className="text-xs text-muted-foreground">{g.distance.toFixed(0)} km</span>
              <span className="font-bold text-primary">+{g.score}</span>
            </div>
          ))}
          {isHost && (
            <button className="game-btn-primary w-full mt-2" onClick={hostNext}>
              {round >= totalRounds ? '🏁 Befejezés' : '▶️ Következő kör'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ===== GUESSING: fullscreen pano + mini map bottom-right =====
  return (
    <div className="fixed inset-0 bg-black z-40">
      {/* Loading overlay */}
      {(!mapsReady || !loc) && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-30 text-center">
          <div>
            <div className="text-6xl animate-spin">🌍</div>
            <p className="mt-3 font-bold">Hely keresése a világban...</p>
          </div>
        </div>
      )}

      {/* Street View — full screen (key forces fresh mount each round) */}
      <div key={`pano-${round}-${loc?.id ?? 'x'}`} ref={panoDivRef} className="absolute inset-0" />

      {/* Top HUD */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-2 p-2 md:p-3 pointer-events-none">
        <div className="ios-glass rounded-2xl px-3 py-1.5 text-xs md:text-sm font-bold pointer-events-auto">
          🌍 Kör {round}/{totalRounds}
        </div>
        <div className={`ios-glass rounded-2xl px-4 py-1.5 text-base md:text-lg font-bold pointer-events-auto ${timeLeft <= 10 ? 'text-destructive animate-pulse' : ''}`}>
          ⏱️ {timeLeft}mp
        </div>
        <div className="ios-glass rounded-2xl px-3 py-1.5 text-xs md:text-sm font-bold pointer-events-auto">
          🎯 {guesses.length}/{players.length}
        </div>
      </div>

      {/* Live leaderboard pills */}
      {sortedScores.some((s) => s.score > 0) && (
        <div className="absolute top-14 left-2 right-2 md:left-3 md:right-auto z-20 flex flex-wrap gap-1 pointer-events-none">
          {sortedScores.slice(0, 5).map((s, i) => (
            <span key={s.playerId} className="ios-glass rounded-full px-2 py-0.5 text-[10px] md:text-xs">
              {i === 0 ? '🥇' : ''} {s.username}: <b>{s.score}</b>
            </span>
          ))}
        </div>
      )}

      {/* Mini-map (bottom-right). Click to expand. */}
      <div
        className={`absolute z-20 transition-all duration-300 ease-out ${
          mapExpanded
            ? 'inset-2 md:inset-auto md:right-4 md:bottom-4 md:w-[55vw] md:h-[70vh]'
            : 'right-2 bottom-20 md:right-4 md:bottom-4 w-[60vw] sm:w-[40vw] md:w-[28vw] h-[35vh] md:h-[40vh]'
        }`}
      >
        <div className="relative w-full h-full rounded-2xl overflow-hidden border-2 border-white/30 shadow-2xl ios-glass">
          <div ref={mapDivRef} className="absolute inset-0" />
          <button
            onClick={() => setMapExpanded((v) => !v)}
            className="absolute top-2 left-2 z-10 ios-glass rounded-lg w-8 h-8 flex items-center justify-center text-sm font-bold"
            title={mapExpanded ? 'Kicsinyítés' : 'Nagyítás'}
          >
            {mapExpanded ? '🗗' : '🗖'}
          </button>
          {!myGuess && (
            <div className="absolute bottom-2 left-2 right-2 ios-glass rounded-lg text-center py-1 text-[10px] md:text-xs font-bold pointer-events-none">
              📍 Kattints a térképre, hogy tippelj!
            </div>
          )}
        </div>
      </div>

      {/* Submit bar (bottom-left) */}
      <div className="absolute bottom-2 left-2 md:bottom-4 md:left-4 z-20 max-w-[40vw]">
        <button
          onClick={submitGuess}
          disabled={!myGuess || submitted}
          className={`px-4 py-3 rounded-2xl font-bold shadow-2xl border-2 ios-glass transition-all ${
            myGuess && !submitted ? 'bg-primary text-primary-foreground border-primary scale-100 hover:scale-105' : 'opacity-60 border-border'
          }`}
        >
          {submitted ? '✅ Beküldve' : myGuess ? '🎯 Tipp beküldése' : '📍 Tippelj a térképen'}
        </button>
        {myGuess && !submitted && (
          <div className="ios-glass rounded-lg px-2 py-1 mt-1 text-[10px] md:text-xs">
            {myGuess.lat.toFixed(1)}°, {myGuess.lng.toFixed(1)}°
          </div>
        )}
      </div>
    </div>
  );
}
