(function () {
  let lastRaw = "";
  let lastReload = 0;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function teamName(st, id) {
    if (st.game && st.game.names && st.game.names[id]) return st.game.names[id];
    const team = (st.teams || []).find((item) => item.id === id);
    return team ? team.name : "";
  }

  function colorOf(game, teamId) {
    if (!game) return "";
    return teamId === game.startTeam ? "is-red" : "is-blue";
  }

  function modeOf(st) {
    if (!st || !st.teams || !st.teams.length) return "idle";
    if (st.hallPin === "table") return "table";
    if (st.game && st.game.phase !== "over") return "board";
    if (st.game && st.game.phase === "over") return "winner";
    return "table";
  }

  function nextPending(st) {
    return (st.matches || []).find((match) => match.status === "pending" && match.b);
  }

  function paintIdle() {
    return "<div class=\"center-show\"><h1 class=\"plaque\">КОДОВЫЕ ИМЕНА</h1><p class=\"idle-kicker\">Ожидание</p></div>";
  }

  function pluralWords(n) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return "слово";
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "слова";
    return "слов";
  }

  function clockText(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  function paintBoard(st) {
    const game = st.game;
    const counts = game.counts || {};
    const left = (id) => (counts[id] && counts[id].left != null ? counts[id].left : "");
    const total = (id) => (counts[id] && counts[id].total != null ? counts[id].total : "");
    const turnName = teamName(st, game.turn);
    const guessedNow = game.clue ? game.clue.guessesMade : 0;
    const cells = (game.cells || []).map((cell) => {
      const role = cell.revealed ? cell.role : null;
      let cls = "word";
      if ((cell.word || "").length > 10) cls += " is-long";
      if (role === "assassin") cls += " is-assassin";
      else if (role === "neutral") cls += " is-neutral";
      else if (role && role === game.startTeam) cls += " is-red";
      else if (role) cls += " is-blue";
      return "<div class=\"" + cls + "\">" + esc(cell.word) + "</div>";
    }).join("");
    let clue = "ПОДСКАЗКА";
        let tries = "ждём";
        const turnId = game.phase === "penalty" ? game.penaltySide : game.turn;
        if (game.phase === "penalty") {
          clue = "ШТРАФ";
          tries = "своего";
        } else if (game.clue) {
          clue = esc(game.clue.text) + " · " + esc(game.clue.countLabel);
          const limited = game.clue.count !== 0 && game.clue.count !== "inf";
          const leftGuess = limited ? Math.max(0, game.clue.maxGuesses - game.clue.guessesMade) : null;
          tries = leftGuess == null ? "без лимита" : "попыток " + leftGuess;
        }
        const clues = (game.log || []).filter((item) => item.type === "clue");
        const past = (game.phase === "guess" ? clues.slice(0, -1) : clues).slice(-4);
        const pastHtml = past.length
          ? "<div class=\"hall-foot\"><div class=\"past-clues\"><span>раньше</span>" + past.map((item) => "<b>" + esc(item.text) + " · " + esc(item.countLabel) + "</b>").join("") + "</div></div>"
          : "";
        const timers = st.timers || {};
        const clock = timers.enabled
          ? "<div class=\"hall-clock" + (timers.left <= 10 ? " is-danger" : "") + "\">" + clockText(timers.left) + "</div>"
          : "";
        const otherId = game.startTeam === game.teamA ? game.teamB : game.teamA;
        const turnClass = colorOf(game, turnId);
        return "<div class=\"hall-top\">" + scorebox(st, game, game.startTeam, left, total, turnId) +
          "<div class=\"info-row\">" +
          "<b class=\"team-now " + turnClass + "\">" + esc(teamName(st, turnId)) + "</b>" +
          "<b class=\"clue-now\">" + clue + "</b>" +
          "<span class=\"tries-now\">" + tries + "</span>" +
          clock +
          "</div>" +
          scorebox(st, game, otherId, left, total, turnId) +
          "</div><div class=\"board\">" + cells + "</div>" + pastHtml;
  }

  function scorebox(st, game, teamId, left, total, turn) {
      const on = turn === teamId && game.phase !== "over" ? " is-turn" : "";
      return "<div class=\"scorebox " + colorOf(game, teamId) + on + "\"><span>" + esc(teamName(st, teamId)) + "</span><b>" + left(teamId) + "</b></div>";
    }

  function paintWinner(st) {
    const game = st.game;
    const counts = game.counts || {};
    const loser = game.winner === game.teamA ? game.teamB : game.teamA;
    const margin = counts[loser] && counts[loser].left != null ? counts[loser].left : "";
    let why = "все агенты найдены";
    if (game.winReason === "assassin") why = "соперник открыл убийцу";
    if (game.winReason === "forfeit") why = "отказ";
    const pending = nextPending(st);
    const next = pending ? "<p class=\"next-line\">Дальше: " + esc(teamName(st, pending.a)) + " — " + esc(teamName(st, pending.b)) + "</p>" : "";
    return "<div class=\"center-show\"><h1 class=\"plaque\">ПОБЕДА</h1><div class=\"winner-name\">" + esc(teamName(st, game.winner)) + "</div><p class=\"next-line\">" + esc(why) + (margin === "" ? "" : " · запас " + margin) + "</p>" + next + "</div>";
  }

  function paintTable(st) {
    const rows = CN.standingsWithLive(st);
    const body = rows.map((row) => {
      const cls = row.place <= 3 ? " class=\"is-" + row.place + "\"" : "";
      return "<tr" + cls + "><td>" + row.place + "</td><td>" + esc(row.name) + "</td><td class=\"num\">" + row.wins + "</td><td class=\"num\">" + row.margin + "</td><td class=\"num\">" + row.points + "</td></tr>";
    }).join("");
    const pending = nextPending(st);
    const next = pending
      ? "<p class=\"next-line\">Следующий бой: " + esc(teamName(st, pending.a)) + " — " + esc(teamName(st, pending.b)) + "</p>"
      : "<p class=\"next-line\">Бои назначены ведущим</p>";
    return "<div class=\"hall-top\"><h1 class=\"plaque\">КОДОВЫЕ ИМЕНА</h1></div><div class=\"table-wrap\" id=\"tableWrap\"><table class=\"hall-table\" id=\"hallTable\"><thead><tr><th>#</th><th>Команда</th><th class=\"num\">Победы</th><th class=\"num\">Запас</th><th class=\"num\">Счёт</th></tr></thead><tbody>" + body + "</tbody></table></div>" + next;
  }

  function fitTable() {
    const wrap = document.getElementById("tableWrap");
    const table = document.getElementById("hallTable");
    if (!wrap || !table) return;
    let size = Math.min(48, window.innerHeight * 0.055);
    table.style.fontSize = size + "px";
    let guard = 0;
    while (size > 16 && table.getBoundingClientRect().height > wrap.clientHeight && guard < 40) {
      size -= 1;
      table.style.fontSize = size + "px";
      guard += 1;
    }
  }

  function paint(st) {
    const stage = document.getElementById("stage");
    const mode = modeOf(st);
    if (mode === "board") stage.innerHTML = paintBoard(st);
    else if (mode === "winner") stage.innerHTML = paintWinner(st);
    else if (mode === "table") stage.innerHTML = paintTable(st);
    else stage.innerHTML = paintIdle();
    if (mode === "table") fitTable();
  }

  async function poll() {
    try {
      const data = await fetch("/api/state", { cache: "no-store" }).then((res) => res.json());
      if (data.hallReload && data.hallReload !== lastReload) {
        if (lastReload) location.reload();
        lastReload = data.hallReload;
      }
      const raw = JSON.stringify(data.state || null);
      if (raw !== lastRaw) {
        lastRaw = raw;
        paint(data.state);
      }
    } catch (err) {
      /* keep the last frame */
    }
  }

  paint(null);
  poll();
  setInterval(poll, 300);
  window.addEventListener("resize", () => {
    if (document.getElementById("hallTable")) fitTable();
  });
})();
