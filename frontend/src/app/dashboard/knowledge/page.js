import { BookOpen } from "lucide-react";

export default function KnowledgeBasePage() {
  return (
    <div className="px-8 py-8">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen className="h-5 w-5 text-purple-400" />
        <h1 className="text-2xl font-bold text-white tracking-tight">Knowledge Base</h1>
      </div>
      <p className="text-sm text-slate-400 mb-8">
        Manage the information your bot uses to respond to customers.
      </p>

      <div className="glass rounded-2xl px-6 py-16 flex flex-col items-center justify-center text-center max-w-md">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-600/20 border border-purple-700/30 mb-4">
          <BookOpen className="h-6 w-6 text-purple-400" />
        </div>
        <h2 className="text-sm font-bold text-white mb-2">Coming Soon</h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          The knowledge base feature is part of the full platform build.
          Add FAQs, product info, and custom responses here.
        </p>
      </div>
    </div>
  );
}
