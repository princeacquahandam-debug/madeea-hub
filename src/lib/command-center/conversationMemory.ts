/**
 * Conversation memory — maintains multi-turn context so follow-ups like
 * "now write an email about that" resolve without re-stating the subject.
 *
 * It keeps a rolling window of messages plus the last assistant output, and
 * exposes `resolveReferences` which rewrites pronoun-y follow-ups ("that",
 * "it", "this") by appending the prior result as context. Kept as a small pure
 * module (no React) so it is trivially testable and reusable.
 */
import type { ConversationMessage } from "./types";

const MAX_MESSAGES = 12; // rolling window handed to the model

export class ConversationMemory {
  private messages: ConversationMessage[] = [];
  private lastOutput = "";

  add(role: ConversationMessage["role"], content: string): void {
    this.messages.push({ role, content });
    if (role === "assistant") this.lastOutput = content;
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
  }

  history(): ConversationMessage[] {
    return [...this.messages];
  }

  /** The most recent assistant answer — the referent for "that"/"it". */
  lastResult(): string {
    return this.lastOutput;
  }

  /**
   * If the prompt refers back to a previous result ("that", "this", "it",
   * "the above"), fold that result into the text so downstream generation has
   * the subject even though the user never repeated it.
   */
  resolveReferences(prompt: string): string {
    const refersBack = /\b(that|this|it|the above|the previous|those)\b/i.test(prompt);
    if (refersBack && this.lastOutput) {
      return `${prompt}\n\n(Context — the previous result this refers to:)\n${this.lastOutput}`;
    }
    return prompt;
  }

  clear(): void {
    this.messages = [];
    this.lastOutput = "";
  }
}
