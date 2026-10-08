// ============================================================
// Seguimientos de Coordinación / Interventoría
// ============================================================
// Registro de acompañamiento en campo de coordinador o interventor,
// independiente del formulario del técnico: a diferencia de las
// revisiones (revisiones.js), aquí NO se requiere que exista un
// formulario ya guardado ni sincronizado — el rol superior puede
// registrar su propia visita/actividad aunque el técnico todavía esté
// llenando su formulario en el mismo momento.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

const ROLES_SEGUIMIENTO = ['coordinador', 'interventor'];
// Gerencia y admin pueden consultar el listado completo (ambos roles), pero no crear seguimientos.
const ROLES_CONSULTA = ['coordinador', 'interventor', 'gerente', 'admin'];

// GET /api/seguimientos — Listado. Coordinador/interventor ven solo los
// de su propio rol (son dos tarjetas/listados independientes en la app);
// gerente/admin ven todos.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { rol, id: usuarioId } = req.user;
    if (!ROLES_CONSULTA.includes(rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado para consultar seguimientos' });
    }

    const soloPropios = ROLES_SEGUIMIENTO.includes(rol);
    const seguimientos = await db.queryAll(
      soloPropios
        ? `SELECT * FROM seguimientos WHERE autor_rol = $1 ORDER BY created_at DESC`
        : `SELECT * FROM seguimientos ORDER BY created_at DESC`,
      soloPropios ? [rol] : []
    );
    res.json({ estado: 'ok', seguimientos });
  } catch (error) {
    console.error('[Seguimientos] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar seguimientos' });
  }
});

// GET /api/seguimientos/:id — Detalle
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    if (!ROLES_CONSULTA.includes(req.user.rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }
    const seguimiento = await db.queryOne('SELECT * FROM seguimientos WHERE id = $1', [req.params.id]);
    if (!seguimiento) {
      return res.status(404).json({ estado: 'error', mensaje: 'Seguimiento no encontrado' });
    }
    res.json({ estado: 'ok', seguimiento });
  } catch (error) {
    console.error('[Seguimientos] Error consultando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al consultar el seguimiento' });
  }
});

