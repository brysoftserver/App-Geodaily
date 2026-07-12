// ============================================================
// Videos Routes — Subida de videos a MinIO
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

// Multer en memoria para subir a MinIO (límite 200MB para videos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /mp4|mov|avi|mkv|webm|3gp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype.split('/')[1]);
    cb(null, extOk || mimeOk);
  },
});

// POST /api/videos/subir
router.post('/subir', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ estado: 'error', mensaje: 'Archivo de video requerido' });
    }

    const { descripcion, latitud, longitud } = req.body;
    const ext = path.extname(req.file.originalname) || '.mp4';
    const filename = `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

    // Subir a MinIO
    await storage.uploadFile(
      req.user.rol,
      req.user.usuario,
      'videos',
      filename,
      req.file.buffer
    );

    // Guardar registro en PostgreSQL
    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
    const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);
    const minioPath = `${basePath}/videos/${filename}`;
    await db.query(
      `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, latitud, longitud, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        req.user.id,
        'video',
        filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        minioPath,
        bucket,
        latitud ? parseFloat(latitud) : null,
        longitud ? parseFloat(longitud) : null,
        JSON.stringify({ descripcion: descripcion || null }),
      ]
    );

    // Obtener el ID generado
    const archivo = await db.queryOne(
      'SELECT id FROM archivos WHERE minio_path = $1 ORDER BY created_at DESC LIMIT 1',
      [minioPath]
    );
    const videoId = archivo ? archivo.id : `video-${Date.now()}`;

    // Registrar actividad
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'subir_video', JSON.stringify({ archivo_id: videoId, filename, tamaño: req.file.size })]
    );

    console.log(`[Videos] 🎬 Video subido a MinIO: ${minioPath}`);

    res.json({
      estado: 'ok',
      id: videoId,
      ruta: minioPath,
      filename,
      size: req.file.size,
    });
  } catch (error) {
    console.error('[Videos] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir video a MinIO' });
  }
});

// POST /api/videos/subir-multiple — Subir varios videos
router.post('/subir-multiple', authenticateToken, upload.array('archivos', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ estado: 'error', mensaje: 'Archivos de video requeridos' });
    }

    const resultados = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname) || '.mp4';
      const filename = `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

      await storage.uploadFile(
        req.user.rol,
        req.user.usuario,
        'videos',
        filename,
        file.buffer
      );

      const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
      const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);
      const minioPath = `${basePath}/videos/${filename}`;
      await db.query(
        `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.user.id, 'video',
          filename,
          file.originalname,
          file.mimetype, file.size,
          minioPath,
          bucket,
        ]
      );
      const archivoResult = await db.queryOne(
        'SELECT id FROM archivos WHERE minio_path = $1 ORDER BY created_at DESC LIMIT 1',
        [minioPath]
      );
      const videoId = archivoResult ? archivoResult.id : `video-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;

      resultados.push({ id: videoId, filename, size: file.size });
    }

    res.json({
      estado: 'ok',
      mensaje: `${resultados.length} videos subidos`,
      videos: resultados,
    });
  } catch (error) {
    console.error('[Videos] Error subida múltiple:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir videos' });
  }
});

// GET /api/videos — Listar videos del usuario o todos (roles superiores)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let sql = 'SELECT * FROM archivos WHERE tipo = $1';
    const params = ['video'];

    if (req.user.rol === 'tecnico') {
      sql += ' AND usuario_id = $2';
      params.push(req.user.id);
    }

    sql += ' ORDER BY created_at DESC';

    const videos = await db.queryAll(sql, params);
    res.json({ estado: 'ok', total: videos.length, videos });
  } catch (error) {
    console.error('[Videos] Listar error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar videos' });
  }
});

// GET /api/videos/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const video = await db.queryOne(
      'SELECT * FROM archivos WHERE id = $1 AND tipo = $2',
      [req.params.id, 'video']
    );
    if (!video) {
      return res.status(404).json({ estado: 'error', mensaje: 'Video no encontrado' });
    }
    res.json({ estado: 'ok', video });
  } catch (error) {
    console.error('[Videos] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener video' });
  }
});

module.exports = router;
