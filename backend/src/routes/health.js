// ============================================================
// Health Check — incluye verificación real de la base de datos
// ============================================================

const express = require('express');
const db = require('../database');
const router = express.Router();

router.get('/', async (_req, res) => {
  let dbEstado = 'ok';
  try {
    await db.queryOne('SELECT 1 AS ok');
  } catch (err) {
    dbEstado = 'error';
    console.error('[Health] Base de datos no responde:', err.message);
  }

  res.json({
    estado: dbEstado === 'ok' ? 'ok' : 'degradado',
    servicio: 'GEODAILY API',
    version: '1.0.0',
    db: dbEstado,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;