// POST /api/seguimientos — Crear
// body: { id, actividad, objetivo_visita?, descripcion_actividad?, observaciones?,
//         fotos?, videos?, firma_beneficiario?, firma_autor?,
//         geo_latitud?, geo_longitud?, geo_altitud?, geo_precision?,
//         beneficiario_cedula?, beneficiario_nombre?, formulario_id?, created_at? }
// firma_beneficiario/firma_autor son el archivo_id ya subido a MinIO (vía /api/firmas).
// formulario_id vincula el seguimiento a la visita del técnico desde cuyo
// detalle se registró (llega vacío cuando se hace desde la tarjeta general).
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { rol, id: autorId, nombre: autorNombre } = req.user;
    if (!ROLES_SEGUIMIENTO.includes(rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo coordinación e interventoría pueden registrar seguimientos' });
    }

    const {
      id,
      actividad,
      objetivo_visita,
      descripcion_actividad,
      observaciones,
      fotos,
      videos,
      firma_beneficiario,
      firma_autor,
      geo_latitud,
      geo_longitud,
      geo_altitud,
      geo_precision,
      huella_beneficiario,
      beneficiario_cedula,
      beneficiario_nombre,
      formulario_id,
      created_at,
    } = req.body;

    if (!actividad?.trim()) {
      return res.status(400).json({ estado: 'error', mensaje: 'La actividad es obligatoria' });
    }
    const seguimientoId = id || `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // created_at opcional: si el cliente corrigió la fecha del seguimiento
    // (o la creó offline) se respeta; si viene vacía/ inválida se deja que la
    // columna use su DEFAULT NOW() (insert) o conserve la existente (upsert).
    const createdAtParam =
      created_at && !Number.isNaN(new Date(created_at).getTime()) ? new Date(created_at).toISOString() : null;

    // ON CONFLICT: si el cliente reintenta este mismo id (p. ej. la
    // respuesta se perdió por un timeout pero el servidor ya lo había
    // guardado), se actualiza en vez de fallar por clave duplicada — evita
    // que el ciclo de sync del dispositivo lo reintente para siempre.
    const fila = await db.queryOne(
      `INSERT INTO seguimientos
         (id, autor_id, autor_nombre, autor_rol, beneficiario_cedula, beneficiario_nombre,
          actividad, objetivo_visita, descripcion_actividad, observaciones, fotos_json,
          videos_json, firma_beneficiario, firma_autor, geo_latitud, geo_longitud, geo_altitud, geo_precision,
          huella_beneficiario, formulario_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, COALESCE($21, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         beneficiario_cedula = EXCLUDED.beneficiario_cedula,
         beneficiario_nombre = EXCLUDED.beneficiario_nombre,
         formulario_id = EXCLUDED.formulario_id,
         actividad = EXCLUDED.actividad,
         objetivo_visita = EXCLUDED.objetivo_visita,
         descripcion_actividad = EXCLUDED.descripcion_actividad,
         observaciones = EXCLUDED.observaciones,
         -- EVIDENCIA: nunca se pierde. Un dispositivo que reintenta el POST, o
         -- que nunca descargó las fotos de otro teléfono, puede enviar
         -- fotos: [] / videos: [] / firma vacía. Antes eso borraba en el
         -- servidor lo que otro dispositivo ya había subido (incidente real:
         -- el seguimiento "plántulas de maderables" perdió 10 fotos y 2
         -- firmas). Ahora se hace UNIÓN por archivo_id: lo que ya existe se
         -- conserva y solo se agregan los elementos nuevos.
         -- El borrado intencional sigue funcionando porque el detalle del
         -- seguimiento usa PATCH (parcial), que sí reemplaza el arreglo.
         fotos_json = COALESCE((
           SELECT jsonb_agg(elem ORDER BY ord) FROM (
             SELECT DISTINCT ON (k) elem, ord FROM (
               SELECT elem, ord, COALESCE(elem->>'archivo_id', elem->>'id', elem::text) AS k
               FROM jsonb_array_elements(COALESCE(EXCLUDED.fotos_json, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
               UNION ALL
               SELECT elem, ord + 1000000, COALESCE(elem->>'archivo_id', elem->>'id', elem::text) AS k
               FROM jsonb_array_elements(COALESCE(seguimientos.fotos_json, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
             ) u ORDER BY k, ord
           ) w), '[]'::jsonb),
         videos_json = COALESCE((
           SELECT jsonb_agg(elem ORDER BY ord) FROM (
             SELECT DISTINCT ON (k) elem, ord FROM (
               SELECT elem, ord, COALESCE(elem->>'archivo_id', elem->>'id', elem::text) AS k
               FROM jsonb_array_elements(COALESCE(EXCLUDED.videos_json, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
               UNION ALL
               SELECT elem, ord + 1000000, COALESCE(elem->>'archivo_id', elem->>'id', elem::text) AS k
               FROM jsonb_array_elements(COALESCE(seguimientos.videos_json, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
             ) u ORDER BY k, ord
           ) w), '[]'::jsonb),
         firma_beneficiario = COALESCE(EXCLUDED.firma_beneficiario, seguimientos.firma_beneficiario),
         firma_autor = COALESCE(EXCLUDED.firma_autor, seguimientos.firma_autor),
         geo_latitud = EXCLUDED.geo_latitud,
         geo_longitud = EXCLUDED.geo_longitud,
         geo_altitud = EXCLUDED.geo_altitud,
         geo_precision = EXCLUDED.geo_precision,
         huella_beneficiario = EXCLUDED.huella_beneficiario,
         created_at = COALESCE($21, seguimientos.created_at),
         updated_at = NOW()
       RETURNING *`,
      [
        seguimientoId,
        autorId,
        autorNombre || req.user.usuario || autorId,
        rol,
        beneficiario_cedula?.trim() || null,
        beneficiario_nombre?.trim() || null,
        actividad.trim(),
        objetivo_visita?.trim() || null,
        descripcion_actividad?.trim() || null,
        observaciones?.trim() || null,
        JSON.stringify(Array.isArray(fotos) ? fotos : []),
        JSON.stringify(Array.isArray(videos) ? videos : []),
        firma_beneficiario || null,
        firma_autor || null,
        geo_latitud ?? null,
        geo_longitud ?? null,
        geo_altitud ?? null,
        geo_precision ?? null,
        !!huella_beneficiario,
        formulario_id?.trim() || null,
        createdAtParam,
      ]
    );

    console.log(`[Seguimientos] Nuevo seguimiento de ${rol} (${req.user.usuario}): ${seguimientoId}`);
    res.status(201).json({ estado: 'ok', mensaje: 'Seguimiento registrado', seguimiento: fila });
  } catch (error) {
    console.error('[Seguimientos] Error creando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al registrar el seguimiento' });
  }
});

// DELETE /api/seguimientos/:id — Puede eliminar el autor del seguimiento o
// cualquier rol con permiso de borrado (admin, coordinador, interventor),
// igual que la regla de forms.js para los formularios del técnico.
const ROLES_ELIMINAR = ['admin', 'coordinador', 'interventor'];
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id: usuarioId, rol } = req.user;
    const fila = await db.queryOne('SELECT autor_id FROM seguimientos WHERE id = $1', [req.params.id]);
    if (!fila) {
      return res.status(404).json({ estado: 'error', mensaje: 'Seguimiento no encontrado' });
    }
    if (fila.autor_id !== usuarioId && !ROLES_ELIMINAR.includes(rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No tienes permiso para eliminar este seguimiento' });
    }
    await db.query('DELETE FROM seguimientos WHERE id = $1', [req.params.id]);
    console.log(`[Seguimientos] Eliminado por ${req.user.usuario}: ${req.params.id}`);
    res.json({ estado: 'ok', mensaje: 'Seguimiento eliminado' });
  } catch (error) {
    console.error('[Seguimientos] Error eliminando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar el seguimiento' });
  }
});

// PATCH /api/seguimientos/:id — Corregir/completar un seguimiento ya guardado.
//
// Mismo espíritu que PATCH /api/formularios/:id/respuesta: permite que el
// autor (coordinador/interventor) o un rol supervisor (admin/coordinador/
// interventor) corrija o complete los campos de un seguimiento terminado,
// incluida la evidencia (fotos/videos/firmas) y la georreferenciación.
//
// Solo se actualizan los campos presentes en el body (patch parcial): así el
// cliente puede mandar únicamente lo que cambió sin pisar el resto.
const CAMPOS_EDITABLES = [
  'actividad',
  'objetivo_visita',
  'descripcion_actividad',
  'observaciones',
  'fotos',
  'videos',
  'firma_beneficiario',
  'firma_autor',
  'geo_latitud',
  'geo_longitud',
  'geo_altitud',
  'geo_precision',
  'huella_beneficiario',
  'beneficiario_cedula',
  'beneficiario_nombre',
  // Fecha de la visita — el autor puede corregirla desde el detalle si la
  // registró con un día equivocado. Se guarda como timestamptz.
  'created_at',
];

// Mapa campo del body → columna de la tabla.
const COLUMNA_POR_CAMPO = {
  actividad: 'actividad',
  objetivo_visita: 'objetivo_visita',
  descripcion_actividad: 'descripcion_actividad',
  observaciones: 'observaciones',
  fotos: 'fotos_json',
  videos: 'videos_json',
  firma_beneficiario: 'firma_beneficiario',
  firma_autor: 'firma_autor',
  geo_latitud: 'geo_latitud',
  geo_longitud: 'geo_longitud',
  geo_altitud: 'geo_altitud',
  geo_precision: 'geo_precision',
  huella_beneficiario: 'huella_beneficiario',
  beneficiario_cedula: 'beneficiario_cedula',
  beneficiario_nombre: 'beneficiario_nombre',
  created_at: 'created_at',
};

router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id: usuarioId, rol } = req.user;
    const fila = await db.queryOne('SELECT autor_id FROM seguimientos WHERE id = $1', [req.params.id]);
    if (!fila) {
      return res.status(404).json({ estado: 'error', mensaje: 'Seguimiento no encontrado' });
    }
    // Puede editar el autor del seguimiento o cualquier rol supervisor
    // (admin/coordinador/interventor), igual que la regla de borrado.
    if (fila.autor_id !== usuarioId && !ROLES_ELIMINAR.includes(rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'No tienes permiso para editar este seguimiento' });
    }

    const body = req.body || {};
    const sets = [];
    const valores = [];
    let indice = 1;

    for (const campo of CAMPOS_EDITABLES) {
      if (!(campo in body)) continue;
      const columna = COLUMNA_POR_CAMPO[campo];
      let valor = body[campo];

      if (campo === 'actividad') {
        if (typeof valor !== 'string' || !valor.trim()) {
          return res.status(400).json({ estado: 'error', mensaje: 'La actividad no puede quedar vacía' });
        }
        valor = valor.trim();
      } else if (campo === 'fotos' || campo === 'videos') {
        valor = JSON.stringify(Array.isArray(valor) ? valor : []);
      } else if (campo === 'huella_beneficiario') {
        valor = !!valor;
      } else if (campo === 'geo_latitud' || campo === 'geo_longitud' || campo === 'geo_altitud' || campo === 'geo_precision') {
        valor = valor === null || valor === '' || valor === undefined ? null : Number(valor);
      } else if (campo === 'created_at') {
        const fecha = new Date(valor);
        if (!valor || Number.isNaN(fecha.getTime())) {
          return res.status(400).json({ estado: 'error', mensaje: 'La fecha no es válida' });
        }
        valor = fecha.toISOString();
      } else if (typeof valor === 'string') {
        valor = valor.trim() || null;
      }

      sets.push(`${columna} = $${indice}`);
      valores.push(valor);
      indice++;
    }

    if (sets.length === 0) {
      return res.status(400).json({ estado: 'error', mensaje: 'No se envió ningún campo para actualizar' });
    }

    // updated_at = NOW() a propósito: al ser más nuevo que la copia local, el
    // próximo merge del dispositivo trae el seguimiento corregido.
    valores.push(req.params.id);
    const actualizado = await db.queryOne(
      `UPDATE seguimientos SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${indice} RETURNING *`,
      valores
    );

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [
        usuarioId,
        'editar_seguimiento',
        JSON.stringify({ seguimiento_id: req.params.id, campos: Object.keys(body).filter((c) => CAMPOS_EDITABLES.includes(c)) }),
      ]
    );

    console.log(`[Seguimientos] Editado por ${req.user.usuario}: ${req.params.id}`);
    res.json({ estado: 'ok', mensaje: 'Seguimiento actualizado', seguimiento: actualizado });
  } catch (error) {
    console.error('[Seguimientos] Error editando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar el seguimiento' });
  }
});

// PATCH /api/seguimientos/:id/pdf — Guardar la url del PDF generado (mismo patrón que formularios.pdf_url)
router.patch('/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const { pdf_url } = req.body;
    await db.query('UPDATE seguimientos SET pdf_url = $1, updated_at = NOW() WHERE id = $2', [pdf_url || null, req.params.id]);
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[Seguimientos] Error actualizando pdf_url:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al actualizar el PDF del seguimiento' });
  }
});

module.exports = router;
