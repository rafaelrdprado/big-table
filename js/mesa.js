import { getPlayers, addPlayer, getCommandersForPlayer, addCommanderForPlayer } from "./players-store.js";
import { searchCommanderPrints, autocompleteCardName } from "./scryfall.js";

// Layout de cadeiras por número de jogadores: cada entrada é uma lista de
// linhas, cada linha com o número de células que ela contém (larguras iguais
// dentro da linha). 4 jogadores = 2x2, como pedido; os demais seguem o mesmo
// espírito de "mesão" com linhas de tamanhos parecidos.
const MESA_LAYOUTS = {
  2: [[1], [1]],
  3: [[1], [2]],
  4: [[2], [2]],
  5: [[2], [3]],
  6: [[3], [3]],
};

const state = {
  playerCount: null,
  cells: [], // { player: {id,name}, commander: {name,imageUrl,scryfallId,setCode} } | null
  activeIndex: null,
  activePlayer: null,
  autocompleteTimer: null,
};

const $ = (id) => document.getElementById(id);
const el = {
  playerCountButtons: $("playerCountButtons"),
  playerCountOkBtn: $("playerCountOkBtn"),
  mesaSection: $("mesaSection"),
  mesaGrid: $("mesaGrid"),
  startGameBtn: $("startGameBtn"),
  gameSection: $("gameSection"),
  gameGrid: $("gameGrid"),

  playerPickDialog: $("playerPickDialog"),
  playerList: $("playerList"),
  newPlayerNameInput: $("newPlayerNameInput"),
  addPlayerBtn: $("addPlayerBtn"),
  playerPickCancelBtn: $("playerPickCancelBtn"),

  commanderPickDialog: $("commanderPickDialog"),
  commanderPickTitle: $("commanderPickTitle"),
  commanderHistoryWrap: $("commanderHistoryWrap"),
  commanderHistory: $("commanderHistory"),
  commanderNameInput: $("commanderNameInput"),
  commanderSearchBtn: $("commanderSearchBtn"),
  commanderSuggestions: $("commanderSuggestions"),
  commanderArtGrid: $("commanderArtGrid"),
  commanderPickCancelBtn: $("commanderPickCancelBtn"),

  printerToggleBtn: $("printerToggleBtn"),
  printerOverlay: $("printerOverlay"),
  printerCloseBtn: $("printerCloseBtn"),
};

function init() {
  renderPlayerCountButtons();
  wireEvents();
}

// ── Etapa 1: número de jogadores ────────────────────────────────────────────

