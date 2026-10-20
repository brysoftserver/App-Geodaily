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

/**
 * ¿Puede elegir entre tomar la foto/video con la cámara o adjuntarlo desde el
 * almacenamiento del dispositivo?
 *
 * SOLO el admin. Regla del negocio: el admin corrige desde la oficina visitas
 * ya cerradas y a veces recibe la evidencia por WhatsApp o la tiene en el
 * carrete, así que necesita poder adjuntarla. Cualquier otro rol (técnico,
 * coordinador, interventor, gerente) debe capturarla con la cámara en el
 * momento: así la evidencia lleva su ubicación real y no se puede "fabricar"
 * una visita adjuntando una foto vieja del almacenamiento.
 *
 * Estas evidencias del almacenamiento se suben sin GPS y sin marca de agua
 * (ver `useCamera` con `origen: 'almacenamiento'` y `photos.js`).
 */
export function puedeElegirOrigenEvidencia(rol?: string | null): boolean {
  return rol === 'admin';
}

/**
 * ¿Puede capturar/reemplazar una firma en el detalle de un formulario?
 *
 * - Firma **faltante** (campo vacío): SOLO el admin. Caso real: el
 *   beneficiario o el técnico no estaban en el momento de la visita y
 *   vuelven después; el admin los tiene enfrente y registra la firma bajo su
 *   supervisión. Si se dejara firmar al técnico dueño, podría “conseguir” una
 *   firma en cualquier momento y desde cualquier lugar, sin que nadie
 *   presencie el acto.
 * - Firma **ya registrada**: se mantiene la regla de reemplazo de siempre
 *   (admin, coordinador y técnico dueño), que cubre el caso del técnico que
 *   cambió o de una firma que salió mal.
 *
 * Debe coincidir con la validación de `POST /api/firmas/guardar-en-formulario`:
 * el servidor rechaza con 403 a quien no sea admin en un campo vacío, aunque
 * el cliente lo intente por otra vía.
 */
export function puedeFirmarFormulario({
  rol,
  usuarioId,
  duenoFormulario,
  firmaExistente,
}: ContextoFormulario & { firmaExistente?: boolean }): boolean {
  if (!firmaExistente) return rol === 'admin';
  return puedeGestionarEvidenciasFormulario({ rol, usuarioId, duenoFormulario });
}
