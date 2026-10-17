// ============================================================
// Anexos Routes — Explorador de archivos por usuario (MinIO)
// ============================================================
// Espacio tipo "explorador de Windows" para que cada técnico organice
// documentación libre: crear/renombrar/eliminar carpetas, subir cualquier
// tipo de archivo.
//
// Almacenamiento: {rol}s/{usuario}/Anexos/... dentro del bucket de MinIO.
// Está aislado de las carpetas de evidencia automáticas (fotos, videos,
// documentos, pdfs, firmas) para que operar aquí nunca dañe la evidencia.
//
// Permisos:
//   · tecnico  → solo su propio espacio (lectura y escritura).
//   · roles superiores (coordinador, interventor, gerente, admin)
//     → pueden LEER los anexos de cualquier técnico (parámetro `tecnico`),
//       pero NO modificarlos (solo lectura + descarga).
// ============================================================

const express = require('express');
const multer = require('multer');
const { authenticateToken, authenticateTokenOrQuery } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

/** Roles que pueden revisar los anexos de cualquier técnico */
const ROLES_SUPERIORES = ['coordinador', 'interventor', 'gerente', 'admin'];

const MINIO_BUCKET = process.env.MINIO_BUCKET || 'geodaily-archivos';

// Multer en memoria: los anexos pueden ser de cualquier tipo (50MB por archivo).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/** ¿Puede este usuario modificar anexos? (solo el técnico dueño) */
const puedeEscribir = (user) => user?.rol === 'tecnico';

/**
 * Resolver de qué espacio se está leyendo.
 *  · Técnico → siempre el suyo.
 *  · Superior con `tecnico` → el del técnico indicado (validado en BD).
 *  · Superior sin `tecnico` → el suyo propio.
 * Si algo es inválido responde el error y devuelve null.
 */
async function resolverObjetivo(req, res) {
  if (req.user?.rol === 'tecnico') {
    return { rol: 'tecnico', usuario: req.user.usuario };
  }

  if (!ROLES_SUPERIORES.includes(req.user?.rol)) {
    return { rol: req.user.rol, usuario: req.user.usuario };
  }

  const tecnico = String(req.query?.tecnico || req.body?.tecnico || '').trim();
  if (!tecnico) {
    return { rol: req.user.rol, usuario: req.user.usuario };
  }

  // Evita traversal por el parámetro técnico antes de tocar MinIO/BD.
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(tecnico)) {
    res.status(400).json({ estado: 'error', mensaje: 'Nombre de técnico inválido' });
    return null;
  }

  const existe = await db.queryOne(
    "SELECT usuario FROM usuarios WHERE usuario = $1 AND rol = 'tecnico'",
    [tecnico]
  );
  if (!existe) {
    res.status(404).json({ estado: 'error', mensaje: 'Técnico no encontrado' });
    return null;
  }

  return { rol: 'tecnico', usuario: tecnico };
}

/**
 * GET /api/anexos/listar?path=&tecnico=
 * Lista carpetas y archivos de una ruta del explorador.
 */
router.get('/listar', authenticateToken, async (req, res) => {
  try {
    const objetivo = await resolverObjetivo(req, res);
    if (!objetivo) return;

    const rel = storage.sanitizeAnexoPath(req.query.path);
    if (rel === null) {
      return res.status(400).json({ estado: 'error', mensaje: 'Ruta inválida' });
    }

    const elementos = await storage.listAnexos(objetivo.rol, objetivo.usuario, rel);
    res.json({ estado: 'ok', path: rel, total: elementos.length, elementos });
  } catch (error) {
    console.error('[Anexos] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar anexos' });
  }
});

/**
 * GET /api/anexos/tecnicos
 * Técnicos activos entre los que un rol superior puede elegir para revisar
 * sus anexos. Solo roles superiores.
 */
