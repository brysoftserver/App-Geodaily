// ============================================================
// GEODAILY — Informe PDF del Análisis de Suelos
// ============================================================
// El PDF se genera en el SERVIDOR (Chromium) y queda guardado en el
// historial: membrete y "Página X de Y" en todas las páginas, igual en web,
// Android e iOS. La app solo lo pide, lo descarga y lo abre. Reabrir un
// informe del historial devuelve exactamente el mismo archivo.
// (El diseño del PDF vive en backend/src/lib/informeSuelosPdf.js.)
// ============================================================

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { avisar } from '../utils/dialogos';
import { abrirPdf } from './informeTecnicoPdf.service';
import { getApiAuthToken } from './api';
import { API_CONFIG } from '../theme';
import { pedirInformeSuelos } from './analisisSuelos.service';

const ENDPOINT = API_CONFIG.ENDPOINTS.ANALISIS_SUELOS;

/** Descarga el PDF guardado de un informe y lo abre (nativo) o lo descarga (web). */
async function abrirPdfDeInforme(id: number): Promise<void> {
  const url = `${API_CONFIG.BASE_URL}${ENDPOINT}/informes/${id}/pdf`;
  const token = await getApiAuthToken();
  if (Platform.OS === 'web') {
    // El navegador descarga el archivo directamente (el servidor pone el nombre).
    const a = document.createElement('a');
    a.href = `${url}?descargar=1${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    a.download = `Analisis_Suelos_N${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const destino = `${FileSystem.cacheDirectory}Analisis_Suelos_N${id}.pdf`;
  const { uri, status } = await FileSystem.downloadAsync(url, destino, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (status !== 200) throw new Error(`Descarga fallida (${status})`);
  await abrirPdf(uri);
}

/**
 * Genera un informe NUEVO en el servidor (queda en el historial) y lo abre.
 * `tecnico` = usuario del técnico; sin él, informe de todos los predios.
 */
export async function generarYAbrirInformeSuelos(opts: { tecnico?: string }): Promise<boolean> {
  try {
    const informe = await pedirInformeSuelos(opts.tecnico);
    await abrirPdfDeInforme(informe.informe.id);
    return true;
  } catch (error: any) {
    console.warn('[Suelos PDF] Error:', error?.message || error);
    avisar('No se pudo generar el informe', 'Verifica tu conexión a internet e inténtalo de nuevo.');
    return false;
  }
}

/** Reabre un informe del historial: el mismo PDF que se generó. */
export async function abrirInformeSuelosGuardado(id: number): Promise<void> {
  try {
    await abrirPdfDeInforme(id);
  } catch (error: any) {
    console.warn('[Suelos PDF] Error abriendo informe guardado:', error?.message || error);
    avisar('No se pudo abrir el informe', 'Verifica tu conexión a internet e inténtalo de nuevo.');
  }
}
