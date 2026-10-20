// ============================================================
// MapaGeneralScreen — Mapa multi-rol con todos los datos
// Plantaciones, tracking de técnicos y mediciones de terreno
// MEJORADO: GPS Context, AppState polling, componentes extraídos,
// cache de veredas, anclado a Puerto Rico, clustering
// ============================================================

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Modal,
} from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapViewOffline, { esCoordenadaValida } from '../components/MapViewOffline';
import MapLayerToggle from '../components/mapa/MapLayerToggle';
import MapTecnicosSelector from '../components/mapa/MapTecnicosSelector';
import type { TecnicoFiltro } from '../components/mapa/MapTecnicosSelector';
import MapToolbar from '../components/mapa/MapToolbar';
import type { MapBaseStyle } from '../components/mapa/MapToolbar';
import MapItemDetailCard from '../components/mapa/MapItemDetailCard';
import MapItemList from '../components/mapa/MapItemList';
import VeredaDetailCard from '../components/mapa/VeredaDetailCard';
import { useAuth } from '../store/AuthContext';
import { useGPS } from '../store/GPSContext';
import { useSyncMapData } from '../hooks/useSyncMapData';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import apiClient from '../services/api';
import { Coordenadas } from '../types';
import { getIconoEspecie } from '../utils/constants';
import { normalizarVereda } from '../utils/corregimientos';
import { getTecnicos } from '../services/admin.service';
import {
  saveVeredasCache,
  getVeredasCache,
  removeVeredaFromCache,
} from '../services/database';

// ============================================================
// PUERTO RICO, CAQUETÁ — Centro del mapa
// ============================================================
const PUERTO_RICO_CENTER = { latitud: 1.914, longitud: -75.145 };
const ZOOM_MUNICIPIO = 13;
const ZOOM_UBICACION = 15;
const POLLING_INTERVAL_MS = 30000; // 30s

type CapaActiva = 'plantaciones' | 'tecnicos' | 'mediciones' | 'veredas';

/**
 * FEATURE FLAG — Capa de plantaciones.
 *
 * El conteo de plantaciones se usará en formularios futuros, así que por
 * ahora se OCULTA del mapa general (capa, pines, polígonos y listados).
 * El código de la capa sigue intacto: para reactivarla basta con poner
 * esta constante en `true`.
 */
const MOSTRAR_CAPA_PLANTACIONES = false;

// NOTA: getIconoEspecie se importa de utils/constants (source of truth única)

