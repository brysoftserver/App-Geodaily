// ============================================================
// Photos Routes — Subida de fotos georreferenciadas a MinIO
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const { aplicarMarcaAgua, normalizarSinMarca } = require('../watermark');

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

    const { latitud, longitud, altitud, nombre, descripcion, beneficiario_cedula, beneficiario_nombre, timestamp_captura, tipo_formulario, formulario_id, evidencia_id } = req.body;

    // ─── Anti-resurrección: si un admin/coordinador borró esta evidencia
    // desde el detalle del formulario (DELETE /api/archivos/:id), se rechaza
    // la re-subida. El teléfono que capturó la foto la conserva en local y la
    // reintentaría en cada ciclo de sync; sin este check la fila volvería a
    // crearse y la evidencia reaparecería en la visita.
    if (evidencia_id) {
      const tumbaEvidencia = await db.queryOne(
        'SELECT id FROM evidencias_eliminadas WHERE evidencia_local_id = $1 LIMIT 1',
        [evidencia_id]
      );
      if (tumbaEvidencia) {
        console.log(`[Photos] Evidencia ${evidencia_id} fue eliminada — se rechaza la re-subida`);
        return res.status(410).json({
          estado: 'eliminado',
          mensaje: 'Esta evidencia fue eliminada por un administrador y no puede volver a subirse',
        });
      }
    }

    // ─── Idempotencia: si esta evidencia (id generado en el celular al
    // capturarla) ya se subió antes, se devuelve el registro existente en
    // vez de crear uno nuevo. Evita duplicados cuando la app reintenta una
    // subida que en realidad ya había llegado al servidor (timeout con
    // señal débil, cierre de la app antes de marcarla como sincronizada).
    if (evidencia_id) {
      const yaSubida = await db.queryOne(
        `SELECT id, minio_path, filename, size_bytes FROM archivos WHERE usuario_id = $1 AND evidencia_local_id = $2`,
        [req.user.id, evidencia_id]
      );
      if (yaSubida) {
        console.log(`[Photos] Evidencia ${evidencia_id} ya existía (id ${yaSubida.id}) — se omite duplicado`);
        return res.json({
          estado: 'ok',
          id: yaSubida.id,
          ruta: yaSubida.minio_path,
          filename: yaSubida.filename,
          size: yaSubida.size_bytes,
        });
      }
    }

    // ─── Marca de agua de evidencia (fecha de captura + GPS + ubicación +
    // clima a la hora de la toma). Nunca bloquea la subida: si falla,
    // se guarda la foto original. Solo aplica a formatos de imagen que
    // sharp puede recomponer (jpeg/png/webp — no HEIC/GIF).
    //
    // EXCEPCIÓN — fotos de SEGUIMIENTO: se guardan LIMPIAS (sin fecha ni
    // marca quemada). La fecha del seguimiento se estampa en el PDF, que es
    // editable, en vez de fijarla en el píxel. Igual se normaliza la
    // orientación EXIF y se re-codifica a JPEG para que la foto salga
    // derecha y liviana.
    let bufferFinal = req.file.buffer;
    let mimetypeFinal = req.file.mimetype;
    let extFinal = path.extname(req.file.originalname) || '.jpg';
    if (/jpeg|jpg|png|webp/i.test(req.file.mimetype)) {
      if (tipo_formulario === 'seguimiento') {
        const { buffer: limpia, normalizada } = await normalizarSinMarca(req.file.buffer);
        if (normalizada) {
          bufferFinal = limpia;
          mimetypeFinal = 'image/jpeg';
          extFinal = '.jpg';
        }
      } else {
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
    }

    const filename = `foto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${extFinal}`;

    // Validar datos de usuario (fallback seguro)
    const userRol = req.user?.rol || 'otros';
    const userUsuario = req.user?.usuario || req.user?.id?.toString() || 'desconocido';

    // ─── Resolver datos del beneficiario para carpeta en MinIO ───
    let benefItem = null;
    let benefNombre = null;
    let cedulaResuelta = beneficiario_cedula || null;
    let tipoFormularioResuelto = tipo_formulario || null;

    // Red de seguridad: si no llegó la cédula (ej. un reintento offline que
    // perdió el contexto del beneficiario) pero sí el formulario_id, se
    // resuelve consultando el formulario ya guardado en el servidor — evita
    // que la foto caiga en la carpeta genérica del técnico.
    if (!cedulaResuelta && formulario_id) {
      try {
        const formulario = await db.queryOne(
          `SELECT tipo, beneficiario_json->>'cedula' AS cedula FROM formularios WHERE id = $1`,
          [formulario_id]
        );
        if (formulario) {
          cedulaResuelta = formulario.cedula || null;
          tipoFormularioResuelto = tipoFormularioResuelto || formulario.tipo || null;
        }
      } catch (lookupErr) {
        console.warn('[Photos] Error resolviendo beneficiario desde formulario:', lookupErr.message);
      }
    }

    if (cedulaResuelta) {
      try {
        const benef = await db.queryOne(
          'SELECT item, nombre_completo FROM beneficiarios WHERE cedula = $1',
          [cedulaResuelta.trim()]
        );
        if (benef) {
          benefItem = benef.item;
          // El nombre oficial de la tabla beneficiarios siempre gana sobre
          // lo que mande el cliente: si no coincide exactamente (typo,
          // corrección posterior del dato oficial), no debe crear una
          // carpeta distinta para el mismo beneficiario.
          benefNombre = benef.nombre_completo || beneficiario_nombre;
        }
      } catch (lookupErr) {
        console.warn('[Photos] Error buscando beneficiario:', lookupErr.message);
      }
    }

    // Preparar la ruta con la misma función que usa uploadFile; sirve también
    // para limpiar si MinIO sube el objeto pero falla al generar la URL firmada.
    const rutaEsperada = benefItem && benefNombre
      ? storage.getBeneficiaryFilePath(userRol, userUsuario, benefItem, benefNombre, tipoFormularioResuelto, 'fotos', filename)
      : storage.getFilePath(userRol, userUsuario, 'fotos', filename);

    // No registrar ni confirmar la evidencia si MinIO no aceptó el objeto.
    const storageMeta = {
      contentType: mimetypeFinal,
      beneficiarioItem: benefItem,
      beneficiarioNombre: benefNombre,
      tipoFormulario: tipoFormularioResuelto,
    };
    let objetoMinio;
    try {
      objetoMinio = await storage.uploadFile(
        userRol,
        userUsuario,
        'fotos',
        filename,
        bufferFinal,
        storageMeta
      );
    } catch (storageErr) {
      const eliminado = await storage.deleteFile(rutaEsperada);
      if (!eliminado) {
        console.warn('[Photos] No se pudo limpiar la ruta tras fallo de subida:', rutaEsperada);
      }
      console.error('[Photos] Error al subir a MinIO:', storageErr.message);
      throw storageErr;
    }

    // Guardar registro en PostgreSQL
    const bucket = objetoMinio.bucket || process.env.MINIO_BUCKET || 'geodaily-archivos';
    const minioPath = objetoMinio.path;

    const metadataExtra = {
      nombre: nombre || null,
      descripcion: descripcion || null,
      beneficiario_item: benefItem,
      beneficiario_cedula: cedulaResuelta || null,
      // Se guarda también en metadata porque la evidencia suele subirse
      // ANTES de que el formulario exista en el servidor (flujo offline).
      // La columna formulario_id se rellena luego, al guardar el formulario.
      formulario_id: formulario_id || null,
    };

    // formulario_id permite recuperar la evidencia desde otro dispositivo.
    // El SELECT evita violar la FK cuando la foto llega antes que el
    // formulario (caso normal offline): queda NULL y se vincula después.
    let archivoCreado;
    try {
      archivoCreado = await db.query(
        `INSERT INTO archivos (usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, latitud, longitud, altitud, metadata_json, evidencia_local_id)
         VALUES ($1, (SELECT id FROM formularios WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
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
          evidencia_id || null,
        ]
      );
    } catch (insertErr) {
      // 23505 = unique_violation — dos subidas de la misma evidencia casi
      // simultáneas (el chequeo de arriba no alcanzó a verla). El archivo ya
      // se subió a MinIO de más, pero no se duplica el registro en BD.
      if (insertErr.code === '23505' && evidencia_id) {
        const existente = await db.queryOne(
          `SELECT id, minio_path, filename, size_bytes FROM archivos WHERE usuario_id = $1 AND evidencia_local_id = $2`,
          [req.user.id, evidencia_id]
        );
        if (existente) {
          await storage.deleteFile(minioPath);
          console.log(`[Photos] Carrera detectada para evidencia ${evidencia_id} — se omite duplicado`);
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

    const photoId = archivoCreado.rows[0]?.id || `foto-${Date.now()}`;

    // Registrar en actividad
    try {
      await db.query(
        'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
        [req.user.id, 'subir_foto', JSON.stringify({ archivo_id: photoId, filename, tamaño: req.file.size })]
      );
    } catch (logErr) {
      console.warn('[Photos] No se pudo registrar la actividad:', logErr.message);
    }

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
    // 'admin' era excepción, así que un coordinador listaba los archivos y
    // recibía 403 al abrir cualquiera de ellos.
    const ROLES_COORDINACION = ['coordinador', 'interventor', 'gerente', 'admin'];
    if (!ROLES_COORDINACION.includes(req.user.rol) && foto.usuario_id !== req.user.id) {
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