function renderPlayerCountButtons() {
  el.playerCountButtons.innerHTML = "";
  for (const n of Object.keys(MESA_LAYOUTS).map(Number)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn count-btn";
    btn.textContent = String(n);
    btn.addEventListener("click", () => {
      state.playerCount = n;
      el.playerCountButtons.querySelectorAll(".count-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      el.playerCountOkBtn.disabled = false;
    });
    el.playerCountButtons.appendChild(btn);
  }
}

function onPlayerCountOk() {
  if (!state.playerCount) return;
  state.cells = new Array(state.playerCount).fill(null);
  el.mesaSection.hidden = false;
  el.gameSection.hidden = true;
  renderMesaGrid();
  updateStartGameButton();
  el.mesaSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Etapa 2: montar a mesa ──────────────────────────────────────────────────

function buildGridInto(container, { interactive }) {
  container.innerHTML = "";
  const layout = MESA_LAYOUTS[state.playerCount];
  let index = 0;
  for (const row of layout) {
    const rowEl = document.createElement("div");
    rowEl.className = "mesa-row";
    const cellsInRow = row[0];
    for (let i = 0; i < cellsInRow; i++) {
      const cellIndex = index++;
      const cellEl = interactive ? document.createElement("button") : document.createElement("div");
      cellEl.className = "mesa-cell";
      if (interactive) {
        cellEl.type = "button";
        cellEl.addEventListener("click", () => openPlayerPicker(cellIndex));
      }
      renderCellContent(cellEl, state.cells[cellIndex]);
      rowEl.appendChild(cellEl);
    }
    container.appendChild(rowEl);
  }
}

function renderCellContent(cellEl, cell) {
  cellEl.innerHTML = "";
  cellEl.classList.toggle("mesa-cell-filled", !!cell);
  if (!cell) {
    const plus = document.createElement("span");
    plus.className = "cell-plus";
    plus.textContent = "+";
    const label = document.createElement("span");
    label.className = "cell-label";
    label.textContent = "Toque para escolher";
    cellEl.appendChild(plus);
    cellEl.appendChild(label);
    return;
  }
  if (cell.commander?.imageUrl) {
    const img = document.createElement("img");
    img.className = "cell-img";
    img.src = cell.commander.imageUrl;
    img.alt = cell.commander.name;
    img.loading = "lazy";
    cellEl.appendChild(img);
  }
  const caption = document.createElement("div");
  caption.className = "cell-caption";
  const strong = document.createElement("strong");
  strong.textContent = cell.player.name;
  const span = document.createElement("span");
  span.textContent = cell.commander?.name || "";
  caption.appendChild(strong);
  caption.appendChild(span);
  cellEl.appendChild(caption);
}

function renderMesaGrid() {
  buildGridInto(el.mesaGrid, { interactive: true });
}

function updateStartGameButton() {
  el.startGameBtn.disabled = state.cells.some((c) => !c);
}

function onStartGame() {
  if (state.cells.some((c) => !c)) return;
  buildGridInto(el.gameGrid, { interactive: false });
  el.gameSection.hidden = false;
  el.gameSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Dialog: escolher jogador ────────────────────────────────────────────────

function openPlayerPicker(cellIndex) {
  state.activeIndex = cellIndex;
  renderPlayerList();
  el.newPlayerNameInput.value = "";
  el.playerPickDialog.showModal();
}

function renderPlayerList() {
  el.playerList.innerHTML = "";
  const players = getPlayers();
  if (!players.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nenhum jogador cadastrado ainda — crie um abaixo.";
    el.playerList.appendChild(p);
    return;
  }
  for (const player of players) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pick-item";
    btn.textContent = player.name;
    btn.addEventListener("click", () => selectPlayer(player));
    el.playerList.appendChild(btn);
  }
}

function selectPlayer(player) {
  state.activePlayer = player;
  el.playerPickDialog.close();
  openCommanderPicker(player);
}

function onAddPlayer() {
  const name = el.newPlayerNameInput.value.trim();
  if (!name) return;
  const player = addPlayer(name);
  selectPlayer(player);
}

// ── Dialog: escolher comandante ─────────────────────────────────────────────

function openCommanderPicker(player) {
  el.commanderPickTitle.textContent = `Escolher comandante de ${player.name}`;
  el.commanderNameInput.value = "";
  el.commanderArtGrid.innerHTML = "";
  el.commanderSuggestions.hidden = true;
  el.commanderSuggestions.innerHTML = "";

  const history = getCommandersForPlayer(player.id);
  if (history.length) {
    el.commanderHistoryWrap.hidden = false;
    el.commanderHistory.innerHTML = "";
    for (const commander of history) {
      el.commanderHistory.appendChild(makeCommanderCard(commander, () => finalizeCell(player, commander)));
    }
  } else {
    el.commanderHistoryWrap.hidden = true;
  }

  el.commanderPickDialog.showModal();
}

function makeCommanderCard(commander, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "result-card";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = commander.imageUrl;
  img.alt = commander.name;
  const meta = document.createElement("div");
  meta.className = "result-meta";
  meta.textContent = commander.name;
  btn.appendChild(img);
  btn.appendChild(meta);
  btn.addEventListener("click", onClick);
  return btn;
}

function cardToCommander(card) {
  const uris = card.image_uris || card.card_faces?.[0]?.image_uris || null;
  return {
    name: card.name,
    imageUrl: uris?.art_crop || uris?.normal || "",
    scryfallId: card.id,
    setCode: card.set,
  };
}

async function onCommanderSearch() {
  const name = el.commanderNameInput.value.trim();
  if (!name) return;
  el.commanderSuggestions.hidden = true;
  el.commanderSearchBtn.disabled = true;
  el.commanderSearchBtn.textContent = "Buscando...";
  el.commanderArtGrid.innerHTML = "";
  try {
    const result = await searchCommanderPrints(name);
    if (!result.cards.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Nenhum comandante encontrado com esse nome.";
      el.commanderArtGrid.appendChild(p);
      return;
    }
    for (const card of result.cards) {
      const commander = cardToCommander(card);
      el.commanderArtGrid.appendChild(
        makeCommanderCard(commander, () => finalizeCell(state.activePlayer, commander))
      );
    }
  } catch (err) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = `Erro na busca: ${err.message}`;
    el.commanderArtGrid.appendChild(p);
  } finally {
    el.commanderSearchBtn.disabled = false;
    el.commanderSearchBtn.textContent = "Buscar";
  }
}

function onCommanderNameInput() {
  clearTimeout(state.autocompleteTimer);
  const q = el.commanderNameInput.value.trim();
  if (q.length < 2) {
    el.commanderSuggestions.hidden = true;
    return;
  }
  state.autocompleteTimer = setTimeout(async () => {
    const suggestions = await autocompleteCardName(q);
    renderSuggestions(suggestions);
  }, 300);
}

function renderSuggestions(names) {
  el.commanderSuggestions.innerHTML = "";
  if (!names.length) {
    el.commanderSuggestions.hidden = true;
    return;
  }
  for (const name of names.slice(0, 8)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.textContent = name;
    chip.addEventListener("click", () => {
      el.commanderNameInput.value = name;
      el.commanderSuggestions.hidden = true;
      onCommanderSearch();
    });
    el.commanderSuggestions.appendChild(chip);
  }
  el.commanderSuggestions.hidden = false;
}

function finalizeCell(player, commander) {
  addCommanderForPlayer(player.id, commander);
  state.cells[state.activeIndex] = { player, commander };
  el.commanderPickDialog.close();
  el.gameSection.hidden = true; // configuração mudou — precisa confirmar de novo
  renderMesaGrid();
  updateStartGameButton();
}

// ── Wiring ───────────────────────────────────────────────────────────────

function wireEvents() {
  el.playerCountOkBtn.addEventListener("click", onPlayerCountOk);
  el.startGameBtn.addEventListener("click", onStartGame);

  el.playerPickCancelBtn.addEventListener("click", () => el.playerPickDialog.close());
  el.addPlayerBtn.addEventListener("click", onAddPlayer);
  el.newPlayerNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onAddPlayer(); }
  });

  el.commanderPickCancelBtn.addEventListener("click", () => el.commanderPickDialog.close());
  el.commanderSearchBtn.addEventListener("click", onCommanderSearch);
  el.commanderNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onCommanderSearch(); }
  });
  el.commanderNameInput.addEventListener("input", onCommanderNameInput);

  el.printerToggleBtn.addEventListener("click", () => { el.printerOverlay.hidden = false; });
  el.printerCloseBtn.addEventListener("click", () => { el.printerOverlay.hidden = true; });
}

init();
