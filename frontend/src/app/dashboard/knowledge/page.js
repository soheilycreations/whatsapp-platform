"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, Trash2, Pencil, Check, X, Tag, AlertCircle } from "lucide-react";

const baseEnvUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const BACKEND_URL = baseEnvUrl.endsWith("/") ? baseEnvUrl.slice(0, -1) : baseEnvUrl;
const SHOP_ID = "shop_123";

export default function KnowledgeBasePage() {
  const [faqs, setFaqs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]           = useState({ question: "", answer: "", keywords: "" });
  const [saving, setSaving]       = useState(false);
  const [apiError, setApiError]   = useState(null);

  useEffect(() => {
    fetchFaqs();
  }, []);

  async function fetchFaqs() {
    setLoading(true);
    setApiError(null);
    try {
      // 1. කෙළින්ම Backend එකෙන් FAQs ඉල්ලනවා
      const res = await fetch(`${BACKEND_URL}/api/faqs?shopId=${SHOP_ID}`);
      
      if (!res.ok) {
        throw new Error(`সර්වර් එකෙන් වැරදි ප්‍රතිචාරයක් ආවා (Status: ${res.status})`);
      }
      
      const data = await res.json();
      
      // 2. ආපු දත්ත Array එකක්ද කියලා තහවුරු කරගෙන විතරක් State එකට දානවා
      if (Array.isArray(data)) {
        setFaqs(data);
      } else {
        setFaqs([]);
      }
    } catch (err) {
      console.error("❌ Error fetching FAQs:", err);
      setApiError("Backend එකට සම්බන්ද වෙන්න බැහැ. URL එක හෝ සර්වර් එක පරීක්ෂා කරන්න.");
      setFaqs([]);
    } finally {
      setLoading(false);
    }
  }

  async function saveFaq() {
    if (!form.question || !form.answer) return;
    setSaving(true);
    try {
      const keywords = form.keywords ? form.keywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean) : [];
      const url    = editingId ? `${BACKEND_URL}/api/faqs/${editingId}` : `${BACKEND_URL}/api/faqs`;
      const method = editingId ? "PATCH" : "POST";
      const body   = editingId
        ? { question: form.question, answer: form.answer, keywords }
        : { shop_id: SHOP_ID, question: form.question, answer: form.answer, keywords };

      const res = await fetch(url, { 
        method, 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(body) 
      });

      if (res.ok) {
        setForm({ question: "", answer: "", keywords: "" });
        setShowForm(false); 
        setEditingId(null);
        await fetchFaqs();
      }
    } catch (err) {
      console.error("❌ Error saving FAQ:", err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteFaq(id) {
    if (!confirm("මෙම FAQ එක මකා දැමීමට අවශ්‍යද?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/faqs/${id}`, { method: "DELETE" });
      if (res.ok) fetchFaqs();
    } catch (err) {
      console.error("❌ Error deleting FAQ:", err);
    }
  }

  function startEdit(faq) {
    setForm({ 
      question: faq.question || "", 
      answer: faq.answer || "", 
      keywords: faq.keywords && Array.isArray(faq.keywords) ? faq.keywords.join(", ") : "" 
    });
    setEditingId(faq.id); 
    setShowForm(true);
  }

  return (
    <div className="px-8 py-8 max-w-4xl text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="h-5 w-5 text-purple-400" />
            <h1 className="text-2xl font-bold text-white tracking-tight">Knowledge Base</h1>
          </div>
          <p className="text-sm text-slate-400">Train your AI bot with FAQs and business documents</p>
        </div>
      </div>

      {/* API Connection Error Message */}
      {apiError && (
        <div className="rounded-xl bg-amber-950/40 border border-amber-700/40 px-4 py-3 text-xs mb-4 flex items-center gap-2 text-amber-300">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <div>
            <span className="font-bold">සටහන:</span> {apiError} <br/>
            <span className="text-slate-500">උත්සාහ කරන URL එක: {BACKEND_URL}/api/faqs?shopId={SHOP_ID}</span>
          </div>
        </div>
      )}

      {/* Add FAQ Button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm({ question: "", answer: "", keywords: "" }); }}
          className="bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl px-4 py-2 text-sm flex items-center gap-2 transition-all"
        >
          <Plus className="h-4 w-4" /> Add FAQ
        </button>
      </div>

      {/* Form Area */}
      {showForm && (
        <div className="bg-slate-900/60 border border-purple-500/20 backdrop-blur-md rounded-2xl p-6 mb-4 animate-fade-in">
          <h2 className="text-sm font-bold text-white mb-4">{editingId ? "Edit FAQ" : "New FAQ"}</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1 block">Question</label>
              <input value={form.question} onChange={e => setForm({...form, question: e.target.value})}
                placeholder="e.g. What are your prices?"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1 block">Answer</label>
              <textarea value={form.answer} onChange={e => setForm({...form, answer: e.target.value})}
                placeholder="e.g. Our prices start from Rs. 5,000..."
                rows={3} className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50 resize-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1 block">Keywords (comma separated)</label>
              <input value={form.keywords} onChange={e => setForm({...form, keywords: e.target.value})}
                placeholder="price, cost, how much"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50" />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={saveFaq} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all">
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="bg-white/5 hover:bg-white/10 text-slate-300 px-4 py-2 rounded-xl text-sm font-medium transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main List Area */}
      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm animate-pulse">Supabase වෙතින් දත්ත ලෝඩ් වෙමින් පවතී…</div>
      ) : faqs.length === 0 ? (
        <div className="bg-slate-900/40 border border-white/5 rounded-2xl px-6 py-12 flex flex-col items-center text-center">
          <BookOpen className="h-8 w-8 text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">පෙන්වීමට කිසිදු FAQ එකක් හමු නොවීය</p>
          <p className="text-xs text-slate-600 mt-1">සර්වර් සම්බන්ධතාවය නිවැරදි නම් Supabase හි දත්ත නොමැති වීම හෝ shopId වෙනස් වීම හේතුවක් විය හැක.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {faqs.map(faq => (
            <div key={faq.id} className="bg-slate-900/40 border border-white/5 rounded-2xl px-5 py-4 hover:border-purple-500/10 transition-all">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white mb-1">{faq.question}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{faq.answer}</p>
                  {faq.keywords && Array.isArray(faq.keywords) && faq.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {faq.keywords.map(kw => (
                        <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-purple-950/40 border border-purple-800/30 px-2 py-0.5 text-[10px] text-purple-300">
                          <Tag className="h-2.5 w-2.5" />{kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
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

      {/* Footer count */}
      <div className="mt-4 bg-slate-900/20 rounded-xl px-5 py-3 text-xs text-slate-500">
        මුළු FAQs ගණන: <span className="text-slate-400 font-bold">{faqs.length}</span>
      </div>
    </div>
  );
}
