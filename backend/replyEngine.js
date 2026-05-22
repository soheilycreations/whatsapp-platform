/**
 * replyEngine.js
 * Uses Soheily Creations AI API
 */

const axios = require("axios");
const supabase = require("./supabaseClient");

const AI_API_URL = process.env.AI_API_URL || "http://localhost:5000/api/ai";
const conversationHistory = new Map();
const MAX_HISTORY = 10;

// ── Keyword match ─────────────────────────────────────────────────────────────
async function keywordMatch(shopId, text) {
  const { data: faqs } = await supabase
    .from("faqs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("is_active", true);

  if (!faqs || faqs.length === 0) return null;

  const lower = text.toLowerCase();
  for (const faq of faqs) {
    if (faq.keywords?.some((kw) => lower.includes(kw.toLowerCase()))) {
      return faq.answer;
    }
    if (lower.includes(faq.question.toLowerCase())) {
      return faq.answer;
    }
  }
  return null;
}

// ── Build context ─────────────────────────────────────────────────────────────
async function buildContext(shopId) {
  const { data: faqs } = await supabase
    .from("faqs")
    .select("question, answer")
    .eq("shop_id", shopId)
    .eq("is_active", true);

  const { data: docs } = await supabase
    .from("knowledge_docs")
    .select("file_name, content")
    .eq("shop_id", shopId);

  let context = "";

  if (faqs && faqs.length > 0) {
    context += "FAQ: " + faqs.map((f) => `${f.question} - ${f.answer}`).join(" | ");
  }

  if (docs && docs.length > 0) {
    let docContent = "";
    docs.forEach((doc) => {
      docContent += doc.content.slice(0, 1500) + " ";
    });
    context += " DOCUMENTS: " + docContent;
  }

  return context.slice(0, 2000);
}

// ── AI reply via Soheily API ───────────────────────────────────────────────────
async function aiReply(shopId, senderJid, text) {
  try {
    const context = await buildContext(shopId);

    // Get conversation history
    if (!conversationHistory.has(senderJid)) {
      conversationHistory.set(senderJid, []);
    }
    const history = conversationHistory.get(senderJid);

    // Add current message to history
    history.push({ role: "user", content: text });

    console.log(`[${shopId}] Calling AI API for: ${text.substring(0, 50)}...`);

    // Call Soheily AI API
    const response = await axios.post(
      `${AI_API_URL}/generate`,
      {
        text: text,
        context: context,
        history: history.slice(-4), // Last 4 messages
      },
      { timeout: 20000 }
    );

    const reply = response.data?.reply;

    if (!reply) {
      console.log(`[${shopId}] AI returned empty reply`);
      return null;
    }

    // Save to history
    history.push({ role: "assistant", content: reply });

    // Keep only last N messages
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, 2);
    }

    console.log(`[${shopId}] AI reply: ${reply.substring(0, 50)}...`);
    return reply;
  } catch (err) {
    console.error(`[${shopId}] AI API error:`, err.message);
    return null;
  }
}

// ── Log to Supabase ───────────────────────────────────────────────────────────
async function logMessage(shopId, senderJid, messageText, replySent, replyType) {
  await supabase.from("messages").insert({
    shop_id: shopId,
    sender_jid: senderJid,
    message_text: messageText,
    reply_sent: replySent,
    reply_type: replyType,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleIncomingMessage(shopId, senderJid, text, waSocket) {
  try {
    const { data: shop } = await supabase
      .from("shops")
      .select("auto_reply")
      .eq("id", shopId)
      .single();

    if (!shop?.auto_reply) {
      await logMessage(shopId, senderJid, text, null, "none");
      return;
    }

    let reply = null;
    let replyType = "none";

    // 1. Keyword match first (fast)
    reply = await keywordMatch(shopId, text);
    if (reply) {
      replyType = "keyword";
      console.log(`[${shopId}] ✓ Keyword match`);
    }

    // 2. AI fallback
    if (!reply) {
      try {
        reply = await aiReply(shopId, senderJid, text);
        if (reply) {
          replyType = "ai";
          console.log(`[${shopId}] ✓ AI reply`);
        }
      } catch (err) {
        console.error(`[${shopId}] AI error:`, err.message);
      }
    }

    // 3. Send reply
    if (reply) {
      await waSocket.sendMessage(senderJid, { text: reply });
      console.log(`[${shopId}] → Sent (${replyType})`);
    }

    // 4. Log
    await logMessage(shopId, senderJid, text, reply, replyType);
  } catch (err) {
    console.error(`[${shopId}] Error:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
