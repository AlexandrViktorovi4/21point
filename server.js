const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3456;

function reply(ack, payload) {
  if (typeof ack === "function") ack(payload);
}
const WINS_TO_FINISH = 10;
const START_CHIPS = 100;
const MIN_BET = 5;
const DEFAULT_BET = 10;

const SUITS = [
  { symbol: "♠", color: "black" },
  { symbol: "♥", color: "red" },
  { symbol: "♦", color: "red" },
  { symbol: "♣", color: "black" },
];
// Классическое «21 очко»: K=4, Q=3, J=2, туз=11; два туза — золотое очко
const RANKS = [
  { label: "A", value: 11 },
  { label: "2", value: 2 },
  { label: "3", value: 3 },
  { label: "4", value: 4 },
  { label: "5", value: 5 },
  { label: "6", value: 6 },
  { label: "7", value: 7 },
  { label: "8", value: 8 },
  { label: "9", value: 9 },
  { label: "10", value: 10 },
  { label: "J", value: 2 },
  { label: "Q", value: 3 },
  { label: "K", value: 4 },
];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

/** @type {Map<string, object>} */
const rooms = new Map();
/** socketId -> roomCode */
const socketRoom = new Map();

function createDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({
        label: rank.label,
        value: rank.value,
        suit: suit.symbol,
        color: suit.color,
      });
    }
  }
  return shuffle(cards);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function handValue(cards) {
  let total = 0;
  for (const card of cards) total += card.value;
  return total;
}

/** Два туза — золотое очко (мгновенная победа). */
function isGoldenOchko(cards) {
  return cards.length === 2 && cards.every((c) => c.label === "A");
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? makeRoomCode() : code;
}

function draw(room) {
  if (room.deck.length === 0) room.deck = createDeck();
  return room.deck.pop();
}

function normalizeMode(mode) {
  return mode === "chips" ? "chips" : "wins";
}

function normalizeScoreMode(mode) {
  return mode === "manual" ? "manual" : "auto";
}

const AVATAR_IDS = new Set([
  "selfie",
  "hamster",
  "creeper",
  "apple",
  "mushroom",
  "parrot",
  "fish",
  "tiger",
  "lion1",
  "lion2",
  "blazer",
]);

function sanitizeAvatar(avatar) {
  const id = String(avatar || "").trim().toLowerCase();
  return AVATAR_IDS.has(id) ? id : "selfie";
}

function makePlayer(id, name, room, avatar) {
  return {
    id,
    name: sanitizeName(name),
    avatar: sanitizeAvatar(avatar),
    cards: [],
    status: "playing",
    connected: true,
    wins: 0,
    chips: room.mode === "chips" ? START_CHIPS : 0,
    bet: 0,
    betPlaced: false,
  };
}

function publicState(room, viewerId) {
  const revealAll = room.phase === "finished" || room.phase === "match_over";

  const autoScore = room.scoreMode !== "manual";

  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    mode: room.mode,
    scoreMode: room.scoreMode || "auto",
    winsToFinish: WINS_TO_FINISH,
    startChips: START_CHIPS,
    minBet: MIN_BET,
    defaultBet: DEFAULT_BET,
    phase: room.phase,
    current: room.current,
    youId: viewerId,
    pot: room.pot || 0,
    resultTitle: room.resultTitle || null,
    matchOver: room.phase === "match_over",
    players: room.players.map((p) => {
      const isSelf = p.id === viewerId;
      const showCards = revealAll || isSelf;

      // До вскрытия чужой перебор/золотое не светим — только «хватит»
      let status = p.status;
      let golden = isGoldenOchko(p.cards) || p.status === "golden";
      if (!showCards) {
        if (status === "bust" || status === "golden" || status === "stood") {
          status = "stood";
        }
        golden = false;
      }

      // Авто: очки во время игры. Вручную: только в итоге раздачи.
      let score = null;
      if (showCards && (autoScore || revealAll)) {
        score = handValue(p.cards);
      }

      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar || "selfie",
        status,
        connected: p.connected,
        wins: p.wins,
        chips: p.chips,
        bet: p.bet,
        betPlaced: p.betPlaced,
        score,
        golden,
        cardCount: p.cards.length,
        cards: showCards
          ? p.cards
          : p.cards.map(() => ({ hidden: true })),
        isWinner: Boolean(room.winners && room.winners.includes(p.id)),
        isMatchWinner: Boolean(room.matchWinners && room.matchWinners.includes(p.id)),
      };
    }),
  };
}

