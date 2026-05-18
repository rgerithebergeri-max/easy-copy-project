import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface FlashCommandoCtx {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
}

const Ctx = createContext<FlashCommandoCtx>({
  enabled: false,
  toggle: () => {},
  setEnabled: () => {},
});

const STORAGE_KEY = 'flashCommandoMode';

export function FlashCommandoProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (enabled) root.classList.add('flash-commando');
    else root.classList.remove('flash-commando');
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch {}
  }, [enabled]);

  // Konami-style hidden trigger: type "flashcommando"
  useEffect(() => {
    const buf: string[] = [];
    const target = 'flashcommando';
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      buf.push(e.key.toLowerCase());
      if (buf.length > target.length) buf.shift();
      if (buf.join('') === target) setEnabledState((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Ctx.Provider value={{ enabled, toggle: () => setEnabledState((v) => !v), setEnabled: setEnabledState }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFlashCommando() {
  return useContext(Ctx);
}