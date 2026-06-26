import { useState } from "react";
import { MessageSquare, Send, Sparkles, X } from "lucide-react";
import { assistantChat, type ChatMessage } from "@/lib/ai";
import { useAuth } from "@/hooks/useAuth";

const SUGGESTIONS = [
  "Draft a follow-up email to a client",
  "What are my tasks for today?",
  "Summarise a client's key details",
];

export function AssistantWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const reply = await assistantChat(next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        data-tour="assistant"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg hover:bg-accent-soft"
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
      >
        <MessageSquare size={22} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[32rem] w-[22rem] max-w-[calc(100vw-3rem)] flex-col card shadow-2xl">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-accent-soft">
          <Sparkles size={16} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">MadeEA AI Assistant</p>
          <p className="text-xs text-faint">Powered by Claude · Online</p>
        </div>
        <button className="text-faint hover:text-zinc-100" onClick={() => setOpen(false)} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <>
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              Hello {user?.name?.split(" ")[0] ?? "there"}. I'm your MadeEA AI Assistant. I can help
              you draft communications, summarise client info, manage tasks, and more. What can I
              help with today?
            </div>
            <div className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-muted hover:border-accent/40 hover:text-zinc-100"
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-lg bg-accent px-3 py-2 text-sm text-white"
                : "max-w-[85%] rounded-lg bg-surface-2 px-3 py-2 text-sm"
            }
          >
            {m.content}
          </div>
        ))}
        {busy && <div className="text-xs text-faint">Thinking…</div>}
      </div>

      <form
        className="flex items-center gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="input"
          placeholder="Ask anything..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-primary px-3" disabled={!input.trim() || busy} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
