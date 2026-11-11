// ============================================================
// Fijar el objetivo oficial en TODAS las Visitas 2 (formato 'v2')
// ============================================================
// Actualiza `actividad_json.objetivo` y `actividad_json.visita_datos.objetivo`
// en `formularios`, y `payload_json.actividad` en `formularios_borradores`.
//
// - NO cambia `updated_at`: así los teléfonos no reemplazan su copia local
//   completa en el próximo merge (la app ya muestra el objetivo fijo).
// - Antes de escribir guarda el objetivo anterior de cada registro en
//   backups/objetivo-visita2-<fecha>.json.
// - Todo en una transacción.
//
// Por defecto SIMULA. Con --apply escribe.
//   node scripts/fijar-objetivo-visita2.js [--apply]
// ============================================================

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { fijarObjetivoVisita2 } = require('../src/lib/objetivoVisita2');

process.loadEnvFile(path.join(__dirname, '..', '.env'));
const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  host: process.env.PG_HOST, port: process.env.PG_PORT, database: process.env.PG_DB,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
});

const aObjeto = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : v || {});

(async () => {
  const client = await pool.connect();
  const respaldo = { fecha: new Date().toISOString(), formularios: [], borradores: [] };
  try {
    await client.query('BEGIN');

    const forms = await client.query(
      `SELECT id, actividad_json FROM formularios WHERE actividad_json->>'formato_visita' = 'v2' FOR UPDATE`
    );
    for (const f of forms.rows) {
      const act = aObjeto(f.actividad_json);
      const antes = { objetivo: act.objetivo, visita_datos_objetivo: act.visita_datos?.objetivo };
      if (!fijarObjetivoVisita2(act)) continue;
      respaldo.formularios.push({ id: f.id, ...antes });
      if (APPLY) {
        await client.query('UPDATE formularios SET actividad_json = $2::jsonb WHERE id = $1', [f.id, JSON.stringify(act)]);
      }
    }

    const borr = await client.query(
      `SELECT id, payload_json FROM formularios_borradores WHERE payload_json->'actividad'->>'formato_visita' = 'v2' FOR UPDATE`
    );
    for (const b of borr.rows) {
      const payload = aObjeto(b.payload_json);
      const act = payload.actividad;
      const antes = { objetivo: act?.objetivo, visita_datos_objetivo: act?.visita_datos?.objetivo };
      if (!fijarObjetivoVisita2(act)) continue;
      respaldo.borradores.push({ id: b.id, ...antes });
      if (APPLY) {
        await client.query('UPDATE formularios_borradores SET payload_json = $2::jsonb WHERE id = $1', [b.id, JSON.stringify(payload)]);
      }
    }

    console.log(`Visitas 2: ${forms.rowCount} formularios (${respaldo.formularios.length} a corregir), ${borr.rowCount} borradores (${respaldo.borradores.length} a corregir)`);

    if (APPLY) {
      const dir = path.join(__dirname, '..', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const archivo = path.join(dir, `objetivo-visita2-${respaldo.fecha.replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(archivo, JSON.stringify(respaldo, null, 2));
      console.log('Respaldo:', archivo);
      await client.query('COMMIT');
      console.log('✅ Aplicado');
    } else {
      await client.query('ROLLBACK');
      console.log('Simulación (sin cambios). Usa --apply para escribir.');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error, no se aplicó nada:', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
