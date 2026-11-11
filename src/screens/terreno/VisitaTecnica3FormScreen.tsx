// ============================================================
// GEODAILY — Formulario de Visita Técnica 3 (formato v3)
// ============================================================
// Misma estructura y ciclo de vida que la Visita Técnica 2
// (`VisitaTecnicaFormScreen`): borrador con autoguardado, evidencias en la
// cola SQLite que sube SyncContext, y guardado local verificado antes de
// borrar el borrador. Cambia el contenido:
//   1. Datos del técnico (solo lectura)
//   2. Datos del beneficiario (solo lectura)
//   3. Actividad realizada (objetivo y descripción por defecto, editables)
//   4. Preguntas 1–12
//   5. Seguimiento a compromisos
//   6. Observaciones y recomendaciones
//   7. Evidencias (fotos, video, firmas, biométrico)
//
// Esquema, textos y validación: `utils/visitaTecnica3.ts`.
// Se guarda como tipo 'visita_tecnica' con `visita_numero: 3` y
// `formato_visita: 'v3'`; la evidencia usa la clave 'visita_tecnica_3' para
// caer en la carpeta Formulario_3 de MinIO.
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
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useForm } from '../../store/FormContext';
import { useSync } from '../../store/SyncContext';
import { useGPS } from '../../store/GPSContext';
import { ActividadRealizada, Coordenadas, DatosBeneficiario, ResumenClimatico } from '../../types';
import { resolverClimaYUbicacion } from '../../services/climate.service';
import DropdownPicker from '../../components/DropdownPicker';
import CapturaGPSPrecisa from '../../components/CapturaGPSPrecisa';
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
  saveFotoLocal,
  saveVideoLocal,
  vincularDocumentosHuerfanos,
} from '../../services/database';
import { resolverBeneficiarioVisita, tieneDatosBeneficiario } from '../../utils/visitaTecnica';
import { construirLlave, llaveCorrespondeACedula } from '../../utils/llaveVisita';
import {
  avisarSinCedula,
  avisarVisitaYaRegistrada,
  buscarVisitaYaCompletada,
  resolverEntradaVisita,
} from '../../services/entradaVisita';
import {
  COMPROMISOS_V3,
  CUMPLE_RECOMENDACIONES_OPTS,
  MANEJO_DRENAJE_OPTS,
  OBJETIVO_VISITA3_DEFAULT,
  DESCRIPCION_VISITA3_DEFAULT,
  ORIENTACION_SURCOS_OPTS,
  PORCENTAJES_PARCIAL,
  PROBLEMAS_SUELO_OPTS,
  SI_NO,
  SISTEMA_TRAZADO_OPTS,
  VISITA3_CLAVE_CARPETA,
  VISITA3_FORMATO,
  VISITA3_NUMERO,
  CompromisoClave,
  Visita3Datos,
  crearEstadoInicialV3,
  faltantesV3,
  hidratarEstadoV3,
  resumenSeguimientoV3,
  sanearPorcentajeManual,
} from '../../utils/visitaTecnica3';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: RouteProp<
    Record<string, any> & { params: { visitaNumero?: number; draftId?: string; beneficiario?: DatosBeneficiario } },
    'params'
  >;
};

// ─── Tarjeta de bloque ───────────────────────────────────────
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

/** Encabezado de una pregunta dentro de un bloque. */
const Pregunta: React.FC<{ numero?: string; texto: string; children: React.ReactNode }> = ({
  numero,
  texto,
  children,
}) => (
  <View style={styles.pregunta}>
    <Text style={styles.preguntaTexto}>
      {numero ? `${numero}. ` : ''}
      {texto}
    </Text>
    {children}
  </View>
);

