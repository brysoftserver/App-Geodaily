// ============================================================
// GEODAILY — Almacenamiento en MinIO (S3-compatible)
// ============================================================

const Minio = require('minio');
const path = require('path');
const { Readable } = require('stream');

// ============================================================
// CONFIGURACIÓN
// ============================================================
const CONFIG = {
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'geodaily_admin',
  secretKey: process.env.MINIO_SECRET || 'GeoDaily2026_M1n10!',
  bucket: process.env.MINIO_BUCKET || 'geodaily-archivos',
};

// ============================================================
// CLIENTE MinIO
// ============================================================
const minioClient = new Minio.Client({
  endPoint: CONFIG.endPoint,
  port: CONFIG.port,
  useSSL: CONFIG.useSSL,
  accessKey: CONFIG.accessKey,
  secretKey: CONFIG.secretKey,
});

let _bucketReady = false;

/**
 * Asegurar que el bucket existe
 */
async function ensureBucket() {
  if (_bucketReady) return true;
  try {
    const exists = await minioClient.bucketExists(CONFIG.bucket);
    if (!exists) {
      await minioClient.makeBucket(CONFIG.bucket);
      console.log(`[Storage] Bucket "${CONFIG.bucket}" creado`);
    }
    _bucketReady = true;
    return true;
  } catch (err) {
    console.error('[Storage] Error al verificar bucket:', err.message);
    return false;
  }
}

// ============================================================
// CONSTRUCCIÓN DE RUTAS
// ============================================================

/**
 * Obtener la ruta base en MinIO para un usuario según su rol
 * @param {string} rol - tecnico | supervisor | interventor | gerente | admin
 * @param {string} usuario - nombre de usuario (ej: 'rodrigo.zuleta')
 * @returns {string} ruta base (ej: 'tecnicos/rodrigo.zuleta')
 */
function getUserBasePath(rol, usuario) {
  const roleMap = {
    tecnico: 'tecnicos',
    supervisor: 'supervisores',
    interventor: 'interventores',
    gerente: 'gerentes',
    admin: 'admin',
  };
  const folder = roleMap[rol] || 'otros';
  return `${folder}/${usuario}`;
}

/**
 * Obtener la ruta completa para un archivo
 */
function getFilePath(rol, usuario, tipo, filename) {
  const base = getUserBasePath(rol, usuario);
  return `${base}/${tipo}/${filename}`;
}

// ============================================================
// OPERACIONES CON ARCHIVOS
// ============================================================

/**
 * Crear carpetas para un usuario nuevo (estructura completa)
 */
async function createUserFolders(rol, usuario) {
  const base = getUserBasePath(rol, usuario);
  const subs = getSubfoldersForRole(rol);
  const created = [];

  for (const sub of subs) {
    const folderPath = `${base}/${sub}/`;
    try {
      // MinIO crea carpetas automáticamente al subir archivos,
      // pero creamos un .keep para que aparezcan en la UI
      await minioClient.putObject(
        CONFIG.bucket,
        `${base}/${sub}/.keep`,
        Buffer.from('')
      );
      created.push(`${base}/${sub}/`);
    } catch (err) {
      console.warn(`[Storage] Error creando carpeta ${base}/${sub}:`, err.message);
    }
  }

  console.log(`[Storage] 📁 Carpetas creadas para ${rol}/${usuario}: ${subs.join(', ')}`);
  return created;
}

/**
 * Subir un archivo a MinIO
 * @param {string} rol - rol del usuario
 * @param {string} usuario - nombre de usuario
 * @param {string} tipo - fotos | videos | documentos | pdfs | firmas
 * @param {string} filename - nombre del archivo
 * @param {Buffer|Readable} data - contenido del archivo
 * @param {object} metadata - metadatos opcionales
 * @returns {Promise<string>} URL pública del archivo
 */
