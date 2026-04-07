// Pantalla de vehículos — búsqueda y filtros
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  RefreshControl,
  ListRenderItemInfo,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFleet } from '@/hooks/useVehicles';
import { Colors } from '@/constants/colors';
import type { FleetVehicle } from '@/types';

type Filter = 'all' | 'online' | 'alerts';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'online', label: 'En línea' },
  { key: 'alerts', label: 'Con alertas' },
];

function VehicleRow({ vehicle, onPress }: { vehicle: FleetVehicle; onPress: () => void }) {
  const online = vehicle.device?.online ?? false;
  const hasAlerts = vehicle.active_alerts > 0;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <View
        style={[
          styles.statusBar,
          { backgroundColor: hasAlerts ? Colors.danger : online ? Colors.success : Colors.offline },
        ]}
      />
      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>{vehicle.vehicle_name}</Text>
          {hasAlerts && (
            <View style={styles.alertChip}>
              <Text style={styles.alertChipText}>{vehicle.active_alerts} alerta{vehicle.active_alerts > 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.rowPlate}>{vehicle.license_plate}</Text>
          <Text style={[styles.rowStatus, { color: online ? Colors.success : Colors.offline }]}>
            {online ? 'En línea' : 'Sin señal'}
          </Text>
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function VehiclesScreen() {
  const router = useRouter();
  const { data: fleet, isLoading, isRefetching, refetch } = useFleet();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    if (!fleet) return [];

    let result = fleet;

    // Filtro por texto
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (v) =>
          v.vehicle_name.toLowerCase().includes(q) ||
          v.license_plate.toLowerCase().includes(q),
      );
    }

    // Filtro por estado
    if (filter === 'online') {
      result = result.filter((v) => v.device?.online);
    } else if (filter === 'alerts') {
      result = result.filter((v) => v.active_alerts > 0);
    }

    return result;
  }, [fleet, search, filter]);

  const handlePress = useCallback(
    (id: number) => router.push(`/(tabs)/vehicle/${id}`),
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FleetVehicle>) => (
      <VehicleRow vehicle={item} onPress={() => handlePress(item.vehicle_id)} />
    ),
    [handlePress],
  );

  const keyExtractor = useCallback((item: FleetVehicle) => String(item.vehicle_id), []);

  return (
    <View style={styles.container}>
      {/* Búsqueda */}
      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por nombre o matrícula..."
          placeholderTextColor={Colors.muted}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      {/* Filtros */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text
              style={[styles.filterText, filter === f.key && styles.filterTextActive]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.countText}>{filtered.length}</Text>
      </View>

      {/* Lista */}
      <FlatList
        data={filtered}
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
              <Text style={styles.emptyText}>
                {search || filter !== 'all'
                  ? 'Sin resultados para esta búsqueda'
                  : 'No hay vehículos en tu flota'}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchWrapper: { padding: 12, paddingBottom: 8 },
  searchInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
    height: 44,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
    alignItems: 'center',
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  filterText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  countText: { color: Colors.muted, fontSize: 13, marginLeft: 'auto' },
  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 4 },
  row: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    minHeight: 64,
  },
  statusBar: { width: 4, alignSelf: 'stretch' },
  rowContent: { flex: 1, paddingHorizontal: 12, paddingVertical: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  rowName: { color: Colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  rowBottom: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  rowPlate: { color: Colors.textSecondary, fontSize: 13 },
  rowStatus: { fontSize: 12, fontWeight: '500' },
  alertChip: {
    backgroundColor: `${Colors.danger}22`,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: `${Colors.danger}44`,
  },
  alertChipText: { color: Colors.danger, fontSize: 11, fontWeight: '600' },
  chevron: { color: Colors.muted, fontSize: 22, paddingHorizontal: 10 },
  emptyContainer: { padding: 32, alignItems: 'center' },
  emptyText: { color: Colors.muted, fontSize: 15, textAlign: 'center' },
});
