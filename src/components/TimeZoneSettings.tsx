import { useMemo, useState } from "react";
import { Globe2, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { timeZones, zoneOffset, localTime } from "@/lib/timezones";
import { useUserTimeZone, zoneCity } from "@/lib/userTimeZone";
import { useNow } from "@/hooks/useNow";

/**
 * Settings card: the time zone the Hub shows your times in (Reich's testing,
 * 20 Oct 2026). An EA supporting a client abroad, or travelling herself, picks
 * one zone and the calendar, its booking form and everything else that reads
 * the setting follow it. "Use my computer's" is the old behaviour, and the
 * default.
 */
export function TimeZoneSettings() {
  const { chosen, device, zone, setChosen } = useUserTimeZone();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useNow(60_000);

  const zones = useMemo(() => {
    const all = timeZones();
    // A zone saved on another device might be missing from this browser's list.
    return chosen && !all.includes(chosen) ? [chosen, ...all] : all;
  }, [chosen]);

  async function pick(v: string) {
    setSaving(true);
    setMsg(null);
    const err = await setChosen(v === "" ? null : v);
    setSaving(false);
    void qc.invalidateQueries({ queryKey: ["member-timezones"] });
    setMsg(err ? { ok: err.startsWith("Saved on this device"), text: err } : { ok: true, text: "Saved." });
  }

  return (
    <section className="card p-5">
      <p className="field-label flex items-center gap-1.5"><Globe2 size={12} /> Time zone</p>
      <p className="mb-3 text-sm text-muted">
        The Hub shows your times in{" "}
        <span className="font-medium text-text">{zoneCity(zone)} ({zoneOffset(zone)})</span>
        , where it is {localTime(zone) ?? "-"} now. Your calendar and new events use it too.
      </p>

      <label className="field-label" htmlFor="tz-mine">Show times in</label>
      <select
        id="tz-mine"
        className="input max-w-sm"
        value={chosen ?? ""}
        disabled={saving}
        onChange={(e) => void pick(e.target.value)}
      >
        <option value="">Use my computer's ({zoneCity(device)}, {zoneOffset(device)})</option>
        {zones.map((z) => (
          <option key={z} value={z}>{z.replace(/_/g, " ")} ({zoneOffset(z)})</option>
        ))}
      </select>

      {/* Only when the clocks differ: Singapore and Manila are both GMT+8. */}
      {chosen && chosen !== device && zoneOffset(chosen) !== zoneOffset(device) && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[12.5px] text-amber-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Your computer is on {zoneCity(device)} ({zoneOffset(device)}); times in the Hub are shown in{" "}
            {zoneCity(chosen)} ({zoneOffset(chosen)}).
          </span>
        </p>
      )}

      <p className="mt-2 text-[11.5px] text-faint">
        Task due dates are whole days and stay on the day they were set, whatever the zone.
      </p>

      {msg && (
        <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-300" : "text-red-300"}`} role="status">{msg.text}</p>
      )}
    </section>
  );
}
