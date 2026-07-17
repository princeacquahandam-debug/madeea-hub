import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Markdown → HTML for rendering.
 *
 * `marked` does NOT sanitize (the `sanitize` option was removed in v8), so raw
 * HTML in the source passes straight through. Markdown here is not all
 * first-party: it comes from automation output, AI replies, SOP bodies and
 * client/task fields, any of which another workspace member can author — and
 * under the shared-workspace model everyone reads everyone's rows. So treat all
 * of it as untrusted and purify before it reaches the DOM.
 *
 * Always render via this helper rather than calling marked.parse() directly.
 */
export function renderMarkdown(markdown: string): string {
  const raw = marked.parse(markdown ?? "", { async: false }) as string;
  return sanitizeHtml(raw);
}

/** Strip scripts, event handlers and javascript: URLs from an HTML string. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // target=_blank without rel=noopener hands the new page a window.opener
    // handle back into this origin.
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["style", "srcset", "formaction", "onerror", "onload"],
  });
}
