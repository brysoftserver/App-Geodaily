// ============================================================
// GEODAILY — Almacenamiento en MinIO (S3-compatible)
// ============================================================

const Minio = require('minio');
const path = require('path');
const { Readable } = require('stream');

// ============================================================
// CONFIGURACIÓN
// ============================================================
if (!process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET) {
  throw new Error('MINIO_ACCESS_KEY/MINIO_SECRET no configurados. Define estas variables de entorno antes de iniciar el servidor.');
}

const CONFIG = {
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET,
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

/**
 * Sanitizar un nombre para usarlo como nombre de carpeta en MinIO
 * Elimina caracteres especiales, reemplaza espacios por guiones bajos
 */
function sanitizeFolderName(name) {
  if (!name) return 'sin_nombre';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')      // Quita tildes
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')     // Solo alfanuméricos, guiones, espacios
    .trim()
    .replace(/\s+/g, '_')                  // Espacios → guión bajo
    .slice(0, 80);                         // Máximo 80 caracteres
}

/**
 * Obtener el subpath de un beneficiario dentro de la carpeta del técnico
 * @param {number|string} item - número de item del beneficiario
 * @param {string} nombreCompleto - nombre completo del beneficiario
 * @returns {string} ej: '42_Juan_Perez'
 */
function getBeneficiarySubpath(item, nombreCompleto) {
  const sanitized = sanitizeFolderName(nombreCompleto);
  return `${item}_${sanitized}`;
}

/**
 * Obtener la carpeta de tipo de formulario según el tipo
 * @param {string} tipoFormulario - 'caracterizacion' | 'visita_tecnica'
 * @returns {string} 'Formulario_1' | 'Formulario_2' | ''
 */
function getFormTypeFolder(tipoFormulario) {
  if (!tipoFormulario) return '';
  const map = {
    caracterizacion: 'Formulario_1',
    visita_tecnica: 'Formulario_2',
  };
  return map[tipoFormulario] || '';
}

/**
 * Obtener la ruta completa para un archivo dentro de la carpeta de un beneficiario
 * Ej: {rol}s/{usuario}/{item}_{nombre}/Formulario_1/fotos/{filename}
 */
function getBeneficiaryFilePath(rol, usuario, item, nombreCompleto, tipoFormulario, tipo, filename) {
  const base = getUserBasePath(rol, usuario);
  const subpath = getBeneficiarySubpath(item, nombreCompleto);
  const formFolder = getFormTypeFolder(tipoFormulario);
  if (formFolder) {
    return `${base}/${subpath}/${formFolder}/${tipo}/${filename}`;
  }
  return `${base}/${subpath}/${tipo}/${filename}`;
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
 * Crear carpetas para un beneficiario dentro de la carpeta del técnico en MinIO
 * Estructura: {rol}s/{usuario}/{item}_{nombre}/Formulario_{1|2}/fotos|videos|documentos|pdfs|firmas/
 */
async function createBeneficiaryFolders(rol, usuario, item, nombreCompleto, tipoFormulario) {
  const base = getUserBasePath(rol, usuario);
  const subpath = getBeneficiarySubpath(item, nombreCompleto);
  const formFolder = getFormTypeFolder(tipoFormulario);
  const subs = getSubfoldersForRole(rol);
  const created = [];

  for (const sub of subs) {
    const folderPath = `${base}/${subpath}/${formFolder}/${sub}/`;
    try {
      await minioClient.putObject(
        CONFIG.bucket,
        `${base}/${subpath}/${formFolder}/${sub}/.keep`,
        Buffer.from('')
      );
      created.push(`${base}/${subpath}/${formFolder}/${sub}/`);
    } catch (err) {
      console.warn(`[Storage] Error creando carpeta ${base}/${subpath}/${formFolder}/${sub}:`, err.message);
    }
  }

  console.log(`[Storage] 📁 Carpetas de beneficiario creadas: ${base}/${subpath}/${formFolder}/ (${subs.join(', ')})`);
  return created;
}

/**
 * Subir un archivo a MinIO (con soporte opcional de carpeta por beneficiario y tipo de formulario)
 * Si se provee item y nombreCompleto, el archivo se guarda en:
 *   {rol}s/{usuario}/{item}_{nombre}/Formulario_{1|2}/{tipo}/{filename}
 * Si no, usa la ruta tradicional:
 *   {rol}s/{usuario}/{tipo}/{filename}
 */
async function uploadFile(rol, usuario, tipo, filename, data, metadata = {}) {
  await ensureBucket();

  const { beneficiarioItem, beneficiarioNombre, tipoFormulario, ...restMetadata } = metadata;
  let filePath;

  if (beneficiarioItem && beneficiarioNombre) {
    filePath = getBeneficiaryFilePath(rol, usuario, beneficiarioItem, beneficiarioNombre, tipoFormulario, tipo, filename);
  } else {
    filePath = getFilePath(rol, usuario, tipo, filename);
  }

  const meta = {
    'Content-Type': restMetadata.contentType || 'application/octet-stream',
    'X-Amz-Meta-Uploaded-By': usuario,
    'X-Amz-Meta-Rol': rol,
    ...(restMetadata.custom || {}),
  };

  // Si hay beneficiario, asegurar que existen sus carpetas (no blocking si ya existen)
  if (beneficiarioItem && beneficiarioNombre) {
    createBeneficiaryFolders(rol, usuario, beneficiarioItem, beneficiarioNombre, tipoFormulario).catch(err => {
      console.warn('[Storage] No se pudieron crear carpetas de beneficiario (probablemente ya existen):', err.message);
    });
  }

  await minioClient.putObject(CONFIG.bucket, filePath, data, null, meta);

  // Generar URL firmada (válida 24h)
  const url = await minioClient.presignedGetObject(CONFIG.bucket, filePath, 24 * 60 * 60);

  const tipoLabel = beneficiarioItem ? `(benef:${beneficiarioItem})` : '';
  console.log(`[Storage] ✅ Archivo subido: ${filePath} ${tipoLabel}(${Buffer.isBuffer(data) ? data.length : 'stream'} bytes)`);

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
async function uploadFromFile(rol, usuario, tipo, filename, localPath, contentType, metadata = {}) {
  const fs = require('fs');
  const stat = fs.statSync(localPath);
  
  await ensureBucket();

  const { beneficiarioItem, beneficiarioNombre, tipoFormulario } = metadata;
  let filePath;
  if (beneficiarioItem && beneficiarioNombre) {
    filePath = getBeneficiaryFilePath(rol, usuario, beneficiarioItem, beneficiarioNombre, tipoFormulario, tipo, filename);
    createBeneficiaryFolders(rol, usuario, beneficiarioItem, beneficiarioNombre, tipoFormulario).catch(() => {});
  } else {
    filePath = getFilePath(rol, usuario, tipo, filename);
  }

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
 * Obtener un stream de lectura de un archivo.
 * Se usa para transmitir evidencias a la app: MinIO está en la red
 * interna, así que el binario pasa por la API en vez de exponer una
 * URL prefirmada que el celular no podría alcanzar.
 */
async function getFileStream(filePath) {
  try {
    return await minioClient.getObject(CONFIG.bucket, filePath);
  } catch (err) {
    console.error('[Storage] Error al abrir archivo:', filePath, err.message);
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
  getBeneficiaryFilePath,
  sanitizeFolderName,
  getBeneficiarySubpath,
  getFormTypeFolder,
  createUserFolders,
  createBeneficiaryFolders,
  uploadFile,
  uploadFromFile,
  getSignedUrl,
  getFileStream,
  deleteFile,
  listFiles,
  getSubfoldersForRole,
  CONFIG,
};
