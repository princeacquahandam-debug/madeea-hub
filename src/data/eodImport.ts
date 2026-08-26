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
 * The roster is the names, and nothing is retired from it any more.
 *
 * There used to be a RETIRED_ROSTER_NAMES set here, holding "Bryan Sumait". It
 * existed because his live account reported under a name generated from his
 * email, so the sheet name sat beside it as an empty duplicate chip and the
 * cheapest fix was to hide one of them.
 *
 * That treated the symptom in the wrong place. Migration 0061 makes the roster
 * the SOURCE of a profile's name — an address belonging to somebody on this
 * list gets this list's spelling, on account creation and as a one-time repair
 * — so the live account and the sheet row are one identity in the database
 * rather than two that the UI papers over. Hiding a roster name would now
 * hide that person's July history for no reason.
 *
 * If a duplicate chip ever appears again, it means an account's profile name
 * does not match its roster entry. The fix is a row in person_name_overrides,
 * not an entry here.
 */

/** Everyone who has ever reported, in the sheet's column order. */
export const EOD_PEOPLE: string[] = EOD_DATA.people;

/** Every dated row the sheet defined, so reporting gaps stay visible. */
export const EOD_DATES: string[] = EOD_DATA.dates;
