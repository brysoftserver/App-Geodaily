// ============================================================
// Script único: asigna los 76 beneficiarios oficiales a su técnico
// correspondiente y garantiza la contraseña de mauricio.valencia.
// Ejecutar una sola vez desde backend/: node scripts/asignar-tecnicos-76.js
// ============================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/database');
const storage = require('../src/storage');

const asignaciones = require('/tmp/claude-0/-opt-App-movil/b918eb28-c6e5-4dce-ad29-333dea4c6fe5/scratchpad/asignaciones76.json');

const TECNICOS = {
  'SERGIO MALAVER': { id: 'tec-004', usuario: 'sergio.malaver' },
  'MILLER CAMACHO': { id: 'tec-006', usuario: 'miller.camacho' },
  'MAURICIO VALENCIA': { id: 'tec-012', usuario: 'mauricio.valencia' },
};

async function main() {
  // 1) Garantizar contraseña de mauricio.valencia
  const hash = await bcrypt.hash('123456', 10);
  const upd = await db.query(
    `UPDATE usuarios SET contrasena = $1, contrasena_visible = $2, updated_at = NOW() WHERE usuario = 'mauricio.valencia'`,
    [hash, '123456']
  );
  console.log(`[1/4] Contraseña de mauricio.valencia actualizada (filas: ${upd.rowCount})`);

  // 2) Resolver nombre completo real de cada técnico desde usuarios
  for (const key of Object.keys(TECNICOS)) {
    const row = await db.queryOne('SELECT id, nombre FROM usuarios WHERE id = $1', [TECNICOS[key].id]);
    if (!row) throw new Error(`Técnico no encontrado: ${key} (${TECNICOS[key].id})`);
    TECNICOS[key].nombre = row.nombre;
  }
  console.log('[2/4] Técnicos resueltos:', TECNICOS);

  // 3) Asignar cada beneficiario por cédula
  let asignados = 0;
  let noEncontrados = [];
  for (const [cedula, tecnicoKey] of asignaciones) {
    const tec = TECNICOS[tecnicoKey];
    const existente = await db.queryOne('SELECT item FROM beneficiarios WHERE cedula = $1', [cedula]);
    if (!existente) {
      noEncontrados.push(cedula);
      continue;
    }
    await db.query(
      `UPDATE beneficiarios SET tecnico_asignado_id = $1, tecnico_asignado_nombre = $2, updated_at = NOW() WHERE cedula = $3`,
      [tec.id, tec.nombre, cedula]
    );
    asignados++;
  }
  console.log(`[3/4] Beneficiarios asignados: ${asignados}/${asignaciones.length}`);
  if (noEncontrados.length > 0) {
    console.warn('  ⚠️ Cédulas no encontradas en la tabla beneficiarios:', noEncontrados);
  }

  // 4) Verificación + crear carpetas MinIO para los recién asignados
  const totalSinAsignar = await db.queryOne('SELECT COUNT(*)::int AS n FROM beneficiarios WHERE tecnico_asignado_id IS NULL');
  const totalBeneficiarios = await db.queryOne('SELECT COUNT(*)::int AS n FROM beneficiarios');
  console.log(`[4/4] Total beneficiarios: ${totalBeneficiarios.n} — sin técnico asignado: ${totalSinAsignar.n}`);

  const asignadosFull = await db.queryAll(
    `SELECT b.item, b.nombre_completo, b.tecnico_asignado_id, u.usuario, u.rol
     FROM beneficiarios b
     JOIN usuarios u ON u.id = b.tecnico_asignado_id
     WHERE b.tecnico_asignado_id IS NOT NULL AND u.activo = TRUE`
  );
  let carpetasOk = 0, carpetasError = 0;
  for (const benef of asignadosFull) {
    try {
      for (const tipoForm of ['caracterizacion', 'visita_tecnica']) {
        await storage.createBeneficiaryFolders(benef.rol, benef.usuario, benef.item, benef.nombre_completo, tipoForm);
      }
      carpetasOk++;
    } catch (err) {
      carpetasError++;
      console.warn(`  ⚠️ Error creando carpetas para item ${benef.item}:`, err.message);
    }
  }
  console.log(`[MinIO] Carpetas creadas/verificadas: ${carpetasOk} ok, ${carpetasError} con error`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Error en el script:', err);
  process.exit(1);
});
