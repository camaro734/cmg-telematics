// Bottom tabs layout — 4 tabs principales
import { Tabs } from 'expo-router';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { useAlerts } from '@/hooks/useAlerts';

// Iconos SVG inline simples (sin dependencia de librería de iconos)
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const color = focused ? Colors.accent : Colors.muted;
  const icons: Record<string, string> = {
    fleet:    focused ? '⬢' : '⬡',
    vehicles: focused ? '▣' : '▢',
    alerts:   focused ? '◉' : '○',
    menu:     focused ? '⊞' : '⊟',
  };
  return (
    <Text style={[styles.icon, { color }]}>
      {icons[name] ?? '●'}
    </Text>
  );
}

function AlertsTabIcon({ focused }: { focused: boolean }) {
  const { data: alerts } = useAlerts();
  const count = alerts?.filter((a) => !a.acknowledged_at).length ?? 0;

  return (
    <View style={styles.tabIconWrapper}>
      <TabIcon name="alerts" focused={focused} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : String(count)}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.text,
        headerTitleStyle: { fontWeight: '600', fontSize: 17 },
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Flota',
          headerTitle: () => (
            <Image
              source={require('@/assets/logo-dark.png')}
              style={{ width: 120, height: 50, resizeMode: 'contain' }}
            />
          ),
          tabBarLabel: 'Flota',
          tabBarIcon: ({ focused }) => <TabIcon name="fleet" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: 'Vehículos',
          tabBarLabel: 'Vehículos',
          tabBarIcon: ({ focused }) => <TabIcon name="vehicles" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alertas',
          tabBarLabel: 'Alertas',
          tabBarIcon: ({ focused }) => <AlertsTabIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="vehicle/[id]"
        options={{
          href: null, // ocultar de los tabs — se navega programáticamente
          headerShown: true,
          title: 'Vehículo',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 22,
  },
  tabIconWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: Colors.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
});
