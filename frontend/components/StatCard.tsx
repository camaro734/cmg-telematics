interface Props {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  icon?: React.ReactNode;
}

export default function StatCard({ label, value, unit, color, icon }: Props) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>{label}</span>
        {icon && <span style={{ color: color || "var(--muted)" }}>{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold" style={{ color: color || "white" }}>{value}</span>
        {unit && <span className="text-sm" style={{ color: "var(--muted)" }}>{unit}</span>}
      </div>
    </div>
  );
}
