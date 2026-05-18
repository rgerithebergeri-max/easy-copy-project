import { GameEntry, GamePhase, getBlankCanvas } from '@/lib/gameTypes';

const TEXT_FALLBACK = '(nem válaszolt)';

function scoreEntry(entry: GameEntry): number {
  if (entry.entry_type === 'text') {
    const trimmed = entry.content.trim();
    if (!trimmed) return 0;
    return trimmed === TEXT_FALLBACK ? 1 : 3;
  }

  if (!entry.content.startsWith('data:image')) return 0;
  return entry.content.length > 140 ? 3 : 1;
}

export function getAssignedChainIndex(playerOrder: string[], playerId: string, step: number) {
  const myIndex = playerOrder.indexOf(playerId);
  const playerCount = playerOrder.length;
  return ((myIndex - step) % playerCount + playerCount) % playerCount;
}

export function dedupeGameEntries(entries: GameEntry[]) {
  const latestByKey = new Map<string, GameEntry>();

  for (const entry of entries) {
    const key = `${entry.chain_index}:${entry.step}`;
    const existing = latestByKey.get(key);

    if (!existing) {
      latestByKey.set(key, entry);
      continue;
    }

    const scoreDelta = scoreEntry(entry) - scoreEntry(existing);
    if (scoreDelta > 0) {
      latestByKey.set(key, entry);
      continue;
    }

    if (scoreDelta === 0) {
      const existingTime = new Date(existing.created_at ?? 0).getTime();
      const nextTime = new Date(entry.created_at ?? 0).getTime();
      if (nextTime >= existingTime) {
        latestByKey.set(key, entry);
      }
    }
  }

  return Array.from(latestByKey.values()).sort((a, b) => {
    if (a.chain_index !== b.chain_index) return a.chain_index - b.chain_index;
    return a.step - b.step;
  });
}

export function hasCompleteEntriesForStep(entries: GameEntry[], step: number, expectedCount: number) {
  const stepEntries = dedupeGameEntries(entries).filter((entry) => entry.step === step);
  return new Set(stepEntries.map((entry) => entry.chain_index)).size >= expectedCount;
}

export function hasCompleteAlbum(entries: GameEntry[], totalSteps: number, playerCount: number) {
  return dedupeGameEntries(entries).length >= totalSteps * playerCount;
}

export function getSlideEntry(entries: GameEntry[], chain: number, step: number) {
  return dedupeGameEntries(entries).find((entry) => entry.chain_index === chain && entry.step === step) ?? null;
}

export function getPhaseFallbackContent(phase: GamePhase) {
  return phase === 'describing' ? getBlankCanvas() : TEXT_FALLBACK;
}