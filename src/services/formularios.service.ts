// ============================================================
// GEODAILY — Servicio de Formularios (API remota)
// ============================================================

import { Formulario, VisitaProgramada } from '../types';
import apiClient from './api';
import { API_CONFIG } from '../theme';
import { deleteFormularioLocal, deleteVisitaProgramadaLocal } from './database';

/**
 * Mapea los nombres de columnas JSONB del backend (tecnico_json, beneficiario_json, ...)
 * a los nombres esperados por la interfaz Formulario (tecnico, beneficiario, ...).
 * El driver pg devuelve JSONB como objeto JS, pero la clave sigue siendo <columna>_json.
 */
function mapearFormularioServidor(raw: Record<string, any>): Formulario {
  const SUFIJO = '_json';
  const mapeo: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (key.endsWith(SUFIJO)) {
      const target = key.slice(0, -SUFIJO.length);
      mapeo[target] = key;
    }
  }
  const result: Record<string, any> = { ...raw };
  for (const [target, source] of Object.entries(mapeo)) {
    if (raw[source] !== undefined) {
      result[target] = raw[source];
    }
  }
  return result as Formulario;
}

/**
 * Obtener todos los formularios desde el servidor.
 *
 * @param opts.vista  'calendario' pide la vista universal: el backend
 *   ignora el filtro "solo mis formularios" (técnico) y la jerarquía de
 *   aprobación (interventor), porque el calendario debe mostrar exactamente
 *   las mismas visitas realizadas a todos los roles. Sin este flag, el
 *   comportamiento es el de siempre (cada rol ve lo que le corresponde).
 */
export const fetchFormulariosDelServidorConEstado = async (
  opts?: { vista?: 'calendario' }
): Promise<{ formularios: Formulario[]; ok: boolean }> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.FORMS, {
      timeout: 15000,
      params: opts?.vista ? { vista: opts.vista } : undefined,
    });

    if (response.data?.estado === 'ok' && Array.isArray(response.data?.formularios)) {
      const forms = response.data.formularios.map(mapearFormularioServidor);
      console.log(`[API Forms] ${forms.length} formularios obtenidos del servidor`);
      return { formularios: forms, ok: true };
    }

    console.warn('[API Forms] Respuesta inesperada:', response.data);
    return { formularios: [], ok: false };
  } catch (error) {
    const err = error as any;
    if (err?.isOffline) {
      console.warn('[API Forms] Sin conexión — no se pueden obtener formularios del servidor');
    } else {
      console.error('[API Forms] Error:', err?.message || error);
    }
    return { formularios: [], ok: false };
  }
};

/**
 * Igual que `fetchFormulariosDelServidorConEstado`, pero solo la lista
 * (vacía si el servidor no respondió). Se conserva para no cambiar a quienes
 * ya la usan.
 */
export const fetchFormulariosDelServidor = async (
  opts?: { vista?: 'calendario' }
): Promise<Formulario[]> => (await fetchFormulariosDelServidorConEstado(opts)).formularios;

/**
 * Obtener las visitas programadas del servidor (compartidas entre el equipo —
 * el técnico solo ve las suyas, roles superiores ven todas).
 */
export const fetchVisitasProgramadasDelServidor = async (): Promise<VisitaProgramada[]> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.VISITAS_PROGRAMADAS, {
      timeout: 15000,
    });

    if (response.data?.estado === 'ok' && Array.isArray(response.data?.visitas)) {
      // Visitas eliminadas en el servidor (por un admin): se borra la copia
      // local de ESTE dispositivo; el calendario une servidor + local y, sin
      // esto, las seguiría mostrando. Best-effort: un fallo no rompe la carga.
      const eliminadas: unknown = response.data?.eliminadas;
      if (Array.isArray(eliminadas)) {
        for (const id of eliminadas) {
          if (typeof id !== 'string') continue;
          try {
            await deleteVisitaProgramadaLocal(id);
          } catch { /* se reintenta en la próxima carga */ }
        }
      }
      return response.data.visitas as VisitaProgramada[];
    }

    return [];
  } catch (error) {
    const err = error as any;
    if (err?.isOffline) {
      console.warn('[API Forms] Sin conexión — no se pueden obtener visitas programadas del servidor');
    } else {
      console.error('[API Forms] Error obteniendo visitas programadas:', err?.message || error);
    }
    return [];
  }
};

/**
 * Eliminar una visita programada en el servidor (best-effort — si está
 * offline, la eliminación local sigue aplicando pero puede reaparecer en
 * el próximo merge con el servidor hasta que se reintente online).
 */
export const eliminarVisitaProgramadaDelServidor = async (id: string): Promise<boolean> => {
  try {
    await apiClient.delete(`${API_CONFIG.ENDPOINTS.VISITAS_PROGRAMADAS}/${id}`);
    return true;
  } catch (error) {
    const err = error as any;
    // 404: ya no existe en el servidor, el objetivo (que no esté) se cumple.
    if (err?.response?.status === 404) return true;
    console.warn('[API Forms] No se pudo eliminar visita programada en servidor:', err?.message || error);
    return false;
  }
};

/**
 * Obtener un formulario por ID desde el servidor
 */
