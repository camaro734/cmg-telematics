import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { VehicleStatus } from '../types';
import { colors, radius, spacing } from '../theme';

const STATUS_CONFIG: Record<VehicleStatus, { color: string; label: string }> = {
  online:  { color: colors.accentOk,   label: 'En línea' },
  moving:  { color: colors.accent,     label: 'En movimiento' },
  idle:    { color: colors.accentWarn, label: 'Ralentí' },
  offline: { color: colors.accentOff,  label: 'Sin señal' },
};

interface Props {
  status: VehicleStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: Props) {
  const { color, label } = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {size === 'md' && <Text style={[styles.label, { color }]}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    gap: spacing.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
