// ============================================================
// GENERAR 30 FORMULARIOS DE PRUEBA POR TÉCNICO
// ============================================================
// Uso: node scripts/generar-30-pruebas-por-tecnico.js
// ============================================================
// Crea 330 formularios (30 × 11 técnicos) con datos realistas:
//   - Coordenadas reales de Puerto Rico, Caquetá
//   - Beneficiarios del padrón CSV distribuidos equitativamente
//   - Tipos: 50% caracterización, 50% visita_técnica
//   - Fechas distribuidas entre marzo y julio 2026
//   - Actividades, clima, georreferencia completos
// ============================================================

const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DB || 'geodaily',
  user: process.env.PG_USER || 'geodaily_admin',
  password: process.env.PG_PASSWORD || 'GeoDaily2026_S3gura!',
});

// ============================================================
// COORDENADAS REALES — Puerto Rico, Caquetá
// ============================================================
// Centro aproximado: 1.9144°N, -75.1467°W
// Cada vereda tiene un punto de referencia + variación aleatoria
const VEREDA_COORDS = {
  'Aguila 1':             { lat: 1.9180, lng: -75.1380 },
  'Brillante Bajo':       { lat: 1.9110, lng: -75.1420 },
  'El Libano Alto':       { lat: 1.9250, lng: -75.1550 },
  'El Porvenir':          { lat: 1.9080, lng: -75.1480 },
  'Monte Bello':          { lat: 1.9220, lng: -75.1350 },
  'Monterrey':            { lat: 1.9150, lng: -75.1300 },
  'Villa Nueva':          { lat: 1.9280, lng: -75.1450 },
  'Alto Riecito':         { lat: 1.9050, lng: -75.1600 },
  'Retorno':              { lat: 1.9300, lng: -75.1400 },
  'La Nutria':            { lat: 1.9200, lng: -75.1700 },
  'Villa Martha':         { lat: 1.9350, lng: -75.1250 },
  'La Floresta No 5':     { lat: 1.9100, lng: -75.1200 },
  'La Victoria':          { lat: 1.9400, lng: -75.1150 },
  'Blanca Nieves':        { lat: 1.9000, lng: -75.1000 },
  'Caimancito Medio Jordan': { lat: 1.8950, lng: -75.1650 },
  'La Florida Cimitarra': { lat: 1.8880, lng: -75.1550 },
  'Palestina 2':          { lat: 1.9020, lng: -75.1750 },
  'Arenoso Oriente':      { lat: 1.8700, lng: -75.2000 },
  'San Marcos':           { lat: 1.8600, lng: -75.2100 },
  'Siberia Alta':         { lat: 1.8800, lng: -75.1900 },
  'Siberia Baja':         { lat: 1.8750, lng: -75.1950 },
  'El Lobo':              { lat: 1.8500, lng: -75.2200 },
  'La Aurora del Guayas': { lat: 1.8400, lng: -75.2300 },
  'La Independencia':     { lat: 1.8650, lng: -75.2150 },
  'Lindanay':             { lat: 1.8550, lng: -75.2250 },
  'Lobo No 2':            { lat: 1.8450, lng: -75.2350 },
  'Costa Rica Alta':      { lat: 1.8300, lng: -75.2400 },
  'Costa Rica Baja':      { lat: 1.8250, lng: -75.2450 },
  'Brisas de la Cristalina': { lat: 1.9500, lng: -75.1800 },
  'El Nutrio':            { lat: 1.9450, lng: -75.1900 },
  'Yarumal Bajo':         { lat: 1.9600, lng: -75.1850 },
  'Yarumal Medio':        { lat: 1.9550, lng: -75.1750 },
};

// ============================================================
// ACTIVIDADES POSIBLES
// ============================================================
const ACTIVIDADES = [
  { descripcion: 'Visita de seguimiento', desc_detallada: 'Se realizó visita de seguimiento al cultivo de cacao, evaluando el estado fitosanitario y desarrollo de las plantas.' },
  { descripcion: 'Capacitación técnica', desc_detallada: 'Se impartió capacitación sobre buenas prácticas agrícolas, manejo integrado de plagas y fertilización orgánica.' },
  { descripcion: 'Evaluación de plantación', desc_detallada: 'Se evaluó el estado de la plantación de cacao, midiendo altura, diámetro y número de mazorcas por árbol.' },
  { descripcion: 'Control fitosanitario', desc_detallada: 'Se aplicó control fitosanitario para monohilia y escoba de bruja, con recomendaciones de poda sanitaria.' },
  { descripcion: 'Toma de muestras de suelo', desc_detallada: 'Se tomaron muestras de suelo para análisis de fertilidad, siguiendo el protocolo de muestreo en zigzag.' },
  { descripcion: 'Poda y mantenimiento', desc_detallada: 'Se realizó poda de formación y mantenimiento en plantas de cacao, eliminando chupones y ramas improductivas.' },
  { descripcion: 'Fertilización', desc_detallada: 'Se aplicó fertilizante orgánico tipo bocashi y compost, con dosis recomendada según análisis de suelo.' },
  { descripcion: 'Instalación de sistema de riego', desc_detallada: 'Se instaló sistema de riego por goteo en 1/4 de hectárea, con tanque de 1000 litros y tubería de 16mm.' },
  { descripcion: 'Cosecha', desc_detallada: 'Se realizó cosecha selectiva de mazorcas maduras, con registro de peso y conteo por árbol.' },
];

