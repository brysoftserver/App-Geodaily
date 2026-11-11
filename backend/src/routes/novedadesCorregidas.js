// ============================================================
// "Ya corregí": el técnico avisa que atendió las novedades
// ============================================================
// Las novedades pasan a "corregida — por verificar" cuando hay una
// corrección explícita posterior (lib/correcciones.js). Pero hay arreglos que
// no quedan registrados como respuesta (ajustar el polígono en el mapa,
// agregar fotos...): con este endpoint el técnico lo declara él mismo, con un
// comentario opcional. Sirve igual para novedades de coordinación o de
// interventoría. El cierre formal sigue siendo el visto bueno del revisor.
//   POST /api/novedades-corregidas/:formularioId   { comentario? }
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const { crearNotificacion } = require('./notificaciones');
const { notificarCorreccion, revisoresConNovedadesPendientes } = require('../lib/correcciones');
const { normalizarCedula, sqlCedulaNormalizada } = require('../lib/visitas');

const router = express.Router();

router.post('/:formularioId', authenticateToken, async (req, res) => {
  try {
    const rol = req.user?.rol;
    if (rol !== 'tecnico' && rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo el técnico de la visita puede marcar las novedades como corregidas' });
    }
    const formularioId = String(req.params.formularioId);
    const form = await db.queryOne(
      `SELECT id, usuario_id, tecnico_json->>'usuario_id' AS tecnico_snapshot, beneficiario_json->>'cedula' AS cedula
         FROM formularios WHERE id = $1`,
      [formularioId]
    );
    if (!form) return res.status(404).json({ estado: 'error', mensaje: 'Formulario no encontrado' });

    // Técnico: dueño de la visita, o técnico asignado HOY al beneficiario
    // (visitas heredadas: el mismo criterio que permite corregir respuestas).
    if (rol === 'tecnico') {
      const dueno = form.tecnico_snapshot || form.usuario_id;
      let autorizado = dueno === req.user.id;
      if (!autorizado && form.cedula) {
        const asignados = await db.queryAll(
          `SELECT tecnico_asignado_id FROM beneficiarios WHERE ${sqlCedulaNormalizada('cedula')} = $1`,
          [normalizarCedula(form.cedula)]
        );
        autorizado = asignados.length === 1 && asignados[0].tecnico_asignado_id === req.user.id;
      }
      if (!autorizado) {
        return res.status(403).json({ estado: 'error', mensaje: 'Esta visita no es tuya' });
      }
    }

    // Solo tiene sentido si hay novedades abiertas.
    const pendientes = await revisoresConNovedadesPendientes(db, formularioId);
    if (pendientes.length === 0) {
      return res.status(409).json({ estado: 'error', mensaje: 'Este formulario no tiene novedades pendientes' });
    }

    const comentario = String(req.body?.comentario || '').trim().slice(0, 1000);
    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3::jsonb)',
      [req.user.id, 'marcar_novedad_corregida', JSON.stringify({ formulario_id: formularioId, comentario: comentario || null })]
    );
    // Mismo aviso que el resto de correcciones (con su anti-spam).
    const avisados = await notificarCorreccion(db, crearNotificacion, { formularioId, autor: req.user });
    console.log(`[NovedadesCorregidas] ${req.user.usuario} marcó corregidas las novedades de ${formularioId} (avisados: ${avisados})`);
    res.json({ estado: 'ok', avisados });
  } catch (error) {
    console.error('[NovedadesCorregidas] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'No se pudo registrar la corrección' });
  }
});

module.exports = router;
