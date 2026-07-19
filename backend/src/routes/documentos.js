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

    const { descripcion, categoria, beneficiario_cedula, beneficiario_nombre, tipo_formulario } = req.body;
    const ext = path.extname(req.file.originalname);
    const filename = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

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

    // Subir a MinIO (con try-catch para no bloquear si MinIO no está disponible)
    try {
      await storage.uploadFile(
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
      console.error('[Documentos] Error al subir a MinIO (no crítico, continúa):', storageErr.message);
    }

    // Guardar registro en PostgreSQL
    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';
    const basePath = storage.getUserBasePath(userRol, userUsuario);
    let minioPath;
    if (benefItem && benefNombre) {
      const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
      const formFolder = storage.getFormTypeFolder(tipo_formulario);
      minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/documentos/${filename}` : `${basePath}/${subpath}/documentos/${filename}`;
    } else {
      minioPath = `${basePath}/documentos/${filename}`;
    }

    const metadataExtra = {
      descripcion: descripcion || null,
      categoria: categoria || null,
      beneficiario_item: benefItem,
      beneficiario_cedula: beneficiario_cedula || null,
    };

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
        JSON.stringify(metadataExtra),
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
      if (benefItem && benefNombre) {
        const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
        const formFolder = storage.getFormTypeFolder(tipo_formulario);
        minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/documentos/${filename}` : `${basePath}/${subpath}/documentos/${filename}`;
      } else {
        minioPath = `${basePath}/documentos/${filename}`;
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
    // 'admin' era excepción, así que un supervisor listaba los archivos y
    // recibía 403 al abrir cualquiera de ellos.
    const ROLES_SUPERVISION = ['supervisor', 'interventor', 'gerente', 'admin'];
    if (!ROLES_SUPERVISION.includes(req.user.rol) && doc.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    res.json({ estado: 'ok', documento: doc });
  } catch (error) {
    console.error('[Documentos] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener documento' });
  }
});

module.exports = router;
