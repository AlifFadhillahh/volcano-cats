import { Room, Client } from "@colyseus/core";
import { GameState, ClientMessage, Player } from "../types/game";
import {
  setupGame,
  drawCard,
  playCard,
  playFreeze,
  playGang,
  placeLavaCat,
  resolveBribe,
  resolvePeekAndSwap,
  resolveFloodDiscard,
  resolveTimeWarp,
  serializeForClient,
  validatePlayCard,
  advanceTurn,
  executeGangRainbow,
  getCurrentPlayer,
} from "../game/engine";

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
const LOBBY_TIMEOUT_MS = 30 * 60 * 1000; // 30 menit
const RECONNECT_TIMEOUT_MS = 60 * 1000; // 1 menit

export class VolcanoCatsRoom extends Room {
  private gameState!: GameState;

  override onCreate(options: { roomName?: string }) {
    this.maxClients = MAX_PLAYERS;
    this.autoDispose = true;

    this.gameState = {
      roomId: this.roomId,
      status: "lobby",
      hostId: "",
      players: new Map(),
      turnOrder: [],
      currentTurnIndex: 0,
      turnDirection: 1,
      pendingTurns: 1,
      deck: [],
      discardPile: [],
      pendingAction: null,
      peekResult: null,
      winner: null,
      log: [],
    };

    this.onMessage("*", (client, type, message) => {
      this.handleMessage(client, type as string, message);
    });

    this.clock.setTimeout(() => {
      if (this.gameState.status === "lobby") {
        this.disconnect();
      }
    }, LOBBY_TIMEOUT_MS);

    console.log(`[Room ${this.roomId}] Created`);
  }

  override onJoin(client: Client, options: { username?: string }) {
    const username =
      (options.username ?? "Player").slice(0, 20).trim() || "Player";

    if (this.gameState.status !== "lobby") {
      // Cek reconnect
      const existing = [...this.gameState.players.values()].find(
        (p) => p.username === username && !p.connected,
      );
      if (existing) {
        this.handleReconnect(client, existing);
        return;
      }
      client.leave(4000); // game sudah mulai, tidak bisa join
      return;
    }

    const player: Player = {
      sessionId: client.sessionId,
      username,
      hand: [],
      isAlive: true,
      hasBunker: false,
      isLocked: false,
      connected: true,
    };

    this.gameState.players.set(client.sessionId, player);
    this.gameState.turnOrder.push(client.sessionId);

    // Host = pemain pertama
    if (this.gameState.hostId === "") {
      this.gameState.hostId = client.sessionId;
    }

    console.log(
      `[Room ${this.roomId}] ${username} joined (${this.gameState.players.size}/${MAX_PLAYERS})`,
    );

    this.broadcastState();
    this.sendToClient(client, { type: "YOUR_HAND", cards: [] });
  }

  override async onLeave(client: Client, code?: number) {
    const player = this.gameState.players.get(client.sessionId);

    if (!player) {
      return;
    }

    if (this.gameState.status === "lobby") {
      // Di lobby: langsung remove
      this.gameState.players.delete(client.sessionId);

      this.gameState.turnOrder = this.gameState.turnOrder.filter(
        (id) => id !== client.sessionId,
      );

      // Pindah host kalau host keluar
      if (
        this.gameState.hostId === client.sessionId &&
        this.gameState.turnOrder.length > 0
      ) {
        this.gameState.hostId = this.gameState.turnOrder[0];
      }

      console.log(
        `[Room ${this.roomId}] ${player.username} left lobby (code: ${code})`,
      );
    } else {
      // Di game: tandai disconnected
      const newPlayers = new Map(this.gameState.players);

      newPlayers.set(client.sessionId, {
        ...player,
        connected: false,
      });

      this.gameState = {
        ...this.gameState,
        players: newPlayers,
      };

      console.log(
        `[Room ${this.roomId}] ${player.username} disconnected (code: ${code})`,
      );

      // Beri waktu reconnect
      this.clock.setTimeout(() => {
        const p = this.gameState.players.get(client.sessionId);

        if (p && !p.connected) {
          this.eliminateDisconnected(client.sessionId);
        }
      }, RECONNECT_TIMEOUT_MS);
    }

    this.broadcastState();
  }

  override onDispose() {
    console.log(`[Room ${this.roomId}] Disposed`);
  }

  // ============================================================
  // RECONNECT
  // ============================================================
  private handleReconnect(client: Client, existing: Player) {
    const newPlayers = new Map(this.gameState.players);
    // Update sessionId ke yang baru
    newPlayers.delete(existing.sessionId);
    const updatedPlayer = {
      ...existing,
      sessionId: client.sessionId,
      connected: true,
    };
    newPlayers.set(client.sessionId, updatedPlayer);

    this.gameState = {
      ...this.gameState,
      players: newPlayers,
      turnOrder: this.gameState.turnOrder.map((id) =>
        id === existing.sessionId ? client.sessionId : id,
      ),
      hostId:
        this.gameState.hostId === existing.sessionId
          ? client.sessionId
          : this.gameState.hostId,
    };

    console.log(`[Room ${this.roomId}] ${existing.username} reconnected`);
    this.sendToClient(client, { type: "YOUR_HAND", cards: updatedPlayer.hand });
    this.broadcastState();
  }

