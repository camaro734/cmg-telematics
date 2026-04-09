// Dashboard — mapa de flota en tiempo real + lista de vehículos
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ListRenderItemInfo,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFleet } from '@/hooks/useVehicles';
import { useFleetWebSocket, type TelemetryMsg, type AlertMsg } from '@/hooks/useFleetWebSocket';
import { useAppStore } from '@/store/useAppStore';
import { Colors } from '@/constants/colors';
import type { FleetVehicle } from '@/types';

// ─── Posición en vivo desde WebSocket ────────────────────────────────────────
interface LivePosition {
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean;
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────

function StatusDot({ online }: { online: boolean }) {
  return (
    <View
      style={[
        styles.statusDot,
        { backgroundColor: online ? Colors.success : Colors.offline },
      ]}
    />
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statPill, { borderColor: `${color}33` }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

interface VehicleCardProps {
  vehicle: FleetVehicle;
  livePos: LivePosition | undefined;
  onPress: () => void;
}

function VehicleCard({ vehicle, livePos, onPress }: VehicleCardProps) {
  const online = vehicle.device?.online ?? false;
  // Prefer live WebSocket data, fall back to REST snapshot
  const ignition = livePos?.ignition ?? vehicle.last_position?.ignition ?? false;
  const speed = livePos?.speed ?? vehicle.last_position?.speed ?? 0;
  const hasAlerts = vehicle.active_alerts > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <StatusDot online={online} />
          <Text style={styles.cardName} numberOfLines={1}>
            {vehicle.vehicle_name}
          </Text>
        </View>
        {hasAlerts && (
          <View style={styles.alertBadge}>
            <Text style={styles.alertBadgeText}>{vehicle.active_alerts}</Text>
          </View>
        )}
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardPlate}>{vehicle.license_plate}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Motor</Text>
            <Text style={[styles.metaValue, { color: ignition ? Colors.success : Colors.muted }]}>
              {ignition ? 'ON' : 'OFF'}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Velocidad</Text>
            <Text style={styles.metaValue}>{speed.toFixed(0)} km/h</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Estado</Text>
            <Text style={[styles.metaValue, { color: online ? Colors.success : Colors.offline }]}>
              {online ? 'En línea' : 'Sin señal'}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Pantalla principal ──────────────────────────────────────────────────────

export default function FleetDashboard() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { data: fleet, isLoading, isRefetching, refetch, error } = useFleet();
  const wsStatus = useAppStore((s) => s.wsStatus);

  const livePosRef = useRef<Map<string, LivePosition>>(new Map());
  const [livePosVersion, setLivePosVersion] = useState(0);

  const handleTelemetry = useCallback((msg: TelemetryMsg) => {
    const { lat, lng, speed, ignition } = msg.data;
    if (lat !== undefined && lng !== undefined && lat !== 0 && lng !== 0) {
      livePosRef.current.set(msg.vehicle_id, {
        lat: lat as number,
        lng: lng as number,
        speed: (speed as number | undefined) ?? 0,
        ignition: (ignition as boolean | undefined) ?? false,
      });
      setLivePosVersion((v) => v + 1);
    }
  }, []);

  const handleAlert = useCallback((_msg: AlertMsg) => {
    refetch();
  }, [refetch]);

  useFleetWebSocket({ onTelemetry: handleTelemetry, onAlert: handleAlert });

  const stats = useMemo(() => {
    if (!fleet) return { online: 0, alerts: 0, total: 0 };
    return {
      total: fleet.length,
      online: fleet.filter((v) => v.device?.online).length,
      alerts: fleet.reduce((sum, v) => sum + (v.active_alerts ?? 0), 0),
    };
  }, [fleet]);

  // Vehículos con posición válida para mostrar en el mapa
  const markersData = useMemo(() => {
    // livePosVersion se usa aquí para que el memo se re-evalúe cuando llegan datos WS
    void livePosVersion;
    if (!fleet) return [];
    return fleet.flatMap((v) => {
      const live = livePosRef.current.get(String(v.vehicle_id));
      const lat = live?.lat ?? v.last_position?.lat;
      const lng = live?.lng ?? v.last_position?.lng;
      if (!lat || !lng || lat === 0 || lng === 0) return [];
      return [{
        id: v.vehicle_id,
        name: v.vehicle_name,
        plate: v.license_plate,
        lat,
        lng,
        speed: live?.speed ?? v.last_position?.speed ?? 0,
        online: v.device?.online ?? false,
      }];
    });
  }, [fleet, livePosVersion]);

  const handleVehiclePress = useCallback(
    (vehicle: FleetVehicle) => {
      router.push(`/(tabs)/vehicle/${vehicle.vehicle_id}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FleetVehicle>) => (
      <VehicleCard
        vehicle={item}
        livePos={livePosRef.current.get(String(item.vehicle_id))}
        onPress={() => handleVehiclePress(item)}
      />
    ),
    // livePosVersion como dependencia para que las cards se actualicen con datos WS
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleVehiclePress, livePosVersion],
  );

  const keyExtractor = useCallback((item: FleetVehicle) => String(item.vehicle_id), []);

  // Indicador de conexión WS en la esquina del mapa
  const wsColor =
    wsStatus === 'connected' ? Colors.success :
    wsStatus === 'connecting' ? Colors.warning :
    Colors.offline;

  const mapHeight = Math.round(height * 0.4);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Error al cargar la flota</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Mapa de flota (40% pantalla) — placeholder hasta integrar maps ── */}
      <View style={[styles.mapContainer, { height: mapHeight }]}>
        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapPlaceholderText}>🗺️ Mapa de flota</Text>
          <Text style={styles.mapPlaceholderSub}>{markersData.length} vehículos con posición</Text>
        </View>

        {/* Badge de estado WS */}
        <View style={[styles.wsBadge, { borderColor: wsColor }]}>
          <View style={[styles.wsDot, { backgroundColor: wsColor }]} />
          <Text style={[styles.wsLabel, { color: wsColor }]}>
            {wsStatus === 'connected' ? 'EN DIRECTO' :
             wsStatus === 'connecting' ? 'CONECTANDO' : 'SIN SEÑAL'}
          </Text>
        </View>
      </View>

      {/* ── Estadísticas resumen ──────────────────────────────────────────── */}
      <View style={styles.statsRow}>
        <StatPill label="En línea" value={stats.online} color={Colors.success} />
        <StatPill label="Alertas"  value={stats.alerts} color={Colors.danger}  />
        <StatPill label="Total"    value={stats.total}  color={Colors.accent}  />
      </View>

      {/* ── Lista de vehículos (60% pantalla) ────────────────────────────── */}
      <FlatList
        data={fleet ?? []}
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
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No hay vehículos en tu flota</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Mapa
  mapContainer: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mapPlaceholderText: {
    color: Colors.textSecondary,
    fontSize: 18,
  },
  mapPlaceholderSub: {
    color: Colors.muted,
    fontSize: 13,
  },
  callout: {
    backgroundColor: Colors.elevated,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 100,
  },
  calloutName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  calloutDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  wsBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15,17,23,0.85)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  wsDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  wsLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Estadísticas
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statPill: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },

  // Lista
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 8,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  cardName: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  alertBadge: {
    backgroundColor: Colors.danger,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  alertBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  cardBody: {},
  cardPlate: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  cardMeta: {
    flexDirection: 'row',
  },
  metaItem: { flex: 1 },
  metaLabel: {
    color: Colors.muted,
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 2,
  },
  metaValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },

  // Genéricos
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyText: {
    color: Colors.muted,
    fontSize: 15,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: Colors.accent,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
});
