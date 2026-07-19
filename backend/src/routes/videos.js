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

    const { descripcion, latitud, longitud, beneficiario_cedula, beneficiario_nombre, tipo_formulario, formulario_id } = req.body;
    const ext = path.extname(req.file.originalname) || '.mp4';
    const filename = `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

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
        console.warn('[Videos] Error buscando beneficiario:', lookupErr.message);
      }
    }

    // Subir a MinIO (con carpeta de beneficiario si aplica)
    await storage.uploadFile(
      req.user.rol,
      req.user.usuario,
      'videos',
      filename,
      req.file.buffer,
      {
        contentType: req.file.mimetype,
        beneficiarioItem: benefItem,
        beneficiarioNombre: benefNombre,
        tipoFormulario: tipo_formulario,
      }
    );

    // Guardar registro en PostgreSQL
    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
    const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);
    let minioPath;
    if (benefItem && benefNombre) {
      const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
      const formFolder = storage.getFormTypeFolder(tipo_formulario);
      minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/videos/${filename}` : `${basePath}/${subpath}/videos/${filename}`;
    } else {
      minioPath = `${basePath}/videos/${filename}`;
    }

    const metadataExtra = {
      descripcion: descripcion || null,
      beneficiario_item: benefItem,
      beneficiario_cedula: beneficiario_cedula || null,
      // Ver nota en photos.js: la evidencia suele subirse antes que el
      // formulario, así que el vínculo también se guarda en metadata.
      formulario_id: formulario_id || null,
    };

    // Ver nota en photos.js: el SELECT evita violar la FK cuando el video
    // llega antes que el formulario.
    await db.query(
      `INSERT INTO archivos (usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, latitud, longitud, metadata_json)
       VALUES ($1, (SELECT id FROM formularios WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        req.user.id,
        formulario_id || null,
        'video',
        filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        minioPath,
        bucket,
        latitud ? parseFloat(latitud) : null,
        longitud ? parseFloat(longitud) : null,
        JSON.stringify(metadataExtra),
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
        console.warn('[Videos] Error buscando beneficiario en subida múltiple:', lookupErr.message);
      }
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
        file.buffer,
        {
          contentType: file.mimetype,
          beneficiarioItem: benefItem,
          beneficiarioNombre: benefNombre,
          tipoFormulario: tipo_formulario,
        }
      );

      const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
      const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);
      let minioPath;
      if (benefItem && benefNombre) {
        const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
        const formFolder = storage.getFormTypeFolder(tipo_formulario);
        minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/videos/${filename}` : `${basePath}/${subpath}/videos/${filename}`;
      } else {
        minioPath = `${basePath}/videos/${filename}`;
      }

      await db.query(
        `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          req.user.id, 'video',
          filename,
          file.originalname,
          file.mimetype, file.size,
          minioPath,
          bucket,
          JSON.stringify({ beneficiario_item: benefItem, beneficiario_cedula: beneficiario_cedula || null }),
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
    // Roles de supervisión ven la evidencia de cualquier técnico. Antes solo
    // 'admin' era excepción, así que un supervisor listaba los archivos y
    // recibía 403 al abrir cualquiera de ellos.
    const ROLES_SUPERVISION = ['supervisor', 'interventor', 'gerente', 'admin'];
    if (!ROLES_SUPERVISION.includes(req.user.rol) && video.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    res.json({ estado: 'ok', video });
  } catch (error) {
    console.error('[Videos] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener video' });
  }
});

module.exports = router;
