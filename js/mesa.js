import { getPlayers, addPlayer, getCommandersForPlayer, addCommanderForPlayer } from "./players-store.js";
import { searchCommanderPrints, autocompleteCardName } from "./scryfall.js";
import { getMatches, addMatch } from "./matches-store.js";

// Opções de layout de cadeiras por número de jogadores — o jogador escolhe
// qual usar. Cada opção é uma lista de linhas, cada linha com o número de
// cadeiras que ela contém (larguras iguais dentro da linha).
const LAYOUT_OPTIONS = {
  2: [[1, 1], [2]],
  3: [[1, 2], [2, 1]],
  4: [[1, 2, 1], [2, 2]],
  5: [[2, 2, 1], [1, 2, 2]],
  6: [[2, 2, 2], [1, 2, 2, 1]],
};

const LIFE_TOTAL_OPTIONS = [20, 25, 30, 40, 60];
const LIFE_START = 40; // padrão pré-selecionado (o mais comum em Commander)

const TIMER_MODE_OPTIONS = [
  { value: "off", label: "Desativado" },
  { value: "chess", label: "Relógio de xadrez" },
];
const MINUTES_PER_PLAYER_OPTIONS = [5, 10, 15, 30, 60];
const MINUTES_PER_PLAYER_START = 10;

const state = {
  playerCount: null,
  layoutRows: null, // linha escolhida, ex.: [2, 2] — array de nº de cadeiras por linha
  lifeTotal: LIFE_START, // vida inicial escolhida — independente de nº de jogadores/layout
  timerMode: "off", // "off" | "chess"
  minutesPerPlayer: MINUTES_PER_PLAYER_START, // só usado no modo "chess"
  cells: [], // { player: {id,name}, commander: {name,imageUrl,scryfallId,setCode} } | null
  lifeState: [], // { life, deltaAccum, hideTimer } — um por célula, criado ao começar a partida
  commanderDamage: [], // commanderDamage[alvo][origem] = { main, partner } — dano que cada comandante de "origem" já deu em "alvo" (partner só é usado/mostrado se a célula tiver parceiro)
  cmdDamageTargetIndex: null, // célula sendo visualizada na tela de dano de comandante
  clockState: [], // { remainingMs } por célula — só existe/roda no modo "chess"
  clockIntervalId: null,
  clockLastTick: null,
  startingPlayerChoice: "random", // "random" | índice da célula escolhida
  currentTurnIndex: null, // índice da célula com o turno ativo, definido ao começar a partida
  currentPriorityIndex: null, // índice da célula com a prioridade — controla qual relógio corre; só existe/importa no modo "chess"
  startingTurnIndex: null, // célula que começou a partida — fecha uma volta quando o turno volta pra ela
  turnNumber: 1, // nº da volta atual, incrementado sempre que o turno completa o ciclo e volta pro início
  matchStartedAt: null, // timestamp de quando a partida atual começou — usado pro registro no placar
  turnOrder: [], // índices de célula na ordem horária da mesa, calculado ao começar a partida
  gameCellRefs: [], // { cellEl, passBtn, priorityBtn, clockEl, applyLifeDelta } por célula da página de jogo, pra atualizar turno/prioridade/vida sem redesenhar tudo
  activeIndex: null,
  activePlayer: null,
  activeMainCommander: null, // comandante principal já escolhido, enquanto se decide o parceiro (opcional)
  commanderPickMode: "main", // "main" | "partner" — controla o que a busca/histórico do diálogo alimenta
  autocompleteTimer: null,
  resizeTimer: null,
  // Pilha de "páginas": só a do topo fica visível. Voltar = pop.
  pageStack: ["count"],
};

const $ = (id) => document.getElementById(id);
const el = {
  playerCountSection: $("playerCountSection"),
  playerCountButtons: $("playerCountButtons"),
  layoutChoiceWrap: $("layoutChoiceWrap"),
  layoutChoiceButtons: $("layoutChoiceButtons"),
  lifeTotalButtons: $("lifeTotalButtons"),
  timerModeButtons: $("timerModeButtons"),
  minutesPerPlayerWrap: $("minutesPerPlayerWrap"),
  minutesPerPlayerButtons: $("minutesPerPlayerButtons"),
  playerCountOkBtn: $("playerCountOkBtn"),
  mesaSection: $("mesaSection"),
  mesaGrid: $("mesaGrid"),
  startingPlayerButtons: $("startingPlayerButtons"),
  startGameBtn: $("startGameBtn"),
  gameSection: $("gameSection"),
  gameGrid: $("gameGrid"),

  cmdDamageSection: $("cmdDamageSection"),
  cmdDamageTitle: $("cmdDamageTitle"),
  cmdDamageGrid: $("cmdDamageGrid"),

  topbarTitle: $("topbarTitle"),
  topbarBackBtn: $("topbarBackBtn"),
  turnCounterBadge: $("turnCounterBadge"),

  playerPickDialog: $("playerPickDialog"),
  playerList: $("playerList"),
  newPlayerNameInput: $("newPlayerNameInput"),
  addPlayerBtn: $("addPlayerBtn"),
  playerPickCancelBtn: $("playerPickCancelBtn"),

  commanderPickDialog: $("commanderPickDialog"),
  commanderPickTitle: $("commanderPickTitle"),
  mainCommanderChosenWrap: $("mainCommanderChosenWrap"),
  mainCommanderChosenImg: $("mainCommanderChosenImg"),
  mainCommanderChosenName: $("mainCommanderChosenName"),
  changeMainCommanderBtn: $("changeMainCommanderBtn"),
  commanderHistoryWrap: $("commanderHistoryWrap"),
  commanderHistory: $("commanderHistory"),
  commanderSearchLabel: $("commanderSearchLabel"),
  commanderNameInput: $("commanderNameInput"),
  commanderSearchBtn: $("commanderSearchBtn"),
  commanderSuggestions: $("commanderSuggestions"),
  commanderArtGrid: $("commanderArtGrid"),
  skipPartnerBtn: $("skipPartnerBtn"),
  commanderPickCancelBtn: $("commanderPickCancelBtn"),

  leaveGameDialog: $("leaveGameDialog"),
  leaveGameCancelBtn: $("leaveGameCancelBtn"),
  leaveGameConfirmBtn: $("leaveGameConfirmBtn"),

  selectWinnerDialog: $("selectWinnerDialog"),
  winnerList: $("winnerList"),
  winnerCancelBtn: $("winnerCancelBtn"),
  winnerConfirmBtn: $("winnerConfirmBtn"),

  printerToggleBtn: $("printerToggleBtn"),
  printerOverlay: $("printerOverlay"),
  printerCloseBtn: $("printerCloseBtn"),

  scoreboardToggleBtn: $("scoreboardToggleBtn"),
  scoreboardDialog: $("scoreboardDialog"),
  scoreboardCloseBtn: $("scoreboardCloseBtn"),
  scoreboardList: $("scoreboardList"),
};

