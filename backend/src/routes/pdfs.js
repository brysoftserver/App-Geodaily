// ============================================================
// PDF Routes — Generación de PDFs (mock)
// ============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const pdfDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || './uploads', 'pdfs');
if (!fs.existsSync(pdfDir)) {
  fs.mkdirSync(pdfDir, { recursive: true });
}

// POST /api/pdfs/generar
router.post('/generar', authenticateToken, (req, res) => {
  try {
    const formulario = req.body;

    if (!formulario || !formulario.id) {
      return res.status(400).json({
        estado: 'error',
        mensaje: 'Datos del formulario requeridos',
      });
    }

    // Generar un PDF mock (HTML simulado)
    const beneficiario = formulario.beneficiario || { nombre: 'N/A', cedula: 'N/A' };
    const tecnico = formulario.tecnico || { nombre: req.user.nombre || 'N/A' };
    const filename = `formulario_${formulario.id}_${Date.now()}.html`;
    const filepath = path.join(pdfDir, filename);

    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Formulario ${formulario.id}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
  h1 { color: #1B5E20; border-bottom: 2px solid #1B5E20; padding-bottom: 8px; }
  .section { margin: 20px 0; padding: 16px; background: #f9f9f9; border-radius: 8px; }
  .section h2 { color: #388E3C; margin-top: 0; }
  .label { font-weight: bold; color: #555; }
  .value { margin-left: 8px; }
  .footer { margin-top: 40px; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
  <h1>🌱 GEODAILY — Formulario de Campo</h1>
  <p><strong>ID:</strong> ${formulario.id}</p>
  <p><strong>Tipo:</strong> ${formulario.tipo || 'N/A'}</p>
  <p><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-CO')}</p>

  <div class="section">
    <h2>Datos del Beneficiario</h2>
    <p><span class="label">Nombre:</span><span class="value">${beneficiario.nombre}</span></p>
    <p><span class="label">Cédula:</span><span class="value">${beneficiario.cedula}</span></p>
  </div>

  <div class="section">
    <h2>Datos del Técnico</h2>
    <p><span class="label">Nombre:</span><span class="value">${tecnico.nombre}</span></p>
  </div>

  <div class="section">
    <h2>Actividad Realizada</h2>
    <p><span class="label">Descripción:</span><span class="value">${formulario.actividad?.descripcion || 'N/A'}</span></p>
    <p><span class="label">Observaciones:</span><span class="value">${formulario.actividad?.observaciones || 'N/A'}</span></p>
    <p><span class="label">Recomendaciones:</span><span class="value">${formulario.actividad?.recomendaciones || 'N/A'}</span></p>
  </div>

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
  </div>
</body></html>`;

    fs.writeFileSync(filepath, html, 'utf8');

    console.log(`[PDF] PDF generado: ${filename}`);

    res.json({
      estado: 'ok',
      pdf_url: `/uploads/pdfs/${filename}`,
      filename,
      mensaje: 'PDF generado correctamente',
    });
  } catch (error) {
    console.error('[PDF] Error:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al generar PDF' });
  }
});

// GET /api/pdfs/:filename
router.get('/:filename', authenticateToken, (req, res) => {
  const filepath = path.join(pdfDir, req.params.filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ estado: 'error', mensaje: 'PDF no encontrado' });
  }
  res.sendFile(filepath);
});

module.exports = router;
