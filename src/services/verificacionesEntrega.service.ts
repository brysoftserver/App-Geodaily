// ============================================================
// GEODAILY — Verificación de Entregas: almacenamiento local + sincronización
// ============================================================
// Offline-first (misma política que seguimientos y otros formatos):
//   · Cada verificación vive en el dispositivo (AsyncStorage, una clave por
//     verificación; funciona en el teléfono y en web).
//   · Borrador = completado:false. Solo existe en el dispositivo.
//   · Completar marca completado:true y sincronizado:false; se intenta subir
//     de inmediato y, si no hay señal, lo sube el sync automático (SyncContext).
//   · Al sincronizar: primero fotos y firmas (endpoint propio, sin marca de
//     agua, carpeta propia en MinIO), luego el registro. Si alguna evidencia
//     falla, el registro igual se envía y la evidencia se reintenta.
// ============================================================

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';
import { archivoLocalFaltante } from './mediaStorage.service';
import { DatosVerificacion, FotoVerificacion, MaterialVerificacionId } from '../data/verificacionesEntrega';

const ENDPOINT = API_CONFIG.ENDPOINTS.VERIFICACIONES_ENTREGA;
const PREFIJO = 'geodaily.verif_entrega.';

export interface VerificacionLocal {
  id: string;
  material: MaterialVerificacionId;
  autor_id: string;
  autor_nombre: string;
  datos: DatosVerificacion;
  completado: boolean;
  sincronizado: boolean;
  created_at: string;
  updated_at: string;
}

/** Verificación tal como la devuelve el servidor (completada en este u otro dispositivo). */
export interface VerificacionServidor {
  id: string;
  material: MaterialVerificacionId;
  autor_nombre: string | null;
  datos: DatosVerificacion;
  created_at: string;
  updated_at: string;
}

