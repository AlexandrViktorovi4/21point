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
const DEALER_ID = "dealer";
const DEALER_STAND_AT = 17;

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
    isDealer: false,
  };
}

function makeDealer() {
  return {
    id: DEALER_ID,
    name: "Дилер",
    avatar: "dealer",
    cards: [],
    status: "playing",
    connected: true,
    wins: 0,
    chips: 0,
    bet: 0,
    betPlaced: true,
    isDealer: true,
  };
}

function resetDealer(room) {
  room.dealer = makeDealer();
  room.dealerTurn = false;
}

function serializeSeat(p, room, viewerId, revealAll, autoScore) {
  const isDealer = Boolean(p.isDealer);
  const isSelf = !isDealer && p.id === viewerId;
  let showCards = revealAll || isSelf;
  let cards;

  if (isDealer && !revealAll) {
    // Одна открытая, остальные закрыты
    showCards = false;
    cards = (p.cards || []).map((c, i) => (i === 0 ? c : { hidden: true }));
  } else if (showCards) {
    cards = p.cards;
  } else {
    cards = (p.cards || []).map(() => ({ hidden: true }));
  }

  let status = p.status;
  let golden = isGoldenOchko(p.cards) || p.status === "golden";
  if (!revealAll && !isSelf) {
    if (isDealer) {
      if (status === "bust" || status === "golden" || status === "stood") {
        status = "playing";
      }
      golden = false;
    } else if (status === "bust" || status === "golden" || status === "stood") {
      status = "stood";
      golden = false;
    }
  }

  let score = null;
  if (isDealer) {
    if (revealAll && (autoScore || true)) score = handValue(p.cards);
  } else if (showCards && (autoScore || revealAll)) {
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
    cardCount: (p.cards || []).length,
    cards,
    isDealer,
    isWinner: Boolean(room.winners && room.winners.includes(p.id)),
    isMatchWinner: Boolean(room.matchWinners && room.matchWinners.includes(p.id)),
  };
}

function publicState(room, viewerId) {
  const revealAll = room.phase === "finished" || room.phase === "match_over";
  const autoScore = room.scoreMode !== "manual";
  if (!room.dealer) resetDealer(room);

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
    dealerTurn: Boolean(room.dealerTurn),
    youId: viewerId,
    pot: room.pot || 0,
    resultTitle: room.resultTitle || null,
    matchOver: room.phase === "match_over",
    dealer: serializeSeat(room.dealer, room, viewerId, revealAll, autoScore),
    players: room.players.map((p) =>
      serializeSeat(p, room, viewerId, revealAll, autoScore)
    ),
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
  resetDealer(room);
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
  return eligible.length >= 1 && eligible.every((p) => p.betPlaced);
}

function startBetting(room) {
  room.phase = "betting";
  room.deck = [];
  room.current = 0;
  room.dealerTurn = false;
  room.resultTitle = null;
  room.winners = [];
  room.pot = 0;
  resetDealer(room);

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
  if (eligible.length < 1) {
    finishMatchChips(room);
    return;
  }

  emitRoom(room);
}

function beginDeal(room) {
  room.deck = createDeck();
  room.phase = "playing";
  room.current = 0;
  room.dealerTurn = false;
  room.resultTitle = null;
  room.winners = [];
  room.pot = 0;
  resetDealer(room);

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

  const dealer = room.dealer;
  dealer.cards.push(draw(room), draw(room));
  if (isGoldenOchko(dealer.cards)) {
    dealer.status = "golden";
  } else if (handValue(dealer.cards) === 21) {
    dealer.status = "stood";
  } else {
    dealer.status = "playing";
  }

  // Золотое очко у игрока или дилера — сразу итог
  if (
    room.players.some((p) => p.status === "golden") ||
    dealer.status === "golden"
  ) {
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
    startDealerTurn(room);
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
    startDealerTurn(room);
    return;
  }
  room.current = next;
  room.phase = "playing";
  room.dealerTurn = false;
  emitRoom(room);
}

function humansNeedDealer(room) {
  return room.players.some(
    (p) =>
      p.cards.length > 0 &&
      p.status !== "out" &&
      p.status !== "bust"
  );
}

function startDealerTurn(room) {
  const dealer = room.dealer || makeDealer();
  room.dealer = dealer;
  room.dealerTurn = true;
  room.phase = "playing";

  if (!humansNeedDealer(room)) {
    if (dealer.status === "playing") dealer.status = "stood";
    room.dealerTurn = false;
    finishRound(room);
    return;
  }

  emitRoom(room);
  setTimeout(() => dealerStep(room), 650);
}

