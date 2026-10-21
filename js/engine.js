/* Codenames venue engine: one board, sequential matches. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CN = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BYE_MARGIN = 4;

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function rng() {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const s = seed == null ? (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0 : seed >>> 0;
    return mulberry32(s || 1);
  }

  function shuffle(list, rng) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function other(game, teamId) {
    return teamId === game.teamA ? game.teamB : game.teamA;
  }

  function remaining(game, teamId) {
    return game.cells.filter((cell) => cell.role === teamId && !cell.revealed).length;
  }

  function finishIfAgents(game) {
    const sides = [game.teamA, game.teamB];
    for (let i = 0; i < sides.length; i += 1) {
      if (remaining(game, sides[i]) === 0) {
        game.phase = "over";
        game.winner = sides[i];
        game.winReason = "agents";
        game.clue = null;
        game.penaltySide = null;
        return true;
      }
    }
    return false;
  }

  function endTurn(game) {
    game.turn = other(game, game.turn);
    game.phase = "clue";
    game.clue = null;
    game.log.push({ type: "turn", team: game.turn });
  }

  function cleanTeams(lines) {
    const names = [];
    const seen = new Set();
    (lines || []).forEach((raw) => {
      const name = String(raw || "").trim().replace(/\s+/g, " ");
      if (!name) return;
      const key = name.toLocaleLowerCase("ru");
      if (seen.has(key)) return;
      seen.add(key);
      names.push(name);
    });
    return names.map((name, index) => ({ id: "t" + (index + 1), name: name }));
  }

  function pairKey(a, b) {
    return a < b ? a + "|" + b : b + "|" + a;
  }

  function matchShell(round, a, b) {
    return {
      id: uid("m"),
      round: round,
      a: a,
      b: b,
      bye: !b,
      status: b ? "pending" : "done",
      winner: b ? null : a,
      margin: b ? 0 : BYE_MARGIN,
      reason: b ? null : "bye",
      startTeam: null,
    };
  }

  function robinMatches(teams) {
    const list = teams.map((team) => team.id);
    if (list.length % 2 === 1) list.push(null);
    const n = list.length;
    const rounds = n - 1;
    const half = n / 2;
    const arr = list.slice();
    const matches = [];
    for (let r = 0; r < rounds; r += 1) {
      for (let i = 0; i < half; i += 1) {
        matches.push(matchShell(r + 1, arr[i], arr[n - 1 - i]));
      }
      const fixed = arr[0];
      const rest = arr.slice(1);
      rest.unshift(rest.pop());
      arr.length = 0;
      arr.push(fixed);
      rest.forEach((id) => arr.push(id));
    }
    return matches.filter((match) => match.a || match.b).map((match) => {
      if (!match.a && match.b) {
        match.a = match.b;
        match.b = null;
        match.bye = true;
        match.status = "done";
        match.winner = match.a;
        match.margin = BYE_MARGIN;
        match.reason = "bye";
      }
      return match;
    });
  }

  function startCounts(matches) {
    const starts = {};
    (matches || []).forEach((match) => {
      if (!match.startTeam) return;
      starts[match.startTeam] = (starts[match.startTeam] || 0) + 1;
    });
    return starts;
  }

  function pickStart(matches, a, b, rng) {
    const starts = startCounts(matches);
    const sa = starts[a] || 0;
    const sb = starts[b] || 0;
    if (sa < sb) return a;
    if (sb < sa) return b;
    return rng() < 0.5 ? a : b;
  }

  function drawWords(packWords, recent, rng) {
    const recentSet = new Set((recent || []).map((word) => String(word).toLocaleUpperCase("ru")));
    const fresh = packWords.filter((word) => !recentSet.has(word));
    const pool = fresh.length >= 25 ? fresh : packWords.slice();
    if (pool.length < 25) {
      return { ok: false, error: "В наборе меньше 25 слов" };
    }
    return { ok: true, words: shuffle(pool, rng).slice(0, 25) };
  }

  function newGame(opts) {
    const teamA = opts.teamA;
    const teamB = opts.teamB;
    const rng = opts.rng || makeRng(opts.seed);
    const drawn = drawWords(opts.words, opts.recent, rng);
    if (!drawn.ok) return drawn;
    const start = opts.startTeam || pickStart(opts.priorMatches || [], teamA.id, teamB.id, rng);
    const second = start === teamA.id ? teamB.id : teamA.id;
    const roles = [];
    for (let i = 0; i < 9; i += 1) roles.push(start);
    for (let i = 0; i < 8; i += 1) roles.push(second);
    for (let i = 0; i < 7; i += 1) roles.push("neutral");
    roles.push("assassin");
    const placed = shuffle(roles, rng);
    const names = {};
    names[teamA.id] = teamA.name;
    names[teamB.id] = teamB.name;
    return {
      ok: true,
      game: {
        teamA: teamA.id,
        teamB: teamB.id,
        names: names,
        startTeam: start,
        turn: start,
        phase: "clue",
        penaltySide: null,
        cells: drawn.words.map((word, index) => ({
          word: word,
          role: placed[index],
          revealed: false,
        })),
        clue: null,
        winner: null,
        winReason: null,
        loser: null,
        log: [{ type: "start", team: start }],
      },
    };
  }

  function visibleWords(game) {
    return game.cells.filter((cell) => !cell.revealed).map((cell) => cell.word.toLocaleLowerCase("ru"));
  }

  function clueWarnings(game, text) {
    const word = String(text || "").trim().replace(/\s+/g, " ");
    const warnings = [];
    if (!word || !game) return warnings;
    if (/\s/.test(word)) warnings.push("несколько слов");
    if (/\d/.test(word)) warnings.push("есть цифра");
    if (/[^0-9a-zA-Zа-яА-ЯёЁ\s-]/.test(word)) warnings.push("не только буквы");
    const low = word.toLocaleLowerCase("ru");
    const visible = visibleWords(game);
    if (visible.indexOf(low) !== -1 || low.split(/\s+/).some((part) => visible.indexOf(part) !== -1)) {
      warnings.push("такое слово ещё на поле");
    }
    return warnings;
  }

  function giveClue(game, text, count) {
    if (!game || game.phase === "over") return { ok: false, error: "Игра окончена" };
    if (game.phase === "penalty") return { ok: false, error: "Сначала штраф или отказ от него" };
    if (game.phase !== "clue") return { ok: false, error: "Сейчас не подсказка" };
    const word = String(text || "").trim().replace(/\s+/g, " ");
    if (!word) return { ok: false, error: "Пустая подсказка" };
    let maxGuesses = 25;
    let countLabel = "∞";
    let stored = "inf";
    if (count !== "inf" && count !== "unlimited") {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 0 || n > 9) {
        return { ok: false, error: "Число от 0 до 9 или без лимита" };
      }
      stored = n;
      countLabel = String(n);
      maxGuesses = n === 0 ? 25 : n + 1;
    }
    game.clue = {
      text: word,
      count: stored,
      countLabel: countLabel,
      guessesMade: 0,
      maxGuesses: maxGuesses,
    };
    game.phase = "guess";
    game.log.push({ type: "clue", team: game.turn, text: word, countLabel: countLabel });
    return { ok: true };
  }

  function reveal(game, index) {
    if (!game) return { ok: false, error: "Нет игры" };
    const cell = game.cells[index];
    if (!cell) return { ok: false, error: "Нет клетки" };
    if (cell.revealed) return { ok: false, error: "Уже открыто" };
    if (game.phase === "over") return { ok: false, error: "Игра окончена" };

    if (game.phase === "penalty") {
      if (cell.role !== game.penaltySide) {
        return { ok: false, error: "Штраф: только свой агент соперника" };
      }
      const side = game.penaltySide;
      cell.revealed = true;
      game.log.push({ type: "penalty", team: side, word: cell.word });
      game.penaltySide = null;
      if (finishIfAgents(game)) return { ok: true };
      game.phase = "clue";
      game.turn = side;
      game.clue = null;
      return { ok: true };
    }

    if (game.phase !== "guess") return { ok: false, error: "Сначала подсказка" };
    cell.revealed = true;
    game.clue.guessesMade += 1;
    game.log.push({ type: "guess", team: game.turn, word: cell.word, role: cell.role });

    if (cell.role === "assassin") {
      game.phase = "over";
      game.loser = game.turn;
      game.winner = other(game, game.turn);
      game.winReason = "assassin";
      game.clue = null;
      return { ok: true };
    }
    if (finishIfAgents(game)) return { ok: true };
    if (cell.role !== game.turn) {
      endTurn(game);
      return { ok: true };
    }
    if (game.clue && game.clue.guessesMade >= game.clue.maxGuesses) endTurn(game);
    return { ok: true };
  }

  function passTurn(game, force) {
    if (!game || game.phase !== "guess") return { ok: false, error: "Сейчас не угадывание" };
    if (!force && game.clue.guessesMade < 1) {
      return { ok: false, error: "Нужна хотя бы одна попытка" };
    }
    game.log.push({ type: "pass", team: game.turn, force: !!force });
    endTurn(game);
    return { ok: true };
  }

  function invalidClue(game) {
    if (!game || game.phase === "over") return { ok: false, error: "Игра окончена" };
    if (game.phase === "penalty") return { ok: false, error: "Штраф уже назначен" };
    const victim = other(game, game.turn);
    game.log.push({ type: "invalid", team: game.turn });
    game.clue = null;
    game.phase = "penalty";
    game.penaltySide = victim;
    game.turn = victim;
    return { ok: true };
  }

  function skipPenalty(game) {
    if (!game || game.phase !== "penalty") return { ok: false, error: "Нет штрафа" };
    const side = game.penaltySide;
    game.penaltySide = null;
    game.phase = "clue";
    game.turn = side;
    game.clue = null;
    return { ok: true };
  }

  function forfeit(game, loserId) {
    if (!game || game.phase === "over") return { ok: false, error: "Игра окончена" };
    if (loserId !== game.teamA && loserId !== game.teamB) return { ok: false, error: "Нет такой команды" };
    game.phase = "over";
    game.loser = loserId;
    game.winner = other(game, loserId);
    game.winReason = "forfeit";
    game.clue = null;
    game.penaltySide = null;
    return { ok: true };
  }

  function gameMargin(game) {
    if (!game || !game.winner) return 0;
    const loser = other(game, game.winner);
    if (game.counts && game.counts[loser] && game.counts[loser].left != null) {
      return game.counts[loser].left;
    }
    return remaining(game, loser);
  }

  function nameOf(teams, id) {
    const team = (teams || []).find((item) => item.id === id);
    return team ? team.name : "";
  }

  function standings(teams, matches) {
    const rows = (teams || []).map((team) => ({
      id: team.id,
      name: team.name,
      played: 0,
      wins: 0,
      losses: 0,
      byes: 0,
      margin: 0,
      points: 0,
    }));
    const byId = {};
    rows.forEach((row) => {
      byId[row.id] = row;
    });
    (matches || []).forEach((match) => {
      if (match.status !== "done" || !match.winner || !byId[match.winner]) return;
      if (match.bye) {
        byId[match.winner].byes += 1;
        byId[match.winner].wins += 1;
        byId[match.winner].margin += match.margin || BYE_MARGIN;
        return;
      }
      const loserId = match.winner === match.a ? match.b : match.a;
      byId[match.winner].wins += 1;
      byId[match.winner].played += 1;
      byId[match.winner].margin += match.margin || 0;
      if (byId[loserId]) {
        byId[loserId].losses += 1;
        byId[loserId].played += 1;
      }
    });
    rows.forEach((row) => {
      row.points = row.wins * 10 + row.margin;
    });
    rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.margin !== a.margin) return b.margin - a.margin;
      if (a.losses !== b.losses) return a.losses - b.losses;
      return a.name.localeCompare(b.name, "ru");
    });
    for (let i = 0; i < rows.length - 1; i += 1) {
      const left = rows[i];
      const right = rows[i + 1];
      if (left.points !== right.points || left.margin !== right.margin) continue;
      const met = (matches || []).find((match) => {
        if (match.status !== "done" || match.bye) return false;
        return (match.a === left.id && match.b === right.id) || (match.a === right.id && match.b === left.id);
      });
      if (met && met.winner === right.id) {
        rows[i] = right;
        rows[i + 1] = left;
      }
    }
    rows.forEach((row, index) => {
      row.place = index + 1;
    });
    return rows;
  }

  function playedSet(matches) {
    const played = new Set();
    const hadBye = new Set();
    (matches || []).forEach((match) => {
      if (match.bye && match.winner) hadBye.add(match.winner);
      if (match.a && match.b) played.add(pairKey(match.a, match.b));
    });
    return { played: played, hadBye: hadBye };
  }

  function swissRound(teams, matches, roundNumber, rng) {
    const table = standings(teams, matches);
    let pool = table.map((row) => row.id);
    if (roundNumber <= 1) pool = shuffle(pool, rng || makeRng());
    const info = playedSet(matches);
    const out = [];
    if (pool.length % 2 === 1) {
      let byeAt = -1;
      for (let i = pool.length - 1; i >= 0; i -= 1) {
        if (!info.hadBye.has(pool[i])) {
          byeAt = i;
          break;
        }
      }
      if (byeAt < 0) byeAt = pool.length - 1;
      const byeId = pool.splice(byeAt, 1)[0];
      out.push(matchShell(roundNumber, byeId, null));
    }
    const unpaired = new Set(pool);
    while (unpaired.size) {
      let a = null;
      for (let i = 0; i < pool.length; i += 1) {
        if (unpaired.has(pool[i])) {
          a = pool[i];
          break;
        }
      }
      if (!a) break;
      unpaired.delete(a);
      let partner = null;
      for (let i = 0; i < pool.length; i += 1) {
        const id = pool[i];
        if (!unpaired.has(id)) continue;
        if (!info.played.has(pairKey(a, id))) {
          partner = id;
          break;
        }
      }
      if (!partner) {
        for (let i = 0; i < pool.length; i += 1) {
          if (unpaired.has(pool[i])) {
            partner = pool[i];
            break;
          }
        }
      }
      if (!partner) break;
      unpaired.delete(partner);
      info.played.add(pairKey(a, partner));
      out.push(matchShell(roundNumber, a, partner));
    }
    return out;
  }

  function suggestedFormat(count) {
    return count <= 6 ? "robin" : "swiss";
  }

  function suggestedSwissRounds(count) {
    if (count <= 8) return 3;
    if (count <= 16) return 4;
    return 5;
  }

  function robinGameCount(count) {
    return (count * (count - 1)) / 2;
  }

  function createTournament(opts) {
    const teams = cleanTeams(opts.lines);
    if (teams.length < 2) return { ok: false, error: "Нужны минимум две команды" };
    const format = opts.format || suggestedFormat(teams.length);
    const swissRounds = Math.max(1, Number(opts.swissRounds) || suggestedSwissRounds(teams.length));
    const rng = makeRng(opts.seed);
    let matches = [];
    if (format === "robin") matches = robinMatches(teams);
    else if (format === "swiss") matches = swissRound(teams, [], 1, rng);
    return {
      ok: true,
      tournament: {
        v: 1,
        teams: teams,
        format: format,
        swissRounds: swissRounds,
        matches: matches,
        game: null,
        currentMatchId: null,
        hallPin: "auto",
        packId: opts.packId || "builtin",
        timers: {
          enabled: false,
          preset: "200",
          defaultSec: 200,
          bonusSec: 100,
          running: false,
          left: 0,
          first: false,
        },
        recentWords: [],
        history: [],
      },
    };
  }

  function teamById(tournament, id) {
    return tournament.teams.find((team) => team.id === id) || null;
  }

  function pushHistory(tournament) {
    const snap = JSON.parse(JSON.stringify({
      matches: tournament.matches,
      game: tournament.game,
      currentMatchId: tournament.currentMatchId,
      recentWords: tournament.recentWords,
    }));
    tournament.history.push(snap);
    if (tournament.history.length > 40) tournament.history.shift();
  }

  function startMatch(tournament, matchId, words, seed) {
    const match = tournament.matches.find((item) => item.id === matchId);
    if (!match) return { ok: false, error: "Бой не найден" };
    if (match.bye) return { ok: false, error: "Это пропуск" };
    if (match.status === "done") return { ok: false, error: "Бой уже сыгран" };
    const teamA = teamById(tournament, match.a);
    const teamB = teamById(tournament, match.b);
    if (!teamA || !teamB) return { ok: false, error: "Нет команды" };
    const rng = makeRng(seed);
    const startTeam = pickStart(tournament.matches, teamA.id, teamB.id, rng);
    const built = newGame({
      teamA: teamA,
      teamB: teamB,
      words: words,
      recent: tournament.recentWords,
      startTeam: startTeam,
      priorMatches: tournament.matches,
      rng: rng,
    });
    if (!built.ok) return built;
    pushHistory(tournament);
    match.status = "live";
    match.startTeam = built.game.startTeam;
    match.winner = null;
    match.margin = 0;
    match.reason = null;
    tournament.currentMatchId = match.id;
    tournament.game = built.game;
    tournament.hallPin = "auto";
    return { ok: true };
  }

  function addFreeMatch(tournament, aId, bId) {
    if (!aId || !bId || aId === bId) return { ok: false, error: "Выберите две разные команды" };
    const round = tournament.matches.reduce((max, match) => Math.max(max, match.round || 0), 0) + 1;
    const match = matchShell(round, aId, bId);
    tournament.matches.push(match);
    return { ok: true, match: match };
  }

  function nextSwiss(tournament, seed) {
    if (tournament.format !== "swiss") return { ok: false, error: "Это не швейцарская" };
    const open = tournament.matches.some((match) => match.status === "pending" || match.status === "live");
    if (open) return { ok: false, error: "Сначала доиграйте текущий тур" };
    const round = tournament.matches.reduce((max, match) => Math.max(max, match.round || 0), 0);
    if (round >= tournament.swissRounds) return { ok: false, error: "Туры закончились" };
    const more = swissRound(tournament.teams, tournament.matches, round + 1, makeRng(seed));
    more.forEach((match) => tournament.matches.push(match));
    return { ok: true, round: round + 1 };
  }

  function commitGame(tournament) {
    const game = tournament.game;
    const match = tournament.matches.find((item) => item.id === tournament.currentMatchId);
    if (!game || !match || game.phase !== "over" || !game.winner) {
      return { ok: false, error: "Игра не закончена" };
    }
    match.status = "done";
    match.winner = game.winner;
    match.margin = gameMargin(game);
    match.reason = game.winReason;
    match.startTeam = game.startTeam;
    game.cells.forEach((cell) => tournament.recentWords.push(cell.word));
    if (tournament.recentWords.length > 200) {
      tournament.recentWords = tournament.recentWords.slice(-200);
    }
    return { ok: true, margin: match.margin };
  }

  function undo(tournament) {
    const snap = tournament.history.pop();
    if (!snap) return { ok: false, error: "Нечего отменять" };
    tournament.matches = snap.matches;
    tournament.game = snap.game;
    tournament.currentMatchId = snap.currentMatchId;
    tournament.recentWords = snap.recentWords;
    return { ok: true };
  }

  function publicGame(game) {
    if (!game) return null;
    return {
      teamA: game.teamA,
      teamB: game.teamB,
      names: game.names,
      startTeam: game.startTeam,
      turn: game.turn,
      phase: game.phase,
      penaltySide: game.penaltySide,
      winner: game.winner,
      winReason: game.winReason,
      loser: game.loser,
      clue: game.clue ? {
        text: game.clue.text,
        count: game.clue.count,
        countLabel: game.clue.countLabel,
        guessesMade: game.clue.guessesMade,
        maxGuesses: game.clue.maxGuesses,
      } : null,
      cells: game.cells.map((cell) => ({
        word: cell.word,
        revealed: !!cell.revealed,
        role: cell.revealed ? cell.role : null,
      })),
    };
  }

  function standingsWithLive(tournament) {
  if (!tournament) return [];
  const matches = (tournament.matches || []).map((match) => Object.assign({}, match));
  const game = tournament.game;
  if (game && game.phase === "over" && game.winner && tournament.currentMatchId) {
    const live = matches.find((match) => match.id === tournament.currentMatchId);
    if (live && live.status !== "done") {
      live.status = "done";
      live.winner = game.winner;
      live.margin = gameMargin(game);
      live.reason = game.winReason;
    }
  }
  return standings(tournament.teams, matches);
}

function publicState(tournament) {
    if (!tournament) return null;
    return {
      v: tournament.v,
      teams: tournament.teams,
      format: tournament.format,
      swissRounds: tournament.swissRounds,
      matches: tournament.matches,
      currentMatchId: tournament.currentMatchId,
      hallPin: tournament.hallPin,
      timers: tournament.timers,
      game: publicGame(tournament.game),
      standings: standings(tournament.teams, tournament.matches),
    };
  }

  function guessesLeft(game) {
    if (!game || !game.clue || game.phase !== "guess") return null;
    if (game.clue.count === 0 || game.clue.count === "inf") return null;
    return Math.max(0, game.clue.maxGuesses - game.clue.guessesMade);
  }

  return {
    BYE_MARGIN: BYE_MARGIN,
    uid: uid,
    makeRng: makeRng,
    shuffle: shuffle,
    cleanTeams: cleanTeams,
    remaining: remaining,
    other: other,
    newGame: newGame,
    clueWarnings: clueWarnings,
    giveClue: giveClue,
    reveal: reveal,
    passTurn: passTurn,
    invalidClue: invalidClue,
    skipPenalty: skipPenalty,
    forfeit: forfeit,
    gameMargin: gameMargin,
    standings: standings,
    robinMatches: robinMatches,
    swissRound: swissRound,
    suggestedFormat: suggestedFormat,
    suggestedSwissRounds: suggestedSwissRounds,
    robinGameCount: robinGameCount,
    createTournament: createTournament,
    startMatch: startMatch,
    addFreeMatch: addFreeMatch,
    nextSwiss: nextSwiss,
    commitGame: commitGame,
    undo: undo,
    publicGame: publicGame,
    standingsWithLive: standingsWithLive,
    publicState: publicState,
    guessesLeft: guessesLeft,
    nameOf: nameOf,
    pickStart: pickStart,
  };
});
