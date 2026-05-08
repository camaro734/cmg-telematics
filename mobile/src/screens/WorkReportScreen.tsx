import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import * as ImagePicker from 'expo-image-picker';
import { useKeepAwake } from 'expo-keep-awake';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createWorkReport, uploadReportPhoto, changeWorkOrderStatus, getWorkOrder } from '../api/workOrders';
import { colors, spacing, radius } from '../theme';
import { isValidDni } from '../utils/dni';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkReport'>;

const MAX_PHOTOS = 5;

type SignMode = 'sign' | 'unsigned';
type UnsignedReasonKey = 'absent' | 'refused' | 'minor' | 'other';

const REASON_LABELS: Record<UnsignedReasonKey, string> = {
  absent: 'Cliente ausente',
  refused: 'Rechaza firmar',
  minor: 'Menor de edad / sin capacidad',
  other: 'Otro',
};

export function WorkReportScreen({ route, navigation }: Props) {
  useKeepAwake();
  const { workOrderId } = route.params;
  const qc = useQueryClient();
  const sigRef = useRef<SignatureViewRef>(null);

  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Conformidad del cliente: firma + DNI o motivo de no firma
  const [signMode, setSignMode] = useState<SignMode>('sign');
  const [signeeName, setSigneeName] = useState('');
  const [signeeDni, setSigneeDni] = useState('');
  const [unsignedReason, setUnsignedReason] = useState<UnsignedReasonKey | null>(null);
  const [unsignedReasonText, setUnsignedReasonText] = useState('');

  const isReadyToSubmit = signMode === 'sign'
    ? signeeName.trim().length >= 3 && !!signeeDni.trim() && !!signatureData
    : !!unsignedReason && (unsignedReason !== 'other' || unsignedReasonText.trim().length >= 3);

  const pickImage = async (source: 'camera' | 'library') => {
    const fn = source === 'camera'
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;
    const result = await fn({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets.length > 0) {
      setPhotos((prev) => [...prev, result.assets[0].uri].slice(0, MAX_PHOTOS));
    }
  };

  const handleAddPhoto = () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Límite alcanzado', `Máximo ${MAX_PHOTOS} fotos por informe.`);
      return;
    }
    Alert.alert('Añadir foto', '', [
      { text: 'Cámara', onPress: () => void pickImage('camera') },
      { text: 'Galería', onPress: () => void pickImage('library') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const handleRemovePhoto = (uri: string) => {
    setPhotos((prev) => prev.filter((p) => p !== uri));
  };

  const handleSend = async () => {
    if (!isReadyToSubmit) {
      Alert.alert(
        'Faltan datos',
        signMode === 'sign'
          ? 'Introduce nombre, DNI/NIE y firma del cliente.'
          : 'Selecciona el motivo por el que no se puede firmar.',
      );
      return;
    }
    setSending(true);
    try {
      const reasonStr = signMode === 'unsigned'
        ? (unsignedReason === 'other' ? unsignedReasonText.trim() : REASON_LABELS[unsignedReason!])
        : null;

      await createWorkReport(workOrderId, {
        description: notes.trim() || null,
        signature_data: signMode === 'sign' ? signatureData : null,
        client_signee_name: signMode === 'sign' ? signeeName.trim() : null,
        client_signee_dni: signMode === 'sign' ? signeeDni.trim().toUpperCase() : null,
        unsigned_reason: reasonStr,
      });
      for (const uri of photos) {
        await uploadReportPhoto(workOrderId, uri);
      }
      const updated = await changeWorkOrderStatus(workOrderId, 'done');
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      void qc.invalidateQueries({ queryKey: ['work-order', workOrderId] });

      // Si el endpoint no devuelve doc_number aún, refrescar la orden
      let docNumber = updated.doc_number ?? null;
      if (!docNumber) {
        try {
          const fresh = await getWorkOrder(workOrderId);
          docNumber = fresh.doc_number ?? null;
        } catch {
          // Mejor esfuerzo — si falla, seguimos sin doc_number
        }
      }

      navigation.replace('WorkReportSuccess', { workOrderId, docNumber });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al enviar el informe. Inténtalo de nuevo.';
      Alert.alert('Error', msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Cabecera */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Atrás</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Informe de trabajo</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Notas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>OBSERVACIONES</Text>
          <TextInput
            style={styles.textArea}
            value={notes}
            onChangeText={setNotes}
            placeholder="Describe el trabajo realizado..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Fotos */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            FOTOS ({photos.length}/{MAX_PHOTOS})
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.photoRow}>
              {photos.map((uri) => (
                <View key={uri} style={styles.photoWrap}>
                  <Image source={{ uri }} style={styles.photo} />
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => handleRemovePhoto(uri)}
                  >
                    <Text style={styles.removeBtnText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <TouchableOpacity style={styles.addPhotoBtn} onPress={handleAddPhoto}>
                  <Text style={styles.addPhotoBtnText}>+</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>

        {/* Conformidad del cliente */}
        {signMode === 'sign' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CONFORMIDAD DEL CLIENTE</Text>

            <Text style={styles.fieldLabel}>Nombre del firmante *</Text>
            <TextInput
              style={styles.input}
              value={signeeName}
              onChangeText={setSigneeName}
              placeholder="Juan García"
              placeholderTextColor={colors.textMuted}
              maxLength={200}
            />

            <Text style={styles.fieldLabel}>DNI / NIE *</Text>
            <TextInput
              style={styles.input}
              value={signeeDni}
              onChangeText={(t) => setSigneeDni(t.toUpperCase())}
              placeholder="12345678A"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
            />
            {signeeDni.length > 0 && !isValidDni(signeeDni) && (
              <Text style={styles.warnText}>Formato de DNI/NIE no estándar</Text>
            )}

            <View style={[styles.sigHeader, { marginTop: spacing.md }]}>
              <Text style={styles.fieldLabel}>Firma *</Text>
              {signatureData !== null && (
                <TouchableOpacity onPress={() => {
                  sigRef.current?.clearSignature();
                  setSignatureData(null);
                }}>
                  <Text style={styles.clearText}>Borrar firma</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.sigWrap}>
              <SignatureCanvas
                ref={sigRef}
                onOK={(sig) => setSignatureData(sig)}
                onEmpty={() => setSignatureData(null)}
                descriptionText=""
                clearText="Borrar"
                confirmText="Guardar"
                webStyle={sigWebStyle}
                autoClear={false}
                imageType="image/png"
              />
            </View>
            {signatureData === null && (
              <Text style={styles.sigHint}>Firma requerida</Text>
            )}

            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => {
                setSignatureData(null);
                setSigneeName('');
                setSigneeDni('');
                sigRef.current?.clearSignature();
                setSignMode('unsigned');
              }}
            >
              <Text style={styles.linkBtnText}>⊘  No se puede firmar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SIN FIRMA DEL CLIENTE</Text>
            <Text style={styles.fieldLabel}>Motivo *</Text>
            {(Object.keys(REASON_LABELS) as UnsignedReasonKey[]).map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.radio, unsignedReason === k && styles.radioOn]}
                onPress={() => setUnsignedReason(k)}
              >
                <Text style={[styles.radioText, unsignedReason === k && styles.radioTextOn]}>
                  {REASON_LABELS[k]}
                </Text>
              </TouchableOpacity>
            ))}
            {unsignedReason === 'other' && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: spacing.sm }]}>Especifica el motivo *</Text>
                <TextInput
                  style={styles.input}
                  value={unsignedReasonText}
                  onChangeText={setUnsignedReasonText}
                  placeholder="Motivo personalizado"
                  placeholderTextColor={colors.textMuted}
                  maxLength={200}
                />
              </>
            )}
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => {
                setUnsignedReason(null);
                setUnsignedReasonText('');
                setSignMode('sign');
              }}
            >
              <Text style={styles.linkBtnText}>← Volver a captura de firma</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Botón enviar */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!isReadyToSubmit || sending) && styles.sendBtnDisabled,
          ]}
          onPress={() => void handleSend()}
          disabled={!isReadyToSubmit || sending}
          activeOpacity={0.85}
        >
          {sending ? (
            <ActivityIndicator color="#0f1117" />
          ) : (
            <Text style={styles.sendBtnText}>Cerrar parte</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const sigWebStyle = `
  .m-signature-pad { box-shadow: none; border: none; }
  .m-signature-pad--body { border: none; background: #1a1a2e; }
  .m-signature-pad--footer { display: none; }
  body { background: #1a1a2e; margin: 0; }
  canvas { background: #1a1a2e; }
`;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgBorder,
  },
  backBtn: { padding: spacing.xs, minWidth: 60 },
  backText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  scroll: { flex: 1 },
  section: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgBorder,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  textArea: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    borderRadius: radius.sm,
    color: colors.textPrimary,
    padding: spacing.md,
    fontSize: 14,
    minHeight: 100,
  },
  photoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  photoWrap: {
    width: 90,
    height: 90,
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: 90,
    height: 90,
  },
  removeBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    backgroundColor: colors.accentCrit,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 18 },
  addPhotoBtn: {
    width: 90,
    height: 90,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSurface,
  },
  addPhotoBtnText: { color: colors.textMuted, fontSize: 28, fontWeight: '300' },
  sigHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  clearText: { color: colors.accentCrit, fontSize: 13, fontWeight: '600' },
  sigWrap: {
    height: 200,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.bgSurface,
  },
  sigHint: {
    color: colors.accentWarn,
    fontSize: 12,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    borderRadius: radius.sm,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
  },
  warnText: {
    color: colors.accentWarn,
    fontSize: 11,
    marginTop: 4,
  },
  linkBtn: {
    marginTop: spacing.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkBtnText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  radio: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.bgBorder,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.bgSurface,
  },
  radioOn: {
    borderColor: colors.accent,
    backgroundColor: colors.bgSurface,
  },
  radioText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  radioTextOn: {
    color: colors.accent,
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    backgroundColor: colors.bgBase,
    borderTopWidth: 1,
    borderTopColor: colors.bgBorder,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 16,
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#0f1117', fontWeight: '800', fontSize: 15 },
});