const MapaGeneralScreen: React.FC<{ navigation?: Record<string, any> }> = ({ navigation: _navigation }) => {
  const insets = useSafeAreaInsets();
  const { user, isAdmin, isCoordinador, isInterventor, isGerente } = useAuth();
  const { userLocation, getCurrentPosition, siguiendo, setSiguiendo } = useGPS();
  const canViewAll = isAdmin || isCoordinador || isInterventor || isGerente;

  const {
    plantaciones,
    posiciones,
    mediciones,
    loading,
    syncing,
    loadAll,
    syncAll,
    fetchUltimasPosiciones,
    fetchAllPlantaciones,
    fetchAllMediciones,
    eliminarPlantacion,
    eliminarMedicion,
  } = useSyncMapData();

  // --- Estado del mapa ---
  // FIX b: 'mediciones' viene activa por defecto — antes el usuario solo veía
  // una capa (plantaciones) y creía que el mapa estaba vacío.
  const [capasActivas, setCapasActivas] = useState<Set<CapaActiva>>(
    new Set(
      MOSTRAR_CAPA_PLANTACIONES
        ? ['plantaciones', 'tecnicos', 'mediciones']
        : ['tecnicos', 'mediciones']
    )
  );
  // Selector de mapa base: solo dos opciones — 'terreno' (curvas de nivel,
  // drenajes, vías) y 'satelite' (Sentinel-2 2025, imagen reciente). Se
  // eliminaron 'relieve' (gris de referencia, poco útil en zona rural) y
  // 'reciente' (se fusionó con 'satelite').
  const [mapStyle, setMapStyle] = useState<MapBaseStyle>('satelite');
  // FIX a: nonce para forzar un reset real de cámara (botón "Puerto Rico").
  const [resetNonce, setResetNonce] = useState(0);
  // Recentrado puntual sin tocar el zoom (botón "Centrar" del mapa general).
  // Antes, centrar reimponía ZOOM_UBICACION y borraba el zoom que el usuario
  // acababa de ajustar para revisar los polígonos.
  const [recentrarNonce, setRecentrarNonce] = useState(0);
  const [veredasFeatures, setVeredasFeatures] = useState<Record<string, any>[] | null>(null);
  const [selectedItem, setSelectedItem] = useState<Record<string, any> | null>(null);
  const [selectedVereda, setSelectedVereda] = useState<Record<string, any> | null>(null);
  // Confirmación de borrado con Modal propio (Alert.alert con botones NO
  // funciona en Expo web, por eso no se usa aquí).
  const [confirmarEliminar, setConfirmarEliminar] = useState<{ tipo: 'plantación' | 'medición' | 'vereda'; id: string; nombre?: string } | null>(null);
  const [showList, setShowList] = useState(false);
  const [mapCenter, setMapCenter] = useState<Coordenadas>(PUERTO_RICO_CENTER);
  const [mapZoom, setMapZoom] = useState(ZOOM_MUNICIPIO);
  const [locating, setLocating] = useState(false);
  const [veredasLoading, setVeredasLoading] = useState(false);
  // El técnico abre el mapa en SU ubicación (no en Puerto Rico ni en el
  // centro por defecto de Leaflet/MapLibre, que era Bogotá). Se hace una
  // sola vez por montaje: si después el usuario mueve el mapa, no se vuelve
  // a recentrar solo.
  const autoCentradoRef = useRef(false);

  // --- Filtro por técnico (capa "Mediciones") ---
  // `tecnicosSeleccionados` guarda los usuario_id cuyas mediciones se
  // dibujan en el mapa. Al activar "Mediciones" se seleccionan TODOS; al
  // desactivarla se limpian. Cada chip del selector alterna uno individual.
  const [tecnicosSeleccionados, setTecnicosSeleccionados] = useState<Set<string>>(new Set());
  // Bandera "Todos": cuando está activa, cualquier técnico nuevo que aparezca
  // (p. ej. al terminar de cargar la lista) queda seleccionado.
  const [filtroTodos, setFiltroTodos] = useState(false);
  // Lista de técnicos del backend (nombre + id). Si no hay red se deriva de
  // las mediciones/posiciones locales para no dejar el selector vacío.
  const [tecnicosBackend, setTecnicosBackend] = useState<{ id: string; nombre: string }[]>([]);
  // nonce para encuadrar el mapa en las mediciones de los técnicos elegidos.
  const [fitNonce, setFitNonce] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const siguiendoRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>('active');

  // Mantener ref sincronizada con el estado
  useEffect(() => {
    siguiendoRef.current = siguiendo;
  }, [siguiendo]);

  // ============================================================
  // Carga inicial
  // ============================================================
  useEffect(() => {
    loadAll();
    syncAll();
    // Cargar veredas (desde cache si es fresco)
    cargarVeredas();
    // Lista de técnicos para el selector de mediciones
    cargarTecnicos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Polling adaptativo con AppState
  // ============================================================
  const iniciarPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    // Solo si hay capas que requieran datos del servidor
    if (!capasActivas.has('tecnicos') && !capasActivas.has('plantaciones') && !capasActivas.has('mediciones')) {
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(() => {
      if (appStateRef.current !== 'active') return; // Pausado si no está en foreground
      if (capasActivas.has('tecnicos')) fetchUltimasPosiciones();
      if (capasActivas.has('plantaciones')) fetchAllPlantaciones();
      if (capasActivas.has('mediciones')) fetchAllMediciones();
    }, POLLING_INTERVAL_MS);
  }, [capasActivas, fetchUltimasPosiciones, fetchAllPlantaciones, fetchAllMediciones]);

  // Escuchar cambios de AppState para pausar/reanudar polling
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        // Al volver a foreground, refrescar datos inmediatamente
        if (capasActivas.has('tecnicos')) fetchUltimasPosiciones();
        if (capasActivas.has('plantaciones')) fetchAllPlantaciones();
        if (capasActivas.has('mediciones')) fetchAllMediciones();
      }
    });
    return () => sub.remove();
  }, [capasActivas, fetchUltimasPosiciones, fetchAllPlantaciones, fetchAllMediciones]);

  // Iniciar/refrescar polling cuando cambian capas
  useEffect(() => {
    iniciarPolling();
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [iniciarPolling]);

  // ============================================================
  // Veredas: cache local + servidor
  // ============================================================
  const cargarVeredas = useCallback(async () => {
    setVeredasLoading(true);
    try {
      // 1. Mostrar el cache local de inmediato (si existe) para que el mapa
      //    no parpadee. NO se retorna aquí: aunque el cache esté fresco,
      //    SIEMPRE se revalida contra el servidor. Antes, un cache fresco
      //    (<24h) evitaba la consulta y las veredas que el admin había
      //    ocultado seguían apareciendo hasta que el cache expiraba.
      const cache = await getVeredasCache();
      if (cache.veredas.length > 0) {
        setVeredasFeatures(cache.veredas);
      }

      // 2. Descargar del servidor (fuente de verdad, ya con las exclusiones
      //    aplicadas). Antes usaba `fetch` crudo SIN cabecera Authorization:
      //    el endpoint exige token, devolvía 401, y como solo se miraba
      //    `res.ok` fallaba en silencio.
      const resp = await apiClient.get('/api/maps/veredas', { timeout: 20000 });
      {
        const data = resp.data;
        if (data?.veredas) {
          const features = data.veredas.map((v: Record<string, any>) => ({
            ...v,
            geometry: v.geometry || { type: 'MultiPolygon', coordinates: [] },
          }));
          setVeredasFeatures(features);
          // Guardar en cache local (ya sin las veredas excluidas)
          await saveVeredasCache(features, data.fuente || 'overpass');
        }
      }
    } catch (err) {
      console.warn('[MapaGeneral] Error al cargar veredas:', err);
      // 3. Fallback: cache local aunque esté vencido (modo offline)
      const cache = await getVeredasCache();
      if (cache.veredas.length > 0) {
        setVeredasFeatures(cache.veredas);
      }
    } finally {
      setVeredasLoading(false);
    }
  }, []);

  // ============================================================
  // Técnicos: lista para el selector de mediciones
  // ============================================================
  const cargarTecnicos = useCallback(async () => {
    try {
      const lista = await getTecnicos();
      if (Array.isArray(lista) && lista.length > 0) {
        setTecnicosBackend(
          lista
            .filter((t) => t.activo !== false)
            .map((t) => ({ id: String(t.id), nombre: t.nombre || t.usuario || 'Técnico' }))
        );
      }
    } catch (err) {
      // Sin red: el selector se arma con los usuario_id de las mediciones
      // locales (ver `tecnicosFiltro`), así el filtro sigue funcionando.
      console.warn('[MapaGeneral] No se pudo cargar la lista de técnicos:', err);
    }
  }, []);

  // ============================================================
  // Navegación: centrar en ubicación / reset
  // ============================================================
  const centrarEnMiUbicacion = useCallback(async () => {
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
        setMapCenter({ latitud: coords.latitud, longitud: coords.longitud });
        setMapZoom(ZOOM_UBICACION);
        setSiguiendo(true);
        setRecentrarNonce((n) => n + 1);
      } else {
        // Fallback: última conocida del sistema
        const last = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
        if (last) {
          setMapCenter({ latitud: last.coords.latitude, longitud: last.coords.longitude });
          setMapZoom(ZOOM_UBICACION);
          setSiguiendo(true);
          setRecentrarNonce((n) => n + 1);
        } else {
          Alert.alert(
            '📍 Sin ubicación',
            'No se pudo obtener la ubicación GPS.\nVerifica que el GPS esté activado y tengas conexión con los satélites.'
          );
        }
      }
    } finally {
      setLocating(false);
    }
  }, [getCurrentPosition, setSiguiendo, userLocation]);

  const detenerSeguimiento = useCallback(() => {
    setSiguiendo(false);
    setMapCenter(PUERTO_RICO_CENTER);
    setMapZoom(ZOOM_MUNICIPIO);
    // FIX a: fuerza el reset aunque el usuario haya hecho zoom/pan manual.
    setResetNonce((n) => n + 1);
  }, [setSiguiendo]);

  // Efecto: si siguiendo y hay userLocation, actualizar centro.
  // FIX a: solo recentra cuando la posición cambia de verdad (> ~5 m). Antes
  // cada lectura GPS (cada segundo) creaba un objeto nuevo → setMapCenter →
  // re-render → setView → el zoom volvía a ZOOM_UBICACION y se perdía el
  // zoom que el técnico acababa de hacer.
  const lastFollowRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!siguiendo || !userLocation) return;
    const prev = lastFollowRef.current;
    const moved =
      !prev ||
      Math.abs(prev.lat - userLocation.latitud) > 0.00005 ||
      Math.abs(prev.lng - userLocation.longitud) > 0.00005;
    if (!moved) return;
    lastFollowRef.current = { lat: userLocation.latitud, lng: userLocation.longitud };
    setMapCenter({ latitud: userLocation.latitud, longitud: userLocation.longitud });
    setMapZoom((prevZoom) => (prevZoom < ZOOM_UBICACION ? ZOOM_UBICACION : prevZoom));
  }, [siguiendo, userLocation]);

  // ============================================================
  // Centrado inicial en la ubicación del usuario
  // ============================================================
  // Antes el mapa abría siempre en PUERTO_RICO_CENTER (y, si el centro aún
  // no estaba listo, Leaflet/MapLibre caían en su default = Bogotá). Para el
  // técnico en campo eso significaba abrir el mapa a ~300 km de donde está.
  // Ahora, en el primer montaje:
  //   1) Si el watch global ya tiene una posición reciente (<5 min), se usa.
  //   2) Si no, se pide una posición puntual (getCurrentPosition).
  //   3) Si falla, se usa la última conocida del sistema.
  //   4) Si tampoco hay, se queda en Puerto Rico (comportamiento anterior).
  // Todo es local (GPS del teléfono): funciona sin internet.
  useEffect(() => {
    if (autoCentradoRef.current) return;
    let cancelado = false;

    const aplicar = (lat: number, lng: number) => {
      if (cancelado || autoCentradoRef.current) return;
      autoCentradoRef.current = true;
      setMapCenter({ latitud: lat, longitud: lng });
      setMapZoom(ZOOM_UBICACION);
      setSiguiendo(true);
    };

    (async () => {
      // 1) Posición viva del watch global
      const edadMs = userLocation?.timestamp
        ? Date.now() - new Date(userLocation.timestamp).getTime()
        : Infinity;
      if (userLocation && edadMs < 300000) {
        aplicar(userLocation.latitud, userLocation.longitud);
        return;
      }

      // 2) Fix puntual
      try {
        const coords = await getCurrentPosition();
        if (coords) {
          aplicar(coords.latitud, coords.longitud);
          return;
        }
      } catch { /* sigue al fallback */ }

      // 3) Última conocida del sistema (funciona sin red)
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 600000 });
        if (last) {
          aplicar(last.coords.latitude, last.coords.longitude);
        }
      } catch { /* se queda en Puerto Rico */ }
    })();

    return () => { cancelado = true; };
    // Solo en el primer montaje: `userLocation` se lee como valor inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si el watch global entrega la primera posición DESPUÉS del montaje y el
  // mapa todavía no se ha centrado (p. ej. el fix puntual falló), se usa esa
  // posición en cuanto llegue.
  useEffect(() => {
    if (autoCentradoRef.current || !userLocation) return;
    autoCentradoRef.current = true;
    setMapCenter({ latitud: userLocation.latitud, longitud: userLocation.longitud });
    setMapZoom(ZOOM_UBICACION);
    setSiguiendo(true);
  }, [userLocation]);

  // --- Lista de técnicos para el selector (chips horizontales) ---
  // Se arma con la lista del backend y se completa con los usuario_id que
  // aparezcan en las mediciones locales (offline) para que nunca falte nadie.
  const tecnicosFiltro: TecnicoFiltro[] = useMemo(() => {
    const mapa = new Map<string, TecnicoFiltro>();
    // 1) Técnicos del backend (nombre oficial)
    tecnicosBackend.forEach((t) => {
      mapa.set(t.id, { id: t.id, nombre: t.nombre, conteo: 0 });
    });
    // 2) Conteo de mediciones por técnico + técnicos que solo existen en local
    mediciones.forEach((m: Record<string, any>) => {
      const id = m.usuario_id != null ? String(m.usuario_id) : '';
      if (!id) return;
      const existente = mapa.get(id);
      if (existente) {
        existente.conteo += 1;
      } else {
        mapa.set(id, {
          id,
          nombre: m.usuario_nombre || `Técnico ${id.slice(0, 6)}`,
          conteo: 1,
        });
      }
    });
    // 3) Orden alfabético por nombre
    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [tecnicosBackend, mediciones]);

  // ============================================================
  // Toggle de capas
  // ============================================================
  const toggleCapa = useCallback(
    (capa: CapaActiva) => {
      const activando = !capasActivas.has(capa);
      setCapasActivas((prev) => {
        const next = new Set(prev);
        if (next.has(capa)) next.delete(capa);
        else next.add(capa);
        return next;
      });
      if (activando) {
        setTimeout(() => {
          if (capa === 'tecnicos') fetchUltimasPosiciones();
          if (capa === 'plantaciones') fetchAllPlantaciones();
          if (capa === 'mediciones') fetchAllMediciones();
          if (capa === 'veredas') cargarVeredas();
        }, 100);
      }
      // Regla del filtro por técnico: al activar "Mediciones" se muestran
      // TODOS los técnicos; al desactivarla se quitan todos. Después de eso
      // el usuario puede seleccionar/deseleccionar técnicos uno a uno.
      if (capa === 'mediciones') {
        if (activando) {
          setFiltroTodos(true);
          setTecnicosSeleccionados(new Set(tecnicosFiltro.map((t) => t.id)));
        } else {
          setFiltroTodos(false);
          setTecnicosSeleccionados(new Set<string>());
        }
      }
    },
    [capasActivas, tecnicosFiltro, fetchUltimasPosiciones, fetchAllPlantaciones, fetchAllMediciones, cargarVeredas]
  );

  // ============================================================
  // Construcción de marcadores
  // FIX a: todo memoizado. Antes cada render creaba arrays nuevos → el efecto
  // de MapViewOffline reinyectaba TODOS los marcadores y capas GeoJSON en el
  // WebView, lo que en web recargaba el iframe y reseteaba el zoom.
  // ============================================================
  const plantacionMarkers = useMemo(
    () =>
      MOSTRAR_CAPA_PLANTACIONES && capasActivas.has('plantaciones')
        ? plantaciones.map((p: Record<string, any>) => ({
            id: `plant-${p.id}`,
            latitud: p.latitud,
            longitud: p.longitud,
            title: `${p.cantidad}x ${p.especie}`,
            icon: p.icono || getIconoEspecie(p.especie),
          }))
        : [],
    [capasActivas, plantaciones]
  );

  const tecnicosMarkers = useMemo(
    () =>
      capasActivas.has('tecnicos')
        ? posiciones.map((pos: Record<string, any>) => ({
            id: `tec-${pos.id}`,
            latitud: pos.latitud,
            longitud: pos.longitud,
            title: pos.usuario_nombre || `Técnico: ${pos.usuario_id}`,
            color: '#1565C0',
            icon: '👤',
          }))
        : [],
    [capasActivas, posiciones]
  );

  // --- Lista de técnicos para el selector (chips horizontales) ---
  // (definida arriba, antes de toggleCapa)

  // --- Mediciones (polígonos del Formulario 2) ---
  // El técnico solo ve sus propios polígonos; los roles superiores ven todos
  // y el detalle indica de qué beneficiario / técnico / vereda / corregimiento
  // es cada uno. Además, en la vista general se filtra por los técnicos
  // seleccionados en el selector horizontal.
  const medicionesVisibles: Record<string, any>[] = useMemo(() => {
    if (!capasActivas.has('mediciones')) return [];
    const base = canViewAll
      ? mediciones
      : mediciones.filter((m: Record<string, any>) => !user?.id || m.usuario_id === user.id);
    if (!canViewAll) return base;
    // Sin técnicos seleccionados no se dibuja nada (equivale a "ninguno").
    if (tecnicosSeleccionados.size === 0) return [];
    return base.filter((m: Record<string, any>) =>
      tecnicosSeleccionados.has(String(m.usuario_id))
    );
  }, [capasActivas, mediciones, canViewAll, user?.id, tecnicosSeleccionados]);

  // Alterna un técnico individual. Si al quitar uno ya no queda ninguno,
  // se apaga la bandera "Todos".
  const toggleTecnico = useCallback((id: string) => {
    setTecnicosSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFiltroTodos(false);
  }, []);

  // Chip "Todos": si ya están todos seleccionados, los quita todos; si no,
  // los selecciona todos.
  const toggleTodosTecnicos = useCallback(() => {
    setTecnicosSeleccionados((prev) => {
      const todos = tecnicosFiltro.length > 0 && tecnicosFiltro.every((t) => prev.has(t.id));
      if (todos) {
        setFiltroTodos(false);
        return new Set<string>();
      }
      setFiltroTodos(true);
      return new Set(tecnicosFiltro.map((t) => t.id));
    });
  }, [tecnicosFiltro]);

  // Cuando la lista de técnicos termina de cargar y la bandera "Todos" está
  // activa, se seleccionan los que falten (p. ej. al abrir la pantalla).
  useEffect(() => {
    if (!filtroTodos) return;
    setTecnicosSeleccionados((prev) => {
      const faltan = tecnicosFiltro.filter((t) => !prev.has(t.id));
      if (faltan.length === 0) return prev;
      const next = new Set(prev);
      faltan.forEach((t) => next.add(t.id));
      return next;
    });
  }, [filtroTodos, tecnicosFiltro]);

  // Encuadre automático: cuando cambia la selección de técnicos, se ajusta la
  // cámara para que se vean todos sus polígonos.
  useEffect(() => {
    if (!capasActivas.has('mediciones')) return;
    setFitNonce((n) => n + 1);
  }, [tecnicosSeleccionados, capasActivas]);

  const fitBounds = useMemo(() => {
    if (!capasActivas.has('mediciones') || medicionesVisibles.length === 0) return null;
    const puntos: Coordenadas[] = [];
    medicionesVisibles.forEach((m: Record<string, any>) => {
      (m.puntos || []).forEach((p: Record<string, any>) => {
        if (esCoordenadaValida(p.latitud, p.longitud)) {
          puntos.push({ latitud: p.latitud, longitud: p.longitud });
        }
      });
    });
    if (puntos.length === 0) return null;
    return { points: puntos, nonce: fitNonce };
  }, [capasActivas, medicionesVisibles, fitNonce]);

  const medicionMarkers: Record<string, any>[] = useMemo(
    () =>
      medicionesVisibles.reduce((acc: Record<string, any>[], m: Record<string, any>) => {
        // Solo vértices dentro de Colombia: hay mediciones con puntos
        // corruptos (Madrid) que ponían el marcador en el Atlántico.
        const puntos = (m.puntos || []).filter((p: Record<string, any>) =>
          esCoordenadaValida(p.latitud, p.longitud)
        );
        if (puntos.length === 0) return acc;
        const latCentro = puntos.reduce((s: number, p: Record<string, any>) => s + p.latitud, 0) / puntos.length;
        const lonCentro = puntos.reduce((s: number, p: Record<string, any>) => s + p.longitud, 0) / puntos.length;
        acc.push({
          id: `med-${m.id}`,
          latitud: latCentro,
          longitud: lonCentro,
          title: `${m.area_hectareas?.toFixed(2) || '?'} ha`,
          color: '#E65100',
          icon: '◈',
          iconColoreado: true,
        });
        return acc;
      }, []),
    [medicionesVisibles]
  );

  // Capa GeoJSON del polígono de cada medición (Formulario 2). Se dibuja para
  // todos los roles: el técnico ve los suyos y los roles superiores ven todos.
  // Los vértices fuera de Colombia se descartan (datos corruptos: 9 mediciones
  // tenían puntos en Madrid y el mapa se alejaba hasta zoom 3 sin mostrar nada).
  const medicionFeatures = useMemo(
    () =>
      medicionesVisibles
        .map((m: Record<string, any>) => ({
          m,
          pts: (m.puntos || []).filter((pt: Record<string, any>) =>
            esCoordenadaValida(pt.latitud, pt.longitud)
          ) as { latitud: number; longitud: number }[],
        }))
        .filter(({ pts }) => pts.length >= 3)
        .map(({ m, pts }) => {
          return {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[
                ...pts.map((pt) => [pt.longitud, pt.latitud]),
                [pts[0].longitud, pts[0].latitud],
              ]],
            },
            properties: {
              medicionId: m.id,
              nombre: m.nombre || null,
              area_hectareas: m.area_hectareas ?? null,
              perimetro_metros: m.perimetro_metros ?? null,
              beneficiario_nombre: m.beneficiario_nombre || null,
              beneficiario_cedula: m.beneficiario_cedula || null,
              vereda: m.vereda || null,
              corregimiento: m.corregimiento || null,
              usuario_nombre: m.usuario_nombre || null,
            },
          };
        }),
    [medicionesVisibles]
  );
  const medicionGeoLayer = useMemo(
    () =>
      medicionFeatures.length > 0
        ? [
            {
              id: 'mediciones-area',
              nombre: 'Polígonos medidos',
              features: medicionFeatures,
              fillColor: 'rgba(230, 81, 0, 0.18)',
              strokeColor: '#E65100',
              strokeWidth: 2,
              strokeOpacity: 0.8,
              fillOpacity: 0.18,
            },
          ]
        : [],
    [medicionFeatures]
  );

  // Mediciones con TODOS sus vértices fuera de Colombia (datos corruptos).
  // No se dibujan en el mapa, pero tampoco se ocultan en silencio: se avisa
  // cuántas son para que el administrador pueda revisarlas/eliminarlas.
  const medicionesCorruptas = useMemo(
    () =>
      medicionesVisibles.filter((m: Record<string, any>) => {
        const pts = m.puntos || [];
        if (pts.length === 0) return false;
        return !pts.some((p: Record<string, any>) => esCoordenadaValida(p.latitud, p.longitud));
      }),
    [medicionesVisibles]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMarkers: any = useMemo(
    () => [...plantacionMarkers, ...tecnicosMarkers, ...medicionMarkers],
    [plantacionMarkers, tecnicosMarkers, medicionMarkers]
  );

  // Capa GeoJSON de veredas
  const veredaGeoLayer = useMemo(
    () =>
      capasActivas.has('veredas') && veredasFeatures && veredasFeatures.length > 0
        ? [
            {
              id: 'veredas',
              nombre: 'Veredas',
              features: veredasFeatures,
              fillColor: 'rgba(27, 94, 32, 0.12)',
              strokeColor: '#1B5E20',
              strokeWidth: 2,
              strokeOpacity: 0.5,
              fillOpacity: 0.12,
            },
          ]
        : [],
    [capasActivas, veredasFeatures]
  );

  // Capa GeoJSON del ÁREA de cada plantación. Se dibuja para todos los roles:
  // dentro de un polígono medido estarán sembradas las plantaciones, así que
  // los roles superiores también necesitan verlas.
  const plantacionFeatures = useMemo(
    () =>
      MOSTRAR_CAPA_PLANTACIONES && capasActivas.has('plantaciones')
        ? plantaciones
            .filter((p: Record<string, any>) => (p.poligono?.length ?? 0) >= 3)
            .map((p: Record<string, any>) => {
              const pts = p.poligono as { latitud: number; longitud: number }[];
              return {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [[
                    ...pts.map((pt) => [pt.longitud, pt.latitud]),
                    [pts[0].longitud, pts[0].latitud],
                  ]],
                },
                properties: {
                  plantacionId: p.id,
                  especie: p.especie,
                  beneficiario_nombre: p.beneficiario_nombre || null,
                  beneficiario_cedula: p.beneficiario_cedula || null,
                  vereda: p.vereda || null,
                  corregimiento: p.corregimiento || null,
                  usuario_nombre: p.usuario_nombre || null,
                },
              };
            })
        : [],
    [capasActivas, plantaciones]
  );
  const plantacionGeoLayer = useMemo(
    () =>
      plantacionFeatures.length > 0
        ? [
            {
              id: 'plantaciones-area',
              nombre: 'Áreas de plantación',
              features: plantacionFeatures,
              fillColor: 'rgba(46, 125, 50, 0.18)',
              strokeColor: '#2E7D32',
              strokeWidth: 2,
              strokeOpacity: 0.7,
              fillOpacity: 0.18,
            },
          ]
        : [],
    [plantacionFeatures]
  );
  const geoLayers = useMemo(
    () => [...veredaGeoLayer, ...plantacionGeoLayer, ...medicionGeoLayer],
    [veredaGeoLayer, plantacionGeoLayer, medicionGeoLayer]
  );

  // ============================================================
  // Handlers
  // ============================================================
  const handleConfirmDelete = (tipo: 'plantación' | 'medición', id: string) => {
    // Abre el Modal de confirmación (Alert.alert no muestra botones en web).
    setConfirmarEliminar({ tipo, id });
  };

  const ejecutarEliminar = useCallback(async () => {
    const pendiente = confirmarEliminar;
    if (!pendiente) return;
    setConfirmarEliminar(null);
    try {
      if (pendiente.tipo === 'plantación') await eliminarPlantacion(pendiente.id);
      else if (pendiente.tipo === 'medición') await eliminarMedicion(pendiente.id);
      else if (pendiente.tipo === 'vereda') {
        // Las veredas no son datos propios (vienen de OpenStreetMap/Overpass o
        // de un fallback del backend) — "eliminar" en realidad es ocultarlas
        // de la vista de la app (tabla `veredas_excluidas`).
        await apiClient.delete(`/api/maps/veredas/${encodeURIComponent(pendiente.id)}`, {
          data: { nombre: pendiente.nombre },
        });
        // Quitar también del caché local: si no, al recargar la pantalla se
        // leía el caché (24h) y la vereda reaparecía aunque el servidor ya
        // la hubiera excluido.
        await removeVeredaFromCache(pendiente.id);
        setVeredasFeatures((prev) => (prev ? prev.filter((v) => v.id !== pendiente.id) : prev));
        setSelectedVereda(null);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.mensaje || `No se pudo eliminar la ${pendiente.tipo}`);
    }
    setSelectedItem(null);
  }, [confirmarEliminar, eliminarPlantacion, eliminarMedicion]);

  // Las veredas no son datos propios (vienen de OpenStreetMap/Overpass o de
  // un fallback del backend) — "eliminar" en realidad es ocultarlas de la
  // vista de la app (tabla `veredas_excluidas`), no borrar el dato de origen.
  // Se usa el Modal de confirmación (Alert.alert no muestra botones en web).
  const handleOcultarVereda = (id: string, nombre: string) => {
    setConfirmarEliminar({ tipo: 'vereda', id, nombre });
  };

  const totalPlantacionesEnVereda = (nombreVereda?: string): number => {
    const objetivo = normalizarVereda(nombreVereda);
    if (!objetivo) return 0;
    return plantaciones.filter(
      (p: Record<string, any>) => normalizarVereda(p.vereda) === objetivo
    ).length;
  };

  const conteos = {
    plantaciones: MOSTRAR_CAPA_PLANTACIONES ? plantaciones.length : 0,
    tecnicos: posiciones.length,
    mediciones: mediciones.length,
    veredas: veredasFeatures?.length || 0,
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    // paddingBottom con safe-area: sin esto el listado y los botones de la
    // parte inferior quedaban ocultos debajo de la barra de navegación
    // del teléfono (HUD inaccesible).
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {canViewAll ? 'Mapa — Puerto Rico, Caquetá' : 'Mi Mapa'}
        </Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={async () => {
            await syncAll();
            await loadAll();
          }}
        >
          <Text style={styles.refreshText}>{syncing ? '⋯' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* Capas Toggle — solo para roles con vista general */}
      {canViewAll && (
        <MapLayerToggle capasActivas={capasActivas} onToggle={toggleCapa} conteos={conteos} />
      )}

      {/* Selector horizontal de técnicos — aparece al activar "Mediciones" */}
      {canViewAll && capasActivas.has('mediciones') && (
        <MapTecnicosSelector
          tecnicos={tecnicosFiltro}
          seleccionados={tecnicosSeleccionados}
          onToggle={toggleTecnico}
          onToggleTodos={toggleTodosTecnicos}
          totalMediciones={mediciones.length}
        />
      )}

      {/* Toolbar — visible para TODOS los roles: el técnico también necesita
          el botón "📍 Mi ubicación" para volver a su posición en campo.
          El selector de mapa base solo se muestra a los roles con vista
          general (el técnico trabaja con el satélite por defecto). */}
      <MapToolbar
        locating={locating}
        siguiendo={siguiendo}
        onCentrar={centrarEnMiUbicacion}
        onReset={detenerSeguimiento}
        mapStyle={canViewAll ? mapStyle : undefined}
        onChangeMapStyle={canViewAll ? setMapStyle : undefined}
        resetLabel={canViewAll ? '🗺️ Puerto Rico' : '🛑 Detener'}
      />

      {/* Mapa */}
      <View style={styles.mapContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Cargando datos del mapa...</Text>
          </View>
        ) : (
          <MapViewOffline
            center={mapCenter}
            zoom={mapZoom}
            markers={allMarkers}
            height="100%"
            mapStyle={mapStyle}
            resetNonce={resetNonce}
            fitBounds={fitBounds}
            recentrar={
              recentrarNonce > 0 && mapCenter
                ? { coords: mapCenter, nonce: recentrarNonce }
                : null
            }
            showUserLocation={true}
            userLocation={userLocation}
            geojsonLayers={geoLayers}
            onMarkerPress={(id) => {
              const marker = allMarkers.find((m: Record<string, any>) => m.id === id);
              if (marker) setSelectedItem(marker);
            }}
            onFeaturePress={(layerId, properties) => {
              if (layerId === 'veredas') {
                setSelectedVereda(properties);
                return;
              }
              // Al tocar un polígono medido se abre su detalle con la
              // atribución (beneficiario, técnico, vereda, corregimiento).
              if (layerId === 'mediciones-area' && properties?.medicionId) {
                setSelectedItem({ id: `med-${properties.medicionId}` });
                return;
              }
              if (layerId === 'plantaciones-area' && properties?.especie) {
                setSelectedItem({ id: `plant-${properties.plantacionId ?? ''}`, ...properties });
              }
            }}
          />
        )}
      </View>

      {/* Indicador de carga de veredas */}
      {veredasLoading && (
        <View style={styles.veredasLoading}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.veredasLoadingText}>Cargando veredas...</Text>
        </View>
      )}

      {/* Aviso: mediciones con coordenadas corruptas (fuera de Colombia).
          Antes estiraban el encuadre hasta el Atlántico y el mapa parecía
          vacío; ahora se descartan del dibujo pero se reportan aquí. */}
      {medicionesCorruptas.length > 0 && (
        <View style={styles.coordsWarning}>
          <Text style={styles.coordsWarningText}>
            ⚠️ {medicionesCorruptas.length}{' '}
            {medicionesCorruptas.length === 1 ? 'medición' : 'mediciones'} con
            coordenadas inválidas (fuera de Colombia) — no se dibujan en el mapa.
          </Text>
        </View>
      )}

      {/* Botón toggle lista */}
      {allMarkers.length > 0 && (
        <TouchableOpacity
          style={styles.toggleListButton}
          onPress={() => setShowList((prev) => !prev)}
          activeOpacity={0.7}
        >
          <Text style={styles.toggleListText}>
            {showList ? '▼ Ocultar lista' : '▲ Ver lista'}
          </Text>
          <View style={styles.toggleListBadge}>
            <Text style={styles.toggleListBadgeText}>{allMarkers.length}</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Lista de items */}
      {showList && (
        <MapItemList
          items={allMarkers}
          plantaciones={plantaciones}
          mediciones={mediciones}
          posiciones={posiciones}
          veredas={capasActivas.has('veredas') ? veredasFeatures || [] : []}
          isAdmin={isAdmin}
          onSelect={setSelectedItem}
          onDelete={handleConfirmDelete}
          onDeleteVereda={handleOcultarVereda}
        />
      )}

      {/* Detalle del item seleccionado */}
      {selectedItem && (
        <MapItemDetailCard
          item={selectedItem}
          plantaciones={plantaciones}
          mediciones={mediciones}
          posiciones={posiciones}
          canViewAll={canViewAll}
          isAdmin={isAdmin}
          onClose={() => setSelectedItem(null)}
          onDelete={handleConfirmDelete}
        />
      )}

      {/* Detalle de la vereda seleccionada */}
      {selectedVereda && (
        <VeredaDetailCard
          properties={selectedVereda}
          totalPlantaciones={totalPlantacionesEnVereda(selectedVereda.nombre)}
          isAdmin={isAdmin}
          onClose={() => setSelectedVereda(null)}
          onDelete={handleOcultarVereda}
        />
      )}

      {/* Modal: confirmar eliminación (Alert.alert no muestra botones en web) */}
      <Modal visible={!!confirmarEliminar} transparent animationType="fade" onRequestClose={() => setConfirmarEliminar(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {confirmarEliminar?.tipo === 'vereda' ? '🗺️ Ocultar vereda' : `🗑️ Eliminar ${confirmarEliminar?.tipo}`}
            </Text>
            <Text style={styles.confirmarTexto}>
              {confirmarEliminar?.tipo === 'vereda'
                ? `¿Ocultar "${confirmarEliminar?.nombre || 'esta vereda'}" del mapa para todos los usuarios? Esto no borra el dato de OpenStreetMap, solo deja de mostrarse en la app.`
                : `¿Seguro que quieres eliminar esta ${confirmarEliminar?.tipo}? Esta acción no se puede deshacer.`}
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnEliminar]}
              onPress={ejecutarEliminar}
            >
              <Text style={styles.modalBtnTextEliminar}>
                {confirmarEliminar?.tipo === 'vereda' ? 'Ocultar' : 'Eliminar'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setConfirmarEliminar(null)}
            >
              <Text style={styles.modalBtnTextCancel}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshText: { fontSize: 20, color: COLORS.primary },
  mapContainer: { flex: 1, minHeight: 300 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.mapTileBackground,
  },
  loadingText: { marginTop: SPACING.sm, fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  veredasLoading: {
    position: 'absolute',
    top: 100,
    right: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface + 'CC',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    gap: 6,
  },
  veredasLoadingText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  coordsWarning: {
    position: 'absolute',
    bottom: 56,
    left: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: COLORS.error + 'E6',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  coordsWarningText: { fontSize: FONTS.sizes.xs, color: '#FFFFFF', fontWeight: '600' },
  toggleListButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  toggleListText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
  toggleListBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleListBadgeText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.bold,
  },
  // Modal de confirmación de borrado
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  confirmarTexto: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  modalBtn: {
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  modalBtnEliminar: { backgroundColor: COLORS.error },
  modalBtnTextEliminar: { color: '#fff', fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold },
  modalBtnCancel: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
  modalBtnTextCancel: { color: COLORS.textPrimary, fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold },
});

export default MapaGeneralScreen;
