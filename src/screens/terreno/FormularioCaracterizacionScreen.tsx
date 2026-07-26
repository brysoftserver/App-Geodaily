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
import { guardarBorrador, getBorrador, FormDraft } from '../../store/FormDraftStore';
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
  Formulario,
  ResumenClimatico,
} from '../../types';
import DropdownPicker from '../../components/DropdownPicker';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: RouteProp<Record<string, any> & { params: { draftId?: string } }, 'params'>;
};

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
  const [fotosCount, setFotosCount] = useState(0);
  const [firmaBeneficiarioOk, setFirmaBeneficiarioOk] = useState(false);
  const [firmaTecnicoOk, setFirmaTecnicoOk] = useState(false);
  const [huellaOk, setHuellaOk] = useState(false);
  const [documentosCount, setDocumentosCount] = useState(0);

  const formIdRef = useRef<string>('');
  const formularioRef = useRef(formularioActual);
  useEffect(() => { formularioRef.current = formularioActual; }, [formularioActual]);
  /** Cédula del productor — leída en callbacks que no dependen de `data` */
  const documentoRef = useRef('');
  useEffect(() => { documentoRef.current = data.documento?.trim() || ''; }, [data.documento]);

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
        }
      }

      // Capturar ubicación
      const coords = await getCurrentPosition();
      if (coords) {
        setCoordenadas(coords);
        // Best-effort: sin señal, el formulario se guarda igual con las
        // coordenadas crudas; nombre de lugar y clima quedan pendientes y
        // se resuelven solos en el próximo sync.
        resolverClimaYUbicacion(coords.latitud, coords.longitud, coords.timestamp)
          .then(({ lugar, resumen }) => {
            if (lugar) setLugarResuelto(lugar);
            if (resumen) setClimaResuelto(resumen);
          })
          .catch((e) => console.warn('[Encuesta] No se pudo resolver clima/ubicación:', e));
      } else {
        Alert.alert(
          'Ubicación no disponible',
          'No se pudo obtener tu ubicación GPS. El formulario se guardará sin coordenadas — verifica el permiso de ubicación y la señal GPS.'
        );
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

  // Refrescar evidencias al volver de pantallas
  useFocusEffect(
    useCallback(() => {
      if (formularioActual) {
        setFotosCount(formularioActual.fotos?.length || 0);
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

  // ─── Autoguardado silencioso ─────────────────────────────
  // Sin esto, un crash o que Android mate la app a mitad de la encuesta perdía
  // TODO lo no guardado a mano: 20-40 minutos de trabajo con el beneficiario
  // delante. Guarda solo el borrador (sin subidas ni alertas) cada 60 s y al
  // pasar la app a segundo plano.
  const autoguardarRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    autoguardarRef.current = async () => {
      try {
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
          selectedDepartamento: 'Caquetá',
          selectedActividad: '',
          otraActividadText: '',
          descripcionDetallada: '',
          updated_at: new Date().toISOString(),
        };
        await guardarBorrador(draft);
        console.log('[Carac] Autoguardado:', draftIdActual);
      } catch (e) {
        console.warn('[Carac] Autoguardado falló:', e);
      }
    };
  });

  useEffect(() => {
    const intervalo = setInterval(() => {
      autoguardarRef.current?.();
    }, 60000);

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
        selectedDepartamento: 'Caquetá',
        selectedActividad: '',
        otraActividadText: '',
        descripcionDetallada: '',
        updated_at: new Date().toISOString(),
      };

      await guardarBorrador(draft);

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
      try {
        for (const foto of fotosActuales) {
          if (foto.tipo === 'video') {
            saveVideoLocal(foto.id, draftIdActual, foto.uri, foto.coordenadas).catch(() => {});
          } else {
            saveFotoLocal(foto.id, draftIdActual, foto.uri, foto.coordenadas).catch(() => {});
          }
        }
      } catch { /* ignorar */ }

      Alert.alert(
        '💾 Guardado',
        verifyOk
          ? `Evidencias guardadas:\n📸 ${fotosActuales.length} foto(s)\n✍️ ${firmaBenefActual ? 'Sí' : 'No'} firma beneficiario\n✍️ ${firmaTecActual ? 'Sí' : 'No'} firma técnico\n👆 ${huellaActual ? 'Sí' : 'No'} huella`
          : `⚠️ Guardado con advertencia — revisa la consola.`
      );
    } catch (err) {
      Alert.alert('Error', 'No se pudo guardar: ' + (err as Error)?.message);
    } finally {
      setIsSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, coordenadas, user, formularioActual]);

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
        for (const foto of fotosParaUpload) {
          if (foto.tipo === 'video') {
            saveVideoLocal(foto.id, formId, foto.uri, foto.coordenadas).catch(() => {});
          } else {
            saveFotoLocal(foto.id, formId, foto.uri, foto.coordenadas).catch(() => {});
          }
        }
      } catch { /* ignorar */ }

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
      const coordenadasConLugar = coordenadas
        ? { ...coordenadas, ...(lugarResuelto ? { lugar: lugarResuelto } : {}) }
        : { latitud: 0, longitud: 0 };
      setCoordenadas(coordenadasConLugar);

      let pdfUrl: string | undefined;
      try {
        const { generarPDFLocal } = await import('../../services/pdfLocal.service');
        const formData: Formulario = {
          id: formIdRef.current || 'encuesta-' + Date.now(),
          tipo: 'caracterizacion',
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
          sociodemografico: undefined,
          coordenadas: coordenadasConLugar,
          clima: climaResuelto || undefined,
          fotos: formularioActual?.fotos || [],
          firma_beneficiario: formularioActual?.firma_beneficiario || '',
          firma_tecnico: formularioActual?.firma_tecnico || '',
          huella_beneficiario: formularioActual?.huella_beneficiario || false,
          sincronizado: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          caracterizacion_nueva: data as any,
        } as any;
        const localUri = await generarPDFLocal(formData);
        if (localUri) pdfUrl = localUri;
      } catch (e) {
        console.warn('[Encuesta] No se pudo generar PDF:', e);
      }

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
      form.pdf_url = pdfUrl || form.pdf_url;
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
        [{ text: 'Ver listado', onPress: () => navigation.navigate('TerrenoFormularioList') }]
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

  // ─── Render ──────────────────────────────────────────────

  // --- Sección reutilizable ---
  const renderSection = (
    title: string,
    icon: string,
    color: string,
    children: React.ReactNode
  ) => (
    <View style={[styles.sectionCard, { borderLeftColor: color }]}>
      <View style={[styles.sectionHeader, { backgroundColor: color + '12' }]}>
        <Text style={[styles.sectionTitle, { color }]}>
          {icon}  {title}
        </Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );

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
  const renderCapturaGPS = (
    label: string,
    lat: string | undefined,
    lon: string | undefined,
    alt: string | undefined,
    onCapture: (lat: string, lon: string, alt: string) => void
  ) => (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        style={styles.gpsButton}
        onPress={async () => {
          const coords = await getCurrentPosition();
          if (coords) {
            onCapture(
              String(coords.latitud),
              String(coords.longitud),
              coords.altitud != null ? String(Math.round(coords.altitud)) : ''
            );
          } else {
            Alert.alert('Sin señal GPS', 'No se pudo obtener la ubicación. Verifica el permiso de ubicación y vuelve a intentar.');
          }
        }}
        activeOpacity={0.7}
      >
        <Text style={styles.gpsButtonText}>📍 Capturar ubicación</Text>
      </TouchableOpacity>
      {lat && lon ? (
        <Text style={styles.gpsResultado}>
          Lat: {lat}   Lon: {lon}{alt ? `   Alt: ${alt} m` : ''}
        </Text>
      ) : (
        <Text style={styles.gpsPendiente}>Aún sin capturar</Text>
      )}
    </View>
  );

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
          {renderSection('DATOS GENERALES', '📋', COLORS.primary, (
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
          {renderSection('COMPONENTE SOCIAL', '👥', '#2E7D32', (
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
          {renderSection('CARACTERIZACION DE LA FINCA', '🏠', '#8D6E63', (
            <>
              {/* 19 */}
              {renderField('19. Nombre de la finca', data.caracterizacion_finca.nombre_finca, (t) => updateFinca({ nombre_finca: t }), {
                placeholder: '',
              })}

              {/* 20 — Captura GPS con resultado debajo */}
              {renderCapturaGPS(
                '20. Coordenada de la finca',
                data.caracterizacion_finca.latitud,
                data.caracterizacion_finca.longitud,
                data.caracterizacion_finca.altitud,
                (lat, lon, alt) => updateFinca({ latitud: lat, longitud: lon, altitud: alt })
              )}

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
          {renderSection('COMPONENTE PRODUCTIVO', '🌱', '#1565C0', (
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
          {renderSection('SECCIÓN DE SUELO', '🔬', '#6A1B9A', (
            <>
              {/* 32 — Punto de georeferenciación */}
              {renderCapturaGPS(
                '32. Ubicación del área de intervención del proyecto',
                data.analisis_suelo.intervencion_latitud,
                data.analisis_suelo.intervencion_longitud,
                data.analisis_suelo.intervencion_altitud,
                (lat, lon, alt) => updateAnalisis({ intervencion_latitud: lat, intervencion_longitud: lon, intervencion_altitud: alt })
              )}

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
          {renderSection('COMPONENTE AGROAMBIENTAL', '🌿', '#E65100', (
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
          {renderSection('RECOMENDACIONES DEL TÉCNICO', '📝', '#F57F17', (
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
          {renderSection('DESARROLLO ACOMPAÑAMIENTO TECNICO', '📋', '#00897B', (
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
            </>
          ))}

          {/* ═══ EVIDENCIAS ═══ */}
          {renderSection('EVIDENCIAS', '📸', '#0984E3', (
            <>
              <TouchableOpacity
                style={[styles.evidenciaCard, fotosCount > 0 && styles.evidenciaCardOk]}
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
                      ? `${fotosCount} foto(s) capturada(s) — requisito: 5 Fotos (4 Fotos De Realizacion De Actividades + 1 Foto Del Cuaderno De Visita)`
                      : '5 Fotos (4 Fotos De Realizacion De Actividades + 1 Foto Del Cuaderno De Visita)'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.evidenciaCard, fotosCount > 0 && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('Camara', { mode: 'video' })}
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>🎥</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Tomar Video</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    Grabar video corto (máx. 30s)
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
                {[fotosCount > 0, firmaBeneficiarioOk, firmaTecnicoOk, huellaOk, documentosCount > 0].filter(Boolean).length} de 5 evidencias completadas
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
            onPress={handleCompletar}
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
  // Captura GPS
  gpsButton: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
  },
  gpsButtonText: {
    color: '#fff',
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.md,
  },
  gpsResultado: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.sm,
    color: COLORS.success,
    fontWeight: FONTS.weights.medium,
  },
  gpsPendiente: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    fontStyle: 'italic',
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
