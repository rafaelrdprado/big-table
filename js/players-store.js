// Persistência local (localStorage) de jogadores e do histórico de
// comandantes de cada jogador, para a mesa de Commander.

const STORE_KEY = "cmdr:store";

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        players: Array.isArray(parsed.players) ? parsed.players : [],
        commandersByPlayer: parsed.commandersByPlayer || {},
      };
    }
  } catch { /* localStorage indisponível ou corrompido */ }
  return { players: [], commandersByPlayer: {} };
}

function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* quota cheia — não é crítico */ }
}

function makeId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function getPlayers() {
  return loadStore().players;
}

export function addPlayer(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Nome do jogador não pode ser vazio.");
  const store = loadStore();
  const player = { id: makeId(), name: trimmed };
  store.players.push(player);
  saveStore(store);
  return player;
}

export function getCommandersForPlayer(playerId) {
  const store = loadStore();
  return store.commandersByPlayer[playerId] || [];
}

/** commander: { name, imageUrl, scryfallId, setCode } */
export function addCommanderForPlayer(playerId, commander) {
  const store = loadStore();
  const list = store.commandersByPlayer[playerId] || (store.commandersByPlayer[playerId] = []);
  const existingIdx = list.findIndex((c) => c.scryfallId === commander.scryfallId);
  if (existingIdx >= 0) list.splice(existingIdx, 1);
  list.unshift({ ...commander, lastUsedAt: Date.now() });
  saveStore(store);
}
