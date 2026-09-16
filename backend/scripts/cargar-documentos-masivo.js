// ============================================================
// GEODAILY — Carga masiva de documentos (PDF) a MinIO + Postgres
// ============================================================
// Lee una carpeta local organizada como:
//   <raiz>/<Corregimiento>/<Vereda>/<Beneficiario>/archivo1.pdf
// y para cada PDF:
//   1. Empareja la carpeta del beneficiario con un registro real en
//      la tabla `beneficiarios` (por corregimiento+vereda+nombre, con
//      fallback a solo nombre si la geografía no calza exacto).
//   2. Resuelve el técnico asignado a ese beneficiario (la ruta en
//      MinIO depende de quién "es dueño" de la carpeta del técnico).
//   3. Sube el PDF a MinIO reutilizando storage.uploadFromFile (misma
//      función que usa la API, así la ruta queda idéntica a como la
//      arma cualquier subida real: tecnicos/{usuario}/{item}_{nombre}/documentos/{filename}).
//   4. Inserta el registro en `archivos`, con
//      metadata_json.beneficiario_cedula — así el endpoint
//      GET /api/documentos/beneficiario/:cedula (y por lo tanto la
//      pantalla "Documentos de la finca") lo puede mostrar.
//
// Por defecto corre en modo DRY-RUN (no sube nada, no escribe en la
// BD): solo reporta qué haría. Hay que pasar --confirmar para que
// suba de verdad.
//
// Uso:
//   node scripts/cargar-documentos-masivo.js --dir "/ruta/a/la/carpeta" [--confirmar]
// ============================================================

const fs = require('fs');
const path = require('path');

// Cargar el mismo .env que usa el backend (mismas credenciales de
// Postgres/MinIO), sin depender de que el proceso se lance con dotenv.
const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const db = require('../src/database');
const storage = require('../src/storage');

// ─── Argumentos ─────────────────────────────────────────────
const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const ROOT_DIR = dirIndex !== -1 ? args[dirIndex + 1] : null;
const CONFIRMAR = args.includes('--confirmar');

if (!ROOT_DIR) {
  console.error('Uso: node cargar-documentos-masivo.js --dir "<ruta>" [--confirmar]');
  process.exit(1);
}
if (!fs.existsSync(ROOT_DIR) || !fs.statSync(ROOT_DIR).isDirectory()) {
  console.error(`No existe la carpeta: ${ROOT_DIR}`);
  process.exit(1);
}

