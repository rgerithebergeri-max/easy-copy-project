import { useEffect, useState } from 'react';
import { useFlashCommando } from '@/contexts/FlashCommandoContext';
import melegBg from '@/assets/easter/meleg.png';
import shrek from '@/assets/avatars/shrek.jpg';
import krisz from '@/assets/avatars/krisz.png';
import orr from '@/assets/avatars/orr.png';

const FLOATERS = [shrek, krisz, orr, melegBg];

interface Floater {
  id: string;
  src: string;
  x: number;
  y: number;
  size: number;
  rot: number;
  dur: number;
}

export default function FlashCommandoOverlay() {
  const { enabled } = useFlashCommando();
  const [floaters, setFloaters] = useState<Floater[]>([]);

  useEffect(() => {
    if (!enabled) {
      setFloaters([]);
      return;
    }
    const spawn = () => {
      const f: Floater = {
        id: crypto.randomUUID(),
        src: FLOATERS[Math.floor(Math.random() * FLOATERS.length)],
        x: Math.random() * 85,
        y: Math.random() * 85,
        size: 60 + Math.random() * 140,
        rot: Math.random() * 60 - 30,
        dur: 3 + Math.random() * 2,
      };
      setFloaters((s) => [...s, f]);
      setTimeout(() => setFloaters((s) => s.filter((x) => x.id !== f.id)), f.dur * 1000);
    };
    const iv = setInterval(spawn, 900);
    spawn();
    return () => clearInterval(iv);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `url(${melegBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.35,
        }}
      />
      <div className="fixed inset-0 pointer-events-none z-[60] overflow-hidden">
        {floaters.map((f) => (
          <img
            key={f.id}
            src={f.src}
            alt=""
            style={{
              position: 'absolute',
              left: `${f.x}%`,
              top: `${f.y}%`,
              width: f.size,
              height: f.size,
              transform: `rotate(${f.rot}deg)`,
              animation: `float-up ${f.dur}s ease-out forwards`,
              borderRadius: 12,
              boxShadow: '0 6px 30px hsla(300, 100%, 50%, 0.6)',
              objectFit: 'cover',
            }}
          />
        ))}
      </div>
    </>
  );
}