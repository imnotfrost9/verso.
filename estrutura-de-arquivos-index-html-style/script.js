// Set the absolute URL after deploying api/legendas.js to Vercel.
const CAPTIONS_API_URL = "";
const CAPTIONS_STORAGE_PREFIX = "verso-captions-v1:";
const THEME_STORAGE_KEY = "verso-theme";
const $ = (id) => document.getElementById(id);

const state = {
  videoId: "",
  player: null,
  playerReady: false,
  pendingVideoId: "",
  playerInitializing: false,
  ignoreNextPause: false,
  captions: [],
  delay: 0,
  timer: null,
  game: createGameState(),
  theme: "dark"
};

function createGameState() {
  return {
    index: 0,
    completed: new Set(),
    skipped: new Set(),
    correctCharacters: 0,
    totalKeys: 0,
    firstKeyAt: null,
    startedAt: null,
    userPaused: false,
    linePaused: false,
    playing: false,
    finished: false,
    pendingKey: null
  };
}

function setMessage(id, text, type = "") {
  const message = $(id);
  message.textContent = text;
  message.className = `inline-message ${type}`.trim();
}

// Player
function extractVideoId(value) {
  const input = value.trim();
  if (/^[\w-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) return "";
    if (url.searchParams.has("v")) return url.searchParams.get("v") || "";
    const parts = url.pathname.split("/").filter(Boolean);
    return ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] || "" : "";
  } catch {
    return "";
  }
}

function loadVideo(videoId) {
  state.videoId = videoId;
  state.captions = [];
  state.delay = 0;
  state.game = createGameState();
  $("video-status").classList.remove("error");
  $("video-status").textContent = "Carregando o vídeo…";
  $("player-wrap").classList.remove("hidden");
  $("captions-panel").classList.remove("hidden");
  $("preview").classList.add("hidden");
  $("game-panel").classList.add("hidden");
  $("game-result").classList.add("hidden");
  $("game-play").classList.remove("hidden");
  $("start-playback").disabled = true;

  if (state.player) {
    if (state.playerReady) {
      state.ignoreNextPause = true;
      state.player.loadVideoById(videoId);
      state.player.pauseVideo();
      $("video-status").textContent = "Vídeo carregado · carregue as legendas para começar.";
    }
    else state.pendingVideoId = videoId;
  } else {
    createYouTubePlayer(videoId);
  }
  restoreCaptions();
}

function createYouTubePlayer(videoId) {
  if (!window.YT?.Player) {
    state.pendingVideoId = videoId;
    if (!state.playerInitializing) {
      state.playerInitializing = true;
      window.setTimeout(() => {
        state.playerInitializing = false;
        createYouTubePlayer(state.pendingVideoId || videoId);
      }, 100);
    }
    return;
  }

  state.playerInitializing = false;
  const initialVideoId = state.pendingVideoId || videoId;
  state.pendingVideoId = "";
  state.player = new YT.Player("player", {
    videoId: initialVideoId,
    playerVars: { playsinline: 1, rel: 0 },
    events: {
      onReady() {
        state.playerReady = true;
        $("video-status").textContent = "Vídeo carregado · carregue as legendas para começar.";
        if (state.pendingVideoId) {
          state.ignoreNextPause = true;
          state.player.loadVideoById(state.pendingVideoId);
          state.player.pauseVideo();
          state.pendingVideoId = "";
        }
      },
      onStateChange(event) {
        if ((event.data === YT.PlayerState.CUED || event.data === YT.PlayerState.PAUSED) && !state.game.startedAt) {
          $("video-status").textContent = "Vídeo carregado · carregue as legendas para começar.";
        }
        state.game.playing = event.data === YT.PlayerState.PLAYING;
        if (event.data === YT.PlayerState.PLAYING) state.game.userPaused = false;
        if (event.data === YT.PlayerState.PAUSED && state.ignoreNextPause) {
          state.ignoreNextPause = false;
        } else if (event.data === YT.PlayerState.PAUSED && state.game.startedAt && !state.game.linePaused && !state.game.finished) {
          state.game.userPaused = true;
        }
        updatePlayButton();
      },
      onError() {
        $("video-status").textContent = "Não foi possível reproduzir este vídeo. Confira o link ou escolha outro.";
        $("video-status").classList.add("error");
      }
    }
  });
}
function handleVideoSubmit(event) {
  event.preventDefault();
  const videoId = extractVideoId($("video-url").value);
  if (!/^[\w-]{11}$/.test(videoId)) {
    $("video-status").textContent = "Não reconhecemos o link. Cole um link ou ID válido do YouTube.";
    $("video-status").classList.add("error");
    return;
  }
  loadVideo(videoId);
}

