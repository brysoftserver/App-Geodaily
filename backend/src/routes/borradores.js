// ============================================================
// Draft Routes — Formularios incompletos sincronizados por usuario
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { normalizarCedula, numeroVisitaFormulario, sqlFormularioEsVisita } = require('../lib/visitas');
const { fijarObjetivoVisita2 } = require('../lib/objetivoVisita2');

const router = express.Router();
const MAX_DRAFT_BYTES = 15 * 1024 * 1024;

router.use(authenticateToken);

// GET /api/borradores — solo borradores del usuario autenticado
router.get('/', async (req, res) => {
  try {
    const borradores = await db.queryAll(
      `SELECT b.payload_json, b.updated_at
         FROM formularios_borradores b
        WHERE b.usuario_id = $1
          AND NOT EXISTS (SELECT 1 FROM formularios f WHERE f.id = b.id)
        ORDER BY b.updated_at DESC`,
      [req.user.id]
    );

    res.json({
      estado: 'ok',
      borradores: borradores.map((row) => ({
        ...row.payload_json,
        updated_at: row.updated_at,
      })),
    });
  } catch (error) {
    console.error('[Borradores] Error listando:', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener borradores' });
  }
});

// PUT /api/borradores/:id — upsert protegido por usuario y versión
router.put('/:id', async (req, res) => {
  try {
    const borrador = req.body;
    if (!borrador || typeof borrador !== 'object' || Array.isArray(borrador) || borrador.id !== req.params.id) {
      return res.status(400).json({ estado: 'error', mensaje: 'El id del borrador no coincide' });
    }

    const bytes = Buffer.byteLength(JSON.stringify(borrador), 'utf8');
    if (bytes > MAX_DRAFT_BYTES) {
      return res.status(413).json({ estado: 'error', mensaje: 'El borrador supera el tamaño permitido' });
    }

    const id = String(borrador.id);
    const existenteFormulario = await db.queryOne('SELECT id FROM formularios WHERE id = $1', [id]);
    if (existenteFormulario) {
      await db.query('DELETE FROM formularios_borradores WHERE id = $1 AND usuario_id = $2', [id, req.user.id]);
      return res.status(409).json({ estado: 'completado', mensaje: 'El formulario ya fue completado' });
    }

    const fechaCliente = Date.parse(borrador.updated_at || '');
    const updatedAt = Number.isFinite(fechaCliente) ? new Date(fechaCliente).toISOString() : new Date().toISOString();
    // Visita 2: objetivo fijo (borradores de apps sin actualizar).
    fijarObjetivoVisita2(borrador.actividad);
    const payload = {
      ...borrador,
      tecnico: { ...(borrador.tecnico || {}), usuario_id: req.user.id },
      updated_at: updatedAt,
    };

    const upsert = await db.query(
      `INSERT INTO formularios_borradores (id, usuario_id, payload_json, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         payload_json = EXCLUDED.payload_json,
         updated_at = EXCLUDED.updated_at
       WHERE formularios_borradores.usuario_id = EXCLUDED.usuario_id
         AND formularios_borradores.updated_at <= EXCLUDED.updated_at
       RETURNING id, updated_at`,
      [id, req.user.id, JSON.stringify(payload), updatedAt]
    );

    if (upsert.rowCount === 0) {
      const actual = await db.queryOne('SELECT usuario_id FROM formularios_borradores WHERE id = $1', [id]);
      if (actual && actual.usuario_id !== req.user.id) {
        return res.status(403).json({ estado: 'error', mensaje: 'No autorizado para modificar este borrador' });
      }
      return res.status(409).json({ estado: 'desactualizado', mensaje: 'Existe una versión más reciente del borrador' });
    }

    res.json({ estado: 'ok', id, updated_at: upsert.rows[0].updated_at });
  } catch (error) {
    console.error('[Borradores] Error guardando:', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar borrador' });
  }
});

// DELETE /api/borradores/:id — solo el propietario
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM formularios_borradores WHERE id = $1 AND usuario_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[Borradores] Error eliminando:', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar borrador' });
  }
});

