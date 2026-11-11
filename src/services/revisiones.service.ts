// ============================================================
// GEODAILY — Servicio de Revisiones de Formularios
// Flujo jerárquico: técnico finaliza → coordinador revisa (novedades /
// visto bueno) → solo entonces el interventor puede ver y revisar.
// ============================================================

import apiClient, { isOfflineError } from './api';

export interface Revision {
  id: number;
  formulario_id: string;
  revisor_id: string;
  revisor_nombre: string | null;
  revisor_rol: 'coordinador' | 'interventor' | 'gerente' | 'admin';
  /** 'formulario_rol' es el tipo histórico (antes de dividirse en línea/campo) — se conserva solo para leer datos viejos */
  tipo: 'novedad' | 'visto_bueno' | 'formulario_rol' | 'formulario_en_linea' | 'formulario_en_campo';
  /** Sección del formulario clonado a la que aplica (null = revisión global) */
  seccion?: string | null;
  comentario: string | null;
  datos_formulario_json: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Referencia a un archivo ya subido a MinIO (vía /api/photos, /api/videos
 * o /api/firmas) — el registro de evidencia del revisor solo guarda el id,
 * el binario vive en MinIO y se sirve por /api/archivos/:id/contenido.
 */
export interface ArchivoRevisorRef {
  archivo_id: string;
  /** uri local (este dispositivo) — solo para vista previa inmediata, puede no existir en otros dispositivos */
  uri?: string;
}

export interface EvidenciaRevisor {
  id: number;
  formulario_id: string;
  revisor_id: string;
  revisor_nombre: string | null;
  revisor_rol: 'coordinador' | 'interventor' | 'gerente' | 'admin';
  fotos_json: ArchivoRevisorRef[];
  videos_json: ArchivoRevisorRef[];
  /** Id de archivo en MinIO (registros nuevos) o base64 "data:image/..." (registros antiguos, previos a esta migración) */
  firma_beneficiario: string | null;
  /** Id de archivo en MinIO (registros nuevos) o base64 "data:image/..." (registros antiguos, previos a esta migración) */
  firma_revisor: string | null;
  geo_latitud: number | null;
  geo_longitud: number | null;
  geo_altitud: number | null;
  observaciones: string | null;
  created_at: string;
}

export interface EstadoRevision {
  coordinador: 'ok' | 'novedades' | null;
  interventor: 'ok' | 'novedades' | null;
  gerente: 'ok' | 'novedades' | null;
  admin: 'ok' | 'novedades' | null;
  novedades_total: number;
  /**
   * De `novedades_total`, cuántas ya corrigió el técnico después de que se
   * marcaran (siguen abiertas hasta el visto bueno del revisor). Opcional:
   * un backend anterior no lo envía.
   */
  por_verificar?: number;
  /** Fecha de la última corrección del técnico (si hay alguna por verificar). */
  ultima_correccion?: string | null;
  // ── Estado del flujo (backend/src/lib/estadoRevision.js). Opcionales:
  //    un backend anterior no los envía. ──
  estado_flujo?: EstadoFlujo;
  /** Rol de la fase actual (null = aprobado por ambos). */
  rol_flujo?: 'coordinador' | 'interventor' | null;
  /** A quién le toca actuar ('tecnico' o el rol revisor). */
  turno?: 'tecnico' | 'coordinador' | 'interventor' | null;
  novedades_fase?: number;
  por_verificar_fase?: number;
  secciones_aprobadas?: number;
  /** Último movimiento (revisión o corrección): para medir días sin avance. */
  ultimo_movimiento?: string | null;
}

/**
 * Estado del flujo de revisión:
 *  sin_revisar → (por_corregir ⇄ por_verificar) → por_cerrar → en_interventoria → … → aprobado
 */
export type EstadoFlujo =
  | 'sin_revisar'
  | 'por_corregir'
  | 'por_verificar'
  | 'por_cerrar'
  | 'en_interventoria'
  | 'aprobado';

/** Estado del flujo de UN formulario, tal como lo entrega GET /api/revisiones/:id. */
export interface FlujoRevision extends EstadoRevision {
  novedades_abiertas_ids?: number[];
  secciones_aprobadas_por_rol?: Record<string, string[]>;
  cerrado_por_rol?: Record<string, boolean>;
}

/**
 * Corrección explícita del técnico sobre el formulario (completar/corregir
 * una respuesta o eliminar una evidencia), registrada por el backend.
 */
export interface Correccion {
  id: string;
  accion: 'corregir_respuesta' | 'completar_respuesta' | 'eliminar_evidencia' | 'marcar_novedad_corregida';
  usuario_id: string;
  usuario_nombre: string | null;
  /** Ruta de la respuesta corregida (null al eliminar evidencias). */
  path: string | null;
  /** Comentario del técnico al marcar "Ya corregí" (solo 'marcar_novedad_corregida'). */
  comentario?: string | null;
  created_at: string;
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

/**
 * Historial de revisiones + correcciones del técnico de un formulario.
 * Mismas reglas de red que `fetchRevisiones` (offline → listas vacías).
 */
export const fetchRevisionesYCorrecciones = async (
  formularioId: string
): Promise<{ revisiones: Revision[]; correcciones: Correccion[]; flujo: FlujoRevision | null }> => {
  try {
    const response = await apiClient.get(`/api/revisiones/${encodeURIComponent(formularioId)}`);
    return {
      revisiones: response.data?.revisiones || [],
      correcciones: response.data?.correcciones || [],
      flujo: response.data?.flujo || null,
    };
  } catch (error) {
    if (!isOfflineError(error)) console.warn('[Revisiones] Error consultando:', error);
    return { revisiones: [], correcciones: [], flujo: null };
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
  tipo: 'novedad' | 'visto_bueno' | 'formulario_en_linea' | 'formulario_en_campo',
  comentario?: string,
  datosFormulario?: Record<string, unknown>,
  seccion?: string
): Promise<void> => {
  try {
    await apiClient.post(`/api/revisiones/${encodeURIComponent(formularioId)}`, {
      tipo,
      comentario,
      datos_formulario: datosFormulario,
      seccion,
    });
  } catch (error: any) {
    const mensajeServidor = error?.response?.data?.mensaje;
    if (mensajeServidor) throw new Error(mensajeServidor);
    throw new Error('No se pudo registrar la revisión — verifica tu conexión a internet.');
  }
};

/** Guardar (o actualizar) la evidencia final del revisor para este formulario. */
export const guardarEvidenciaRevisor = async (
  formularioId: string,
  datos: {
    fotos?: ArchivoRevisorRef[];
    videos?: ArchivoRevisorRef[];
    /** Id de archivo en MinIO devuelto por subirFirma() */
    firma_beneficiario?: string;
    /** Id de archivo en MinIO devuelto por subirFirma() */
    firma_revisor?: string;
    geo_latitud?: number;
    geo_longitud?: number;
    geo_altitud?: number;
    observaciones?: string;
  }
): Promise<void> => {
  try {
    await apiClient.post(`/api/revisiones/${encodeURIComponent(formularioId)}/evidencia`, datos);
  } catch (error: any) {
    const mensajeServidor = error?.response?.data?.mensaje;
    if (mensajeServidor) throw new Error(mensajeServidor);
    throw new Error('No se pudo guardar la evidencia — verifica tu conexión a internet.');
  }
};

/** Evidencias finales ya registradas para un formulario (una por rol revisor). */
export const fetchEvidenciasRevisor = async (formularioId: string): Promise<EvidenciaRevisor[]> => {
  try {
    const response = await apiClient.get(`/api/revisiones/${encodeURIComponent(formularioId)}/evidencia`);
    return response.data?.evidencias || [];
  } catch (error) {
    if (!isOfflineError(error)) console.warn('[Revisiones] Error consultando evidencia:', error);
    return [];
  }
};
