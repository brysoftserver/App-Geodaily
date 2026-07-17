// ============================================================
// GEODAILY — Servicio de Revisiones de Formularios
// Flujo jerárquico: técnico finaliza → supervisor revisa (novedades /
// visto bueno) → solo entonces el interventor puede ver y revisar.
// ============================================================

import apiClient, { isOfflineError } from './api';

export interface Revision {
  id: number;
  formulario_id: string;
  revisor_id: string;
  revisor_nombre: string | null;
  revisor_rol: 'supervisor' | 'interventor' | 'gerente' | 'admin';
  tipo: 'novedad' | 'visto_bueno' | 'formulario_rol';
  comentario: string | null;
  datos_formulario_json: Record<string, unknown> | null;
  created_at: string;
}

export interface EstadoRevision {
  supervisor: 'ok' | 'novedades' | null;
  interventor: 'ok' | 'novedades' | null;
  gerente: 'ok' | 'novedades' | null;
  admin: 'ok' | 'novedades' | null;
  novedades_total: number;
}

/** Historial de revisiones de un formulario. */
export const fetchRevisiones = async (formularioId: string): Promise<Revision[]> => {
  try {
    const response = await apiClient.get(`/api/revisiones/${encodeURIComponent(formularioId)}`);
    return response.data?.revisiones || [];
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Revisiones] Offline — sin historial de revisiones');
      return [];
    }
    console.warn('[Revisiones] Error consultando:', error);
    return [];
  }
};

/** Resumen de estados de TODOS los formularios (para badges en listados). */
export const fetchResumenRevisiones = async (): Promise<Record<string, EstadoRevision>> => {
  try {
    const response = await apiClient.get('/api/revisiones/resumen');
    return response.data?.estados || {};
  } catch (error) {
    if (!isOfflineError(error)) console.warn('[Revisiones] Error en resumen:', error);
    return {};
  }
};

/**
 * Registrar una novedad o un visto bueno. Lanza Error con mensaje claro
 * si el servidor lo rechaza (jerarquía, permisos, duplicado) o no hay red.
 */
export const registrarRevision = async (
  formularioId: string,
  tipo: 'novedad' | 'visto_bueno' | 'formulario_rol',
  comentario?: string,
  datosFormulario?: Record<string, unknown>
): Promise<void> => {
  try {
    await apiClient.post(`/api/revisiones/${encodeURIComponent(formularioId)}`, {
      tipo,
      comentario,
      datos_formulario: datosFormulario,
    });
  } catch (error: any) {
    const mensajeServidor = error?.response?.data?.mensaje;
    if (mensajeServidor) throw new Error(mensajeServidor);
    throw new Error('No se pudo registrar la revisión — verifica tu conexión a internet.');
  }
};
