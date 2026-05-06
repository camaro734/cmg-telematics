import React, { useState } from 'react';
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
import { getWorkOrders, changeWorkOrderStatus } from '../api/workOrders';
import { colors, spacing, radius } from '../theme';
import type { WorkOrder, WorkOrderStatus } from '../types';

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pending:     'Pendiente',
  in_progress: 'En curso',
  done:        'Completada',
  cancelled:   'Cancelada',
};

const STATUS_COLORS: Record<WorkOrderStatus, string> = {
  pending:     colors.accentInfo,
  in_progress: colors.accent,
  done:        colors.accentOk,
  cancelled:   colors.textMuted,
};

const PRIORITY_COLORS: Record<string, string> = {
  low:    colors.textMuted,
  normal: colors.textMuted,
  high:   colors.accentWarn,
  urgent: colors.accentCrit,
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
};

const FILTERS: Array<WorkOrderStatus | 'all'> = ['all', 'pending', 'in_progress', 'done'];

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <View style={[badge.wrap, { backgroundColor: color + '22' }]}>
      <Text style={[badge.text, { color }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}
const badge = StyleSheet.create({
  wrap: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  text: { fontSize: 11, fontWeight: '700' },
});

function OrderCard({
  order,
  onStart,
  onComplete,
  onCancel,
}: {
  order: WorkOrder;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <StatusBadge status={order.status} />
        <Text style={[styles.priority, { color: PRIORITY_COLORS[order.priority] }]}>
          {PRIORITY_LABELS[order.priority]}
        </Text>
      </View>

      <Text style={styles.title}>{order.title}</Text>

      {order.location_address != null && (
        <Text style={styles.meta}>📍 {order.location_address}</Text>
      )}
      {order.vehicle_name != null && (
        <Text style={styles.meta}>🚚 {order.vehicle_name}</Text>
      )}
      {order.driver_name != null && (
        <Text style={styles.meta}>👤 {order.driver_name}</Text>
      )}
      {order.scheduled_at != null && (
        <Text style={styles.meta}>
          📅{' '}
          {new Date(order.scheduled_at).toLocaleString('es-ES', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          })}
        </Text>
      )}
      {order.description != null && (
        <Text style={styles.description}>{order.description}</Text>
      )}

      {/* Acciones de transición de estado */}
      {(order.status === 'pending' || order.status === 'in_progress') && (
        <View style={styles.actions}>
          {order.status === 'pending' && (
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: colors.accent }]}
              onPress={onStart}
              activeOpacity={0.8}
            >
              <Text style={[styles.actionText, { color: colors.accent }]}>Iniciar</Text>
            </TouchableOpacity>
          )}
          {order.status === 'in_progress' && (
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: colors.accentOk }]}
              onPress={onComplete}
              activeOpacity={0.8}
            >
              <Text style={[styles.actionText, { color: colors.accentOk }]}>Completar</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.bgBorder }]}
            onPress={onCancel}
            activeOpacity={0.8}
          >
            <Text style={[styles.actionText, { color: colors.textMuted }]}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function WorkOrdersScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<WorkOrderStatus | 'all'>('all');

  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ['work-orders', filter],
    queryFn: () => getWorkOrders({ status: filter, limit: 100 }),
    refetchInterval: 60_000,
  });

  const { mutate: changeStatus } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkOrderStatus }) =>
      changeWorkOrderStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
    onError: () => Alert.alert('Error', 'No se pudo actualizar el estado.'),
  });

  const confirmChange = (order: WorkOrder, newStatus: WorkOrderStatus, label: string) => {
    Alert.alert(
      label,
      `¿${label} "${order.title}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: label, onPress: () => changeStatus({ id: order.id, status: newStatus }) },
      ]
    );
  };

  const activeOrders = orders.filter(o => o.status === 'in_progress').length;
  const pendingOrders = orders.filter(o => o.status === 'pending').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Órdenes de trabajo</Text>
          <Text style={styles.subtitle}>
            {activeOrders} en curso · {pendingOrders} pendientes
          </Text>
        </View>
      </View>

      {/* Filtro de estado */}
      <View style={styles.filters}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? 'Todas' : STATUS_LABELS[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={orders}
        keyExtractor={o => o.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            onStart={() => confirmChange(item, 'in_progress', 'Iniciar')}
            onComplete={() => confirmChange(item, 'done', 'Completar')}
            onCancel={() => confirmChange(item, 'cancelled', 'Cancelar')}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading ? 'Cargando órdenes...' : 'No hay órdenes de trabajo'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  filters: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.bgBorder,
  },
  filterChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  filterTextActive: { color: '#0f1117' },
  list: { padding: spacing.md },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  priority: { fontSize: 11, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 13 },
  description: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  actionText: { fontSize: 13, fontWeight: '700' },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
