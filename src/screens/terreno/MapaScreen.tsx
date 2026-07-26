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
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useTrackingContext } from '../../store/TrackingContext';
import { useAuth } from '../../store/AuthContext';
import { useSync } from '../../store/SyncContext';
import { useGPS } from '../../store/GPSContext';
import MapViewOffline from '../../components/MapViewOffline';
import { calcularArea, exportarKML, importarKML, exportarKMLRuta } from '../../services/kml.service';
import {
  savePlantacion,
  saveMedicion,
  getPlantaciones,
  getSesionesRuta,
  getPosicionesPorSesion,
  SesionRutaResumen,
  getMediciones,
  deleteMedicionLocal,
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
import { PLANTAS_OPCIONES, getIconoEspecie, getVeredasByMunicipio } from '../../utils/constants';
import { PADRON_BENEFICIARIOS } from '../../data/padronBeneficiarios';
import DropdownPicker from '../../components/DropdownPicker';

const STORAGE_KEY_MAP = '@geodaily/mapa_estado';

// Zona de trabajo del proyecto (Puerto Rico, Caquetá) — permite descargar
// el mapa correcto para los técnicos sin importar desde dónde se esté
// probando/preparando la descarga (ej. alguien en Florencia preparando el
// mapa para técnicos que trabajan en Puerto Rico).
const PUERTO_RICO_CENTRO: Coordenadas = { latitud: 1.914, longitud: -75.145 };

type ModoMapa = 'navegar' | 'medir' | 'contar' | 'ruta';

const MapaScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { syncNow } = useSync();
  const tracking = useTrackingContext();
  const [modo, setModo] = useState<ModoMapa>('navegar');
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

  // El modo inicial es 'navegar' — activar el seguimiento en tiempo real
  // desde el primer momento, sin esperar a que el técnico toque "Mi Ubicación".
  useEffect(() => {
    setSiguiendoGPS(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seguir al usuario en tiempo real — SOLO en Navegar y Ruta. En Medición y
  // Conteo el técnico necesita hacer zoom/pan libremente para ubicar cada
  // punto con precisión; si el mapa se recentra solo cada vez que llega una
  // posición GPS (cada ~15s), lo "pierde" en medio de marcar un punto.
  useEffect(() => {
    if (siguiendoGPS && userLocation && mapCenterInitialized.current && (modo === 'navegar' || modo === 'ruta')) {
      setMapCenter(userLocation);
    }
  }, [siguiendoGPS, userLocation, modo]);

  // --- Estado para Medición ---
  const [poligono, setPoligono] = useState<PuntoPoligono[]>([]);
  const [resultadoArea, setResultadoArea] = useState<{
    areaMetros2: number;
    areaHectareas: number;
    perimetroMetros: number;
  } | null>(null);
  const [mostrarResultado, setMostrarResultado] = useState(false);

  // --- Estado para distancia lineal (2 puntos) ---
  const [resultadoDistancia, setResultadoDistancia] = useState<{
    distanciaMetros: number;
    distanciaKm: number;
  } | null>(null);

  // --- Estado para Conteo (polígono de plantación + selector de especie) ---
  const [mostrarPanelConteo, setMostrarPanelConteo] = useState(false);
  const [plantaSeleccionada, setPlantaSeleccionada] = useState<string>('Cacao');
  const [cantidadInput, setCantidadInput] = useState<string>('');
  /** Polígono que el técnico va dibujando en modo conteo */
  const [plantacionPoligono, setPlantacionPoligono] = useState<PuntoPoligono[]>([]);
  /** Beneficiario/vereda opcional asociado al área de plantación */
  const [plantacionCedula, setPlantacionCedula] = useState('');
  const [plantacionBeneficiarioNombre, setPlantacionBeneficiarioNombre] = useState('');
  const [plantacionVereda, setPlantacionVereda] = useState('');
  const [plantacionCorregimiento, setPlantacionCorregimiento] = useState('');
  const veredasPlantacion = getVeredasByMunicipio('Caquetá', 'Puerto Rico');

  const buscarBeneficiarioPlantacionPorCedula = useCallback(() => {
    const cedula = plantacionCedula.trim();
    const encontrado = PADRON_BENEFICIARIOS[cedula];
    if (encontrado) {
      setPlantacionBeneficiarioNombre(encontrado.nombre);
      setPlantacionVereda(encontrado.vereda);
      setPlantacionCorregimiento(encontrado.corregimiento);
    } else {
      Alert.alert('No encontrado', 'No se encontró un beneficiario con esa cédula en el padrón.');
    }
  }, [plantacionCedula]);

  // --- Estado para Plantaciones (Fase B) ---
  const [plantaciones, setPlantaciones] = useState<Plantacion[]>([]);

  // --- Estado para KML ---
  const [mostrarModalKML, setMostrarModalKML] = useState(false);

  // --- Historial de rutas (sesiones de tracking guardadas) ---
  const [mostrarHistorialRutas, setMostrarHistorialRutas] = useState(false);
  const [sesionesRuta, setSesionesRuta] = useState<SesionRutaResumen[]>([]);
  const [cargandoHistorialRutas, setCargandoHistorialRutas] = useState(false);
  const [rutaPreview, setRutaPreview] = useState<{ sesionId: string; puntos: { latitud: number; longitud: number }[] } | null>(null);
  const [exportandoSesionId, setExportandoSesionId] = useState<string | null>(null);

  // --- Historial de mediciones (áreas/distancias guardadas) ---
  const [mostrarHistorialMediciones, setMostrarHistorialMediciones] = useState(false);
  const [medicionesGuardadas, setMedicionesGuardadas] = useState<Record<string, any>[]>([]);
  const [cargandoHistorialMediciones, setCargandoHistorialMediciones] = useState(false);
  const [medicionPreview, setMedicionPreview] = useState<{ id: string; puntos: { latitud: number; longitud: number }[] } | null>(null);
  const [eliminandoMedicionId, setEliminandoMedicionId] = useState<string | null>(null);

  // --- Historial de plantaciones (áreas de siembra guardadas) ---
  const [mostrarHistorialPlantaciones, setMostrarHistorialPlantaciones] = useState(false);

  // --- Tipo de mapa: relieve (CartoDB) o satélite ---
  const [tipoMapa, setTipoMapa] = useState<'relieve' | 'satelite'>('relieve');

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
            if (estado.modo) setModo(estado.modo);
            if (estado.tipoMapa) setTipoMapa(estado.tipoMapa);
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
      const coords = await getCurrentPosition();
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
    [modo]
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
        area_hectareas: 0,
        area_metros2: 0,
        perimetro_metros: d,
        puntos: poligono.map((p) => ({ latitud: p.latitud, longitud: p.longitud })),
        sincronizado: false,
      })
        .then(() => { syncNow().catch(() => {}); })
        .catch((e) => console.warn('[Mapa] No se pudo guardar la distancia:', e));
    } else {
      // Área (3+ puntos)
      const area = calcularArea(poligono);
      setResultadoArea(area);
      setResultadoDistancia(null);
      // Persistir medición en SQLite
      saveMedicion({
        id: idMedicion,
        usuario_id: user?.id,
        area_hectareas: area.areaHectareas,
        area_metros2: area.areaMetros2,
        perimetro_metros: area.perimetroMetros,
        puntos: poligono.map(p => ({ latitud: p.latitud, longitud: p.longitud })),
        sincronizado: false,
      }).then(() => {
        // Intentar sincronizar al servidor si hay conexión
        syncNow().catch(() => {});
      }).catch(err => console.warn('[Mapa] Error al persistir medición:', err));
    }
    setMostrarResultado(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poligono, calcularDistanciaHaversine, user?.id]);

  const limpiarPoligono = useCallback(() => {
    setPoligono([]);
    setResultadoArea(null);
    setResultadoDistancia(null);
    setMostrarResultado(false);
  }, []);

  const deshacerUltimoPunto = useCallback(() => {
    setPoligono((prev) => prev.slice(0, -1));
    setResultadoArea(null);
    setResultadoDistancia(null);
    setMostrarResultado(false);
  }, []);

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
  }, []);

  const guardarConteo = useCallback(async () => {
    const cantidad = parseInt(cantidadInput);
    if (!cantidad || cantidad <= 0) {
      Alert.alert('Cantidad inválida', 'Ingresa un número válido de plantas.');
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
    const plantacion: Plantacion = {
      id: `plant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
    await savePlantacion(plantacion);
    setPlantaciones((prev) => [...prev, plantacion]);
    // Intentar sincronizar al servidor si hay conexión
    syncNow().catch(() => {});
    Alert.alert(
      '✅ Conteo guardado',
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantaSeleccionada, cantidadInput, ultimoPunto, userLocation, user?.id, plantacionPoligono, plantacionCedula, plantacionBeneficiarioNombre, plantacionVereda, plantacionCorregimiento]);

  // --- Funciones KML ---
  const handleExportarKML = useCallback(async () => {
    if (poligono.length < 3) {
      Alert.alert('Sin polígono', 'Dibuja un polígono en modo Medición primero.');
      return;
    }
    const nombre = `Medicion_${new Date().toISOString().split('T')[0]}`;
    await exportarKML(nombre, poligono);
    setMostrarModalKML(false);
  }, [poligono]);

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

  // --- Historial de rutas ---
  const abrirHistorialRutas = useCallback(async () => {
    if (!user?.id) return;
    setCargandoHistorialRutas(true);
    setMostrarHistorialRutas(true);
    try {
      const sesiones = await getSesionesRuta(user.id);
      setSesionesRuta(sesiones);
    } finally {
      setCargandoHistorialRutas(false);
    }
  }, [user?.id]);

  const verRutaPreview = useCallback(async (sesionId: string) => {
    const posiciones = await getPosicionesPorSesion(sesionId);
    if (posiciones.length === 0) {
      Alert.alert('Sin puntos', 'Esta ruta no tiene posiciones guardadas.');
      return;
    }
    setRutaPreview({
      sesionId,
      puntos: posiciones.map((p) => ({ latitud: p.latitud, longitud: p.longitud })),
    });
    setFoco({ coords: { latitud: posiciones[0].latitud, longitud: posiciones[0].longitud }, nonce: Date.now() });
    setMostrarHistorialRutas(false);
  }, []);

  const cerrarRutaPreview = useCallback(() => setRutaPreview(null), []);

  const exportarSesionRuta = useCallback(async (sesion: SesionRutaResumen) => {
    setExportandoSesionId(sesion.sesionId);
    try {
      const posiciones = await getPosicionesPorSesion(sesion.sesionId);
      if (posiciones.length < 2) {
        Alert.alert('Sin puntos suficientes', 'Esta ruta no tiene suficientes posiciones para exportar.');
        return;
      }
      const fecha = new Date(sesion.inicio).toISOString().split('T')[0];
      await exportarKMLRuta(`Ruta_${fecha}_${sesion.sesionId.slice(-6)}`, posiciones);
    } finally {
      setExportandoSesionId(null);
    }
  }, []);

  // --- Historial de mediciones ---
  const abrirHistorialMediciones = useCallback(async () => {
    setCargandoHistorialMediciones(true);
    setMostrarHistorialMediciones(true);
    try {
      const todas = await getMediciones();
      setMedicionesGuardadas(todas.filter((m) => !user?.id || m.usuario_id === user.id));
    } finally {
      setCargandoHistorialMediciones(false);
    }
  }, [user?.id]);

  const verMedicionPreview = useCallback((medicion: Record<string, any>) => {
    const puntos = (medicion.puntos || []) as { latitud: number; longitud: number }[];
    if (puntos.length === 0) return;
    setMedicionPreview({ id: medicion.id, puntos });
    setFoco({ coords: puntos[0], nonce: Date.now() });
    setMostrarHistorialMediciones(false);
  }, []);

  const cerrarMedicionPreview = useCallback(() => setMedicionPreview(null), []);

  const eliminarMedicionGuardada = useCallback(async (id: string) => {
    Alert.alert('Eliminar medición', '¿Seguro que quieres eliminar esta área/distancia guardada?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setEliminandoMedicionId(id);
          try {
            await deleteMedicionLocal(id);
            setMedicionesGuardadas((prev) => prev.filter((m) => m.id !== id));
            if (medicionPreview?.id === id) setMedicionPreview(null);
          } finally {
            setEliminandoMedicionId(null);
          }
        },
      },
    ]);
  }, [medicionPreview]);

  // --- Historial de plantaciones ---
  const abrirHistorialPlantaciones = useCallback(() => {
    setMostrarHistorialPlantaciones(true);
  }, []);

  const verPlantacionEnMapa = useCallback((pl: Plantacion) => {
    setFoco({ coords: { latitud: pl.latitud, longitud: pl.longitud }, nonce: Date.now() });
    setMostrarHistorialPlantaciones(false);
  }, []);

  // Cambiar modo
  const cambiarModo = useCallback(
    (nuevoModo: ModoMapa) => {
      setModo(nuevoModo);
      if (nuevoModo !== 'medir') {
        setMostrarResultado(false);
      }
      if (nuevoModo !== 'contar') {
        setMostrarPanelConteo(false);
        setPlantacionPoligono([]);
      }
      // Navegar y Ruta siguen la ubicación en tiempo real automáticamente;
      // Medición y Conteo la apagan (el técnico centra manualmente con el
      // botón "Centrar" cuando lo necesite, sin que el mapa se mueva solo).
      setSiguiendoGPS(nuevoModo === 'navegar' || nuevoModo === 'ruta');
    },
    [setSiguiendoGPS]
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface} />

      {/* Selector de modo */}
      <View style={styles.modeSelector}>
        <TouchableOpacity
          style={[styles.modeBtn, modo === 'navegar' && styles.modeBtnActive]}
          onPress={() => cambiarModo('navegar')}
        >
          <Text style={styles.modeIcon}>🧭</Text>
          <Text style={[styles.modeLabel, modo === 'navegar' && styles.modeLabelActive]}>
            Navegar
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, modo === 'medir' && styles.modeBtnActiveMedir]}
          onPress={() => cambiarModo('medir')}
        >
          <Text style={styles.modeIcon}>📐</Text>
          <Text style={[styles.modeLabel, modo === 'medir' && styles.modeLabelActive]}>
            Medición
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, modo === 'contar' && styles.modeBtnActiveContar]}
          onPress={() => cambiarModo('contar')}
        >
          <Text style={styles.modeIcon}>🌱</Text>
          <Text style={[styles.modeLabel, modo === 'contar' && styles.modeLabelActive]}>
            Conteo
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, modo === 'ruta' && styles.modeBtnActiveRuta]}
          onPress={() => cambiarModo('ruta')}
        >
          <Text style={styles.modeIcon}>🛣️</Text>
          <Text style={[styles.modeLabel, modo === 'ruta' && styles.modeLabelActive]}>
            Ruta
          </Text>
        </TouchableOpacity>
      </View>

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
              draggable: modo === 'medir',
            })),
            // Puntos del polígono de plantación (conteo) — igual, arrastrables
            ...plantacionPoligono.map((p) => ({
              id: `pp_${p.orden}`,
              latitud: p.latitud,
              longitud: p.longitud,
              title: `Área punto ${p.orden} (mantén presionado para moverlo)`,
              color: '#2E7D32',
              draggable: modo === 'contar',
            })),
            // Centroide del polígono de plantación (icono difuminado)
            ...(getPlantacionCentroide() ? [{
              id: 'plantacion-centro',
              latitud: getPlantacionCentroide()!.lat,
              longitud: getPlantacionCentroide()!.lon,
              title: 'Centro del área',
              icon: getIconoEspecie(plantaSeleccionada),
            }] : []),
            // Plantaciones guardadas
            ...plantaciones.map((pl) => ({
              id: pl.id,
              latitud: pl.latitud,
              longitud: pl.longitud,
              title: `${pl.especie}: ${pl.cantidad} plantas`,
              icon: pl.icono || getIconoEspecie(pl.especie),
            })),
          ]}
          polyline={
            rutaPreview
              ? rutaPreview.puntos
              : modo === 'ruta'
              ? tracking.posiciones.map(p => ({ latitud: p.latitud, longitud: p.longitud }))
              : modo === 'medir' && poligono.length >= 2
              ? poligono.map(p => ({ latitud: p.latitud, longitud: p.longitud }))
              : undefined
          }
          startMarker={
            rutaPreview
              ? rutaPreview.puntos[0]
              : modo === 'ruta' && tracking.posiciones.length > 0
              ? { latitud: tracking.posiciones[0].latitud, longitud: tracking.posiciones[0].longitud }
              : undefined
          }
          endMarker={
            rutaPreview
              ? rutaPreview.puntos[rutaPreview.puntos.length - 1]
              : modo === 'ruta' && tracking.posiciones.length > 0
              ? { latitud: tracking.posiciones[tracking.posiciones.length - 1].latitud, longitud: tracking.posiciones[tracking.posiciones.length - 1].longitud }
              : undefined
          }
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

            // Previsualización de una medición ya guardada, elegida desde el
            // historial — independiente del modo activo.
            if (medicionPreview && medicionPreview.puntos.length >= 3) {
              const coordsPreview = [
                ...medicionPreview.puntos.map((p) => [p.longitud, p.latitud]),
                [medicionPreview.puntos[0].longitud, medicionPreview.puntos[0].latitud],
              ];
              layers.push({
                id: 'medicion-preview',
                features: [{
                  type: 'Feature',
                  geometry: { type: 'Polygon', coordinates: [coordsPreview] },
                  properties: {},
                }],
                fillColor: 'rgba(230, 81, 0, 0.22)',
                strokeColor: '#E65100',
                strokeWidth: 2.5,
                strokeOpacity: 0.85,
                fillOpacity: 0.22,
              });
            }

            // Polígono EN DIBUJO (mientras el técnico marca los puntos)
            if (plantacionPoligono.length >= 3) {
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
                fillColor: 'rgba(46, 125, 50, 0.25)',
                strokeColor: '#1B5E20',
                strokeWidth: 2.5,
                strokeOpacity: 0.8,
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
            if (featuresGuardadas.length > 0) {
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
          onMapPress={handleMapPress}
          onMarkerDragEnd={moverPuntoPoligono}
          foco={foco}
        />

        {/* Banner de previsualización de ruta o medición guardada */}
        {(rutaPreview || medicionPreview) && (
          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerText}>
              👁 Viendo {rutaPreview ? 'ruta' : 'área'} guardada
            </Text>
            <TouchableOpacity onPress={rutaPreview ? cerrarRutaPreview : cerrarMedicionPreview}>
              <Text style={styles.previewBannerClose}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Overlay de coordenadas */}
        {ultimoPunto && (
          <View style={styles.coordsOverlay}>
            <Text style={styles.coordsLabel}>
              {modo === 'medir' ? `Punto #${poligono.length}` : modo === 'contar' ? `Área punto #${plantacionPoligono.length}` : 'Coordenadas'}
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
            {modo === 'contar' && plantacionPoligono.length > 0 && (
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
            <Text style={styles.resultTitle}>📐 Resultado</Text>
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
                onPress={() => setMostrarModalKML(true)}
              >
                <Text style={styles.resultBtnText}>Exportar KML</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultBtn, styles.resultBtnSecondary]}
                onPress={limpiarPoligono}
              >
                <Text style={styles.resultBtnTextSecondary}>Nuevo</Text>
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
                onPress={limpiarPoligono}
              >
                <Text style={styles.resultBtnTextSecondary}>Nuevo</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Botón toggle tipo de mapa */}
        <TouchableOpacity
          style={styles.mapTypeButton}
          onPress={() =>
            setTipoMapa((prev) => (prev === 'relieve' ? 'satelite' : 'relieve'))
          }
        >
          <Text style={styles.mapTypeButtonText}>
            {tipoMapa === 'relieve' ? '🛰️' : '🗺️'}
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
        {modo === 'contar' && plantacionPoligono.length >= 3 && !mostrarPanelConteo && (
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
        {mostrarPanelConteo && ultimoPunto && (
          <View style={styles.conteoPanel}>
            <View style={styles.conteoHeader}>
              <View>
                <Text style={styles.conteoTitle}>🌱 Conteo de Plantas</Text>
                <Text style={styles.conteoSubtitle}>
                  📍 Centro: {ultimoPunto.lat.toFixed(5)}, {ultimoPunto.lon.toFixed(5)} · {plantacionPoligono.length} puntos
                </Text>
              </View>
              <TouchableOpacity onPress={cancelarPoligonoPlantacion}>
                <Text style={styles.conteoClose}>✕</Text>
              </TouchableOpacity>
            </View>

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

            <Text style={styles.conteoLabel}>Beneficiario / vereda (opcional):</Text>
            <View style={styles.conteoInputRow}>
              <TextInput
                style={[styles.conteoInputCant, { flex: 1 }]}
                value={plantacionCedula}
                onChangeText={setPlantacionCedula}
                placeholder="Cédula del beneficiario"
                placeholderTextColor={COLORS.textLight}
                keyboardType="numeric"
              />
              <TouchableOpacity style={styles.toolBtn} onPress={buscarBeneficiarioPlantacionPorCedula}>
                <Text style={styles.toolBtnIcon}>🔍</Text>
              </TouchableOpacity>
            </View>
            {!!plantacionBeneficiarioNombre && (
              <Text style={styles.conteoSubtitle}>👤 {plantacionBeneficiarioNombre}</Text>
            )}
            <DropdownPicker
              label="Vereda"
              value={plantacionVereda || null}
              options={veredasPlantacion}
              onSelect={setPlantacionVereda}
              placeholder="Seleccionar vereda (opcional)..."
            />

            <View style={styles.conteoActions}>
              <TouchableOpacity
                style={[styles.conteoSaveBtn, (!cantidadInput || parseInt(cantidadInput) <= 0) && styles.toolBtnDisabled]}
                onPress={guardarConteo}
              >
                <Text style={styles.conteoSaveText}>Guardar área de plantación</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.conteoCancelBtn} onPress={cancelarPoligonoPlantacion}>
                <Text style={styles.conteoCancelText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Barra de herramientas inferior */}
      <View style={[styles.toolbar, { paddingBottom: insets.bottom + SPACING.sm }]}>
        {modo === 'navegar' && (
          <>
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
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => setMostrarModalKML(true)}
            >
              <Text style={styles.toolBtnIcon}>🗺️</Text>
              <Text style={styles.toolBtnLabel}>KML</Text>
            </TouchableOpacity>
          </>
        )}

        {modo === 'medir' && (
          <>
            <View style={styles.toolInfo}>
              <Text style={styles.toolInfoText}>
                {poligono.length} punto(s)
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.toolBtn, centrando && styles.toolBtnDisabled]}
              onPress={centrarUnaVez}
              disabled={centrando}
            >
              <Text style={styles.toolBtnIcon}>🎯</Text>
              <Text style={styles.toolBtnLabel}>{centrando ? 'GPS...' : 'Centrar'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={abrirHistorialMediciones}>
              <Text style={styles.toolBtnLabel}>📋 Historial</Text>
            </TouchableOpacity>
            {poligono.length > 0 && (
              <>
                <TouchableOpacity style={styles.toolBtn} onPress={deshacerUltimoPunto}>
                  <Text style={styles.toolBtnLabel}>↩ Deshacer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolBtn, styles.toolBtnPrimary]}
                  onPress={calcularMedicion}
                >
                  <Text style={styles.toolBtnLabelPrimary}>Calcular</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toolBtn} onPress={limpiarPoligono}>
                  <Text style={styles.toolBtnLabel}>✕ Limpiar</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {modo === 'contar' && (
          <>
            <View style={styles.toolInfo}>
              <Text style={styles.toolInfoText}>
                {plantacionPoligono.length > 0
                  ? `${plantacionPoligono.length} punto(s) · ${plantaciones.length} registro(s)`
                  : `${plantaciones.length} registro(s) guardados`}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.toolBtn, centrando && styles.toolBtnDisabled]}
              onPress={centrarUnaVez}
              disabled={centrando}
            >
              <Text style={styles.toolBtnIcon}>🎯</Text>
              <Text style={styles.toolBtnLabel}>{centrando ? 'GPS...' : 'Centrar'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={abrirHistorialPlantaciones}>
              <Text style={styles.toolBtnLabel}>📋 Historial</Text>
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
                    {plantacionPoligono.length < 3 ? `Mín. 3 pts (${plantacionPoligono.length})` : '✅ Finalizar área'}
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
          </>
        )}

        {modo === 'ruta' && (
          <>
            <View style={styles.toolInfo}>
              <Text style={styles.toolInfoText}>
                {tracking.activo
                  ? tracking.pausado
                    ? `⏸ Pausada · ${tracking.posiciones.length} pts · ${tracking.distanceKm.toFixed(2)} km`
                    : `🟢 ${tracking.posiciones.length} pts · ${tracking.distanceKm.toFixed(2)} km`
                  : '⏹ Tracking detenido'}
              </Text>
            </View>
            {!tracking.activo ? (
              <>
                <TouchableOpacity
                  style={[styles.toolBtn, styles.toolBtnPrimary]}
                  onPress={tracking.iniciarTracking}
                >
                  <Text style={styles.toolBtnLabelPrimary}>▶ Iniciar Ruta</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toolBtn} onPress={abrirHistorialRutas}>
                  <Text style={styles.toolBtnLabel}>📋 Historial</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {tracking.inicio && (
                  <View style={styles.toolInfoSmall}>
                    <Text style={styles.toolInfoTextSmall}>
                      {Math.floor(
                        (Date.now() - new Date(tracking.inicio).getTime()) / 60000
                      )}{' '}
                      min
                    </Text>
                  </View>
                )}
                {tracking.pausado ? (
                  <TouchableOpacity
                    style={[styles.toolBtn, styles.toolBtnPrimary]}
                    onPress={tracking.reanudarTracking}
                  >
                    <Text style={styles.toolBtnLabelPrimary}>▶ Reanudar</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.toolBtn} onPress={tracking.pausarTracking}>
                    <Text style={styles.toolBtnLabel}>⏸ Pausar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.toolBtn, { backgroundColor: COLORS.error }]}
                  onPress={tracking.detenerTracking}
                >
                  <Text style={styles.toolBtnLabelPrimary}>⏹ Detener</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </View>

      {/* Modal KML */}
      <Modal visible={mostrarModalKML} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🗺️ Importar / Exportar KML</Text>
            <TouchableOpacity style={styles.modalBtn} onPress={handleExportarKML}>
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
          </View>
        </View>
      </Modal>

      {/* Modal: Historial de Rutas */}
      <Modal visible={mostrarHistorialRutas} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.modalContentHistorial]}>
            <Text style={styles.modalTitle}>📋 Historial de Rutas</Text>
            {cargandoHistorialRutas ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginVertical: SPACING.lg }} />
            ) : sesionesRuta.length === 0 ? (
              <Text style={styles.emptyPacksText}>
                Todavía no tienes rutas guardadas. Inicia una ruta y detenla para que quede aquí.
              </Text>
            ) : (
              <ScrollView style={styles.historialScroll}>
                {sesionesRuta.map((s) => (
                  <View key={s.sesionId} style={styles.historialItem}>
                    <View style={styles.historialItemInfo}>
                      <Text style={styles.historialItemFecha}>
                        {new Date(s.inicio).toLocaleDateString('es-CO')} ·{' '}
                        {new Date(s.inicio).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                      <Text style={styles.historialItemDetalle}>
                        {s.totalPuntos} pts · {s.distanciaKm.toFixed(2)} km
                      </Text>
                    </View>
                    <View style={styles.historialItemAcciones}>
                      <TouchableOpacity onPress={() => verRutaPreview(s.sesionId)} style={styles.historialAccionBtn}>
                        <Text style={styles.historialAccionIcono}>👁</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => exportarSesionRuta(s)}
                        style={styles.historialAccionBtn}
                        disabled={exportandoSesionId === s.sesionId}
                      >
                        {exportandoSesionId === s.sesionId ? (
                          <ActivityIndicator size="small" color={COLORS.primary} />
                        ) : (
                          <Text style={styles.historialAccionIcono}>📤</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setMostrarHistorialRutas(false)}
            >
              <Text style={styles.modalBtnTextCancel}>Cerrar</Text>
            </TouchableOpacity>
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
                Todavía no tienes mediciones guardadas. Marca un área o distancia y presiona &quot;Calcular&quot;.
              </Text>
            ) : (
              <ScrollView style={styles.historialScroll}>
                {medicionesGuardadas.map((m) => (
                  <View key={m.id} style={styles.historialItem}>
                    <View style={styles.historialItemInfo}>
                      <Text style={styles.historialItemFecha}>
                        {m.created_at ? new Date(m.created_at).toLocaleDateString('es-CO') : '—'} ·{' '}
                        {m.created_at ? new Date(m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </Text>
                      <Text style={styles.historialItemDetalle}>
                        {m.area_hectareas > 0
                          ? `📐 ${m.area_hectareas} ha · ${(m.puntos || []).length} pts`
                          : `📏 ${(m.perimetro_metros || 0).toFixed(1)} m (distancia)`}
                      </Text>
                    </View>
                    <View style={styles.historialItemAcciones}>
                      <TouchableOpacity onPress={() => verMedicionPreview(m)} style={styles.historialAccionBtn}>
                        <Text style={styles.historialAccionIcono}>👁</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => eliminarMedicionGuardada(m.id)}
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

      {/* Modal: Historial de Plantaciones */}
      <Modal visible={mostrarHistorialPlantaciones} transparent animationType="fade">
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
                      <TouchableOpacity onPress={() => verPlantacionEnMapa(pl)} style={styles.historialAccionBtn}>
                        <Text style={styles.historialAccionIcono}>👁</Text>
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
                      {pack.metadata?.tipo === 'satelite' ? '🛰️ Satélite' : '🗺️ Relieve'} · Descargado: {formatearFechaPack(pack.metadata?.creado)}
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
  // --- Selector de modo ---
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
  modeBtnActive: {
    backgroundColor: COLORS.primary + '20',
    borderWidth: 1,
    borderColor: COLORS.primary,
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
  modeBtnActiveRuta: {
    backgroundColor: '#1B5E20' + '20',
    borderWidth: 1,
    borderColor: '#1B5E20',
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
    maxHeight: 300,
    ...SHADOWS.lg,
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
    ...SHADOWS.sm,
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
    flex: 1,
  },
  toolInfoText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  toolInfoSmall: {
    marginRight: SPACING.sm,
  },
  toolInfoTextSmall: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
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
  // --- Historial de rutas ---
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
  historialItemFecha: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  historialItemDetalle: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
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
