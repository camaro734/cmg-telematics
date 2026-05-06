import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { setDout } from '../api/fleet';

interface Props {
  vehicleId: string;
  channel: number;
  label: string;
  currentState: boolean;
  onToggled?: (newState: boolean) => void;
}

export function DoutButton({ vehicleId, channel, label, currentState, onToggled }: Props) {
  const [loading, setLoading] = useState(false);

  const handlePress = () => {
    const newState = !currentState;
    Alert.alert(
      'Confirmar acción',
      `${newState ? 'Activar' : 'Desactivar'} salida "${label}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          style: newState ? 'default' : 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await setDout(vehicleId, channel, newState);
              onToggled?.(newState);
            } catch {
              Alert.alert('Error', 'No se pudo cambiar el estado de la salida digital.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={[styles.btn, currentState && styles.btnActive]}
      onPress={handlePress}
      disabled={loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.textPrimary} />
      ) : (
        <Text style={[styles.label, currentState && styles.labelActive]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    backgroundColor: colors.bgSurface,
    minWidth: 80,
    alignItems: 'center',
  },
  btnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '22',
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.accent,
  },
});
