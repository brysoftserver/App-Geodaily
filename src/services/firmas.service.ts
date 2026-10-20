// ============================================================
// GEODAILY — Servicio de Firmas (subida a MinIO)
// ============================================================

import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';
import { recordSyncFailure } from './syncDiagnostics';

/**
 * Subir una firma (base64) al servidor
 * @param tipo 'beneficiario' | 'tecnico' | 'revisor' (revisor = coordinador/interventor/gerente/admin en su sección de evidencia)
 * @param dataBase64 data:image/png;base64,...
 */
export const subirFirma = async (
  tipo: 'beneficiario' | 'tecnico' | 'revisor',
  dataBase64: string,
  beneficiarioCedula?: string,
  beneficiarioNombre?: string,
  tipoFormulario?: string,
  evidenciaId?: string
): Promise<{ id: string; ruta: string; estado: string } | null> => {
  try {
    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.FIRMAS + '/subir',
      { tipo, data: dataBase64, beneficiario_cedula: beneficiarioCedula, beneficiario_nombre: beneficiarioNombre, tipo_formulario: tipoFormulario, evidencia_id: evidenciaId },
      { timeout: 15000 }
    );
    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Firmas] Offline — firma guardada solo localmente');
      return null;
    }
    console.error('[Firmas] Error:', error);
    // Motivo visible en la UI (ver syncDiagnostics).
    recordSyncFailure('firma', error);
    return null;
  }
};

/**
 * El servidor rechazó la firma por PERMISOS (403).
 *
 * No es un problema de conexión: la firma NO debe guardarse localmente como
 * si fuera a sincronizarse después, porque el guardado del formulario la
 * reenviaría y saltaría la regla que la rechazó. Quien llama debe mostrar el
 * mensaje del servidor y abortar.
 */
export class FirmaNoPermitidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'FirmaNoPermitidaError';
  }
}

/**
 * Subir firma y asociarla directamente a un formulario
 */
export const guardarFirmaEnFormulario = async (
  formularioId: string,
  tipo: 'beneficiario' | 'tecnico',
  dataBase64: string,
  beneficiarioCedula?: string,
  beneficiarioNombre?: string,
  tipoFormulario?: string
): Promise<{ id: string; ruta: string; estado: string } | null> => {
  try {
    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.FIRMAS + '/guardar-en-formulario',
      { formulario_id: formularioId, tipo, data: dataBase64, beneficiario_cedula: beneficiarioCedula, beneficiario_nombre: beneficiarioNombre, tipo_formulario: tipoFormulario },
      { timeout: 15000 }
    );
    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Firmas] Offline — firma no asociada al formulario');
      return null;
    }
    // 403: regla del servidor (p. ej. firma faltante y no es admin). Se
    // propaga para no simular un guardado local que luego el sync reenviaría.
    const estado = (error as { response?: { status?: number; data?: { mensaje?: string } } })?.response;
    if (estado?.status === 403) {
      throw new FirmaNoPermitidaError(
        estado.data?.mensaje || 'No tienes permiso para registrar esta firma.'
      );
    }
    console.error('[Firmas] Error:', error);
    return null;
  }
};
