// =============================================================
// Este archivo se encarga de: cargar las preguntas desde el JSON,
// estado de la aplicación, interfaz, localStorage, respuestas,
// estadísticas, historial y reportes.
// El ALGORITMO de selección de preguntas vive aparte, en
// selection-engine.js (función selectSessionQuestions).
// =============================================================
// -------------------------------------------------------------
// Mezcla las opciones de una pregunta y recalcula el índice
// correcto. NO modifica el objeto original del banco.
// -------------------------------------------------------------
function shuffleQuestionOptions(question) {
  const indices = question.options.map((_, i) => i);

  // Fisher-Yates
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const newOptions = indices.map((i) => question.options[i]);
  const newCorrectIndex = indices.indexOf(question.correctIndex);

  return {
    ...question,
    options: newOptions,
    correctIndex: newCorrectIndex
  };
}
// =============================================================
// 1. Constantes y configuración
// =============================================================

// Ruta al archivo JSON con las preguntas.
const QUESTIONS_URL = "data/questions.json";

// Clave de localStorage
const STORAGE_KEY = "quizProgressV1";

// Etiquetas legibles para cada modo de estudio (historial)
const MODE_LABELS = {
  smart: "Estudio inteligente",
  all: "Todas las preguntas",
  errors: "Solo errores"
};

// Etiquetas para el filtro de nivel (para el historial)
const LEVEL_FILTER_LABELS = {
  "all": "Todas",
  "new": "Solo nuevas",
  "reinforce": "Refuerzo",
  "not-mastered": "No dominadas",
  "mastered": "Solo dominadas"
};


// Configuración de los presets de simulacro
const SIMULACRO_PRESETS = {
  rapida:  { name: "Rápida",   questions: 5,  durationMs: 2.5 * 60 * 1000 },
  media:   { name: "Media",    questions: 10, durationMs: 5   * 60 * 1000 },
  examen:  { name: "Examen",   questions: 20, durationMs: 15  * 60 * 1000 },
  extensa: { name: "Extensa",  questions: 30, durationMs: 25  * 60 * 1000 }
};

// Etiquetas para los tipos de reporte
const REPORT_TYPE_LABELS = {
  "respuesta-incorrecta": "Respuesta incorrecta",
  "pregunta-confusa": "Pregunta mal formulada",
  "explicacion-incorrecta": "Explicación incorrecta",
  "ortografia": "Ortografía / redacción",
  "otro": "Otro"
};

// Nombres de cada nivel de dominio
const LEVEL_NAMES = [
  "Nueva",
  "Necesita refuerzo",
  "En aprendizaje",
  "Conocida",
  "Dominada",
  "Dominio sólido"
];
const MAX_LEVEL = LEVEL_NAMES.length - 1;
const MIN_LEVEL = 0;

// =============================================================
// 2. Variables de estado (en memoria, no persistente)
// =============================================================
let QUESTIONS = [];
let progress = null;
let quizState = "setup";
let isLoading = true;

let selectedMode = "smart";
let selectedAmount = 20;
let selectedSource = "all";
let selectedLevelFilter = "all";
let selectedSimulacroType = "rapida";  // "rapida" | "media" | "examen" | "extensa"

let sessionQuestions = [];
let sessionMode = null;
let sessionSource = null;
let sessionLevelFilter = null;
let lastSessionQuestionIds = null;  // Para "Repetir última sesión"

// Estado del simulacro (en memoria, no persistente)
let simulacro = {
  active: false,
  type: "rapida",
  questions: [],
  answers: [],
  flags: [],
  visited: [],
  currentIndex: 0,
  startTime: null,
  durationMs: 0,
  remainingMs: 0,
  timerInterval: null,
  paused: false
};


let currentIndex = 0;
let score = 0;
let selectedOption = null;
let answered = false;

// =============================================================
// 3. Almacenamiento en localStorage
// =============================================================
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { questionStats: {}, sessionHistory: [], questionReports: [] };
    const parsed = JSON.parse(raw);
    return {
      questionStats: parsed.questionStats || {},
      sessionHistory: parsed.sessionHistory || [],
      questionReports: parsed.questionReports || []
    };
  } catch (error) {
    console.warn("No se pudo leer el progreso guardado:", error);
    return { questionStats: {}, sessionHistory: [], questionReports: [] };
  }
}

function saveProgress(p) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch (error) {
    console.warn("No se pudo guardar el progreso:", error);
  }
}

function migrateProgress(rawProgress) {
  let didMigrate = false;
  Object.values(rawProgress.questionStats).forEach((stats) => {
    if (stats.streakCorrect === undefined) { stats.streakCorrect = 0; didMigrate = true; }
    if (stats.streakIncorrect === undefined) { stats.streakIncorrect = 0; didMigrate = true; }
    if (stats.lastCorrectDate === undefined) { stats.lastCorrectDate = null; didMigrate = true; }
  });
  return didMigrate;
}

function getStatsFor(questionId) {
  if (!progress.questionStats[questionId]) {
    progress.questionStats[questionId] = {
      attempts: 0,
      correct: 0,
      incorrect: 0,
      streakCorrect: 0,
      streakIncorrect: 0,
      lastAnswer: null,
      lastAttemptDate: null,
      lastCorrectDate: null,
      level: 0
    };
  }
  return progress.questionStats[questionId];
}



function registerAnswer(questionId, isCorrect, answerText) {
  const stats = getStatsFor(questionId);
  const now = new Date().toISOString();

  stats.attempts += 1;
  stats.lastAnswer = answerText;
  stats.lastAttemptDate = now;

  if (isCorrect) {
    stats.correct += 1;
    stats.streakCorrect += 1;
    stats.streakIncorrect = 0;
    stats.lastCorrectDate = now;
    stats.level = Math.min(MAX_LEVEL, stats.level + 1);
  } else {
    stats.incorrect += 1;
    stats.streakIncorrect += 1;
    stats.streakCorrect = 0;
    stats.level = Math.max(MIN_LEVEL, stats.level - 1);
  }

  saveProgress(progress);
  return stats;
}

function registerSession(total, correct, incorrect, mode, source, levelFilter) {
  const percentage = Math.round((correct / total) * 100);
  progress.sessionHistory.push({
    date: new Date().toISOString(),
    total,
    correct,
    incorrect,
    answered: total,
    unanswered: 0,
    percentage,
    mode,
    source,
    levelFilter,
    status: "completed"
  });
  saveProgress(progress);
}

function registerIncompleteSession(total, answeredCount, correct, incorrect, mode, source, levelFilter) {
  const unanswered = total - answeredCount;
  const percentage = answeredCount > 0
    ? Math.round((correct / answeredCount) * 100)
    : 0;

  progress.sessionHistory.push({
    date: new Date().toISOString(),
    total,
    correct,
    incorrect,
    answered: answeredCount,
    unanswered,
    percentage,
    mode,
    source,
    levelFilter,
    status: "incomplete"
  });
  saveProgress(progress);
}

