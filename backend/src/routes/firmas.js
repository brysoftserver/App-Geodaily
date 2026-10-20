// ============================================================
// Firmas Routes — Subida de firmas a MinIO
// Ruta en MinIO: {rol}s/{usuario}/firmas/{filename}
// ============================================================

const express = require('express');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const { esTecnicoVigenteDelFormulario } = require('../lib/atribucion');
const { resolverDuenoDeFormulario } = require('../lib/duenoEvidencia');

const router = express.Router();

/** Roles de supervisión: pueden tocar la evidencia de cualquier formulario. */
const ROLES_COORDINACION = ['coordinador', 'interventor', 'gerente', 'admin'];

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
    const { tipo, data, beneficiario_cedula, beneficiario_nombre, tipo_formulario, evidencia_id } = req.body; // tipo: 'beneficiario' | 'tecnico' | 'revisor'

    if (!data || !tipo) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Datos de firma requeridos (data base64 + tipo)',
      });
    }

    // 'revisor' = firma de coordinador/interventor/gerente/admin en su
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

    if (evidencia_id) {
      const yaSubida = await db.queryOne(
        'SELECT id, minio_path, filename, size_bytes FROM archivos WHERE usuario_id = $1 AND evidencia_local_id = $2',
        [req.user.id, evidencia_id]
      );
      if (yaSubida) {
        return res.json({
          estado: 'ok',
          id: yaSubida.id,
          ruta: yaSubida.minio_path,
          filename: yaSubida.filename,
          size: yaSubida.size_bytes,
        });
      }
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
    const objetoMinio = await storage.uploadFile(
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
    const bucket = objetoMinio.bucket || process.env.MINIO_BUCKET || 'geodaily-archivos';
    const minioPath = objetoMinio.path;

    const metadataExtra = {
      tipo_firma: tipo,
      beneficiario_item: benefItem,
      beneficiario_cedula: beneficiario_cedula || null,
    };

    let archivoCreado;
    try {
      archivoCreado = await db.query(
        `INSERT INTO archivos (usuario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json, evidencia_local_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          req.user.id,
          'firma',
          filename,
          `firma_${tipo}.png`,
          converted.mimetype,
          converted.buffer.length,
          minioPath,
          bucket,
          JSON.stringify({ tipo_firma: tipo, beneficiario_cedula: beneficiario_cedula || null }),
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

    const firmaId = archivoCreado.rows[0]?.id || `firma-${timestamp}`;

    // Registrar en actividad
    try {
      await db.query(
        'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
        [req.user.id, 'subir_firma', JSON.stringify({ archivo_id: firmaId, filename, tipo_firma: tipo })]
      );
    } catch (logErr) {
      console.warn('[Firmas] No se pudo registrar la actividad:', logErr.message);
    }

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
    //
    // El dueño se resuelve con el MISMO criterio que usa la app para mostrar
    // el botón «Cambiar firma» (resolverDuenoFormulario) y que PATCH
    // /formularios/:id/respuesta: manda el snapshot `tecnico_json.usuario_id`
    // (se reescribe al reasignar el beneficiario) y la columna queda de
    // respaldo. Comparar contra la sola columna dejaba fuera a los
    // formularios levantados "a nombre de" un técnico por un supervisor.
    //
    // Además se trae el técnico asignado HOY al beneficiario: cuando el
    // técnico cambia y el interventor pide reemplazar las firmas, el nuevo
    // responsable de la visita es ese técnico vigente — el mismo caso de las
    // visitas heredadas que ya se admite al corregir respuestas.
    const propietario = await db.queryOne(
      `SELECT COALESCE(NULLIF(tecnico_json->>'usuario_id', ''), usuario_id) AS usuario_id,
              firma_beneficiario,
              firma_tecnico,
              (SELECT CASE WHEN COUNT(DISTINCT b.tecnico_asignado_id) = 1
                           THEN MIN(b.tecnico_asignado_id) END
                 FROM beneficiarios b
                WHERE TRIM(b.cedula) = TRIM(beneficiario_json->>'cedula')
                  AND b.tecnico_asignado_id IS NOT NULL) AS tecnico_vigente
         FROM formularios WHERE id = $1`,
      [formulario_id]
    );
    if (!propietario) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formulario no encontrado' });
    }
    const esCoordinacion = ROLES_COORDINACION.includes(req.user.rol);
    const esDueno = propietario.usuario_id === req.user.id;
    const esTecnicoVigente =
      req.user.rol === 'tecnico' &&
      esTecnicoVigenteDelFormulario({
        usuarioSolicitante: req.user.id,
        duenoDelFormulario: propietario.usuario_id,
        tecnicoVigente: propietario.tecnico_vigente,
      });
    if (!esCoordinacion && !esDueno && !esTecnicoVigente) {
      return res.status(403).json({
        estado: 'error',
        mensaje: 'No autorizado para modificar este formulario',
      });
    }

    // ─── Firma FALTANTE: solo el admin ───
    // Caso real: el beneficiario o el técnico no estaban en la visita y
    // vuelven después. La firma se registra con el admin delante, así que es
    // el admin el ÚNICO que puede añadir una firma donde no había ninguna.
    // Sin este control, el técnico dueño del formulario podría "conseguir"
    // una firma en cualquier momento y desde cualquier lugar (solo se le
    // autoriza a REEMPLAZAR una ya existente).
    const campoFirma = tipo === 'beneficiario' ? 'firma_beneficiario' : 'firma_tecnico';
    const firmaPrevia = tipo === 'beneficiario' ? propietario.firma_beneficiario : propietario.firma_tecnico;
    if (!firmaPrevia && req.user.rol !== 'admin') {
      return res.status(403).json({
        estado: 'error',
        mensaje:
          'Solo el administrador puede registrar una firma faltante en este formulario',
      });
    }

    // ─── Atribución: la firma pertenece al DUEÑO del formulario ───
    // Si firma el admin (caso habitual aquí), guardar el archivo en
    // `admin/<usuario>` y a su nombre lo deja invisible para el técnico: la
    // app resuelve la firma listando `GET /api/archivos/formulario/:id`, que
    // filtra por `usuario_id` para los roles que no son de coordinación.
    // Por eso el archivo se guarda en el árbol del dueño, y quién lo firmó
    // queda en `metadata_json.firmado_por` (trazabilidad).
    const duenoFormulario = await resolverDuenoDeFormulario(formulario_id);
    const propietarioArchivo = duenoFormulario || {
      id: req.user.id,
      rol: req.user.rol,
      usuario: req.user.usuario,
    };
    const firmadoPorOtro = String(propietarioArchivo.id) !== String(req.user.id);

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
      propietarioArchivo.rol,
      propietarioArchivo.usuario,
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

    const basePath = storage.getUserBasePath(propietarioArchivo.rol, propietarioArchivo.usuario);
    let minioPath;
    const formFolder = storage.getFormTypeFolder(tipo_formulario);
    if (benefItem && benefNombre) {
      const subpath = storage.getBeneficiarySubpath(benefItem, benefNombre);
      minioPath = formFolder ? `${basePath}/${subpath}/${formFolder}/firmas/${filename}` : `${basePath}/${subpath}/firmas/${filename}`;
    } else {
      minioPath = formFolder ? `${basePath}/${formFolder}/firmas/${filename}` : `${basePath}/firmas/${filename}`;
    }

    const bucket = process.env.MINIO_BUCKET || 'geodaily-archivos';

    // Guardar en archivos
    const archivoResult = await db.queryOne(
      `INSERT INTO archivos (usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
       VALUES ($1, (SELECT id FROM formularios WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        propietarioArchivo.id, formulario_id, 'firma', filename, `firma_${tipo}.png`,
        converted.mimetype, converted.buffer.length,
        minioPath, bucket,
        JSON.stringify({
          tipo_firma: tipo,
          formulario_id,
          beneficiario_item: benefItem,
          beneficiario_cedula: beneficiario_cedula || null,
          // Quién firmó: el admin puede registrar una firma faltante a
          // nombre del beneficiario/técnico, así que se deja constancia.
          firmado_por: firmadoPorOtro ? req.user.id : null,
          firmado_por_rol: firmadoPorOtro ? req.user.rol || null : null,
        }),
      ]
    );
    const firmaId = archivoResult?.id || `firma-${timestamp}`;

    // La propiedad ya se validó al inicio del handler.
    const campo = campoFirma;
    await db.query(
      `UPDATE formularios SET ${campo} = $1, updated_at = NOW() WHERE id = $2`,
      [minioPath, formulario_id]
    );

    console.log(
      `[Firmas] ✍️ Firma ${tipo} ${firmaPrevia ? 'reemplazada' : 'registrada'} en formulario ${formulario_id}: ${minioPath}` +
        (firmadoPorOtro ? ` — firmada por ${req.user.usuario} (${req.user.rol})` : '')
    );

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
    // Roles de supervisión ven la evidencia de cualquier técnico (constante
    // declarada arriba del archivo). Antes solo 'admin' era excepción, así
    // que un coordinador listaba los archivos y recibía 403 al abrir
    // cualquiera de ellos.
    if (!ROLES_COORDINACION.includes(req.user.rol) && firma.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    res.json({ estado: 'ok', firma });
  } catch (error) {
    console.error('[Firmas] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener firma' });
  }
});

module.exports = router;
