/**
 * replyEngine.js — Gemini AI Version (Creative AI First with Resilient Fallback)
 * Prioritizes Gemini AI, but safely falls back to keywords if API Quota (429) hits.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const supabase = require("./supabaseClient");

let genAI;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

const conversationHistory = new Map();
const MAX_HISTORY = 10;

// ── Keyword match (Used as standard fallback) ───────────────────────────────
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
    context += "## Frequently Asked Questions (Use this as reference)\n";
    context += faqs.map((f) => `Question: ${f.question}\nSuggested Answer: ${f.answer}`).join("\n\n");
    context += "\n\n";
  }

  if (docs && docs.length > 0) {
    context += "## Deep Business Knowledge & Training Documents\n";
    docs.forEach((doc) => {
      const content = doc.content.slice(0, 4000);
      context += `### Document: ${doc.file_name}\n${content}\n\n`;
    });
  }

  return context || "No knowledge base available yet.";
}

// ── Gemini AI reply ───────────────────────────────────────────────────────────
async function aiReply(shopId, senderJid, text) {
  if (!genAI) {
    console.log("Gemini API key not configured");
    return null;
  }

  const context = await buildContext(shopId);

  if (!conversationHistory.has(senderJid)) {
    conversationHistory.set(senderJid, []);
  }
  const history = conversationHistory.get(senderJid);

  const systemPrompt = `You are a smart, highly creative, and friendly WhatsApp sales assistant for this business. 

YOUR MISSION:
- Answer customer questions using BOTH the FAQ reference AND the Deep Business Knowledge Documents provided below.
- Do NOT just copy-paste answers. Be conversational, natural, and helpful.
- Mix the information intelligently to give the best personalized response.

RULES:
- Reply in the SAME language the customer uses (Sinhala, English, or Singlish)
- Keep replies catchy, short, and engaging (2-4 sentences max, perfect for WhatsApp)
- Use emojis naturally 😊✨
- Always guide the customer towards making a purchase, booking, or taking the next step.
- Be warm and professional.

BUSINESS KNOWLEDGE BASE & TRAINED DATA:
${context}`;

  // 429 errors මඟහරින්න 1.5-flash එකත් අන්තිමට තියෙන්න ඇරියා ට්‍රැෆික් වැඩි වෙලාවට
  const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  let model;
  let result;
  let success = false;

  for (const modelName of modelsToTry) {
    try {
      model = genAI.getGenerativeModel({ model: modelName });

      let fullPrompt = systemPrompt + "\n\n";
      history.forEach(msg => {
        fullPrompt += msg.role === "user" ? `Customer: ${msg.content}\n` : `Assistant: ${msg.content}\n`;
      });
      fullPrompt += `Customer: ${text}\nAssistant:`;

      result = await model.generateContent(fullPrompt);
      success = true;
      break; 
    } catch (modelErr) {
      console.error(`Model ${modelName} failed during creative reply:`, modelErr.message);
      // මෙතනදී Error එක 429 (Quota) නම් ඊළඟ මොඩල් එකට යන්න ඉඩ දෙනවා
    }
  }

  if (!success) {
    return null; // AI එක සම්පූර්ණයෙන්ම ෆේල් වුණොත් null යවනවා handleIncomingMessage එකට fallback වෙන්න
  }

  const response = await result.response;
  const reply = response.text();

  history.push({ role: "user", content: text });
  history.push({ role: "assistant", content: reply });

  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, 2);
  }

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

// ── Main handler (Resilient AI First Logic) ───────────────────────────────────
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

    // පියවර 1: AI එකෙන් උත්තරයක් ගන්න බලනවා
    if (process.env.GEMINI_API_KEY) {
      try {
        reply = await aiReply(shopId, senderJid, text);
        if (reply) replyType = "ai";
      } catch (err) {
        console.error(`[${shopId}] General AI reply error:`, err.message);
      }
    }

    // පියවර 2: Gemini Quota Exceed වුණොත් හෝ වෙනත් අවුලකින් AI null වුණොත්,
    // සිස්ටම් එක ගොළු වෙන්න නොදී කෙලින්ම Keyword Match එකෙන් උත්තරයක් හොයනවා.
    if (!reply) {
      console.log(`[${shopId}] AI failed or hit limits. Falling back to Keyword Matching...`);
      reply = await keywordMatch(shopId, text);
      if (reply) {
        replyType = "keyword_fallback";
      } else {
        // Keyword එකකුත් නැත්නම් default fallback මැසේජ් එකක් දෙනවා බොට් නැවතීම පේන්න නොදී
        reply = "ඔබගේ පණිවිඩයට ස්තූතියි! අපගේ නියෝජිතයෙකු ළඟදීම ඔබව සම්බන්ධ කරගනු ඇත. 😊";
        replyType = "default_fallback";
      }
    }

    // පියවර 3: මැසේජ් එක යවනවා
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
