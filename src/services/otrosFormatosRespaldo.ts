// ============================================================
// GEODAILY — Respaldo en archivo de "Otros formatos" completados
// ============================================================
// El acta completada se guarda primero en SQLite (otros_formatos_locales) y
// de ahí se sube. En campo ese guardado llegó a fallar ("No se pudo guardar
// el acta en este dispositivo") y el acta nunca entraba a la cola de subida:
// las firmas se quedaban solo en el borrador del teléfono.
//
// Si SQLite falla, el formato se escribe aquí, como JSON en el almacenamiento
// privado de la app (NO en AsyncStorage: tope de 6 MB en Android), y la
// sincronización lo sube igual que a los de SQLite.
//
// Nunca se borra un respaldo: al subirse solo se marca `sincronizado: true`.
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';
import type { OtroFormatoLocal } from './database';

export const RESPALDO_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}otros_formatos_respaldo/`
  : null;

const ruta = (id: string): string | null =>
  RESPALDO_DIR ? `${RESPALDO_DIR}${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.json` : null;

const asegurarCarpeta = async (): Promise<void> => {
  if (!RESPALDO_DIR) throw new Error('Sin almacenamiento de documentos para el respaldo');
  const info = await FileSystem.getInfoAsync(RESPALDO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(RESPALDO_DIR, { intermediates: true });
};

/** Lee un respaldo por id (null si no hay o no se puede leer). */
export const leerRespaldo = async (id: string): Promise<OtroFormatoLocal | null> => {
  const r = ruta(id);
  if (!r) return null;
  try {
    const info = await FileSystem.getInfoAsync(r);
    if (!info.exists) return null;
    const f = JSON.parse(await FileSystem.readAsStringAsync(r));
    return f && typeof f === 'object' && f.id ? (f as OtroFormatoLocal) : null;
  } catch (e) {
    console.warn('[Respaldo] No se pudo leer el respaldo', id, e);
    return null;
  }
};

/**
 * Guarda (crea o actualiza) un formato en el respaldo. Conserva `created_at`,
 * lo deja pendiente de subir. Lanza si no se pudo escribir.
 */
export const guardarRespaldo = async (
  id: string,
  f: Pick<
    OtroFormatoLocal,
    'tecnico_id' | 'tecnico_nombre' | 'tecnico_usuario' | 'beneficiario_cedula' | 'beneficiario_nombre' | 'tipo' | 'datos' | 'completo'
  >
): Promise<OtroFormatoLocal> => {
  await asegurarCarpeta();
  const previo = await leerRespaldo(id);
  const ahora = new Date().toISOString();
  const registro: OtroFormatoLocal = {
    id,
    tecnico_id: f.tecnico_id ?? null,
    tecnico_nombre: f.tecnico_nombre ?? null,
    tecnico_usuario: f.tecnico_usuario ?? null,
    beneficiario_cedula: f.beneficiario_cedula,
    beneficiario_nombre: f.beneficiario_nombre ?? null,
    tipo: f.tipo,
    datos: f.datos || {},
    completo: !!f.completo,
    sincronizado: false,
    created_at: previo?.created_at || ahora,
    updated_at: ahora,
  };
  const r = ruta(id) as string;
  await FileSystem.writeAsStringAsync(r, JSON.stringify(registro));
  // Verificación: lo escrito se puede leer.
  const leido = await leerRespaldo(id);
  if (!leido || leido.updated_at !== ahora) throw new Error('El respaldo en archivo no quedó escrito');
  return registro;
};

/** Todos los respaldos guardados en este dispositivo. */
export const listarRespaldos = async (): Promise<OtroFormatoLocal[]> => {
  if (!RESPALDO_DIR) return [];
  try {
    const info = await FileSystem.getInfoAsync(RESPALDO_DIR);
    if (!info.exists) return [];
    const nombres = (await FileSystem.readDirectoryAsync(RESPALDO_DIR)).filter((n) => n.endsWith('.json'));
    const out: OtroFormatoLocal[] = [];
    for (const n of nombres) {
      try {
        const f = JSON.parse(await FileSystem.readAsStringAsync(`${RESPALDO_DIR}${n}`));
        if (f?.id) out.push(f as OtroFormatoLocal);
      } catch {
        // archivo ilegible: se deja quieto
      }
    }
    return out;
  } catch {
    return [];
  }
};

/** Marca un respaldo como subido SOLO si no cambió mientras se subía. */
export const marcarRespaldoSubidoSiSinCambios = async (id: string, updatedAt: string): Promise<boolean> => {
  const f = await leerRespaldo(id);
  if (!f || f.updated_at !== updatedAt) return false;
  const r = ruta(id);
  if (!r) return false;
  await FileSystem.writeAsStringAsync(r, JSON.stringify({ ...f, sincronizado: true }));
  return true;
};
