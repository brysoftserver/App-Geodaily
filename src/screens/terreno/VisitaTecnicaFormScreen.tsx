// ============================================================
// GEODAILY — Formulario de Visita Técnica (formato v2)
// ============================================================
// Reemplaza el "boseto" del formulario de visita técnica anterior.
// Tabla ITEM / ACTIVIDAD / DESCRIPCIÓN con 10 ítems:
//   1. No identificación (desplegable con los datos)
//   2. Objetivo de la visita
//   3. Descripción de la visita
//   4. Georreferenciación del polígono del cultivo
//   5. Seguimiento a compromisos
//   6. Valoración del cumplimiento (%)
//   7. Recomendaciones
//   8. Compromisos para la próxima visita (checklist)
//   9. Registro fotográfico (beneficiario, técnico y terreno)
//  10. Observaciones de la visita
//
// Los datos estructurados se guardan DENTRO de `actividad` (columna
// `actividad_json` del backend) para no cambiar el esquema del servidor:
//   - `visita_datos` = estado completo del formulario (para reeditar
//     borradores sin ambigüedad).
//   - Campos legibles (`descripcion`, `observaciones`, `recomendaciones`,
//     `objetivo`, …) para el Detalle del Formulario y el PDF.
//
// Evidencias: las fotos/firmas NO se suben desde aquí. Se encolan en
// SQLite (`saveFotoLocal`) y las sube SyncContext — igual que la Encuesta
// Social AgroAmbiental. Subirlas aquí generaba duplicados en MinIO.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Switch,
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useForm } from '../../store/FormContext';
import { useSync } from '../../store/SyncContext';
import { ActividadRealizada, DatosBeneficiario, MedicionAdjunta, PuntoPoligono } from '../../types';
import DropdownPicker from '../../components/DropdownPicker';
import CapturaGPSPrecisa from '../../components/CapturaGPSPrecisa';
import MedicionCaptura from '../../components/MedicionCaptura';
import SelectorBeneficiarioModal from '../../components/SelectorBeneficiarioModal';
import {
  guardarBorrador,
  getBorrador,
  eliminarBorrador,
  obtenerUltimoErrorBorrador,
  FormDraft,
} from '../../store/FormDraftStore';
import {
  saveFormularioLocal,
  getFormularioById,
  getDb,
  getMediciones,
  saveFotoLocal,
  saveVideoLocal,
  vincularDocumentosHuerfanos,
} from '../../services/database';
import {
  COMPROMISOS_VISITA_DEFAULT,
  DESCRIPCION_ITEM,
  OBJETIVO_VISITA_DEFAULT,
  getVisitaTecnica,
  resolverBeneficiarioVisita,
  tieneDatosBeneficiario,
} from '../../utils/visitaTecnica';
import { construirLlave, llaveCorrespondeACedula } from '../../utils/llaveVisita';
import { formatFechaHoraColombia } from '../../utils/formatters';
import { descargarHistorialMediciones } from '../../services/mediciones.service';
import {
  filtrarParaBeneficiario,
  MAX_POLIGONOS_VISITA,
  medicionesDeObjeto,
  medicionesDeVisita,
  sumaHectareas,
} from '../../utils/medicionesVisita';
import {
  avisarSinCedula,
  avisarVisitaYaRegistrada,
  buscarVisitaYaCompletada,
  resolverEntradaVisita,
} from '../../services/entradaVisita';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: RouteProp<
    Record<string, any> & { params: { visitaNumero?: number; draftId?: string; beneficiario?: DatosBeneficiario } },
    'params'
  >;
};

/** Fila del checklist del ítem 8. */
interface CompromisoRow {
  id: string;
  texto: string;
  activo: boolean;
}

/** Estado completo del formulario de visita técnica. */
interface VisitaFormState {
  no_identificacion: string;
  objetivo: string;
  descripcion_visita: string;
  // Ítem 4 — georreferenciación
  latitud: string;
  longitud: string;
  altitud: string;
  precision: string;
  area_intervencion: string;
  /**
   * Mediciones del historial elegidas para esta visita (ítem 4). Pueden ser
   * varias: un predio con dos o más lotes separados.
   */
  mediciones_historial: MedicionAdjunta[];
  // Ítems 5–7
  seguimiento_compromisos: string;
  valoracion_cumplimiento: string;
  recomendaciones: string;
  // Ítem 8
  compromisos: CompromisoRow[];
  /** Ítem 8: el técnico marca que NO hay compromisos para la próxima visita. */
  sin_compromisos: boolean;
  // Ítem 10
  observaciones: string;
}

let compromisoSeq = 0;
const nuevoCompromiso = (texto = '', activo = true): CompromisoRow => ({
  id: `c${++compromisoSeq}-${Date.now()}`,
  texto,
  activo,
});

/**
 * Sanea el texto del área de intervención (hectáreas).
 * - Solo dígitos y UN separador decimal (`.` o `,`).
 * - Máximo 2 decimales.
 * - Evita valores como "1,5,3", "..", "1.2.3".
 * Devuelve el texto listo para mostrar/guardar.
 */
const sanearArea = (raw: string): string => {
  // Normaliza comas a punto y descarta todo lo que no sea dígito o punto.
  const limpio = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const [entero, ...resto] = limpio.split('.');
  if (resto.length === 0) return entero;
  // Conserva solo el primer punto y hasta 2 decimales.
  return `${entero}.${resto.join('').slice(0, 2)}`;
};

/**
 * Al cambiar la lista de mediciones del ítem 4:
 *  · el área del cultivo pasa a ser la SUMA de las áreas, salvo que el técnico
 *    haya escrito otra cifra (si el campo está vacío o coincide con la suma
 *    anterior, se considera automático y se actualiza);
 *  · lat/lon se completan con el centro de la primera medición si faltan.
 */
const camposDerivadosDeMediciones = (
  prev: VisitaFormState,
  lista: MedicionAdjunta[]
): Pick<VisitaFormState, 'mediciones_historial' | 'area_intervencion' | 'latitud' | 'longitud'> => {
  const areaPrev = prev.area_intervencion.trim();
  const sumaPrev = sumaHectareas(prev.mediciones_historial);
  const esAutomatica = !areaPrev || Math.abs(Number(areaPrev) - sumaPrev) < 0.005;
  const suma = sumaHectareas(lista);
  const area = esAutomatica ? (suma > 0 ? sanearArea(suma.toFixed(2)) : '') : prev.area_intervencion;

  let { latitud, longitud } = prev;
  const primera = lista[0];
  if ((!latitud || !longitud) && primera && primera.puntos.length > 0) {
    const n = primera.puntos.length;
    latitud = latitud || (primera.puntos.reduce((a, p) => a + p.latitud, 0) / n).toFixed(6);
    longitud = longitud || (primera.puntos.reduce((a, p) => a + p.longitud, 0) / n).toFixed(6);
  }
  return { mediciones_historial: lista, area_intervencion: area, latitud, longitud };
};

/**
 * Sanea el texto de la valoración del cumplimiento (%).
 * - Solo dígitos, máximo 3.
 * - Rechaza valores > 100.
 * - Normaliza ceros a la izquierda ("000" → "0", "007" → "7") para que no
 *   se muestre "000%" ni se confunda con un valor vacío.
 * Devuelve `null` si el valor debe rechazarse (no se actualiza el estado).
 */
const sanearValoracion = (raw: string): string | null => {
  const limpio = raw.replace(/[^0-9]/g, '').slice(0, 3);
  if (limpio === '') return '';
  const n = Number(limpio);
  if (n > 100) return null;
  return String(n);
};

/** Construye el estado inicial del formulario. */
const crearEstadoInicial = (): VisitaFormState => ({
  no_identificacion: '',
  objetivo: OBJETIVO_VISITA_DEFAULT,
  descripcion_visita: '',
  latitud: '',
  longitud: '',
  altitud: '',
  precision: '',
  area_intervencion: '',
  mediciones_historial: [],
  seguimiento_compromisos: '',
  valoracion_cumplimiento: '',
  recomendaciones: '',
  compromisos: COMPROMISOS_VISITA_DEFAULT.map((t) => nuevoCompromiso(t, false)),
  sin_compromisos: false,
  observaciones: '',
});

/**
 * Reconstruye el estado desde `actividad.visita_datos`.
 * Si el borrador es de una versión anterior (sin `visita_datos`), se
 * recupera lo que se pueda de los campos legibles, sin reventar.
 */
