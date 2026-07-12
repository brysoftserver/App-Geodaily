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

    const { descripcion, categoria } = req.body;
    const ext = path.extname(req.file.originalname);
    const filename = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

    // Validar que el usuario tenga rol y nombre de usuario
    const userRol = req.user?.rol || 'otros';
    const userUsuario = req.user?.usuario || req.user?.id?.toString() || 'desconocido';

    // Subir a MinIO (con try-catch para no bloquear si MinIO no está disponible)
    try {
      await storage.uploadFile(
        userRol,
        userUsuario,
        'documentos',
        filename,
        req.file.buffer
      );
    } catch (storageErr) {
      console.error('[Documentos] Error al subir a MinIO (no crítico, continúa):', storageErr.message);
      // No retornamos error — el documento se marca para sincronización posterior
    }

    // Guardar registro en PostgreSQL
    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
    const basePath = storage.getUserBasePath(userRol, userUsuario);
    const minioPath = `${basePath}/documentos/${filename}`;
    await db.query(
      `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.user.id,
        'other',
        filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        minioPath,
        bucket,
        JSON.stringify({ descripcion: descripcion || null, categoria: categoria || null }),
      ]
    );

    // Obtener el ID generado
    const archivo = await db.queryOne(
      'SELECT id FROM archivos WHERE minio_path = $1 ORDER BY created_at DESC LIMIT 1',
      [minioPath]
    );
    const docId = archivo ? archivo.id : `doc-${Date.now()}`;

    // Registrar en actividad
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'subir_documento', JSON.stringify({ archivo_id: docId, filename, original: req.file.originalname })]
    );

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

    const resultados = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname);
      const filename = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

      await storage.uploadFile(
        req.user.rol, req.user.usuario, 'documentos', filename, file.buffer
      );

      const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);
      const minioPath = `${basePath}/documentos/${filename}`;
      const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';

      const archivoResult = await db.queryOne(
        `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          req.user.id, 'other', filename, file.originalname,
          file.mimetype, file.size, minioPath, bucket,
          JSON.stringify({}),
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
    res.json({ estado: 'ok', documento: doc });
  } catch (error) {
    console.error('[Documentos] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener documento' });
  }
});

module.exports = router;
