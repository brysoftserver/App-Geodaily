// ============================================================
// Archivos Routes — Entrega de evidencias almacenadas en MinIO
// ============================================================
// Las fotos y videos se guardan en MinIO al sincronizar, pero la app
// solo conservaba la ruta LOCAL del teléfono que los capturó
// (file:///data/user/0/...). Al abrir el formulario desde otro
// dispositivo esa ruta no existe y la evidencia aparecía rota.
//
// Esta ruta transmite el archivo desde MinIO a través de la API para
// que cualquier dispositivo autorizado pueda verlo. Se hace streaming
// (en vez de redirigir a una URL prefirmada) porque MinIO vive en la
// red interna y no es alcanzable directamente desde el celular.
// ============================================================

const express = require('express');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

/** Roles que pueden ver la evidencia de cualquier técnico */
const ROLES_COORDINACION = ['coordinador', 'interventor', 'gerente', 'admin'];

/**
 * GET /api/archivos/:id/contenido
 * Devuelve el binario de la evidencia (foto, video, firma, documento).
 */
router.get('/:id/contenido', authenticateTokenOrQuery, async (req, res) => {
  try {
    const archivo = await db.queryOne(
      'SELECT id, usuario_id, tipo, filename, mimetype, minio_path, metadata_json FROM archivos WHERE id = $1',
      [req.params.id]
    );

    if (!archivo) {
      return res.status(404).json({ estado: 'error', mensaje: 'Archivo no encontrado' });
    }

    // El técnico solo accede a sus propias evidencias; supervisión ve todo.
    // Excepción: documentos de la finca (tipo 'other' con beneficiario_cedula
    // en metadata_json) son de la finca, no de quien los subió — cualquier
    // técnico autenticado puede verlos, igual que ya puede listarlos vía
    // GET /api/documentos/beneficiario/:cedula.
    const esPropio = archivo.usuario_id === req.user.id;
    const esCoordinacion = ROLES_COORDINACION.includes(req.user.rol);
    const esDocumentoDeFinca = archivo.tipo === 'other' && !!archivo.metadata_json?.beneficiario_cedula;
    if (!esPropio && !esCoordinacion && !esDocumentoDeFinca) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    // Los reproductores de video (ExoPlayer en Android, AVPlayer en iOS)
    // no leen el fichero de una sola vez: piden trozos con la cabecera
    // Range y necesitan conocer el tamaño total. Sin soporte de rangos
    // las fotos se veían pero los videos no se reproducían.
    //
    // resolveFilePath corrige rutas registradas con un segmento
    // `Seguimientos/` espurio (seguimientos de Coordinación/Interventoría
    // subidos por una versión anterior del backend): si el objeto no está
    // en la ruta registrada, se prueba la variante sin ese segmento.
    const rutaReal = await storage.resolveFilePath(archivo.minio_path);
    if (!rutaReal) {
      return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible en almacenamiento' });
    }
    const stat = await storage.statFile(rutaReal);
    if (!stat) {
      return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible en almacenamiento' });
    }

    const total = stat.size;
    const rangeHeader = req.headers.range;

    // ETag/Last-Modified derivados del objeto real en MinIO. Aunque el id de
    // `archivos` no cambia, el binario SÍ puede cambiar (p. ej. re-estampado
    // de marca de agua). Sin validador, el cliente cacheaba la versión vieja
    // hasta 24 h y seguía viendo el texto anterior. Con ETag + revalidación
    // (`no-cache`) el dispositivo pregunta al servidor y recibe la nueva
    // versión en cuanto el objeto cambia.
    const etag = stat.etag ? `"${stat.etag}"` : `"${total}-${new Date(stat.lastModified).getTime()}"`;
    const lastModified = new Date(stat.lastModified).toUTCString();

    // Revalidación condicional: si el cliente ya tiene la versión vigente,
    // responde 304 sin reenviar el binario (ahorra ancho de banda).
    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-cache');
      return res.end();
    }

    res.setHeader('Content-Type', archivo.mimetype || 'application/octet-stream');
    // `no-cache` NO significa "no guardar": significa "guardar pero
    // revalidar siempre". Así el dispositivo conserva el caché pero detecta
    // cambios en el binario (re-estampados) de inmediato.
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader('Content-Disposition', `inline; filename="${archivo.filename}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    let stream;
    if (rangeHeader) {
      const coincide = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!coincide) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }

      // "bytes=-500" pide los últimos 500 bytes; "bytes=100-" desde el 100
      const [, desdeStr, hastaStr] = coincide;
      let desde;
      let hasta;
      if (desdeStr === '') {
        const ultimos = parseInt(hastaStr, 10);
        if (!ultimos) {
          res.setHeader('Content-Range', `bytes */${total}`);
          return res.status(416).end();
        }
        desde = Math.max(0, total - ultimos);
        hasta = total - 1;
      } else {
        desde = parseInt(desdeStr, 10);
        hasta = hastaStr === '' ? total - 1 : Math.min(parseInt(hastaStr, 10), total - 1);
      }

      if (desde > hasta || desde >= total) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }

      const longitud = hasta - desde + 1;
      stream = await storage.getFileRangeStream(rutaReal, desde, longitud);
      if (!stream) {
        return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible en almacenamiento' });
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${desde}-${hasta}/${total}`);
      res.setHeader('Content-Length', longitud);
    } else {
      stream = await storage.getFileStream(rutaReal);
      if (!stream) {
        return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible en almacenamiento' });
      }
      res.setHeader('Content-Length', total);
    }

    stream.on('error', (err) => {
      console.error('[Archivos] Error transmitiendo:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ estado: 'error', mensaje: 'Error al leer el archivo' });
      } else {
        res.destroy();
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error('[Archivos] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener el archivo' });
  }
});

