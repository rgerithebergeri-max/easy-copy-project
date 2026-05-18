
-- Parties table
CREATE TABLE public.parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby',
  settings JSONB NOT NULL DEFAULT '{"drawTime": 60, "writeTime": 30, "describeTime": 30, "gameMode": "normal", "maxPlayers": 14}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read parties" ON public.parties FOR SELECT USING (true);
CREATE POLICY "Anyone can create parties" ON public.parties FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update parties" ON public.parties FOR UPDATE USING (true);

-- Party players table
CREATE TABLE public.party_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT 'default',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(party_id, player_id)
);

ALTER TABLE public.party_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read players" ON public.party_players FOR SELECT USING (true);
CREATE POLICY "Anyone can join" ON public.party_players FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update players" ON public.party_players FOR UPDATE USING (true);
CREATE POLICY "Anyone can leave" ON public.party_players FOR DELETE USING (true);

-- Game entries table
CREATE TABLE public.game_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  session_number INT NOT NULL DEFAULT 1,
  chain_index INT NOT NULL,
  step INT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('text', 'drawing')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.game_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read entries" ON public.game_entries FOR SELECT USING (true);
CREATE POLICY "Anyone can create entries" ON public.game_entries FOR INSERT WITH CHECK (true);

-- Game reactions table
CREATE TABLE public.game_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES public.game_entries(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  session_number INT NOT NULL,
  player_id TEXT NOT NULL,
  reaction_type TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.game_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read reactions" ON public.game_reactions FOR SELECT USING (true);
CREATE POLICY "Anyone can react" ON public.game_reactions FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX idx_party_code ON public.parties(code);
CREATE INDEX idx_party_players_party ON public.party_players(party_id);
CREATE INDEX idx_game_entries_party ON public.game_entries(party_id, session_number);
CREATE INDEX idx_game_reactions_entry ON public.game_reactions(entry_id);
