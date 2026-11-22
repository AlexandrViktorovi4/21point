(() => {
  const socket = io();

  const els = {
    home: document.getElementById("home"),
    lobby: document.getElementById("lobby"),
    game: document.getElementById("game"),
    result: document.getElementById("result"),
    playerName: document.getElementById("player-name"),
    roomCode: document.getElementById("room-code"),
    homeError: document.getElementById("home-error"),
    createPanel: document.getElementById("create-panel"),
    joinPanel: document.getElementById("join-panel"),
    tabCreate: document.getElementById("tab-create"),
    tabJoin: document.getElementById("tab-join"),
    btnCreate: document.getElementById("btn-create"),
    btnJoin: document.getElementById("btn-join"),
    lobbyCode: document.getElementById("lobby-code"),
    lobbyMode: document.getElementById("lobby-mode"),
    lobbyList: document.getElementById("lobby-list"),
    lobbyStatus: document.getElementById("lobby-status"),
    btnStart: document.getElementById("btn-start"),
    btnCopy: document.getElementById("btn-copy"),
    btnLeaveLobby: document.getElementById("btn-leave-lobby"),
    table: document.getElementById("table"),
    turnBanner: document.getElementById("turn-banner"),
    roomChip: document.getElementById("room-chip"),
    matchBanner: document.getElementById("match-banner"),
    bettingPanel: document.getElementById("betting-panel"),
    betAmount: document.getElementById("bet-amount"),
    btnBetMinus: document.getElementById("btn-bet-minus"),
    btnBetPlus: document.getElementById("btn-bet-plus"),
    btnPlaceBet: document.getElementById("btn-place-bet"),
    btnHit: document.getElementById("btn-hit"),
    btnStand: document.getElementById("btn-stand"),
    waitHint: document.getElementById("wait-hint"),
    btnLeaveGame: document.getElementById("btn-leave-game"),
    resultTitle: document.getElementById("result-title"),
    resultList: document.getElementById("result-list"),
    btnRematch: document.getElementById("btn-rematch"),
    rematchWait: document.getElementById("rematch-wait"),
    btnToHome: document.getElementById("btn-to-home"),
  };

  /** @type {object | null} */
  let state = null;
  /** @type {Map<string, number>} */
  let prevCardCounts = new Map();
  let prevPhase = "";
  let prevTurnId = "";
  let prevMyStatus = "";

  const AVATARS = [
    { id: "selfie", src: "avatars/selfie.png" },
    { id: "hamster", src: "avatars/hamster.jpg" },
    { id: "creeper", src: "avatars/creeper.jpg" },
    { id: "apple", src: "avatars/apple.jpg" },
    { id: "mushroom", src: "avatars/mushroom.jpg" },
    { id: "parrot", src: "avatars/parrot.jpg" },
    { id: "fish", src: "avatars/fish.jpg" },
    { id: "tiger", src: "avatars/tiger.jpg" },
    { id: "lion1", src: "avatars/lion1.jpg" },
    { id: "lion2", src: "avatars/lion2.jpg" },
    { id: "blazer", src: "avatars/blazer.jpg" },
  ];

  let selectedAvatar = localStorage.getItem("21avatar") || "selfie";
  if (!AVATARS.some((a) => a.id === selectedAvatar)) selectedAvatar = "selfie";

  function avatarMeta(id) {
    return AVATARS.find((a) => a.id === id) || AVATARS[0];
  }

  function avatarHtml(id, sizeClass = "") {
    const a = avatarMeta(id);
    return `<span class="avatar avatar-photo ${sizeClass}" aria-hidden="true"><img src="${a.src}" alt="" /></span>`;
  }

  function renderAvatarPicker() {
    const grid = document.getElementById("avatar-grid");
    if (!grid) return;
    grid.innerHTML = AVATARS.map(
      (a) => `
      <button type="button" class="avatar-option${a.id === selectedAvatar ? " is-selected" : ""}" data-avatar="${a.id}" aria-pressed="${a.id === selectedAvatar}">
        <span class="avatar avatar-photo"><img src="${a.src}" alt="" /></span>
      </button>
    `
    ).join("");
  }

  renderAvatarPicker();
  document.getElementById("avatar-grid")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-avatar]");
    if (!btn) return;
    selectedAvatar = btn.getAttribute("data-avatar");
    localStorage.setItem("21avatar", selectedAvatar);
    renderAvatarPicker();
  });

  const audio = window.GameAudio;
  const btnAudio = document.getElementById("btn-audio");
  const audioPanel = document.getElementById("audio-panel");
  const musicVolEl = document.getElementById("music-vol");
  const sfxVolEl = document.getElementById("sfx-vol");
  const musicVolLabel = document.getElementById("music-vol-label");
  const sfxVolLabel = document.getElementById("sfx-vol-label");
  const btnStartMusic = document.getElementById("btn-start-music");
  const trackList = document.getElementById("track-list");

  function renderTrackList() {
    if (!audio || !trackList) return;
    const s = audio.getSettings();
    trackList.innerHTML = (s.tracks || [])
      .map(
        (t) => `
        <button type="button" class="track-btn${t.id === s.trackId ? " is-active" : ""}" data-track="${t.id}">
          <span class="track-btn-title">${t.title}</span>
          ${t.id === s.trackId && s.musicPlaying ? '<span class="track-btn-now">сейчас</span>' : ""}
        </button>
      `
      )
      .join("");
  }

  function syncAudioPanel() {
    if (!audio) return;
    const s = audio.getSettings();
    const mPct = Math.round(s.musicVol * 100);
    const sPct = Math.round(s.sfxVol * 100);
    if (musicVolEl) musicVolEl.value = String(mPct);
    if (sfxVolEl) sfxVolEl.value = String(sPct);
    if (musicVolLabel) musicVolLabel.textContent = `${mPct}%`;
    if (sfxVolLabel) sfxVolLabel.textContent = `${sPct}%`;
    if (btnAudio) {
      btnAudio.classList.toggle("is-muted", s.musicVol <= 0.001 && s.sfxVol <= 0.001);
      btnAudio.textContent = "♪";
    }
    if (btnStartMusic) {
      btnStartMusic.textContent = s.musicPlaying ? "Музыка играет" : "Включить музыку";
      btnStartMusic.disabled = s.musicPlaying;
    }
    renderTrackList();
  }

  const btnValues = document.getElementById("btn-values");
  const valuesPanel = document.getElementById("values-panel");

  function closePanel(panel, btn) {
    panel?.classList.add("hidden");
    btn?.setAttribute("aria-expanded", "false");
  }

  function togglePanel(panel, btn) {
    const willOpen = panel.classList.contains("hidden");
    if (willOpen) {
      closePanel(audioPanel, btnAudio);
      closePanel(valuesPanel, btnValues);
      panel.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
    } else {
      closePanel(panel, btn);
    }
    return willOpen;
  }

  btnValues?.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel(valuesPanel, btnValues);
  });

  if (audio && btnAudio && audioPanel) {
    syncAudioPanel();

    btnAudio.addEventListener("click", (e) => {
      e.stopPropagation();
      audio.unlock();
      const open = togglePanel(audioPanel, btnAudio);
      if (open) syncAudioPanel();
    });

    musicVolEl?.addEventListener("input", () => {
      const pct = Number(musicVolEl.value);
      if (musicVolLabel) musicVolLabel.textContent = `${pct}%`;
      audio.unlock();
      audio.setMusicVolume(pct / 100);
      audio.startMusic();
      if (btnStartMusic) {
        btnStartMusic.textContent = pct > 0 ? "Музыка играет" : "Включить музыку";
        btnStartMusic.disabled = pct > 0;
      }
    });

    sfxVolEl?.addEventListener("input", () => {
      const pct = Number(sfxVolEl.value);
      if (sfxVolLabel) sfxVolLabel.textContent = `${pct}%`;
      audio.unlock();
      audio.setSfxVolume(pct / 100);
      if (pct > 0) audio.click();
    });

    btnStartMusic?.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      btnStartMusic.disabled = true;
      btnStartMusic.textContent = "Запуск…";
      await audio.unlock();
      if (Number(musicVolEl?.value || 0) <= 0) {
        musicVolEl.value = "45";
        audio.setMusicVolume(0.45);
        if (musicVolLabel) musicVolLabel.textContent = "45%";
      }
      const ok = await audio.startMusic();
      syncAudioPanel();
      if (!ok) {
        btnStartMusic.disabled = false;
        btnStartMusic.textContent = "Нажмите ещё раз";
      }
    });

    trackList?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-track]");
      if (!btn) return;
      e.stopPropagation();
      await audio.unlock();
      if (Number(musicVolEl?.value || 0) <= 0) {
        musicVolEl.value = "45";
        audio.setMusicVolume(0.45);
        if (musicVolLabel) musicVolLabel.textContent = "45%";
      }
      await audio.setTrack(btn.getAttribute("data-track"));
      syncAudioPanel();
    });

  }

  document.addEventListener("click", (e) => {
    const side = document.getElementById("side-dock");
    if (!side) return;
    if (!side.contains(e.target)) {
      closePanel(audioPanel, btnAudio);
      closePanel(valuesPanel, btnValues);
    }
  });

  const savedName = localStorage.getItem("21name");
  if (savedName) els.playerName.value = savedName;

  function handleSounds(s) {
    if (!audio || !s) return;

    const counts = new Map(s.players.map((p) => [p.id, p.cards?.length || 0]));
    let gained = 0;
    for (const [id, count] of counts) {
      const prev = prevCardCounts.get(id) || 0;
      if (count > prev) gained += count - prev;
    }

    if (gained > 0 && (s.phase === "playing" || s.phase === "finished" || s.phase === "match_over")) {
      audio.dealMany(gained);
    }

    const mePlayer = me(s);
    const turnId = s.players[s.current]?.id || "";

    if (
      s.phase === "playing" &&
      prevPhase === "playing" &&
      turnId &&
      turnId !== prevTurnId &&
      turnId === s.youId
    ) {
      audio.turn();
    }

    if (mePlayer && prevMyStatus === "playing" && mePlayer.status === "bust") {
      audio.bust();
    }

    if (
      (s.phase === "finished" || s.phase === "match_over") &&
      prevPhase !== "finished" &&
      prevPhase !== "match_over"
    ) {
      const iWon = s.players.some(
        (p) => p.id === s.youId && (p.isWinner || p.isMatchWinner || p.golden)
      );
      if (iWon) audio.win();
      else if (mePlayer?.status === "bust") audio.bust();
    }

    if (s.phase === "betting" && prevPhase !== "betting") {
      audio.click();
    }

    prevCardCounts = counts;
    prevPhase = s.phase;
    prevTurnId = turnId;
    prevMyStatus = mePlayer?.status || "";
  }

  function showScreen(name) {
    els.home.classList.toggle("hidden", name !== "home");
    els.lobby.classList.toggle("hidden", name !== "lobby");
    els.game.classList.toggle("hidden", name !== "game");
    if (name !== "result") els.result.classList.add("hidden");
  }

  function setHomeError(msg) {
    if (!msg) {
      els.homeError.classList.add("hidden");
      els.homeError.textContent = "";
      return;
    }
    els.homeError.textContent = msg;
    els.homeError.classList.remove("hidden");
  }

  function getName() {
    const name = els.playerName.value.trim();
    if (!name) {
      setHomeError("Введите имя");
      els.playerName.focus();
      return null;
    }
    localStorage.setItem("21name", name);
    return name;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function modeLabel(mode) {
    return mode === "chips" ? "На фишки" : "До 10 побед";
  }

  function scoreModeLabel(mode) {
    return mode === "manual" ? "очки вручную" : "очки авто";
  }

  function me(s) {
    return s.players.find((p) => p.id === s.youId) || null;
  }

  function cardHtml(card, index) {
    if (card.hidden) {
      return `
        <article class="card card-back" style="animation-delay: ${index * 90}ms" aria-label="Закрытая карта">
          <div class="card-back-inner">
            <div class="card-back-pattern"></div>
            <span class="card-back-mark">21</span>
          </div>
        </article>
      `;
    }
    const red = card.color === "red" ? " red" : "";
    return `
      <article class="card${red}" style="animation-delay: ${index * 90}ms" aria-label="${card.label}${card.suit}">
        <div class="card-corner">
          <span>${card.label}</span>
          <span class="card-suit">${card.suit}</span>
        </div>
        <div class="card-center">${card.suit}</div>
        <div class="card-corner bottom">
          <span>${card.label}</span>
          <span class="card-suit">${card.suit}</span>
        </div>
      </article>
    `;
  }

  function statusLabel(player, isActive, phase) {
    if (!player.connected) return "офлайн";
    if (player.status === "out") return "вне игры";
    if (phase === "betting") {
      if (player.chips <= 0) return "без фишек";
      return player.betPlaced ? `ставка ${player.bet}` : "ставит…";
    }
    if (player.status === "golden" || player.golden) return "золотое очко";
    if (player.status === "bust") return "перебор";
    if (player.status === "stood") return "хватит";
    if (isActive && phase === "playing") return "ход";
    return "ждёт";
  }

  function metaLine(s, player) {
    if (s.mode === "chips") {
      const parts = [`${player.chips} фиш.`];
      if (player.bet > 0 && (s.phase === "playing" || s.phase === "betting")) {
        parts.push(`ставка ${player.bet}`);
      }
      return parts.join(" · ");
    }
    return `${player.wins} / ${s.winsToFinish}`;
  }

  function clampBetInput(s) {
    const player = me(s);
    if (!player) return;
    const min = Math.min(s.minBet || 5, player.chips);
    let val = Number(els.betAmount.value) || min;
    if (val < min) val = min;
    if (val > player.chips) val = player.chips;
    els.betAmount.value = String(val);
    els.betAmount.min = String(min);
    els.betAmount.max = String(player.chips);
  }

  function renderLobby(s) {
    showScreen("lobby");
    els.result.classList.add("hidden");
    els.lobbyCode.textContent = s.code;
    els.lobbyMode.textContent = `${modeLabel(s.mode)} · ${scoreModeLabel(s.scoreMode)}`;
    const isHost = s.hostId === s.youId;

    els.lobbyList.innerHTML = s.players
      .map((p) => {
        const you = p.id === s.youId ? " (вы)" : "";
        const host = p.id === s.hostId ? " · хост" : "";
        const offline = p.connected ? "" : " · офлайн";
        return `<li>
          ${avatarHtml(p.avatar, "avatar-sm")}
          <div class="lobby-player-text">
            <strong>${escapeHtml(p.name)}</strong>
            <span>${you}${host}${offline}</span>
          </div>
        </li>`;
      })
      .join("");

    els.lobbyStatus.textContent = `${s.players.length} / ${s.maxPlayers} игроков`;
    els.btnStart.classList.toggle("hidden", !isHost);
    els.btnStart.disabled = s.players.filter((p) => p.connected).length < 2;
  }

  function renderGame(s) {
    showScreen("game");
    els.roomChip.textContent = `Комната ${s.code} · ${modeLabel(s.mode)} · ${scoreModeLabel(s.scoreMode)}`;

    if (s.mode === "chips") {
      els.matchBanner.textContent =
        s.phase === "betting"
          ? `Делайте ставки · банк соберётся после всех`
          : `Банк: ${s.pot || 0}`;
    } else {
      const leader = [...s.players].sort((a, b) => b.wins - a.wins)[0];
      els.matchBanner.textContent = `До ${s.winsToFinish} побед · лидирует ${leader?.name || "—"} (${leader?.wins || 0})`;
    }

    const currentPlayer = s.players[s.current];
    const myTurn =
      s.phase === "playing" && currentPlayer && currentPlayer.id === s.youId;
    const self = me(s);
    const needBet =
      s.phase === "betting" &&
      self &&
      self.connected &&
      self.chips > 0 &&
      !self.betPlaced;

    els.table.innerHTML = s.players
      .map((player, i) => {
        const isActive = i === s.current && s.phase === "playing";
        const isYou = player.id === s.youId;
        const classes = [
          "seat",
          isActive ? "active" : "",
          player.status === "bust" ? "bust" : "",
          player.status === "stood" ? "stood" : "",
          player.status === "golden" || player.golden ? "golden" : "",
          player.status === "out" ? "out" : "",
          player.isWinner || player.isMatchWinner ? "winner" : "",
          isYou ? "you" : "",
          !player.connected ? "offline" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const name = isYou ? `${player.name} (вы)` : player.name;
        const showHand = s.phase === "playing" || s.phase === "finished" || s.phase === "match_over";

        return `
          <article class="${classes}">
            <div class="seat-top">
              <div class="seat-identity">
                ${avatarHtml(player.avatar, "avatar-md")}
                <div>
                  <h3 class="seat-name">${escapeHtml(name)}</h3>
                  <span class="seat-status">${statusLabel(player, isActive, s.phase)}</span>
                  <span class="seat-meta">${escapeHtml(metaLine(s, player))}</span>
                </div>
              </div>
              ${
                s.phase === "betting"
                  ? `<div class="seat-score">${player.betPlaced ? player.bet : "…"}</div>`
                  : player.score != null
                    ? `<div class="seat-score">${player.score}</div>`
                    : ""
              }
            </div>
            ${
              showHand
                ? `<div class="hand">${(player.cards || [])
                    .map((c, idx) => cardHtml(c, idx))
                    .join("")}</div>`
                : `<div class="hand hand-empty">${
                    player.chips <= 0 && s.mode === "chips"
                      ? "Без фишек"
                      : "Ожидание ставки"
                  }</div>`
            }
          </article>
        `;
      })
      .join("");

    if (s.phase === "betting") {
      els.turnBanner.textContent = needBet ? "Ваша ставка" : "Ждём ставки…";
    } else if (s.phase === "playing" && currentPlayer) {
      els.turnBanner.textContent =
        currentPlayer.id === s.youId ? "Ваш ход" : `Ход: ${currentPlayer.name}`;
    } else if (s.phase === "finished") {
      els.turnBanner.textContent = "Раздача окончена";
    } else if (s.phase === "match_over") {
      els.turnBanner.textContent = "Матч окончен";
    }

    els.bettingPanel.classList.toggle("hidden", !needBet);
    if (needBet) clampBetInput(s);

    els.btnHit.classList.toggle("hidden", !myTurn);
    els.btnStand.classList.toggle("hidden", !myTurn);
    els.waitHint.classList.toggle(
      "hidden",
      myTurn || needBet || (s.phase !== "playing" && s.phase !== "betting")
    );
    if (s.phase === "betting" && !needBet) {
      els.waitHint.textContent = "Ждём ставки соперников…";
      els.waitHint.classList.remove("hidden");
    } else if (s.phase === "playing" && !myTurn) {
      els.waitHint.textContent = "Ждём ход соперника…";
    }
  }

  function renderResult(s) {
    els.result.classList.remove("hidden");
    els.resultTitle.textContent = s.resultTitle || "Итог";

    els.resultList.innerHTML = s.players
      .map((p) => {
        const bust = p.status === "bust";
        const cls =
          p.isMatchWinner || p.isWinner ? "is-winner" : bust ? "is-bust" : "";
        let tag =
          p.status === "golden" || p.golden
            ? "золотое очко"
            : bust
              ? p.score != null
                ? `перебор · ${p.score}`
                : "перебор"
              : p.status === "out"
                ? "—"
                : p.score != null
                  ? `${p.score}`
                  : "карты вскрыты";
        if (s.mode === "wins") tag += ` · ${p.wins} поб.`;
        if (s.mode === "chips") tag += ` · ${p.chips} фиш.`;
        return `
          <li class="${cls}">
            <span class="result-player">${avatarHtml(p.avatar, "avatar-sm")}<strong>${escapeHtml(p.name)}</strong></span>
            <span class="score-tag">${tag}</span>
          </li>
        `;
      })
      .join("");

    const isHost = s.hostId === s.youId;
    els.btnRematch.classList.toggle("hidden", !isHost);
    els.rematchWait.classList.toggle("hidden", isHost);

    if (isHost) {
      els.btnRematch.textContent =
        s.phase === "match_over" ? "Новый матч" : "Следующая раздача";
    } else {
      els.rematchWait.textContent =
        s.phase === "match_over" ? "Ждём новый матч от хоста…" : "Ждём следующую раздачу…";
    }
  }

  function applyState(s) {
    handleSounds(s);
    state = s;
    if (!s) {
      showScreen("home");
      return;
    }

    if (s.phase === "lobby") {
      renderLobby(s);
      return;
    }

    renderGame(s);
    if (s.phase === "finished" || s.phase === "match_over") {
      renderResult(s);
    } else {
      els.result.classList.add("hidden");
    }
  }

  function leaveToHome() {
    socket.emit("room:leave");
    state = null;
    prevCardCounts = new Map();
    prevPhase = "";
    prevTurnId = "";
    prevMyStatus = "";
    els.result.classList.add("hidden");
    showScreen("home");
  }

  // Fly trial / рестарт сервера сбрасывает комнаты в памяти
  socket.io.on("reconnect", () => {
    if (state && state.phase !== "lobby" && state.phase !== "home") {
      alert(
        "Сервер перезапустился — комната сброшена. На триале Fly.io машина останавливается ~каждые 5 минут без карты. Создайте комнату заново."
      );
      leaveToHome();
    }
  });

  function placeBet() {
    if (!state) return;
    clampBetInput(state);
    const amount = Number(els.betAmount.value);
    els.btnPlaceBet.disabled = true;
    socket.emit("game:bet", { amount }, (res) => {
      els.btnPlaceBet.disabled = false;
      if (!res?.ok) alert(res?.error || "Нельзя поставить");
    });
  }

  // Tabs
  els.tabCreate.addEventListener("click", () => {
    els.tabCreate.classList.add("active");
    els.tabJoin.classList.remove("active");
    els.createPanel.classList.remove("hidden");
    els.joinPanel.classList.add("hidden");
    setHomeError("");
  });

  els.tabJoin.addEventListener("click", () => {
    els.tabJoin.classList.add("active");
    els.tabCreate.classList.remove("active");
    els.joinPanel.classList.remove("hidden");
    els.createPanel.classList.add("hidden");
    setHomeError("");
  });

  els.roomCode.addEventListener("input", () => {
    els.roomCode.value = els.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  els.btnCreate.addEventListener("click", () => {
    const name = getName();
    if (!name) return;
    const max = Number(document.querySelector('input[name="max"]:checked')?.value || 2);
    const mode =
      document.querySelector('input[name="game-mode"]:checked')?.value || "wins";
    const scoreMode =
      document.querySelector('input[name="score-mode"]:checked')?.value || "auto";
    setHomeError("");
    els.btnCreate.disabled = true;

    socket.emit(
      "room:create",
      { name, maxPlayers: max, mode, scoreMode, avatar: selectedAvatar },
      (res) => {
        els.btnCreate.disabled = false;
        if (!res?.ok) {
          setHomeError(res?.error || "Ошибка");
          return;
        }
        applyState(res.state);
      }
    );
  });

  els.btnJoin.addEventListener("click", () => {
    const name = getName();
    if (!name) return;
    const code = els.roomCode.value.trim();
    if (code.length < 4) {
      setHomeError("Введите код комнаты");
      return;
    }
    setHomeError("");
    els.btnJoin.disabled = true;

    socket.emit("room:join", { name, code, avatar: selectedAvatar }, (res) => {
      els.btnJoin.disabled = false;
      if (!res?.ok) {
        setHomeError(res?.error || "Ошибка");
        return;
      }
      applyState(res.state);
    });
  });

  els.btnStart.addEventListener("click", () => {
    socket.emit("game:start", (res) => {
      if (!res?.ok) alert(res?.error || "Не удалось начать");
    });
  });

  els.btnCopy.addEventListener("click", async () => {
    if (!state?.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      els.btnCopy.textContent = "Скопировано";
      setTimeout(() => {
        els.btnCopy.textContent = "Скопировать код";
      }, 1500);
    } catch {
      prompt("Скопируйте код комнаты:", state.code);
    }
  });

  els.btnLeaveLobby.addEventListener("click", leaveToHome);
  els.btnLeaveGame.addEventListener("click", () => {
    if (confirm("Покинуть комнату?")) leaveToHome();
  });
  els.btnToHome.addEventListener("click", leaveToHome);

  els.btnHit.addEventListener("click", () => {
    socket.emit("game:hit", (res) => {
      if (!res?.ok) alert(res?.error || "Нельзя");
    });
  });

  els.btnStand.addEventListener("click", () => {
    socket.emit("game:stand", (res) => {
      if (!res?.ok) alert(res?.error || "Нельзя");
    });
  });

  els.btnRematch.addEventListener("click", () => {
    socket.emit("game:rematch", (res) => {
      if (!res?.ok) alert(res?.error || "Нельзя");
    });
  });

  els.btnPlaceBet.addEventListener("click", () => {
    audio?.unlock();
    audio?.chip();
    placeBet();
  });

  els.btnBetMinus.addEventListener("click", () => {
    if (!state) return;
    const step = 5;
    els.betAmount.value = String(Math.max(0, Number(els.betAmount.value) - step));
    clampBetInput(state);
  });

  els.btnBetPlus.addEventListener("click", () => {
    if (!state) return;
    const step = 5;
    els.betAmount.value = String(Number(els.betAmount.value) + step);
    clampBetInput(state);
  });

  document.querySelectorAll(".bet-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state) return;
      const self = me(state);
      if (!self) return;
      const raw = btn.getAttribute("data-bet");
      els.betAmount.value = raw === "all" ? String(self.chips) : raw;
      clampBetInput(state);
    });
  });

  socket.on("room:state", (s) => applyState(s));

  socket.on("disconnect", () => {
    if (state) {
      els.turnBanner.textContent = "Нет связи…";
    }
  });

  showScreen("home");
})();
