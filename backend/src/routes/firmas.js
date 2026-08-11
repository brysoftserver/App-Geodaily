// ============================================================
// Firmas Routes — Subida de firmas a MinIO
// Ruta en MinIO: {rol}s/{usuario}/firmas/{filename}
// ============================================================

const express = require('express');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

/**
 * Convertir base64 a Buffer
 */
function base64ToBuffer(dataUri) {
  const matches = dataUri.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return null;
  return {
    buffer: Buffer.from(matches[2], 'base64'),
    mimetype: matches[1],
  };
}

// POST /api/firmas/subir — Subir una firma (base64) a MinIO
router.post('/subir', authenticateToken, async (req, res) => {
  try {
    const { tipo, data, beneficiario_cedula, beneficiario_nombre, tipo_formulario } = req.body; // tipo: 'beneficiario' | 'tecnico' | 'revisor'

    if (!data || !tipo) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Datos de firma requeridos (data base64 + tipo)',
      });
    }

    // 'revisor' = firma de supervisor/interventor/gerente/admin en su
    // sección de evidencia final (no se asocia a formularios.firma_tecnico
    // como las otras, por eso solo pasa por /subir y no por
    // /guardar-en-formulario).
    if (!['beneficiario', 'tecnico', 'revisor'].includes(tipo)) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'tipo debe ser "beneficiario", "tecnico" o "revisor"',
      });
    }

    const converted = base64ToBuffer(data);
    if (!converted) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Formato base64 inválido. Debe ser data:image/...;base64,...',
      });
    }

    const timestamp = Date.now();
    const filename = `firma_${tipo}_${timestamp}.png`;

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
        console.warn('[Firmas] Error buscando beneficiario:', lookupErr.message);
      }
    }

    // Subir a MinIO
    await storage.uploadFile(
      req.user.rol,
      req.user.usuario,
      'firmas',
      filename,
      converted.buffer,
      {
        contentType: converted.mimetype,
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
      minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/firmas/${filename}` : `${basePath}/${subpath}/firmas/${filename}`;
    } else {
      minioPath = `${basePath}/firmas/${filename}`;
    }

    const metadataExtra = {
      tipo_firma: tipo,
      beneficiario_item: benefItem,
      beneficiario_cedula: beneficiario_cedula || null,
    };

    await db.query(
      `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.user.id,
        'firma',
        filename,
        `firma_${tipo}.png`,
        converted.mimetype,
        converted.buffer.length,
        minioPath,
        bucket,
        JSON.stringify({ tipo_firma: tipo }),
      ]
    );

    // Obtener el ID generado
    const archivo = await db.queryOne(
      'SELECT id FROM archivos WHERE minio_path = $1 ORDER BY created_at DESC LIMIT 1',
      [minioPath]
    );
    const firmaId = archivo ? archivo.id : `firma-${timestamp}`;

    // Registrar en actividad
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'subir_firma', JSON.stringify({ archivo_id: firmaId, filename, tipo_firma: tipo })]
    );

    console.log(`[Firmas] ✍️ Firma subida a MinIO: ${minioPath}`);

    res.json({
      estado: 'ok',
      id: firmaId,
      ruta: minioPath,
      filename,
      tipo_firma: tipo,
      mensaje: 'Firma almacenada correctamente',
    });
  } catch (error) {
    console.error('[Firmas] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al subir firma a MinIO' });
  }
});

