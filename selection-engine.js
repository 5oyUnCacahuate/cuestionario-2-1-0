// =============================================================
// MOTOR DE SELECCIÓN DE PREGUNTAS (V5)
//
// Este archivo NO toca el DOM ni localStorage. Solo recibe datos
// (el banco de preguntas + el progreso guardado + filtros) y
// devuelve datos (la selección de preguntas para una sesión).
//
// Novedades V5:
//  - "Solo errores" ahora usa olvido automático: una pregunta
//    sale de la lista cuando el usuario la acierta 3 veces
//    seguidas (streakCorrect >= 3).
//  - Nuevo filtro "levelFilter" en Estudio inteligente:
//    "all" | "new" | "reinforce" | "not-mastered" | "mastered"
// =============================================================

// -------------------------------------------------------------
// Peso relativo de cada nivel de dominio (0 a 5), usado por el
// modo "Estudio inteligente" (y dentro de "Solo errores").
// -------------------------------------------------------------
const LEVEL_WEIGHTS = {
  0: 8,    // Nueva              → prioridad muy alta
  1: 10,   // Necesita refuerzo  → prioridad máxima
  2: 6,    // En aprendizaje     → prioridad alta
  3: 3,    // Conocida           → prioridad media
  4: 1.5,  // Dominada           → prioridad baja
  5: 0.5   // Dominio sólido     → prioridad muy baja
};
const DEFAULT_LEVEL_WEIGHT = LEVEL_WEIGHTS[0];

function getWeightForLevel(level) {
  return LEVEL_WEIGHTS[level] !== undefined ? LEVEL_WEIGHTS[level] : DEFAULT_LEVEL_WEIGHT;
}

// -------------------------------------------------------------
// Constante de "olvido automático" en Solo errores.
// Si el usuario acierta esta cantidad de veces seguidas, la
// pregunta sale de la lista de errores.
// -------------------------------------------------------------
const ERRORS_FORGIVE_STREAK = 3;

// -------------------------------------------------------------
// Baraja un arreglo SIN modificar el original (Fisher-Yates).
// -------------------------------------------------------------
function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// -------------------------------------------------------------
// Muestreo aleatorio ponderado SIN reemplazo.
// (Algoritmo de Efraimidis-Spirakis: key = random ^ (1/peso))
// -------------------------------------------------------------
function weightedSampleWithoutReplacement(items, weightFn, amount) {
  const keyed = items.map((item) => {
    const weight = Math.max(weightFn(item), 0.0001);
    const key = Math.pow(Math.random(), 1 / weight);
    return { item, key };
  });

  keyed.sort((a, b) => b.key - a.key);

  return keyed.slice(0, amount).map((entry) => entry.item);
}

// -------------------------------------------------------------
// Filtra las preguntas por fuente (source).
// - "all" o null → sin filtro.
// - Un id como "rm-0864-2019" → solo esa fuente.
// -------------------------------------------------------------
function filterBySource(allQuestions, sourceId) {
  if (!sourceId || sourceId === "all") return allQuestions;
  return allQuestions.filter((q) => q.source === sourceId);
}

// -------------------------------------------------------------
// NUEVO: filtra por rango de nivel de dominio.
// Valores válidos para levelFilter:
//   "all"          → todas (sin filtro)
//   "new"          → solo nivel 0
//   "reinforce"    → niveles 1 y 2
//   "not-mastered" → niveles 0, 1, 2 y 3
//   "mastered"     → niveles 4 y 5
// -------------------------------------------------------------
function filterByLevel(questions, questionStats, levelFilter) {
  if (!levelFilter || levelFilter === "all") return questions;

  return questions.filter((q) => {
    const stats = questionStats[q.id];
    const level = stats ? stats.level : 0;

    switch (levelFilter) {
      case "new":          return level === 0;
      case "reinforce":    return level === 1 || level === 2;
      case "not-mastered": return level >= 0 && level <= 3;
      case "mastered":     return level >= 4;
      default:             return true;
    }
  });
}

// -------------------------------------------------------------
// NUEVO: decide si una pregunta pertenece al conjunto "errores".
// Aplica olvido automático:
//   - Entra si tiene al menos 1 fallo en la historia.
//   - Sale si tiene streakCorrect >= ERRORS_FORGIVE_STREAK.
//   - Vuelve a entrar si la falla de nuevo (porque streakCorrect se
//     reinicia a 0 y la condición de olvido ya no se cumple).
// -------------------------------------------------------------
function belongsToErrors(questionStats, questionId) {
  const stats = questionStats[questionId];
  if (!stats) return false;
  if (stats.incorrect === 0) return false;

  const forgiveStreak = stats.streakCorrect || 0;
  return forgiveStreak < ERRORS_FORGIVE_STREAK;
}

// -------------------------------------------------------------
// Punto de entrada principal del motor.
//
// Parámetros:
//  - allQuestions: arreglo completo del banco
//  - questionStats: progreso por id
//  - options.mode:        "smart" | "all" | "errors"
//  - options.amount:      número | "all"
//  - options.source:      "all" | id de fuente
//  - options.levelFilter: "all" | "new" | "reinforce" | "not-mastered" | "mastered"
//
// Devuelve:
//  {
//    questions, mode, source, levelFilter,
//    requestedAmount, availableAmount, usedAmount, wasClamped
//  }
// -------------------------------------------------------------
function selectSessionQuestions(allQuestions, questionStats, options) {
  const mode = options.mode;
  const requestedAmount = options.amount;
  const source = options.source || "all";
  const levelFilter = options.levelFilter || "all";

  // 1. Filtrar por fuente.
  let candidates = filterBySource(allQuestions, source);

  // 2. Aplicar filtro del modo.
  if (mode === "errors") {
    candidates = candidates.filter((q) => belongsToErrors(questionStats, q.id));
  }

  // 3. Aplicar filtro por rango de nivel (solo aplica a "smart" y "all").
  if (mode !== "errors") {
    candidates = filterByLevel(candidates, questionStats, levelFilter);
  }

  const availableAmount = candidates.length;

  // 4. Resolver cuántas preguntas se usarán realmente.
  const wantsAll = requestedAmount === "all";
  const numericAmount = wantsAll
    ? availableAmount
    : Math.min(requestedAmount, availableAmount);
  const wasClamped = !wantsAll && requestedAmount > availableAmount;

  // 5. Seleccionar preguntas según el modo.
  let questions;
  if (candidates.length === 0) {
    questions = [];
  } else if (mode === "all") {
    questions = shuffleArray(candidates).slice(0, numericAmount);
  } else {
    questions = weightedSampleWithoutReplacement(
      candidates,
      (q) => {
        const stats = questionStats[q.id];
        const level = stats ? stats.level : 0;
        return getWeightForLevel(level);
      },
      numericAmount
    );
  }

  return {
    questions,
    mode,
    source,
    levelFilter,
    requestedAmount,
    availableAmount,
    usedAmount: questions.length,
    wasClamped
  };
}