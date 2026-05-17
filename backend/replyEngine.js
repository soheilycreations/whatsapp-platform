/**
 * replyEngine.js — Resilient & Creative AI Model (Strict Keywords + Closing Fallback)
 * Prioritizes Gemini AI with strict regex matching and elegant failure fallback.
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
        
        // වාක්‍යයක් මැද කෑල්ලක් මැච් වෙන්නේ නැතුව, තනි වචනයක් හෝ phrase එකක් විදියටම තිබ්බොත් විතරක් අල්ලනවා
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
    }
  }

  if (!success) return null;

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

    // පියවර 1: මුලින්ම AI එකෙන් උත්තරයක් ගන්න බලනවා
    if (process.env.GEMINI_API_KEY) {
      try {
        reply = await aiReply(shopId, senderJid, text);
        if (reply) replyType = "ai";
      } catch (err) {
        console.error(`[${shopId}] General AI reply error:`, err.message);
      }
    }

    // පියවර 2: Gemini ලිමිට් පැන්නොත් (Null ආවොත්), Strict Keyword Match එක චෙක් කරනවා
    if (!reply) {
      console.log(`[${shopId}] AI unavailable. Trying strict keyword matching...`);
      reply = await keywordMatch(shopId, text);
      if (reply) replyType = "keyword_fallback";
    }

    // පියවර 3: Keyword එකකුත් නැත්නම්, ලස්සන ක්ලෝසින් මැසේජ් එකක් දීලා ඉවර කරනවා
    if (!reply) {
      console.log(`[${shopId}] Both AI and Keywords failed. Sending closing fallback...`);
      reply = "ඔබගේ පණිවිඩයට බොහොම ස්තූතියි! ✨ මේ වෙලාවේ අපේ AI පද්ධතිය කාර්යබහුලයි. අපගේ නියෝජිතයෙකු ඉතා ඉක්මනින් ඔබව පෞද්ගලිකව සම්බන්ධ කරගනු ඇත. සුභ දවසක්! 😊🙏";
      replyType = "closing_fallback";
    }

    // පියවර 4: මැසේජ් එක යවනවා
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
