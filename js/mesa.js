import { getPlayers, addPlayer, getCommandersForPlayer, addCommanderForPlayer } from "./players-store.js";
import { searchCommanderPrints, autocompleteCardName } from "./scryfall.js";

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
  commanderDamage: [], // commanderDamage[alvo][origem] = dano que o comandante de "origem" já deu em "alvo"
  cmdDamageTargetIndex: null, // célula sendo visualizada na tela de dano de comandante
  clockState: [], // { remainingMs } por célula — só existe/roda no modo "chess"
  clockIntervalId: null,
  clockLastTick: null,
  startingPlayerChoice: "random", // "random" | índice da célula escolhida
  currentTurnIndex: null, // índice da célula com o turno ativo, definido ao começar a partida
  currentPriorityIndex: null, // índice da célula com a prioridade — controla qual relógio corre; só existe/importa no modo "chess"
  startingTurnIndex: null, // célula que começou a partida — fecha uma volta quando o turno volta pra ela
  turnNumber: 1, // nº da volta atual, incrementado sempre que o turno completa o ciclo e volta pro início
  turnOrder: [], // índices de célula na ordem horária da mesa, calculado ao começar a partida
  gameCellRefs: [], // { cellEl, passBtn, priorityBtn, clockEl, applyLifeDelta } por célula da página de jogo, pra atualizar turno/prioridade/vida sem redesenhar tudo
  activeIndex: null,
  activePlayer: null,
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
  mesaBackBtn: $("mesaBackBtn"),
  startingPlayerButtons: $("startingPlayerButtons"),
  startGameBtn: $("startGameBtn"),
  gameSection: $("gameSection"),
  gameGrid: $("gameGrid"),
  turnCounterBadge: $("turnCounterBadge"),
  gameBackBtn: $("gameBackBtn"),

  cmdDamageSection: $("cmdDamageSection"),
  cmdDamageTitle: $("cmdDamageTitle"),
  cmdDamageGrid: $("cmdDamageGrid"),
  cmdDamageBackBtn: $("cmdDamageBackBtn"),

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

