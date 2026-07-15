/**
 * AI generation tools — everything that produces text via the server-side model
 * (lib/ai.ts, real in live mode, labelled fallback in demo).
 *
 * A `genTool` factory builds each one so they stay DRY, yet every capability is
 * still a *distinct* registered Tool with its own intent, icon, validation, and
 * input mapping — new generative tools are one object literal away.
 *
 * Conversation context: each tool folds the last assistant result into its
 * inputs (`_context`) so follow-ups like "now write an email about that" carry
 * the subject forward without the user restating it.
 */
import { Mail, FileText, ScanText, WandSparkles, Languages, GraduationCap, Code2, NotebookPen, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Intent, Tool, ToolContext, ToolResult, PermissionLevel } from "../types";

/** Most recent assistant answer — the referent for "that"/"it" follow-ups. */
function priorContext(ctx: ToolContext): string {
  for (let i = ctx.conversation.length - 1; i >= 0; i--) {
    if (ctx.conversation[i].role === "assistant") return ctx.conversation[i].content;
  }
  return "";
}

interface GenConfig {
  name: string;
  intent: Intent;
  icon: LucideIcon;
  description: string;
  format: string; // passed to the model as the output format
  permissions?: PermissionLevel;
  /** Build model inputs from parsed params (+ optional prior context). */
  inputs: (ctx: ToolContext) => Record<string, string>;
  /** Guard; return an error message to block, or null when valid. */
  validate?: (ctx: ToolContext) => string | null;
  title?: string; // result card heading
}

function genTool(cfg: GenConfig): Tool {
  return {
    name: cfg.name,
    intent: cfg.intent,
    category: "generate",
    description: cfg.description,
    icon: cfg.icon,
    permissions: cfg.permissions ?? "safe",
    validate: cfg.validate ?? (() => null),
    execute: async (ctx): Promise<ToolResult> => {
      const inputs = cfg.inputs(ctx);
      const context = priorContext(ctx);
      if (context) inputs._context = context;
      const output = await ctx.ai.generate(cfg.format, inputs);
      return { kind: "text", title: cfg.title ?? cfg.name, markdown: output };
    },
  };
}

export const EmailTool = genTool({
  name: "Write Email",
  intent: "write_email",
  icon: Mail,
  description: "Draft a professional email in any tone.",
  format: "Executive Email",
  title: "Draft email",
  validate: (ctx) => (ctx.params.points?.trim() || ctx.params.subject?.trim() || ctx.params.recipient?.trim() ? null : "Who's it to and what should it say?"),
  inputs: (ctx) => ({
    recipient: ctx.params.recipient || "the client",
    subject: ctx.params.subject || "",
    points: ctx.params.points || ctx.command.raw,
    tone: ctx.params.tone || "Professional",
  }),
});

export const SummaryTool = genTool({
  name: "Summarize Documents",
  intent: "summarize_documents",
  icon: FileText,
  description: "Summarize documents or long text into key points.",
  format: "Summary",
  title: "Summary",
  inputs: (ctx) => ({ source: ctx.params.target || ctx.command.raw, length: "Bullet points" }),
});

export const SummarizePdfTool = genTool({
  name: "Summarize PDF",
  intent: "summarize_pdf",
  icon: FileText,
  description: "Summarize a PDF (attach handling is future-ready; today summarizes referenced content).",
  format: "PDF Summary",
  title: "PDF summary",
  inputs: (ctx) => ({ source: ctx.params.target || ctx.command.raw, length: "Bullet points" }),
});

export const AnalyzeDocumentTool = genTool({
  name: "Analyze Document",
  intent: "analyze_document",
  icon: ScanText,
  description: "Analyze a document for themes, risks, and action items.",
  format: "Document Analysis",
  title: "Analysis",
  inputs: (ctx) => ({ source: ctx.params.target || ctx.command.raw, focus: "themes, risks, action items" }),
});

export const RewriteTool = genTool({
  name: "Rewrite Text",
  intent: "rewrite_text",
  icon: WandSparkles,
  description: "Rewrite, reword, or polish text.",
  format: "Rewrite",
  title: "Rewritten",
  inputs: (ctx) => ({ text: ctx.params.text || ctx.command.raw }),
});

export const TranslateTool = genTool({
  name: "Translate",
  intent: "translate",
  icon: Languages,
  description: "Translate text into another language.",
  format: "Translation",
  title: "Translation",
  validate: (ctx) => (ctx.params.text?.trim() || priorContext(ctx) ? null : "What text should I translate?"),
  inputs: (ctx) => ({ text: ctx.params.text || priorContext(ctx), language: ctx.params.language || "Spanish" }),
});

export const ExplainTool = genTool({
  name: "Explain",
  intent: "explain",
  icon: GraduationCap,
  description: "Explain a concept clearly.",
  format: "Explanation",
  title: "Explanation",
  inputs: (ctx) => ({ topic: ctx.params.topic || ctx.command.raw }),
});

export const CodeTool = genTool({
  name: "Generate Code",
  intent: "generate_code",
  icon: Code2,
  description: "Generate a code snippet from a description.",
  format: "Code",
  title: "Code",
  inputs: (ctx) => ({ spec: ctx.params.spec || ctx.command.raw }),
});

export const MeetingNotesTool = genTool({
  name: "Create Meeting Notes",
  intent: "create_meeting_notes",
  icon: NotebookPen,
  description: "Turn a topic or transcript into structured meeting notes.",
  format: "Meeting Notes",
  title: "Meeting notes",
  inputs: (ctx) => ({ topic: ctx.params.topic || ctx.command.raw, source: ctx.params.source || "" }),
});

/**
 * Conversational fallback. Unlike the format tools it uses the chat endpoint and
 * the full conversation so multi-turn context is preserved end-to-end.
 */
export const AskTool: Tool = {
  name: "Ask AI",
  intent: "ask",
  category: "generate",
  description: "Ask the assistant anything.",
  icon: Sparkles,
  permissions: "safe",
  validate: (ctx) => (ctx.command.raw.trim() ? null : "Ask a question."),
  execute: async (ctx): Promise<ToolResult> => {
    const reply = await ctx.ai.chat([...ctx.conversation, { role: "user", content: ctx.command.raw }]);
    return { kind: "text", title: "Assistant", markdown: reply };
  },
};
