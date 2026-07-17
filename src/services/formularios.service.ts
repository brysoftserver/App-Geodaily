// ============================================================
// GEODAILY — Servicio de Formularios (API remota)
// ============================================================

import { Formulario, VisitaProgramada } from '../types';
import apiClient from './api';
import { API_CONFIG } from '../theme';

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
 * Obtener todos los formularios desde el servidor
 */
export const fetchFormulariosDelServidor = async (): Promise<Formulario[]> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.FORMS, {
      timeout: 15000,
    });

    if (response.data?.estado === 'ok' && Array.isArray(response.data?.formularios)) {
      const forms = response.data.formularios.map(mapearFormularioServidor);
      console.log(`[API Forms] ${forms.length} formularios obtenidos del servidor`);
      return forms;
    }

    console.warn('[API Forms] Respuesta inesperada:', response.data);
    return [];
  } catch (error) {
    const err = error as any;
    if (err?.isOffline) {
      console.warn('[API Forms] Sin conexión — no se pueden obtener formularios del servidor');
    } else {
      console.error('[API Forms] Error:', err?.message || error);
    }
    return [];
  }
};

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
export const eliminarVisitaProgramadaDelServidor = async (id: string): Promise<void> => {
  try {
    await apiClient.delete(`${API_CONFIG.ENDPOINTS.VISITAS_PROGRAMADAS}/${id}`);
  } catch (error) {
    const err = error as any;
    console.warn('[API Forms] No se pudo eliminar visita programada en servidor:', err?.message || error);
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
