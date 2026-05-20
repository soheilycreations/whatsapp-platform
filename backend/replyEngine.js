/**
 * replyEngine.js
 * Native Gemini AI Integration + Smart FAQ Priority + Official Chat Sessions
 * Fully robust, production-ready WhatsApp Automation Engine for Soheily Creations.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const supabase = require("./supabaseClient");

// Render Environment Variables වලින් කෙලින්ම Gemini Key එක ගන්නවා
let genAI = null;
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
        
        // Exact keyword එකක්ද කියලා RegEx එකෙන් බලනවා (වචන මැද තියෙන කෑලි පැටලෙන්නේ නැති වෙන්න)
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

// ── Build Context for AI ──────────────────────────────────────────────────────
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
    context += "FAQ DATA:\n" + faqs.map((f) => `Q: ${f.question} - A: ${f.answer}`).join("\n") + "\n";
  }
  if (docs && docs.length > 0) {
    context += "KNOWLEDGE DOCUMENTS:\n";
    docs.forEach((doc) => { context += doc.content.slice(0, 1000) + " "; });
  }
  return context;
}

// ── Native Gemini AI Reply (Official Chat Session Method) ─────────────────────
async function aiReply(shopId, senderJid, text) {
  if (!genAI) {
    console.error(`[${shopId}] GEMINI_API_KEY is missing in Render!`);
    return null;
  }

  try {
    const context = await buildContext(shopId);

    if (!conversationHistory.has(senderJid)) {
      conversationHistory.set(senderJid, []);
    }
    const history = conversationHistory.get(senderJid);

    // AI එකට දෙන නියෝගය (System Prompt)
    const systemPrompt = `You are a smart, friendly, and helpful WhatsApp sales assistant for "Soheily Creations" (Sri Lanka).
Use the provided FAQ and Context to answer user questions beautifully.
- If the question is about pricing, WhatsApp bots, websites, or POS, give precise details based on context.
- Keep answers short and professional (Max 2-3 sentences).
- Reply in the EXACT same language the user writes (If they write in Singlish, reply in Singlish/Sinhala. If Sinhala, reply in Sinhala).
- ALWAYS rely on the context data below to provide accurate answers.

CONTEXT DATA:
${context}`;

    console.log(`[${shopId}] Calling Official Gemini Chat API for: ${text}...`);

    // Model Fallback Array (එකක් බැරි වුණොත් අනෙක)
    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    let replyText = null;

    // Gemini නිල Chat API එකට ගැලපෙන විදියට හිස්ට්‍රි Format එක සකස් කරගන්නවා (user -> model)
    const formattedHistory = history.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          systemInstruction: systemPrompt // System instruction එක නිල විදියටම දෙනවා
        });
        
        // නිල SDK Chat Session එකක් ආරම්භ කිරීම (History එක ස්ටේබල්ව තියාගන්න)
        const chat = model.startChat({
          history: formattedHistory,
          generationConfig: { maxOutputTokens: 250 }
        });

        const result = await chat.sendMessage(text);
        replyText = result.response.text();
        
        if (replyText) break; // සාර්ථකව රිප්ලයි එකක් ආවොත් ලූප් එක නවත්වනවා
      } catch (e) {
        console.error(`[${shopId}] Model ${modelName} chat session failed:`, e.message);
      }
    }

    if (!replyText) return null;

    // වැඩේ සාර්ථක නම් විතරක් අපේ local history එකට push කරනවා
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: replyText });

    if (history.length > MAX_HISTORY * 2) history.splice(0, 2);

    return replyText;
  } catch (err) {
    console.error(`[${shopId}] Gemini Native Chat Top Level Error:`, err.message);
    return null;
  }
}

// ── Main handler (FAQ First, Then AI Fallback) ──────────────────────────────────
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

    // 1. 💡 පළවෙනි පියවර: මුලින්ම FAQ / Keywords චෙක් කරනවා (Fast & 100% Correct)
    reply = await keywordMatch(shopId, text);
    if (reply) {
      replyType = "database_faq";
      console.log(`[${shopId}] ✓ Found in FAQ Database`);

      // FAQ එකෙන් දෙන උත්තරෙත් හිස්ට්‍රි එකට දානවා (එතකොට ඊළඟ පාර AI එක දන්නවා FAQ එකෙන් උත්තරයක් දීලා තියෙන්නේ කියලා)
      if (!conversationHistory.has(senderJid)) conversationHistory.set(senderJid, []);
      const hist = conversationHistory.get(senderJid);
      hist.push({ role: "user", content: text });
      hist.push({ role: "assistant", content: reply });
    }

    // 2. දෙවැනි පියවර: FAQ එකේ නැත්නම් විතරක් Gemini AI එකට දෙනවා (Smart Handling)
    if (!reply) {
      reply = await aiReply(shopId, senderJid, text);
      if (reply) {
        replyType = "gemini_ai";
        console.log(`[${shopId}] ✓ Generated by Gemini AI`);
      }
    }

    // 3. තුන්වැනි පියවර: දෙකම නැත්නම් විතරක් "Busy" මැසේජ් එක දෙනවා (බොට් ගොළු වෙන්නේ නැහැ)
    if (!reply) {
      console.log(`[${shopId}] Both FAQ and AI unavailable. Sending closing fallback...`);
      reply = "ඔබගේ පණිවිඩයට බොහොම ස්තූතියි! ✨ මේ වෙලාවේ අපේ පද්ධතිය තරමක් කාර්යබහුලයි. අපගේ නියෝජිතයෙකු ඉතා ඉක්මනින් ඔබව පෞද්ගලිකව සම්බන්ධ කරගනු ඇත. සුභ දවසක්! 😊🙏";
      replyType = "closing_fallback";
    }

    // WhatsApp එකෙන් මැසේජ් එක යැවීම
    await waSocket.sendMessage(senderJid, { text: reply });
    console.log(`[${shopId}] → Sent (${replyType})`);

    // Supabase එකට මැසේජ් එක සේව් කිරීම (Dashboard එකට පේන්න)
    await supabase.from("messages").insert({
      shop_id: shopId,
      sender_jid: senderJid,
      message_text: text,
      reply_sent: reply,
      reply_type: replyType,
    });

  } catch (err) {
    console.error(`[${shopId}] Error in handleIncomingMessage:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
