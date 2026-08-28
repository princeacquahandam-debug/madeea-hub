import { Link } from "react-router-dom";
import { ShieldCheck, ScrollText, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The privacy policy and the terms.
 *
 * ── WHY THESE ARE PUBLIC ROUTES ──────────────────────────────────────────
 * They sit OUTSIDE the auth gate in App.tsx, above the `if (!user) return
 * <Login />`. A privacy policy reachable only after signing in is not reachable
 * by the person deciding whether to sign in, and is not reachable at all by the
 * client whose data it describes. Everything else in this app is gated; these
 * two are the exception on purpose.
 *
 * ── WHY THE WORDING IS SPECIFIC AND UNFLATTERING ─────────────────────────
 * This is a monitoring product. A policy that describes it in the soft language
 * of a marketing page would be worse than none: the people it covers are
 * employees who cannot meaningfully decline, and the thing they most need to
 * know — that the whole screen is photographed, and who can look — is exactly
 * what vague wording hides.
 *
 * So each claim below is written from what the code actually does, and the
 * limits are stated as plainly as the protections. Where a protection does NOT
 * exist, it says so rather than going quiet.
 *
 * ── NOT LEGAL ADVICE, AND NOT FINISHED ───────────────────────────────────
 * Written by reading the schema, not by a lawyer. Every [BRACKETED] item is a
 * decision somebody at MadeEA has to make — legal entity, jurisdiction, contact
 * address, effective date — and the whole document needs review before it is
 * relied on. The accuracy of the factual sections is the part this file can
 * vouch for.
 */

const UPDATED = "[EFFECTIVE DATE — set when this is reviewed and published]";
const ENTITY = "[LEGAL ENTITY NAME]";
const CONTACT = "[PRIVACY CONTACT EMAIL]";
const JURISDICTION = "[JURISDICTION]";

function LegalPage({ icon, title, lede, children }: {
  icon: ReactNode; title: string; lede: string; children: ReactNode;
}) {
  return (
    <div className="min-h-screen overflow-y-auto bg-[var(--bg)] px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-[46rem]">
        <Link to="/" className="text-xs text-faint hover:text-muted">← Executive OS</Link>

        <div className="mt-5 flex items-start gap-3">
          {icon}
          <div className="min-w-0">
            <h1 className="display text-3xl">{title}</h1>
            <p className="mt-1 text-sm text-muted">{lede}</p>
          </div>
        </div>

        <p className="mt-4 text-xs text-faint">Last updated: {UPDATED}</p>

        {/* Said once, at the top, where somebody deciding whether to trust the
            document will actually read it. */}
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[12.5px] leading-relaxed text-amber-100/90">
            <strong className="font-semibold">Draft, pending legal review.</strong> The factual sections
            describe what this software actually does and were written from its source. The bracketed
            items still need answering, and the whole document needs a lawyer before anyone relies on it.
          </p>
        </div>

        <div className="mt-8 space-y-7 pb-16">{children}</div>

        <div className="border-t border-border pt-5 text-xs text-faint">
          <Link to="/privacy" className="hover:text-muted">Privacy</Link>
          <span className="mx-2">·</span>
          <Link to="/terms" className="hover:text-muted">Terms</Link>
        </div>
      </div>
    </div>
  );
}

function S({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-100">{title}</h2>
      <div className="space-y-2.5 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export function Privacy() {
  return (
    <LegalPage
      icon={<ShieldCheck size={26} className="mt-1 shrink-0 text-accent" />}
      title="Privacy Policy"
      lede="What Executive OS records about the people who use it, who can see it, and what it never collects."
    >
      <S title="Who this covers">
        <p>
          Executive OS is an internal tool operated by {ENTITY} (“the agency”). It covers two groups of
          people, and it treats them differently:
        </p>
        <p>
          <strong className="text-zinc-200">Executive assistants</strong> who hold accounts here. Access is
          invite-only; there is no public signup.
        </p>
        <p>
          <strong className="text-zinc-200">Clients</strong>, who do not hold accounts. Client information
          exists here as records maintained by the agency — contact details, notes, and correspondence that
          an assistant has synced from a connected mailbox or chat account.
        </p>
      </S>

      <S title="What is recorded while an assistant is clocked in">
        <p>
          <strong className="text-zinc-200">Screenshots of the entire screen.</strong> Roughly every ten
          minutes, at a deliberately irregular interval so captures cannot be timed. Capture only runs
          while clocked in, only after the assistant grants their browser’s screen-share permission, and
          the browser shows its own sharing indicator throughout. The assistant can stop it at any moment
          from that indicator.
        </p>
        <p>
          The capture is the whole monitor, not one window. That is enforced: sharing a single tab or
          window is refused, because a screenshot labelled as covering a computer while showing only one
          tab would misrepresent what was recorded. The practical consequence is stated plainly in
          <em> What we cannot promise</em> below.
        </p>
        <p>
          <strong className="text-zinc-200">Activity counts.</strong> The number of keystrokes and mouse
          events in a period, seconds spent idle, and how much the screen changed between captures.
        </p>
        <p>
          <strong className="text-zinc-200">Time and reporting.</strong> Clock-in and clock-out times, the
          working day, the focus stated at the start of the day, the end-of-day report, and a reason where
          a day finished early or a report was not filed.
        </p>
      </S>

      <S title="What is never collected">
        <p>
          <strong className="text-zinc-200">The content of what is typed.</strong> The software counts
          keypresses and never reads which key was pressed. This is an absence in the code rather than a
          promise about it: there is no code path in which a typed character could be recorded, even by
          accident. Mouse handlers likewise count events and ignore coordinates.
        </p>
        <p>
          <strong className="text-zinc-200">Anything outside a shift.</strong> Capture and counting stop
          when the clock stops, and cannot restart without the assistant granting the browser prompt again.
        </p>
      </S>

      <S title="Who can see what">
        <p>
          <strong className="text-zinc-200">Personal mailboxes and chats stay personal.</strong> Mail synced
          from Gmail or Outlook, and Teams chats, are readable only by the account that connected them.
          Administrators are not exempt: there is deliberately no administrator override on this, and that
          decision is recorded in the database migration that made it.
        </p>
        <p>
          <strong className="text-zinc-200">Shared channels are shared.</strong> Slack, Discord, WhatsApp
          and Instagram messages are visible to the workspace, because a team channel belongs to the team
          rather than to whoever happened to press sync.
        </p>
        <p>
          <strong className="text-zinc-200">Screenshots and time records</strong> are visible to the
          assistant they belong to, and to accounts holding the reviewer permission for them.
        </p>
        <p>
          <strong className="text-zinc-200">Blur is one-way.</strong> Where blurring is enabled, it is
          applied before the image is uploaded and no unblurred copy is kept. It cannot be reversed by
          anybody, including an administrator.
        </p>
      </S>

      <S title="How long it is kept">
        <p>
          Screenshots are retained for a configurable period, ninety days by default. Deleting a screenshot
          marks it deleted and removes it from view; a record that a capture existed is retained, so that a
          gap in monitoring is distinguishable from a gap that was tidied away.
        </p>
      </S>

      <S title="What we cannot promise">
        <p>
          Two limits matter more than anything above, and both are properties of how the software works
          rather than choices that can be undone by a setting:
        </p>
        <p>
          <strong className="text-zinc-200">A screenshot captures whatever is on the screen.</strong> If a
          conversation with a client, a personal message, or a password manager is open when a capture
          fires, it is in that image, and that image is visible to reviewers. Access rules elsewhere in
          this system that keep a mailbox private do not apply to a photograph of it.
        </p>
        <p>
          <strong className="text-zinc-200">The agency operates the database.</strong> The access rules
          described here are enforced by the database for people using the application. They are not
          enforceable against whoever administers that database, who can read what it stores. Treating
          those two as the same thing would be a claim this software cannot support.
        </p>
      </S>

      <S title="Your choices">
        <p>
          An assistant can decline the screen-share prompt, stop sharing mid-shift from the browser’s own
          indicator, and see at any time what has been recorded about them on the Screenshots and Time
          pages. Declining has employment consequences that are a matter between the assistant and the
          agency, not something this software decides; it is stated here so the choice is not presented as
          more free than it is.
        </p>
        <p>To ask what is held about you, or to request correction or deletion, contact {CONTACT}.</p>
      </S>

      <S title="Changes">
        <p>
          Material changes to what is collected or who can see it will be reflected here. The date at the
          top is the one that matters.
        </p>
      </S>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage
      icon={<ScrollText size={26} className="mt-1 shrink-0 text-accent" />}
      title="Terms of Use"
      lede="The rules for using Executive OS, and what is expected of the people who hold accounts here."
    >
      <S title="Accounts">
        <p>
          Accounts are issued by {ENTITY} and are invite-only. An account belongs to one named person; it
          is not to be shared, and its credentials are not to be reused elsewhere. Access ends when the
          working relationship does.
        </p>
      </S>

      <S title="Monitoring, and consent to it">
        <p>
          This system records screenshots, activity counts and working time as described in the{" "}
          <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>. Using it while
          clocked in means being recorded in the ways set out there. Read it before agreeing to this.
        </p>
        <p>
          Deliberately defeating the recording — sharing a decoy screen, faking activity, editing time
          records to show work that did not happen — is a breach of these terms. So is misrepresenting what
          the recording shows.
        </p>
      </S>

      <S title="Client confidentiality">
        <p>
          Client information handled here is confidential and belongs to the client. It is to be used only
          to do the work, and not copied, forwarded, retained personally, or discussed outside the people
          the work requires.
        </p>
        <p>
          This obligation runs both ways and survives the account. It continues after access ends.
        </p>
      </S>

      <S title="Acceptable use">
        <p>
          Do not connect an account you are not authorised to connect, attempt to reach data belonging to
          another assistant, or use this system to store material unrelated to the work. Do not attempt to
          circumvent the access rules; report them instead if you find a way through.
        </p>
      </S>

      <S title="Data ownership">
        <p>
          Client records, correspondence and work product created in the course of the work belong to the
          agency or to its clients as their agreements provide. Records about a person — their time,
          screenshots and activity — remain subject to that person’s rights under applicable data
          protection law regardless of who operates the system.
        </p>
      </S>

      <S title="Availability">
        <p>
          The software is provided as it is, for internal use. No uptime is guaranteed, and time or
          monitoring data can be lost through failures outside anybody’s control. Where a record matters —
          payroll, compliance, a dispute — it should not rest on this system alone.
        </p>
      </S>

      <S title="Ending access">
        <p>
          The agency can suspend or end an account at any time, including for breach of these terms. On
          ending, access stops immediately; retention of what was already recorded follows the Privacy
          Policy.
        </p>
      </S>

      <S title="Governing law">
        <p>These terms are governed by the laws of {JURISDICTION}. Questions: {CONTACT}.</p>
      </S>
    </LegalPage>
  );
}
