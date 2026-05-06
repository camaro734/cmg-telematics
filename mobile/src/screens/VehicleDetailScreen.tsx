import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { getVehicleStatus, getKpis, getTrack } from '../api/fleet';
import { getAlerts } from '../api/alerts';
import { SensorGauge } from '../components/SensorGauge';
import { DoutButton } from '../components/DoutButton';
import { StatusBadge } from '../components/StatusBadge';
import { colors, spacing, radius } from '../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'VehicleDetail'>;

type Tab = 'live' | 'history' | 'alerts';

// Tarjeta de estado individual (ignición, PTO, velocidad, voltaje)
function StatusCard({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <View style={[scStyles.card, active === true && scStyles.cardActive]}>
      <Text style={scStyles.label}>{label}</Text>
      <Text style={[scStyles.value, active === true && { color: colors.accentOk }]}>
        {value}
      </Text>
    </View>
  );
}

const scStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    padding: spacing.sm,
    alignItems: 'center',
    margin: 3,
    minWidth: 75,
  },
  cardActive: {
    borderColor: colors.accentOk,
  },
  label: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  value: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginTop: 2,
  },
});

// Estilos del mapa oscuro
const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9CA3AF' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d3748' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
];

export function VehicleDetailScreen({ route, navigation }: Props) {
  const { vehicleId } = route.params;
  const [tab, setTab] = useState<Tab>('live');

  // Datos en vivo — solo activos cuando la tab correspondiente está visible
  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['vehicle-status', vehicleId],
    queryFn: () => getVehicleStatus(vehicleId),
    refetchInterval: 30_000,
    enabled: tab === 'live',
  });

  const { data: track = [], refetch: refetchTrack } = useQuery({
    queryKey: ['vehicle-track', vehicleId],
    queryFn: () => getTrack(vehicleId, 2),
    enabled: tab === 'live',
  });

  // KPIs históricos — solo cuando se necesitan
  const { data: kpis = [], isLoading: kpisLoading, refetch: refetchKpis } = useQuery({
    queryKey: ['vehicle-kpis', vehicleId],
    queryFn: () => getKpis(vehicleId, 7),
    enabled: tab === 'history',
  });

  // Alertas del vehículo
  const { data: alerts = [], isLoading: alertsLoading, refetch: refetchAlerts } = useQuery({
    queryKey: ['vehicle-alerts', vehicleId],
    queryFn: () => getAlerts({ vehicle_id: vehicleId }),
    enabled: tab === 'alerts',
  });

  const handleRefresh = () => {
    if (tab === 'live') {
      void refetchStatus();
      void refetchTrack();
    } else if (tab === 'history') {
      void refetchKpis();
    } else {
      void refetchAlerts();
    }
  };

  const isRefreshing =
    tab === 'live' ? statusLoading :
    tab === 'history' ? kpisLoading :
    alertsLoading;

  // Coordenadas para el mapa de ruta
  const trackCoords = track.map((p) => ({ latitude: p.lat, longitude: p.lng }));
  const lastPos = trackCoords[trackCoords.length - 1];

  // Calcular dimensiones del gráfico de barras SVG
  const chartW = 300;
  const chartH = 120;
  const safeKpis = kpis.length > 0 ? kpis : [];
  const maxHours = Math.max(
    ...safeKpis.map((k) => Math.max(k.engine_hours, k.pto_hours, 0.1)),
    0.1
  );
  const barGroupW = safeKpis.length > 0 ? chartW / safeKpis.length : 40;
  const barW = barGroupW * 0.3;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Cabecera con botón atrás y badge de estado */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>Atras</Text>
        </TouchableOpacity>
        {status && <StatusBadge status={status.status} />}
      </View>

      {/* Tabs de navegación interna */}
      <View style={styles.tabs}>
        {(['live', 'history', 'alerts'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'live' ? 'EN VIVO' : t === 'history' ? 'HISTORICO' : 'ALERTAS'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ======================== TAB: EN VIVO ======================== */}
      {tab === 'live' && (
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
        >
          {/* Mapa con ruta reciente */}
          <MapView
            provider={PROVIDER_DEFAULT}
            style={styles.map}
            customMapStyle={darkMapStyle}
            region={
              lastPos
                ? {
                    latitude: lastPos.latitude,
                    longitude: lastPos.longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }
                : status?.lat != null && status?.lng != null
                ? {
                    latitude: status.lat,
                    longitude: status.lng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }
                : undefined
            }
          >
            {trackCoords.length > 1 && (
              <Polyline
                coordinates={trackCoords}
                strokeColor={colors.accent}
                strokeWidth={3}
              />
            )}
            {lastPos && <Marker coordinate={lastPos} pinColor={colors.accent} />}
          </MapView>

          {/* Tarjetas de estado: Ignición, PTO, Velocidad, Voltaje */}
          {status && (
            <View style={styles.statusGrid}>
              <StatusCard
                label="IGNICION"
                value={status.ignition ? 'ON' : 'OFF'}
                active={status.ignition}
              />
              <StatusCard
                label="PTO"
                value={status.pto_active ? 'ACTIVO' : 'INACTIVO'}
                active={status.pto_active}
              />
              <StatusCard
                label="VELOCIDAD"
                value={`${(status.speed ?? 0).toFixed(0)} km/h`}
              />
              <StatusCard
                label="VOLTAJE"
                value={
                  status.power_voltage != null
                    ? `${status.power_voltage.toFixed(1)} V`
                    : '--'
                }
              />
            </View>
          )}

          {/* Gauges de sensores CAN */}
          {status && Object.keys(status.can_data).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>SENSORES CAN</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.gaugeRow}>
                  {Object.entries(status.can_data)
                    .filter(([, v]) => typeof v === 'number')
                    .slice(0, 8)
                    .map(([key, val]) => (
                      <SensorGauge
                        key={key}
                        label={key.replace(/_/g, ' ')}
                        value={val as number}
                        min={0}
                        max={100}
                        unit=""
                        size={100}
                      />
                    ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Botones de control DOUT */}
          {status && Object.keys(status.dout_state).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>SALIDAS DIGITALES (DOUT)</Text>
              <View style={styles.doutRow}>
                {Object.entries(status.dout_state).map(([ch, state]) => (
                  <DoutButton
                    key={ch}
                    vehicleId={vehicleId}
                    channel={Number(ch)}
                    label={`DOUT ${ch}`}
                    currentState={state}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Sin datos */}
          {!statusLoading && !status && (
            <Text style={styles.empty}>
              Sin datos de telemetria disponibles
            </Text>
          )}
        </ScrollView>
      )}

      {/* ======================== TAB: HISTORICO ======================== */}
      {tab === 'history' && (
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
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>HORAS MOTOR Y PTO — ULTIMOS 7 DIAS</Text>

            {/* Grafico de barras SVG sin dependencias externas */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Svg width={chartW} height={chartH + 30}>
                {safeKpis.map((kpi, i) => {
                  const engineH = Math.max((kpi.engine_hours / maxHours) * chartH, 1);
                  const ptoH = Math.max((kpi.pto_hours / maxHours) * chartH, 1);
                  const x = i * barGroupW + barGroupW * 0.1;
                  const dateLabel = new Date(kpi.date).toLocaleDateString('es', {
                    day: '2-digit',
                    month: '2-digit',
                  });
                  return (
                    <React.Fragment key={kpi.date}>
                      {/* Barra motor (cyan) */}
                      <Rect
                        x={x}
                        y={chartH - engineH}
                        width={barW}
                        height={engineH}
                        fill={colors.accent}
                        rx={3}
                      />
                      {/* Barra PTO (naranja) */}
                      <Rect
                        x={x + barW + 3}
                        y={chartH - ptoH}
                        width={barW}
                        height={ptoH}
                        fill={colors.accentWarn}
                        rx={3}
                      />
                      {/* Etiqueta de fecha */}
                      <SvgText
                        x={x + barW}
                        y={chartH + 18}
                        textAnchor="middle"
                        fill={colors.textMuted}
                        fontSize={10}
                      >
                        {dateLabel}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
              </Svg>
            </ScrollView>

            {/* Leyenda del gráfico */}
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
                <Text style={styles.legendLabel}>Motor</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.accentWarn }]} />
                <Text style={styles.legendLabel}>PTO</Text>
              </View>
            </View>

            {/* Tabla de valores diarios */}
            {safeKpis.map((k) => (
              <View key={k.date} style={styles.kpiRow}>
                <Text style={styles.kpiDate}>
                  {new Date(k.date).toLocaleDateString('es', {
                    weekday: 'short',
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </Text>
                <Text style={styles.kpiVal}>{k.engine_hours.toFixed(1)}h motor</Text>
                <Text style={[styles.kpiVal, { color: colors.accentWarn }]}>
                  {k.pto_hours.toFixed(1)}h PTO
                </Text>
              </View>
            ))}

            {safeKpis.length === 0 && !kpisLoading && (
              <Text style={styles.empty}>Sin datos historicos disponibles</Text>
            )}
          </View>
        </ScrollView>
      )}

      {/* ======================== TAB: ALERTAS ======================== */}
      {tab === 'alerts' && (
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
        >
          <View style={styles.section}>
            {alerts.length === 0 && !alertsLoading ? (
              <Text style={styles.empty}>No hay alertas para este vehiculo</Text>
            ) : (
              alerts.map((a) => {
                const borderColor =
                  a.severity === 'critical'
                    ? colors.accentCrit
                    : a.severity === 'warning'
                    ? colors.accentWarn
                    : colors.accentInfo;
                return (
                  <View
                    key={a.id}
                    style={[styles.alertCard, { borderLeftColor: borderColor, borderLeftWidth: 3 }]}
                  >
                    <View style={styles.alertHeader}>
                      <Text style={styles.alertRule}>{a.rule_name}</Text>
                      <Text style={[styles.alertSeverity, { color: borderColor }]}>
                        {a.severity.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.alertTime}>
                      {new Date(a.triggered_at).toLocaleString('es', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                    <Text style={styles.alertStatus}>{a.status.toUpperCase()}</Text>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    padding: spacing.xs,
  },
  backText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.bgBorder,
    paddingHorizontal: spacing.md,
  },
  tabBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.xs,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: colors.accent,
  },
  scroll: {
    flex: 1,
  },
  map: {
    height: 220,
    margin: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  section: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  gaugeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  doutRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  kpiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgBorder,
  },
  kpiDate: {
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  kpiVal: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginLeft: spacing.sm,
  },
  alertCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  alertRule: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
    marginRight: spacing.sm,
  },
  alertSeverity: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  alertTime: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 3,
  },
  alertStatus: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
});