function resetProgress() {
  progress = { questionStats: {}, sessionHistory: [], questionReports: [] };
  saveProgress(progress);
}

// Reportes
function saveQuestionReport(questionId, type, comment) {
  const q = QUESTIONS.find((item) => item.id === questionId);
  const questionText = q ? q.question : "(pregunta no encontrada)";

  progress.questionReports.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    questionId,
    questionText,
    type,
    comment: (comment || "").trim(),
    date: new Date().toISOString()
  });
  saveProgress(progress);
}

function clearAllReports() {
  progress.questionReports = [];
  saveProgress(progress);
}

// =============================================================
// 4. Referencias al DOM
// =============================================================
const counterEl = document.getElementById("counter");
const scoreEl = document.getElementById("score");
const progressFillEl = document.getElementById("progressFill");
const boardTitles = document.getElementById("boardTitles");
const boardStats = document.getElementById("boardStats");

const loadingScreen = document.getElementById("loadingScreen");
const errorScreen = document.getElementById("errorScreen");
const errorText = document.getElementById("errorText");

const setupScreen = document.getElementById("setupScreen");
const modeGrid = document.getElementById("modeGrid");
const levelFilterBlock = document.getElementById("levelFilterBlock");
const levelFilterGrid = document.getElementById("levelFilterGrid");

const simulacroTypeBlock = document.getElementById("simulacroTypeBlock");
const simulacroGrid = document.getElementById("simulacroGrid");
const amountBlock = document.getElementById("amountBlock");

const setupWarning = document.getElementById("setupWarning");
const startSessionBtn = document.getElementById("startSessionBtn");
const sourceCount = document.getElementById("sourceCount");
const amountGrid = document.getElementById("amountGrid");

// Selector de bibliografía (dropdown custom)
const sourceSelector = document.getElementById("sourceSelector");
const sourceTrigger = document.getElementById("sourceTrigger");
const sourceTriggerName = document.getElementById("sourceTriggerName");
const sourceTriggerCount = document.getElementById("sourceTriggerCount");
const sourceDropdown = document.getElementById("sourceDropdown");

// Quiz
const levelBadgeEl = document.getElementById("levelBadge");
const questionTextEl = document.getElementById("questionText");
const optionsListEl = document.getElementById("optionsList");
const feedbackEl = document.getElementById("feedback");
const feedbackVerdictEl = document.getElementById("feedbackVerdict");
const feedbackExplanationEl = document.getElementById("feedbackExplanation");
const answerBtn = document.getElementById("answerBtn");
const nextBtn = document.getElementById("nextBtn");
const finishSessionBtn = document.getElementById("finishSessionBtn");

const quizScreen = document.getElementById("quizScreen");
const resultScreen = document.getElementById("resultScreen");
const finalScoreEl = document.getElementById("finalScore");
const resultMessageEl = document.getElementById("resultMessage");
const restartBtn = document.getElementById("restartBtn");
const repeatSessionBtn = document.getElementById("repeatSessionBtn");

// Stats / history / reports
const statsScreen = document.getElementById("statsScreen");
const statsSummaryGrid = document.getElementById("statsSummaryGrid");
const statsLevelGrid = document.getElementById("statsLevelGrid");
const resetBtn = document.getElementById("resetBtn");

const historyScreen = document.getElementById("historyScreen");
const historyList = document.getElementById("historyList");

const reportsScreen = document.getElementById("reportsScreen");
const reportsList = document.getElementById("reportsList");
const reportsBadge = document.getElementById("reportsBadge");
const copyReportsBtn = document.getElementById("copyReportsBtn");
const clearReportsBtn = document.getElementById("clearReportsBtn");

// Modal reportes
const reportQuestionBtn = document.getElementById("reportQuestionBtn");
const reportModal = document.getElementById("reportModal");
const reportQuestionPreview = document.getElementById("reportQuestionPreview");
const reportTypeSelect = document.getElementById("reportType");
const reportCommentInput = document.getElementById("reportComment");
const cancelReportBtn = document.getElementById("cancelReportBtn");
const submitReportBtn = document.getElementById("submitReportBtn");

const navButtons = document.querySelectorAll(".nav__btn");
const LETTERS = ["A", "B", "C", "D", "E", "F"];


// Simulacro
const simulacroScreen = document.getElementById("simulacroScreen");
const simulacroTimer = document.getElementById("simulacroTimer");
const simulacroTimerValue = document.getElementById("simulacroTimerValue");
const simulacroTypeLabel = document.getElementById("simulacroTypeLabel");
const simulacroCounter = document.getElementById("simulacroCounter");
const simulacroProgressFill = document.getElementById("simulacroProgressFill");
const simulacroLevelBadge = document.getElementById("simulacroLevelBadge");
const simulacroReportBtn = document.getElementById("simulacroReportBtn");
const simulacroQuestionText = document.getElementById("simulacroQuestionText");
const simulacroOptionsList = document.getElementById("simulacroOptionsList");
const simulacroFlagBtn = document.getElementById("simulacroFlagBtn");
const simulacroFlagText = document.getElementById("simulacroFlagText");
const simulacroNavigatorGrid = document.getElementById("simulacroNavigatorGrid");
const simulacroPauseBtn = document.getElementById("simulacroPauseBtn");
const simulacroFinishBtn = document.getElementById("simulacroFinishBtn");
const simulacroPrevBtn = document.getElementById("simulacroPrevBtn");
const simulacroNextBtn = document.getElementById("simulacroNextBtn");
const simulacroPauseOverlay = document.getElementById("simulacroPauseOverlay");
const simulacroResumeBtn = document.getElementById("simulacroResumeBtn");
const simulacroFinishModal = document.getElementById("simulacroFinishModal");
const simulacroFinishSummary = document.getElementById("simulacroFinishSummary");
const simulacroCancelFinishBtn = document.getElementById("simulacroCancelFinishBtn");
const simulacroConfirmFinishBtn = document.getElementById("simulacroConfirmFinishBtn");
// Pantalla de resultados del simulacro
const simulacroResultScreen = document.getElementById("simulacroResultScreen");
const simulacroResultScore = document.getElementById("simulacroResultScore");
const simulacroResultCorrect = document.getElementById("simulacroResultCorrect");
const simulacroResultIncorrect = document.getElementById("simulacroResultIncorrect");
const simulacroResultUnanswered = document.getElementById("simulacroResultUnanswered");
const simulacroResultTime = document.getElementById("simulacroResultTime");
const simulacroResultMessage = document.getElementById("simulacroResultMessage");
const simulacroRepeatBtn = document.getElementById("simulacroRepeatBtn");
const simulacroNewBtn = document.getElementById("simulacroNewBtn");

