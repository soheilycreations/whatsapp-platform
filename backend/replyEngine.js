/**
 * replyEngine.js
 * OpenRouter AI Integration + Smart FAQ Priority + Chat History
 * Fully robust, production-ready WhatsApp Automation Engine for Soheily Creations.
 */

const supabase = require("./supabaseClient");

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

// ── OpenRouter API Reply (Dynamic Client Routing) ─────────────────────────────
async function aiReply(shopId, senderJid, text) {
  try {
    // 1. Supabase එකෙන් shop එකට වෙන් කරපු openrouter_api_key එකක් තියෙනවද බලනවා
    const { data: shopData } = await supabase
      .from("shops")
      .select("openrouter_api_key") // 💡 Column name එක openrouter_api_key ලෙස උපකල්පනය කර ඇත
      .eq("id", shopId)
      .single();

    let apiKey = null;

    if (shopData?.openrouter_api_key) {
      console.log(`[${shopId}] Using Client-Specific OpenRouter Key from DB.`);
      apiKey = shopData.openrouter_api_key;
    } else if (process.env.OPENROUTER_API_KEY) {
      console.log(`[${shopId}] Using Global OpenRouter Key from Render.`);
      apiKey = process.env.OPENROUTER_API_KEY;
    }

    if (!apiKey) {
      console.error(`[${shopId}] ERROR: No OpenRouter API Key found!`);
      return null;
    }

    const context = await buildContext(shopId);

    if (!conversationHistory.has(senderJid)) {
      conversationHistory.set(senderJid, []);
    }
    const history = conversationHistory.get(senderJid);

    // System Prompt (Trained & Constrained)
    const systemPrompt = `You are a smart, friendly, and helpful WhatsApp sales assistant for "Soheily Creations" (Sri Lanka).
Use the provided FAQ and Context to answer user questions beautifully.

Strict Rules for Greeting:
- ONLY say "Ayubowan" or greeting words if the customer is starting the conversation (like "Hi", "Hello", "Ayubowan").
- DO NOT repeat "Ayubowan", hello, or welcome messages in subsequent replies if the conversation is already ongoing. Just answer the question directly.

Response Style:
- Keep answers informative but concise (Max 3-4 sentences).
- Reply in the EXACT same language the user writes (If they write in Singlish, reply in Singlish/Sinhala. If Sinhala, reply in Sinhala).
- ALWAYS rely on the context data below to provide accurate answers.

CONTEXT DATA:
${context}`;

    console.log(`[${shopId}] Calling OpenRouter API for: ${text}...`);

    // OpenRouter එකේ තියෙන ලාභම සහ හොඳම Gemini මොඩල් එක
    const modelName = "google/gemini-2.5-flash"; 

    // OpenAI Format එකට හිස්ට්‍රි එක සකස් කිරීම
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(msg => ({ role: msg.role, content: msg.content })),
      { role: "user", content: text }
    ];

    // OpenRouter Native Fetch Request එක
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://soheilycreations.com", // 💡 OpenRouter එකට අවශ්‍යයි
        "X-Title": "Soheily WhatsApp Bot"
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages,
        max_tokens: 1000 // 💡 මැසේජ් බාගෙට කැපෙන එක සදහටම නවත්තන්න 1000 දැම්මා
      })
    });

    const data = await response.json();
    const replyText = data.choices?.[0]?.message?.content;

    if (!replyText) {
      console.error(`[${shopId}] OpenRouter Error Response:`, data);
      return null;
    }

    // හිස්ට්‍රි එක අප්ඩේට් කිරීම
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: replyText });

    if (history.length > MAX_HISTORY * 2) history.splice(0, 2);

    return replyText;
  } catch (err) {
    console.error(`[${shopId}] OpenRouter Top Level Error:`, err.message);
    return null;
  }
}

// ── Main handler (FAQ First, Then AI Fallback) ──────────────────────────────────
async function handleIncomingMessage(shopId, senderJid, text, waSocket) {
  try {
    if (senderJid && senderJid.endsWith("@g.us")) {
      console.log(`[${shopId}] Ignored group message from: ${senderJid}`);
      return; 
    }

    const { data: shop } = await supabase
      .from("shops")
      .select("auto_reply")
      .eq("id", shopId)
      .single();

    if (!shop?.auto_reply) return;

    let reply = null;
    let replyType = "none";

    // 1. FAQ / Keywords චෙක් කිරීම
    reply = await keywordMatch(shopId, text);
    if (reply) {
      replyType = "database_faq";
      console.log(`[${shopId}] ✓ Found in FAQ Database`);

      if (!conversationHistory.has(senderJid)) conversationHistory.set(senderJid, []);
      const hist = conversationHistory.get(senderJid);
      hist.push({ role: "user", content: text });
      hist.push({ role: "assistant", content: reply });
    }

    // 2. AI Fallback (OpenRouter)
    if (!reply) {
      reply = await aiReply(shopId, senderJid, text);
      if (reply) {
        replyType = "openrouter_ai";
        console.log(`[${shopId}] ✓ Generated by OpenRouter AI`);
      }
    }

    // 3. Fallback Closing
    if (!reply) {
      console.log(`[${shopId}] Both FAQ and AI unavailable. Sending closing fallback...`);
      reply = "ඔබගේ පණිවිඩයට බොහොම ස්තූතියි! ✨ මේ වෙලාවේ අපේ පද්ධතිය තරමක් කාර්යබහුලයි. අපගේ නියෝජිතයෙකු ඉතා ඉක්මනින් ඔබව පෞද්ගලිකව සම්බන්ධ කරගනු ඇත. සුභ දවසක්! 😊🙏";
      replyType = "closing_fallback";
    }

    await waSocket.sendMessage(senderJid, { text: reply });
    console.log(`[${shopId}] → Sent (${replyType})`);

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
