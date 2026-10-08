// ============================================================
// GEODAILY — API de borradores en la nube
// ============================================================

import apiClient from './api';
import type { FormDraft } from '../store/FormDraftStore';

const ENDPOINT = '/api/borradores';

const prepararPayload = (draft: FormDraft): FormDraft => ({
  ...draft,
  // Las rutas file:// solo existen en el dispositivo que capturó la evidencia.
  // Las fotos/videos se sincronizan por la cola de medios y se vuelven a
  // asociar desde /api/archivos/formulario/:id al abrir en otro dispositivo.
  fotos: (draft.fotos || []).filter((foto) => !foto.uri?.startsWith('file://')),
});

export const listarBorradoresDelServidor = async (): Promise<FormDraft[]> => {
  const response = await apiClient.get(ENDPOINT, { timeout: 20000 });
  if (response.data?.estado !== 'ok' || !Array.isArray(response.data?.borradores)) {
    throw new Error('Respuesta inválida al consultar borradores remotos');
  }
  return response.data.borradores as FormDraft[];
};

export const guardarBorradorEnServidor = async (
  draft: FormDraft
): Promise<'saved' | 'conflict' | 'completed' | 'failed'> => {
  try {
    await apiClient.put(
      `${ENDPOINT}/${encodeURIComponent(draft.id)}`,
      prepararPayload(draft),
      { timeout: 30000 }
    );
    return 'saved';
  } catch (error) {
    const status = (error as { response?: { status?: number; data?: { estado?: string } } })?.response?.status;
    const estado = (error as { response?: { data?: { estado?: string } } })?.response?.data?.estado;
    if (status === 409 && estado === 'completado') return 'completed';
    if (status === 409) return 'conflict';
    console.warn('[Borradores] No se pudo subir el borrador:', draft.id, error);
    return 'failed';
  }
};

export const eliminarBorradorDelServidor = async (id: string): Promise<boolean> => {
  try {
    await apiClient.delete(`${ENDPOINT}/${encodeURIComponent(id)}`, { timeout: 15000 });
    return true;
  } catch (error) {
    console.warn('[Borradores] No se pudo eliminar el borrador remoto:', id, error);
    return false;
  }
};

const borradoresPendientes = new Map<string, FormDraft>();
const timersPendientes = new Map<string, ReturnType<typeof setTimeout>>();

export const programarSubidaBorrador = (draft: FormDraft): void => {
  borradoresPendientes.set(draft.id, draft);
  const timerAnterior = timersPendientes.get(draft.id);
  if (timerAnterior) clearTimeout(timerAnterior);

  const timer = setTimeout(() => {
    timersPendientes.delete(draft.id);
    const pendiente = borradoresPendientes.get(draft.id);
    if (!pendiente) return;
    borradoresPendientes.delete(draft.id);
    void guardarBorradorEnServidor(pendiente);
  }, 1800);

  timersPendientes.set(draft.id, timer);
};

export const cancelarSubidaBorrador = (id: string): void => {
  const timer = timersPendientes.get(id);
  if (timer) clearTimeout(timer);
  timersPendientes.delete(id);
  borradoresPendientes.delete(id);
};

export const vaciarColaBorradores = async (usuarioId: string): Promise<void> => {
  const pendientes = Array.from(borradoresPendientes.entries()).filter(
    ([, draft]) => draft.tecnico?.usuario_id === usuarioId
  );
  for (const [id, draft] of pendientes) {
    cancelarSubidaBorrador(id);
    await guardarBorradorEnServidor(draft);
  }
};