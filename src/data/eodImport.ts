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
 * Names from the sheet roster that are now LIVE accounts reporting under their
 * own profile name. The sheet copy is a stale duplicate. E.g. "Bryan Sumait"
 * from the July sheet showed as an empty chip next to the real account, which
 * submits as "Bryansumait Automate". Dropping it here removes the duplicate so
 * only the live identity shows. Add a name here whenever a sheet person becomes
 * an account under a different display name (or, alternatively, rename their
 * profile to match the roster. See supabase/fixes/2026-07-25-canonical-eod-names.sql).
 */
const RETIRED_ROSTER_NAMES = new Set<string>(["Bryan Sumait"]);

/** Everyone who has ever reported, in the sheet's column order. */
export const EOD_PEOPLE: string[] = EOD_DATA.people.filter((n) => !RETIRED_ROSTER_NAMES.has(n));

/** Every dated row the sheet defined, so reporting gaps stay visible. */
export const EOD_DATES: string[] = EOD_DATA.dates;
