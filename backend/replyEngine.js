/**
 * replyEngine.js
 * Native Gemini AI Integration + Strict Regex Fallbacks (No External Axios Needed)
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
    context += "## FAQ Reference:\n" + faqs.map((f) => `Q: ${f.question} -> A: ${f.answer}`).join("\n");
  }
  if (docs && docs.length > 0) {
    context += "\n\n## Business Documents:\n";
    docs.forEach((doc) => { context += `${doc.content.slice(0, 1500)} `; });
  }
  return context;
}

// ── Direct Native Gemini AI Reply ─────────────────────────────────────────────
async function aiReply(shopId, senderJid, text) {
  if (!genAI) {
    console.error(`[${shopId}] Gemini API Key missing in environment variables`);
    return null;
  }

  try {
    const context = await buildContext(shopId);

    if (!conversationHistory.has(senderJid)) {
      conversationHistory.set(senderJid, []);
    }
    const history = conversationHistory.get(senderJid);

    const systemPrompt = `You are a smart, friendly, and helpful WhatsApp sales assistant for "Soheily Creations". 
Use the following FAQ and context to answer user questions nicely in a catchy way.
Reply in the SAME language the customer uses (Sinhala, English, or Singlish). Keep it brief (2-3 sentences max).

CONTEXT:
${context}`;

    console.log(`[${shopId}] Calling Native Gemini API for: ${text.substring(0, 50)}...`);

    // Resilient model fallback
    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    let responseText = null;

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        
        let fullPrompt = `${systemPrompt}\n\n`;
        history.slice(-4).forEach(msg => {
          fullPrompt += msg.role === "user" ? `Customer: ${msg.content}\n` : `Bot: ${msg.content}\n`;
        });
        fullPrompt += `Customer: ${text}\nBot:`;

        const result = await model.generateContent(fullPrompt);
        responseText = result.response.text();
        if (responseText) break;
      } catch (err) {
        console.error(`[${shopId}] Model ${modelName} failed, trying next...`);
      }
    }

    if (!responseText) return null;

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: responseText });

    if (history.length > MAX_HISTORY * 2) history.splice(0, 2);

    console.log(`[${shopId}] Gemini reply success!`);
    return responseText;
  } catch (err) {
    console.error(`[${shopId}] Native AI Error:`, err.message);
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

    // 1. Try AI First
    reply = await aiReply(shopId, senderJid, text);
    if (reply) replyType = "ai";

    // 2. Keyword Fallback if AI fails
    if (!reply) {
      console.log(`[${shopId}] AI failed. Trying strict keyword matching...`);
      reply = await keywordMatch(shopId, text);
      if (reply) replyType = "keyword_fallback";
    }

    // 3. Final Closing Fallback
    if (!reply) {
      console.log(`[${shopId}] Sending closing fallback...`);
      reply = "ඔබගේ පණිවිඩයට බොහොම ස්තූතියි! ✨ මේ වෙලාවේ අපේ AI පද්ධතිය කාර්යබහුලයි. අපගේ නියෝජිතයෙකු ඉතා ඉක්මනින් ඔබව පෞද්ගලිකව සම්බන්ධ කරගනු ඇත. සුභ දවසක්! 😊🙏";
      replyType = "closing_fallback";
    }

    if (reply) {
      await waSocket.sendMessage(senderJid, { text: reply });
      console.log(`[${shopId}] → Sent (${replyType})`);
    }

    await logMessage(shopId, senderJid, text, reply, replyType);
  } catch (err) {
    console.error(`[${shopId}] Error:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
