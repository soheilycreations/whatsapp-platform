/**
 * whatsappManager.js
 *
 * Manages per-tenant Baileys WhatsApp sessions.
 * Each session is keyed by `shopId` and holds the Baileys socket,
 * auth state, and a cleanup function.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const path = require("path");
const fs = require("fs");

// Suppress verbose Baileys logs in development — swap to 'info' if you need them
const logger = pino({ level: "silent" });

// ── In-memory session store ───────────────────────────────────────────────────
// Map<shopId, { socket: WASocket, cleanup: () => void }>
const sessions = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the filesystem path used to persist auth credentials for a shop.
 */
function authPath(shopId) {
  const dir = path.resolve(__dirname, "sessions", shopId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates (or re-creates) a Baileys session for the given shopId.
 *
 * @param {string}   shopId   - Unique tenant identifier
 * @param {import("socket.io").Socket} clientSocket - The Socket.io socket for this client
 */
async function createSession(shopId, clientSocket) {
  // Tear down any existing session for this shop before starting fresh
  await destroySession(shopId);

  const { state, saveCreds } = await useMultiFileAuthState(authPath(shopId));
  const { version } = await fetchLatestBaileysVersion();

  const waSocket = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // Do NOT mark messages as read automatically
    markOnlineOnConnect: false,
    // Ignore broadcast/status messages to reduce noise
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
    browser: ["WhatsApp Bot Platform", "Chrome", "1.0.0"],
  });

  // ── Event: credentials updated ──────────────────────────────────────────────
  waSocket.ev.on("creds.update", saveCreds);

  // ── Event: connection lifecycle ─────────────────────────────────────────────
  waSocket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // 1. New QR code available → relay raw QR string to the frontend
    if (qr) {
      console.log(`[${shopId}] QR code received — forwarding to client`);
      clientSocket.emit("qr", { qr });
      clientSocket.emit("status", { status: "connecting" });
    }

    // 2. Connection opened successfully
    if (connection === "open") {
      console.log(`[${shopId}] WhatsApp connected ✓`);
      clientSocket.emit("status", { status: "connected" });
    }

    // 3. Connection closed
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `[${shopId}] Connection closed. Code: ${statusCode}. Reconnect: ${shouldReconnect}`
      );

      clientSocket.emit("status", { status: "disconnected" });

      if (shouldReconnect) {
        // Exponential back-off could be added here for production
        console.log(`[${shopId}] Attempting reconnection in 3s…`);
        setTimeout(() => createSession(shopId, clientSocket), 3000);
      } else {
        // Logged-out: remove persisted auth so the next scan starts fresh
        console.log(`[${shopId}] Logged out — clearing auth state`);
        sessions.delete(shopId);
        fs.rmSync(authPath(shopId), { recursive: true, force: true });
      }
    }
  });

  // ── Event: incoming messages ────────────────────────────────────────────────
  waSocket.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const sender = msg.key.remoteJid;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "[non-text message]";

      console.log(`[${shopId}] ← Message from ${sender}: ${text}`);

      // TODO: Route message to the knowledge-base / reply handler
    }
  });

  // Store reference so we can tear it down later
  sessions.set(shopId, {
    socket: waSocket,
    cleanup: () => {
      waSocket.ev.removeAllListeners();
      waSocket.end();
    },
  });

  console.log(`[${shopId}] Session initialised`);
}

/**
 * Cleanly destroys an existing session without removing auth credentials.
 * Call before re-creating a session for the same shopId.
 *
 * @param {string} shopId
 */
async function destroySession(shopId) {
  if (!sessions.has(shopId)) return;

  const { cleanup } = sessions.get(shopId);
  try {
    cleanup();
  } catch (_) {
    // Ignore errors during teardown
  }
  sessions.delete(shopId);
  console.log(`[${shopId}] Session destroyed`);
}

/**
 * Returns true when an active session exists for the given shopId.
 *
 * @param {string} shopId
 * @returns {boolean}
 */
function hasSession(shopId) {
  return sessions.has(shopId);
}

module.exports = { createSession, destroySession, hasSession };