const OBSERVACIONES = [
  'El productor muestra interés en mejorar su cultivo. Se recomienda continuar con las visitas técnicas.',
  'Se observa buena densidad de siembra. Requiere fertilización adicional en el próximo ciclo.',
  'La plantación presenta buen desarrollo vegetativo. Continuar con el plan de manejo establecido.',
  'Se detectó incidencia de monilia en algunas mazorcas. Aplicar control preventivo cada 15 días.',
  'El productor ha implementado las recomendaciones de la visita anterior. Buen avance.',
  'Suelo con pH ácido (5.2). Se recomienda encalado con 2 ton/ha de cal dolomita.',
  'Plantación con sombrío temporal de plátano bien establecido. Iniciar regulación de sombra.',
  'Requiere renovación de plantas improductivas mayores de 8 años. Se programó resiembra.',
  'Se entregó material vegetal de cacao clonado (ICS-95, CCN-51) para renovación de 0.5 ha.',
];

const RECOMENDACIONES = [
  'Aplicar fertilizante rico en potasio (KCl) en próxima visita. Realizar poda sanitaria.',
  'Mantener la cobertura vegetal del suelo con leguminosas. Controlar arvenses manualmente.',
  'Realizar análisis de suelo semestral. Mantener el plan de fertilización orgánica.',
  'Establecer barreras vivas para conservación de suelos. Sembrar árboles en linderos.',
  'Implementar sistema de captación de agua lluvia para riego de verano.',
  'Asociar cultivos de maíz y fríjol en callejones para diversificar ingresos.',
  'Registrar en formato de producción semanal el peso de mazorcas y grano seco.',
  'Participar en las próximas capacitaciones programadas por la UMATA municipal.',
];

// ============================================================
// HELPERS
// ============================================================
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];

/** Genera coordenadas aleatorias cercanas a la vereda */
function generarCoordenadas(vereda) {
  const base = VEREDA_COORDS[vereda] || { lat: 1.9144, lng: -75.1467 };
  return {
    latitud: base.lat + rand(-0.003, 0.003),
    longitud: base.lng + rand(-0.003, 0.003),
    altitud: rand(250, 450),
    precision_gps: rand(3, 12),
    heading: rand(0, 360),
    timestamp: new Date().toISOString(),
    lugar: `Puerto Rico, Caquetá`,
  };
}

function generarGeoreferencia(coords) {
  return {
    coordenadas: coords,
    huso_utm: 18,
    banda_utm: 'N',
    codigo_mgrs: '18NVK',
    zona_horaria: 'America/Bogota',
    pais: 'Colombia',
  };
}

function generarClima() {
  return {
    fuente: 'Open-Meteo',
    timestamp: new Date().toISOString(),
    ubicacion: { latitud: 1.9144, longitud: -75.1467, nombre: 'Puerto Rico, Caquetá' },
    temperatura: {
      actual: rand(24, 32),
      sensacion_termica: rand(26, 34),
      minima: rand(20, 24),
      maxima: rand(30, 34),
    },
    humedad: rand(65, 90),
    presion: rand(1008, 1015),
    viento: { velocidad: rand(3, 15), direccion_grados: rand(0, 360) },
    nubosidad: rand(30, 85),
    visibilidad: rand(8000, 16000),
    clima: pick(['Despejado', 'Parcialmente nublado', 'Nublado', 'Lluvia ligera']),
    icono: pick(['01d', '02d', '03d', '04d', '10d']),
  };
}

/** Genera un id UUID único */
function generarId() {
  return randomUUID().split('-').join('').substring(0, 20) + Date.now().toString(36);
}

/** Crea el objeto tecnico para el JSON */
function crearTecnicoJson(tecnico) {
  return {
    usuario_id: tecnico.id,
    nombre: tecnico.nombre,
    cedula: tecnico.cedula || '',
    telefono: '',
    email: `${tecnico.usuario}@geodaily.app`,
  };
}