const hidratarEstado = (actividad: ActividadRealizada | undefined, numeroVisita: number): VisitaFormState => {
  const base = crearEstadoInicial();
  if (!actividad) return base;

  const guardado = actividad.visita_datos as unknown as Partial<VisitaFormState> | undefined;
  if (guardado && typeof guardado === 'object') {
    const compromisos = Array.isArray(guardado.compromisos) && guardado.compromisos.length > 0
      ? guardado.compromisos
          .filter((c) => c && typeof c.texto === 'string')
          .map((c) => nuevoCompromiso(c.texto, !!c.activo))
      : base.compromisos;
    // Formatos anteriores guardaban una sola medición (`medicion_historial`)
    // y el admin podía cargar una segunda: se unifican en la lista.
    const { medicion_historial: _m1, medicion_historial_2: _m2, ...resto } =
      guardado as Partial<VisitaFormState> & { medicion_historial?: unknown; medicion_historial_2?: unknown };
    const deGuardado = medicionesDeObjeto(guardado as unknown as Record<string, unknown>);
    return {
      ...base,
      ...resto,
      mediciones_historial: deGuardado.length > 0 ? deGuardado : medicionesDeVisita(actividad),
      compromisos,
    };
  }

  // Fallback: borrador v2 guardado solo con los campos legibles.
  // La `descripcion` es el texto de la visita, pero si quedó el valor por
  // defecto (`Visita Técnica N`) no sirve como contenido editable.
  //
  // LIMITACIÓN CONOCIDA: los borradores v2 antiguos (sin `visita_datos`) no
  // guardaban altitud ni precisión GPS en ningún campo legible, por lo que
  // esos dos valores no se pueden recuperar aquí. Los borradores nuevos sí
  // los conservan porque `visita_datos` guarda el estado completo.
  const descripcion = actividad.descripcion && actividad.descripcion !== `Visita Técnica ${numeroVisita}`
    ? actividad.descripcion
    : '';
  const activos = new Set(actividad.compromisos_siguiente_visita || []);
  const extras = (actividad.compromisos_siguiente_visita || []).filter(
    (t) => !COMPROMISOS_VISITA_DEFAULT.includes(t)
  );
  return {
    ...base,
    no_identificacion: actividad.no_identificacion || base.no_identificacion,
    // Objetivo fijo de la Visita 2: aunque el borrador traiga otro texto
    // (versiones anteriores lo dejaban editar), se usa el oficial.
    objetivo: OBJETIVO_VISITA_DEFAULT,
    descripcion_visita: descripcion,
    seguimiento_compromisos: actividad.seguimiento_compromisos || '',
    valoracion_cumplimiento: actividad.valoracion_cumplimiento || '',
    recomendaciones: actividad.recomendaciones || '',
    observaciones: actividad.observaciones || '',
    area_intervencion: actividad.area_intervencion || '',
    mediciones_historial: medicionesDeVisita(actividad),
    latitud: actividad.poligono?.[0]?.latitud != null ? String(actividad.poligono[0].latitud) : '',
    longitud: actividad.poligono?.[0]?.longitud != null ? String(actividad.poligono[0].longitud) : '',
    compromisos: [
      ...COMPROMISOS_VISITA_DEFAULT.map((t) => nuevoCompromiso(t, activos.has(t))),
      ...extras.map((t) => nuevoCompromiso(t, true)),
    ],
    sin_compromisos: (actividad.compromisos_siguiente_visita || []).length === 0,
  };
};

// ─── Tarjeta de ítem (ITEM / ACTIVIDAD / DESCRIPCIÓN) ────────
const ItemCard: React.FC<{
  numero: number;
  titulo: string;
  ayuda?: string;
  completo?: boolean;
  children: React.ReactNode;
}> = ({ numero, titulo, ayuda, completo, children }) => (
  <View style={styles.itemCard}>
    <View style={styles.itemHeader}>
      <View style={styles.itemBadge}>
        <Text style={styles.itemBadgeText}>{numero}</Text>
      </View>
      <View style={styles.itemHeaderText}>
        <Text style={styles.itemTitulo}>{titulo}</Text>
        {!!ayuda && <Text style={styles.itemAyuda}>{ayuda}</Text>}
      </View>
      {completo && <Text style={styles.itemCheck}>✅</Text>}
    </View>
    <View style={styles.itemBody}>{children}</View>
  </View>
);

const VisitaTecnicaFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const { user } = useAuth();
  const {
    iniciarFormulario,
    setTecnico,
    setBeneficiario,
    setActividad,
    setCoordenadas,
    addFoto,
    setFirmaBeneficiario,
    setFirmaTecnico,
    setHuella,
    finalizarFormulario,
    formularioActual,
  } = useForm();
  const { syncNow } = useSync();
  const insets = useSafeAreaInsets();

  const draftId = route.params?.draftId;
  const beneficiarioParam = route.params?.beneficiario;
  const visitaNumero = route.params?.visitaNumero ?? getVisitaTecnica()?.numero ?? 2;
  const visitaDef = getVisitaTecnica(visitaNumero);

  // ─── Estado ───────────────────────────────────────────────
  const [data, setData] = useState<VisitaFormState>(() => crearEstadoInicial());
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formIdRef = useRef<string>(draftId || `visita-${Date.now()}`);
  const completadoRef = useRef(false);
  /** Llave inmutable de la visita (técnico|cédula|vN). Se fija una vez al abrir. */
  const llaveRef = useRef<string | null>(null);
  const inicializadoRef = useRef(false);
  /**
   * false hasta que terminó la carga inicial. Sin esto, el autoguardado con
   * debounce podía dispararse ANTES de que el borrador terminara de cargar y
   * escribir el beneficiario que venía por parámetros/contexto encima del
   * beneficiario real del borrador.
   */
  const borradorListoRef = useRef(false);
  const autoguardarRef = useRef<(() => void) | null>(null);
  const autoguardadoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref con la versión más reciente del formulario en curso (fotos/firmas)
  const formularioRef = useRef(formularioActual);
  useEffect(() => {
    formularioRef.current = formularioActual;
  }, [formularioActual]);

  const totalFotosCtx = formularioActual?.fotos?.length ?? 0;

  /**
   * Beneficiario guardado en el borrador que se está retomando. Cuando se
   * llega con `draftId` ("Formularios Incompletos") ESTE es el que manda:
   * antes ganaba el parámetro de navegación y el contexto, así que el
   * borrador de un beneficiario se completaba a nombre de otro.
   */
  const [beneficiarioBorrador, setBeneficiarioBorrador] = useState<DatosBeneficiario | undefined>(
    undefined
  );

  /**
   * «Cambiar beneficiario» (caso excepcional): las fotos/videos/respuestas se
   * tomaron dentro de un beneficiario que YA tiene esta visita. El técnico
   * elige otro y este manda sobre todos los demás. `requiereCambioBenef`
   * queda en true mientras el formulario siga con el beneficiario bloqueado.
   */
  const [beneficiarioElegido, setBeneficiarioElegido] = useState<DatosBeneficiario | undefined>(undefined);
  const [mostrarSelectorBenef, setMostrarSelectorBenef] = useState(false);
  const [requiereCambioBenef, setRequiereCambioBenef] = useState(false);
  const cambioBenefPorGuardarRef = useRef(false);
  /** Número de visita real (el del borrador si se retoma uno). */
  const numeroVisitaRef = useRef(visitaNumero);

  // El beneficiario puede venir del detalle (params), de lo ya precargado en
  // el contexto por `SeleccionarVisitaTecnica`, o del borrador que se retoma
  // (que `aplicarBorrador` deja en el contexto). Se resuelve por prioridad y
  // descartando objetos vacíos: antes bastaba con que llegara un objeto sin
  // nombre ni cédula para que el ítem 1 se diera por no diligenciado.
  const beneficiario = beneficiarioElegido
    ? beneficiarioElegido
    : draftId
    ? resolverBeneficiarioVisita(
        beneficiarioBorrador,
        beneficiarioParam,
        formularioActual?.beneficiario
      )
    // Formulario NUEVO: solo el beneficiario elegido en la navegación. El del
    // contexto global puede ser el de un formulario anterior (otro beneficiario).
    : resolverBeneficiarioVisita(beneficiarioParam);

  // ─── Identificación (ítem 1: "desplegable con los datos") ─
  // El ítem pide un desplegable con los datos del beneficiario. Antes solo
  // se ofrecía UNA opción (nombre — C.C.) y, si el beneficiario llegaba sin
  // nombre ni cédula, el desplegable desaparecía y caía a texto libre. Ahora
  // se ofrecen todas las variantes útiles (nombre, cédula y combinación) para
  // que el técnico elija sin escribir, y se conserva el texto libre como
  // último recurso cuando no hay ningún dato.
  const nombreBenef = beneficiario?.nombre;
  const cedulaBenef = beneficiario?.cedula;
  const opcionesIdentificacion = React.useMemo(() => {
    const opciones: string[] = [];
    if (nombreBenef && cedulaBenef) opciones.push(`${nombreBenef} — C.C. ${cedulaBenef}`);
    if (nombreBenef) opciones.push(nombreBenef);
    if (cedulaBenef) opciones.push(`C.C. ${cedulaBenef}`);
    return Array.from(new Set(opciones));
  }, [nombreBenef, cedulaBenef]);

  const fotos = formularioActual?.fotos || [];
  const fotosSolo = fotos.filter((f) => f.tipo !== 'video');
  const videosSolo = fotos.filter((f) => f.tipo === 'video');
  const firmaBeneficiarioOk = !!formularioActual?.firma_beneficiario;
  const firmaTecnicoOk = !!formularioActual?.firma_tecnico;
  const huellaOk = !!formularioActual?.huella_beneficiario;

  const set = useCallback(<K extends keyof VisitaFormState>(key: K, value: VisitaFormState[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ─── Ítem 4: medición del historial ───────────────────────
  // El técnico puede reutilizar un área ya medida y guardada en el mapa en
  // vez de volver a trazarla. Se guarda completa (nombre + puntos + área)
  // para que el coordinador/interventor vea la captura en el detalle.
  const [mostrarSelectorMediciones, setMostrarSelectorMediciones] = useState(false);
  const [medicionesHistorial, setMedicionesHistorial] = useState<Record<string, unknown>[]>([]);
  const [cargandoMediciones, setCargandoMediciones] = useState(false);

  const abrirSelectorMediciones = useCallback(async () => {
    setMostrarSelectorMediciones(true);
    setCargandoMediciones(true);
    try {
      // Trae también las mediciones guardadas en el servidor (hechas desde
      // otro teléfono). Sin conexión sigue con lo local.
      await descargarHistorialMediciones(8000);
      const todas = await getMediciones();
      const propias = user?.id ? todas.filter((m) => !m.usuario_id || m.usuario_id === user.id) : todas;
      // Sin coordenadas no se puede dibujar la captura ni abrir en Earth.
      const conPuntos = propias.filter((m) => Array.isArray(m.puntos) && (m.puntos as unknown[]).length > 0);
      // Solo las de ESTE beneficiario: con su cédula o, si la medición no
      // tiene cédula (antiguas), las que quedan cerca del punto de la visita.
      const lat = Number(data.latitud);
      const lon = Number(data.longitud);
      const primera = data.mediciones_historial[0]?.puntos || [];
      const punto =
        data.latitud && data.longitud && Number.isFinite(lat) && Number.isFinite(lon)
          ? { latitud: lat, longitud: lon }
          : primera.length > 0
          ? {
              latitud: primera.reduce((a, p) => a + p.latitud, 0) / primera.length,
              longitud: primera.reduce((a, p) => a + p.longitud, 0) / primera.length,
            }
          : null;
      setMedicionesHistorial(filtrarParaBeneficiario(conPuntos, { cedula: beneficiario?.cedula, punto }));
    } catch (error) {
      console.warn('[VisitaTecnica] No se pudo leer el historial de mediciones:', error);
      setMedicionesHistorial([]);
    } finally {
      setCargandoMediciones(false);
    }
  }, [user?.id, beneficiario?.cedula, data.latitud, data.longitud, data.mediciones_historial]);

  /**
   * Marca o desmarca una medición del historial. Se pueden adjuntar varias
   * (lotes separados del mismo predio); el área del cultivo se prellena con
   * la SUMA mientras el técnico no la haya escrito a mano.
   */
  const alternarMedicionHistorial = useCallback((cruda: Record<string, unknown>) => {
    const id = String(cruda.id ?? '');
    setData((prev) => {
      const yaEsta = prev.mediciones_historial.some((m) => m.id === id);
      let lista: MedicionAdjunta[];
      if (yaEsta) {
        lista = prev.mediciones_historial.filter((m) => m.id !== id);
      } else {
        if (prev.mediciones_historial.length >= MAX_POLIGONOS_VISITA) return prev;
        const puntos = ((cruda.puntos || []) as { latitud: number; longitud: number }[])
          .map((p) => ({ latitud: Number(p.latitud), longitud: Number(p.longitud) }))
          .filter((p) => Number.isFinite(p.latitud) && Number.isFinite(p.longitud));
        if (puntos.length === 0) return prev;
        lista = [
          ...prev.mediciones_historial,
          {
            id,
            nombre: String(cruda.nombre || 'Medición de terreno'),
            area_hectareas: Number(cruda.area_hectareas) || 0,
            area_metros2: Number(cruda.area_metros2) || 0,
            perimetro_metros: Number(cruda.perimetro_metros) || 0,
            puntos,
            created_at: typeof cruda.created_at === 'string' ? cruda.created_at : undefined,
          },
        ];
      }
      return { ...prev, ...camposDerivadosDeMediciones(prev, lista) };
    });
  }, []);

  const quitarMedicionHistorial = useCallback((id: string) => {
    setData((prev) => ({
      ...prev,
      ...camposDerivadosDeMediciones(prev, prev.mediciones_historial.filter((m) => m.id !== id)),
    }));
  }, []);

  // ─── Restaurar / iniciar ──────────────────────────────────
  useEffect(() => {
    if (inicializadoRef.current) return;
    // Formulario nuevo: la llave necesita el id del técnico, así que se espera a la sesión.
    if (!draftId && !user?.id) return;
    inicializadoRef.current = true;

    // El id del borrador se fija ANTES de restaurar evidencias: si se hiciera
    // al final, el reducer recrearía el formulario y borraría las fotos y
    // firmas recién restauradas (mismo motivo que en la encuesta).
    iniciarFormulario('visita_tecnica', draftId);
    // `iniciarFormulario` conserva el beneficiario que hubiera en el contexto (puede ser el
    // de otro formulario): se fija explícitamente el elegido en la navegación.
    if (!draftId && beneficiarioParam) setBeneficiario(beneficiarioParam);

    const aplicarBorrador = (draft: FormDraft) => {
      formIdRef.current = draft.id;
      iniciarFormulario('visita_tecnica', draft.id);
      // Restaurar el beneficiario del borrador. `iniciarFormulario` solo
      // conserva el que ya estuviera en el contexto; al reabrir un borrador
      // desde "Formularios Incompletos" no llega ningún parámetro y el
      // contexto suele estar vacío (la app se cerró, o el técnico venía de
      // otro beneficiario), así que el ítem 1 quedaba sin diligenciar y al
      // completar aparecía "Beneficiario (ítem 1)" aunque el dato sí estaba
      // guardado en el borrador.
      //
      // ⚠️ El borrador es la fuente autoritativa: se refleja en el estado
      // local (`beneficiarioBorrador`, que `beneficiario` resuelve PRIMERO)
      // y en el contexto. Si el borrador no trae beneficiario, se LIMPIA el
      // del contexto para no arrastrar el de un formulario anterior — antes
      // ese arrastre hacía que la visita quedara a nombre de otro productor.
      if (tieneDatosBeneficiario(draft.beneficiario)) {
        setBeneficiarioBorrador(draft.beneficiario);
        setBeneficiario(draft.beneficiario);
      } else {
        setBeneficiarioBorrador(undefined);
        setBeneficiario({
          nombre: '',
          cedula: '',
          telefono: '',
          departamento: '',
          municipio: '',
          vereda: '',
          finca: '',
        });
      }
      setData(hidratarEstado(draft.actividad, draft.actividad?.visita_numero ?? visitaNumero));
      if (draft.fotos?.length) {
        for (const foto of draft.fotos) addFoto(foto);
      }
      if (draft.firma_beneficiario) setFirmaBeneficiario(draft.firma_beneficiario);
      if (draft.firma_tecnico) setFirmaTecnico(draft.firma_tecnico);
      if (draft.huella_beneficiario) setHuella(true);
      if (draft.coordenadas) setCoordenadas(draft.coordenadas);
    };

    const init = async () => {
      if (draftId) {
        // Borrador retomado por su id (Formularios Incompletos).
        const draft = await getBorrador(draftId).catch(() => null);
        if (draft) {
          const numeroDraft = draft.actividad?.visita_numero ?? visitaNumero;
          numeroVisitaRef.current = numeroDraft;
          const yaExiste = await buscarVisitaYaCompletada(draft.beneficiario?.cedula, numeroDraft);
          if (yaExiste) {
            avisarVisitaYaRegistrada(navigation, yaExiste, `La Visita Técnica ${numeroDraft}`, () => {
              // Se carga el borrador (fotos, videos, respuestas) para no perder
              // nada, pero sin autoguardado hasta que el técnico elija el
              // beneficiario correcto (la llave sigue siendo la del borrador).
              llaveRef.current = draft.llave || construirLlave(user?.id, draft.beneficiario?.cedula, numeroDraft);
              aplicarBorrador(draft);
              setRequiereCambioBenef(true);
              setMostrarSelectorBenef(true);
            });
            return;
          }
          llaveRef.current = draft.llave || construirLlave(user?.id, draft.beneficiario?.cedula, numeroDraft);
          aplicarBorrador(draft);
        } else {
          // El borrador ya no existe: seguir con un formulario nuevo.
          formIdRef.current = draftId;
          iniciarFormulario('visita_tecnica', draftId);
        }
      } else {
        // Entrada desde el beneficiario: una sola visita por beneficiario y formulario.
        const decision = await resolverEntradaVisita({
          usuarioId: user?.id,
          cedula: beneficiarioParam?.cedula,
          numeroVisita: visitaNumero,
        });
        if (decision.estado === 'sin_datos') {
          avisarSinCedula(navigation);
          return;
        }
        if (decision.estado === 'bloqueada') {
          avisarVisitaYaRegistrada(navigation, decision.formulario, `La Visita Técnica ${visitaNumero}`, () => {
            setRequiereCambioBenef(true);
            setMostrarSelectorBenef(true);
          });
          return;
        }
        llaveRef.current = decision.llave;
        // Solo se reanuda un borrador con EXACTAMENTE la misma llave (igualdad de texto).
        if (decision.borrador && decision.borrador.llave === decision.llave) {
          aplicarBorrador(decision.borrador);
        }
      }

      // Formulario NUEVO (sin `draftId`): no se busca ni se ofrece ningún
      // borrador. Los incompletos viven en "Formularios Incompletos" y el
      // técnico los retoma desde allí eligiéndolos explícitamente. Ofrecerlos
      // aquí era lo que cargaba el borrador de un beneficiario dentro del
      // formulario de otro.
      //
      // Se habilita el autoguardado solo cuando la carga inicial terminó (si
      // venía un borrador, ya está aplicado): así el debounce de 1.5 s no
      // puede guardar el formulario con el beneficiario equivocado.
      borradorListoRef.current = true;
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Mantener el ref sincronizado con el id real del contexto
  useEffect(() => {
    if (formularioActual?.id) formIdRef.current = formularioActual.id;
  }, [formularioActual?.id]);

  // Autoseleccionar la identificación cuando ya se conocen los datos.
  // Se toma la primera opción (la más completa: "Nombre — C.C. X") solo si
  // el técnico aún no ha elegido nada, para no pisar su selección.
  useEffect(() => {
    if (!data.no_identificacion && opcionesIdentificacion.length > 0) {
      set('no_identificacion', opcionesIdentificacion[0]);
    }
  }, [opcionesIdentificacion, data.no_identificacion, set]);

  // ─── Construcción de `actividad` ──────────────────────────
  const construirActividad = useCallback((): ActividadRealizada => {
    const lat = Number(data.latitud);
    const lon = Number(data.longitud);
    const poligono: PuntoPoligono[] | undefined =
      data.latitud && data.longitud && !Number.isNaN(lat) && !Number.isNaN(lon)
        ? [{ latitud: lat, longitud: lon, orden: 0 }]
        : undefined;

    const compromisosActivos = data.sin_compromisos
      ? []
      : data.compromisos.filter((c) => c.activo && c.texto.trim()).map((c) => c.texto.trim());

    return {
      descripcion: data.descripcion_visita.trim() || `Visita Técnica ${visitaNumero}`,
      descripcion_detallada: data.seguimiento_compromisos.trim() || undefined,
      observaciones: data.observaciones.trim(),
      recomendaciones: data.recomendaciones.trim(),
      visita_numero: visitaNumero,
      formato_visita: 'v2',
      no_identificacion: data.no_identificacion,
      objetivo: OBJETIVO_VISITA_DEFAULT,
      seguimiento_compromisos: data.seguimiento_compromisos.trim(),
      valoracion_cumplimiento: data.valoracion_cumplimiento,
      compromisos_siguiente_visita: compromisosActivos,
      area_intervencion: sanearArea(data.area_intervencion) || undefined,
      mediciones_historial: data.mediciones_historial.length > 0 ? data.mediciones_historial : undefined,
      // Compatibilidad: las versiones anteriores de la app leen un solo polígono.
      medicion_historial: data.mediciones_historial[0] || undefined,
      poligono,
      visita_datos: {
        ...data,
        objetivo: OBJETIVO_VISITA_DEFAULT,
        medicion_historial: data.mediciones_historial[0] || undefined,
      } as unknown as Record<string, unknown>,
    };
  }, [data, visitaNumero]);

  const construirCoordenadas = useCallback(() => {
    const lat = Number(data.latitud);
    const lon = Number(data.longitud);
    if (!data.latitud || !data.longitud || Number.isNaN(lat) || Number.isNaN(lon)) return undefined;
    return {
      latitud: lat,
      longitud: lon,
      altitud: data.altitud ? Number(data.altitud) : undefined,
      precision_gps: data.precision ? Number(data.precision) : undefined,
    };
  }, [data.latitud, data.longitud, data.altitud, data.precision]);

  const construirTecnico = useCallback(
    () => ({
      usuario_id: user?.id || '',
      nombre: user?.nombre || '',
      cedula: user?.cedula || '',
      telefono: user?.telefono || '',
      email: user?.email || '',
    }),
    [user]
  );

  const construirBeneficiario = useCallback(() => {
    const b = beneficiario;
    return {
      nombre: b?.nombre || '',
      cedula: b?.cedula || '',
      telefono: b?.telefono || '',
      departamento: b?.departamento || 'Caquetá',
      municipio: b?.municipio || '',
      vereda: b?.vereda || '',
      finca: b?.finca || '',
      corregimiento: b?.corregimiento,
      edad: b?.edad,
      sexo: b?.sexo,
    } as DatosBeneficiario;
  }, [beneficiario]);

  // ─── Guardar borrador (común) ─────────────────────────────
  const armarBorrador = useCallback(
    (id: string): FormDraft => {
      const currentForm = formularioRef.current || formularioActual;
      return {
        id,
        tipo: 'visita_tecnica',
        llave: llaveRef.current || undefined,
        step: 0,
        tecnico: construirTecnico(),
        beneficiario: construirBeneficiario(),
        actividad: construirActividad(),
        coordenadas: construirCoordenadas(),
        fotos: currentForm?.fotos || [],
        firma_beneficiario: currentForm?.firma_beneficiario || '',
        firma_tecnico: currentForm?.firma_tecnico || '',
        huella_beneficiario: currentForm?.huella_beneficiario || false,
        selectedDepartamento: 'Caquetá',
        selectedActividad: '',
        otraActividadText: '',
        descripcionDetallada: '',
        updated_at: new Date().toISOString(),
      };
    },
    [construirActividad, construirBeneficiario, construirCoordenadas, construirTecnico, formularioActual]
  );

  /** ¿Hay algo que valga la pena guardar? (evita borradores vacíos) */
  const hayContenido = useCallback(() => {
    const currentForm = formularioRef.current || formularioActual;
    return !!(
      data.descripcion_visita.trim() ||
      data.seguimiento_compromisos.trim() ||
      data.recomendaciones.trim() ||
      data.observaciones.trim() ||
      data.latitud ||
      data.valoracion_cumplimiento ||
      // `no_identificacion` se autoselecciona al abrir: no cuenta como contenido del técnico
      // (si contara, abrir y salir ya crearía un borrador).
      data.area_intervencion.trim() ||
      data.mediciones_historial.length > 0 ||
      data.sin_compromisos ||
      data.compromisos.some((c) => c.activo && c.texto.trim()) ||
      (currentForm?.fotos?.length || 0) > 0
    );
  }, [data, formularioActual]);

  /**
   * Encola las evidencias locales (fotos/videos) para que las suba
   * SyncContext. Es el ÚNICO camino de subida.
   */
  const encolarEvidencias = useCallback(
    async (formId: string) => {
      const currentForm = formularioRef.current || formularioActual;
      const beneficiarioActual = {
        cedula: beneficiario?.cedula,
        nombre: beneficiario?.nombre,
      };
      for (const evidencia of currentForm?.fotos || []) {
        if (evidencia.uri?.startsWith('http')) continue;
        if (evidencia.tipo === 'video') {
          await saveVideoLocal(evidencia.id, formId, evidencia.uri, evidencia.coordenadas, beneficiarioActual, 'visita_tecnica');
        } else {
          await saveFotoLocal(evidencia.id, formId, evidencia.uri, evidencia.coordenadas, beneficiarioActual, 'visita_tecnica');
        }
      }
    },
    [beneficiario?.cedula, beneficiario?.nombre, formularioActual]
  );

  // ─── Autoguardado ─────────────────────────────────────────
  useEffect(() => {
    autoguardarRef.current = async () => {
      try {
        if (completadoRef.current) return;
        // La carga inicial (borrador/precarga de beneficiario) aún no terminó:
        // guardar ahora escribiría el beneficiario equivocado en el borrador.
        if (!borradorListoRef.current) return;
        // Sin llave no se crea un borrador nuevo (solo se admite al retomar uno por id).
        if (!llaveRef.current && !draftId) return;
        // Cinturón de seguridad: la llave debe ser la del beneficiario en pantalla.
        if (llaveRef.current && !llaveCorrespondeACedula(llaveRef.current, beneficiario?.cedula)) {
          console.warn('[VisitaTecnica] La llave no coincide con el beneficiario; no se autoguarda');
          return;
        }
        const id = formIdRef.current || formularioActual?.id;
        if (!id) return;
        if (!hayContenido()) return;
        const ok = await guardarBorrador(armarBorrador(id));
        if (ok) {
          console.log('[VisitaTecnica] Autoguardado:', id);
        } else {
          console.warn('[VisitaTecnica] El borrador no quedó guardado:', id);
        }
      } catch (e) {
        console.warn('[VisitaTecnica] Autoguardado falló:', e);
      }
    };
  });

  // Red de seguridad: intervalo + salida de la app/pantalla
  useEffect(() => {
    const intervalo = setInterval(() => {
      autoguardarRef.current?.();
    }, 20000);

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background' || estado === 'inactive') {
        autoguardarRef.current?.();
      }
    });

    return () => {
      clearInterval(intervalo);
      sub.remove();
      autoguardarRef.current?.();
    };
  }, []);

  // Autoguardado reactivo (debounce 1.5 s sobre cada cambio)
  useEffect(() => {
    if (completadoRef.current) return;
    if (!borradorListoRef.current) return;
    if (!hayContenido()) return;

    if (autoguardadoDebounceRef.current) {
      clearTimeout(autoguardadoDebounceRef.current);
    }
    autoguardadoDebounceRef.current = setTimeout(() => {
      autoguardadoDebounceRef.current = null;
      autoguardarRef.current?.();
    }, 1500);

    return () => {
      if (autoguardadoDebounceRef.current) {
        clearTimeout(autoguardadoDebounceRef.current);
        autoguardadoDebounceRef.current = null;
      }
    };
  }, [data, totalFotosCtx, hayContenido]);

  // ─── Botón "Guardar borrador" ─────────────────────────────
  const guardarBorradorHandler = useCallback(async () => {
    if (llaveRef.current && !llaveCorrespondeACedula(llaveRef.current, beneficiario?.cedula)) {
      Alert.alert('No se pudo guardar', 'El borrador no corresponde al beneficiario en pantalla. Cierra y vuelve a abrir el formulario desde la ficha del beneficiario.');
      return;
    }
    setIsSaving(true);
    try {
      const id = formIdRef.current || formularioActual?.id || `visita-${Date.now()}`;
      const ok = await guardarBorrador(armarBorrador(id));
      if (!ok) {
        const detalle = obtenerUltimoErrorBorrador();
        Alert.alert(
          'No se pudo guardar',
          'El borrador no quedó guardado en este dispositivo.' +
            (detalle ? `\n\nDetalle: ${detalle}` : '') +
            '\n\nTus datos siguen en pantalla: no cierres la app e inténtalo de nuevo.'
        );
        return;
      }
      try {
        await encolarEvidencias(id);
      } catch (e) {
        console.warn('[VisitaTecnica] No se pudieron encolar todas las evidencias:', e);
      }
      Alert.alert('💾 Guardado', 'El borrador quedó guardado y lo encuentras en “Formularios Incompletos”.');
    } catch (err) {
      Alert.alert('Error', 'No se pudo guardar: ' + (err as Error)?.message);
    } finally {
      setIsSaving(false);
    }
  }, [armarBorrador, encolarEvidencias, formularioActual?.id, beneficiario?.cedula]);

  // ─── Cambiar beneficiario (caso excepcional) ───────────────
  const abrirSelectorBenef = useCallback(() => setMostrarSelectorBenef(true), []);

  const elegirNuevoBeneficiario = useCallback(
    async (nuevo: DatosBeneficiario) => {
      const numero = numeroVisitaRef.current;
      setMostrarSelectorBenef(false);
      // El mismo beneficiario, u otro que ya tenga esta visita: mismo aviso de siempre.
      const yaExiste = await buscarVisitaYaCompletada(nuevo.cedula, numero);
      if (yaExiste) {
        setTimeout(
          () => avisarVisitaYaRegistrada(navigation, yaExiste, `La Visita Técnica ${numero}`, abrirSelectorBenef),
          350
        );
        return;
      }
      const llave = construirLlave(user?.id, nuevo.cedula, numero);
      if (!llave) {
        Alert.alert('No se pudo cambiar', 'El beneficiario elegido no tiene cédula registrada o la sesión del técnico no está disponible.');
        return;
      }
      llaveRef.current = llave;
      cambioBenefPorGuardarRef.current = true;
      setBeneficiarioElegido(nuevo);
      setBeneficiario(nuevo);
      // Se vacía para que se autoseleccione la identificación del nuevo beneficiario.
      set('no_identificacion', '');
      setRequiereCambioBenef(false);
      borradorListoRef.current = true;
    },
    [navigation, abrirSelectorBenef, user?.id, setBeneficiario, set]
  );

  // Tras el cambio: guardar el borrador con el nuevo beneficiario y reasignar
  // las fotos/videos de la cola local a su cédula.
  useEffect(() => {
    if (!cambioBenefPorGuardarRef.current || !beneficiarioElegido) return;
    cambioBenefPorGuardarRef.current = false;
    autoguardarRef.current?.();
    const id = formIdRef.current || formularioActual?.id;
    if (id) {
      encolarEvidencias(id).catch((e) =>
        console.warn('[VisitaTecnica] No se pudieron reasignar evidencias al nuevo beneficiario:', e)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiarioElegido]);

  // ─── Validación ───────────────────────────────────────────
  const faltantes = React.useMemo(() => {
    const f: string[] = [];
    if (!beneficiario?.nombre) f.push('Beneficiario (ítem 1)');
    if (!data.no_identificacion.trim()) f.push('No. identificación (ítem 1)');
    if (!data.objetivo.trim()) f.push('Objetivo de la visita (ítem 2)');
    if (!data.descripcion_visita.trim()) f.push('Descripción de la visita (ítem 3)');
    if (!data.latitud || !data.longitud) f.push('Georreferenciación del polígono (ítem 4)');
    if (!data.seguimiento_compromisos.trim()) f.push('Seguimiento a compromisos (ítem 5)');
    if (!data.valoracion_cumplimiento.trim()) f.push('Valoración del cumplimiento (ítem 6)');
    if (!data.recomendaciones.trim()) f.push('Recomendaciones (ítem 7)');
    // Ítem 8: se exige al menos un compromiso activo O marcar "sin compromisos".
    if (!data.sin_compromisos && !data.compromisos.some((c) => c.activo && c.texto.trim())) {
      f.push('Compromisos para la próxima visita (ítem 8)');
    }
    if (fotos.length === 0) f.push('Registro fotográfico (ítem 9)');
    if (!data.observaciones.trim()) f.push('Observaciones de la visita (ítem 10)');
    return f;
  }, [beneficiario?.nombre, data, fotos.length]);

  // ─── Completar ────────────────────────────────────────────
  const handleCompletar = useCallback(async () => {
    if (isSubmitting) return;

    // Una sola visita por beneficiario: si el beneficiario en pantalla ya la
    // tiene (p. ej. el técnico no lo cambió), se bloquea con el mismo aviso.
    const yaExiste = await buscarVisitaYaCompletada(beneficiario?.cedula, numeroVisitaRef.current);
    if (yaExiste) {
      avisarVisitaYaRegistrada(navigation, yaExiste, `La Visita Técnica ${numeroVisitaRef.current}`, abrirSelectorBenef);
      return;
    }

    setIsSubmitting(true);

    try {
      const formId = formIdRef.current || `visita-${Date.now()}`;

      // 1. Asegurar evidencias en la cola local antes de nada.
      try {
        await encolarEvidencias(formId);
      } catch (queueError) {
        setIsSubmitting(false);
        Alert.alert(
          'No se pudieron asegurar las evidencias',
          'La visita sigue en el borrador local. Revisa el almacenamiento e inténtalo de nuevo.'
        );
        console.warn('[VisitaTecnica] No se pudo encolar evidencia al completar:', queueError);
        return;
      }

      const tecnico = construirTecnico();
      const beneficiarioDatos = construirBeneficiario();
      const actividad = construirActividad();
      const coordenadas = construirCoordenadas();

      // 2. Sincronizar el contexto (por si alguna pantalla lo consulta).
      setTecnico(tecnico);
      setBeneficiario(beneficiarioDatos);
      setActividad(actividad);
      if (coordenadas) setCoordenadas(coordenadas as any);

      // 3. Finalizar con los datos FRESCOS (los set* de arriba todavía no
      //    están en el estado del contexto — closure del render anterior).
      const form = finalizarFormulario({
        tipo: 'visita_tecnica',
        tecnico,
        beneficiario: beneficiarioDatos,
        actividad,
        coordenadas: coordenadas as any,
      });
      if (!form) {
        Alert.alert(
          'No se pudo finalizar',
          'Se perdió el formulario en curso. Tus datos siguen en el borrador: ciérralo y ábrelo de nuevo.'
        );
        setIsSubmitting(false);
        return;
      }

      // 4. Punto de no retorno: si el guardado local falla, se ABORTA y el
      //    borrador se conserva intacto.
      try {
        await saveFormularioLocal(form);
        const verificado = await getFormularioById(form.id);
        if (!verificado) throw new Error('El formulario no aparece en la base local tras guardarlo');
        completadoRef.current = true;
      } catch (errGuardado) {
        console.error('[VisitaTecnica] Error guardando el formulario:', errGuardado);
        setIsSubmitting(false);
        Alert.alert(
          'No se pudo guardar',
          'No fue posible guardar el formulario en este dispositivo. Tu borrador sigue intacto: ' +
            'ciérralo, vuelve a abrirlo e inténtalo de nuevo.'
        );
        return;
      }

      // 5. Reasignar evidencias y documentos al id real del formulario.
      try {
        const cedula = beneficiarioDatos.cedula?.trim() || undefined;
        const db = getDb();
        if (db) {
          const idsEvidencia = Array.from(
            new Set(
              [formularioActual?.id, formIdRef.current, '', 'sin-formulario'].filter(
                (id): id is string => !!id && id !== form.id
              )
            )
          );
          for (const idEvidencia of idsEvidencia) {
            await db.runAsync('UPDATE fotos_locales SET formulario_id = ? WHERE formulario_id = ?', [form.id, idEvidencia]);
            await db.runAsync('UPDATE videos_locales SET formulario_id = ? WHERE formulario_id = ?', [form.id, idEvidencia]);
            await db.runAsync(
              "UPDATE documentos_finca SET formulario_id = ?, beneficiario_cedula = COALESCE(NULLIF(beneficiario_cedula, ''), ?) WHERE formulario_id = ?",
              [form.id, cedula || null, idEvidencia]
            );
          }
        }
        await vincularDocumentosHuerfanos(form.id, cedula);
      } catch (e) {
        console.warn('[VisitaTecnica] No se pudieron actualizar documentos:', e);
      }

      // 6. Eliminar el borrador (todos los ids con los que pudo guardarse).
      try {
        const idsBorrador = Array.from(
          new Set([draftId, formIdRef.current, formularioActual?.id, form.id].filter((id): id is string => !!id))
        );
        for (const id of idsBorrador) {
          await eliminarBorrador(id);
        }
      } catch {
        // Ignorar
      }

      // 7. Sincronizar (best-effort: si no hay señal, la cola reintenta).
      syncNow().catch(() => {});

      setIsSubmitting(false);
      Alert.alert(
        '✅ Visita completada',
        `La ${visitaDef?.titulo || 'visita técnica'} quedó guardada correctamente.`,
        [{ text: 'Ver historial', onPress: () => navigation.navigate('TerrenoFormularioList') }],
        { cancelable: false }
      );
    } catch (err) {
      console.error('[VisitaTecnica] Error al completar:', err);
      setIsSubmitting(false);
      Alert.alert('Error inesperado', 'Ocurrió un error al completar el formulario');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isSubmitting,
    beneficiario?.cedula,
    abrirSelectorBenef,
    construirActividad,
    construirBeneficiario,
    construirCoordenadas,
    construirTecnico,
    encolarEvidencias,
    formularioActual,
    draftId,
    navigation,
    setActividad,
    setBeneficiario,
    setCoordenadas,
    setTecnico,
    finalizarFormulario,
    syncNow,
    visitaDef?.titulo,
  ]);

  const confirmarCompletar = useCallback(() => {
    if (isSubmitting) return;

    if (faltantes.length > 0) {
      autoguardarRef.current?.();
      Alert.alert(
        'Visita incompleta',
        'Termina de diligenciar los siguientes ítems antes de completar:\n\n• ' + faltantes.join('\n• '),
        [{ text: 'Revisar', style: 'cancel' }]
      );
      return;
    }

    Alert.alert(
      '¿Completar la visita?',
      'Revisa que la información y las evidencias estén correctas antes de continuar.',
      [
        { text: 'No, revisar', style: 'cancel' },
        { text: 'Sí, completar', onPress: () => handleCompletar() },
      ]
    );
  }, [faltantes, handleCompletar, isSubmitting]);

  // ─── Navegación a evidencias ──────────────────────────────
  const abrirCamara = (modo: 'photo' | 'video') => {
    navigation.navigate('Camara', {
      mode: modo,
      requisito: DESCRIPCION_ITEM.registro_fotografico,
    });
  };

  // ─── Render ───────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Encabezado */}
        <View style={styles.header}>
          <Text style={styles.headerIcono}>{visitaDef?.icono || '📋'}</Text>
          <View style={styles.flex}>
            <Text style={styles.headerTitulo}>{visitaDef?.titulo || `Visita Técnica ${visitaNumero}`}</Text>
            <Text style={styles.headerSubtitulo}>
              {beneficiario?.nombre ? `Beneficiario: ${beneficiario.nombre}` : 'Formulario de visita técnica'}
            </Text>
          </View>
        </View>

        {/* Aviso de ítems pendientes */}
        <View style={[styles.aviso, faltantes.length === 0 && styles.avisoOk]}>
          <Text style={styles.avisoTexto}>
            {faltantes.length === 0
              ? '✅ Todos los ítems están diligenciados'
              : `⏳ Faltan ${faltantes.length} ítem(s) por diligenciar`}
          </Text>
        </View>

        {/* ─── Ítem 1: No identificación ─────────────────── */}
        <ItemCard
          numero={1}
          titulo="No. identificación"
          ayuda={DESCRIPCION_ITEM.no_identificacion}
          completo={!!data.no_identificacion}
        >
          {requiereCambioBenef && (
            <View style={styles.cambioBenefBox}>
              <Text style={styles.cambioBenefTexto}>
                ⚠️ Este beneficiario ya tiene registrada esta visita. Elige el beneficiario al que
                corresponde lo diligenciado para poder completar.
              </Text>
              <TouchableOpacity style={styles.cambioBenefBtn} onPress={abrirSelectorBenef} activeOpacity={0.7}>
                <Text style={styles.cambioBenefBtnTexto}>👤 Cambiar beneficiario</Text>
              </TouchableOpacity>
            </View>
          )}
          {beneficiario && (
            <View style={styles.datosBox}>
              <Text style={styles.datosLinea}>👤 {beneficiario.nombre || '—'}</Text>
              {!!beneficiario.cedula && <Text style={styles.datosLinea}>🪪 C.C. {beneficiario.cedula}</Text>}
              {!!beneficiario.telefono && <Text style={styles.datosLinea}>📞 {beneficiario.telefono}</Text>}
              {!!(beneficiario.vereda || beneficiario.corregimiento) && (
                <Text style={styles.datosLinea}>
                  📍 {[beneficiario.vereda, beneficiario.corregimiento].filter(Boolean).join(' · ')}
                </Text>
              )}
              {!!beneficiario.municipio && (
                <Text style={styles.datosLinea}>
                  🗺️ {beneficiario.municipio}
                  {beneficiario.departamento ? `, ${beneficiario.departamento}` : ''}
                </Text>
              )}
            </View>
          )}

          {opcionesIdentificacion.length > 0 ? (
            <DropdownPicker
              label="Identificación del beneficiario"
              value={data.no_identificacion || null}
              options={opcionesIdentificacion}
              onSelect={(v) => set('no_identificacion', v)}
              placeholder="Seleccionar identificación"
              required
            />
          ) : (
            <TextInput
              style={styles.input}
              value={data.no_identificacion}
              onChangeText={(v) => set('no_identificacion', v)}
              placeholder="Escribe el nombre o número de identificación"
              placeholderTextColor={COLORS.textLight}
            />
          )}
        </ItemCard>

        {/* ─── Ítem 2: Objetivo de la visita ─────────────── */}
        <ItemCard
          numero={2}
          titulo="Objetivo de la visita"
          ayuda={DESCRIPCION_ITEM.objetivo}
          completo
        >
          {/* Objetivo fijo para todas las Visitas 2 (no editable). */}
          <TextInput
            style={[styles.input, styles.inputMultiline, styles.inputSoloLectura]}
            value={OBJETIVO_VISITA_DEFAULT}
            editable={false}
            multiline
          />
        </ItemCard>

        {/* ─── Ítem 3: Descripción de la visita ──────────── */}
        <ItemCard
          numero={3}
          titulo="Descripción de la visita"
          ayuda={DESCRIPCION_ITEM.descripcion_visita}
          completo={!!data.descripcion_visita.trim()}
        >
          <TextInput
            style={[styles.input, styles.inputMultilineTall]}
            value={data.descripcion_visita}
            onChangeText={(v) => set('descripcion_visita', v)}
            multiline
            placeholder="Describe paso a paso la visita y las condiciones actuales del predio"
            placeholderTextColor={COLORS.textLight}
          />
        </ItemCard>

        {/* ─── Ítem 4: Georreferenciación ────────────────── */}
        <ItemCard
          numero={4}
          titulo="Georreferenciación del polígono del cultivo"
          ayuda={DESCRIPCION_ITEM.georreferenciacion}
          completo={!!data.latitud && !!data.longitud}
        >
          <CapturaGPSPrecisa
            label="Coordenada del área a intervenir"
            latitud={data.latitud}
            longitud={data.longitud}
            altitud={data.altitud}
            precision={data.precision}
            ubicacionTexto={
              [beneficiario?.vereda, beneficiario?.corregimiento, beneficiario?.municipio]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            onCapture={(lat, lon, alt, prec) => {
              setData((prev) => ({
                ...prev,
                latitud: lat,
                longitud: lon,
                altitud: alt,
                precision: prec,
              }));
            }}
          />

          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() =>
              navigation.navigate('TerrenoMapa', {
                // Se pasa el beneficiario para que el KML exportado desde el
                // mapa se nombre «Nombre del beneficiario - Medición» y se
                // pueda distinguir de los demás.
                beneficiarioNombre: beneficiario?.nombre,
                beneficiarioCedula: beneficiario?.cedula,
                // Atribución geográfica y vínculo con la visita: así el
                // polígono trazado queda amarrado al beneficiario y los roles
                // superiores pueden ver de quién es en el mapa general.
                vereda: beneficiario?.vereda,
                corregimiento: beneficiario?.corregimiento,
                formularioId: formIdRef.current,
                visitaNumero,
              })
            }
            activeOpacity={0.7}
          >
            <Text style={styles.mapBtnText}>🗺️ Abrir mapa para trazar el área</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.mapBtnSecundario}
            onPress={abrirSelectorMediciones}
            activeOpacity={0.7}
          >
            <Text style={styles.mapBtnSecundarioText}>
              📌 {data.mediciones_historial.length > 0 ? 'Agregar o quitar mediciones del historial' : 'Elegir mediciones del historial'}
            </Text>
          </TouchableOpacity>

          {data.mediciones_historial.length > 0 ? (
            <>
              {data.mediciones_historial.length > 1 && (
                <Text style={styles.medicionResumen}>
                  {data.mediciones_historial.length} polígonos · total{' '}
                  {sumaHectareas(data.mediciones_historial).toLocaleString('es-CO', { maximumFractionDigits: 2 })} ha
                </Text>
              )}
              {data.mediciones_historial.map((m, idx) => (
                <View key={m.id || String(idx)} style={styles.medicionCard}>
                  <View style={styles.medicionCardHeader}>
                    <View style={styles.medicionCardHeaderText}>
                      <Text style={styles.medicionCardTitulo}>
                        {data.mediciones_historial.length > 1 ? `Polígono ${idx + 1}` : 'Medición adjunta'}
                      </Text>
                      <Text style={styles.medicionCardNombre} numberOfLines={2}>
                        {m.nombre}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => quitarMedicionHistorial(m.id)}
                      style={styles.medicionQuitarBtn}
                      accessibilityLabel={`Quitar la medición ${m.nombre}`}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.medicionQuitarTexto}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <MedicionCaptura medicion={m} altura={170} mostrarAcciones={false} />
                </View>
              ))}
              <Text style={styles.medicionCardAyuda}>
                El coordinador y el interventor verán estas capturas en el detalle del formulario y podrán
                abrir cada área en Google Earth. Si el predio tiene varios lotes, adjunta todos.
              </Text>
            </>
          ) : (
            <Text style={styles.medicionVacio}>
              Opcional: adjunta una o varias mediciones ya guardadas en el mapa (por ejemplo, si el predio tiene
              varios lotes) para que el área quede con su nombre y su captura de imagen.
            </Text>
          )}

          <Text style={styles.fieldLabel}>Área del cultivo (ha) — opcional</Text>
          <TextInput
            style={styles.input}
            value={data.area_intervencion}
            onChangeText={(v) => set('area_intervencion', sanearArea(v))}
            keyboardType="decimal-pad"
            placeholder="Ej. 1.5"
            placeholderTextColor={COLORS.textLight}
          />
        </ItemCard>

        {/* ─── Ítem 5: Seguimiento a compromisos ─────────── */}
        <ItemCard
          numero={5}
          titulo="Seguimiento a compromisos"
          ayuda={DESCRIPCION_ITEM.seguimiento_compromisos}
          completo={!!data.seguimiento_compromisos.trim()}
        >
          <TextInput
            style={[styles.input, styles.inputMultilineTall]}
            value={data.seguimiento_compromisos}
            onChangeText={(v) => set('seguimiento_compromisos', v)}
            multiline
            placeholder="Describe las actividades realizadas para el cumplimiento de los compromisos previos"
            placeholderTextColor={COLORS.textLight}
          />
        </ItemCard>

        {/* ─── Ítem 6: Valoración del cumplimiento ───────── */}
        <ItemCard
          numero={6}
          titulo="Valoración del cumplimiento"
          ayuda={DESCRIPCION_ITEM.valoracion_cumplimiento}
          completo={!!data.valoracion_cumplimiento.trim()}
        >
          <View style={styles.porcentajeRow}>
            <TextInput
              style={[styles.input, styles.inputPorcentaje]}
              value={data.valoracion_cumplimiento}
              onChangeText={(v) => {
                const limpio = sanearValoracion(v);
                if (limpio !== null) set('valoracion_cumplimiento', limpio);
              }}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textLight}
            />
            <Text style={styles.porcentajeSigno}>%</Text>
          </View>

          <View style={styles.chipsRow}>
            {[0, 25, 50, 75, 100].map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.chip, data.valoracion_cumplimiento === String(v) && styles.chipActivo]}
                onPress={() => set('valoracion_cumplimiento', String(v))}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.chipText,
                    data.valoracion_cumplimiento === String(v) && styles.chipTextActivo,
                  ]}
                >
                  {v}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.barraFondo}>
            <View
              style={[
                styles.barraRelleno,
                {
                  width: `${Math.min(100, Number(data.valoracion_cumplimiento) || 0)}%`,
                  backgroundColor:
                    (Number(data.valoracion_cumplimiento) || 0) >= 75
                      ? COLORS.success
                      : (Number(data.valoracion_cumplimiento) || 0) >= 40
                      ? COLORS.warning
                      : COLORS.error,
                },
              ]}
            />
          </View>
        </ItemCard>

        {/* ─── Ítem 7: Recomendaciones ───────────────────── */}
        <ItemCard
          numero={7}
          titulo="Recomendaciones"
          ayuda={DESCRIPCION_ITEM.recomendaciones}
          completo={!!data.recomendaciones.trim()}
        >
          <TextInput
            style={[styles.input, styles.inputMultilineTall]}
            value={data.recomendaciones}
            onChangeText={(v) => set('recomendaciones', v)}
            multiline
            placeholder="Recomendaciones técnicas para el productor"
            placeholderTextColor={COLORS.textLight}
          />
        </ItemCard>

        {/* ─── Ítem 8: Compromisos para la próxima visita ── */}
        <ItemCard
          numero={8}
          titulo={`Compromisos para la ${visitaNumero + 1}ª visita`}
          ayuda="Selecciona los compromisos adquiridos (puedes agregar los tuyos)"
          completo={data.sin_compromisos || data.compromisos.some((c) => c.activo && c.texto.trim())}
        >
          <View style={styles.compromisoRow}>
            <Switch
              value={data.sin_compromisos}
              onValueChange={(v) => set('sin_compromisos', v)}
              trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
              thumbColor={data.sin_compromisos ? COLORS.primary : '#f4f3f4'}
            />
            <Text style={styles.sinCompromisosText}>
              Sin compromisos para la próxima visita (no aplica)
            </Text>
          </View>

          {!data.sin_compromisos && (
            <>
              {data.compromisos.map((c, index) => (
                <View key={c.id} style={styles.compromisoRow}>
                  <Switch
                    value={c.activo}
                    onValueChange={(v) =>
                      setData((prev) => ({
                        ...prev,
                        compromisos: prev.compromisos.map((x, i) => (i === index ? { ...x, activo: v } : x)),
                      }))
                    }
                    trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                    thumbColor={c.activo ? COLORS.primary : '#f4f3f4'}
                  />
                  <TextInput
                    style={[styles.input, styles.inputCompromiso]}
                    value={c.texto}
                    onChangeText={(v) =>
                      setData((prev) => ({
                        ...prev,
                        compromisos: prev.compromisos.map((x, i) => (i === index ? { ...x, texto: v } : x)),
                      }))
                    }
                    placeholder="Descripción del compromiso"
                    placeholderTextColor={COLORS.textLight}
                  />
                  <TouchableOpacity
                    onPress={() =>
                      setData((prev) => ({
                        ...prev,
                        compromisos: prev.compromisos.filter((_, i) => i !== index),
                      }))
                    }
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.eliminarCompromiso}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity
                style={styles.agregarBtn}
                onPress={() =>
                  setData((prev) => ({ ...prev, compromisos: [...prev.compromisos, nuevoCompromiso('', true)] }))
                }
                activeOpacity={0.7}
              >
                <Text style={styles.agregarBtnText}>+ Agregar compromiso</Text>
              </TouchableOpacity>
            </>
          )}
        </ItemCard>

        {/* ─── Ítem 9: Registro fotográfico ──────────────── */}
        <ItemCard
          numero={9}
          titulo="Registro fotográfico"
          ayuda={DESCRIPCION_ITEM.registro_fotografico}
          completo={fotos.length > 0}
        >
          <View style={styles.evidenciaBtns}>
            <TouchableOpacity style={styles.evidenciaBtn} onPress={() => abrirCamara('photo')} activeOpacity={0.7}>
              <Text style={styles.evidenciaBtnIcon}>📷</Text>
              <Text style={styles.evidenciaBtnText}>Tomar fotos</Text>
              <Text style={styles.evidenciaBtnCount}>{fotosSolo.length} foto(s)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.evidenciaBtn} onPress={() => abrirCamara('video')} activeOpacity={0.7}>
              <Text style={styles.evidenciaBtnIcon}>🎥</Text>
              <Text style={styles.evidenciaBtnText}>Grabar video</Text>
              <Text style={styles.evidenciaBtnCount}>{videosSolo.length} video(s)</Text>
            </TouchableOpacity>
          </View>

          {fotosSolo.length > 0 && (
            <View style={styles.thumbsRow}>
              {fotosSolo.slice(-6).map((f) => (
                <Image key={f.id} source={{ uri: f.uri }} style={styles.thumb} />
              ))}
            </View>
          )}

          <Text style={styles.fieldLabel}>Firmas y registro biométrico (opcional)</Text>
          <View style={styles.firmasRow}>
            <TouchableOpacity
              style={[styles.firmaBtn, firmaBeneficiarioOk && styles.firmaBtnOk]}
              onPress={() => navigation.navigate('FirmaBeneficiario')}
              activeOpacity={0.7}
            >
              <Text style={styles.firmaBtnText}>
                {firmaBeneficiarioOk ? '✅' : '✍️'} Firma beneficiario
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.firmaBtn, firmaTecnicoOk && styles.firmaBtnOk]}
              onPress={() => navigation.navigate('FirmaDigital')}
              activeOpacity={0.7}
            >
              <Text style={styles.firmaBtnText}>
                {firmaTecnicoOk ? '✅' : '✍️'} Firma técnico
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.firmaBtn, styles.firmaBtnFull, huellaOk && styles.firmaBtnOk]}
            onPress={() => navigation.navigate('FirmaBiometrica')}
            activeOpacity={0.7}
          >
            <Text style={styles.firmaBtnText}>{huellaOk ? '✅' : '👆'} Registro biométrico</Text>
          </TouchableOpacity>
        </ItemCard>

        {/* ─── Ítem 10: Observaciones ────────────────────── */}
        <ItemCard
          numero={10}
          titulo="Observaciones de la visita"
          ayuda={DESCRIPCION_ITEM.observaciones}
          completo={!!data.observaciones.trim()}
        >
          <TextInput
            style={[styles.input, styles.inputMultilineTall]}
            value={data.observaciones}
            onChangeText={(v) => set('observaciones', v)}
            multiline
            placeholder="Describe situaciones anómalas o novedades de la visita"
            placeholderTextColor={COLORS.textLight}
          />
        </ItemCard>
      </ScrollView>

      {/* ─── Barra inferior de acciones ──────────────────── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.sm }]}>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecundario]}
          onPress={guardarBorradorHandler}
          disabled={isSaving || isSubmitting}
          activeOpacity={0.7}
        >
          {isSaving ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : (
            <Text style={styles.btnSecundarioText}>💾 Guardar borrador</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimario, isSubmitting && styles.btnDeshabilitado]}
          onPress={confirmarCompletar}
          disabled={isSubmitting}
          activeOpacity={0.7}
        >
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.textOnPrimary} />
          ) : (
            <Text style={styles.btnPrimarioText}>✅ Completar visita</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ─── Selector de medición del historial (ítem 4) ── */}
      <Modal
        visible={mostrarSelectorMediciones}
        animationType="slide"
        transparent
        onRequestClose={() => setMostrarSelectorMediciones(false)}
      >
        <View style={styles.selectorOverlay}>
          <View style={styles.selectorHoja}>
            <View style={styles.selectorHeader}>
              <Text style={styles.selectorTitulo}>Mediciones guardadas</Text>
              <TouchableOpacity
                onPress={() => setMostrarSelectorMediciones(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.7}
              >
                <Text style={styles.selectorCerrar}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.selectorAyuda}>
              Marca todas las áreas medidas que correspondan a esta visita (puedes elegir varias, por ejemplo
              un lote de 1 ha y otro de 1,5 ha). Solo se muestran tus mediciones de este beneficiario y las
              antiguas sin beneficiario que quedan cerca de la visita.
            </Text>

            {cargandoMediciones ? (
              <View style={styles.selectorVacioBox}>
                <ActivityIndicator color={COLORS.primary} />
              </View>
            ) : medicionesHistorial.length === 0 ? (
              <View style={styles.selectorVacioBox}>
                <Text style={styles.selectorVacioTexto}>
                  No hay mediciones guardadas para este beneficiario. Traza el área desde el mapa (botón de
                  arriba) y guárdala para poder adjuntarla aquí.
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.selectorLista} contentContainerStyle={styles.selectorListaContenido}>
                {medicionesHistorial.map((m) => {
                  const puntos = (m.puntos as unknown[]) || [];
                  const esArea = puntos.length >= 3;
                  const fecha = formatFechaHoraColombia(m.created_at as string | undefined);
                  const marcada = data.mediciones_historial.some((x) => x.id === String(m.id ?? ''));
                  const lleno = !marcada && data.mediciones_historial.length >= MAX_POLIGONOS_VISITA;
                  return (
                    <TouchableOpacity
                      key={String(m.id ?? '')}
                      style={[styles.selectorItem, marcada && styles.selectorItemMarcado, lleno && { opacity: 0.5 }]}
                      onPress={() => alternarMedicionHistorial(m)}
                      disabled={lleno}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: marcada }}
                    >
                      <View style={styles.selectorItemFila}>
                        <Text style={[styles.selectorCheck, marcada && styles.selectorCheckMarcado]}>
                          {marcada ? '☑' : '☐'}
                        </Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.selectorItemNombre} numberOfLines={2}>
                            {String(m.nombre || 'Medición sin nombre')}
                          </Text>
                          <Text style={styles.selectorItemMeta}>
                            {fecha ? `${fecha} · ` : ''}
                            {esArea
                              ? `◈ ${Number(m.area_hectareas || 0).toFixed(2)} ha`
                              : `📏 ${Number(m.perimetro_metros || 0).toFixed(0)} m`}
                            {` · ${puntos.length} pts`}
                          </Text>
                          {m.cercana ? (
                            <Text style={styles.selectorItemCercana}>
                              Sin beneficiario asignado · a {Number(m.distancia_m) || 0} m de la visita
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity
              style={styles.selectorListo}
              onPress={() => setMostrarSelectorMediciones(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.selectorListoTexto}>
                {data.mediciones_historial.length === 0
                  ? 'Cerrar'
                  : `Listo · ${data.mediciones_historial.length} ${data.mediciones_historial.length === 1 ? 'medición' : 'mediciones'} · ${sumaHectareas(data.mediciones_historial).toLocaleString('es-CO', { maximumFractionDigits: 2 })} ha`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <SelectorBeneficiarioModal
        visible={mostrarSelectorBenef}
        tecnicoId={user?.id}
        numeroVisita={numeroVisitaRef.current}
        cedulaActual={beneficiario?.cedula}
        onSeleccionar={elegirNuevoBeneficiario}
        onCerrar={() => setMostrarSelectorBenef(false)}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  headerIcono: { fontSize: 30, marginRight: SPACING.md },
  headerTitulo: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  headerSubtitulo: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },

  aviso: {
    backgroundColor: '#FFF3E0',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  avisoOk: { backgroundColor: COLORS.surfaceAlt },
  avisoTexto: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium },

  itemCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
    ...SHADOWS.sm,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: SPACING.md,
    paddingBottom: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt,
    borderTopLeftRadius: BORDER_RADIUS.lg,
    borderTopRightRadius: BORDER_RADIUS.lg,
  },
  itemBadge: {
    width: 26,
    height: 26,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  itemBadgeText: { color: COLORS.textOnPrimary, fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold },
  itemHeaderText: { flex: 1 },
  itemTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  itemAyuda: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2, lineHeight: 15 },
  itemCheck: { fontSize: 16, marginLeft: SPACING.sm },
  itemBody: { padding: SPACING.md, paddingTop: SPACING.sm },

  datosBox: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  datosLinea: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, marginBottom: 3 },
  cambioBenefBox: {
    backgroundColor: COLORS.warning + '15',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.warning + '60',
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  cambioBenefTexto: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  cambioBenefBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  cambioBenefBtnTexto: { color: COLORS.textOnPrimary, fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold },

  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.background,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  inputMultilineTall: { minHeight: 110, textAlignVertical: 'top' },
  fieldLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  inputSoloLectura: { backgroundColor: COLORS.surfaceAlt, color: COLORS.textPrimary },

  mapBtn: {
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  mapBtnText: { fontSize: FONTS.sizes.sm, color: COLORS.primary, fontWeight: FONTS.weights.medium },

  mapBtnSecundario: {
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.primaryLight,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  mapBtnSecundarioText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.medium,
  },
  medicionVacio: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    lineHeight: 15,
  },
  medicionCard: {
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
    backgroundColor: COLORS.background,
    padding: SPACING.sm,
  },
  medicionCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.xs },
  medicionCardHeaderText: { flex: 1 },
  medicionCardTitulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  medicionCardNombre: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.bold,
    marginTop: 1,
  },
  medicionCardAyuda: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    lineHeight: 15,
  },
  medicionQuitarBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    marginLeft: SPACING.sm,
  },
  medicionQuitarTexto: { fontSize: 16, color: COLORS.error, fontWeight: FONTS.weights.bold },
  medicionResumen: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.bold,
  },
  selectorItemCercana: { fontSize: FONTS.sizes.xs, color: COLORS.warning, marginTop: 2 },
  selectorItemMarcado: { borderColor: COLORS.primary, borderWidth: 1.5 },
  selectorItemFila: { flexDirection: 'row', alignItems: 'center' },
  selectorCheck: { fontSize: 22, color: COLORS.textLight, marginRight: SPACING.sm },
  selectorCheckMarcado: { color: COLORS.primary },
  selectorListo: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
  },
  selectorListoTexto: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.sm },

  selectorOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  selectorHoja: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.md,
    maxHeight: '75%',
  },
  selectorHeader: { flexDirection: 'row', alignItems: 'center' },
  selectorTitulo: {
    flex: 1,
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  selectorCerrar: { fontSize: 18, color: COLORS.textSecondary, paddingHorizontal: SPACING.xs },
  selectorAyuda: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
    lineHeight: 15,
  },
  selectorLista: { maxHeight: 420 },
  selectorListaContenido: { paddingBottom: SPACING.sm },
  selectorItem: {
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
    backgroundColor: COLORS.background,
  },
  selectorItemNombre: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  selectorItemMeta: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  selectorVacioBox: { paddingVertical: SPACING.xl, alignItems: 'center' },
  selectorVacioTexto: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },

  porcentajeRow: { flexDirection: 'row', alignItems: 'center' },
  inputPorcentaje: { width: 90, textAlign: 'center', fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold },
  porcentajeSigno: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textSecondary, marginLeft: SPACING.sm },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  chipActivo: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  chipTextActivo: { color: COLORS.textOnPrimary, fontWeight: FONTS.weights.bold },

  barraFondo: {
    height: 8,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.divider,
    overflow: 'hidden',
    marginTop: SPACING.sm,
  },
  barraRelleno: { height: 8, borderRadius: BORDER_RADIUS.full },

  compromisoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  inputCompromiso: { flex: 1, marginHorizontal: SPACING.sm },
  eliminarCompromiso: { fontSize: 18, color: COLORS.error, paddingHorizontal: SPACING.xs },
  sinCompromisosText: { flex: 1, marginLeft: SPACING.sm, color: COLORS.textPrimary, fontSize: FONTS.sizes.sm },
  agregarBtn: {
    marginTop: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.primaryLight,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  agregarBtnText: { color: COLORS.primary, fontWeight: FONTS.weights.medium, fontSize: FONTS.sizes.sm },

  evidenciaBtns: { flexDirection: 'row', justifyContent: 'space-between' },
  evidenciaBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    marginRight: SPACING.sm,
  },
  evidenciaBtnIcon: { fontSize: 24, marginBottom: 4 },
  evidenciaBtnText: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.medium, color: COLORS.textPrimary },
  evidenciaBtnCount: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },

  thumbsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.sm },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: BORDER_RADIUS.sm,
    marginRight: SPACING.xs,
    marginBottom: SPACING.xs,
    backgroundColor: COLORS.divider,
  },

  firmasRow: { flexDirection: 'row', justifyContent: 'space-between' },
  firmaBtn: {
    flex: 1,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  firmaBtnFull: { marginTop: SPACING.sm, marginRight: 0 },
  firmaBtnOk: { borderColor: COLORS.success, backgroundColor: COLORS.surfaceAlt },
  firmaBtnText: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary, textAlign: 'center' },

  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    ...SHADOWS.lg,
  },
  btn: {
    flex: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecundario: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    marginRight: SPACING.sm,
  },
  btnSecundarioText: { color: COLORS.primary, fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.sm },
  btnPrimario: { backgroundColor: COLORS.primary },
  btnPrimarioText: { color: COLORS.textOnPrimary, fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.sm },
  btnDeshabilitado: { opacity: 0.6 },
});

export default VisitaTecnicaFormScreen;
