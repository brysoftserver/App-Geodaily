// ============================================================
// Health Check
// ============================================================

const express = require('express');
const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    estado: 'ok',
    servicio: 'GEODAILY API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;
