import Link from "next/link";
import { Bot, BookOpen, ArrowRight, Activity } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8 animate-fade-in">
        <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Welcome to your WhatsApp Bot Platform
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Active Bots",     value: "0", note: "Connect one below" },
          { label: "Messages Today",  value: "—", note: "No data yet" },
          { label: "Knowledge Items", value: "0", note: "Add your first item" },
        ].map((s, i) => (
          <div
            key={s.label}
            className="glass rounded-2xl px-5 py-4 animate-fade-in"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="text-xs font-semibold text-slate-400 mt-0.5">{s.label}</p>
            <p className="text-[11px] text-slate-600 mt-1">{s.note}</p>
          </div>
        ))}
      </div>

      {/* Quick action cards */}
      <div className="grid grid-cols-2 gap-4">
        <Link
          href="/dashboard/connect"
          className="glass rounded-2xl p-6 group transition-all duration-200 hover:bg-white/8 hover:border-brand-800/50 animate-fade-in"
          style={{ animationDelay: "240ms" }}
        >
          <div className="flex items-start justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/20 border border-brand-700/30">
              <Bot className="h-5 w-5 text-brand-400" />
            </div>
            <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
          </div>
          <h2 className="mt-4 text-sm font-bold text-white">Connect Bot</h2>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Scan a QR code to link your WhatsApp number to the platform.
          </p>
        </Link>

        <Link
          href="/dashboard/knowledge"
          className="glass rounded-2xl p-6 group transition-all duration-200 hover:bg-white/8 animate-fade-in"
          style={{ animationDelay: "320ms" }}
        >
          <div className="flex items-start justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/20 border border-purple-700/30">
              <BookOpen className="h-5 w-5 text-purple-400" />
            </div>
            <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
          </div>
          <h2 className="mt-4 text-sm font-bold text-white">Knowledge Base</h2>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Manage the information your bot uses to answer customer questions.
          </p>
        </Link>
      </div>

      {/* Activity placeholder */}
      <div
        className="mt-4 glass rounded-2xl px-6 py-5 animate-fade-in"
        style={{ animationDelay: "400ms" }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-300">Recent Activity</h2>
        </div>
        <p className="text-xs text-slate-600 py-4 text-center">
          No activity yet — connect a WhatsApp number to get started
        </p>
      </div>
    </div>
  );
}
