"use client";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}

export default function Sparkline({ values, width = 60, height = 24, color = "#3b82f6", strokeWidth = 1.5 }: Props) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pad = strokeWidth;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Trend: compare last value to first
  const trend = values[values.length - 1] - values[0];
  const trendColor = trend > 0 ? "#f59e0b" : trend < -1 ? "#22c55e" : color;
  const lineColor = values.length > 3 ? trendColor : color;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Subtle fill under the line */}
      <defs>
        <linearGradient id={`spark-fill-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`${pad},${pad + h} ${points.join(" ")} ${pad + w},${pad + h}`}
        fill={`url(#spark-fill-${color.replace("#","")})`}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={lineColor}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Last value dot */}
      <circle
        cx={parseFloat(points[points.length - 1].split(",")[0])}
        cy={parseFloat(points[points.length - 1].split(",")[1])}
        r={2.5}
        fill={lineColor}
      />
    </svg>
  );
}
