import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { LoginScreen } from '../screens/LoginScreen';
import { VehicleDetailScreen } from '../screens/VehicleDetailScreen';
import { WorkOrderDetailScreen } from '../screens/WorkOrderDetailScreen';
import { WorkReportScreen } from '../screens/WorkReportScreen';
import { WorkReportSuccessScreen } from '../screens/WorkReportSuccessScreen';
import { MainNavigator } from './MainNavigator';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  VehicleDetail: { vehicleId: string };
  WorkOrderDetail: { workOrderId: string };
  WorkReport: { workOrderId: string };
  WorkReportSuccess: { workOrderId: string; docNumber: string | null };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();

  // Verificar si existe un token guardado al arrancar
  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // Pantalla de carga mientras se verifica autenticación
  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.bgBase,
        }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Main" component={MainNavigator} />
          <Stack.Screen
            name="VehicleDetail"
            component={VehicleDetailScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="WorkOrderDetail"
            component={WorkOrderDetailScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="WorkReport"
            component={WorkReportScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="WorkReportSuccess"
            component={WorkReportSuccessScreen}
            options={{ animation: 'slide_from_right', gestureEnabled: false }}
          />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}
