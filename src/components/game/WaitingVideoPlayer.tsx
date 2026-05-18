import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface VideoClip {
  id: string;
  start: number;
}

const GORYON_VIDEOS: VideoClip[] = [
  { id: 'BjjcJW7NxgE', start: 162 },
  { id: 'BjjcJW7NxgE', start: 210 },
  { id: 'BjjcJW7NxgE', start: 311 },
  { id: 'BjjcJW7NxgE', start: 432 },
  { id: 'BjjcJW7NxgE', start: 1141 },
  { id: 'g-RiCGKPYb8', start: 0 },
  { id: 'IUw6qc-2Kgo', start: 0 },
  { id: 'ruDH5SlrcfY', start: 0 },
  { id: 'PJAZf_2aIr4', start: 187 },
  { id: 'TzTiuzc5I50', start: 0 },
  { id: 've1UBtWGXdA', start: 0 },
  { id: 've1UBtWGXdA', start: 198 },
  { id: 'Wdldno14pBo', start: 0 },
];

let youtubeApiPromise: Promise<any> | null = null;

function ensureYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const existingScript = document.querySelector('script[data-youtube-api="true"]');

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.youtubeApi = 'true';
      document.body.appendChild(script);
    }

    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
  });

  return youtubeApiPromise;
}

function pickRandomVideo(previous?: VideoClip | null) {
  const pool = previous
    ? GORYON_VIDEOS.filter((video) => video.id !== previous.id || video.start !== previous.start)
    : GORYON_VIDEOS;

  return pool[Math.floor(Math.random() * pool.length)] ?? GORYON_VIDEOS[0];
}

export default function WaitingVideoPlayer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [currentVideo, setCurrentVideo] = useState<VideoClip>(() => pickRandomVideo());

  const handleEnded = useCallback(() => {
    setCurrentVideo((previous) => pickRandomVideo(previous));
  }, []);

  useEffect(() => {
    let cancelled = false;

    ensureYoutubeApi().then((YT) => {
      if (cancelled || !mountRef.current) return;

      if (!playerRef.current) {
        playerRef.current = new YT.Player(mountRef.current, {
          videoId: currentVideo.id,
          playerVars: {
            autoplay: 1,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            start: currentVideo.start,
          },
          events: {
            onReady: (event: any) => event.target.playVideo(),
            onStateChange: (event: any) => {
              if (YT.PlayerState && event.data === YT.PlayerState.ENDED) {
                handleEnded();
              }
            },
          },
        });
        return;
      }

      playerRef.current.loadVideoById({
        videoId: currentVideo.id,
        startSeconds: currentVideo.start,
      });
      playerRef.current.playVideo();
    });

    return () => {
      cancelled = true;
    };
  }, [currentVideo, handleEnded]);

  useEffect(() => {
    return () => {
      if (playerRef.current?.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="w-full mt-4">
      <p className="text-center text-lg font-bold mb-2 text-primary">
        🎬 Ameddig várakozol nézd a Mestert
      </p>
      <div className="relative w-full aspect-video rounded-xl overflow-hidden border-2 border-border shadow-lg bg-card">
        <div ref={mountRef} className="w-full h-full" />
      </div>
    </div>
  );
}