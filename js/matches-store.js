// Persistência local (localStorage) do histórico de partidas, pro placar.

const MATCHES_KEY = "cmdr:matches";

function loadMatches() {
  try {
    const raw = localStorage.getItem(MATCHES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* localStorage indisponível ou corrompido */ }
  return [];
}

function saveMatches(matches) {
  try {
    localStorage.setItem(MATCHES_KEY, JSON.stringify(matches));
  } catch { /* quota cheia — não é crítico */ }
}

/** Mais recente primeiro. */
export function getMatches() {
  return loadMatches();
}

/** match: { id, startedAt, endedAt, durationMs, players, winnerPlayerIds } */
export function addMatch(match) {
  const matches = loadMatches();
  matches.unshift(match);
  saveMatches(matches);
}
