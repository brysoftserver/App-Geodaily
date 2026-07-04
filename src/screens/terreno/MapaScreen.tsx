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
  ScrollView,
  TextInput,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import * as Location from 'expo-location';
import { useLocation } from '../../hooks/useLocation';
import { useTrackingContext } from '../../store/TrackingContext';
import { useAuth } from '../../store/AuthContext';
import MapViewOffline from '../../components/MapViewOffline';
import { calcularArea, exportarKML, importarKML } from '../../services/kml.service';
import { savePlantacion, getPlantaciones } from '../../services/database';
import { Plantacion, Coordenadas } from '../../types';

const STORAGE_KEY_MAP = '@geodaily/mapa_estado';

type ModoMapa = 'navegar' | 'medir' | 'contar' | 'ruta';

interface PuntoPoligono {
  latitud: number;
  longitud: number;
  orden: number;
}

interface EspecieConteo {
  nombre: string;
  cantidad: string;
}

const MapaScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { coordenadas, getCurrentPosition, isLoading: gpsLoading } = useLocation();
  const { user } = useAuth();
  const tracking = useTrackingContext();
  const [modo, setModo] = useState<ModoMapa>('navegar');
  const [ultimoPunto, setUltimoPunto] = useState<{ lat: number; lon: number } | null>(null);

  // --- Centro del mapa estable (NO se reinicia con GPS) ---
  const [mapCenter, setMapCenter] = useState<Coordenadas | undefined>(undefined);
  const mapCenterInitialized = useRef(false);
  useEffect(() => {
    if (coordenadas && !mapCenterInitialized.current) {
      setMapCenter({ latitud: coordenadas.latitud, longitud: coordenadas.longitud } as Coordenadas);
      mapCenterInitialized.current = true;
    }
  }, [coordenadas]);

  // GPS siempre activo: watch continuo desde que monta la pantalla
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 },
        (newPos) => {
          const { latitude, longitude } = newPos.coords;
          const pos: Coordenadas = { latitud: latitude, longitud: longitude };
          setUserLocation(pos);
          // Si estamos en modo siguiendo, actualizar el centro
          if (siguiendoRef.current) {
            setMapCenter(pos);
          }
        }
      );
      watchRef.current = sub;
    })();
    return () => {
      if (watchRef.current) {
        watchRef.current.remove();
        watchRef.current = null;
      }
    };
  }, []);

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

  // --- Estado para Conteo (rediseñado: dropdown + icono por planta) ---
  const [mostrarPanelConteo, setMostrarPanelConteo] = useState(false);
  const [plantaSeleccionada, setPlantaSeleccionada] = useState<string>('Cacao');
  const [cantidadInput, setCantidadInput] = useState<string>('');
  const PLANTAS_OPCIONES = [
    { nombre: 'Cacao', icono: '🍫' },
    { nombre: 'Plátano', icono: '🍌' },
    { nombre: 'Abarco / Cedro / Caucho', icono: '🌳' },
  ];
  const getIconoFromNombre = (nombre: string): string =>
    PLANTAS_OPCIONES.find((p) => p.nombre === nombre)?.icono || '🌱';

  // --- Estado para Plantaciones (Fase B) ---
  const [plantaciones, setPlantaciones] = useState<Plantacion[]>([]);

  // --- Estado para KML ---
  const [mostrarModalKML, setMostrarModalKML] = useState(false);

  // --- Tipo de mapa: relieve (CartoDB) o satélite ---
  const [tipoMapa, setTipoMapa] = useState<'relieve' | 'satelite'>('relieve');

  // --- Seguimiento GPS continuo ---
  const [siguiendoGPS, setSiguiendoGPS] = useState(false);
  const siguiendoRef = useRef(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  /** Posición GPS real, siempre actualizada por el watch */
  const [userLocation, setUserLocation] = useState<Coordenadas | undefined>(undefined);

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
        ultimasCoords: coordenadas,
      };
      await AsyncStorage.setItem(STORAGE_KEY_MAP, JSON.stringify(estado));
    } catch (e) {
      console.warn('[Mapa] Error al guardar estado:', e);
    }
  }, [poligono, resultadoArea, resultadoDistancia, mostrarResultado, ultimoPunto, modo, tipoMapa, mapCenter, coordenadas]);

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
    const coords = await getCurrentPosition();
    if (coords) {
      setMapCenter({ latitud: coords.latitud, longitud: coords.longitud } as Coordenadas);
    } else if (userLocation) {
      setMapCenter(userLocation);
    }
    setSiguiendoGPS(true);
    siguiendoRef.current = true;
    setUltimoPunto(null);
  }, [getCurrentPosition, userLocation]);

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
        // Abre panel con punto seleccionado
        setPlantaSeleccionada('Cacao');
        setCantidadInput('');
        setMostrarPanelConteo(true);
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
    }
    setMostrarResultado(true);
  }, [poligono, calcularDistanciaHaversine]);

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

  // --- Funciones de Conteo (rediseñado: dropdown + icono por planta) ---
  const guardarConteo = useCallback(async () => {
    const cantidad = parseInt(cantidadInput);
    if (!cantidad || cantidad <= 0) {
      Alert.alert('Cantidad inválida', 'Ingresa un número válido de plantas.');
      return;
    }
    const latitud = ultimoPunto?.lat ?? coordenadas?.latitud ?? 0;
    const longitud = ultimoPunto?.lon ?? coordenadas?.longitud ?? 0;
    if (!latitud || !longitud) {
      Alert.alert('Sin ubicación', 'Toca el mapa para seleccionar un punto.');
      return;
    }
    const icono = getIconoFromNombre(plantaSeleccionada);
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
    };
    await savePlantacion(plantacion);
    setPlantaciones((prev) => [...prev, plantacion]);
    Alert.alert('✅ Conteo guardado', `${plantaSeleccionada}: ${cantidad} plantas\n${icono} Marcador agregado al mapa`);
    setCantidadInput('');
    setMostrarPanelConteo(false);
    setUltimoPunto(null);
  }, [plantaSeleccionada, cantidadInput, ultimoPunto, coordenadas, user?.id]);

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
      const result = await importarKML('');
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
          center={mapCenter ?? coordenadas ?? undefined}
          zoom={15}
          height={'100%'}
          mapStyle={tipoMapa}
          markers={[
            ...poligono.map((p) => ({
              id: `p_${p.orden}`,
              latitud: p.latitud,
              longitud: p.longitud,
              title: `Punto ${p.orden}`,
              color: modo === 'medir' ? COLORS.secondary : COLORS.primary,
            })),
            ...plantaciones.map((pl) => ({
              id: pl.id,
              latitud: pl.latitud,
              longitud: pl.longitud,
              title: `${pl.especie}: ${pl.cantidad} plantas`,
              icon: (pl.icono || '🌱') as '🌱' | '🍫' | '🍌' | '🌳',
            })),
          ]}
          polyline={modo === 'ruta' ? tracking.posiciones.map(p => ({ latitud: p.latitud, longitud: p.longitud })) : undefined}
          startMarker={modo === 'ruta' && tracking.posiciones.length > 0 ? { latitud: tracking.posiciones[0].latitud, longitud: tracking.posiciones[0].longitud } : undefined}
          endMarker={modo === 'ruta' && tracking.posiciones.length > 0 ? { latitud: tracking.posiciones[tracking.posiciones.length - 1].latitud, longitud: tracking.posiciones[tracking.posiciones.length - 1].longitud } : undefined}
          showUserLocation={true}
          userLocation={userLocation}
          interactive={true}
          onMapPress={handleMapPress}
        />

        {/* Overlay de coordenadas */}
        {ultimoPunto && (
          <View style={styles.coordsOverlay}>
            <Text style={styles.coordsLabel}>
              {modo === 'medir' ? `Punto #${poligono.length}` : 'Coordenadas'}
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

        {/* Panel de Conteo (rediseñado: dropdown + icono por planta) */}
        {mostrarPanelConteo && ultimoPunto && (
          <View style={styles.conteoPanel}>
            <View style={styles.conteoHeader}>
              <View>
                <Text style={styles.conteoTitle}>🌱 Conteo de Plantas</Text>
                <Text style={styles.conteoSubtitle}>
                  📍 {ultimoPunto.lat.toFixed(5)}, {ultimoPunto.lon.toFixed(5)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => { setMostrarPanelConteo(false); setUltimoPunto(null); }}>
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
                Vista previa: {getIconoFromNombre(plantaSeleccionada)} {plantaSeleccionada}
              </Text>
            </View>

            <View style={styles.conteoActions}>
              <TouchableOpacity
                style={[styles.conteoSaveBtn, (!cantidadInput || parseInt(cantidadInput) <= 0) && styles.toolBtnDisabled]}
                onPress={guardarConteo}
              >
                <Text style={styles.conteoSaveText}>Guardar en este punto</Text>
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
              style={[styles.toolBtn, siguiendoGPS && styles.toolBtnActive, gpsLoading && styles.toolBtnDisabled]}
              onPress={centrarEnGPS}
              disabled={gpsLoading}
            >
              <Text style={styles.toolBtnIcon}>📍</Text>
              <Text style={styles.toolBtnLabel}>
                {gpsLoading ? 'GPS...' : siguiendoGPS ? '🟢 Siguiendo' : 'Mi Ubicación'}
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
                {plantaciones.length} registro(s) guardados
              </Text>
            </View>
            {!mostrarPanelConteo && (
              <TouchableOpacity
                style={[styles.toolBtn, styles.toolBtnPrimary]}
                onPress={() => Alert.alert('🌱 Modo Conteo', 'Toca el mapa en el lugar donde quieras registrar las plantas.' )}
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
});

export default MapaScreen;