// ============================================================
// Administración — "Listado de formularios incompletos"
// ============================================================
// El admin ve los borradores de TODOS los técnicos (agrupados por técnico) y
// puede forzar uno como completo para luego agregarle a mano lo que falte.
// "Forzar completo" convierte el borrador en formulario con la misma lógica
// de POST /api/formularios/guardar (atribución al técnico vigente, firmas,
// vínculo de evidencias, visita planificada) y borra el borrador. A partir de
// ese momento el teléfono del técnico recibe 409 «completado» al resincronizar
// y elimina su copia local, así que no puede pisar lo que agregue el admin.
// ============================================================

const soloAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ estado: 'error', mensaje: 'Solo el administrador puede ver los formularios incompletos' });
  }
  next();
};

/** Borradores vigentes (sin formulario completado con el mismo id). */
const SQL_BORRADORES_VIGENTES = `
  FROM formularios_borradores b
  WHERE NOT EXISTS (SELECT 1 FROM formularios f WHERE f.id = b.id)`;

const contarPoligonos = (actividad) => {
  const historial = actividad?.mediciones_historial;
  if (Array.isArray(historial) && historial.length > 0) return historial.length;
  return actividad?.medicion_historial ? 1 : 0;
};

/** Versión liviana del borrador para la lista (sin firmas base64 ni puntos). */
const resumirBorrador = (row) => {
  const p = row.payload_json || {};
  const act = p.actividad || {};
  const esCarac = p.tipo === 'caracterizacion';
  return {
    id: row.id,
    tipo: p.tipo || 'visita_tecnica',
    visita_numero: esCarac ? 1 : act.visita_numero ?? null,
    formato_visita: act.formato_visita || null,
    beneficiario: {
      nombre: p.beneficiario?.nombre || '',
      cedula: p.beneficiario?.cedula || '',
      vereda: p.beneficiario?.vereda || '',
      municipio: p.beneficiario?.municipio || '',
    },
    actividad: esCarac
      ? null
      : {
          objetivo: act.objetivo || '',
          descripcion: act.descripcion || '',
          seguimiento_compromisos: act.seguimiento_compromisos || '',
          observaciones: act.observaciones || '',
          recomendaciones: act.recomendaciones || '',
          valoracion_cumplimiento: act.valoracion_cumplimiento ?? null,
          compromisos: Array.isArray(act.compromisos_siguiente_visita) ? act.compromisos_siguiente_visita : [],
          area_intervencion: act.area_intervencion || null,
        },
    poligonos: contarPoligonos(act),
    fotos: Array.isArray(p.fotos) ? p.fotos.length : 0,
    tiene_coordenadas: !!(p.coordenadas && p.coordenadas.latitud && p.coordenadas.longitud),
    firma_beneficiario: !!p.firma_beneficiario || !!p.huella_beneficiario,
    firma_tecnico: !!p.firma_tecnico,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
};

// GET /api/borradores/admin/tecnicos — técnicos con borradores pendientes
router.get('/admin/tecnicos', soloAdmin, async (_req, res) => {
  try {
    const filas = await db.queryAll(
      `SELECT u.id, u.nombre, u.usuario, u.rol,
              COUNT(*)::int AS total,
              MAX(b.updated_at) AS ultimo
         ${SQL_BORRADORES_VIGENTES.replace('FROM formularios_borradores b', 'FROM formularios_borradores b JOIN usuarios u ON u.id = b.usuario_id')}
        GROUP BY u.id, u.nombre, u.usuario, u.rol
        ORDER BY u.nombre`
    );
    res.json({ estado: 'ok', tecnicos: filas });
  } catch (error) {
    console.error('[Borradores] Error listando técnicos (admin):', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener los formularios incompletos' });
  }
});

// GET /api/borradores/admin/tecnico/:usuarioId — borradores de un técnico
router.get('/admin/tecnico/:usuarioId', soloAdmin, async (req, res) => {
  try {
    const filas = await db.queryAll(
      `SELECT b.id, b.payload_json, b.updated_at, b.created_at
         ${SQL_BORRADORES_VIGENTES}
          AND b.usuario_id = $1
        ORDER BY b.updated_at DESC`,
      [req.params.usuarioId]
    );
    res.json({ estado: 'ok', borradores: filas.map(resumirBorrador) });
  } catch (error) {
    console.error('[Borradores] Error listando borradores del técnico (admin):', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener los borradores del técnico' });
  }
});

/** Ejecuta el manejador de guardado de formularios y captura su respuesta. */
const ejecutarGuardado = (user, formulario) =>
  new Promise((resolve, reject) => {
    const { guardarFormularioHandler } = require('./forms');
    const resCaptura = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
        return this;
      },
    };
    Promise.resolve(guardarFormularioHandler({ user, body: formulario }, resCaptura)).catch(reject);
  });

// POST /api/borradores/admin/:id/forzar-completo
router.post('/admin/:id/forzar-completo', soloAdmin, async (req, res) => {
  try {
    const fila = await db.queryOne(
      `SELECT b.id, b.usuario_id, b.payload_json, b.created_at
         ${SQL_BORRADORES_VIGENTES}
          AND b.id = $1`,
      [req.params.id]
    );
    if (!fila) {
      return res.status(404).json({ estado: 'error', mensaje: 'El borrador ya no existe o ya fue completado' });
    }

    const p = fila.payload_json || {};
    const tipo = p.tipo || 'visita_tecnica';
    const beneficiario = p.beneficiario || {};
    if (!beneficiario.nombre || !beneficiario.cedula) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'El borrador no tiene beneficiario (nombre y cédula). No se puede completar sin saber a quién pertenece.',
      });
    }

    // Una sola visita N por beneficiario (igual que en la app).
    const cedula = normalizarCedula(beneficiario.cedula);
    const numero = numeroVisitaFormulario(tipo, p.actividad?.visita_numero);
    if (cedula && numero) {
      const repetido = await db.queryOne(
        `SELECT id, tecnico_json->>'nombre' AS tecnico
           FROM formularios
          WHERE ${sqlFormularioEsVisita('$1', '$2', '$3')}
          LIMIT 1`,
        [cedula, numero, String(numero)]
      );
      if (repetido) {
        return res.status(409).json({
          estado: 'duplicado',
          mensaje: `${beneficiario.nombre} ya tiene la visita ${numero} completada${repetido.tecnico ? ` (técnico: ${repetido.tecnico})` : ''}. No se puede completar otra.`,
          formulario_id: repetido.id,
        });
      }
    }

    const ahora = new Date().toISOString();
    const formulario = {
      id: fila.id,
      tipo,
      tecnico: { ...(p.tecnico || {}), usuario_id: fila.usuario_id },
      beneficiario,
      actividad: {
        ...(p.actividad || {}),
        forzado_completo: { por: req.user.id, por_nombre: req.user.nombre || req.user.usuario || '', fecha: ahora },
      },
      sociodemografico: p.socioData || p.sociodemografico || undefined,
      caracterizacion_nueva: p.caracterizacion_nueva || undefined,
      coordenadas: p.coordenadas || { latitud: 0, longitud: 0 },
      georeferencia: p.georeferencia || undefined,
      clima: p.clima || undefined,
      // Las fotos con ruta del teléfono (file://) no sirven aquí; las que ya
      // subió la cola de medios se vinculan por metadata_json.formulario_id.
      fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter((f) => f && !String(f.uri || '').startsWith('file://')),
      firma_beneficiario: p.firma_beneficiario || '',
      firma_tecnico: p.firma_tecnico || '',
      huella_beneficiario: !!p.huella_beneficiario,
      created_at: fila.created_at ? new Date(fila.created_at).toISOString() : ahora,
      updated_at: ahora,
    };

    const resultado = await ejecutarGuardado(req.user, formulario);
    if (resultado.status !== 200 || resultado.body?.estado !== 'ok') {
      return res.status(resultado.status === 200 ? 500 : resultado.status).json(resultado.body);
    }

    await db.query('DELETE FROM formularios_borradores WHERE id = $1', [fila.id]);
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [
        req.user.id,
        'forzar_borrador_completo',
        JSON.stringify({ formulario_id: fila.id, tipo, tecnico_id: fila.usuario_id, beneficiario_cedula: beneficiario.cedula }),
      ]
    );

    console.log(`[Borradores] Admin ${req.user.id} forzó como completo el borrador ${fila.id} (técnico ${fila.usuario_id})`);
    res.json({ estado: 'ok', id: fila.id, mensaje: 'El formulario quedó completo' });
  } catch (error) {
    console.error('[Borradores] Error forzando borrador completo:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al completar el borrador' });
  }
});

module.exports = router;