// ─── Normalización para matching (igual criterio que storage.js) ──
function normalizar(s) {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function sanitizeFolderName(name) {
  if (!name) return 'sin_nombre';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

/**
 * Limpia los nombres reales de las carpetas de "SOPORTES BASE FINAL", que
 * traen numeración/conteos pegados y, en varios casos, un guion bajo suelto
 * al final (artefacto de sincronización, ej. Drive/OneDrive):
 *   "1.CORREGIMIENTO LA AGUILILLA. BEN88" -> "LA AGUILILLA"
 *   "1.1 Águila N°1. -1"                  -> "Águila N°1"
 *   "8.ALDEMAR GUALY ARIAS"               -> "ALDEMAR GUALY ARIAS"
 *   "ABELARDO MORA_"                      -> "ABELARDO MORA"
 */
function limpiarNombreCarpeta(nombre) {
  let n = nombre;
  n = n.replace(/^\d+\.\s*CORREGIMIENTO\s+/i, '');      // prefijo corregimiento
  n = n.replace(/\.?\s*BEN\d+\s*$/i, '');                // sufijo ". BEN88"
  n = n.replace(/^\d+(\.\d+)?\.?\s*/, '');               // prefijo "1.1 " / "8."
  n = n.replace(/[.\s]*-\s*\d+\s*$/, '');                // sufijo conteo ". -2" / "-1" / ".-2"
  n = n.replace(/_+\s*$/, '');                           // guion bajo final suelto
  n = n.replace(/\.pdf_?$/i, '');                         // carpeta con ".pdf"/".pdf_" pegado al nombre
  n = n.replace(/_+\s*$/, '');                           // guion bajo que quedó tras quitar ".pdf_"
  return n.trim();
}

// ─── Recorrido de la carpeta: Corregimiento/Vereda/Beneficiario/*.pdf ──
function listarSubcarpetas(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

// Acepta ".pdf" y ".pdf_" (mismo artefacto de sincronización que en las
// carpetas): son PDFs reales, solo con un carácter de más en la extensión.
function listarPdfs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.pdf_?$/i.test(e.name))
    .map((e) => e.name);
}

/**
 * Carpetas cuyo nombre no calzó ni por (corregimiento+vereda+nombre) ni por
 * nombre solo, pero que SÍ se verificaron manualmente contra la BD (apellido
 * faltante/de más, una letra distinta, orden de apellidos invertido). Cada
 * una se confirmó como coincidencia única e inequívoca antes de agregarla
 * aquí — no es una adivinanza automática.
 */
const MAPEO_MANUAL = {
  'eduardo quintero': 80,           // BD: Eduardo Quintero Hernandez
  'willan guaza mina': 82,          // BD: Willian Guaza Mina
  'edwin arturo sanchez': 5,        // BD: Edwin Arturo Sanchez Gaviria
  'luis humberto farfan abella': 90,// BD: Luis Humberto Farfan
  'maria cristina perdomo': 92,     // BD: Maria Cristina Perdomo Gutierrez
  'william alberto alarcon': 96,    // BD: William Alberto Alarcon Tique
  'luis eduardo montoya lopez': 243,// BD: Luis Eduardo Montoya Lopes
  'edinsson salinas osuna': 196,    // BD: Edinson Salinas Osuna
  'marcos munoz': 305,              // BD: Marcos Muñoz Oidor
  'dago leal paz': 320,             // BD: Dago Paz Leal
  'cristian eduardo ruiz bernal': 325, // BD: Cristian Eduardo Ruiz
  'robinson caviedez munoz': 329,   // BD: Robinson Cavidez Muñoz
};
// Las claves de arriba deben quedar ya normalizadas (sin tildes/ñ, como
// hace normalizar()) porque así se comparan más abajo.

/** Nombre "limpio" del archivo para guardar como originalname (sin el _ final) */
function limpiarNombreArchivo(nombre) {
  return nombre.replace(/_+$/, '');
}

async function main() {
  console.log(`Modo: ${CONFIRMAR ? 'CONFIRMAR (sube y escribe de verdad)' : 'DRY-RUN (solo simula)'}`);
  console.log(`Carpeta raíz: ${ROOT_DIR}\n`);

  const { rows: beneficiarios } = await db.pool.query(
    `SELECT b.item, b.nombre_completo, b.cedula, b.corregimiento, b.vereda,
            b.tecnico_asignado_id, u.usuario AS tecnico_usuario, u.rol AS tecnico_rol
     FROM beneficiarios b
     LEFT JOIN usuarios u ON u.id = b.tecnico_asignado_id`
  );

  // Índices de matching
  const porTriplete = new Map(); // "corregimiento|vereda|nombre" -> [beneficiarios]
  const porNombre = new Map();   // "nombre" -> [beneficiarios]
  const porItem = new Map();     // item -> beneficiario
  for (const b of beneficiarios) {
    const claveTriplete = `${normalizar(b.corregimiento)}|${normalizar(b.vereda)}|${normalizar(b.nombre_completo)}`;
    const claveNombre = normalizar(b.nombre_completo);
    if (!porTriplete.has(claveTriplete)) porTriplete.set(claveTriplete, []);
    porTriplete.get(claveTriplete).push(b);
    if (!porNombre.has(claveNombre)) porNombre.set(claveNombre, []);
    porNombre.get(claveNombre).push(b);
    porItem.set(b.item, b);
  }

  const reporte = {
    subidos: [],       // {corregimiento, vereda, beneficiario, archivo, minioPath}
    yaExistian: [],     // ya había un registro para ese beneficiario+archivo
    sinMatch: [],       // no se encontró beneficiario para esa carpeta
    matchParcial: [],   // matcheó solo por nombre, geografía no coincidía exacto
    sinTecnico: [],     // beneficiario matcheado pero sin técnico asignado
    errores: [],
  };

  const corregimientos = listarSubcarpetas(ROOT_DIR);
  for (const corregimiento of corregimientos) {
    const dirCorregimiento = path.join(ROOT_DIR, corregimiento);
    const veredas = listarSubcarpetas(dirCorregimiento);

    for (const vereda of veredas) {
      const dirVereda = path.join(dirCorregimiento, vereda);
      const carpetasBeneficiario = listarSubcarpetas(dirVereda);

      for (const nombreCarpeta of carpetasBeneficiario) {
        const dirBeneficiario = path.join(dirVereda, nombreCarpeta);
        const pdfs = listarPdfs(dirBeneficiario);
        if (pdfs.length === 0) continue;

        // 1) Match exacto por corregimiento+vereda+nombre (limpiando la
        //    numeración/conteos/guion bajo suelto que traen las carpetas)
        const corregimientoLimpio = limpiarNombreCarpeta(corregimiento);
        const veredaLimpia = limpiarNombreCarpeta(vereda);
        const nombreLimpio = limpiarNombreCarpeta(nombreCarpeta);
        const claveTriplete = `${normalizar(corregimientoLimpio)}|${normalizar(veredaLimpia)}|${normalizar(nombreLimpio)}`;
        let candidatos = porTriplete.get(claveTriplete) || [];
        let matchParcial = false;

        // 2) Fallback: solo por nombre (la geografía en la carpeta puede
        //    estar escrita distinto a como quedó en la BD)
        if (candidatos.length !== 1) {
          const porSoloNombre = porNombre.get(normalizar(nombreLimpio)) || [];
          if (porSoloNombre.length === 1) {
            candidatos = porSoloNombre;
            matchParcial = true;
          }
        }

        // 3) Fallback: mapeo manual verificado (apellido faltante/de más,
        //    letra distinta, orden invertido — ver MAPEO_MANUAL arriba)
        if (candidatos.length !== 1) {
          const itemManual = MAPEO_MANUAL[normalizar(nombreLimpio)];
          if (itemManual && porItem.has(itemManual)) {
            candidatos = [porItem.get(itemManual)];
            matchParcial = true;
          }
        }

        if (candidatos.length !== 1) {
          reporte.sinMatch.push({
            corregimiento, vereda, beneficiario: nombreCarpeta,
            pdfs: pdfs.length,
            motivo: candidatos.length === 0 ? 'sin coincidencias' : `${candidatos.length} coincidencias ambiguas`,
          });
          continue;
        }

        const beneficiario = candidatos[0];
        if (matchParcial) {
          reporte.matchParcial.push({
            corregimiento, vereda, beneficiario: nombreCarpeta,
            item: beneficiario.item,
            corregimientoBD: beneficiario.corregimiento,
            veredaBD: beneficiario.vereda,
          });
        }

        if (!beneficiario.tecnico_asignado_id || !beneficiario.tecnico_usuario) {
          reporte.sinTecnico.push({
            corregimiento, vereda, beneficiario: nombreCarpeta, item: beneficiario.item,
          });
          continue;
        }

        // 3) Subir cada PDF de esa carpeta
        for (const nombreArchivoDisco of pdfs) {
          const rutaLocal = path.join(dirBeneficiario, nombreArchivoDisco);
          // Nombre "de verdad" a guardar como originalname: algunos PDFs
          // quedaron como "....pdf_" (mismo artefacto de sincronización que
          // en las carpetas) — se guarda sin ese guion bajo de más.
          const nombreArchivo = limpiarNombreArchivo(nombreArchivoDisco);

          try {
            // Idempotencia: si ya existe un registro para este beneficiario
            // con el mismo nombre original, no lo duplica.
            const existente = await db.pool.query(
              `SELECT id FROM archivos
               WHERE tipo = 'other' AND metadata_json->>'beneficiario_cedula' = $1 AND originalname = $2`,
              [beneficiario.cedula, nombreArchivo]
            );
            if (existente.rows.length > 0) {
              reporte.yaExistian.push({ beneficiario: nombreCarpeta, archivo: nombreArchivo });
              continue;
            }

            const stat = fs.statSync(rutaLocal);
            const filenameMinio = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.pdf`;

            if (!CONFIRMAR) {
              reporte.subidos.push({
                corregimiento, vereda, beneficiario: nombreCarpeta, item: beneficiario.item,
                tecnico: beneficiario.tecnico_usuario, archivo: nombreArchivo,
                minioPath: `tecnicos/${beneficiario.tecnico_usuario}/${beneficiario.item}_${sanitizeFolderName(beneficiario.nombre_completo)}/documentos/${filenameMinio}`,
                size: stat.size,
              });
              continue;
            }

            const resultado = await storage.uploadFromFile(
              beneficiario.tecnico_rol || 'tecnico',
              beneficiario.tecnico_usuario,
              'documentos',
              filenameMinio,
              rutaLocal,
              'application/pdf',
              { beneficiarioItem: beneficiario.item, beneficiarioNombre: beneficiario.nombre_completo }
            );

            const metadataExtra = {
              descripcion: null,
              categoria: 'carga_masiva',
              beneficiario_item: beneficiario.item,
              beneficiario_cedula: beneficiario.cedula,
              formulario_id: null,
            };

            await db.pool.query(
              `INSERT INTO archivos (usuario_id, formulario_id, tipo, filename, originalname, mimetype, size_bytes, minio_path, minio_bucket, metadata_json)
               VALUES ($1, NULL, 'other', $2, $3, $4, $5, $6, $7, $8)`,
              [
                beneficiario.tecnico_asignado_id,
                filenameMinio,
                nombreArchivo,
                'application/pdf',
                resultado.size,
                resultado.path,
                resultado.bucket,
                JSON.stringify(metadataExtra),
              ]
            );

            reporte.subidos.push({
              corregimiento, vereda, beneficiario: nombreCarpeta, item: beneficiario.item,
              tecnico: beneficiario.tecnico_usuario, archivo: nombreArchivo,
              minioPath: resultado.path, size: resultado.size,
            });
            console.log(`✔ ${nombreCarpeta} — ${nombreArchivo}`);
          } catch (err) {
            reporte.errores.push({ beneficiario: nombreCarpeta, archivo: nombreArchivo, error: err.message });
            console.error(`✘ Error con ${nombreCarpeta}/${nombreArchivo}: ${err.message}`);
          }
        }
      }
    }
  }

  // ─── Resumen ──────────────────────────────────────────────
  console.log('\n============ RESUMEN ============');
  console.log(`${CONFIRMAR ? 'Subidos' : 'Se subirían (dry-run)'}: ${reporte.subidos.length}`);
  console.log(`Ya existían (omitidos): ${reporte.yaExistian.length}`);
  console.log(`Match parcial (solo por nombre, revisar geografía): ${reporte.matchParcial.length}`);
  console.log(`Sin coincidencia en la BD: ${reporte.sinMatch.length}`);
  console.log(`Sin técnico asignado: ${reporte.sinTecnico.length}`);
  console.log(`Errores: ${reporte.errores.length}`);

  const outDir = path.join(__dirname, 'reportes-carga-documentos');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `reporte_${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(reporte, null, 2));
  console.log(`\nReporte detallado guardado en: ${outFile}`);

  await db.pool.end();
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