// =============================================================
// 5. Carga inicial del JSON
// =============================================================
async function loadQuestionsFromJSON() {
  try {
    const response = await fetch(QUESTIONS_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - No se encontró ${QUESTIONS_URL}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("El JSON no es un arreglo de preguntas.");
    }
    QUESTIONS = data;
    return true;
  } catch (error) {
    console.error("Error al cargar questions.json:", error);
    errorText.textContent =
      "No se pudieron cargar las preguntas. Detalles: " + error.message +
      " — Si abriste el archivo directamente (file://), usa Live Server.";
    return false;
  }
}

// =============================================================
// 6. Constructor del selector de bibliografía
// =============================================================

// Devuelve un mapa { sourceId: { name, count } } a partir del banco.
function buildSourceMap() {
  const map = new Map();

  // "all" siempre existe
  map.set("all", { name: "Todas las bibliografías", count: QUESTIONS.length });

  QUESTIONS.forEach((q) => {
    const src = q.source || "sin-fuente";
    const srcName = q.sourceName || src;

    if (!map.has(src)) {
      map.set(src, { name: srcName, count: 0 });
    }
    map.get(src).count += 1;
  });

  return map;
}

// Orden: "all" primero, luego por nombre alfabético
function getSortedSourceEntries(sourceMap) {
  const entries = [...sourceMap.entries()];
  const allEntry = entries.find(([id]) => id === "all");
  const rest = entries
    .filter(([id]) => id !== "all")
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "es"));

  return allEntry ? [allEntry, ...rest] : rest;
}

