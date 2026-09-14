// Converte uma frase falada (em inglês, termos de Magic) numa query de busca do Scryfall.
// Estratégia: extrair campos estruturados (cor, poder/resistência, palavras-chave,
// tipo de criatura) da frase, removendo-os do texto conforme encontrados, e usar o
// que sobrar como termo de busca livre (nome do token, ex.: "clue", "treasure").

const COLOR_WORDS = {
  white: "w", blue: "u", black: "b", red: "r", green: "g",
  colorless: "c", artifact: "c",
};

const WUBRG_ORDER = ["w", "u", "b", "r", "g", "c"];

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, twenty: 20,
};

// Frases mais longas primeiro, para não casar "strike" antes de "first strike".
const KEYWORDS = [
  "first strike", "double strike", "can't block", "cant block",
  "flying", "trample", "vigilance", "deathtouch", "lifelink", "haste",
  "menace", "reach", "indestructible", "defender", "hexproof", "skulk",
  "flash", "prowess", "changeling", "unblockable", "ward", "afflict",
];

// Nomes de tokens não-criatura comuns (artefato/outros), para busca por nome direta.
const NAMED_TOKENS = [
  "clue", "treasure", "food", "blood", "gold", "powerstone", "map",
  "incubator", "junk", "shard", "gnome",
];

const FILLER_WORDS = new Set([
  "token", "tokens", "with", "a", "an", "the", "that", "has", "having",
  "creature", "and", "of", "is", "for", "it", "its", "which", "called",
]);

const FALLBACK_CREATURE_TYPES = [
  "Human", "Goblin", "Zombie", "Elf", "Soldier", "Wolf", "Bird", "Insect",
  "Spirit", "Elemental", "Dragon", "Angel", "Demon", "Vampire", "Faerie",
  "Squirrel", "Rat", "Snake", "Spider", "Beast", "Construct", "Golem",
  "Horror", "Illusion", "Knight", "Warrior", "Cleric", "Wizard", "Rogue",
  "Scout", "Shaman", "Druid", "Monk", "Berserker", "Barbarian", "Assassin",
  "Ninja", "Samurai", "Ogre", "Giant", "Troll", "Orc", "Minotaur",
  "Centaur", "Satyr", "Merfolk", "Kraken", "Octopus", "Treefolk", "Plant",
  "Fungus", "Ooze", "Slime", "Phoenix", "Griffin", "Hippogriff", "Pegasus",
  "Unicorn", "Boar", "Bear", "Cat", "Dog", "Hound", "Fox", "Rabbit",
  "Frog", "Turtle", "Fish", "Shark", "Whale", "Bat", "Owl", "Eagle",
  "Hawk", "Raven", "Crow", "Sphinx", "Hydra", "Wurm", "Serpent", "Lizard",
  "Salamander", "Homunculus", "Gargoyle", "Skeleton", "Ghost", "Specter",
  "Wraith", "Shade", "Pirate", "Pilot", "Peasant", "Faerie Dragon",
  "Dinosaur", "Ape", "Monkey", "Bird", "Thopter", "Servo", "Soldier",
];

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
}

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[^\w\s/'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAll(text, phrase) {
  const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  return text.replace(re, " ");
}

/**
 * @param {string} transcript - frase falada, ex: "1/1 black faerie with flying"
 * @param {string[]} creatureTypeCatalog - lista de tipos de criatura conhecidos (do Scryfall, opcional)
 * @returns {{ query: string, parsed: { colors:string[], power:?number, toughness:?number,
 *   keywords:string[], creatureType:?string, isEmblem:boolean, freeText:string } }}
 */
