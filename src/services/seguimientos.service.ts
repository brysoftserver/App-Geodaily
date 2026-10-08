// ============================================================
// GEODAILY — Servicio de Seguimientos (Coordinación / Interventoría)
// ============================================================
// Registro de acompañamiento en campo de coordinador o interventor,
// independiente del formulario del técnico — no requiere que exista un
// formulario guardado ni sincronizado (a diferencia de revisiones.service).
// ============================================================

import apiClient, { isOfflineError } from './api';

export interface ArchivoSeguimientoRef {
  archivo_id: string;
  /** uri local (este dispositivo) — solo para vista previa inmediata */
  uri?: string;
}

export interface Seguimiento {
  id: string;
  autor_id: string;
  autor_nombre: string | null;
  autor_rol: 'coordinador' | 'interventor';
  beneficiario_cedula: string | null;
  beneficiario_nombre: string | null;
  /** id de la visita (formulario) desde cuyo detalle se registró el seguimiento — null si fue desde la tarjeta general. */
  formulario_id: string | null;
  actividad: string;
  objetivo_visita: string | null;
  descripcion_actividad: string | null;
  observaciones: string | null;
  fotos_json: ArchivoSeguimientoRef[];
  videos_json: ArchivoSeguimientoRef[];
  /** archivo_id en MinIO (subido vía /api/firmas) */
  firma_beneficiario: string | null;
  /** archivo_id en MinIO — firma de quien registra el seguimiento (coordinador/interventor) */
  firma_autor: string | null;
  geo_latitud: number | null;
  geo_longitud: number | null;
  geo_altitud: number | null;
  geo_precision: number | null;
  /** Confirmación con huella del sensor del dispositivo (atestigua presencia, no identidad del beneficiario) */
  huella_beneficiario: boolean | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface NuevoSeguimiento {
  /** Si se provee, el servidor usa este mismo id (el del registro creado offline) en vez de generar uno nuevo. */
  id?: string;
  actividad: string;
  objetivo_visita?: string;
  descripcion_actividad?: string;
  observaciones?: string;
  fotos?: ArchivoSeguimientoRef[];
  videos?: ArchivoSeguimientoRef[];
  /** archivo_id ya subido a MinIO vía /api/firmas */
  firma_beneficiario?: string;
  /** archivo_id ya subido a MinIO vía /api/firmas */
  firma_autor?: string;
  /** Georeferencia puntual (captura única de 8s de alta precisión — CapturaGPSPrecisa) */
  geo_latitud?: number;
  geo_longitud?: number;
  geo_altitud?: number;
  geo_precision?: number;
  huella_beneficiario?: boolean;
  beneficiario_cedula?: string;
  beneficiario_nombre?: string;
  /** Vincula el seguimiento a la visita (formulario) desde la que se registró. */
  formulario_id?: string;
  /** Solo para correcciones (PATCH): nueva fecha del seguimiento en ISO. El POST lo ignora. */
  created_at?: string;
}

/**
 * Listado de seguimientos + bandera de éxito.
 * `ok = false` significa que NO se pudo consultar el servidor (sin red o error),
 * por lo que el listado vacío NO debe interpretarse como "no hay seguimientos".
 * Es clave para no borrar datos locales válidos cuando estamos offline.
 */
export const fetchSeguimientosConEstado = async (): Promise<{ seguimientos: Seguimiento[]; ok: boolean }> => {
  try {
    const response = await apiClient.get('/api/seguimientos');
    return { seguimientos: response.data?.seguimientos || [], ok: true };
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Seguimientos] Offline — sin listado de seguimientos');
      return { seguimientos: [], ok: false };
    }
    console.warn('[Seguimientos] Error listando:', error);
    return { seguimientos: [], ok: false };
  }
};

/** Listado de seguimientos — coordinador/interventor ven solo los de su propio rol. */
export const fetchSeguimientos = async (): Promise<Seguimiento[]> => {
  const { seguimientos } = await fetchSeguimientosConEstado();
  return seguimientos;
};

/** Registrar un nuevo seguimiento. Lanza Error con mensaje claro si el servidor lo rechaza o no hay red. */
export const registrarSeguimiento = async (datos: NuevoSeguimiento): Promise<Seguimiento> => {
  try {
    const response = await apiClient.post('/api/seguimientos', datos);
    return response.data.seguimiento;
  } catch (error: any) {
    const mensajeServidor = error?.response?.data?.mensaje;
    if (mensajeServidor) throw new Error(mensajeServidor);
    throw new Error('No se pudo registrar el seguimiento — verifica tu conexión a internet.');
  }
};

/** Eliminar un seguimiento del servidor — solo el autor puede eliminar el suyo. */
export const eliminarSeguimiento = async (id: string): Promise<void> => {
  try {
    await apiClient.delete(`/api/seguimientos/${encodeURIComponent(id)}`);
  } catch (error: any) {
    const mensajeServidor = error?.response?.data?.mensaje;
    if (mensajeServidor) throw new Error(mensajeServidor);
    throw new Error('No se pudo eliminar el seguimiento — verifica tu conexión a internet.');
  }
};

/** Guarda la url del PDF ya generado para este seguimiento. */
export const actualizarPdfSeguimiento = async (id: string, pdfUrl: string): Promise<void> => {
  try {
    await apiClient.patch(`/api/seguimientos/${encodeURIComponent(id)}/pdf`, { pdf_url: pdfUrl });
  } catch (error) {
    console.warn('[Seguimientos] No se pudo registrar la url del PDF:', error);
  }
};

/**
 * Corregir/completar un seguimiento ya guardado (patch parcial).
 * Solo se envían los campos presentes en `cambios`; el servidor actualiza
 * únicamente esos y deja el resto intacto. Lanza Error con mensaje claro si
 * el servidor lo rechaza o no hay red.
 */
export const actualizarSeguimiento = async (
  id: string,
  cambios: Partial<NuevoSeguimiento>
): Promise<Seguimiento> => {
  try {
    const response = await apiClient.patch(`/api/seguimientos/${encodeURIComponent(id)}`, cambios);
    return response.data.seguimiento;
  } catch (error: any) {
    const mensajeServidor = error?.response?.data?.mensaje;
    if (mensajeServidor) throw new Error(mensajeServidor);
    throw new Error('No se pudo actualizar el seguimiento — verifica tu conexión a internet.');
  }
};
