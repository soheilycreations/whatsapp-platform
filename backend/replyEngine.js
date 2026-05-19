/**
 * replyEngine.js — Resilient & Creative AI Model (Updated for Gemini 1.5 Flash)
 * Optimized for high limits and stable WhatsApp performance.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const supabase = require("./supabaseClient");

let genAI;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

const conversationHistory = new Map();
const MAX_HISTORY = 10;

// ── Keyword match (Strict exact word matching via RegEx) ─────────────────────
async function keywordMatch(shopId, text) {
  const { data: faqs } = await supabase
    .from("faqs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("is_active", true);

  if (!faqs || faqs.length === 0) return null;

  const lowerText = text.toLowerCase();
  
  for (const faq of faqs) {
    if (faq.keywords && faq.keywords.length > 0) {
      for (const kw of faq.keywords) {
        const lowerKw = kw.toLowerCase();
        const regex = new RegExp(`\\b${escapeRegExp(lowerKw)}\\b`, 'i');
        
        if (regex.test(lowerText) || lowerText === lowerKw) {
          return faq.answer;
        }
      }
    }
  }
  return null;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Build context from FAQs + Documents ───────────────────────────────────────
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
    context += "## Frequently Asked Questions\n";
    context += faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
    context += "\n\n";
  }

  if (docs && docs.length > 0) {
    context += "## Deep Business Knowledge Documents\n";
    docs.forEach((doc) => {
      // මෙතන 2000ට අඩු කළා Token limit එක පනින එක නතර කරන්න
      const content = doc.content.slice(0, 2000); 
      context += `### Document: ${doc.file_name}\n${content}\n\n`;
    });
  }

  return context || "No knowledge base available yet.";
}

// ── Gemini AI reply ───────────────────────────────────────────────────────────
async function aiReply(shopId, senderJid, text) {
  if (!genAI) return null;

  const context = await buildContext(shopId);

  if (!conversationHistory.has(senderJid)) {
    conversationHistory.set(senderJid, []);
  }
  const history = conversationHistory.get(senderJid);

  const systemPrompt = `You are a smart, highly creative, and friendly WhatsApp sales assistant.
  
YOUR MISSION:
- Answer customer questions using ONLY the provided Knowledge Base below.
- Do NOT just copy-paste. Be conversational and helpful.
- Reply in the SAME language the customer uses (Sinhala, English, or Singlish).
- Keep it short (2-4 sentences max) + Use emojis naturally 😊.
- Always guide the customer to take the next step (buy/book).

KNOWLEDGE BASE:
${context}`;

  // නිවැරදි මොඩල් නම් (Flash models වල ලිමිට් වැඩියි)
  const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-flash-8b"];
  let reply = null;

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        systemInstruction: systemPrompt 
      });

      // Chat history එක Gemini format එකට සකස් කිරීම
      const chat = model.startChat({
        history: history.map(msg => ({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        })),
      });

      const result = await chat.sendMessage(text);
      reply = result.response.text();
      
      if (reply) break; 
    } catch (modelErr) {
      console.error(`[${shopId}] Model ${modelName} error:`, modelErr.message);
      // 429 error එකක් ආවොත් ඊළඟ මොඩල් එකට යනවා
    }
  }

  if (reply) {
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: reply });
    if (history.length > MAX_HISTORY * 2) history.splice(0, 2);
    return reply;
  }

  return null;
}

// ── Log to Supabase ───────────────────────────────────────────────────────────
async function logMessage(shopId, senderJid, messageText, replySent, replyType) {
  try {
    await supabase.from("messages").insert({
      shop_id: shopId,
      sender_jid: senderJid,
      message_text: messageText,
      reply_sent: replySent,
      reply_type: replyType,
    });
  } catch (err) {
    console.error("Logging error:", err.message);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleIncomingMessage(shopId, senderJid, text, waSocket) {
  try {
    const { data: shop } = await supabase
      .from("shops")
      .select("auto_reply")
      .eq("id", shopId)
      .single();

    if (!shop?.auto_reply) return;

    let reply = null;
    let replyType = "none";

    // 1. මුලින්ම AI උත්සාහ කරයි
    if (process.env.GEMINI_API_KEY) {
      reply = await aiReply(shopId, senderJid, text);
      if (reply) replyType = "ai";
    }

    // 2. AI ලිමිට් පැන්නොත් Keyword Match බලයි
    if (!reply) {
      reply = await keywordMatch(shopId, text);
      if (reply) replyType = "keyword_fallback";
    }

    // 3. දෙකම නැත්නම් Closing Message එක යවයි
    if (!reply) {
      reply = "ඔබගේ පණිවිඩයට ස්තූතියි! ✨ මේ වෙලාවේ අපේ පද්ධතියේ පොඩි කාර්යබහුලත්වයක් තියෙනවා. අපේ නියෝජිතයෙක් ඉක්මනින්ම ඔබට සහාය වෙයි. 😊";
      replyType = "closing_fallback";
    }

    // මැසේජ් එක යැවීම
    await waSocket.sendMessage(senderJid, { text: reply });
    console.log(`[${shopId}] → Reply sent (${replyType})`);

    // Log කිරීම
    await logMessage(shopId, senderJid, text, reply, replyType);

  } catch (err) {
    console.error(`[${shopId}] Global error:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
