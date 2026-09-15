import { parseVoiceToQuery } from "./voice-query.js";
import { fetchCreatureTypeCatalog, searchCardsWithFallback } from "./scryfall.js";
import { fetchImageBitmap, drawCover } from "./image-compose.js";
import { applyDitherToCanvas } from "./dither.js";

const SETTINGS_KEY = "tokenprinter:settings";
const DEFAULT_SETTINGS = { modelKey: "b1pro", sizeKey: "T50x30", density: 3, lang: "en-US", dither: "floyd" };

// Mapeia cada modelo de impressora aos tamanhos de etiqueta compatíveis com ELE
// (não só com o dpi — ver README do niimbot-web-bluetooth: dpi sozinho é ambíguo,
// há três etiquetas de 50×30mm a 300dpi diferentes para b1pro/b2pro/m2h).
const MODEL_SIZES = {
  b1pro: ["T50x30", "T25x38", "T30x45", "T40x60", "T50x80"],
  b2pro: ["T50x30_b2pro", "T50x80_b2pro"],
  b1: ["T50x30_b1", "T30x45_b1", "T25x38_b1", "T50x80_b1"],
  d11h: ["T15x30", "T12x22"],
  m2h: ["T50x30_m2h", "T50x80_m2h"],
  d110: ["T15x50"],
  n1: ["T14x50"],
};

const state = {
  registry: null,
  creatureTypes: [],
  settings: loadSettings(),
  recognition: null,
  listening: false,
  parsedQuery: null,
  results: [],
  selectedCard: null,
  printerConnected: false,
  printing: false,
};

const $ = (id) => document.getElementById(id);
const el = {
  compatWarning: $("compatWarning"),
  micBtn: $("micBtn"),
  micStatus: $("micStatus"),
  manualInput: $("manualInput"),
  manualSearchBtn: $("manualSearchBtn"),
  listenSection: $("listenSection"),
  queryReview: $("queryReview"),
  transcriptInput: $("transcriptInput"),
  queryPreview: $("queryPreview"),
  editQueryBtn: $("editQueryBtn"),
  confirmSearchBtn: $("confirmSearchBtn"),
  restartBtn: $("restartBtn"),
  rawQueryInput: $("rawQueryInput"),
  resultsSection: $("resultsSection"),
  resultsTitle: $("resultsTitle"),
  resultsGrid: $("resultsGrid"),
  backToSearchBtn: $("backToSearchBtn"),
  printSection: $("printSection"),
  previewCanvas: $("previewCanvas"),
  ditherSelect: $("ditherSelect"),
  selectedCardName: $("selectedCardName"),
  selectedCardMeta: $("selectedCardMeta"),
  printerStatusDot: $("printerStatusDot"),
  printerStatusText: $("printerStatusText"),
  connectPrinterBtn: $("connectPrinterBtn"),
  copiesInput: $("copiesInput"),
  printBtn: $("printBtn"),
  printStatus: $("printStatus"),
  printProgressWrap: $("printProgressWrap"),
  printProgressBar: $("printProgressBar"),
  printAnotherBtn: $("printAnotherBtn"),
  settingsBtn: $("settingsBtn"),
  settingsDialog: $("settingsDialog"),
  modelSelect: $("modelSelect"),
  sizeSelect: $("sizeSelect"),
  densityRange: $("densityRange"),
  densityValue: $("densityValue"),
  langSelect: $("langSelect"),
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* ignore */ }
}

// ── Inicialização ──────────────────────────────────────────────────────────

async function init() {
  checkCompat();
  await loadRegistry();
  populateSettingsUI();
  wireEvents();
  fetchCreatureTypeCatalog().then((list) => { state.creatureTypes = list; });
}

function checkCompat() {
  const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasBluetooth = typeof Niimbot !== "undefined" && Niimbot.isSupported();
  const msgs = [];
  if (!hasSpeech) msgs.push("Reconhecimento de voz não é suportado neste navegador — use o campo de texto manual, ou abra no Chrome (Android/Windows).");
  if (!hasBluetooth) msgs.push("Web Bluetooth não é suportado neste navegador — a impressão não vai funcionar. Use Chrome/Edge no Android ou Windows.");
  if (msgs.length) {
    el.compatWarning.hidden = false;
    el.compatWarning.textContent = msgs.join(" ");
  }
  if (!hasSpeech) el.micBtn.disabled = true;
}

