// ============================================================
// Photos Routes — Subida de fotos georreferenciadas
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Configurar multer — almacenamiento en disco
const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || './uploads', 'fotos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = `foto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype.split('/')[1]);
    cb(null, extOk || mimeOk);
  },
});

// POST /api/photos/subir
router.post('/subir', authenticateToken, upload.single('archivo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ estado: 'error', mensaje: 'Archivo requerido' });
    }

    const { latitud, longitud, altitud, nombre, descripcion } = req.body;

    const photoRecord = {
      id: `foto-${Date.now()}`,
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      url: `/uploads/fotos/${req.file.filename}`,
      latitud: latitud ? parseFloat(latitud) : null,
      longitud: longitud ? parseFloat(longitud) : null,
      altitud: altitud ? parseFloat(altitud) : null,
      nombre: nombre || null,
      descripcion: descripcion || null,
      usuario_id: req.user.id,
      timestamp: new Date().toISOString(),
    };

    console.log(`[Photos] Foto subida: ${photoRecord.id} (${req.file.filename})`);

    res.json({
      estado: 'ok',
      id: photoRecord.id,
      url: photoRecord.url,
      filename: photoRecord.filename,
      size: photoRecord.size,
    });
  } catch (error) {
    console.error('[Photos] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir foto' });
  }
});

// GET /api/photos/:id (mock)
router.get('/:id', authenticateToken, (req, res) => {
  res.json({
    estado: 'ok',
    foto: {
      id: req.params.id,
      url: `/uploads/fotos/${req.params.id}.jpg`,
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
