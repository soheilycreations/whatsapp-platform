"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, Trash2, Pencil, Check, X, Tag, ToggleLeft, ToggleRight } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const SHOP_ID = "shop_123";

export default function KnowledgeBasePage() {
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoReply, setAutoReply] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ question: "", answer: "", keywords: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchFaqs();
    fetchShop();
  }, []);

  async function fetchFaqs() {
    setLoading(true);
    const res = await fetch(`${BACKEND_URL}/api/faqs?shopId=${SHOP_ID}`);
    const data = await res.json();
    setFaqs(data);
    setLoading(false);
  }

  async function fetchShop() {
    const res = await fetch(`${BACKEND_URL}/api/shop/${SHOP_ID}`);
    const data = await res.json();
    setAutoReply(data.auto_reply);
  }

  async function toggleAutoReply() {
    const newVal = !autoReply;
    setAutoReply(newVal);
    await fetch(`${BACKEND_URL}/api/shop/${SHOP_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_reply: newVal }),
    });
  }

  async function saveFaq() {
    if (!form.question || !form.answer) return;
    setSaving(true);

    const keywords = form.keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    if (editingId) {
      await fetch(`${BACKEND_URL}/api/faqs/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: form.question, answer: form.answer, keywords }),
      });
    } else {
      await fetch(`${BACKEND_URL}/api/faqs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: SHOP_ID, question: form.question, answer: form.answer, keywords }),
      });
    }

    setForm({ question: "", answer: "", keywords: "" });
    setShowForm(false);
    setEditingId(null);
    setSaving(false);
    fetchFaqs();
  }

  async function deleteFaq(id) {
    if (!confirm("Delete this FAQ?")) return;
    await fetch(`${BACKEND_URL}/api/faqs/${id}`, { method: "DELETE" });
    fetchFaqs();
  }

  async function toggleActive(faq) {
    await fetch(`${BACKEND_URL}/api/faqs/${faq.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !faq.is_active }),
    });
    fetchFaqs();
  }

  function startEdit(faq) {
    setForm({ question: faq.question, answer: faq.answer, keywords: (faq.keywords || []).join(", ") });
    setEditingId(faq.id);
    setShowForm(true);
  }

  return (
    <div className="px-8 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="h-5 w-5 text-purple-400" />
            <h1 className="text-2xl font-bold text-white tracking-tight">Knowledge Base</h1>
          </div>
          <p className="text-sm text-slate-400">Manage FAQs and auto-reply settings for shop_123</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-reply toggle */}
          <button
            onClick={toggleAutoReply}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border transition-all duration-200
              ${autoReply
                ? "bg-green-900/30 border-green-700/40 text-green-300"
                : "bg-white/5 border-white/10 text-slate-400"}`}
          >
            {autoReply
              ? <ToggleRight className="h-4 w-4" />
              : <ToggleLeft className="h-4 w-4" />}
            Auto-Reply {autoReply ? "ON" : "OFF"}
          </button>

          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ question: "", answer: "", keywords: "" }); }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" />
            Add FAQ
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="glass rounded-2xl p-6 mb-6 animate-fade-in border border-purple-700/30">
          <h2 className="text-sm font-bold text-white mb-4">
            {editingId ? "Edit FAQ" : "New FAQ"}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Question</label>
              <input
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
                placeholder="e.g. What are your opening hours?"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Answer</label>
              <textarea
                value={form.answer}
                onChange={(e) => setForm({ ...form, answer: e.target.value })}
                placeholder="e.g. We are open Monday to Saturday, 9AM to 6PM."
                rows={3}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50 resize-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1.5 block">
                Keywords <span className="text-slate-600 font-normal">(comma separated — e.g. hours, open, time)</span>
              </label>
              <input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="hours, open, time, opening"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={saveFaq} disabled={saving} className="btn-primary">
                <Check className="h-4 w-4" />
                {saving ? "Saving…" : "Save FAQ"}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="btn-ghost"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAQ List */}
      {loading ? (
        <div className="text-center py-16 text-slate-600 text-sm">Loading FAQs…</div>
      ) : faqs.length === 0 ? (
        <div className="glass rounded-2xl px-6 py-16 flex flex-col items-center text-center">
          <BookOpen className="h-8 w-8 text-slate-600 mb-3" />
          <p className="text-sm font-semibold text-slate-400">No FAQs yet</p>
          <p className="text-xs text-slate-600 mt-1">Add your first FAQ to start auto-replying to customers</p>
        </div>
      ) : (
        <div className="space-y-3">
          {faqs.map((faq) => (
            <div
              key={faq.id}
              className={`glass rounded-2xl px-5 py-4 transition-all duration-200 animate-fade-in
                ${!faq.is_active ? "opacity-50" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white mb-1">{faq.question}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{faq.answer}</p>
                  {faq.keywords && faq.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {faq.keywords.map((kw) => (
                        <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-purple-900/40 border border-purple-700/30 px-2 py-0.5 text-[10px] text-purple-300">
                          <Tag className="h-2.5 w-2.5" />
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => toggleActive(faq)}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border transition-all
                      ${faq.is_active
                        ? "bg-green-900/30 border-green-700/30 text-green-400"
                        : "bg-white/5 border-white/10 text-slate-500"}`}
                  >
                    {faq.is_active ? "Active" : "Inactive"}
                  </button>
                  <button onClick={() => startEdit(faq)} className="rounded-lg p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteFaq(faq.id)} className="rounded-lg p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-all">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats footer */}
      <div className="mt-4 glass rounded-xl px-5 py-3 flex items-center gap-6 text-xs text-slate-600">
        <span>Total FAQs: <span className="text-slate-400">{faqs.length}</span></span>
        <span>Active: <span className="text-slate-400">{faqs.filter(f => f.is_active).length}</span></span>
        <span>Auto-Reply: <span className={autoReply ? "text-green-400" : "text-red-400"}>{autoReply ? "Enabled" : "Disabled"}</span></span>
      </div>
    </div>
  );
}
