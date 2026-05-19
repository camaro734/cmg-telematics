import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getWorkOrders } from '../api/workOrders';
import { colors, spacing, radius } from '../theme';
import type { MainTabParamList } from '../navigation/MainNavigator';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { WorkOrder, WorkOrderStatus } from '../types';

type WorkOrdersNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Orders'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Props = {
  navigation: WorkOrdersNavProp;
};

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
  onPress,
}: {
  order: WorkOrder;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
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
        <Text style={styles.description} numberOfLines={2}>{order.description}</Text>
      )}

      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export function WorkOrdersScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<WorkOrderStatus | 'all'>('all');

  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ['work-orders', filter],
    queryFn: () => getWorkOrders({ status: filter, limit: 100 }),
    refetchInterval: 60_000,
  });

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
            onPress={() => navigation.navigate('WorkOrderDetail', { workOrderId: item.id })}
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
  priority: { fontSize: 11, fontWeight: '700', flex: 1 },
  chevron: { color: colors.textMuted, fontSize: 20, position: 'absolute', right: spacing.md, top: spacing.md },
  meta: { color: colors.textSecondary, fontSize: 13 },
  description: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
