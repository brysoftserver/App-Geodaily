// ============================================================
// GEODAILY — Entregas de una actividad (técnico): local + sincronización
// ============================================================
// Ej.: Siembra de Plátano → Entrega de Colinos → Entrega 1, Entrega 2…
// Offline-first: cada entrega vive en el dispositivo (AsyncStorage, una clave
// por entrega) y cada cambio la deja pendiente de subir. Al sincronizar se
// suben primero las fotos (carpeta propia en MinIO) y luego el registro.
// El acta de cada entrega es un Acta de Entrega y Recibo (otros formatos) con
// su propia instancia: no se mezcla con las de otras entregas ni actividades.
// ============================================================

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';
import { archivoLocalFaltante } from './mediaStorage.service';

const ENDPOINT = API_CONFIG.ENDPOINTS.ACTIVIDADES_ENTREGAS;
const PREFIJO = 'geodaily.act_entrega.';
export const MAX_FOTOS_ENTREGA = 10;

export interface FotoEntrega {
  id: string;
  uri?: string;
  archivo_id?: number;
  perdido?: boolean;
}

export interface BeneficiarioEntrega {
  item: number;
  nombre: string;
  cedula: string;
  vereda?: string;
  corregimiento?: string;
  departamento?: string;
  municipio?: string;
  telefono?: string;
  predio?: string;
}

export interface DatosEntrega {
  lugar: string;
  beneficiario: BeneficiarioEntrega | null;
  /** Instancia del Acta de Entrega y Recibo de esta entrega (fija desde que se crea). */
  actaInstancia: string;
  /** Ya se abrió el acta: el beneficiario queda fijo para no dejarla huérfana. */
  actaIniciada: boolean;
  fotos: FotoEntrega[];
}

export interface EntregaLocal {
  id: string;
  actividad: string;
  numero: number;
  tecnico_id: string;
  datos: DatosEntrega;
  sincronizado: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Local ──────────────────────────────────────────────────

export const guardarEntregaLocal = async (e: EntregaLocal): Promise<boolean> => {
  try {
    await AsyncStorage.setItem(PREFIJO + e.id, JSON.stringify({ ...e, updated_at: new Date().toISOString() }));
    return true;
  } catch (err) {
    console.warn('[Entregas] No se pudo guardar localmente:', err);
    return false;
  }
};

export const obtenerEntregaLocal = async (id: string): Promise<EntregaLocal | null> => {
  try {
    const crudo = await AsyncStorage.getItem(PREFIJO + id);
    return crudo ? (JSON.parse(crudo) as EntregaLocal) : null;
  } catch {
    return null;
  }
};

const todasLasLocales = async (): Promise<EntregaLocal[]> => {
  try {
    const claves = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIJO));
    if (!claves.length) return [];
    const lista: EntregaLocal[] = [];
    for (const [, valor] of await AsyncStorage.multiGet(claves)) {
      if (!valor) continue;
      try {
        lista.push(JSON.parse(valor));
      } catch {
        // registro corrupto: se ignora
      }
    }
    return lista;
  } catch {
    return [];
  }
};

export const listarEntregasLocales = async (actividad: string, tecnicoId?: string): Promise<EntregaLocal[]> =>
  (await todasLasLocales())
    .filter((e) => e.actividad === actividad && (!tecnicoId || e.tecnico_id === tecnicoId))
    .sort((a, b) => a.numero - b.numero);

export const getEntregasNoSincronizadas = async (): Promise<EntregaLocal[]> =>
  (await todasLasLocales()).filter((e) => !e.sincronizado);

/**
 * Trae las entregas del técnico guardadas en el servidor (hechas en otro
 * teléfono o antes de reinstalar) y guarda localmente las que falten, para
 * poder verlas y seguir editándolas. Sin red no hace nada.
 */
export const importarEntregasDelServidor = async (actividad: string, tecnicoId: string): Promise<boolean> => {
  try {
    const r = await apiClient.get(ENDPOINT, { params: { actividad }, timeout: 15000 });
    const locales = new Set((await listarEntregasLocales(actividad, tecnicoId)).map((e) => e.id));
    for (const s of r.data.entregas || []) {
      if (locales.has(s.id)) continue;
      const datos = typeof s.datos === 'string' ? JSON.parse(s.datos) : s.datos;
      await guardarEntregaLocal({
        id: s.id,
        actividad: s.actividad,
        numero: s.numero,
        tecnico_id: tecnicoId,
        datos: { lugar: '', beneficiario: null, actaInstancia: '', actaIniciada: false, fotos: [], ...datos },
        sincronizado: true,
        created_at: s.created_at,
        updated_at: s.updated_at,
      });
    }
    return true;
  } catch {
    return false;
  }
};

