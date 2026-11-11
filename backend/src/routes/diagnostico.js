// ============================================================
// Diagnóstico de cliente — errores que reporta la app desde el teléfono
// ============================================================
// Cuando algo falla en el aparato (p. ej. el guardado local de un acta),
// el error real quedaba solo en la consola del teléfono y no había forma de
// saber la causa. La app lo manda aquí (sin bloquear al técnico) y queda en
// el log del backend y en la tabla diagnosticos_cliente.
//
// Consultar:  SELECT * FROM diagnosticos_cliente ORDER BY created_at DESC LIMIT 50;
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

const corto = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));

// POST /api/diagnostico/cliente — { contexto, mensaje, detalle, app_version, plataforma }
router.post('/cliente', authenticateToken, async (req, res) => {
  try {
    const contexto = corto(req.body?.contexto, 120);
    if (!contexto) return res.status(400).json({ estado: 'error', mensaje: 'Falta el contexto' });
    const mensaje = corto(req.body?.mensaje, 4000);
    let detalle = req.body?.detalle;
    if (!detalle || typeof detalle !== 'object') detalle = {};
    let json = JSON.stringify(detalle);
    if (json.length > 20000) json = JSON.stringify({ recortado: true, inicio: json.slice(0, 20000) });

    console.warn(`[DiagnosticoCliente] ${req.user?.usuario || 'anónimo'} · ${contexto} · ${mensaje || ''}`);
    await db.query(
      `INSERT INTO diagnosticos_cliente (usuario_id, usuario, contexto, mensaje, detalle, app_version, plataforma)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        corto(req.user?.id, 20),
        corto(req.user?.usuario, 100),
        contexto,
        mensaje,
        json,
        corto(req.body?.app_version, 60),
        corto(req.body?.plataforma, 30),
      ]
    );
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[DiagnosticoCliente] Error guardando diagnóstico:', error.message);
    res.status(500).json({ estado: 'error', mensaje: 'No se pudo guardar el diagnóstico' });
  }
});

module.exports = router;
