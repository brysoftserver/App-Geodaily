// ============================================================
// Script para generar 30 formularios de ejemplo
// Distribuye: 3 formularios por cada uno de los 10 técnicos
// ============================================================
const http = require('http');

const API = 'http://192.168.80.20:8089';

const TECNICOS = [
  { nombre: 'Rodrigo Zuleta Velasquez', cedula: '1006530738', telefono: '3144210470', usuario: 'rodrigo.zuleta' },
  { nombre: 'German David Rojas Valderrama', cedula: '1006506887', telefono: '3115546096', usuario: 'german.rojas' },
  { nombre: 'Jose Andres Morales Barreto', cedula: '1075215830', telefono: '3106132412', usuario: 'jose.morales' },
  { nombre: 'Sergio Antonio Malaver Ramirez', cedula: '17636223', telefono: '3212348056', usuario: 'sergio.malaver' },
  { nombre: 'Alejandro Garcia Barrera', cedula: '12258325', telefono: '3115403798', usuario: 'alejandro.garcia' },
  { nombre: 'Miller Eugenio Camacho Endo', cedula: '96355140', telefono: '3222938062', usuario: 'miller.camacho' },
  { nombre: 'Deily Lorena Torres Barreto', cedula: '1006458953', telefono: '3112081673', usuario: 'deily.torres' },
  { nombre: 'Albenis Quintero Segura', cedula: '1116918281', telefono: '3229524201', usuario: 'albenis.quintero' },
  { nombre: 'Estefania Molano Rojas', cedula: '1117529305', telefono: '3123742791', usuario: 'estefania.molano' },
  { nombre: 'Alejandro Otavo Rojas', cedula: '1117541110', telefono: '3229146170', usuario: 'alejandro.otavo' },
];

const BENEFICIARIOS = [
  { nombre: 'María Elena Cuéllar', cedula: '1001234561', telefono: '3123456789', vereda: 'La Mono', finca: 'El Placer' },
  { nombre: 'Pedro Antonio Silva', cedula: '1001234562', telefono: '3123456790', vereda: 'La Mono', finca: 'Bella Vista' },
  { nombre: 'Luz Dary Rincón', cedula: '1001234563', telefono: '3123456791', vereda: 'Bajo Calenturitas', finca: 'San José' },
  { nombre: 'José del Carmen Páez', cedula: '1001234564', telefono: '3123456792', vereda: 'Bajo Calenturitas', finca: 'La Esperanza' },
  { nombre: 'Ana Milena Torres', cedula: '1001234565', telefono: '3123456793', vereda: 'San Isidro', finca: 'El Triunfo' },
  { nombre: 'Carlos Arturo Rojas', cedula: '1001234566', telefono: '3123456794', vereda: 'San Isidro', finca: 'El Porvenir' },
  { nombre: 'Marina López Muñoz', cedula: '1001234567', telefono: '3123456795', vereda: 'La Cristalina', finca: 'La Palma' },
  { nombre: 'Fernando Gutiérrez', cedula: '1001234568', telefono: '3123456796', vereda: 'La Cristalina', finca: 'El Recuerdo' },
  { nombre: 'Rosa Elena Vargas', cedula: '1001234569', telefono: '3123456797', vereda: 'Agua Blanca', finca: 'Santa Martha' },
  { nombre: 'Jorge Eliécer Martínez', cedula: '1001234570', telefono: '3123456798', vereda: 'Agua Blanca', finca: 'La Arboleda' },
  { nombre: 'Dora Inés Córdoba', cedula: '1001234571', telefono: '3123456799', vereda: 'Puerto Rico Centro', finca: 'La María' },
  { nombre: 'Hernando Parra Ríos', cedula: '1001234572', telefono: '3123456700', vereda: 'Puerto Rico Centro', finca: 'El Edén' },
  { nombre: 'Teresa Mosquera', cedula: '1001234573', telefono: '3123456701', vereda: 'La Mono', finca: 'Villa María' },
  { nombre: 'Luis Alberto Narváez', cedula: '1001234574', telefono: '3123456702', vereda: 'Bajo Calenturitas', finca: 'Buenos Aires' },
  { nombre: 'Martha Cecilia Ortiz', cedula: '1001234575', telefono: '3123456703', vereda: 'San Isidro', finca: 'Altamira' },
];

