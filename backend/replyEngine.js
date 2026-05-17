/**
 * replyEngine.js — Full AI Sales Assistant (Updated to Gemini API)
 * 1. Load FAQs + knowledge docs from Supabase
 * 2. Try keyword match
 * 3. AI reply with full business context + conversation memory
 */

const { GoogleGenAI } = require("@google/genai"); // Anthropic ain karala Gemini aluth SDK eka damma
const supabase = require("./supabaseClient");

// Gemini client eka initialize කරනවා (.env eke GEMINI_API_KEY thiyenna ඕනෙ)
const ai = new GoogleGenAI(); 

// Simple in-memory conversation store: Map<jid, message[]>
const conversationHistory = new Map();
const MAX_HISTORY = 10; // keep last 10 messages per customer

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
    if (lower.includes(faq.question.toLowerCase())) return faq.answer;
  }
  return null;
}

// ── Build AI context from FAQs + uploaded docs ────────────────────────────────
async function buildContext(shopId) {
  // FAQs
  const { data: faqs } = await supabase
    .from("faqs")
    .select("question, answer")
    .eq("shop_id", shopId)
    .eq("is_active", true);

  // Knowledge docs
  const { data: docs } = await supabase
    .from("knowledge_docs")
    .select("file_name, content")
    .eq("shop_id", shopId);

  let context = "";

  if (faqs && faqs.length > 0) {
    context += "## FAQ / Quick Answers\n";
    context += faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
    context += "\n\n";
  }

  if (docs && docs.length > 0) {
    context += "## Business Knowledge Documents\n";
    docs.forEach((doc) => {
      // Gemini walata loku context ekak unath thiyanna puluwan, eth limits thiyaganna eka hodai
      const content = doc.content.slice(0, 3000);
      context += `### ${doc.file_name}\n${content}\n\n`;
    });
  }

  return context || "No knowledge base available yet.";
}

// ── AI reply with conversation memory ─────────────────────────────────────────
async function aiReply(shopId, senderJid, text) {
  const context = await buildContext(shopId);

  // Get or init conversation history
  if (!conversationHistory.has(senderJid)) {
    conversationHistory.set(senderJid, []);
  }
  const history = conversationHistory.get(senderJid);

  // Add new user message
  history.push({ role: "user", parts: [{ text: text }] }); // Gemini chat format ekata 'parts' damma

  // Keep only last N messages (user + model roles dekama nisa x2 karanne)
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, 2);
  }

  const systemPrompt = `You are a smart, friendly WhatsApp sales assistant for this business. Your job is to help customers, answer questions, suggest products/services, and close sales.

RULES:
- Reply in the SAME language the customer uses (Sinhala, English, etc.)
- Keep replies SHORT and conversational (2-4 sentences max for WhatsApp)
- Use emojis naturally 😊
- If a product/service is not available, suggest the closest alternative
- Always guide customer toward making a purchase or booking
- Never say "I don't know" — instead say you'll find out and ask them to contact directly
- Be warm, helpful, and professional

BUSINESS KNOWLEDGE BASE:
${context}`;

  // Gemini API එකෙන් response එක generate කිරීම
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash", // Speed සහ Cost අතින් WhatsApp Bot කෙනෙකුට සුපිරිම Model එක
    contents: history,
    config: {
      systemInstruction: systemPrompt, // Claude වල system එක වෙනුවට Gemini config.systemInstruction
      maxOutputTokens: 400,
    }
  });

  const reply = response.text;

  // Save assistant reply to history
  history.push({ role: "model", parts: [{ text: reply }] }); // Anthropic assistant -> Gemini model වෙනස් වුණා

  return reply;
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
    }

    // 2. AI fallback with full context + memory
    if (!reply && process.env.GEMINI_API_KEY) { // Env variable name eka change kala
      try {
        reply = await aiReply(shopId, senderJid, text);
        replyType = "ai";
      } catch (err) {
        console.error(`[${shopId}] AI reply error:`, err.message);
      }
    }

    // 3. Send reply
    if (reply) {
      await waSocket.sendMessage(senderJid, { text: reply });
      console.log(`[${shopId}] → Reply sent (${replyType})`);
    }

    await logMessage(shopId, senderJid, text, reply, replyType);
  } catch (err) {
    console.error(`[${shopId}] handleIncomingMessage error:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