// POST /api/firmas/guardar-en-formulario — Sube firma Y la asocia a un formulario
router.post('/guardar-en-formulario', authenticateToken, async (req, res) => {
  try {
    const { formulario_id, tipo, data, beneficiario_cedula, beneficiario_nombre, tipo_formulario } = req.body;

    if (!formulario_id || !data || !tipo) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'formulario_id, tipo y data (base64) requeridos',
      });
    }

    // Comprobar la PROPIEDAD ANTES de subir nada. Sin esta comprobación
    // cualquier usuario autenticado podía sobrescribir la firma de un
    // formulario ajeno; y si se validaba al final, el archivo ya se había
    // subido a MinIO y registrado en la BD aunque luego se rechazara.
    const ROLES_SUPERVISION = ['supervisor', 'interventor', 'gerente', 'admin'];
    const propietario = await db.queryOne(
      'SELECT usuario_id FROM formularios WHERE id = $1',
      [formulario_id]
    );
    if (!propietario) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formulario no encontrado' });
    }
    if (propietario.usuario_id !== req.user.id && !ROLES_SUPERVISION.includes(req.user.rol)) {
      return res.status(403).json({
        estado: 'error',
        mensaje: 'No autorizado para modificar este formulario',
      });
    }

    // Subir firma a MinIO
    const converted = base64ToBuffer(data);
    if (!converted) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Formato base64 inválido',
      });
    }

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
        console.warn('[Firmas] Error buscando beneficiario:', lookupErr.message);
      }
    }

    const timestamp = Date.now();
    const filename = `firma_${tipo}_${formulario_id}_${timestamp}.png`;

    await storage.uploadFile(
      req.user.rol,
      req.user.usuario,
      'firmas',
      filename,
      converted.buffer,
      {
        contentType: converted.mimetype,
        beneficiarioItem: benefItem,
        beneficiarioNombre: benefNombre,
        tipoFormulario: tipo_formulario,
      }
    );

    const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);
    let minioPath;
    if (benefItem && benefNombre) {
      const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
      const formFolder = storage.getFormTypeFolder(tipo_formulario);
      minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/firmas/${filename}` : `${basePath}/${subpath}/firmas/${filename}`;
    } else {
      minioPath = `${basePath}/firmas/${filename}`;
    }

    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';

    // Guardar en archivos
    const archivoResult = await db.queryOne(
      `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        req.user.id, 'firma', filename, `firma_${tipo}.png`,
        converted.mimetype, converted.buffer.length,
        minioPath, bucket,
        JSON.stringify({
          tipo_firma: tipo,
          formulario_id,
          beneficiario_item: benefItem,
          beneficiario_cedula: beneficiario_cedula || null,
        }),
      ]
    );
    const firmaId = archivoResult?.id || `firma-${timestamp}`;

    // La propiedad ya se validó al inicio del handler.
    const campo = tipo === 'beneficiario' ? 'firma_beneficiario' : 'firma_tecnico';
    await db.query(
      `UPDATE formularios SET ${campo} = $1, updated_at = NOW() WHERE id = $2`,
      [minioPath, formulario_id]
    );

    console.log(`[Firmas] ✍️ Firma ${tipo} asociada a formulario ${formulario_id}: ${minioPath}`);

    res.json({
      estado: 'ok',
      id: firmaId,
      ruta: minioPath,
      tipo_firma: tipo,
      formulario_id,
      mensaje: 'Firma guardada y asociada al formulario',
    });
  } catch (error) {
    console.error('[Firmas] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar firma en formulario' });
  }
});

// GET /api/firmas/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const firma = await db.queryOne(
      'SELECT * FROM archivos WHERE id = $1 AND tipo = $2',
      [req.params.id, 'firma']
    );
    if (!firma) {
      return res.status(404).json({ estado: 'error', mensaje: 'Firma no encontrada' });
    }
    // Roles de supervisión ven la evidencia de cualquier técnico. Antes solo
    // 'admin' era excepción, así que un supervisor listaba los archivos y
    // recibía 403 al abrir cualquiera de ellos.
    const ROLES_SUPERVISION = ['supervisor', 'interventor', 'gerente', 'admin'];
    if (!ROLES_SUPERVISION.includes(req.user.rol) && firma.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    res.json({ estado: 'ok', firma });
  } catch (error) {
    console.error('[Firmas] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener firma' });
  }
});

module.exports = router;