// Captions
function secondsFromTime(value) {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

function parseLrc(text) {
  const rows = [];
  for (const sourceLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const timestamps = [...sourceLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!timestamps.length) continue;

    const lyric = sourceLine
      .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, "")
      .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .trim();

    for (const stamp of timestamps) {
      const fraction = stamp[3] ? Number(`0.${stamp[3]}`) : 0;
      rows.push({ inicio: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction, duracao: 0, texto: lyric });
    }
  }
  return rows;
}

function isCueTiming(line) {
  return /(?:^|\s)(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/.test(line);
}

function parseSubtitles(text) {
  const source = text.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lrcRows = parseLrc(source);
  if (lrcRows.length) return lrcRows;

  const lines = source.split("\n");
  const rows = [];
  let index = 0;
  while (index < lines.length) {
    const timing = lines[index].match(/(?:^|\s)(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/);
    if (!timing) {
      index += 1;
      continue;
    }

    const start = secondsFromTime(timing[1]);
    const end = secondsFromTime(timing[2]);
    const textLines = [];
    index += 1;
    while (index < lines.length) {
      const current = lines[index].trim();
      const next = lines[index + 1]?.trim() || "";
      if (!current) {
        index += 1;
        break;
      }
      if (isCueTiming(current)) break;
      if (/^\d+$/.test(current) && isCueTiming(next)) {
        index += 1;
        break;
      }
      if (/^(?:WEBVTT|NOTE(?:\s|$))/i.test(current)) {
        index += 1;
        break;
      }
      textLines.push(current);
      index += 1;
    }

    const lyric = textLines.join(" ").replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      rows.push({ inicio: start, duracao: end - start, texto: lyric });
    }
  }
  return rows;
}
function cleanCaptionText(value, options) {
  let text = String(value ?? "")
    .replace(/\[music\]|\[música\]/gi, " ")
    .replace(/♪/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:\[[^\]]*\]|\([^)]*\))$/.test(text)) return "";
  if (options.removeParentheticals) text = text.replace(/\([^)]*\)/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  let text = String(value);
  if ($("ignore-case").checked) text = text.toLocaleLowerCase();
  if ($("ignore-accents").checked) text = text.normalize("NFD").replace(/\p{M}/gu, "");
  if ($("ignore-punctuation").checked) text = text.replace(/\p{P}/gu, "");
  return Array.from(text);
}

function removeAutomaticDuplicates(rows) {
  const output = [];
  for (const row of rows) {
    const previous = output.at(-1);
    if (!previous) {
      output.push(row);
      continue;
    }

    const timeGap = row.inicio - previous.inicio;
    if (row.texto.toLocaleLowerCase() === previous.texto.toLocaleLowerCase() && timeGap <= Math.max(3, previous.duracao)) {
      previous.duracao = Math.max(previous.duracao, row.duracao);
      continue;
    }

    const previousWords = previous.texto.split(/\s+/);
    const currentWords = row.texto.split(/\s+/);
    const normalizeWord = (word) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    let overlap = Math.min(previousWords.length, currentWords.length);
    while (overlap > 0 && !previousWords.slice(-overlap).every((word, wordIndex) => normalizeWord(word) === normalizeWord(currentWords[wordIndex]))) overlap -= 1;

    if (timeGap >= 0 && timeGap <= Math.max(2, previous.duracao + 0.5) && overlap > 0) {
      previous.texto = [...previousWords, ...currentWords.slice(overlap)].join(" ").trim();
      previous.duracao = Math.max(previous.duracao, row.inicio + row.duracao - previous.inicio);
      continue;
    }
    output.push(row);
  }
  return output;
}

