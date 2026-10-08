// ============================================================
// GEODAILY — Servicio de Base de Datos de Beneficiarios
// ============================================================

import { getDbSafe } from './database';
import { BeneficiarioDB, BeneficiarioPayload } from '../types';
import apiClient from './api';
import { API_CONFIG } from '../theme';

// ============================================================
// ARQUITECTURA: el servidor (PostgreSQL) es la fuente de verdad
// compartida entre todos los dispositivos. La SQLite local es un
// ESPEJO para lectura rápida y trabajo offline del técnico.
// - Lecturas: siempre desde el espejo local.
// - Mutaciones (asignar/crear/eliminar): contra la API; si la API
//   acepta, se refleja en el espejo local. Sin conexión, fallan con
//   un mensaje claro (estas operaciones las hacen roles de oficina).
// - sincronizarBeneficiariosDesdeServidor(): refresca el espejo.
// ============================================================

/**
 * Obtiene la conexión SQLite compartida desde database.ts
 * con reconexión automática si la conexión se perdió.
 */
const ensureDb = async () => {
  return getDbSafe();
};

/** Error de red → mensaje accionable para quien está usando la pantalla. */
const errorLegible = (error: any, accion: string): Error => {
  const status = error?.response?.status;
  const mensajeServidor = error?.response?.data?.mensaje;
  if (status && mensajeServidor) {
    return new Error(mensajeServidor);
  }
  return new Error(
    `No se pudo ${accion}: se requiere conexión con el servidor. Verifica tu internet e inténtalo de nuevo.`
  );
};

/**
 * Descargar la base de beneficiarios del servidor y reemplazar el espejo
 * local. Devuelve true si sincronizó, false si no hubo conexión (el espejo
 * local anterior se conserva para trabajo offline).
 */
