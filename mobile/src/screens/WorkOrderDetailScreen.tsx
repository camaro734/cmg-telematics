import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getWorkOrder, getWorkOrderStops, changeWorkOrderStatus } from '../api/workOrders';
import { StopItem } from '../components/StopItem';
import { colors, spacing, radius } from '../theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { WorkOrderStatus } from '../types';

const ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pending:     'Pendiente',
  in_progress: 'En curso',
  done:        'Completada',
  cancelled:   'Cancelada',
};
const ORDER_STATUS_COLORS: Record<WorkOrderStatus, string> = {
  pending:     colors.accentInfo,
  in_progress: colors.accent,
  done:        colors.accentOk,
  cancelled:   colors.textMuted,
};

function OrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const color = ORDER_STATUS_COLORS[status];
  return (
    <View style={[osBadge.wrap, { backgroundColor: color + '22' }]}>
      <Text style={[osBadge.text, { color }]}>{ORDER_STATUS_LABELS[status]}</Text>
    </View>
  );
}
const osBadge = StyleSheet.create({
  wrap: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  text: { fontSize: 11, fontWeight: '700' },
});

type Props = NativeStackScreenProps<RootStackParamList, 'WorkOrderDetail'>;

const PRIORITY_COLORS: Record<string, string> = {
  low:    colors.textMuted,
  normal: colors.textMuted,
  high:   colors.accentWarn,
  urgent: colors.accentCrit,
};
const PRIORITY_LABELS: Record<string, string> = {
  low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
};

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9CA3AF' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d3748' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
];

export function WorkOrderDetailScreen({ route, navigation }: Props) {
  const { workOrderId } = route.params;
  const qc = useQueryClient();

  const {
    data: order,
    isLoading: orderLoading,
    refetch: refetchOrder,
  } = useQuery({
    queryKey: ['work-order', workOrderId],
    queryFn: () => getWorkOrder(workOrderId),
  });

  const {
    data: stops = [],
    isLoading: stopsLoading,
    refetch: refetchStops,
  } = useQuery({
    queryKey: ['work-order-stops', workOrderId],
    queryFn: () => getWorkOrderStops(workOrderId),
  });

  const { mutate: changeStatus, isPending: statusPending } = useMutation({
    mutationFn: ({ status }: { status: WorkOrderStatus }) =>
      changeWorkOrderStatus(workOrderId, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      void refetchOrder();
    },
    onError: () => Alert.alert('Error', 'No se pudo actualizar el estado.'),
  });

  const handleStart = () => {
    Alert.alert('Iniciar orden', `¿Iniciar "${order?.title}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Iniciar', onPress: () => changeStatus({ status: 'in_progress' }) },
    ]);
  };

  const handleCancel = () => {
    Alert.alert('Cancelar orden', `¿Cancelar "${order?.title}"?`, [
      { text: 'No', style: 'cancel' },
      { text: 'Cancelar orden', style: 'destructive', onPress: () => changeStatus({ status: 'cancelled' }) },
    ]);
  };

  const stopsWithCoords = stops.filter((s) => s.lat != null && s.lon != null);
  const mapRegion = stopsWithCoords.length > 0
    ? {
        latitude: stopsWithCoords[0].lat!,
        longitude: stopsWithCoords[0].lon!,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : undefined;

  const isRefreshing = orderLoading || stopsLoading;

  const handleRefresh = () => {
    void refetchOrder();
    void refetchStops();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Cabecera */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Atrás</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {order && <OrderStatusBadge status={order.status} />}
          {order && (order.status === 'pending' || order.status === 'in_progress') && (
            <TouchableOpacity onPress={handleCancel}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {/* Título y metadatos */}
        {order && (
          <View style={styles.section}>
            <Text style={styles.title}>{order.title}</Text>
            <View style={styles.meta}>
              <Text style={[styles.metaItem, { color: PRIORITY_COLORS[order.priority] }]}>
                {PRIORITY_LABELS[order.priority]}
              </Text>
              {order.vehicle_name != null && (
                <Text style={styles.metaItem}>🚚 {order.vehicle_name}</Text>
              )}
              {order.driver_name != null && (
                <Text style={styles.metaItem}>👤 {order.driver_name}</Text>
              )}
              {order.scheduled_at != null && (
                <Text style={styles.metaItem}>
                  📅 {new Date(order.scheduled_at).toLocaleString('es-ES', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              )}
            </View>
            {order.description != null && (
              <Text style={styles.description}>{order.description}</Text>
            )}
          </View>
        )}

        {/* Mapa de paradas */}
        {stopsWithCoords.length > 0 && mapRegion && (
          <MapView
            provider={PROVIDER_DEFAULT}
            style={styles.map}
            customMapStyle={darkMapStyle}
            region={mapRegion}
          >
            {stopsWithCoords.map((stop, i) => (
              <Marker
                key={stop.id}
                coordinate={{ latitude: stop.lat!, longitude: stop.lon! }}
                title={stop.title || `Parada ${i + 1}`}
                description={stop.address ?? undefined}
                pinColor={stop.status === 'done' ? '#22C55E' : colors.accent}
              />
            ))}
          </MapView>
        )}

        {/* Lista de paradas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            PARADAS ({stops.length})
          </Text>
          {stops.length === 0 && !stopsLoading ? (
            <Text style={styles.empty}>Sin paradas definidas</Text>
          ) : (
            stops.map((stop, i) => (
              <StopItem key={stop.id} stop={stop} index={i} />
            ))
          )}
        </View>

        {/* Espacio para el botón flotante */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Botón de acción flotante */}
      {order?.status === 'pending' && (
        <View style={styles.floatingBtn}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.accent }]}
            onPress={handleStart}
            disabled={statusPending}
            activeOpacity={0.85}
          >
            <Text style={styles.actionText}>Iniciar orden</Text>
          </TouchableOpacity>
        </View>
      )}
      {order?.status === 'in_progress' && (
        <View style={styles.floatingBtn}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.accentOk }]}
            onPress={() => navigation.navigate('WorkReport', { workOrderId })}
            activeOpacity={0.85}
          >
            <Text style={styles.actionText}>Cerrar orden</Text>
          </TouchableOpacity>
        </View>
      )}
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
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgBorder,
  },
  backBtn: { padding: spacing.xs },
  backText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancelText: { color: colors.accentCrit, fontSize: 13, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.md },
  section: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgBorder,
  },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: spacing.sm },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metaItem: { color: colors.textSecondary, fontSize: 13 },
  description: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
  map: {
    height: 200,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
  floatingBtn: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    backgroundColor: colors.bgBase,
    borderTopWidth: 1,
    borderTopColor: colors.bgBorder,
  },
  actionBtn: {
    borderRadius: radius.sm,
    paddingVertical: 16,
    alignItems: 'center',
  },
  actionText: { color: '#0f1117', fontWeight: '800', fontSize: 15 },
});
