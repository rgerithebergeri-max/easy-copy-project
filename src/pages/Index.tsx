import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { AVATARS, getAvatarDisplay } from '@/lib/avatars';
import { generatePartyCode } from '@/lib/gameTypes';
import { playClick, playSubmit } from '@/lib/sounds';
import Header from '@/components/game/Header';
import bannerBg from '@/assets/goryonbanner.jpg';

export default function Index() {
  const navigate = useNavigate();
  const { playerId, username, setUsername, avatar, setAvatar } = usePlayerIdentity();
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const createParty = async () => {
    if (!username.trim()) { setError('Add meg a neved!'); return; }
    setLoading(true);
    setError('');
    playClick();

    const code = generatePartyCode();
    const { data, error: err } = await supabase
      .from('parties')
      .insert({ code, host_id: playerId })
      .select()
      .single();

    if (err || !data) {
      setError('Hiba történt a party létrehozásakor!');
      setLoading(false);
      return;
    }

    await supabase.from('party_players').insert({
      party_id: data.id,
      player_id: playerId,
      username: username.trim(),
      avatar,
    });

    playSubmit();
    navigate(`/party/${code}`);
  };

  const joinParty = async () => {
    if (!username.trim()) { setError('Add meg a neved!'); return; }
    if (!joinCode.trim()) { setError('Add meg a party kódot!'); return; }
    setLoading(true);
    setError('');
    playClick();

    const { data: party } = await supabase
      .from('parties')
      .select('id')
      .eq('code', joinCode.trim().toUpperCase())
      .maybeSingle();

    if (!party) {
      setError('Nincs ilyen party!');
      setLoading(false);
      return;
    }

    playSubmit();
    navigate(`/party/${joinCode.trim().toUpperCase()}`);
  };

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Hero banner with neon overlay */}
      <div
        className="absolute inset-x-0 top-0 h-[55vh] pointer-events-none opacity-40"
        style={{
          backgroundImage: `url(${bannerBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          maskImage: 'linear-gradient(180deg, #000 0%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, #000 0%, transparent 100%)',
        }}
      />
      <div className="min-h-screen flex flex-col relative z-10">
        <Header />

        <main className="flex-1 flex items-center justify-center p-4">
          <div className="game-card max-w-md w-full p-6 space-y-5 animate-spring-in">
            <h2 className="text-3xl font-black text-center neon-text-magenta animate-flicker">
              ⚡ CSATLAKOZZ ⚡
            </h2>

            {/* Username */}
            <div>
              <label className="font-bold text-sm mb-1 block">Felhasználónév</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="game-input"
                placeholder="Add meg a neved..."
                maxLength={20}
              />
            </div>

            {/* Avatar picker */}
            <div>
              <label className="font-bold text-sm mb-1 block">Profilkép</label>
              <div className="grid grid-cols-6 gap-2">
                {AVATARS.map((av) => {
                  const display = getAvatarDisplay(av.id);
                  return (
                    <button
                      key={av.id}
                      className={`w-12 h-12 rounded-xl border-2 overflow-hidden transition-all ${
                        avatar === av.id
                          ? 'border-primary scale-110 ring-2 ring-primary/50'
                          : 'border-border/30 hover:scale-105'
                      }`}
                      onClick={() => { setAvatar(av.id); playClick(); }}
                    >
                      {display.src ? (
                        <img src={display.src} alt={av.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-xl bg-card">
                          {display.emoji}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <p className="text-destructive font-bold text-sm text-center">{error}</p>
            )}

            {/* Actions */}
            <div className="space-y-3">
              <button
                className="game-btn-primary w-full text-xl"
                onClick={createParty}
                disabled={loading}
              >
                🎉 PARTY LÉTREHOZÁSA
              </button>

              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-sm font-bold text-muted-foreground">VAGY</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="game-input flex-1 font-mono tracking-widest text-center"
                  placeholder="KÓD..."
                  maxLength={6}
                />
                <button
                  className="game-btn-secondary"
                  onClick={joinParty}
                  disabled={loading}
                >
                  🚪 BELÉPÉS
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