/**
 * GET /api/archivos/formulario/:formularioId
 * Lista las evidencias asociadas a un formulario, con la URL para
 * descargarlas. La app la usa para reconstruir fotos y videos cuando
 * abre un formulario sincronizado desde otro dispositivo.
 */
router.get('/formulario/:formularioId', authenticateToken, async (req, res) => {
  try {
    const esCoordinacion = ROLES_COORDINACION.includes(req.user.rol);

    // Las evidencias se asocian al formulario por metadata_json.formulario_id
    // o por la columna formulario_id, según cómo se subieron.
    const params = [req.params.formularioId];
    let sql = `
      SELECT id, tipo, filename, mimetype, latitud, longitud, created_at, updated_at, metadata_json, evidencia_local_id
      FROM archivos
      WHERE (formulario_id = $1 OR metadata_json->>'formulario_id' = $1)`;

    if (!esCoordinacion) {
      params.push(req.user.id);
      sql += ` AND usuario_id = $${params.length}`;
    }

    sql += ' ORDER BY created_at ASC';

    const archivos = await db.queryAll(sql, params);

    // Tumbas de evidencias borradas individualmente: un dispositivo que
    // conserva la foto local necesita saber que ya fue eliminada para no
    // seguir mostrándola (ver resolverEvidenciasRemotas en la app).
    const eliminadas = await db.queryAll(
      `SELECT archivo_id, evidencia_local_id FROM evidencias_eliminadas WHERE formulario_id = $1`,
      [req.params.formularioId]
    );

    res.json({
      estado: 'ok',
      total: archivos.length,
      archivos: archivos.map((a) => ({
        id: a.id,
        tipo: a.tipo,
        filename: a.filename,
        mimetype: a.mimetype,
        latitud: a.latitud,
        longitud: a.longitud,
        created_at: a.created_at,
        // Se usa como cache-buster en la app (`?v=<updated_at>`): cambia
        // cuando el binario se re-sube (p. ej. re-estampado de marca de
        // agua), forzando al <Image> a re-descargar la versión nueva.
        updated_at: a.updated_at || a.created_at,
        url: `/api/archivos/${a.id}/contenido`,
        // Solo relevante para tipo 'firma': distingue beneficiario/técnico.
        tipo_firma: a.metadata_json?.tipo_firma || null,
        // id generado en el celular al capturar la evidencia; es el mismo
        // que llevan las fotos del formulario (fotos_json[].id).
        evidencia_local_id: a.evidencia_local_id || null,
      })),
      eliminadas: eliminadas.map((e) => ({
        archivo_id: e.archivo_id,
        evidencia_local_id: e.evidencia_local_id,
      })),
    });
  } catch (error) {
    console.error('[Archivos] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar archivos' });
  }
});

/** Roles autorizados a eliminar CUALQUIER evidencia (foto/video). */
const ROLES_PUEDEN_ELIMINAR_EVIDENCIA = ['admin', 'coordinador'];

