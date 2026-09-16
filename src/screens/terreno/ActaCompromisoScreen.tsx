// ============================================================
// GEODAILY — Acta de Compromiso (PA. 2 FO. 30)
// ============================================================
// El beneficiario lee un resumen de cada sección (con opción de ver el
// texto completo), se completan los datos que falten y al final firman
// el beneficiario y el técnico. El PDF se genera reproduciendo el
// formato oficial completo con los espacios llenos.
// ============================================================

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { useAuth } from '../../store/AuthContext';
import { DatosBeneficiario } from '../../types';
import {
  getBeneficiarioByCedula,
  actualizarContactoBeneficiario,
} from '../../services/beneficiariosDB.service';
import {
  generarPDFActaCompromiso,
  AC_DISPONIBILIDAD,
  AC_ACREDITACION,
  AC_USO_MANEJO,
  AC_TECNICOS_PRODUCTIVOS,
  AC_AMBIENTALES,
  AC_PERMANENCIA,
  AC_ENTIDAD,
} from '../../services/pdfLocal.service';
import SignaturePad from '../../components/SignaturePad';
import { guardarDatosOtroFormato, cargarDatosOtroFormato } from '../../store/OtrosFormatosDraftStore';

type ActaCompromisoScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: {
    params?: {
      beneficiario?: DatosBeneficiario;
    };
  };
};

type CalidadPredio = 'propietario' | 'poseedor' | 'otro';

type Seccion = {
  id: string;
  titulo: string;
  resumen: string;
  parrafos?: string[];
  items?: string[];
};

const SECCIONES: Seccion[] = [
  {
    id: 'consideracion',
    titulo: '1. Consideración',
    resumen: 'Participarás en el proyecto de implementación de unidades productoras de cacao en arreglo agroforestal, con acompañamiento técnico integral (análisis de suelo, fertilización, capacitación y asistencia técnica).',
    parrafos: [
      'El proyecto "Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal en el municipio de Puerto Rico, Caquetá" tiene como propósito el establecimiento y fortalecimiento de unidades productoras de cacao mediante sistemas de arreglo agroforestal, integrando clones mejorados de cacao de alto rendimiento, asociados con plátano como sombrío temporal y especies forestales como sombrío permanente, bajo criterios de sostenibilidad productiva y ambiental.',
      'En el marco de la ejecución del proyecto se contempla el desarrollo de un proceso integral de acompañamiento a los beneficiarios: análisis de suelos, biofactorías de insumos orgánicos, fertilización órgano-mineral, manejo fitosanitario, herramientas, materiales e insumos, capacitación y Escuelas de Campo para Agricultores (ECA), y asistencia técnica especializada.',
      'Al firmar esta acta, declaras conocer las condiciones generales de participación y asumes los compromisos relacionados con la implementación, cuidado, manejo y sostenibilidad de tu unidad productora de cacao.',
    ],
  },
  {
    id: '2.1',
    titulo: '2.1 Disponibilidad y participación',
    resumen: 'Facilitar el acceso al predio y participar activamente en las visitas, capacitaciones y actividades técnicas programadas.',
    items: AC_DISPONIBILIDAD,
  },
  {
    id: '2.2',
    titulo: '2.2 Acreditación y disponibilidad del predio',
    resumen: 'Mantener al día la documentación que acredite tu relación con el predio y permitir su georreferenciación y verificación técnica.',
    items: AC_ACREDITACION,
  },
  {
    id: '2.3',
    titulo: '2.3 Uso y manejo de los elementos entregados',
    resumen: 'Dar uso adecuado y exclusivo a las herramientas, equipos e insumos entregados; no venderlos, arrendarlos ni cederlos.',
    items: AC_USO_MANEJO,
  },
  {
    id: '2.4',
    titulo: '2.4 Compromisos técnicos y productivos',
    resumen: 'Seguir las recomendaciones técnicas y aplicar las buenas prácticas agrícolas y ambientales durante el manejo del cultivo.',
    items: AC_TECNICOS_PRODUCTIVOS,
  },
  {
    id: '2.5',
    titulo: '2.5 Compromisos ambientales',
    resumen: 'Respetar las franjas de protección hídrica (30 m), no deforestar y conservar el suelo y los recursos naturales.',
    items: AC_AMBIENTALES,
  },
  {
    id: '2.6',
    titulo: '2.6 Permanencia y sostenibilidad',
    resumen: 'Garantizar el cuidado y continuidad de la unidad productora, e informar oportunamente si decides retirarte del proyecto.',
    items: AC_PERMANENCIA,
  },
  {
    id: '3',
    titulo: '3. Compromisos de la Entidad Ejecutora',
    resumen: 'AGROINDUSTRIAL CACAOTERA DE PUERTO RICO S.A.S. se compromete a brindar asistencia técnica, entregar materiales e insumos, capacitar y hacer seguimiento continuo al proyecto.',
    items: AC_ENTIDAD,
  },
  {
    id: '4',
    titulo: '4. Vigencia',
    resumen: 'Esta acta rige durante la ejecución del proyecto y el periodo de seguimiento establecido para las unidades productoras de cacao.',
  },
];

