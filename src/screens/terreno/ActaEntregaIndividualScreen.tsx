// ============================================================
// GEODAILY — Acta Individual de Entrega y Recibido a Satisfacción (PA. 2 FO. 39)
// ============================================================
// El técnico diligencia los datos del beneficiario y del predio, lista las
// actividades entregadas (ítem, descripción, actividad del proyecto, cantidad
// y unidad) y recoge las firmas del beneficiario y del contratista (técnico).
// La firma de la interventoría es opcional: puede firmar después en el PDF.
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
import { useAuth } from '../../store/AuthContext';
import { DatosBeneficiario } from '../../types';
import {
  generarPDFActaEntregaIndividual,
  construirHtmlActaEntregaIndividual,
  ActividadActaEntrega,
  DatosActaEntregaIndividual,
} from '../../services/pdfLocal.service';
import SignaturePad from '../../components/SignaturePad';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  guardarDatosOtroFormato,
  cargarDatosOtroFormato,
  eliminarDatosOtroFormato,
} from '../../store/OtrosFormatosDraftStore';
import BotonGuardarBorrador, { useGuardarBorrador } from '../../components/BotonGuardarBorrador';
import { registrarOtroFormato, adjuntarPdfOtroFormato, cargarActaExistente } from '../../services/otrosFormatos.service';
import { avisar, confirmar } from '../../utils/dialogos';
import { abrirVentanaDeCarga, imprimirHtmlEnVentana } from '../../utils/printWeb';
import { buscarActividad } from '../../data/actividades';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: { params?: { beneficiario?: DatosBeneficiario; actividadId?: string; instancia?: string } };
};

type Firmante = 'beneficiario' | 'tecnico' | 'interventoria';

const TIPOS_DOCUMENTO = ['CC', 'CE', 'TI', 'PA'];

/** Fila de ejemplo que trae el formato oficial: se puede editar o quitar. */
const ACTIVIDAD_INICIAL: ActividadActaEntrega = {
  descripcion: 'Preparación del terreno',
  actividad: '2',
  cantidad: '2,5',
  unidad: 'Hectárea',
};

/**
 * A un beneficiario le entregan varias cosas y firma varias actas: cada una es
 * una INSTANCIA aparte (su propio borrador y su propio registro). Mientras el
 * técnico no genera el PDF, al volver a entrar retoma la acta en curso; al
 * generarla se suelta, y la siguiente apertura empieza una acta nueva.
 */
/**
 * Cada actividad tiene sus propias actas: el acta en curso se guarda por
 * (beneficiario, actividad) para que una acta empezada en "Otros formatos" no
 * se retome dentro de una actividad, ni al revés.
 */
const claveActaEnCurso = (cedula: string, actividadId?: string) =>
  actividadId ? `geodaily.acta_entrega.en_curso.${cedula}.${actividadId}` : `geodaily.acta_entrega.en_curso.${cedula}`;