async function loadRegistry() {
  const res = await fetch("vendor/niimbot-registry.json");
  state.registry = await res.json();
}

function populateSettingsUI() {
  const { models } = state.registry;
  el.modelSelect.innerHTML = "";
  for (const [key, m] of Object.entries(models)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = m.label;
    el.modelSelect.appendChild(opt);
  }
  el.modelSelect.value = state.settings.modelKey;
  populateSizeSelect();
  el.densityRange.value = state.settings.density;
  el.densityValue.textContent = state.settings.density;
  el.langSelect.value = state.settings.lang;
}

function populateSizeSelect() {
  const modelKey = el.modelSelect.value;
  const sizeKeys = MODEL_SIZES[modelKey] || [];
  el.sizeSelect.innerHTML = "";
  for (const key of sizeKeys) {
    const s = state.registry.sizes[key];
    if (!s) continue;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${s.label} (${s.w_px}×${s.h_px}px)`;
    el.sizeSelect.appendChild(opt);
  }
  if (sizeKeys.includes(state.settings.sizeKey)) {
    el.sizeSelect.value = state.settings.sizeKey;
  } else if (sizeKeys.length) {
    el.sizeSelect.value = sizeKeys[0];
    state.settings.sizeKey = sizeKeys[0];
  }
}

// ── Eventos ─────────────────────────────────────────────────────────────────

function wireEvents() {
  el.micBtn.addEventListener("click", onMicClick);
  el.manualSearchBtn.addEventListener("click", () => {
    const text = el.manualInput.value.trim();
    if (text) startQueryReview(text);
  });
  el.manualInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.manualSearchBtn.click();
  });

  el.transcriptInput.addEventListener("input", () => {
    updateQueryPreviewFromTranscript();
  });
  el.editQueryBtn.addEventListener("click", () => {
    el.rawQueryInput.hidden = !el.rawQueryInput.hidden;
    if (!el.rawQueryInput.hidden) el.rawQueryInput.value = el.queryPreview.textContent;
  });
  el.confirmSearchBtn.addEventListener("click", runSearch);
  el.restartBtn.addEventListener("click", resetToListen);
  el.backToSearchBtn.addEventListener("click", () => showSection("queryReview"));

  el.settingsBtn.addEventListener("click", () => el.settingsDialog.showModal());
  el.modelSelect.addEventListener("change", () => {
    state.settings.modelKey = el.modelSelect.value;
    populateSizeSelect();
    saveSettings();
  });
  el.sizeSelect.addEventListener("change", () => {
    state.settings.sizeKey = el.sizeSelect.value;
    saveSettings();
    if (state.selectedCard) renderPreview();
  });
  el.densityRange.addEventListener("input", () => {
    el.densityValue.textContent = el.densityRange.value;
    state.settings.density = parseInt(el.densityRange.value, 10);
    saveSettings();
  });
  el.langSelect.addEventListener("change", () => {
    state.settings.lang = el.langSelect.value;
    saveSettings();
  });

  el.connectPrinterBtn.addEventListener("click", onConnectPrinter);
  el.printBtn.addEventListener("click", onPrint);
  el.printAnotherBtn.addEventListener("click", resetToListen);

  document.querySelectorAll('input[name="artMode"]').forEach((r) =>
    r.addEventListener("change", renderPreview)
  );
  el.ditherSelect.value = state.settings.dither;
  el.ditherSelect.addEventListener("change", () => {
    state.settings.dither = el.ditherSelect.value;
    saveSettings();
    renderPreview();
  });
}

// ── Voz ─────────────────────────────────────────────────────────────────────

function onMicClick() {
  if (state.listening) {
    state.recognition?.stop();
    return;
  }
  startListening();
}

function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const recognition = new SR();
  recognition.lang = state.settings.lang;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    state.listening = true;
    el.micBtn.classList.add("listening");
    el.micStatus.textContent = "Ouvindo...";
  };
  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    el.micStatus.textContent = transcript;
    const isFinal = event.results[event.results.length - 1].isFinal;
    if (isFinal) startQueryReview(transcript.trim());
  };
  recognition.onerror = (event) => {
    el.micStatus.textContent = `Erro no reconhecimento de voz: ${event.error}. Tente novamente ou digite manualmente.`;
  };
  recognition.onend = () => {
    state.listening = false;
    el.micBtn.classList.remove("listening");
    if (el.micStatus.textContent === "Ouvindo...") {
      el.micStatus.textContent = "Não entendi. Toque para tentar de novo.";
    }
  };

  state.recognition = recognition;
  recognition.start();
}

// ── Revisão da query ─────────────────────────────────────────────────────────

function startQueryReview(transcript) {
  el.transcriptInput.value = transcript;
  el.rawQueryInput.hidden = true;
  updateQueryPreviewFromTranscript();
  showSection("queryReview");
}

function updateQueryPreviewFromTranscript() {
  const transcript = el.transcriptInput.value;
  state.parsedQuery = parseVoiceToQuery(transcript, state.creatureTypes);
  el.queryPreview.textContent = state.parsedQuery.query;
}

async function runSearch() {
  const useRaw = !el.rawQueryInput.hidden && el.rawQueryInput.value.trim();
  const parts = useRaw ? [el.rawQueryInput.value.trim()] : state.parsedQuery.parts;

  el.confirmSearchBtn.disabled = true;
  el.confirmSearchBtn.textContent = "Buscando...";
  try {
    const result = await searchCardsWithFallback(parts);
    state.results = result.cards;
    renderResults(result);
    showSection("resultsSection");
  } catch (err) {
    el.queryPreview.textContent = `${state.parsedQuery.query} — erro: ${err.message}`;
  } finally {
    el.confirmSearchBtn.disabled = false;
    el.confirmSearchBtn.textContent = "Buscar carta";
  }
}

// ── Resultados ────────────────────────────────────────────────────────────

function cardImageUris(card) {
  return card.image_uris || card.card_faces?.[0]?.image_uris || null;
}

function renderResults(result) {
  el.resultsTitle.textContent = result.approximate
    ? `Resultados aproximados (${result.cards.length})`
    : `Resultados (${result.cards.length})`;
  el.resultsGrid.innerHTML = "";

  if (!result.cards.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nenhum token encontrado. Volte e ajuste a busca.";
    el.resultsGrid.appendChild(p);
    return;
  }

  for (const card of result.cards) {
    const uris = cardImageUris(card);
    const btn = document.createElement("button");
    btn.className = "result-card";
    btn.type = "button";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = uris?.small || uris?.normal || "";
    img.alt = card.name;
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = `${card.name} · ${card.set_name}`;
    btn.appendChild(img);
    btn.appendChild(meta);
    btn.addEventListener("click", () => selectCard(card));
    el.resultsGrid.appendChild(btn);
  }
}

// ── Seleção + preview de impressão ─────────────────────────────────────────

async function selectCard(card) {
  state.selectedCard = card;
  el.selectedCardName.textContent = card.name;
  el.selectedCardMeta.textContent = `${card.set_name} · ${card.type_line || ""}`;
  showSection("printSection");
  updatePrintReadiness();
  await renderPreview();
}

async function renderPreview() {
  const card = state.selectedCard;
  if (!card) return;
  const uris = cardImageUris(card);
  const artMode = document.querySelector('input[name="artMode"]:checked').value;
  const url = artMode === "art" ? (uris?.art_crop || uris?.normal) : (uris?.png || uris?.normal || uris?.large);
  if (!url) return;

  const size = currentSize();
  const canvas = el.previewCanvas;
  canvas.width = size.w_px;
  canvas.height = size.h_px;
  const ctx = canvas.getContext("2d");

  try {
    const bitmap = await fetchImageBitmap(url);
    drawCover(ctx, bitmap, canvas.width, canvas.height);
    applyDitherToCanvas(canvas, state.settings.dither);
  } catch (err) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#c00";
    ctx.font = "14px sans-serif";
    ctx.fillText("Erro ao carregar imagem", 8, 20);
    console.error(err);
  }
}

function currentModel() {
  return state.registry.models[el.modelSelect.value];
}
function currentSize() {
  return state.registry.sizes[el.sizeSelect.value];
}

// ── Impressora ────────────────────────────────────────────────────────────

async function onConnectPrinter() {
  if (typeof Niimbot === "undefined" || !Niimbot.isSupported()) {
    setPrinterStatus(false, "Web Bluetooth não suportado neste navegador.");
    return;
  }
  el.connectPrinterBtn.disabled = true;
  el.connectPrinterBtn.textContent = "Conectando...";
  try {
    const model = currentModel();
    const info = await Niimbot.identify(model);
    state.printerConnected = true;

    // Se o modelo detectado for diferente do selecionado, ajusta automaticamente.
    const detectedKey = Object.entries(state.registry.models)
      .find(([, m]) => m.id === info.modelId)?.[0];
    if (detectedKey && detectedKey !== el.modelSelect.value) {
      el.modelSelect.value = detectedKey;
      state.settings.modelKey = detectedKey;
      populateSizeSelect();
      saveSettings();
    }

    setPrinterStatus(true, `Conectado: ${info.label || "impressora Niimbot"}`);
  } catch (err) {
    state.printerConnected = false;
    setPrinterStatus(false, `Falha ao conectar: ${err.message}`);
  } finally {
    el.connectPrinterBtn.disabled = false;
    el.connectPrinterBtn.textContent = "🔗 Conectar impressora";
    updatePrintReadiness();
  }
}

function setPrinterStatus(ok, text) {
  el.printerStatusDot.className = `status-dot ${ok ? "status-dot-ok" : "status-dot-err"}`;
  el.printerStatusText.textContent = text;
}

function updatePrintReadiness() {
  el.printBtn.disabled = !state.selectedCard || state.printing;
}

async function onPrint() {
  const card = state.selectedCard;
  if (!card) return;

  state.printing = true;
  el.printBtn.disabled = true;
  el.printStatus.textContent = "Preparando imagem...";
  el.printProgressWrap.hidden = false;
  el.printProgressBar.style.width = "0%";

  try {
    const model = currentModel();
    const size = currentSize();
    const copies = Math.max(1, Math.min(20, parseInt(el.copiesInput.value, 10) || 1));
    const density = state.settings.density;

    // O preview já está desenhado exatamente no tamanho w_px×h_px da etiqueta.
    const dataUrl = el.previewCanvas.toDataURL("image/png");

    el.printStatus.textContent = "Imprimindo...";
    await Niimbot.printImage(dataUrl, {
      model,
      size,
      copies,
      density,
      onProgress: (s) => {
        el.printStatus.textContent = s;
        const pctMatch = /(\d+)%/.exec(s);
        if (pctMatch) el.printProgressBar.style.width = `${pctMatch[1]}%`;
      },
    });

    state.printerConnected = true;
    setPrinterStatus(true, "Conectado");
    el.printProgressBar.style.width = "100%";
    el.printStatus.textContent = "✅ Impresso!";
    el.printAnotherBtn.hidden = false;
  } catch (err) {
    el.printStatus.textContent = `❌ Erro ao imprimir: ${err.message}`;
    console.error(err);
  } finally {
    state.printing = false;
    updatePrintReadiness();
  }
}

// ── Navegação entre seções ──────────────────────────────────────────────────

function showSection(id) {
  for (const s of [el.queryReview, el.resultsSection, el.printSection]) {
    s.hidden = s.id !== id;
  }
}

function resetToListen() {
  state.selectedCard = null;
  state.parsedQuery = null;
  el.manualInput.value = "";
  el.micStatus.textContent = "Toque para descrever o token em voz alta";
  el.printAnotherBtn.hidden = true;
  el.printStatus.textContent = "";
  el.printProgressWrap.hidden = true;
  for (const s of [el.queryReview, el.resultsSection, el.printSection]) s.hidden = true;
}

init();
