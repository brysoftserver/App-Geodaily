// ============================================================
// Photos Routes — Subida de fotos georreferenciadas a MinIO
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const { aplicarMarcaAgua } = require('../watermark');

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

    const { latitud, longitud, altitud, nombre, descripcion, beneficiario_cedula, beneficiario_nombre, timestamp_captura, tipo_formulario, formulario_id } = req.body;

    // ─── Marca de agua de evidencia (fecha de captura + GPS + ubicación +
    // clima a la hora de la toma). Nunca bloquea la subida: si falla,
    // se guarda la foto original. Solo aplica a formatos de imagen que
    // sharp puede recomponer (jpeg/png/webp — no HEIC/GIF).
    let bufferFinal = req.file.buffer;
    let mimetypeFinal = req.file.mimetype;
    let extFinal = path.extname(req.file.originalname) || '.jpg';
    if (/jpeg|jpg|png|webp/i.test(req.file.mimetype)) {
      const { buffer: marcado, marcada } = await aplicarMarcaAgua(req.file.buffer, {
        latitud,
        longitud,
        altitud,
        timestampCaptura: timestamp_captura,
      });
      if (marcada) {
        bufferFinal = marcado;
        mimetypeFinal = 'image/jpeg'; // la marca re-codifica a JPEG
        extFinal = '.jpg';
      }
    }

    const filename = `foto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${extFinal}`;

    // Validar datos de usuario (fallback seguro)
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
        console.warn('[Photos] Error buscando beneficiario:', lookupErr.message);
      }
    }

    // Subir a MinIO
    const storageMeta = {
      contentType: mimetypeFinal,
      beneficiarioItem: benefItem,
      beneficiarioNombre: benefNombre,
      tipoFormulario: tipo_formulario,
    };
    try {
      await storage.uploadFile(
        userRol,
        userUsuario,
        'fotos',
        filename,
        bufferFinal,
        storageMeta
      );
    } catch (storageErr) {
      console.error('[Photos] Error al subir a MinIO (no crítico, continúa):', storageErr.message);
    }

    // Guardar registro en PostgreSQL
    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
    const basePath = storage.getUserBasePath(userRol, userUsuario);
    let minioPath;
    if (benefItem && benefNombre) {
      const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
      const formFolder = storage.getFormTypeFolder(tipo_formulario);
      minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/fotos/${filename}` : `${basePath}/${subpath}/fotos/${filename}`;
    } else {
      minioPath = `${basePath}/fotos/${filename}`;
    }

    const metadataExtra = {
      nombre: nombre || null,
      descripcion: descripcion || null,
      beneficiario_item: benefItem,
      beneficiario_cedula: beneficiario_cedula || null,
      // Se guarda también en metadata porque la evidencia suele subirse
      // ANTES de que el formulario exista en el servidor (flujo offline).
      // La columna formulario_id se rellena luego, al guardar el formulario.
      formulario_id: formulario_id || null,
    };

    // formulario_id permite recuperar la evidencia desde otro dispositivo.
    // El SELECT evita violar la FK cuando la foto llega antes que el
    // formulario (caso normal offline): queda NULL y se vincula después.
    await db.query(
      `INSERT INTO archivos (usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, latitud, longitud, altitud, metadata_json)
       VALUES ($1, (SELECT id FROM formularios WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        req.user.id,
        formulario_id || null,
        'foto',
        filename,
        req.file.originalname,
        mimetypeFinal,
        bufferFinal.length,
        minioPath,
        bucket,
        latitud ? parseFloat(latitud) : null,
        longitud ? parseFloat(longitud) : null,
        altitud ? parseFloat(altitud) : null,
        JSON.stringify(metadataExtra),
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
    // Roles de supervisión ven la evidencia de cualquier técnico. Antes solo
    // 'admin' era excepción, así que un supervisor listaba los archivos y
    // recibía 403 al abrir cualquiera de ellos.
    const ROLES_SUPERVISION = ['supervisor', 'interventor', 'gerente', 'admin'];
    if (!ROLES_SUPERVISION.includes(req.user.rol) && foto.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
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
