// ============================================================
// GEODAILY — Abrir el Detalle de un formulario (solo lectura)
// ============================================================
// Lo usan las actividades para llevar de un beneficiario a la visita que la
// respalda. Se abre SIN `modo`: el formulario se ve tal cual lo diligenció el
// técnico (el modo 'online'/'campo' añade los controles de Novedad/Aprobado).
// ============================================================

import { fetchFormularioDelServidor } from '../services/formularios.service';
import { avisar } from './dialogos';

/** Nombre de la pantalla de detalle registrada en el navegador de cada rol. */
const pantallaDetalleDe = (rol?: string): string =>
  rol === 'tecnico' ? 'FormularioDetail' : rol === 'interventor' ? 'InterventorFormularioDetail' : 'SupervisionFormularioDetail';

/** Devuelve true si abrió el formulario. */
export const abrirDetalleFormulario = async (
  navigation: { navigate: (pantalla: string, params: object) => void },
  rol: string | undefined,
  formularioId: string
): Promise<boolean> => {
  const formulario = await fetchFormularioDelServidor(formularioId);
  if (!formulario) {
    avisar(
      'No se pudo abrir',
      'No se encontró el formulario o no tienes acceso a él (lo diligenció otro técnico). Verifica tu conexión.'
    );
    return false;
  }
  navigation.navigate(pantallaDetalleDe(rol), { formulario });
  return true;
};
