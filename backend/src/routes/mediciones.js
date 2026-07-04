// ============================================================
// Mediciones Routes — Sync + CRUD de mediciones de terreno
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { createPersistentStore } = require('../persistence');
const router = express.Router();

// Almacenamiento persistente en JSON
const store = createPersistentStore('mediciones');

// Cache de usuarios para enriquecer respuestas
let usuariosCache = null;
function getUsuarios() {
  if (usuariosCache) return usuariosCache;
  try {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'usuarios.json'), 'utf8');
    usuariosCache = JSON.parse(raw);
    return usuariosCache;
  } catch { return []; }
}
function enriquecerConNombre(items) {
  const usuarios = getUsuarios();
  const map = new Map(usuarios.map(u => [u.id, u.nombre || u.usuario]));
  return items.map(item => ({ ...item, usuario_nombre: map.get(item.usuario_id) || item.usuario_id }));
}

// POST /api/mediciones/sync — Recibir mediciones del técnico
router.post('/sync', authenticateToken, (req, res) => {
  try {
    const { mediciones } = req.body;
    if (!Array.isArray(mediciones)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de mediciones' });
    }

    const enriched = mediciones.map(m => ({
      ...m,
      sincronizado: true,
      server_timestamp: new Date().toISOString(),
    }));

    store.setMany(enriched);

    console.log(`[Mediciones] ${enriched.length} mediciones sincronizadas (${store.getAll().length} totales)`);
    res.json({
      estado: 'ok',
      mensaje: `${enriched.length} mediciones sincronizadas`,
      sincronizadas: enriched.length,
    });
  } catch (error) {
    console.error('[Mediciones] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar mediciones' });
  }
});

// GET /api/mediciones — Obtener todas las mediciones
router.get('/', authenticateToken, (req, res) => {
  try {
    const { rol, usuario_id } = req.user;
    let lista = store.getAll();

    // Técnicos solo ven sus propias mediciones
    if (rol === 'tecnico') {
      lista = lista.filter(m => m.usuario_id === usuario_id);
    }

    res.json({
      estado: 'ok',
      total: lista.length,
      mediciones: enriquecerConNombre(lista),
    });
  } catch (error) {
    console.error('[Mediciones] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener mediciones' });
  }
});

// DELETE /api/mediciones/:id — Solo admin puede eliminar
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo administradores pueden eliminar mediciones' });
    }

    const { id } = req.params;
    if (!store.get(id)) {
      return res.status(404).json({ estado: 'error', mensaje: 'Medición no encontrada' });
    }

    store.delete(id);
    console.log(`[Mediciones] Eliminada: ${id} por admin ${req.user.usuario_id}`);
    res.json({ estado: 'ok', mensaje: 'Medición eliminada correctamente' });
  } catch (error) {
    console.error('[Mediciones] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar medición' });
  }
});

module.exports = router;