function emitRoom(room) {
  for (const player of room.players) {
    if (!player.connected) continue;
    io.to(player.id).emit("room:state", publicState(room, player.id));
  }
}

function findRoom(socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return null;
  return rooms.get(code) || null;
}

function resetMatchStats(room) {
  for (const player of room.players) {
    player.wins = 0;
    player.chips = room.mode === "chips" ? START_CHIPS : 0;
    player.bet = 0;
    player.betPlaced = false;
    player.cards = [];
    player.status = "playing";
  }
  room.pot = 0;
  room.winners = [];
  room.matchWinners = [];
  room.resultTitle = null;
}

function playersWhoCanBet(room) {
  return room.players.filter((p) => p.connected && p.chips > 0);
}

function allBetsPlaced(room) {
  const eligible = playersWhoCanBet(room);
  return eligible.length >= 2 && eligible.every((p) => p.betPlaced);
}

function startBetting(room) {
  room.phase = "betting";
  room.deck = [];
  room.current = 0;
  room.resultTitle = null;
  room.winners = [];
  room.pot = 0;

  for (const player of room.players) {
    player.cards = [];
    player.status = "playing";
    player.bet = 0;
    player.betPlaced = false;

    if (!player.connected || player.chips <= 0) {
      player.status = "out";
      player.betPlaced = true;
    }
  }

  const eligible = playersWhoCanBet(room);
  if (eligible.length < 2) {
    finishMatchChips(room);
    return;
  }

  emitRoom(room);
}

function beginDeal(room) {
  room.deck = createDeck();
  room.phase = "playing";
  room.current = 0;
  room.resultTitle = null;
  room.winners = [];
  room.pot = 0;

  for (const player of room.players) {
    player.cards = [];

    const skipped =
      player.status === "out" ||
      !player.connected ||
      (room.mode === "chips" && (!player.betPlaced || player.bet <= 0));

    if (skipped) {
      player.status = "out";
      continue;
    }

    if (room.mode === "chips") {
      room.pot += player.bet;
    }

    player.status = "playing";
    player.cards.push(draw(room), draw(room));

    if (isGoldenOchko(player.cards)) {
      player.status = "golden";
    } else if (handValue(player.cards) === 21) {
      player.status = "stood";
    }
  }

  // Золотое очко сразу завершает раздачу
  if (room.players.some((p) => p.status === "golden")) {
    finishRound(room);
    return;
  }

  while (
    room.current < room.players.length &&
    room.players[room.current].status !== "playing"
  ) {
    room.current += 1;
  }

  if (room.current >= room.players.length) {
    finishRound(room);
    return;
  }

  emitRoom(room);
}

function startRound(room) {
  if (room.mode === "chips") {
    startBetting(room);
  } else {
    for (const player of room.players) {
      player.bet = 0;
      player.betPlaced = false;
    }
    room.pot = 0;
    beginDeal(room);
  }
}

function nextPlayable(room, from) {
  let next = from + 1;
  while (next < room.players.length && room.players[next].status !== "playing") {
    next += 1;
  }
  return next;
}

function advanceAfterAction(room) {
  const next = nextPlayable(room, room.current);
  if (next >= room.players.length) {
    finishRound(room);
    return;
  }
  room.current = next;
  room.phase = "playing";
  emitRoom(room);
}

