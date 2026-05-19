import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import { colors, spacing, radius } from '../theme';
import type { WorkOrderStop, WorkOrderStopStatus } from '../types';

const STATUS_LABELS: Record<WorkOrderStopStatus, string> = {
  pending:     'Pendiente',
  arrived:     'Llegado',
  in_progress: 'En curso',
  done:        'Completado',
  skipped:     'Saltado',
};

const STATUS_COLORS: Record<WorkOrderStopStatus, string> = {
  pending:     colors.textMuted,
  arrived:     colors.accentInfo,
  in_progress: colors.accent,
  done:        colors.accentOk,
  skipped:     colors.accentCrit,
};

function circleBg(status: WorkOrderStopStatus): string {
  if (status === 'done' || status === 'arrived') return colors.accentOk;
  if (status === 'in_progress') return colors.accent;
  return colors.bgBorder;
}

async function openMaps(lat: number, lon: number) {
  const url = Platform.OS === 'ios'
    ? `maps://?daddr=${lat},${lon}`
    : `geo:${lat},${lon}?q=${lat},${lon}`;
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
  }
}

type Props = {
  stop: WorkOrderStop;
  index: number;
};

export function StopItem({ stop, index }: Props) {
  const color = STATUS_COLORS[stop.status];
  const bgColor = circleBg(stop.status);

  return (
    <View style={styles.row}>
      <View style={[styles.circle, { backgroundColor: bgColor }]}>
        <Text style={styles.circleText}>{index + 1}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {stop.title || `Parada ${index + 1}`}
        </Text>
        {stop.address != null && (
          <Text style={styles.address} numberOfLines={2}>{stop.address}</Text>
        )}
        {stop.client_name != null && (
          <Text style={styles.meta}>👤 {stop.client_name}</Text>
        )}
        <View style={styles.footer}>
          <View style={[styles.badge, { backgroundColor: color + '22' }]}>
            <Text style={[styles.badgeText, { color }]}>{STATUS_LABELS[stop.status]}</Text>
          </View>
          {stop.arrival_radius_m > 0 && (
            <Text style={styles.radius}>{stop.arrival_radius_m} m</Text>
          )}
        </View>
      </View>

      {stop.lat != null && stop.lon != null && (
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => void openMaps(stop.lat!, stop.lon!)}
          activeOpacity={0.8}
        >
          <Text style={styles.navText}>Navegar</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgBorder,
    gap: spacing.sm,
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  circleText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  content: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  address: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 3,
  },
  badge: {
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  radius: {
    color: colors.textMuted,
    fontSize: 11,
  },
  navBtn: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'center',
    flexShrink: 0,
  },
  navText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
});
