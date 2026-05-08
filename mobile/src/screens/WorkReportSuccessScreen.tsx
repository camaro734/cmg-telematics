import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { downloadAndShareReportPdf } from '../api/workOrders';
import { colors, spacing, radius } from '../theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkReportSuccess'>;

export function WorkReportSuccessScreen({ route, navigation }: Props) {
  const { workOrderId, docNumber } = route.params;
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    try {
      setSharing(true);
      await downloadAndShareReportPdf(workOrderId, docNumber);
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? 'No se pudo descargar el PDF';
      Alert.alert('Error', msg);
    } finally {
      setSharing(false);
    }
  };

  const handleBack = () => {
    navigation.popToTop();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.checkCircle}>
          <Text style={styles.check}>✓</Text>
        </View>

        <Text style={styles.title}>Parte cerrado</Text>
        {docNumber && <Text style={styles.docNumber}>{docNumber}</Text>}
        <Text style={styles.subtitle}>
          Comparte el PDF del parte con el cliente directamente desde aquí.
        </Text>

        <TouchableOpacity
          style={[styles.primaryBtn, sharing && styles.primaryBtnDisabled]}
          onPress={() => void handleShare()}
          disabled={sharing}
          activeOpacity={0.85}
        >
          {sharing ? (
            <ActivityIndicator color="#0f1117" />
          ) : (
            <Text style={styles.primaryBtnText}>Compartir parte con el cliente</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={handleBack} activeOpacity={0.8}>
          <Text style={styles.secondaryBtnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgBase },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  checkCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accentOk,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  check: {
    color: '#0f1117',
    fontSize: 56,
    lineHeight: 60,
    fontWeight: '900',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  docNumber: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Courier',
    marginTop: -4,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    minWidth: 280,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    color: '#0f1117',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  secondaryBtnText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});