function finishMatchWins(room, winner) {
  room.phase = "match_over";
  room.matchWinners = [winner.id];
  room.resultTitle = `${winner.name} набрал ${WINS_TO_FINISH} побед!`;
  emitRoom(room);
}

function finishMatchChips(room) {
  room.phase = "match_over";
  const ranked = [...room.players].sort((a, b) => b.chips - a.chips);
  const top = ranked[0];
  const tied = ranked.filter((p) => p.chips === top.chips && p.chips > 0);
  room.matchWinners = tied.map((p) => p.id);

  if (tied.length === 1) {
    room.resultTitle = `${top.name} сорвал банк (${top.chips} фишек)!`;
  } else if (tied.length > 1) {
    room.resultTitle = `Ничья по фишкам: ${tied.map((p) => p.name).join(", ")}`;
  } else {
    room.resultTitle = "Фишки закончились";
  }
  emitRoom(room);
}

function payoutWinners(room, winners, titleSolo, titleTie) {
  room.winners = winners.map((w) => w.id);

  if (room.mode === "wins") {
    if (winners.length === 1) {
      winners[0].player.wins += 1;
      room.resultTitle = titleSolo(winners[0]);
    } else {
      room.resultTitle = titleTie(winners);
    }
    return;
  }

  const pot = room.pot;
  const share = Math.floor(pot / winners.length);
  let remainder = pot - share * winners.length;

  for (const w of winners) {
    let gain = share;
    if (remainder > 0) {
      gain += 1;
      remainder -= 1;
    }
    w.player.chips += gain;
  }

  for (const p of room.players) {
    p.bet = 0;
  }
  room.pot = 0;

  if (winners.length === 1) {
    room.resultTitle = titleSolo(winners[0]);
  } else {
    room.resultTitle = titleTie(winners);
  }
}

function finishRound(room) {
  room.phase = "finished";

  const contested = room.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: handValue(p.cards),
      status: p.status,
      golden: p.status === "golden" || isGoldenOchko(p.cards),
      player: p,
    }))
    .filter((p) => p.status !== "bust" && p.status !== "out" && p.player.cards.length > 0);

  const golden = contested.filter((p) => p.golden);

  if (golden.length > 0) {
    payoutWinners(
      room,
      golden,
      (w) => `Золотое очко! Победил ${w.name}`,
      (ws) => `Золотое очко: ${ws.map((w) => w.name).join(", ")}`
    );
  } else if (contested.length === 0) {
    room.resultTitle = "Все перебрали";
    room.winners = [];
    if (room.mode === "chips" && room.pot > 0) {
      for (const p of room.players) {
        if (p.bet > 0) {
          p.chips += p.bet;
          p.bet = 0;
        }
      }
      room.pot = 0;
    }
  } else {
    const best = Math.max(...contested.map((p) => p.score));
    const winners = contested.filter((p) => p.score === best);
    payoutWinners(
      room,
      winners,
      (w) =>
        room.mode === "chips"
          ? `${w.name} забирает банк`
          : `Победил ${w.name}`,
      (ws) =>
        room.mode === "chips"
          ? `Банк делится: ${ws.map((w) => w.name).join(", ")}`
          : `Ничья: ${ws.map((w) => w.name).join(", ")}`
    );
  }

  // Check match end
  if (room.mode === "wins") {
    const champ = room.players.find((p) => p.wins >= WINS_TO_FINISH);
    if (champ) {
      finishMatchWins(room, champ);
      return;
    }
  } else {
    const withChips = room.players.filter((p) => p.chips > 0);
    if (withChips.length <= 1) {
      finishMatchChips(room);
      return;
    }
  }

  emitRoom(room);
}

function sanitizeName(name) {
  const cleaned = String(name || "")
    .trim()
    .slice(0, 20)
    .replace(/[<>]/g, "");
  return cleaned || "Игрок";
}

