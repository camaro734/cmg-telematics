"use client";

export interface GaugeZone {
  from: number;
  to: number;
  color: string;
}

interface Props {
  value: number | null;
  min: number;
  max: number;
  label: string;
  unit: string;
  zones: GaugeZone[];
  size?: number;
}

// Convert compass angle (0=top, CW) to SVG cartesian point
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Build SVG arc path from startDeg to endDeg (compass, CW)
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const sweep = ((endDeg - startDeg) + 720) % 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const START_ANGLE = 225; // compass degrees (7:30 position)
const TOTAL_SWEEP = 270; // sweep clockwise to 4:30 position

export default function CircularGauge({ value, min, max, label, unit, zones, size = 120 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.37;
  const sw = size * 0.095; // stroke width

  const clamped = value != null ? Math.max(min, Math.min(max, value)) : null;
  const progress = clamped != null ? (clamped - min) / (max - min) : 0;
  const valueAngle = START_ANGLE + progress * TOTAL_SWEEP;

  // Active zone color based on current value
  const activeZone = zones.find(z => clamped != null && clamped >= z.from && clamped < z.to)
    ?? zones[zones.length - 1];
  const valueColor = activeZone?.color ?? "#3b82f6";

  // Full background arc
  const bgPath = describeArc(cx, cy, r, START_ANGLE, START_ANGLE + TOTAL_SWEEP);

  // Value arc (only render if we have a meaningful value)
  const showValueArc = clamped != null && progress > 0.005;
  const valuePath = showValueArc ? describeArc(cx, cy, r, START_ANGLE, valueAngle) : null;

  // Zone tick marks (optional subtle guides)
  const zoneTickPaths = zones.slice(0, -1).map(z => {
    const tickAngle = START_ANGLE + ((z.to - min) / (max - min)) * TOTAL_SWEEP;
    const inner = polarToCartesian(cx, cy, r - sw * 0.8, tickAngle);
    const outer = polarToCartesian(cx, cy, r + sw * 0.2, tickAngle);
    return `M ${inner.x.toFixed(1)} ${inner.y.toFixed(1)} L ${outer.x.toFixed(1)} ${outer.y.toFixed(1)}`;
  });

  // Format display value
  const displayValue = clamped != null
    ? (Math.abs(clamped) >= 100 ? Math.round(clamped).toString() : clamped % 1 === 0 ? clamped.toString() : clamped.toFixed(1))
    : "–";

  const fontSize = size * (displayValue.length > 4 ? 0.14 : 0.18);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
        {/* Background arc */}
        <path
          d={bgPath}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={sw}
          strokeLinecap="round"
        />

        {/* Value arc */}
        {valuePath && (
          <path
            d={valuePath}
            fill="none"
            stroke={valueColor}
            strokeWidth={sw}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 5px ${valueColor}99)` }}
          />
        )}

        {/* Zone dividers */}
        {zoneTickPaths.map((d, i) => (
          <path key={i} d={d} stroke="rgba(0,0,0,0.5)" strokeWidth={1.5} />
        ))}

        {/* Center: value */}
        <text
          x={cx}
          y={cy - size * 0.05}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={clamped != null ? "white" : "#475569"}
          fontSize={fontSize}
          fontWeight="700"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {displayValue}
        </text>

        {/* Center: unit */}
        <text
          x={cx}
          y={cy + size * 0.15}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#64748b"
          fontSize={size * 0.09}
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {unit}
        </text>
      </svg>

      {/* Label */}
      <div style={{
        fontSize: size * 0.09,
        color: "#94a3b8",
        marginTop: -size * 0.04,
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
        lineHeight: 1.2,
      }}>
        {label}
      </div>
    </div>
  );
}
