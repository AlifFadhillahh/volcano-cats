import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
// import { monitor } from "@colyseus/monitor";
import { VolcanoCatsRoom } from "./rooms/VolcanoCatsRoom";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3000";

// ============================================================
// EXPRESS APP
// ============================================================
const app = express();

app.use(
  cors({
    origin: [CLIENT_URL, /\.vercel\.app$/],
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

app.use(express.json());

// Health check — Railway pakai ini
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Colyseus monitor (dev only)
// if (process.env.NODE_ENV !== "production") {
//   app.use("/colyseus", monitor());
// }

// ============================================================
// COLYSEUS SERVER
// ============================================================
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Register room
gameServer
  .define("volcano_cats", VolcanoCatsRoom)
  .filterBy(["roomId"])
  .sortBy({ clients: 1 }) // join room yang paling sedikit pemainnya
  .enableRealtimeListing();

// ============================================================
// START
// ============================================================
gameServer.listen(PORT).then(() => {
  console.log(`🌋 Volcano Cats Server running on port ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  if (process.env.NODE_ENV !== "production") {
    console.log(`🔍 Monitor: http://localhost:${PORT}/colyseus`);
  }
});
