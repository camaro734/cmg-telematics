import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { FleetScreen } from '../screens/FleetScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { WorkOrdersScreen } from '../screens/WorkOrdersScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { getAlerts } from '../api/alerts';
import { getWorkOrders } from '../api/workOrders';
import { colors } from '../theme';

export type MainTabParamList = {
  Fleet: undefined;
  Orders: undefined;
  Alerts: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

// Iconos de texto para cada tab — sin dependencias de iconos externos
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Fleet:    '🚚',
    Orders:   '📋',
    Alerts:   '🔔',
    Settings: '⚙️',
  };
  return (
    <Text style={[styles.icon, { opacity: focused ? 1 : 0.45 }]}>
      {icons[name] ?? '•'}
    </Text>
  );
}

export function MainNavigator() {
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => getAlerts({ status: 'firing' }),
    refetchInterval: 60_000,
  });
  const firingCount = alerts.filter((a) => a.status === 'firing').length;

  const { data: orders = [] } = useQuery({
    queryKey: ['work-orders', 'in_progress'],
    queryFn: () => getWorkOrders({ status: 'in_progress', limit: 50 }),
    refetchInterval: 60_000,
  });
  const inProgressCount = orders.length;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="Fleet"
        component={FleetScreen}
        options={{
          tabBarLabel: 'Flota',
          tabBarIcon: ({ focused }) => <TabIcon name="Fleet" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Orders"
        component={WorkOrdersScreen}
        options={{
          tabBarLabel: 'Órdenes',
          tabBarIcon: ({ focused }) => <TabIcon name="Orders" focused={focused} />,
          tabBarBadge: inProgressCount > 0 ? inProgressCount : undefined,
          tabBarBadgeStyle: styles.badge,
        }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{
          tabBarLabel: 'Alertas',
          tabBarIcon: ({ focused }) => <TabIcon name="Alerts" focused={focused} />,
          tabBarBadge: firingCount > 0 ? firingCount : undefined,
          tabBarBadgeStyle: styles.badge,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Ajustes',
          tabBarIcon: ({ focused }) => <TabIcon name="Settings" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.bgSurface,
    borderTopColor: colors.bgBorder,
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 8,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  icon: {
    fontSize: 20,
  },
  badge: {
    backgroundColor: colors.accentCrit,
    fontSize: 10,
  },
});