export function parseVoiceToQuery(transcript, creatureTypeCatalog) {
  let text = normalize(transcript || "");
  const parsed = {
    colors: [], power: null, toughness: null, keywords: [],
    creatureType: null, isEmblem: false, freeText: "",
  };

  // Emblem em vez de token
  if (/\bemblem\b/.test(text)) {
    parsed.isEmblem = true;
    text = stripAll(text, "emblem");
  }

  // Poder/resistência: "1/1" explícito
  const slashMatch = text.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (slashMatch) {
    parsed.power = parseInt(slashMatch[1], 10);
    parsed.toughness = parseInt(slashMatch[2], 10);
    text = text.replace(slashMatch[0], " ");
  } else {
    // Fallback: dois números (dígitos ou por extenso) próximos no início da frase
    const words = text.split(" ");
    const nums = [];
    const idxs = [];
    for (let i = 0; i < words.length && nums.length < 2; i++) {
      const w = words[i];
      if (/^\d{1,2}$/.test(w)) {
        nums.push(parseInt(w, 10));
        idxs.push(i);
      } else if (w in NUMBER_WORDS) {
        nums.push(NUMBER_WORDS[w]);
        idxs.push(i);
      } else if (nums.length > 0) {
        // números precisam ser consecutivos ou separados só por "slash"/"dash"
        if (w !== "slash" && w !== "dash" && w !== "-") break;
      }
    }
    if (nums.length === 2) {
      parsed.power = nums[0];
      parsed.toughness = nums[1];
      idxs.slice().reverse().forEach((i) => { words[i] = ""; });
      // remove eventual "slash"/"dash" entre eles
      const between = words.slice(idxs[0], idxs[1] + 1);
      for (let i = idxs[0]; i <= idxs[1]; i++) {
        if (words[i] === "slash" || words[i] === "dash" || words[i] === "-") words[i] = "";
      }
      text = words.join(" ").replace(/\s+/g, " ").trim();
    }
  }

  // Palavras-chave (keywords)
  for (const kw of KEYWORDS) {
    const norm = kw === "cant block" ? "can't block" : kw;
    if (text.includes(kw) || (kw === "cant block" && text.includes("cant block"))) {
      parsed.keywords.push(norm === "cant block" ? "can't block" : kw);
      text = stripAll(text, kw.replace("'", "'"));
      text = text.replace(kw, " ");
    }
  }

  // Cores
  const wordsForColor = text.split(" ");
  const remainingWords = [];
  const colorSet = new Set();
  for (const w of wordsForColor) {
    if (w in COLOR_WORDS) {
      colorSet.add(COLOR_WORDS[w]);
    } else {
      remainingWords.push(w);
    }
  }
  parsed.colors = WUBRG_ORDER.filter((c) => colorSet.has(c));
  text = remainingWords.join(" ").replace(/\s+/g, " ").trim();

  // Remove palavras de preenchimento
  text = text
    .split(" ")
    .filter((w) => w && !FILLER_WORDS.has(w))
    .join(" ")
    .trim();

  // Tenta casar tipo de criatura (catálogo do Scryfall, com fallback embutido)
  const catalog = (creatureTypeCatalog && creatureTypeCatalog.length)
    ? creatureTypeCatalog
    : FALLBACK_CREATURE_TYPES;
  const catalogLower = catalog.map((t) => t.toLowerCase());

  const leftoverWords = text.split(" ").filter(Boolean);
  let matchedType = null;
  let matchedWordIdx = -1;
  for (let i = 0; i < leftoverWords.length; i++) {
    const w = leftoverWords[i];
    if (w.length < 3) continue;
    let best = null;
    let bestDist = Infinity;
    for (let j = 0; j < catalogLower.length; j++) {
      const ct = catalogLower[j];
      if (ct.includes(" ")) continue; // tipos compostos tratados à parte, se necessário
      let dist;
      if (ct === w) dist = 0;
      else if (ct.startsWith(w) || w.startsWith(ct)) dist = 1;
      else dist = levenshtein(ct, w);
      if (dist < bestDist) { bestDist = dist; best = catalog[j]; }
    }
    const threshold = w.length <= 4 ? 1 : 2;
    if (best && bestDist <= threshold) {
      matchedType = best;
      matchedWordIdx = i;
      break;
    }
  }
  if (matchedType) {
    parsed.creatureType = matchedType;
    leftoverWords.splice(matchedWordIdx, 1);
  }

  parsed.freeText = leftoverWords.join(" ").trim();

  // Monta a query Scryfall
  const parts = [];
  parts.push(parsed.isEmblem ? "t:emblem" : "t:token");

  if (parsed.colors.length === 1 && parsed.colors[0] === "c") {
    parts.push("c:colorless");
  } else if (parsed.colors.length > 0) {
    parts.push(`c:${parsed.colors.join("")}`);
  }

  if (parsed.power != null && parsed.toughness != null) {
    parts.push(`pow=${parsed.power}`, `tou=${parsed.toughness}`);
  }

  if (parsed.creatureType) {
    parts.push(`t:"${parsed.creatureType}"`);
  }

  for (const kw of parsed.keywords) {
    parts.push(`o:"${kw}"`);
  }

  if (parsed.freeText) {
    // termos livres (ex.: "clue", "treasure") — busca por nome/texto
    for (const w of parsed.freeText.split(" ")) {
      if (w) parts.push(w);
    }
  }

  return { query: parts.join(" "), parts, parsed };
}

export { FALLBACK_CREATURE_TYPES };
