// ============================================================
// GEODAILY — "Ya corregí": el técnico avisa que atendió las novedades
// ============================================================
// Registra una corrección explícita (acción 'marcar_novedad_corregida') para
// los arreglos que no quedan como respuesta (polígono, fotos...). Las
// novedades pasan a "corregida — por verificar" y se avisa al revisor.
// Requiere conexión. Ver backend/src/routes/novedadesCorregidas.js.
// ============================================================

import apiClient from './api';

export const marcarNovedadesCorregidas = async (formularioId: string, comentario: string): Promise<void> => {
  await apiClient.post(`/api/novedades-corregidas/${encodeURIComponent(formularioId)}`, { comentario }, { timeout: 15000 });
};
