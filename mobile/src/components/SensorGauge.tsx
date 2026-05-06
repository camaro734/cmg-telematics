import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';

interface Props {
  value: number;
  min: number;
  max: number;
  label: string;
  unit: string;
  size?: number;
  warnThreshold?: number;
  critThreshold?: number;
}

export function SensorGauge({
  value,
  min,
  max,
  label,
  unit,
  size = 120,
  warnThreshold,
  critThreshold,
}: Props) {
  const center = size / 2;
  const r = size * 0.38;
  const strokeWidth = size * 0.08;
  const startAngle = 220;
  const totalAngle = 280;

  const clampedValue = Math.min(Math.max(value, min), max);
  const pct = (clampedValue - min) / (max - min);
  const sweepAngle = pct * totalAngle;

  function polarToCartesian(angle: number, radius: number): { x: number; y: number } {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  }

  function describeArc(startA: number, endA: number, radius: number): string {
    const s = polarToCartesian(startA, radius);
    const e = polarToCartesian(endA, radius);
    const largeArc = Math.abs(endA - startA) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  }

  const trackPath = describeArc(startAngle, startAngle - totalAngle, r);
  const fillEndAngle = startAngle - sweepAngle;
  const fillPath = sweepAngle > 0 ? describeArc(startAngle, fillEndAngle, r) : '';

  // Determinar color según umbrales
  let gaugeColor: string = colors.accent;
  if (critThreshold != null && value >= critThreshold) {
    gaugeColor = colors.accentCrit;
  } else if (warnThreshold != null && value >= warnThreshold) {
    gaugeColor = colors.accentWarn;
  }

  const displayValue = Number.isFinite(value) ? value.toFixed(1) : '--';

  return (
    <View style={styles.container}>
      <Svg width={size} height={size}>
        {/* Pista de fondo */}
        <Path
          d={trackPath}
          stroke={colors.bgBorder}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
        {/* Relleno del valor actual */}
        {fillPath !== '' && (
          <Path
            d={fillPath}
            stroke={gaugeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
          />
        )}
        {/* Valor numérico */}
        <SvgText
          x={center}
          y={center + size * 0.08}
          textAnchor="middle"
          fill={colors.textPrimary}
          fontSize={size * 0.18}
          fontWeight="bold"
        >
          {displayValue}
        </SvgText>
        {/* Unidad */}
        <SvgText
          x={center}
          y={center + size * 0.26}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={size * 0.10}
        >
          {unit}
        </SvgText>
      </Svg>
      <Text style={[styles.label, { maxWidth: size }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  label: {
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: -4,
  },
});
