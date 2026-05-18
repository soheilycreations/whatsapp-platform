/**
 * whatsappManager.js — updated with replyEngine integration
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
const { handleIncomingMessage } = require("./replyEngine");

const logger = pino({ level: "silent" });
const sessions = new Map();

function authPath(shopId) {
  const dir = path.resolve(__dirname, "sessions", shopId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function createSession(shopId, clientSocket) {
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
    markOnlineOnConnect: false,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
    browser: ["WhatsApp Bot Platform", "Chrome", "1.0.0"],
  });

  waSocket.ev.on("creds.update", saveCreds);

  waSocket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`[${shopId}] QR code received — forwarding to client`);
      clientSocket.emit("qr", { qr });
      clientSocket.emit("status", { status: "connecting" });
    }

    if (connection === "open") {
      console.log(`[${shopId}] WhatsApp connected ✓`);
      clientSocket.emit("status", { status: "connected" });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `[${shopId}] Connection closed. Code: ${statusCode}. Reconnect: ${shouldReconnect}`
      );

      clientSocket.emit("status", { status: "disconnected" });

      if (shouldReconnect) {
        console.log(`[${shopId}] Attempting reconnection in 3s…`);
        setTimeout(() => createSession(shopId, clientSocket), 3000);
      } else {
        console.log(`[${shopId}] Logged out — clearing auth state`);
        sessions.delete(shopId);
        fs.rmSync(authPath(shopId), { recursive: true, force: true });
      }
    }
  });

  // ── Incoming messages → replyEngine ────────────────────────────────────────
  waSocket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const senderJid = msg.key.remoteJid;
      
      // 🛑 Ignore group messages
      if (senderJid.endsWith('@g.us')) {
        console.log(`[${shopId}] Ignoring group message from ${senderJid}`);
        continue;
      }
      
      // 🛑 Ignore broadcast/newsletter messages
      if (senderJid.includes('@newsletter') || senderJid.includes('@broadcast')) {
        console.log(`[${shopId}] Ignoring broadcast message`);
        continue;
      }

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        null;

      if (!text) continue;

      console.log(`[${shopId}] ← Message from ${senderJid}: ${text}`);
      await handleIncomingMessage(shopId, senderJid, text, waSocket);
    }
  });

  sessions.set(shopId, {
    socket: waSocket,
    cleanup: () => {
      waSocket.ev.removeAllListeners();
      waSocket.end();
    },
  });

  console.log(`[${shopId}] Session initialised`);
}

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

function hasSession(shopId) {
  return sessions.has(shopId);
}

module.exports = { createSession, destroySession, hasSession };
