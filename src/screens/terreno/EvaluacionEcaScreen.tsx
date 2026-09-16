// ============================================================
// GEODAILY — Evaluación de Escuela de Campo para Agricultores, ECA 1 (PA. 2 FO. 33)
// ============================================================
// Encuesta sin firma — se aplica antes y después de cada jornada ECA.
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
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { DatosBeneficiario } from '../../types';
import {
  generarPDFEvaluacionEca,
  ECA_PREGUNTAS_TECNICAS,
  ECA_PREGUNTAS_JORNADA,
  ECA_TEMAS_UTILES,
  EcaOpcionABC,
  EcaLikert,
} from '../../services/pdfLocal.service';
import { guardarDatosOtroFormato, cargarDatosOtroFormato } from '../../store/OtrosFormatosDraftStore';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: { params?: { beneficiario?: DatosBeneficiario } };
};

const LIKERT_OPCIONES: { value: EcaLikert; label: string }[] = [
  { value: 'muy_buena', label: 'Muy buena' },
  { value: 'buena', label: 'Buena' },
  { value: 'regular', label: 'Regular' },
  { value: 'mala', label: 'Mala' },
];

const EvaluacionEcaScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const beneficiario = route?.params?.beneficiario;

  const [nombre, setNombre] = useState(beneficiario?.nombre || '');
  const [identificacion, setIdentificacion] = useState(beneficiario?.cedula || '');
  const [vereda, setVereda] = useState(beneficiario?.vereda || '');
  const [predio, setPredio] = useState(beneficiario?.finca || '');

  const [respuestasTecnicas, setRespuestasTecnicas] = useState<Record<string, EcaOpcionABC | null>>({});
  const [respuestasJornada, setRespuestasJornada] = useState<Record<string, EcaLikert | null>>({});
  const [temaMasUtil, setTemaMasUtil] = useState<string>('');
  const [temaMasUtilOtro, setTemaMasUtilOtro] = useState('');
  const [puedeAplicar, setPuedeAplicar] = useState<'si' | 'parcial' | 'no' | null>(null);
  const [temaReforzar, setTemaReforzar] = useState('');
  const [volveriaParticipar, setVolveriaParticipar] = useState<'si' | 'no' | 'tal_vez' | null>(null);
  const [temaProximaEca, setTemaProximaEca] = useState('');
  const [sugerencias, setSugerencias] = useState('');

  const [generando, setGenerando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const cargadoRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const g = await cargarDatosOtroFormato<{
          nombre: string; identificacion: string; vereda: string; predio: string;
          respuestasTecnicas: Record<string, EcaOpcionABC | null>;
          respuestasJornada: Record<string, EcaLikert | null>;
          temaMasUtil: string; temaMasUtilOtro: string;
          puedeAplicar: 'si' | 'parcial' | 'no' | null;
          temaReforzar: string;
          volveriaParticipar: 'si' | 'no' | 'tal_vez' | null;
          temaProximaEca: string; sugerencias: string;
        }>('evaluacion_eca', beneficiario?.cedula);
        if (g) {
          setNombre(g.nombre ?? nombre);
          setIdentificacion(g.identificacion ?? identificacion);
          setVereda(g.vereda ?? vereda);
          setPredio(g.predio ?? predio);
          setRespuestasTecnicas(g.respuestasTecnicas ?? {});
          setRespuestasJornada(g.respuestasJornada ?? {});
          setTemaMasUtil(g.temaMasUtil ?? '');
          setTemaMasUtilOtro(g.temaMasUtilOtro ?? '');
          setPuedeAplicar(g.puedeAplicar ?? null);
          setTemaReforzar(g.temaReforzar ?? '');
          setVolveriaParticipar(g.volveriaParticipar ?? null);
          setTemaProximaEca(g.temaProximaEca ?? '');
          setSugerencias(g.sugerencias ?? '');
        }
      } catch (e) {
        console.warn('[EvaluacionEca] Error al cargar borrador:', e);
      } finally {
        cargadoRef.current = true;
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiario?.cedula]);

  useEffect(() => {
    if (!cargadoRef.current) return;
    guardarDatosOtroFormato('evaluacion_eca', beneficiario?.cedula, {
      nombre, identificacion, vereda, predio, respuestasTecnicas, respuestasJornada,
      temaMasUtil, temaMasUtilOtro, puedeAplicar, temaReforzar, volveriaParticipar, temaProximaEca, sugerencias,
    });
  }, [beneficiario?.cedula, nombre, identificacion, vereda, predio, respuestasTecnicas, respuestasJornada, temaMasUtil, temaMasUtilOtro, puedeAplicar, temaReforzar, volveriaParticipar, temaProximaEca, sugerencias]);

  const handleGenerar = useCallback(async () => {
    if (!nombre.trim() || !identificacion.trim()) {
      Alert.alert('Faltan datos', 'El nombre y la identificación del beneficiario son obligatorios.');
      return;
    }
    setGenerando(true);
    try {
      const uri = await generarPDFEvaluacionEca({
        nombre: nombre.trim(),
        identificacion: identificacion.trim(),
        vereda: vereda.trim(),
        predio: predio.trim(),
        respuestasTecnicas,
        respuestasJornada,
        temaMasUtil,
        temaMasUtilOtro: temaMasUtilOtro.trim(),
        puedeAplicar,
        temaReforzar: temaReforzar.trim(),
        volveriaParticipar,
        temaProximaEca: temaProximaEca.trim(),
        sugerencias: sugerencias.trim(),
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
      console.warn('[EvaluacionEca] Error al generar PDF:', e);
      Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setGenerando(false);
    }
  }, [nombre, identificacion, vereda, predio, respuestasTecnicas, respuestasJornada, temaMasUtil, temaMasUtilOtro, puedeAplicar, temaReforzar, volveriaParticipar, temaProximaEca, sugerencias]);

  if (cargando) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.titulo}>Evaluación ECA 1</Text>
        <Text style={styles.subtitulo}>PA. 2 FO. 33 — Escuela de Campo para Agricultores</Text>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Nombre del beneficiario</Text>
          <TextInput style={styles.input} value={nombre} onChangeText={setNombre} placeholder="Nombre completo" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Identificación</Text>
          <TextInput style={styles.input} value={identificacion} onChangeText={setIdentificacion} keyboardType="numeric" placeholder="Cédula" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Vereda</Text>
          <TextInput style={styles.input} value={vereda} onChangeText={setVereda} placeholder="Vereda" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Predio</Text>
          <TextInput style={styles.input} value={predio} onChangeText={setPredio} placeholder="Nombre de la finca" placeholderTextColor={COLORS.textLight} />
        </View>

        <Text style={styles.sectionLabel}>1. Evaluación de Conocimientos Técnicos</Text>
        {ECA_PREGUNTAS_TECNICAS.map((p) => (
          <View key={p.key} style={styles.preguntaCard}>
            <Text style={styles.preguntaTitulo}>{p.titulo}</Text>
            <Text style={styles.preguntaTexto}>{p.pregunta}</Text>
            {(['A', 'B', 'C'] as EcaOpcionABC[]).map((letra, i) => (
              <TouchableOpacity
                key={letra}
                style={styles.opcionRow}
                onPress={() => setRespuestasTecnicas((prev) => ({ ...prev, [p.key]: letra }))}
              >
                <View style={[styles.radio, respuestasTecnicas[p.key] === letra && styles.radioActivo]}>
                  {respuestasTecnicas[p.key] === letra && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.opcionTexto}>{letra}. {p.opciones[i]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}

        <Text style={styles.sectionLabel}>2. Evaluación de la Jornada</Text>
        {ECA_PREGUNTAS_JORNADA.map((p) => (
          <View key={p.key} style={styles.preguntaCard}>
            <Text style={styles.preguntaTexto}>{p.texto}</Text>
            <View style={styles.likertRow}>
              {LIKERT_OPCIONES.map((op) => (
                <TouchableOpacity
                  key={op.value}
                  style={[styles.likertChip, respuestasJornada[p.key] === op.value && styles.likertChipActivo]}
                  onPress={() => setRespuestasJornada((prev) => ({ ...prev, [p.key]: op.value }))}
                >
                  <Text style={[styles.likertChipText, respuestasJornada[p.key] === op.value && styles.likertChipTextActivo]}>{op.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.sectionLabel}>3. Aprendizaje y Aplicación</Text>
        <Text style={styles.preguntaTexto}>¿Qué tema considera que fue más útil para su finca?</Text>
        {ECA_TEMAS_UTILES.map((t) => (
          <TouchableOpacity key={t} style={styles.opcionRow} onPress={() => setTemaMasUtil(t)}>
            <View style={[styles.radio, temaMasUtil === t && styles.radioActivo]}>
              {temaMasUtil === t && <View style={styles.radioDot} />}
            </View>
            <Text style={styles.opcionTexto}>{t}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.opcionRow} onPress={() => setTemaMasUtil('otro')}>
          <View style={[styles.radio, temaMasUtil === 'otro' && styles.radioActivo]}>
            {temaMasUtil === 'otro' && <View style={styles.radioDot} />}
          </View>
          <Text style={styles.opcionTexto}>Otro:</Text>
        </TouchableOpacity>
        {temaMasUtil === 'otro' && (
          <TextInput
            style={[styles.input, { marginBottom: SPACING.sm }]}
            value={temaMasUtilOtro}
            onChangeText={setTemaMasUtilOtro}
            placeholder="¿Cuál?"
            placeholderTextColor={COLORS.textLight}
          />
        )}

        <Text style={[styles.preguntaTexto, { marginTop: SPACING.sm }]}>¿Considera que puede aplicar lo aprendido en su finca?</Text>
        <View style={styles.likertRow}>
          {([['si', 'Sí'], ['parcial', 'Parcialmente'], ['no', 'No']] as const).map(([value, label]) => (
            <TouchableOpacity key={value} style={[styles.likertChip, puedeAplicar === value && styles.likertChipActivo]} onPress={() => setPuedeAplicar(value)}>
              <Text style={[styles.likertChipText, puedeAplicar === value && styles.likertChipTextActivo]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>¿Qué tema le gustaría reforzar en próximas jornadas?</Text>
          <TextInput style={[styles.input, styles.textArea]} value={temaReforzar} onChangeText={setTemaReforzar} multiline placeholder="Escribe aquí..." placeholderTextColor={COLORS.textLight} />
        </View>

        <Text style={styles.sectionLabel}>4. Participación y Continuidad</Text>
        <Text style={styles.preguntaTexto}>¿Volvería a participar en otra Escuela de Campo?</Text>
        <View style={styles.likertRow}>
          {([['si', 'Sí'], ['no', 'No'], ['tal_vez', 'Tal vez']] as const).map(([value, label]) => (
            <TouchableOpacity key={value} style={[styles.likertChip, volveriaParticipar === value && styles.likertChipActivo]} onPress={() => setVolveriaParticipar(value)}>
              <Text style={[styles.likertChipText, volveriaParticipar === value && styles.likertChipTextActivo]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>¿Qué tema le gustaría que se abordara en la próxima ECA?</Text>
          <TextInput style={styles.input} value={temaProximaEca} onChangeText={setTemaProximaEca} placeholder="Escribe aquí..." placeholderTextColor={COLORS.textLight} />
        </View>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Sugerencias para mejorar las próximas jornadas</Text>
          <TextInput style={[styles.input, styles.textArea]} value={sugerencias} onChangeText={setSugerencias} multiline placeholder="Escribe aquí..." placeholderTextColor={COLORS.textLight} />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <TouchableOpacity style={[styles.generarBtn, generando && styles.generarBtnDisabled]} onPress={handleGenerar} disabled={generando} activeOpacity={0.8}>
          {generando ? <ActivityIndicator color="#fff" /> : <Text style={styles.generarBtnText}>📄 Generar PDF</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  titulo: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  subtitulo: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 16 },
  sectionLabel: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  campoWrap: { marginBottom: SPACING.sm },
  campoLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm, paddingVertical: 8, fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary, backgroundColor: COLORS.background,
  },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  preguntaCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.md,
    marginBottom: SPACING.sm, ...SHADOWS.sm,
  },
  preguntaTitulo: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.primary, marginBottom: 2 },
  preguntaTexto: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  opcionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: COLORS.border,
    marginRight: SPACING.sm, alignItems: 'center', justifyContent: 'center',
  },
  radioActivo: { borderColor: COLORS.primary },
  radioDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: COLORS.primary },
  opcionTexto: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary, flex: 1 },
  likertRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  likertChip: {
    paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  likertChipActivo: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  likertChipText: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary, fontWeight: FONTS.weights.medium },
  likertChipTextActivo: { color: '#fff' },
  footer: { padding: SPACING.md, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  generarBtn: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.md, alignItems: 'center', justifyContent: 'center' },
  generarBtnDisabled: { opacity: 0.6 },
  generarBtnText: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
});

export default EvaluacionEcaScreen;