function dealerStep(room) {
  if (!rooms.has(room.code)) return;
  if (room.phase !== "playing" || !room.dealerTurn) return;

  const dealer = room.dealer;
  if (!dealer) {
    finishRound(room);
    return;
  }

  if (dealer.status !== "playing") {
    room.dealerTurn = false;
    finishRound(room);
    return;
  }

  const score = handValue(dealer.cards);
  if (score >= DEALER_STAND_AT) {
    dealer.status = score > 21 ? "bust" : "stood";
    emitRoom(room);
    room.dealerTurn = false;
    setTimeout(() => {
      if (rooms.has(room.code)) finishRound(room);
    }, 500);
    return;
  }

  dealer.cards.push(draw(room));
  const next = handValue(dealer.cards);
  if (next > 21) dealer.status = "bust";
  else if (next === 21 || next >= DEALER_STAND_AT) dealer.status = "stood";

  emitRoom(room);

  if (dealer.status !== "playing") {
    room.dealerTurn = false;
    setTimeout(() => {
      if (rooms.has(room.code)) finishRound(room);
    }, 550);
  } else {
    setTimeout(() => dealerStep(room), 700);
  }
}

function compareVsDealer(player, dealer) {
  const pScore = handValue(player.cards);
  const dScore = handValue(dealer.cards);
  const pBust = player.status === "bust" || pScore > 21;
  const dBust = dealer.status === "bust" || dScore > 21;
  const pGolden = player.status === "golden" || isGoldenOchko(player.cards);
  const dGolden = dealer.status === "golden" || isGoldenOchko(dealer.cards);

  if (player.status === "out" || player.cards.length === 0) return "skip";
  if (pGolden && dGolden) return "push";
  if (pGolden) return "win";
  if (dGolden) return "lose";
  if (pBust && dBust) return "push";
  if (pBust) return "lose";
  if (dBust) return "win";
  if (pScore > dScore) return "win";
  if (pScore < dScore) return "lose";
  return "push";
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

function finishRound(room) {
  room.phase = "finished";
  room.dealerTurn = false;
  if (!room.dealer) resetDealer(room);

  const dealer = room.dealer;
  const winners = [];
  const pushers = [];

  for (const player of room.players) {
    const result = compareVsDealer(player, dealer);
    if (result === "win") winners.push(player);
    if (result === "push") pushers.push(player);
  }

  room.winners = winners.map((w) => w.id);

  if (room.mode === "wins") {
    for (const w of winners) w.wins += 1;

    if (winners.length === 0 && pushers.length === 0) {
      room.resultTitle = "Дилер забирает раздачу";
    } else if (winners.length === 1 && pushers.length === 0) {
      room.resultTitle = `${winners[0].name} обыграл дилера`;
    } else if (winners.length > 0) {
      room.resultTitle = `Обыграли дилера: ${winners.map((w) => w.name).join(", ")}`;
    } else {
      room.resultTitle = "Ничья с дилером";
    }
  } else {
    for (const player of room.players) {
      if (!player.bet) continue;
      const result = compareVsDealer(player, dealer);
      if (result === "win") player.chips += player.bet * 2;
      else if (result === "push") player.chips += player.bet;
      player.bet = 0;
    }
    room.pot = 0;

    if (winners.length === 0 && pushers.length === 0) {
      room.resultTitle = "Дилер забирает ставки";
    } else if (winners.length === 1 && pushers.length === 0) {
      room.resultTitle = `${winners[0].name} обыграл дилера`;
    } else if (winners.length > 0) {
      room.resultTitle = `Выиграли у дилера: ${winners.map((w) => w.name).join(", ")}`;
    } else {
      room.resultTitle = "Ничья со ставками";
    }
  }

  if (room.mode === "wins") {
    const champ = room.players.find((p) => p.wins >= WINS_TO_FINISH);
    if (champ) {
      finishMatchWins(room, champ);
      return;
    }
  } else {
    const withChips = room.players.filter((p) => p.chips > 0);
    if (withChips.length <= 1 && room.players.length > 1) {
      finishMatchChips(room);
      return;
    }
    if (withChips.length === 0) {
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
        dealerTurn: false,
        resultTitle: null,
        winners: [],
        matchWinners: [],
        players: [],
        dealer: makeDealer(),
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
    if (ready.length < 1) {
      reply(ack, { ok: false, error: "Нужен хотя бы 1 игрок онлайн" });
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
      if (stillOnline.length < 1) {
        reply(ack, { ok: false, error: "Нужен хотя бы 1 игрок онлайн" });
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
    if (!room || room.phase !== "playing" || room.dealerTurn) {
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
    if (!room || room.phase !== "playing" || room.dealerTurn) {
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
