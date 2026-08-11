const { Pool } = require('pg');
const Minio = require('minio');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'geodaily', user: 'geodaily_admin', password: process.env.PG_PASSWORD });

async function main() {
  // 1. Backup de filas a borrar (por seguridad) antes de tocar nada
  const fs = require('fs');
  const backup = {};
  backup.usuarios_a_borrar = (await pool.query(`SELECT * FROM usuarios WHERE id='int-008'`)).rows;
  backup.archivos = (await pool.query(`SELECT * FROM archivos`)).rows;
  backup.tracking = (await pool.query(`SELECT * FROM tracking`)).rows;
  backup.actividad_log_a_borrar = (await pool.query(`SELECT * FROM actividad_log WHERE accion IN ('generar_pdf','eliminar_formulario','guardar_formulario','actualizar_formulario','subir_foto','subir_documento','subir_video','subir_firma','eliminar_plantacion')`)).rows;
  fs.writeFileSync('/tmp/claude-0/-opt-App-movil/108154cb-061f-4823-af01-77f168959439/scratchpad/backup-antes-de-limpieza.json', JSON.stringify(backup, null, 2));
  console.log('Backup guardado. Filas respaldadas:', {
    usuarios: backup.usuarios_a_borrar.length,
    archivos: backup.archivos.length,
    tracking: backup.tracking.length,
    actividad_log: backup.actividad_log_a_borrar.length
  });
}
main().then(()=>pool.end()).catch(e=>{console.error(e); process.exit(1);});