function prepareCaptions(rawRows, rawTranslations = [], options = {}) {
  const cleanOptions = { removeParentheticals: options.removeParentheticals || false };
  let rows = rawRows
    .map((row) => ({
      inicio: Number(row.inicio ?? row.offset ?? row.start),
      duracao: Number(row.duracao ?? row.duration ?? 0),
      texto: cleanCaptionText(row.texto ?? row.text, cleanOptions)
    }))
    .filter((row) => Number.isFinite(row.inicio) && row.inicio >= 0 && Number.isFinite(row.duracao) && row.texto)
    .sort((left, right) => left.inicio - right.inicio);

  if (options.mergeDuplicates) rows = removeAutomaticDuplicates(rows);

  const translations = rawTranslations
    .map((row) => ({ inicio: Number(row.inicio ?? row.offset ?? row.start), texto: cleanCaptionText(row.texto ?? row.text, cleanOptions) }))
    .filter((row) => Number.isFinite(row.inicio) && row.inicio >= 0 && row.texto)
    .sort((left, right) => left.inicio - right.inicio);

  rows = rows.map((row) => {
    const translation = translations
      .map((candidate) => ({ candidate, distance: Math.abs(candidate.inicio - row.inicio) }))
      .filter((entry) => entry.distance <= 1.5)
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;
    return { ...row, traducao: translation?.texto || "" };
  });

  return recalculateLineLimits(rows);
}

