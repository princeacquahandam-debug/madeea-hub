import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Badge } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE, type SlaStatus, type SlaTrend } from "@/lib/sla";

export function SlaBadge({ status }: { status: SlaStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/**
 * Falling response time is an improvement, so the arrow points down when things
 * are getting better — colour carries the meaning, not the direction.
 */
export function TrendArrow({ trend, className = "" }: { trend: SlaTrend; className?: string }) {
  if (trend === "unknown") return null;
  if (trend === "flat") return <Minus size={13} className={`text-faint ${className}`} />;
  const Icon = trend === "improving" ? TrendingDown : TrendingUp;
  return (
    <Icon
      size={13}
      className={`${trend === "improving" ? "text-emerald-400" : "text-amber-400"} ${className}`}
    />
  );
}

export const TREND_LABEL: Record<SlaTrend, string> = {
  improving: "Improving vs. previous 30 days",
  worsening: "Slipping vs. previous 30 days",
  flat: "Steady vs. previous 30 days",
  unknown: "Not enough history to compare",
};
