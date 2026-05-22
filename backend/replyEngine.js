/**
 * replyEngine.js — OpenRouter AI Version
 */

const axios = require("axios");
const supabase = require("./supabaseClient");

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
    context += "## FAQs\n";
    context += faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
    context += "\n\n";
  }

  if (docs && docs.length > 0) {
    context += "## Business Documents\n";
    docs.forEach((doc) => {
      context += `### ${doc.file_name}\n${doc.content.slice(0, 3000)}\n\n`;
    });
  }

  return context || "No knowledge base available.";
}

// ── OpenRouter AI reply ───────────────────────────────────────────────────────
async function aiReply(shopId, senderJid, text) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log(`[${shopId}] OPENROUTER_API_KEY not set`);
    return null;
  }

  const context = await buildContext(shopId);

  if (!conversationHistory.has(senderJid)) {
    conversationHistory.set(senderJid, []);
  }
  const history = conversationHistory.get(senderJid);

  // Add user message
  history.push({ role: "user", content: text });

  // Keep only last N messages
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, 2);
  }

  const systemPrompt = `You are a smart, friendly WhatsApp sales assistant for this business.

RULES:
- Reply in the SAME language the customer uses (Sinhala, English, Tamil, etc.)
- Keep replies SHORT (2-4 sentences max for WhatsApp)
- Use emojis naturally 😊
- If a product/service is not available, suggest the closest alternative
- Always guide customer toward making a purchase or booking
- Never say "I don't know" — ask them to contact directly instead
- Be warm, helpful, and professional

BUSINESS KNOWLEDGE BASE:
${context}`;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: process.env.OPENROUTER_MODEL || "mistralai/mistral-7b-instruct:free",
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
        ],
        max_tokens: 300,
        temperature: 0.7,
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://whatsapp-bot-backend-27d8.onrender.com",
          "X-Title": "WhatsApp Bot Platform",
        },
        timeout: 30000,
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      console.log(`[${shopId}] OpenRouter returned empty reply`);
      return null;
    }

    // Save assistant reply to history
    history.push({ role: "assistant", content: reply });

    console.log(`[${shopId}] ✓ OpenRouter reply: ${reply.substring(0, 60)}...`);
    return reply;

  } catch (err) {
    console.error(`[${shopId}] OpenRouter error:`, err.response?.data || err.message);
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

    // 1. Keyword match first (fast, free)
    reply = await keywordMatch(shopId, text);
    if (reply) {
      replyType = "keyword";
      console.log(`[${shopId}] ✓ Keyword match`);
    }

    // 2. OpenRouter AI fallback
    if (!reply) {
      try {
        reply = await aiReply(shopId, senderJid, text);
        if (reply) {
          replyType = "ai";
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