// A mesa inteira está girada 90° (sentido anti-horário) em relação ao array
// LAYOUT_OPTIONS: cada entrada dele, que era uma LINHA (empilhada de cima pra
// baixo), agora é uma COLUNA (lado a lado, da esquerda pra direita) — o que
// estava no topo fica na lateral esquerda, o que estava embaixo fica na
// lateral direita. Dentro de cada coluna as cadeiras empilham de cima pra
// baixo.
//
// Cada cadeira gira de acordo só com o tamanho da SUA coluna, não com a
// posição da coluna (exceto pra decidir 90° vs 270° numa coluna de 1):
//   - coluna de 1 cadeira (ponta da mesa): 90° se for a primeira coluna
//     (esquerda), 270° se for a última (direita).
//   - coluna de 2 cadeiras: a de cima sempre 180° ("virada pra cima"), a de
//     baixo sempre 0° ("virada pra baixo") — vale pra qualquer coluna de 2,
//     esteja ela sozinha (1x2), ao lado de outras iguais (2x2, 3x2...) ou
//     entre colunas de 1 (1x2x1 etc.).
function buildGridInto(container, cellRenderer) {
  container.innerHTML = "";
  const cols = state.layoutRows; // cada valor = nº de cadeiras daquela coluna

  let index = 0;
  cols.forEach((seatsInCol, colPos) => {
    const colEl = document.createElement("div");
    colEl.className = "mesa-row"; // uma "coluna" da mesa — ver flex-direction no CSS
    const isFirst = colPos === 0;

    for (let i = 0; i < seatsInCol; i++) {
      const cellEl = cellRenderer(index++);
      const angle = seatsInCol === 1 ? (isFirst ? 90 : 270) : (i === 0 ? 180 : 0);
      applyCellRotation(cellEl, angle);
      colEl.appendChild(cellEl);
    }
    container.appendChild(colEl);
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

function onStartGame() {
  if (state.cells.some((c) => !c)) return;
  state.lifeState = state.cells.map(() => ({ life: state.lifeTotal, deltaAccum: 0, hideTimer: null }));
  state.commanderDamage = state.cells.map(() => state.cells.map(() => 0));
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

  if (cell.commander?.imageUrl) {
    const img = document.createElement("img");
    img.className = "cell-img";
    img.src = cell.commander.imageUrl;
    img.alt = cell.commander.name;
    cellEl.appendChild(img);
  }

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
  span.textContent = cell.commander?.name || "";
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
function applyCommanderDamageDelta(sourceIndex, targetIndex, amount, { numberText, deltaEl, cellRef }) {
  const before = state.commanderDamage[targetIndex][sourceIndex];
  const dmg = Math.max(0, before + amount);
  const applied = dmg - before;
  if (applied === 0) return;
  state.commanderDamage[targetIndex][sourceIndex] = dmg;

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

function makeCommanderDamageCell(sourceIndex, targetIndex) {
  const cell = state.cells[sourceIndex];

  const cellEl = document.createElement("div");
  cellEl.className = "mesa-cell life-cell";

  if (cell.commander?.imageUrl) {
    const img = document.createElement("img");
    img.className = "cell-img";
    img.src = cell.commander.imageUrl;
    img.alt = cell.commander.name;
    cellEl.appendChild(img);
  }

  const scrim = document.createElement("div");
  scrim.className = "cell-scrim";
  cellEl.appendChild(scrim);

  const lifeDisplay = document.createElement("div");
  lifeDisplay.className = "life-display";
  const lifeNumber = document.createElement("span");
  lifeNumber.className = "life-number";
  const numberText = document.createElement("span");
  numberText.className = "life-number-text";
  numberText.textContent = String(state.commanderDamage[targetIndex][sourceIndex]);
  const deltaEl = document.createElement("span");
  deltaEl.className = "life-delta";
  deltaEl.hidden = true;
  lifeNumber.appendChild(numberText);
  lifeNumber.appendChild(deltaEl);
  lifeDisplay.appendChild(lifeNumber);
  cellEl.appendChild(lifeDisplay);

  const caption = document.createElement("div");
  caption.className = "cell-caption life-caption";
  const strong = document.createElement("strong");
  strong.textContent = cell.player.name;
  const span = document.createElement("span");
  span.textContent = cell.commander?.name || "";
  caption.appendChild(strong);
  caption.appendChild(span);
  cellEl.appendChild(caption);

  const cellRef = { deltaAccum: 0, hideTimer: null };
  const zoneUp = document.createElement("button");
  zoneUp.type = "button";
  zoneUp.className = "life-zone life-zone-up";
  zoneUp.setAttribute("aria-label", `Aumentar dano de ${cell.player.name}`);
  const zoneDown = document.createElement("button");
  zoneDown.type = "button";
  zoneDown.className = "life-zone life-zone-down";
  zoneDown.setAttribute("aria-label", `Diminuir dano de ${cell.player.name}`);
  cellEl.appendChild(zoneUp);
  cellEl.appendChild(zoneDown);

  const args = { numberText, deltaEl, cellRef };
  attachHoldTap(zoneUp, {
    onTap: () => applyCommanderDamageDelta(sourceIndex, targetIndex, 1, args),
    onHold: () => applyCommanderDamageDelta(sourceIndex, targetIndex, 10, args),
  });
  attachHoldTap(zoneDown, {
    onTap: () => applyCommanderDamageDelta(sourceIndex, targetIndex, -1, args),
    onHold: () => applyCommanderDamageDelta(sourceIndex, targetIndex, -10, args),
  });

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
  renderMesaGrid();
  updateStartGameButton();
}

// ── Wiring ───────────────────────────────────────────────────────────────

function wireEvents() {
  el.playerCountOkBtn.addEventListener("click", onPlayerCountOk);
  el.startGameBtn.addEventListener("click", onStartGame);
  el.mesaBackBtn.addEventListener("click", popPage);
  el.gameBackBtn.addEventListener("click", onGameBack);
  el.cmdDamageBackBtn.addEventListener("click", popPage);

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
