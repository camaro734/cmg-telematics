interface Props {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  icon?: React.ReactNode;
  /** Positive = up (good or bad depending on context), negative = down, 0 = flat */
  trend?: number;
  /** If true, an upward trend is considered bad (e.g. alerts) */
  trendInverse?: boolean;
  /** Compact badge text shown in top-right corner */
  badge?: string;
  badgeColor?: string;
}

export default function StatCard({ label, value, unit, color, icon, trend, trendInverse, badge, badgeColor }: Props) {
  const trendUp = trend != null && trend > 0;
  const trendDown = trend != null && trend < 0;
  const trendGood = trendUp ? !trendInverse : trendInverse;
  const trendColor = trend == null || trend === 0 ? "var(--muted)" : trendGood ? "var(--success)" : "#ef4444";

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>{label}</span>
        <div className="flex items-center gap-1.5">
          {badge && (
            <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: `${badgeColor ?? "#3b82f6"}22`, color: badgeColor ?? "#3b82f6", fontSize: 9 }}>
              {badge}
            </span>
          )}
          {icon && <span style={{ color: color || "var(--muted)" }}>{icon}</span>}
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold" style={{ color: color || "white" }}>{value}</span>
        {unit && <span className="text-sm" style={{ color: "var(--muted)" }}>{unit}</span>}
        {trend != null && trend !== 0 && (
          <span className="flex items-center gap-0.5 text-xs font-semibold ml-1" style={{ color: trendColor }}>
            <svg width="10" height="10" fill="none" viewBox="0 0 24 24">
              {trendUp
                ? <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
            {Math.abs(trend)}
          </span>
        )}
        {trend === 0 && (
          <span className="text-xs ml-1" style={{ color: "var(--muted)" }}>—</span>
        )}
      </div>
      {trendDown !== undefined && trend != null && (
        <div className="mt-1 text-xs" style={{ color: "var(--muted)", fontSize: 10 }}>
          {trendUp ? "vs ayer ↑" : trendDown ? "vs ayer ↓" : ""}
        </div>
      )}
    </div>
  );
}