router.get('/tecnicos', authenticateToken, async (req, res) => {
  try {
    if (!ROLES_SUPERIORES.includes(req.user?.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const tecnicos = await db.queryAll(
      "SELECT usuario, nombre, cedula FROM usuarios WHERE rol = 'tecnico' AND activo = TRUE ORDER BY nombre"
    );
    res.json({ estado: 'ok', total: tecnicos.length, tecnicos });
  } catch (error) {
    console.error('[Anexos] Error al listar técnicos:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar técnicos' });
  }
});

/**
 * POST /api/anexos/carpeta  { path, nombre }
 */
router.post('/carpeta', authenticateToken, async (req, res) => {
  try {
    if (!puedeEscribir(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico puede crear carpetas' });
    }

    const rel = storage.sanitizeAnexoPath(req.body?.path);
    if (rel === null) {
      return res.status(400).json({ estado: 'error', mensaje: 'Ruta inválida' });
    }
    const nombre = storage.sanitizeAnexoName(req.body?.nombre);
    if (!nombre) {
      return res.status(400).json({ estado: 'error', mensaje: 'Nombre de carpeta inválido' });
    }

    await storage.createAnexoFolder('tecnico', req.user.usuario, rel, nombre);
    res.json({ estado: 'ok', mensaje: 'Carpeta creada', nombre });
  } catch (error) {
    console.error('[Anexos] Error al crear carpeta:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al crear la carpeta' });
  }
});

/**
 * POST /api/anexos/subir  (multipart: archivos[])  { path }
 * Sube uno o varios archivos a la ruta indicada.
 */
router.post('/subir', authenticateToken, upload.array('archivos', 20), async (req, res) => {
  try {
    if (!puedeEscribir(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico puede subir anexos' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ estado: 'error', mensaje: 'Archivos requeridos' });
    }

    const rel = storage.sanitizeAnexoPath(req.body?.path);
    if (rel === null) {
      return res.status(400).json({ estado: 'error', mensaje: 'Ruta inválida' });
    }

    const subidos = [];
    for (const file of req.files) {
      const resumen = await storage.uploadAnexo(
        'tecnico',
        req.user.usuario,
        rel,
        file.originalname,
        file.buffer,
        file.mimetype
      );
      subidos.push({ nombre: resumen.nombre, tamaño: file.size });
    }

    try {
      await db.query(
        'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
        [req.user.id, 'subir_anexo', JSON.stringify({ path: rel, archivos: subidos.map((s) => s.nombre) })]
      );
    } catch (logErr) {
      console.warn('[Anexos] No se pudo registrar la actividad:', logErr.message);
    }

    res.json({ estado: 'ok', mensaje: `${subidos.length} archivo(s) subido(s)`, archivos: subidos });
  } catch (error) {
    console.error('[Anexos] Error al subir:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir los archivos' });
  }
});

/**
 * POST /api/anexos/renombrar  { path, nuevoNombre }
 */
router.post('/renombrar', authenticateToken, async (req, res) => {
  try {
    if (!puedeEscribir(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico puede renombrar' });
    }

    const rel = storage.sanitizeAnexoPath(req.body?.path);
    if (rel === null || !rel) {
      return res.status(400).json({ estado: 'error', mensaje: 'Ruta inválida' });
    }
    const nuevoNombre = storage.sanitizeAnexoName(req.body?.nuevoNombre);
    if (!nuevoNombre) {
      return res.status(400).json({ estado: 'error', mensaje: 'Nombre inválido' });
    }

    const resultado = await storage.renameAnexoPath('tecnico', req.user.usuario, rel, nuevoNombre);
    res.json({ estado: 'ok', mensaje: 'Renombrado', ...resultado });
  } catch (error) {
    console.error('[Anexos] Error al renombrar:', error);
    const noEncontrado = /no encontrado/i.test(error.message || '');
    res
      .status(noEncontrado ? 404 : 500)
      .json({ estado: 'error', mensaje: noEncontrado ? 'Elemento no encontrado' : 'Error al renombrar' });
  }
});

/**
 * DELETE /api/anexos?path=  (o body { path })
 * Elimina un archivo o una carpeta (recursiva).
 */
router.delete('/', authenticateToken, async (req, res) => {
  try {
    if (!puedeEscribir(req.user)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico puede eliminar' });
    }

    const rel = storage.sanitizeAnexoPath(req.query?.path ?? req.body?.path);
    if (rel === null || !rel) {
      return res.status(400).json({ estado: 'error', mensaje: 'Ruta inválida' });
    }

    const resultado = await storage.deleteAnexoPath('tecnico', req.user.usuario, rel);
    res.json({ estado: 'ok', mensaje: 'Eliminado', ...resultado });
  } catch (error) {
    console.error('[Anexos] Error al eliminar:', error);
    const noEncontrado = /no encontrado/i.test(error.message || '');
    res
      .status(noEncontrado ? 404 : 500)
      .json({ estado: 'error', mensaje: noEncontrado ? 'Elemento no encontrado' : 'Error al eliminar' });
  }
});

/** MIME básico por extensión (los anexos pueden ser de cualquier tipo). */
function mimetypeDeNombre(nombre) {
  const ext = String(nombre).toLowerCase().split('.').pop() || '';
  const mapa = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    json: 'application/json',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    kml: 'application/vnd.google-earth.kml+xml',
    kmz: 'application/vnd.google-earth.kmz',
  };
  return mapa[ext] || 'application/octet-stream';
}

/**
 * GET /api/anexos/descargar?path=&tecnico=&token=
 * Transmite el archivo desde MinIO (con soporte de Range para videos/PDF).
 * Usa authenticateTokenOrQuery para que en web el <a>/<video> pueda abrir
 * la URL con el token como query param.
 */
router.get('/descargar', authenticateTokenOrQuery, async (req, res) => {
  try {
    const objetivo = await resolverObjetivo(req, res);
    if (!objetivo) return;

    const rel = storage.sanitizeAnexoPath(req.query?.path);
    if (rel === null || !rel) {
      return res.status(400).json({ estado: 'error', mensaje: 'Ruta inválida' });
    }

    const root = storage.getAnexosRoot(objetivo.rol, objetivo.usuario);
    const key = `${root}/${rel}`;

    const stat = await storage.statFile(key);
    if (!stat) {
      return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible' });
    }

    const nombreArchivo = rel.split('/').pop();
    const total = stat.size;
    const rangeHeader = req.headers.range;

    res.setHeader('Content-Type', mimetypeDeNombre(nombreArchivo));
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nombreArchivo)}"`);
    if (stat.etag) res.setHeader('ETag', `"${stat.etag}"`);

    let stream;
    if (rangeHeader) {
      const coincide = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!coincide) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
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
        hasta = hastaStr === '' ? total - 1 : parseInt(hastaStr, 10);
      }
      if (Number.isNaN(desde) || Number.isNaN(hasta) || desde > hasta || desde >= total) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
      hasta = Math.min(hasta, total - 1);

      res.status(206);
      res.setHeader('Content-Range', `bytes ${desde}-${hasta}/${total}`);
      res.setHeader('Content-Length', hasta - desde + 1);
      stream = await storage.getFileRangeStream(key, desde, hasta - desde + 1);
    } else {
      res.setHeader('Content-Length', total);
      stream = await storage.getFileStream(key);
    }

    if (!stream) {
      return res.status(404).json({ estado: 'error', mensaje: 'Archivo no disponible' });
    }
    stream.on('error', (err) => {
      console.error('[Anexos] Error transmitiendo archivo:', err.message);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('[Anexos] Error al descargar:', error);
    if (!res.headersSent) {
      res.status(500).json({ estado: 'error', mensaje: 'Error al descargar' });
    }
  }
});

module.exports = router;
