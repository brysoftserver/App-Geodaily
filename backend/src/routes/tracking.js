// ============================================================
// Tracking Routes — Sync de posiciones GPS de técnicos
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { createPersistentStore } = require('../persistence');
const router = express.Router();

// Almacenamiento persistente en JSON
const store = createPersistentStore('tracking');

// Cache de usuarios para enriquecer respuestas con nombre real
let usuariosCache = null;
function getUsuarios() {
  if (usuariosCache) return usuariosCache;
  try {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'usuarios.json'), 'utf8');
    usuariosCache = JSON.parse(raw);
    return usuariosCache;
  } catch {
    return [];
  }
}

/**
 * Enriquecer posiciones con nombre real del técnico
 */
function enriquecerConNombre(posiciones) {
  const usuarios = getUsuarios();
  const map = new Map(usuarios.map(u => [u.id, u.nombre || u.usuario]));
  return posiciones.map(pos => ({
    ...pos,
    usuario_nombre: map.get(pos.usuario_id) || pos.usuario_id,
  }));
}

// POST /api/tracking/sync — Recibir posiciones del técnico
router.post('/sync', authenticateToken, (req, res) => {
  try {
    const { posiciones } = req.body;
    if (!Array.isArray(posiciones)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de posiciones' });
    }

    const enriched = posiciones.map(p => ({
      ...p,
      sincronizado: true,
      server_timestamp: new Date().toISOString(),
    }));

    store.setMany(enriched);

    console.log(`[Tracking] ${enriched.length} posiciones sincronizadas (${store.getAll().length} totales)`);
    res.json({
      estado: 'ok',
      mensaje: `${enriched.length} posiciones sincronizadas`,
      sincronizadas: enriched.length,
    });
  } catch (error) {
    console.error('[Tracking] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar posiciones' });
  }
});

// GET /api/tracking/ultimas — Última posición de cada técnico
router.get('/ultimas', authenticateToken, (req, res) => {
  try {
    const todas = store.getAll();

    // Agrupar por usuario_id y tomar la más reciente
    const ultimasMap = new Map();
    for (const pos of todas) {
      const existente = ultimasMap.get(pos.usuario_id);
      if (!existente || new Date(pos.timestamp) > new Date(existente.timestamp)) {
        ultimasMap.set(pos.usuario_id, pos);
      }
    }

    const ultimas = Array.from(ultimasMap.values());
    res.json({
      estado: 'ok',
      total: ultimas.length,
      posiciones: enriquecerConNombre(ultimas),
    });
  } catch (error) {
    console.error('[Tracking] Error al obtener últimas:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener posiciones' });
  }
});

// GET /api/tracking/historial/:usuarioId — Historial de un técnico
router.get('/historial/:usuarioId', authenticateToken, (req, res) => {
  try {
    const { usuarioId } = req.params;
    const todas = store.getAll();
    const historial = todas
      .filter(p => p.usuario_id === usuarioId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    res.json({
      estado: 'ok',
      total: historial.length,
      posiciones: historial,
    });
  } catch (error) {
    console.error('[Tracking] Error al obtener historial:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener historial' });
  }
});

module.exports = router;
