// ============================================================
// GEODAILY — Encuesta Social AgroAmbiental
// Pantalla única con todas las secciones, dropdowns y checklist
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
  Platform,
  ActivityIndicator,
  AppState,
  Switch,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '../../components/AppBackground';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useForm } from '../../store/FormContext';
import { useSync } from '../../store/SyncContext';
import { useLocation } from '../../hooks/useLocation';
import { resolverClimaYUbicacion } from '../../services/climate.service';
import {
  getVeredasByMunicipio,
  SINO_OPTS,
  RECONOCIMIENTO_OPTS,
  NIVEL_EDUCATIVO_ENV_OPTS,
  FUENTE_INGRESOS_ENV_OPTS,
  OCUPACION_SECUNDARIA_OPTS,
  TIPO_ASOCIACION_OPTS,
  VIVIENDA_UBICACION_OPTS,
  TIPO_ENERGIA_OPTS,
  AGUA_CONSUMO_OPTS,
  ELEMENTOS_TECNOLOGICOS_OPTS,
  QUIENES_TRABAJAN_OPTS,
  MEDIO_TRANSPORTE_OPTS,
  MEDIO_SALIDA_OPTS,
  ACTIVIDADES_FINCA_OPTS,
  ACTIVIDAD_AGRICOLA_OPTS,
  ACTIVIDAD_PECUARIA_OPTS,
  SEXO_OPTS,
  ACTIVIDAD_PRODUCTIVA_OPTS,
  ANALISIS_SUELO_REALIZADO_OPTS,
  TEXTURA_SUELO_OPTS,
  COLOR_SUELO_OPTS,
  DRENAJE_OPTS,
  USO_TIERRA_HISTORICO_OPTS,
  PRESENCIA_PIEDRAS_OPTS,
  COMPACTACION_OPTS,
  COBERTURA_SUELO_OPTS,
  EVIDENCIA_EROSION_OPTS,
  PROCESOS_EROSION_OPTS,
  FUENTES_HIDRICAS_OPTS,
  PRACTICAS_CONSERVACION_OPTS,
  AREAS_CONSERVACION_OPTS,
  TIPO_AGROQUIMICO_OPTS,
  MANEJO_RESIDUOS_OPTS,
  INGRESOS_SALARIOS_OPTS,
} from '../../utils/constants';
import { guardarBorrador, getBorrador, cargarBorradores, FormDraft, obtenerUltimoErrorBorrador } from '../../store/FormDraftStore';
import {
  saveFormularioLocal,
  getFormularioById,
  getDb,
  saveFotoLocal,
  saveVideoLocal,
  getDocumentosDeBeneficiario,
  vincularDocumentosHuerfanos,
} from '../../services/database';
import {
  EncuestaSocialAgroAmbiental,
  ComponenteSocialEncuesta,
  CaracterizacionFinca,
  ComponenteProductivoEncuesta,
  AnalisisSueloEncuesta,
  ComponenteAgroambientalEncuesta,
  RecomendacionesEncuesta,
  AcompaniamientoTecnico,
  ResumenClimatico,
  Coordenadas,
} from '../../types';
import DropdownPicker from '../../components/DropdownPicker';
import CapturaGPSPrecisa from '../../components/CapturaGPSPrecisa';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: RouteProp<Record<string, any> & { params: { draftId?: string } }, 'params'>;
};

// Claves de las secciones del formulario (para el check verde y la validación)
type SectionKey =
  | 'datos'
  | 'social'
  | 'finca'
  | 'productivo'
  | 'suelo'
  | 'agroambiental'
  | 'recomendaciones'
  | 'acompanamiento'
  | 'evidencias';

// ─── Estados iniciales vacíos ────────────────────────────────
const EMPTY_SOCIAL: ComponenteSocialEncuesta = {
  reconocimiento: '',
  reconocimiento_otro: '',
  nivel_educativo: '',
  participo_eca: '',
  personas_nucleo: '',
  fuente_ingresos: '',
  fuente_ingresos_otra: '',
  ingresos_salarios: '',
  ocupacion_secundaria: '',
  ocupacion_secundaria_otro: '',
  participa_organizacion: '',
  organizacion_cual: '',
  tipo_asociacion: '',
  tipo_asociacion_otro: '',
  rol_asociacion: '',
  vivienda_ubicacion: '',
  vivienda_ubicacion_otra: '',
  energia_electrica: '',
  tipo_energia: '',
  tipo_energia_otro: '',
  agua_consumo: '',
  agua_consumo_otro: '',
  elementos_tecnologicos: '',
  senal_celular: '',
  quienes_trabajan: '',
  quienes_trabajan_otro: '',
  medio_transporte: '',
  medio_transporte_otro: '',
};

const EMPTY_FINCA: CaracterizacionFinca = {
  nombre_finca: '',
  latitud: '',
  longitud: '',
  altitud: '',
  area_total: '',
  division_bosque: '',
  division_agricola: '',
  division_pecuaria: '',
  division_instalaciones: '',
  medio_salida: '',
  medio_salida_otro: '',
  distancia_km: '',
  distancia_observaciones: '',
  aprovechamiento_directo: '',
  aprovechamiento_porque: '',
  actividades_finca: '',
  actividades_finca_otro: '',
  actividades_agricolas: '',
  actividades_agricolas_otro: '',
  actividades_pecuarias: '',
  actividades_pecuarias_otro: '',
};

const EMPTY_PRODUCTIVO: ComponenteProductivoEncuesta = {
  actividad_principal: '',
  actividad_principal_cual: '',
  acceso_agua: '',
  sistemas_riego: '',
  asistencia_tecnica: '',
};

const EMPTY_ANALISIS: AnalisisSueloEncuesta = {
  intervencion_latitud: '',
  intervencion_longitud: '',
  intervencion_altitud: '',
  analisis_realizado: '',
  textura: '',
  color: '',
  drenaje: '',
  uso_tierra: '',
  piedras: '',
  compactacion: '',
  cobertura: '',
  erosion: '',
  pendiente: '',
};

const EMPTY_AGROAMBIENTAL: ComponenteAgroambientalEncuesta = {
  procesos_erosion: '',
  fuentes_hidricas: '',
  areas_conservacion: '',
  practicas_conservacion: '',
  uso_agroquimicos: '',
  tipo_agroquimicos: '',
  tipo_agroquimicos_otro: '',
  herbicidas_cuales: '',
  manejo_residuos: '',
};

const EMPTY_RECOMENDACIONES: RecomendacionesEncuesta = {
  recomendaciones_tecnicas: '',
  compromisos_productor: '',
  recomendaciones_ambientales: '',
};

const EMPTY_ACOMPANAMIENTO: AcompaniamientoTecnico = {
  actividades_realizadas_si: false,
  actividades_realizadas_no: false,
  actividades_realizadas_obs: '',
  manejo_plagas_si: false,
  manejo_plagas_no: false,
  manejo_plagas_obs: '',
  manejo_plagas_hectareas: '',
  manejo_suelo_si: false,
  manejo_suelo_no: false,
  manejo_suelo_obs: '',
  manejo_suelo_cantidad: '',
  capacitacion_si: false,
  capacitacion_no: false,
  capacitacion_obs: '',
  seguimiento_si: false,
  seguimiento_no: false,
  seguimiento_obs: '',
  entresacado_si: false,
  entresacado_no: false,
  entresacado_obs: '',
  observaciones_visita: '',
};

const EMPTY_ENCUESTA: EncuestaSocialAgroAmbiental = {
  municipio: 'Puerto Rico',
  fecha: format(new Date(), 'dd/MM/yyyy', { locale: es }),
  vereda: '',
  productor_nombre: '',
  edad: '',
  sexo: '',
  sexo_otro: '',
  documento: '',
  telefono: '',
  tecnico_responsable: '',
  tecnico_cedula: '',
  corregimiento: '',
  componente_social: { ...EMPTY_SOCIAL },
  caracterizacion_finca: { ...EMPTY_FINCA },
  componente_productivo: { ...EMPTY_PRODUCTIVO },
  analisis_suelo: { ...EMPTY_ANALISIS },
  componente_agroambiental: { ...EMPTY_AGROAMBIENTAL },
  recomendaciones: { ...EMPTY_RECOMENDACIONES },
  acompaniamiento: { ...EMPTY_ACOMPANAMIENTO },
};