export const sincronizarBeneficiariosDesdeServidor = async (): Promise<boolean> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.BENEFICIARIOS);
    const beneficiarios: any[] = response.data?.beneficiarios;
    if (!Array.isArray(beneficiarios)) return false;

    const database = await ensureDb();
    if (!database) return false;

    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM beneficiarios');
      for (const b of beneficiarios) {
        await database.runAsync(
          `INSERT INTO beneficiarios (item, corregimiento, vereda, nombre_completo, cedula, tecnico_asignado_id, tecnico_asignado_nombre, departamento, municipio, telefono, nombre_predio, area_predio, latitud, longitud, correo_electronico, calidad_predio, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            b.item,
            b.corregimiento,
            b.vereda,
            b.nombre_completo,
            b.cedula,
            b.tecnico_asignado_id || null,
            b.tecnico_asignado_nombre || null,
            b.departamento || null,
            b.municipio || null,
            b.telefono || null,
            b.nombre_predio || null,
            b.area_predio ?? null,
            b.latitud ?? null,
            b.longitud ?? null,
            b.correo_electronico || null,
            b.calidad_predio || null,
            b.created_at || new Date().toISOString(),
            b.updated_at || new Date().toISOString(),
          ]
        );
      }
    });

    console.log(`[BeneficiariosDB] Espejo local sincronizado: ${beneficiarios.length} beneficiarios`);
    return true;
  } catch (error: any) {
    console.warn('[BeneficiariosDB] Sin conexión para sincronizar (se usa el espejo local):', error?.message);
    return false;
  }
};

/**
 * Traer el padrón de beneficiarios directamente del servidor, sin pasar
 * por el espejo SQLite. A diferencia de `sincronizarBeneficiariosDesdeServidor`
 * + `getBeneficiarios()`, esto funciona también en web (expo-sqlite no
 * corre ahí — ver database.ts) porque no toca la base local en ningún punto.
 * Se usa para estadísticas que necesitan la asignación técnico↔beneficiario
 * VIGENTE (tecnico_asignado_id), no el espejo offline.
 */
export const fetchBeneficiariosDelServidor = async (): Promise<BeneficiarioDB[]> => {
  try {
    const response = await apiClient.get(API_CONFIG.ENDPOINTS.BENEFICIARIOS);
    const beneficiarios = response.data?.beneficiarios;
    return Array.isArray(beneficiarios) ? beneficiarios : [];
  } catch (error: any) {
    console.warn('[BeneficiariosDB] No se pudo obtener el padrón del servidor:', error?.message);
    return [];
  }
};

// ============================================================
// SEED — exactamente los 300 beneficiarios de
// Base_de_datos_beneficiarios/300 beneficiarios final.csv (los 31 que no
// estaban en ese CSV se eliminaron; Jose Daniel Hurtado, item 34 con cédula
// desactualizada, se fusionó con su registro verificado, item 301). El
// item 77, registro de pruebas, se deja fuera del seed. Los 2 formularios
// ya diligenciados a nombre de beneficiarios que salieron de la base
// (antiguos items 22 y 39) NO se tocaron: formularios guarda su propia
// copia de los datos del beneficiario y no depende de esta tabla.
// ============================================================

/**
 * Exportado (no solo usado internamente) porque es la única fuente confiable
 * en el código de la asociación vereda → corregimiento real del municipio;
 * el Dashboard de supervisión (utils/corregimientos.ts) la reutiliza para
 * resolver el corregimiento de un formulario cuando este no lo trae explícito.
 */
export const SEED_DATA: Omit<BeneficiarioDB, 'tecnico_asignado_id' | 'tecnico_asignado_nombre' | 'created_at' | 'updated_at'>[] = [
  { item: 2, corregimiento: 'LA AGUILILLA', vereda: 'Brillante Bajo', nombre_completo: 'Nolbeiro Caviedes Martinez', cedula: '1115942322' },
  { item: 3, corregimiento: 'LA AGUILILLA', vereda: 'Brillante Bajo', nombre_completo: 'Elicenia Rengifo Martinez', cedula: '1059354244' },
  { item: 4, corregimiento: 'LA AGUILILLA', vereda: 'Brillante Bajo', nombre_completo: 'Aldemar Gualy Arias', cedula: '96359978' },
  { item: 5, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Edwin Arturo Sanchez Gaviria', cedula: '1115947968' },
  { item: 6, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Jesus Elias Gomez Carmona', cedula: '17665994' },
  { item: 7, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Rulberto Yanguma', cedula: '96361394' },
  { item: 8, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Maria Maricel Yanguma', cedula: '26623720' },
  { item: 9, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Eidy Julied Hernandez Montealegre', cedula: '1115949073' },
  { item: 11, corregimiento: 'LA AGUILILLA', vereda: 'Montebello', nombre_completo: 'Yeferson David Nieto Quiceno', cedula: '1115947889' },
  { item: 13, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Rogelio Avilez Rico', cedula: '96362086' },
  { item: 14, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Abercio Cerquera Losada', cedula: '17666541' },
  { item: 15, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Gonzalo Garcia Muñoz', cedula: '17788800' },
  { item: 16, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Gustavo Urriago Gasca', cedula: '1115945725' },
  { item: 17, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Edubiel Villegas', cedula: '1115946162' },
  { item: 18, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Lucelida Martinez Uribe', cedula: '1115945923' },
  { item: 19, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Dilia Saavedra', cedula: '55199769' },
  { item: 21, corregimiento: 'LUSITANIA', vereda: 'Caimancito Medio Jordan', nombre_completo: 'Jefferson Fabian Escobar Losada', cedula: '1115948632' },
  { item: 23, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Jose Guaza Sandoval', cedula: '76289094' },
  { item: 24, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Fabio Ordoñez Ordoñez', cedula: '6298635' },
  { item: 25, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Edgar Calderon Sanchez', cedula: '1115940037' },
  { item: 26, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Alcides Guaza Dias', cedula: '96353924' },
  { item: 28, corregimiento: 'RIO NEGRO', vereda: 'La Aurora Del Guayas', nombre_completo: 'Hermes Marroquin Donta', cedula: '12111164' },
  { item: 29, corregimiento: 'RIO NEGRO', vereda: 'La Aurora Del Guayas', nombre_completo: 'Crisanto Cuellar Forero', cedula: '17788925' },
  { item: 30, corregimiento: 'RIO NEGRO', vereda: 'La Aurora Del Guayas', nombre_completo: 'Jowanny Tafur Rodriguez', cedula: '5976174' },
  { item: 33, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Delio Diaz Cortes', cedula: '17699930' },
  { item: 35, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Astul Guaza Alvaran', cedula: '16825070' },
  { item: 36, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Sisto Guaza Caracas', cedula: '96353923' },
  { item: 40, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Aldemar Calderon Castellanos', cedula: '96351929' },
  { item: 41, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Jose Antonio Noreña Caviedes', cedula: '96351814' },
  { item: 42, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Floresmiro Julicue', cedula: '10478401' },
  { item: 43, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Luis Fernando Cortes', cedula: '96351205' },
  { item: 44, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Ivan Salinas Rojas', cedula: '17701440' },
  { item: 46, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Yorty Durney Leon Ramirez', cedula: '17788310' },
  { item: 47, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Arcesio Navia Rivera', cedula: '17620219' },
  { item: 51, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Diego Pabon Castañeda', cedula: '17701524' },
  { item: 56, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Olmeiro Cobaleda Ramirez', cedula: '96351095' },
  { item: 57, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Jesus Maria Perez Giraldo', cedula: '1116919040' },
  { item: 58, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Uber De Jesus Perez Giraldo', cedula: '17711294' },
  { item: 60, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Alirio Lizcano Tovar', cedula: '16828450' },
  { item: 61, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Luis Enrique Torres', cedula: '17668189' },
  { item: 64, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Euder Navia Aley', cedula: '17651393' },
  { item: 68, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Evangelista Padilla Guasaquillo', cedula: '96353707' },
  { item: 70, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Magrli Velazco Suns', cedula: '36177547' },
  { item: 74, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Ismael Pinto Arias', cedula: '17671147' },
  { item: 78, corregimiento: 'LA AGUILILLA', vereda: 'Aguila 1', nombre_completo: 'Didier Erlanderson Narvaez', cedula: '1097730033' },
  { item: 79, corregimiento: 'LA AGUILILLA', vereda: 'Alto Riecito', nombre_completo: 'Abelardo Mora', cedula: '14212527' },
  { item: 80, corregimiento: 'LA AGUILILLA', vereda: 'Alto Riecito', nombre_completo: 'Eduardo Quintero Hernandez', cedula: '12123448' },
  { item: 81, corregimiento: 'LA AGUILILLA', vereda: 'Alto Riecito', nombre_completo: 'Luz Mirian Herrera Rojas', cedula: '40778488' },
  { item: 82, corregimiento: 'LA AGUILILLA', vereda: 'Alto Riecito', nombre_completo: 'Willian Guaza Mina', cedula: '96352111' },
  { item: 83, corregimiento: 'LA AGUILILLA', vereda: 'Alto Riecito', nombre_completo: 'Wilmer Arles Collazos Gomez', cedula: '17674635' },
  { item: 84, corregimiento: 'LA AGUILILLA', vereda: 'Alto Riecito', nombre_completo: 'Zuly Ayala Herrera', cedula: '1117518704' },
  { item: 85, corregimiento: 'LA AGUILILLA', vereda: 'El Desquite', nombre_completo: 'Alfonso Sanchez Cruz', cedula: '17702233' },
  { item: 86, corregimiento: 'LA AGUILILLA', vereda: 'El Desquite', nombre_completo: 'Sandra Patricia Apache Hernandez', cedula: '1115947076' },
  { item: 87, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Abelardo De Jesus Agudelo', cedula: '4667635' },
  { item: 88, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Dennis Tique Vargas', cedula: '51571908' },
  { item: 89, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Gloria Peñaloza Sanchez', cedula: '40776193' },
  { item: 90, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Luis Humberto Farfan', cedula: '96361201' },
  { item: 91, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Luz Elena Sarria Peña', cedula: '30519344' },
  { item: 92, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Maria Cristina Perdomo Gutierrez', cedula: '1006878482' },
  { item: 93, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Nelson Chala Vargas', cedula: '83234035' },
  { item: 94, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Rafael Antonio Gaviria Rodriguez', cedula: '17699130' },
  { item: 95, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Rubiela Zambrano Castro', cedula: '30515835' },
  { item: 96, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'William Alberto Alarcon Tique', cedula: '79792597' },
  { item: 97, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Edilson Sanchez Rodriguez', cedula: '1117813622' },
  { item: 98, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Efrain Molano', cedula: '14259984' },
  { item: 99, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Fanny Montealegre Ramírez', cedula: '40675032' },
  { item: 100, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Ferney Sanchez Salazar', cedula: '14297285' },
  { item: 101, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Henry Zambrano Barreto', cedula: '17709422' },
  { item: 102, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Jahir Rojas Quinaya', cedula: '96360036' },
  { item: 103, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Maria Lucrecia Gomez Tique', cedula: '30521227' },
  { item: 104, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Mayerly Calderon Loaiza', cedula: '1006528105' },
  { item: 105, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Nelcy Calderón Murcia', cedula: '40601502' },
  { item: 106, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Norbey Yanguma', cedula: '17788739' },
  { item: 107, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Orlando Rojas Suarez', cedula: '4883026' },
  { item: 108, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Paola Andrea Hernandez Zuñiga', cedula: '1117523482' },
  { item: 109, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Sergio Luis Tello Hernandez', cedula: '1006518550' },
  { item: 110, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Wilmer Pizo Diaz', cedula: '1117528608' },
  { item: 111, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Wilmer Quinaya Reyes', cedula: '96362136' },
  { item: 112, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Felix Antonio Mora Rodriguez', cedula: '12255657' },
  { item: 113, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Gamalier Chavarro Montiel', cedula: '1115941018' },
  { item: 114, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Monica Pinzon Ortiz', cedula: '1115943178' },
  { item: 115, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Ofelia Cano Lozada', cedula: '40625751' },
  { item: 116, corregimiento: 'LA AGUILILLA', vereda: 'El Retorno', nombre_completo: 'Santiago Bermudez Bermudez', cedula: '1116915394' },
  { item: 117, corregimiento: 'LA AGUILILLA', vereda: 'La Nutria', nombre_completo: 'Alfredo Morales Yatacue', cedula: '1006419915' },
  { item: 118, corregimiento: 'LA AGUILILLA', vereda: 'La Nutria', nombre_completo: 'Anderson Galeano Herrera', cedula: '1115951861' },
  { item: 119, corregimiento: 'LA AGUILILLA', vereda: 'La Nutria', nombre_completo: 'Daniel Orozco Hernandez', cedula: '96359721' },
  { item: 120, corregimiento: 'LA AGUILILLA', vereda: 'La Nutria', nombre_completo: 'Maria Consuelo Manchola Rojas', cedula: '26649278' },
  { item: 121, corregimiento: 'LA AGUILILLA', vereda: 'La Pedregosa', nombre_completo: 'Cesar Fernando Vasquez Montoya', cedula: '1117530256' },
  { item: 122, corregimiento: 'LA AGUILILLA', vereda: 'La Pedregosa', nombre_completo: 'Edilberto Garzon Garcia', cedula: '96360632' },
  { item: 123, corregimiento: 'LA AGUILILLA', vereda: 'La Pedregosa', nombre_completo: 'Evaristo Becerra Quiguasu', cedula: '17788698' },
  { item: 124, corregimiento: 'LA AGUILILLA', vereda: 'La Pedregosa', nombre_completo: 'Jeisson Rubiano Sierra', cedula: '1117826770' },
  { item: 125, corregimiento: 'LA AGUILILLA', vereda: 'La Pedregosa', nombre_completo: 'Oniel Rodriguez Arias', cedula: '17700503' },
  { item: 126, corregimiento: 'LA AGUILILLA', vereda: 'La Soledad', nombre_completo: 'Argeni Ortiz Valbuena', cedula: '30519690' },
  { item: 127, corregimiento: 'LA AGUILILLA', vereda: 'La Soledad', nombre_completo: 'Dario Sierra Castro', cedula: '17702434' },
  { item: 128, corregimiento: 'LA AGUILILLA', vereda: 'La Soledad', nombre_completo: 'Jhonattan Correa Capera', cedula: '1075243102' },
  { item: 129, corregimiento: 'LA AGUILILLA', vereda: 'La Soledad', nombre_completo: 'Jonny Lizcano Santofimio', cedula: '12340118' },
  { item: 130, corregimiento: 'LA AGUILILLA', vereda: 'La Soledad', nombre_completo: 'Juan Carlos Quijano Gomez', cedula: '1115948623' },
  { item: 131, corregimiento: 'LA AGUILILLA', vereda: 'La Soledad', nombre_completo: 'Maria Isabel Baron Montiel', cedula: '26649588' },
  { item: 132, corregimiento: 'LA AGUILILLA', vereda: 'La Soledad', nombre_completo: 'Martha Cecilia Sandoval Cardona', cedula: '40731595' },
  { item: 133, corregimiento: 'LA AGUILILLA', vereda: 'La Soledad', nombre_completo: 'Rodrigo Agredo', cedula: '10660683' },
  { item: 134, corregimiento: 'LA AGUILILLA', vereda: 'Las Iglesias', nombre_completo: 'Eduardo Perez Sanchez', cedula: '17634090' },
  { item: 135, corregimiento: 'LA AGUILILLA', vereda: 'Las Iglesias', nombre_completo: 'Johan Perez Villamil', cedula: '1006516641' },
  { item: 136, corregimiento: 'LA AGUILILLA', vereda: 'Montebello', nombre_completo: 'Gabriel Arias Hoyos', cedula: '12208568' },
  { item: 137, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Alexander Lopez Buitrago', cedula: '96360655' },
  { item: 138, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Claudia Lorena Arias Barragan', cedula: '48657723' },
  { item: 139, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Esneider Palma Lugo', cedula: '17788773' },
  { item: 140, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Hernan Zambrano Calderon', cedula: '17642453' },
  { item: 141, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Jorge Enrique Salazar Alzate', cedula: '96330966' },
  { item: 142, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Jose Whaldo Leal Ramirez', cedula: '79742358' },
  { item: 143, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Lenis Santiago Alvira Toledo', cedula: '96353328' },
  { item: 144, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Lilliana Valderrama Lima', cedula: '1123861780' },
  { item: 145, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Luz Delly Rojas', cedula: '30520626' },
  { item: 146, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Nelson Reyes Perdomo', cedula: '83086984' },
  { item: 147, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Noraldo Garcia Montilla', cedula: '1115940652' },
  { item: 148, corregimiento: 'LA AGUILILLA', vereda: 'Villanueva', nombre_completo: 'Emilse Ramirez Reinoso', cedula: '1117811378' },
  { item: 149, corregimiento: 'LA AGUILILLA', vereda: 'Villanueva', nombre_completo: 'Jhon Eleverth Criollo Ortiz', cedula: '1115948098' },
  { item: 150, corregimiento: 'LA ESMERALDA', vereda: 'Buena Vista', nombre_completo: 'Airso Betancourt Valbuena', cedula: '96353039' },
  { item: 151, corregimiento: 'LA ESMERALDA', vereda: 'Buena Vista', nombre_completo: 'Angelmiro Mur Vergara', cedula: '17668871' },
  { item: 152, corregimiento: 'LA ESMERALDA', vereda: 'Buena Vista', nombre_completo: 'Lina Marcela Betancourt Fuestes', cedula: '1117511548' },
  { item: 153, corregimiento: 'LA ESMERALDA', vereda: 'Buena Vista', nombre_completo: 'Ricardo Andrade Vasquez', cedula: '96356179' },
  { item: 154, corregimiento: 'LA ESMERALDA', vereda: 'Coconuco', nombre_completo: 'Hector Eduardo Diaz Gallego', cedula: '17702088' },
  { item: 155, corregimiento: 'LA ESMERALDA', vereda: 'Coconuco #2', nombre_completo: 'Silohe Alvarado Quintero', cedula: '17642468' },
  { item: 156, corregimiento: 'LA ESMERALDA', vereda: 'El Diamante', nombre_completo: 'Danilo Murcia Alvarez', cedula: '17748103' },
  { item: 157, corregimiento: 'LA ESMERALDA', vereda: 'El Diamante', nombre_completo: 'Flor Elcira Sanchez Moreno', cedula: '30516913' },
  { item: 158, corregimiento: 'LA ESMERALDA', vereda: 'El Diamante', nombre_completo: 'Porfirio Valencia Loaiza', cedula: '17702997' },
  { item: 159, corregimiento: 'LA ESMERALDA', vereda: 'El Plebeyo', nombre_completo: 'Cristina Ibarra Maya', cedula: '1120573619' },
  { item: 160, corregimiento: 'LA ESMERALDA', vereda: 'El Plebeyo', nombre_completo: 'Harold Yecid Reinoso Betancourt', cedula: '1193445103' },
  { item: 161, corregimiento: 'LA ESMERALDA', vereda: 'El Plebeyo', nombre_completo: 'Pedro Andrade Campos', cedula: '17700160' },
  { item: 162, corregimiento: 'LA ESMERALDA', vereda: 'El Plebeyo', nombre_completo: 'Diana Mileydi Jaramillo Fajardo', cedula: '1115949687' },
  { item: 163, corregimiento: 'LA ESMERALDA', vereda: 'El Plebeyo', nombre_completo: 'Erika Julieth Tumbo Ramirez', cedula: '1115951926' },
  { item: 164, corregimiento: 'LA ESMERALDA', vereda: 'El Plebeyo', nombre_completo: 'Ferley Reinoso Betancourt', cedula: '1006418363' },
  { item: 165, corregimiento: 'LA ESMERALDA', vereda: 'El Plebeyo', nombre_completo: 'Nohelis Morales Rondon', cedula: '1115948037' },
  { item: 166, corregimiento: 'LA ESMERALDA', vereda: 'El Sabalo', nombre_completo: 'Adiel Gutierrez Rondon', cedula: '1115946858' },
  { item: 167, corregimiento: 'LA ESMERALDA', vereda: 'El Sabalo', nombre_completo: 'Eliana Ospina Cuellar', cedula: '1115949629' },
  { item: 168, corregimiento: 'LA ESMERALDA', vereda: 'Etiopia', nombre_completo: 'Bernardo Arturo Hernandez Cerquera', cedula: '17646484' },
  { item: 169, corregimiento: 'LA ESMERALDA', vereda: 'Etiopia', nombre_completo: 'Francy Muñoz Agudelo', cedula: '1115945390' },
  { item: 170, corregimiento: 'LA ESMERALDA', vereda: 'La Argentina', nombre_completo: 'Jose De Jesus Yate Lasso', cedula: '17667087' },
  { item: 171, corregimiento: 'LA ESMERALDA', vereda: 'La Florida', nombre_completo: 'Estella Guzman Bocanegra', cedula: '30519924' },
  { item: 172, corregimiento: 'LA ESMERALDA', vereda: 'La Profunda', nombre_completo: 'Jose Arturo Muñeton Salazar', cedula: '96352575' },
  { item: 173, corregimiento: 'LA ESMERALDA', vereda: 'La Profunda', nombre_completo: 'Maria Liliana Reyes Ahumada', cedula: '1115943621' },
  { item: 174, corregimiento: 'LA ESMERALDA', vereda: 'La Profunda', nombre_completo: 'Orlando Hoyos Avilez', cedula: '17699979' },
  { item: 175, corregimiento: 'LA ESMERALDA', vereda: 'La Tigra', nombre_completo: 'Pedro Suarez Garzon', cedula: '17669552' },
  { item: 176, corregimiento: 'LA ESMERALDA', vereda: 'La Tigra', nombre_completo: 'Yerly Yamile Zuluaga Morales', cedula: '1117504149' },
  { item: 177, corregimiento: 'LA ESMERALDA', vereda: 'La Tigra', nombre_completo: 'Jairo Restrepo Rodriguez', cedula: '17667932' },
  { item: 178, corregimiento: 'LA ESMERALDA', vereda: 'Los Alpes', nombre_completo: 'Camilo Enrique Bonilla Ramos', cedula: '1116921355' },
  { item: 179, corregimiento: 'LA ESMERALDA', vereda: 'Topacio Alto', nombre_completo: 'Jose Ricaurte Navarrete Isaza', cedula: '96351555' },
  { item: 180, corregimiento: 'LA ESMERALDA', vereda: 'Topacio Alto', nombre_completo: 'Lider Jairo Navarrete Isaza', cedula: '17669778' },
  { item: 181, corregimiento: 'LA ESMERALDA', vereda: 'Topacio Alto', nombre_completo: 'Maria Esperanza Reyes Ahumada', cedula: '1116917885' },
  { item: 182, corregimiento: 'LA ESMERALDA', vereda: 'Topacio Alto', nombre_completo: 'Marta Cecilia Rivas Rodriguez', cedula: '40733215' },
  { item: 183, corregimiento: 'LA ESMERALDA', vereda: 'Topacio Bajo', nombre_completo: 'Luis Carlos Motato Motato', cedula: '10014806' },
  { item: 184, corregimiento: 'LA ESMERALDA', vereda: 'Topacio Bajo', nombre_completo: 'Angel Antonio Lozano Loaiza', cedula: '96353388' },
  { item: 185, corregimiento: 'LA ESMERALDA', vereda: 'Topacio Bajo', nombre_completo: 'Jaime Valencia Loaiza', cedula: '14190446' },
  { item: 186, corregimiento: 'LA ESMERALDA', vereda: 'Topacio Bajo', nombre_completo: 'Loreny Campos Rivera', cedula: '40076852' },
  { item: 187, corregimiento: 'LA ESMERALDA', vereda: 'Trocha B Nemal', nombre_completo: 'Jhon Edison Garzon Sierra', cedula: '96353560' },
  { item: 188, corregimiento: 'LA ESMERALDA', vereda: 'Trocha B Nemal', nombre_completo: 'Jose Sedeon Garzon Sierra', cedula: '96350936' },
  { item: 189, corregimiento: 'LA ESMERALDA', vereda: 'Trocha B Nemal', nombre_completo: 'Juan De La Cruz Saldaña Torres', cedula: '17723107' },
  { item: 190, corregimiento: 'LA ESMERALDA', vereda: 'Trocha B Nemal', nombre_completo: 'Oliver Ocampo Ramires', cedula: '1115940917' },
  { item: 191, corregimiento: 'LA ESMERALDA', vereda: 'Villa Martha', nombre_completo: 'Kelly Johanna Granja', cedula: '1115945333' },
  { item: 192, corregimiento: 'LA ESMERALDA', vereda: 'Villa Martha', nombre_completo: 'Orlando Rondon Ortiz', cedula: '96361024' },
  { item: 193, corregimiento: 'LA PAZ', vereda: 'Betania', nombre_completo: 'Derly Constanza Barrera Rojas', cedula: '30518748' },
  { item: 194, corregimiento: 'LA PAZ', vereda: 'Betania', nombre_completo: 'Edinson Alberto Rivas Sanchez', cedula: '1117824331' },
  { item: 195, corregimiento: 'LA PAZ', vereda: 'El Arenoso', nombre_completo: 'Henry Araque Cabrera', cedula: '96360447' },
  { item: 196, corregimiento: 'LA PAZ', vereda: 'El Carmelo', nombre_completo: 'Edinson Salinas Osuna', cedula: '1115950238' },
  { item: 197, corregimiento: 'LA PAZ', vereda: 'El Cuervo', nombre_completo: 'Aide Evao Pipicay', cedula: '1003786762' },
  { item: 198, corregimiento: 'LA PAZ', vereda: 'El Cuervo', nombre_completo: 'Alexander Florez', cedula: '17187702' },
  { item: 199, corregimiento: 'LA PAZ', vereda: 'El Cuervo', nombre_completo: 'Gloria Lucila Contreras Buitrago', cedula: '41780266' },
  { item: 200, corregimiento: 'LA PAZ', vereda: 'La Carmelita', nombre_completo: 'Hernando Antonio Serna Zuluaga', cedula: '19453585' },
  { item: 201, corregimiento: 'LA PAZ', vereda: 'La Carmelita', nombre_completo: 'Leidy Maritza Gallego Soto', cedula: '1014238612' },
  { item: 202, corregimiento: 'LA PAZ', vereda: 'La Carmelita', nombre_completo: 'Maria Fernanda Rada Villamarin', cedula: '55116074' },
  { item: 203, corregimiento: 'LA PAZ', vereda: 'La Carmelita', nombre_completo: 'Marlon Hernando Serna Loaiza', cedula: '17784423' },
  { item: 204, corregimiento: 'LA PAZ', vereda: 'La Cristalina', nombre_completo: 'Agustin Vega Restrepo', cedula: '96322403' },
  { item: 205, corregimiento: 'LA PAZ', vereda: 'La Estrella', nombre_completo: 'Raul Valencia Paya', cedula: '96359558' },
  { item: 206, corregimiento: 'LA PAZ', vereda: 'La Estrellita', nombre_completo: 'Elizabeth Corrales Garcia', cedula: '1004089299' },
  { item: 207, corregimiento: 'LA PAZ', vereda: 'La Estrellita', nombre_completo: 'Jose David Rodriguez Villanueva', cedula: '1006419856' },
  { item: 208, corregimiento: 'LA PAZ', vereda: 'La Floresta No. 5', nombre_completo: 'Cristhian Arles Ceballos Perdomo', cedula: '1115950350' },
  { item: 209, corregimiento: 'LA PAZ', vereda: 'La Floresta No. 5', nombre_completo: 'Dioselina Guzman Maya', cedula: '52695342' },
  { item: 210, corregimiento: 'LA PAZ', vereda: 'La Floresta No. 5', nombre_completo: 'Harold Alejandro Castaño Sanchez', cedula: '9862352' },
  { item: 211, corregimiento: 'LA PAZ', vereda: 'La Floresta No. 5', nombre_completo: 'Isaac Guzman Saavedra', cedula: '17702659' },
  { item: 212, corregimiento: 'LA PAZ', vereda: 'La Floresta No. 5', nombre_completo: 'Jesus Eliecer Parra Vargas', cedula: '17723025' },
  { item: 213, corregimiento: 'LA PAZ', vereda: 'La Floresta No. 5', nombre_completo: 'Juan Paulo Rodriguez Vivas', cedula: '1115953425' },
  { item: 214, corregimiento: 'LA PAZ', vereda: 'La Floresta No. 5', nombre_completo: 'Olga Patricia Rojas Florez', cedula: '52176150' },
  { item: 215, corregimiento: 'LA PAZ', vereda: 'La Floresta No. 5', nombre_completo: 'Rocio Hernandez', cedula: '1006517753' },
  { item: 216, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Adiel Molano Perdomo', cedula: '17788292' },
  { item: 217, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Alex Silva Peralta', cedula: '1115942079' },
  { item: 218, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Ana Beatriz Chaux Toledo', cedula: '40776590' },
  { item: 219, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Arcadio Jimenez Murcia', cedula: '96354655' },
  { item: 220, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Cesar Guasaquillo Ulcue', cedula: '96360690' },
  { item: 221, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Edgar Plazas Torres', cedula: '17650053' },
  { item: 222, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Ezequiel Gomez', cedula: '1059908596' },
  { item: 223, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Flor Alba Moreno Moreno', cedula: '30519858' },
  { item: 224, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Geylert Rico Embus', cedula: '1115946275' },
  { item: 225, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Henry Vargas Medina', cedula: '93421875' },
  { item: 226, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Jair Peralta Ortíz', cedula: '12257604' },
  { item: 227, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Jairo Biasus Barragán', cedula: '17702603' },
  { item: 228, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Jhonan Cárdenas García', cedula: '1143838924' },
  { item: 229, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'José Antonio Briñez Cortés', cedula: '96362205' },
  { item: 230, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'José Antonio Guasaquillo Ramos', cedula: '11350399' },
  { item: 231, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Juan Carlos Castilla Garzón', cedula: '1004156724' },
  { item: 232, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Libia Garzon', cedula: '55215868' },
  { item: 233, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Luz Esther Valderrama López', cedula: '55200604' },
  { item: 234, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Mayuri Rico Embus', cedula: '1115946276' },
  { item: 235, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Nancy Moreno Orjuela', cedula: '1026578793' },
  { item: 236, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Yan Carlos Sanchez Alba', cedula: '1116912068' },
  { item: 237, corregimiento: 'LA PAZ', vereda: 'La Victoria', nombre_completo: 'Dilverto Molano Motta', cedula: '17701235' },
  { item: 238, corregimiento: 'LA PAZ', vereda: 'Las Damas', nombre_completo: 'Santiago Puentes Alvarez', cedula: '96352791' },
  { item: 239, corregimiento: 'LA PAZ', vereda: 'Las Damas', nombre_completo: 'Yesica Fernanda Correa Trujillo', cedula: '1115950077' },
  { item: 240, corregimiento: 'LA PAZ', vereda: 'Montecristo', nombre_completo: 'Gabriel Antonio Medina Noguera', cedula: '17698758' },
  { item: 241, corregimiento: 'LA PAZ', vereda: 'Montecristo', nombre_completo: 'Jose Edervey Quiceno Guerrero', cedula: '17700128' },
  { item: 242, corregimiento: 'LA PAZ', vereda: 'Montecristo', nombre_completo: 'Jose Ovidio Lucumi Guaza', cedula: '6223116' },
  { item: 243, corregimiento: 'LA PAZ', vereda: 'Montecristo', nombre_completo: 'Luis Eduardo Montoya Lopes', cedula: '1112770484' },
  { item: 244, corregimiento: 'LA PAZ', vereda: 'Montecristo', nombre_completo: 'Maria Unires Moreno Escobar', cedula: '40726710' },
  { item: 245, corregimiento: 'LA PAZ', vereda: 'Nogales', nombre_completo: 'Cristian Andres Vargas Morales', cedula: '1006519946' },
  { item: 246, corregimiento: 'LA PAZ', vereda: 'Nogales', nombre_completo: 'Erica Yaneth Cifuentes Perez', cedula: '30505436' },
  { item: 247, corregimiento: 'LA PAZ', vereda: 'Nogales', nombre_completo: 'Jesus Maria Aguja', cedula: '5966287' },
  { item: 248, corregimiento: 'LUSITANIA', vereda: '12 De Octubre', nombre_completo: 'Josue Tafur Daza', cedula: '17774472' },
  { item: 249, corregimiento: 'LUSITANIA', vereda: 'El Cedral', nombre_completo: 'Celso Antonio Florez Useche', cedula: '4466326' },
  { item: 250, corregimiento: 'LUSITANIA', vereda: 'El Cedral', nombre_completo: 'Jaime Rodriguez Barragan', cedula: '6750389' },
  { item: 251, corregimiento: 'LUSITANIA', vereda: 'El Cedral', nombre_completo: 'Miller Fernando Florez Bonilla', cedula: '7827707' },
  { item: 252, corregimiento: 'LUSITANIA', vereda: 'El Danubio', nombre_completo: 'Jenny Ruth Marquez Romero', cedula: '66887055' },
  { item: 253, corregimiento: 'LUSITANIA', vereda: 'La Esperanza', nombre_completo: 'Vitelio Rodriguez Urriago', cedula: '17788791' },
  { item: 254, corregimiento: 'LUSITANIA', vereda: 'La Florida Cimitarra', nombre_completo: 'Miguel Antonio Arias Veru', cedula: '96359918' },
  { item: 255, corregimiento: 'LUSITANIA', vereda: 'La Parada', nombre_completo: 'Ana Maria Velasquez Sanchez', cedula: '34065366' },
  { item: 256, corregimiento: 'LUSITANIA', vereda: 'La Parada', nombre_completo: 'Barbara Montiel Alape', cedula: '26623466' },
  { item: 257, corregimiento: 'LUSITANIA', vereda: 'La Parada', nombre_completo: 'Julieta Rodriguez Arias', cedula: '30517763' },
  { item: 258, corregimiento: 'LUSITANIA', vereda: 'La Parada', nombre_completo: 'Maria Eva Cuellar Diaz', cedula: '40755974' },
  { item: 259, corregimiento: 'LUSITANIA', vereda: 'Miravalles', nombre_completo: 'Yadi Consuelo Mendez Guzman', cedula: '1115951170' },
  { item: 260, corregimiento: 'LUSITANIA', vereda: 'Palestina No. 2', nombre_completo: 'Durbay Quezada Cortez', cedula: '96360538' },
  { item: 261, corregimiento: 'LUSITANIA', vereda: 'Risaralda', nombre_completo: 'Erica Castañeda Cumbe', cedula: '26423707' },
  { item: 262, corregimiento: 'LUSITANIA', vereda: 'Risaralda', nombre_completo: 'Fanery Castillo Jaramillo', cedula: '30518821' },
  { item: 263, corregimiento: 'LUSITANIA', vereda: 'Risaralda', nombre_completo: 'Jorge Trujillo Vilalo', cedula: '96359426' },
  { item: 264, corregimiento: 'LUSITANIA', vereda: 'Risaralda', nombre_completo: 'Marina Veru Trujillo', cedula: '26643703' },
  { item: 265, corregimiento: 'LUSITANIA', vereda: 'Santa Elena', nombre_completo: 'Bernado Tobon Ibarra', cedula: '75157655' },
  { item: 266, corregimiento: 'LUSITANIA', vereda: 'Santa Elena', nombre_completo: 'Maria Del Carmen Calderon', cedula: '30520994' },
  { item: 267, corregimiento: 'LUSITANIA', vereda: 'Santa Elena', nombre_completo: 'Miled Andrea Perdomo Rivas', cedula: '1116919896' },
  { item: 268, corregimiento: 'LUSITANIA', vereda: 'Santa Elena', nombre_completo: 'Sandra Rocio Valencia Velasquez', cedula: '30520186' },
  { item: 269, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Angel Enrrique Salguero Cardenas', cedula: '17670376' },
  { item: 270, corregimiento: 'RIO NEGRO', vereda: 'Costa Rica Alta', nombre_completo: 'Jhonatan Trujillo Rivera', cedula: '1007431054' },
  { item: 271, corregimiento: 'RIO NEGRO', vereda: 'Costa Rica Alta', nombre_completo: 'Jose Alfredo Ortiz Mamian', cedula: '17711297' },
  { item: 272, corregimiento: 'RIO NEGRO', vereda: 'Costa Rica Alta', nombre_completo: 'Maria Alejandra Fino Hurtado', cedula: '1117972580' },
  { item: 273, corregimiento: 'RIO NEGRO', vereda: 'Costa Rica Alta', nombre_completo: 'Maria Ernestina Rivera Delgado', cedula: '40781196' },
  { item: 274, corregimiento: 'RIO NEGRO', vereda: 'Costa Rica Alta', nombre_completo: 'Maria Jara Burgos', cedula: '40728366' },
  { item: 275, corregimiento: 'RIO NEGRO', vereda: 'Costa Rica Alta', nombre_completo: 'Rafael Antonio Tapasco Vinasco', cedula: '17667815' },
  { item: 276, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Miguel Angel Tafur Rodtriguez', cedula: '1116916588' },
  { item: 277, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Miller Navia Aley', cedula: '96359422' },
  { item: 278, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Yesenia Vasquez Vanegas', cedula: '1097033529' },
  { item: 279, corregimiento: 'RIO NEGRO', vereda: 'La Aurora Del Guayas', nombre_completo: 'Abelardo Meneses Manquillo', cedula: '17699155' },
  { item: 280, corregimiento: 'RIO NEGRO', vereda: 'La Aurora Del Guayas', nombre_completo: 'Cesar Augusto Pedraza Rodríguez', cedula: '17701603' },
  { item: 281, corregimiento: 'RIO NEGRO', vereda: 'La Aurora Del Guayas', nombre_completo: 'Jhon Anderson Silva Lara', cedula: '1115950469' },
  { item: 282, corregimiento: 'RIO NEGRO', vereda: 'La Esperanza', nombre_completo: 'Ana Ruth Manrique Montoya', cedula: '40727064' },
  { item: 283, corregimiento: 'RIO NEGRO', vereda: 'La Esperanza', nombre_completo: 'Consuelo Arboleda', cedula: '48656409' },
  { item: 284, corregimiento: 'RIO NEGRO', vereda: 'La Esperanza', nombre_completo: 'Eduardo Bolaños Avalo', cedula: '96354741' },
  { item: 285, corregimiento: 'RIO NEGRO', vereda: 'La Esperanza', nombre_completo: 'Hernando Bolaños Avalo', cedula: '96354249' },
  { item: 286, corregimiento: 'RIO NEGRO', vereda: 'La Esperanza', nombre_completo: 'Jose David Nuñez Sanchez', cedula: '5901689' },
  { item: 287, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Edwin Molano Artunduaga', cedula: '1193108459' },
  { item: 288, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Eidy Lorena Avila Garcia', cedula: '1083907299' },
  { item: 289, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Gerson Enrique Torres Paniagua', cedula: '1006528770' },
  { item: 290, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Rosalba Muñoz Aley', cedula: '40731175' },
  { item: 291, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Segundo Alfonso Romero Peña', cedula: '17788838' },
  { item: 292, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Adolfo Sanchez Barrero', cedula: '83181434' },
  { item: 293, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Jhon Jairo Reyes', cedula: '6802409' },
  { item: 294, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Jose Edin Ramirez', cedula: '1117964800' },
  { item: 295, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Luz Stella Aldana', cedula: '26645063' },
  { item: 296, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Milton Delgado Ordoñez', cedula: '7696639' },
  { item: 297, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Jorge Eliecer Loaiza Hincapie', cedula: '17788614' },
  { item: 298, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Jose Antonio Victoria Monje', cedula: '17645280' },
  { item: 299, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Alipio Cortez Marroquin', cedula: '93354761' },
  { item: 300, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Diomedes Gonzalez', cedula: '76225257' },
  { item: 301, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Jose Daniel Hurtado', cedula: '4752631' },
  { item: 302, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Romario Bermudez Diaz', cedula: '1006418753' },
  { item: 303, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'German Viveros Lasso', cedula: '17702257' },
  { item: 304, corregimiento: 'SANTANA RAMOS', vereda: 'Brisas De La Cristalina', nombre_completo: 'Federman Mora Sanchez', cedula: '14259604' },
  { item: 305, corregimiento: 'SANTANA RAMOS', vereda: 'Brisas De La Cristalina', nombre_completo: 'Marcos Muñoz Oidor', cedula: '1007396044' },
  { item: 306, corregimiento: 'SANTANA RAMOS', vereda: 'Brisas De La Cristalina', nombre_completo: 'Olmer Eliecer Salazar Cortez', cedula: '1076986066' },
  { item: 307, corregimiento: 'SANTANA RAMOS', vereda: 'El Arenoso', nombre_completo: 'Jorqui Oney Ramirez Saldaña', cedula: '1115941560' },
  { item: 308, corregimiento: 'SANTANA RAMOS', vereda: 'El Arenoso', nombre_completo: 'Vilmar Molano Manrrique', cedula: '12259185' },
  { item: 309, corregimiento: 'SANTANA RAMOS', vereda: 'El Arenoso', nombre_completo: 'Andres Guzman Lavao', cedula: '1115941565' },
  { item: 310, corregimiento: 'SANTANA RAMOS', vereda: 'El Arenoso', nombre_completo: 'Bladimir Cifuentes Taborda', cedula: '5996532' },
  { item: 311, corregimiento: 'SANTANA RAMOS', vereda: 'El Arenoso', nombre_completo: 'Elias Cortez', cedula: '12253491' },
  { item: 312, corregimiento: 'SANTANA RAMOS', vereda: 'El Arenoso', nombre_completo: 'Jaiver Peralta Pimentel', cedula: '96362217' },
  { item: 313, corregimiento: 'SANTANA RAMOS', vereda: 'El Arenoso', nombre_completo: 'Oscar Fernando Sierra Castro', cedula: '1115953141' },
  { item: 314, corregimiento: 'SANTANA RAMOS', vereda: 'El Arenoso', nombre_completo: 'Rosana Teresa Perdomo', cedula: '30517200' },
  { item: 315, corregimiento: 'SANTANA RAMOS', vereda: 'El Mendez', nombre_completo: 'Jairo Pinto Losada', cedula: '12253913' },
  { item: 316, corregimiento: 'SANTANA RAMOS', vereda: 'El Mendez', nombre_completo: 'Ramiro Ramirez Latorre', cedula: '17673191' },
  { item: 317, corregimiento: 'SANTANA RAMOS', vereda: 'El Mendez', nombre_completo: 'Santo Puentes Cruz', cedula: '12208121' },
  { item: 318, corregimiento: 'SANTANA RAMOS', vereda: 'El Mendez', nombre_completo: 'Wbalter Molano Perdomo', cedula: '1075215326' },
  { item: 319, corregimiento: 'SANTANA RAMOS', vereda: 'El Mendez', nombre_completo: 'Yamil Rodriguez Zapata', cedula: '12258138' },
  { item: 320, corregimiento: 'SANTANA RAMOS', vereda: 'El Nutrio', nombre_completo: 'Dago Paz Leal', cedula: '10566900' },
  { item: 321, corregimiento: 'SANTANA RAMOS', vereda: 'El Nutrio', nombre_completo: 'Jhonatan Ruiz Londoño', cedula: '1075247036' },
  { item: 322, corregimiento: 'SANTANA RAMOS', vereda: 'Guadualito', nombre_completo: 'Cristhian Arbey Murcia Bastidas', cedula: '1075259121' },
  { item: 323, corregimiento: 'SANTANA RAMOS', vereda: 'Guadualito', nombre_completo: 'Gabriel Arbey Murcia Cortes', cedula: '17668142' },
  { item: 324, corregimiento: 'SANTANA RAMOS', vereda: 'Loma Alta', nombre_completo: 'Luis Ferney Lopez Fierro', cedula: '1003904399' },
  { item: 325, corregimiento: 'SANTANA RAMOS', vereda: 'Palestina', nombre_completo: 'Cristian Eduardo Ruiz', cedula: '1075264478' },
  { item: 326, corregimiento: 'SANTANA RAMOS', vereda: 'Palestina', nombre_completo: 'Elias Ruiz Bonilla', cedula: '83027261' },
  { item: 327, corregimiento: 'SANTANA RAMOS', vereda: 'San Pablo', nombre_completo: 'Diego Alejandro Cavidez Rincon', cedula: '1069761392' },
  { item: 328, corregimiento: 'SANTANA RAMOS', vereda: 'San Pablo', nombre_completo: 'Wilderman Cabrera Martinez', cedula: '1129844050' },
  { item: 329, corregimiento: 'SANTANA RAMOS', vereda: 'Santana Ramos', nombre_completo: 'Robinson Cavidez Muñoz', cedula: '7698923' },
  { item: 330, corregimiento: 'SANTANA RAMOS', vereda: 'Yarumal Bajo', nombre_completo: 'Luz Dary Saldaña Lazo', cedula: '30519208' },
  { item: 331, corregimiento: 'SANTANA RAMOS', vereda: 'Yarumal Bajo', nombre_completo: 'Raul Dario Chavez Cuetochambo', cedula: '76343755' },
  { item: 332, corregimiento: 'SANTANA RAMOS', vereda: 'Yarumal Medio', nombre_completo: 'Mario Arnulfo Real Gomez', cedula: '83221387' },
  { item: 333, corregimiento: 'SANTANA RAMOS', vereda: 'Yarumal Medio', nombre_completo: 'Mario Stiven Real Bastidas', cedula: '1129844566' },
];

// ============================================================
// FUNCIONES CRUD
// ============================================================

/** Inicializar la tabla y hacer seed si está vacía */
export const initBeneficiariosDB = async (): Promise<void> => {
  const database = await ensureDb();
  if (!database) return;

  const count = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM beneficiarios'
  );

  if (count && count.count === 0) {
    const now = new Date().toISOString();
    for (const b of SEED_DATA) {
      await database.runAsync(
        `INSERT OR IGNORE INTO beneficiarios (item, corregimiento, vereda, nombre_completo, cedula, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [b.item, b.corregimiento, b.vereda, b.nombre_completo, b.cedula, now, now]
      );
    }
    console.log('[BeneficiariosDB] Seed completado: 76 beneficiarios insertados');
  }
};