function leaveRoom(socket) {
  const room = findRoom(socket);
  if (!room) return;

  socket.leave(room.code);
  socketRoom.delete(socket.id);

  const player = room.players.find((p) => p.id === socket.id);
  if (!player) return;

  if (room.phase === "lobby") {
    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }
    emitRoom(room);
    return;
  }

  player.connected = false;

  if (room.phase === "betting") {
    player.betPlaced = true;
    player.status = "out";
    if (allBetsPlaced(room)) {
      beginDeal(room);
      return;
    }
    emitRoom(room);
    return;
  }

  if (room.phase === "playing") {
    const currentPlayer = room.players[room.current];
    if (currentPlayer && currentPlayer.id === socket.id && currentPlayer.status === "playing") {
      currentPlayer.status = "stood";
      advanceAfterAction(room);
      return;
    }
  }

  const allGone = room.players.every((p) => !p.connected);
  if (allGone) {
    rooms.delete(room.code);
    return;
  }

  emitRoom(room);
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, maxPlayers, mode, scoreMode, avatar }, ack) => {
    try {
      leaveRoom(socket);

      const max = Math.min(6, Math.max(2, Number(maxPlayers) || 2));
      const gameMode = normalizeMode(mode);
      const code = makeRoomCode();
      const room = {
        code,
        hostId: socket.id,
        maxPlayers: max,
        mode: gameMode,
        scoreMode: normalizeScoreMode(scoreMode),
        phase: "lobby",
        deck: [],
        current: 0,
        pot: 0,
        resultTitle: null,
        winners: [],
        matchWinners: [],
        players: [],
      };

      room.players.push(makePlayer(socket.id, name, room, avatar));

      rooms.set(code, room);
      socketRoom.set(socket.id, code);
      socket.join(code);

      reply(ack, { ok: true, state: publicState(room, socket.id) });
      emitRoom(room);
    } catch (err) {
      reply(ack, { ok: false, error: "Не удалось создать комнату" });
    }
  });

  socket.on("room:join", ({ code, name, avatar }, ack) => {
    try {
      leaveRoom(socket);

      const roomCode = String(code || "")
        .trim()
        .toUpperCase();
      const room = rooms.get(roomCode);

      if (!room) {
        reply(ack, { ok: false, error: "Комната не найдена" });
        return;
      }
      if (room.phase !== "lobby") {
        reply(ack, { ok: false, error: "Игра уже началась" });
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        reply(ack, { ok: false, error: "Комната заполнена" });
        return;
      }

      room.players.push(makePlayer(socket.id, name, room, avatar));

      socketRoom.set(socket.id, room.code);
      socket.join(room.code);

      reply(ack, { ok: true, state: publicState(room, socket.id) });
      emitRoom(room);
    } catch (err) {
      reply(ack, { ok: false, error: "Не удалось войти" });
    }
  });

  socket.on("room:leave", () => {
    leaveRoom(socket);
  });

  socket.on("game:start", (ack) => {
    const room = findRoom(socket);
    if (!room) {
      reply(ack, { ok: false, error: "Вы не в комнате" });
      return;
    }
    if (room.hostId !== socket.id) {
      reply(ack, { ok: false, error: "Только хост может начать" });
      return;
    }
    if (room.phase !== "lobby" && room.phase !== "finished" && room.phase !== "match_over") {
      reply(ack, { ok: false, error: "Игра уже идёт" });
      return;
    }
    const ready = room.players.filter((p) => p.connected);
    if (ready.length < 2) {
      reply(ack, { ok: false, error: "Нужно минимум 2 игрока онлайн" });
      return;
    }

    if (room.phase === "lobby" || room.phase === "match_over") {
      room.players = ready;
      if (!room.players.some((p) => p.id === room.hostId)) {
        room.hostId = room.players[0].id;
      }
      resetMatchStats(room);
    } else {
      // Next round — keep score/chips, drop only fully disconnected if needed
      room.players = room.players.filter((p) => p.connected || (room.mode === "chips" ? p.chips > 0 : true));
      const stillOnline = room.players.filter((p) => p.connected);
      if (stillOnline.length < 2) {
        reply(ack, { ok: false, error: "Нужно минимум 2 игрока онлайн" });
        return;
      }
    }

    startRound(room);
    reply(ack, { ok: true });
  });

  socket.on("game:bet", ({ amount }, ack) => {
    const room = findRoom(socket);
    if (!room || room.phase !== "betting" || room.mode !== "chips") {
      reply(ack, { ok: false, error: "Сейчас нельзя ставить" });
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.connected) {
      reply(ack, { ok: false, error: "Игрок не найден" });
      return;
    }
    if (player.betPlaced) {
      reply(ack, { ok: false, error: "Ставка уже сделана" });
      return;
    }
    if (player.chips <= 0) {
      reply(ack, { ok: false, error: "Нет фишек" });
      return;
    }

    let bet = Math.floor(Number(amount));
    if (!Number.isFinite(bet)) {
      reply(ack, { ok: false, error: "Некорректная ставка" });
      return;
    }

    const minBet = Math.min(MIN_BET, player.chips);
    if (bet < minBet) bet = minBet;
    if (bet > player.chips) bet = player.chips;

    player.chips -= bet;
    player.bet = bet;
    player.betPlaced = true;

    if (allBetsPlaced(room)) {
      beginDeal(room);
    } else {
      emitRoom(room);
    }

    reply(ack, { ok: true });
  });

  socket.on("game:hit", (ack) => {
    const room = findRoom(socket);
    if (!room || room.phase !== "playing") {
      reply(ack, { ok: false, error: "Сейчас нельзя" });
      return;
    }
    const player = room.players[room.current];
    if (!player || player.id !== socket.id) {
      reply(ack, { ok: false, error: "Не ваш ход" });
      return;
    }
    if (player.status !== "playing") {
      reply(ack, { ok: false, error: "Ход уже завершён" });
      return;
    }

    player.cards.push(draw(room));
    const score = handValue(player.cards);

    if (score > 21) {
      player.status = "bust";
      advanceAfterAction(room);
    } else if (score === 21) {
      player.status = "stood";
      advanceAfterAction(room);
    } else {
      emitRoom(room);
    }

    reply(ack, { ok: true });
  });

  socket.on("game:stand", (ack) => {
    const room = findRoom(socket);
    if (!room || room.phase !== "playing") {
      reply(ack, { ok: false, error: "Сейчас нельзя" });
      return;
    }
    const player = room.players[room.current];
    if (!player || player.id !== socket.id) {
      reply(ack, { ok: false, error: "Не ваш ход" });
      return;
    }

    player.status = "stood";
    advanceAfterAction(room);
    reply(ack, { ok: true });
  });

  socket.on("game:rematch", (ack) => {
    const room = findRoom(socket);
    if (!room) {
      reply(ack, { ok: false, error: "Вы не в комнате" });
      return;
    }
    if (room.hostId !== socket.id) {
      reply(ack, { ok: false, error: "Только хост может продолжить" });
      return;
    }
    if (room.phase !== "finished" && room.phase !== "match_over") {
      reply(ack, { ok: false, error: "Раздача ещё не окончена" });
      return;
    }

    const ready = room.players.filter((p) => p.connected);
    if (ready.length < 2) {
      reply(ack, { ok: false, error: "Нужно минимум 2 игрока онлайн" });
      return;
    }

    if (room.phase === "match_over") {
      room.players = ready;
      if (!room.players.some((p) => p.id === room.hostId)) {
        room.hostId = room.players[0].id;
      }
      resetMatchStats(room);
    }

    startRound(room);
    reply(ack, { ok: true });
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`21 очко: http://0.0.0.0:${PORT}`);
});
