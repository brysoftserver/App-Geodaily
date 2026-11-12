// ============================================================
// GEODAILY — Reasignación «solo pendientes» (conservar autoría)
// ============================================================
// Caso: un técnico se retira (Miller) y sus beneficiarios pasan a otro
// (Suárez). Lo que el anterior ya diligenció y firmó es un documento
// legalizado: NO se traslada. El técnico nuevo solo hace lo que falta.
//
// Diferencia con la reasignación normal (PUT /api/beneficiarios/:item/asignacion
// sin modo), que reescribe TODO a nombre del técnico nuevo:
//
//   Formularios completos   → se quedan con su técnico, firmas y caracterización
//                             intactos; se marcan `autoria_fija = TRUE`
//                             (el técnico nuevo los ve en solo lectura).
//   Archivos en MinIO       → no se mueven.
//   Borradores              → pasan al técnico nuevo tal cual (con fotos y
//                             firmas); él decide si los usa o los elimina.
//   beneficiarios           → técnico nuevo + `tecnico_anterior_id`, para que
//                             una visita del anterior que suba tarde quede a
//                             su nombre (ver lib/atribucion.js).
//
// `autoria_fija` se marca SIN tocar `updated_at` (flag del trigger): así ningún teléfono
// reemplaza su copia local por esta razón.
// Todo en una transacción: o queda completo o no cambia nada.
// ============================================================

const CEDULA_NORMALIZADA = (expr) => `regexp_replace(COALESCE(${expr}, ''), '[^0-9A-Za-z]', '', 'g')`;

/**
 * @param {import('pg').Pool} pool
 * @param {{item:number, tecnicoId:string, tecnicoNombre:string, simular?:boolean}} p
 */
const reasignarSoloPendientes = async (pool, { item, tecnicoId, tecnicoNombre, simular = false }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const benef = (await client.query(
      `SELECT item, cedula, nombre_completo, tecnico_asignado_id
         FROM beneficiarios WHERE item = $1 FOR UPDATE`,
      [item]
    )).rows[0];
    if (!benef) throw Object.assign(new Error('Beneficiario no encontrado'), { status: 404 });

    const tecnico = (await client.query(
      'SELECT id, nombre, cedula, telefono, email FROM usuarios WHERE id = $1',
      [tecnicoId]
    )).rows[0];
    if (!tecnico) throw Object.assign(new Error('Técnico no encontrado'), { status: 404 });

    const anterior = benef.tecnico_asignado_id && benef.tecnico_asignado_id !== tecnicoId
      ? benef.tecnico_asignado_id
      : null;

    await client.query(
      `UPDATE beneficiarios
          SET tecnico_asignado_id = $1,
              tecnico_asignado_nombre = $2,
              tecnico_anterior_id = COALESCE($3, tecnico_anterior_id),
              updated_at = NOW()
        WHERE item = $4`,
      [tecnicoId, tecnicoNombre || tecnico.nombre, anterior, item]
    );

    const resumen = {
      item,
      beneficiario: benef.nombre_completo,
      tecnicoAnterior: anterior,
      formulariosConservados: 0,
      borradoresTrasladados: 0,
    };

    const cedula = (benef.cedula || '').replace(/[^0-9A-Za-z]/g, '');
    if (cedula) {
      // Formularios completos: solo se marca la autoría. Ni dueño, ni
      // tecnico_json, ni caracterización, ni firmas, ni updated_at.
      // El trigger trg_formularios_updated_at pondría NOW(): el flag (solo
      // para esta transacción) lo evita — ver update_updated_at() en database.js.
      await client.query(`SET LOCAL geodaily.conservar_updated_at = 'on'`);
      const conservados = await client.query(
        `UPDATE formularios SET autoria_fija = TRUE
          WHERE ${CEDULA_NORMALIZADA("beneficiario_json->>'cedula'")} = $1
          RETURNING id`,
        [cedula]
      );
      await client.query(`SET LOCAL geodaily.conservar_updated_at = 'off'`);
      resumen.formulariosConservados = conservados.rowCount;

      // Borradores: pasan al técnico nuevo con todo su contenido. Solo cambia
      // el dueño y el técnico del payload (al terminarlo, la visita es suya).
      // updated_at = NOW() para que esta versión gane sobre la copia vieja del
      // teléfono anterior (mismo criterio que la reasignación normal).
      const nuevoTecnicoJson = JSON.stringify({
        usuario_id: tecnicoId,
        nombre: tecnico.nombre,
        cedula: tecnico.cedula || '',
        telefono: tecnico.telefono || '',
        email: tecnico.email || '',
      });
      const borradores = await client.query(
        `UPDATE formularios_borradores b
            SET usuario_id = $1,
                payload_json = jsonb_set(
                  b.payload_json, '{tecnico}',
                  COALESCE(b.payload_json->'tecnico', '{}'::jsonb) || $2::jsonb
                ),
                updated_at = NOW()
          WHERE ${CEDULA_NORMALIZADA("b.payload_json->'beneficiario'->>'cedula'")} = $3
            AND b.usuario_id <> $1
            AND NOT EXISTS (SELECT 1 FROM formularios f WHERE f.id = b.id)
          RETURNING b.id`,
        [tecnicoId, nuevoTecnicoJson, cedula]
      );
      resumen.borradoresTrasladados = borradores.rowCount;
    }

    await client.query(simular ? 'ROLLBACK' : 'COMMIT');
    return resumen;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { reasignarSoloPendientes };
