// ============================================================
// GEODAILY — Dueño de una evidencia (foto / video)
//
// REGLA
// Una foto o un video pertenece al DUEÑO DEL FORMULARIO al que se amarra,
// no a quien la subió. En oficina un admin (o un coordinador) adjunta
// evidencia a la visita de un técnico; si esa evidencia se guardara a
// nombre del admin:
//   - quedaría en la carpeta `admin/<usuario>/…` de MinIO, fuera del árbol
//     del técnico y del beneficiario → nadie la vuelve a encontrar,
//   - y `GET /api/archivos/formulario/:id` filtra por `usuario_id` para los
//     roles que no son de coordinación, así que el TÉCNICO dueño de la
//     visita no la vería (evidencia "huérfana" desde su punto de vista).
//
// Por eso `archivos.usuario_id` y la ruta en MinIO se resuelven con el
// dueño efectivo del formulario, y quién la subió queda en
// `metadata_json.subido_por` (trazabilidad sin romper la atribución).
//
// El dueño efectivo se toma igual que en forms.js / archivos.js / firmas.js:
// `tecnico_json.usuario_id` (snapshot del dispositivo) y, si viene vacío,
// `formularios.usuario_id`.
// ============================================================

const db = require('../database');

/** Roles válidos en la tabla `usuarios` (para no romper la ruta de MinIO). */
const ROLES_VALIDOS = ['tecnico', 'coordinador', 'interventor', 'gerente', 'admin'];

/**
 * Dueño efectivo de un formulario, con el rol y el usuario que definen su
 * carpeta en MinIO.
 *
 * Nunca lanza y nunca devuelve datos inventados: si el formulario no existe
 * todavía (caso normal offline: la evidencia se sube ANTES que el
 * formulario) o si la consulta falla, devuelve `null` y quien llama se
 * queda con el usuario autenticado, que es el comportamiento anterior.
 *
 * @param {string|null|undefined} formularioId
 * @returns {Promise<{id: string, rol: string, usuario: string}|null>}
 */
const resolverDuenoDeFormulario = async (formularioId) => {
  if (!formularioId || typeof formularioId !== 'string' || !formularioId.trim()) return null;
  try {
    const formulario = await db.queryOne(
      `SELECT COALESCE(NULLIF(tecnico_json->>'usuario_id', ''), usuario_id) AS dueno_id
         FROM formularios
        WHERE id = $1`,
      [formularioId.trim()]
    );
    const duenoId = formulario && formulario.dueno_id;
    if (!duenoId) return null;

    const dueno = await db.queryOne(
      'SELECT id, rol, usuario FROM usuarios WHERE id = $1',
      [duenoId]
    );
    // Sin fila en usuarios no se puede armar una ruta válida: se descarta
    // para no crear carpetas con ids que no existen.
    if (!dueno || !dueno.usuario) return null;

    return {
      id: String(dueno.id),
      rol: ROLES_VALIDOS.includes(dueno.rol) ? dueno.rol : 'tecnico',
      usuario: String(dueno.usuario),
    };
  } catch (error) {
    console.warn('[Evidencias] No se pudo resolver el dueño del formulario:', error.message);
    return null;
  }
};

/**
 * ¿La evidencia viene del almacenamiento del dispositivo (galería) y no de
 * la cámara?
 *
 * Las de galería se suben LIMPIAS: sin marca de agua quemada y sin
 * latitud/longitud/altitud. La foto ya existía antes de la visita, así que
 * los datos de captura (GPS y hora) no son de esta evidencia y quemarlos en
 * el píxel sería un dato FALSO. Las de cámara conservan su marca completa.
 *
 * @param {unknown} origen
 * @returns {boolean}
 */
const esOrigenAlmacenamiento = (origen) =>
  typeof origen === 'string' && origen.trim().toLowerCase() === 'almacenamiento';

/**
 * Copia de cortesía del cuerpo que llega al log de subida: sin datos
 * sensibles y sin objetos enormes.
 */
const describirOrigen = (origen) => (esOrigenAlmacenamiento(origen) ? 'almacenamiento' : 'camara');

module.exports = {
  resolverDuenoDeFormulario,
  esOrigenAlmacenamiento,
  describirOrigen,
};