const ActaEntregaIndividualScreen: React.FC<Props> = ({ route, navigation }) => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const beneficiario = route?.params?.beneficiario;
  /** Actividad en la que se diligencia el acta (undefined = desde "Otros formatos"). */
  const actividadId = route?.params?.actividadId;
  const actividadDelActa = buscarActividad(actividadId);
  /** Acta ya completada que se reabre para corregirla (ej. tras una observación). */
  const instanciaExistente = route?.params?.instancia;

  const [nombre, setNombre] = useState(beneficiario?.nombre || '');
  const [cedula, setCedula] = useState(beneficiario?.cedula || '');
  const [tipoDocumento, setTipoDocumento] = useState('CC');
  const [vereda, setVereda] = useState(beneficiario?.vereda || '');
  const [corregimiento, setCorregimiento] = useState(beneficiario?.corregimiento || '');
  const [predio, setPredio] = useState(beneficiario?.finca || '');
  const [actividades, setActividades] = useState<ActividadActaEntrega[]>([
    actividadId && actividadId !== 'preparacion_terreno'
      ? { descripcion: actividadDelActa?.nombre ?? '', actividad: '', cantidad: '', unidad: '' }
      : { ...ACTIVIDAD_INICIAL },
  ]);

  const [contratistaNombre, setContratistaNombre] = useState(user?.nombre || '');
  const [contratistaCargo, setContratistaCargo] = useState('Técnico de campo');
  const [interventoriaNombre, setInterventoriaNombre] = useState('');
  const [interventoriaCargo, setInterventoriaCargo] = useState('');

  const [firmaBeneficiario, setFirmaBeneficiario] = useState<string | null>(null);
  const [firmaTecnico, setFirmaTecnico] = useState<string | null>(null);
  const [firmaInterventoria, setFirmaInterventoria] = useState<string | null>(null);
  const [padActivo, setPadActivo] = useState<Firmante | null>(null);

  const [generando, setGenerando] = useState(false);
  const [completando, setCompletando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const cargadoRef = useRef(false);
  const [instancia, setInstancia] = useState('');
  // El borrador se guarda por (beneficiario, instancia): "<cédula>__<instancia>".
  const claveBorrador = beneficiario?.cedula && instancia ? `${beneficiario.cedula}__${instancia}` : undefined;

  // Retoma el acta en curso de ESTE beneficiario, o abre una nueva.
  useEffect(() => {
    (async () => {
      try {
        let inst = '';
        if (beneficiario?.cedula && instanciaExistente) {
          inst = instanciaExistente;
          setInstancia(inst);
        } else if (beneficiario?.cedula) {
          inst = (await AsyncStorage.getItem(claveActaEnCurso(beneficiario.cedula, actividadId))) || '';
          if (!inst) {
            inst = Date.now().toString(36);
            await AsyncStorage.setItem(claveActaEnCurso(beneficiario.cedula, actividadId), inst);
          }
          setInstancia(inst);
        }
        let g = inst
          ? await cargarDatosOtroFormato<Record<string, any>>('acta_entrega_individual', `${beneficiario?.cedula}__${inst}`)
          : null;
        // Al reabrir un acta completada: lo que se estaba corrigiendo (borrador) o, si no hay, el acta tal como se publicó.
        if (!g && instanciaExistente && beneficiario?.cedula) g = await cargarActaExistente(beneficiario.cedula, instanciaExistente);
        if (g) {
          setNombre(g.nombre ?? nombre);
          setCedula(g.cedula ?? cedula);
          setTipoDocumento(g.tipoDocumento ?? 'CC');
          setVereda(g.vereda ?? vereda);
          setCorregimiento(g.corregimiento ?? corregimiento);
          setPredio(g.predio ?? predio);
          if (Array.isArray(g.actividades) && g.actividades.length) setActividades(g.actividades);
          setContratistaNombre(g.contratistaNombre ?? contratistaNombre);
          setContratistaCargo(g.contratistaCargo ?? contratistaCargo);
          setInterventoriaNombre(g.interventoriaNombre ?? '');
          setInterventoriaCargo(g.interventoriaCargo ?? '');
          setFirmaBeneficiario(g.firmaBeneficiario ?? null);
          setFirmaTecnico(g.firmaTecnico ?? null);
          setFirmaInterventoria(g.firmaInterventoria ?? null);
        }
      } catch (e) {
        console.warn('[ActaEntregaIndividual] Error al cargar borrador:', e);
      } finally {
        cargadoRef.current = true;
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiario?.cedula]);

  // Autoguardado ligado al beneficiario (no antes de terminar de cargar).
  useEffect(() => {
    if (!cargadoRef.current || !claveBorrador) return;
    guardarDatosOtroFormato('acta_entrega_individual', claveBorrador, {
      nombre, cedula, tipoDocumento, vereda, corregimiento, predio, actividades,
      contratistaNombre, contratistaCargo, interventoriaNombre, interventoriaCargo,
      firmaBeneficiario, firmaTecnico, firmaInterventoria,
    });
  }, [
    claveBorrador, nombre, cedula, tipoDocumento, vereda, corregimiento, predio, actividades,
    contratistaNombre, contratistaCargo, interventoriaNombre, interventoriaCargo,
    firmaBeneficiario, firmaTecnico, firmaInterventoria,
  ]);

  const cambiarActividad = useCallback((i: number, campo: keyof ActividadActaEntrega, valor: string) => {
    setActividades((prev) => prev.map((a, idx) => (idx === i ? { ...a, [campo]: valor } : a)));
  }, []);

  const agregarActividad = useCallback(() => {
    setActividades((prev) => [...prev, { descripcion: '', actividad: '', cantidad: '', unidad: '' }]);
  }, []);

  const quitarActividad = useCallback((i: number) => {
    setActividades((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const { guardar, guardando } = useGuardarBorrador('acta_entrega_individual', claveBorrador, { nombre, cedula, tipoDocumento, vereda, corregimiento, predio, actividades, contratistaNombre, contratistaCargo, interventoriaNombre, interventoriaCargo, firmaBeneficiario, firmaTecnico, firmaInterventoria });

  const handleGenerar = useCallback(async () => {
    if (!nombre.trim() || !cedula.trim()) {
      Alert.alert('Faltan datos', 'El nombre y la identificación del beneficiario son obligatorios.');
      return;
    }
    const completas = actividades.filter((a) => a.descripcion.trim());
    if (completas.length === 0) {
      Alert.alert('Faltan actividades', 'Agrega al menos una actividad entregada, con su descripción.');
      return;
    }
    if (!firmaBeneficiario || !firmaTecnico) {
      Alert.alert('Faltan firmas', 'Se necesita la firma del beneficiario y la del contratista (técnico).');
      return;
    }

    // En web la pestaña de impresión debe abrirse SÍNCRONA, antes de cualquier await.
    const ventanaWeb = Platform.OS === 'web' ? abrirVentanaDeCarga() : null;

    setGenerando(true);
    try {
      const datosPDF: DatosActaEntregaIndividual = {
        nombre: nombre.trim(),
        cedula: cedula.trim(),
        tipoDocumento,
        instancia,
        ...(actividadId ? { actividadId } : {}),
        faltantes: [],
        fecha: new Date().toISOString(),
        corregimiento: corregimiento.trim(),
        vereda: vereda.trim(),
        predio: predio.trim(),
        actividades: completas.map((a) => ({
          descripcion: a.descripcion.trim(),
          actividad: a.actividad.trim(),
          cantidad: a.cantidad.trim(),
          unidad: a.unidad.trim(),
        })),
        contratistaNombre: contratistaNombre.trim(),
        contratistaCargo: contratistaCargo.trim(),
        interventoriaNombre: interventoriaNombre.trim(),
        interventoriaCargo: interventoriaCargo.trim(),
        firmaBeneficiario,
        firmaTecnico,
        firmaInterventoria,
      };

      // Publicar para los roles superiores (offline-first).
      await registrarOtroFormato({
        tipo: 'acta_entrega_individual',
        beneficiarioCedula: datosPDF.cedula,
        beneficiarioNombre: datosPDF.nombre,
        datos: datosPDF as unknown as Record<string, any>,
        user,
      });

      // Acta terminada: se suelta el borrador y la próxima apertura será una acta nueva.
      const cerrarActa = async () => {
        if (claveBorrador) await eliminarDatosOtroFormato('acta_entrega_individual', claveBorrador);
        if (beneficiario?.cedula && !instanciaExistente) await AsyncStorage.removeItem(claveActaEnCurso(beneficiario.cedula, actividadId));
      };

      if (Platform.OS === 'web') {
        imprimirHtmlEnVentana(ventanaWeb, construirHtmlActaEntregaIndividual(datosPDF));
        await cerrarActa();
        navigation.goBack();
        return;
      }

      const uri = await generarPDFActaEntregaIndividual(datosPDF);
      if (!uri) {
        Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
        return;
      }
      // Conserva el PDF (copia local + servidor) para el Historial; sin esperar la subida.
      void adjuntarPdfOtroFormato({
        tipo: 'acta_entrega_individual',
        beneficiarioCedula: datosPDF.cedula,
        instancia,
        pdfUri: uri,
      });
      await cerrarActa();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('PDF generado', `Guardado en: ${uri}`);
      }
      navigation.goBack();
    } catch (e) {
      ventanaWeb?.close();
      console.warn('[ActaEntregaIndividual] Error al generar PDF:', e);
      Alert.alert('Error', 'No se pudo generar el PDF. Intenta de nuevo.');
    } finally {
      setGenerando(false);
    }
  }, [
    nombre, cedula, tipoDocumento, vereda, corregimiento, predio, actividades,
    contratistaNombre, contratistaCargo, interventoriaNombre, interventoriaCargo,
    firmaBeneficiario, firmaTecnico, firmaInterventoria, user, instancia, claveBorrador, beneficiario?.cedula, actividadId, instanciaExistente, navigation,
  ]);

  // "Completar acta": la publica para los demás roles con los datos que haya
  // (sin exigir firmas ni todos los campos); ellos avisan de lo errado o
  // faltante y el técnico puede reabrirla desde la actividad para corregirla.
  const handleCompletar = async () => {
    if (completando) return;
    if (!nombre.trim() || !cedula.trim()) {
      avisar('Faltan datos', 'El nombre y la identificación del beneficiario son obligatorios.');
      return;
    }
    const completas = actividades.filter((a) => a.descripcion.trim());
    const faltantes: string[] = [];
    if (completas.length === 0) faltantes.push('Actividades entregadas');
    if (!predio.trim()) faltantes.push('Predio');
    if (!vereda.trim()) faltantes.push('Vereda');
    if (!corregimiento.trim()) faltantes.push('Corregimiento');
    if (!firmaBeneficiario) faltantes.push('Firma del beneficiario');
    if (!firmaTecnico) faltantes.push('Firma del contratista (técnico)');

    const pregunta = faltantes.length
      ? `Quedan pendientes: ${faltantes.join(', ')}.\n\nSe publicará para que los revisores la vean y te avisen de cualquier dato errado o faltante. Podrás reabrirla y completarla desde la actividad.`
      : 'Se publicará para que los revisores la vean. Podrás reabrirla desde la actividad si te piden una corrección.';
    if (!(await confirmar('Completar acta', pregunta, 'Completar'))) return;

    setCompletando(true);
    try {
      const datos: DatosActaEntregaIndividual = {
        nombre: nombre.trim(),
        cedula: cedula.trim(),
        tipoDocumento,
        instancia,
        ...(actividadId ? { actividadId } : {}),
        faltantes,
        fecha: new Date().toISOString(),
        corregimiento: corregimiento.trim(),
        vereda: vereda.trim(),
        predio: predio.trim(),
        actividades: completas.map((a) => ({
          descripcion: a.descripcion.trim(),
          actividad: a.actividad.trim(),
          cantidad: a.cantidad.trim(),
          unidad: a.unidad.trim(),
        })),
        contratistaNombre: contratistaNombre.trim(),
        contratistaCargo: contratistaCargo.trim(),
        interventoriaNombre: interventoriaNombre.trim(),
        interventoriaCargo: interventoriaCargo.trim(),
        firmaBeneficiario: firmaBeneficiario || '',
        firmaTecnico: firmaTecnico || '',
        firmaInterventoria,
      };
      const r = await registrarOtroFormato({
        tipo: 'acta_entrega_individual',
        beneficiarioCedula: datos.cedula,
        beneficiarioNombre: datos.nombre,
        datos: datos as unknown as Record<string, any>,
        user,
      });
      if (!r.guardado) {
        avisar('No se pudo completar', 'No se pudo guardar el acta en este dispositivo. Revisa el espacio e intenta de nuevo.');
        return;
      }
      // Publicada: se suelta el borrador; la próxima apertura será una acta nueva (o la reabres desde la actividad).
      if (claveBorrador) await eliminarDatosOtroFormato('acta_entrega_individual', claveBorrador);
      if (beneficiario?.cedula && !instanciaExistente) await AsyncStorage.removeItem(claveActaEnCurso(beneficiario.cedula, actividadId));
      avisar(
        'Acta completada',
        r.sincronizado
          ? 'Los revisores ya pueden verla.'
          : 'Quedó guardada en este dispositivo y se publicará cuando haya señal.'
      );
      navigation.goBack();
    } catch (e) {
      console.warn('[ActaEntregaIndividual] Error al completar:', e);
      avisar('Error', 'No se pudo completar el acta. Intenta de nuevo.');
    } finally {
      setCompletando(false);
    }
  };

  if (cargando) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (padActivo) {
    const titulos: Record<Firmante, string> = {
      beneficiario: '✍️ Firma del Beneficiario',
      tecnico: '🖊️ Firma del Contratista (Técnico)',
      interventoria: '🖊️ Firma de la Interventoría',
    };
    return (
      <View style={styles.container}>
        <View style={[styles.padHeader, { paddingTop: insets.top + SPACING.sm }]}>
          <Text style={styles.padTitle}>{titulos[padActivo]}</Text>
        </View>
        <SignaturePad
          description={titulos[padActivo].replace(/^\S+\s/, '')}
          onOK={(signature) => {
            if (padActivo === 'beneficiario') setFirmaBeneficiario(signature);
            else if (padActivo === 'tecnico') setFirmaTecnico(signature);
            else setFirmaInterventoria(signature);
            setPadActivo(null);
          }}
        />
        <TouchableOpacity style={styles.padCancelar} onPress={() => setPadActivo(null)}>
          <Text style={styles.padCancelarText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const campo = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {}
  ) => (
    <View style={styles.campoWrap}>
      <Text style={styles.campoLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor={COLORS.textLight}
        {...extra}
      />
    </View>
  );

  const botonFirma = (quien: Firmante, firma: string | null, pendiente: string, hecha: string) => (
    <TouchableOpacity
      style={[styles.firmaBtn, firma && styles.firmaBtnOk]}
      onPress={() => setPadActivo(quien)}
    >
      <Text style={styles.firmaBtnText}>{firma ? hecha : pendiente}</Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.titulo}>Acta Individual de Entrega y Recibo</Text>
        <Text style={styles.subtitulo}>
          Entrega y recibido a satisfacción — Unidades Productoras de Cacao, Puerto Rico (Caquetá) — PA. 2 FO. 39
        </Text>

        <Text style={styles.sectionLabel}>Beneficiario y predio</Text>
        {campo('Beneficiario', nombre, setNombre, { placeholder: 'Nombre completo' })}
        <View style={styles.campoWrap}>
          <Text style={styles.campoLabel}>Tipo de documento</Text>
          <View style={styles.chipsRow}>
            {TIPOS_DOCUMENTO.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, tipoDocumento === t && styles.chipActivo]}
                onPress={() => setTipoDocumento(t)}
              >
                <Text style={[styles.chipText, tipoDocumento === t && styles.chipTextActivo]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {campo('Identificación', cedula, setCedula, { keyboardType: 'numeric', editable: !beneficiario?.cedula })}
        {campo('Corregimiento', corregimiento, setCorregimiento)}
        {campo('Vereda', vereda, setVereda)}
        {campo('Nombre del predio', predio, setPredio)}

        <Text style={styles.sectionLabel}>Actividades entregadas</Text>
        {actividades.map((a, i) => (
          <View key={i} style={styles.actividadCard}>
            <View style={styles.actividadHeader}>
              <Text style={styles.actividadTitulo}>Ítem {i + 1}</Text>
              {actividades.length > 1 && (
                <TouchableOpacity onPress={() => quitarActividad(i)}>
                  <Text style={styles.quitar}>Quitar</Text>
                </TouchableOpacity>
              )}
            </View>
            {campo('Descripción', a.descripcion, (v) => cambiarActividad(i, 'descripcion', v))}
            {campo('Actividad proyecto', a.actividad, (v) => cambiarActividad(i, 'actividad', v), { keyboardType: 'numeric' })}
            {campo('Cantidad', a.cantidad, (v) => cambiarActividad(i, 'cantidad', v), { keyboardType: 'decimal-pad' })}
            {campo('Unidad de medida', a.unidad, (v) => cambiarActividad(i, 'unidad', v))}
          </View>
        ))}
        <TouchableOpacity style={styles.agregarBtn} onPress={agregarActividad}>
          <Text style={styles.agregarBtnText}>＋ Agregar actividad</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Por el Contratista</Text>
        {campo('Nombre', contratistaNombre, setContratistaNombre)}
        {campo('Cargo', contratistaCargo, setContratistaCargo)}

        <Text style={styles.sectionLabel}>Por la Interventoría (opcional)</Text>
        {campo('Nombre', interventoriaNombre, setInterventoriaNombre)}
        {campo('Cargo', interventoriaCargo, setInterventoriaCargo)}

        <Text style={styles.sectionLabel}>Firmas</Text>
        {botonFirma('beneficiario', firmaBeneficiario, '✍️ Firmar — Beneficiario', '✓ Firma del Beneficiario registrada')}
        {botonFirma('tecnico', firmaTecnico, '🖊️ Firmar — Contratista (Técnico)', '✓ Firma del Contratista registrada')}
        {botonFirma('interventoria', firmaInterventoria, '🖊️ Firmar — Interventoría (opcional)', '✓ Firma de la Interventoría registrada')}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <BotonGuardarBorrador onPress={guardar} guardando={guardando} />
        <TouchableOpacity
          style={[styles.completarBtn, completando && styles.generarBtnDisabled]}
          onPress={handleCompletar}
          disabled={completando || generando}
          activeOpacity={0.8}
        >
          {completando ? <ActivityIndicator color="#fff" /> : <Text style={styles.generarBtnText}>✅ Completar acta</Text>}
        </TouchableOpacity>
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
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  chipActivo: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, fontWeight: FONTS.weights.medium },
  chipTextActivo: { color: '#fff' },
  actividadCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.secondary,
    ...SHADOWS.sm,
  },
  actividadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  actividadTitulo: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  quitar: { fontSize: FONTS.sizes.xs, color: COLORS.error, fontWeight: FONTS.weights.bold },
  agregarBtn: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  agregarBtnText: { color: COLORS.primary, fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.sm },
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
  completarBtn: {
    backgroundColor: COLORS.success,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  generarBtnDisabled: { opacity: 0.6 },
  generarBtnText: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
  padHeader: { padding: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  padTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  padCancelar: { padding: SPACING.md, alignItems: 'center' },
  padCancelarText: { color: COLORS.textSecondary, fontSize: FONTS.sizes.sm },
});

export default ActaEntregaIndividualScreen;