/** Selección única con chips (Sí/No, opciones del formato). */
const Opciones: React.FC<{
  opciones: string[];
  valor: string;
  onChange: (v: string) => void;
}> = ({ opciones, valor, onChange }) => (
  <View style={styles.chipsRow}>
    {opciones.map((op) => {
      const activo = valor === op;
      return (
        <TouchableOpacity
          key={op}
          style={[styles.chip, activo && styles.chipActivo]}
          onPress={() => onChange(activo ? '' : op)}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, activo && styles.chipTextActivo]}>{op}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const VisitaTecnica3FormScreen: React.FC<Props> = ({ navigation, route }) => {
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
  const { userLocation, getCurrentPosition } = useGPS();
  const insets = useSafeAreaInsets();

  const draftId = route.params?.draftId;
  const beneficiarioParam = route.params?.beneficiario;

  // ─── Estado ───────────────────────────────────────────────
  const [data, setData] = useState<Visita3Datos>(() => crearEstadoInicialV3());
  const [coords, setCoords] = useState<Coordenadas | null>(null);
  const [climaResuelto, setClimaResuelto] = useState<ResumenClimatico | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formIdRef = useRef<string>(draftId || `visita3-${Date.now()}`);
  const completadoRef = useRef(false);
  /** Llave inmutable de la visita (técnico|cédula|vN). Se fija una vez al abrir. */
  const llaveRef = useRef<string | null>(null);
  const inicializadoRef = useRef(false);
  /** false hasta terminar la carga inicial (evita autoguardar con el beneficiario equivocado). */
  const borradorListoRef = useRef(false);
  const autoguardarRef = useRef<(() => void) | null>(null);
  const autoguardadoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Coordenada restaurada de un borrador: el GPS de apertura no la pisa. */
  const coordsDeBorradorRef = useRef<Coordenadas | null>(null);

  const formularioRef = useRef(formularioActual);
  useEffect(() => {
    formularioRef.current = formularioActual;
  }, [formularioActual]);

  const totalFotosCtx = formularioActual?.fotos?.length ?? 0;

  /** Beneficiario del borrador que se retoma: manda sobre parámetros y contexto. */
  const [beneficiarioBorrador, setBeneficiarioBorrador] = useState<DatosBeneficiario | undefined>(undefined);

  /**
   * «Cambiar beneficiario» (caso excepcional): lo diligenciado se tomó dentro
   * de un beneficiario que YA tiene esta visita. El elegido manda sobre todos.
   */
  const [beneficiarioElegido, setBeneficiarioElegido] = useState<DatosBeneficiario | undefined>(undefined);
  const [mostrarSelectorBenef, setMostrarSelectorBenef] = useState(false);
  const [requiereCambioBenef, setRequiereCambioBenef] = useState(false);
  const cambioBenefPorGuardarRef = useRef(false);

  const beneficiario = beneficiarioElegido
    ? beneficiarioElegido
    : draftId
    ? resolverBeneficiarioVisita(beneficiarioBorrador, beneficiarioParam, formularioActual?.beneficiario)
    // Formulario NUEVO: solo el beneficiario elegido en la navegación. El del
    // contexto global puede ser el de un formulario anterior (otro beneficiario).
    : resolverBeneficiarioVisita(beneficiarioParam);

  const fotos = formularioActual?.fotos || [];
  const fotosSolo = fotos.filter((f) => f.tipo !== 'video');
  const videosSolo = fotos.filter((f) => f.tipo === 'video');
  const firmaBeneficiarioOk = !!formularioActual?.firma_beneficiario;
  const firmaTecnicoOk = !!formularioActual?.firma_tecnico;
  const huellaOk = !!formularioActual?.huella_beneficiario;

  /** Máximo de fotos: 4 de realización de actividades + 1 del cuaderno de visita. */
  const MAX_FOTOS = 5;
  const ubicacionOk = !!(data.ubicacion_latitud && data.ubicacion_longitud);
  const fotosOk = fotosSolo.length >= 1 && fotosSolo.length <= MAX_FOTOS;
  const requisitosEvidencia = [fotosOk, videosSolo.length >= 1, firmaBeneficiarioOk, firmaTecnicoOk, ubicacionOk];
  const requisitosCumplidos = requisitosEvidencia.filter(Boolean).length;

  const set = useCallback(<K extends keyof Visita3Datos>(key: K, value: Visita3Datos[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setCompromiso = useCallback(
    (clave: CompromisoClave, parche: Partial<Visita3Datos['compromisos'][CompromisoClave]>) => {
      setData((prev) => ({
        ...prev,
        compromisos: { ...prev.compromisos, [clave]: { ...prev.compromisos[clave], ...parche } },
      }));
    },
    []
  );

  const alternarProblema = useCallback((problema: string) => {
    setData((prev) => {
      const activo = prev.p6_problemas.includes(problema);
      return {
        ...prev,
        p6_problemas: activo ? prev.p6_problemas.filter((p) => p !== problema) : [...prev.p6_problemas, problema],
      };
    });
  }, []);

  /** Resuelve nombre de lugar y clima de un punto (best-effort, nunca lanza). */
  const resolverLugarClima = useCallback((pos: Coordenadas) => {
    resolverClimaYUbicacion(pos.latitud, pos.longitud, pos.timestamp)
      .then(({ lugar, resumen }) => {
        if (lugar) setCoords((prev) => (prev ? { ...prev, lugar } : prev));
        if (resumen) setClimaResuelto(resumen);
      })
      .catch((e) => console.warn('[VisitaTecnica3] No se pudo resolver clima/ubicación:', e));
  }, []);
  const resolverLugarClimaRef = useRef(resolverLugarClima);
  resolverLugarClimaRef.current = resolverLugarClima;

  /**
   * Tarjeta "Tomar georreferenciación": igual que la pregunta 20 del form 1
   * (captura de alta precisión). El punto capturado reemplaza al GPS pasivo
   * de apertura como ubicación de la visita.
   */
  const capturarUbicacion = useCallback(
    (latitud: string, longitud: string, altitud: string, precision: string) => {
      setData((prev) => ({
        ...prev,
        ubicacion_latitud: latitud,
        ubicacion_longitud: longitud,
        ubicacion_altitud: altitud,
        ubicacion_precision: precision,
      }));
      const lat = Number(latitud);
      const lon = Number(longitud);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const nueva: Coordenadas = {
        latitud: lat,
        longitud: lon,
        altitud: altitud ? Number(altitud) : undefined,
        precision_gps: precision ? Number(precision) : undefined,
        timestamp: new Date().toISOString(),
      };
      // Es otro punto: el lugar/clima del GPS de apertura ya no aplica.
      setCoords(nueva);
      setCoordenadas(nueva);
      resolverLugarClimaRef.current(nueva);
    },
    [setCoordenadas]
  );

  // ─── Restaurar / iniciar ──────────────────────────────────
  useEffect(() => {
    if (inicializadoRef.current) return;
    // Formulario nuevo: la llave necesita el id del técnico, así que se espera a la sesión.
    if (!draftId && !user?.id) return;
    inicializadoRef.current = true;

    // El id se fija ANTES de restaurar evidencias (mismo motivo que en la encuesta y la Visita 2).
    iniciarFormulario('visita_tecnica', draftId);
    // `iniciarFormulario` conserva el beneficiario que hubiera en el contexto (puede ser el
    // de otro formulario): se fija explícitamente el elegido en la navegación.
    if (!draftId && beneficiarioParam) setBeneficiario(beneficiarioParam);

    const aplicarBorrador = (draft: FormDraft) => {
      formIdRef.current = draft.id;
      iniciarFormulario('visita_tecnica', draft.id);
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
      setData(hidratarEstadoV3(draft.actividad?.visita3_datos as unknown as Partial<Visita3Datos> | undefined));
      if (draft.fotos?.length) {
        for (const foto of draft.fotos) addFoto(foto);
      }
      if (draft.firma_beneficiario) setFirmaBeneficiario(draft.firma_beneficiario);
      if (draft.firma_tecnico) setFirmaTecnico(draft.firma_tecnico);
      if (draft.huella_beneficiario) setHuella(true);
      if (draft.coordenadas) {
        coordsDeBorradorRef.current = draft.coordenadas;
        setCoords(draft.coordenadas);
        setCoordenadas(draft.coordenadas);
      }
    };

    const init = async () => {
      if (draftId) {
        // Borrador retomado por su id (Formularios Incompletos).
        const draft = await getBorrador(draftId).catch(() => null);
        if (draft) {
          const yaExiste = await buscarVisitaYaCompletada(draft.beneficiario?.cedula, VISITA3_NUMERO);
          if (yaExiste) {
            avisarVisitaYaRegistrada(navigation, yaExiste, 'La Visita Técnica 3', () => {
              // Se carga el borrador para no perder nada, pero sin autoguardado
              // hasta que el técnico elija el beneficiario correcto.
              llaveRef.current = draft.llave || construirLlave(user?.id, draft.beneficiario?.cedula, VISITA3_NUMERO);
              aplicarBorrador(draft);
              setRequiereCambioBenef(true);
              setMostrarSelectorBenef(true);
            });
            return;
          }
          llaveRef.current = draft.llave || construirLlave(user?.id, draft.beneficiario?.cedula, VISITA3_NUMERO);
          aplicarBorrador(draft);
        } else {
          formIdRef.current = draftId;
          iniciarFormulario('visita_tecnica', draftId);
        }
      } else {
        // Entrada desde el beneficiario: una sola visita por beneficiario y formulario.
        const decision = await resolverEntradaVisita({
          usuarioId: user?.id,
          cedula: beneficiarioParam?.cedula,
          numeroVisita: VISITA3_NUMERO,
        });
        if (decision.estado === 'sin_datos') {
          avisarSinCedula(navigation);
          return;
        }
        if (decision.estado === 'bloqueada') {
          avisarVisitaYaRegistrada(navigation, decision.formulario, 'La Visita Técnica 3', () => {
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
      // A partir de aquí se puede autoguardar: si venía un borrador, ya está aplicado.
      borradorListoRef.current = true;

      // GPS automático: se reutiliza una lectura reciente (<60 s); si no, se pide una.
      // La coordenada del borrador, si existe, manda sobre la de ahora.
      let posicion: Coordenadas | null = coordsDeBorradorRef.current;
      if (!posicion) {
        const edadMs = userLocation?.timestamp ? Date.now() - new Date(userLocation.timestamp).getTime() : Infinity;
        posicion = userLocation && edadMs < 60000 ? userLocation : await getCurrentPosition().catch(() => null);
        if (posicion) {
          setCoords(posicion);
          setCoordenadas(posicion);
        }
      }

      // Clima y nombre del lugar: best-effort. Sin señal el formulario se guarda
      // igual y el sync lo completa después (buscarFormulariosConClimaPendiente).
      if (posicion) resolverLugarClimaRef.current(posicion);
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (formularioActual?.id) formIdRef.current = formularioActual.id;
  }, [formularioActual?.id]);

  // ─── Construcción de `actividad` y datos del formulario ───
  const construirActividad = useCallback((): ActividadRealizada => {
    const identificacion = [beneficiario?.nombre, beneficiario?.cedula ? `C.C. ${beneficiario.cedula}` : '']
      .filter(Boolean)
      .join(' — ');
    return {
      descripcion: data.descripcion_visita.trim() || `Visita Técnica ${VISITA3_NUMERO}`,
      descripcion_detallada: undefined,
      observaciones: data.observaciones.trim(),
      recomendaciones: data.recomendaciones.trim(),
      visita_numero: VISITA3_NUMERO,
      formato_visita: VISITA3_FORMATO,
      no_identificacion: identificacion,
      objetivo: data.objetivo.trim(),
      seguimiento_compromisos: resumenSeguimientoV3(data),
      visita3_datos: data as unknown as Record<string, unknown>,
    };
  }, [data, beneficiario?.nombre, beneficiario?.cedula]);

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
        coordenadas: coords || undefined,
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
    [construirActividad, construirBeneficiario, construirTecnico, coords, formularioActual]
  );

  /** ¿Hay algo que valga la pena guardar? (evita borradores vacíos) */
  const hayContenido = useCallback(() => {
    const currentForm = formularioRef.current || formularioActual;
    return (
      JSON.stringify(data) !== JSON.stringify(crearEstadoInicialV3()) || (currentForm?.fotos?.length || 0) > 0
    );
  }, [data, formularioActual]);

  /** Encola fotos/videos locales para que SyncContext los suba (único camino de subida). */
  const encolarEvidencias = useCallback(
    async (formId: string) => {
      const currentForm = formularioRef.current || formularioActual;
      const beneficiarioActual = { cedula: beneficiario?.cedula, nombre: beneficiario?.nombre };
      for (const evidencia of currentForm?.fotos || []) {
        if (evidencia.uri?.startsWith('http')) continue;
        if (evidencia.tipo === 'video') {
          await saveVideoLocal(evidencia.id, formId, evidencia.uri, evidencia.coordenadas, beneficiarioActual, VISITA3_CLAVE_CARPETA);
        } else {
          await saveFotoLocal(evidencia.id, formId, evidencia.uri, evidencia.coordenadas, beneficiarioActual, VISITA3_CLAVE_CARPETA);
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
        if (!borradorListoRef.current) return;
        // Sin llave no se crea un borrador nuevo (solo se admite al retomar uno por id).
        if (!llaveRef.current && !draftId) return;
        // Cinturón de seguridad: la llave debe ser la del beneficiario en pantalla.
        if (llaveRef.current && !llaveCorrespondeACedula(llaveRef.current, beneficiario?.cedula)) {
          console.warn('[VisitaTecnica3] La llave no coincide con el beneficiario; no se autoguarda');
          return;
        }
        const id = formIdRef.current || formularioActual?.id;
        if (!id) return;
        if (!hayContenido()) return;
        const ok = await guardarBorrador(armarBorrador(id));
        if (!ok) console.warn('[VisitaTecnica3] El borrador no quedó guardado:', id);
      } catch (e) {
        console.warn('[VisitaTecnica3] Autoguardado falló:', e);
      }
    };
  });

  // Red de seguridad: intervalo + salida de la app/pantalla
  useEffect(() => {
    const intervalo = setInterval(() => {
      autoguardarRef.current?.();
    }, 20000);
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background' || estado === 'inactive') autoguardarRef.current?.();
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
    if (autoguardadoDebounceRef.current) clearTimeout(autoguardadoDebounceRef.current);
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
      const id = formIdRef.current || formularioActual?.id || `visita3-${Date.now()}`;
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
        console.warn('[VisitaTecnica3] No se pudieron encolar todas las evidencias:', e);
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
      setMostrarSelectorBenef(false);
      // El mismo beneficiario, u otro que ya tenga esta visita: mismo aviso de siempre.
      const yaExiste = await buscarVisitaYaCompletada(nuevo.cedula, VISITA3_NUMERO);
      if (yaExiste) {
        setTimeout(
          () => avisarVisitaYaRegistrada(navigation, yaExiste, 'La Visita Técnica 3', abrirSelectorBenef),
          350
        );
        return;
      }
      const llave = construirLlave(user?.id, nuevo.cedula, VISITA3_NUMERO);
      if (!llave) {
        Alert.alert('No se pudo cambiar', 'El beneficiario elegido no tiene cédula registrada o la sesión del técnico no está disponible.');
        return;
      }
      llaveRef.current = llave;
      cambioBenefPorGuardarRef.current = true;
      setBeneficiarioElegido(nuevo);
      setBeneficiario(nuevo);
      setRequiereCambioBenef(false);
      borradorListoRef.current = true;
    },
    [navigation, abrirSelectorBenef, user?.id, setBeneficiario]
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
        console.warn('[Visita3] No se pudieron reasignar evidencias al nuevo beneficiario:', e)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiarioElegido]);

  // ─── Validación ───────────────────────────────────────────
  const faltantes = React.useMemo(() => {
    const f: string[] = [];
    if (!beneficiario?.nombre) f.push('Beneficiario');
    f.push(...faltantesV3(data));
    // Evidencias: todo es obligatorio salvo la huella biométrica.
    if (fotosSolo.length === 0) f.push('Evidencias: al menos 1 foto');
    if (fotosSolo.length > MAX_FOTOS) f.push(`Evidencias: máximo ${MAX_FOTOS} fotos (tienes ${fotosSolo.length})`);
    if (videosSolo.length === 0) f.push('Evidencias: video');
    if (!firmaBeneficiarioOk) f.push('Evidencias: firma del beneficiario');
    if (!firmaTecnicoOk) f.push('Evidencias: firma del técnico');
    if (!ubicacionOk) f.push('Evidencias: georeferenciación - ubicación');
    return f;
  }, [beneficiario?.nombre, data, fotosSolo.length, videosSolo.length, firmaBeneficiarioOk, firmaTecnicoOk, ubicacionOk]);

  // ─── Completar ────────────────────────────────────────────
  const handleCompletar = useCallback(async () => {
    if (isSubmitting) return;

    // Una sola visita por beneficiario: si el beneficiario en pantalla ya la
    // tiene (p. ej. el técnico no lo cambió), se bloquea con el mismo aviso.
    const yaExiste = await buscarVisitaYaCompletada(beneficiario?.cedula, VISITA3_NUMERO);
    if (yaExiste) {
      avisarVisitaYaRegistrada(navigation, yaExiste, 'La Visita Técnica 3', abrirSelectorBenef);
      return;
    }

    setIsSubmitting(true);

    try {
      const formId = formIdRef.current || `visita3-${Date.now()}`;

      // 1. Asegurar evidencias en la cola local antes de nada.
      try {
        await encolarEvidencias(formId);
      } catch (queueError) {
        setIsSubmitting(false);
        Alert.alert(
          'No se pudieron asegurar las evidencias',
          'La visita sigue en el borrador local. Revisa el almacenamiento e inténtalo de nuevo.'
        );
        console.warn('[VisitaTecnica3] No se pudo encolar evidencia al completar:', queueError);
        return;
      }

      // 2. GPS: si no hubo lectura al abrir, un último intento (no bloqueante).
      let coordenadasFinales: Coordenadas | undefined = coords || undefined;
      if (!coordenadasFinales) {
        const pos = await getCurrentPosition().catch(() => null);
        if (pos) coordenadasFinales = pos;
      }

      const tecnico = construirTecnico();
      const beneficiarioDatos = construirBeneficiario();
      const actividad = construirActividad();

      // 3. Sincronizar el contexto (por si alguna pantalla lo consulta).
      setTecnico(tecnico);
      setBeneficiario(beneficiarioDatos);
      setActividad(actividad);
      if (coordenadasFinales) setCoordenadas(coordenadasFinales);

      // 4. Finalizar con los datos FRESCOS (los set* de arriba aún no están en el estado).
      const form = finalizarFormulario({
        tipo: 'visita_tecnica',
        tecnico,
        beneficiario: beneficiarioDatos,
        actividad,
        coordenadas: coordenadasFinales as any,
        clima: climaResuelto || undefined,
      });
      if (!form) {
        Alert.alert(
          'No se pudo finalizar',
          'Se perdió el formulario en curso. Tus datos siguen en el borrador: ciérralo y ábrelo de nuevo.'
        );
        setIsSubmitting(false);
        return;
      }

      // 5. Punto de no retorno: si el guardado local falla, se ABORTA y el borrador se conserva.
      try {
        await saveFormularioLocal(form);
        const verificado = await getFormularioById(form.id);
        if (!verificado) throw new Error('El formulario no aparece en la base local tras guardarlo');
        completadoRef.current = true;
      } catch (errGuardado) {
        console.error('[VisitaTecnica3] Error guardando el formulario:', errGuardado);
        setIsSubmitting(false);
        Alert.alert(
          'No se pudo guardar',
          'No fue posible guardar el formulario en este dispositivo. Tu borrador sigue intacto: ' +
            'ciérralo, vuelve a abrirlo e inténtalo de nuevo.'
        );
        return;
      }

      // 6. Reasignar evidencias y documentos al id real del formulario.
      try {
        const cedula = beneficiarioDatos.cedula?.trim() || undefined;
        const db = getDb();
        if (db) {
          const idsEvidencia = Array.from(
            new Set(
              [formularioActual?.id, formIdRef.current, '', 'sin-formulario'].filter(
                (id): id is string => id !== undefined && id !== form.id
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
        console.warn('[VisitaTecnica3] No se pudieron actualizar documentos:', e);
      }

      // 7. Eliminar el borrador (todos los ids con los que pudo guardarse).
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

      // 8. Sincronizar (best-effort: sin señal, la cola reintenta).
      syncNow().catch(() => {});

      setIsSubmitting(false);
      Alert.alert(
        '✅ Visita completada',
        'La Visita Técnica 3 quedó guardada correctamente.',
        [{ text: 'Ver historial', onPress: () => navigation.navigate('TerrenoFormularioList') }],
        { cancelable: false }
      );
    } catch (err) {
      console.error('[VisitaTecnica3] Error al completar:', err);
      setIsSubmitting(false);
      Alert.alert('Error inesperado', 'Ocurrió un error al completar el formulario');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isSubmitting,
    beneficiario?.cedula,
    abrirSelectorBenef,
    coords,
    climaResuelto,
    construirActividad,
    construirBeneficiario,
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
  ]);

  const confirmarCompletar = useCallback(() => {
    if (isSubmitting) return;

    if (faltantes.length > 0) {
      autoguardarRef.current?.();
      Alert.alert(
        'Visita incompleta',
        'Termina de diligenciar lo siguiente antes de completar:\n\n• ' + faltantes.join('\n• '),
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

  const abrirCamara = (modo: 'photo' | 'video') => {
    navigation.navigate('Camara', {
      mode: modo,
      requisito: 'Beneficiario y técnico, terreno',
      tipoFormulario: VISITA3_CLAVE_CARPETA,
    });
  };

  // ─── Render ───────────────────────────────────────────────
  const objetivoDefault = data.objetivo === OBJETIVO_VISITA3_DEFAULT;
  const descripcionDefault = data.descripcion_visita === DESCRIPCION_VISITA3_DEFAULT;

  const campoAbierto = (
    clave: keyof Visita3Datos,
    placeholder: string,
    tall = false
  ) => (
    <TextInput
      style={[styles.input, tall ? styles.inputMultilineTall : styles.inputMultiline]}
      value={String(data[clave] ?? '')}
      onChangeText={(v) => set(clave, v as never)}
      multiline
      placeholder={placeholder}
      placeholderTextColor={COLORS.textLight}
    />
  );

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
          <Text style={styles.headerIcono}>🌱</Text>
          <View style={styles.flex}>
            <Text style={styles.headerTitulo}>Visita Técnica 3</Text>
            <Text style={styles.headerSubtitulo}>
              {beneficiario?.nombre ? `Beneficiario: ${beneficiario.nombre}` : 'Formulario de visita técnica'}
            </Text>
          </View>
        </View>

        <View style={[styles.aviso, faltantes.length === 0 && styles.avisoOk]}>
          <Text style={styles.avisoTexto}>
            {faltantes.length === 0
              ? '✅ Todo está diligenciado'
              : `⏳ Faltan ${faltantes.length} ítem(s) por diligenciar`}
          </Text>
        </View>

        {/* ─── 1. Datos del técnico ──────────────────────── */}
        <ItemCard numero={1} titulo="Datos del técnico" completo={!!user?.nombre}>
          <View style={styles.datosBox}>
            <Text style={styles.datosLinea}>🧑‍🌾 {user?.nombre || '—'}</Text>
            {!!user?.cedula && <Text style={styles.datosLinea}>🪪 C.C. {user.cedula}</Text>}
            {!!user?.telefono && <Text style={styles.datosLinea}>📞 {user.telefono}</Text>}
            {!!user?.email && <Text style={styles.datosLinea}>✉️ {user.email}</Text>}
          </View>
        </ItemCard>

        {/* ─── 2. Datos del beneficiario ─────────────────── */}
        <ItemCard numero={2} titulo="Datos del beneficiario" completo={!!beneficiario?.nombre}>
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
          {beneficiario ? (
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
              {!!beneficiario.finca && <Text style={styles.datosLinea}>🌾 {beneficiario.finca}</Text>}
            </View>
          ) : (
            <Text style={styles.itemAyuda}>
              No hay beneficiario seleccionado. Abre la visita desde la ficha del beneficiario.
            </Text>
          )}
        </ItemCard>

        {/* ─── 3. Actividad realizada ────────────────────── */}
        <ItemCard
          numero={3}
          titulo="Actividad realizada"
          completo={!!data.objetivo.trim() && !!data.descripcion_visita.trim()}
        >
          <Text style={styles.fieldLabel}>Objetivo de la visita</Text>
          <TextInput
            style={[styles.input, styles.inputMultilineTall]}
            value={data.objetivo}
            onChangeText={(v) => set('objetivo', v)}
            multiline
            placeholder="Objetivo de la visita"
            placeholderTextColor={COLORS.textLight}
          />
          {!objetivoDefault && (
            <TouchableOpacity style={styles.linkBtn} onPress={() => set('objetivo', OBJETIVO_VISITA3_DEFAULT)} activeOpacity={0.7}>
              <Text style={styles.linkBtnText}>↺ Restaurar objetivo sugerido</Text>
            </TouchableOpacity>
          )}

          <Text style={[styles.fieldLabel, styles.espacioArriba]}>Descripción de la visita</Text>
          <TextInput
            style={[styles.input, styles.inputMultilineTall]}
            value={data.descripcion_visita}
            onChangeText={(v) => set('descripcion_visita', v)}
            multiline
            placeholder="Descripción de la visita"
            placeholderTextColor={COLORS.textLight}
          />
          {!descripcionDefault && (
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => set('descripcion_visita', DESCRIPCION_VISITA3_DEFAULT)}
              activeOpacity={0.7}
            >
              <Text style={styles.linkBtnText}>↺ Restaurar descripción sugerida</Text>
            </TouchableOpacity>
          )}
        </ItemCard>

        {/* ─── 4. Preguntas ──────────────────────────────── */}
        <ItemCard numero={4} titulo="Preguntas" completo={faltantesV3(data).every((x) => !x.startsWith('Pregunta'))}>
          <Pregunta numero="1" texto="¿Cuál es el estado actual del terreno desde la última visita técnica?">
            {campoAbierto('p1_estado_terreno', 'Escribe la respuesta')}
          </Pregunta>

          <Pregunta numero="2" texto="¿Qué actividades de adecuación del terreno ha realizado el productor desde la Visita 2?">
            {campoAbierto('p2_actividades_adecuacion', 'Escribe la respuesta')}
          </Pregunta>

          <Pregunta
            numero="3"
            texto="¿El terreno se encuentra limpio y libre de malezas, residuos y obstáculos que dificulten la siembra?"
          >
            {campoAbierto('p3_terreno_limpio', 'Escribe la respuesta')}
          </Pregunta>

          <Pregunta numero="4" texto="¿Se encuentra delimitada o cercada el área destinada al cultivo?">
            <Opciones opciones={SI_NO} valor={data.p4_area_delimitada} onChange={(v) => set('p4_area_delimitada', v)} />
          </Pregunta>

          <Pregunta numero="5" texto="¿Las condiciones del terreno permiten iniciar siembra de plátano y maderables?">
            <Opciones opciones={SI_NO} valor={data.p5_condiciones_siembra} onChange={(v) => set('p5_condiciones_siembra', v)} />
          </Pregunta>

          <Pregunta
            numero="5.1"
            texto="¿Qué recomendaciones se brindaron para la selección, preparación y manejo del material vegetal?"
          >
            <Text style={styles.itemAyuda}>Responde el técnico.</Text>
            {campoAbierto('p5_1_recomendaciones_material', 'Escribe las recomendaciones')}
          </Pregunta>

          <Pregunta
            numero="6"
            texto="¿Se identifican problemas de drenaje o condiciones físicas del suelo que puedan afectar el establecimiento y desarrollo del cultivo de plátano y maderables?"
          >
            <Opciones
              opciones={SI_NO}
              valor={data.p6_problemas_drenaje}
              onChange={(v) => {
                set('p6_problemas_drenaje', v);
                // Al pasar a "No" se limpia la lista para no guardar respuestas huérfanas.
                if (v !== 'Sí') {
                  set('p6_problemas', []);
                  set('p6_otro', '');
                }
              }}
            />
            {data.p6_problemas_drenaje === 'Sí' && (
              <View style={styles.subPregunta}>
                <Text style={styles.fieldLabel}>
                  ¿Cuáles de los siguientes problemas se presentan en el terreno? (puedes seleccionar varias)
                </Text>
                <View style={styles.chipsRow}>
                  {PROBLEMAS_SUELO_OPTS.map((op) => {
                    const activo = data.p6_problemas.includes(op);
                    return (
                      <TouchableOpacity
                        key={op}
                        style={[styles.chip, activo && styles.chipActivo]}
                        onPress={() => {
                          alternarProblema(op);
                          if (op === 'Otro' && activo) set('p6_otro', '');
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText, activo && styles.chipTextActivo]}>
                          {activo ? '☑ ' : '☐ '}
                          {op}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {data.p6_problemas.includes('Otro') && (
                  <TextInput
                    style={[styles.input, styles.espacioArriba]}
                    value={data.p6_otro}
                    onChangeText={(v) => set('p6_otro', v)}
                    placeholder="Otro, ¿cuál?"
                    placeholderTextColor={COLORS.textLight}
                  />
                )}
              </View>
            )}
          </Pregunta>

          <Pregunta
            numero="7"
            texto="¿Qué medidas preventivas debe implementar el productor para proteger el cultivo durante el establecimiento?"
          >
            {campoAbierto('p7_medidas_preventivas', 'Escribe la respuesta')}
          </Pregunta>

          <Pregunta
            numero="8"
            texto="¿Cuáles son las recomendaciones técnicas que debe implementar el productor para completar la adecuación del terreno?"
          >
            {campoAbierto('p8_recomendaciones_adecuacion', 'Escribe las recomendaciones')}
          </Pregunta>

          <Pregunta numero="9" texto="¿Qué sistema de trazado se utilizará para distribuir las plantas de plátano y maderables?">
            <Opciones opciones={SISTEMA_TRAZADO_OPTS} valor={data.p9_sistema_trazado} onChange={(v) => set('p9_sistema_trazado', v)} />
          </Pregunta>

          <Pregunta numero="10" texto="¿Qué criterio se tendrá en cuenta para definir la orientación de los surcos?">
            <Opciones
              opciones={ORIENTACION_SURCOS_OPTS}
              valor={data.p10_orientacion_surcos}
              onChange={(v) => set('p10_orientacion_surcos', v)}
            />
          </Pregunta>

          <Pregunta numero="11" texto="¿Cómo se manejará el drenaje del terreno dentro del arreglo del cultivo?">
            <Opciones opciones={MANEJO_DRENAJE_OPTS} valor={data.p11_manejo_drenaje} onChange={(v) => set('p11_manejo_drenaje', v)} />
          </Pregunta>

          <Pregunta numero="12" texto="¿Qué actividades requieren ajustes antes de iniciar la siembra?">
            {campoAbierto('p12_ajustes_previos', 'Escribe la respuesta')}
          </Pregunta>
        </ItemCard>

        {/* ─── 5. Seguimiento a compromisos ──────────────── */}
        <ItemCard
          numero={5}
          titulo="Seguimiento a compromisos"
          ayuda="Preguntas o compromisos a verificar"
          completo={faltantesV3(data).every((x) => !x.startsWith('Seguimiento'))}
        >
          {COMPROMISOS_V3.map(({ clave, pregunta, opciones }, i) => {
            const c = data.compromisos[clave];
            return (
              <Pregunta key={clave} numero={String(i + 1)} texto={pregunta}>
                <Opciones
                  opciones={opciones}
                  valor={c.estado}
                  onChange={(v) =>
                    // Al salir de "Parcial" se limpia el porcentaje.
                    setCompromiso(clave, v === 'Parcial' ? { estado: v } : { estado: v, porcentaje: '', porcentaje_otro: '' })
                  }
                />
                {c.estado === 'Parcial' && (
                  <View style={styles.subPregunta}>
                    <DropdownPicker
                      label="Porcentaje de cumplimiento"
                      value={c.porcentaje || null}
                      options={PORCENTAJES_PARCIAL}
                      onSelect={(v) =>
                        setCompromiso(clave, v === 'Otro' ? { porcentaje: v } : { porcentaje: v, porcentaje_otro: '' })
                      }
                      placeholder="Seleccionar porcentaje"
                      required
                    />
                    {c.porcentaje === 'Otro' && (
                      <View style={[styles.porcentajeRow, styles.espacioArriba]}>
                        <TextInput
                          style={[styles.input, styles.inputPorcentaje]}
                          value={c.porcentaje_otro}
                          onChangeText={(v) => setCompromiso(clave, { porcentaje_otro: sanearPorcentajeManual(v) })}
                          keyboardType="number-pad"
                          maxLength={2}
                          placeholder="0"
                          placeholderTextColor={COLORS.textLight}
                        />
                        <Text style={styles.porcentajeSigno}>%</Text>
                      </View>
                    )}
                  </View>
                )}
              </Pregunta>
            );
          })}

          <Pregunta
            numero="5"
            texto="¿Las actividades realizadas cumplen con las recomendaciones técnicas impartidas en la visita anterior?"
          >
            <Opciones
              opciones={CUMPLE_RECOMENDACIONES_OPTS}
              valor={data.cumple_recomendaciones}
              onChange={(v) => set('cumple_recomendaciones', v)}
            />
          </Pregunta>

          <Pregunta numero="6" texto="¿Qué dificultades se presentaron para cumplir los compromisos establecidos?">
            {campoAbierto('dificultades', 'Escribe la respuesta')}
          </Pregunta>
        </ItemCard>

        {/* ─── 6. Observaciones y recomendaciones ────────── */}
        <ItemCard
          numero={6}
          titulo="Observaciones y recomendaciones"
          completo={!!data.observaciones.trim() && !!data.recomendaciones.trim()}
        >
          <Text style={styles.fieldLabel}>Observaciones durante la visita</Text>
          {campoAbierto('observaciones', 'Describir situaciones anormales al proceso', true)}

          <Text style={[styles.fieldLabel, styles.espacioArriba]}>Recomendaciones</Text>
          {campoAbierto('recomendaciones', 'Escribe las recomendaciones', true)}
        </ItemCard>

        {/* ─── 7. Evidencias (mismo diseño que el form 1) ─── */}
        <View style={[styles.sectionCard, { borderLeftColor: '#0984E3' }]}>
          <View style={[styles.sectionHeader, { backgroundColor: '#0984E312' }]}>
            <Text style={[styles.sectionTitle, { color: '#0984E3', flex: 1 }]}>📸  EVIDENCIAS</Text>
            {requisitosCumplidos === requisitosEvidencia.length && (
              <View style={styles.sectionOkBadge}>
                <Text style={styles.sectionOkBadgeText}>✓</Text>
              </View>
            )}
          </View>
          <View style={styles.sectionBody}>
            <TouchableOpacity
              style={[styles.evidenciaCard, fotosOk && styles.evidenciaCardOk]}
              onPress={() => abrirCamara('photo')}
              activeOpacity={0.7}
            >
              <View style={styles.evidenciaIcon}>
                <Text style={styles.evidenciaIconText}>📷</Text>
              </View>
              <View style={styles.evidenciaContent}>
                <Text style={styles.evidenciaCardTitle}>Tomar Fotos</Text>
                <Text style={styles.evidenciaCardDesc}>
                  {fotosSolo.length > 0
                    ? `${fotosSolo.length} de máximo ${MAX_FOTOS} foto(s) tomada(s)`
                    : 'Fotos del beneficiario, el técnico y el terreno'}
                </Text>
                <Text style={styles.evidenciaCardNota}>
                  Máximo {MAX_FOTOS} fotos: 4 de realización de actividades + 1 del cuaderno de visita
                </Text>
              </View>
              <Text style={styles.evidenciaArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.evidenciaCard, videosSolo.length >= 1 && styles.evidenciaCardOk]}
              onPress={() => abrirCamara('video')}
              activeOpacity={0.7}
            >
              <View style={styles.evidenciaIcon}>
                <Text style={styles.evidenciaIconText}>🎥</Text>
              </View>
              <View style={styles.evidenciaContent}>
                <Text style={styles.evidenciaCardTitle}>Tomar Video</Text>
                <Text style={styles.evidenciaCardDesc}>
                  {videosSolo.length > 0 ? `${videosSolo.length} video(s) grabado(s)` : 'Grabar video corto (máx. 30s)'}
                </Text>
              </View>
              <Text style={styles.evidenciaArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.evidenciaCard, firmaBeneficiarioOk && styles.evidenciaCardOk]}
              onPress={() => navigation.navigate('FirmaBeneficiario')}
              activeOpacity={0.7}
            >
              <View style={styles.evidenciaIcon}>
                <Text style={styles.evidenciaIconText}>✍️</Text>
              </View>
              <View style={styles.evidenciaContent}>
                <Text style={styles.evidenciaCardTitle}>Firma del Beneficiario</Text>
                <Text style={styles.evidenciaCardDesc}>
                  {firmaBeneficiarioOk ? 'Firma registrada ✓' : 'Capturar firma del beneficiario'}
                </Text>
              </View>
              <Text style={styles.evidenciaArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.evidenciaCard, firmaTecnicoOk && styles.evidenciaCardOk]}
              onPress={() => navigation.navigate('FirmaDigital')}
              activeOpacity={0.7}
            >
              <View style={styles.evidenciaIcon}>
                <Text style={styles.evidenciaIconText}>🖊️</Text>
              </View>
              <View style={styles.evidenciaContent}>
                <Text style={styles.evidenciaCardTitle}>Firma del Técnico en Terreno</Text>
                <Text style={styles.evidenciaCardDesc}>
                  {firmaTecnicoOk ? 'Firma registrada ✓' : 'Capturar firma del técnico'}
                </Text>
              </View>
              <Text style={styles.evidenciaArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.evidenciaCard, huellaOk && styles.evidenciaCardOk]}
              onPress={() => navigation.navigate('FirmaBiometrica')}
              activeOpacity={0.7}
            >
              <View style={styles.evidenciaIcon}>
                <Text style={styles.evidenciaIconText}>🖐️</Text>
              </View>
              <View style={styles.evidenciaContent}>
                <Text style={styles.evidenciaCardTitle}>Huella Biométrica del Beneficiario</Text>
                <Text style={styles.evidenciaCardDesc}>
                  {huellaOk ? 'Huella registrada ✓' : 'Escanear huella del beneficiario'}
                </Text>
              </View>
              <Text style={styles.evidenciaArrow}>›</Text>
            </TouchableOpacity>

            {/* Georreferenciación: misma captura de alta precisión de la pregunta 20 del form 1 */}
            <View
              style={[
                styles.evidenciaCard,
                styles.evidenciaCardColumna,
                ubicacionOk && styles.evidenciaCardOk,
              ]}
            >
              <View style={styles.evidenciaFila}>
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>📍</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Tomar georeferenciación - ubicación</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {ubicacionOk
                      ? 'Ubicación registrada ✓'
                      : 'Captura GPS de alta precisión del lugar de la visita (obligatoria)'}
                  </Text>
                </View>
              </View>
              <CapturaGPSPrecisa
                label="Coordenada de la visita"
                latitud={data.ubicacion_latitud}
                longitud={data.ubicacion_longitud}
                altitud={data.ubicacion_altitud}
                precision={data.ubicacion_precision}
                ubicacionTexto={[beneficiario?.municipio, beneficiario?.vereda || beneficiario?.corregimiento]
                  .filter(Boolean)
                  .join(' · ')}
                onCapture={capturarUbicacion}
                obligatoria
              />
            </View>

            <Text style={styles.evidenciasProgress}>
              {requisitosCumplidos} de {requisitosEvidencia.length} requisitos obligatorios completados
              {'\n'}Solo la huella biométrica es opcional
            </Text>
          </View>
        </View>
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

      <SelectorBeneficiarioModal
        visible={mostrarSelectorBenef}
        tecnicoId={user?.id}
        numeroVisita={VISITA3_NUMERO}
        cedulaActual={beneficiario?.cedula}
        onSeleccionar={elegirNuevoBeneficiario}
        onCerrar={() => setMostrarSelectorBenef(false)}
      />
    </KeyboardAvoidingView>
  );
};

export default VisitaTecnica3FormScreen;

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
  linkBtn: { marginTop: SPACING.sm, alignSelf: 'flex-start' },
  linkBtnText: { fontSize: FONTS.sizes.sm, color: COLORS.primary, fontWeight: FONTS.weights.medium },

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

  pregunta: { marginBottom: SPACING.lg },
  preguntaTexto: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
    lineHeight: 19,
    marginBottom: SPACING.xs,
  },
  subPregunta: {
    marginTop: SPACING.sm,
    paddingLeft: SPACING.sm,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.divider,
  },
  espacioArriba: { marginTop: SPACING.sm },

  // ─── Evidencias (mismo diseño que el form 1) ───
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderLeftWidth: 4,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
    overflow: 'hidden',
  },
  sectionHeader: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionOkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.sm,
  },
  sectionOkBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' },
  sectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  evidenciaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  evidenciaCardColumna: { flexDirection: 'column', alignItems: 'stretch' },
  evidenciaFila: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.xs },
  evidenciaCardOk: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '08',
  },
  evidenciaIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  evidenciaIconText: { fontSize: 24 },
  evidenciaContent: { flex: 1 },
  evidenciaCardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  evidenciaCardDesc: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  evidenciaCardNota: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2, fontStyle: 'italic' },
  evidenciaArrow: { fontSize: 28, color: '#b2bec3', fontWeight: '300', marginLeft: SPACING.sm },
  evidenciasProgress: {
    textAlign: 'center',
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
});
