(function () {
  const STATE_KEY = "codenames-pad-v1";
  const PACK_KEY = "codenames-packs-v1";
  let state = null;
  let packs = [];
  let editingPackId = null;
  let formatTouched = false;
  let postTimer = 0;
  let toastTimer = 0;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function toast(message, danger) {
    const el = document.getElementById("toast");
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("is-danger", !!danger);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3400);
  }

  function loadPacks() {
    try {
      packs = JSON.parse(localStorage.getItem(PACK_KEY) || "[]");
    } catch (err) {
      packs = [];
    }
    if (!Array.isArray(packs)) packs = [];
  }

  function savePacks() {
    localStorage.setItem(PACK_KEY, JSON.stringify(packs));
  }

  let folderPacks = [];

    function allPacks() {
      return [CN_WORDS.builtin].concat(folderPacks, packs);
    }

  function packById(id) {
    return allPacks().find((pack) => pack.id === id) || CN_WORDS.builtin;
  }

  function fillPackSelect(select, selected) {
    if (!select) return;
    const current = selected || select.value || "builtin";
    select.innerHTML = allPacks().map((pack) => {
      const n = (pack.words || []).length;
      return "<option value=\"" + esc(pack.id) + "\">" + esc(pack.name) + " (" + n + ")</option>";
    }).join("");
    select.value = packById(current).id;
  }

  function publish() {
    if (!state) {
      localStorage.removeItem(STATE_KEY);
    } else {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }
    clearTimeout(postTimer);
    postTimer = setTimeout(() => {
      fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state || {}),
      }).catch(() => {});
    }, 40);
  }

  function snapshot() {
    if (!state) return;
    state.history = state.history || [];
    state.history.push(JSON.parse(JSON.stringify({
      matches: state.matches,
      game: state.game,
      currentMatchId: state.currentMatchId,
      recentWords: state.recentWords,
    })));
    if (state.history.length > 40) state.history.shift();
  }

  function teamName(id) {
    if (!id) return "";
    if (state && state.game && state.game.names && state.game.names[id]) return state.game.names[id];
    const team = state && state.teams.find((item) => item.id === id);
    return team ? team.name : "";
  }

  function colorOf(game, teamId) {
    if (!game || teamId !== game.teamA && teamId !== game.teamB) return "";
    return teamId === game.startTeam ? "is-red" : "is-blue";
  }

  function roleClass(game, role) {
    if (role === "assassin") return "is-assassin";
    if (role === "neutral") return "is-neutral";
    if (role === game.startTeam) return "is-red";
    return "is-blue";
  }

  function reasonText(reason) {
    if (reason === "assassin") return "убийца";
    if (reason === "forfeit") return "отказ";
    if (reason === "bye") return "пропуск";
    if (reason === "agents") return "все агенты";
    return "";
  }

  function nextPending() {
    return (state.matches || []).find((match) => match.status === "pending" && match.b);
  }

  const TIMER_PRESETS = [
    { id: "90", label: "90 с + 60 с", defaultSec: 90, bonusSec: 60 },
    { id: "120", label: "2 мин + 80 с", defaultSec: 120, bonusSec: 80 },
    { id: "150", label: "2:30 + 90 с", defaultSec: 150, bonusSec: 90 },
    { id: "200", label: "3:20 + 100 с", defaultSec: 200, bonusSec: 100 },
    { id: "300", label: "5 мин + 2 мин", defaultSec: 300, bonusSec: 120 },
    { id: "480", label: "8 мин + 3 мин", defaultSec: 480, bonusSec: 180 },
  ];

  function clockText(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  function wordsRu(n) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return "слово";
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "слова";
    return "слов";
  }

  function ensureTimers() {
    if (!state) return;
    if (!state.timers) state.timers = {};
    const timers = state.timers;
    if (!timers.defaultSec) {
      timers.preset = "200";
      timers.defaultSec = 200;
      timers.bonusSec = 100;
    }
    if (timers.left == null) timers.left = 0;
    if (timers.running == null) timers.running = false;
  }

  function firstTurn(game) {
    return !(game.log || []).some((item) => item.type === "clue" || item.type === "turn");
  }

  function syncTimer(prevPhase) {
    ensureTimers();
    const game = state.game;
    if (!state.timers.enabled || !game || game.phase === "over") {
      state.timers.running = false;
      return;
    }
    if (game.phase === "clue" && prevPhase !== "clue") startTurnTimer(firstTurn(game));
  }

  function startTurnTimer(first) {
    const base = Number(state.timers.defaultSec) || 200;
    const bonus = first ? Number(state.timers.bonusSec) || 0 : 0;
    const sec = base + bonus;
    state.timers.left = sec;
    state.timers.endsAt = Date.now() + sec * 1000;
    state.timers.running = true;
    state.timers.first = !!first;
  }

  function tick() {
    if (!state || !state.timers || !state.timers.running) return;
    const left = Math.max(0, Math.ceil((state.timers.endsAt - Date.now()) / 1000));
    const clock = document.getElementById("clock");
    if (clock) {
      clock.textContent = clockText(left);
      clock.classList.toggle("is-danger", left <= 10);
    }
    if (left !== state.timers.left) {
      state.timers.left = left;
      if (left === 0) state.timers.running = false;
      publish();
    }
  }

  function render() {
    const setup = document.getElementById("setup");
    const play = document.getElementById("play");
    const live = !!(state && state.teams && state.teams.length >= 2);
    setup.hidden = live;
    play.hidden = !live;
    if (!live) {
      fillPackSelect(document.getElementById("pack"), document.getElementById("pack").value);
      refreshHint();
      return;
    }
    play.innerHTML = playHtml();
  }


  function cellTitle(game, cell) {
    if (cell.revealed) return "Уже открыто";
    if (cell.role === "assassin") return "Убийца. Клик закончит игру поражением";
    if (cell.role === "neutral") return "Мирный. Клик откроет слово и закончит ход";
    if (cell.role === game.startTeam) return "Агент начинающих. Клик откроет слово на зале";
    return "Агент вторых. Клик откроет слово на зале";
  }

  function playHtml() {
    const table = CN.standingsWithLive(state);
    const game = state.game;
    const rows = table.map((row) => {
      return "<tr class=\"" + (row.place <= 3 ? "is-" + row.place : "") + "\"><td>" + row.place + "</td><td>" + esc(row.name) + "</td><td>" + row.wins + "</td><td>" + row.margin + "</td><td>" + row.points + "</td></tr>";
    }).join("");
    const matches = (state.matches || []).map((match) => {
      const title = match.bye
        ? esc(teamName(match.a)) + " — пропуск"
        : esc(teamName(match.a)) + " — " + esc(teamName(match.b));
      let extra = "";
      if (match.status === "pending" && match.b) {
        extra = "<button type=\"button\" data-act=\"start\" data-id=\"" + esc(match.id) + "\" title=\"Начать этот бой. Ключ только на пульте\">Начать</button>";
      } else if (match.status === "live" || (game && state.currentMatchId === match.id && game.phase !== "over")) {
        extra = "идёт";
      } else if (match.status === "done" && match.winner) {
        extra = esc(teamName(match.winner)) + " · " + match.margin;
      }
      return "<div class=\"match\"><span>Тур " + match.round + " · " + title + "</span>" + extra + "</div>";
    }).join("");
    const options = state.teams.map((team) => "<option value=\"" + esc(team.id) + "\">" + esc(team.name) + "</option>").join("");
    const pending = nextPending();
    let center = "";
    if (!game) {
      center = "<h2>Поле</h2><p class=\"note\">" + (pending
        ? "Следующий бой: " + esc(teamName(pending.a)) + " — " + esc(teamName(pending.b))
        : "Нет назначенного боя.") + "</p>" +
        (pending ? "<button type=\"button\" class=\"primary\" data-act=\"start\" data-id=\"" + esc(pending.id) + "\" title=\"Начать следующий бой. Ключ только на пульте\">Начать бой</button>" : "");
    } else {
      const aLeft = CN.remaining(game, game.teamA);
      const bLeft = CN.remaining(game, game.teamB);
      const aTotal = game.cells.filter((cell) => cell.role === game.teamA).length;
      const bTotal = game.cells.filter((cell) => cell.role === game.teamB).length;
      const cells = game.cells.map((cell, index) => {
        return "<button type=\"button\" data-act=\"reveal\" data-i=\"" + index + "\" class=\"" + roleClass(game, cell.role) + (cell.revealed ? " is-open" : "") + "\" title=\"" + esc(cellTitle(game, cell)) + "\">" + esc(cell.word) + "</button>";
      }).join("");
      const guessedNow = game.clue ? game.clue.guessesMade : 0;
      const clueLine = game.clue
        ? esc(game.clue.text) + " · " + esc(game.clue.countLabel)
        : (game.phase === "penalty" ? "Штраф: соперник может открыть своего" : "Ждём подсказку");
      const over = game.phase === "over"
        ? "<p class=\"note\"><b>" + esc(teamName(game.winner)) + "</b> — победа (" + esc(reasonText(game.winReason)) + "), запас " + CN.gameMargin(game) + "</p><button type=\"button\" data-act=\"table\" title=\"Показать таблицу на зале\">Таблица на зал</button>"
        : "";
      center = "<div class=\"key-head\">" +
        pill(game, game.teamA, aLeft, aTotal) +
        "<div class=\"turn-chip\"><span>Отгадано за ход</span><b>" + guessedNow + "</b><span>" + wordsRu(guessedNow) + "</span></div>" +
        pill(game, game.teamB, bLeft, bTotal) +
        "</div><div class=\"key\">" + cells + "</div><p class=\"note\">" + clueLine + "</p>" + over +
        "<p class=\"legend\"><span><i class=\"swatch\" style=\"background:#d1262c\"></i>9</span><span><i class=\"swatch\" style=\"background:#1d4ed8\"></i>8</span><span><i class=\"swatch\" style=\"background:#e6c48a\"></i>мирные</span><span><i class=\"swatch\" style=\"background:#07080c;border:1px solid #ff2a2a\"></i>убийца</span></p>";
    }
    const swissBtn = state.format === "swiss"
      ? "<button type=\"button\" data-act=\"swiss\" title=\"Составить пары следующего тура по текущему счёту\">Следующий тур</button>"
      : "";
    const pin = state.hallPin === "table" ? "Поле на зал" : "Таблица на зал";
    return "<div class=\"col\"><h2>Таблица</h2><table class=\"grid\"><thead><tr><th>#</th><th>Команда</th><th>Поб.</th><th>Запас</th><th>Счёт</th></tr></thead><tbody>" + rows + "</tbody></table><h2>Бои</h2>" + matches + "</div>" +
      "<div class=\"col field\">" + center + "</div>" +
      "<div class=\"col side-col\"><h2>Ход</h2>" + controlsHtml(options, pin, swissBtn) + "</div>";
  }

  function pill(game, teamId, left, total) {
    const turn = game.turn === teamId && game.phase !== "over" ? " is-turn" : "";
    return "<div class=\"side-pill " + colorOf(game, teamId) + turn + "\"><span>" + esc(teamName(teamId)) + "</span><b>" + left + "</b><span>из " + total + "</span></div>";
  }

  function journalHtml(game) {
    if (!game) return "<p class=\"note\">Появится в бою.</p>";
    const items = (game.log || []).filter((item) => item.type !== "turn" && item.type !== "start");
    if (!items.length) return "<p class=\"note\">Пока пусто.</p>";
    return "<ol class=\"journal\">" + items.map((item) => {
      if (item.type === "clue") return "<li><b>" + esc(teamName(item.team)) + "</b> " + esc(item.text) + " · " + esc(item.countLabel) + "</li>";
      if (item.type === "guess") return "<li>открыто " + esc(item.word) + "</li>";
      if (item.type === "pass") return "<li>пас</li>";
      if (item.type === "invalid") return "<li>неверная подсказка</li>";
      if (item.type === "penalty") return "<li>штраф: " + esc(item.word) + "</li>";
      return "";
    }).join("") + "</ol>";
  }

  function controlsHtml(options, pin, swissBtn) {
    ensureTimers();
    const timers = state.timers;
    const game = state.game;
    const danger = timers.enabled && timers.left <= 10;
    const clock = timers.enabled
      ? "<div id=\"clock\" class=\"clock" + (danger ? " is-danger" : "") + "\">" + clockText(timers.left) + "</div>"
      : "<div id=\"clock\" class=\"clock\" hidden>0:00</div>";
    const preset = timers.preset || "200";
    const presetHtml = TIMER_PRESETS.map((item) => {
      return "<option value=\"" + item.id + "\"" + (item.id === preset ? " selected" : "") + ">" + esc(item.label) + "</option>";
    }).join("");
    const names = game ? "<button type=\"button\" class=\"is-danger\" data-act=\"forfeit\" data-id=\"" + esc(game.teamA) + "\" title=\"Засчитать поражение: " + esc(teamName(game.teamA)) + "\">Поражение: " + esc(teamName(game.teamA)) + "</button><button type=\"button\" class=\"is-danger\" data-act=\"forfeit\" data-id=\"" + esc(game.teamB) + "\" title=\"Засчитать поражение: " + esc(teamName(game.teamB)) + "\">Поражение: " + esc(teamName(game.teamB)) + "</button>" : "";
    return clock +
      "<form id=\"clueForm\"><label>Подсказка<input id=\"clueText\" type=\"text\" autocomplete=\"off\" placeholder=\"одно слово\"></label><label>Число<select id=\"clueNum\">" + numOptions() + "</select></label><button type=\"submit\" class=\"primary\" title=\"Показать подсказку на зале. Если она сомнительная, программа спросит\">На зал</button></form>" +
      "<div class=\"row\"><button type=\"button\" data-act=\"pass\" title=\"Закончить угадывание и передать ход. Нужна хотя бы одна попытка\">Хватит</button><button type=\"button\" data-act=\"force-pass\" title=\"Передать ход, даже если попыток ещё не было\">Пас без попытки</button></div>" +
      "<div class=\"row\"><button type=\"button\" data-act=\"invalid\" title=\"Ход сгорает. Соперник может открыть одного своего агента\">Неверная подсказка</button><button type=\"button\" data-act=\"skip-penalty\" title=\"Соперник отказывается от штрафного открытия\">Без штрафа</button></div>" +
      "<div class=\"row\">" + names + "</div>" +
      "<label class=\"check\"><input id=\"timerOn\" type=\"checkbox\"" + (timers.enabled ? " checked" : "") + "> Таймер на ход</label>" +
      "<label>Первый ход длиннее<select id=\"timerPreset\">" + presetHtml + "</select></label>" +
      "<p class=\"note\">Время не заканчивает ход само.</p>" +
      "<h2>Журнал</h2>" + journalHtml(game) +
      "<label>Набор на следующий бой<select id=\"livePack\">" + allPacks().map((pack) => "<option value=\"" + esc(pack.id) + "\"" + (pack.id === state.packId ? " selected" : "") + ">" + esc(pack.name) + "</option>").join("") + "</select></label>" +
      "<div class=\"row\"><button type=\"button\" data-act=\"pin\" title=\"Показать таблицу или вернуть поле на зал\">" + pin + "</button>" + swissBtn + "</div>" +
      "<h2>Дополнительный бой</h2><label>Первые<select id=\"extraA\">" + options + "</select></label><label>Вторые<select id=\"extraB\">" + options + "</select></label><button type=\"button\" data-act=\"extra\" title=\"Добавить ещё один бой этих двух команд\">Назначить</button>" +
      "<div class=\"row\"><button type=\"button\" data-act=\"packs\" title=\"Создать или изменить набор слов\">Наборы</button><button type=\"button\" class=\"is-danger\" data-act=\"reset\" title=\"Сбросить таблицу и бои. Наборы слов останутся\">Новый турнир</button></div>";
  }

  function numOptions() {
    let html = "";
    for (let n = 1; n <= 9; n += 1) html += "<option value=\"" + n + "\">" + n + "</option>";
    html += "<option value=\"0\">0 — без лимита</option><option value=\"inf\">∞ — без лимита</option>";
    return html;
  }

  function refreshHint() {
    const lines = document.getElementById("teams").value.split("\n");
    const count = CN.cleanTeams(lines).length;
    if (!formatTouched && count >= 2) {
      document.getElementById("format").value = CN.suggestedFormat(count);
      if (!document.getElementById("rounds").dataset.touched) {
        document.getElementById("rounds").value = String(CN.suggestedSwissRounds(count));
      }
    }
    const format = document.getElementById("format").value;
    const rounds = Number(document.getElementById("rounds").value) || 3;
    const hint = document.getElementById("formatHint");
    document.getElementById("rounds").closest("label").hidden = format !== "swiss";
    if (count < 2) {
      hint.textContent = "Нужны минимум две команды.";
      return;
    }
    if (format === "robin") {
      const games = CN.robinGameCount(count);
      hint.textContent = "Круговая: " + games + " боёв. " + (games > 10 ? "На одном зале это долго — лучше швейцарская." : "Все играют со всеми по одному разу.");
    } else if (format === "swiss") {
      hint.textContent = "Швейцарская: " + rounds + " тура, около " + (Math.floor(count / 2) * rounds) + " боёв. В туре играют близкие по счёту.";
    } else {
      hint.textContent = "Свободные пары: кто выходит к полю, решаете вы.";
    }
  }

  function wordsOfCurrentPack() {
    const pack = packById(state.packId || "builtin");
    return pack.words || [];
  }

  function afterChange(prevPhase) {
    syncTimer(prevPhase);
    publish();
    render();
  }

  function beginMatch(id) {
    if (state.game && state.game.phase === "over") CN.commitGame(state);
    if (state.game && state.game.phase !== "over") {
      toast("Сначала закончите текущий бой", true);
      return;
    }
    const result = CN.startMatch(state, id, wordsOfCurrentPack());
    if (!result.ok) {
      toast(result.error, true);
      return;
    }
    state.hallPin = "auto";
    afterChange("over");
  }

  function onPlayClick(event) {
    const btn = event.target.closest("[data-act]");
    if (!btn || !state) return;
    const act = btn.dataset.act;
    const prev = state.game ? state.game.phase : "";
    if (act === "start") {
      beginMatch(btn.dataset.id);
      return;
    }
    if (act === "reveal") {
      if (!state.game) return;
      const index = Number(btn.dataset.i);
      const cell = state.game.cells[index];
      if (cell && !cell.revealed && cell.role === "assassin") {
        if (!window.confirm("Это убийца. Открыть и закончить игру?")) return;
      }
      snapshot();
      const result = CN.reveal(state.game, index);
      if (!result.ok) {
        state.history.pop();
        toast(result.error, true);
        return;
      }
      afterChange(prev);
      return;
    }
    if (act === "pass" || act === "force-pass") {
      if (!state.game) return;
      snapshot();
      const result = CN.passTurn(state.game, act === "force-pass");
      if (!result.ok) {
        state.history.pop();
        toast(result.error, true);
        return;
      }
      afterChange(prev);
      return;
    }
    if (act === "invalid") {
      if (!state.game) return;
      snapshot();
      const result = CN.invalidClue(state.game);
      if (!result.ok) {
        state.history.pop();
        toast(result.error, true);
        return;
      }
      afterChange(prev);
      return;
    }
    if (act === "skip-penalty") {
      if (!state.game) return;
      snapshot();
      const result = CN.skipPenalty(state.game);
      if (!result.ok) {
        state.history.pop();
        toast(result.error, true);
        return;
      }
      afterChange(prev);
      return;
    }
    if (act === "forfeit") {
      if (!state.game) return;
      if (!window.confirm("Засчитать поражение команде " + teamName(btn.dataset.id) + "?")) return;
      snapshot();
      const result = CN.forfeit(state.game, btn.dataset.id);
      if (!result.ok) {
        state.history.pop();
        toast(result.error, true);
        return;
      }
      afterChange(prev);
      return;
    }
    if (act === "pin") {
      state.hallPin = state.hallPin === "table" ? "auto" : "table";
      publish();
      render();
      return;
    }
    if (act === "table") {
      state.hallPin = "table";
      publish();
      render();
      return;
    }
    if (act === "swiss") {
      if (state.game && state.game.phase === "over") CN.commitGame(state);
      const result = CN.nextSwiss(state);
      if (!result.ok) {
        toast(result.error, true);
        return;
      }
      publish();
      render();
      toast("Тур " + result.round);
      return;
    }
    if (act === "extra") {
      const result = CN.addFreeMatch(state, document.getElementById("extraA").value, document.getElementById("extraB").value);
      if (!result.ok) {
        toast(result.error, true);
        return;
      }
      publish();
      render();
      return;
    }
    if (act === "packs") {
      openPackEditor(state.packId);
      return;
    }
    if (act === "reset") {
      if (!window.confirm("Сбросить турнир? Наборы слов останутся.")) return;
      state = null;
      publish();
      render();
    }
  }

  function submitClue(event) {
    event.preventDefault();
    if (!state || !state.game) {
      toast("Сначала начните бой", true);
      return;
    }
    const text = document.getElementById("clueText").value;
    const count = document.getElementById("clueNum").value;
    const warnings = CN.clueWarnings(state.game, text);
    if (warnings.length && !window.confirm("Сомнительная подсказка: " + warnings.join(", ") + ". Всё равно на зал?")) return;
    const prev = state.game.phase;
    snapshot();
    const result = CN.giveClue(state.game, text, count);
    if (!result.ok) {
      state.history.pop();
      toast(result.error, true);
      return;
    }
    afterChange(prev);
  }

  function openPackEditor(id) {
    const pack = packById(id || document.getElementById("pack").value);
    editingPackId = pack.builtin ? null : pack.id;
    document.getElementById("packName").value = pack.builtin ? "" : pack.name;
    document.getElementById("packWords").value = (pack.words || []).join("\n");
    updatePackCount();
    document.getElementById("packDlg").showModal();
  }

  function updatePackCount() {
    const words = parseWords(document.getElementById("packWords").value);
    document.getElementById("packCount").textContent = words.length + " слов. Для игры нужно минимум 25.";
  }

  function parseWords(text) {
      const out = [];
      const seen = new Set();
      String(text || "").split(/[\n,;]+/).forEach((line) => {
        const word = CN_WORDS.clean(line);
        if (word.length < 2 || word.length > 24 || seen.has(word)) return;
        seen.add(word);
        out.push(word);
      });
      return out;
    }

  function savePack() {
    const name = document.getElementById("packName").value.trim() || "Свой набор";
    const words = parseWords(document.getElementById("packWords").value);
    if (words.length < 25) {
      toast("Нужно минимум 25 слов", true);
      return;
    }
    if (editingPackId) {
      const pack = packs.find((item) => item.id === editingPackId);
      if (pack) {
        pack.name = name;
        pack.words = words;
      }
    } else {
      const pack = { id: CN.uid("pack"), name: name, words: words };
      packs.push(pack);
      editingPackId = pack.id;
    }
    savePacks();
    fillPackSelect(document.getElementById("pack"), editingPackId);
    if (state) {
      state.packId = editingPackId;
      publish();
    }
    toast("Набор сохранён");
    document.getElementById("packDlg").close();
  }

  function deletePack() {
    if (!editingPackId) {
      toast("Встроенный набор не удаляется", true);
      return;
    }
    packs = packs.filter((pack) => pack.id !== editingPackId);
    savePacks();
    fillPackSelect(document.getElementById("pack"), "builtin");
    if (state && state.packId === editingPackId) state.packId = "builtin";
    editingPackId = null;
    publish();
    document.getElementById("packDlg").close();
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.txt,application/json,text/plain";
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        input.remove();
        resolve(file || null);
      });
      input.click();
    });
  }

  async function loadFile() {
    const file = await pickFile();
    if (!file) return;
    const text = await file.text();
    let words = [];
    let name = file.name.replace(/\.(json|txt)$/i, "");
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) words = data;
      else if (data && Array.isArray(data.words)) {
        words = data.words;
        if (data.name) name = data.name;
      }
    } catch (err) {
      words = [text];
    }
    const cleaned = parseWords(words.join("\n"));
    if (cleaned.length < 25) {
      toast("В файле меньше 25 слов", true);
      return;
    }
    const pack = { id: CN.uid("pack"), name: name || "Свой набор", words: cleaned };
    packs.push(pack);
    savePacks();
    fillPackSelect(document.getElementById("pack"), pack.id);
    if (state) {
      state.packId = pack.id;
      publish();
      render();
    }
    toast("Загружен набор «" + pack.name + "»");
  }

  function exportPack() {
    const id = state && state.packId ? state.packId : document.getElementById("pack").value;
    const pack = packById(id);
    const blob = new Blob([JSON.stringify({ name: pack.name, words: pack.words }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = (pack.name || "words") + ".json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function buildTournament() {
    const created = CN.createTournament({
      lines: document.getElementById("teams").value.split("\n"),
      format: document.getElementById("format").value,
      swissRounds: Number(document.getElementById("rounds").value),
      packId: document.getElementById("pack").value,
    });
    if (!created.ok) {
      toast(created.error, true);
      return;
    }
    state = created.tournament;
    publish();
    render();
  }

  function bind() {
    document.getElementById("teams").addEventListener("input", refreshHint);
    document.getElementById("format").addEventListener("change", () => {
      formatTouched = true;
      refreshHint();
    });
    document.getElementById("rounds").addEventListener("input", () => {
      document.getElementById("rounds").dataset.touched = "1";
      refreshHint();
    });
    document.getElementById("build").addEventListener("click", buildTournament);
    document.getElementById("packEdit").addEventListener("click", () => openPackEditor());
    document.getElementById("packLoad").addEventListener("click", loadFile);
    document.getElementById("packExport").addEventListener("click", exportPack);
    document.getElementById("packWords").addEventListener("input", updatePackCount);
    document.getElementById("packSave").addEventListener("click", savePack);
    document.getElementById("packDelete").addEventListener("click", deletePack);
    document.getElementById("hallBtn").addEventListener("click", async () => {
      try {
        const info = await fetch("/api/hall", { cache: "no-store" }).then((res) => res.json());
        if (!info.ok) toast(info.error || "Зал не открылся", true);
        else toast("Зал на мониторе " + ((info.monitor || 0) + 1) + ". Ещё раз — другой монитор.");
      } catch (err) {
        toast("Нет связи с программой", true);
      }
    });
    document.getElementById("undoBtn").addEventListener("click", () => {
      if (!state) return;
      const result = CN.undo(state);
      if (!result.ok) {
        toast(result.error, true);
        return;
      }
      publish();
      render();
    });
    const play = document.getElementById("play");
    play.addEventListener("click", onPlayClick);
    play.addEventListener("submit", (event) => {
      if (event.target && event.target.id === "clueForm") submitClue(event);
    });
    play.addEventListener("change", (event) => {
      if (!state) return;
      if (event.target.id === "livePack") {
        state.packId = event.target.value;
        publish();
      }
      if (event.target.id === "timerOn") {
              ensureTimers();
              state.timers.enabled = event.target.checked;
              if (!state.timers.enabled) state.timers.running = false;
              else if (state.game && state.game.phase === "clue") startTurnTimer(firstTurn(state.game));
              else if (state.game && state.game.phase === "guess") startTurnTimer(false);
              publish();
              render();
            }
            if (event.target.id === "timerPreset") {
              ensureTimers();
              const preset = TIMER_PRESETS.find((item) => item.id === event.target.value);
              if (preset) {
                state.timers.preset = preset.id;
                state.timers.defaultSec = preset.defaultSec;
                state.timers.bonusSec = preset.bonusSec;
              }
              publish();
            }
    });
    setInterval(tick, 250);
  }

  async function loadFolderPacks() {
    try {
      const data = await fetch("/api/word-packs", { cache: "no-store" }).then((res) => res.json());
      folderPacks = Array.isArray(data.packs) ? data.packs : [];
    } catch (err) {
      folderPacks = [];
    }
    const select = document.getElementById("pack");
    if (select) fillPackSelect(select, state && state.packId);
    if (state) render();
  }

  loadPacks();
  try {
    state = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
  } catch (err) {
    state = null;
  }
  if (state && (!state.teams || state.teams.length < 2)) state = null;
  bind();
  loadFolderPacks();
  fillPackSelect(document.getElementById("pack"));
  render();
  if (state) publish();
})();
