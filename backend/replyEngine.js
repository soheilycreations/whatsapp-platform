/**
 * replyEngine.js
 * Uses Soheily Creations AI API (With Safe History Management & Smart FAQ Fallback)
 */

const axios = require("axios");
const supabase = require("./supabaseClient");

const AI_API_URL = process.env.AI_API_URL || "http://localhost:5000/api/ai";
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
        
        // තනි වචනයක් හෝ phrase එකක් විදියටම තිබ්බොත් විතරක් අල්ලනවා
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
    context += "FAQ: " + faqs.map((f) => `${f.question} - ${f.answer}`).join(" | ");
  }

  if (docs && docs.length > 0) {
    let docContent = "";
    docs.forEach((doc) => {
      docContent += doc.content.slice(0, 1500) + " ";
    });
    context += " DOCUMENTS: " + docContent;
  }

  return context.slice(0, 2000);
}

// ── AI reply via Soheily API ───────────────────────────────────────────────────
async function aiReply(shopId, senderJid, text) {
  try {
    const context = await buildContext(shopId);

    if (!conversationHistory.has(senderJid)) {
      conversationHistory.set(senderJid, []);
    }
    const history = conversationHistory.get(senderJid);

    console.log(`[${shopId}] Calling AI API for: ${text.substring(0, 50)}...`);

    // 💡 FIX: API එක සාර්ථක වුණොත් විතරක් හිස්ට්‍රි එකට දාන්න තාවකාලික array එකක් හදනවා
    const tempHistory = [...history, { role: "user", content: text }];

    const response = await axios.post(
      `${AI_API_URL}/generate`,
      {
        text: text,
        context: context,
        history: tempHistory.slice(-4), // සේෆ් හිස්ට්‍රි එක යවනවා
      },
      { timeout: 15000 }
    );

    const reply = response.data?.reply;

    if (!reply) {
      console.log(`[${shopId}] AI returned empty reply`);
      return null;
    }

    // API එක 100% ක් සක්සස් නම් විතරක් ඇත්තම හිස්ට්‍රි එකට push කරනවා (Roles මාරුවෙන් මාරුවට රැකෙනවා)
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: reply });

    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, 2);
    }

    console.log(`[${shopId}] AI reply success!`);
    return reply;
  } catch (err) {
    const errorDetails = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(`[${shopId}] AI API error details:`, errorDetails);
    return null; // AI ෆේල් වුණොත් null දීලා ඊළඟ පියවරට බාර දෙනවා
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

// ── Main handler (Smart Logic Flow) ──────────────────────────────────────────
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

    // 1. මුලින්ම AI එකෙන් උත්තරයක් ගන්න ට්‍රයි කරනවා (Creative First)
    reply = await aiReply(shopId, senderJid, text);
    if (reply) replyType = "ai";

    // 2. 💡 ඔයා ඉල්ලපු දේ: AI ෆේල් වුණොත් (හෝ කාර්යබහුල වුණොත්), බිසී කියලා කියන්නේ නැතුව FAQ වල තියෙනවද බලනවා
    if (!reply) {
      console.log(`[${shopId}] AI failed/busy. Instantly checking FAQ database fallback...`);
      reply = await keywordMatch(shopId, text);
      if (reply) replyType = "faq_fallback";
    }

    // 3. AI එකයි, FAQ ඩේටාබේස් එකයි දෙකම ඇතුළේ උත්තරයක් නැත්නම් විතරක් "Busy" මැසේජ් එක දෙනවා
    if (!reply) {
      console.log(`[${shopId}] No FAQ match found either. Sending final closing fallback...`);
      reply = "ඔබගේ පණිවිඩයට බොහොම ස්තූතියි! ✨ මේ වෙලාවේ අපේ AI පද්ධතිය කාර්යබහුලයි. අපගේ නියෝජිතයෙකු ඉතා ඉක්මනින් ඔබව පෞද්ගලිකව සම්බන්ධ කරගනු ඇත. සුභ දවසක්! 😊🙏";
      replyType = "closing_fallback";
    }

    // 4. මැසේජ් එක යැවීම
    if (reply) {
      await waSocket.sendMessage(senderJid, { text: reply });
      console.log(`[${shopId}] → Sent Response (${replyType})`);
    }

    // 5. Log කිරීම
    await logMessage(shopId, senderJid, text, reply, replyType);
  } catch (err) {
    console.error(`[${shopId}] Top level error:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
