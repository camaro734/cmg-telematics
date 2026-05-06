import React, { useState, useCallback } from 'react';
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
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { getVehicles } from '../api/fleet';
import { VehicleCard } from '../components/VehicleCard';
import { useFleetStore } from '../store/fleetStore';
import { colors, spacing, radius } from '../theme';
import type { Vehicle, VehicleStatus } from '../types';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainTabParamList } from '../navigation/MainNavigator';
import type { RootStackParamList } from '../navigation/AppNavigator';

const STATUS_COLORS: Record<VehicleStatus, string> = {
  online:  '#22C55E',
  moving:  '#00C8C8',
  idle:    '#F97316',
  offline: '#6B7280',
};

type FleetNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Fleet'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Props = {
  navigation: FleetNavProp;
};

export function FleetScreen({ navigation }: Props) {
  const [view, setView] = useState<'list' | 'map'>('list');
  const setSelectedVehicle = useFleetStore((s) => s.setSelectedVehicle);

  const { data: vehicles = [], isLoading, refetch } = useQuery({
    queryKey: ['vehicles'],
    queryFn: getVehicles,
    refetchInterval: 30_000,
  });

  const handleVehiclePress = useCallback(
    (v: Vehicle) => {
      setSelectedVehicle(v);
      navigation.navigate('VehicleDetail', { vehicleId: v.id });
    },
    [navigation, setSelectedVehicle]
  );

  const vehiclesWithCoords = vehicles.filter((v) => v.lat != null && v.lng != null);
  const onlineCount = vehicles.filter((v) => v.status !== 'offline').length;

  const initialRegion = vehiclesWithCoords.length > 0
    ? {
        latitude: vehiclesWithCoords[0].lat!,
        longitude: vehiclesWithCoords[0].lng!,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      }
    : {
        latitude: 39.4699,
        longitude: -0.3763,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Flota</Text>
          <Text style={styles.subtitle}>
            {onlineCount}/{vehicles.length} en línea
          </Text>
        </View>
        <View style={styles.toggle}>
          <TouchableOpacity
            style={[styles.toggleBtn, view === 'list' && styles.toggleActive]}
            onPress={() => setView('list')}
          >
            <Text style={[styles.toggleText, view === 'list' && styles.toggleTextActive]}>
              Lista
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, view === 'map' && styles.toggleActive]}
            onPress={() => setView('map')}
          >
            <Text style={[styles.toggleText, view === 'map' && styles.toggleTextActive]}>
              Mapa
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {view === 'list' ? (
        <FlatList
          data={vehicles}
          keyExtractor={(v) => v.id}
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
            <VehicleCard vehicle={item} onPress={() => handleVehiclePress(item)} />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {isLoading ? 'Cargando vehículos...' : 'No hay vehículos disponibles'}
            </Text>
          }
        />
      ) : (
        <MapView
          provider={PROVIDER_DEFAULT}
          style={styles.map}
          customMapStyle={darkMapStyle}
          initialRegion={initialRegion}
        >
          {vehiclesWithCoords.map((v) => (
            <Marker
              key={v.id}
              coordinate={{ latitude: v.lat!, longitude: v.lng! }}
              title={v.name}
              description={v.plate}
              pinColor={STATUS_COLORS[v.status]}
              onCalloutPress={() => handleVehiclePress(v)}
            />
          ))}
        </MapView>
      )}
    </SafeAreaView>
  );
}

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9CA3AF' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d3748' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
];

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
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    overflow: 'hidden',
  },
  toggleBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleActive: {
    backgroundColor: colors.accent,
  },
  toggleText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#0f1117',
  },
  list: {
    padding: spacing.md,
  },
  map: {
    flex: 1,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
