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

// ============================================================
// INICIALIZAR BASE DE DATOS
// ============================================================
const db = require('./database');
const storage = require('./storage');
db.initSchema()
  .then(async () => {
    console.log('[Server] ✅ Base de datos inicializada');

    // Crear carpetas en MinIO para todos los usuarios existentes
    try {
      const usuarios = await db.queryAll('SELECT id, usuario, rol FROM usuarios WHERE activo = TRUE');
      for (const u of usuarios) {
        await storage.createUserFolders(u.rol, u.usuario);
      }
      console.log(`[Storage] ✅ Carpetas verificadas para ${usuarios.length} usuarios en MinIO`);
    } catch (err) {
      console.warn('[Storage] ⚠️ No se pudieron verificar carpetas de usuarios:', err.message);
    }
  })
  .catch(err => console.error('[Server] ❌ Error inicializando DB:', err.message));

// --- Middleware global ---
const PROD_DOMAIN = process.env.PROD_DOMAIN || 'https://geodaily-api.brysoftsas.com';
const corsOptions = {
  origin: [
    'http://192.168.1.20:8082',
    'http://localhost:8082',
    'http://localhost:8081',
    PROD_DOMAIN,
    PROD_DOMAIN.replace('api.', 'app.'),
    /\.brysoftsas\.com$/,
    /\.cloudflare\.dev$/,
  ],
  credentials: true,
};
app.use(cors(corsOptions));
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
app.use('/api/plantaciones', require('./routes/plantaciones'));
app.use('/api/visitas-programadas', require('./routes/visitas-programadas'));
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/mediciones', require('./routes/mediciones'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/maps', require('./routes/maps'));
app.use('/api/firmas', require('./routes/firmas'));
app.use('/api/documentos', require('./routes/documentos'));
app.use('/api/beneficiarios', require('./routes/beneficiarios'));
app.use('/api/revisiones', require('./routes/revisiones'));
app.use('/api/archivos', require('./routes/archivos'));

// --- 404 handler ---
app.use((_req, res) => {
  res.status(404).json({ estado: 'error', mensaje: 'Endpoint no encontrado' });
});

// --- Error handler ---
app.use((err, _req, res, _next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({ estado: 'error', mensaje: err.message || 'Error interno del servidor' });
});

const HOST = process.env.HOST || `http://192.168.1.20:${PORT}`;
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  🌱 GEODAILY API — Puerto ${PORT}`);
  console.log(`  ${HOST}/health`);
  console.log(`  ${HOST}/api/auth`);
  console.log(`  ${HOST}/api/formularios`);
  console.log(`  ${HOST}/api/photos`);
  console.log(`  ${HOST}/api/pdfs`);
  console.log(`  ${HOST}/api/plantaciones`);
  console.log(`  ${HOST}/api/tracking`);
  console.log(`  ${HOST}/api/mediciones`);
  console.log(`  ${HOST}/api/videos`);
  console.log(`  ${HOST}/api/maps`);
  console.log(`  ${HOST}/api/firmas`);
  console.log(`  ${HOST}/api/documentos`);
  console.log(`  DB:      PostgreSQL ${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DB}`);
  console.log(`  MinIO:   ${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT} (bucket: ${process.env.MINIO_BUCKET || 'geodaily-archivos'})`);
  console.log(`========================================\n`);
});
