/**
 * The imported July reports from the old Google Sheet, adapted to the EodReport
 * shape so history survives the move off the sheet.
 *
 * These predate the team having Hub accounts, so they carry a person NAME and no
 * owner_id, the same shape migration 0016 stores them in (imported = true).
 * Everything else about the sheet is retired: the Task Tracker tab is replaced
 * by the real Kanban, and new reports are submitted in-app.
 *
 * To load these into a live database, see scripts/import_eod.sql.
 */
import { EOD_DATA } from "@/data/eod";
import type { EodReport } from "@/types/db";

/**
 * The July history no longer ships in the client bundle, it contained
 * security-sensitive report text (a live XSS disclosure, MFA gaps, prod config)
 * that must not be readable from the public JS. It now lives in the database
 * (see supabase/seed_eod.sql), behind RLS, and the app loads it via useEodReports
 * once signed in.
 *
 * This stays an empty array so demo mode (dev-only, no DB) simply shows no
 * historical reports rather than leaking them. eod.ts keeps only the
 * non-sensitive people / dates / coverage matrix used to render the grid.
 */
export const IMPORTED_EOD: EodReport[] = [];

/**
 * There is no roster export here any more, and that is the point.
 *
 * This file used to publish EOD_PEOPLE — the July sheet's eight names — and the
 * EOD page treated it as a list of who works here, alongside the live
 * membership list. Two lists of the same humans is what put "FJ Caballes 0.00%"
 * directly above "fj.caballes 6.45%" in the compliance table: ten rows for
 * eight people, and every total split down the middle.
 *
 * Making the two lists agree (migration 0061 names accounts from the roster)
 * collapses the pairs, but agreement is a thing that must KEEP being true, and
 * it stops being true the first time somebody is invited who was never on the
 * sheet. So the page reads membership and nothing else. Who works here is a
 * question the workspace can answer; a spreadsheet from July cannot.
 *
 * EOD_DATA.people survives below as the key into the July coverage matrix,
 * which is what it always actually was: column headings from an archive, not a
 * statement about the present.
 */

/** Every dated row the sheet defined, so reporting gaps stay visible. */
export const EOD_DATES: string[] = EOD_DATA.dates;
