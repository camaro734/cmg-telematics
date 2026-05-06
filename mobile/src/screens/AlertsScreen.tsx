import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAlerts, acknowledgeAlert } from '../api/alerts';
import { colors, spacing, radius } from '../theme';
import type { Alert as AlertType } from '../types';

const SEVERITY_COLOR: Record<string, string> = {
  info:     colors.accentInfo,
  warning:  colors.accentWarn,
  critical: colors.accentCrit,
};

export function AlertsScreen() {
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading, refetch } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => getAlerts({ status: 'firing' }),
    refetchInterval: 30_000,
  });

  const ackMutation = useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const handleAck = (alertItem: AlertType) => {
    Alert.alert(
      'Reconocer alerta',
      `¿Reconocer la alerta "${alertItem.rule_name}" del vehículo ${alertItem.vehicle_name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reconocer',
          onPress: () => ackMutation.mutate(alertItem.id),
        },
      ]
    );
  };

  const firingCount = alerts.filter((a) => a.status === 'firing').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Alertas activas</Text>
        {firingCount > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{firingCount}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={alerts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        renderItem={({ item }) => {
          const color = SEVERITY_COLOR[item.severity] ?? colors.accentInfo;
          return (
            <View style={[styles.card, { borderLeftColor: color, borderLeftWidth: 3 }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.ruleName}>{item.rule_name}</Text>
                <Text style={[styles.severityLabel, { color }]}>
                  {item.severity.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.vehicleName}>{item.vehicle_name}</Text>
              <Text style={styles.time}>
                {new Date(item.triggered_at).toLocaleString('es', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              {item.status === 'firing' && (
                <TouchableOpacity
                  style={styles.ackBtn}
                  onPress={() => handleAck(item)}
                  activeOpacity={0.8}
                  disabled={ackMutation.isPending}
                >
                  <Text style={styles.ackText}>Reconocer</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading ? 'Cargando alertas...' : 'No hay alertas activas'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  countBadge: {
    backgroundColor: colors.accentCrit,
    borderRadius: radius.full,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  list: {
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  ruleName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: spacing.sm,
  },
  severityLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  vehicleName: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 4,
  },
  time: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  ackBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.bgBorder,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  ackText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
