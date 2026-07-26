// ============================================================
// GEODAILY — Notificaciones en-app (bandeja + contador)
// ============================================================

import apiClient from './api';

export interface NotificacionApp {
  id: number;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  formulario_id: string | null;
  leida: boolean;
  created_at: string;
}

export const fetchNotificaciones = async (): Promise<NotificacionApp[]> => {
  try {
    const res = await apiClient.get('/api/notificaciones');
    return res.data?.notificaciones || [];
  } catch (error) {
    console.warn('[Notificaciones] Error al listar:', error);
    return [];
  }
};

export const fetchContadorNoLeidas = async (): Promise<number> => {
  try {
    const res = await apiClient.get('/api/notificaciones/no-leidas/count');
    return res.data?.total || 0;
  } catch (error) {
    console.warn('[Notificaciones] Error al contar:', error);
    return 0;
  }
};

export const marcarNotificacionLeida = async (id: number): Promise<void> => {
  try {
    await apiClient.post(`/api/notificaciones/${id}/leer`);
  } catch (error) {
    console.warn('[Notificaciones] Error al marcar leída:', error);
  }
};

export const marcarTodasLeidas = async (): Promise<void> => {
  try {
    await apiClient.post('/api/notificaciones/leer-todas');
  } catch (error) {
    console.warn('[Notificaciones] Error al marcar todas leídas:', error);
  }
};