  // ============================================================
  // ELIMINATE DISCONNECTED
  // ============================================================
  private eliminateDisconnected(sessionId: string) {
    const player = this.gameState.players.get(sessionId);
    if (!player || !player.isAlive) return;

    const newPlayers = new Map(this.gameState.players);
    newPlayers.set(sessionId, { ...player, isAlive: false, hand: [] });
    this.gameState = { ...this.gameState, players: newPlayers };

    // Cek apakah game selesai
    const alivePlayers = [...newPlayers.values()].filter((p) => p.isAlive);
    if (alivePlayers.length === 1) {
      this.gameState = {
        ...this.gameState,
        status: "finished",
        winner: alivePlayers[0].sessionId,
        log: [
          ...this.gameState.log,
          {
            timestamp: Date.now(),
            message: `${player.username} dieliminasi karena disconnect. ${alivePlayers[0].username} menang! 🏆`,
            type: "win",
          },
        ],
      };
    } else {
      // Advance turn jika giliran player ini
      const current = getCurrentPlayer(this.gameState);

      if (current?.sessionId === sessionId) {
        this.gameState = advanceTurn(this.gameState);
      }
    }

    this.broadcastState();
  }

  // ============================================================
  // MESSAGE HANDLER
  // ============================================================
  private handleMessage(client: Client, type: string, payload: unknown) {
    const msg = { type, ...(payload as object) } as ClientMessage;

    try {
      switch (msg.type) {
        case "START_GAME":
          this.handleStartGame(client);
          break;
        case "DRAW_CARD":
          this.handleDrawCard(client);
          break;
        case "PLAY_CARD":
          this.handlePlayCard(client, msg.cardId, msg.targetId);
          break;
        case "PLAY_GANG":
          this.handlePlayGang(
            client,
            msg.cardIds,
            msg.targetId,
            msg.targetCardId,
          );
          break;
        case "USE_WATER_BUCKET":
          this.handleWaterBucket(client, msg.insertPosition);
          break;
        case "BRIBE_GIVE_CARD":
          this.handleBribeGive(client, msg.cardId);
          break;
        case "PEEK_SWAP_DECISION":
          this.handlePeekSwap(client, msg.swap, msg.cardId);
          break;
        case "FLOOD_DISCARD":
          this.handleFloodDiscard(client, msg.cardId);
          break;
        case "FREEZE_PLAY":
          this.handleFreeze(client);
          break;
        case "GANG_RAINBOW_CONFIRM":
          this.handleGangRainbow(client, msg.targetId);
          break;
        default:
          this.sendError(client, `Unknown message type: ${type}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[Room ${this.roomId}] Error handling ${type}:`, message);
      this.sendError(client, message);
    }
  }

  // ============================================================
  // HANDLERS
  // ============================================================
  private handleStartGame(client: Client) {
    if (client.sessionId !== this.gameState.hostId)
      throw new Error("Hanya host yang bisa mulai game!");
    if (this.gameState.status !== "lobby")
      throw new Error("Game sudah berjalan!");
    if (this.gameState.players.size < MIN_PLAYERS)
      throw new Error(`Minimal ${MIN_PLAYERS} pemain!`);

    this.gameState = setupGame(this.gameState);
    this.broadcastState();
    console.log(
      `[Room ${this.roomId}] Game started with ${this.gameState.players.size} players`,
    );
  }

  private handleDrawCard(client: Client) {
    const current = getCurrentPlayer(this.gameState);
    if (current?.sessionId !== client.sessionId)
      throw new Error("Bukan giliran kamu!");
    if (this.gameState.pendingAction)
      throw new Error("Selesaikan aksi yang pending dulu!");

    // Unlock lockdown setelah draw
    const player = this.gameState.players.get(client.sessionId)!;
    if (player.isLocked) {
      const newPlayers = new Map(this.gameState.players);
      newPlayers.set(client.sessionId, { ...player, isLocked: false });
      this.gameState = { ...this.gameState, players: newPlayers };
    }

    const result = drawCard(this.gameState, client.sessionId);
    this.gameState = result.state;

    this.broadcastState();

    // Kirim hand update ke pemain yang draw
    this.sendHandUpdate(client.sessionId);

    // Kirim peek result jika ada
    if (this.gameState.peekResult?.sessionId === client.sessionId) {
      const peekClient = this.clients.find(
        (c) => c.sessionId === client.sessionId,
      );
      if (peekClient) {
        this.sendToClient(peekClient, {
          type: "PEEK_RESULT",
          cards: this.gameState.peekResult.cards,
        });
      }
    }
  }

  private handlePlayCard(client: Client, cardId: string, targetId?: string) {
    validatePlayCard(this.gameState, client.sessionId, cardId);

    this.gameState = playCard(
      this.gameState,
      client.sessionId,
      cardId,
      targetId,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);

    // Kirim peek result
    if (this.gameState.peekResult?.sessionId === client.sessionId) {
      this.sendToClient(client, {
        type: "PEEK_RESULT",
        cards: this.gameState.peekResult.cards,
      });
    }
  }

  private handlePlayGang(
    client: Client,
    cardIds: string[],
    targetId?: string,
    targetCardId?: string,
  ) {
    const current = getCurrentPlayer(this.gameState);
    if (current?.sessionId !== client.sessionId)
      throw new Error("Bukan giliran kamu!");

    this.gameState = playGang(
      this.gameState,
      client.sessionId,
      cardIds,
      targetId,
      targetCardId,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
  }

  private handleWaterBucket(client: Client, insertPosition: number) {
    const pa = this.gameState.pendingAction;
    if (!pa || pa.type !== "WATER_BUCKET_PLACE")
      throw new Error("Tidak ada Water Bucket pending!");
    if (pa.initiatorId !== client.sessionId)
      throw new Error("Bukan kamu yang pakai Water Bucket!");

    const lavaCatCard = pa.data?.lavaCatCard as import("../types/cards").Card;
    this.gameState = placeLavaCat(this.gameState, lavaCatCard, insertPosition);
    this.broadcastState();
  }

  private handleBribeGive(client: Client, cardId: string) {
    const pa = this.gameState.pendingAction;
    if (!pa || pa.type !== "BRIBE_WAITING")
      throw new Error("Tidak ada Bribe aktif!");
    if (pa.targetId !== client.sessionId)
      throw new Error("Bukan kamu yang harus kasih kartu!");

    this.gameState = resolveBribe(this.gameState, client.sessionId, cardId);
    this.broadcastState();
    // Update hand untuk initiator dan target
    this.sendHandUpdate(pa.initiatorId);
    this.sendHandUpdate(client.sessionId);
  }

  private handlePeekSwap(client: Client, doSwap: boolean, cardId?: string) {
    const pa = this.gameState.pendingAction;
    if (!pa || pa.type !== "PEEK_AND_SWAP_DECIDE")
      throw new Error("Tidak ada Peek & Swap aktif!");
    if (pa.initiatorId !== client.sessionId)
      throw new Error("Bukan kamu yang main Peek & Swap!");

    this.gameState = resolvePeekAndSwap(
      this.gameState,
      client.sessionId,
      doSwap,
      cardId,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
  }

  private handleFloodDiscard(client: Client, cardId: string) {
    const pa = this.gameState.pendingAction;
    if (!pa) throw new Error("Tidak ada aksi aktif!");

    if (pa.type === "FLOOD_WAITING" && !pa.data?.isTimeWarp) {
      // Semua pemain buang kartu
      const player = this.gameState.players.get(client.sessionId)!;
      if (!player.isAlive) throw new Error("Kamu sudah mati!");
      if (pa.floodDiscarded?.includes(client.sessionId))
        throw new Error("Kamu sudah buang kartu!");

      this.gameState = resolveFloodDiscard(
        this.gameState,
        client.sessionId,
        cardId,
      );
    } else if (pa.data?.isTimeWarp && pa.initiatorId === client.sessionId) {
      // Time Warp: ambil dari discard pile
      this.gameState = resolveTimeWarp(
        this.gameState,
        client.sessionId,
        cardId,
      );
    } else {
      throw new Error("Bukan giliranmu untuk aksi ini!");
    }

    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
  }

  private handleFreeze(client: Client) {
    // Cari kartu freeze di tangan
    const player = this.gameState.players.get(client.sessionId)!;
    const freezeCard = player.hand.find((c) => c.type === "FREEZE");
    if (!freezeCard) throw new Error("Tidak punya kartu Freeze!");

    this.gameState = playFreeze(
      this.gameState,
      client.sessionId,
      freezeCard.id,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
  }

  private handleGangRainbow(client: Client, targetId: string) {
    const pa = this.gameState.pendingAction;

    if (!pa || pa.type !== "GANG_RAINBOW_TARGET") {
      throw new Error("Tidak ada Rainbow Gang aktif!");
    }

    if (pa.initiatorId !== client.sessionId) {
      throw new Error("Bukan kamu yang main Rainbow Gang!");
    }

    this.gameState = executeGangRainbow(
      this.gameState,
      client.sessionId,
      targetId,
    );

    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
    this.sendHandUpdate(targetId);
  }

  // ============================================================
  // BROADCAST HELPERS
  // ============================================================
  private broadcastState() {
    // Kirim state umum (tanpa hand spesifik) ke semua
    for (const client of this.clients) {
      const state = serializeForClient(this.gameState, client.sessionId);
      this.sendToClient(client, { type: "GAME_STATE_UPDATE", state });
    }
  }

  private sendHandUpdate(sessionId: string) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    const player = this.gameState.players.get(sessionId);
    if (client && player) {
      this.sendToClient(client, { type: "YOUR_HAND", cards: player.hand });
    }
  }

  private sendToClient(client: Client, message: object) {
    try {
      client.send("message", message);
    } catch {
      // client mungkin sudah disconnect
    }
  }

  private sendError(client: Client, message: string) {
    this.sendToClient(client, { type: "ERROR", message });
  }
}
