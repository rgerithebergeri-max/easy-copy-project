import { useEffect, useRef, useState } from 'react';

// Procedurálisan generált vidám 8-bit dallam Web Audio API-val (nincs külső függőség)
const MELODY = [
  // [midi note, beats]
  [60, 0.5], [64, 0.5], [67, 0.5], [72, 0.5],
  [67, 0.5], [64, 0.5], [60, 1.0],
  [62, 0.5], [65, 0.5], [69, 0.5], [74, 0.5],
  [69, 0.5], [65, 0.5], [62, 1.0],
  [64, 0.5], [67, 0.5], [71, 0.5], [76, 0.5],
  [71, 0.5], [67, 0.5], [64, 1.0],
  [65, 0.5], [69, 0.5], [72, 0.5], [77, 0.5],
  [72, 0.5], [69, 0.5], [65, 1.0],
] as const;

function midiToFreq(n: number) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export function useLobbyMusic(active: boolean) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('lobbyMusic') !== 'off'; } catch { return true; }
  });
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<any>(null);
  const masterRef = useRef<GainNode | null>(null);

  useEffect(() => {
    try { localStorage.setItem('lobbyMusic', enabled ? 'on' : 'off'); } catch {}
  }, [enabled]);

  useEffect(() => {
    const stop = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (masterRef.current) {
        try { masterRef.current.gain.setValueAtTime(0, ctxRef.current!.currentTime); } catch {}
      }
    };
    if (!active || !enabled) { stop(); return; }

    const start = () => {
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = ctxRef.current;
      if (!masterRef.current) {
        masterRef.current = ctx.createGain();
        masterRef.current.gain.value = 0.06;
        masterRef.current.connect(ctx.destination);
      } else {
        masterRef.current.gain.setValueAtTime(0.06, ctx.currentTime);
      }

      const tempo = 0.32; // sec per beat
      let t = ctx.currentTime + 0.05;
      const playLoop = () => {
        const start = ctx.currentTime + 0.05;
        let cursor = start;
        for (const [note, beats] of MELODY) {
          const dur = beats * tempo;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'square';
          osc.frequency.value = midiToFreq(note);
          g.gain.setValueAtTime(0.0001, cursor);
          g.gain.exponentialRampToValueAtTime(0.5, cursor + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, cursor + dur * 0.9);
          osc.connect(g).connect(masterRef.current!);
          osc.start(cursor);
          osc.stop(cursor + dur);
          cursor += dur;
        }
        const total = (cursor - start) * 1000;
        timerRef.current = setTimeout(playLoop, total);
      };
      playLoop();
    };

    const onFirstGesture = () => {
      start();
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
    // Try start immediately, fallback to user gesture
    try { start(); } catch {
      window.addEventListener('pointerdown', onFirstGesture, { once: true });
      window.addEventListener('keydown', onFirstGesture, { once: true });
    }

    return () => {
      stop();
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
  }, [active, enabled]);

  return { enabled, setEnabled };
}