/**
 * DELETE /api/archivos/:id
 * Elimina una evidencia (foto o video) de un formulario. Admin y coordinador
 * pueden borrar cualquiera; el técnico solo las de SUS PROPIOS formularios
 * (se valida abajo contra el dueño de la visita). Borra el objeto de MinIO, la
 * fila de `archivos`, la entrada correspondiente en `formularios.fotos_json` y
 * deja una "tumba" en `evidencias_eliminadas` para que el teléfono que capturó
 * la evidencia (que conserva el archivo local) no la vuelva a mostrar ni a
 * subir.
 *
 * Las firmas, PDFs y documentos de finca NO se pueden borrar por aquí.
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  const esAdminOCoordinador = ROLES_PUEDEN_ELIMINAR_EVIDENCIA.includes(req.user.rol);
  const esTecnico = req.user.rol === 'tecnico';
  if (!esAdminOCoordinador && !esTecnico) {
    return res.status(403).json({
      estado: 'error',
      mensaje: 'No tienes permiso para eliminar evidencias',
    });
  }

  const client = await db.pool.connect();
  let archivo = null;
  let formularioId = null;
  let filtradas = null;

  try {
    await client.query('BEGIN');

    // El cliente puede mandar el id de `archivos` (evidencia que vio en el
    // servidor) o el id LOCAL de la captura: cuando el teléfono muestra sus
    // propias fotos, `formulario.fotos[].id` es el id generado al capturar
    // (archivos.evidencia_local_id), no la PK de la tabla. Se intenta primero
    // por PK y, si no hay fila, por evidencia_local_id.
    const idParam = String(req.params.id);
    const columnas = `id, tipo, minio_path, formulario_id, evidencia_local_id, metadata_json`;
    let result = await client.query(
      `SELECT ${columnas} FROM archivos WHERE id::text = $1 LIMIT 1`,
      [idParam]
    );
    if (result.rows.length === 0) {
      result = await client.query(
        `SELECT ${columnas} FROM archivos WHERE evidencia_local_id = $1 ORDER BY id DESC LIMIT 1`,
        [idParam]
      );
    }
    archivo = result.rows[0];

    if (!archivo) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ estado: 'error', mensaje: 'Evidencia no encontrada' });
    }

    // Solo fotos y videos de evidencia: borrar una firma dejaría el
    // formulario sin firma de beneficiario/técnico y un PDF incoherente.
    if (archivo.tipo !== 'foto' && archivo.tipo !== 'video') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Solo se pueden eliminar fotos o videos de evidencia',
      });
    }

    formularioId = archivo.formulario_id || archivo.metadata_json?.formulario_id || null;

    // El técnico solo puede borrar evidencias de SUS PROPIOS formularios. Se
    // resuelve el dueño con el mismo criterio que PATCH /formularios/:id/respuesta
    // (snapshot tecnico_json.usuario_id manda; columna usuario_id de respaldo).
    if (esTecnico) {
      if (!formularioId) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({
          estado: 'error',
          mensaje: 'No se pudo verificar el dueño de la evidencia',
        });
      }
      const duenoResult = await client.query(
        `SELECT COALESCE(NULLIF(tecnico_json->>'usuario_id', ''), usuario_id) AS usuario_id
           FROM formularios WHERE id = $1`,
        [formularioId]
      );
      const dueno = duenoResult.rows[0]?.usuario_id;
      if (!dueno || dueno !== req.user.id) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(403).json({
          estado: 'error',
          mensaje: 'Solo puedes eliminar evidencias de tus propios formularios',
        });
      }
    }

    // 1. Tumba del borrado (idempotencia: no duplicar si se reintenta).
    await client.query(
      `INSERT INTO evidencias_eliminadas
         (archivo_id, formulario_id, evidencia_local_id, minio_path, eliminado_por)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        archivo.id,
        formularioId,
        archivo.evidencia_local_id || null,
        archivo.minio_path,
        req.user.id,
      ]
    );

    // 2. Borrar la fila de la BD.
    await client.query('DELETE FROM archivos WHERE id = $1', [archivo.id]);

    // 3. Quitar la evidencia del fotos_json del formulario. El servidor
    //    guarda ahí las fotos que envió el celular (id = evidencia local,
    //    uri = ruta del teléfono), no las filas de `archivos`, así que hay
    //    que limpiarlas por separado para que la visita deje de mostrar la
    //    foto borrada aunque todavía quede una copia local en algún equipo.
    if (formularioId) {
      const formResult = await client.query(
        'SELECT fotos_json FROM formularios WHERE id = $1',
        [formularioId]
      );
      const fotos = Array.isArray(formResult.rows[0]?.fotos_json)
        ? formResult.rows[0].fotos_json
        : [];
      const nombreArchivo = archivo.minio_path ? archivo.minio_path.split('/').pop() : null;
      filtradas = fotos.filter((f) => {
        if (!f) return false;
        if (archivo.evidencia_local_id && f.id === archivo.evidencia_local_id) return false;
        if (f.archivo_id && String(f.archivo_id) === String(archivo.id)) return false;
        if (nombreArchivo && typeof f.uri === 'string' && f.uri.includes(nombreArchivo)) return false;
        return true;
      });
      if (filtradas.length !== fotos.length) {
        await client.query(
          'UPDATE formularios SET fotos_json = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(filtradas), formularioId]
        );
      }
    }

    // 4. Constancia en el log de actividad.
    await client.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [
        req.user.id,
        'eliminar_evidencia',
        JSON.stringify({
          archivo_id: archivo.id,
          tipo: archivo.tipo,
          formulario_id: formularioId,
          minio_path: archivo.minio_path,
        }),
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('[Archivos] Error eliminando evidencia:', error);
    return res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar la evidencia' });
  }
  client.release();

  // Borrado físico en MinIO — fuera de la transacción (no es atómico con la
  // BD a propósito): la BD ya quedó consistente; si MinIO falla, el objeto
  // queda huérfano pero ya no se referencia desde ninguna parte.
  const borradoFisico = await storage.deleteFile(archivo.minio_path);

  console.log(`[Archivos] 🗑️ Evidencia ${archivo.id} (${archivo.tipo}) eliminada por ${req.user.rol}`);

  res.json({
    estado: 'ok',
    mensaje: 'Evidencia eliminada',
    archivo_id: archivo.id,
    formulario_id: formularioId,
    borrado_fisico: borradoFisico,
    fotos_restantes: filtradas ? filtradas.length : null,
  });
});

module.exports = router;
