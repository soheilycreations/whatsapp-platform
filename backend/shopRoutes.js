/**
 * shopRoutes.js
 * REST API for messages + shop settings.
 */

const express = require("express");
const router = express.Router();
const supabase = require("./supabaseClient");

// GET /api/messages?shopId=shop_123&limit=50
router.get("/messages", async (req, res) => {
  const { shopId, limit = 50 } = req.query;
  if (!shopId) return res.status(400).json({ error: "shopId required" });

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(Number(limit));

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/shop/:id
router.get("/shop/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("shops")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/shop/:id  (toggle auto_reply etc.)
router.patch("/shop/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("shops")
    .update(req.body)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
