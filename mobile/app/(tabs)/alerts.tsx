// Pantalla de alertas — Safety Inbox estilo Samsara
import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ListRenderItemInfo,
} from 'react-native';
import { useAlerts } from '@/hooks/useAlerts';
import { Colors } from '@/constants/colors';
import type { Alert, AlertLevel } from '@/types';

const LEVEL_COLOR: Record<AlertLevel, string> = {
  critical: Colors.danger,
  high:     Colors.danger,
  warning:  Colors.warning,
  info:     Colors.accent,
};

const LEVEL_LABEL: Record<AlertLevel, string> = {
  critical: 'Crítico',
  high:     'Alto',
  warning:  'Aviso',
  info:     'Info',
};

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

function AlertCard({ alert }: { alert: Alert }) {
  const levelColor = LEVEL_COLOR[alert.level] ?? Colors.warning;
  const acknowledged = !!alert.acknowledged_at;

  return (
    <View style={[styles.card, acknowledged && styles.cardAck]}>
      <View style={[styles.levelBar, { backgroundColor: levelColor }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={[styles.levelBadge, { backgroundColor: `${levelColor}22` }]}>
            <Text style={[styles.levelText, { color: levelColor }]}>
              {LEVEL_LABEL[alert.level] ?? alert.level}
            </Text>
          </View>
          {acknowledged && (
            <Text style={styles.ackLabel}>Reconocida</Text>
          )}
          <Text style={styles.timeText}>{timeAgo(alert.fired_at)}</Text>
        </View>

        {/* Descripción legible — NO código hex crudo */}
        <Text style={styles.displayName}>{alert.display_name}</Text>

        {alert.converted_value !== null && alert.threshold !== null && (
          <Text style={styles.valueText}>
            Valor:{' '}
            <Text style={{ color: levelColor }}>
              {String(alert.converted_value)} {alert.unit}
            </Text>
            {'  '}Umbral: {String(alert.threshold)} {alert.unit}
          </Text>
        )}

        <Text style={styles.vehicleName}>{alert.vehicle_name}</Text>
      </View>
    </View>
  );
}

// Orden de severidad para el inbox
const SEVERITY_ORDER: Record<AlertLevel, number> = {
  critical: 0,
  high:     1,
  warning:  2,
  info:     3,
};

export default function AlertsScreen() {
  const { data: alerts, isLoading, isRefetching, refetch, error } = useAlerts();

  const sorted = React.useMemo(() => {
    if (!alerts) return [];
    return [...alerts].sort((a, b) => {
      const aDiff = (SEVERITY_ORDER[a.level] ?? 4) - (SEVERITY_ORDER[b.level] ?? 4);
      if (aDiff !== 0) return aDiff;
      return new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime();
    });
  }, [alerts]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Alert>) => <AlertCard alert={item} />,
    [],
  );

  const keyExtractor = useCallback((item: Alert) => String(item.id), []);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Error al cargar alertas</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Cabecera con contadores */}
      {sorted.length > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {sorted.filter((a) => !a.acknowledged_at).length} activa{sorted.filter((a) => !a.acknowledged_at).length !== 1 ? 's' : ''}
            {'  ·  '}
            {sorted.filter((a) => a.level === 'critical' || a.level === 'high').length} crítica{sorted.filter((a) => a.level === 'critical' || a.level === 'high').length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      <FlatList
        data={sorted}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading || isRefetching}
            onRefresh={refetch}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>✓</Text>
              <Text style={styles.emptyTitle}>Sin alertas activas</Text>
              <Text style={styles.emptySubtitle}>Todos los vehículos operan con normalidad</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summaryBar: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  summaryText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
  list: { padding: 12, gap: 6, paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardAck: { opacity: 0.6 },
  levelBar: { width: 4, alignSelf: 'stretch' },
  cardContent: { flex: 1, padding: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  levelBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  levelText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  ackLabel: { color: Colors.muted, fontSize: 11 },
  timeText: { color: Colors.muted, fontSize: 11, marginLeft: 'auto' },
  displayName: { color: Colors.text, fontSize: 14, fontWeight: '600', marginBottom: 4 },
  valueText: { color: Colors.textSecondary, fontSize: 13, marginBottom: 4 },
  vehicleName: { color: Colors.muted, fontSize: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: Colors.textSecondary, fontSize: 16, marginBottom: 16 },
  retryBtn: { backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48, marginTop: 60 },
  emptyIcon: { fontSize: 48, color: Colors.success, marginBottom: 12 },
  emptyTitle: { color: Colors.text, fontSize: 18, fontWeight: '600', marginBottom: 6 },
  emptySubtitle: { color: Colors.muted, fontSize: 14, textAlign: 'center' },
});
