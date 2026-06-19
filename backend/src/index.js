// ============================================================
// GEODAILY — Backend API Server
// Puerto 8089 · Express + JWT
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// --- Load .env manualmente (sin dotenv) ---
const envPath = path.join(__dirname, '..', '.env');
try {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch { /* .env opcional */ }

const app = express();
const PORT = parseInt(process.env.PORT || '8089', 10);

// --- Middleware global ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', process.env.UPLOAD_DIR || './uploads')));

// --- Rutas ---
app.use('/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/georeference', require('./routes/georeference'));
app.use('/api/climate', require('./routes/climate'));
app.use('/api/formularios', require('./routes/forms'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/pdfs', require('./routes/pdfs'));

// --- 404 handler ---
app.use((_req, res) => {
  res.status(404).json({ estado: 'error', mensaje: 'Endpoint no encontrado' });
});

// --- Error handler ---
app.use((err, _req, res, _next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({ estado: 'error', mensaje: err.message || 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  🌱 GEODAILY API — Puerto ${PORT}`);
  console.log(`  Health:  http://192.168.1.20:${PORT}/health`);
  console.log(`  Auth:    http://192.168.1.20:${PORT}/api/auth`);
  console.log(`  Forms:   http://192.168.1.20:${PORT}/api/formularios`);
  console.log(`  Photos:  http://192.168.1.20:${PORT}/api/photos`);
  console.log(`  PDFs:    http://192.168.1.20:${PORT}/api/pdfs`);
  console.log(`========================================\n`);
});
