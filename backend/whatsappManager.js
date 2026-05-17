/**
 * whatsappManager.js — Database Backed Auth (Supabase Session Sync)
 * Fixes Render server restarts causing WhatsApp logouts.
 */

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  initAuthCreds,
  BufferJSON
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const supabase = require("./supabaseClient");
const { handleIncomingMessage } = require("./replyEngine");

const logger = pino({ level: "silent" });
const sessions = new Map();

// ── Custom Database Auth State Handling ─────────────────────────────────────
async function useDatabaseAuthState(shopId) {
  // 1. Database එකෙන් පරණ සෙෂන් දත්ත තියෙනවද බලනවා
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select("session_data")
    .eq("shop_id", shopId)
    .single();

  let creds;
  let keys = {};

  if (data?.session_data) {
    try {
      const parsed = JSON.parse(data.session_data, BufferJSON.reviver);
      creds = parsed.creds;
      keys = parsed.keys || {};
    } catch (e) {
      console.error(`[${shopId}] Error parsing session data, resetting...`);
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
  }

  // සෙෂන් දත්ත ඩේටාබේස් එකට සේව් කරන custom function එක
  const saveState = async () => {
    const sessionDataStr = JSON.stringify({ creds, keys }, BufferJSON.replacer);
    await supabase.from("whatsapp_sessions").upsert({
      shop_id: shopId,
      session_data: sessionDataStr,
      updated_at: new Date().toISOString()
    });
  };

  return {
    state: {
      creds,
      keys: {
        get: (type, ids) => {
          const res = {};
          for (const id of ids) {
            if (keys[type]?.[id]) {
              res[id] = keys[type][id];
            }
          }
          return res;
        },
        set: (data) => {
          for (const type in data) {
            if (!keys[type]) keys[type] = {};
            for (const id in data[type]) {
              if (data[type][id] === null) {
                delete keys[type][id];
              } else {
                keys[type][id] = data[type][id];
              }
            }
          }
          saveState(); // මොනවා හරි කී එකක් අප්ඩේට් වුණොත් DB එකට සේව් කරනවා
        }
      }
    },
    saveCreds: async () => {
      await saveState(); // Creds අප්ඩේට් වුණොත් DB එකට සේව් කරනවා
    }
  };
}

// ── Create Session ──────────────────────────────────────────────────────────
async function createSession(shopId, clientSocket) {
  await destroySession(shopId);

  // ඩේටාබේස් එකෙන් Auth State එක ලෝඩ් කරගන්නවා
  const { state, saveCreds } = await useDatabaseAuthState(shopId);
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
      clientSocket.emit("qr", { qr });
      clientSocket.emit("status", { status: "connecting" });
    }

    if (connection === "open") {
      console.log(`[${shopId}] WhatsApp connected ✓ (Synced to DB)`);
      clientSocket.emit("status", { status: "connected" });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      clientSocket.emit("status", { status: "disconnected" });

      if (shouldReconnect) {
        console.log(`[${shopId}] Connection lost. Reconnecting in 3s...`);
        setTimeout(() => createSession(shopId, clientSocket), 3000);
      } else {
        console.log(`[${shopId}] Logged out by user. Clearing database session...`);
        sessions.delete(shopId);
        await supabase.from("whatsapp_sessions").delete().eq("shop_id", shopId);
      }
    }
  });

  // ── Incoming messages ─────────────────────────────────────────────────────
  waSocket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const senderJid = msg.key.remoteJid;
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
  try { cleanup(); } catch (_) {}
  sessions.delete(shopId);
}

function hasSession(shopId) {
  return sessions.has(shopId);
}

module.exports = { createSession, destroySession, hasSession };
