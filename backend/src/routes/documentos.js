// ============================================================
// Documentos Routes — Subida de documentos/anexos a MinIO
// Ruta en MinIO: {rol}s/{usuario}/documentos/{filename}
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

/** Roles que pueden ver los documentos de finca de cualquier técnico */
const ROLES_COORDINACION = ['coordinador', 'interventor', 'gerente', 'admin'];

// Multer en memoria para subir a MinIO (límite 50MB para documentos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|doc|docx|xls|xlsx|zip|rar|7z|txt|csv|jpg|jpeg|png/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = /pdf|msword|spreadsheet|zip|rar|plain|csv|image/.test(file.mimetype);
    cb(null, extOk || mimeOk);
  },
});

// POST /api/documentos/subir — Subir un documento
router.post('/subir', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    }

    const { descripcion, categoria, beneficiario_cedula, beneficiario_nombre, tipo_formulario, formulario_id, evidencia_id } = req.body;
    const ext = path.extname(req.file.originalname);
    const filename = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

    if (evidencia_id) {
      const yaSubido = await db.queryOne(
        'SELECT id, minio_path, filename, size_bytes FROM archivos WHERE usuario_id = $1 AND evidencia_local_id = $2',
        [req.user.id, evidencia_id]
      );
      if (yaSubido) {
        return res.json({
          estado: 'ok',
          id: yaSubido.id,
          ruta: yaSubido.minio_path,
          filename: yaSubido.filename,
          size: yaSubido.size_bytes,
        });
      }
    }

    // Validar que el usuario tenga rol y nombre de usuario
    const userRol = req.user?.rol || 'otros';
    const userUsuario = req.user?.usuario || req.user?.id?.toString() || 'desconocido';

    // ─── Resolver datos del beneficiario para carpeta en MinIO ───
    let benefItem = null;
    let benefNombre = null;
    if (beneficiario_cedula) {
      try {
        const benef = await db.queryOne(
          'SELECT item, nombre_completo FROM beneficiarios WHERE cedula = $1',
          [beneficiario_cedula.trim()]
        );
        if (benef) {
          benefItem = benef.item;
          benefNombre = beneficiario_nombre || benef.nombre_completo;
        }
      } catch (lookupErr) {
        console.warn('[Documentos] Error buscando beneficiario:', lookupErr.message);
      }
    }

    const rutaEsperada = benefItem && benefNombre
      ? storage.getBeneficiaryFilePath(userRol, userUsuario, benefItem, benefNombre, tipo_formulario, 'documentos', filename)
      : storage.getFilePath(userRol, userUsuario, 'documentos', filename);

    // El documento solo se considera subido si MinIO confirmó el objeto.
    let objetoMinio;
    try {
      objetoMinio = await storage.uploadFile(
        userRol,
        userUsuario,
        'documentos',
        filename,
        req.file.buffer,
        {
          contentType: req.file.mimetype,
          beneficiarioItem: benefItem,
          beneficiarioNombre: benefNombre,
          tipoFormulario: tipo_formulario,
        }
      );
    } catch (storageErr) {
      const eliminado = await storage.deleteFile(rutaEsperada);
      if (!eliminado) {
        console.warn('[Documentos] No se pudo limpiar la ruta tras fallo de subida:', rutaEsperada);
      }
      console.error('[Documentos] Error al subir a MinIO:', storageErr.message);
      throw storageErr;
    }

    // Guardar registro en PostgreSQL
    const bucket = objetoMinio.bucket || process.env.MINIO_BUCKET || 'geodaily-archivos';
    const minioPath = objetoMinio.path;

    const metadataExtra = {
      descripcion: descripcion || null,
      categoria: categoria || null,
      beneficiario_item: benefItem,
      beneficiario_cedula: beneficiario_cedula || null,
      // Ver nota en photos.js: respaldo por si el documento llega antes de
      // que el formulario exista en el servidor. Antes NO se guardaba el
      // vínculo en absoluto (ni columna ni metadata), así que un coordinador
      // nunca podía ver los documentos de finca de una visita: no había
      // forma de saber a qué formulario pertenecía cada uno.
      formulario_id: formulario_id || null,
    };

    // El SELECT evita violar la FK cuando el documento se sube antes de que
    // el formulario correspondiente termine de sincronizarse (caso normal
    // sin señal): queda NULL y se resuelve por metadata_json más tarde.
    let archivoCreado;
    try {
      archivoCreado = await db.query(
        `INSERT INTO archivos (usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json, evidencia_local_id)
         VALUES ($1, (SELECT id FROM formularios WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          req.user.id,
          formulario_id || null,
          'other',
          filename,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          minioPath,
          bucket,
          JSON.stringify(metadataExtra),
          evidencia_id || null,
        ]
      );
    } catch (insertErr) {
      if (insertErr.code === '23505' && evidencia_id) {
        const existente = await db.queryOne(
          'SELECT id, minio_path, filename, size_bytes FROM archivos WHERE usuario_id = $1 AND evidencia_local_id = $2',
          [req.user.id, evidencia_id]
        );
        if (existente) {
          await storage.deleteFile(minioPath);
          return res.json({
            estado: 'ok',
            id: existente.id,
            ruta: existente.minio_path,
            filename: existente.filename,
            size: existente.size_bytes,
          });
        }
      }
      await storage.deleteFile(minioPath);
      throw insertErr;
    }

    const docId = archivoCreado.rows[0]?.id || `doc-${Date.now()}`;

    // Registrar en actividad
    try {
      await db.query(
        'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
        [req.user.id, 'subir_documento', JSON.stringify({ archivo_id: docId, filename, original: req.file.originalname })]
      );
    } catch (logErr) {
      console.warn('[Documentos] No se pudo registrar la actividad:', logErr.message);
    }

    console.log(`[Documentos] 📎 Documento subido a MinIO: ${minioPath}`);

    res.json({
      estado: 'ok',
      id: docId,
      ruta: minioPath,
      filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mensaje: 'Documento subido correctamente',
    });
  } catch (error) {
    console.error('[Documentos] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir documento a MinIO' });
  }
});

// POST /api/documentos/subir-multiple — Subir múltiples documentos
router.post('/subir-multiple', authenticateToken, upload.array('archivos', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ estado: 'error', mensaje: 'Archivos requeridos' });
    }

    const { beneficiario_cedula, beneficiario_nombre, tipo_formulario } = req.body;
    let benefItem = null;
    let benefNombre = null;
    if (beneficiario_cedula) {
      try {
        const benef = await db.queryOne(
          'SELECT item, nombre_completo FROM beneficiarios WHERE cedula = $1',
          [beneficiario_cedula.trim()]
        );
        if (benef) {
          benefItem = benef.item;
          benefNombre = beneficiario_nombre || benef.nombre_completo;
        }
      } catch (lookupErr) {
        console.warn('[Documentos] Error buscando beneficiario en subida múltiple:', lookupErr.message);
      }
    }

    const resultados = [];

    const userRol = req.user?.rol || 'otros';
    const userUsuario = req.user?.usuario || req.user?.id?.toString() || 'desconocido';

    for (const file of req.files) {
      const ext = path.extname(file.originalname);
      const filename = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

      try {
        await storage.uploadFile(
          userRol, userUsuario, 'documentos', filename, file.buffer,
          {
            contentType: file.mimetype,
            beneficiarioItem: benefItem,
            beneficiarioNombre: benefNombre,
            tipoFormulario: tipo_formulario,
          }
        );
      } catch (storageErr) {
        console.warn('[Documentos] Error subiendo a MinIO en lote:', storageErr.message);
      }

      const basePath = storage.getUserBasePath(userRol, userUsuario);
      let minioPath;
      const formFolder = storage.getFormTypeFolder(tipo_formulario);
      if (benefItem && benefNombre) {
        const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
        minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/documentos/${filename}` : `${basePath}/${subpath}/documentos/${filename}`;
      } else {
        minioPath = formFolder ? `${basePath}/${formFolder}/documentos/${filename}` : `${basePath}/documentos/${filename}`;
      }

      const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';

      const archivoResult = await db.queryOne(
        `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          req.user.id, 'other', filename, file.originalname,
          file.mimetype, file.size, minioPath, bucket,
          JSON.stringify({ beneficiario_item: benefItem, beneficiario_cedula: beneficiario_cedula || null }),
        ]
      );

      resultados.push({ id: archivoResult?.id || `doc-${Date.now()}`, filename, size: file.size });
    }

    res.json({
      estado: 'ok',
      mensaje: `${resultados.length} documentos subidos`,
      documentos: resultados,
    });
  } catch (error) {
    console.error('[Documentos] Error subida múltiple:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir documentos' });
  }
});

// GET /api/documentos — Listar documentos
router.get('/', authenticateToken, async (req, res) => {
  try {
    let sql = "SELECT * FROM archivos WHERE tipo = 'other'";
    const params = [];

    if (req.user.rol === 'tecnico') {
      sql += ' AND usuario_id = $1';
      params.push(req.user.id);
    }

    sql += ' ORDER BY created_at DESC';
    const docs = await db.queryAll(sql, params);
    res.json({ estado: 'ok', total: docs.length, documentos: docs });
  } catch (error) {
    console.error('[Documentos] Listar error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar documentos' });
  }
});

/**
 * GET /api/documentos/formulario/:formularioId
 * Documentos de finca vinculados a un formulario — la app la usa para
 * mostrarlos en el resumen del formulario a cualquier rol de supervisión,
 * no solo al técnico que los subió. Debe ir ANTES de GET /:id: si no,
 * Express interpretaría "formulario" como el :id de esa ruta.
 */
router.get('/formulario/:formularioId', authenticateToken, async (req, res) => {
  try {
    const esCoordinacion = ROLES_COORDINACION.includes(req.user.rol);

    const params = [req.params.formularioId];
    let sql = `
      SELECT id, tipo, filename, originalname, mimetype, size_bytes, created_at, metadata_json
      FROM archivos
      WHERE tipo = 'other'
        AND (formulario_id = $1 OR metadata_json->>'formulario_id' = $1)`;

    if (!esCoordinacion) {
      params.push(req.user.id);
      sql += ` AND usuario_id = $${params.length}`;
    }

    sql += ' ORDER BY created_at ASC';

    const docs = await db.queryAll(sql, params);

    res.json({
      estado: 'ok',
      total: docs.length,
      documentos: docs.map((d) => ({
        id: d.id,
        nombre: d.originalname || d.filename,
        mimetype: d.mimetype,
        size_bytes: d.size_bytes,
        created_at: d.created_at,
        descripcion: d.metadata_json?.descripcion || null,
        categoria: d.metadata_json?.categoria || null,
        url: `/api/archivos/${d.id}/contenido`,
      })),
    });
  } catch (error) {
    console.error('[Documentos] Error listando por formulario:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar documentos del formulario' });
  }
});

/**
 * GET /api/documentos/beneficiario/:cedula
 * Documentos de la finca vinculados directamente al beneficiario (no a una
 * visita puntual): incluye los subidos desde cualquier dispositivo/técnico,
 * y los cargados manualmente a MinIO y registrados aquí. A diferencia de
 * /formulario/:id, NO se filtra por usuario_id — son documentos de la
 * finca, compartidos entre técnicos, no propiedad de quien los subió.
 * Debe ir ANTES de GET /:id por el mismo motivo que /formulario/:id.
 */
router.get('/beneficiario/:cedula', authenticateToken, async (req, res) => {
  try {
    const cedula = req.params.cedula.trim();
    const docs = await db.queryAll(
      `SELECT id, tipo, filename, originalname, mimetype, size_bytes, created_at, metadata_json
       FROM archivos
       WHERE tipo = 'other' AND metadata_json->>'beneficiario_cedula' = $1
       ORDER BY created_at DESC`,
      [cedula]
    );

    res.json({
      estado: 'ok',
      total: docs.length,
      documentos: docs.map((d) => ({
        id: d.id,
        nombre: d.originalname || d.filename,
        mimetype: d.mimetype,
        size_bytes: d.size_bytes,
        created_at: d.created_at,
        descripcion: d.metadata_json?.descripcion || null,
        categoria: d.metadata_json?.categoria || null,
        url: `/api/archivos/${d.id}/contenido`,
      })),
    });
  } catch (error) {
    console.error('[Documentos] Error listando por beneficiario:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar documentos del beneficiario' });
  }
});

// GET /api/documentos/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const doc = await db.queryOne(
      'SELECT * FROM archivos WHERE id = $1 AND tipo = $2',
      [req.params.id, 'other']
    );
    if (!doc) {
      return res.status(404).json({ estado: 'error', mensaje: 'Documento no encontrado' });
    }
    // Roles de supervisión ven la evidencia de cualquier técnico. Antes solo
    // 'admin' era excepción, así que un coordinador listaba los archivos y
    // recibía 403 al abrir cualquiera de ellos.
    if (!ROLES_COORDINACION.includes(req.user.rol) && doc.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    res.json({ estado: 'ok', documento: doc });
  } catch (error) {
    console.error('[Documentos] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener documento' });
  }
});

module.exports = router;
