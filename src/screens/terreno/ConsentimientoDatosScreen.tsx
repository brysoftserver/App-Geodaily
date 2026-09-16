// ============================================================
// GEODAILY — Consentimiento Informado y Tratamiento de Datos (PA. 2 FO. 32)
// ============================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { DatosBeneficiario } from '../../types';
import { generarPDFConsentimientoDatos, AC_FINALIDADES_TRATAMIENTO } from '../../services/pdfLocal.service';
import SignaturePad from '../../components/SignaturePad';
import { guardarDatosOtroFormato, cargarDatosOtroFormato } from '../../store/OtrosFormatosDraftStore';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: { params?: { beneficiario?: DatosBeneficiario } };
};

const ConsentimientoDatosScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const beneficiario = route?.params?.beneficiario;

  const [nombre, setNombre] = useState(beneficiario?.nombre || '');
  const [cedula, setCedula] = useState(beneficiario?.cedula || '');
  const [expedidaEn, setExpedidaEn] = useState(beneficiario?.municipio || '');

  const [autorizaIdentificacion, setAutorizaIdentificacion] = useState(true);
  const [autorizaPredio, setAutorizaPredio] = useState(true);
  const [autorizaTecnica, setAutorizaTecnica] = useState(true);
  const [autorizaAsistencia, setAutorizaAsistencia] = useState(true);

  const [finalidadesVistas, setFinalidadesVistas] = useState(false);

  const [firma, setFirma] = useState<string | null>(null);
  const [padActivo, setPadActivo] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const cargadoRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const g = await cargarDatosOtroFormato<{
          nombre: string; cedula: string; expedidaEn: string;
          autorizaIdentificacion: boolean; autorizaPredio: boolean; autorizaTecnica: boolean; autorizaAsistencia: boolean;
          finalidadesVistas: boolean; firma: string | null;
        }>('consentimiento_datos', beneficiario?.cedula);
        if (g) {
          setNombre(g.nombre ?? nombre);
          setCedula(g.cedula ?? cedula);
          setExpedidaEn(g.expedidaEn ?? expedidaEn);
          setAutorizaIdentificacion(g.autorizaIdentificacion ?? true);
          setAutorizaPredio(g.autorizaPredio ?? true);
          setAutorizaTecnica(g.autorizaTecnica ?? true);
          setAutorizaAsistencia(g.autorizaAsistencia ?? true);
          setFinalidadesVistas(g.finalidadesVistas ?? false);
          setFirma(g.firma ?? null);
        }
      } catch (e) {
        console.warn('[ConsentimientoDatos] Error al cargar borrador:', e);
      } finally {
        cargadoRef.current = true;
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiario?.cedula]);

  useEffect(() => {
    if (!cargadoRef.current) return;
    guardarDatosOtroFormato('consentimiento_datos', beneficiario?.cedula, {
      nombre, cedula, expedidaEn, autorizaIdentificacion, autorizaPredio, autorizaTecnica, autorizaAsistencia,
      finalidadesVistas, firma,
    });
  }, [beneficiario?.cedula, nombre, cedula, expedidaEn, autorizaIdentificacion, autorizaPredio, autorizaTecnica, autorizaAsistencia, finalidadesVistas, firma]);

  const handleGenerar = useCallback(async () => {
    if (!nombre.trim() || !cedula.trim()) {
      Alert.alert('Faltan datos', 'El nombre y la cédula son obligatorios.');
      return;
    }
    if (!finalidadesVistas) {
      Alert.alert('Revisa el contenido', 'Toca "Ver las 9 finalidades del tratamiento" antes de continuar.');
      return;
    }
    if (!firma) {
      Alert.alert('Falta la firma', 'El beneficiario debe firmar el consentimiento.');
      return;
    }
    setGenerando(true);
    try {
      const uri = await generarPDFConsentimientoDatos({
        nombre: nombre.trim(),
        cedula: cedula.trim(),
        expedidaEn: expedidaEn.trim(),
        autorizaIdentificacion,
        autorizaPredio,
        autorizaTecnica,
        autorizaAsistencia,
        fecha: new Date().toISOString(),
        firma,
      });
      if (!uri) {
        Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('PDF generado', `Guardado en: ${uri}`);
      }
    } catch (e) {
      console.warn('[ConsentimientoDatos] Error al generar PDF:', e);
      Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setGenerando(false);
    }
  }, [nombre, cedula, expedidaEn, autorizaIdentificacion, autorizaPredio, autorizaTecnica, autorizaAsistencia, finalidadesVistas, firma]);

  if (cargando) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (padActivo) {
    return (
      <View style={styles.container}>
        <View style={[styles.padHeader, { paddingTop: insets.top + SPACING.sm }]}>
          <Text style={styles.padTitle}>✍️ Firma del Beneficiario</Text>
        </View>
        <SignaturePad
          description="Firma del beneficiario"
          onOK={(signature) => {
            setFirma(signature);
            setPadActivo(false);
          }}
        />
        <TouchableOpacity style={styles.padCancelar} onPress={() => setPadActivo(false)}>
          <Text style={styles.padCancelarText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.titulo}>Consentimiento Informado y Tratamiento de Datos</Text>
        <Text style={styles.subtitulo}>PA. 2 FO. 32 — Participación en el proyecto y autorización de datos personales</Text>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Nombre del beneficiario(a)</Text>
          <TextInput style={styles.input} value={nombre} onChangeText={setNombre} placeholder="Nombre completo" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Cédula de ciudadanía</Text>
          <TextInput style={styles.input} value={cedula} onChangeText={setCedula} keyboardType="numeric" placeholder="Cédula" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Expedida en (ciudad)</Text>
          <TextInput style={styles.input} value={expedidaEn} onChangeText={setExpedidaEn} placeholder="Ciudad de expedición" placeholderTextColor={COLORS.textLight} />
        </View>

        <Text style={styles.sectionLabel}>Resumen</Text>
        <Text style={styles.resumen}>
          Al firmar, declaras haber recibido información clara sobre el proyecto y aceptas participar voluntariamente. Además autorizas el tratamiento de tus datos personales para la ejecución, seguimiento y control del proyecto.
        </Text>

        <Text style={styles.sectionLabel}>Tipos de información que autoriza tratar</Text>
        <View style={styles.checkRow}>
          {([
            ['Identificación y contacto', autorizaIdentificacion, setAutorizaIdentificacion],
            ['Información del predio', autorizaPredio, setAutorizaPredio],
            ['Información técnica/productiva', autorizaTecnica, setAutorizaTecnica],
            ['Asistencia y participación', autorizaAsistencia, setAutorizaAsistencia],
          ] as const).map(([label, value, setter]) => (
            <TouchableOpacity key={label} style={[styles.checkChip, value && styles.checkChipActivo]} onPress={() => setter(!value)}>
              <Text style={[styles.checkChipText, value && styles.checkChipTextActivo]}>{value ? '✓ ' : ''}{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.finalidadesCard, finalidadesVistas && styles.finalidadesCardVista]}
          onPress={() => setFinalidadesVistas((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.finalidadesTitulo}>
            {finalidadesVistas ? '✓ ' : ''}Ver las 9 finalidades del tratamiento {finalidadesVistas ? '︿' : '﹀'}
          </Text>
          {finalidadesVistas && (
            <View style={styles.finalidadesLista}>
              {AC_FINALIDADES_TRATAMIENTO.map((f, i) => (
                <Text key={i} style={styles.finalidadItem}>{i + 1}. {f}</Text>
              ))}
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Firma</Text>
        <TouchableOpacity style={[styles.firmaBtn, firma && styles.firmaBtnOk]} onPress={() => setPadActivo(true)}>
          <Text style={styles.firmaBtnText}>{firma ? '✓ Firma registrada' : '✍️ Firmar — Beneficiario'}</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <TouchableOpacity style={[styles.generarBtn, generando && styles.generarBtnDisabled]} onPress={handleGenerar} disabled={generando} activeOpacity={0.8}>
          {generando ? <ActivityIndicator color="#fff" /> : <Text style={styles.generarBtnText}>📄 Generar PDF</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  titulo: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  subtitulo: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 16 },
  sectionLabel: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginTop: SPACING.md, marginBottom: SPACING.sm },
  resumen: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, lineHeight: 17 },
  campoWrap: { marginBottom: SPACING.sm },
  campoLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm, paddingVertical: 8, fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary, backgroundColor: COLORS.background,
  },
  checkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  checkChip: {
    paddingVertical: 8, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  checkChipActivo: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkChipText: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, fontWeight: FONTS.weights.medium },
  checkChipTextActivo: { color: '#fff' },
  finalidadesCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.md,
    marginTop: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.border, ...SHADOWS.sm,
  },
  finalidadesCardVista: { borderLeftColor: COLORS.success },
  finalidadesTitulo: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  finalidadesLista: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider },
  finalidadItem: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary, marginBottom: 6, lineHeight: 16, textAlign: 'justify' },
  firmaBtn: {
    borderWidth: 1.5, borderColor: COLORS.info, borderStyle: 'dashed', borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md, alignItems: 'center', backgroundColor: COLORS.info + '10',
  },
  firmaBtnOk: { borderStyle: 'solid', borderColor: COLORS.success, backgroundColor: COLORS.success + '15' },
  firmaBtnText: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  footer: { padding: SPACING.md, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  generarBtn: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.md, alignItems: 'center', justifyContent: 'center' },
  generarBtnDisabled: { opacity: 0.6 },
  generarBtnText: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
  padHeader: { padding: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  padTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  padCancelar: { padding: SPACING.md, alignItems: 'center' },
  padCancelarText: { color: COLORS.textSecondary, fontSize: FONTS.sizes.sm },
});

export default ConsentimientoDatosScreen;
