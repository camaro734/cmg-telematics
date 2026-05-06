import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import type { Vehicle } from '../types';
import { colors, spacing, radius } from '../theme';
import { StatusBadge } from './StatusBadge';

interface Props {
  vehicle: Vehicle;
  onPress: () => void;
}

export function VehicleCard({ vehicle, onPress }: Props) {
  const isOnline = vehicle.status !== 'offline';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.name}>{vehicle.name}</Text>
          <Text style={styles.plate}>{vehicle.plate}</Text>
        </View>
        <StatusBadge status={vehicle.status} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.meta}>
          {isOnline && vehicle.speed != null
            ? `${vehicle.speed.toFixed(0)} km/h`
            : vehicle.last_seen
              ? `Última señal: ${new Date(vehicle.last_seen).toLocaleTimeString('es', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'Sin datos'}
        </Text>
        {vehicle.lat != null && vehicle.lng != null && (
          <Text style={styles.coords}>
            {vehicle.lat.toFixed(4)}, {vehicle.lng.toFixed(4)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  plate: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  coords: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
