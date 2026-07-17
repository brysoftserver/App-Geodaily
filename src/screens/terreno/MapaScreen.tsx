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
import { calcularArea, exportarKML, importarKML } from '../../services/kml.service';
import { savePlantacion, saveMedicion, getPlantaciones } from '../../services/database';
import { isOfflineMapAvailable, descargarMapaOffline, listarPaquetesOffline, eliminarPaqueteOffline, OfflinePackInfo } from '../../services/offlineMap.service';
import { Plantacion, Coordenadas, PuntoPoligono } from '../../types';
import { PLANTAS_OPCIONES, getIconoEspecie } from '../../utils/constants';

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

  // Seguir al usuario si el modo siguiendo está activo
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

  // --- Estado para Plantaciones (Fase B) ---
  const [plantaciones, setPlantaciones] = useState<Plantacion[]>([]);

  // --- Estado para KML ---
  const [mostrarModalKML, setMostrarModalKML] = useState(false);

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
          text: '📍 Puerto Rico, Caquetá (zona de trabajo)',
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
  }, [mapCenter, userLocation, ejecutarDescarga]);

  // --- Persistencia automática: guardar al salir, restaurar al entrar ---
  const guardarEstadoMapa = useCallback(async () => {
    try {
      const estado = {
        poligono,
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
  }, [poligono, resultadoArea, resultadoDistancia, mostrarResultado, ultimoPunto, modo, tipoMapa, mapCenter, userLocation]);

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
    if (poligono.length === 2) {
      // Distancia lineal entre 2 puntos
      const d = calcularDistanciaHaversine(poligono[0], poligono[1]);
      setResultadoDistancia({ distanciaMetros: d, distanciaKm: d / 1000 });
      setResultadoArea(null);
    } else {
      // Área (3+ puntos)
      const area = calcularArea(poligono);
      setResultadoArea(area);
      setResultadoDistancia(null);
      // Persistir medición en SQLite
      saveMedicion({
        id: `med_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantaSeleccionada, cantidadInput, ultimoPunto, userLocation, user?.id, plantacionPoligono]);

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

  const handleImportarKML = useCallback(async () => {
    try {
      const result = await importarKML(''); // eslint-disable-line @typescript-eslint/no-unused-vars
      // Note: real implementation would use DocumentPicker
      Alert.alert(
        'Importar KML',
        'Selecciona un archivo .kml desde el explorador de archivos del dispositivo.'
      );
      setMostrarModalKML(false);
    } catch (error) {
      console.warn('[Mapa] Error al importar KML:', error);
    }
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
    },
    []
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
            // Puntos del polígono de medición
            ...poligono.map((p) => ({
              id: `p_${p.orden}`,
              latitud: p.latitud,
              longitud: p.longitud,
              title: `Punto ${p.orden}`,
              color: modo === 'medir' ? COLORS.secondary : COLORS.primary,
            })),
            // Puntos del polígono de plantación (conteo)
            ...plantacionPoligono.map((p) => ({
              id: `pp_${p.orden}`,
              latitud: p.latitud,
              longitud: p.longitud,
              title: `Área punto ${p.orden}`,
              color: '#2E7D32',
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
              icon: (pl.icono || '🌱') as '🌱' | '�' | '🌳',
            })),
          ]}
          polyline={modo === 'ruta' ? tracking.posiciones.map(p => ({ latitud: p.latitud, longitud: p.longitud })) : undefined}
          startMarker={modo === 'ruta' && tracking.posiciones.length > 0 ? { latitud: tracking.posiciones[0].latitud, longitud: tracking.posiciones[0].longitud } : undefined}
          endMarker={modo === 'ruta' && tracking.posiciones.length > 0 ? { latitud: tracking.posiciones[tracking.posiciones.length - 1].latitud, longitud: tracking.posiciones[tracking.posiciones.length - 1].longitud } : undefined}
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
        />

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
                  ? `🟢 ${tracking.posiciones.length} pts · ${tracking.distanceKm.toFixed(2)} km`
                  : '⏹ Tracking detenido'}
              </Text>
            </View>
            {!tracking.activo ? (
              <TouchableOpacity
                style={[styles.toolBtn, styles.toolBtnPrimary]}
                onPress={tracking.iniciarTracking}
              >
                <Text style={styles.toolBtnLabelPrimary}>▶ Iniciar Ruta</Text>
              </TouchableOpacity>
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
                  <Text style={styles.packName} numberOfLines={1}>{pack.name}</Text>
                  <TouchableOpacity onPress={() => handleEliminarPaquete(pack.name)}>
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
  packName: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    marginRight: SPACING.sm,
  },
  packDeleteIcon: {
    fontSize: 18,
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
