// ============================================================
// GEODAILY — Servicio de Firmas (subida a MinIO)
// ============================================================

import apiClient, { isOfflineError } from './api';
import { API_CONFIG } from '../theme';

/**
 * Subir una firma (base64) al servidor
 * @param tipo 'beneficiario' | 'tecnico' | 'revisor' (revisor = supervisor/interventor/gerente/admin en su sección de evidencia)
 * @param dataBase64 data:image/png;base64,...
 */
export const subirFirma = async (
  tipo: 'beneficiario' | 'tecnico' | 'revisor',
  dataBase64: string,
  beneficiarioCedula?: string,
  beneficiarioNombre?: string,
  tipoFormulario?: string
): Promise<{ id: string; ruta: string; estado: string } | null> => {
  try {
    const response = await apiClient.post(
      API_CONFIG.ENDPOINTS.FIRMAS + '/subir',
      { tipo, data: dataBase64, beneficiario_cedula: beneficiarioCedula, beneficiario_nombre: beneficiarioNombre, tipo_formulario: tipoFormulario },
      { timeout: 15000 }
    );
    return response.data;
  } catch (error) {
    if (isOfflineError(error)) {
      console.warn('[Firmas] Offline — firma guardada solo localmente');
      return null;
    }
    console.error('[Firmas] Error:', error);
    return null;
  }
};

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
    console.error('[Firmas] Error:', error);
    return null;
  }
};
