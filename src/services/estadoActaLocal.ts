// ============================================================
// GEODAILY — Estado del Acta de Entrega desde lo guardado en el teléfono
// ============================================================
// Solo lectura y sin red (para listas: rápido y sin efectos). El detalle de
// la entrega hace además la consulta al servidor y republica cambios.
// ============================================================

import { idOtroFormato, getOtrosFormatosLocales, OtroFormatoLocal } from './database';
import { listarRespaldos } from './otrosFormatosRespaldo';
import { obtenerFormatoLocalPorId, borradorActaRespaldado } from './otrosFormatos.service';
import { cargarDatosOtroFormato } from '../store/OtrosFormatosDraftStore';
import { ActaSegunTelefono, esFirmaDibujada, limpiarFaltantes } from '../utils/estadoActa';

export type EstadoActaLocal = ActaSegunTelefono;

export const leerEstadoActaLocal = async (cedula?: string | null, instancia?: string | null): Promise<EstadoActaLocal> => {
  if (!cedula) return { estado: 'sin_diligenciar', faltantes: [], firmaInterventoria: false };
  try {
    const completada = await obtenerFormatoLocalPorId(idOtroFormato('acta_entrega_individual', cedula, instancia));
    if (completada) {
      return {
        estado: completada.sincronizado ? 'completada' : 'pendiente_subir',
        faltantes: limpiarFaltantes(completada.datos?.faltantes),
        firmaInterventoria: esFirmaDibujada(completada.datos?.firmaInterventoria),
      };
    }
    const clave = `${cedula}__${instancia}`;
    const borrador = await cargarDatosOtroFormato('acta_entrega_individual', clave);
    if (borrador) {
      return {
        estado: (await borradorActaRespaldado(cedula, String(instancia ?? ''))) ? 'borrador_respaldado' : 'borrador',
        faltantes: [],
        firmaInterventoria: false,
      };
    }
  } catch {
    // Sin acceso a la base local: se muestra como sin diligenciar.
  }
  return { estado: 'sin_diligenciar', faltantes: [], firmaInterventoria: false };
};

/**
 * Actas completadas guardadas en este teléfono para (beneficiario, actividad):
 * SQLite + respaldo en archivo, la versión más nueva de cada una. Sirve para
 * mostrar al instante (sin esperar la subida) el acta recién completada.
 * Nunca lanza.
 */
export const actasLocalesDeActividad = async (cedula: string, actividadId: string): Promise<OtroFormatoLocal[]> => {
  const porId = new Map<string, OtroFormatoLocal>();
  const sumar = (f: OtroFormatoLocal) => {
    if (f.tipo !== 'acta_entrega_individual' || !f.completo) return;
    if (f.beneficiario_cedula !== cedula || String(f.datos?.actividadId ?? '') !== actividadId) return;
    const otro = porId.get(f.id);
    if (!otro || String(f.updated_at || '') > String(otro.updated_at || '')) porId.set(f.id, f);
  };
  try {
    (await getOtrosFormatosLocales(cedula)).forEach(sumar);
  } catch {
    // Sin base local: se sigue con el respaldo.
  }
  try {
    (await listarRespaldos()).forEach(sumar);
  } catch {
    // Sin respaldo: no pasa nada.
  }
  return [...porId.values()];
};
