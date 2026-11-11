// ============================================================
// GEODAILY — Diagnóstico remoto de errores del cliente
// ============================================================
// Cuando algo crítico falla en el teléfono (p. ej. el guardado local de un
// Acta de Entrega), el error real quedaba solo en la consola del aparato y
// no había forma de saber la causa desde el servidor. Aquí se manda al
// backend (POST /api/diagnostico/cliente) sin bloquear al técnico.
//
// Sin señal, el reporte se guarda en una cola pequeña (máx. 20) y se envía
// en la próxima sincronización. Nunca lanza.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import apiClient from './api';
import { API_CONFIG } from '../theme';

const COLA = 'geodaily.diagnostico.pendientes';
const MAX_COLA = 20;

interface Reporte {
  contexto: string;
  mensaje: string;
  detalle: Record<string, any>;
  app_version: string | null;
  plataforma: string;
  fecha: string;
}

/** Texto legible de cualquier error (incluye la causa nativa si la trae). */
export const textoError = (e: unknown): string => {
  if (!e) return '';
  const err = e as { message?: string; cause?: { message?: string }; code?: string };
  const partes = [err.message || String(e)];
  if (err.cause?.message) partes.push(`causa: ${err.cause.message}`);
  if (err.code) partes.push(`código: ${err.code}`);
  return partes.join(' · ').slice(0, 2000);
};

const versionApp = (): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Updates = require('expo-updates');
    return `${Updates.runtimeVersion ?? '?'}/${Updates.updateId ?? 'embedded'}`;
  } catch {
    return null;
  }
};

const enviar = async (r: Reporte): Promise<boolean> => {
  try {
    await apiClient.post(`${API_CONFIG.ENDPOINTS.DIAGNOSTICO}/cliente`, r, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
};

const encolar = async (r: Reporte): Promise<void> => {
  try {
    const crudo = await AsyncStorage.getItem(COLA);
    const lista: Reporte[] = crudo ? JSON.parse(crudo) : [];
    lista.push(r);
    await AsyncStorage.setItem(COLA, JSON.stringify(lista.slice(-MAX_COLA)));
  } catch {
    // Sin espacio para el diagnóstico: no es crítico.
  }
};

/** Reporta un error al servidor (o lo deja en cola). No espera ni lanza. */
export const reportarDiagnostico = (contexto: string, error: unknown, detalle: Record<string, any> = {}): void => {
  const r: Reporte = {
    contexto,
    mensaje: textoError(error),
    detalle,
    app_version: versionApp(),
    plataforma: `${Platform.OS} ${String(Platform.Version ?? '')}`.trim(),
    fecha: new Date().toISOString(),
  };
  void (async () => {
    if (!(await enviar(r))) await encolar(r);
  })();
};

/** Envía los reportes que quedaron en cola sin señal. Nunca lanza. */
export const enviarDiagnosticosPendientes = async (): Promise<void> => {
  try {
    const crudo = await AsyncStorage.getItem(COLA);
    if (!crudo) return;
    const lista: Reporte[] = JSON.parse(crudo);
    const quedan: Reporte[] = [];
    for (const r of lista) {
      if (!(await enviar(r))) quedan.push(r);
    }
    if (quedan.length) await AsyncStorage.setItem(COLA, JSON.stringify(quedan));
    else await AsyncStorage.removeItem(COLA);
  } catch {
    // no crítico
  }
};
