import { useFlashCommando } from '@/contexts/FlashCommandoContext';
import { playClick } from '@/lib/sounds';

export default function FlashCommandoSwitch() {
  const { enabled, toggle } = useFlashCommando();
  return (
    <button
      type="button"
      onClick={() => { toggle(); playClick(); }}
      className={`group flex items-center gap-2 rounded-full border-2 border-border px-3 py-1.5 text-xs font-bold transition-all ${
        enabled
          ? 'bg-gradient-to-r from-fuchsia-500 to-purple-700 text-white shadow-[0_0_18px_hsl(300_100%_60%/0.7)]'
          : 'bg-card text-foreground hover:brightness-105'
      }`}
      title="Flash Commando Mode"
    >
      <span className="text-base">{enabled ? '⚡' : '🌀'}</span>
      <span className="hidden sm:inline">Flash Commando</span>
      <span
        className={`relative inline-block h-4 w-7 rounded-full border border-border ${enabled ? 'bg-white/30' : 'bg-muted'}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-foreground transition-all ${enabled ? 'left-3.5 bg-yellow-300' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}