/** Crea el objeto beneficiario para el JSON */
function crearBeneficiarioJson(benef) {
  return {
    nombre: benef.nombre,
    cedula: Object.keys(benef)[0],
    telefono: '',
    departamento: 'Caquetá',
    municipio: 'Puerto Rico',
    vereda: benef.vereda,
    finca: `Finca ${benef.nombre.split(' ')[0]}`,
    edad: String(randInt(25, 75)),
    sexo: pick(['masculino', 'femenino']),
    corregimiento: benef.corregimiento,
  };
}

/** Crea actividad para el JSON */
function crearActividadJson() {
  const act = pick(ACTIVIDADES);
  return {
    descripcion: act.descripcion,
    descripcion_detallada: act.desc_detallada,
    observaciones: pick(OBSERVACIONES),
    recomendaciones: pick(RECOMENDACIONES),
  };
}

/** Crea sociodemográfico para caracterización */
function crearSociodemografico() {
  return {
    nivel_educativo: pick(['Ninguno', 'Primaria', 'Secundaria', 'Técnico']),
    personas_nucleo: pick(['1 a 3 personas', '4 a 6 personas', '7 a 9 personas']),
    fuente_ingresos: pick(['Agricultura', 'Ganadería', 'Comercio', 'Empleo formal']),
    servicios_publicos: pick(['Todos los servicios', 'Algunos servicios']),
    mano_obra: pick(['Familiar', 'Mixta']),
    actividad_productiva: 'Cacao',
    procesos_erosion: pick(['Leve', 'Moderada', 'No presenta']),
    fuentes_hidricas: pick(['Quebrada', 'Río', 'Ninguna']),
    practicas_conservacion: pick(['Barreras vivas', 'Cobertura vegetal', 'Ninguna']),
    areas_conservacion: pick(['Bosque intervenido', 'Rastrojo maduro', 'Regeneración natural']),
    manejo_residuos: pick(['Triple lavado y disposición adecuada', 'Los almacena']),
    textura_suelo: pick(['Franco', 'Arcilloso', 'Franco arcilloso']),
    color_suelo: pick(['Negro', 'Café oscuro', 'Café claro']),
    drenaje: pick(['Bueno', 'Regular']),
    profundidad: pick(['Entre 20 y 50 cm', 'Entre 50 y 100 cm', 'Mayor de 100 cm']),
    presencia_piedras: pick(['Baja', 'Media', 'No presenta']),
    compactacion: pick(['Baja compactación', 'Sin evidencia de compactación']),
    cobertura_suelo: pick(['Cobertura herbácea o pastos', 'Cobertura arbórea o arbustiva', 'Rastrojos o residuos vegetales']),
    evidencia_erosion: pick(['Leve', 'No presenta']),
  };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('🔍 Cargando datos...');

  // 1. Obtener técnicos
  const tecnicos = (await pool.query(
    "SELECT id, usuario, nombre, cedula FROM usuarios WHERE rol = 'tecnico' ORDER BY id"
  )).rows;
  console.log(`✅ ${tecnicos.length} técnicos encontrados`);

  // 2. Cargar beneficiarios del padron (desde el archivo TS)
  const fs = require('fs');
  const padronPath = '../src/data/padronBeneficiarios.ts';
  let padronContent = fs.readFileSync(padronPath, 'utf8');
  // Extraer todas las entradas usando regex
  const beneficiarios = [];
  const entryRegex = /'(\d+)':\s*\{[^}]*nombre:\s*'([^']*)'[^}]*vereda:\s*'([^']*)'[^}]*corregimiento:\s*'([^']*)'\s*\},/g;
  let match;
  while ((match = entryRegex.exec(padronContent)) !== null) {
    beneficiarios.push({
      cedula: match[1],
      nombre: match[2],
      vereda: match[3],
      corregimiento: match[4],
    });
  }
  console.log(`✅ ${beneficiarios.length} beneficiarios cargados del padrón`);

  if (beneficiarios.length === 0) {
    console.error('❌ No se pudieron cargar beneficiarios');
    process.exit(1);
  }

  // 3. Distribuir beneficiarios entre técnicos (round-robin)
  const tecnicosBeneficiarios = {};
  tecnicos.forEach((t, i) => {
    tecnicosBeneficiarios[t.id] = [];
  });
  beneficiarios.forEach((b, i) => {
    const tecId = tecnicos[i % tecnicos.length].id;
    tecnicosBeneficiarios[tecId].push(b);
  });

  // 4. Generar formularios
  const totalPorTecnico = 30;
  let totalCreados = 0;
  let totalErrores = 0;
  const BATCH_SIZE = 20; // inserts por lote

  console.log(`\n📝 Generando ${totalPorTecnico} formularios por cada uno de ${tecnicos.length} técnicos...`);

  for (const tecnico of tecnicos) {
    const tecBenefs = tecnicosBeneficiarios[tecnico.id];
    console.log(`\n👤 ${tecnico.nombre} (${tecnico.id}) — ${tecBenefs.length} beneficiarios asignados`);

    const forms = [];
    for (let i = 0; i < totalPorTecnico; i++) {
      const benef = tecBenefs[i % tecBenefs.length];
      // Distribución: 15 caracterización, 12 visita, 3 capacitación
      let tipo;
      let esCaracterizacion = false;
      if (i < 15) {
        tipo = 'caracterizacion';
        esCaracterizacion = true;
      } else if (i < 27) {
        tipo = 'visita';
      } else {
        tipo = 'capacitacion';
      }
      const coords = generarCoordenadas(benef.vereda);
      const fecha = new Date('2026-03-01');
      fecha.setDate(fecha.getDate() + randInt(0, 140)); // ~marzo a julio
      fecha.setHours(randInt(7, 16), randInt(0, 59), 0, 0);

      const form = {
        id: generarId(),
        tipo,
        usuario_id: tecnico.id,
        tecnico_json: JSON.stringify(crearTecnicoJson(tecnico)),
        beneficiario_json: JSON.stringify(crearBeneficiarioJson(benef)),
        actividad_json: JSON.stringify(crearActividadJson()),
        sociodemografico_json: esCaracterizacion ? JSON.stringify(crearSociodemografico()) : null,
        caracterizacion_nueva_json: null,
        coordenadas_json: JSON.stringify(coords),
        georeferencia_json: JSON.stringify(generarGeoreferencia(coords)),
        clima_json: JSON.stringify(generarClima()),
        fotos_json: JSON.stringify([]),
        firma_beneficiario: '',
        firma_tecnico: '',
        huella_beneficiario: Math.random() > 0.3,
        pdf_url: null,
        sincronizado: true,
        created_at: fecha.toISOString(),
      };
      forms.push(form);
    }

    // Insertar en lotes
    for (let batch = 0; batch < forms.length; batch += BATCH_SIZE) {
      const lote = forms.slice(batch, batch + BATCH_SIZE);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const f of lote) {
        values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9}, $${paramIdx+10}, $${paramIdx+11}, $${paramIdx+12}, $${paramIdx+13}, $${paramIdx+14}, $${paramIdx+15}, $${paramIdx+16}, $${paramIdx+17})`);
        params.push(
          f.id, f.tipo, f.usuario_id,
          f.tecnico_json, f.beneficiario_json, f.actividad_json,
          f.sociodemografico_json, f.caracterizacion_nueva_json,
          f.coordenadas_json, f.georeferencia_json, f.clima_json,
          f.fotos_json, f.firma_beneficiario, f.firma_tecnico,
          f.huella_beneficiario, f.pdf_url, true, f.created_at
        );
        paramIdx += 18;
      }

      const sql = `INSERT INTO formularios
        (id, tipo, usuario_id, tecnico_json,
         beneficiario_json, actividad_json,
         sociodemografico_json, caracterizacion_nueva_json,
         coordenadas_json, georeferencia_json, clima_json,
         fotos_json, firma_beneficiario, firma_tecnico,
         huella_beneficiario, pdf_url, sincronizado, created_at)
        VALUES ${values.join(', ')}
        ON CONFLICT (id) DO NOTHING`;

      try {
        const result = await pool.query(sql, params);
        totalCreados += result.rowCount || 0;
        process.stdout.write(`  ✓ Lote ${batch/BATCH_SIZE + 1}: ${result.rowCount || 0} insertados\r`);
      } catch (err) {
        totalErrores += lote.length;
        console.error(`  ✗ Error en lote ${batch/BATCH_SIZE + 1}: ${err.message.substring(0, 100)}`);
      }
    }
    console.log(`  ✓ Total: ${totalPorTecnico} formularios para ${tecnico.nombre}`);
  }

  console.log(`\n========================================`);
  console.log(`📊 RESUMEN FINAL`);
  console.log(`========================================`);
  console.log(`   Técnicos:         ${tecnicos.length}`);
  console.log(`   Formularios creados: ${totalCreados}`);
  console.log(`   Beneficiarios:    ${beneficiarios.length}`);
  console.log(`   Errores:          ${totalErrores}`);
  console.log(`========================================`);

  await pool.end();
}

main().catch(err => {
  console.error('❌ Error general:', err);
  process.exit(1);
});
