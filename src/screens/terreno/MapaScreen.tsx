// ============================================================
// GEODAILY — Pantalla de Mapa Offline (Mejorada)
// ============================================================
// Mapa interactivo con: navegación GPS, medición de terreno
// (Shoelace), conteo de plantas, importación/exportación KML.
// ============================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  TextInput,
  Alert,
  Modal,
  AppState,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useSync } from '../../store/SyncContext';
import { useGPS } from '../../store/GPSContext';
import MapViewOffline, { esCoordenadaValida } from '../../components/MapViewOffline';
import type { MapBaseStyle } from '../../components/mapa/MapToolbar';
import { calcularArea, exportarKML, importarKML } from '../../services/kml.service';
import {
  savePlantacion,
  saveMedicion,
  actualizarNombreMedicion,
  getPlantaciones,
  getMediciones,
  deleteMedicionLocal,
  deletePlantacionLocal,
} from '../../services/database';
import * as DocumentPicker from 'expo-document-picker';
import {
  isOfflineMapAvailable,
  descargarMapaOffline,
  descargarMapaOfflinePorBounds,
  listarPaquetesOffline,
  eliminarPaqueteOffline,
  LIMITES_PUERTO_RICO_MUNICIPIO,
  OfflinePackInfo,
} from '../../services/offlineMap.service';
import { Plantacion, Coordenadas, PuntoPoligono } from '../../types';
import { PLANTAS_OPCIONES, getIconoEspecie } from '../../utils/constants';
import { PADRON_BENEFICIARIOS } from '../../data/padronBeneficiarios';

const STORAGE_KEY_MAP = '@geodaily/mapa_estado';

// Zona de trabajo del proyecto (Puerto Rico, Caquetá) — permite descargar
// el mapa correcto para los técnicos sin importar desde dónde se esté
// probando/preparando la descarga (ej. alguien en Florencia preparando el
// mapa para técnicos que trabajan en Puerto Rico).
const PUERTO_RICO_CENTRO: Coordenadas = { latitud: 1.914, longitud: -75.145 };

type ModoMapa = 'medir' | 'contar';

/**
 * FEATURE FLAG — Conteo de plantaciones.
 *
 * El conteo de plantaciones (dibujar el área, elegir especie y guardar) se
 * deja OCULTO por ahora: se usará en formularios futuros. Todo el código
 * sigue intacto (estado, handlers, guardado, sincronización, polígonos
 * guardados) y solo se esconde la interfaz. Para reactivarlo basta con
 * poner esta constante en `true`.
 */
const MOSTRAR_CONTEO_PLANTACIONES = false;

/**
 * Parámetros con los que se abre el mapa (ver `TerrenoStackParamList`).
 * El nombre del beneficiario llega desde el formulario de visita técnica
 * («Abrir mapa para trazar el área») para poder nombrar el KML exportado.
 *
 * Además del nombre se recibe la atribución completa (cédula, vereda,
 * corregimiento) y el `formularioId` de la visita: antes el polígono se
 * guardaba «suelto» y en el mapa general aparecía sin dueño, mientras que
 * las plantaciones sí quedaban amarradas al beneficiario.
 */
type MapaRouteParams =
  | {
      beneficiarioNombre?: string;
      beneficiarioCedula?: string;
      vereda?: string;
      corregimiento?: string;
      formularioId?: string;
      visitaNumero?: number;
      /**
       * Modo consulta: el mapa solo sirve para VER los polígonos ya
       * recolectados. No se pueden trazar mediciones ni conteos.
       * Se activa cuando el técnico abre el mapa desde el menú general
       * (no desde un formulario).
       */
      soloLectura?: boolean;
    }
  | undefined;

/**
 * Sufijo automático que se agrega al final del nombre de cada KML para
 * saber de dónde viene: «… - Medición» / «… - Conteo».
 */
const SUFIJOS_KML: Record<ModoMapa, string> = {
  medir: 'Medicion',
  contar: 'Conteo',
};

/** Quita acentos y espacios dobles de un nombre escrito a mano. */
const limpiarNombreKML = (texto: string): string => texto.replace(/\s+/g, ' ').trim();

const MapaScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { user, isAdmin, isCoordinador, isInterventor, isGerente } = useAuth();
  // Los roles superiores ven todas las mediciones (con su atribución); el
  // técnico solo las suyas.
  const canViewAll = isAdmin || isCoordinador || isInterventor || isGerente;
  const { syncNow } = useSync();
  const route = useRoute<RouteProp<{ TerrenoMapa: MapaRouteParams }, 'TerrenoMapa'>>();
  // El mapa abierto desde el menú general es de solo lectura: el técnico
  // consulta sus polígonos pero no puede trazar. El trazado solo se habilita
  // cuando se entra desde un formulario (Visita Técnica 2).
  const soloLectura = route.params?.soloLectura === true;
  const [modo, setModo] = useState<ModoMapa>('medir');
  const [ultimoPunto, setUltimoPunto] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);

  // --- Centro del mapa estable (se inicializa con la primera ubicación GPS) ---
  const [mapCenter, setMapCenter] = useState<Coordenadas | undefined>(undefined);
  const mapCenterInitialized = useRef(false);

  // GPS: consumir el watch único del GPSContext
  const { userLocation, getCurrentPosition, siguiendo: siguiendoGPS, setSiguiendo: setSiguiendoGPS } = useGPS();

  // Inicializar centro del mapa con la primera posición GPS disponible
  useEffect(() => {
    if (!mapCenterInitialized.current && userLocation) {
      setMapCenter(userLocation);
      mapCenterInitialized.current = true;
    }
  }, [userLocation]);

  // La navegación está inmersa en Medición y Conteo: activamos el seguimiento
  // en tiempo real desde el primer momento, sin esperar a que el técnico
  // toque "Mi Ubicación". El técnico puede apagarlo tocando el mapa (pan/zoom
  // libre) y reactivarlo con el botón "Mi Ubicación".
  useEffect(() => {
    setSiguiendoGPS(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seguir al usuario en tiempo real mientras el seguimiento esté activo.
  // El técnico lo apaga al hacer pan/zoom manual (para ubicar cada punto con
  // precisión) y lo reactiva con el botón "Mi Ubicación".
  useEffect(() => {
    if (siguiendoGPS && userLocation && mapCenterInitialized.current) {
      setMapCenter(userLocation);
    }
  }, [siguiendoGPS, userLocation]);

  // --- Estado para Medición ---
  const [poligono, setPoligono] = useState<PuntoPoligono[]>([]);
  const [resultadoArea, setResultadoArea] = useState<{
    areaMetros2: number;
    areaHectareas: number;
    perimetroMetros: number;
  } | null>(null);
  const [mostrarResultado, setMostrarResultado] = useState(false);
  /**
   * true cuando la medición del polígono actual ya quedó en SQLite.
   * Se usa para que el botón «Guardar» del panel de resultado confirme con
   * certeza en vez de dar por hecho que se guardó (si el guardado falló al
   * calcular, avisa que hay que reintentar).
   */
  const [medicionPersistida, setMedicionPersistida] = useState(false);

  // --- Estado para distancia lineal (2 puntos) ---
  const [resultadoDistancia, setResultadoDistancia] = useState<{
    distanciaMetros: number;
    distanciaKm: number;
  } | null>(null);

  /**
   * Id de la medición del polígono actual (el mismo que usa «Calcular» para
   * guardarla en SQLite). «Guardar» lo necesita para ponerle nombre a esa fila
   * y que quede identificable en el 📋 Historial.
   */
  const [idMedicionActual, setIdMedicionActual] = useState<string | null>(null);

  // --- Estado para Conteo (polígono de plantación + selector de especie) ---
  const [mostrarPanelConteo, setMostrarPanelConteo] = useState(false);
  const [plantaSeleccionada, setPlantaSeleccionada] = useState<string>('Cacao');
  const [cantidadInput, setCantidadInput] = useState<string>('');
  /** Polígono que el técnico va dibujando en modo conteo */
  const [plantacionPoligono, setPlantacionPoligono] = useState<PuntoPoligono[]>([]);
  /** Beneficiario asociado al área de plantación (OBLIGATORIO). La vereda y el
   *  corregimiento NO se eligen a mano: vienen amarrados del padrón al buscar la
   *  cédula, para que no queden datos incoherentes. */
  const [plantacionCedula, setPlantacionCedula] = useState('');
  const [plantacionBeneficiarioNombre, setPlantacionBeneficiarioNombre] = useState('');
  const [plantacionVereda, setPlantacionVereda] = useState('');
  const [plantacionCorregimiento, setPlantacionCorregimiento] = useState('');
  /** true solo cuando la cédula escrita corresponde a un beneficiario del padrón */
  const [beneficiarioValido, setBeneficiarioValido] = useState(false);
  /** Sugerencias de beneficiarios que coinciden con lo que se va escribiendo */
  const [sugerenciasBeneficiario, setSugerenciasBeneficiario] = useState<
    { cedula: string; nombre: string; vereda: string; corregimiento: string }[]
  >([]);

  /** Aplica un beneficiario del padrón al formulario (nombre/vereda/corregimiento). */
  const aplicarBeneficiario = useCallback(
    (cedula: string, datos: { nombre: string; vereda: string; corregimiento: string }) => {
      setPlantacionCedula(cedula);
      setPlantacionBeneficiarioNombre(datos.nombre);
      setPlantacionVereda(datos.vereda);
      setPlantacionCorregimiento(datos.corregimiento);
      setBeneficiarioValido(true);
      setSugerenciasBeneficiario([]);
    },
    [],
  );

  const buscarBeneficiarioPlantacionPorCedula = useCallback(() => {
    const cedula = plantacionCedula.trim();
    const encontrado = PADRON_BENEFICIARIOS[cedula];
    if (encontrado) {
      aplicarBeneficiario(cedula, encontrado);
    } else {
      setPlantacionBeneficiarioNombre('');
      setPlantacionVereda('');
      setPlantacionCorregimiento('');
      setBeneficiarioValido(false);
      Alert.alert('No encontrado', 'No se encontró un beneficiario con esa cédula en el padrón.');
    }
  }, [plantacionCedula, aplicarBeneficiario]);

  /** Al editar la cédula se invalida el beneficiario hasta volver a buscarlo, para
   *  que no se guarde una cédula distinta a la del nombre/vereda mostrados. Además
   *  se calculan sugerencias (por cédula o por nombre) para elegir con un toque. */
  const onChangeCedulaPlantacion = useCallback(
    (texto: string) => {
      setPlantacionCedula(texto);
      if (beneficiarioValido) {
        setBeneficiarioValido(false);
        setPlantacionBeneficiarioNombre('');
        setPlantacionVereda('');
        setPlantacionCorregimiento('');
      }
      const q = texto.trim().toLowerCase();
      if (q.length < 2) {
        setSugerenciasBeneficiario([]);
        return;
      }
      const coincidencias = Object.entries(PADRON_BENEFICIARIOS)
        .filter(([cedula, datos]) => cedula.includes(q) || datos.nombre.toLowerCase().includes(q))
        .slice(0, 6)
        .map(([cedula, datos]) => ({ cedula, ...datos }));
      setSugerenciasBeneficiario(coincidencias);
    },
    [beneficiarioValido],
  );

  // --- Estado para Plantaciones (Fase B) ---
  const [plantaciones, setPlantaciones] = useState<Plantacion[]>([]);
  /** Plantación tocada en el mapa (marcador ya guardado) — abre el detalle */
  const [plantacionSeleccionada, setPlantacionSeleccionada] = useState<Plantacion | null>(null);

  // --- Estado para KML ---
  const [mostrarModalKML, setMostrarModalKML] = useState(false);
  // Modal de nombrado del KML: el técnico decide cómo se llama el archivo y
  // el sufijo de origen (Medición / Conteo) se agrega solo.
  const [mostrarModalNombreKML, setMostrarModalNombreKML] = useState(false);
  const [nombreBaseKML, setNombreBaseKML] = useState('');
  const [exportandoKML, setExportandoKML] = useState(false);
  const [guardandoMedicion, setGuardandoMedicion] = useState(false);
  /**
   * Qué hace el botón de confirmar del modal de nombre:
   * - 'exportar' → genera el archivo .kml (botón «Exportar KML»).
   * - 'guardar'  → guarda el nombre en la medición y la deja en el historial
   *                (botón «Guardar»), SIN exportar archivo.
   */
  const [accionNombre, setAccionNombre] = useState<'exportar' | 'guardar'>('exportar');
  /** Nombre del beneficiario recibido desde el formulario de visita técnica. */
  const beneficiarioNombreRuta = limpiarNombreKML(route.params?.beneficiarioNombre ?? '');
  /**
   * Atribución de la visita desde la que se abrió el mapa. Se guarda junto a
   * cada medición para que el polígono quede amarrado al beneficiario y los
   * roles superiores puedan ver de quién es en el mapa general.
   */
  const atribucionVisita = useRef({
    cedula: route.params?.beneficiarioCedula || null,
    nombre: route.params?.beneficiarioNombre || null,
    vereda: route.params?.vereda || null,
    corregimiento: route.params?.corregimiento || null,
    formularioId: route.params?.formularioId || null,
    visitaNumero: route.params?.visitaNumero ?? null,
  });

  // --- Historial de mediciones (áreas/distancias guardadas) ---
  const [mostrarHistorialMediciones, setMostrarHistorialMediciones] = useState(false);
  const [medicionesGuardadas, setMedicionesGuardadas] = useState<Record<string, any>[]>([]);
  const [cargandoHistorialMediciones, setCargandoHistorialMediciones] = useState(false);
  const [medicionPreview, setMedicionPreview] = useState<{ id: string; nombre?: string | null; puntos: { latitud: number; longitud: number }[] } | null>(null);
  const [eliminandoMedicionId, setEliminandoMedicionId] = useState<string | null>(null);
  // Confirmación de borrado propia (Alert.alert no muestra botones en web).
  const [confirmarEliminarMedicion, setConfirmarEliminarMedicion] = useState<Record<string, any> | null>(null);

  // --- Historial de plantaciones (áreas de siembra guardadas) ---
  const [mostrarHistorialPlantaciones, setMostrarHistorialPlantaciones] = useState(false);
  const [eliminandoPlantacionId, setEliminandoPlantacionId] = useState<string | null>(null);
  // Confirmación de borrado propia (Alert.alert no muestra botones en web).
  const [confirmarEliminarPlantacion, setConfirmarEliminarPlantacion] = useState<Plantacion | null>(null);
  /** Plantación que se está editando (revivida desde el historial). Si es null,
   *  el panel de conteo está creando una nueva. */
  const [plantacionEditandoId, setPlantacionEditandoId] = useState<string | null>(null);

  // --- Tipo de mapa: Terreno/Calles (Esri Topo), Satélite HD o Satélite Relieve (Sentinel-2 2025) ---
  const [tipoMapa, setTipoMapa] = useState<MapBaseStyle>('terreno');

  // --- Descarga de mapa offline (solo disponible con dev client / build nativo) ---
  const [descargandoMapa, setDescargandoMapa] = useState(false);
  const [progresoDescarga, setProgresoDescarga] = useState(0);
  const [mostrarModalPaquetes, setMostrarModalPaquetes] = useState(false);
  const [paquetesOffline, setPaquetesOffline] = useState<OfflinePackInfo[]>([]);

  const abrirGestionPaquetes = useCallback(async () => {
    const paquetes = await listarPaquetesOffline();
    setPaquetesOffline(paquetes);
    setMostrarModalPaquetes(true);
  }, []);

  const handleEliminarPaquete = useCallback(async (name: string) => {
    await eliminarPaqueteOffline(name);
    setPaquetesOffline((prev) => prev.filter((p) => p.name !== name));
  }, []);

  // Vuelve a descargar un paquete existente con la misma zona/tipo — refresca
  // los datos con la versión actual de las teselas y actualiza la fecha.
  const handleActualizarPaquete = useCallback(async (pack: OfflinePackInfo) => {
    const meta = pack.metadata || {};
    setMostrarModalPaquetes(false);
    setDescargandoMapa(true);
    setProgresoDescarga(0);
    let resultado: { success: boolean; error?: string };
    if (meta.bounds) {
      resultado = await descargarMapaOfflinePorBounds(
        meta.bounds,
        meta.tipo,
        meta.nombreZona || 'zona',
        meta.maxZoom,
        setProgresoDescarga
      );
    } else if (meta.center) {
      resultado = await descargarMapaOffline(meta.center, meta.radioKm || 20, meta.tipo, setProgresoDescarga);
    } else {
      resultado = { success: false, error: 'No se pudo determinar la zona original de este mapa. Descárgalo de nuevo desde "Descargar mapa offline".' };
    }
    setDescargandoMapa(false);
    if (resultado.success) {
      Alert.alert('✅ Mapa actualizado', 'Este mapa offline quedó con los datos más recientes.');
      const paquetes = await listarPaquetesOffline();
      setPaquetesOffline(paquetes);
    } else {
      Alert.alert('Error', resultado.error || 'No se pudo actualizar el mapa.');
    }
  }, []);

  const formatearFechaPack = (iso?: string): string => {
    if (!iso) return 'Fecha desconocida';
    try {
      return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return 'Fecha desconocida';
    }
  };

  const formatearZonaPack = (pack: OfflinePackInfo): string => {
    const meta = pack.metadata || {};
    if (meta.nombreZona === 'municipio-completo') return 'Puerto Rico completo (municipio)';
    if (meta.radioKm) return `Radio ${meta.radioKm} km`;
    return pack.name;
  };

  const ejecutarDescarga = useCallback(async (centro: Coordenadas, radioKm: number) => {
    setDescargandoMapa(true);
    setProgresoDescarga(0);
    const resultado = await descargarMapaOffline(centro, radioKm, tipoMapa, setProgresoDescarga);
    setDescargandoMapa(false);
    if (resultado.success) {
      Alert.alert('✅ Mapa descargado', 'Ya puedes usar este mapa sin conexión.');
    } else {
      Alert.alert('Error', resultado.error || 'No se pudo descargar el mapa offline.');
    }
  }, [tipoMapa]);

  const ejecutarDescargaMunicipio = useCallback(async () => {
    setDescargandoMapa(true);
    setProgresoDescarga(0);
    const resultado = await descargarMapaOfflinePorBounds(
      LIMITES_PUERTO_RICO_MUNICIPIO,
      tipoMapa,
      'municipio-completo',
      undefined,
      setProgresoDescarga
    );
    setDescargandoMapa(false);
    if (resultado.success) {
      Alert.alert('✅ Municipio completo descargado', 'Ya puedes usar el mapa de todo Puerto Rico (Caquetá) sin conexión.');
    } else {
      Alert.alert('Error', resultado.error || 'No se pudo descargar el mapa offline.');
    }
  }, [tipoMapa]);

  // El municipio completo (6 corregimientos) son ~2.700 km² a más detalle
  // (zoom 17) que la descarga rápida de 20km — se avisa el peso aproximado
  // antes de iniciar porque conviene hacerlo con WiFi.
  const confirmarDescargaMunicipio = useCallback(() => {
    Alert.alert(
      '🗺️ Puerto Rico completo (municipio)',
      'Cubre los 6 corregimientos completos, con más nivel de detalle que la descarga rápida. Pesa aproximadamente 300–900 MB según el tipo de mapa — se recomienda hacerlo con WiFi.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Descargar', onPress: ejecutarDescargaMunicipio },
      ]
    );
  }, [ejecutarDescargaMunicipio]);

  const handleDescargarMapaOffline = useCallback(async () => {
    if (!isOfflineMapAvailable()) {
      Alert.alert(
        'No disponible en esta versión',
        'La descarga de mapas offline requiere la app instalada (no funciona en Expo Go). Pide la versión instalable al equipo técnico.'
      );
      return;
    }
    const centroActual = mapCenter ?? userLocation;
    Alert.alert(
      'Descargar mapa offline',
      '¿Qué zona quieres descargar? Hazlo con WiFi si es posible.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: '🗺️ Puerto Rico completo (municipio, más detalle)',
          onPress: confirmarDescargaMunicipio,
        },
        {
          text: '📍 Puerto Rico, Caquetá (rápida, 20km desde el centro)',
          onPress: () => ejecutarDescarga(PUERTO_RICO_CENTRO, 20),
        },
        ...(centroActual
          ? [{
              text: '📌 Mi ubicación actual (10km)',
              onPress: () => ejecutarDescarga(centroActual, 10),
            }]
          : []),
      ]
    );
  }, [mapCenter, userLocation, ejecutarDescarga, confirmarDescargaMunicipio]);

  // --- Persistencia automática: guardar al salir, restaurar al entrar ---
  const guardarEstadoMapa = useCallback(async () => {
    try {
      const estado = {
        poligono,
        // Faltaba: el técnico marcaba 15 puntos del área de plantación, salía
        // a la cámara y al volver el polígono estaba vacío mientras `modo`
        // sí se restauraba — un estado incoherente que parecía fallo aleatorio.
        plantacionPoligono,
        resultadoArea,
        resultadoDistancia,
        mostrarResultado,
        ultimoPunto,
        modo,
        tipoMapa,
        mapCenter,
        ultimasCoords: userLocation,
      };
      await AsyncStorage.setItem(STORAGE_KEY_MAP, JSON.stringify(estado));
    } catch (e) {
      console.warn('[Mapa] Error al guardar estado:', e);
    }
  }, [poligono, plantacionPoligono, resultadoArea, resultadoDistancia, mostrarResultado, ultimoPunto, modo, tipoMapa, mapCenter, userLocation]);

  // Cargar plantaciones del usuario desde SQLite
  const cargarPlantaciones = useCallback(async () => {
    try {
      const data = await getPlantaciones(user?.id);
      setPlantaciones(data);
    } catch (e) {
      console.warn('[Mapa] Error al cargar plantaciones:', e);
    }
  }, [user?.id]);

  // Usar refs para evitar que useFocusEffect se re-ejecute cuando cambien
  const guardarEstadoMapaRef = useRef(guardarEstadoMapa);
  guardarEstadoMapaRef.current = guardarEstadoMapa;
  const cargarPlantacionesRef = useRef(cargarPlantaciones);
  cargarPlantacionesRef.current = cargarPlantaciones;

  useFocusEffect(
    useCallback(() => {
      let activo = true;
      const cargarEstado = async () => {
        try {
          const json = await AsyncStorage.getItem(STORAGE_KEY_MAP);
          if (json && activo) {
            const estado = JSON.parse(json);
            if (estado.poligono) setPoligono(estado.poligono);
            if (estado.plantacionPoligono) setPlantacionPoligono(estado.plantacionPoligono);
            if (estado.resultadoArea) {
              setResultadoArea(estado.resultadoArea);
              if (estado.mostrarResultado) setMostrarResultado(true);
            }
            if (estado.resultadoDistancia) {
              setResultadoDistancia(estado.resultadoDistancia);
              if (estado.mostrarResultado) setMostrarResultado(true);
            }
            if (estado.ultimoPunto) setUltimoPunto(estado.ultimoPunto);
            // Saneo: versiones anteriores guardaban modo 'ruta' o 'navegar'
            // (ya eliminados). Si viene un valor inválido, caemos a 'medir'
            // para no dejar la pantalla en un modo inexistente.
            if (estado.modo === 'medir' || estado.modo === 'contar') {
              // Con el conteo oculto, un estado guardado en 'contar' dejaría
              // la pantalla en un modo sin interfaz: caemos a 'medir'.
              setModo(
                estado.modo === 'contar' && !MOSTRAR_CONTEO_PLANTACIONES
                  ? 'medir'
                  : estado.modo
              );
            } else if (estado.modo) {
              setModo('medir');
            }
            if (estado.tipoMapa === 'terreno' || estado.tipoMapa === 'satelite' || estado.tipoMapa === 'satelite-reciente') {
              setTipoMapa(estado.tipoMapa);
            }
            if (estado.mapCenter) setMapCenter(estado.mapCenter);
          }
        } catch (e) {
          console.warn('[Mapa] Error al cargar estado:', e);
        }
        // Cargar plantaciones desde SQLite
        if (activo) {
          await cargarPlantacionesRef.current();
        }
      };
      cargarEstado();
      return () => {
        activo = false;
        guardarEstadoMapaRef.current();
        // NO detener GPS watch — debe seguir vivo al navegar
      };
    }, []) // ← Deps vacío: solo corre al obtener/perder foco, estable
  );

  // Guardar también al pasar a segundo plano: antes el estado del mapa solo
  // se guardaba al PERDER EL FOCO, así que si Android mataba la app estando
  // en el mapa se perdía el polígono de medición entero.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background' || estado === 'inactive') {
        guardarEstadoMapaRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  // Centrar en ubicación actual y seguir en tiempo real
  const centrarEnGPS = useCallback(async () => {
    setLocating(true);
    try {
      // Reutilizar la posición del watch global si es reciente (<60 s):
      // evita un fix nuevo que puede tardar o colgarse cuando ya hay una
      // lectura viva. Si está vieja o no hay, se pide una fresca.
      const edadMs = userLocation?.timestamp
        ? Date.now() - new Date(userLocation.timestamp).getTime()
        : Infinity;
      const coords =
        userLocation && edadMs < 60000 ? userLocation : await getCurrentPosition();
      if (coords) {
        setMapCenter({
          latitud: coords.latitud,
          longitud: coords.longitud,
        });
        setSiguiendoGPS(true);
        setUltimoPunto(null);
      } else {
        // Fallback a última posición del watch si getCurrentPosition falló
        if (userLocation) {
          setMapCenter(userLocation);
          setSiguiendoGPS(true);
          setUltimoPunto(null);
        } else {
          Alert.alert(
            '📍 Sin ubicación',
            'No se pudo obtener la ubicación GPS.\n\n' +
            'Verifica que el GPS esté activado y tengas conexión con los satélites.\n' +
            'Si estás en interiores, intenta salir a un espacio abierto.'
          );
        }
      }
    } finally {
      setLocating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCurrentPosition, userLocation]);

  // Centrado manual "de una sola vez" para Medición/Conteo — a diferencia de
  // centrarEnGPS, NO activa el seguimiento continuo (setSiguiendoGPS queda
  // en false) ni cambia el zoom: solo mueve la cámara a la posición actual
  // cuando el técnico lo pide, sin volver a moverse sola después.
  const [foco, setFoco] = useState<{ coords: Coordenadas; nonce: number } | null>(null);
  const [centrando, setCentrando] = useState(false);
  const centrarUnaVez = useCallback(async () => {
    setCentrando(true);
    try {
      const coords = userLocation ?? (await getCurrentPosition());
      if (coords) {
        setFoco({ coords, nonce: Date.now() });
      } else {
        Alert.alert(
          '📍 Sin ubicación',
          'No se pudo obtener la ubicación GPS. Verifica que el GPS esté activado.'
        );
      }
    } finally {
      setCentrando(false);
    }
  }, [userLocation, getCurrentPosition]);

  // --- Calcular centroide de un polígono ---
  const calcularCentroide = useCallback((puntos: PuntoPoligono[]): { lat: number; lon: number } => {
    const n = puntos.length;
    const lat = puntos.reduce((s, p) => s + p.latitud, 0) / n;
    const lon = puntos.reduce((s, p) => s + p.longitud, 0) / n;
    return { lat, lon };
  }, []);

  // Manejar tap en el mapa
  const handleMapPress = useCallback(
    (latitud: number, longitud: number) => {
      // En modo consulta el mapa no captura toques para trazar.
      if (soloLectura) return;
      // Un toque fuera de Colombia (p. ej. el mapa quedó en otro continente
      // por un encuadre corrupto) NO debe crear un vértice: en la base real
      // hay 9 mediciones con puntos en Madrid que rompían el mapa general.
      if (!esCoordenadaValida(latitud, longitud)) {
        Alert.alert(
          '📍 Fuera de la zona',
          'Ese punto está fuera de Colombia. Centra el mapa en tu ubicación (📍) y vuelve a tocar.'
        );
        return;
      }
      setUltimoPunto({ lat: latitud, lon: longitud });

      if (modo === 'medir') {
        setPoligono((prev) => [
          ...prev,
          { latitud, longitud, orden: prev.length + 1 },
        ]);
        setResultadoArea(null);
        setMostrarResultado(false);
      } else if (modo === 'contar') {
        // Agregar punto al polígono de plantación
        setPlantacionPoligono((prev) => [
          ...prev,
          { latitud, longitud, orden: prev.length + 1 },
        ]);
      }
    },
    [modo, soloLectura]
  );

  // Mover un punto ya puesto (arrastrar para corregir un error sin borrar
  // todo el polígono) — el resultado calculado queda desactualizado hasta
  // volver a presionar "Calcular".
  const moverPuntoPoligono = useCallback((id: string, coords: { latitud: number; longitud: number }) => {
    if (id.startsWith('pp_')) {
      const orden = parseInt(id.slice(3), 10);
      setPlantacionPoligono((prev) => prev.map((p) => (p.orden === orden ? { ...p, ...coords } : p)));
    } else if (id.startsWith('p_')) {
      const orden = parseInt(id.slice(2), 10);
      setPoligono((prev) => prev.map((p) => (p.orden === orden ? { ...p, ...coords } : p)));
      setResultadoArea(null);
      setResultadoDistancia(null);
      setMostrarResultado(false);
    }
  }, []);

  /** Tocar el marcador de una plantación YA guardada abre su detalle (especie, cantidad, beneficiario, vereda). */
  const handleMarkerPress = useCallback(
    (id: string) => {
      const pl = plantaciones.find((p) => p.id === id);
      if (pl) setPlantacionSeleccionada(pl);
    },
    [plantaciones]
  );

  // --- Funciones de Medición ---
  const calcularDistanciaHaversine = useCallback(
    (p1: PuntoPoligono, p2: PuntoPoligono): number => {
      const R = 6371000; // Radio Tierra en metros
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const dLat = toRad(p2.latitud - p1.latitud);
      const dLon = toRad(p2.longitud - p1.longitud);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(p1.latitud)) *
          Math.cos(toRad(p2.latitud)) *
          Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
    []
  );

  const calcularMedicion = useCallback(() => {
    if (poligono.length < 2) {
      Alert.alert('Insuficiente', 'Se necesitan al menos 2 puntos para medir una distancia.');
      return;
    }
    // ID determinista a partir de los puntos: pulsar "Calcular" dos veces
    // sobre el mismo polígono insertaba DOS filas distintas y ambas se
    // sincronizaban, inflando los datos de área del proyecto.
    const idMedicion =
      'med_' +
      poligono
        .map((p) => `${p.latitud.toFixed(6)},${p.longitud.toFixed(6)}`)
        .join('|')
        .split('')
        .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
        .toString(36)
        .replace('-', 'n');

    // Se guarda para que «Guardar» pueda ponerle nombre a esta misma fila.
    setIdMedicionActual(idMedicion);

    if (poligono.length === 2) {
      // Distancia lineal entre 2 puntos
      const d = calcularDistanciaHaversine(poligono[0], poligono[1]);
      setResultadoDistancia({ distanciaMetros: d, distanciaKm: d / 1000 });
      setResultadoArea(null);
      // Antes las distancias solo se mostraban en pantalla y se perdían: no
      // llegaban ni a SQLite ni al servidor. Se guardan como medición sin
      // área, con la distancia en el perímetro.
      saveMedicion({
        id: idMedicion,
        usuario_id: user?.id,
        formulario_id: atribucionVisita.current.formularioId || undefined,
        area_hectareas: 0,
        area_metros2: 0,
        perimetro_metros: d,
        puntos: poligono.map((p) => ({ latitud: p.latitud, longitud: p.longitud })),
        beneficiario_cedula: atribucionVisita.current.cedula,
        beneficiario_nombre: atribucionVisita.current.nombre,
        vereda: atribucionVisita.current.vereda,
        corregimiento: atribucionVisita.current.corregimiento,
        usuario_nombre: user?.nombre || null,
        sincronizado: false,
      })
        .then(() => {
          setMedicionPersistida(true);
          syncNow().catch(() => {});
        })
        .catch((e) => {
          console.warn('[Mapa] No se pudo guardar la distancia:', e);
          setMedicionPersistida(false);
          const detalle = e instanceof Error ? e.message : String(e);
          Alert.alert(
            'Medición no guardada',
            `La distancia se calculó, pero no quedó guardada en el dispositivo. Inténtalo de nuevo.\n\nDetalle: ${detalle}`
          );
        });
    } else {
      // Área (3+ puntos)
      const area = calcularArea(poligono);
      setResultadoArea(area);
      setResultadoDistancia(null);
      // Persistir medición en SQLite
      saveMedicion({
        id: idMedicion,
        usuario_id: user?.id,
        formulario_id: atribucionVisita.current.formularioId || undefined,
        area_hectareas: area.areaHectareas,
        area_metros2: area.areaMetros2,
        perimetro_metros: area.perimetroMetros,
        puntos: poligono.map(p => ({ latitud: p.latitud, longitud: p.longitud })),
        beneficiario_cedula: atribucionVisita.current.cedula,
        beneficiario_nombre: atribucionVisita.current.nombre,
        vereda: atribucionVisita.current.vereda,
        corregimiento: atribucionVisita.current.corregimiento,
        usuario_nombre: user?.nombre || null,
        sincronizado: false,
      }).then(() => {
        // Intentar sincronizar al servidor si hay conexión
        setMedicionPersistida(true);
        syncNow().catch(() => {});
      }).catch(err => {
        console.warn('[Mapa] Error al persistir medición:', err);
        setMedicionPersistida(false);
        const detalle = err instanceof Error ? err.message : String(err);
        Alert.alert(
          'Medición no guardada',
          `El área se calculó, pero no quedó guardada en el dispositivo. Inténtalo de nuevo.\n\nDetalle: ${detalle}`
        );
      });
    }
    setMostrarResultado(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poligono, calcularDistanciaHaversine, user?.id, user?.nombre]);

  const limpiarPoligono = useCallback(() => {
    setPoligono([]);
    setResultadoArea(null);
    setResultadoDistancia(null);
    setMostrarResultado(false);
    setMedicionPreview(null);
    setMedicionPersistida(false);
    setIdMedicionActual(null);
  }, []);

  const deshacerUltimoPunto = useCallback(() => {
    setPoligono((prev) => prev.slice(0, -1));
    setResultadoArea(null);
    setResultadoDistancia(null);
    setMostrarResultado(false);
    // El polígono cambió: el resultado anterior ya no corresponde a lo guardado.
    setMedicionPersistida(false);
    setIdMedicionActual(null);
  }, []);

  /**
   * Botón «Guardar» del panel de resultado.
   *
   * La medición se persiste al presionar «Calcular» (con un id determinista,
   * así que recalcular NO duplica filas); «Guardar» pide el nombre y lo deja
   * grabado en esa fila para poder identificarla en el 📋 Historial. Antes el
   * historial mostraba solo fecha y hora (todas las mediciones se veían
   * iguales) y «Guardar» exportaba un KML, que ya tiene su propio botón.
   * La apertura del diálogo se maneja en `abrirModalNombreMedicion`.
   */

  /** Calcular centroide para la previsualización del polígono de plantación */
  const getPlantacionCentroide = useCallback((): { lat: number; lon: number } | null => {
    if (plantacionPoligono.length < 3) return null;
    return calcularCentroide(plantacionPoligono);
  }, [plantacionPoligono, calcularCentroide]);

  // --- Funciones de Conteo (polígono → centroide → guardar) ---
  const finalizarPoligonoPlantacion = useCallback(() => {
    if (plantacionPoligono.length < 3) {
      Alert.alert('Área muy pequeña', 'Debes marcar al menos 3 puntos para definir el área de plantación.');
      return;
    }
    const centro = calcularCentroide(plantacionPoligono);
    setUltimoPunto({ lat: centro.lat, lon: centro.lon });
    setPlantaSeleccionada('Cacao');
    setCantidadInput('');
    setMostrarPanelConteo(true);
  }, [plantacionPoligono, calcularCentroide]);

  const deshacerUltimoPuntoPlantacion = useCallback(() => {
    setPlantacionPoligono((prev) => prev.slice(0, -1));
  }, []);

  const cancelarPoligonoPlantacion = useCallback(() => {
    setPlantacionPoligono([]);
    setMostrarPanelConteo(false);
    setUltimoPunto(null);
    setPlantacionCedula('');
    setPlantacionBeneficiarioNombre('');
    setPlantacionVereda('');
    setPlantacionCorregimiento('');
    setBeneficiarioValido(false);
    setSugerenciasBeneficiario([]);
    setPlantacionEditandoId(null);
  }, []);

  const guardarConteo = useCallback(async () => {
    const cantidad = parseInt(cantidadInput);
    if (!cantidad || cantidad <= 0) {
      Alert.alert('Cantidad inválida', 'Ingresa un número válido de plantas.');
      return;
    }
    // El beneficiario es obligatorio: sin él no se puede ubicar la plantación
    // en el Dashboard ni amarrar vereda/corregimiento.
    if (!beneficiarioValido) {
      Alert.alert(
        'Beneficiario obligatorio',
        'Escribe la cédula del beneficiario y pulsa 🔍 para validarla en el padrón antes de guardar.'
      );
      return;
    }
    const latitud = ultimoPunto?.lat ?? userLocation?.latitud ?? 0;
    const longitud = ultimoPunto?.lon ?? userLocation?.longitud ?? 0;
    if (!latitud || !longitud) {
      Alert.alert('Sin ubicación', 'Toca el mapa para seleccionar un punto.');
      return;
    }
    const icono = getIconoEspecie(plantaSeleccionada);
    const poligonoData = plantacionPoligono.length >= 3 ? plantacionPoligono : undefined;
    const esEdicion = !!plantacionEditandoId;
    const plantacion: Plantacion = {
      id: esEdicion ? plantacionEditandoId! : `plant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      usuario_id: user?.id || 'unknown',
      latitud,
      longitud,
      especie: plantaSeleccionada,
      cantidad,
      timestamp: new Date().toISOString(),
      sincronizado: false,
      icono,
      poligono: poligonoData,
      beneficiario_cedula: plantacionCedula.trim() || undefined,
      beneficiario_nombre: plantacionBeneficiarioNombre.trim() || undefined,
      vereda: plantacionVereda || undefined,
      corregimiento: plantacionCorregimiento || undefined,
    };
    try {
      await savePlantacion(plantacion);
    } catch (error) {
      console.error('[Mapa] No se pudo guardar la plantación local:', error);
      Alert.alert('No se pudo guardar', 'El conteo no quedó guardado en este dispositivo. Inténtalo de nuevo.');
      return;
    }
    setPlantaciones((prev) =>
      esEdicion ? prev.map((p) => (p.id === plantacion.id ? plantacion : p)) : [...prev, plantacion]
    );
    // Intentar sincronizar al servidor si hay conexión
    syncNow().catch(() => {});
    Alert.alert(
      esEdicion ? '✅ Conteo actualizado' : '✅ Conteo guardado',
      `${plantaSeleccionada}: ${cantidad} plantas\n${icono} Área de ${poligonoData ? plantacionPoligono.length : 1} punto(s) registrada`
    );
    setCantidadInput('');
    setMostrarPanelConteo(false);
    setPlantacionPoligono([]);
    setUltimoPunto(null);
    setPlantacionCedula('');
    setPlantacionBeneficiarioNombre('');
    setPlantacionVereda('');
    setPlantacionCorregimiento('');
    setBeneficiarioValido(false);
    setSugerenciasBeneficiario([]);
    setPlantacionEditandoId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantaSeleccionada, cantidadInput, ultimoPunto, userLocation, user?.id, plantacionPoligono, plantacionCedula, plantacionBeneficiarioNombre, plantacionVereda, plantacionCorregimiento, beneficiarioValido, plantacionEditandoId]);

  // --- Funciones KML ---
  /** Sufijo de origen que se agrega siempre al final del nombre del KML. */
  const sufijoKML = SUFIJOS_KML[modo];

  /**
   * Nombre completo: lo que escribió el técnico + el origen
   * («Luiz Rojas - Medicion», «Camilo Zapata - Conteo»). Sirve tanto para el
   * archivo KML como para el nombre que se ve en el 📋 Historial.
   */
  const nombreCompletoKML = React.useMemo(() => {
    const base = limpiarNombreKML(nombreBaseKML);
    return base ? `${base} - ${sufijoKML}` : sufijoKML;
  }, [nombreBaseKML, sufijoKML]);

  /** Quita el sufijo de origen («- Medicion» / «- Conteo») para reusar el nombre. */
  const quitarSufijoOrigen = React.useCallback((texto?: string | null) => {
    return limpiarNombreKML(String(texto ?? '')).replace(/\s*-\s*(Medicion|Conteo)\s*$/i, '').trim();
  }, []);

  /**
   * Abre el modal para nombrar (o exportar).
   *
   * `accion = 'guardar'`: solo pide el nombre y lo guarda en la medición, para
   * identificarla en el historial. NO genera archivo (para eso está
   * «Exportar KML»).
   * `accion = 'exportar'`: pide el nombre y genera el .kml.
   */
  const abrirModalNombreMedicion = useCallback((accion: 'exportar' | 'guardar') => {
    if (accion === 'exportar') {
      const puntos = modo === 'contar' ? plantacionPoligono : poligono;
      if (puntos.length < 3) {
        Alert.alert(
          'Sin polígono',
          modo === 'contar'
            ? 'Dibuja el área de plantación en el mapa (mínimo 3 puntos) antes de exportar el KML.'
            : 'Dibuja un polígono en modo Medición primero (mínimo 3 puntos).'
        );
        return;
      }
    } else if (!medicionPersistida || !idMedicionActual) {
      Alert.alert(
        'Medición sin guardar',
        'El resultado no quedó guardado en este dispositivo. Vuelve a presionar «Calcular» para reintentarlo.'
      );
      return;
    }
    // Sugerencia por defecto: el nombre que ya tenía la medición (si se está
    // renombrando), el beneficiario del formulario o el del padrón en conteo.
    const sugerido =
      quitarSufijoOrigen(medicionPreview?.nombre) ||
      beneficiarioNombreRuta ||
      (modo === 'contar' ? limpiarNombreKML(plantacionBeneficiarioNombre) : '');
    setNombreBaseKML(sugerido);
    setAccionNombre(accion);
    setMostrarModalKML(false);
    setMostrarModalNombreKML(true);
  }, [
    modo,
    poligono,
    plantacionPoligono,
    medicionPersistida,
    idMedicionActual,
    medicionPreview?.nombre,
    quitarSufijoOrigen,
    beneficiarioNombreRuta,
    plantacionBeneficiarioNombre,
  ]);

  /**
   * Botón único «Calcular y guardar».
   *
   * Antes el técnico tenía que pulsar «Calcular» (que ya persistía la fila en
   * SQLite) y luego buscar el botón «Guardar» dentro del recuadro de
   * resultado para ponerle nombre. Muchos no lo encontraban y las mediciones
   * quedaban como «Medición sin nombre». Ahora un solo botón calcula, guarda
   * y abre el modal de nombre.
   */
  const calcularYGuardar = useCallback(() => {
    if (poligono.length < 2) {
      Alert.alert('Insuficiente', 'Se necesitan al menos 2 puntos para medir una distancia.');
      return;
    }
    calcularMedicion();
    // El modal de nombre se abre en el siguiente tick, cuando
    // `medicionPersistida`/`idMedicionActual` ya fueron actualizados por
    // `calcularMedicion` (ambos son estado de React).
    setTimeout(() => {
      abrirModalNombreMedicion('guardar');
    }, 0);
  }, [poligono.length, calcularMedicion, abrirModalNombreMedicion]);

  /** Exporta el polígono actual a .kml (no toca la medición guardada). */
  const handleExportarKML = useCallback(async () => {
    const puntos = modo === 'contar' ? plantacionPoligono : poligono;
    if (puntos.length < 3) {
      Alert.alert('Sin polígono', 'Dibuja el polígono en el mapa primero (mínimo 3 puntos).');
      return;
    }
    setExportandoKML(true);
    try {
      const uri = await exportarKML(nombreCompletoKML, puntos);
      setMostrarModalNombreKML(false);
      if (!uri) {
        Alert.alert(
          'No se pudo exportar',
          'El archivo KML no se pudo generar en este dispositivo. Inténtalo de nuevo.'
        );
        return;
      }
    } finally {
      setExportandoKML(false);
    }
  }, [modo, plantacionPoligono, poligono, nombreCompletoKML]);

  /**
   * Botón «Guardar»: pide el nombre y lo graba en la medición para que quede
   * identificable en el historial.
   */
  const confirmarGuardarMedicion = useCallback(async () => {
    if (!idMedicionActual) {
      Alert.alert(
        'Medición sin guardar',
        'El resultado no quedó guardado en este dispositivo. Vuelve a presionar «Calcular» para reintentarlo.'
      );
      return;
    }
    const nombre = nombreCompletoKML;
    const detalle = resultadoArea
      ? `${resultadoArea.areaHectareas} ha (${Math.round(resultadoArea.areaMetros2).toLocaleString()} m²) · perímetro ${Math.round(resultadoArea.perimetroMetros).toLocaleString()} m`
      : resultadoDistancia
        ? `${Math.round(resultadoDistancia.distanciaMetros).toLocaleString()} m`
        : '';
    setGuardandoMedicion(true);
    try {
      await actualizarNombreMedicion(idMedicionActual, nombre);
      // Se marca como no sincronizada: el nombre viaja al servidor en el sync.
      syncNow().catch(() => {});
      setMostrarModalNombreKML(false);
      limpiarPoligono();
      Alert.alert(
        '✅ Medición guardada',
        `Guardada como «${nombre}».${detalle ? `\n\n${detalle}` : ''}\n\nPuedes verla en el 📋 Historial.`
      );
    } catch (error) {
      console.warn('[Mapa] No se pudo guardar el nombre de la medición:', error);
      Alert.alert(
        'No se pudo guardar',
        'El nombre no se pudo guardar en este dispositivo. Inténtalo de nuevo.'
      );
    } finally {
      setGuardandoMedicion(false);
    }
  }, [idMedicionActual, nombreCompletoKML, resultadoArea, resultadoDistancia, limpiarPoligono, syncNow]);

  /** Botón de confirmar del modal de nombre: guarda o exporta según el origen. */
  const confirmarAccionNombre = useCallback(async () => {
    if (accionNombre === 'exportar') {
      await handleExportarKML();
    } else {
      await confirmarGuardarMedicion();
    }
  }, [accionNombre, handleExportarKML, confirmarGuardarMedicion]);

  // Antes llamaba a `importarKML('')` con URI vacía: fallaba dentro de su
  // propio try/catch, descartaba el resultado y mostraba una instrucción que
  // no llevaba a ninguna parte. La opción figuraba en la UI como si funcionara.
  const handleImportarKML = useCallback(async () => {
    try {
      const seleccion = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.google-earth.kml+xml', 'application/xml', 'text/xml', '*/*'],
        copyToCacheDirectory: true,
      });
      if (seleccion.canceled || !seleccion.assets?.length) return;

      const archivo = seleccion.assets[0];
      if (!archivo.name?.toLowerCase().endsWith('.kml')) {
        Alert.alert('Archivo no válido', 'Selecciona un archivo con extensión .kml');
        return;
      }

      const result = await importarKML(archivo.uri);
      if (!result || result.puntos.length === 0) {
        Alert.alert(
          'No se pudo leer el KML',
          'El archivo no contiene coordenadas reconocibles.'
        );
        return;
      }

      setPoligono(result.puntos.map((p, i) => ({ ...p, orden: i })));
      setModo('medir');
      setMostrarModalKML(false);
      Alert.alert(
        '✅ KML importado',
        `"${result.nombre}" — ${result.puntos.length} punto(s) cargados. Pulsa "Calcular" para obtener el área.`
      );
    } catch (error) {
      console.warn('[Mapa] Error al importar KML:', error);
      Alert.alert('Error', 'No se pudo importar el archivo KML.');
    }
  }, []);

  // --- Historial de mediciones ---
  const abrirHistorialMediciones = useCallback(async () => {
    setCargandoHistorialMediciones(true);
    setMostrarHistorialMediciones(true);
    try {
      const todas = await getMediciones();
      // El técnico solo ve sus propias mediciones; los roles superiores ven
      // todas (con la atribución de beneficiario/vereda de cada una).
      setMedicionesGuardadas(
        canViewAll ? todas : todas.filter((m) => !user?.id || m.usuario_id === user.id)
      );
    } finally {
      setCargandoHistorialMediciones(false);
    }
  }, [user?.id, canViewAll]);

  // "Revive" una medición guardada: la carga en el polígono editable para
  // poder seguir moviendo/agregando/quitando puntos y recalcular. Antes solo
  // se mostraba como una capa de solo lectura (no editable, sin resultados).
  const verMedicionPreview = useCallback((medicion: Record<string, any>) => {
    const puntos = (medicion.puntos || []) as { latitud: number; longitud: number }[];
    if (puntos.length === 0) return;
    // Cargar los puntos en el estado editable de medición (con su orden).
    const puntosEditables: PuntoPoligono[] = puntos.map((p, i) => ({
      latitud: p.latitud,
      longitud: p.longitud,
      orden: i + 1,
    }));
    setModo('medir');
    setPoligono(puntosEditables);
    // Recalcular y mostrar el resultado de inmediato (área o distancia).
    if (puntosEditables.length === 2) {
      const d = calcularDistanciaHaversine(puntosEditables[0], puntosEditables[1]);
      setResultadoDistancia({ distanciaMetros: d, distanciaKm: d / 1000 });
      setResultadoArea(null);
    } else if (puntosEditables.length >= 3) {
      const area = calcularArea(puntosEditables);
      setResultadoArea(area);
      setResultadoDistancia(null);
    }
    setMostrarResultado(true);
    setMedicionPreview({ id: medicion.id, nombre: medicion.nombre || null, puntos });
    // La medición revivida ya está en SQLite: «Guardar» puede renombrarla.
    setIdMedicionActual(medicion.id);
    setMedicionPersistida(true);
    setFoco({ coords: puntos[0], nonce: Date.now() });
    setMostrarHistorialMediciones(false);
  }, [calcularDistanciaHaversine]);

  const cerrarMedicionPreview = useCallback(() => setMedicionPreview(null), []);

  // Abre el modal de confirmación (Alert.alert no muestra botones en web).
  const eliminarMedicionGuardada = useCallback((medicion: Record<string, any>) => {
    setConfirmarEliminarMedicion(medicion);
  }, []);

  // Ejecuta el borrado real tras confirmar.
  const confirmarEliminarMedicionGuardada = useCallback(async () => {
    const medicion = confirmarEliminarMedicion;
    if (!medicion) return;
    const id = medicion.id;
    setConfirmarEliminarMedicion(null);
    setEliminandoMedicionId(id);
    try {
      await deleteMedicionLocal(id);
      setMedicionesGuardadas((prev) => prev.filter((m) => m.id !== id));
      if (medicionPreview?.id === id) setMedicionPreview(null);
    } catch (error) {
      console.error('[Mapa] Error al eliminar medición:', error);
      Alert.alert('Error', 'No se pudo eliminar la medición. Intenta de nuevo.');
    } finally {
      setEliminandoMedicionId(null);
    }
  }, [confirmarEliminarMedicion, medicionPreview]);

  // --- Historial de plantaciones ---
  const abrirHistorialPlantaciones = useCallback(() => {
    setMostrarHistorialPlantaciones(true);
  }, []);

  // "Revive" un área de plantación guardada: la carga en el panel de conteo
  // (especie, cantidad, polígono y beneficiario) para poder modificarla y
  // volver a guardarla. Antes solo se podía centrar el mapa en ella.
  const revivirPlantacion = useCallback((pl: Plantacion) => {
    if (!MOSTRAR_CONTEO_PLANTACIONES) return;
    setModo('contar');
    setPlantaSeleccionada(pl.especie);
    setCantidadInput(String(pl.cantidad ?? ''));
    setPlantacionPoligono((pl.poligono || []).map((p, i) => ({ ...p, orden: i + 1 })));
    setPlantacionCedula(pl.beneficiario_cedula || '');
    setPlantacionBeneficiarioNombre(pl.beneficiario_nombre || '');
    setPlantacionVereda(pl.vereda || '');
    setPlantacionCorregimiento(pl.corregimiento || '');
    setBeneficiarioValido(!!pl.beneficiario_cedula && !!pl.beneficiario_nombre);
    setSugerenciasBeneficiario([]);
    setPlantacionEditandoId(pl.id);
    setUltimoPunto({ lat: pl.latitud, lon: pl.longitud });
    setFoco({ coords: { latitud: pl.latitud, longitud: pl.longitud }, nonce: Date.now() });
    setMostrarPanelConteo(true);
    setMostrarHistorialPlantaciones(false);
  }, []);

  // Abre el modal de confirmación (Alert.alert no muestra botones en web).
  const eliminarPlantacionGuardada = useCallback((pl: Plantacion) => {
    setConfirmarEliminarPlantacion(pl);
  }, []);

  // Ejecuta el borrado real tras confirmar.
  const confirmarEliminarPlantacionGuardada = useCallback(async () => {
    const pl = confirmarEliminarPlantacion;
    if (!pl) return;
    const id = pl.id;
    setConfirmarEliminarPlantacion(null);
    setEliminandoPlantacionId(id);
    try {
      await deletePlantacionLocal(id);
      setPlantaciones((prev) => prev.filter((p) => p.id !== id));
      if (plantacionEditandoId === id) setPlantacionEditandoId(null);
    } catch (error) {
      console.error('[Mapa] Error al eliminar plantación:', error);
      Alert.alert('Error', 'No se pudo eliminar el área de plantación. Intenta de nuevo.');
    } finally {
      setEliminandoPlantacionId(null);
    }
  }, [confirmarEliminarPlantacion, plantacionEditandoId]);

  // Cambiar modo
  const cambiarModo = useCallback(
    (nuevoModo: ModoMapa) => {
      // Conteo oculto (feature flag): no se puede entrar a ese modo.
      if (nuevoModo === 'contar' && !MOSTRAR_CONTEO_PLANTACIONES) return;
      setModo(nuevoModo);
      if (nuevoModo !== 'medir') {
        setMostrarResultado(false);
      }
      if (nuevoModo !== 'contar') {
        setMostrarPanelConteo(false);
        setPlantacionPoligono([]);
      }
      // La navegación está inmersa en ambos modos: reactivamos el seguimiento
      // en tiempo real al cambiar de pestaña. El técnico puede apagarlo
      // tocando el mapa y reactivarlo con "Mi Ubicación".
      setSiguiendoGPS(true);
    },
    [setSiguiendoGPS]
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface} />

      {/* Mapa */}
      <View style={styles.mapContainer}>
        <MapViewOffline
          center={mapCenter ?? userLocation ?? undefined}
          zoom={15}
          height={'100%'}
          mapStyle={tipoMapa}
          markers={[
            // Puntos del polígono de medición — arrastrables para corregir un
            // punto puesto en el lugar equivocado sin tener que borrar todo.
            ...poligono.map((p) => ({
              id: `p_${p.orden}`,
              latitud: p.latitud,
              longitud: p.longitud,
              title: `Punto ${p.orden} (mantén presionado para moverlo)`,
              color: modo === 'medir' ? COLORS.secondary : COLORS.primary,
              draggable: modo === 'medir' && !soloLectura,
            })),
            // Puntos del polígono de plantación (conteo) — igual, arrastrables
            ...(MOSTRAR_CONTEO_PLANTACIONES ? plantacionPoligono.map((p) => ({
              id: `pp_${p.orden}`,
              latitud: p.latitud,
              longitud: p.longitud,
              title: `Área punto ${p.orden} (mantén presionado para moverlo)`,
              color: '#FF6D00',
              draggable: modo === 'contar' && !soloLectura,
            })) : []),
            // Centroide del polígono de plantación (icono difuminado) — solo
            // aparece cuando el técnico ya eligió qué está plantando (panel
            // de especie abierto), no automáticamente al llegar a 3 puntos.
            ...(MOSTRAR_CONTEO_PLANTACIONES && mostrarPanelConteo && getPlantacionCentroide() ? [{
              // El id incluye la especie: MLAnnotation (anotación nativa)
              // no refresca el ícono si solo cambia el contenido hijo —
              // necesita un id distinto para remontarse y capturar el
              // nuevo emoji al elegir otra especie.
              id: `plantacion-centro-${plantaSeleccionada}`,
              latitud: getPlantacionCentroide()!.lat,
              longitud: getPlantacionCentroide()!.lon,
              title: 'Centro del área',
              icon: getIconoEspecie(plantaSeleccionada),
            }] : []),
            // Plantaciones guardadas (ocultas junto con el conteo)
            ...(MOSTRAR_CONTEO_PLANTACIONES ? plantaciones.map((pl) => ({
              id: pl.id,
              latitud: pl.latitud,
              longitud: pl.longitud,
              title: `${pl.especie}: ${pl.cantidad} plantas`,
              icon: pl.icono || getIconoEspecie(pl.especie),
            })) : []),
          ]}
          polyline={
            modo === 'medir' && poligono.length >= 2
              ? poligono.map(p => ({ latitud: p.latitud, longitud: p.longitud }))
              : MOSTRAR_CONTEO_PLANTACIONES && modo === 'contar' && !mostrarPanelConteo && plantacionPoligono.length >= 2
              ? plantacionPoligono.map(p => ({ latitud: p.latitud, longitud: p.longitud }))
              : undefined
          }
          polylineColor="#FF6D00"
          startMarker={undefined}
          endMarker={undefined}
          geojsonLayers={(() => {
            const layers: Array<{
              id: string;
              features: Record<string, any>[];
              fillColor?: string;
              strokeColor?: string;
              fillOpacity?: number;
              strokeOpacity?: number;
              strokeWidth?: number;
            }> = [];

            // Polígono de MEDICIÓN — se rellena al presionar "Calcular"
            // (mientras se marcan los puntos solo se ve la línea/polyline
            // de arriba, sin relleno, hasta confirmar el área).
            if (modo === 'medir' && mostrarResultado && poligono.length >= 3) {
              const coordsMedicion = [
                ...poligono.map((p) => [p.longitud, p.latitud]),
                [poligono[0].longitud, poligono[0].latitud],
              ];
              layers.push({
                id: 'medicion-poligono',
                features: [{
                  type: 'Feature',
                  geometry: { type: 'Polygon', coordinates: [coordsMedicion] },
                  properties: {},
                }],
                fillColor: 'rgba(21, 101, 192, 0.22)',
                strokeColor: '#1565C0',
                strokeWidth: 2.5,
                strokeOpacity: 0.85,
                fillOpacity: 0.22,
              });
            }

            // (La medición revivida desde el historial ya se dibuja como el
            // polígono editable de arriba — no se duplica como capa aparte.)

            // Polígono de plantación — el relleno solo aparece cuando el
            // técnico ya presionó "seleccionar especie y guardar" y está en
            // el panel eligiendo qué plantar (mostrarPanelConteo). Mientras
            // solo va marcando puntos (así sean muchos más de 3), únicamente
            // se ve la línea de arriba, sin sombra ni ícono forzados.
            if (mostrarPanelConteo && plantacionPoligono.length >= 3) {
              const coords = [
                ...plantacionPoligono.map((p) => [p.longitud, p.latitud]),
                [plantacionPoligono[0].longitud, plantacionPoligono[0].latitud],
              ];
              layers.push({
                id: 'plantacion-dibujo',
                features: [{
                  type: 'Feature',
                  geometry: { type: 'Polygon', coordinates: [coords] },
                  properties: {},
                }],
                fillColor: 'rgba(255, 109, 0, 0.25)',
                strokeColor: '#FF6D00',
                strokeWidth: 2.5,
                strokeOpacity: 0.9,
                fillOpacity: 0.25,
              });
            }

            // Polígonos de plantaciones YA GUARDADAS — quedan permanentes
            // en el mapa, difuminados, con el ícono de la especie en el
            // centroide (el marcador de la plantación es ese centro).
            const featuresGuardadas = plantaciones
              .filter((pl) => (pl.poligono?.length ?? 0) >= 3)
              .map((pl) => {
                const pts = pl.poligono || [];
                return {
                  type: 'Feature',
                  geometry: {
                    type: 'Polygon',
                    coordinates: [[
                      ...pts.map((p) => [p.longitud, p.latitud]),
                      [pts[0].longitud, pts[0].latitud],
                    ]],
                  },
                  properties: { especie: pl.especie },
                };
              });
            if (featuresGuardadas.length > 0 && MOSTRAR_CONTEO_PLANTACIONES) {
              layers.push({
                id: 'plantaciones-guardadas',
                features: featuresGuardadas,
                fillColor: 'rgba(46, 125, 50, 0.18)',
                strokeColor: '#2E7D32',
                strokeWidth: 2,
                strokeOpacity: 0.7,
                fillOpacity: 0.18,
              });
            }

            return layers.length > 0 ? layers : undefined;
          })()}
          showUserLocation={true}
          userLocation={userLocation}
          interactive={true}
          onMapPress={soloLectura ? undefined : handleMapPress}
          onMarkerDragEnd={soloLectura ? undefined : moverPuntoPoligono}
          onMarkerPress={handleMarkerPress}
          foco={foco}
        />

        {/* Banner de medición revivida desde el historial (editable) */}
        {medicionPreview && !soloLectura && (
          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerText}>
              ✏️ Editando medición guardada — mueve, agrega o quita puntos
            </Text>
            <TouchableOpacity onPress={cerrarMedicionPreview}>
              <Text style={styles.previewBannerClose}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Banner de modo consulta */}
        {soloLectura && (
          <View style={styles.readOnlyBanner} pointerEvents="none">
            <Text style={styles.readOnlyBannerText}>
              👁️ Modo consulta — solo lectura. Para trazar, abre el mapa desde el formulario.
            </Text>
          </View>
        )}

        {/* Aviso inicial: cómo empezar a medir (sin puntos aún) */}
        {!soloLectura && modo === 'medir' && poligono.length === 0 && !mostrarResultado && (
          <View style={styles.startHintOverlay} pointerEvents="none">
            <Text style={styles.startHintIcon}>◈</Text>
            <Text style={styles.startHintTitle}>Toca el mapa para iniciar la medición</Text>
            <Text style={styles.startHintText}>
              2 puntos = distancia · 3+ puntos = área
            </Text>
          </View>
        )}

        {/* Aviso inicial: cómo empezar a contar (sin puntos aún) */}
        {MOSTRAR_CONTEO_PLANTACIONES && !soloLectura && modo === 'contar' && plantacionPoligono.length === 0 && !mostrarPanelConteo && (
          <View style={styles.startHintOverlay} pointerEvents="none">
            <Text style={styles.startHintIcon}>🌱</Text>
            <Text style={styles.startHintTitle}>Toca el mapa para iniciar el conteo</Text>
            <Text style={styles.startHintText}>
              Dibuja el área de plantación (3+ puntos) y finaliza para guardar
            </Text>
          </View>
        )}

        {/* Overlay de coordenadas */}
        {ultimoPunto && (
          <View style={styles.coordsOverlay}>
            <Text style={styles.coordsLabel}>
              {modo === 'medir'
                ? `Punto #${poligono.length}`
                : MOSTRAR_CONTEO_PLANTACIONES && modo === 'contar'
                ? `Área punto #${plantacionPoligono.length}`
                : 'Coordenadas'}
            </Text>
            <Text style={styles.coordsValue}>
              Lat: {ultimoPunto.lat.toFixed(6)}
            </Text>
            <Text style={styles.coordsValue}>
              Lon: {ultimoPunto.lon.toFixed(6)}
            </Text>
            {modo === 'medir' && (
              <Text style={styles.coordsHint}>
                {poligono.length < 2
                  ? 'Toca el mapa para agregar puntos (2 = distancia, 3+ = área)'
                  : poligono.length === 2
                  ? '✅ Toca "Calcular" para ver la distancia lineal'
                  : 'Toca el mapa para agregar puntos al polígono'}
              </Text>
            )}
            {MOSTRAR_CONTEO_PLANTACIONES && modo === 'contar' && plantacionPoligono.length > 0 && (
              <Text style={styles.coordsHint}>
                {plantacionPoligono.length < 3
                  ? `Toca el mapa para definir el área (${plantacionPoligono.length}/3 puntos)`
                  : '✅ Área lista — presiona "Finalizar área" abajo'}
              </Text>
            )}
          </View>
        )}

        {/* Resultado de medición */}
        {mostrarResultado && resultadoArea && (
          <View style={styles.resultOverlay}>
            <Text style={styles.resultTitle}>◈ Resultado</Text>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Área:</Text>
              <Text style={styles.resultValue}>
                {resultadoArea.areaHectareas} ha
              </Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Área (m²):</Text>
              <Text style={styles.resultValue}>
                {resultadoArea.areaMetros2.toLocaleString()} m²
              </Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Perímetro:</Text>
              <Text style={styles.resultValue}>
                {resultadoArea.perimetroMetros.toLocaleString()} m
              </Text>
            </View>
            <View style={styles.resultActions}>
              <TouchableOpacity
                style={styles.resultBtn}
                onPress={() => abrirModalNombreMedicion('exportar')}
              >
                <Text style={styles.resultBtnText}>Exportar KML</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultBtn, styles.resultBtnSecondary]}
                onPress={() => abrirModalNombreMedicion('guardar')}
              >
                <Text style={styles.resultBtnTextSecondary}>💾 Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Resultado de distancia lineal (2 puntos) */}
        {mostrarResultado && resultadoDistancia && (
          <View style={styles.resultOverlay}>
            <Text style={styles.resultTitle}>📏 Distancia</Text>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Distancia:</Text>
              <Text style={styles.resultValue}>
                {resultadoDistancia.distanciaKm < 1
                  ? `${Math.round(resultadoDistancia.distanciaMetros)} m`
                  : `${resultadoDistancia.distanciaKm.toFixed(3)} km`}
              </Text>
            </View>
            <View style={styles.resultActions}>
              <TouchableOpacity
                style={[styles.resultBtn, styles.resultBtnSecondary]}
                onPress={() => abrirModalNombreMedicion('guardar')}
              >
                <Text style={styles.resultBtnTextSecondary}>💾 Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Botón toggle tipo de mapa — cicla Terreno/Calles → Satélite HD → Satélite Relieve */}
        <TouchableOpacity
          style={styles.mapTypeButton}
          onPress={() =>
            setTipoMapa((prev) =>
              prev === 'terreno'
                ? 'satelite'
                : prev === 'satelite'
                  ? 'satelite-reciente'
                  : 'terreno'
            )
          }
        >
          <Text style={styles.mapTypeButtonText}>
            {tipoMapa === 'terreno' ? '🛰️' : tipoMapa === 'satelite' ? '📅' : '⛰️'}
          </Text>
        </TouchableOpacity>

        {/* Botón descargar mapa offline — mantener presionado para gestionar los ya descargados */}
        <TouchableOpacity
          style={styles.downloadMapButton}
          onPress={handleDescargarMapaOffline}
          onLongPress={abrirGestionPaquetes}
          disabled={descargandoMapa}
        >
          <Text style={descargandoMapa ? styles.downloadProgressText : styles.mapTypeButtonText}>
            {descargandoMapa ? `⏳${progresoDescarga}%` : '⬇️'}
          </Text>
        </TouchableOpacity>

        {/* Panel de finalización de área (modo conteo — polígono listo) */}
        {MOSTRAR_CONTEO_PLANTACIONES && !soloLectura && modo === 'contar' && plantacionPoligono.length >= 3 && !mostrarPanelConteo && (
          <View style={styles.conteoPanelSimple}>
            <Text style={styles.conteoTitle}>🌱 Área de plantación</Text>
            <Text style={styles.conteoSubtitle}>
              {plantacionPoligono.length} puntos · {getPlantacionCentroide()?.lat.toFixed(5)}, {getPlantacionCentroide()?.lon.toFixed(5)}
            </Text>
            <View style={styles.conteoAreaActions}>
              <TouchableOpacity style={styles.conteoSaveBtn} onPress={finalizarPoligonoPlantacion}>
                <Text style={styles.conteoSaveText}>Seleccionar especie y guardar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.conteoCancelBtn} onPress={cancelarPoligonoPlantacion}>
                <Text style={styles.conteoCancelText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Panel de conteo (selector de especie + cantidad) */}
        {MOSTRAR_CONTEO_PLANTACIONES && !soloLectura && mostrarPanelConteo && ultimoPunto && (
          <View style={styles.conteoPanel}>
            <View style={styles.conteoHeader}>
              <View>
                <Text style={styles.conteoTitle}>{plantacionEditandoId ? '✏️ Editar Conteo' : '🌱 Conteo de Plantas'}</Text>
                <Text style={styles.conteoSubtitle}>
                  📍 Centro: {ultimoPunto.lat.toFixed(5)}, {ultimoPunto.lon.toFixed(5)} · {plantacionPoligono.length} puntos
                </Text>
              </View>
              <TouchableOpacity onPress={cancelarPoligonoPlantacion}>
                <Text style={styles.conteoClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.conteoScroll}
              contentContainerStyle={styles.conteoScrollContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.conteoLabel}>Selecciona el tipo de planta:</Text>
              <View style={styles.conteoOptionsRow}>
                {PLANTAS_OPCIONES.map((op) => (
                  <TouchableOpacity
                    key={op.nombre}
                    style={[
                      styles.conteoOptionBtn,
                      plantaSeleccionada === op.nombre && styles.conteoOptionBtnActive,
                    ]}
                    onPress={() => setPlantaSeleccionada(op.nombre)}
                  >
                    <Text style={styles.conteoOptionIcon}>{op.icono}</Text>
                    <Text
                      style={[
                        styles.conteoOptionLabel,
                        plantaSeleccionada === op.nombre && styles.conteoOptionLabelActive,
                      ]}
                      numberOfLines={1}
                    >
                      {op.nombre === 'Abarco / Cedro / Caucho' ? 'Abarco / Cedro' : op.nombre}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.conteoInputRow}>
                <Text style={styles.conteoLabel}>Cantidad de plantas:</Text>
                <TextInput
                  style={styles.conteoInputCant}
                  value={cantidadInput}
                  onChangeText={setCantidadInput}
                  placeholder="Ej: 50"
                  placeholderTextColor={COLORS.textLight}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.conteoPreview}>
                <Text style={styles.conteoPreviewText}>
                  Vista previa: {getIconoEspecie(plantaSeleccionada)} {plantaSeleccionada}
                </Text>
              </View>

              <Text style={styles.conteoLabel}>Beneficiario (obligatorio):</Text>
              <View style={styles.conteoInputRow}>
                <TextInput
                  style={[styles.conteoInputCant, { flex: 1 }]}
                  value={plantacionCedula}
                  onChangeText={onChangeCedulaPlantacion}
                  placeholder="Cédula del beneficiario"
                  placeholderTextColor={COLORS.textLight}
                  keyboardType="numeric"
                />
                <TouchableOpacity style={styles.toolBtn} onPress={buscarBeneficiarioPlantacionPorCedula}>
                  <Text style={styles.toolBtnIcon}>🔍</Text>
                </TouchableOpacity>
              </View>

              {/* Sugerencias mientras se escribe: toca una para seleccionarla */}
              {!beneficiarioValido && sugerenciasBeneficiario.length > 0 && (
                <View style={styles.sugerenciasBox}>
                  {sugerenciasBeneficiario.map((s) => (
                    <TouchableOpacity
                      key={s.cedula}
                      style={styles.sugerenciaItem}
                      onPress={() => aplicarBeneficiario(s.cedula, s)}
                    >
                      <Text style={styles.sugerenciaNombre}>{s.nombre}</Text>
                      <Text style={styles.sugerenciaDato}>
                        🪪 {s.cedula} · 📍 {s.vereda} · 🗺️ {s.corregimiento}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Datos del beneficiario: la vereda y el corregimiento vienen
                  amarrados del padrón (no se eligen a mano). */}
              {beneficiarioValido ? (
                <View style={styles.beneficiarioCard}>
                  <Text style={styles.beneficiarioCardTitle}>👤 {plantacionBeneficiarioNombre}</Text>
                  <Text style={styles.beneficiarioCardRow}>🪪 Cédula: {plantacionCedula.trim()}</Text>
                  <Text style={styles.beneficiarioCardRow}>📍 Vereda: {plantacionVereda || '—'}</Text>
                  <Text style={styles.beneficiarioCardRow}>🗺️ Corregimiento: {plantacionCorregimiento || '—'}</Text>
                </View>
              ) : (
                <Text style={styles.beneficiarioHint}>
                  Escribe la cédula y pulsa 🔍 para validar el beneficiario en el padrón.
                </Text>
              )}

              <View style={styles.conteoActions}>
                <TouchableOpacity
                  style={[
                    styles.conteoSaveBtn,
                    (!cantidadInput || parseInt(cantidadInput) <= 0 || !beneficiarioValido) && styles.toolBtnDisabled,
                  ]}
                  onPress={guardarConteo}
                >
                  <Text style={styles.conteoSaveText}>{plantacionEditandoId ? 'Actualizar área de plantación' : 'Guardar área de plantación'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.conteoCancelBtn} onPress={cancelarPoligonoPlantacion}>
                  <Text style={styles.conteoCancelText}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      {/* Barra de herramientas inferior — oculta en modo consulta */}
      {!soloLectura && (
      <View style={styles.toolbar}>
        {modo === 'medir' && (
          <>
            <View style={styles.toolInfo}>
              <Text style={styles.toolInfoText} numberOfLines={1}>
                {poligono.length} punto(s)
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolButtonsScroll} contentContainerStyle={styles.toolButtonsRow}>
              <TouchableOpacity
                style={[styles.toolBtn, centrando && styles.toolBtnDisabled]}
                onPress={centrarUnaVez}
                disabled={centrando}
              >
                <Text style={styles.toolBtnIcon}>🎯</Text>
                <Text style={styles.toolBtnLabel}>{centrando ? 'GPS...' : 'Centrar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolBtn, siguiendoGPS && styles.toolBtnActive, locating && styles.toolBtnDisabled]}
                onPress={centrarEnGPS}
                disabled={locating}
              >
                <Text style={styles.toolBtnIcon}>📍</Text>
                <Text style={styles.toolBtnLabel}>
                  {locating ? 'GPS...' : siguiendoGPS ? '🟢 Siguiendo' : 'Mi Ubicación'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={abrirHistorialMediciones}>
                <Text style={styles.toolBtnLabel}>📋 Historial</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setMostrarModalKML(true)}>
                <Text style={styles.toolBtnIcon}>🗺️</Text>
                <Text style={styles.toolBtnLabel}>KML</Text>
              </TouchableOpacity>
              {poligono.length > 0 && (
                <>
                  <TouchableOpacity style={styles.toolBtn} onPress={deshacerUltimoPunto}>
                    <Text style={styles.toolBtnLabel}>↩ Deshacer</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toolBtn, styles.toolBtnPrimary]}
                    onPress={calcularYGuardar}
                  >
                    <Text style={styles.toolBtnLabelPrimary}>💾 Calcular y guardar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolBtn} onPress={limpiarPoligono}>
                    <Text style={styles.toolBtnLabel}>✕ Limpiar</Text>
                  </TouchableOpacity>
                </>
              )}
              {poligono.length === 0 && (
                <TouchableOpacity
                  style={[styles.toolBtn, styles.toolBtnPrimary]}
                  onPress={() => Alert.alert('◈ Modo Medición', 'Toca el mapa para comenzar a medir. Con 2 puntos obtienes la distancia y con 3+ el área del polígono.')}
                >
                  <Text style={styles.toolBtnLabelPrimary}>📍 Toca el mapa</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </>
        )}

        {MOSTRAR_CONTEO_PLANTACIONES && modo === 'contar' && (
          <>
            <View style={styles.toolInfo}>
              <Text style={styles.toolInfoText} numberOfLines={1}>
                {plantacionPoligono.length > 0
                  ? `${plantacionPoligono.length} punto(s) · ${plantaciones.length} reg.`
                  : `${plantaciones.length} registro(s)`}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolButtonsScroll} contentContainerStyle={styles.toolButtonsRow}>
              <TouchableOpacity
                style={[styles.toolBtn, centrando && styles.toolBtnDisabled]}
                onPress={centrarUnaVez}
                disabled={centrando}
              >
                <Text style={styles.toolBtnIcon}>🎯</Text>
                <Text style={styles.toolBtnLabel}>{centrando ? 'GPS...' : 'Centrar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolBtn, siguiendoGPS && styles.toolBtnActive, locating && styles.toolBtnDisabled]}
                onPress={centrarEnGPS}
                disabled={locating}
              >
                <Text style={styles.toolBtnIcon}>📍</Text>
                <Text style={styles.toolBtnLabel}>
                  {locating ? 'GPS...' : siguiendoGPS ? '🟢 Siguiendo' : 'Mi Ubicación'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={abrirHistorialPlantaciones}>
                <Text style={styles.toolBtnLabel}>📋 Historial</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setMostrarModalKML(true)}>
                <Text style={styles.toolBtnIcon}>🗺️</Text>
                <Text style={styles.toolBtnLabel}>KML</Text>
              </TouchableOpacity>
              {plantacionPoligono.length > 0 && !mostrarPanelConteo && (
                <>
                  <TouchableOpacity style={styles.toolBtn} onPress={deshacerUltimoPuntoPlantacion}>
                    <Text style={styles.toolBtnLabel}>↩ Deshacer</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.toolBtn,
                      styles.toolBtnPrimary,
                      plantacionPoligono.length < 3 && styles.toolBtnDisabled,
                    ]}
                    onPress={finalizarPoligonoPlantacion}
                    disabled={plantacionPoligono.length < 3}
                  >
                    <Text style={styles.toolBtnLabelPrimary}>
                      {plantacionPoligono.length < 3 ? `Mín. 3 (${plantacionPoligono.length})` : '✅ Finalizar área'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toolBtn} onPress={cancelarPoligonoPlantacion}>
                    <Text style={styles.toolBtnLabel}>✕ Cancelar</Text>
                  </TouchableOpacity>
                </>
              )}
              {plantacionPoligono.length === 0 && !mostrarPanelConteo && (
                <TouchableOpacity
                  style={[styles.toolBtn, styles.toolBtnPrimary]}
                  onPress={() => Alert.alert('🌱 Modo Conteo', 'Toca el mapa para comenzar a dibujar el área de plantación. Con 3+ puntos podrás finalizar y guardar.')}
                >
                  <Text style={styles.toolBtnLabelPrimary}>📍 Toca el mapa</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </>
        )}
      </View>
      )}

      {/* Selector de modo (barra inferior) — oculto en modo consulta */}
      {!soloLectura && (
      <View style={[styles.modeSelector, { paddingBottom: insets.bottom + SPACING.xs }]}>
        <TouchableOpacity
          style={[styles.modeBtn, modo === 'medir' && styles.modeBtnActiveMedir]}
          onPress={() => cambiarModo('medir')}
        >
          <Text style={styles.modeIcon}>◈</Text>
          <Text style={[styles.modeLabel, modo === 'medir' && styles.modeLabelActive]}>
            Medición
          </Text>
        </TouchableOpacity>
        {/* Conteo de plantaciones oculto por ahora (ver MOSTRAR_CONTEO_PLANTACIONES) */}
        {MOSTRAR_CONTEO_PLANTACIONES && (
          <TouchableOpacity
            style={[styles.modeBtn, modo === 'contar' && styles.modeBtnActiveContar]}
            onPress={() => cambiarModo('contar')}
          >
            <Text style={styles.modeIcon}>🌱</Text>
            <Text style={[styles.modeLabel, modo === 'contar' && styles.modeLabelActive]}>
              Conteo
            </Text>
          </TouchableOpacity>
        )}
      </View>
      )}

      {/* Modal KML — un solo <Modal> con dos pasos (menú / nombre).
          Antes eran dos <Modal> separados: al cerrar el del menú y abrir el
          del nombre en el mismo instante, en iOS el segundo no se presentaba
          y parecía que el KML se guardaba sin poder nombrarlo. */}
      <Modal
        visible={mostrarModalKML || mostrarModalNombreKML}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setMostrarModalKML(false);
          setMostrarModalNombreKML(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {mostrarModalNombreKML ? (
              <>
                <Text style={styles.modalTitle}>
                  {accionNombre === 'guardar' ? '💾 Guardar medición' : '📤 Exportar KML'}
                </Text>
                <Text style={styles.kmlLabel}>
                  {accionNombre === 'guardar' ? 'Nombre de la medición' : 'Nombre del KML'}
                </Text>
                <View style={styles.kmlNombreRow}>
                  <TextInput
                    style={styles.kmlNombreInput}
                    value={nombreBaseKML}
                    onChangeText={setNombreBaseKML}
                    placeholder="Ej. Luiz Rojas"
                    placeholderTextColor={COLORS.textLight}
                    autoCorrect={false}
                    maxLength={80}
                  />
                  {/* El origen se agrega solo, el técnico no lo puede borrar por error */}
                  <Text style={styles.kmlSufijo} numberOfLines={1}>
                    - {MOSTRAR_CONTEO_PLANTACIONES ? sufijoKML : 'Medicion'}
                  </Text>
                </View>
                <Text style={styles.kmlPreview} numberOfLines={2}>
                  {accionNombre === 'guardar'
                    ? `Se guardará en el historial como: ${nombreCompletoKML}`
                    : `Se exportará como: ${nombreCompletoKML}.kml`}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.modalBtn,
                    styles.modalBtnExportar,
                    (exportandoKML || guardandoMedicion) && styles.toolBtnDisabled,
                  ]}
                  onPress={confirmarAccionNombre}
                  disabled={exportandoKML || guardandoMedicion}
                >
                  {exportandoKML || guardandoMedicion ? (
                    <ActivityIndicator color={COLORS.textOnPrimary} />
                  ) : (
                    <Text style={styles.modalBtnTextExportar}>
                      {accionNombre === 'guardar' ? '💾 Guardar medición' : '📤 Exportar KML'}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnCancel]}
                  onPress={() => setMostrarModalNombreKML(false)}
                  disabled={exportandoKML || guardandoMedicion}
                >
                  <Text style={styles.modalBtnTextCancel}>Cancelar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>🗺️ Importar / Exportar KML</Text>
                <TouchableOpacity style={styles.modalBtn} onPress={() => abrirModalNombreMedicion('exportar')}>
                  <Text style={styles.modalBtnIcon}>📤</Text>
                  <Text style={styles.modalBtnText}>Exportar polígono a KML</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalBtn} onPress={handleImportarKML}>
                  <Text style={styles.modalBtnIcon}>📥</Text>
                  <Text style={styles.modalBtnText}>Importar KML</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnCancel]}
                  onPress={() => setMostrarModalKML(false)}
                >
                  <Text style={styles.modalBtnTextCancel}>Cancelar</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal: Historial de Mediciones */}
      <Modal visible={mostrarHistorialMediciones} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.modalContentHistorial]}>
            <Text style={styles.modalTitle}>📋 Historial de Mediciones</Text>
            {cargandoHistorialMediciones ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginVertical: SPACING.lg }} />
            ) : medicionesGuardadas.length === 0 ? (
              <Text style={styles.emptyPacksText}>
                Todavía no hay mediciones guardadas. Marca un área o distancia y presiona &quot;Calcular y guardar&quot;.
              </Text>
            ) : (
              <ScrollView style={styles.historialScroll}>
                {medicionesGuardadas.map((m) => (
                  <View key={m.id} style={styles.historialItem}>
                    <View style={styles.historialItemInfo}>
                      {/* El nombre es lo que permite distinguir una medición de
                          otra; la fecha queda como dato secundario. Las
                          mediciones viejas (sin nombre) siguen mostrando la fecha. */}
                      <Text style={styles.historialItemNombre} numberOfLines={2}>
                        {m.nombre || 'Medición sin nombre'}
                      </Text>
                      <Text style={styles.historialItemFecha}>
                        {m.created_at ? new Date(m.created_at).toLocaleDateString('es-CO') : '—'} ·{' '}
                        {m.created_at ? new Date(m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </Text>
                      <Text style={styles.historialItemDetalle}>
                        {m.area_hectareas > 0
                          ? `◈ ${m.area_hectareas} ha · ${(m.puntos || []).length} pts`
                          : `📏 ${(m.perimetro_metros || 0).toFixed(1)} m (distancia)`}
                      </Text>
                      {/* Atribución: de qué beneficiario y vereda es el polígono.
                          Antes el historial solo mostraba área y fecha, así que
                          dos mediciones del mismo tamaño eran indistinguibles. */}
                      {!!(m.beneficiario_nombre || m.beneficiario_cedula) && (
                        <Text style={styles.historialItemAtribucion} numberOfLines={2}>
                          👤 {m.beneficiario_nombre || 'Sin nombre'}
                          {m.beneficiario_cedula ? ` · C.C. ${m.beneficiario_cedula}` : ''}
                        </Text>
                      )}
                      {!!(m.vereda || m.corregimiento) && (
                        <Text style={styles.historialItemAtribucion} numberOfLines={2}>
                          📍 {[m.vereda, m.corregimiento].filter(Boolean).join(' — ')}
                        </Text>
                      )}
                    </View>
                    <View style={styles.historialItemAcciones}>
                      <TouchableOpacity onPress={() => verMedicionPreview(m)} style={styles.historialAccionBtn}>
                        <Text style={styles.historialAccionIcono}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => eliminarMedicionGuardada(m)}
                        style={styles.historialAccionBtn}
                        disabled={eliminandoMedicionId === m.id}
                      >
                        {eliminandoMedicionId === m.id ? (
                          <ActivityIndicator size="small" color={COLORS.error} />
                        ) : (
                          <Text style={styles.historialAccionIcono}>🗑️</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setMostrarHistorialMediciones(false)}
            >
              <Text style={styles.modalBtnTextCancel}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: Confirmar eliminación de medición (Alert.alert no muestra
          botones en web, por eso usamos un modal propio). */}
      <Modal visible={!!confirmarEliminarMedicion} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🗑️ Eliminar medición</Text>
            <Text style={styles.confirmarTexto}>
              ¿Seguro que quieres eliminar esta área/distancia guardada? Esta acción no se puede deshacer.
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnEliminar]}
              onPress={confirmarEliminarMedicionGuardada}
            >
              <Text style={styles.modalBtnIcon}>🗑️</Text>
              <Text style={styles.modalBtnTextEliminar}>Eliminar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setConfirmarEliminarMedicion(null)}
            >
              <Text style={styles.modalBtnTextCancel}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: Historial de Plantaciones */}
      <Modal visible={MOSTRAR_CONTEO_PLANTACIONES && mostrarHistorialPlantaciones} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.modalContentHistorial]}>
            <Text style={styles.modalTitle}>📋 Historial de Áreas de Plantación</Text>
            {plantaciones.length === 0 ? (
              <Text style={styles.emptyPacksText}>
                Todavía no tienes áreas de plantación guardadas.
              </Text>
            ) : (
              <ScrollView style={styles.historialScroll}>
                {plantaciones.map((pl) => (
                  <View key={pl.id} style={styles.historialItem}>
                    <View style={styles.historialItemInfo}>
                      <Text style={styles.historialItemFecha}>
                        {pl.icono} {pl.especie} — {pl.cantidad} plantas
                      </Text>
                      <Text style={styles.historialItemDetalle}>
                        {pl.timestamp ? new Date(pl.timestamp).toLocaleDateString('es-CO') : '—'}
                        {pl.poligono?.length ? ` · ${pl.poligono.length} pts` : ''}
                      </Text>
                    </View>
                    <View style={styles.historialItemAcciones}>
                      <TouchableOpacity onPress={() => revivirPlantacion(pl)} style={styles.historialAccionBtn}>
                        <Text style={styles.historialAccionIcono}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => eliminarPlantacionGuardada(pl)}
                        style={styles.historialAccionBtn}
                        disabled={eliminandoPlantacionId === pl.id}
                      >
                        {eliminandoPlantacionId === pl.id ? (
                          <ActivityIndicator size="small" color={COLORS.error} />
                        ) : (
                          <Text style={styles.historialAccionIcono}>🗑️</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setMostrarHistorialPlantaciones(false)}
            >
              <Text style={styles.modalBtnTextCancel}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: Confirmar eliminación de plantación (Alert.alert no muestra
          botones en web, por eso usamos un modal propio). */}
      <Modal visible={MOSTRAR_CONTEO_PLANTACIONES && !!confirmarEliminarPlantacion} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🗑️ Eliminar área de plantación</Text>
            <Text style={styles.confirmarTexto}>
              ¿Seguro que quieres eliminar esta área de plantación guardada? Esta acción no se puede deshacer.
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnEliminar]}
              onPress={confirmarEliminarPlantacionGuardada}
            >
              <Text style={styles.modalBtnIcon}>🗑️</Text>
              <Text style={styles.modalBtnTextEliminar}>Eliminar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setConfirmarEliminarPlantacion(null)}
            >
              <Text style={styles.modalBtnTextCancel}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: detalle de una plantación tocada en el mapa */}
      <Modal visible={MOSTRAR_CONTEO_PLANTACIONES && !!plantacionSeleccionada} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {plantacionSeleccionada?.icono || getIconoEspecie(plantacionSeleccionada?.especie || '')} Plantación
            </Text>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Especie:</Text>
              <Text style={styles.detalleValue}>{plantacionSeleccionada?.especie || '—'}</Text>
            </View>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Cantidad:</Text>
              <Text style={styles.detalleValue}>{plantacionSeleccionada?.cantidad ?? '—'}</Text>
            </View>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Técnico:</Text>
              <Text style={styles.detalleValue}>{user?.nombre || '—'}</Text>
            </View>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Beneficiario:</Text>
              <Text style={styles.detalleValue}>{plantacionSeleccionada?.beneficiario_nombre || '—'}</Text>
            </View>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Vereda:</Text>
              <Text style={styles.detalleValue}>
                {[plantacionSeleccionada?.vereda, plantacionSeleccionada?.corregimiento].filter(Boolean).join(' — ') || '—'}
              </Text>
            </View>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>Fecha:</Text>
              <Text style={styles.detalleValue}>
                {plantacionSeleccionada?.timestamp ? new Date(plantacionSeleccionada.timestamp).toLocaleDateString('es-CO') : '—'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setPlantacionSeleccionada(null)}
            >
              <Text style={styles.modalBtnTextCancel}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: gestión de mapas offline descargados */}
      <Modal visible={mostrarModalPaquetes} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>⬇️ Mapas Descargados</Text>
            {paquetesOffline.length === 0 ? (
              <Text style={styles.emptyPacksText}>No has descargado ningún mapa offline todavía.</Text>
            ) : (
              paquetesOffline.map((pack) => (
                <View key={pack.name} style={styles.packRow}>
                  <View style={styles.packInfo}>
                    <Text style={styles.packName} numberOfLines={1}>{formatearZonaPack(pack)}</Text>
                    <Text style={styles.packMeta} numberOfLines={1}>
                      {pack.metadata?.tipo === 'satelite'
                        ? '🛰️ Satélite HD'
                        : pack.metadata?.tipo === 'satelite-reciente'
                          ? '📅 Satélite Relieve'
                          : '⛰️ Terreno/Calles'} · Descargado: {formatearFechaPack(pack.metadata?.creado)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleActualizarPaquete(pack)} style={styles.packActionBtn}>
                    <Text style={styles.packActionIcon}>🔄</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleEliminarPaquete(pack.name)} style={styles.packActionBtn}>
                    <Text style={styles.packDeleteIcon}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setMostrarModalPaquetes(false)}
            >
              <Text style={styles.modalBtnTextCancel}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  // --- Selector de modo (barra inferior) ---
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginHorizontal: 4,
    backgroundColor: COLORS.background,
  },
  modeBtnActiveMedir: {
    backgroundColor: COLORS.secondary + '20',
    borderWidth: 1,
    borderColor: COLORS.secondary,
  },
  modeBtnActiveContar: {
    backgroundColor: COLORS.success + '20',
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  modeIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  modeLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
  },
  modeLabelActive: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  // --- Overlay coordenadas ---
  coordsOverlay: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    backgroundColor: COLORS.surface,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    ...SHADOWS.sm,
  },
  previewBanner: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    right: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.roleGerente,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    ...SHADOWS.sm,
  },
  previewBannerText: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
  },
  previewBannerClose: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.bold,
    fontSize: FONTS.sizes.sm,
  },
  readOnlyBanner: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: 'rgba(27, 94, 32, 0.92)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    ...SHADOWS.sm,
  },
  readOnlyBannerText: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
  },
  coordsLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
    marginBottom: 2,
  },
  coordsValue: {
    fontSize: FONTS.sizes.xs,
    fontFamily: 'monospace',
    color: COLORS.textPrimary,
  },
  coordsHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  // --- Aviso inicial (cómo empezar a medir/contar) ---
  startHintOverlay: {
    position: 'absolute',
    top: '38%',
    left: SPACING.lg,
    right: SPACING.lg,
    alignItems: 'center',
    backgroundColor: COLORS.surface + 'E6',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.md,
  },
  startHintIcon: {
    fontSize: 28,
    marginBottom: SPACING.xs,
  },
  startHintTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  startHintText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  // --- Resultado medición ---
  resultOverlay: {
    position: 'absolute',
    bottom: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.lg,
  },
  resultTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.secondary,
    marginBottom: SPACING.sm,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  resultLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  resultValue: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  resultActions: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  resultBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  resultBtnSecondary: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultBtnText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  resultBtnTextSecondary: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  // --- Panel Conteo ---
  conteoPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.lg,
    borderTopRightRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    maxHeight: '75%',
    ...SHADOWS.lg,
  },
  conteoScroll: {
    flexGrow: 0,
  },
  conteoScrollContent: {
    paddingBottom: SPACING.md,
  },
  conteoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  conteoTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.success,
  },
  conteoSubtitle: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  beneficiarioCard: {
    backgroundColor: COLORS.success + '12',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.success + '40',
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
    gap: 2,
  },
  beneficiarioCardTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  beneficiarioCardRow: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  beneficiarioHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginBottom: SPACING.sm,
  },
  sugerenciasBox: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  sugerenciaItem: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sugerenciaNombre: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  sugerenciaDato: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  conteoClose: {
    fontSize: 18,
    color: COLORS.textSecondary,
    padding: SPACING.xs,
  },
  conteoLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  conteoOptionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },
  conteoOptionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  conteoOptionBtnActive: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '15',
  },
  conteoOptionIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  conteoOptionLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  conteoOptionLabelActive: {
    color: COLORS.success,
    fontWeight: FONTS.weights.bold,
  },
  conteoInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  conteoInputCant: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  conteoPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success + '10',
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  conteoPreviewText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.success,
    fontWeight: FONTS.weights.semibold,
  },
  conteoActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  conteoSaveBtn: {
    flex: 1,
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  conteoSaveText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  conteoCancelBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  conteoCancelText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
  },
  conteoPanelSimple: {
    position: 'absolute',
    bottom: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.lg,
  },
  conteoAreaActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  // --- Toolbar ---
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginRight: SPACING.sm,
  },
  toolBtnDisabled: {
    opacity: 0.5,
  },
  toolBtnActive: {
    backgroundColor: COLORS.success || '#2E7D32',
  },
  toolBtnPrimary: {
    backgroundColor: COLORS.primary,
  },
  toolBtnIcon: {
    fontSize: 16,
    marginRight: SPACING.xs,
  },
  toolBtnLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  toolBtnLabelPrimary: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  toolInfo: {
    flexShrink: 1,
    marginRight: SPACING.sm,
  },
  toolInfoText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  toolButtonsScroll: {
    flex: 1,
  },
  toolButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // --- Modal ---
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    width: '85%',
    ...SHADOWS.lg,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  detalleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detalleLabel: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  detalleValue: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  modalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
  },
  modalBtnIcon: {
    fontSize: 20,
    marginRight: SPACING.md,
  },
  modalBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  modalBtnCancel: {
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalBtnTextCancel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
  confirmarTexto: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  modalBtnEliminar: {
    backgroundColor: COLORS.error,
    justifyContent: 'center',
  },
  modalBtnTextEliminar: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  // --- Modal: nombrar el KML ---
  kmlLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  kmlNombreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  kmlNombreInput: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  kmlSufijo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
    flexShrink: 0,
  },
  kmlPreview: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginBottom: SPACING.md,
  },
  modalBtnExportar: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
  },
  modalBtnTextExportar: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  // --- Botón tipo de mapa ---
  mapTypeButton: {
    position: 'absolute',
    right: SPACING.sm,
    top: SPACING.xl,
    width: 44,
    height: 44,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.md,
    elevation: 6,
    zIndex: 10,
  },
  mapTypeButtonText: {
    fontSize: 22,
  },
  // Estado de descarga dentro del mismo botón circular de 44px: el texto
  // "⏳NN%" es más largo que un emoji solo, así que necesita fuente pequeña
  // para no desbordarse.
  downloadProgressText: {
    fontSize: 10,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  emptyPacksText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  packInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  packName: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  packMeta: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  packActionBtn: {
    paddingHorizontal: SPACING.xs,
  },
  packDeleteIcon: {
    fontSize: 18,
  },
  packActionIcon: {
    fontSize: 18,
  },
  // --- Historial (mediciones / plantaciones) ---
  modalContentHistorial: {
    maxHeight: '75%',
  },
  historialScroll: {
    maxHeight: 380,
  },
  historialItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  historialItemInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  // Nombre de la medición: línea principal del historial, para poder
  // distinguir una medición de otra sin mirar la fecha.
  historialItemNombre: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  historialItemFecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: 2,
  },
  historialItemDetalle: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  historialItemAtribucion: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: 2,
  },
  historialItemAcciones: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  historialAccionBtn: {
    paddingHorizontal: SPACING.xs,
    minWidth: 28,
    alignItems: 'center',
  },
  historialAccionIcono: {
    fontSize: 20,
  },
  downloadMapButton: {
    position: 'absolute',
    right: SPACING.sm,
    top: SPACING.xl + 44 + SPACING.sm,
    width: 44,
    height: 44,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.md,
    elevation: 6,
    zIndex: 10,
  },
});

export default MapaScreen;
