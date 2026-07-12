// ============================================================
// Forms Routes — CRUD de formularios (PostgreSQL)
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');
const router = express.Router();

/**
 * Detectar si un string es base64 (data URI)
 */
function esBase64DataURI(val) {
  return typeof val === 'string' && /^data:image\/[a-zA-Z]+;base64,/.test(val);
}

/**
 * Subir una firma/foto base64 a MinIO y devolver la ruta
 */
async function subirBase64AMinIO(req, data, tipo, prefijo) {
  if (!esBase64DataURI(data)) return data; // ya es ruta o null

  const matches = data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
  const buffer = Buffer.from(matches[2], 'base64');
  const timestamp = Date.now();
  const filename = `${prefijo}_${timestamp}.png`;
  const basePath = storage.getUserBasePath(req.user.rol, req.user.usuario);

  await storage.uploadFile(
    req.user.rol, req.user.usuario, 'firmas', filename, buffer,
    { contentType: matches[1] }
  );

  return `${basePath}/firmas/${filename}`;
}

// POST /api/formularios/guardar
router.post('/guardar', authenticateToken, async (req, res) => {
  try {
    const formulario = req.body;

    if (!formulario || !formulario.id) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Formulario inválido: id requerido',
      });
    }

    // Extraer campos del formulario para mapear al esquema
    const beneficiario = formulario.beneficiario || {};
    const actividad = formulario.actividad || {};
    const sociodemografico = formulario.sociodemografico || {};
    const caracterizacion = formulario.caracterizacion_nueva || {};
    const coordenadas = formulario.coordenadas || {};
    const georeferencia = formulario.georeferencia || {};
    const clima = formulario.clima || {};
    const fotos = formulario.fotos || [];

    const existente = await db.queryOne('SELECT id FROM formularios WHERE id = $1', [formulario.id]);

    // Subir firmas base64 a MinIO si vienen en ese formato
    const firmaBeneficiario = await subirBase64AMinIO(req, formulario.firma_beneficiario, 'beneficiario', `firma_beneficiario_${formulario.id}`);
    const firmaTecnico = await subirBase64AMinIO(req, formulario.firma_tecnico, 'tecnico', `firma_tecnico_${formulario.id}`);

    if (existente) {
      await db.query(
        `UPDATE formularios SET
          tipo = $1, usuario_id = $2,
          beneficiario_json = $3, actividad_json = $4,
          sociodemografico_json = $5, caracterizacion_nueva_json = $6,
          coordenadas_json = $7, georeferencia_json = $8,
          clima_json = $9, fotos_json = $10,
          firma_beneficiario = $11, firma_tecnico = $12,
          huella_beneficiario = $13, sincronizado = TRUE,
          updated_at = NOW()
         WHERE id = $14`,
        [
          formulario.tipo || 'desconocido',
          req.user.id,
          JSON.stringify(beneficiario),
          JSON.stringify(actividad),
          JSON.stringify(sociodemografico),
          JSON.stringify(caracterizacion),
          JSON.stringify(coordenadas),
          JSON.stringify(georeferencia),
          JSON.stringify(clima),
          JSON.stringify(fotos),
          firmaBeneficiario,
          firmaTecnico,
          formulario.huella_beneficiario || false,
          formulario.id,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO formularios
          (id, tipo, usuario_id, beneficiario_json, actividad_json,
           sociodemografico_json, caracterizacion_nueva_json,
           coordenadas_json, georeferencia_json, clima_json,
           fotos_json, firma_beneficiario, firma_tecnico,
           huella_beneficiario, sincronizado, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE, $15)`,
        [
          formulario.id,
          formulario.tipo || 'desconocido',
          req.user.id,
          JSON.stringify(beneficiario),
          JSON.stringify(actividad),
          JSON.stringify(sociodemografico),
          JSON.stringify(caracterizacion),
          JSON.stringify(coordenadas),
          JSON.stringify(georeferencia),
          JSON.stringify(clima),
          JSON.stringify(fotos),
          firmaBeneficiario,
          firmaTecnico,
          formulario.huella_beneficiario || false,
          formulario.created_at ? new Date(formulario.created_at) : null,
        ]
      );
    }

    // Registrar en actividad
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, existente ? 'actualizar_formulario' : 'guardar_formulario',
       JSON.stringify({ formulario_id: formulario.id, tipo: formulario.tipo })]
    );

    console.log(`[Forms] Formulario ${existente ? 'actualizado' : 'guardado'}: ${formulario.id} (${formulario.tipo})`);

    res.json({
      estado: 'ok',
      mensaje: 'Formulario guardado correctamente',
      id: formulario.id,
    });
  } catch (error) {
    console.error('[Forms] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar formulario' });
  }
});

// GET /api/formularios — listar todos (con filtros opcionales)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { tipo, usuario_id, desde, hasta, limit, offset } = req.query;
    let sql = `
      SELECT id, tipo, usuario_id,
        beneficiario_json, actividad_json, sociodemografico_json,
        caracterizacion_nueva_json, coordenadas_json, georeferencia_json,
        clima_json, fotos_json, firma_beneficiario, firma_tecnico,
        huella_beneficiario, pdf_url, sincronizado, created_at, updated_at
      FROM formularios WHERE 1=1`;
    const params = [];
    let paramIdx = 1;

    if (tipo) { sql += ` AND tipo = $${paramIdx++}`; params.push(tipo); }
    if (usuario_id) { sql += ` AND usuario_id = $${paramIdx++}`; params.push(usuario_id); }
    if (desde) { sql += ` AND created_at >= $${paramIdx++}`; params.push(desde); }
    if (hasta) { sql += ` AND created_at <= $${paramIdx++}`; params.push(hasta); }

    // Filtro por rol: si es técnico, solo ve sus formularios
    if (req.user.rol === 'tecnico') {
      sql += ` AND usuario_id = $${paramIdx++}`;
      params.push(req.user.id);
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) { sql += ` LIMIT $${paramIdx++}`; params.push(parseInt(limit)); }
    if (offset) { sql += ` OFFSET $${paramIdx++}`; params.push(parseInt(offset)); }

    const formularios = await db.queryAll(sql, params);

    res.json({
      estado: 'ok',
      total: formularios.length,
      formularios,
    });
  } catch (error) {
    console.error('[Forms] Listar error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar formularios' });
  }
});

// GET /api/formularios/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const form = await db.queryOne(
      `SELECT id, tipo, usuario_id,
        beneficiario_json, actividad_json, sociodemografico_json,
        caracterizacion_nueva_json, coordenadas_json, georeferencia_json,
        clima_json, fotos_json, firma_beneficiario, firma_tecnico,
        huella_beneficiario, pdf_url, sincronizado, created_at, updated_at
       FROM formularios WHERE id = $1`,
      [req.params.id]
    );
    if (!form) {
      return res.status(404).json({ estado: 'error', mensaje: 'Formulario no encontrado' });
    }
    res.json({ estado: 'ok', formulario: form });
  } catch (error) {
    console.error('[Forms] Get error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener formulario' });
  }
});

// DELETE /api/formularios/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM formularios WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    const deleted = result?.rowCount > 0;

    if (deleted) {
      await db.query(
        'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
        [req.user.id, 'eliminar_formulario', JSON.stringify({ formulario_id: req.params.id })]
      );
    }

    res.json({
      estado: deleted ? 'ok' : 'error',
      mensaje: deleted ? 'Formulario eliminado' : 'Formulario no encontrado',
    });
  } catch (error) {
    console.error('[Forms] Delete error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar formulario' });
  }
});

module.exports = router;
