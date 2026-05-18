import { useEffect, useRef, useState } from 'react';

interface Props {
  videoId: string;
  label: string;
  active?: boolean;
  compact?: boolean;
  autoStart?: boolean;
}

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void; }
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeAPI(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

export default function YouTubeMusicPlayer({ videoId, label, active = true, compact = false, autoStart = false }: Props) {
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('ytMusicVol')); return isNaN(v) ? 40 : Math.max(0, Math.min(100, v)); } catch { return 40; }
  });
  const [showVol, setShowVol] = useState(false);
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // Initialize the player once
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    loadYouTubeAPI().then(() => {
      if (!mounted || !containerRef.current || playerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        height: '0', width: '0',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, loop: 1, playlist: videoId, modestbranding: 1, rel: 0 },
        events: {
          onReady: (e: any) => {
            e.target.setVolume(volume);
          },
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.PLAYING) setPlaying(true);
            else if (e.data === window.YT.PlayerState.PAUSED || e.data === window.YT.PlayerState.ENDED) setPlaying(false);
          },
        },
      });
    });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, videoId]);

  const start = () => {
    const p = playerRef.current;
    if (!p) return;
    try { p.setVolume(volume); p.playVideo(); } catch {}
  };
  const stop = () => {
    const p = playerRef.current;
    if (!p) return;
    try { p.pauseVideo(); } catch {}
  };

  // Auto-start on first gesture
  useEffect(() => {
    if (!autoStart || !active || startedRef.current) return;
    const handler = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      // small delay so the YT player has time to load
      setTimeout(start, 300);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      window.removeEventListener('touchstart', handler);
    };
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
    window.addEventListener('touchstart', handler);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, active]);

  useEffect(() => {
    try { localStorage.setItem('ytMusicVol', String(volume)); } catch {}
    const p = playerRef.current;
    if (p && p.setVolume) { try { p.setVolume(volume); } catch {} }
  }, [volume]);

  if (!active) return null;

  return (
    <div className={compact ? 'w-full' : 'relative'}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => (playing ? stop() : start())}
          className={compact ? 'game-btn-secondary text-sm py-2 px-3 flex-1' : 'game-btn-secondary text-sm py-1 px-3'}
          title={playing ? 'Zene leállítása' : 'Zene indítása'}
        >
          {playing ? '⏸️ Zene' : `🎵 ${label}`}
        </button>
        <button
          type="button"
          onClick={() => setShowVol((v) => !v)}
          className="game-btn-secondary text-sm py-1 px-2"
          title="Hangerő"
        >
          {volume === 0 ? '🔇' : volume < 50 ? '🔈' : '🔊'}
        </button>
      </div>
      {showVol && (
        <div className={compact ? 'mt-2' : 'absolute right-0 mt-2 w-44 p-2 rounded-xl border-2 border-border bg-card shadow-xl z-30'}>
          <input
            type="range" min={0} max={100} value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-[10px] text-center font-bold opacity-70 mt-0.5">{volume}%</div>
        </div>
      )}
      {/* Hidden audio source */}
      <div
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
        aria-hidden
      >
        <div ref={containerRef} />
      </div>
    </div>
  );
}