function recalculateLineLimits(rows) {
  return rows.map((line, index) => ({
    ...line,
    limite: rows[index + 1]?.inicio ?? Infinity
  }));
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function saveCaptions() {
  try {
    localStorage.setItem(CAPTIONS_STORAGE_PREFIX + state.videoId, JSON.stringify({ lines: state.captions, delay: state.delay }));
  } catch {
    setMessage("import-message", "As legendas estão carregadas, mas o navegador não permitiu salvá-las.", "error");
  }
}

function restoreCaptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(CAPTIONS_STORAGE_PREFIX + state.videoId) || "null");
    if (!Array.isArray(saved?.lines) || !saved.lines.length) return;
    state.captions = recalculateLineLimits(saved.lines.map((line) => ({ ...line, traducao: line.traducao || "" })));
    state.delay = Number(saved.delay) || 0;
    renderPreview();
    $("preview").classList.remove("hidden");
    $("start-playback").disabled = false;
    $("change-captions").classList.remove("hidden");
    setMessage("auto-message", "Legendas salvas para este vídeo. Você pode começar ou trocá-las.", "success");
  } catch {
    try {
      localStorage.removeItem(CAPTIONS_STORAGE_PREFIX + state.videoId);
    } catch {
      // Armazenamento pode estar bloqueado pelo navegador.
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function renderPreview() {
  $("line-count").textContent = state.captions.length;
  $("preview-lines").innerHTML = state.captions.slice(0, 5).map((line) => `
    <div class="preview-line"><span class="preview-time">${formatClock(line.inicio + state.delay)}</span>
    <span class="preview-text">${escapeHtml(line.texto)}${line.traducao ? `<small>${escapeHtml(line.traducao)}</small>` : ""}</span></div>
  `).join("") + (state.captions.length > 5 ? `<div class="more-lines">+ ${state.captions.length - 5} outras linhas</div>` : "");
  $("delay-value").textContent = `${state.delay.toFixed(1).replace(".", ",")} s`;
}

function displayPreparedCaptions(rows, source, translations = []) {
  const options = {
    mergeDuplicates: source === "automatic" || $("clean-auto").checked,
    removeParentheticals: $("remove-parentheticals").checked
  };
  const prepared = prepareCaptions(rows, translations, options);
  if (!prepared.length) {
    const target = source === "automatic" ? "auto-message" : "import-message";
    setMessage(target, "Não encontramos linhas com texto e tempo depois da limpeza.", "error");
    return false;
  }

  state.captions = prepared;
  renderPreview();
  $("preview").classList.remove("hidden");
  $("change-captions").classList.remove("hidden");
  $("start-playback").disabled = false;
  saveCaptions();
  const target = source === "automatic" ? "auto-message" : "import-message";
  setMessage(target, `${prepared.length} linhas carregadas. Confira a prévia e ajuste o atraso se precisar.`, "success");
  return true;
}

function switchCaptionTab(tab) {
  const automatic = tab === "auto";
  $("tab-auto").classList.toggle("active", automatic);
  $("tab-auto").setAttribute("aria-selected", String(automatic));
  $("tab-import").classList.toggle("active", !automatic);
  $("tab-import").setAttribute("aria-selected", String(!automatic));
  $("auto-panel").classList.toggle("hidden", !automatic);
  $("import-panel").classList.toggle("hidden", automatic);
}

async function requestAutomaticCaptions() {
  if (!CAPTIONS_API_URL) {
    setMessage("auto-message", "Busca automática indisponível: configure CAPTIONS_API_URL no topo de script.js. Você ainda pode importar ou colar legendas.", "error");
    return;
  }

  const button = $("fetch-captions");
  button.disabled = true;
  button.firstElementChild.textContent = "Buscando…";
  setMessage("auto-message", "Consultando as legendas disponíveis…");
  try {
    const response = await fetch(CAPTIONS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId: state.videoId,
        idioma: $("language").value,
        idiomaTraducao: $("translation-language").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível buscar as legendas.");
    const rows = Array.isArray(data) ? data : data.legendas;
    if (!Array.isArray(rows)) throw new Error("A função retornou um formato de legenda inesperado.");
    const loaded = displayPreparedCaptions(rows, "automatic", data.traducao || []);
    if (loaded && data.avisoTraducao) {
      setMessage("auto-message", `Legendas carregadas. ${data.avisoTraducao}`, "success");
    }
  } catch (error) {
    setMessage("auto-message", `${error.message || "Falha ao buscar legendas."} Você pode importar um arquivo .LRC, .SRT ou .VTT.`, "error");
  } finally {
    button.disabled = false;
    button.firstElementChild.textContent = "Buscar legendas";
  }
}

async function readCaptionFile(file) {
  const text = await file.text();
  if (text.includes("\uFFFD")) throw new Error("O arquivo contém caracteres inválidos; ele provavelmente não está codificado em UTF-8.");
  return text;
}

async function prepareImportedCaptions() {
  const pasted = $("caption-text").value.trim();
  const mainFile = $("caption-file").files[0];
  const translationFile = $("translation-file").files[0];
  if (!pasted && !mainFile) {
    setMessage("import-message", "Escolha um arquivo ou cole o conteúdo das legendas.", "error");
    return;
  }

  try {
    const sourceText = pasted || await readCaptionFile(mainFile);
    if (sourceText.includes("\uFFFD")) throw new Error("O texto contém caracteres inválidos; o arquivo provavelmente não está em UTF-8.");
    const translationText = translationFile ? await readCaptionFile(translationFile) : "";
    const rows = parseSubtitles(sourceText);
    if (!rows.length) {
      setMessage("import-message", "A legenda precisa ter marcações de tempo válidas no formato .LRC, .SRT ou .VTT.", "error");
      return;
    }
    const translations = translationText ? parseSubtitles(translationText) : [];
    if (translationText && !translations.length) {
      setMessage("import-message", "A legenda principal foi lida, mas a tradução não contém marcações de tempo reconhecíveis.", "error");
      return;
    }
    state.delay = 0;
    displayPreparedCaptions(rows, "import", translations);
  } catch (error) {
    setMessage("import-message", error.message || "Não foi possível ler o arquivo em UTF-8.", "error");
  }
}

function applyDelay(amount) {
  state.delay = Math.round((state.delay + amount) * 10) / 10;
  renderPreview();
  saveCaptions();
}

// Game
function lineStart(index) {
  return Math.max(0, state.captions[index].inicio + state.delay);
}

function linePlaybackLimit(index) {
  const nextLine = state.captions[index + 1];
  if (nextLine) return Math.max(0, nextLine.inicio + state.delay);
  if (!state.playerReady) return Infinity;
  const duration = state.player.getDuration();
  return Number.isFinite(duration) && duration > 0 ? duration : Infinity;
}

function currentLineComplete() {
  const expected = normalizeComparable(state.captions[state.game.index].texto).join("");
  const typed = normalizeComparable($("game-input").value).join("");
  return typed === expected;
}

function renderCurrentLine() {
  const line = state.captions[state.game.index];
  if (!line) return;

  const expected = Array.from(line.texto);
  const typed = normalizeComparable($("game-input").value);
  let requiredIndex = 0;
  const characters = expected.map((character) => {
    const ignored = $("ignore-punctuation").checked && /\p{P}/u.test(character);
    if (ignored) return { character, status: "ignored" };
    const expectedCharacter = normalizeComparable(character)[0] ?? "";
    const typedCharacter = typed[requiredIndex];
    const status = typedCharacter === undefined ? "pending" : typedCharacter === expectedCharacter ? "correct" : "wrong";
    requiredIndex += 1;
    return { character, status };
  });
  let cursorIndex = characters.findIndex((character) => character.status === "wrong");
  if (cursorIndex < 0) cursorIndex = characters.findIndex((character) => character.status === "pending");

  $("current-line").innerHTML = characters.map(({ character, status }, index) =>
    `<span class="char ${status}${index === cursorIndex ? " cursor" : ""}">${escapeHtml(character)}</span>`
  ).join("");
  $("line-translation").textContent = line.traducao || "";
  $("line-translation").classList.toggle("hidden", !line.traducao);
  $("line-position").textContent = String(state.game.index + 1).padStart(2, "0");
  updateGameStats();
  updateControlAvailability();
}
function startGame() {
  if (!state.captions.length) return;
  if (!state.playerReady) {
    switchCaptionTab("auto");
    $("captions-panel").classList.remove("hidden");
    setMessage("auto-message", "Aguarde o vídeo carregar antes de começar.", "error");
    return;
  }
  state.game = createGameState();
  state.game.startedAt = performance.now();
  $("captions-panel").classList.add("hidden");
  $("game-panel").classList.remove("hidden");
  $("game-result").classList.add("hidden");
  $("game-play").classList.remove("hidden");
  $("game-input").value = "";
  renderCurrentLine();
  if (state.playerReady) {
    state.player.seekTo(Math.max(0, lineStart(0) - 1), true);
    state.player.playVideo();
    state.game.userPaused = false;
  }
  if (!state.timer) state.timer = window.setInterval(tickGame, 50);
  window.setTimeout(() => $("game-input").focus(), 0);
}

function resetGame() {
  if (!state.captions.length) return;
  startGame();
}

function advanceLine() {
  state.game.completed.add(state.game.index);
  const wasLinePaused = state.game.linePaused;
  state.game.linePaused = false;
  state.game.index += 1;
  if (state.game.index >= state.captions.length) {
    showGameResult();
    return;
  }

  $("game-input").value = "";
  renderCurrentLine();
  $("game-input").focus();
  if (wasLinePaused && !state.game.userPaused && state.playerReady) state.player.playVideo();
}

function handleGameInput() {
  if (state.game.finished || !state.captions[state.game.index]) return;
  const pending = state.game.pendingKey;
  if (pending) {
    const before = pending.before;
    const after = normalizeComparable($("game-input").value);
    const expected = normalizeComparable(state.captions[state.game.index].texto);
    if (pending.key !== "Backspace" && after.length > before.length) {
      const insertedIndex = Math.min(before.length, after.length - 1);
      if (after[insertedIndex] === expected[insertedIndex]) state.game.correctCharacters += 1;
    }
    state.game.pendingKey = null;
  }

  renderCurrentLine();
  if (currentLineComplete()) advanceLine();
}

function handleGameKeydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || state.game.finished) return;
  if (event.key.length !== 1 && event.key !== "Backspace") return;

  if (state.game.firstKeyAt === null) state.game.firstKeyAt = performance.now();
  state.game.totalKeys += 1;
  state.game.pendingKey = {
    key: event.key,
    before: normalizeComparable($("game-input").value)
  };
}

function seekToLine(index, resume) {
  if (!state.playerReady) return;
  state.game.linePaused = false;
  state.player.seekTo(lineStart(index), true);
  if (resume) state.player.playVideo();
}

function goToPreviousLine() {
  if (state.game.index <= 0 || state.game.finished) return;
  const target = state.game.index - 1;
  state.game.completed.delete(target);
  state.game.skipped.delete(target);
  state.game.index = target;
  $("game-input").value = "";
  renderCurrentLine();
  seekToLine(target, state.game.playing && !state.game.userPaused);
  $("game-input").focus();
}

function skipCurrentLine() {
  if (state.game.finished) return;
  state.game.skipped.add(state.game.index);
  const target = state.game.index + 1;
  if (target >= state.captions.length) {
    showGameResult();
    return;
  }
  state.game.index = target;
  $("game-input").value = "";
  renderCurrentLine();
  const resume = (state.game.playing || state.game.linePaused) && !state.game.userPaused;
  seekToLine(target, resume);
  $("game-input").focus();
}

function toggleVideoPlayback() {
  if (!state.playerReady) return;
  if (state.game.playing) {
    state.game.userPaused = true;
    state.game.linePaused = false;
    state.player.pauseVideo();
  } else {
    state.game.userPaused = false;
    state.game.linePaused = false;
    state.player.playVideo();
  }
}

function tickGame() {
  if (state.game.finished || !state.game.startedAt || !state.playerReady || !state.game.playing) return;
  const currentTime = state.player.getCurrentTime();
  const limit = linePlaybackLimit(state.game.index);
  if (!currentLineComplete() && currentTime >= limit - 0.15) {
    state.game.linePaused = true;
    state.player.pauseVideo();
  }
  updateGameStats();
}

function finishTypingCurrentLine() {
  if (currentLineComplete()) advanceLine();
}

// Statistics
function updateGameStats() {
  const total = state.captions.length;
  const line = Math.min(state.game.index + 1, total);
  const progress = total ? line / total * 100 : 0;
  $("progress-label").textContent = `${line} / ${total}`;
  $("progress-bar").style.width = `${Math.min(100, progress)}%`;

  const now = performance.now();
  const typingMinutes = state.game.firstKeyAt === null ? 0 : Math.max(0.001, (now - state.game.firstKeyAt) / 60000);
  const wpm = state.game.firstKeyAt === null ? 0 : Math.round(state.game.correctCharacters / 5 / typingMinutes);
  const accuracy = state.game.totalKeys ? Math.round(state.game.correctCharacters / state.game.totalKeys * 100) : 100;
  $("wpm-stat").textContent = wpm;
  $("accuracy-stat").textContent = `${accuracy}%`;
}

function showGameResult() {
  state.game.finished = true;
  state.game.playing = false;
  if (state.playerReady) state.player.pauseVideo();
  $("game-play").classList.add("hidden");
  $("game-result").classList.remove("hidden");

  const now = performance.now();
  const elapsed = state.game.startedAt ? (now - state.game.startedAt) / 1000 : 0;
  const typingMinutes = state.game.firstKeyAt === null ? 0 : Math.max(0.001, (now - state.game.firstKeyAt) / 60000);
  const wpm = state.game.firstKeyAt === null ? 0 : Math.round(state.game.correctCharacters / 5 / typingMinutes);
  const accuracy = state.game.totalKeys ? Math.round(state.game.correctCharacters / state.game.totalKeys * 100) : 100;

  $("result-wpm").textContent = wpm;
  $("result-accuracy").textContent = `${accuracy}%`;
  $("result-time").textContent = formatClock(elapsed);
  $("result-completed").textContent = state.game.completed.size;
  $("result-skipped").textContent = state.game.skipped.size;
}

function updatePlayButton() {
  const button = $("play-toggle");
  button.textContent = state.game.playing ? "Ⅱ" : "▶";
  button.setAttribute("aria-label", state.game.playing ? "Pausar vídeo" : "Reproduzir vídeo");
}

function updateControlAvailability() {
  $("previous-line").disabled = state.game.index <= 0;
}

// Theme
function setTheme(theme, persist = true) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content = state.theme === "light" ? "#f3f5ee" : "#101510";
  $("theme-label").textContent = state.theme === "light" ? "Tema escuro" : "Tema claro";
  $("theme-toggle").setAttribute("aria-label", state.theme === "light" ? "Ativar tema escuro" : "Ativar tema claro");
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, state.theme);
    } catch {
      // A troca de tema permanece ativa mesmo sem armazenamento disponível.
    }
  }
}

