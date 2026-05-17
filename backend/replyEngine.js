/**
 * replyEngine.js — Full AI Sales Assistant (Gemini Stable Version)
 */

const { GoogleGenAI } = require("@google/genai");
const supabase = require("./supabaseClient");

// Gemini Client setup
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

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
    if (lower.includes(faq.question.toLowerCase())) return faq.answer;
  }
  return null;
}

// ── Build AI context ──────────────────────────────────────────────────────────
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
    context += "## FAQ\n" + faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n") + "\n\n";
  }
  if (docs && docs.length > 0) {
    context += "## Knowledge Docs\n" + docs.map(doc => `### ${doc.file_name}\n${doc.content.slice(0, 3000)}`).join("\n\n");
  }
  return context || "No knowledge base available.";
}

// ── AI reply with stable Gemini Syntax ─────────────────────────────────────────
async function aiReply(shopId, senderJid, text) {
  const context = await buildContext(shopId);

  if (!conversationHistory.has(senderJid)) {
    conversationHistory.set(senderJid, []);
  }
  const history = conversationHistory.get(senderJid);

  const systemPrompt = `You are a smart, friendly WhatsApp sales assistant. 
  - Reply in the SAME language as the customer (Sinhala/English).
  - Keep it SHORT (2-4 sentences).
  - Use emojis.
  - Context: ${context}`;

  // Gemini model configuration
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", // Stable version එක
    systemInstruction: systemPrompt 
  });

  // History format එක Gemini වලට ගැලපෙන විදියට සකස් කිරීම
  const contents = history.map(msg => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }]
  }));

  // අලුත් මැසේජ් එක එකතු කිරීම
  contents.push({ role: "user", parts: [{ text: text }] });

  const result = await model.generateContent({ contents });
  const response = await result.response;
  const reply = response.text();

  // History update
  history.push({ role: "user", content: text });
  history.push({ role: "assistant", content: reply });

  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);

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
    const { data: shop } = await supabase.from("shops").select("auto_reply").eq("id", shopId).single();
    if (!shop?.auto_reply) return;

    let reply = await keywordMatch(shopId, text);
    let replyType = "keyword";

    if (!reply && process.env.GEMINI_API_KEY) {
      reply = await aiReply(shopId, senderJid, text);
      replyType = "ai";
    }

    if (reply) {
      await waSocket.sendMessage(senderJid, { text: reply });
    }
    await logMessage(shopId, senderJid, text, reply, replyType);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

module.exports = { handleIncomingMessage };
