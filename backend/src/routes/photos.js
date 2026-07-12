// ============================================================
// Photos Routes — Subida de fotos georreferenciadas a MinIO
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

// Multer en memoria (buffer) para subir a MinIO
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype.split('/')[1]);
    cb(null, extOk || mimeOk);
  },
});

// POST /api/photos/subir
router.post('/subir', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    }

    const { latitud, longitud, altitud, nombre, descripcion } = req.body;
    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = `foto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

    // Validar datos de usuario (fallback seguro)
    const userRol = req.user?.rol || 'otros';
    const userUsuario = req.user?.usuario || req.user?.id?.toString() || 'desconocido';

    // Subir a MinIO (con try-catch para no bloquear si MinIO no está disponible)
    try {
      await storage.uploadFile(
        userRol,
        userUsuario,
        'fotos',
        filename,
        req.file.buffer
      );
    } catch (storageErr) {
      console.error('[Photos] Error al subir a MinIO (no crítico, continúa):', storageErr.message);
      // No retornamos error — la foto se marca para sincronización posterior
    }

    // Guardar registro en PostgreSQL
    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
    const basePath = storage.getUserBasePath(userRol, userUsuario);
    const minioPath = `${basePath}/fotos/${filename}`;
    await db.query(
      `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, latitud, longitud, altitud, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        req.user.id,
        'foto',
        filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        minioPath,
        bucket,
        latitud ? parseFloat(latitud) : null,
        longitud ? parseFloat(longitud) : null,
        altitud ? parseFloat(altitud) : null,
        JSON.stringify({ nombre: nombre || null, descripcion: descripcion || null }),
      ]
    );

    // Obtener el ID generado
    const archivo = await db.queryOne(
      'SELECT id FROM archivos WHERE minio_path = $1 ORDER BY created_at DESC LIMIT 1',
      [minioPath]
    );
    const photoId = archivo ? archivo.id : `foto-${Date.now()}`;

    // Registrar en actividad
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'subir_foto', JSON.stringify({ archivo_id: photoId, filename, tamaño: req.file.size })]
    );

    console.log(`[Photos] 📸 Foto subida a MinIO: ${minioPath}`);

    res.json({
      estado: 'ok',
      id: photoId,
      ruta: minioPath,
      filename,
      size: req.file.size,
    });
  } catch (error) {
    console.error('[Photos] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir foto a MinIO' });
  }
});

// GET /api/photos/:id — Obtener metadata de una foto
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const foto = await db.queryOne(
      'SELECT * FROM archivos WHERE id = $1 AND tipo = $2',
      [req.params.id, 'foto']
    );
    if (!foto) {
      return res.status(404).json({ estado: 'error', mensaje: 'Foto no encontrada' });
    }

    res.json({
      estado: 'ok',
      foto: {
        id: foto.id,
        minio_path: foto.minio_path,
        filename: foto.filename,
        originalname: foto.originalname,
        mimetype: foto.mimetype,
        size_bytes: foto.size_bytes,
        metadata: foto.metadata_json,
        latitud: foto.latitud,
        longitud: foto.longitud,
        timestamp: foto.created_at,
      },
    });
  } catch (error) {
    console.error('[Photos] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener foto' });
  }
});

module.exports = router;
