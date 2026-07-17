// ============================================================
// Revisiones de Formularios — Flujo de retroalimentación jerárquico
// ============================================================
// Cuando el técnico finaliza un formulario, los roles superiores lo
// revisan y registran:
//   - tipo 'novedad'      → observación/corrección pendiente
//   - tipo 'visto_bueno'  → aprobación ("Todo OK")
// Junto con el visto bueno puede ir el formulario pequeño del rol
// (datos_formulario_json: concepto, observaciones, recomendaciones).
//
// JERARQUÍA DE CONTROL: el interventor solo puede revisar (y ver, ver
// forms.js) formularios que YA tienen visto bueno del supervisor.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

const ROLES_REVISORES = ['supervisor', 'interventor', 'gerente', 'admin'];

/** ¿El formulario tiene visto bueno de un rol dado? */
async function tieneVistoBueno(formularioId, rol) {
  const row = await db.queryOne(
    `SELECT id FROM revisiones_formulario
     WHERE formulario_id = $1 AND revisor_rol = $2 AND tipo = 'visto_bueno'
     ORDER BY created_at DESC LIMIT 1`,
    [formularioId, rol]
  );
  return !!row;
}

// GET /api/revisiones/resumen — Estado de revisión de TODOS los formularios
// (para pintar badges en listados sin pedir formulario por formulario).
// Devuelve: { estados: { [formulario_id]: { supervisor: 'ok'|'novedades'|null, interventor: ..., novedades_total: n } } }
router.get('/resumen', authenticateToken, async (req, res) => {
  try {
    const filas = await db.queryAll(
      `SELECT formulario_id, revisor_rol, tipo, COUNT(*)::int AS total, MAX(created_at) AS ultima
       FROM revisiones_formulario
       GROUP BY formulario_id, revisor_rol, tipo`
    );

    const estados = {};
    for (const f of filas) {
      if (!estados[f.formulario_id]) {
        estados[f.formulario_id] = { supervisor: null, interventor: null, gerente: null, admin: null, novedades_total: 0 };
      }
      const e = estados[f.formulario_id];
      if (f.tipo === 'visto_bueno') {
        e[f.revisor_rol] = 'ok';
      } else if (f.tipo === 'novedad') {
        e.novedades_total += f.total;
        // Solo marcar "novedades" si ese rol no dio ya el visto bueno
        if (e[f.revisor_rol] !== 'ok') e[f.revisor_rol] = 'novedades';
      }
    }

    res.json({ estado: 'ok', estados });
  } catch (error) {
    console.error('[Revisiones] Error en resumen:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener resumen de revisiones' });
  }
});

// GET /api/revisiones/:formularioId — Historial de revisiones de un formulario
router.get('/:formularioId', authenticateToken, async (req, res) => {
  try {
    const revisiones = await db.queryAll(
      `SELECT id, formulario_id, revisor_id, revisor_nombre, revisor_rol, tipo, comentario, datos_formulario_json, created_at
       FROM revisiones_formulario
       WHERE formulario_id = $1
       ORDER BY created_at ASC`,
      [req.params.formularioId]
    );
    res.json({ estado: 'ok', revisiones });
  } catch (error) {
    console.error('[Revisiones] Error listando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar revisiones' });
  }
});

// POST /api/revisiones/:formularioId — Registrar novedad o visto bueno
// body: { tipo: 'novedad' | 'visto_bueno', comentario?, datos_formulario? }
router.post('/:formularioId', authenticateToken, async (req, res) => {
  try {
    const { rol, id: revisorId, nombre: revisorNombre } = req.user;
    if (!ROLES_REVISORES.includes(rol)) {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo los roles superiores pueden revisar formularios' });
    }

    const { tipo, comentario, datos_formulario } = req.body;
    // 'formulario_rol' = el formulario pequeño del rol (supervisor/interventor),
    // independiente del visto bueno — no afecta el estado de aprobación.
    if (!['novedad', 'visto_bueno', 'formulario_rol'].includes(tipo)) {
      return res.status(400).json({ estado: 'error', mensaje: "tipo debe ser 'novedad', 'visto_bueno' o 'formulario_rol'" });
    }
    if (tipo === 'novedad' && !comentario?.trim()) {
      return res.status(400).json({ estado: 'error', mensaje: 'La novedad requiere un comentario' });
    }
    if (tipo === 'formulario_rol' && !datos_formulario) {
      return res.status(400).json({ estado: 'error', mensaje: 'El formulario de rol requiere datos_formulario' });
    }

    const formularioId = req.params.formularioId;

    // Jerarquía: el interventor solo revisa lo que el supervisor ya aprobó
    if (rol === 'interventor') {
      const okSupervisor = await tieneVistoBueno(formularioId, 'supervisor');
      if (!okSupervisor) {
        return res.status(409).json({
          estado: 'error',
          mensaje: 'Este formulario aún no tiene el visto bueno del supervisor — no puede ser revisado por interventoría.',
        });
      }
    }

    // Evitar vistos buenos duplicados del mismo rol
    if (tipo === 'visto_bueno' && (await tieneVistoBueno(formularioId, rol))) {
      return res.status(409).json({ estado: 'error', mensaje: `Este formulario ya tiene el visto bueno de ${rol}` });
    }

    const fila = await db.queryOne(
      `INSERT INTO revisiones_formulario (formulario_id, revisor_id, revisor_nombre, revisor_rol, tipo, comentario, datos_formulario_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        formularioId,
        revisorId,
        revisorNombre || req.user.usuario || revisorId,
        rol,
        tipo,
        comentario?.trim() || null,
        datos_formulario ? JSON.stringify(datos_formulario) : null,
      ]
    );

    console.log(`[Revisiones] ${tipo} de ${rol} (${req.user.usuario}) sobre formulario ${formularioId}`);
    const mensajes = {
      visto_bueno: 'Visto bueno registrado',
      novedad: 'Novedad registrada',
      formulario_rol: 'Formulario de revisión guardado',
    };
    res.status(201).json({ estado: 'ok', mensaje: mensajes[tipo], id: fila.id });
  } catch (error) {
    console.error('[Revisiones] Error registrando:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al registrar la revisión' });
  }
});

module.exports = router;
module.exports.tieneVistoBueno = tieneVistoBueno;
