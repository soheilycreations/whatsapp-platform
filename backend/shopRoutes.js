/**
 * shopRoutes.js
 * Shop management endpoints
 */

const express = require("express");
const router = express.Router();
const supabase = require("./supabaseClient");

// GET /api/shop/:id
router.get("/shop/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("shops")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/shop/:id
router.patch("/shop/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  console.log(`[${id}] Updating shop:`, updates);

  const { data, error } = await supabase
    .from("shops")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(`[${id}] Update error:`, error);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[${id}] ✓ Shop updated`);
  res.json(data);
});

module.exports = router;