// ─── Componente ──────────────────────────────────────────────
const EncuestaSocialAgroambientalScreen: React.FC<Props> = ({ navigation, route }) => {
  const { user } = useAuth();
  const {
    iniciarFormulario,
    setTecnico,
    setBeneficiario,
    setCoordenadas,
    addFoto,
    setFirmaBeneficiario,
    setFirmaTecnico,
    setHuella,
    setCaracterizacionNueva,
    finalizarFormulario,
    formularioActual,
  } = useForm();
  const { syncNow } = useSync();
  const { getCurrentPosition, coordenadas } = useLocation();
  /**
   * Nombre de lugar y clima resueltos por separado — antes venían unidos
   * en `useClimate()`/`climaActual` y si no había señal para el clima,
   * tampoco quedaba ningún nombre de lugar en el formulario.
   */
  const [lugarResuelto, setLugarResuelto] = useState<string | null>(null);
  const [climaResuelto, setClimaResuelto] = useState<ResumenClimatico | null>(null);
  const insets = useSafeAreaInsets();

  const draftId = route.params.draftId;

  // ─── Estado del formulario ────────────────────────────────
  const [data, setData] = useState<EncuestaSocialAgroAmbiental>({ ...EMPTY_ENCUESTA });
  const [selectedMunicipio, setSelectedMunicipio] = useState('Puerto Rico');
  const [datosBloqueados, setDatosBloqueados] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Evidencias
  // `fotos` en el contexto guarda fotos Y videos (diferenciados por
  // `tipo`), por eso se cuentan por separado: si no, un video marcaba en
  // verde la tarjeta de "Tomar Fotos" y viceversa.
  const [fotosCount, setFotosCount] = useState(0);
  const [videosCount, setVideosCount] = useState(0);
  const [firmaBeneficiarioOk, setFirmaBeneficiarioOk] = useState(false);
  const [firmaTecnicoOk, setFirmaTecnicoOk] = useState(false);
  const [huellaOk, setHuellaOk] = useState(false);
  const [documentosCount, setDocumentosCount] = useState(0);

  const formIdRef = useRef<string>('');
  const formularioRef = useRef(formularioActual);
  useEffect(() => { formularioRef.current = formularioActual; }, [formularioActual]);
  /** Se activa al completar con éxito para que el autoguardado (interval,
   *  AppState, cleanup al desmontar) deje de recrear el borrador que ya
   *  se eliminó — sin tocar el autoguardado normal durante el llenado. */
  const completadoRef = useRef(false);
  /** Cédula del productor — leída en callbacks que no dependen de `data` */
  const documentoRef = useRef('');
  useEffect(() => { documentoRef.current = data.documento?.trim() || ''; }, [data.documento]);
  /**
   * Coordenada restaurada de un borrador. Se guarda aparte para que el GPS
   * de apertura no la pise (ver "Capturar ubicación" en el efecto de init).
   */
  const coordsDeBorradorRef = useRef<Coordenadas | null>(null);

  /**
   * Aplica un borrador al estado del formulario: datos (fusionados contra los
   * EMPTY_* para tolerar borradores de versiones anteriores), evidencias y el
   * resto de campos de contexto.
   */
  const aplicarBorrador = useCallback(
    (draft: FormDraft) => {
      // ⚠️ ORDEN CRÍTICO — esto va PRIMERO, antes de restaurar evidencias.
      // `iniciarFormulario` con un id DISTINTO al que tiene el contexto ahora
      // hace que el reducer recree `formularioActual` con `fotos: []`,
      // firmas vacías y `huella_beneficiario: false`. Despacharlo después de
      // addFoto/setFirma*/setHuella borraba del contexto toda la evidencia
      // recién restaurada: el formulario abría con los datos correctos pero
      // con 0 fotos — exactamente el reporte "se me eliminó toda la
      // información". Con el id ya fijado, el reducer conserva la evidencia
      // (early return por mismo id) y las fotos que se añaden después se
      // suman. No reordenar este bloque.
      formIdRef.current = draft.id;
      iniciarFormulario('caracterizacion', draft.id);

      if (draft.caracterizacion_nueva) {
        const d = draft.caracterizacion_nueva as unknown as Partial<EncuestaSocialAgroAmbiental>;
        setData({
          ...EMPTY_ENCUESTA,
          ...d,
          componente_social: { ...EMPTY_SOCIAL, ...(d.componente_social || {}) },
          caracterizacion_finca: { ...EMPTY_FINCA, ...(d.caracterizacion_finca || {}) },
          componente_productivo: { ...EMPTY_PRODUCTIVO, ...(d.componente_productivo || {}) },
          analisis_suelo: { ...EMPTY_ANALISIS, ...(d.analisis_suelo || {}) },
          componente_agroambiental: { ...EMPTY_AGROAMBIENTAL, ...(d.componente_agroambiental || {}) },
          recomendaciones: { ...EMPTY_RECOMENDACIONES, ...(d.recomendaciones || {}) },
          acompaniamiento: { ...EMPTY_ACOMPANAMIENTO, ...(d.acompaniamiento || {}) },
        });
        if ((draft.caracterizacion_nueva as any).municipio) {
          setSelectedMunicipio((draft.caracterizacion_nueva as any).municipio);
        }
      }
      // Restaurar evidencias guardadas en el borrador (ADD_FOTO es idempotente)
      if (draft.fotos && draft.fotos.length > 0) {
        for (const foto of draft.fotos) {
          addFoto(foto);
        }
      }
      if (draft.firma_beneficiario) setFirmaBeneficiario(draft.firma_beneficiario);
      if (draft.firma_tecnico) setFirmaTecnico(draft.firma_tecnico);
      if (draft.huella_beneficiario) setHuella(true);
      if (draft.coordenadas) {
        // Se recuerda aparte para que el GPS de apertura no la sobrescriba.
        coordsDeBorradorRef.current = draft.coordenadas;
        setCoordenadas(draft.coordenadas);
      }
      // El bloqueo de vereda/corregimiento (datos del padrón) se perdía al
      // recuperar el borrador.
      if (draft.datosBloqueados) setDatosBloqueados(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addFoto, setFirmaBeneficiario, setFirmaTecnico, setHuella, setCoordenadas, iniciarFormulario]
  );

  // ─── Inicializar ──────────────────────────────────────────
  useEffect(() => {
    iniciarFormulario('caracterizacion', draftId);

    // Autocompletar técnico desde el usuario autenticado
    if (user) {
      setData((prev) => ({
        ...prev,
        tecnico_responsable: user.nombre || '',
        tecnico_cedula: user.cedula || '',
      }));
    }

    const init = async () => {
      // Cargar borrador si existe
      if (draftId) {
        const draft = await getBorrador(draftId);
        if (draft) {
          // ⚠️ ORDEN CRÍTICO: fijar el id del borrador ANTES de restaurar
          // evidencias. Si se hiciera al final, el reducer recrearía el
          // formulario y borraría las fotos/firmas recién restauradas. Mismo
          // motivo que en `aplicarBorrador`.
          formIdRef.current = draft.id;
          iniciarFormulario('caracterizacion', draft.id);
        }
        if (draft?.caracterizacion_nueva) {
          // Fusión profunda con los EMPTY_*: los borradores creados con la
          // versión anterior de la encuesta no traen los campos nuevos y
          // dejarían inputs sin controlar (undefined).
          const d = draft.caracterizacion_nueva as unknown as Partial<EncuestaSocialAgroAmbiental>;
          setData({
            ...EMPTY_ENCUESTA,
            ...d,
            componente_social: { ...EMPTY_SOCIAL, ...(d.componente_social || {}) },
            caracterizacion_finca: { ...EMPTY_FINCA, ...(d.caracterizacion_finca || {}) },
            componente_productivo: { ...EMPTY_PRODUCTIVO, ...(d.componente_productivo || {}) },
            analisis_suelo: { ...EMPTY_ANALISIS, ...(d.analisis_suelo || {}) },
            componente_agroambiental: { ...EMPTY_AGROAMBIENTAL, ...(d.componente_agroambiental || {}) },
            recomendaciones: { ...EMPTY_RECOMENDACIONES, ...(d.recomendaciones || {}) },
            acompaniamiento: { ...EMPTY_ACOMPANAMIENTO, ...(d.acompaniamiento || {}) },
          });
          if ((draft.caracterizacion_nueva as any).municipio) {
            setSelectedMunicipio((draft.caracterizacion_nueva as any).municipio);
          }
        }
        // Restaurar evidencias guardadas en el borrador
        if (draft?.fotos && draft.fotos.length > 0) {
          for (const foto of draft.fotos) {
            addFoto(foto);
          }
        }
        if (draft?.firma_beneficiario) setFirmaBeneficiario(draft.firma_beneficiario);
        if (draft?.firma_tecnico) setFirmaTecnico(draft.firma_tecnico);
        if (draft?.huella_beneficiario) setHuella(true);
        // La ubicación capturada también se restauraba a medias: el borrador
        // la guardaba, pero al reabrir se volvía a pedir GPS y se perdía la
        // original si no había señal.
        if (draft?.coordenadas) {
          coordsDeBorradorRef.current = draft.coordenadas;
          setCoordenadas(draft.coordenadas);
        }
        if (draft?.datosBloqueados) setDatosBloqueados(true);
      } else {
        // Si NO hay borrador pero viene beneficiario precargado desde
        // SeleccionarTipoFormulario, pre-llenar nombre y documento
        const benefPrecargado = formularioActual?.beneficiario;
        if (benefPrecargado?.nombre || benefPrecargado?.cedula) {
          setData(prev => ({
            ...prev,
            productor_nombre: benefPrecargado.nombre || prev.productor_nombre,
            documento: benefPrecargado.cedula || prev.documento,
            vereda: benefPrecargado.vereda || prev.vereda,
            corregimiento: benefPrecargado.corregimiento || prev.corregimiento,
          }));
          if (benefPrecargado.vereda || benefPrecargado.corregimiento) {
            setDatosBloqueados(true);
          }
        } else {
          // ─── Recuperación del trabajo en curso ──────────────────────────
          // Antes, entrar a una encuesta NUEVA (sin `draftId` en la ruta)
          // nunca buscaba un borrador existente: se creaba un formulario en
          // blanco y el borrador anterior quedaba huérfano. El técnico veía
          // un formulario vacío "como si lo hubiera abierto por primera vez"
          // y su trabajo parecía borrado. Ahora, si existe un borrador
          // propio reciente, se le ofrece continuarlo.
          try {
            const borradores = await cargarBorradores();
            const propios = borradores
              .filter((d) => d.tipo === 'caracterizacion')
              .filter((d) => {
                // Los borradores sin dueño asignado (creados mientras la
                // sesión todavía se restauraba) también se ofrecen: es
                // preferible recuperar de más que dejar trabajo perdido.
                const t = d.tecnico || ({} as FormDraft['tecnico']);
                if (user?.id && t.usuario_id) return t.usuario_id === user.id;
                if (user?.cedula && t.cedula) return t.cedula === user.cedula;
                return true;
              })
              .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

            const candidato = propios[0];
            if (candidato) {
              const nombre = candidato.beneficiario?.nombre || 'sin nombre';
              const vereda = candidato.beneficiario?.vereda || '';
              const cuando = candidato.updated_at
                ? new Date(candidato.updated_at).toLocaleString()
                : 'hace un momento';
              Alert.alert(
                '📝 Tienes un formulario sin terminar',
                `Se encontró una encuesta guardada de "${nombre}"${vereda ? ` (${vereda})` : ''} del ${cuando}.\n\n¿Quieres continuar donde la dejaste?`,
                [
                  {
                    // El borrador NO se borra: sigue disponible en
                    // "Formularios Incompletos" por si se arrepiente.
                    text: 'Empezar de cero',
                    style: 'cancel',
                  },
                  { text: 'Continuar', onPress: () => aplicarBorrador(candidato) },
                ],
                { cancelable: false }
              );
            }
          } catch (e) {
            console.warn('[Encuesta] No se pudo buscar borradores pendientes:', e);
          }
        }
      }

      // Capturar ubicación
      const coords = await getCurrentPosition();
      // Si el borrador recuperado ya traía la ubicación donde se levantó la
      // encuesta, ESA manda: el GPS de ahora puede ser otro punto (el técnico
      // reabre la encuesta al día siguiente desde otra vereda) y antes la
      // pisaba siempre, perdiendo la coordenada original. Si no hay borrador,
      // se usa la del GPS como antes.
      const coordsBorrador = coordsDeBorradorRef.current;
      if (coords && !coordsBorrador) {
        setCoordenadas(coords);
      }
      const coordsFinales = coordsBorrador || coords;
      if (coordsFinales) {
        // Best-effort: sin señal, el formulario se guarda igual con las
        // coordenadas crudas; nombre de lugar y clima quedan pendientes y
        // se resuelven solos en el próximo sync.
        resolverClimaYUbicacion(coordsFinales.latitud, coordsFinales.longitud, coordsFinales.timestamp)
          .then(({ lugar, resumen }) => {
            if (lugar) setLugarResuelto(lugar);
            if (resumen) setClimaResuelto(resumen);
          })
          .catch((e) => console.warn('[Encuesta] No se pudo resolver clima/ubicación:', e));
      } else {
        // Aviso NO bloqueante: en campo, sin señal, un modal al abrir la
        // encuesta es puro estorbo (y el técnico termina cerrándolo de
        // memoria). El formulario se llena igual y la coordenada real la
        // toma la pregunta "Captura GPS precisa" al completar.
        console.warn('[Encuesta] Sin ubicación GPS al abrir el formulario');
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincronizar formIdRef con el ID real del contexto cuando esté disponible
  useEffect(() => {
    if (formularioActual?.id) {
      formIdRef.current = formularioActual.id;
    }
  }, [formularioActual?.id]);

  // Si la sesión del técnico se restaura DESPUÉS de montar la pantalla (lo
  // normal al arrancar en frío sin internet), el usuario llegaba tarde y
  // `tecnico_responsable` quedaba vacío — el formulario no se podía completar
  // ni aparecía en "Formularios Incompletos". Aquí se rellena en cuanto
  // aparece el usuario, sin pisar lo que el técnico ya haya escrito.
  useEffect(() => {
    if (!user) return;
    setData((prev) => {
      const nombre = prev.tecnico_responsable || user.nombre || '';
      const cedula = prev.tecnico_cedula || user.cedula || '';
      if (nombre === prev.tecnico_responsable && cedula === prev.tecnico_cedula) {
        return prev;
      }
      return { ...prev, tecnico_responsable: nombre, tecnico_cedula: cedula };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.nombre, user?.cedula]);

  // Refrescar evidencias al volver de pantallas
  useFocusEffect(
    useCallback(() => {
      if (formularioActual) {
        const evidencias = formularioActual.fotos || [];
        setFotosCount(evidencias.filter((f) => f.tipo !== 'video').length);
        setVideosCount(evidencias.filter((f) => f.tipo === 'video').length);
        setFirmaBeneficiarioOk(!!formularioActual.firma_beneficiario);
        setFirmaTecnicoOk(!!formularioActual.firma_tecnico);
        setHuellaOk(!!formularioActual.huella_beneficiario);
      }
      const cargarDocs = async () => {
        const formId = formularioActual?.id || formIdRef.current;
        try {
          // Cuenta los documentos de la finca (por beneficiario), no solo
          // los de esta visita — así se ven los ya recolectados antes.
          const docs = await getDocumentosDeBeneficiario(
            documentoRef.current || undefined,
            formId || undefined
          );
          setDocumentosCount(docs.length);
        } catch (e) { /* Ignorar */ }
      };
      cargarDocs();
    }, [formularioActual])
  );

  // ─── Helpers ──────────────────────────────────────────────
  const updateData = useCallback((partial: Partial<EncuestaSocialAgroAmbiental>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  const updateSocial = useCallback((partial: Partial<ComponenteSocialEncuesta>) => {
    setData((prev) => ({
      ...prev,
      componente_social: { ...prev.componente_social, ...partial },
    }));
  }, []);

  const updateFinca = useCallback((partial: Partial<CaracterizacionFinca>) => {
    setData((prev) => ({
      ...prev,
      caracterizacion_finca: { ...prev.caracterizacion_finca, ...partial },
    }));
  }, []);

  const updateProductivo = useCallback((partial: Partial<ComponenteProductivoEncuesta>) => {
    setData((prev) => ({
      ...prev,
      componente_productivo: { ...prev.componente_productivo, ...partial },
    }));
  }, []);

  const updateAnalisis = useCallback((partial: Partial<AnalisisSueloEncuesta>) => {
    setData((prev) => ({
      ...prev,
      analisis_suelo: { ...prev.analisis_suelo, ...partial },
    }));
  }, []);

  const updateAgroambiental = useCallback((partial: Partial<ComponenteAgroambientalEncuesta>) => {
    setData((prev) => ({
      ...prev,
      componente_agroambiental: { ...prev.componente_agroambiental, ...partial },
    }));
  }, []);

  const updateRecomendaciones = useCallback((partial: Partial<RecomendacionesEncuesta>) => {
    setData((prev) => ({
      ...prev,
      recomendaciones: { ...prev.recomendaciones, ...partial },
    }));
  }, []);

  const updateAcompaniamiento = useCallback((partial: Partial<AcompaniamientoTecnico>) => {
    setData((prev) => ({
      ...prev,
      acompaniamiento: { ...prev.acompaniamiento, ...partial },
    }));
  }, []);

  // Veredas disponibles según municipio
  const veredasDisponibles = React.useMemo(() => {
    return getVeredasByMunicipio('Caquetá', selectedMunicipio);
  }, [selectedMunicipio]);

  // Municipio/vereda para mostrar como referencia sobre el mapa de captura GPS
  // (el mapa satelital no trae nombres de lugar — ver CapturaGPSPrecisa.tsx)
  const ubicacionGPSTexto = React.useMemo(
    () => [data.municipio, data.vereda || data.corregimiento].filter(Boolean).join(' · '),
    [data.municipio, data.vereda, data.corregimiento]
  );

  // ─── Toggle helper para checklist ─────────────────────────
  const toggleAcompaniamiento = useCallback((fieldSi: keyof AcompaniamientoTecnico, fieldNo: keyof AcompaniamientoTecnico, value: boolean) => {
    setData((prev) => ({
      ...prev,
      acompaniamiento: {
        ...prev.acompaniamiento,
        [fieldSi]: value,
        [fieldNo]: !value,
      },
    }));
  }, []);

  // ─── Validación de completitud ───────────────────────────
  // Calcula, sección por sección, qué espacios quedan sin responder. Una
  // pregunta se considera respondida cuando su valor no está vacío. Los
  // subcampos condicionales («¿Cuál?», «¿Por qué?») solo cuentan cuando la
  // opción que los muestra está activa. La huella y los documentos de la
  // finca son OPCIONALES; las 5 fotos, el video y las 2 firmas son
  // obligatorios.
  const validacion = React.useMemo(() => {
    const fill = (v?: string | null) => !!(v && String(v).trim());
    const faltas: Record<SectionKey, string[]> = {
      datos: [],
      social: [],
      finca: [],
      productivo: [],
      suelo: [],
      agroambiental: [],
      recomendaciones: [],
      acompanamiento: [],
      evidencias: [],
    };
    // `req` agrega la etiqueta a la sección cuando NO está respondida. Se
    // deduplica al final, porque una misma pregunta puede tener varios
    // subcampos (p. ej. la 22 tiene 4 áreas).
    const req = (sec: SectionKey, label: string, ok: boolean) => {
      if (!ok) faltas[sec].push(label);
    };

    const s = data.componente_social;
    const f = data.caracterizacion_finca;
    const p = data.componente_productivo;
    const a = data.analisis_suelo;
    const ag = data.componente_agroambiental;
    const r = data.recomendaciones;
    const ac = data.acompaniamiento;

    // ── DATOS GENERALES ──
    // Solo lo marcado con «*» en el formulario (Vereda, Nombre y Documento).
    // Edad, Sexo, Teléfono y Corregimiento son opcionales.
    req('datos', 'Vereda', fill(data.vereda));
    req('datos', 'Nombre del productor', fill(data.productor_nombre));
    req('datos', 'Documento (C.C.)', fill(data.documento));

    // ── COMPONENTE SOCIAL (1-18) ──
    req('social', '1', fill(s.reconocimiento));
    if (s.reconocimiento === 'Otro') req('social', '1', fill(s.reconocimiento_otro));
    req('social', '2', fill(s.nivel_educativo));
    req('social', '3', fill(s.participo_eca));
    req('social', '4', fill(s.personas_nucleo));
    req('social', '5', fill(s.fuente_ingresos));
    if (s.fuente_ingresos === 'Otra actividad') req('social', '5', fill(s.fuente_ingresos_otra));
    req('social', '6', fill(s.ingresos_salarios));
    req('social', '7', fill(s.ocupacion_secundaria));
    if (s.ocupacion_secundaria === 'Otro') req('social', '7', fill(s.ocupacion_secundaria_otro));
    req('social', '8', fill(s.participa_organizacion));
    if (s.participa_organizacion === 'Sí') req('social', '8', fill(s.organizacion_cual));
    // 9 y 10 quedan bloqueadas en «Ninguna» cuando la 8 es «No»
    if (s.participa_organizacion !== 'No') {
      req('social', '9', fill(s.tipo_asociacion));
      if (s.tipo_asociacion === 'Otro') req('social', '9', fill(s.tipo_asociacion_otro));
      req('social', '10', fill(s.rol_asociacion));
    }
    req('social', '11', fill(s.vivienda_ubicacion));
    if (s.vivienda_ubicacion === 'Otra') req('social', '11', fill(s.vivienda_ubicacion_otra));
    req('social', '12', fill(s.energia_electrica));
    req('social', '13', fill(s.tipo_energia));
    if (s.tipo_energia === 'Otro') req('social', '13', fill(s.tipo_energia_otro));
    req('social', '14', fill(s.agua_consumo));
    if (s.agua_consumo === 'Otro') req('social', '14', fill(s.agua_consumo_otro));
    req('social', '15', fill(s.elementos_tecnologicos));
    req('social', '16', fill(s.senal_celular));
    req('social', '17', fill(s.quienes_trabajan));
    if ((s.quienes_trabajan || '').split(', ').includes('Otro')) req('social', '17', fill(s.quienes_trabajan_otro));
    req('social', '18', fill(s.medio_transporte));
    if ((s.medio_transporte || '').split(', ').includes('Otro')) req('social', '18', fill(s.medio_transporte_otro));

    // ── CARACTERIZACIÓN DE LA FINCA (19-27) ──
    req('finca', '19', fill(f.nombre_finca));
    req('finca', '20', fill(f.latitud) && fill(f.longitud));
    req('finca', '21', fill(f.area_total));
    req('finca', '22', fill(f.division_bosque));
    req('finca', '22', fill(f.division_agricola));
    req('finca', '22', fill(f.division_pecuaria));
    req('finca', '22', fill(f.division_instalaciones));
    req('finca', '23', fill(f.medio_salida));
    req('finca', '24', fill(f.distancia_km));
    req('finca', '25', fill(f.distancia_observaciones));
    req('finca', '26', fill(f.aprovechamiento_directo));
    if (f.aprovechamiento_directo === 'No') req('finca', '26', fill(f.aprovechamiento_porque));
    req('finca', '27', fill(f.actividades_finca));
    if ((f.actividades_finca || '').includes('Actividades agrícolas')) {
      req('finca', '27', fill(f.actividades_agricolas));
      if ((f.actividades_agricolas || '').includes('Otro')) req('finca', '27', fill(f.actividades_agricolas_otro));
    }
    if ((f.actividades_finca || '').includes('Actividades pecuarias')) {
      req('finca', '27', fill(f.actividades_pecuarias));
      if ((f.actividades_pecuarias || '').includes('Otro')) req('finca', '27', fill(f.actividades_pecuarias_otro));
    }
    if ((f.actividades_finca || '').split(', ').includes('Otro')) req('finca', '27', fill(f.actividades_finca_otro));

    // ── COMPONENTE PRODUCTIVO (28-31) ──
    req('productivo', '28', fill(p.actividad_principal));
    req('productivo', '29', fill(p.acceso_agua));
    req('productivo', '30', fill(p.sistemas_riego));
    req('productivo', '31', fill(p.asistencia_tecnica));

    // ── SECCIÓN DE SUELO (32-42) ──
    req('suelo', '32', fill(a.intervencion_latitud) && fill(a.intervencion_longitud));
    req('suelo', '33', fill(a.analisis_realizado));
    req('suelo', '34', fill(a.textura));
    req('suelo', '35', fill(a.color));
    req('suelo', '36', fill(a.drenaje));
    req('suelo', '37', fill(a.uso_tierra));
    req('suelo', '38', fill(a.piedras));
    req('suelo', '39', fill(a.compactacion));
    req('suelo', '40', fill(a.cobertura));
    req('suelo', '41', fill(a.erosion));
    req('suelo', '42', fill(a.pendiente));

    // ── COMPONENTE AGROAMBIENTAL (43-50) ──
    req('agroambiental', '43', fill(ag.procesos_erosion));
    req('agroambiental', '44', fill(ag.fuentes_hidricas));
    req('agroambiental', '45', fill(ag.areas_conservacion));
    req('agroambiental', '46', fill(ag.practicas_conservacion));
    req('agroambiental', '47', fill(ag.uso_agroquimicos));
    // 48 y 49 quedan bloqueadas en «Ninguno» cuando la 47 es «No»
    if (ag.uso_agroquimicos !== 'No') {
      req('agroambiental', '48', fill(ag.tipo_agroquimicos));
      if (ag.tipo_agroquimicos === 'Otro') req('agroambiental', '48', fill(ag.tipo_agroquimicos_otro));
      req('agroambiental', '49', fill(ag.herbicidas_cuales));
    }
    req('agroambiental', '50', fill(ag.manejo_residuos));

    // ── RECOMENDACIONES DEL TÉCNICO (51-53) ──
    req('recomendaciones', '51', fill(r.recomendaciones_tecnicas));
    req('recomendaciones', '52', fill(r.compromisos_productor));
    req('recomendaciones', '53', fill(r.recomendaciones_ambientales));

    // ── DESARROLLO ACOMPAÑAMIENTO TÉCNICO ──
    req('acompanamiento', 'Acompañamiento 1', ac.actividades_realizadas_si || ac.actividades_realizadas_no);
    req('acompanamiento', 'Acompañamiento 2', fill(ac.manejo_plagas_hectareas));
    req('acompanamiento', 'Acompañamiento 3', fill(ac.manejo_suelo_cantidad));
    req('acompanamiento', 'Acompañamiento 4', ac.capacitacion_si || ac.capacitacion_no);
    req('acompanamiento', 'Acompañamiento 5', ac.seguimiento_si || ac.seguimiento_no);
    req('acompanamiento', 'Acompañamiento 6', !!(ac.entresacado_si || ac.entresacado_no));
    req('acompanamiento', 'Acompañamiento 7', fill(ac.observaciones_visita));

    // ── EVIDENCIAS (5 fotos + 1 video + 2 firmas obligatorias) ──
    if (fotosCount < 5) faltas.evidencias.push(`Fotos (${fotosCount} de 5)`);
    if (videosCount < 1) faltas.evidencias.push(`Video (${videosCount} de 1)`);
    if (!firmaBeneficiarioOk) faltas.evidencias.push('Firma del beneficiario');
    if (!firmaTecnicoOk) faltas.evidencias.push('Firma del técnico');

    // Deduplicar etiquetas repetidas (p. ej. la pregunta 22 o la 27)
    (Object.keys(faltas) as SectionKey[]).forEach((k) => {
      faltas[k] = Array.from(new Set(faltas[k]));
    });

    // Lista plana en orden de sección, para el mensaje de la alerta
    const faltantes = (Object.keys(faltas) as SectionKey[]).flatMap((k) => faltas[k]);

    return { faltas, faltantes };
  }, [data, fotosCount, videosCount, firmaBeneficiarioOk, firmaTecnicoOk]);

  const faltas = validacion.faltas;

  // ─── Autoguardado silencioso ─────────────────────────────
  // Sin esto, un crash o que Android mate la app a mitad de la encuesta perdía
  // TODO lo no guardado a mano: 20-40 minutos de trabajo con el beneficiario
  // delante. Guarda solo el borrador (sin subidas ni alertas) cada 20 s y al
  // pasar la app a segundo plano.
  const autoguardarRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    autoguardarRef.current = async () => {
      try {
        if (completadoRef.current) return;
        const draftIdActual = formIdRef.current || formularioActual?.id;
        if (!draftIdActual) return;
        // Nada que guardar todavía: evita crear borradores vacíos
        if (!data.productor_nombre?.trim() && !data.documento?.trim()) return;

        const currentForm = formularioRef.current || formularioActual;
        const draft: FormDraft = {
          id: draftIdActual,
          tipo: 'caracterizacion',
          step: 0,
          tecnico: {
            usuario_id: user?.id || '',
            nombre: data.tecnico_responsable,
            cedula: user?.cedula || '',
            telefono: data.telefono,
            email: user?.email || '',
          },
          beneficiario: {
            nombre: data.productor_nombre,
            cedula: data.documento,
            telefono: data.telefono,
            departamento: 'Caquetá',
            municipio: data.municipio,
            vereda: data.vereda,
            finca: data.caracterizacion_finca.nombre_finca || '',
          },
          actividad: {
            descripcion: 'Encuesta Social AgroAmbiental',
            observaciones: data.recomendaciones.recomendaciones_tecnicas,
            recomendaciones: data.recomendaciones.recomendaciones_ambientales,
          },
          caracterizacion_nueva: data as any,
          coordenadas: coordenadas || undefined,
          fotos: currentForm?.fotos || [],
          firma_beneficiario: currentForm?.firma_beneficiario || '',
          firma_tecnico: currentForm?.firma_tecnico || '',
          huella_beneficiario: currentForm?.huella_beneficiario || false,
          datosBloqueados,
          selectedDepartamento: 'Caquetá',
          selectedActividad: '',
          otraActividadText: '',
          descripcionDetallada: '',
          updated_at: new Date().toISOString(),
        };
        const guardado = await guardarBorrador(draft);
        if (guardado) {
          console.log('[Carac] Autoguardado:', draftIdActual);
        } else {
          console.warn('[Carac] El borrador no quedó guardado localmente:', draftIdActual);
        }
      } catch (e) {
        console.warn('[Carac] Autoguardado falló:', e);
      }
    };
  });

  useEffect(() => {
    const intervalo = setInterval(() => {
      autoguardarRef.current?.();
    }, 20000);

    const sub = AppState.addEventListener('change', (estado) => {
      // 'inactive' cubre iOS al deslizar hacia el multitarea
      if (estado === 'background' || estado === 'inactive') {
        autoguardarRef.current?.();
      }
    });

    return () => {
      clearInterval(intervalo);
      sub.remove();
      // Último guardado al salir de la pantalla
      autoguardarRef.current?.();
    };
  }, []);

  // ─── Autoguardado reactivo (debounce) ────────────────────
  // El intervalo de 20 s dejaba una ventana de pérdida de hasta 20 s: si
  // Android mataba la app (o el técnico cerraba por error) justo después de
  // escribir, ese pedazo se perdía. Con debounce de 1.5 s sobre cada cambio,
  // el hueco real baja a ~2 s. El intervalo se mantiene como red de
  // seguridad (por si algún cambio no pasa por `data`).
  const autoguardadoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (completadoRef.current) return;
    // Nada que guardar todavía: evita crear borradores vacíos al abrir
    if (!data.productor_nombre?.trim() && !data.documento?.trim()) return;

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
  }, [data]);

  // ─── Guardar borrador ────────────────────────────────────
  const guardarBorradorHandler = useCallback(async () => {
    setIsSaving(true);
    try {
      const draftIdActual = formIdRef.current || formularioActual?.id || 'draft-' + Date.now();
      const currentForm = formularioRef.current || formularioActual;
      const fotosActuales = currentForm?.fotos || [];
      const firmaBenefActual = currentForm?.firma_beneficiario || '';
      const firmaTecActual = currentForm?.firma_tecnico || '';
      const huellaActual = currentForm?.huella_beneficiario || false;

      const draft: FormDraft = {
        id: draftIdActual,
        tipo: 'caracterizacion',
        step: 0,
        tecnico: {
          usuario_id: user?.id || '',
          nombre: data.tecnico_responsable,
          cedula: user?.cedula || '',
          telefono: data.telefono,
          email: user?.email || '',
        },
        beneficiario: {
          nombre: data.productor_nombre,
          cedula: data.documento,
          telefono: data.telefono,
          departamento: 'Caquetá',
          municipio: data.municipio,
          vereda: data.vereda,
          finca: data.caracterizacion_finca.nombre_finca || '',
        },
        actividad: {
          descripcion: 'Encuesta Social AgroAmbiental',
          observaciones: data.recomendaciones.recomendaciones_tecnicas,
          recomendaciones: data.recomendaciones.recomendaciones_ambientales,
        },
        caracterizacion_nueva: data as any,
        coordenadas: coordenadas || undefined,
        fotos: fotosActuales,
        firma_beneficiario: firmaBenefActual,
        firma_tecnico: firmaTecActual,
        huella_beneficiario: huellaActual,
        datosBloqueados,
        selectedDepartamento: 'Caquetá',
        selectedActividad: '',
        otraActividadText: '',
        descripcionDetallada: '',
        updated_at: new Date().toISOString(),
      };

      const guardado = await guardarBorrador(draft);
      if (!guardado) {
        const detalle = obtenerUltimoErrorBorrador();
        Alert.alert(
          'No se pudo guardar',
          'El borrador no quedó guardado en este dispositivo.' +
            (detalle ? `\n\nDetalle: ${detalle}` : '') +
            '\n\nTus datos siguen en pantalla: no cierres la app e inténtalo de nuevo.'
        );
        return;
      }

      let verifyOk = false;
      try {
        const verificado = await getBorrador(draftIdActual);
        if (verificado) {
          const vFotos = verificado.fotos?.length || 0;
          const vFirmaB = !!verificado.firma_beneficiario;
          const vFirmaT = !!verificado.firma_tecnico;
          const vHuella = !!verificado.huella_beneficiario;
          if (vFotos >= fotosActuales.length &&
              (!firmaBenefActual || vFirmaB) &&
              (!firmaTecActual || vFirmaT) &&
              (!huellaActual || vHuella)) {
            verifyOk = true;
          }
        }
      } catch { /* ignorar */ }

      // Encolar evidencias para sincronización.
      // NO se suben aquí: antes se llamaba a uploadPhoto/uploadVideo/subirFirma
      // directamente sin marcar la evidencia como sincronizada, así que
      // SyncContext la volvía a subir — y cada pulsación de "Guardar borrador"
      // repetía la subida. Ya hay duplicados reales en MinIO por esto.
      // Ahora la cola es el ÚNICO camino de subida.
      let colasEvidenciasCompletas = true;
      try {
        const beneficiarioActual = { cedula: data.documento, nombre: data.productor_nombre };
        for (const foto of fotosActuales) {
          if (foto.uri?.startsWith('http')) continue;
          if (foto.tipo === 'video') {
            await saveVideoLocal(foto.id, draftIdActual, foto.uri, foto.coordenadas, beneficiarioActual, 'caracterizacion');
          } else {
            await saveFotoLocal(foto.id, draftIdActual, foto.uri, foto.coordenadas, beneficiarioActual, 'caracterizacion');
          }
        }
      } catch (e) {
        colasEvidenciasCompletas = false;
        console.warn('[Carac] No se pudieron encolar todas las evidencias:', e);
      }

      // `fotosActuales` trae fotos y videos juntos: se desglosan para no
      // reportar un video como si fuera una foto.
      const nFotosGuardadas = fotosActuales.filter((f) => f.tipo !== 'video').length;
      const nVideosGuardados = fotosActuales.filter((f) => f.tipo === 'video').length;

      Alert.alert(
        colasEvidenciasCompletas ? '💾 Guardado' : 'Guardado con advertencia',
        verifyOk && colasEvidenciasCompletas
          ? `Evidencias guardadas:\n📸 ${nFotosGuardadas} foto(s)\n🎥 ${nVideosGuardados} video(s)\n✍️ ${firmaBenefActual ? 'Sí' : 'No'} firma beneficiario\n✍️ ${firmaTecActual ? 'Sí' : 'No'} firma técnico\n👆 ${huellaActual ? 'Sí' : 'No'} huella`
          : `El borrador está guardado, pero la verificación o la cola local de evidencias falló. Revisa el almacenamiento antes de continuar.`
      );
    } catch (err) {
      Alert.alert('Error', 'No se pudo guardar: ' + (err as Error)?.message);
    } finally {
      setIsSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, coordenadas, user, formularioActual, datosBloqueados]);

  // ─── Navegar a evidencia ─────────────────────────────────
  const goToEvidencia = useCallback(
    (screen: string, params?: Record<string, any>) => {
      navigation.navigate(screen as any, params as any);
    },
    [navigation]
  );

  // ─── Completar formulario ────────────────────────────────
  const handleCompletar = useCallback(async () => {
    if (isSubmitting) return;

    if (!data.productor_nombre.trim()) {
      Alert.alert('Campo requerido', 'El nombre del productor es obligatorio');
      return;
    }
    if (!data.documento.trim()) {
      Alert.alert('Campo requerido', 'El número de documento es obligatorio');
      return;
    }
    if (!data.caracterizacion_finca.latitud || !data.caracterizacion_finca.longitud) {
      Alert.alert('Coordenada requerida', 'Captura la coordenada de la finca (pregunta 20) antes de completar el formulario.');
      return;
    }

    setIsSubmitting(true);

    try {
      const currentForm = formularioRef.current || formularioActual;
      const fotosParaUpload = currentForm?.fotos || [];
      const formId = formIdRef.current || 'encuesta-' + Date.now();

      // Encolar evidencias. Las firmas viajan en base64 dentro del propio
      // formulario (el backend las sube a MinIO en /guardar), y las fotos y
      // videos los sube SyncContext desde la cola marcándolos como
      // sincronizados. Subirlos también aquí generaba duplicados.
      try {
        const beneficiarioActual = { cedula: data.documento, nombre: data.productor_nombre };
        for (const foto of fotosParaUpload) {
          if (foto.uri?.startsWith('http')) continue;
          if (foto.tipo === 'video') {
            await saveVideoLocal(foto.id, formId, foto.uri, foto.coordenadas, beneficiarioActual, 'caracterizacion');
          } else {
            await saveFotoLocal(foto.id, formId, foto.uri, foto.coordenadas, beneficiarioActual, 'caracterizacion');
          }
        }
      } catch (queueError) {
        setIsSubmitting(false);
        Alert.alert('No se pudieron asegurar las evidencias', 'La encuesta sigue en el borrador local. Revisa el almacenamiento e inténtalo de nuevo.');
        console.warn('[Carac] No se pudo encolar evidencia al completar:', queueError);
        return;
      }

      setTecnico({
        usuario_id: user?.id || '',
        nombre: data.tecnico_responsable || user?.nombre || '',
        cedula: user?.cedula || '',
        telefono: data.telefono || '',
        email: user?.email || '',
      });
      setBeneficiario({
        nombre: data.productor_nombre || '',
        cedula: data.documento || '',
        telefono: data.telefono || '',
        departamento: 'Caquetá',
        municipio: data.municipio || '',
        vereda: data.vereda || '',
        finca: data.caracterizacion_finca.nombre_finca || '',
      });
      setCaracterizacionNueva(data as any);
      // La "Ubicación" del formulario toma la coordenada de la pregunta 20
      // (captura de alta precisión, 8s de muestreo, validada como requerida
      // arriba) en vez del GPS automático de apertura de pantalla, que es
      // una sola lectura rápida y puede fallar sin señal — antes, cuando
      // fallaba, se guardaba un placeholder { latitud: 0, longitud: 0 } que
      // se veía como un dato real en el Detalle del Formulario. El GPS de
      // apertura queda solo como respaldo si la 20 llegara a faltar en un
      // borrador antiguo.
      const latQ20 = Number(data.caracterizacion_finca.latitud);
      const lonQ20 = Number(data.caracterizacion_finca.longitud);
      const coordenadasBase = data.caracterizacion_finca.latitud && data.caracterizacion_finca.longitud && !Number.isNaN(latQ20) && !Number.isNaN(lonQ20)
        ? {
            latitud: latQ20,
            longitud: lonQ20,
            altitud: data.caracterizacion_finca.altitud ? Number(data.caracterizacion_finca.altitud) : undefined,
            precision_gps: data.caracterizacion_finca.precision_gps ? Number(data.caracterizacion_finca.precision_gps) : undefined,
          }
        : coordenadas || undefined;
      const coordenadasConLugar = coordenadasBase
        ? { ...coordenadasBase, ...(lugarResuelto ? { lugar: lugarResuelto } : {}) }
        : undefined;
      setCoordenadas(coordenadasConLugar as any);

      // ─── AQUÍ SE GENERABA EL PDF. YA NO. ────────────────────────────────
      // Antes, "Completar" esperaba a `generarPDFLocal(formData)` ANTES de
      // guardar nada. Ese PDF recorre cada foto haciendo un
      // resize+base64 (`manipulateAsync`) y arma una cadena HTML de varios
      // MB en el hilo de JavaScript, y termina en un WebView nativo
      // (`Print.printToFileAsync`) sin timeout. Con 10-20 fotos en una
      // tablet de gama baja son minutos de CPU —y la UI no se puede ni
      // repintar—, o directamente se queda sin memoria. Ese era el reporte
      // de los técnicos: "le daba a completar y quedaba cargando cargando y
      // nunca pasaba nada", y al cerrar, todo se perdía.
      //
      // Además ese PDF se descartaba igual: el backend solo conserva
      // `pdf_url` si NO es local (ver backend/src/routes/forms.js, donde
      // ignora las rutas `file://`), y la pantalla de detalle SIEMPRE
      // regenera el documento bajo demanda desde los datos guardados
      // (FormularioDetailScreen.generarPdfUri), que es justamente lo que
      // se quiere: generar el PDF después, con el formulario ya completo,
      // desde donde haya señal.
      //
      // Guardar primero y generar el PDF después: la encuesta nunca se
      // pierde por un documento que se puede reconstruir.
      //
      // NOTA: el código de la variable `formData` que alimentaba ese `generarPDFLocal`
      // salió de aquí, y con él el del `form.pdf_url`: el detalle regenera el PDF solo.

      // Pasar los datos frescos directamente: los setTecnico/setBeneficiario
      // despachados unas líneas arriba aún NO están en el estado del contexto
      // (closure del render anterior) — antes esto hacía que la validación
      // viera técnico vacío y fallara SIEMPRE con "No se pudo finalizar".
      const form = finalizarFormulario({
        tipo: 'caracterizacion',
        tecnico: {
          usuario_id: user?.id || '',
          nombre: data.tecnico_responsable || user?.nombre || '',
          cedula: user?.cedula || '',
          telefono: data.telefono || '',
          email: user?.email || '',
        },
        beneficiario: {
          nombre: data.productor_nombre || '',
          cedula: data.documento || '',
          telefono: data.telefono || '',
          departamento: 'Caquetá',
          municipio: data.municipio || '',
          vereda: data.vereda || '',
          finca: data.caracterizacion_finca.nombre_finca || '',
        },
        actividad: {
          descripcion: 'Encuesta Social AgroAmbiental',
          observaciones: data.recomendaciones.recomendaciones_tecnicas,
          recomendaciones: data.recomendaciones.recomendaciones_ambientales,
        },
        coordenadas: coordenadasConLugar,
        clima: climaResuelto || undefined,
      });
      if (!form) {
        const motivo = !data.tecnico_responsable && !user?.nombre
          ? 'Falta el nombre del técnico responsable.'
          : !data.productor_nombre
            ? 'Falta el nombre del productor.'
            : 'Se perdió el formulario en curso. Tus datos siguen en el borrador — ciérralo y ábrelo de nuevo.';
        Alert.alert('No se pudo finalizar', motivo);
        setIsSubmitting(false);
        return;
      }
      (form as any).caracterizacion_nueva = data;

      // El guardado local es el punto de no retorno: si falla, se ABORTA y se
      // conserva el borrador. Antes el error se tragaba y el borrador se
      // borraba igual, así que la encuesta completa desaparecía en silencio.
      try {
        await saveFormularioLocal(form);
        // Verificar que la fila existe de verdad antes de tocar el borrador
        const verificado = await getFormularioById(form.id);
        if (!verificado) {
          throw new Error('El formulario no aparece en la base local tras guardarlo');
        }
        // Ya quedó guardado de verdad: de aquí en adelante ningún autoguardado
        // (interval, AppState o cleanup al salir) debe volver a crear un borrador.
        completadoRef.current = true;
      } catch (errGuardado) {
        console.error('[Carac] Error guardando el formulario:', errGuardado);
        setIsSubmitting(false);
        Alert.alert(
          'No se pudo guardar',
          'No fue posible guardar el formulario en este dispositivo. ' +
            'Tu borrador sigue intacto: ciérralo, vuelve a abrirlo e inténtalo de nuevo. ' +
            'Si persiste, libera espacio en el teléfono.'
        );
        return;
      }

      // 5. Vincular documentos capturados con ID temporal al formulario real
      //    y, sobre todo, a la cédula del beneficiario para que queden como
      //    documentos permanentes de la finca.
      try {
        const cedula = data.documento?.trim() || undefined;
        const formRealId = form.id;
        const db = getDb();
        if (db) {
          // Reasignar los IDs temporales conocidos de ESTA sesión
          const idsTemporales = [
            formularioActual?.id || 'sin-formulario',
            formIdRef.current,
          ].filter((id): id is string => !!id && id !== formRealId);

          for (const idTemp of idsTemporales) {
            await db.runAsync(
              'UPDATE documentos_finca SET formulario_id = ?, beneficiario_cedula = COALESCE(NULLIF(beneficiario_cedula, \'\'), ?) WHERE formulario_id = ?',
              [formRealId, cedula || null, idTemp]
            );
          }

          // ─── Reasignar FOTOS y VIDEOS al id real del formulario ───────
          // Las evidencias pueden haberse encolado con otro id (el temporal
          // de la sesión, o '' si se capturaron antes de que existiera el
          // formulario en curso). Sin este paso quedaban apuntando a un
          // formulario que no existe, no entraban en el payload de sync de
          // ESTE formulario y el técnico las veía como perdidas.
          const idsEvidencia = Array.from(
            new Set(
              [
                formularioActual?.id,
                formIdRef.current,
                '',
                'sin-formulario',
              ].filter((id): id is string => id !== formRealId && id !== undefined)
            )
          );
          for (const idEvidencia of idsEvidencia) {
            await db.runAsync(
              'UPDATE fotos_locales SET formulario_id = ? WHERE formulario_id = ?',
              [formRealId, idEvidencia]
            );
            await db.runAsync(
              'UPDATE videos_locales SET formulario_id = ? WHERE formulario_id = ?',
              [formRealId, idEvidencia]
            );
          }
        }
        await vincularDocumentosHuerfanos(formRealId, cedula);
      } catch (e) {
        console.warn('[Carac] No se pudieron actualizar documentos:', e);
      }

      // 6. Eliminar el borrador.
      //    Se borran TODOS los ids con los que pudo haberse guardado, no solo
      //    el parámetro de ruta: al abrir un formulario nuevo `draftId` es
      //    undefined, así que el borrador creado con "Guardar borrador" nunca
      //    se eliminaba. Quedaba para siempre en "Formularios Incompletos" y,
      //    si el técnico lo reabría y completaba, generaba un DUPLICADO.
      try {
        const { eliminarBorrador } = await import('../../store/FormDraftStore');
        const idsBorrador = Array.from(
          new Set(
            [draftId, formIdRef.current, formularioActual?.id, form.id].filter(
              (id): id is string => !!id
            )
          )
        );
        for (const id of idsBorrador) {
          await eliminarBorrador(id);
        }
      } catch {
        // Ignorar error al eliminar borrador
      }

      // 7. Sincronizar con el servidor (best-effort). Si no hay conexión el
      //    formulario queda en la cola y sube solo al recuperarla.
      syncNow().catch(() => { /* la cola reintenta */ });

      setIsSubmitting(false);

      Alert.alert(
        '✅ Formulario completado',
        'La caracterización ha sido guardada correctamente.',
        [{ text: 'Ver listado', onPress: () => navigation.navigate('TerrenoFormularioList') }],
        { cancelable: false }
      );
    } catch (err) {
      console.error('[Carac] Error al completar:', err);
      setIsSubmitting(false);
      Alert.alert('Error inesperado', 'Ocurrió un error al completar el formulario');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    coordenadas,
    isSubmitting,
    formularioActual,
    draftId,
    user,
    navigation,
    setCaracterizacionNueva,
    setCoordenadas,
    finalizarFormulario,
    syncNow,
  ]);

  // Confirmación antes de disparar el envío — evita que un toque accidental
  // en "Completar" cierre la visita a mitad de llenado, sin forma de volver
  // atrás una vez arrancó la subida. `handleCompletar` va en las
  // dependencias para no quedar con una versión vieja capturada (cambia en
  // cada tecla que el técnico escribe, por sus propias dependencias).
  const confirmarCompletar = useCallback(() => {
    if (isSubmitting) return;

    // Puerta de validación: si hay espacios sin responder NO se completa. Se
    // asegura el borrador (silencioso) y se le muestra al técnico la lista
    // exacta de lo que falta, para que no cierre un formulario incompleto.
    if (validacion.faltantes.length > 0) {
      autoguardarRef.current?.();
      Alert.alert(
        'Formulario incompleto',
        'Por favor termina de diligenciar el formulario. Espacios sin responder:\n\n' +
          validacion.faltantes.join(', '),
        [{ text: 'Revisar y completar', style: 'cancel' }]
      );
      return;
    }

    Alert.alert(
      '¿Has completado todos los pasos?',
      'Revisa que toda la información y evidencias estén correctas antes de continuar.',
      [
        { text: 'No, revisar nuevamente', style: 'cancel' },
        { text: 'Sí, completar', onPress: () => handleCompletar() },
      ]
    );
  }, [isSubmitting, handleCompletar, validacion]);

  // ─── Render ──────────────────────────────────────────────

  // --- Sección reutilizable ---
  // Muestra un check verde cuando la sección no tiene espacios sin responder
  const renderSection = (
    sectionKey: SectionKey,
    title: string,
    icon: string,
    color: string,
    children: React.ReactNode
  ) => {
    const completa = faltas[sectionKey].length === 0;
    return (
      <View style={[styles.sectionCard, { borderLeftColor: color }]}>
        <View style={[styles.sectionHeader, { backgroundColor: color + '12' }]}>
          <Text style={[styles.sectionTitle, { color, flex: 1 }]}>
            {icon}  {title}
          </Text>
          {completa && (
            <View style={styles.sectionOkBadge}>
              <Text style={styles.sectionOkBadgeText}>✓</Text>
            </View>
          )}
        </View>
        <View style={styles.sectionBody}>{children}</View>
      </View>
    );
  };

  // --- Input field corto ---
  const renderField = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    opts?: {
      placeholder?: string;
      keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'email-address';
      multiline?: boolean;
      numberOfLines?: number;
      required?: boolean;
    }
  ) => (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>
        {label}
        {opts?.required && <Text style={styles.required}> *</Text>}
      </Text>
      <TextInput
        style={[
          styles.textInput,
          opts?.multiline && { minHeight: 70, textAlignVertical: 'top' },
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={opts?.placeholder || ''}
        placeholderTextColor={COLORS.textLight}
        keyboardType={opts?.keyboardType || 'default'}
        multiline={opts?.multiline || false}
        numberOfLines={opts?.numberOfLines || 1}
        autoCapitalize="sentences"
      />
    </View>
  );

  // --- Selección múltiple (checkboxes) — valor almacenado separado por comas ---
  const renderMultiCheck = (
    label: string,
    value: string,
    options: string[],
    onChange: (nuevo: string) => void
  ) => {
    const seleccionados = value ? value.split(', ').filter(Boolean) : [];
    const toggle = (opt: string) => {
      const next = seleccionados.includes(opt)
        ? seleccionados.filter((o) => o !== opt)
        : [...seleccionados, opt];
      onChange(next.join(', '));
    };
    return (
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {options.map((opt) => {
          const activo = seleccionados.includes(opt);
          return (
            <TouchableOpacity key={opt} style={styles.checkRow} onPress={() => toggle(opt)} activeOpacity={0.7}>
              <Text style={[styles.checkBox, activo && styles.checkBoxActive]}>{activo ? '☑' : '☐'}</Text>
              <Text style={styles.checkLabel}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // --- Botón de captura GPS: llena lat/lon/alt y muestra el resultado debajo ---
  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
      <AppBackground overlay={0.35}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {/* ═══ DATOS GENERALES ═══ */}
          {renderSection('datos', 'DATOS GENERALES', '📋', COLORS.primary, (
            <>
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Fecha *</Text>
                <View style={styles.lockedField}>
                  <Text style={styles.lockedFieldText}>
                    📅 {format(new Date(), 'dd/MM/yyyy', { locale: es })}
                  </Text>
                </View>
              </View>

              <DropdownPicker
                label="Municipio"
                value={selectedMunicipio}
                options={['Puerto Rico']}
                onSelect={(val) => {
                  setSelectedMunicipio(val);
                  updateData({ municipio: val, vereda: '' });
                }}
                required
              />

              {datosBloqueados && data.vereda ? (
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Vereda *</Text>
                  <View style={styles.lockedField}>
                    <Text style={styles.lockedFieldText}>📍 {data.vereda}</Text>
                  </View>
                </View>
              ) : (
                <DropdownPicker
                  label="Vereda"
                  value={data.vereda || null}
                  options={veredasDisponibles}
                  onSelect={(val) => updateData({ vereda: val })}
                  placeholder="Seleccionar vereda..."
                  required
                />
              )}

              {datosBloqueados && data.corregimiento ? (
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Corregimiento *</Text>
                  <View style={styles.lockedField}>
                    <Text style={styles.lockedFieldText}>📍 {data.corregimiento}</Text>
                  </View>
                </View>
              ) : (
                renderField('Corregimiento', data.corregimiento, (t) => updateData({ corregimiento: t }), {
                  placeholder: 'Corregimiento del beneficiario',
                })
              )}

              {datosBloqueados && (
                <TouchableOpacity onPress={() => setDatosBloqueados(false)} style={styles.editarManualBtn}>
                  <Text style={styles.editarManualBtnText}>✏️ Editar vereda / corregimiento manualmente</Text>
                </TouchableOpacity>
              )}

              {renderField('Nombre del productor', data.productor_nombre, (t) => updateData({ productor_nombre: t }), {
                placeholder: 'Nombre completo del productor',
                required: true,
              })}

              {renderField('Edad (años)', data.edad, (t) => updateData({ edad: t }), {
                placeholder: '',
                keyboardType: 'numeric',
              })}

              <DropdownPicker
                label="Sexo"
                value={data.sexo || null}
                options={SEXO_OPTS}
                onSelect={(val) => updateData({ sexo: val, sexo_otro: val === 'Otro' ? data.sexo_otro : '' })}
                placeholder="Seleccionar..."
              />
              {data.sexo === 'Otro' && renderField('¿Cuál?', data.sexo_otro, (t) => updateData({ sexo_otro: t }), {
                placeholder: 'Especifique...',
              })}

              {renderField('Documento (C.C.)', data.documento, (t) => updateData({ documento: t }), {
                placeholder: 'Número de cédula',
                keyboardType: 'numeric',
                required: true,
              })}

              {renderField('Teléfono', data.telefono, (t) => updateData({ telefono: t }), {
                placeholder: 'Teléfono de contacto',
                keyboardType: 'phone-pad',
              })}

              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Técnico responsable *</Text>
                <View style={styles.lockedField}>
                  <Text style={styles.lockedFieldText}>
                    👤 {data.tecnico_responsable || (user?.nombre || '—')}
                  </Text>
                </View>
              </View>

            </>
          ))}

          {/* ═══════════════════════════════════════════════════
               COMPONENTE SOCIAL (P1-P18)
               ═══════════════════════════════════════════════════ */}
          {renderSection('social', 'COMPONENTE SOCIAL', '👥', '#2E7D32', (
            <>
              {/* 1 */}
              <DropdownPicker
                label="1. Se reconoce como:"
                value={data.componente_social.reconocimiento || null}
                options={RECONOCIMIENTO_OPTS}
                onSelect={(val) => updateSocial({ reconocimiento: val, reconocimiento_otro: val === 'Otro' ? data.componente_social.reconocimiento_otro : '' })}
                placeholder="Seleccionar..."
              />
              {data.componente_social.reconocimiento === 'Otro' && renderField('Especifique cual otro', data.componente_social.reconocimiento_otro, (t) => updateSocial({ reconocimiento_otro: t }), { placeholder: '' })}

              {/* 2 */}
              <DropdownPicker
                label="2. Nivel educativo del productor"
                value={data.componente_social.nivel_educativo || null}
                options={NIVEL_EDUCATIVO_ENV_OPTS}
                onSelect={(val) => updateSocial({ nivel_educativo: val })}
                placeholder="Seleccionar..."
              />

              {/* 3 */}
              <DropdownPicker
                label="3. ¿Ha participado antes en Escuelas de Campo (ECA)?"
                value={data.componente_social.participo_eca || null}
                options={SINO_OPTS}
                onSelect={(val) => updateSocial({ participo_eca: val })}
                placeholder="Seleccionar..."
              />

              {/* 4 */}
              {renderField('4. ¿Cuántas personas, incluyéndose usted, hacen parte de su núcleo familiar?', data.componente_social.personas_nucleo, (t) => updateSocial({ personas_nucleo: t }), {
                placeholder: 'Número de personas',
                keyboardType: 'numeric',
              })}
              <Text style={styles.notaInfo}>
                Nota informativa: (El núcleo familiar lo conforman las personas que viven en la misma vivienda y/o dependen económicamente del hogar)
              </Text>

              {/* 5 */}
              <DropdownPicker
                label="5. Principal fuente de ingresos"
                value={data.componente_social.fuente_ingresos || null}
                options={FUENTE_INGRESOS_ENV_OPTS}
                onSelect={(val) => updateSocial({ fuente_ingresos: val, fuente_ingresos_otra: val === 'Otra actividad' ? data.componente_social.fuente_ingresos_otra : '' })}
                placeholder="Seleccionar..."
              />
              {data.componente_social.fuente_ingresos === 'Otra actividad' && renderField('Especifique cual:', data.componente_social.fuente_ingresos_otra, (t) => updateSocial({ fuente_ingresos_otra: t }), { placeholder: '' })}

              {/* 6 */}
              <DropdownPicker
                label="6. ¿Cuánto son sus ingresos en salarios?"
                value={data.componente_social.ingresos_salarios || null}
                options={INGRESOS_SALARIOS_OPTS}
                onSelect={(val) => updateSocial({ ingresos_salarios: val })}
                placeholder="Seleccionar..."
              />

              {/* 7 */}
              <DropdownPicker
                label="7. ¿Cual es su ocupación secundaria?"
                value={data.componente_social.ocupacion_secundaria || null}
                options={OCUPACION_SECUNDARIA_OPTS}
                onSelect={(val) => updateSocial({ ocupacion_secundaria: val, ocupacion_secundaria_otro: val === 'Otro' ? data.componente_social.ocupacion_secundaria_otro : '' })}
                placeholder="Seleccionar..."
              />
              {data.componente_social.ocupacion_secundaria === 'Otro' && renderField('Especifique cual otro:', data.componente_social.ocupacion_secundaria_otro, (t) => updateSocial({ ocupacion_secundaria_otro: t }), { placeholder: '' })}

              {/* 8 */}
              <DropdownPicker
                label="8. Participa en alguna organización o asociación"
                value={data.componente_social.participa_organizacion || null}
                options={SINO_OPTS}
                onSelect={(val) => updateSocial({
                  participa_organizacion: val,
                  ...(val === 'No' ? { tipo_asociacion: 'Ninguna', tipo_asociacion_otro: '', rol_asociacion: 'Ninguna' } : {}),
                })}
                placeholder="Seleccionar..."
              />
              {data.componente_social.participa_organizacion === 'Sí' && renderField('Si la respuesta es “sí”, cual?:', data.componente_social.organizacion_cual, (t) => updateSocial({ organizacion_cual: t }), { placeholder: '' })}

              {/* 9 */}
              {data.componente_social.participa_organizacion === 'No' ? (
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>9. ¿A qué asociaciones u organizaciones se encuentra afiliado?</Text>
                  <View style={styles.lockedField}>
                    <Text style={styles.lockedFieldText}>Ninguna</Text>
                  </View>
                </View>
              ) : (
                <>
                  <DropdownPicker
                    label="9. ¿A qué asociaciones u organizaciones se encuentra afiliado?"
                    value={data.componente_social.tipo_asociacion || null}
                    options={TIPO_ASOCIACION_OPTS}
                    onSelect={(val) => updateSocial({ tipo_asociacion: val, tipo_asociacion_otro: val === 'Otro' ? data.componente_social.tipo_asociacion_otro : '' })}
                    placeholder="Seleccionar..."
                  />
                  {data.componente_social.tipo_asociacion === 'Otro' && renderField('Especifique cual otra:', data.componente_social.tipo_asociacion_otro, (t) => updateSocial({ tipo_asociacion_otro: t }), { placeholder: '' })}
                </>
              )}

              {/* 10 — texto libre según encuesta oficial */}
              {data.componente_social.participa_organizacion === 'No' ? (
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>10. ¿Cuál es el rol en la organización que está afiliado(a)?</Text>
                  <View style={styles.lockedField}>
                    <Text style={styles.lockedFieldText}>Ninguna</Text>
                  </View>
                </View>
              ) : (
                renderField('10. ¿Cuál es el rol en la organización que está afiliado(a)?', data.componente_social.rol_asociacion, (t) => updateSocial({ rol_asociacion: t }), {
                  placeholder: '',
                })
              )}

              {/* 11 */}
              <DropdownPicker
                label="11. En donde está ubicada la vivienda principal de su núcleo familiar"
                value={data.componente_social.vivienda_ubicacion || null}
                options={VIVIENDA_UBICACION_OPTS}
                onSelect={(val) => updateSocial({ vivienda_ubicacion: val, vivienda_ubicacion_otra: val === 'Otra' ? data.componente_social.vivienda_ubicacion_otra : '' })}
                placeholder="Seleccionar..."
              />
              {data.componente_social.vivienda_ubicacion === 'Otra' && renderField('Especifique la otra ubicación:', data.componente_social.vivienda_ubicacion_otra || '', (t) => updateSocial({ vivienda_ubicacion_otra: t }), { placeholder: '' })}

              {/* 12 */}
              <DropdownPicker
                label="12. ¿Su vivienda cuenta con energía?"
                value={data.componente_social.energia_electrica || null}
                options={SINO_OPTS}
                onSelect={(val) => updateSocial({ energia_electrica: val })}
                placeholder="Seleccionar..."
              />

              {/* 13 */}
              <DropdownPicker
                label="13. ¿Cuál es el tipo de energía con el que cuenta?"
                value={data.componente_social.tipo_energia || null}
                options={TIPO_ENERGIA_OPTS}
                onSelect={(val) => updateSocial({ tipo_energia: val, tipo_energia_otro: val === 'Otro' ? data.componente_social.tipo_energia_otro : '' })}
                placeholder="Seleccionar..."
              />
              {data.componente_social.tipo_energia === 'Otro' && renderField('Especifique otro tipo de energía:', data.componente_social.tipo_energia_otro, (t) => updateSocial({ tipo_energia_otro: t }), { placeholder: '' })}

              {/* 14 */}
              <DropdownPicker
                label="14. ¿De dónde obtiene principalmente el agua para el consumo humano?"
                value={data.componente_social.agua_consumo || null}
                options={AGUA_CONSUMO_OPTS}
                onSelect={(val) => updateSocial({ agua_consumo: val, agua_consumo_otro: val === 'Otro' ? data.componente_social.agua_consumo_otro : '' })}
                placeholder="Seleccionar..."
              />
              {data.componente_social.agua_consumo === 'Otro' && renderField('Especifique cual otro:', data.componente_social.agua_consumo_otro, (t) => updateSocial({ agua_consumo_otro: t }), { placeholder: '' })}

              {/* 15 — respuesta múltiple */}
              {renderMultiCheck(
                '15. ¿Cuenta con algunos de estos elementos? (respuesta multiple)',
                data.componente_social.elementos_tecnologicos,
                ELEMENTOS_TECNOLOGICOS_OPTS,
                (nuevo) => updateSocial({ elementos_tecnologicos: nuevo })
              )}

              {/* 16 */}
              <DropdownPicker
                label="16. ¿Cuenta con señal de celular en su vivienda?"
                value={data.componente_social.senal_celular || null}
                options={SINO_OPTS}
                onSelect={(val) => updateSocial({ senal_celular: val })}
                placeholder="Seleccionar..."
              />

              {/* 17 — respuesta múltiple */}
              {renderMultiCheck(
                '17. ¿Quiénes trabajan en su finca? (respuesta multiple)',
                data.componente_social.quienes_trabajan,
                QUIENES_TRABAJAN_OPTS,
                (nuevo) => updateSocial({
                  quienes_trabajan: nuevo,
                  quienes_trabajan_otro: nuevo.split(', ').includes('Otro') ? data.componente_social.quienes_trabajan_otro : '',
                })
              )}
              {(data.componente_social.quienes_trabajan || '').split(', ').includes('Otro') && renderField('Especifique cual otro:', data.componente_social.quienes_trabajan_otro || '', (t) => updateSocial({ quienes_trabajan_otro: t }), { placeholder: '' })}

              {/* 18 — selección múltiple: pueden usar varios medios de transporte */}
              {renderMultiCheck(
                '18. ¿Qué medio de transporte utiliza?',
                data.componente_social.medio_transporte,
                MEDIO_TRANSPORTE_OPTS,
                (nuevo) => updateSocial({
                  medio_transporte: nuevo,
                  medio_transporte_otro: nuevo.split(', ').includes('Otro') ? data.componente_social.medio_transporte_otro : '',
                })
              )}
              {(data.componente_social.medio_transporte || '').split(', ').includes('Otro') && renderField('Especifique cual otro:', data.componente_social.medio_transporte_otro, (t) => updateSocial({ medio_transporte_otro: t }), { placeholder: '' })}
            </>
          ))}

          {/* ═══════════════════════════════════════════════════
               CARACTERIZACIÓN DE LA FINCA (P19-P27)
               ═══════════════════════════════════════════════════ */}
          {renderSection('finca', 'CARACTERIZACION DE LA FINCA', '🏠', '#8D6E63', (
            <>
              {/* 19 */}
              {renderField('19. Nombre de la finca', data.caracterizacion_finca.nombre_finca, (t) => updateFinca({ nombre_finca: t }), {
                placeholder: '',
              })}

              {/* 20 — Captura GPS de alta precisión (cuenta regresiva + mapa) */}
              <CapturaGPSPrecisa
                label="20. Coordenada de la finca"
                latitud={data.caracterizacion_finca.latitud}
                longitud={data.caracterizacion_finca.longitud}
                altitud={data.caracterizacion_finca.altitud}
                precision={data.caracterizacion_finca.precision_gps}
                ubicacionTexto={ubicacionGPSTexto}
                onCapture={(lat, lon, alt, precision) => updateFinca({ latitud: lat, longitud: lon, altitud: alt, precision_gps: precision })}
              />

              {/* 21 */}
              {renderField('21. ¿Cuál es el área total de la finca en hectáreas?', data.caracterizacion_finca.area_total, (t) => updateFinca({ area_total: t }), {
                placeholder: '',
                keyboardType: 'numeric',
              })}

              {/* 22 — División en hectáreas (texto oficial) */}
              <Text style={styles.subSectionTitle}>22. ¿Cómo está dividida en hectáreas?</Text>
              <View style={styles.row}>
                <View style={styles.halfField}>
                  {renderField('Área de bosque', data.caracterizacion_finca.division_bosque, (t) => updateFinca({ division_bosque: t }), { placeholder: 'ha', keyboardType: 'numeric' })}
                </View>
                <View style={styles.halfField}>
                  {renderField('Área de agrícola', data.caracterizacion_finca.division_agricola || '', (t) => updateFinca({ division_agricola: t }), { placeholder: 'ha', keyboardType: 'numeric' })}
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.halfField}>
                  {renderField('Área de pecuaria', data.caracterizacion_finca.division_pecuaria || '', (t) => updateFinca({ division_pecuaria: t }), { placeholder: 'ha', keyboardType: 'numeric' })}
                </View>
                <View style={styles.halfField}>
                  {renderField('Área instalaciones', data.caracterizacion_finca.division_instalaciones || '', (t) => updateFinca({ division_instalaciones: t }), { placeholder: 'ha', keyboardType: 'numeric' })}
                </View>
              </View>

              {/* 23 */}
              <DropdownPicker
                label="23. Medio de salida de productos al centro poblado más cercano"
                value={data.caracterizacion_finca.medio_salida || null}
                options={MEDIO_SALIDA_OPTS}
                onSelect={(val) => updateFinca({ medio_salida: val })}
                placeholder="Seleccionar..."
              />
              <Text style={styles.notaInfo}>
                Nota info: Terciaria – Secundaria – Primaria: camino de herradura, trocha o destapada y carreteable principal · Secundaria – Primaria: trocha o destapada y carreteable principal · Primaria: carreteable principal
              </Text>

              {/* 24 */}
              {renderField('24. Distancia aproximada del predio al centro poblado (km)', data.caracterizacion_finca.distancia_km || '', (t) => updateFinca({ distancia_km: t }), {
                placeholder: 'km',
                keyboardType: 'numeric',
              })}

              {/* 25 */}
              {renderField('25. Observaciones de la descripción llegada al predio (desde cabecera municipal)', data.caracterizacion_finca.distancia_observaciones, (t) => updateFinca({ distancia_observaciones: t }), {
                placeholder: '',
                multiline: true,
                numberOfLines: 3,
              })}

              {/* 26 */}
              <DropdownPicker
                label="26. ¿Realiza aprovechamiento productivo de manera directa?"
                value={data.caracterizacion_finca.aprovechamiento_directo || null}
                options={SINO_OPTS}
                onSelect={(val) => updateFinca({ aprovechamiento_directo: val, aprovechamiento_porque: val === 'No' ? data.caracterizacion_finca.aprovechamiento_porque : '' })}
                placeholder="Seleccionar..."
              />
              <Text style={styles.notaInfo}>
                Nota informativa: Si el beneficiario realiza la actividad productiva en la finca o contrata una persona externa
              </Text>
              {data.caracterizacion_finca.aprovechamiento_directo === 'No' && renderField('Porque?:', data.caracterizacion_finca.aprovechamiento_porque || '', (t) => updateFinca({ aprovechamiento_porque: t }), { placeholder: '' })}

              {/* 27 — respuesta múltiple con sub-listas */}
              {renderMultiCheck(
                '27. ¿Cuáles son las actividades que realiza en su finca?',
                data.caracterizacion_finca.actividades_finca || '',
                ACTIVIDADES_FINCA_OPTS,
                (nuevo) => updateFinca({ actividades_finca: nuevo })
              )}
              {(data.caracterizacion_finca.actividades_finca || '').includes('Actividades agrícolas') && (
                <>
                  {renderMultiCheck(
                    'Actividades agrícolas',
                    data.caracterizacion_finca.actividades_agricolas,
                    ACTIVIDAD_AGRICOLA_OPTS,
                    (nuevo) => updateFinca({ actividades_agricolas: nuevo })
                  )}
                  {(data.caracterizacion_finca.actividades_agricolas || '').includes('Otro') && renderField('Especifique cual otro:', data.caracterizacion_finca.actividades_agricolas_otro || '', (t) => updateFinca({ actividades_agricolas_otro: t }), { placeholder: '' })}
                </>
              )}
              {(data.caracterizacion_finca.actividades_finca || '').includes('Actividades pecuarias') && (
                <>
                  {renderMultiCheck(
                    'Actividades pecuarias',
                    data.caracterizacion_finca.actividades_pecuarias,
                    ACTIVIDAD_PECUARIA_OPTS,
                    (nuevo) => updateFinca({ actividades_pecuarias: nuevo })
                  )}
                  {(data.caracterizacion_finca.actividades_pecuarias || '').includes('Otro') && renderField('Especifique cual otro:', data.caracterizacion_finca.actividades_pecuarias_otro || '', (t) => updateFinca({ actividades_pecuarias_otro: t }), { placeholder: '' })}
                </>
              )}
              {(data.caracterizacion_finca.actividades_finca || '').split(', ').includes('Otro') && renderField('Especifique cual otro', data.caracterizacion_finca.actividades_finca_otro || '', (t) => updateFinca({ actividades_finca_otro: t }), { placeholder: '' })}
            </>
          ))}

          {/* ═══════════════════════════════════════════════════
               COMPONENTE PRODUCTIVO (P28-P31)
               ═══════════════════════════════════════════════════ */}
          {renderSection('productivo', 'COMPONENTE PRODUCTIVO', '🌱', '#1565C0', (
            <>
              {/* 28 — sin campo "Cual?": ninguna opción de esta pregunta es "Otro",
                  así que no hay nada que el técnico deba especificar aparte. */}
              <DropdownPicker
                label="28. ¿Cual es la actividad principal productiva de la finca?"
                value={data.componente_productivo.actividad_principal || null}
                options={ACTIVIDAD_PRODUCTIVA_OPTS}
                onSelect={(val) => updateProductivo({ actividad_principal: val })}
                placeholder="Seleccionar..."
              />

              {/* 29 */}
              <DropdownPicker
                label="29. ¿El predio cuenta con acceso permanente al agua?"
                value={data.componente_productivo.acceso_agua || null}
                options={SINO_OPTS}
                onSelect={(val) => updateProductivo({ acceso_agua: val })}
                placeholder="Seleccionar..."
              />

              {/* 30 */}
              <DropdownPicker
                label="30. ¿Dispone de sistemas de riego?"
                value={data.componente_productivo.sistemas_riego || null}
                options={SINO_OPTS}
                onSelect={(val) => updateProductivo({ sistemas_riego: val })}
                placeholder="Seleccionar..."
              />

              {/* 31 */}
              <DropdownPicker
                label="31. ¿Ha recibido asistencia técnica en los últimos dos años?"
                value={data.componente_productivo.asistencia_tecnica || null}
                options={SINO_OPTS}
                onSelect={(val) => updateProductivo({ asistencia_tecnica: val })}
                placeholder="Seleccionar..."
              />
            </>
          ))}

          {/* ═══════════════════════════════════════════════════
               ANÁLISIS DE SUELO (P32-P42)
               ═══════════════════════════════════════════════════ */}
          {renderSection('suelo', 'SECCIÓN DE SUELO', '🔬', '#6A1B9A', (
            <>
              {/* 32 — Captura GPS de alta precisión (cuenta regresiva + mapa) */}
              <CapturaGPSPrecisa
                label="32. Ubicación del área de intervención del proyecto"
                latitud={data.analisis_suelo.intervencion_latitud}
                longitud={data.analisis_suelo.intervencion_longitud}
                altitud={data.analisis_suelo.intervencion_altitud}
                precision={data.analisis_suelo.intervencion_precision_gps}
                ubicacionTexto={ubicacionGPSTexto}
                onCapture={(lat, lon, alt, precision) => updateAnalisis({ intervencion_latitud: lat, intervencion_longitud: lon, intervencion_altitud: alt, intervencion_precision_gps: precision })}
              />

              {/* 33 */}
              <DropdownPicker
                label="33. ¿Ha realizado alguna vez análisis de suelo en su predio?"
                value={data.analisis_suelo.analisis_realizado || null}
                options={ANALISIS_SUELO_REALIZADO_OPTS}
                onSelect={(val) => updateAnalisis({ analisis_realizado: val })}
                placeholder="Seleccionar..."
              />

              {/* 34 — selección múltiple */}
              {renderMultiCheck(
                '34. ¿Cuál es la textura predominante en el suelo? Selección multiple',
                data.analisis_suelo.textura,
                TEXTURA_SUELO_OPTS,
                (nuevo) => updateAnalisis({ textura: nuevo })
              )}

              {/* 35 */}
              <DropdownPicker
                label="35. ¿Qué coloración predomina en el suelo?"
                value={data.analisis_suelo.color || null}
                options={COLOR_SUELO_OPTS}
                onSelect={(val) => updateAnalisis({ color: val })}
                placeholder="Seleccionar..."
              />

              {/* 36 */}
              <DropdownPicker
                label="36. ¿Qué tipo de drenaje hay en el suelo?"
                value={data.analisis_suelo.drenaje || null}
                options={DRENAJE_OPTS}
                onSelect={(val) => updateAnalisis({ drenaje: val })}
                placeholder="Seleccionar..."
              />

              {/* 37 — uso histórico del suelo */}
              <DropdownPicker
                label="37. ¿Cual ha sido el uso histórico de uso del suelo?"
                value={data.analisis_suelo.uso_tierra || null}
                options={USO_TIERRA_HISTORICO_OPTS}
                onSelect={(val) => updateAnalisis({ uso_tierra: val })}
                placeholder="Seleccionar..."
              />

              {/* 38 */}
              <DropdownPicker
                label="38. ¿Existe alguna presencia de piedras o fragmentos rocosos?"
                value={data.analisis_suelo.piedras || null}
                options={PRESENCIA_PIEDRAS_OPTS}
                onSelect={(val) => updateAnalisis({ piedras: val })}
                placeholder="Seleccionar..."
              />

              {/* 39 */}
              <DropdownPicker
                label="39. ¿Cuál es el estado de la compactación del suelo?"
                value={data.analisis_suelo.compactacion || null}
                options={COMPACTACION_OPTS}
                onSelect={(val) => updateAnalisis({ compactacion: val })}
                placeholder="Seleccionar..."
              />

              {/* 40 */}
              <DropdownPicker
                label="40. ¿Qué presencia de cobertura presenta el suelo?"
                value={data.analisis_suelo.cobertura || null}
                options={COBERTURA_SUELO_OPTS}
                onSelect={(val) => updateAnalisis({ cobertura: val })}
                placeholder="Seleccionar..."
              />

              {/* 41 */}
              <DropdownPicker
                label="41. ¿Se evidencia algún tipo de erosión en el suelo?"
                value={data.analisis_suelo.erosion || null}
                options={EVIDENCIA_EROSION_OPTS}
                onSelect={(val) => updateAnalisis({ erosion: val })}
                placeholder="Seleccionar..."
              />

              {/* 42 — grados */}
              {renderField('42. ¿Cual es el grado de Pendiente del terreno? (°)', data.analisis_suelo.pendiente, (t) => updateAnalisis({ pendiente: t }), {
                placeholder: '°',
                keyboardType: 'numeric',
              })}
            </>
          ))}

          {/* ═══════════════════════════════════════════════════
               COMPONENTE AGROAMBIENTAL (P43-P50)
               ═══════════════════════════════════════════════════ */}
          {renderSection('agroambiental', 'COMPONENTE AGROAMBIENTAL', '🌿', '#E65100', (
            <>
              {/* 43 */}
              <DropdownPicker
                label="43. ¿El predio presenta procesos de erosión?"
                value={data.componente_agroambiental.procesos_erosion || null}
                options={PROCESOS_EROSION_OPTS}
                onSelect={(val) => updateAgroambiental({ procesos_erosion: val })}
                placeholder="Seleccionar..."
              />

              {/* 44 */}
              <DropdownPicker
                label="44. ¿Existen fuentes hídricas dentro o cerca del predio?"
                value={data.componente_agroambiental.fuentes_hidricas || null}
                options={FUENTES_HIDRICAS_OPTS}
                onSelect={(val) => updateAgroambiental({ fuentes_hidricas: val })}
                placeholder="Seleccionar..."
              />

              {/* 45 — respuesta múltiple */}
              {renderMultiCheck(
                '45. ¿El predio cuenta con áreas de conservación o protección? (respuesta multiple)',
                data.componente_agroambiental.areas_conservacion,
                AREAS_CONSERVACION_OPTS,
                (nuevo) => updateAgroambiental({ areas_conservacion: nuevo })
              )}

              {/* 46 */}
              <DropdownPicker
                label="46. ¿Realiza prácticas de conservación del suelo?"
                value={data.componente_agroambiental.practicas_conservacion || null}
                options={PRACTICAS_CONSERVACION_OPTS}
                onSelect={(val) => updateAgroambiental({ practicas_conservacion: val })}
                placeholder="Seleccionar..."
              />

              {/* 47 — si es No, auto-hardcodea 48 y 49 con "Ninguno" */}
              <DropdownPicker
                label="47. ¿Utiliza algún tipo agroquímico?"
                value={data.componente_agroambiental.uso_agroquimicos || null}
                options={SINO_OPTS}
                onSelect={(val) => {
                  if (val === 'No') {
                    updateAgroambiental({
                      uso_agroquimicos: val,
                      tipo_agroquimicos: 'Ninguno',
                      tipo_agroquimicos_otro: '',
                      herbicidas_cuales: 'Ninguno',
                    });
                  } else {
                    updateAgroambiental({ uso_agroquimicos: val, tipo_agroquimicos: '', herbicidas_cuales: '' });
                  }
                }}
                placeholder="Seleccionar..."
              />

              {/* 48 */}
              {data.componente_agroambiental.uso_agroquimicos === 'No' ? (
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>48. ¿Cuál es el tipo de agroquímico que más utiliza?</Text>
                  <View style={styles.lockedField}>
                    <Text style={styles.lockedFieldText}>Ninguno</Text>
                  </View>
                </View>
              ) : (
                <>
                  <DropdownPicker
                    label="48. ¿Cuál es el tipo de agroquímico que más utiliza?"
                    value={data.componente_agroambiental.tipo_agroquimicos || null}
                    options={TIPO_AGROQUIMICO_OPTS}
                    onSelect={(val) => updateAgroambiental({ tipo_agroquimicos: val, tipo_agroquimicos_otro: val === 'Otro' ? data.componente_agroambiental.tipo_agroquimicos_otro : '' })}
                    placeholder="Seleccionar..."
                  />
                  {data.componente_agroambiental.tipo_agroquimicos === 'Otro' && renderField('Especifique cual otro:', data.componente_agroambiental.tipo_agroquimicos_otro || '', (t) => updateAgroambiental({ tipo_agroquimicos_otro: t }), { placeholder: '' })}
                </>
              )}

              {/* 49 — texto libre */}
              {data.componente_agroambiental.uso_agroquimicos === 'No' ? (
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>49. Mencione el nombre del agroquímico</Text>
                  <View style={styles.lockedField}>
                    <Text style={styles.lockedFieldText}>Ninguno</Text>
                  </View>
                </View>
              ) : (
                renderField('49. Mencione el nombre del agroquímico', data.componente_agroambiental.herbicidas_cuales, (t) => updateAgroambiental({ herbicidas_cuales: t }), {
                  placeholder: '',
                })
              )}

              {/* 50 */}
              <DropdownPicker
                label="50. ¿Realiza manejo de residuos de agroquímicos?"
                value={data.componente_agroambiental.manejo_residuos || null}
                options={MANEJO_RESIDUOS_OPTS}
                onSelect={(val) => updateAgroambiental({ manejo_residuos: val })}
                placeholder="Seleccionar..."
              />
            </>
          ))}

          {/* ═══════════════════════════════════════════════════
               RECOMENDACIONES DEL TÉCNICO
               ═══════════════════════════════════════════════════ */}
          {renderSection('recomendaciones', 'RECOMENDACIONES DEL TÉCNICO', '📝', '#F57F17', (
            <>
              {renderField(
                '51. Recomendaciones técnicas para el sistema productivo:',
                data.recomendaciones.recomendaciones_tecnicas,
                (t) => updateRecomendaciones({ recomendaciones_tecnicas: t }),
                { placeholder: '', multiline: true, numberOfLines: 3 }
              )}
              {renderField(
                '52. Compromisos adquiridos sobre el desarrollo del estado actual del terreno:',
                data.recomendaciones.compromisos_productor,
                (t) => updateRecomendaciones({ compromisos_productor: t }),
                { placeholder: '', multiline: true, numberOfLines: 3 }
              )}
              {renderField(
                '53. Recomendaciones ambientales y de conservación:',
                data.recomendaciones.recomendaciones_ambientales,
                (t) => updateRecomendaciones({ recomendaciones_ambientales: t }),
                { placeholder: '', multiline: true, numberOfLines: 3 }
              )}
            </>
          ))}

          {/* ═══════════════════════════════════════════════════
               DESARROLLO DEL ACOMPAÑAMIENTO TÉCNICO
               ═══════════════════════════════════════════════════ */}
          {renderSection('acompanamiento', 'DESARROLLO ACOMPAÑAMIENTO TECNICO', '📋', '#00897B', (
            <>
              {/* 1 — Socialización (Sí/No) */}
              <View style={styles.acompaniamientoItem}>
                <Text style={styles.fieldLabel}>1. Socialización de actividades del proyecto al productor, mediante presentación digital.</Text>
                <View style={styles.siNoRow}>
                  <TouchableOpacity
                    style={[styles.siNoBtn, data.acompaniamiento.actividades_realizadas_si && styles.siNoBtnActive]}
                    onPress={() => toggleAcompaniamiento('actividades_realizadas_si', 'actividades_realizadas_no', true)}
                  >
                    <Text style={[styles.siNoBtnText, data.acompaniamiento.actividades_realizadas_si && styles.siNoBtnTextActive]}>Sí</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.siNoBtn, data.acompaniamiento.actividades_realizadas_no && styles.siNoBtnNoActive]}
                    onPress={() => toggleAcompaniamiento('actividades_realizadas_no', 'actividades_realizadas_si', true)}
                  >
                    <Text style={[styles.siNoBtnText, data.acompaniamiento.actividades_realizadas_no && styles.siNoBtnTextActive]}>No</Text>
                  </TouchableOpacity>
                </View>
                {renderField('Observaciones',
                  data.acompaniamiento.actividades_realizadas_obs,
                  (t) => updateAcompaniamiento({ actividades_realizadas_obs: t }),
                  { placeholder: 'Observaciones...', multiline: true, numberOfLines: 2 }
                )}
              </View>

              {/* 2 — Número de hectáreas */}
              <View style={styles.acompaniamientoItem}>
                <Text style={styles.fieldLabel}>2. Realización de selección y delimitación técnica del terreno para la implementación del cultivo de cacao en arreglo agroforestal con plátano y maderable.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.fieldLabel}>Número de hectáreas</Text>
                  <View style={{ flex: 1 }}>
                    {renderField('',
                      data.acompaniamiento.manejo_plagas_hectareas || '',
                      (t) => updateAcompaniamiento({ manejo_plagas_hectareas: t }),
                      { placeholder: '', keyboardType: 'numeric' }
                    )}
                  </View>
                  <Text style={styles.fieldLabel}>ha</Text>
                </View>
              </View>

              {/* 3 — Muestreo de suelo realizado */}
              <View style={styles.acompaniamientoItem}>
                <Text style={styles.fieldLabel}>3. Realización de muestreo de suelo, teniendo en cuenta: criterios de homogeneidad, uso actual del terreno, topografía y condiciones agroecológicas.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.fieldLabel}>Muestreo de suelo realizado</Text>
                  <View style={{ flex: 1 }}>
                    {renderField('',
                      data.acompaniamiento.manejo_suelo_cantidad || '',
                      (t) => updateAcompaniamiento({ manejo_suelo_cantidad: t }),
                      { placeholder: '', keyboardType: 'numeric' }
                    )}
                  </View>
                </View>
              </View>

              {/* 4 — Orientación producción (Sí/No) */}
              <View style={styles.acompaniamientoItem}>
                <Text style={styles.fieldLabel}>4. Orientación al productor sobre procesos de producción y beneficios de la producción de cacao.</Text>
                <View style={styles.siNoRow}>
                  <TouchableOpacity
                    style={[styles.siNoBtn, data.acompaniamiento.capacitacion_si && styles.siNoBtnActive]}
                    onPress={() => toggleAcompaniamiento('capacitacion_si', 'capacitacion_no', true)}
                  >
                    <Text style={[styles.siNoBtnText, data.acompaniamiento.capacitacion_si && styles.siNoBtnTextActive]}>Sí</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.siNoBtn, data.acompaniamiento.capacitacion_no && styles.siNoBtnNoActive]}
                    onPress={() => toggleAcompaniamiento('capacitacion_no', 'capacitacion_si', true)}
                  >
                    <Text style={[styles.siNoBtnText, data.acompaniamiento.capacitacion_no && styles.siNoBtnTextActive]}>No</Text>
                  </TouchableOpacity>
                </View>
                {renderField('Observaciones',
                  data.acompaniamiento.capacitacion_obs,
                  (t) => updateAcompaniamiento({ capacitacion_obs: t }),
                  { placeholder: 'Observaciones...', multiline: true, numberOfLines: 2 }
                )}
              </View>

              {/* 5 — Limpias (Sí/No) */}
              <View style={styles.acompaniamientoItem}>
                <Text style={styles.fieldLabel}>5. Orientación del manejo de preparación del terreno: realización de limpias si es rastrojo de porte bajo (herbáceas), recomendando no utilización de herbicidas a base de componentes de medio a altamente tóxicos.</Text>
                <View style={styles.siNoRow}>
                  <TouchableOpacity
                    style={[styles.siNoBtn, data.acompaniamiento.seguimiento_si && styles.siNoBtnActive]}
                    onPress={() => toggleAcompaniamiento('seguimiento_si', 'seguimiento_no', true)}
                  >
                    <Text style={[styles.siNoBtnText, data.acompaniamiento.seguimiento_si && styles.siNoBtnTextActive]}>Sí</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.siNoBtn, data.acompaniamiento.seguimiento_no && styles.siNoBtnNoActive]}
                    onPress={() => toggleAcompaniamiento('seguimiento_no', 'seguimiento_si', true)}
                  >
                    <Text style={[styles.siNoBtnText, data.acompaniamiento.seguimiento_no && styles.siNoBtnTextActive]}>No</Text>
                  </TouchableOpacity>
                </View>
                {renderField('Observaciones',
                  data.acompaniamiento.seguimiento_obs,
                  (t) => updateAcompaniamiento({ seguimiento_obs: t }),
                  { placeholder: 'Observaciones...', multiline: true, numberOfLines: 2 }
                )}
              </View>

              {/* 6 — Entresacado (Sí/No) */}
              <View style={styles.acompaniamientoItem}>
                <Text style={styles.fieldLabel}>6. Orientación del manejo de preparación del terreno: realización de entresacado en rastrojo biche de regeneración baja (arbóreas o arbustos), recomendando entresacado</Text>
                <View style={styles.siNoRow}>
                  <TouchableOpacity
                    style={[styles.siNoBtn, data.acompaniamiento.entresacado_si && styles.siNoBtnActive]}
                    onPress={() => toggleAcompaniamiento('entresacado_si', 'entresacado_no', true)}
                  >
                    <Text style={[styles.siNoBtnText, data.acompaniamiento.entresacado_si && styles.siNoBtnTextActive]}>Sí</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.siNoBtn, data.acompaniamiento.entresacado_no && styles.siNoBtnNoActive]}
                    onPress={() => toggleAcompaniamiento('entresacado_no', 'entresacado_si', true)}
                  >
                    <Text style={[styles.siNoBtnText, data.acompaniamiento.entresacado_no && styles.siNoBtnTextActive]}>No</Text>
                  </TouchableOpacity>
                </View>
                {renderField('Observaciones',
                  data.acompaniamiento.entresacado_obs || '',
                  (t) => updateAcompaniamiento({ entresacado_obs: t }),
                  { placeholder: 'Observaciones...', multiline: true, numberOfLines: 2 }
                )}
              </View>

              {/* 7 — Observaciones generales de la visita (última pregunta del formulario) */}
              <View style={styles.acompaniamientoItem}>
                <Text style={styles.fieldLabel}>7. Observaciones generales de la VISITA</Text>
                {renderField('Observaciones generales de la visita',
                  data.acompaniamiento.observaciones_visita || '',
                  (t) => updateAcompaniamiento({ observaciones_visita: t }),
                  { placeholder: 'Escriba aquí las observaciones generales de la visita...', multiline: true, numberOfLines: 4 }
                )}
              </View>
            </>
          ))}

          {/* ═══ EVIDENCIAS ═══ */}
          {renderSection('evidencias', 'EVIDENCIAS', '📸', '#0984E3', (
            <>
              <TouchableOpacity
                style={[styles.evidenciaCard, fotosCount >= 5 && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('Camara', {
                  mode: 'photo',
                  requisito: '5 Fotos (4 Fotos De Realizacion De Actividades + 1 Foto Del Cuaderno De Visita)',
                })}
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>📷</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Tomar Fotos</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {fotosCount > 0
                      ? `${fotosCount} de 5 foto(s) — 4 de actividades + 1 del cuaderno de visita`
                      : '5 Fotos (4 Fotos De Realizacion De Actividades + 1 Foto Del Cuaderno De Visita)'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.evidenciaCard, videosCount >= 1 && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('Camara', { mode: 'video' })}
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>🎥</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Tomar Video</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {videosCount > 0
                      ? `${videosCount} de 1 video(s) grabado(s)`
                      : 'Grabar video corto (máx. 30s)'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.evidenciaCard, firmaBeneficiarioOk && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('FirmaBeneficiario')}
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
                onPress={() => goToEvidencia('FirmaDigital')}
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
                onPress={() => goToEvidencia('FirmaBiometrica')}
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

              <TouchableOpacity
                style={[styles.evidenciaCard, documentosCount > 0 && styles.evidenciaCardOk]}
                onPress={() =>
                  goToEvidencia('Documentos', {
                    beneficiarioCedula: data.documento,
                    beneficiarioNombre: data.productor_nombre,
                  })
                }
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>📄</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Documentos de la Finca</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {documentosCount > 0 ? `${documentosCount} documento(s) vinculado(s) ✓` : 'Subir PDF, fotos, KML...'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <Text style={styles.evidenciasProgress}>
                {[fotosCount >= 5, videosCount >= 1, firmaBeneficiarioOk, firmaTecnicoOk].filter(Boolean).length} de 4 requisitos obligatorios completados
                {'\n'}Huella y documentos de la finca son opcionales
              </Text>
            </>
          ))}

          {/* ═══ UBICACIÓN ═══ */}
          {coordenadas && (
            <View style={styles.locationBox}>
              <Text style={styles.locationTitle}>📍 Ubicación capturada</Text>
              <Text style={styles.locationText}>
                Lat: {coordenadas.latitud.toFixed(6)} | Lon: {coordenadas.longitud.toFixed(6)}
              </Text>
              {coordenadas.altitud && (
                <Text style={styles.locationText}>Alt: {coordenadas.altitud.toFixed(1)} m</Text>
              )}
            </View>
          )}
        </ScrollView>

        {/* ═══ BOTTOM BAR ═══ */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, SPACING.sm) }]}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={guardarBorradorHandler}
            disabled={isSaving}
          >
            <Text style={styles.saveBtnText}>{isSaving ? '💾 Guardando...' : '💾 Guardar borrador'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.completeBtn, isSubmitting && styles.buttonDisabled]}
            onPress={confirmarCompletar}
            disabled={isSubmitting}
          >
            <Text style={styles.completeBtnText}>
              {isSubmitting ? '⏳...' : '✓ Completar'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Overlay de carga */}
        {isSubmitting && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Generando PDF y guardando datos...</Text>
            </View>
          </View>
        )}
      </View>
      </AppBackground>
    </SafeAreaView>
  );
};

