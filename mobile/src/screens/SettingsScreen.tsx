import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { logout } from '../api/auth';
import { colors, spacing, radius } from '../theme';

export function SettingsScreen() {
  const { user, clearAuth } = useAuthStore();

  const handleLogout = () => {
    Alert.alert(
      'Cerrar sesión',
      '¿Seguro que quieres salir de CMG Track?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: async () => {
            await logout();
            clearAuth();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.title}>Ajustes</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CUENTA</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Email</Text>
            <Text style={styles.cardValue}>{user?.email ?? '--'}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Rol</Text>
            <Text style={styles.cardValue}>{user?.role ?? '--'}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Empresa</Text>
            <Text style={styles.cardValue}>{user?.brand_name ?? '--'}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Tenant ID</Text>
            <Text style={[styles.cardValue, styles.mono]}>
              {user?.tenant_id ? user.tenant_id.slice(0, 8) + '...' : '--'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>APLICACION</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Version</Text>
            <Text style={styles.cardValue}>1.0.0</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>API</Text>
            <Text style={[styles.cardValue, styles.mono]}>cmgtrack.com</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Plataforma</Text>
            <Text style={styles.cardValue}>React Native + Expo</Text>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Text style={styles.logoutText}>Cerrar sesion</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
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
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  cardLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  cardValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  logoutBtn: {
    backgroundColor: colors.accentCrit + '22',
    borderWidth: 1,
    borderColor: colors.accentCrit,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  logoutText: {
    color: colors.accentCrit,
    fontWeight: '700',
    fontSize: 15,
  },
});