/** Obtener todos los beneficiarios */
export const getBeneficiarios = async (): Promise<BeneficiarioDB[]> => {
  const database = await ensureDb();
  if (!database) return [];

  const rows = await database.getAllAsync<BeneficiarioDB>(
    'SELECT * FROM beneficiarios ORDER BY item ASC'
  );
  return rows;
};

/** Obtener un beneficiario por item */
export const getBeneficiarioByItem = async (item: number): Promise<BeneficiarioDB | null> => {
  const database = await ensureDb();
  if (!database) return null;

  const row = await database.getFirstAsync<BeneficiarioDB>(
    'SELECT * FROM beneficiarios WHERE item = ?',
    [item]
  );
  return row || null;
};

/**
 * Buscar un beneficiario por cédula — útil cuando solo se tiene un
 * `DatosBeneficiario` (formularios) en vez del `BeneficiarioDB` completo,
 * ya que ese tipo no trae el `item` (llave primaria de esta tabla).
 */
export const getBeneficiarioByCedula = async (cedula: string): Promise<BeneficiarioDB | null> => {
  const database = await ensureDb();
  if (!database || !cedula) return null;

  const row = await database.getFirstAsync<BeneficiarioDB>(
    'SELECT * FROM beneficiarios WHERE cedula = ?',
    [cedula]
  );
  return row || null;
};

