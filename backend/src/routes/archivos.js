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
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

/** Roles que pueden ver la evidencia de cualquier técnico */
const ROLES_SUPERVISION = ['supervisor', 'interventor', 'gerente', 'admin'];

/**
 * GET /api/archivos/:id/contenido
 * Devuelve el binario de la evidencia (foto, video, firma, documento).
 */
router.get('/:id/contenido', authenticateToken, async (req, res) => {
  try {
    const archivo = await db.queryOne(
      'SELECT id, usuario_id, tipo, filename, mimetype, minio_path FROM archivos WHERE id = $1',
      [req.params.id]
    );

    if (!archivo) {
      return res.status(404).json({ estado: 'error', mensaje: 'Archivo no encontrado' });
    }

    // El técnico solo accede a sus propias evidencias; supervisión ve todo.
    const esPropio = archivo.usuario_id === req.user.id;
    const esSupervision = ROLES_SUPERVISION.includes(req.user.rol);
    if (!esPropio && !esSupervision) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    // Los reproductores de video (ExoPlayer en Android, AVPlayer en iOS)
    // no leen el fichero de una sola vez: piden trozos con la cabecera
    // Range y necesitan conocer el tamaño total. Sin soporte de rangos
    // las fotos se veían pero los videos no se reproducían.
    const stat = await storage.statFile(archivo.minio_path);
    if (!stat) {
      return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible en almacenamiento' });
    }

    const total = stat.size;
    const rangeHeader = req.headers.range;

    res.setHeader('Content-Type', archivo.mimetype || 'application/octet-stream');
    // Las evidencias son inmutables: se pueden cachear en el dispositivo.
    res.setHeader('Cache-Control', 'private, max-age=86400');
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
      stream = await storage.getFileRangeStream(archivo.minio_path, desde, longitud);
      if (!stream) {
        return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible en almacenamiento' });
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${desde}-${hasta}/${total}`);
      res.setHeader('Content-Length', longitud);
    } else {
      stream = await storage.getFileStream(archivo.minio_path);
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
    const esSupervision = ROLES_SUPERVISION.includes(req.user.rol);

    // Las evidencias se asocian al formulario por metadata_json.formulario_id
    // o por la columna formulario_id, según cómo se subieron.
    const params = [req.params.formularioId];
    let sql = `
      SELECT id, tipo, filename, mimetype, latitud, longitud, created_at, metadata_json
      FROM archivos
      WHERE (formulario_id = $1 OR metadata_json->>'formulario_id' = $1)`;

    if (!esSupervision) {
      params.push(req.user.id);
      sql += ` AND usuario_id = $${params.length}`;
    }

    sql += ' ORDER BY created_at ASC';

    const archivos = await db.queryAll(sql, params);

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
        url: `/api/archivos/${a.id}/contenido`,
        // Solo relevante para tipo 'firma': distingue beneficiario/técnico.
        tipo_firma: a.metadata_json?.tipo_firma || null,
      })),
    });
  } catch (error) {
    console.error('[Archivos] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar archivos' });
  }
});

module.exports = router;
