/**
 * replyEngine.js
 *
 * Handles auto-reply logic:
 * 1. Check if shop has auto_reply enabled
 * 2. Try keyword match from FAQs
 * 3. Fall back to Claude AI with FAQ context
 * 4. Log message + reply to Supabase
 */

const Anthropic = require("@anthropic-ai/sdk");
const supabase = require("./supabaseClient");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Try to find a keyword match in the shop's FAQs
 */
async function keywordMatch(shopId, text) {
  const { data: faqs } = await supabase
    .from("faqs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("is_active", true);

  if (!faqs || faqs.length === 0) return null;

  const lower = text.toLowerCase();

  for (const faq of faqs) {
    // Check keywords array
    if (faq.keywords && faq.keywords.length > 0) {
      const matched = faq.keywords.some((kw) => lower.includes(kw.toLowerCase()));
      if (matched) return faq.answer;
    }
    // Check question itself
    if (lower.includes(faq.question.toLowerCase())) return faq.answer;
  }

  return null;
}

/**
 * Use Claude AI to generate a reply using FAQs as context
 */
async function aiReply(shopId, text) {
  const { data: faqs } = await supabase
    .from("faqs")
    .select("question, answer")
    .eq("shop_id", shopId)
    .eq("is_active", true);

  const faqContext =
    faqs && faqs.length > 0
      ? faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")
      : "No FAQs available.";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: `You are a helpful WhatsApp customer service bot. Answer the customer's question using the FAQ knowledge base below. Keep replies short and friendly (2-3 sentences max). If you cannot answer from the FAQ, politely say you'll get back to them.

FAQ Knowledge Base:
${faqContext}`,
    messages: [{ role: "user", content: text }],
  });

  return response.content[0].text;
}

/**
 * Log message and reply to Supabase
 */
async function logMessage(shopId, senderJid, messageText, replySent, replyType) {
  await supabase.from("messages").insert({
    shop_id: shopId,
    sender_jid: senderJid,
    message_text: messageText,
    reply_sent: replySent,
    reply_type: replyType,
  });
}

/**
 * Main reply handler — called from whatsappManager on incoming message
 */
async function handleIncomingMessage(shopId, senderJid, text, waSocket) {
  try {
    // 1. Check auto_reply setting
    const { data: shop } = await supabase
      .from("shops")
      .select("auto_reply")
      .eq("id", shopId)
      .single();

    if (!shop || !shop.auto_reply) {
      console.log(`[${shopId}] Auto-reply disabled — skipping`);
      await logMessage(shopId, senderJid, text, null, "none");
      return;
    }

    let reply = null;
    let replyType = "none";

    // 2. Try keyword match
    reply = await keywordMatch(shopId, text);
    if (reply) {
      replyType = "keyword";
      console.log(`[${shopId}] Keyword match found`);
    }

    // 3. Fall back to AI
    if (!reply && process.env.ANTHROPIC_API_KEY) {
      try {
        reply = await aiReply(shopId, text);
        replyType = "ai";
        console.log(`[${shopId}] AI reply generated`);
      } catch (err) {
        console.error(`[${shopId}] AI reply failed:`, err.message);
      }
    }

    // 4. Send reply on WhatsApp
    if (reply) {
      await waSocket.sendMessage(senderJid, { text: reply });
      console.log(`[${shopId}] → Reply sent (${replyType})`);
    }

    // 5. Log to Supabase
    await logMessage(shopId, senderJid, text, reply, replyType);
  } catch (err) {
    console.error(`[${shopId}] handleIncomingMessage error:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