/** Asignar un técnico a un beneficiario (servidor + espejo local) */
export const assignTecnicoToBeneficiario = async (
  item: number,
  tecnicoId: string,
  tecnicoNombre: string
): Promise<void> => {
  try {
    await apiClient.put(`${API_CONFIG.ENDPOINTS.BENEFICIARIOS}/${item}/asignacion`, {
      tecnico_id: tecnicoId,
      tecnico_nombre: tecnicoNombre,
    });
  } catch (error) {
    throw errorLegible(error, 'asignar el técnico');
  }

  const database = await ensureDb();
  if (!database) return;
  const now = new Date().toISOString();
  await database.runAsync(
    `UPDATE beneficiarios SET tecnico_asignado_id = ?, tecnico_asignado_nombre = ?, updated_at = ? WHERE item = ?`,
    [tecnicoId, tecnicoNombre, now, item]
  );
};

/** Desasignar técnico de un beneficiario (servidor + espejo local) */
export const unassignTecnicoFromBeneficiario = async (item: number): Promise<void> => {
  try {
    await apiClient.put(`${API_CONFIG.ENDPOINTS.BENEFICIARIOS}/${item}/asignacion`, {
      tecnico_id: null,
      tecnico_nombre: null,
    });
  } catch (error) {
    throw errorLegible(error, 'desasignar el técnico');
  }

  const database = await ensureDb();
  if (!database) return;
  const now = new Date().toISOString();
  await database.runAsync(
    `UPDATE beneficiarios SET tecnico_asignado_id = NULL, tecnico_asignado_nombre = NULL, updated_at = ? WHERE item = ?`,
    [now, item]
  );
};

