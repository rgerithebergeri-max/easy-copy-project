import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Player, GameSettings, GAME_MODES, TIME_OPTIONS } from '@/lib/gameTypes';
import { getAvatarDisplay } from '@/lib/avatars';
import { playClick, playPop } from '@/lib/sounds';
import { toast } from '@/hooks/use-toast';

interface Props {
  players: Player[];
  settings: GameSettings;
  isHost: boolean;
  partyCode: string;
  playerId: string;
  username: string;
  onStartGame: () => void;
  onUpdateSettings: (s: Partial<GameSettings>) => void;
  onLeaveParty?: () => void;
}

type ChatMsg = { id: string; pid: string; name: string; text: string; t: number };

export default function LobbyView({
  players, settings, isHost, partyCode, playerId, username,
  onStartGame, onUpdateSettings, onLeaveParty,
}: Props) {
  const maxSlots = settings.maxPlayers;
  const emptySlots = Math.max(0, maxSlots - players.length);

  const [readyMap, setReadyMap] = useState<Record<string, boolean>>({ [playerId]: false });
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);

  // Lobby channel for ready + chat
  useEffect(() => {
    const ch = supabase.channel(`lobby-${partyCode}`);
    ch.on('broadcast', { event: 'ready' }, ({ payload }) => {
      setReadyMap((m) => ({ ...m, [payload.pid]: payload.ready }));
    });
    ch.on('broadcast', { event: 'chat' }, ({ payload }) => {
      setChat((c) => [...c.slice(-50), payload]);
      playPop();
    });
    ch.on('broadcast', { event: 'who' }, () => {
      // re-broadcast my ready state when someone joins
      ch.send({ type: 'broadcast', event: 'ready', payload: { pid: playerId, ready: !!readyMap[playerId] } });
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'who', payload: {} });
      }
    });
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyCode, playerId]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat]);

  function toggleReady() {
    const next = !readyMap[playerId];
    setReadyMap((m) => ({ ...m, [playerId]: next }));
    channelRef.current?.send({ type: 'broadcast', event: 'ready', payload: { pid: playerId, ready: next } });
    playClick();
  }

  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    const msg: ChatMsg = { id: crypto.randomUUID(), pid: playerId, name: username, text, t: Date.now() };
    setChat((c) => [...c.slice(-50), msg]);
    channelRef.current?.send({ type: 'broadcast', event: 'chat', payload: msg });
    setChatInput('');
  }

  const copyInviteLink = () => {
    const link = `${window.location.origin}/party/${partyCode}`;
    navigator.clipboard.writeText(link);
    toast({ title: '📋 Link másolva!', description: 'Küldd el a barátaidnak!' });
    playClick();
  };

  const selectedMode = GAME_MODES.find((m) => m.id === settings.gameMode) || GAME_MODES[0];
  const readyCount = players.filter((p) => readyMap[p.player_id]).length;
  const allReady = players.length >= 2 && readyCount === players.length;
  const hostId = players[0]?.player_id;

  return (
    <div className="max-w-[1400px] mx-auto p-3">
      {/* Top title row */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl md:text-4xl font-bold tracking-wider">
          <span className="neon-text-magenta">GORYON</span>{' '}
          <span className="neon-text">PHONE</span>
        </h1>
        <div className="flex gap-2">
          {onLeaveParty && (
            <button className="game-btn-secondary text-xs py-1.5 px-3" onClick={onLeaveParty}>
              🚪 KILÉPÉS
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-3">
        {/* LEFT — SQUAD HUB */}
        <div className="cyber-panel p-4 space-y-3">
          <h2 className="text-lg font-bold neon-text">SQUAD HUB</h2>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {players.map((p) => {
              const av = getAvatarDisplay(p.avatar);
              const isHostP = p.player_id === hostId;
              const isReady = !!readyMap[p.player_id];
              return (
                <div
                  key={p.player_id}
                  className={`relative flex items-center gap-2 p-2 rounded-lg border-l-4 transition-all ${
                    isReady ? 'border-l-[hsl(140_100%_55%)]' : 'border-l-[hsl(56_100%_60%)]'
                  } bg-[hsl(224_55%_10%/0.85)] border-y border-r border-[hsl(184_100%_55%/0.4)]`}
                  style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)' }}
                >
                  {av.src ? (
                    <img src={av.src} alt="" className="w-9 h-9 rounded-md border border-[hsl(184_100%_55%/0.6)]" />
                  ) : (
                    <span className="w-9 h-9 rounded-md flex items-center justify-center text-xl bg-card border border-[hsl(184_100%_55%/0.6)]">{av.emoji}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate text-sm">{p.username}</div>
                    <div className="text-[10px] opacity-70 flex gap-1">
                      <span>🛡️</span><span>⚡</span><span>📶</span>
                    </div>
                  </div>
                  <div className="text-right">
                    {isHostP && <div className="text-[10px] font-bold neon-text-yellow">HOST</div>}
                    <div className={`text-xs font-bold ${isReady ? 'text-[hsl(140_100%_55%)]' : 'neon-text-yellow'}`}>
                      {isReady ? 'KÉSZ' : 'VÁR'}
                    </div>
                  </div>
                </div>
              );
            })}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <div key={`e-${i}`} className="player-slot-empty text-xs">
                <span>👤</span><span className="opacity-50">ÜRES SLOT</span>
              </div>
            ))}
          </div>

          {/* Chat */}
          <div className="cyber-panel-magenta cyber-panel p-2 space-y-1">
            <div className="text-xs font-bold neon-text-magenta">💬 CHAT</div>
            <div ref={chatRef} className="h-28 overflow-y-auto text-xs space-y-0.5 px-1">
              {chat.length === 0 && <div className="opacity-50 italic">Még nincs üzenet...</div>}
              {chat.map((m) => (
                <div key={m.id}>
                  <span className={m.pid === hostId ? 'neon-text font-bold' : 'neon-text-magenta font-bold'}>{m.name}:</span>{' '}
                  <span>{m.text}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="Üzenet..."
                className="game-input text-xs py-1 px-2"
              />
              <button className="game-btn-secondary text-xs py-1 px-2" onClick={sendChat}>➤</button>
            </div>
          </div>
        </div>

        {/* CENTER — MODE GRID with featured mode in middle */}
        <div className="cyber-panel p-3">
          <div className="grid grid-cols-3 gap-2 md:gap-3" style={{ gridAutoRows: 'minmax(110px, auto)' }}>
            {GAME_MODES.map((mode, i) => {
              const isSelected = settings.gameMode === mode.id;
              const isFeatured = isSelected;
              // place selected in center-ish if possible: just rely on CSS — selected pops with bigger style
              return (
                <button
                  key={mode.id}
                  className={`mode-card relative ${isSelected ? 'active animate-pulse-glow' : 'hover-glow'} ${
                    isFeatured ? 'col-span-1 row-span-2 min-h-[230px]' : ''
                  }`}
                  onClick={() => { if (isHost) onUpdateSettings({ gameMode: mode.id }); playClick(); }}
                  disabled={!isHost}
                  title={mode.description}
                  style={isFeatured ? { gridColumn: '2 / 3', gridRow: '2 / 4' } : undefined}
                >
                  <span className={isFeatured ? 'text-6xl animate-float-bob' : 'text-3xl'}>{mode.icon}</span>
                  <span className={`font-bold ${isFeatured ? 'text-base text-center' : 'text-xs text-center'}`}>{mode.name}</span>
                  {isFeatured && (
                    <>
                      <span className="text-[10px] text-center opacity-80 leading-tight px-2">{mode.description}</span>
                      <span className="text-[10px] mt-1 font-bold neon-text-magenta">
                        🔥 TRASH SZINT: MAGAS
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT — CONTROLS */}
        <div className="space-y-3">
          {/* Code + invite */}
          <div className="cyber-panel p-4 text-center space-y-2">
            <div className="text-xs opacity-70 font-bold">KÓD</div>
            <div className="text-3xl font-mono font-bold neon-text tracking-widest">{partyCode}</div>
            <button className="game-btn-secondary w-full text-xs py-1.5" onClick={copyInviteLink}>🔗 LINK MÁSOLÁS</button>
          </div>

          {/* Ready / Start */}
          <button
            className={`w-full text-2xl py-4 ${readyMap[playerId] ? 'game-btn-magenta' : 'game-btn-primary'} animate-pulse-glow`}
            onClick={toggleReady}
          >
            {readyMap[playerId] ? '⛔ MÉGSEM KÉSZ' : '✅ KÉSZ VAGYOK'}
          </button>

          {isHost && (
            <button
              className="game-btn-primary w-full text-2xl py-4 disabled:opacity-50"
              onClick={onStartGame}
              disabled={players.length < 2}
              title={!allReady ? 'Nem mindenki kész — de elindíthatod' : 'Minden játékos kész!'}
            >
              ▶️ INDÍTÁS
              <div className="text-[10px] font-normal opacity-80 mt-1">
                KÉSZ: {readyCount}/{players.length}
              </div>
            </button>
          )}

          <button
            className="game-btn-secondary w-full text-sm py-2"
            onClick={() => { setShowSettings((s) => !s); playClick(); }}
          >
            ⚙️ BEÁLLÍTÁSOK {showSettings ? '▴' : '▾'}
          </button>

          {showSettings && (
            <div className="cyber-panel p-3 space-y-3 animate-slide-up max-h-[60vh] overflow-y-auto">
              <div className="text-xs font-bold neon-text">{selectedMode.icon} {selectedMode.name}</div>

              <TimeRow label="✏️ Írás" value={settings.writeTime} field="writeTime" isHost={isHost} onUpdate={onUpdateSettings} />
              <TimeRow label="🎨 Rajz" value={settings.drawTime} field="drawTime" isHost={isHost} onUpdate={onUpdateSettings} />
              <TimeRow label="📝 Leírás" value={settings.describeTime} field="describeTime" isHost={isHost} onUpdate={onUpdateSettings} />

              <div>
                <label className="font-bold text-xs mb-1 block">👥 Max</label>
                <div className="flex gap-1 flex-wrap">
                  {[4, 6, 8, 10, 14].map((n) => (
                    <button key={n}
                      className={`text-xs py-1 px-2 rounded border-2 font-bold ${
                        settings.maxPlayers === n ? 'border-primary bg-primary/20' : 'border-border/30 bg-card'
                      }`}
                      onClick={() => { if (isHost) onUpdateSettings({ maxPlayers: n }); }}
                      disabled={!isHost}>{n}</button>
                  ))}
                </div>
              </div>

              <ModeSpecificSettings settings={settings} isHost={isHost} onUpdateSettings={onUpdateSettings} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimeRow({ label, value, field, isHost, onUpdate }: {
  label: string; value: number; field: keyof GameSettings; isHost: boolean; onUpdate: (s: Partial<GameSettings>) => void;
}) {
  return (
    <div>
      <label className="font-bold text-xs mb-1 block">{label}</label>
      <div className="flex flex-wrap gap-1">
        {TIME_OPTIONS.map((t) => (
          <button key={t.value}
            className={`text-[10px] py-1 px-1.5 rounded border-2 font-bold ${
              value === t.value ? 'border-primary bg-primary/20' : 'border-border/30 bg-card'
            }`}
            onClick={() => { if (isHost) onUpdate({ [field]: t.value } as any); }}
            disabled={!isHost}>{t.label}</button>
        ))}
      </div>
    </div>
  );
}

function ModeSpecificSettings({ settings, isHost, onUpdateSettings }: {
  settings: GameSettings; isHost: boolean; onUpdateSettings: (s: Partial<GameSettings>) => void;
}) {
  const mode = settings.gameMode;
  if (mode === 'deepfake-sync') {
    return (
      <div className="border-t border-border/40 pt-2 space-y-2">
        <div className="font-bold text-xs neon-text-magenta">🎤 Deepfake Sync</div>
        <NumberRow label="Kör idő (mp)" value={settings.deepfakeRoundTime ?? 45} min={15} max={180} step={5}
          disabled={!isHost} onChange={(v) => onUpdateSettings({ deepfakeRoundTime: v })} />
        <NumberRow label="Körök (x játékos)" value={settings.deepfakeRounds ?? 1} min={1} max={5}
          disabled={!isHost} onChange={(v) => onUpdateSettings({ deepfakeRounds: v })} />
        <p className="text-[10px] text-muted-foreground">Mindenki YT linket küld be, kapsz egy randomot, némán szinkronizálnod kell!</p>
      </div>
    );
  }
  if (mode === 'scribble') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">✍️ Scribble</div>
      <NumberRow label="Körök" value={settings.scribbleRounds ?? 3} min={1} max={10} disabled={!isHost} onChange={(v) => onUpdateSettings({ scribbleRounds: v })} />
      <NumberRow label="Rajz idő" value={settings.scribbleDrawTime ?? 60} min={20} max={180} step={5} disabled={!isHost} onChange={(v) => onUpdateSettings({ scribbleDrawTime: v })} />
    </div>
  );
  if (mode === 'blind-flight') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">🌑 Vakrepülés</div>
      <NumberRow label="Körök" value={settings.blindRounds ?? 3} min={1} max={10} disabled={!isHost} onChange={(v) => onUpdateSettings({ blindRounds: v })} />
      <NumberRow label="Rajz idő" value={settings.blindDrawTime ?? 45} min={20} max={120} step={5} disabled={!isHost} onChange={(v) => onUpdateSettings({ blindDrawTime: v })} />
    </div>
  );
  if (mode === 'animation') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">🎬 Animáció</div>
      <NumberRow label="Képkockák" value={settings.animFrames ?? 6} min={2} max={12} disabled={!isHost} onChange={(v) => onUpdateSettings({ animFrames: v })} />
      <NumberRow label="Idő/kocka" value={settings.animFrameTime ?? 30} min={10} max={120} step={5} disabled={!isHost} onChange={(v) => onUpdateSettings({ animFrameTime: v })} />
    </div>
  );
  if (mode === 'presentation') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">🎤 Prezentáció</div>
      <NumberRow label="Slide-ok" value={settings.presSlides ?? 5} min={3} max={10} disabled={!isHost} onChange={(v) => onUpdateSettings({ presSlides: v })} />
      <NumberRow label="Slide idő" value={settings.presSlideTime ?? 25} min={10} max={60} step={5} disabled={!isHost} onChange={(v) => onUpdateSettings({ presSlideTime: v })} />
    </div>
  );
  if (mode === 'geoguesser') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">🌍 GeoGuesser</div>
      <NumberRow label="Körök" value={settings.geoRounds ?? 5} min={1} max={10} disabled={!isHost} onChange={(v) => onUpdateSettings({ geoRounds: v })} />
      <NumberRow label="Kör idő" value={settings.geoTime ?? 90} min={20} max={180} step={5} disabled={!isHost} onChange={(v) => onUpdateSettings({ geoTime: v })} />
    </div>
  );
  if (mode === 'music-quiz') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">🎵 Zenekitaláló</div>
      <NumberRow label="Körök" value={settings.musicRounds ?? 8} min={3} max={20} disabled={!isHost} onChange={(v) => onUpdateSettings({ musicRounds: v })} />
    </div>
  );
  if (mode === 'f1-race') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">🏎️ F1</div>
      <NumberRow label="Körök" value={settings.f1Laps ?? 3} min={1} max={10} disabled={!isHost} onChange={(v) => onUpdateSettings({ f1Laps: v })} />
      <NumberRow label="Tervezés (mp)" value={settings.f1DesignTime ?? 90} min={30} max={300} step={10} disabled={!isHost} onChange={(v) => onUpdateSettings({ f1DesignTime: v })} />
    </div>
  );
  if (mode === 'shooter-3d') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">🎯 Shooter</div>
      <NumberRow label="Idő" value={settings.shooterTime ?? 90} min={30} max={180} step={5} disabled={!isHost} onChange={(v) => onUpdateSettings({ shooterTime: v })} />
    </div>
  );
  if (mode === 'slither') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">🐍 Kukac</div>
      <NumberRow label="Idő" value={settings.slitherDuration ?? 120} min={60} max={300} step={10} disabled={!isHost} onChange={(v) => onUpdateSettings({ slitherDuration: v })} />
    </div>
  );
  if (mode === 'mc-pvp') return (
    <div className="border-t border-border/40 pt-2 space-y-2">
      <div className="font-bold text-xs">⚔️ PVP</div>
      <NumberRow label="Idő" value={settings.pvpDuration ?? 180} min={60} max={600} step={30} disabled={!isHost} onChange={(v) => onUpdateSettings({ pvpDuration: v })} />
    </div>
  );
  return null;
}

function NumberRow({ label, value, min, max, step = 1, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-bold flex-1">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 px-2 py-1 text-xs rounded border-2 border-border bg-card font-bold text-right" />
    </div>
  );
}
