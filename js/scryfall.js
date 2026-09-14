// Wrapper fino para a API pública do Scryfall (https://scryfall.com/docs/api).
// Sem chave de API necessária. Respeita o pedido deles de não disparar rajadas de
// requisições — usamos só chamadas pontuais disparadas por ação do usuário.

const API_BASE = "https://api.scryfall.com";
const CATALOG_CACHE_KEY = "tokenprinter:creatureTypes";
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export async function fetchCreatureTypeCatalog() {
  try {
    const cached = localStorage.getItem(CATALOG_CACHE_KEY);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CATALOG_TTL_MS && Array.isArray(data) && data.length) {
        return data;
      }
    }
  } catch { /* localStorage indisponível ou corrompido — segue para buscar */ }

  try {
    const res = await fetch(`${API_BASE}/catalog/creature-types`);
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
    const json = await res.json();
    const data = json.data || [];
    try {
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* quota cheia — não é crítico */ }
    return data;
  } catch (err) {
    console.warn("Não foi possível buscar catálogo de tipos de criatura do Scryfall:", err);
    return [];
  }
}

/**
 * Busca cartas no Scryfall. Retorna { cards, totalCards, usedQuery } ou lança erro.
 */
export async function searchCards(query, { uniqueMode = "art", order = "released" } = {}) {
  const url = `${API_BASE}/cards/search?${new URLSearchParams({
    q: query,
    unique: uniqueMode,
    order,
  })}`;
  const res = await fetch(url);
  if (res.status === 404) {
    return { cards: [], totalCards: 0, usedQuery: query };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.details || `Scryfall retornou ${res.status}`);
  }
  const json = await res.json();
  return { cards: json.data || [], totalCards: json.total_cards || 0, usedQuery: query };
}

/**
 * Busca com degradação progressiva: se a query estruturada não achar nada,
 * vai relaxando restrições (palavras-chave, depois tipo, depois p/t) até achar
 * algo ou esgotar as tentativas. Retorna também um aviso indicando se o
 * resultado foi aproximado.
 */
export async function searchCardsWithFallback(queryParts) {
  // queryParts: array de strings, cada uma um "AND" obrigatório da busca base
  // (ex.: ["t:token", "c:b", "pow=1", "tou=1", "t:\"Faerie\"", "o:\"flying\""])
  const attempts = [];
  attempts.push([...queryParts]);

  // Remove palavras-chave (o:"...") primeiro
  const withoutKeywords = queryParts.filter((p) => !p.startsWith("o:"));
  if (withoutKeywords.length !== queryParts.length) attempts.push(withoutKeywords);

  // Depois remove p/t
  const withoutPT = withoutKeywords.filter((p) => !p.startsWith("pow=") && !p.startsWith("tou="));
  if (withoutPT.length !== withoutKeywords.length) attempts.push(withoutPT);

  // Depois remove tipo de criatura
  const withoutType = withoutPT.filter((p) => !p.startsWith('t:"'));
  if (withoutType.length !== withoutPT.length) attempts.push(withoutType);

  let lastResult = null;
  for (let i = 0; i < attempts.length; i++) {
    const q = attempts[i].join(" ");
    const result = await searchCards(q);
    lastResult = result;
    if (result.cards.length > 0) {
      return { ...result, approximate: i > 0 };
    }
  }
  return { ...lastResult, approximate: true };
}

/** Sugestões de nome de carta enquanto o usuário digita (para achar o comandante certo). */
export async function autocompleteCardName(query) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`${API_BASE}/cards/autocomplete?${new URLSearchParams({ q })}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data || [];
  } catch {
    return [];
  }
}

/** Todas as artes/impressões de um comandante (cartas que podem ser comandante) pelo nome. */
export async function searchCommanderPrints(name) {
  return searchCards(`${name} is:commander`, { uniqueMode: "art", order: "released" });
}