/** Crear un nuevo beneficiario (servidor + espejo local) */
export const createBeneficiario = async (payload: BeneficiarioPayload): Promise<void> => {
  try {
    await apiClient.post(API_CONFIG.ENDPOINTS.BENEFICIARIOS, payload);
  } catch (error) {
    throw errorLegible(error, 'crear el beneficiario');
  }

  const database = await ensureDb();
  if (!database) return;
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT OR REPLACE INTO beneficiarios (item, corregimiento, vereda, nombre_completo, cedula, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [payload.item, payload.corregimiento, payload.vereda, payload.nombre_completo, payload.cedula, now, now]
  );
};

/** Editar datos de un beneficiario: corregimiento, vereda, nombre (NO cédula) */
export const updateBeneficiario = async (
  item: number,
  payload: { corregimiento: string; vereda: string; nombre_completo: string }
): Promise<void> => {
  try {
    await apiClient.put(`${API_CONFIG.ENDPOINTS.BENEFICIARIOS}/${item}`, payload);
  } catch (error) {
    throw errorLegible(error, 'actualizar el beneficiario');
  }

  const database = await ensureDb();
  if (!database) return;
  const now = new Date().toISOString();
  await database.runAsync(
    `UPDATE beneficiarios SET corregimiento = ?, vereda = ?, nombre_completo = ?, updated_at = ? WHERE item = ?`,
    [payload.corregimiento, payload.vereda, payload.nombre_completo, now, item]
  );
};

