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
          `INSERT INTO beneficiarios (item, corregimiento, vereda, nombre_completo, cedula, tecnico_asignado_id, tecnico_asignado_nombre, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            b.item,
            b.corregimiento,
            b.vereda,
            b.nombre_completo,
            b.cedula,
            b.tecnico_asignado_id || null,
            b.tecnico_asignado_nombre || null,
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

// ============================================================
// SEED — 76 beneficiarios desde el CSV
// ============================================================

/**
 * Exportado (no solo usado internamente) porque es la única fuente confiable
 * en el código de la asociación vereda → corregimiento real del municipio;
 * el Dashboard de supervisión (utils/corregimientos.ts) la reutiliza para
 * resolver el corregimiento de un formulario cuando este no lo trae explícito.
 */
export const SEED_DATA: Omit<BeneficiarioDB, 'tecnico_asignado_id' | 'tecnico_asignado_nombre' | 'created_at' | 'updated_at'>[] = [
  { item: 1, corregimiento: 'LA AGUILILLA', vereda: 'Brillante Bajo', nombre_completo: 'Benardino Caviedes Martinez', cedula: '96359490' },
  { item: 2, corregimiento: 'LA AGUILILLA', vereda: 'Brillante Bajo', nombre_completo: 'Nolveiro Caviedez Martinez', cedula: '1115942322' },
  { item: 3, corregimiento: 'LA AGUILILLA', vereda: 'Brillante Bajo', nombre_completo: 'Elicenia Rengifo Martinez', cedula: '1059354244' },
  { item: 4, corregimiento: 'LA AGUILILLA', vereda: 'Brillante Bajo', nombre_completo: 'Aldemar Gualy Arias', cedula: '96359978' },
  { item: 5, corregimiento: 'LA AGUILILLA', vereda: 'El Libano Alto', nombre_completo: 'Edwin Arturo Sanchez Gaviria', cedula: '1115947968' },
  { item: 6, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Jesus Elias Gomez Carmona', cedula: '17665994' },
  { item: 7, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Rulberto Yanguma', cedula: '96361394' },
  { item: 8, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Maria Maricel Yanguma', cedula: '26623720' },
  { item: 9, corregimiento: 'LA AGUILILLA', vereda: 'El Porvenir', nombre_completo: 'Eidy Yulieth Hernandez', cedula: '1115949073' },
  { item: 10, corregimiento: 'LA AGUILILLA', vereda: 'Monte Bello', nombre_completo: 'Jose Luis Rodriguez', cedula: '1115940902' },
  { item: 11, corregimiento: 'LA AGUILILLA', vereda: 'Monte Bello', nombre_completo: 'Yeferson Nieto', cedula: '1115947889' },
  { item: 12, corregimiento: 'LA AGUILILLA', vereda: 'Monte Bello', nombre_completo: 'Luzdary Loaiza Bravo', cedula: '41212236' },
  { item: 13, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Rogelio Aviles Rico', cedula: '96362086' },
  { item: 14, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Avercio Cerquera Losada', cedula: '17666541' },
  { item: 15, corregimiento: 'LA AGUILILLA', vereda: 'Monterrey', nombre_completo: 'Gonzalo Garcia Muñoz', cedula: '17788800' },
  { item: 16, corregimiento: 'LA AGUILILLA', vereda: 'Retorno', nombre_completo: 'Gustavo Urriago Gasca', cedula: '1115945725' },
  { item: 17, corregimiento: 'LA AGUILILLA', vereda: 'Retorno', nombre_completo: 'Edubel Villegas', cedula: '1115946162' },
  { item: 18, corregimiento: 'LA AGUILILLA', vereda: 'Retorno', nombre_completo: 'Lucelida Martinez Uribe', cedula: '1115945923' },
  { item: 19, corregimiento: 'LA AGUILILLA', vereda: 'Retorno', nombre_completo: 'Dilia Saavedra', cedula: '55199769' },
  { item: 20, corregimiento: 'LUSITANIA', vereda: 'Caimancito Medio Jordan', nombre_completo: 'Nolberto Borrero Ortiz', cedula: '12202461' },
  { item: 21, corregimiento: 'LUSITANIA', vereda: 'Caimancito Medio Jordan', nombre_completo: 'Jefferson Fabian Escobar Losada', cedula: '1115948632' },
  { item: 22, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Leidy Guasa Sandoval', cedula: '40733578' },
  { item: 23, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Jose Armando Guasa Sandoval', cedula: '76289094' },
  { item: 24, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Fabio Ordoñez Ordoñez', cedula: '6298635' },
  { item: 25, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Edgar Calderon Sanchez', cedula: '1115940037' },
  { item: 26, corregimiento: 'RIO NEGRO', vereda: 'Arenoso Oriente', nombre_completo: 'Alcides Guasa Diaz', cedula: '96353924' },
  { item: 27, corregimiento: 'RIO NEGRO', vereda: 'Costa Rica Alta', nombre_completo: 'Duberney Burgos', cedula: '1117961305' },
  { item: 28, corregimiento: 'RIO NEGRO', vereda: 'La Aurora del Guayas', nombre_completo: 'Hermes Marroquin', cedula: '12111164' },
  { item: 29, corregimiento: 'RIO NEGRO', vereda: 'La Aurora del Guayas', nombre_completo: 'Crisanto Cuellar', cedula: '17788925' },
  { item: 30, corregimiento: 'RIO NEGRO', vereda: 'La Aurora del Guayas', nombre_completo: 'Giovanny Tafur', cedula: '5976174' },
  { item: 31, corregimiento: 'RIO NEGRO', vereda: 'La Aurora del Guayas', nombre_completo: 'Abelardo Meneces', cedula: '176991155' },
  { item: 32, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Jesus Alfredo Trujillo', cedula: '17683247' },
  { item: 33, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Delio Diaz', cedula: '17699930' },
  { item: 34, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Jose Daniel Hurtado', cedula: '4572631' },
  { item: 35, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Artur Guasa', cedula: '16825070' },
  { item: 36, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Sixto Guasa', cedula: '96353923' },
  { item: 37, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Noelia Valanta', cedula: '30158831' },
  { item: 38, corregimiento: 'RIO NEGRO', vereda: 'Siberia Alta', nombre_completo: 'Georgina Mina', cedula: '25334990' },
  { item: 39, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'German Viveros', cedula: '17720257' },
  { item: 40, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Aldemar Calderon', cedula: '96351929' },
  { item: 41, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Jose Antonio Noreña', cedula: '96351814' },
  { item: 42, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Floresmiro Julicue', cedula: '10478401' },
  { item: 43, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Luis Fernando Cortes', cedula: '96351205' },
  { item: 44, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Ivan Salinas Rojas', cedula: '17701440' },
  { item: 45, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Nelson Londoño', cedula: '83258208' },
  { item: 46, corregimiento: 'RIO NEGRO', vereda: 'Siberia Baja', nombre_completo: 'Jorti Leon', cedula: '17788310' },
  { item: 47, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Arcesio Navia', cedula: '17620219' },
  { item: 48, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Eduardo Jimenez', cedula: '96350985' },
  { item: 49, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Victor Alfonso Pabon', cedula: '1115940635' },
  { item: 50, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Luis Adan Pabon Parra', cedula: '2351091' },
  { item: 51, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Diego Pabon', cedula: '17701524' },
  { item: 52, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Jose Ferney Cipriano', cedula: '146916620' },
  { item: 53, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Luis Ovaldo Vasques', cedula: '4533379' },
  { item: 54, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Farid Serrano', cedula: '96361550' },
  { item: 55, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Oscar Ivan Peña', cedula: '17784108' },
  { item: 56, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Olmeiro Covaleda Ramirez', cedula: '96351095' },
  { item: 57, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Jesus Maria Perez', cedula: '1116919040' },
  { item: 58, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Uber De Jesus Perez', cedula: '17711294' },
  { item: 59, corregimiento: 'RIO NEGRO', vereda: 'El Lobo', nombre_completo: 'Miguel Angel Tafur Rodriguez', cedula: '1116916188' },
  { item: 60, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Alirio Lizcano', cedula: '16828450' },
  { item: 61, corregimiento: 'RIO NEGRO', vereda: 'Lindanay', nombre_completo: 'Luis Enrrique Torres', cedula: '17668189' },
  { item: 62, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Adolfo Sanchez', cedula: '83181454' },
  { item: 63, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Leonardo Lizcano', cedula: '17708081' },
  { item: 64, corregimiento: 'RIO NEGRO', vereda: 'Lobo No. 2', nombre_completo: 'Euder Navia Aley', cedula: '17651393' },
  { item: 65, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Euder Yate', cedula: '17710020' },
  { item: 66, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Jorge Eliecer Loaiza Incapie', cedula: '177888614' },
  { item: 67, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Fernando Artunduaga', cedula: '96350879' },
  { item: 68, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Evangelista Padilla Guazaquilloo', cedula: '96353707' },
  { item: 69, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Mauricio Sun', cedula: '16828451' },
  { item: 70, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Marly Velasco Sun', cedula: '36177547' },
  { item: 71, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Martha Pabon', cedula: '40730783' },
  { item: 72, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Evangelista Padilla', cedula: '5980107' },
  { item: 73, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Sandro Victorio', cedula: '1117961268' },
  { item: 74, corregimiento: 'RIO NEGRO', vereda: 'Palestina', nombre_completo: 'Ismael Pinto Arias', cedula: '17671147' },
  { item: 75, corregimiento: 'RIO NEGRO', vereda: 'San Marcos', nombre_completo: 'Virgelina Manrique', cedula: '40626743' },
  { item: 76, corregimiento: 'RIO NEGRO', vereda: 'San Marcos', nombre_completo: 'Alfonso Gonzales', cedula: '12132154' },
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
