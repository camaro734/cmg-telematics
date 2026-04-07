// Gauge circular SVG nativo — Victory Native XL pattern con react-native-svg
// Sin WebView. Sin react-native-webview. SVG nativo animado.
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Path, Circle, Line, G } from 'react-native-svg';
import { Colors } from '@/constants/colors';

interface GaugeZone {
  from: number;
  to: number;
  color: string;
}

interface Props {
  value: number;
  min: number;
  max: number;
  label: string;
  unit: string;
  color?: string;
  size?: number;
  zones?: GaugeZone[];
}

const DEFAULT_ZONES: GaugeZone[] = [
  { from: 0,    to: 0.6,  color: Colors.success },
  { from: 0.6,  to: 0.85, color: Colors.warning },
  { from: 0.85, to: 1,    color: Colors.danger },
];

// Convierte ángulo (grados) a coordenadas en un círculo de radio r centrado en (cx, cy)
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Genera el path SVG de un arco
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function CircularGauge({
  value,
  min,
  max,
  label,
  unit,
  size = 120,
  zones,
}: Props) {
  const clampedValue = Math.max(min, Math.min(max, value));
  const ratio = max === min ? 0 : (clampedValue - min) / (max - min);

  // Animación del valor mostrado en texto
  const animatedValue = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: value,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [value, animatedValue]);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const strokeWidth = size * 0.08;

  // Arco total: de 135° a 405° (270° de barrido)
  const START_ANGLE = 135;
  const END_ANGLE = 405;
  const totalSweep = END_ANGLE - START_ANGLE;

  // Needle
  const needleAngle = START_ANGLE + ratio * totalSweep;
  const needleTip = polarToCartesian(cx, cy, r * 0.85, needleAngle);
  const needleBase1 = polarToCartesian(cx, cy, r * 0.12, needleAngle + 90);
  const needleBase2 = polarToCartesian(cx, cy, r * 0.12, needleAngle - 90);

  const resolvedZones = zones ?? DEFAULT_ZONES;

  // Color de la aguja según zona actual
  const needleColor = resolvedZones.reduce<string>((acc, z) => {
    if (ratio >= z.from && ratio <= z.to) return z.color;
    return acc;
  }, Colors.text);

  return (
    <View style={[styles.wrapper, { width: size, height: size + 20 }]}>
      <Svg width={size} height={size}>
        {/* Track de fondo */}
        <Path
          d={describeArc(cx, cy, r, START_ANGLE, END_ANGLE)}
          stroke={Colors.border}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />

        {/* Zonas de color */}
        {resolvedZones.map((zone, i) => {
          const zStart = START_ANGLE + zone.from * totalSweep;
          const zEnd = START_ANGLE + zone.to * totalSweep;
          return (
            <Path
              key={i}
              d={describeArc(cx, cy, r, zStart, zEnd)}
              stroke={zone.color}
              strokeWidth={strokeWidth}
              fill="none"
              strokeOpacity={0.3}
              strokeLinecap="round"
            />
          );
        })}

        {/* Arco de progreso */}
        <Path
          d={describeArc(cx, cy, r, START_ANGLE, START_ANGLE + ratio * totalSweep)}
          stroke={needleColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />

        {/* Aguja */}
        <G>
          <Path
            d={`M ${needleBase1.x} ${needleBase1.y} L ${needleTip.x} ${needleTip.y} L ${needleBase2.x} ${needleBase2.y} Z`}
            fill={needleColor}
          />
          <Circle cx={cx} cy={cy} r={strokeWidth * 0.6} fill={Colors.surface} />
        </G>

        {/* Marcas min/max */}
        <Line
          x1={polarToCartesian(cx, cy, r - strokeWidth / 2, START_ANGLE).x}
          y1={polarToCartesian(cx, cy, r - strokeWidth / 2, START_ANGLE).y}
          x2={polarToCartesian(cx, cy, r + strokeWidth / 2, START_ANGLE).x}
          y2={polarToCartesian(cx, cy, r + strokeWidth / 2, START_ANGLE).y}
          stroke={Colors.muted}
          strokeWidth={1}
        />
        <Line
          x1={polarToCartesian(cx, cy, r - strokeWidth / 2, END_ANGLE).x}
          y1={polarToCartesian(cx, cy, r - strokeWidth / 2, END_ANGLE).y}
          x2={polarToCartesian(cx, cy, r + strokeWidth / 2, END_ANGLE).x}
          y2={polarToCartesian(cx, cy, r + strokeWidth / 2, END_ANGLE).y}
          stroke={Colors.muted}
          strokeWidth={1}
        />
      </Svg>

      {/* Valor central */}
      <View style={[styles.valueContainer, { top: size * 0.38 }]}>
        <Text style={[styles.value, { fontSize: size * 0.18, color: needleColor }]}>
          {Number.isFinite(value) ? value.toFixed(value < 10 ? 1 : 0) : '--'}
        </Text>
        <Text style={[styles.unit, { fontSize: size * 0.1 }]}>{unit}</Text>
      </View>

      {/* Etiqueta inferior */}
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    position: 'relative',
  },
  valueContainer: {
    position: 'absolute',
    alignItems: 'center',
    width: '100%',
  },
  value: {
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  unit: {
    color: Colors.textSecondary,
    fontWeight: '500',
    marginTop: -2,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 4,
    textAlign: 'center',
  },
});
