import { ROLES_PUEDEN_ELIMINAR_EVIDENCIA } from '../services/archivos.service';

/**
 * Reglas de "¿este usuario puede tocar este formulario?" en el cliente.
 *
 * Vivían dentro de `FormularioDetailScreen`, donde no se podían probar. Se
 * extraen aquí porque tienen que coincidir EXACTAMENTE con lo que valida el
 * backend: si el cliente habilita un botón que el servidor rechaza, el técnico
 * ve el error justo al guardar (así se reportó el caso de la visita heredada,
 * donde el formulario quedaba a nombre del técnico anterior).
 */

export interface ContextoFormulario {
  rol?: string | null;
  /** `usuarioActual.id` de la sesión. */
  usuarioId?: string | null;
  /** Dueño ya resuelto con `resolverDuenoFormulario`. */
  duenoFormulario?: string | null;
}

/** Lo mínimo que se necesita de un formulario para resolver su dueño. */
export interface FormularioConDueno {
  usuario_id?: string | null;
  tecnico?: { usuario_id?: string | null } | null;
}

/**
 * Dueño de la visita, con el MISMO criterio y orden que el backend en
 * `PATCH /formularios/:id/respuesta` y `GET /formularios/:id`:
 *
 *   1. `tecnico.usuario_id` (el snapshot) — es la atribución vigente: se
 *      reescribe al reasignar el beneficiario y `POST /guardar` la protege
 *      de los snapshots viejos que llegan de un dispositivo sin señal.
 *   2. `usuario_id` (la columna) — respaldo para filas antiguas.
 *
 * Usar un criterio distinto al del backend hace que el botón aparezca para
 * luego responder 403, o que desaparezca cuando sí se puede guardar.
 */
export function resolverDuenoFormulario(formulario?: FormularioConDueno | null): string | null {
  return formulario?.tecnico?.usuario_id || formulario?.usuario_id || null;
}

/**
 * ¿Puede editar las respuestas (botones «✎ Completar» / «Corregir»)?
 *
 * El admin puede en cualquier formulario (es quien supervisa la calidad del
 * dato) y el técnico solo en los suyos. El interventor/coordinador revisa,
 * no edita respuestas.
 *
 * Nota: cuando el formulario quedó a nombre de otro técnico pero el
 * beneficiario está asignado hoy al que pregunta, el backend sí lo autoriza
 * (visitas heredadas) y repara la atribución; a partir de la siguiente
 * sincronización el dueño que se recibe ya es el correcto y este mismo
 * cálculo habilita el botón.
 */
export function puedeEditarRespuestasFormulario({
  rol,
  usuarioId,
  duenoFormulario,
}: ContextoFormulario): boolean {
  if (rol === 'admin') return true;
  if (rol !== 'tecnico') return false;
  return esDueno(usuarioId, duenoFormulario);
}

/**
 * ¿Puede eliminar/agregar evidencias? Admin y coordinador en cualquier
 * formulario, y el técnico dueño solo en el suyo. Debe coincidir con
 * `ROLES_PUEDEN_ELIMINAR_EVIDENCIA` en `backend/src/routes/archivos.js`.
 */
export function puedeGestionarEvidenciasFormulario({
  rol,
  usuarioId,
  duenoFormulario,
}: ContextoFormulario): boolean {
  if (rol && ROLES_PUEDEN_ELIMINAR_EVIDENCIA.includes(rol)) return true;
  return rol === 'tecnico' && esDueno(usuarioId, duenoFormulario);
}

function esDueno(usuarioId?: string | null, duenoFormulario?: string | null): boolean {
  return !!usuarioId && !!duenoFormulario && usuarioId === duenoFormulario;
}
