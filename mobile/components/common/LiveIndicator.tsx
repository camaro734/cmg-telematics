// Indicador animado de estado de conexión en tiempo real
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import type { ConnectionStatus } from '@/types';

interface Props {
  status: ConnectionStatus;
}

const STATUS_CONFIG: Record<ConnectionStatus, { color: string; label: string }> = {
  connecting: { color: Colors.warning, label: 'Conectando...' },
  live:       { color: Colors.success, label: 'En directo' },
  polling:    { color: Colors.warning, label: 'Actualizando' },
  offline:    { color: Colors.offline, label: 'Sin conexión' },
};

export function LiveIndicator({ status }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;
  const config = STATUS_CONFIG[status];

  useEffect(() => {
    if (status !== 'live') {
      pulse.setValue(1);
      return;
    }
    // Pulso animado solo cuando está en directo
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.6, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [status, pulse]);

  return (
    <View style={styles.container}>
      <View style={styles.dotWrapper}>
        {status === 'live' && (
          <Animated.View
            style={[
              styles.dotPulse,
              { backgroundColor: config.color, transform: [{ scale: pulse }] },
            ]}
          />
        )}
        <View style={[styles.dot, { backgroundColor: config.color }]} />
      </View>
      <Text style={styles.label}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dotWrapper: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotPulse: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.4,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
});