function init() {
  renderPlayerCountButtons();
  renderLifeTotalButtons();
  renderTimerModeButtons();
  renderMinutesPerPlayerButtons();
  wireEvents();
  showTopPage();
}

// ── Navegação em pilha (uma "página" visível por vez) ───────────────────────

function showTopPage() {
  const top = state.pageStack[state.pageStack.length - 1];
  el.playerCountSection.hidden = top !== "count";
  el.mesaSection.hidden = top !== "mesa";
  el.gameSection.hidden = top !== "game";
  el.cmdDamageSection.hidden = top !== "cmdDamage";
  // Voltar e o título do app são mutuamente exclusivos na topbar: a página
  // inicial mostra o título; qualquer outra mostra "← Voltar" no lugar dele,
  // pra caber numa linha só e sem duplicar navegação.
  el.topbarTitle.hidden = top !== "count";
  el.topbarBackBtn.hidden = top === "count";
  el.turnCounterBadge.hidden = top !== "game";
  window.scrollTo({ top: 0, behavior: "smooth" });
  // Só dá pra medir o tamanho real das células (pra montar o rotor dos
  // assentos de lado) depois que a seção correspondente ficou visível.
  if (top === "mesa") sizeRotatedSideCells(el.mesaGrid);
  else if (top === "game") sizeRotatedSideCells(el.gameGrid);
  else if (top === "cmdDamage") sizeRotatedSideCells(el.cmdDamageGrid);
}

function pushPage(name) {
  state.pageStack.push(name);
  showTopPage();
}

function popPage() {
  if (state.pageStack.length > 1) state.pageStack.pop();
  showTopPage();
}

// ── Etapa 1: número de jogadores ────────────────────────────────────────────