const CALIDAD_OPCIONES: { value: CalidadPredio; label: string }[] = [
  { value: 'propietario', label: 'Propietario(a)' },
  { value: 'poseedor', label: 'Poseedor(a)' },
  { value: 'otro', label: 'Otro' },
];

const ActaCompromisoScreen: React.FC<ActaCompromisoScreenProps> = ({ navigation, route }) => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const beneficiario = route?.params?.beneficiario;

  const [nombre, setNombre] = useState(beneficiario?.nombre || '');
  const [cedula, setCedula] = useState(beneficiario?.cedula || '');
  const [telefono, setTelefono] = useState(beneficiario?.telefono || '');
  const [correo, setCorreo] = useState('');
  const [vereda, setVereda] = useState(beneficiario?.vereda || '');
  const [corregimiento, setCorregimiento] = useState(beneficiario?.corregimiento || '');
  const [predio, setPredio] = useState(beneficiario?.finca || '');
  const [calidadPredio, setCalidadPredio] = useState<CalidadPredio | null>(null);

  const [expandida, setExpandida] = useState<Set<string>>(new Set());
  const [leidas, setLeidas] = useState<Set<string>>(new Set());

  const [firmaBeneficiario, setFirmaBeneficiario] = useState<string | null>(null);
  const [firmaTecnico, setFirmaTecnico] = useState<string | null>(null);
  const [padActivo, setPadActivo] = useState<'beneficiario' | 'tecnico' | null>(null);

  const [generando, setGenerando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const cargadoRef = useRef(false);

  // Cargar lo que el técnico ya había escrito para ESTE beneficiario (si
  // existe) — cada beneficiario guarda su propio acta por separado.
  useEffect(() => {
    (async () => {
      try {
        const guardado = await cargarDatosOtroFormato<{
          nombre: string; cedula: string; telefono: string; correo: string;
          vereda: string; corregimiento: string; predio: string;
          calidadPredio: CalidadPredio | null; leidas: string[];
          firmaBeneficiario: string | null; firmaTecnico: string | null;
        }>('acta_compromiso', beneficiario?.cedula);
        if (guardado) {
          setNombre(guardado.nombre ?? nombre);
          setCedula(guardado.cedula ?? cedula);
          setTelefono(guardado.telefono ?? telefono);
          setCorreo(guardado.correo ?? '');
          setVereda(guardado.vereda ?? vereda);
          setCorregimiento(guardado.corregimiento ?? corregimiento);
          setPredio(guardado.predio ?? predio);
          setCalidadPredio(guardado.calidadPredio ?? null);
          setLeidas(new Set(guardado.leidas || []));
          setFirmaBeneficiario(guardado.firmaBeneficiario ?? null);
          setFirmaTecnico(guardado.firmaTecnico ?? null);
        }
      } catch (e) {
        console.warn('[ActaCompromiso] Error al cargar borrador:', e);
      } finally {
        cargadoRef.current = true;
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiario?.cedula]);

  // Guardar automáticamente cada vez que algo cambia (ligado a este
  // beneficiario) — no antes de terminar de cargar, para no pisar lo
  // guardado con los valores iniciales vacíos.
  useEffect(() => {
    if (!cargadoRef.current) return;
    guardarDatosOtroFormato('acta_compromiso', beneficiario?.cedula, {
      nombre, cedula, telefono, correo, vereda, corregimiento, predio,
      calidadPredio, leidas: Array.from(leidas), firmaBeneficiario, firmaTecnico,
    });
  }, [beneficiario?.cedula, nombre, cedula, telefono, correo, vereda, corregimiento, predio, calidadPredio, leidas, firmaBeneficiario, firmaTecnico]);

  const toggleSeccion = useCallback((id: string) => {
    setExpandida((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLeidas((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const todasLeidas = useMemo(() => leidas.size === SECCIONES.length, [leidas]);

  const handleGenerar = useCallback(async () => {
    if (!nombre.trim() || !cedula.trim()) {
      Alert.alert('Faltan datos', 'El nombre y la identificación del beneficiario son obligatorios.');
      return;
    }
    if (!calidadPredio) {
      Alert.alert('Falta un dato', 'Selecciona la calidad respecto del predio (Propietario, Poseedor u Otro).');
      return;
    }
    if (!todasLeidas) {
      Alert.alert(
        'Revisa el contenido',
        'Toca cada sección para desplegarla antes de continuar — así te aseguras de que el beneficiario conoce todos los compromisos.'
      );
      return;
    }
    if (!firmaBeneficiario || !firmaTecnico) {
      Alert.alert('Faltan firmas', 'Se necesita la firma del beneficiario y del técnico de campo.');
      return;
    }

    setGenerando(true);
    try {
      // Guardar en la base de beneficiarios los datos capturados aquí por
      // primera vez, para futuras consultas.
      try {
        const registro = await getBeneficiarioByCedula(cedula.trim());
        if (registro) {
          await actualizarContactoBeneficiario(registro.item, {
            telefono: telefono.trim() || undefined,
            correo_electronico: correo.trim() || undefined,
            calidad_predio: calidadPredio,
          });
        }
      } catch (e) {
        console.warn('[ActaCompromiso] No se pudieron guardar los datos de contacto:', e);
      }

      const uri = await generarPDFActaCompromiso({
        nombre: nombre.trim(),
        cedula: cedula.trim(),
        telefono: telefono.trim(),
        correo: correo.trim(),
        vereda: vereda.trim(),
        corregimiento: corregimiento.trim(),
        predio: predio.trim(),
        calidadPredio,
        fecha: new Date().toISOString(),
        firmaBeneficiario,
        firmaTecnico,
        tecnicoNombre: user?.nombre || 'Técnico',
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
      console.warn('[ActaCompromiso] Error al generar PDF:', e);
      Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setGenerando(false);
    }
  }, [nombre, cedula, telefono, correo, vereda, corregimiento, predio, calidadPredio, todasLeidas, firmaBeneficiario, firmaTecnico, user]);

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
          <Text style={styles.padTitle}>
            {padActivo === 'beneficiario' ? '✍️ Firma del Beneficiario' : '🖊️ Firma del Técnico de Campo'}
          </Text>
        </View>
        <SignaturePad
          description={padActivo === 'beneficiario' ? 'Firma del beneficiario' : 'Firma del técnico de campo'}
          onOK={(signature) => {
            if (padActivo === 'beneficiario') setFirmaBeneficiario(signature);
            else setFirmaTecnico(signature);
            setPadActivo(null);
          }}
        />
        <TouchableOpacity style={styles.padCancelar} onPress={() => setPadActivo(null)}>
          <Text style={styles.padCancelarText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.titulo}>Acta de Compromiso</Text>
        <Text style={styles.subtitulo}>
          Implementación de Unidades Productoras de Cacao en Arreglo Agroforestal — PA. 2 FO. 30
        </Text>

        {/* ─── Datos del beneficiario y del predio ─────────────── */}
        <Text style={styles.sectionLabel}>Información del beneficiario y del predio</Text>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Nombre del beneficiario(a)</Text>
          <TextInput style={styles.input} value={nombre} onChangeText={setNombre} placeholder="Nombre completo" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Identificación</Text>
          <TextInput style={styles.input} value={cedula} onChangeText={setCedula} keyboardType="numeric" placeholder="Cédula" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Teléfono</Text>
          <TextInput style={styles.input} value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" placeholder="Teléfono" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Correo electrónico</Text>
          <TextInput style={styles.input} value={correo} onChangeText={setCorreo} keyboardType="email-address" autoCapitalize="none" placeholder="correo@ejemplo.com" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Vereda</Text>
          <TextInput style={styles.input} value={vereda} onChangeText={setVereda} placeholder="Vereda" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Corregimiento</Text>
          <TextInput style={styles.input} value={corregimiento} onChangeText={setCorregimiento} placeholder="Corregimiento" placeholderTextColor={COLORS.textLight} />
        </View>
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Predio</Text>
          <TextInput style={styles.input} value={predio} onChangeText={setPredio} placeholder="Nombre de la finca" placeholderTextColor={COLORS.textLight} />
        </View>

        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Calidad respecto del predio</Text>
          <View style={styles.calidadRow}>
            {CALIDAD_OPCIONES.map((op) => (
              <TouchableOpacity
                key={op.value}
                style={[styles.calidadChip, calidadPredio === op.value && styles.calidadChipActivo]}
                onPress={() => setCalidadPredio(op.value)}
              >
                <Text style={[styles.calidadChipText, calidadPredio === op.value && styles.calidadChipTextActivo]}>
                  {op.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ─── Secciones del acta (resumen + expandible) ───────── */}
        <Text style={styles.sectionLabel}>Contenido del acta — toca cada sección para leerla</Text>
        <Text style={styles.sectionHint}>
          {leidas.size}/{SECCIONES.length} secciones revisadas
        </Text>

        {SECCIONES.map((s) => {
          const abierta = expandida.has(s.id);
          const vista = leidas.has(s.id);
          return (
            <TouchableOpacity
              key={s.id}
              style={[styles.seccionCard, vista && styles.seccionCardVista]}
              onPress={() => toggleSeccion(s.id)}
              activeOpacity={0.7}
            >
              <View style={styles.seccionHeader}>
                <View style={styles.seccionTituloRow}>
                  {vista && <Text style={styles.seccionCheck}>✓</Text>}
                  <Text style={styles.seccionTitulo}>{s.titulo}</Text>
                </View>
                <Text style={styles.seccionArrow}>{abierta ? '︿' : '﹀'}</Text>
              </View>
              <Text style={styles.seccionResumen}>{s.resumen}</Text>

              {abierta && (
                <View style={styles.seccionCompleto}>
                  {s.parrafos?.map((p, i) => (
                    <Text key={i} style={styles.seccionTexto}>{p}</Text>
                  ))}
                  {s.items?.map((it, i) => (
                    <Text key={i} style={styles.seccionItem}>{i + 1}. {it}</Text>
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* ─── Firmas ───────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Firmas</Text>

        <TouchableOpacity
          style={[styles.firmaBtn, firmaBeneficiario && styles.firmaBtnOk]}
          onPress={() => setPadActivo('beneficiario')}
        >
          <Text style={styles.firmaBtnText}>
            {firmaBeneficiario ? '✓ Firma del Beneficiario registrada' : '✍️ Firmar — Beneficiario'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.firmaBtn, firmaTecnico && styles.firmaBtnOk]}
          onPress={() => setPadActivo('tecnico')}
        >
          <Text style={styles.firmaBtnText}>
            {firmaTecnico ? '✓ Firma del Técnico de Campo registrada' : '🖊️ Firmar — Técnico de Campo'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <TouchableOpacity
          style={[styles.generarBtn, generando && styles.generarBtnDisabled]}
          onPress={handleGenerar}
          disabled={generando}
          activeOpacity={0.8}
        >
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
  sectionHint: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  campoWrap: { marginBottom: SPACING.sm },
  campoLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.background,
  },
  calidadRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  calidadChip: {
    paddingVertical: 8,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  calidadChipActivo: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  calidadChipText: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, fontWeight: FONTS.weights.medium },
  calidadChipTextActivo: { color: '#fff' },
  seccionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.border,
    ...SHADOWS.sm,
  },
  seccionCardVista: { borderLeftColor: COLORS.success },
  seccionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seccionTituloRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  seccionCheck: { color: COLORS.success, fontWeight: FONTS.weights.bold, marginRight: 6 },
  seccionTitulo: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, flexShrink: 1 },
  seccionArrow: { fontSize: FONTS.sizes.md, color: COLORS.textLight, marginLeft: SPACING.sm },
  seccionResumen: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 4, lineHeight: 16 },
  seccionCompleto: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider },
  seccionTexto: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary, marginBottom: SPACING.sm, lineHeight: 17, textAlign: 'justify' },
  seccionItem: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary, marginBottom: 6, lineHeight: 17, textAlign: 'justify' },
  firmaBtn: {
    borderWidth: 1.5,
    borderColor: COLORS.info,
    borderStyle: 'dashed',
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.info + '10',
  },
  firmaBtnOk: { borderStyle: 'solid', borderColor: COLORS.success, backgroundColor: COLORS.success + '15' },
  firmaBtnText: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  footer: {
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  generarBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generarBtnDisabled: { opacity: 0.6 },
  generarBtnText: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
  padHeader: { padding: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  padTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  padCancelar: { padding: SPACING.md, alignItems: 'center' },
  padCancelarText: { color: COLORS.textSecondary, fontSize: FONTS.sizes.sm },
});

export default ActaCompromisoScreen;