// ─── Estilos ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
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
  sectionOkBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
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
  subSectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  halfField: {
    flex: 1,
  },
  fieldContainer: {
    marginBottom: SPACING.md,
  },
  fieldLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  required: {
    color: COLORS.error,
  },
  textInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  lockedField: {
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lockedFieldText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  editarManualBtn: {
    alignSelf: 'flex-start',
    marginBottom: SPACING.sm,
  },
  editarManualBtnText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.medium,
  },
  // Selección múltiple (checkboxes)
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  checkBox: {
    fontSize: 20,
    marginRight: SPACING.sm,
    color: COLORS.textSecondary,
  },
  checkBoxActive: {
    color: COLORS.primary,
  },
  checkLabel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    flex: 1,
  },
  // Nota informativa oficial (texto del ministerio)
  notaInfo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: -SPACING.xs,
    marginBottom: SPACING.sm,
  },
  // Acompañamiento
  acompaniamientoItem: {
    marginBottom: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  siNoRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  siNoBtn: {
    flex: 1,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  siNoBtnActive: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '18',
  },
  siNoBtnNoActive: {
    borderColor: COLORS.error,
    backgroundColor: COLORS.error + '12',
  },
  siNoBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
  },
  siNoBtnTextActive: {
    color: COLORS.textPrimary,
  },
  // Evidencias
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
  evidenciaIconText: {
    fontSize: 24,
  },
  evidenciaContent: {
    flex: 1,
  },
  evidenciaCardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  evidenciaCardDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  evidenciaArrow: {
    fontSize: 28,
    color: '#b2bec3',
    fontWeight: '300',
    marginLeft: SPACING.sm,
  },
  evidenciasProgress: {
    textAlign: 'center',
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  locationBox: {
    backgroundColor: COLORS.surfaceAlt,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  locationTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  locationText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  bottomBar: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    ...SHADOWS.md,
  },
  saveBtn: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.info,
    ...SHADOWS.sm,
  },
  saveBtnText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  completeBtn: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.success,
    ...SHADOWS.sm,
  },
  completeBtnText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loadingBox: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    marginHorizontal: SPACING.lg,
    ...SHADOWS.lg,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
});

export default EncuestaSocialAgroambientalScreen;