async function uploadFile(rol, usuario, tipo, filename, data, metadata = {}) {
  await ensureBucket();
  const filePath = getFilePath(rol, usuario, tipo, filename);

  const meta = {
    'Content-Type': metadata.contentType || 'application/octet-stream',
    'X-Amz-Meta-Uploaded-By': usuario,
    'X-Amz-Meta-Rol': rol,
    ...(metadata.custom || {}),
  };

  await minioClient.putObject(CONFIG.bucket, filePath, data, null, meta);

  // Generar URL firmada (válida 24h)
  const url = await minioClient.presignedGetObject(CONFIG.bucket, filePath, 24 * 60 * 60);

  console.log(`[Storage] ✅ Archivo subido: ${filePath} (${Buffer.isBuffer(data) ? data.length : 'stream'} bytes)`);

  return {
    path: filePath,
    url,
    bucket: CONFIG.bucket,
    filename,
    size: Buffer.isBuffer(data) ? data.length : 0,
  };
}

/**
 * Subir archivo desde el sistema de archivos local
 */
async function uploadFromFile(rol, usuario, tipo, filename, localPath, contentType) {
  const fs = require('fs');
  const stat = fs.statSync(localPath);
  const stream = fs.createReadStream(localPath);
  
  await ensureBucket();
  const filePath = getFilePath(rol, usuario, tipo, filename);

  await minioClient.fPutObject(CONFIG.bucket, filePath, localPath, {
    'Content-Type': contentType || 'application/octet-stream',
  });

  const url = await minioClient.presignedGetObject(CONFIG.bucket, filePath, 24 * 60 * 60);

  console.log(`[Storage] ✅ Archivo subido desde disco: ${filePath} (${stat.size} bytes)`);

  return {
    path: filePath,
    url,
    bucket: CONFIG.bucket,
    filename,
    size: stat.size,
  };
}

/**
 * Obtener URL firmada para descarga
 */
async function getSignedUrl(filePath, expirySeconds = 86400) {
  try {
    const url = await minioClient.presignedGetObject(CONFIG.bucket, filePath, expirySeconds);
    return url;
  } catch (err) {
    console.error('[Storage] Error al generar URL:', err.message);
    return null;
  }
}

/**
 * Eliminar un archivo
 */
async function deleteFile(filePath) {
  try {
    await minioClient.removeObject(CONFIG.bucket, filePath);
    console.log(`[Storage] 🗑️ Archivo eliminado: ${filePath}`);
    return true;
  } catch (err) {
    console.error('[Storage] Error al eliminar archivo:', err.message);
    return false;
  }
}

/**
 * Listar archivos en una carpeta
 */
async function listFiles(prefix, recursive = true) {
  try {
    const objects = [];
    const stream = minioClient.listObjects(CONFIG.bucket, prefix, recursive);
    
    return new Promise((resolve, reject) => {
      stream.on('data', obj => {
        if (!obj.name.endsWith('.keep')) {
          objects.push(obj);
        }
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(objects));
    });
  } catch (err) {
    console.error('[Storage] Error al listar archivos:', err.message);
    return [];
  }
}

/**
 * Obtener subcarpetas según el rol
 */
function getSubfoldersForRole(rol) {
  const common = ['fotos', 'videos', 'documentos', 'pdfs'];
  const roleSpecific = {
    tecnico: [...common, 'firmas'],
    supervisor: [...common, 'informes', 'firmas'],
    interventor: [...common, 'informes', 'firmas'],
    gerente: [...common, 'reportes', 'dashboards'],
    admin: ['documentos', 'pdfs', 'configuracion', 'respaldos', 'logs'],
  };
  return roleSpecific[rol] || common;
}

module.exports = {
  minioClient,
  ensureBucket,
  getUserBasePath,
  getFilePath,
  createUserFolders,
  uploadFile,
  uploadFromFile,
  getSignedUrl,
  deleteFile,
  listFiles,
  getSubfoldersForRole,
  CONFIG,
};
