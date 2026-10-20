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

/**
 * Marca de "el servidor ya no tiene este seguimiento" (HTTP 410).
 *
 * Se usa una propiedad en el Error (no una subclase) porque `instanceof`
 * puede fallar tras un recargado en caliente del bundle en React Native.
 * El sincronizador y el detalle lo consultan para descartar la copia local
 * en vez de reintentar para siempre.
 */
export const esSeguimientoEliminado = (error: unknown): boolean =>
  !!(error as { seguimientoEliminado?: boolean })?.seguimientoEliminado;

const errorEliminado = (mensaje?: string): Error => {
  const err = new Error(mensaje || 'Este seguimiento fue eliminado en el servidor.');
  (err as Error & { seguimientoEliminado?: boolean }).seguimientoEliminado = true;
  return err;
};

/** Registrar un nuevo seguimiento. Lanza Error con mensaje claro si el servidor lo rechaza o no hay red. */
export const registrarSeguimiento = async (datos: NuevoSeguimiento): Promise<Seguimiento> => {
  try {
    const response = await apiClient.post('/api/seguimientos', datos);
    return response.data.seguimiento;
  } catch (error: any) {
    const mensajeServidor = error?.response?.data?.mensaje;
    // 410 = un admin/coordinador lo eliminó (tumba en seguimientos_eliminados).
    // No es un fallo de red: se marca para que el sync descarte la copia local.
    if (error?.response?.status === 410) throw errorEliminado(mensajeServidor);
    if (mensajeServidor) throw new Error(mensajeServidor);
    throw new Error('No se pudo registrar el seguimiento — verifica tu conexión a internet.');
  }
};

/** Eliminar un seguimiento del servidor — solo el autor puede eliminar el suyo. */
export const eliminarSeguimiento = async (id: string): Promise<void> => {
  try {
    await apiClient.delete(`/api/seguimientos/${encodeURIComponent(id)}`);
  } catch (error: any) {
    const status = error?.response?.status;
    // 404/410 = ya no existe en el servidor: el objetivo del borrado está
    // cumplido, así que se considera exitoso en vez de mostrar un error.
    if (status === 404 || status === 410) return;
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
    // 410 = el seguimiento fue eliminado en el servidor: la corrección ya no
    // aplica y la copia local debe descartarse.
    if (error?.response?.status === 410) throw errorEliminado(mensajeServidor);
    if (mensajeServidor) throw new Error(mensajeServidor);
    throw new Error('No se pudo actualizar el seguimiento — verifica tu conexión a internet.');
  }
};
