// Detalle de vehículo — telemetría en tiempo real + gauges SVG + comandos DOUT
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useVehicleLast, useLiveSignals } from '@/hooks/useVehicleTelemetry';
import { useFleetWebSocket, type TelemetryMsg } from '@/hooks/useFleetWebSocket';
import { vehicleKeys } from '@/hooks/useVehicles';
import { commands } from '@/services/api';
import { CircularGauge } from '@/components/gauges/CircularGauge';
import { LiveIndicator } from '@/components/common/LiveIndicator';
import { Colors } from '@/constants/colors';
import type { LiveSignal, VehicleLastData } from '@/types';

// ─── LED de estado binario ────────────────────────────────────────────────────

function LedIndicator({
  label,
  active,
  activeColor = Colors.success,
}: {
  label: string;
  active: boolean;
  activeColor?: string;
}) {
  return (
    <View style={styles.led}>
      <View style={[styles.ledDot, { backgroundColor: active ? activeColor : Colors.muted }]} />
      <Text style={styles.ledLabel}>{label}</Text>
    </View>
  );
}

// ─── Tarjeta de señal CAN ─────────────────────────────────────────────────────

function SignalCard({ signal }: { signal: LiveSignal }) {
  const isBoolean = typeof signal.converted_value === 'boolean';
  const displayValue = signal.converted_value !== null ? String(signal.converted_value) : '--';

  return (
    <View style={styles.signalCard}>
      <Text style={styles.signalName} numberOfLines={1}>{signal.display_name}</Text>
      <View style={styles.signalValueRow}>
        {isBoolean ? (
          <View
            style={[
              styles.boolBadge,
              { backgroundColor: signal.converted_value ? Colors.success : Colors.muted },
            ]}
          >
            <Text style={styles.boolBadgeText}>
              {signal.converted_value ? 'ON' : 'OFF'}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.signalValue}>{displayValue}</Text>
            {signal.unit ? (
              <Text style={styles.signalUnit}>{signal.unit}</Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

// ─── Botón de comando DOUT ────────────────────────────────────────────────────

interface DoutButtonProps {
  label: string;
  output: 'DOUT1' | 'DOUT2';
  active: boolean;
  imei: string;
  disabled?: boolean;
}

function DoutButton({ label, output, active, imei, disabled }: DoutButtonProps) {
  const [loading, setLoading] = useState(false);

  const handlePress = useCallback(async () => {
    const newValue = !active;
    const actionLabel = newValue ? 'activar' : 'desactivar';
    Alert.alert(
      'Confirmar comando',
      `¿Deseas ${actionLabel} ${label}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          style: newValue ? 'default' : 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await commands.sendDout(imei, output, newValue);
              Alert.alert('Comando enviado', `${label} ${newValue ? 'activado' : 'desactivado'}.`);
            } catch {
              Alert.alert('Error', 'No se pudo enviar el comando. Verifica la conexión.');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }, [active, label, output, imei]);

  return (
    <TouchableOpacity
      style={[
        styles.doutButton,
        active ? styles.doutButtonActive : styles.doutButtonInactive,
        ((disabled ?? false) || loading) && styles.doutButtonDisabled,
      ]}
      onPress={handlePress}
      disabled={(disabled ?? false) || loading}
      activeOpacity={0.75}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <>
          <View style={[styles.doutDot, { backgroundColor: active ? Colors.success : Colors.muted }]} />
          <Text style={styles.doutLabel}>{label}</Text>
          <Text style={[styles.doutState, { color: active ? Colors.success : Colors.muted }]}>
            {active ? 'ON' : 'OFF'}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicleId = Number(id);
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  const {
    data: lastData,
    isLoading: lastLoading,
    isRefetching: lastRefetching,
    refetch: refetchLast,
  } = useVehicleLast(vehicleId);

  const {
    data: signalsData,
    isLoading: signalsLoading,
    refetch: refetchSignals,
  } = useLiveSignals(vehicleId);

  // Estado en vivo superpuesto sobre los datos de polling REST
  const [liveTel, setLiveTel] = useState<Partial<VehicleLastData> | null>(null);
  const [wsActive, setWsActive] = useState(false);

  const handleTelemetry = useCallback(
    (msg: TelemetryMsg) => {
      if (String(msg.vehicle_id) !== String(vehicleId)) return;
      setLiveTel(msg.data as Partial<VehicleLastData>);
      setWsActive(true);
      // Actualizar cache de React Query con los nuevos datos
      queryClient.invalidateQueries({ queryKey: vehicleKeys.last(vehicleId) });
    },
    [vehicleId, queryClient],
  );

  useFleetWebSocket({
    onTelemetry: handleTelemetry,
    onStatusChange: (status) => {
      if (status !== 'connected') setWsActive(false);
    },
  });

  useEffect(() => {
    if (lastData?.vehicle_name) {
      navigation.setOptions({ title: lastData.vehicle_name });
    }
  }, [lastData?.vehicle_name, navigation]);

  const handleRefresh = useCallback(() => {
    refetchLast();
    refetchSignals();
  }, [refetchLast, refetchSignals]);

  const connectionStatus = wsActive
    ? 'live'
    : lastLoading
    ? 'connecting'
    : lastRefetching
    ? 'polling'
    : 'live';

  if (lastLoading && !lastData) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.accent} size="large" />
        <Text style={styles.loadingText}>Cargando telemetría...</Text>
      </View>
    );
  }

  // Mezclar datos REST con actualizaciones WS — WS tiene prioridad
  const tel: VehicleLastData | null = lastData?.data
    ? { ...lastData.data, ...(liveTel ?? {}) }
    : null;

  const ignition = tel?.ignition === true;
  const speed = typeof tel?.speed === 'number' ? tel.speed : 0;
  const voltage = typeof tel?.ext_voltage_mv === 'number' ? tel.ext_voltage_mv / 1000 : 0;
  const hasGps = tel?.lat !== null && tel?.lat !== undefined && tel.lat !== 0;
  const dout1Active = tel?.dout1 === 1;
  const dout2Active = tel?.dout2 === 1;
  const imei = lastData?.imei ?? '';

  const signals = signalsData?.signals ?? [];
  const numericSignals = signals
    .filter((s) => typeof s.converted_value === 'number' && s.unit)
    .slice(0, 2);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={lastRefetching || signalsLoading}
          onRefresh={handleRefresh}
          tintColor={Colors.accent}
          colors={[Colors.accent]}
        />
      }
    >
      {/* ── Header de estado ───────────────────────────────────────────── */}
      <View style={styles.statusHeader}>
        <View style={styles.vehicleInfo}>
          <Text style={styles.vehicleName}>{lastData?.vehicle_name ?? `Vehículo ${vehicleId}`}</Text>
          <Text style={styles.vehiclePlate}>{lastData?.license_plate ?? ''}</Text>
        </View>
        <LiveIndicator status={connectionStatus} />
      </View>

      {/* ── Fila de LEDs ───────────────────────────────────────────────── */}
      <View style={styles.ledRow}>
        <LedIndicator label="Motor"   active={ignition} />
        <LedIndicator label="GPS"     active={hasGps}   />
        <LedIndicator
          label="Batería"
          active={voltage > 12.0}
          activeColor={voltage > 13.5 ? Colors.success : Colors.warning}
        />
        <LedIndicator
          label="DOUT1"
          active={dout1Active}
          activeColor={Colors.accent}
        />
      </View>

      {/* ── Grid de gauges 2×2 ─────────────────────────────────────────── */}
      <View style={styles.gaugesGrid}>
        <CircularGauge
          value={speed}
          min={0}
          max={120}
          label="Velocidad"
          unit="km/h"
          zones={[
            { from: 0,   to: 0.7, color: Colors.success },
            { from: 0.7, to: 0.9, color: Colors.warning },
            { from: 0.9, to: 1,   color: Colors.danger  },
          ]}
        />
        <CircularGauge
          value={voltage}
          min={10}
          max={16}
          label="Batería"
          unit="V"
          zones={[
            { from: 0,    to: 0.25, color: Colors.danger  },
            { from: 0.25, to: 0.6,  color: Colors.warning },
            { from: 0.6,  to: 1,    color: Colors.success },
          ]}
        />
        {numericSignals[0] && (
          <CircularGauge
            value={numericSignals[0].converted_value as number}
            min={0}
            max={Math.max(100, (numericSignals[0].converted_value as number) * 1.5)}
            label={numericSignals[0].display_name}
            unit={numericSignals[0].unit}
          />
        )}
        {numericSignals[1] && (
          <CircularGauge
            value={numericSignals[1].converted_value as number}
            min={0}
            max={Math.max(100, (numericSignals[1].converted_value as number) * 1.5)}
            label={numericSignals[1].display_name}
            unit={numericSignals[1].unit}
          />
        )}
      </View>

      {/* ── Comandos DOUT ──────────────────────────────────────────────── */}
      {imei ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Salidas digitales</Text>
          <View style={styles.doutRow}>
            <DoutButton
              label="DOUT 1"
              output="DOUT1"
              active={dout1Active}
              imei={imei}
            />
            <DoutButton
              label="DOUT 2"
              output="DOUT2"
              active={dout2Active}
              imei={imei}
            />
          </View>
        </View>
      ) : null}

      {/* ── Señales CAN en tiempo real ─────────────────────────────────── */}
      {signals.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Señales en tiempo real</Text>
          <View style={styles.signalsGrid}>
            {signals.map((signal) => (
              <SignalCard key={signal.io_key} signal={signal} />
            ))}
          </View>
        </View>
      )}

      {/* ── Datos de posición ──────────────────────────────────────────── */}
      {tel && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Posición</Text>
          <View style={styles.positionCard}>
            {tel.lat !== null && tel.lat !== undefined && (
              <View style={styles.positionRow}>
                <Text style={styles.positionLabel}>Latitud</Text>
                <Text style={styles.positionValue}>{Number(tel.lat).toFixed(6)}</Text>
              </View>
            )}
            {tel.lng !== null && tel.lng !== undefined && (
              <View style={styles.positionRow}>
                <Text style={styles.positionLabel}>Longitud</Text>
                <Text style={styles.positionValue}>{Number(tel.lng).toFixed(6)}</Text>
              </View>
            )}
            {tel.ext_voltage_mv !== null && tel.ext_voltage_mv !== undefined && (
              <View style={[styles.positionRow, styles.positionRowLast]}>
                <Text style={styles.positionLabel}>Tensión ext.</Text>
                <Text style={styles.positionValue}>
                  {(Number(tel.ext_voltage_mv) / 1000).toFixed(2)} V
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    gap: 12,
  },
  loadingText: { color: Colors.textSecondary, fontSize: 15 },

  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  vehicleInfo: { flex: 1 },
  vehicleName: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  vehiclePlate: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontFamily: 'monospace',
  },

  ledRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'space-around',
  },
  led: { alignItems: 'center', gap: 4 },
  ledDot: { width: 12, height: 12, borderRadius: 6 },
  ledLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500' },

  gaugesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
    justifyContent: 'space-around',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  doutRow: {
    flexDirection: 'row',
    gap: 10,
  },
  doutButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    minHeight: 48,
  },
  doutButtonActive: {
    backgroundColor: `${Colors.accent}22`,
    borderColor: Colors.accent,
  },
  doutButtonInactive: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  doutButtonDisabled: { opacity: 0.5 },
  doutDot: { width: 10, height: 10, borderRadius: 5 },
  doutLabel: { color: Colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  doutState: { fontSize: 13, fontWeight: '700' },

  section: { marginBottom: 16 },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  signalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  signalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: '47%',
    flex: 1,
  },
  signalName: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500', marginBottom: 4 },
  signalValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  signalValue: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  signalUnit: { color: Colors.textSecondary, fontSize: 12 },
  boolBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  boolBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  positionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  positionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  positionRowLast: { borderBottomWidth: 0 },
  positionLabel: { color: Colors.textSecondary, fontSize: 13 },
  positionValue: { color: Colors.text, fontSize: 13, fontWeight: '600' },
});
