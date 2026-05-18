// Curated YouTube catalog for Deepfake Sync.
// Short, meme-friendly clips that are fun to dub over.
export interface YtCatalogItem {
  id: string;       // YouTube video id
  title: string;
  tags: string;     // searchable text
  category: 'meme' | 'movie' | 'music' | 'speech' | 'reaction' | 'sport';
}

export const YT_CATALOG: YtCatalogItem[] = [
  { id: 'dQw4w9WgXcQ', title: 'Rick Astley — Never Gonna Give You Up', tags: 'rickroll meme music', category: 'music' },
  { id: '9bZkp7q19f0', title: 'PSY — Gangnam Style', tags: 'gangnam dance kpop meme', category: 'music' },
  { id: 'kJQP7kiw5Fk', title: 'Despacito', tags: 'despacito music latin', category: 'music' },
  { id: 'fJ9rUzIMcZQ', title: 'Queen — Bohemian Rhapsody', tags: 'queen rock classic', category: 'music' },
  { id: 'L_jWHffIx5E', title: 'Smash Mouth — All Star', tags: 'shrek meme all star', category: 'music' },
  { id: 'y6120QOlsfU', title: 'Sandstorm — Darude', tags: 'edm meme darude', category: 'music' },
  { id: 'ZZ5LpwO-An4', title: 'HEYYEYAAEYAAAEYAEYAA', tags: 'meme he man classic', category: 'meme' },
  { id: 'iik25wqIuFo', title: 'Crazy Frog — Axel F', tags: 'crazy frog meme', category: 'meme' },
  { id: 'd1YBv2mWll0', title: 'Will Smith Slap (oscars)', tags: 'will smith oscars slap meme', category: 'meme' },
  { id: 'otCpCn0l4Wo', title: 'Skibidi Toilet', tags: 'skibidi meme brainrot', category: 'meme' },
  { id: 'iSCnz8fwSlE', title: 'Bad Piggies meme', tags: 'piggies meme', category: 'meme' },
  { id: '6n3pFFPSlW4', title: 'Spongebob — Imagination', tags: 'spongebob meme imagination', category: 'meme' },
  { id: 'ZHwVBirqD2s', title: 'Sad Violin meme', tags: 'violin sad meme', category: 'meme' },
  { id: 'PIh2xe4jnpk', title: 'Anakin & Padme meme scene', tags: 'star wars anakin padme meme', category: 'movie' },
  { id: 'eIho2S0ZahI', title: 'How do you do fellow kids', tags: 'fellow kids meme', category: 'meme' },
  { id: 'BBAyRBTfsOU', title: 'Hide the Pain Harold', tags: 'harold meme stock', category: 'meme' },
  { id: 'CnZ8ENJoZ_8', title: 'Surprised Pikachu', tags: 'pikachu meme reaction', category: 'meme' },
  { id: '8gw0rXPMMPE', title: 'Two Trucks (and a stupid song)', tags: 'lemon demon two trucks meme', category: 'meme' },
  { id: 'dv13gl0a-FA', title: 'Discord notification 1 hour', tags: 'discord meme sound', category: 'meme' },
  { id: 'VbfpW0pbvaU', title: 'Doom — E1M1 (At Doom\'s Gate)', tags: 'doom metal game', category: 'music' },
  { id: 'jofNR_WkoCE', title: 'Ed Sheeran — Shape of You', tags: 'ed sheeran pop music', category: 'music' },
  { id: 'pRpeEdMmmQ0', title: 'Shakira — Waka Waka', tags: 'shakira world cup music', category: 'music' },
  { id: 'JGwWNGJdvx8', title: 'Ed Sheeran — Shape of You', tags: 'ed sheeran music', category: 'music' },
  { id: 'OPf0YbXqDm0', title: 'Mark Ronson — Uptown Funk', tags: 'bruno mars uptown funk', category: 'music' },
  { id: 'RgKAFK5djSk', title: 'Wiz Khalifa — See You Again', tags: 'fast furious emotional', category: 'music' },
  { id: 'hT_nvWreIhg', title: 'OneRepublic — Counting Stars', tags: 'pop music', category: 'music' },
  { id: 'YQHsXMglC9A', title: 'Adele — Hello', tags: 'adele hello music', category: 'music' },
  { id: 'JZjAg6fK-BQ', title: 'Tom & Jerry chase music', tags: 'tom jerry cartoon', category: 'meme' },
  { id: 'WoZNYRzZmgI', title: 'Loituma — Ievan Polkka', tags: 'leek spin loituma meme', category: 'meme' },
  { id: 'C-u5WLJ9Yk4', title: 'Trololo Guy', tags: 'trololo meme russian', category: 'meme' },
  { id: '_-agl0pOQfs', title: 'Why are you running meme', tags: 'why are you running meme', category: 'meme' },
  { id: '4r7wHMg5Yjg', title: 'Bee Movie intro', tags: 'bee movie meme intro', category: 'movie' },
  { id: '5qap5aO4i9A', title: 'Lofi girl', tags: 'lofi chill music study', category: 'music' },
  { id: 'TwHM2Ck1NV0', title: 'Office Stapler scene', tags: 'office meme stapler', category: 'movie' },
];

export const YT_CATEGORIES = [
  { id: 'all', label: 'Mind' },
  { id: 'meme', label: '😂 Mémek' },
  { id: 'music', label: '🎵 Zenék' },
  { id: 'movie', label: '🎬 Filmek' },
  { id: 'speech', label: '🎤 Beszédek' },
  { id: 'reaction', label: '😲 Reakciók' },
  { id: 'sport', label: '⚽ Sport' },
] as const;

export function searchCatalog(query: string, category: string): YtCatalogItem[] {
  const q = query.trim().toLowerCase();
  return YT_CATALOG.filter((it) => {
    if (category !== 'all' && it.category !== category) return false;
    if (!q) return true;
    return it.title.toLowerCase().includes(q) || it.tags.toLowerCase().includes(q);
  });
}
