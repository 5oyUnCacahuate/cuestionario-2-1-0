// =============================================================
// BIBLIOTECA - Lógica principal
// =============================================================

// ---------------------------------------------
// 1. Lista de documentos disponibles
// ---------------------------------------------
const DOCUMENTOS = [
  {
    id: "educacion-2030-ods4",
    titulo: "Educación 2030: Declaración de Incheon",
    fuente: "UNESCO · 2016 · ODS 4",
    icono: "📄",
    carpeta: "data/documentos/educacion-2030-ods4"
  }
];

// ---------------------------------------------
// 2. Referencias al DOM
// ---------------------------------------------
const listView = document.getElementById("listView");
const readerView = document.getElementById("readerView");
const docGrid = document.getElementById("docGrid");
const readerTitle = document.getElementById("readerTitle");
const indexList = document.getElementById("indexList");
const readerContent = document.getElementById("readerContent");
const backToLibraryBtn = document.getElementById("backToLibraryBtn");
const openPdfBtn = document.getElementById("openPdfBtn");
const pdfModal = document.getElementById("pdfModal");
const pdfModalTitle = document.getElementById("pdfModalTitle");
const pdfFrame = document.getElementById("pdfFrame");
const closePdfBtn = document.getElementById("closePdfBtn");
const tabsNav = document.getElementById("tabsNav");

// ---------------------------------------------
// 3. Estado
// ---------------------------------------------
let docActual = null;
let seccionActual = null;
let tabActivo = "texto";
let contenidoSeccion = {};

// ---------------------------------------------
// 4. Renderizar la lista de documentos
// ---------------------------------------------
function renderDocList() {
  docGrid.innerHTML = "";
  DOCUMENTOS.forEach((doc) => {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "doc-card";
    a.dataset.docId = doc.id;
    a.innerHTML = `
      <div class="doc-card__icon">${doc.icono}</div>
      <div class="doc-card__body">
        <h3 class="doc-card__title">${doc.titulo}</h3>
        <p class="doc-card__meta">${doc.fuente}</p>
      </div>
    `;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      abrirDocumento(doc.id);
    });
    docGrid.appendChild(a);
  });
}