function renderSourceDropdown() {
  const sourceMap = buildSourceMap();
  const entries = getSortedSourceEntries(sourceMap);

  sourceDropdown.innerHTML = entries
    .map(([id, { name, count }]) => {
      const isSelected = id === selectedSource;
      const countLabel = count === 1 ? "1 pregunta" : `${count} preguntas`;
      return `
        <button class="source-option ${isSelected ? "is-selected" : ""}"
                type="button"
                data-source="${id}"
                role="option"
                aria-selected="${isSelected}">
          <span class="source-option__body">
            <span class="source-option__name">${escapeHtml(name)}</span>
            <span class="source-option__count">${countLabel}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function updateSourceTrigger() {
  const sourceMap = buildSourceMap();
  const entry = sourceMap.get(selectedSource) || sourceMap.get("all");

  sourceTriggerName.textContent = entry.name;
  sourceTriggerCount.textContent = entry.count === 1
    ? "1 pregunta"
    : `${entry.count} preguntas`;
}

function toggleSourceDropdown(forceState) {
  const willOpen = forceState !== undefined ? forceState : sourceDropdown.hidden;

  sourceDropdown.hidden = !willOpen;
  sourceSelector.classList.toggle("is-open", willOpen);
  sourceTrigger.setAttribute("aria-expanded", String(willOpen));
}

sourceTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleSourceDropdown();
});

sourceDropdown.addEventListener("click", (e) => {
  const btn = e.target.closest(".source-option");
  if (!btn) return;
  selectedSource = btn.dataset.source;
  updateSourceTrigger();
  renderSourceDropdown();
  toggleSourceDropdown(false);

  // Resetear la cantidad al cambiar de bibliografía
  selectedAmount = null;

  pulseAmountCard();
  rebuildAmountButtons();
  updateSetupPreview();
});

// Cerrar al hacer clic fuera
document.addEventListener("click", (e) => {
  if (!sourceSelector.contains(e.target)) {
    toggleSourceDropdown(false);
  }
});

// =============================================================
// 7. Presets dinámicos de cantidad
// =============================================================
function getAmountPresets(total) {
  if (total <= 0) return [];

  let presets;
  if (total <= 5) presets = [total];
  else if (total <= 15) presets = [5, 10, total];
  else if (total <= 30) presets = [5, 10, 20, total];
  else if (total <= 60) presets = [10, 25, 50, total];
  else if (total <= 120) presets = [15, 30, 60, total];
  else if (total <= 300) presets = [25, 50, 100, total];
  else presets = [50, 100, 200, total];

  // Eliminar duplicados Y los que exceden el total
  const filtered = [...new Set(presets)].filter((n) => n <= total).sort((a, b) => a - b);

  // Asegurar que el total siempre esté como último preset
  if (!filtered.includes(total)) {
    filtered.push(total);
  }

  return filtered;
}

function rebuildAmountButtons() {
  const available = countAvailableForCurrentSelection();

  // Sin preguntas disponibles: mensaje y salir
  if (available === 0) {
    amountGrid.innerHTML = `<p class="empty-state">No hay preguntas disponibles para esta combinación.</p>`;
    startSessionBtn.disabled = true;
    return;
  }

  // Calcular presets según el total disponible
  const presets = [...new Set(getAmountPresets(available))].sort((a, b) => a - b);
  const totalAvailable = presets[presets.length - 1]; // el mayor = "Todas"

  // Normalizar selectedAmount:
  // - Si es "all", siempre OK
  // - Si es un número válido y está entre los presets, OK
  // - Si no, elegir un valor por defecto razonable
  let isAll = selectedAmount === "all";
  let numericAmount = isAll ? null : Number(selectedAmount);

  // Si el usuario tenía "all" pero el total cambió, sigue siendo "all"
  // Si tenía un número, verificar que siga siendo válido
  if (!isAll) {
    if (typeof numericAmount !== "number" || isNaN(numericAmount)) {
      // Valor corrupto: resetear a un default
      selectedAmount = defaultAmountFor(totalAvailable);
    } else if (numericAmount > available) {
      // Excede el total disponible: usar "Todas"
      selectedAmount = "all";
    }
    // Si está entre los presets, se mantiene
  }

  // Si el usuario aún no eligió nada, aplicar default
  if (selectedAmount === null || selectedAmount === undefined) {
    selectedAmount = defaultAmountFor(totalAvailable);
  }

  // Construir los botones
  amountGrid.innerHTML = presets
    .map((n) => {
      const isLast = n === totalAvailable;
      const label = isLast ? `${n} (Todas)` : String(n);
      const value = isLast ? "all" : String(n);

      // ¿Este botón debe estar activo?
      let isActive = false;
      if (isLast) {
        isActive = selectedAmount === "all" ||
                   Number(selectedAmount) === n;
      } else {
        isActive = Number(selectedAmount) === n;
      }

      return `<button class="amount-btn ${isActive ? "is-active" : ""}"
                      data-amount="${value}"
                      type="button">${label}</button>`;
    })
    .join("");

  // Animación
  animateNewAmountButtons();
}

// Devuelve un default razonable según el total disponible
function defaultAmountFor(total) {
  if (total <= 5) return total;
  if (total <= 10) return 5;
  if (total <= 20) return 10;
  if (total <= 50) return 20;
  if (total <= 100) return 25;
  return 50;
}

amountGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".amount-btn");
  if (!btn) return;

  const raw = btn.dataset.amount;
  selectedAmount = raw === "all" ? "all" : Number(raw);

  amountGrid.querySelectorAll(".amount-btn").forEach((b) => {
    b.classList.toggle("is-active", b === btn);
  });

  updateSetupPreview();
});

// =============================================================
// 8. Navegación entre vistas
// =============================================================
function switchView(view) {
  const isQuiz = view === "quiz";

  if (isQuiz) {
    renderQuizState();
  } else {
    loadingScreen.hidden = true;
    errorScreen.hidden = true;
    setupScreen.hidden = true;
    quizScreen.hidden = true;
    simulacroScreen.hidden = true;
    resultScreen.hidden = true;
    simulacroResultScreen.hidden = true;
  }

  statsScreen.hidden = view !== "stats";
  historyScreen.hidden = view !== "history";
  reportsScreen.hidden = view !== "reports";

  navButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === view);
  });

  if (view === "stats") renderStats();
  if (view === "history") renderHistory();
  if (view === "reports") renderReports();
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

function renderQuizState() {
  const isLoaded = QUESTIONS.length > 0;

  loadingScreen.hidden = isLoaded || !isLoading;
  errorScreen.hidden = isLoaded || isLoading;

  setupScreen.hidden = quizState !== "setup" || !isLoaded;
  quizScreen.hidden = quizState !== "playing" || !isLoaded;
  simulacroScreen.hidden = quizState !== "simulacro" || !isLoaded;
  resultScreen.hidden = quizState !== "finished" || !isLoaded;
  simulacroResultScreen.hidden = quizState !== "simulacro-finished" || !isLoaded;

  boardTitles.hidden = quizState !== "setup";
  boardStats.hidden = quizState === "setup";
}

// =============================================================
// 9. Configuración d sesión
// =============================================================
modeGrid.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", () => {
    selectedMode = card.dataset.mode;
    modeGrid.querySelectorAll(".mode-card").forEach((c) => {
      c.classList.toggle("is-active", c === card);
    });

    // El filtro por nivel aplica a "smart" y "simulacro"
    const showLevelFilter = selectedMode === "smart" || selectedMode === "simulacro";
    levelFilterBlock.hidden = !showLevelFilter;

    // Reset del rango de nivel si no aplica
    if (!showLevelFilter) {
      selectedLevelFilter = "all";
      levelFilterGrid.querySelectorAll(".filter-btn").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.level === "all");
      });
    }

    // Mostrar/ocultar bloque de tipo de simulacro
    const isSimulacro = selectedMode === "simulacro";
    simulacroTypeBlock.hidden = !isSimulacro;
    amountBlock.hidden = isSimulacro;

    // Resetear la cantidad al cambiar de modo (evita arrastrar valores)
    selectedAmount = null;

    pulseAmountCard();
    rebuildAmountButtons();
    updateSetupPreview();
  });
});

levelFilterGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;

  selectedLevelFilter = btn.dataset.level;
  levelFilterGrid.querySelectorAll(".filter-btn").forEach((b) => {
    b.classList.toggle("is-active", b === btn);
  });

  // Resetear la cantidad al cambiar el filtro
  selectedAmount = null;

  pulseAmountCard();
  rebuildAmountButtons();
  updateSetupPreview();
});


simulacroGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".simulacro-btn");
  if (!btn) return;

  selectedSimulacroType = btn.dataset.simulacro;
  simulacroGrid.querySelectorAll(".simulacro-btn").forEach((b) => {
    b.classList.toggle("is-active", b === btn);
  });

  pulseAmountCard();
  updateSetupPreview();
});


function countAvailableForCurrentSelection() {
  // Filtramos igual que lo haría el motor.
  return selectSessionQuestions(QUESTIONS, progress.questionStats, {
    mode: selectedMode,
    amount: "all",     // queremos el universo completo, no una muestra
    source: selectedSource,
    levelFilter: selectedLevelFilter
  }).usedAmount;
}

// -------------------------------------------------------------
// Animaciones de "feedback visual" en el bloque de cantidad
// -------------------------------------------------------------
function pulseAmountCard() {
  const card = document.getElementById("amountCard");
  if (!card) return;
  card.classList.remove("is-pulsing");
  // Forzar reflow para poder reiniciar la animación
  void card.offsetWidth;
  card.classList.add("is-pulsing");
  setTimeout(() => card.classList.remove("is-pulsing"), 700);
}

function flashCountText() {
  if (!sourceCount) return;
  sourceCount.classList.remove("is-updating");
  void sourceCount.offsetWidth;
  sourceCount.classList.add("is-updating");
}

function animateNewAmountButtons() {
  const btns = amountGrid.querySelectorAll(".amount-btn");
  btns.forEach((b) => {
    b.classList.remove("is-new");
    void b.offsetWidth;
    b.classList.add("is-new");
  });
}

function updateSetupPreview() {
  const available = countAvailableForCurrentSelection();

  // Contador con texto y flash
  sourceCount.textContent = available === 1
    ? "1 pregunta disponible"
    : `${available} preguntas disponibles`;
  flashCountText();
  pulseAmountCard();

  // Sin preguntas: deshabilitar y mostrar aviso
  if (available === 0) {
    startSessionBtn.disabled = true;

    if (selectedMode === "errors") {
      setupWarning.hidden = false;
      setupWarning.textContent = "No tienes preguntas falladas para esta bibliografía. Cambia de modo o de bibliografía.";
    } else if (selectedLevelFilter !== "all") {
      setupWarning.hidden = false;
      setupWarning.textContent = "No hay preguntas en este rango de nivel para la bibliografía seleccionada. Cambia el filtro.";
    } else {
      setupWarning.hidden = false;
      setupWarning.textContent = "No hay preguntas disponibles con esta combinación.";
    }
    return;
  }

  // ¿El usuario pidió más de lo disponible?
  if (selectedAmount !== "all" && selectedAmount > available) {
    setupWarning.hidden = false;
    setupWarning.textContent = `Hay ${available} preguntas disponibles. Se usarán todas.`;
  } else {
    setupWarning.hidden = true;
  }

  startSessionBtn.disabled = false;
}

function startSession() {
  // Si estamos en modo simulacro, derivamos a la función específica
  if (selectedMode === "simulacro") {
    startSimulacro();
    return;
  }

  const result = selectSessionQuestions(QUESTIONS, progress.questionStats, {
    mode: selectedMode,
    amount: selectedAmount,
    source: selectedSource,
    levelFilter: selectedLevelFilter
  });

  if (result.usedAmount === 0) {
    updateSetupPreview();
    return;
  }

  // Mezclar las opciones de cada pregunta al iniciar la sesión
  sessionQuestions = result.questions.map(shuffleQuestionOptions);
  sessionMode = result.mode;
  sessionSource = result.source;
  sessionLevelFilter = result.levelFilter;
  lastSessionQuestionIds = sessionQuestions.map((q) => q.id);

  currentIndex = 0;
  score = 0;

  quizState = "playing";
  renderQuizState();
  renderQuestion();
}

startSessionBtn.addEventListener("click", startSession);

// =============================================================
// 10. Renderizado de una pregunta
// =============================================================
function renderQuestion() {
  const total = sessionQuestions.length;
  const q = sessionQuestions[currentIndex];
  const stats = getStatsFor(q.id);

  counterEl.innerHTML = `${String(currentIndex + 1).padStart(2, "0")}<span class="stat__of">/${String(total).padStart(2, "0")}</span>`;
  scoreEl.textContent = String(score).padStart(3, "0");
  progressFillEl.style.width = `${(currentIndex / total) * 100}%`;

  levelBadgeEl.hidden = false;
  levelBadgeEl.textContent = `Nivel ${stats.level} · ${LEVEL_NAMES[stats.level]}`;

  reportQuestionBtn.textContent = "⚠ Reportar";
  reportQuestionBtn.disabled = false;

  questionTextEl.textContent = q.question;

  optionsListEl.innerHTML = "";
  q.options.forEach((optionText, index) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.type = "button";
    btn.innerHTML = `<span class="option__letter">${LETTERS[index]}</span><span>${optionText}</span>`;
    btn.addEventListener("click", () => selectOption(index));
    optionsListEl.appendChild(btn);
  });

  selectedOption = null;
  answered = false;
  feedbackEl.hidden = true;
  feedbackEl.classList.remove("feedback--correct", "feedback--wrong");
  answerBtn.hidden = false;
  answerBtn.disabled = true;
  nextBtn.hidden = true;
}

function selectOption(index) {
  if (answered) return;
  selectedOption = index;
  answerBtn.disabled = false;
  const optionButtons = optionsListEl.querySelectorAll(".option");
  optionButtons.forEach((btn, i) => {
    btn.classList.toggle("is-selected", i === index);
  });
}

function submitAnswer() {
  if (selectedOption === null || answered) return;

  answered = true;
  const q = sessionQuestions[currentIndex];
  const isCorrect = selectedOption === q.correctIndex;

  if (isCorrect) score++;

  const stats = registerAnswer(q.id, isCorrect, q.options[selectedOption]);
  levelBadgeEl.textContent = `Nivel ${stats.level} · ${LEVEL_NAMES[stats.level]}`;

  const optionButtons = optionsListEl.querySelectorAll(".option");
  optionButtons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.correctIndex) btn.classList.add("is-correct");
    if (i === selectedOption && !isCorrect) btn.classList.add("is-wrong");
  });

  feedbackEl.hidden = false;
  feedbackEl.classList.add(isCorrect ? "feedback--correct" : "feedback--wrong");
  feedbackVerdictEl.textContent = isCorrect ? "✓ Correcto" : "✗ Incorrecto";
  feedbackExplanationEl.textContent = q.explanation;

  scoreEl.textContent = String(score).padStart(3, "0");
  progressFillEl.style.width = `${((currentIndex + 1) / sessionQuestions.length) * 100}%`;

  answerBtn.hidden = true;
  nextBtn.hidden = false;
}

// =============================================================
// 11. Terminar un intento antes de completarlo
// =============================================================
function finishSession() {
  if (quizState !== "playing") return;

  const total = sessionQuestions.length;
  const answeredCount = currentIndex + (answered ? 1 : 0);
  const incorrect = answeredCount - score;
  const unanswered = total - answeredCount;

  const confirmed = confirm(
    `¿Quieres terminar este intento?\n\n` +
    `Respondidas: ${answeredCount}/${total}\n` +
    `Correctas: ${score}\n` +
    `Incorrectas: ${incorrect}\n` +
    `Sin responder: ${unanswered}\n\n` +
    `El intento quedará registrado como "No completado".`
  );

  if (!confirmed) return;

  registerIncompleteSession(
    total, answeredCount, score, incorrect,
    sessionMode, sessionSource, sessionLevelFilter
  );

  goToSetup();
}

// =============================================================
// 12. Avanzar / mostrar resultado
// =============================================================
function goToNext() {
  currentIndex++;
  if (currentIndex < sessionQuestions.length) {
    renderQuestion();
  } else {
    showResult();
  }
}

function showResult() {
  quizState = "finished";
  renderQuizState();

  const total = sessionQuestions.length;
  const incorrect = total - score;
  finalScoreEl.textContent = `${score}/${total}`;

  registerSession(total, score, incorrect, sessionMode, sessionSource, sessionLevelFilter);

  const ratio = score / total;
  let message;
  if (ratio === 1) message = "Puntaje perfecto. Dominas el tema.";
  else if (ratio >= 0.7) message = "Muy buen resultado.";
  else if (ratio >= 0.4) message = "Buen intento, hay espacio para mejorar.";
  else message = "Vale la pena repasar el tema e intentarlo de nuevo.";

  resultMessageEl.textContent = message;
}


// =============================================================
// 12.b. SIMULACRO
// =============================================================

function startSimulacro() {
  const preset = SIMULACRO_PRESETS[selectedSimulacroType];
  if (!preset) {
    console.error("Tipo de simulacro inválido:", selectedSimulacroType);
    return;
  }

  // 1. Seleccionar preguntas (modo "all" con shuffle, para no usar pesos)
  const result = selectSessionQuestions(QUESTIONS, progress.questionStats, {
    mode: "all",                       // siempre modo "all" para simulacro
    amount: preset.questions,
    source: selectedSource,
    levelFilter: selectedLevelFilter
  });

  if (result.usedAmount === 0) {
    setupWarning.hidden = false;
    setupWarning.textContent = "No hay preguntas disponibles para este simulacro con la combinación seleccionada.";
    return;
  }

  // 2. Cargar el estado del simulacro
  simulacro.active = true;
  simulacro.type = selectedSimulacroType;
  simulacro.questions = result.questions.map(shuffleQuestionOptions);
  simulacro.answers = new Array(simulacro.questions.length).fill(null);
  simulacro.flags = new Array(simulacro.questions.length).fill(false);
  simulacro.visited = new Array(simulacro.questions.length).fill(false);
  simulacro.currentIndex = 0;
  simulacro.startTime = Date.now();
  simulacro.durationMs = preset.durationMs;
  simulacro.remainingMs = preset.durationMs;
  simulacro.paused = false;

  // Marcar la primera pregunta como visitada
  simulacro.visited[0] = true;

  // 3. Mostrar la pantalla
  quizState = "simulacro";
  renderQuizState();

  // 4. Renderizar y arrancar
  renderSimulacro();
  startSimulacroTimer();
}



function startSimulacroTimer() {
  if (simulacro.timerInterval) {
    clearInterval(simulacro.timerInterval);
  }

  updateSimulacroTimerDisplay();

  simulacro.timerInterval = setInterval(() => {
    if (simulacro.paused || !simulacro.active) return;

    simulacro.remainingMs -= 1000;
    updateSimulacroTimerDisplay();

    // Últimos 30 segundos: color coral
    if (simulacro.remainingMs <= 30000) {
      simulacroTimer.classList.add("is-warning");
    }

    // Tiempo agotado
    if (simulacro.remainingMs <= 0) {
      simulacro.remainingMs = 0;
      updateSimulacroTimerDisplay();
      finishSimulacroByTimeout();
    }
  }, 1000);
}

function updateSimulacroTimerDisplay() {
  const ms = Math.max(0, simulacro.remainingMs);
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  simulacroTimerValue.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderSimulacro() {
  const total = simulacro.questions.length;
  const idx = simulacro.currentIndex;
  const q = simulacro.questions[idx];
  const stats = getStatsFor(q.id);

  // Header
  const preset = SIMULACRO_PRESETS[simulacro.type];
  simulacroTypeLabel.textContent = `SIMULACRO · ${preset.name.toUpperCase()}`;
  simulacroCounter.textContent = `Pregunta ${idx + 1}/${total}`;
  simulacroProgressFill.style.width = `${(idx / total) * 100}%`;

  // Nivel
  simulacroLevelBadge.hidden = false;
  simulacroLevelBadge.textContent = `Nivel ${stats.level} · ${LEVEL_NAMES[stats.level]}`;

  // Reset botón reportar
  simulacroReportBtn.textContent = "⚠ Reportar";
  simulacroReportBtn.disabled = false;

  // Pregunta
  simulacroQuestionText.textContent = q.question;

  // Opciones
  simulacroOptionsList.innerHTML = "";
  q.options.forEach((optionText, index) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.type = "button";
    btn.innerHTML = `<span class="option__letter">${LETTERS[index]}</span><span>${optionText}</span>`;

    const alreadyAnswered = simulacro.answers[idx] !== null;
    if (alreadyAnswered) {
      btn.disabled = true;
      if (index === q.correctIndex) btn.classList.add("is-correct");
      if (index === simulacro.answers[idx] && index !== q.correctIndex) {
        btn.classList.add("is-wrong");
      }
    } else {
      btn.addEventListener("click", () => selectSimulacroOption(index));
    }

    simulacroOptionsList.appendChild(btn);
  });

  // Flag
  const isFlagged = simulacro.flags[idx];
  simulacroFlagBtn.classList.toggle("is-flagged", isFlagged);
  simulacroFlagText.textContent = isFlagged ? "Marcada para revisar" : "Marcar para revisar";

  // Botones prev/next
  simulacroPrevBtn.disabled = idx === 0;
  simulacroNextBtn.disabled = idx === total - 1;

  // Renderizar navegador
  renderSimulacroNavigator();
}

function renderSimulacroNavigator() {
  simulacroNavigatorGrid.innerHTML = "";

  simulacro.questions.forEach((q, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "simulacro-nav-btn";
    btn.textContent = String(i + 1);

    if (simulacro.answers[i] !== null) btn.classList.add("is-answered");
    if (simulacro.flags[i]) btn.classList.add("is-flagged");
    if (i === simulacro.currentIndex) btn.classList.add("is-current");

    btn.addEventListener("click", () => gotoSimulacroQuestion(i));
    simulacroNavigatorGrid.appendChild(btn);
  });
}

function selectSimulacroOption(index) {
  const idx = simulacro.currentIndex;
  if (simulacro.answers[idx] !== null) return;

  const q = simulacro.questions[idx];
  const isCorrect = index === q.correctIndex;

  // Guardar respuesta y actualizar stats
  simulacro.answers[idx] = index;
  const stats = registerAnswer(q.id, isCorrect, q.options[index]);
  simulacroLevelBadge.textContent = `Nivel ${stats.level} · ${LEVEL_NAMES[stats.level]}`;

  // Marcar visualmente las opciones
  const optionButtons = simulacroOptionsList.querySelectorAll(".option");
  optionButtons.forEach((btn, i) => {
    btn.disabled = true;
    btn.removeEventListener("click", () => {});
    if (i === q.correctIndex) btn.classList.add("is-correct");
    if (i === index && !isCorrect) btn.classList.add("is-wrong");
  });

  // Actualizar navegador
  renderSimulacroNavigator();
}

function gotoSimulacroQuestion(newIndex) {
  const total = simulacro.questions.length;
  if (newIndex < 0 || newIndex >= total) return;

  simulacro.currentIndex = newIndex;
  simulacro.visited[newIndex] = true;
  renderSimulacro();
}

function toggleSimulacroFlag() {
  const idx = simulacro.currentIndex;
  simulacro.flags[idx] = !simulacro.flags[idx];
  renderSimulacro();
}

function pauseSimulacro() {
  if (!simulacro.active || simulacro.paused) return;
  simulacro.paused = true;
  simulacroPauseOverlay.hidden = false;
}

function resumeSimulacro() {
  if (!simulacro.active || !simulacro.paused) return;
  simulacro.paused = false;
  simulacroPauseOverlay.hidden = true;
}

function openFinishSimulacroModal() {
  if (!simulacro.active) return;

  // Contar respondidas y sin responder
  const total = simulacro.questions.length;
  const answeredCount = simulacro.answers.filter((a) => a !== null).length;
  const unansweredCount = total - answeredCount;
  const flaggedCount = simulacro.flags.filter((f) => f).length;

  simulacroFinishSummary.textContent =
    `Respondidas: ${answeredCount}/${total}\n` +
    `Sin responder: ${unansweredCount}\n` +
    `Marcadas para revisar: ${flaggedCount}`;

  simulacroFinishModal.hidden = false;

  // Pausar mientras se confirma
  simulacro.paused = true;
}

function closeFinishSimulacroModal() {
  simulacroFinishModal.hidden = true;
  simulacro.paused = false;
}

function confirmFinishSimulacro() {
  simulacroFinishModal.hidden = true;
  finishSimulacro("manual");
}

function finishSimulacroByTimeout() {
  // Cuando se acaba el tiempo: finalizar automáticamente
  finishSimulacro("timeout");
}

function finishSimulacro(reason) {
  if (!simulacro.active) return;

  // Detener el timer
  if (simulacro.timerInterval) {
    clearInterval(simulacro.timerInterval);
    simulacro.timerInterval = null;
  }

  // Calcular estadísticas
  const total = simulacro.questions.length;
  const answeredCount = simulacro.answers.filter((a) => a !== null).length;
  const correctCount = simulacro.questions.reduce((acc, q, i) => {
    return acc + (simulacro.answers[i] === q.correctIndex ? 1 : 0);
  }, 0);
  const incorrectCount = answeredCount - correctCount;
  const unansweredCount = total - answeredCount;

  // Registrar como sesión (incompleta si hay sin responder, completa si no)
  const isComplete = unansweredCount === 0;
  const mode = "simulacro";

  if (isComplete) {
    registerSession(total, correctCount, incorrectCount, mode, selectedSource, selectedLevelFilter);
  } else {
    registerIncompleteSession(total, answeredCount, correctCount, incorrectCount, mode, selectedSource, selectedLevelFilter);
  }

  // Guardar datos para la pantalla de resultados
  const timeUsedMs = simulacro.durationMs - simulacro.remainingMs;

  // Limpiar el estado (pero mantener las últimas variables para la pantalla final)
  const summary = {
    total,
    answeredCount,
    correctCount,
    incorrectCount,
    unansweredCount,
    timeUsedMs,
    durationMs: simulacro.durationMs,
    reason,
    type: simulacro.type
  };

  // Resetear simulacro
  if (simulacro.timerInterval) clearInterval(simulacro.timerInterval);
  simulacro.active = false;
  simulacro.paused = false;
  simulacroPauseOverlay.hidden = true;

  // Mostrar pantalla de resultado
  showSimulacroResult(summary);
}

function showSimulacroResult(summary) {
  quizState = "simulacro-finished";
  renderQuizState();

  // Puntaje principal
  simulacroResultScore.textContent = `${summary.correctCount}/${summary.total}`;

  // Tarjetas de desglose
  simulacroResultCorrect.textContent = summary.correctCount;
  simulacroResultIncorrect.textContent = summary.incorrectCount;
  simulacroResultUnanswered.textContent = summary.unansweredCount;

  // Tiempo usado (mm:ss)
  const totalSeconds = Math.round(summary.timeUsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  simulacroResultTime.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;

  // Mensaje según desempeño
  const ratio = summary.correctCount / summary.total;
  let message;

  if (summary.reason === "timeout") {
    message = "⏱ Se acabó el tiempo. ";
  } else {
    message = "";
  }

  if (ratio === 1) message += "Puntaje perfecto. Dominás el tema.";
  else if (ratio >= 0.7) message += "Muy buen resultado.";
  else if (ratio >= 0.4) message += "Buen intento, hay espacio para mejorar.";
  else message += "Vale la pena repasar el tema e intentarlo de nuevo.";

  simulacroResultMessage.textContent = message;

  // Guardar el resumen para el botón "Repetir"
  lastSimulacroSummary = summary;
}

let lastSimulacroSummary = null;

// =============================================================
// Eventos del simulacro
// =============================================================
simulacroFlagBtn.addEventListener("click", toggleSimulacroFlag);
simulacroPrevBtn.addEventListener("click", () => gotoSimulacroQuestion(simulacro.currentIndex - 1));
simulacroNextBtn.addEventListener("click", () => gotoSimulacroQuestion(simulacro.currentIndex + 1));
simulacroPauseBtn.addEventListener("click", pauseSimulacro);
simulacroResumeBtn.addEventListener("click", resumeSimulacro);
simulacroFinishBtn.addEventListener("click", openFinishSimulacroModal);
simulacroCancelFinishBtn.addEventListener("click", closeFinishSimulacroModal);
simulacroConfirmFinishBtn.addEventListener("click", confirmFinishSimulacro);
simulacroFinishModal.querySelector("[data-close-finish-modal]").addEventListener("click", closeFinishSimulacroModal);

// Repetir el simulacro: vuelve a configurar con el mismo tipo y bibliografía
simulacroRepeatBtn.addEventListener("click", () => {
  if (!lastSimulacroSummary) return;

  // Restaurar los parámetros del simulacro anterior
  selectedSimulacroType = lastSimulacroSummary.type;

  // Volver a lanzar el simulacro (mismo tipo, misma bibliografía, mismo filtro)
  startSimulacro();
});

// Elegir otro simulacro: vuelve a la pantalla de configuración
simulacroNewBtn.addEventListener("click", () => {
  quizState = "setup";
  renderQuizState();
  updateSetupPreview();
});

// =============================================================
// 13. Volver a configuración
// =============================================================
function goToSetup() {
  quizState = "setup";
  renderQuizState();
  rebuildAmountButtons();
  updateSetupPreview();
}

restartBtn.addEventListener("click", goToSetup);

// Repetir la última sesión (mismos IDs, mismo orden)
repeatSessionBtn.addEventListener("click", () => {
  if (!lastSessionQuestionIds || lastSessionQuestionIds.length === 0) return;

  // Reconstruir preguntas respetando el orden original
  const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
  const rebuilt = lastSessionQuestionIds
    .map((id) => byId.get(id))
    .filter(Boolean);

  if (rebuilt.length === 0) return;

    sessionQuestions = rebuilt.map(shuffleQuestionOptions);
  sessionMode = "repeat";
  sessionSource = "all";
  sessionLevelFilter = "all";
  currentIndex = 0;
  score = 0;

  quizState = "playing";
  renderQuizState();
  renderQuestion();
});

// =============================================================
// 14. Estadísticas
// =============================================================
function renderStats() {
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let answeredQuestions = 0;
  const levelCounts = new Array(LEVEL_NAMES.length).fill(0);

  QUESTIONS.forEach((q) => {
    const stats = getStatsFor(q.id);
    totalCorrect += stats.correct;
    totalIncorrect += stats.incorrect;
    if (stats.attempts > 0) answeredQuestions++;
    levelCounts[stats.level]++;
  });

  const totalAnswers = totalCorrect + totalIncorrect;
  const accuracy = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;

  const summaryCards = [
    { value: answeredQuestions, label: "Preguntas respondidas" },
    { value: totalCorrect, label: "Correctas" },
    { value: totalIncorrect, label: "Incorrectas" },
    { value: `${accuracy}%`, label: "Porcentaje de aciertos" }
  ];

  statsSummaryGrid.innerHTML = summaryCards
    .map((card) => `
      <div class="stat-card">
        <span class="stat-card__value">${card.value}</span>
        <span class="stat-card__label">${card.label}</span>
      </div>`)
    .join("");

  statsLevelGrid.innerHTML = LEVEL_NAMES.map((name, level) => `
    <div class="stat-card">
      <span class="stat-card__value">${levelCounts[level]}</span>
      <span class="stat-card__label">${name}</span>
    </div>`)
    .join("");
}

resetBtn.addEventListener("click", () => {
  const confirmed = confirm(
    "¿Seguro que quieres borrar todo tu progreso? Esta acción no se puede deshacer."
  );
  if (!confirmed) return;
  resetProgress();
  renderStats();
  renderHistory();
  renderReports();
  updateReportsBadge();
});

// =============================================================
// 15. Historial
// =============================================================
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function renderHistory() {
  if (progress.sessionHistory.length === 0) {
    historyList.innerHTML = `
      <p class="empty-state">
        Aún no hay sesiones registradas.
        Completa un cuestionario para ver tu historial aquí.
      </p>`;
    return;
  }

  const sessions = [...progress.sessionHistory].reverse();

  historyList.innerHTML = sessions
    .map((session) => {
      const modeTag = session.mode
        ? `<span class="history-item__mode">${MODE_LABELS[session.mode] || session.mode}</span>`
        : "";

      const sourceTag = session.source && session.source !== "all"
        ? (() => {
            const q = QUESTIONS.find((item) => item.source === session.source);
            const label = q && q.sourceName ? q.sourceName : session.source;
            return `<span class="history-item__mode">${escapeHtml(label)}</span>`;
          })()
        : "";

      const isIncomplete = session.status === "incomplete";
      const statusTag = isIncomplete
        ? `<span class="history-item__status history-item__status--incomplete">⚠ No completado</span>`
        : `<span class="history-item__status history-item__status--completed">✓ Completado</span>`;

      const answeredCount = session.answered !== undefined ? session.answered : session.total;
      const unanswered = session.unanswered !== undefined ? session.unanswered : 0;

      const detail = isIncomplete
        ? `${answeredCount}/${session.total} respondidas · ${session.correct} correctas · ${session.incorrect} incorrectas · ${unanswered} sin responder`
        : `${session.total} preguntas · ${session.correct} correctas · ${session.incorrect} incorrectas`;

      return `
        <div class="history-item">
          <div>
            <div class="history-item__date">${formatDate(session.date)}</div>
            <div class="history-item__detail">${detail}</div>
            ${modeTag}
            ${sourceTag}
            ${statusTag}
          </div>
          <div class="history-item__pct">${session.percentage}%</div>
        </div>
      `;
    })
    .join("");
}

// =============================================================
// 16. Modal de reportes
// =============================================================
function openReportModal() {
  if (quizState !== "playing") return;
  const q = sessionQuestions[currentIndex];
  if (!q) return;

  reportQuestionPreview.textContent = q.question;
  reportTypeSelect.value = "respuesta-incorrecta";
  reportCommentInput.value = "";
  reportModal.hidden = false;
  reportCommentInput.focus();
}

function closeReportModal() {
  reportModal.hidden = true;
}

function submitReport() {
  if (quizState !== "playing") return;
  const q = sessionQuestions[currentIndex];
  if (!q) return;

  saveQuestionReport(q.id, reportTypeSelect.value, reportCommentInput.value);
  closeReportModal();
  updateReportsBadge();

  reportQuestionBtn.textContent = "✓ Reportado";
  reportQuestionBtn.disabled = true;
  setTimeout(() => {
    reportQuestionBtn.textContent = "⚠ Reportar";
    reportQuestionBtn.disabled = false;
  }, 1800);
}

reportQuestionBtn.addEventListener("click", openReportModal);
cancelReportBtn.addEventListener("click", closeReportModal);
submitReportBtn.addEventListener("click", submitReport);
reportModal.querySelector("[data-close-modal]").addEventListener("click", closeReportModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !reportModal.hidden) closeReportModal();
});

// =============================================================
// 17. Pantalla de reportes
// =============================================================
function updateReportsBadge() {
  const count = progress.questionReports.length;
  if (count > 0) {
    reportsBadge.hidden = false;
    reportsBadge.textContent = String(count);
  } else {
    reportsBadge.hidden = true;
  }
}


function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderReports() {
  const reports = [...progress.questionReports].reverse();

  if (reports.length === 0) {
    reportsList.innerHTML = `
      <p class="empty-state">
        No has enviado ningún reporte todavía.
        Si encuentras una pregunta con error, usa el botón "Reportar"
        mientras la estás respondiendo.
      </p>`;
    copyReportsBtn.hidden = true;
    clearReportsBtn.hidden = true;
    return;
  }

  copyReportsBtn.hidden = false;
  clearReportsBtn.hidden = false;

  reportsList.innerHTML = reports
    .map((report) => {
      const typeLabel = REPORT_TYPE_LABELS[report.type] || report.type;
      const comment = report.comment
        ? `<p class="report-card__comment">${escapeHtml(report.comment)}</p>`
        : `<p class="report-card__comment report-card__comment--empty">(sin comentario)</p>`;

      return `
        <div class="report-card">
          <div class="report-card__head">
            <span class="report-card__type">${typeLabel}</span>
            <span class="report-card__date">${formatDate(report.date)}</span>
          </div>
          <p class="report-card__question">${escapeHtml(report.questionText)}</p>
          ${comment}
        </div>
      `;
    })
    .join("");
}

copyReportsBtn.addEventListener("click", async () => {
  if (progress.questionReports.length === 0) return;

  const text = progress.questionReports
    .map((r) => {
      const typeLabel = REPORT_TYPE_LABELS[r.type] || r.type;
      return [
        `ID: ${r.questionId}`,
        `Tipo: ${typeLabel}`,
        `Fecha: ${formatDate(r.date)}`,
        `Pregunta: ${r.questionText}`,
        `Comentario: ${r.comment || "(sin comentario)"}`
      ].join("\n");
    })
    .join("\n\n---\n\n");

  try {
    await navigator.clipboard.writeText(text);
    copyReportsBtn.textContent = "✓ Copiado";
    setTimeout(() => {
      copyReportsBtn.textContent = "Copiar todos los reportes";
    }, 1800);
  } catch (err) {
    console.warn("No se pudo copiar al portapapeles:", err);
    alert("No se pudo copiar automáticamente. Aquí tienes los reportes:\n\n" + text);
  }
});

clearReportsBtn.addEventListener("click", () => {
  const confirmed = confirm(
    "¿Seguro que quieres borrar TODOS los reportes? Esta acción no se puede deshacer."
  );
  if (!confirmed) return;
  clearAllReports();
  renderReports();
  updateReportsBadge();
});

// =============================================================
// 18. Arranque
// =============================================================
answerBtn.addEventListener("click", submitAnswer);
nextBtn.addEventListener("click", goToNext);
finishSessionBtn.addEventListener("click", finishSession);

async function boot() {
  progress = loadProgress();
  if (migrateProgress(progress)) saveProgress(progress);

  const ok = await loadQuestionsFromJSON();
  isLoading = false;

  if (!ok) {
    renderQuizState();
    return;
  }

  // Construir selector de bibliografía
  renderSourceDropdown();
  updateSourceTrigger();

   // Estado inicial: modo smart, level all
  selectedMode = "smart";
  selectedSource = "all";
  selectedLevelFilter = "all";
  selectedAmount = 20;
  selectedSimulacroType = "rapida";

  // Activar el primer botón de simulacro visualmente
  const firstSimulacroBtn = simulacroGrid.querySelector('[data-simulacro="rapida"]');
  if (firstSimulacroBtn) firstSimulacroBtn.classList.add("is-active");

  // Ocultar bloque de filtro si el modo inicial no es smart
  levelFilterBlock.hidden = selectedMode !== "smart";

  // Construir presets de cantidad iniciales
  rebuildAmountButtons();

  // Pintar todo
  renderQuizState();
  updateSetupPreview();
  updateReportsBadge();
}

boot();