/**
 * Completar datos de contacto y calidad del predio (correo, teléfono,
 * calidad_predio) — a diferencia de `updateBeneficiario`, lo puede llamar
 * cualquier usuario autenticado (lo usa el técnico al diligenciar el Acta
 * de Compromiso, donde se captura esta info por primera vez).
 */
export const actualizarContactoBeneficiario = async (
  item: number,
  payload: { telefono?: string; correo_electronico?: string; calidad_predio?: 'propietario' | 'poseedor' | 'otro' }
): Promise<void> => {
  try {
    await apiClient.put(`${API_CONFIG.ENDPOINTS.BENEFICIARIOS}/${item}/contacto`, payload);
  } catch (error) {
    throw errorLegible(error, 'guardar los datos de contacto');
  }

  const database = await ensureDb();
  if (!database) return;
  const now = new Date().toISOString();
  await database.runAsync(
    `UPDATE beneficiarios
     SET telefono = COALESCE(?, telefono),
         correo_electronico = COALESCE(?, correo_electronico),
         calidad_predio = COALESCE(?, calidad_predio),
         updated_at = ?
     WHERE item = ?`,
    [payload.telefono || null, payload.correo_electronico || null, payload.calidad_predio || null, now, item]
  );
};

/** Eliminar un beneficiario (servidor + espejo local) */
export const deleteBeneficiario = async (item: number): Promise<void> => {
  try {
    await apiClient.delete(`${API_CONFIG.ENDPOINTS.BENEFICIARIOS}/${item}`);
  } catch (error) {
    throw errorLegible(error, 'eliminar el beneficiario');
  }

  const database = await ensureDb();
  if (!database) return;
  await database.runAsync(
    'DELETE FROM beneficiarios WHERE item = ?',
    [item]
  );
};

/** Obtener el siguiente item disponible (mayor item + 1) */
export const getNextItem = async (): Promise<number> => {
  const database = await ensureDb();
  if (!database) return 301;

  const row = await database.getFirstAsync<{ max: number | null }>(
    'SELECT MAX(item) as max FROM beneficiarios'
  );
  return (row?.max || 300) + 1;
};

/** Obtener beneficiarios asignados a un técnico específico */
export const getBeneficiariosByTecnico = async (tecnicoId: string): Promise<BeneficiarioDB[]> => {
  const database = await ensureDb();
  if (!database) return [];

  const rows = await database.getAllAsync<BeneficiarioDB>(
    'SELECT * FROM beneficiarios WHERE tecnico_asignado_id = ? ORDER BY nombre_completo ASC',
    [tecnicoId]
  );
  return rows;
};