// ---------------------------------------------
// 5. Abrir un documento
// ---------------------------------------------
async function abrirDocumento(docId) {
  const doc = DOCUMENTOS.find((d) => d.id === docId);
  if (!doc) return;

  try {
    const resp = await fetch(`${doc.carpeta}/index.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    docActual = { ...doc, meta: data };
    seccionActual = null;

    readerTitle.textContent = data.titulo;
    renderIndex(data);
    mostrarVista("reader");

    // Abrir la primera sección clickeable automáticamente
    const primerIndex = data.secciones.findIndex((s) => !s.esTitulo);
    if (primerIndex !== -1) {
      cargarSeccion(primerIndex);
    } else {
      readerContent.innerHTML = '<p class="empty-state">Este documento no tiene secciones cargadas todavía.</p>';
    }
  } catch (err) {
    console.error("Error al cargar el documento:", err);
    alert("No se pudo cargar el documento. Verificá que exista el archivo index.json.");
  }
}

// ---------------------------------------------
// 6. Renderizar el índice de secciones
// ---------------------------------------------
function renderIndex(data) {
  indexList.innerHTML = "";

  data.secciones.forEach((seccion, i) => {
    const li = document.createElement("li");

    if (seccion.esTitulo) {
      // Título agrupador (no clickeable)
      const span = document.createElement("span");
      span.className = "index-titulo";
      span.textContent = seccion.titulo;
      li.appendChild(span);
    } else {
      // Sección clickeable
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "index-item";
      btn.dataset.indexRef = String(i);
      const nivel = (seccion.id.match(/\./g) || []).length;
      btn.dataset.nivel = String(nivel);
      btn.textContent = seccion.titulo;
      btn.addEventListener("click", () => cargarSeccion(i));
      li.appendChild(btn);
    }

    indexList.appendChild(li);
  });
}

// ---------------------------------------------
// 7. Cargar una sección
// ---------------------------------------------
async function cargarSeccion(index) {
  if (!docActual) return;
  const seccion = docActual.meta.secciones[index];
  if (!seccion || seccion.esTitulo) return;

  if (typeof detenerTTS === "function") detenerTTS();

  seccionActual = index;

  // Marcar como activa
  document.querySelectorAll(".index-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.indexRef === String(index));
  });

  readerContent.innerHTML = '<p class="empty-state">Cargando…</p>';

  const base = `${docActual.carpeta}/${seccion.carpeta}`;
  const tabs = seccion.tabs || ["texto"];

  // Configurar tabs visibles
  if (tabsNav) {
    tabsNav.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.hidden = !tabs.includes(btn.dataset.tab);
    });
  }

  try {
    // Cargar solo los archivos necesarios según los tabs
    const fetchPromises = {};

    if (tabs.includes("texto")) {
      fetchPromises.texto = fetch(`${base}/texto.txt`).then((r) => (r.ok ? r.text() : ""));
    }
    if (tabs.includes("resumen")) {
      fetchPromises.resumen = fetch(`${base}/resumen.txt`).then((r) => (r.ok ? r.text() : ""));
    }
    if (tabs.includes("clave")) {
      fetchPromises.clave = fetch(`${base}/puntos-clave.json`).then((r) => (r.ok ? r.json() : []));
    }
    if (tabs.includes("preguntas")) {
      fetchPromises.preguntas = fetch(`${base}/preguntas.json`).then((r) => (r.ok ? r.json() : []));
    }

    const resultados = await Promise.all(Object.values(fetchPromises));
    const keys = Object.keys(fetchPromises);
    contenidoSeccion = {};
    keys.forEach((k, i) => { contenidoSeccion[k] = resultados[i]; });

    // Resetear tab activo al primero disponible
    tabActivo = tabs[0];
    actualizarTabsUI();
    renderTabContenido();
  } catch (err) {
    console.error("Error al cargar la sección:", err);
    readerContent.innerHTML = '<p class="empty-state">No se pudo cargar esta sección.</p>';
  }
}

// ---------------------------------------------
// 8. Renderizar el contenido del tab activo
// ---------------------------------------------
function renderTabContenido() {
  const c = contenidoSeccion;

  if (tabActivo === "texto") {
    readerContent.innerHTML = textoAHtml(c.texto, "texto");

  } else if (tabActivo === "resumen") {
    readerContent.innerHTML = textoAHtml(c.resumen, "resumen");

  } else if (tabActivo === "clave") {
    if (!c.clave || c.clave.length === 0) {
      readerContent.innerHTML = '<p class="empty-state">No hay puntos clave cargados para esta sección.</p>';
      return;
    }
    readerContent.innerHTML = c.clave
      .map(
        (bloque) => `
        <div class="clave-bloque">
          <h3 class="clave-bloque__titulo">${escapeHtml(bloque.titulo)}</h3>
          <ul class="clave-bloque__lista">
            ${bloque.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
      `
      )
      .join("");

  } else if (tabActivo === "preguntas") {
    if (!c.preguntas || c.preguntas.length === 0) {
      readerContent.innerHTML = '<p class="empty-state">No hay preguntas de repaso para esta sección.</p>';
      return;
    }
    readerContent.innerHTML = `
      <p class="preguntas-intro">Estas preguntas te ayudan a verificar la comprensión del apartado. También forman parte del banco de preguntas del cuestionario.</p>
      ${c.preguntas
        .map(
          (p, i) => `
        <div class="pregunta-card" data-pregunta-id="${p.id}">
          <p class="pregunta-card__num">Pregunta ${i + 1}</p>
          <p class="pregunta-card__texto">${escapeHtml(p.pregunta)}</p>
          <ul class="pregunta-card__opciones">
            ${p.opciones
              .map(
                (op, j) => `
              <li class="pregunta-card__opcion" data-index="${j}">
                <span class="pregunta-card__letra">${String.fromCharCode(65 + j)}</span>
                <span>${escapeHtml(op)}</span>
              </li>
            `
              )
              .join("")}
          </ul>
          <button class="btn-revelar" type="button">Ver respuesta</button>
          <div class="pregunta-card__respuesta" hidden>
            <p><strong>Respuesta correcta:</strong> ${String.fromCharCode(65 + p.respuestaCorrecta)}. ${escapeHtml(p.opciones[p.respuestaCorrecta])}</p>
            <p class="pregunta-card__explicacion">${escapeHtml(p.explicacion)}</p>
          </div>
        </div>
      `
        )
        .join("")}
    `;

    readerContent.querySelectorAll(".btn-revelar").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".pregunta-card");
        const resp = card.querySelector(".pregunta-card__respuesta");
        resp.hidden = !resp.hidden;
        btn.textContent = resp.hidden ? "Ver respuesta" : "Ocultar respuesta";
      });
    });
  }

  readerContent.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------
// 9. Convertir texto plano a HTML
// ---------------------------------------------
function textoAHtml(texto, tipo = "texto") {
  if (!texto) {
    return `<p class="empty-state">Esta sección todavía no tiene contenido de "${tipo}".</p>`;
  }

  const parrafos = texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return parrafos
    .map((p) => {
      if (/^(Meta\s+4|Sección|Anexo|Introducción|Conclusión|Objetivo|Visión|Modalidades|Notas al pie|Objetivo global|Enfoques estratégicos)/i.test(p)) {
        return `<h2>${escapeHtml(p)}</h2>`;
      }
      const limpio = p.replace(/\n+/g, " ");
      return `<p>${escapeHtml(limpio)}</p>`;
    })
    .join("");
}

// ---------------------------------------------
// 10. Cambiar entre tabs
// ---------------------------------------------
function actualizarTabsUI() {
  if (!tabsNav) return;
  tabsNav.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tabActivo);
  });
}

function cambiarTab(nuevoTab) {
  if (nuevoTab === tabActivo) return;
  tabActivo = nuevoTab;
  if (typeof detenerTTS === "function") detenerTTS();
  actualizarTabsUI();
  renderTabContenido();
}

// ---------------------------------------------
// 11. Cambiar entre vista lista y vista lector
// ---------------------------------------------
function mostrarVista(vista) {
  if (vista === "reader") {
    listView.hidden = true;
    readerView.hidden = false;
  } else {
    listView.hidden = false;
    readerView.hidden = true;
    docActual = null;
    seccionActual = null;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------
// 12. Modal del PDF
// ---------------------------------------------
function abrirPdfModal() {
  if (!docActual || !docActual.meta.pdf) return;
  const url = docActual.meta.pdf;
  const embedUrl = url.replace("/view?usp=sharing", "/preview").replace("/view", "/preview");
  pdfModalTitle.textContent = docActual.meta.titulo;
  pdfFrame.src = embedUrl;
  pdfModal.hidden = false;
}

function cerrarPdfModal() {
  pdfModal.hidden = true;
  pdfFrame.src = "";
}

// ---------------------------------------------
// 13. Utilidades
// ---------------------------------------------
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------
// 14. Eventos
// ---------------------------------------------
backToLibraryBtn.addEventListener("click", () => {
  if (typeof detenerTTS === "function") detenerTTS();
  mostrarVista("library");
});
openPdfBtn.addEventListener("click", abrirPdfModal);
closePdfBtn.addEventListener("click", cerrarPdfModal);
pdfModal.querySelector("[data-close-pdf]").addEventListener("click", cerrarPdfModal);

if (tabsNav) {
  tabsNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    cambiarTab(btn.dataset.tab);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !pdfModal.hidden) cerrarPdfModal();
});

// ---------------------------------------------
// 15. Arranque
// ---------------------------------------------
renderDocList();

// =============================================================
// TTS - Text to Speech
// =============================================================
const tts = {
  chunks: [],
  currentChunk: 0,
  rate: 1,
  speaking: false,
  paused: false,
  utterance: null
};

const ttsPlayBtn = document.getElementById("ttsPlayBtn");
const ttsPauseBtn = document.getElementById("ttsPauseBtn");
const ttsStopBtn = document.getElementById("ttsStopBtn");
const ttsSpeedSelect = document.getElementById("ttsSpeedSelect");

if (!("speechSynthesis" in window)) {
  console.warn("Este navegador no soporta síntesis de voz.");
}

let vocesDisponibles = [];
function cargarVoces() { vocesDisponibles = speechSynthesis.getVoices(); }
cargarVoces();
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = cargarVoces;
}

function prepararTextoParaTTS(texto) {
  const parrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks = [];
  parrafos.forEach((parrafo) => {
    if (parrafo.length <= 200) {
      chunks.push(parrafo);
    } else {
      const oraciones = parrafo.split(/(?<=[.!?])\s+/);
      let actual = "";
      oraciones.forEach((o) => {
        if ((actual + " " + o).trim().length > 200) {
          if (actual.trim()) chunks.push(actual.trim());
          actual = o;
        } else {
          actual += " " + o;
        }
      });
      if (actual.trim()) chunks.push(actual.trim());
    }
  });
  return chunks;
}

function iniciarTTS() {
  if (tts.paused) {
    speechSynthesis.resume();
    tts.paused = false;
    actualizarBotonesTTS();
    return;
  }
  if (tts.speaking) return;

  const texto = readerContent.innerText.trim();
  if (!texto) return;

  speechSynthesis.cancel();
  tts.chunks = prepararTextoParaTTS(texto);
  tts.currentChunk = 0;
  tts.speaking = true;
  tts.paused = false;
  leerChunkActual();
  actualizarBotonesTTS();
}

function leerChunkActual() {
  if (tts.currentChunk >= tts.chunks.length) {
    tts.speaking = false;
    tts.paused = false;
    tts.currentChunk = 0;
    actualizarBotonesTTS();
    return;
  }
  const chunk = tts.chunks[tts.currentChunk];
  const utterance = new SpeechSynthesisUtterance(chunk);
  utterance.lang = "es-ES";
  utterance.rate = tts.rate;

  const vozEspanol = vocesDisponibles.find((v) => v.lang.startsWith("es"));
  if (vozEspanol) utterance.voice = vozEspanol;

  utterance.onend = () => {
    if (!tts.paused && tts.speaking) {
      tts.currentChunk++;
      leerChunkActual();
    }
  };
  utterance.onerror = (e) => {
    if (e.error === "canceled" || e.error === "interrupted") return;
    console.error("Error en TTS:", e);
    tts.speaking = false;
    actualizarBotonesTTS();
  };
  tts.utterance = utterance;
  speechSynthesis.speak(utterance);
}

function pausarTTS() {
  if (!tts.speaking || tts.paused) return;
  speechSynthesis.pause();
  tts.paused = true;
  actualizarBotonesTTS();
}

function detenerTTS() {
  speechSynthesis.cancel();
  tts.speaking = false;
  tts.paused = false;
  tts.currentChunk = 0;
  tts.chunks = [];
  actualizarBotonesTTS();
}

function actualizarBotonesTTS() {
  if (!ttsPlayBtn) return;
  const txtPlay = ttsPlayBtn.querySelector(".tts-btn__text");
  if (tts.speaking && !tts.paused) {
    ttsPlayBtn.hidden = true;
    ttsPauseBtn.hidden = false;
    ttsStopBtn.hidden = false;
  } else if (tts.speaking && tts.paused) {
    ttsPlayBtn.hidden = false;
    txtPlay.textContent = "Reanudar";
    ttsPauseBtn.hidden = true;
    ttsStopBtn.hidden = false;
  } else {
    ttsPlayBtn.hidden = false;
    txtPlay.textContent = "Escuchar";
    ttsPauseBtn.hidden = true;
    ttsStopBtn.hidden = true;
  }
}

if (ttsPlayBtn) {
  ttsPlayBtn.addEventListener("click", iniciarTTS);
  ttsPauseBtn.addEventListener("click", pausarTTS);
  ttsStopBtn.addEventListener("click", detenerTTS);
  ttsSpeedSelect.addEventListener("change", () => {
    tts.rate = parseFloat(ttsSpeedSelect.value);
    if (tts.speaking && !tts.paused) {
      const chunkActual = tts.currentChunk;
      speechSynthesis.cancel();
      tts.currentChunk = chunkActual;
      setTimeout(leerChunkActual, 100);
    }
  });
}