function initializeTheme() {
  let saved = "";
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY) || "";
  } catch {
    saved = "";
  }
  const preferred = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  setTheme(saved || preferred, false);
}

// Interface
function showImportOptions() {
  $("game-panel").classList.add("hidden");
  $("captions-panel").classList.remove("hidden");
  $("preview").classList.remove("hidden");
  switchCaptionTab("import");
}

function chooseOtherVideo() {
  $("game-panel").classList.add("hidden");
  $("captions-panel").classList.add("hidden");
  $("video-url").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function handleFileDrop(event) {
  event.preventDefault();
  $("dropzone").classList.remove("dragging");
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $("caption-file").files = transfer.files;
  readCaptionFile(file)
    .then((text) => {
      $("caption-text").value = text;
      setMessage("import-message", `${file.name} carregado. Pressione “Preparar prévia”.`);
      switchCaptionTab("import");
    })
    .catch((error) => setMessage("import-message", error.message, "error"));
}

function bindInterface() {
  $("video-form").addEventListener("submit", handleVideoSubmit);
  $("tab-auto").addEventListener("click", () => switchCaptionTab("auto"));
  $("tab-import").addEventListener("click", () => switchCaptionTab("import"));
  $("fetch-captions").addEventListener("click", requestAutomaticCaptions);
  $("prepare-import").addEventListener("click", prepareImportedCaptions);
  $("delay-minus").addEventListener("click", () => applyDelay(-0.5));
  $("delay-plus").addEventListener("click", () => applyDelay(0.5));
  $("start-playback").addEventListener("click", startGame);
  $("restart-game").addEventListener("click", resetGame);
  $("previous-line").addEventListener("click", goToPreviousLine);
  $("skip-line").addEventListener("click", skipCurrentLine);
  $("play-toggle").addEventListener("click", toggleVideoPlayback);
  $("change-captions").addEventListener("click", showImportOptions);
  $("try-again").addEventListener("click", resetGame);
  $("choose-other").addEventListener("click", chooseOtherVideo);
  $("theme-toggle").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  $("game-input").addEventListener("keydown", handleGameKeydown);
  $("game-input").addEventListener("input", handleGameInput);
  $("game-input").addEventListener("paste", (event) => event.preventDefault());
  $("game-input").addEventListener("drop", (event) => event.preventDefault());
  $("game-input").addEventListener("beforeinput", (event) => {
    if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") event.preventDefault();
  });

  $("caption-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      $("caption-text").value = await readCaptionFile(file);
      setMessage("import-message", `${file.name} carregado. Pressione “Preparar prévia”.`);
      switchCaptionTab("import");
    } catch (error) {
      setMessage("import-message", error.message, "error");
    }
  });
  $("translation-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) setMessage("import-message", `Tradução selecionada: ${file.name}. Associação por tempo (até 1,5 s).`);
  });

  const dropzone = $("dropzone");
  ["dragenter", "dragover"].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  }));
  dropzone.addEventListener("drop", handleFileDrop);

  ["ignore-case", "ignore-accents", "ignore-punctuation"].forEach((id) => {
    $(id).addEventListener("change", () => {
      renderCurrentLine();
      finishTypingCurrentLine();
    });
  });
}

initializeTheme();
bindInterface();















