// ============================================================
// GEODAILY — Descarga de mapas para uso offline (MapLibre OfflineManager)
// ============================================================
// Solo funciona cuando el módulo nativo de MapLibre está compilado en el
// build (dev client / build de producción) — en Expo Go no existe
// NativeModules.MLRNModule, así que estas funciones son no-op seguras ahí.
// ============================================================

import { NativeModules } from 'react-native';
import { API_CONFIG } from '../theme';
import { Coordenadas } from '../types';

export interface OfflinePackInfo {
  name: string;
  boundsDescripcion?: string;
  metadata?: Record<string, any>;
}

/** ¿Está disponible el módulo nativo de mapas (requiere dev client/build)? */
export const isOfflineMapAvailable = (): boolean => {
  return !!NativeModules.MLRNModule;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let OfflineManager: any = null;
if (isOfflineMapAvailable()) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    OfflineManager = require('@maplibre/maplibre-react-native').OfflineManager;
  } catch {
    // Módulo no disponible — las funciones de abajo quedan como no-op seguras
  }
}

/** Traduce errores técnicos de red a un mensaje claro para el técnico en campo. */
function mensajeAmigable(error: any): string {
  const msg: string = error?.message || '';
  if (/unable to resolve host|network.*(unreachable|request failed)|timeout|failed to connect/i.test(msg)) {
    return 'No se pudo conectar para descargar el mapa. Verifica tu conexión a internet (usa WiFi si es posible) e inténtalo de nuevo.';
  }
  return msg || 'No se pudo descargar el mapa offline. Inténtalo de nuevo.';
}

/** Calcula un bounding box cuadrado de `radioKm` alrededor de un centro. */
function calcularBounds(center: Coordenadas, radioKm: number): [[number, number], [number, number]] {
  const deltaLat = radioKm / 111;
  const deltaLon = radioKm / (111 * Math.cos((center.latitud * Math.PI) / 180));
  const noreste: [number, number] = [center.longitud + deltaLon, center.latitud + deltaLat];
  const suroeste: [number, number] = [center.longitud - deltaLon, center.latitud - deltaLat];
  return [noreste, suroeste];
}

/**
 * Descargar un paquete de mapa offline centrado en `center`, con un radio
 * en km. Debe llamarse con conexión activa (WiFi idealmente, por el peso).
 */
export const descargarMapaOffline = async (
  center: Coordenadas,
  radioKm: number,
  tipo: 'relieve' | 'satelite',
  onProgress?: (percentage: number) => void
): Promise<{ success: boolean; error?: string }> => {
  if (!OfflineManager) {
    return { success: false, error: 'La descarga de mapas offline requiere la versión instalada de GEODAILY (no está disponible en Expo Go).' };
  }

  const name = `geodaily-${tipo}-${Math.round(center.latitud * 1000)}-${Math.round(center.longitud * 1000)}`;
  const styleURL = `${API_CONFIG.BASE_URL}/api/maps/style/${tipo}`;
  const bounds = calcularBounds(center, radioKm);

  // Si ya existe un paquete con este nombre (misma zona+tipo, ej. un reintento
  // o una descarga previa), borrarlo primero — createPack() rechaza nombres
  // duplicados, y esto además refresca la descarga con datos actuales.
  try {
    const existentes = await OfflineManager.getPacks();
    if (existentes?.some((p: any) => p.name === name)) {
      await OfflineManager.deletePack(name);
    }
  } catch (error) {
    console.warn('[OfflineMap] No se pudo verificar/borrar paquete existente:', error);
  }

  return new Promise((resolve) => {
    OfflineManager.createPack(
      {
        name,
        styleURL,
        bounds,
        minZoom: 10,
        maxZoom: 16,
        metadata: { tipo, radioKm, creado: new Date().toISOString() },
      },
      (_pack: any, status: any) => {
        if (onProgress && status?.percentage != null) {
          onProgress(status.percentage);
        }
        if (status?.percentage === 100) {
          resolve({ success: true });
        }
      },
      (_pack: any, error: any) => {
        // console.warn (no console.error) — es un fallo de red esperado y ya
        // manejado abajo con un mensaje claro; console.error dispara la
        // pantalla roja de LogBox, innecesariamente alarmante para el técnico.
        console.warn('[OfflineMap] Error descargando paquete:', error);
        resolve({ success: false, error: mensajeAmigable(error) });
      }
    ).catch((error: any) => {
      console.warn('[OfflineMap] Error creando paquete:', error);
      resolve({ success: false, error: mensajeAmigable(error) });
    });
  });
};

/** Listar los paquetes de mapa ya descargados en este dispositivo. */
export const listarPaquetesOffline = async (): Promise<OfflinePackInfo[]> => {
  if (!OfflineManager) return [];
  try {
    const packs = await OfflineManager.getPacks();
    return (packs || []).map((p: any) => ({
      name: p.name,
      metadata: p.metadata,
    }));
  } catch (error) {
    console.warn('[OfflineMap] Error listando paquetes:', error);
    return [];
  }
};

/** Eliminar un paquete de mapa offline para liberar espacio. */
export const eliminarPaqueteOffline = async (name: string): Promise<void> => {
  if (!OfflineManager) return;
  try {
    await OfflineManager.deletePack(name);
  } catch (error) {
    console.warn('[OfflineMap] Error eliminando paquete:', error);
    throw error;
  }
};