export const nuevoIdVerificacion = (material: string) =>
  `ve-${material.replace(/_/g, '')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// ─── Almacenamiento local ───────────────────────────────────

export const guardarVerificacionLocal = async (v: VerificacionLocal): Promise<boolean> => {
  try {
    await AsyncStorage.setItem(PREFIJO + v.id, JSON.stringify({ ...v, updated_at: new Date().toISOString() }));
    return true;
  } catch (e) {
    console.warn('[VerifEntrega] No se pudo guardar localmente:', e);
    return false;
  }
};

export const obtenerVerificacionLocal = async (id: string): Promise<VerificacionLocal | null> => {
  try {
    const crudo = await AsyncStorage.getItem(PREFIJO + id);
    return crudo ? (JSON.parse(crudo) as VerificacionLocal) : null;
  } catch {
    return null;
  }
};

const todasLasLocales = async (): Promise<VerificacionLocal[]> => {
  try {
    const claves = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIJO));
    if (!claves.length) return [];
    const pares = await AsyncStorage.multiGet(claves);
    const lista: VerificacionLocal[] = [];
    for (const [, valor] of pares) {
      if (!valor) continue;
      try {
        lista.push(JSON.parse(valor));
      } catch {
        // registro corrupto: se ignora
      }
    }
    return lista;
  } catch (e) {
    console.warn('[VerifEntrega] No se pudo leer el almacenamiento local:', e);
    return [];
  }
};

/** Verificaciones de este usuario y material, más recientes primero. */
export const listarVerificacionesLocales = async (filtro: {
  material: MaterialVerificacionId;
  autorId?: string;
  completado: boolean;
}): Promise<VerificacionLocal[]> =>
  (await todasLasLocales())
    .filter((v) => v.material === filtro.material && v.completado === filtro.completado && (!filtro.autorId || v.autor_id === filtro.autorId))
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

export const eliminarVerificacionLocal = async (id: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(PREFIJO + id);
  } catch {
    // nada
  }
};

/** Completadas que aún no terminan de subir (para el contador de pendientes). */
export const getVerificacionesNoSincronizadas = async (): Promise<VerificacionLocal[]> =>
  (await todasLasLocales()).filter((v) => v.completado && !v.sincronizado);

// ─── Servidor ───────────────────────────────────────────────

export const listarVerificacionesServidor = async (material: MaterialVerificacionId): Promise<VerificacionServidor[]> => {
  const r = await apiClient.get(ENDPOINT, { params: { material }, timeout: 20000 });
  return (r.data.verificaciones || []).map((v: any) => ({ ...v, datos: typeof v.datos === 'string' ? JSON.parse(v.datos) : v.datos }));
};

/** Fuente para <Image> de una foto o firma ya subida (token por cabecera en el teléfono, por URL en web). */
export const fuenteArchivoVerificacion = async (archivoId: number): Promise<{ uri: string; headers?: Record<string, string> }> => {
  const uri = `${API_CONFIG.BASE_URL}${ENDPOINT}/archivos/${archivoId}`;
  const token = await getApiAuthToken();
  if (!token) return { uri };
  return Platform.OS === 'web'
    ? { uri: `${uri}?token=${encodeURIComponent(token)}` }
    : { uri, headers: { Authorization: `Bearer ${token}` } };
};

const subirFoto = async (v: VerificacionLocal, campo: string, foto: FotoVerificacion): Promise<number | null> => {
  try {
    const fd = new FormData();
    fd.append('material', v.material);
    fd.append('cliente_id', foto.id);
    fd.append('campo', campo);
    if (Platform.OS === 'web') {
      const blob = await (await fetch(foto.uri as string)).blob();
      fd.append('archivo', blob, `${foto.id}.jpg`);
    } else {
      // @ts-expect-error — FormData de React Native
      fd.append('archivo', { uri: foto.uri, type: 'image/jpeg', name: `${foto.id}.jpg` });
    }
    const r = await apiClient.post(`${ENDPOINT}/${v.id}/archivos`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return r.data?.id ?? null;
  } catch (e: any) {
    console.warn('[VerifEntrega] Foto no subida:', foto.id, e?.message);
    return null;
  }
};

const subirFirma = async (v: VerificacionLocal, campo: string, dataUri: string): Promise<number | null> => {
  try {
    const r = await apiClient.post(
      `${ENDPOINT}/${v.id}/firmas`,
      { material: v.material, cliente_id: `firma-${campo}`, campo, dataUri },
      { timeout: 60000 }
    );
    return r.data?.id ?? null;
  } catch (e: any) {
    console.warn('[VerifEntrega] Firma no subida:', campo, e?.message);
    return null;
  }
};

/** Sube las fotos pendientes de una lista. Devuelve la lista actualizada y si quedó alguna sin subir. */
const resolverFotos = async (v: VerificacionLocal, campo: string, fotos: FotoVerificacion[]) => {
  let falta = false;
  const salida: FotoVerificacion[] = [];
  for (const f of fotos) {
    if (f.archivo_id || f.perdido) {
      salida.push(f);
      continue;
    }
    if (!f.uri) continue;
    if (await archivoLocalFaltante(f.uri)) {
      salida.push({ ...f, perdido: true });
      continue;
    }
    const id = await subirFoto(v, campo, f);
    if (id) salida.push({ ...f, archivo_id: id });
    else {
      salida.push(f);
      falta = true;
    }
  }
  return { fotos: salida, falta };
};

/**
 * Sube las verificaciones completadas pendientes. Devuelve los ids que no
 * terminaron (mismo contrato que el resto de `sincronizarX()` del SyncContext).
 * Nunca lanza.
 */
export const sincronizarVerificacionesEntrega = async (timeoutMs = 30000): Promise<string[]> => {
  const fallaron: string[] = [];
  let pendientes: VerificacionLocal[] = [];
  try {
    pendientes = await getVerificacionesNoSincronizadas();
  } catch {
    return fallaron;
  }
  for (const original of pendientes) {
    try {
      const v: VerificacionLocal = JSON.parse(JSON.stringify(original));
      let falta = false;

      for (const [criterio, r] of Object.entries(v.datos.respuestas || {})) {
        const res = await resolverFotos(v, criterio, r.fotos || []);
        r.fotos = res.fotos;
        falta = falta || res.falta;
      }
      const ev = await resolverFotos(v, 'evidencias', v.datos.evidencias || []);
      v.datos.evidencias = ev.fotos;
      falta = falta || ev.falta;

      for (const campo of ['tecnico', 'interventoria'] as const) {
        const f = v.datos.firmas?.[campo];
        if (f?.firma?.startsWith('data:') && !f.archivo_id) {
          const id = await subirFirma(v, campo, f.firma);
          if (id) f.archivo_id = id;
          else falta = true;
        }
      }

      // Al servidor solo viaja la referencia de cada archivo (no las URIs
      // locales ni el base64 de las firmas).
      const datosServidor: DatosVerificacion = JSON.parse(JSON.stringify(v.datos));
      const limpiar = (lista: FotoVerificacion[]) => lista.map(({ id, archivo_id, perdido }) => ({ id, archivo_id, perdido }));
      for (const r of Object.values(datosServidor.respuestas || {})) r.fotos = limpiar(r.fotos || []);
      datosServidor.evidencias = limpiar(datosServidor.evidencias || []);
      for (const campo of ['tecnico', 'interventoria'] as const) {
        if (datosServidor.firmas?.[campo]) datosServidor.firmas[campo].firma = null;
      }

      const r = await apiClient.post(
        `${ENDPOINT}/sync`,
        { verificaciones: [{ id: v.id, material: v.material, datos: datosServidor, created_at: v.created_at }] },
        { timeout: timeoutMs }
      );
      const rechazada = (r.data?.rechazadas || []).some((x: { id?: string }) => x.id === v.id);
      v.sincronizado = r.data?.estado === 'ok' && !rechazada && !falta;
      await guardarVerificacionLocal(v);
      if (!v.sincronizado) fallaron.push(v.id);
    } catch (e: any) {
      console.warn('[VerifEntrega] No se pudo sincronizar', original.id, e?.message);
      fallaron.push(original.id);
    }
  }
  return fallaron;
};

/** Marca como completada, la guarda y trata de subirla ya. Nunca lanza. */
export const completarVerificacion = async (
  v: VerificacionLocal
): Promise<{ guardada: boolean; sincronizada: boolean }> => {
  const lista = { ...v, completado: true, sincronizado: false };
  const guardada = await guardarVerificacionLocal(lista);
  if (!guardada) return { guardada: false, sincronizada: false };
  const fallaron = await sincronizarVerificacionesEntrega(15000);
  return { guardada: true, sincronizada: !fallaron.includes(v.id) };
};