/** Crea la siguiente entrega (número consecutivo del técnico en esa actividad). */
export const crearEntrega = async (actividad: string, tecnicoId: string): Promise<EntregaLocal | null> => {
  const existentes = await listarEntregasLocales(actividad, tecnicoId);
  const numero = existentes.reduce((m, e) => Math.max(m, e.numero), 0) + 1;
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ahora = new Date().toISOString();
  const entrega: EntregaLocal = {
    id: `ent-${actividad.replace(/_/g, '')}-${sufijo}`,
    actividad,
    numero,
    tecnico_id: tecnicoId,
    datos: { lugar: '', beneficiario: null, actaInstancia: `e${sufijo}`.slice(0, 40), actaIniciada: false, fotos: [] },
    sincronizado: false,
    created_at: ahora,
    updated_at: ahora,
  };
  return (await guardarEntregaLocal(entrega)) ? entrega : null;
};

// ─── Servidor ───────────────────────────────────────────────

export const fuenteFotoEntrega = async (fotoId: number): Promise<{ uri: string; headers?: Record<string, string> }> => {
  const uri = `${API_CONFIG.BASE_URL}${ENDPOINT}/fotos/${fotoId}`;
  const token = await getApiAuthToken();
  if (!token) return { uri };
  return Platform.OS === 'web'
    ? { uri: `${uri}?token=${encodeURIComponent(token)}` }
    : { uri, headers: { Authorization: `Bearer ${token}` } };
};

const subirFoto = async (e: EntregaLocal, f: FotoEntrega): Promise<number | null> => {
  try {
    const fd = new FormData();
    fd.append('actividad', e.actividad);
    fd.append('numero', String(e.numero));
    if (e.datos.beneficiario?.item) fd.append('beneficiario_item', String(e.datos.beneficiario.item));
    fd.append('cliente_id', f.id);
    if (Platform.OS === 'web') {
      const blob = await (await fetch(f.uri as string)).blob();
      fd.append('archivo', blob, `${f.id}.jpg`);
    } else {
      // @ts-expect-error — FormData de React Native
      fd.append('archivo', { uri: f.uri, type: 'image/jpeg', name: `${f.id}.jpg` });
    }
    const r = await apiClient.post(`${ENDPOINT}/${e.id}/fotos`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
    return r.data?.id ?? null;
  } catch (err: any) {
    console.warn('[Entregas] Foto no subida:', f.id, err?.message);
    return null;
  }
};

/** Sube las entregas pendientes. Devuelve los ids que no terminaron. Nunca lanza. */
export const sincronizarEntregasActividad = async (timeoutMs = 30000): Promise<string[]> => {
  const fallaron: string[] = [];
  let pendientes: EntregaLocal[] = [];
  try {
    pendientes = await getEntregasNoSincronizadas();
  } catch {
    return fallaron;
  }
  for (const original of pendientes) {
    try {
      const e: EntregaLocal = JSON.parse(JSON.stringify(original));
      let falta = false;
      const fotos: FotoEntrega[] = [];
      for (const f of e.datos.fotos || []) {
        if (f.archivo_id || f.perdido) {
          fotos.push(f);
          continue;
        }
        if (!f.uri) continue;
        if (await archivoLocalFaltante(f.uri)) {
          fotos.push({ ...f, perdido: true });
          continue;
        }
        const id = await subirFoto(e, f);
        if (id) fotos.push({ ...f, archivo_id: id });
        else {
          fotos.push(f);
          falta = true;
        }
      }
      e.datos.fotos = fotos;
      const datosServidor: DatosEntrega = {
        ...e.datos,
        fotos: fotos.map(({ id, archivo_id, perdido }) => ({ id, archivo_id, perdido })),
      };
      const r = await apiClient.post(
        `${ENDPOINT}/sync`,
        { entregas: [{ id: e.id, actividad: e.actividad, numero: e.numero, datos: datosServidor, created_at: e.created_at }] },
        { timeout: timeoutMs }
      );
      const rechazada = (r.data?.rechazadas || []).some((x: { id?: string }) => x.id === e.id);
      // Si mientras subía se editó la entrega, se conserva lo nuevo y queda pendiente.
      const actual = await obtenerEntregaLocal(e.id);
      const cambioEnMedio = !!actual && actual.updated_at !== original.updated_at;
      const base = cambioEnMedio && actual ? { ...actual, datos: { ...actual.datos, fotos: mezclarFotos(actual.datos.fotos, fotos) } } : e;
      base.sincronizado = r.data?.estado === 'ok' && !rechazada && !falta && !cambioEnMedio;
      await AsyncStorage.setItem(PREFIJO + base.id, JSON.stringify(base));
      if (!base.sincronizado) fallaron.push(e.id);
    } catch (err: any) {
      console.warn('[Entregas] No se pudo sincronizar', original.id, err?.message);
      fallaron.push(original.id);
    }
  }
  return fallaron;
};

/** Conserva las fotos actuales y les pega el archivo_id de las que ya subieron. */
const mezclarFotos = (actuales: FotoEntrega[], subidas: FotoEntrega[]): FotoEntrega[] =>
  actuales.map((f) => {
    const s = subidas.find((x) => x.id === f.id);
    return s?.archivo_id && !f.archivo_id ? { ...f, archivo_id: s.archivo_id } : f;
  });
