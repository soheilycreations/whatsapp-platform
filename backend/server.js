/**
 * server.js
 *
 * Entry point for the Multi-Tenant WhatsApp Bot Platform backend.
 * Starts an Express + Socket.io server that manages per-tenant
 * WhatsApp sessions via the Baileys library.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { createSession, destroySession } = require("./whatsappManager");

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

// ── Express setup ─────────────────────────────────────────────────────────────
const app = express();

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST"],
  })
);

app.use(express.json());

// Health-check endpoint — useful for load balancers / uptime monitors
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── HTTP + Socket.io setup ────────────────────────────────────────────────────
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST"],
  },
  // Increase ping timeout for long-lived QR sessions
  pingTimeout: 60000,
});

// ── Socket.io connection handler ──────────────────────────────────────────────
io.on("connection", (socket) => {
  // The client is expected to pass shopId as a query parameter:
  // e.g.  io("http://localhost:5000", { query: { shopId: "shop_123" } })
  const shopId = socket.handshake.query?.shopId;

  if (!shopId) {
    console.warn("Socket connected without shopId — disconnecting");
    socket.emit("error", { message: "shopId is required" });
    socket.disconnect(true);
    return;
  }

  console.log(`[${shopId}] Client connected  (socketId: ${socket.id})`);

  // ── Client requests QR / session initialisation ───────────────────────────
  socket.on("start_session", async () => {
    console.log(`[${shopId}] start_session event received`);
    try {
      socket.emit("status", { status: "connecting" });
      await createSession(shopId, socket);
    } catch (err) {
      console.error(`[${shopId}] Failed to create session:`, err);
      socket.emit("error", { message: "Failed to start WhatsApp session" });
    }
  });

  // ── Client requests explicit disconnect ───────────────────────────────────
  socket.on("disconnect_session", async () => {
    console.log(`[${shopId}] disconnect_session event received`);
    await destroySession(shopId);
    socket.emit("status", { status: "disconnected" });
  });

  // ── Socket transport disconnected ─────────────────────────────────────────
  socket.on("disconnect", (reason) => {
    console.log(`[${shopId}] Socket disconnected (reason: ${reason})`);
    // NOTE: We intentionally do NOT destroy the Baileys session here.
    // The WhatsApp session should remain alive on the server even when
    // the browser tab is closed, allowing messages to be processed.
    // Call destroySession explicitly only when the user logs out.
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🚀  WhatsApp Bot Backend running`);
  console.log(`   HTTP  →  http://localhost:${PORT}`);
  console.log(`   WS    →  ws://localhost:${PORT}`);
  console.log(`   CORS  →  ${FRONTEND_ORIGIN}\n`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down gracefully");
  httpServer.close(() => process.exit(0));
});