const ACTIVIDADES = [
  { desc: 'Visita de seguimiento a cultivo de cacao', obs: 'Las plantas presentan buen desarrollo vegetativo', rec: 'Continuar con manejo integrado' },
  { desc: 'Capacitación en poda de formación', obs: 'Beneficiario aplica técnicas aprendidas', rec: 'Realizar próxima poda en 3 meses' },
  { desc: 'Asistencia técnica en control fitosanitario', obs: 'Se detectó incidencia leve de monilia', rec: 'Aplicar caldo bordelés cada 15 días' },
  { desc: 'Evaluación de sombrío temporal', obs: 'El sombrío está establecido correctamente', rec: 'Mantener densidad de 50%' },
  { desc: 'Caracterización de parcela', obs: 'Parcela con potencial productivo alto', rec: 'Realizar análisis de suelo' },
  { desc: 'Fertilización y abonamiento', obs: 'Suelo con deficiencia de potasio', rec: 'Aplicar fertilizante rico en K cada 2 meses' },
  { desc: 'Taller de fermentación de cacao', obs: 'Beneficiarios mostraron interés en el proceso', rec: 'Realizar práctica supervisada en próxima visita' },
  { desc: 'Monitoreo de plagas y enfermedades', obs: 'No se detectaron plagas de importancia económica', rec: 'Continuar monitoreo semanal' },
  { desc: 'Instalación de vivero', obs: 'Se germinaron 500 plantas de cacao', rec: 'Riego constante y control de malezas' },
  { desc: 'Evaluación post-cosecha', obs: 'Cosecha de 15 kg de cacao seco', rec: 'Mejorar proceso de secado al sol' },
  { desc: 'Manejo de sombrío permanente', obs: 'Árboles de sombrío en buen estado', rec: 'Podar ramas bajas' },
  { desc: 'Control de arvenses', obs: 'Presencia media de arvenses en la parcela', rec: 'Realizar plateo alrededor de cada planta' },
  { desc: 'Renovación de plantas improductivas', obs: '30% de plantas mayores a 8 años', rec: 'Resiembra con clones mejorados' },
  { desc: 'Sistema de riego por goteo', obs: 'Riego funcionando correctamente', rec: 'Mantener horario de riego cada 3 días' },
  { desc: ' Buenas prácticas agrícolas', obs: 'Beneficiario aplica BPA básicas', rec: 'Implementar registro de actividades' },
];

// Login con supervisor para obtener token
function login() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ usuario: 'supervisor1', contrasena: '123456' });
    const req = http.request({
      hostname: '192.168.80.20',
      port: 8089,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.success) resolve(json.token);
          else reject(new Error(json.error));
        } catch (e) {
          reject(new Error('Error parseando login: ' + body.substring(0, 100)));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function guardarFormulario(token, form) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(form);
    const req = http.request({
      hostname: '192.168.80.20',
      port: 8089,
      path: '/api/formularios/guardar',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Error parseando: ' + body.substring(0, 100)));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('🔑 Obteniendo token...');
  const token = await login();
  console.log('✅ Token obtenido\n');

  let count = 0;
  // 3 formularios por técnico = 30 formularios
  for (let t = 0; t < TECNICOS.length; t++) {
    const tec = TECNICOS[t];
    // Cada técnico visita 3 beneficiarios distintos
    const benefIndex = (t * 3) % BENEFICIARIOS.length;
    for (let i = 0; i < 3; i++) {
      const benef = BENEFICIARIOS[(benefIndex + i) % BENEFICIARIOS.length];
      const act = ACTIVIDADES[(count + i) % ACTIVIDADES.length];
      const tipo = i === 0 ? 'caracterizacion' : 'visita_tecnica';
      const diasAtras = Math.floor(Math.random() * 60); // hasta 2 meses atrás
      const fecha = new Date(Date.now() - diasAtras * 86400000);

      const form = {
        id: `seed-${String(count + 1).padStart(3, '0')}`,
        tipo,
        tecnico: {
          nombre: tec.nombre,
          cedula: tec.cedula,
          telefono: tec.telefono,
          email: `${tec.usuario}@geodaily.app`,
        },
        beneficiario: {
          nombre: benef.nombre,
          cedula: benef.cedula,
          telefono: benef.telefono,
          departamento: 'Caquetá',
          municipio: 'Puerto Rico',
          vereda: benef.vereda,
          finca: benef.finca,
        },
        actividad: {
          descripcion: act.desc,
          observaciones: act.obs,
          recomendaciones: act.rec,
        },
        coordenadas: {
          latitud: 1.5 + Math.random() * 0.5,
          longitud: -75.2 + Math.random() * 0.3,
          altitud: 300 + Math.random() * 200,
          precision_gps: 5 + Math.random() * 10,
          timestamp: fecha.toISOString(),
        },
        fotos: [],
        firma_beneficiario: '',
        firma_tecnico: '',
        huella_beneficiario: Math.random() > 0.3,
        sincronizado: true,
        created_at: fecha.toISOString(),
        updated_at: fecha.toISOString(),
      };

      try {
        const res = await guardarFormulario(token, form);
        if (res.estado === 'ok') {
          count++;
          console.log(`  ✅ [${count}/30] ${tec.nombre.split(' ')[0]} → ${benef.nombre.split(' ')[0]} (${tipo})`);
        } else {
          console.log(`  ❌ ${res.mensaje || 'Error'}`);
        }
      } catch (err) {
        console.log(`  ❌ Error: ${err.message}`);
      }
    }
  }

  console.log(`\n📊 Total: ${count} formularios creados`);
}

main().catch(console.error);