export const fetchFormularioDelServidor = async (id: string): Promise<Formulario | null> => {
  try {
    const response = await apiClient.get(`${API_CONFIG.ENDPOINTS.FORMS}/${id}`, {
      timeout: 15000,
    });

    if (response.data?.estado === 'ok' && response.data?.formulario) {
      return mapearFormularioServidor(response.data.formulario);
    }

    return null;
  } catch (error) {
    const err = error as any;
    console.warn('[API Forms] Error obteniendo formulario:', id, err?.message || error);
    return null;
  }
};

/**
 * Actualiza una respuesta del Formulario 1 ("✎ Completar" / "✎ Corregir").
 *
 * El backend es el que autoriza (PATCH /api/formularios/:id/respuesta, admin
 * o técnico dueño) y el que decide si la pregunta ya tenía respuesta (409).
 * Se propaga el mensaje del servidor tal cual para que la pantalla explique el
 * motivo real en vez de un "Request failed with status code 409".
 *
 * `modo`:
 *   - 'completar' (por defecto): solo escribe si la pregunta estaba vacía.
 *   - 'corregir': sobrescribe una respuesta existente.
 */
export const actualizarRespuestaFormulario = async (
  id: string,
  path: string,
  value: string,
  modo: 'completar' | 'corregir' = 'completar'
): Promise<void> => {
  try {
    await apiClient.patch(`${API_CONFIG.ENDPOINTS.FORMS}/${id}/respuesta`, { path, value, modo });
  } catch (error) {
    const err = error as { response?: { status?: number; data?: { mensaje?: string } }; message?: string };
    const mensajeServidor = err?.response?.data?.mensaje;
    if (mensajeServidor) throw new Error(mensajeServidor);
    if (err?.response?.status === 404) {
      throw new Error('El formulario no existe todavía en el servidor (puede ser una visita sin sincronizar).');
    }
    throw error;
  }
};

/**
 * Eliminar un formulario del servidor — SOLO admin (el backend lo valida
 * de nuevo, esto es solo la puerta de la UI). Borra en cascada revisiones,
 * notificaciones, mediciones, plantaciones y archivos (fotos/videos/firmas/
 * PDFs) asociados, tanto en PostgreSQL como en MinIO.
 * A diferencia de `eliminarVisitaProgramadaDelServidor`, aquí SÍ se
 * propaga el error: es una acción destructiva e irreversible, la pantalla
 * debe saber si falló para no dar una falsa confirmación de éxito.
 *
 * "Formulario no encontrado" no siempre es un error real: puede ser una
 * visita capturada offline que nunca llegó a sincronizarse (solo existe en
 * el SQLite local de ESE dispositivo — el listado la muestra igual porque
 * se lee sin filtrar por usuario). En ese caso no hay nada que borrar en el
 * servidor, así que se cae a borrar la copia local; solo se lanza el error
 * si tampoco había nada local que eliminar.
 */
export const eliminarFormularioDelServidor = async (id: string): Promise<void> => {
  const response = await apiClient.delete(`${API_CONFIG.ENDPOINTS.FORMS}/${id}`);
  if (response.data?.estado === 'ok') {
    // Borrar también la copia local de ESTE dispositivo — si no, el
    // próximo refresco la resucita fusionando lo local con el servidor
    // (el servidor ya no la tiene, pero el SQLite local seguía intacto).
    await deleteFormularioLocal(id);
    return;
  }

  if (response.data?.mensaje === 'Formulario no encontrado') {
    await deleteFormularioLocal(id);
    return;
  }

  throw new Error(response.data?.mensaje || 'No se pudo eliminar el formulario');
};

/**
 * Cambiar la fecha de la visita — SOLO admin (el backend lo valida de nuevo).
 * `fecha` va como AAAA-MM-DD. Sirve para cualquier tipo de formulario.
 * Devuelve el created_at nuevo que fijó el servidor.
 */
export const cambiarFechaFormulario = async (id: string, fecha: string): Promise<string> => {
  try {
    const r = await apiClient.patch(`${API_CONFIG.ENDPOINTS.FORMS}/${encodeURIComponent(id)}/fecha`, { fecha });
    return r.data?.created_at as string;
  } catch (error) {
    const err = error as { response?: { status?: number; data?: { mensaje?: string } } };
    if (err?.response?.data?.mensaje) throw new Error(err.response.data.mensaje);
    if (err?.response?.status === 404) {
      throw new Error('El formulario no existe todavía en el servidor (puede ser una visita sin sincronizar).');
    }
    throw error;
  }
};

/** Cambiar la fecha de un formato de "Otros anexos" — SOLO admin. */
export const cambiarFechaOtroFormato = async (id: string, fecha: string): Promise<string> => {
  try {
    const r = await apiClient.patch(`${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/${encodeURIComponent(id)}/fecha`, { fecha });
    return r.data?.created_at as string;
  } catch (error) {
    const err = error as { response?: { data?: { mensaje?: string } } };
    if (err?.response?.data?.mensaje) throw new Error(err.response.data.mensaje);
    throw error;
  }
};

/** dd/MM/yyyy → AAAA-MM-DD, o null si no es una fecha real. */
export const fechaDMAaISO = (texto: string): string | null => {
  const m = texto.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
