// ============================================================
// GEODAILY — Autorización Uso de Imagen, Menores de Edad (PA. 2 FO. 11)
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
import { generarPDFAutorizacionImagenMenor } from '../../services/pdfLocal.service';
import SignaturePad from '../../components/SignaturePad';
import { guardarDatosOtroFormato, cargarDatosOtroFormato } from '../../store/OtrosFormatosDraftStore';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: { params?: { beneficiario?: DatosBeneficiario } };
};

type Calidad = 'padre' | 'madre' | 'representante';

const CALIDAD_OPCIONES: { value: Calidad; label: string }[] = [
  { value: 'padre', label: 'Padre' },
  { value: 'madre', label: 'Madre' },
  { value: 'representante', label: 'Representante legal' },
];

const AutorizacionImagenMenorScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const beneficiario = route?.params?.beneficiario;

  const [nombreRepresentante, setNombreRepresentante] = useState('');
  const [cedulaRepresentante, setCedulaRepresentante] = useState('');
  const [expedidaEn, setExpedidaEn] = useState(beneficiario?.municipio || '');
  const [documentoMenor, setDocumentoMenor] = useState('');
  const [calidad, setCalidad] = useState<Calidad | null>(null);
  const [telefono, setTelefono] = useState(beneficiario?.telefono || '');

  const [autorizaFotos, setAutorizaFotos] = useState(true);
  const [autorizaAudios, setAutorizaAudios] = useState(true);
  const [autorizaVideos, setAutorizaVideos] = useState(true);
  const [autorizaOtros, setAutorizaOtros] = useState(false);

  const [firma, setFirma] = useState<string | null>(null);
  const [padActivo, setPadActivo] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const cargadoRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const g = await cargarDatosOtroFormato<{
          nombreRepresentante: string; cedulaRepresentante: string; expedidaEn: string;
          documentoMenor: string; calidad: Calidad | null; telefono: string;
          autorizaFotos: boolean; autorizaAudios: boolean; autorizaVideos: boolean; autorizaOtros: boolean;
          firma: string | null;
        }>('autorizacion_imagen_menor', beneficiario?.cedula);
        if (g) {
          setNombreRepresentante(g.nombreRepresentante ?? '');
          setCedulaRepresentante(g.cedulaRepresentante ?? '');
          setExpedidaEn(g.expedidaEn ?? expedidaEn);
          setDocumentoMenor(g.documentoMenor ?? '');
          setCalidad(g.calidad ?? null);
          setTelefono(g.telefono ?? telefono);
          setAutorizaFotos(g.autorizaFotos ?? true);
          setAutorizaAudios(g.autorizaAudios ?? true);
          setAutorizaVideos(g.autorizaVideos ?? true);
          setAutorizaOtros(g.autorizaOtros ?? false);
          setFirma(g.firma ?? null);
        }
      } catch (e) {
        console.warn('[AutorizacionImagenMenor] Error al cargar borrador:', e);
      } finally {
        cargadoRef.current = true;
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiario?.cedula]);

  useEffect(() => {
    if (!cargadoRef.current) return;
    guardarDatosOtroFormato('autorizacion_imagen_menor', beneficiario?.cedula, {
      nombreRepresentante, cedulaRepresentante, expedidaEn, documentoMenor, calidad, telefono,
      autorizaFotos, autorizaAudios, autorizaVideos, autorizaOtros, firma,
    });
  }, [beneficiario?.cedula, nombreRepresentante, cedulaRepresentante, expedidaEn, documentoMenor, calidad, telefono, autorizaFotos, autorizaAudios, autorizaVideos, autorizaOtros, firma]);

  const handleGenerar = useCallback(async () => {
    if (!nombreRepresentante.trim() || !cedulaRepresentante.trim()) {
      Alert.alert('Faltan datos', 'El nombre y la cédula del padre/madre/representante son obligatorios.');
      return;
    }
    if (!documentoMenor.trim()) {
      Alert.alert('Falta un dato', 'El documento de identidad del menor es obligatorio.');
      return;
    }
    if (!calidad) {
      Alert.alert('Falta un dato', 'Selecciona la calidad: Padre, Madre o Representante legal.');
      return;
    }
    if (!firma) {
      Alert.alert('Falta la firma', 'El padre, madre o representante legal debe firmar la autorización.');
      return;
    }
    setGenerando(true);
    try {
      const uri = await generarPDFAutorizacionImagenMenor({
        nombreRepresentante: nombreRepresentante.trim(),
        cedulaRepresentante: cedulaRepresentante.trim(),
        expedidaEn: expedidaEn.trim(),
        documentoMenor: documentoMenor.trim(),
        calidad,
        telefono: telefono.trim(),
        autorizaFotos,
        autorizaAudios,
        autorizaVideos,
        autorizaOtros,
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
      console.warn('[AutorizacionImagenMenor] Error al generar PDF:', e);
      Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setGenerando(false);
    }
  }, [nombreRepresentante, cedulaRepresentante, expedidaEn, documentoMenor, calidad, telefono, autorizaFotos, autorizaAudios, autorizaVideos, autorizaOtros, firma]);

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
          <Text style={styles.padTitle}>✍️ Firma del Padre/Madre/Representante</Text>
        </View>
        <SignaturePad
          description="Firma del padre, madre o representante legal"
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
        <Text style={styles.titulo}>Autorización Uso de Imagen — Menor de Edad</Text>
        <Text style={styles.subtitulo}>PA. 2 FO. 11 — La firma el padre, madre o representante legal del menor</Text>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Nombre del padre/madre/representante</Text>
          <TextInput style={styles.input} value={nombreRepresentante} onChangeText={setNombreRepresentante} placeholder="Nombre completo" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Cédula de ciudadanía</Text>
          <TextInput style={styles.input} value={cedulaRepresentante} onChangeText={setCedulaRepresentante} keyboardType="numeric" placeholder="Cédula" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Expedida en (ciudad)</Text>
          <TextInput style={styles.input} value={expedidaEn} onChangeText={setExpedidaEn} placeholder="Ciudad de expedición" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Documento de identidad del menor</Text>
          <TextInput style={styles.input} value={documentoMenor} onChangeText={setDocumentoMenor} keyboardType="numeric" placeholder="Registro civil / tarjeta de identidad" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Teléfono</Text>
          <TextInput style={styles.input} value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" placeholder="Teléfono" placeholderTextColor={COLORS.textLight} />
        </View>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Calidad</Text>
          <View style={styles.checkRow}>
            {CALIDAD_OPCIONES.map((op) => (
              <TouchableOpacity key={op.value} style={[styles.checkChip, calidad === op.value && styles.checkChipActivo]} onPress={() => setCalidad(op.value)}>
                <Text style={[styles.checkChipText, calidad === op.value && styles.checkChipTextActivo]}>{op.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Autoriza recolectar y divulgar (del menor)</Text>
        <View style={styles.checkRow}>
          {([
            ['Fotos', autorizaFotos, setAutorizaFotos],
            ['Audios', autorizaAudios, setAutorizaAudios],
            ['Videos', autorizaVideos, setAutorizaVideos],
            ['Otros datos', autorizaOtros, setAutorizaOtros],
          ] as const).map(([label, value, setter]) => (
            <TouchableOpacity key={label} style={[styles.checkChip, value && styles.checkChipActivo]} onPress={() => setter(!value)}>
              <Text style={[styles.checkChipText, value && styles.checkChipTextActivo]}>{value ? '✓ ' : ''}{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.disclaimer}>
          Al firmar, se declara autorizar de manera libre, voluntaria, previa, expresa e informada el uso institucional de la imagen, voz y datos personales del menor, garantizando el respeto por su dignidad, intimidad y derechos fundamentales, conforme a la Ley 1581 de 2012 y el Decreto 1074 de 2015.
        </Text>

        <Text style={styles.sectionLabel}>Firma</Text>
        <TouchableOpacity style={[styles.firmaBtn, firma && styles.firmaBtnOk]} onPress={() => setPadActivo(true)}>
          <Text style={styles.firmaBtnText}>{firma ? '✓ Firma registrada' : '✍️ Firmar — Padre/Madre/Representante'}</Text>
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
  disclaimer: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: SPACING.md, lineHeight: 16, fontStyle: 'italic' },
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

export default AutorizacionImagenMenorScreen;