function renderPlayerCountButtons() {
  el.playerCountButtons.innerHTML = "";
  for (const n of Object.keys(LAYOUT_OPTIONS).map(Number)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn count-btn";
    btn.textContent = String(n);
    btn.addEventListener("click", () => {
      state.playerCount = n;
      el.playerCountButtons.querySelectorAll(".count-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      renderLayoutChoices(n);
    });
    el.playerCountButtons.appendChild(btn);
  }
}

// Vida inicial — independente do nº de jogadores/layout escolhidos, por isso
// fica sempre visível e já vem com um padrão (40) pré-selecionado.
function renderLifeTotalButtons() {
  el.lifeTotalButtons.innerHTML = "";
  for (const n of LIFE_TOTAL_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn count-btn";
    if (n === state.lifeTotal) btn.classList.add("selected");
    btn.textContent = String(n);
    btn.addEventListener("click", () => {
      state.lifeTotal = n;
      el.lifeTotalButtons.querySelectorAll(".count-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    el.lifeTotalButtons.appendChild(btn);
  }
}

// Temporizador de turno — "chess" só faz sentido com um nº de minutos por
// jogador, por isso a seção de minutos só aparece quando esse modo é
// escolhido.
function renderTimerModeButtons() {
  el.timerModeButtons.innerHTML = "";
  for (const opt of TIMER_MODE_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn count-btn";
    btn.textContent = opt.label;
    if (state.timerMode === opt.value) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      state.timerMode = opt.value;
      el.timerModeButtons.querySelectorAll(".count-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      el.minutesPerPlayerWrap.hidden = opt.value !== "chess";
    });
    el.timerModeButtons.appendChild(btn);
  }
}

function renderMinutesPerPlayerButtons() {
  el.minutesPerPlayerButtons.innerHTML = "";
  for (const n of MINUTES_PER_PLAYER_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn count-btn";
    if (n === state.minutesPerPlayer) btn.classList.add("selected");
    btn.textContent = String(n);
    btn.addEventListener("click", () => {
      state.minutesPerPlayer = n;
      el.minutesPerPlayerButtons.querySelectorAll(".count-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    el.minutesPerPlayerButtons.appendChild(btn);
  }
}

function buildLayoutDiagram(rows) {
  const diagram = document.createElement("div");
  diagram.className = "layout-diagram";
  for (const count of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "layout-diagram-row";
    for (let i = 0; i < count; i++) {
      const seat = document.createElement("span");
      seat.className = "layout-diagram-seat";
      rowEl.appendChild(seat);
    }
    diagram.appendChild(rowEl);
  }
  return diagram;
}

function renderLayoutChoices(n) {
  state.layoutRows = null;
  el.playerCountOkBtn.disabled = true;
  el.layoutChoiceButtons.innerHTML = "";
  for (const rows of LAYOUT_OPTIONS[n]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "layout-choice-btn";
    btn.appendChild(buildLayoutDiagram(rows));
    btn.addEventListener("click", () => {
      state.layoutRows = rows;
      el.layoutChoiceButtons.querySelectorAll(".layout-choice-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      el.playerCountOkBtn.disabled = false;
    });
    el.layoutChoiceButtons.appendChild(btn);
  }
  el.layoutChoiceWrap.hidden = false;
}

function onPlayerCountOk() {
  if (!state.playerCount || !state.layoutRows) return;
  state.cells = new Array(state.playerCount).fill(null);
  renderMesaGrid();
  updateStartGameButton();
  pushPage("mesa");
}

// ── Etapa 2: montar a mesa ──────────────────────────────────────────────────

// A mesa é montada exatamente como o array LAYOUT_OPTIONS descreve: cada
// entrada é uma LINHA, empilhada de cima pra baixo; dentro de cada linha as
// cadeiras ficam lado a lado, da esquerda pra direita.
//
// Cada cadeira gira só de acordo com o tamanho da SUA linha, não com a
// posição da linha (exceto pra decidir 180° vs 0° numa linha de 1):
//   - linha de 1 cadeira (ponta da mesa): 180° se for a primeira linha
//     (topo — vira pra "olhar" pra baixo, em direção à mesa), 0° se for a
//     última (base — já "olha" pra cima na orientação natural).
//   - linha de 2 cadeiras: a da esquerda sempre 90° ("virada pra direita"),
//     a da direita sempre 270° ("virada pra esquerda") — vale pra qualquer
//     linha de 2, esteja ela sozinha, ao lado de outras iguais (2x2, 2x2x2)
//     ou entre linhas de 1 (1,2,1 etc.).
function buildGridInto(container, cellRenderer) {
  container.innerHTML = "";
  const rows = state.layoutRows; // cada valor = nº de cadeiras daquela linha

  let index = 0;
  rows.forEach((seatsInRow, rowPos) => {
    const rowEl = document.createElement("div");
    rowEl.className = "mesa-row";
    const isFirst = rowPos === 0;

    for (let i = 0; i < seatsInRow; i++) {
      const cellEl = cellRenderer(index++);
      const angle = seatsInRow === 1 ? (isFirst ? 180 : 0) : (i === 0 ? 90 : 270);
      applyCellRotation(cellEl, angle);
      rowEl.appendChild(cellEl);
    }
    container.appendChild(rowEl);
  });
}

function applyCellRotation(cellEl, angle) {
  if (angle === 180) {
    // 180° não troca largura por altura — cabe igual, gira a célula direto.
    cellEl.classList.add("cell-rot-180");
  } else if (angle === 90 || angle === 270) {
    wrapCellForRotor(cellEl, angle);
  }
}

// 90°/270° trocam largura por altura: uma célula deitada simplesmente girada
// não cobre mais o espaço retangular dela (sobra vão nas bordas, conteúdo
// cortado). Em vez de girar a célula inteira, todo o conteúdo já montado
// nela vai para um "rotor" interno com as dimensões trocadas (medidas de
// verdade em px via sizeRotatedSideCells, depois que a célula está visível
// no layout — ver showTopPage), que aí sim gira e cobre a célula original
// certinho.
function wrapCellForRotor(cellEl, angle) {
  const rotor = document.createElement("div");
  rotor.className = `cell-rotor cell-rotor-${angle}`;
  while (cellEl.firstChild) rotor.appendChild(cellEl.firstChild);
  cellEl.appendChild(rotor);
  cellEl.classList.add("mesa-cell-has-rotor");
}

function sizeRotatedSideCells(container) {
  if (!container) return;
  container.querySelectorAll(".mesa-cell-has-rotor").forEach((cellEl) => {
    const rotor = cellEl.querySelector(":scope > .cell-rotor");
    if (!rotor) return;
    const w = cellEl.clientWidth;
    const h = cellEl.clientHeight;
    if (!w || !h) return; // ainda escondida/sem layout — tenta de novo quando ficar visível
    rotor.style.width = `${h}px`;
    rotor.style.height = `${w}px`;
  });
}

function makeMesaCell(cellIndex) {
  const cellEl = document.createElement("button");
  cellEl.type = "button";
  cellEl.className = "mesa-cell";
  cellEl.addEventListener("click", () => openPlayerPicker(cellIndex));
  renderCellContent(cellEl, state.cells[cellIndex]);
  return cellEl;
}

// Nome pra exibir na legenda: junta os dois quando há parceiro.
function commanderDisplayName(cell) {
  if (!cell.commander) return "";
  return cell.partner ? `${cell.commander.name} & ${cell.partner.name}` : cell.commander.name;
}

// Com parceiro, a célula é dividida ao meio (uma imagem de cada comandante);
// sem parceiro, uma imagem só cobrindo a célula inteira, como sempre foi.
function appendCommanderImages(cellEl, cell) {
  if (!cell.commander?.imageUrl) return;
  if (cell.partner?.imageUrl) {
    const left = document.createElement("img");
    left.className = "cell-img cell-img-half cell-img-half-left";
    left.src = cell.commander.imageUrl;
    left.alt = cell.commander.name;
    left.loading = "lazy";
    const right = document.createElement("img");
    right.className = "cell-img cell-img-half cell-img-half-right";
    right.src = cell.partner.imageUrl;
    right.alt = cell.partner.name;
    right.loading = "lazy";
    cellEl.appendChild(left);
    cellEl.appendChild(right);
  } else {
    const img = document.createElement("img");
    img.className = "cell-img";
    img.src = cell.commander.imageUrl;
    img.alt = cell.commander.name;
    img.loading = "lazy";
    cellEl.appendChild(img);
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
  appendCommanderImages(cellEl, cell);
  const caption = document.createElement("div");
  caption.className = "cell-caption";
  const strong = document.createElement("strong");
  strong.textContent = cell.player.name;
  const span = document.createElement("span");
  span.textContent = commanderDisplayName(cell);
  caption.appendChild(strong);
  caption.appendChild(span);
  cellEl.appendChild(caption);
}

function renderMesaGrid() {
  buildGridInto(el.mesaGrid, makeMesaCell);
  sizeRotatedSideCells(el.mesaGrid); // no-op se a seção ainda estiver escondida
  renderStartingPlayerButtons();
}

// Jogador inicial — lista cresce conforme as cadeiras vão sendo preenchidas.
// Se o jogador escolhido antes for removido/trocado de cadeira, volta pro
// padrão "aleatório" em vez de apontar pra célula errada.
function renderStartingPlayerButtons() {
  if (
    state.startingPlayerChoice !== "random" &&
    !state.cells[state.startingPlayerChoice]
  ) {
    state.startingPlayerChoice = "random";
  }

  el.startingPlayerButtons.innerHTML = "";

  const makeBtn = (label, value) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn count-btn";
    btn.textContent = label;
    if (state.startingPlayerChoice === value) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      state.startingPlayerChoice = value;
      el.startingPlayerButtons.querySelectorAll(".count-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    return btn;
  };

  el.startingPlayerButtons.appendChild(makeBtn("Aleatório", "random"));
  state.cells.forEach((cell, index) => {
    if (cell) el.startingPlayerButtons.appendChild(makeBtn(cell.player.name, index));
  });
}

function updateStartGameButton() {
  el.startGameBtn.disabled = state.cells.some((c) => !c);
}

function pickStartingIndex() {
  if (state.startingPlayerChoice !== "random") return state.startingPlayerChoice;
  return Math.floor(Math.random() * state.cells.length);
}

// A mesa (state.layoutRows) é uma lista de COLUNAS — ver comentário grande em
// buildGridInto. Física da mesa: colunas com 1 cadeira só existem na ponta
// esquerda (primeira) ou direita (última) e ocupam a lateral inteira ali;
// colunas com 2 cadeiras têm uma de cada lado longo (índice 0 = de cima,
// índice 1 = de baixo). O sentido horário, visto de cima, é: ponta esquerda
// (se houver) → topo da esquerda pra direita → ponta direita (se houver) →
// base da direita pra esquerda → de volta pra ponta/início esquerdo.
function computeClockwiseOrder() {
  const cols = state.layoutRows;
  const colSeats = [];
  let idx = 0;
  for (const seatsInCol of cols) {
    const seats = [];
    for (let i = 0; i < seatsInCol; i++) seats.push(idx++);
    colSeats.push(seats);
  }

  const first = colSeats[0];
  const last = colSeats[colSeats.length - 1];
  const order = [];

  if (first.length === 1) order.push(first[0]);
  for (const seats of colSeats) {
    if (seats.length === 2) order.push(seats[0]);
  }
  if (last.length === 1 && last !== first) order.push(last[0]);
  for (let i = colSeats.length - 1; i >= 0; i--) {
    if (colSeats[i].length === 2) order.push(colSeats[i][1]);
  }
  return order;
}

// Atualiza só a célula que perde e a que ganha o turno (não redesenha a
// mesa toda, então timers de delta e afins de outras células não são
// perturbados).
function setActiveTurn(index) {
  const prevRef = state.gameCellRefs[state.currentTurnIndex];
  if (prevRef) {
    prevRef.cellEl.classList.remove("life-cell-active-turn");
    prevRef.passBtn.disabled = true;
  }
  state.currentTurnIndex = index;
  const nextRef = state.gameCellRefs[index];
  if (nextRef) {
    nextRef.cellEl.classList.add("life-cell-active-turn");
    nextRef.passBtn.disabled = false;
  }
}

// Prioridade é independente do turno: controla só qual relógio corre.
// Qualquer jogador pode tomar a prioridade de quem estiver com ela (exceto
// dele mesmo, já que não faz sentido tomar a própria prioridade).
function setPriority(index) {
  const prevRef = state.gameCellRefs[state.currentPriorityIndex];
  if (prevRef?.priorityBtn) prevRef.priorityBtn.disabled = false;
  state.currentPriorityIndex = index;
  const nextRef = state.gameCellRefs[index];
  if (nextRef?.priorityBtn) nextRef.priorityBtn.disabled = true;
}

function advanceTurn() {
  const order = state.turnOrder;
  const pos = order.indexOf(state.currentTurnIndex);
  const next = order[(pos + 1) % order.length];
  setActiveTurn(next);
  setPriority(next); // quem recebe o turno também recebe a prioridade de volta
  // Uma volta completa é fechada quando o turno volta pra quem começou.
  if (next === state.startingTurnIndex) {
    state.turnNumber += 1;
    updateTurnCounterBadge();
  }
}

function updateTurnCounterBadge() {
  el.turnCounterBadge.textContent = `Turno ${state.turnNumber}`;
}

// ── Relógio de xadrez ────────────────────────────────────────────────────

function formatClock(ms) {
  const sign = ms < 0 ? "-" : "";
  const totalSeconds = Math.ceil(Math.abs(ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

// Só o relógio de quem está com a PRIORIDADE anda (não necessariamente quem
// está com o turno — ver setPriority). Cada tick desconta o tempo real
// decorrido só dessa célula, então as outras ficam paradas naturalmente,
// sem precisar de lógica extra de pausa.
function tickChessClock() {
  const now = Date.now();
  const elapsed = now - state.clockLastTick;
  state.clockLastTick = now;
  const clock = state.clockState[state.currentPriorityIndex];
  if (!clock) return;
  // Sem clamp em 0: o tempo continua correndo pro negativo (estourou o
  // tempo), só muda de cor — ver toggle de life-clock-badge-negative.
  clock.remainingMs -= elapsed;
  const ref = state.gameCellRefs[state.currentPriorityIndex];
  if (ref?.clockEl) {
    ref.clockEl.textContent = formatClock(clock.remainingMs);
    ref.clockEl.classList.toggle("life-clock-badge-negative", clock.remainingMs < 0);
  }
}

function stopChessClock() {
  clearInterval(state.clockIntervalId);
  state.clockIntervalId = null;
}

function startChessClock() {
  stopChessClock();
  state.clockLastTick = Date.now();
  state.clockIntervalId = setInterval(tickChessClock, 250);
}

function onGameBack() {
  stopChessClock();
  popPage();
}

// Um único botão de voltar na topbar serve todas as sub-páginas — só a
// página "game" pede confirmação (e possivelmente o vencedor) antes de sair,
// já que ali existe uma partida em andamento pra encerrar.
function onTopbarBack() {
  const top = state.pageStack[state.pageStack.length - 1];
  if (top === "game") confirmLeaveGame();
  else popPage();
}

function confirmLeaveGame() {
  el.leaveGameDialog.showModal();
}

// Só pede pra escolher o vencedor se o resultado não for óbvio (exatamente
// um jogador de pé) — com zero ou vários ainda vivos, alguém decide manual.
function onLeaveGameConfirmed() {
  el.leaveGameDialog.close();
  const aliveIndex = state.lifeState.findIndex((life) => life.life > 0);
  const aliveCount = state.lifeState.filter((life) => life.life > 0).length;
  if (aliveCount === 1) {
    // Resultado óbvio — só um de pé, nem precisa perguntar.
    recordMatch([state.cells[aliveIndex].player.id]);
    onGameBack();
  } else {
    renderWinnerList();
    el.selectWinnerDialog.showModal();
  }
}

function renderWinnerList() {
  el.winnerList.innerHTML = "";
  for (const cell of state.cells) {
    if (!cell) continue;
    const label = document.createElement("label");
    label.className = "pick-item pick-item-checkbox";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.playerId = cell.player.id;
    checkbox.addEventListener("change", () => label.classList.toggle("selected", checkbox.checked));
    const meta = document.createElement("div");
    meta.className = "pick-item-meta";
    const strong = document.createElement("strong");
    strong.textContent = cell.player.name;
    const span = document.createElement("span");
    span.textContent = commanderDisplayName(cell);
    meta.appendChild(strong);
    meta.appendChild(span);
    label.appendChild(checkbox);
    label.appendChild(meta);
    el.winnerList.appendChild(label);
  }
}

function onWinnerConfirmed() {
  const winnerPlayerIds = [...el.winnerList.querySelectorAll("input:checked")].map((cb) => cb.dataset.playerId);
  el.selectWinnerDialog.close();
  recordMatch(winnerPlayerIds);
  onGameBack();
}

// Registra a partida que está terminando no placar (localStorage) — os
// comandantes/parceiro de cada jogador são copiados pro registro porque a
// mesa é desmontada ao sair, então não dá pra ler de volta de state.cells.
function recordMatch(winnerPlayerIds) {
  const endedAt = Date.now();
  addMatch({
    id: (crypto.randomUUID && crypto.randomUUID()) || `m_${endedAt}_${Math.random().toString(36).slice(2)}`,
    startedAt: state.matchStartedAt,
    endedAt,
    durationMs: endedAt - state.matchStartedAt,
    players: state.cells.map((cell) => ({
      playerId: cell.player.id,
      playerName: cell.player.name,
      commander: { name: cell.commander.name, imageUrl: cell.commander.imageUrl },
      partner: cell.partner ? { name: cell.partner.name, imageUrl: cell.partner.imageUrl } : null,
    })),
    winnerPlayerIds,
  });
}

// ── Placar ───────────────────────────────────────────────────────────────

function openScoreboard() {
  renderScoreboard();
  el.scoreboardDialog.showModal();
}

function renderScoreboard() {
  const matches = getMatches();
  el.scoreboardList.innerHTML = "";
  if (!matches.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nenhuma partida registrada ainda.";
    el.scoreboardList.appendChild(p);
    return;
  }
  for (const match of matches) {
    el.scoreboardList.appendChild(makeMatchRow(match));
  }
}

function formatClockTime(ts) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// O comandante é representado pela figura (ou duas, com parceiro); o nome
// escrito ao lado é o do JOGADOR, não do comandante — várias figuras
// diferentes podem passar pela mesma "cadeira" ao longo de partidas.
function makeMatchChip(player, isWinner) {
  const chip = document.createElement("span");
  chip.className = "match-chip" + (isWinner ? " match-chip-winner" : "");

  const images = document.createElement("span");
  images.className = "match-chip-images";
  const img1 = document.createElement("img");
  img1.src = player.commander.imageUrl;
  img1.alt = player.commander.name;
  images.appendChild(img1);
  if (player.partner) {
    const img2 = document.createElement("img");
    img2.src = player.partner.imageUrl;
    img2.alt = player.partner.name;
    images.appendChild(img2);
  }
  chip.appendChild(images);

  const name = document.createElement("span");
  name.textContent = player.playerName;
  chip.appendChild(name);

  return chip;
}

function makeMatchRow(match) {
  const row = document.createElement("div");
  row.className = "match-row";

  const header = document.createElement("div");
  header.className = "match-row-header";
  const time = document.createElement("span");
  time.textContent = `${formatClockTime(match.startedAt)} – ${formatClockTime(match.endedAt)}`;
  const duration = document.createElement("span");
  duration.textContent = formatDuration(match.durationMs);
  header.appendChild(time);
  header.appendChild(duration);
  row.appendChild(header);

  const playersLabel = document.createElement("div");
  playersLabel.className = "match-section-label";
  playersLabel.textContent = "Jogadores";
  row.appendChild(playersLabel);
  const playersChips = document.createElement("div");
  playersChips.className = "match-chips";
  for (const player of match.players) {
    playersChips.appendChild(makeMatchChip(player, match.winnerPlayerIds.includes(player.playerId)));
  }
  row.appendChild(playersChips);

  const winners = match.players.filter((p) => match.winnerPlayerIds.includes(p.playerId));
  const winnerLabel = document.createElement("div");
  winnerLabel.className = "match-section-label";
  winnerLabel.textContent = winners.length > 1 ? "Vencedores (empate)" : "Vencedor";
  row.appendChild(winnerLabel);
  const winnerChips = document.createElement("div");
  winnerChips.className = "match-chips";
  if (winners.length) {
    for (const player of winners) winnerChips.appendChild(makeMatchChip(player, true));
  } else {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = "Sem vencedor declarado";
    winnerChips.appendChild(span);
  }
  row.appendChild(winnerChips);

  return row;
}

function onStartGame() {
  if (state.cells.some((c) => !c)) return;
  state.matchStartedAt = Date.now();
  state.lifeState = state.cells.map(() => ({ life: state.lifeTotal, deltaAccum: 0, hideTimer: null }));
  state.commanderDamage = state.cells.map(() => state.cells.map(() => ({ main: 0, partner: 0 })));
  state.turnOrder = computeClockwiseOrder();
  state.gameCellRefs = new Array(state.cells.length).fill(null);
  state.currentTurnIndex = pickStartingIndex();
  state.currentPriorityIndex = state.currentTurnIndex; // quem começa a partida também começa com a prioridade
  state.startingTurnIndex = state.currentTurnIndex;
  state.turnNumber = 1;
  updateTurnCounterBadge();

  if (state.timerMode === "chess") {
    state.clockState = state.cells.map(() => ({ remainingMs: state.minutesPerPlayer * 60000 }));
    startChessClock();
  } else {
    state.clockState = [];
    stopChessClock();
  }

  buildGridInto(el.gameGrid, makeLifeCell);
  pushPage("game"); // já mede os rotores ao mostrar a página
}

// ── Etapa 3: contador de vida ────────────────────────────────────────────────

const HOLD_MS = 1000;
const HOLD_REPEAT_MS = 400; // ritmo do +10/-10 repetido enquanto segura
const DELTA_HIDE_MS = 5000;

/**
 * Toque rápido = onTap. Pressionar e segurar por HOLD_MS = onHold, repetindo
 * a cada HOLD_REPEAT_MS enquanto o dedo/botão continuar pressionado. Funciona
 * com mouse e toque (Pointer Events cobrem os dois).
 */
function attachHoldTap(zoneEl, { onTap, onHold }) {
  let timer = null;
  let repeatTimer = null;
  let holdFired = false;

  const cancel = () => {
    clearTimeout(timer);
    clearInterval(repeatTimer);
    timer = null;
    repeatTimer = null;
  };

  zoneEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    // Best-effort: evita perder o toque se o dedo escorrega um pouco. Nunca
    // deve impedir o timer do hold de ser armado abaixo.
    try { zoneEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    holdFired = false;
    timer = setTimeout(() => {
      holdFired = true;
      onHold();
      repeatTimer = setInterval(onHold, HOLD_REPEAT_MS);
    }, HOLD_MS);
  });
  zoneEl.addEventListener("pointerup", () => {
    cancel();
    if (!holdFired) onTap(); // se o hold já disparou o +10/-10, não soma o toque também
  });
  zoneEl.addEventListener("pointerleave", cancel);
  zoneEl.addEventListener("pointercancel", cancel);
}

function formatDelta(n) {
  return n > 0 ? `+${n}` : String(n);
}

function makeLifeCell(cellIndex) {
  const cell = state.cells[cellIndex];
  const life = state.lifeState[cellIndex];

  const cellEl = document.createElement("div");
  cellEl.className = "mesa-cell life-cell";
  if (cellIndex === state.currentTurnIndex) cellEl.classList.add("life-cell-active-turn");

  appendCommanderImages(cellEl, cell);

  const scrim = document.createElement("div");
  scrim.className = "cell-scrim";
  cellEl.appendChild(scrim);

  const zoneUp = document.createElement("button");
  zoneUp.type = "button";
  zoneUp.className = "life-zone life-zone-up";
  zoneUp.setAttribute("aria-label", `Aumentar vida de ${cell.player.name}`);
  const zoneDown = document.createElement("button");
  zoneDown.type = "button";
  zoneDown.className = "life-zone life-zone-down";
  zoneDown.setAttribute("aria-label", `Diminuir vida de ${cell.player.name}`);
  cellEl.appendChild(zoneUp);
  cellEl.appendChild(zoneDown);

  const lifeDisplay = document.createElement("div");
  lifeDisplay.className = "life-display";
  // life-number fica no centro exato da célula, sempre — o delta é um filho
  // dele posicionado à parte (não entra no fluxo), então nunca desloca o
  // número ao aparecer/desaparecer.
  const lifeNumber = document.createElement("span");
  lifeNumber.className = "life-number";
  const lifeNumberText = document.createElement("span");
  lifeNumberText.className = "life-number-text";
  lifeNumberText.textContent = String(life.life);
  const lifeDelta = document.createElement("span");
  lifeDelta.className = "life-delta";
  lifeDelta.hidden = true;
  lifeNumber.appendChild(lifeNumberText);
  lifeNumber.appendChild(lifeDelta);
  lifeDisplay.appendChild(lifeNumber);
  const lifeSkull = document.createElement("span");
  lifeSkull.className = "life-skull";
  lifeSkull.textContent = "☠️";
  lifeSkull.hidden = true;
  lifeDisplay.appendChild(lifeSkull);
  cellEl.appendChild(lifeDisplay);

  const caption = document.createElement("div");
  caption.className = "cell-caption life-caption";
  const strong = document.createElement("strong");
  strong.textContent = cell.player.name;
  const span = document.createElement("span");
  span.textContent = commanderDisplayName(cell);
  caption.appendChild(strong);
  caption.appendChild(span);
  cellEl.appendChild(caption);

  const cornerActions = document.createElement("div");
  cornerActions.className = "life-corner-actions";
  cellEl.appendChild(cornerActions);

  const cmdDamageBtn = document.createElement("button");
  cmdDamageBtn.type = "button";
  cmdDamageBtn.className = "life-corner-btn life-cmd-damage-btn";
  cmdDamageBtn.textContent = "Dano de comandante";
  cmdDamageBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openCommanderDamage(cellIndex);
  });
  cornerActions.appendChild(cmdDamageBtn);

  // "Pegar prioridade" só faz sentido junto do relógio de xadrez (é o que
  // ela controla — ver setPriority/tickChessClock), por isso só existe
  // nesse modo, assim como o próprio relógio.
  let priorityBtn = null;
  if (state.timerMode === "chess") {
    priorityBtn = document.createElement("button");
    priorityBtn.type = "button";
    priorityBtn.className = "life-corner-btn life-priority-btn";
    priorityBtn.textContent = "Pegar prioridade";
    priorityBtn.disabled = cellIndex === state.currentPriorityIndex;
    priorityBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setPriority(cellIndex);
    });
    cornerActions.appendChild(priorityBtn);
  }

  const passBtn = document.createElement("button");
  passBtn.type = "button";
  passBtn.className = "life-corner-btn life-pass-turn-btn";
  passBtn.textContent = "Passar turno";
  passBtn.disabled = cellIndex !== state.currentTurnIndex;
  passBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    advanceTurn();
  });
  cornerActions.appendChild(passBtn);

  let clockEl = null;
  if (state.timerMode === "chess") {
    clockEl = document.createElement("div");
    clockEl.className = "life-clock-badge";
    clockEl.textContent = formatClock(state.clockState[cellIndex].remainingMs);
    cellEl.appendChild(clockEl);
  }

  state.gameCellRefs[cellIndex] = { cellEl, passBtn, priorityBtn, clockEl, applyLifeDelta: applyDelta };

  function updateDeadVisual() {
    const dead = life.life <= 0;
    cellEl.classList.toggle("life-cell-dead", dead);
    lifeNumber.hidden = dead;
    lifeSkull.hidden = !dead;
  }

  function applyDelta(amount) {
    // Vida nunca fica negativa. Uma vez morto (vida 0), só é possível
    // aumentar a vida de novo — apertar para baixo não faz nada.
    if (amount < 0 && life.life <= 0) return;

    const before = life.life;
    life.life = Math.max(0, life.life + amount);
    const applied = life.life - before;
    if (applied === 0) return;

    life.deltaAccum += applied;
    lifeNumberText.textContent = String(life.life);
    lifeDelta.hidden = false;
    lifeDelta.textContent = formatDelta(life.deltaAccum);
    lifeDelta.classList.toggle("life-delta-negative", life.deltaAccum < 0);
    updateDeadVisual();

    clearTimeout(life.hideTimer);
    life.hideTimer = setTimeout(() => {
      lifeDelta.hidden = true;
      life.deltaAccum = 0;
    }, DELTA_HIDE_MS);
  }

  updateDeadVisual();
  attachHoldTap(zoneUp, { onTap: () => applyDelta(1), onHold: () => applyDelta(10) });
  attachHoldTap(zoneDown, { onTap: () => applyDelta(-1), onHold: () => applyDelta(-10) });

  return cellEl;
}

// ── Etapa 4: dano de comandante ──────────────────────────────────────────────

function openCommanderDamage(targetIndex) {
  state.cmdDamageTargetIndex = targetIndex;
  el.cmdDamageTitle.textContent = `Dano de comandante em ${state.cells[targetIndex].player.name}`;
  buildGridInto(el.cmdDamageGrid, (sourceIndex) => makeCommanderDamageCell(sourceIndex, targetIndex));
  pushPage("cmdDamage");
}

// O dano de comandante que "origem" já deu em "alvo" sobe/desce junto com a
// vida de "alvo" — na mesma proporção e na direção oposta (dano some, vida
// aumenta; dano aumenta, vida cai a mesma quantidade). O clamp em 0 do dano
// e o clamp em 0 da vida (dentro de applyLifeDelta) são independentes.
// "slot" é "main" ou "partner": com parceiro, cada comandante tem seu próprio
// contador (dano de comandante é rastreado por carta, não por jogador).
function applyCommanderDamageDelta(sourceIndex, targetIndex, slot, amount, { numberText, deltaEl, cellRef }) {
  const before = state.commanderDamage[targetIndex][sourceIndex][slot];
  const dmg = Math.max(0, before + amount);
  const applied = dmg - before;
  if (applied === 0) return;
  state.commanderDamage[targetIndex][sourceIndex][slot] = dmg;

  numberText.textContent = String(dmg);
  cellRef.deltaAccum = (cellRef.deltaAccum || 0) + applied;
  deltaEl.hidden = false;
  deltaEl.textContent = formatDelta(cellRef.deltaAccum);
  deltaEl.classList.toggle("life-delta-negative", cellRef.deltaAccum < 0);
  clearTimeout(cellRef.hideTimer);
  cellRef.hideTimer = setTimeout(() => {
    deltaEl.hidden = true;
    cellRef.deltaAccum = 0;
  }, DELTA_HIDE_MS);

  state.gameCellRefs[targetIndex]?.applyLifeDelta(-applied);
}

// Cria um contador de dano independente (número + zonas de toque) dentro de
// cellEl. Sem "half", ocupa a célula inteira, como antes; com "half"
// ("left"/"right"), fica restrito àquela metade — usado quando há parceiro,
// já que cada comandante tem seu próprio contador.
function makeDamageCounter(cellEl, sourceIndex, targetIndex, slot, labelName, half) {
  const halfSuffix = half ? ` life-display-half life-display-half-${half}` : "";
  const zoneHalfSuffix = half ? ` life-zone-half life-zone-half-${half}` : "";

  const lifeDisplay = document.createElement("div");
  lifeDisplay.className = `life-display${halfSuffix}`;
  const lifeNumber = document.createElement("span");
  lifeNumber.className = "life-number";
  const numberText = document.createElement("span");
  numberText.className = half ? "life-number-text life-number-text-half" : "life-number-text";
  numberText.textContent = String(state.commanderDamage[targetIndex][sourceIndex][slot]);
  const deltaEl = document.createElement("span");
  deltaEl.className = "life-delta";
  deltaEl.hidden = true;
  lifeNumber.appendChild(numberText);
  lifeNumber.appendChild(deltaEl);
  lifeDisplay.appendChild(lifeNumber);
  cellEl.appendChild(lifeDisplay);

  const zoneUp = document.createElement("button");
  zoneUp.type = "button";
  zoneUp.className = `life-zone life-zone-up${zoneHalfSuffix}`;
  zoneUp.setAttribute("aria-label", `Aumentar dano de ${labelName}`);
  const zoneDown = document.createElement("button");
  zoneDown.type = "button";
  zoneDown.className = `life-zone life-zone-down${zoneHalfSuffix}`;
  zoneDown.setAttribute("aria-label", `Diminuir dano de ${labelName}`);
  cellEl.appendChild(zoneUp);
  cellEl.appendChild(zoneDown);

  const cellRef = { deltaAccum: 0, hideTimer: null };
  const args = { numberText, deltaEl, cellRef };
  attachHoldTap(zoneUp, {
    onTap: () => applyCommanderDamageDelta(sourceIndex, targetIndex, slot, 1, args),
    onHold: () => applyCommanderDamageDelta(sourceIndex, targetIndex, slot, 10, args),
  });
  attachHoldTap(zoneDown, {
    onTap: () => applyCommanderDamageDelta(sourceIndex, targetIndex, slot, -1, args),
    onHold: () => applyCommanderDamageDelta(sourceIndex, targetIndex, slot, -10, args),
  });
}

function makeCommanderDamageCell(sourceIndex, targetIndex) {
  const cell = state.cells[sourceIndex];

  const cellEl = document.createElement("div");
  cellEl.className = "mesa-cell life-cell";

  appendCommanderImages(cellEl, cell);

  const scrim = document.createElement("div");
  scrim.className = "cell-scrim";
  cellEl.appendChild(scrim);

  if (cell.partner) {
    makeDamageCounter(cellEl, sourceIndex, targetIndex, "main", cell.commander.name, "left");
    makeDamageCounter(cellEl, sourceIndex, targetIndex, "partner", cell.partner.name, "right");
  } else {
    makeDamageCounter(cellEl, sourceIndex, targetIndex, "main", cell.player.name, null);
  }

  const caption = document.createElement("div");
  caption.className = "cell-caption life-caption";
  const strong = document.createElement("strong");
  strong.textContent = cell.player.name;
  const span = document.createElement("span");
  span.textContent = commanderDisplayName(cell);
  caption.appendChild(strong);
  caption.appendChild(span);
  cellEl.appendChild(caption);

  return cellEl;
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
  state.commanderPickMode = "main";
  state.activeMainCommander = null;
  el.mainCommanderChosenWrap.hidden = true;
  el.skipPartnerBtn.hidden = true;
  el.commanderSearchLabel.textContent = "Buscar comandante";
  el.commanderPickTitle.textContent = `Escolher comandante de ${player.name}`;
  el.commanderNameInput.value = "";
  el.commanderArtGrid.innerHTML = "";
  el.commanderSuggestions.hidden = true;
  el.commanderSuggestions.innerHTML = "";

  renderCommanderHistory(player);
  el.commanderPickDialog.showModal();
}

// A mesma busca/histórico do diálogo alimenta tanto o comandante principal
// quanto o parceiro — só muda o que acontece ao escolher um card, decidido
// por state.commanderPickMode (ver onCommanderPicked).
function renderCommanderHistory(player) {
  const history = getCommandersForPlayer(player.id).filter((c) => c.scryfallId !== state.activeMainCommander?.scryfallId);
  if (history.length) {
    el.commanderHistoryWrap.hidden = false;
    el.commanderHistory.innerHTML = "";
    for (const commander of history) {
      el.commanderHistory.appendChild(makeCommanderCard(commander, () => onCommanderPicked(commander)));
    }
  } else {
    el.commanderHistoryWrap.hidden = true;
  }
}

function onCommanderPicked(commander) {
  if (state.commanderPickMode === "main") {
    chooseMainCommander(commander);
  } else {
    finalizeCell(state.activePlayer, state.activeMainCommander, commander);
  }
}

// Depois de escolher o principal, o diálogo continua aberto oferecendo um
// parceiro opcional — reaproveita a mesma busca/histórico, agora alimentando
// state.activeMainCommander em vez de fechar a célula direto.
function chooseMainCommander(commander) {
  state.activeMainCommander = commander;
  state.commanderPickMode = "partner";

  el.mainCommanderChosenWrap.hidden = false;
  el.mainCommanderChosenImg.src = commander.imageUrl;
  el.mainCommanderChosenImg.alt = commander.name;
  el.mainCommanderChosenName.textContent = commander.name;
  el.skipPartnerBtn.hidden = false;

  el.commanderPickTitle.textContent = `Escolher parceiro de ${state.activePlayer.name} (opcional)`;
  el.commanderSearchLabel.textContent = "Buscar comandante parceiro";
  el.commanderNameInput.value = "";
  el.commanderArtGrid.innerHTML = "";
  el.commanderSuggestions.hidden = true;
  el.commanderSuggestions.innerHTML = "";

  renderCommanderHistory(state.activePlayer);
}

function onChangeMainCommander() {
  state.commanderPickMode = "main";
  state.activeMainCommander = null;
  el.mainCommanderChosenWrap.hidden = true;
  el.skipPartnerBtn.hidden = true;

  el.commanderPickTitle.textContent = `Escolher comandante de ${state.activePlayer.name}`;
  el.commanderSearchLabel.textContent = "Buscar comandante";
  el.commanderNameInput.value = "";
  el.commanderArtGrid.innerHTML = "";
  el.commanderSuggestions.hidden = true;
  el.commanderSuggestions.innerHTML = "";

  renderCommanderHistory(state.activePlayer);
}

function onSkipPartner() {
  finalizeCell(state.activePlayer, state.activeMainCommander, null);
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
      if (commander.scryfallId === state.activeMainCommander?.scryfallId) continue;
      el.commanderArtGrid.appendChild(makeCommanderCard(commander, () => onCommanderPicked(commander)));
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

function finalizeCell(player, commander, partner) {
  addCommanderForPlayer(player.id, commander);
  if (partner) addCommanderForPlayer(player.id, partner);
  state.cells[state.activeIndex] = { player, commander, partner: partner || null };
  el.commanderPickDialog.close();
  renderMesaGrid();
  updateStartGameButton();
}

// ── Wiring ───────────────────────────────────────────────────────────────

function wireEvents() {
  el.playerCountOkBtn.addEventListener("click", onPlayerCountOk);
  el.startGameBtn.addEventListener("click", onStartGame);
  el.topbarBackBtn.addEventListener("click", onTopbarBack);
  el.leaveGameCancelBtn.addEventListener("click", () => el.leaveGameDialog.close());
  el.leaveGameConfirmBtn.addEventListener("click", onLeaveGameConfirmed);
  el.winnerCancelBtn.addEventListener("click", () => el.selectWinnerDialog.close());
  el.winnerConfirmBtn.addEventListener("click", onWinnerConfirmed);

  el.playerPickCancelBtn.addEventListener("click", () => el.playerPickDialog.close());
  el.addPlayerBtn.addEventListener("click", onAddPlayer);
  el.newPlayerNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onAddPlayer(); }
  });

  el.commanderPickCancelBtn.addEventListener("click", () => el.commanderPickDialog.close());
  el.changeMainCommanderBtn.addEventListener("click", onChangeMainCommander);
  el.skipPartnerBtn.addEventListener("click", onSkipPartner);
  el.commanderSearchBtn.addEventListener("click", onCommanderSearch);
  el.commanderNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onCommanderSearch(); }
  });
  el.commanderNameInput.addEventListener("input", onCommanderNameInput);

  el.printerToggleBtn.addEventListener("click", () => { el.printerOverlay.hidden = false; });
  el.printerCloseBtn.addEventListener("click", () => { el.printerOverlay.hidden = true; });

  el.scoreboardToggleBtn.addEventListener("click", openScoreboard);
  el.scoreboardCloseBtn.addEventListener("click", () => el.scoreboardDialog.close());

  // A mesa é responsiva — refaz o tamanho dos rotores (assentos de lado) se
  // a janela mudar de tamanho/orientação.
  window.addEventListener("resize", () => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => {
      const top = state.pageStack[state.pageStack.length - 1];
      if (top === "mesa") sizeRotatedSideCells(el.mesaGrid);
      else if (top === "game") sizeRotatedSideCells(el.gameGrid);
      else if (top === "cmdDamage") sizeRotatedSideCells(el.cmdDamageGrid);
    }, 150);
  });
}

init();
