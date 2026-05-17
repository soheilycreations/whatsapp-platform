const { GoogleGenAI } = require("@google/genai");
const supabase = require("./supabaseClient");

// Gemini Setup
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

const conversationHistory = new Map();
const MAX_HISTORY = 10;

async function keywordMatch(shopId, text) {
  const { data: faqs } = await supabase.from("faqs").select("*").eq("shop_id", shopId).eq("is_active", true);
  if (!faqs) return null;
  const lower = text.toLowerCase();
  for (const faq of faqs) {
    if (faq.keywords?.some((kw) => lower.includes(kw.toLowerCase()))) return faq.answer;
    if (lower.includes(faq.question.toLowerCase())) return faq.answer;
  }
  return null;
}

async function buildContext(shopId) {
  const { data: faqs } = await supabase.from("faqs").select("question, answer").eq("shop_id", shopId).eq("is_active", true);
  const { data: docs } = await supabase.from("knowledge_docs").select("file_name, content").eq("shop_id", shopId);
  
  let context = "";
  if (faqs?.length) context += "FAQs:\n" + faqs.map(f => `Q: ${f.question} A: ${f.answer}`).join("\n");
  if (docs?.length) context += "\nDocs:\n" + docs.map(d => d.content).join("\n");
  return context || "No specific business info.";
}

async function aiReply(shopId, senderJid, text) {
  const context = await buildContext(shopId);
  
  // Model එක initialize කරන නිවැරදි ක්‍රමය
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash" 
  });

  if (!conversationHistory.has(senderJid)) conversationHistory.set(senderJid, []);
  const history = conversationHistory.get(senderJid);

  const systemPrompt = `You are a helpful WhatsApp assistant. 
  Context: ${context}
  Rules: Short replies, same language as user, use emojis.`;

  // අලුත්ම Gemini SDK එකේ chat format එක
  const chat = model.startChat({
    history: history.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    })),
    generationConfig: { maxOutputTokens: 500 },
  });

  // System instruction එක වෙනම යවන්න බැරි නම් Prompt එකට එකතු කරනවා
  const fullPrompt = `${systemPrompt}\n\nCustomer: ${text}`;
  
  const result = await chat.sendMessage(fullPrompt);
  const response = await result.response;
  const reply = response.text();

  // Update history
  history.push({ role: "user", content: text });
  history.push({ role: "assistant", content: reply });
  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);

  return reply;
}

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
  } catch (err) {
    console.error("Gemini API error:", err); // මෙතනින් තමයි log එකේ error එක පෙන්නන්නේ
  }
}

module.exports = { handleIncomingMessage };
