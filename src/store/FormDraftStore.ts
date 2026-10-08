// ============================================================
// GEODAILY — Store de Borradores de Formularios (Drafts)
// ============================================================
// Persiste borradores localmente para recuperar formularios
// en caso de cierre inesperado de la aplicación.
//
// IMPORTANTE: Usamos AsyncStorage en vez de SecureStore porque
// los borradores contienen firmas (base64 ~5-50KB) y fotos,
// que superan el límite de ~2KB de SecureStore en Android.
// AsyncStorage tiene un límite de ~6MB, suficiente para
// múltiples borradores completos.
//
// ─── UN BORRADOR POR CLAVE (antes: un solo JSON con todos) ───
// Antes, TODOS los borradores vivían en una única clave como un
// array JSON: cada guardado leía el array completo, le insertaba/
// reemplazaba un elemento y reescribía la clave entera. Dos
// problemas graves en campo:
//   1. Una escritura interrumpida (Android matando la app al
//      bloquear el teléfono) dejaba la clave con JSON inválido.
//      `cargarBorradores` lo atrapaba y devolvía `[]` en silencio:
//      el técnico abría "Formularios Incompletos" y no había NADA
//      —sus reportes: "ya había eliminado toda la información".
//   2. Guardados y borrados concurrentes (autoguardado cada 20 s +
//      "Guardar borrador" + "Completar") competían por la misma
//      clave y podían resucitar un borrador ya eliminado o perder
//      el recién guardado.
// Ahora cada borrador se guarda en su propia clave
// (`geodaily.form_drafts.item.<id>`) y hay un índice aparte. Así una
// escritura rota afecta a UN borrador, y el índice —si se daña— se
// reconstruye listando las claves existentes.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolverEvidenciasRemotas } from '../services/archivos.service';
import {
  cancelarSubidaBorrador,
  eliminarBorradorDelServidor,
  guardarBorradorEnServidor,
  listarBorradoresDelServidor,
  programarSubidaBorrador,
  vaciarColaBorradores,
} from '../services/borradores.service';
import { STORAGE_KEYS } from '../utils/constants';
import { compactarDatosOtrosFormatos } from './OtrosFormatosDraftStore';
import {
  DatosTecnico,
  DatosBeneficiario,
  ActividadRealizada,
  DatosSociodemograficos,
  DatosCaracterizacionNueva,
  Coordenadas,
  TipoFormulario,
  FotoGeotag,
} from '../types';

/** Clave del formato ANTIGUO (array JSON con todos los borradores). */
const DRAFTS_KEY = STORAGE_KEYS.FORM_DRAFTS;
/** Prefijo de la clave individual de cada borrador. */
const DRAFT_ITEM_PREFIX = `${DRAFTS_KEY}.item.`;
/** Clave del índice (array JSON solo con los ids). */
const DRAFT_INDEX_KEY = `${DRAFTS_KEY}.index`;
/** Tombstone local para reintentar borrados remotos cuando vuelva la conexión. */
const DRAFT_DELETED_PREFIX = `${DRAFTS_KEY}.deleted.`;

/**
 * Último error real de un guardado fallido.
 *
 * La UI antes mostraba SIEMPRE "libera espacio e inténtalo de nuevo", sin
 * importar la causa. En Android el fallo típico es que la base SQLite de
 * AsyncStorage (tope de 6 MB) se llenó con firmas en base64, pero también
 * puede ser otra cosa — así que aquí se conserva el mensaje real y las
 * pantallas lo muestran para poder diagnosticar en campo.
 */
let ultimoErrorBorrador: string | null = null;

/** Mensaje del último guardado fallido (null si el último guardado fue bien). */
export const obtenerUltimoErrorBorrador = (): string | null => ultimoErrorBorrador;

/** Texto legible de un error desconocido (mensaje + código si los trae). */
const describirError = (error: unknown): string => {
  const e = error as { message?: string; code?: string } | null | undefined;
  const mensaje = e?.message || String(error ?? 'desconocido');
  return e?.code ? `${mensaje} (${e.code})` : mensaje;
};

export interface FormDraft {
  id: string;
  tipo: TipoFormulario;
  step: number;
  tecnico: DatosTecnico;
  beneficiario: DatosBeneficiario;
  actividad: ActividadRealizada;
  socioData?: DatosSociodemograficos;
  caracterizacion_nueva?: DatosCaracterizacionNueva;
  coordenadas?: Coordenadas;
  selectedDepartamento: string;
  selectedActividad: string;
  otraActividadText: string;
  descripcionDetallada?: string;
  fotos?: FotoGeotag[];
  /** Firma del beneficiario en base64 (data:image/png;base64,...) */
  firma_beneficiario?: string;
  /** Firma del técnico en base64 (data:image/png;base64,...) */
  firma_tecnico?: string;
  huella_beneficiario?: boolean;
  /**
   * Campos de ubicación administrativa (vereda/corregimiento) bloqueados
   * porque vienen del padrón de beneficiarios. No se guardaba y al recuperar
   * el borrador el técnico podía pisar la vereda asignada por error.
   */
  datosBloqueados?: boolean;
  updated_at: string;
}

const itemKey = (id: string) => `${DRAFT_ITEM_PREFIX}${id}`;

/** JSON.parse defensivo: devuelve `null` en vez de lanzar. */
const parseSeguro = <T,>(valor: string | null): T | null => {
  if (!valor) return null;
  try {
    return JSON.parse(valor) as T;
  } catch {
    return null;
  }
};

/** Extrae solo objetos de borrador completos de un array JSON danado. */
const rescatarBorradoresCompletos = (crudo: string): FormDraft[] => {
  const encontrados = new Map<string, FormDraft>();
  let inicio = -1;
  let profundidad = 0;
  let dentroCadena = false;
  let escape = false;

  for (let i = 0; i < crudo.length; i += 1) {
    const caracter = crudo[i];

    if (inicio < 0) {
      if (caracter === '{') {
        inicio = i;
        profundidad = 1;
        dentroCadena = false;
        escape = false;
      }
      continue;
    }

    if (dentroCadena) {
      if (escape) {
        escape = false;
      } else if (caracter === '\\') {
        escape = true;
      } else if (caracter === '"') {
        dentroCadena = false;
      }
      continue;
    }

    if (caracter === '"') {
      dentroCadena = true;
    } else if (caracter === '{') {
      profundidad += 1;
    } else if (caracter === '}') {
      profundidad -= 1;
      if (profundidad === 0) {
        const valor = parseSeguro<unknown>(crudo.slice(inicio, i + 1));
        if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
          const candidato = valor as Partial<FormDraft>;
          const tieneFormaDeBorrador =
            typeof candidato.id === 'string' &&
            candidato.id.length > 0 &&
            typeof candidato.tipo === 'string' &&
            !!candidato.tecnico && typeof candidato.tecnico === 'object' &&
            !!candidato.beneficiario && typeof candidato.beneficiario === 'object';

          if (tieneFormaDeBorrador) {
            const borrador = candidato as FormDraft;
            const previo = encontrados.get(borrador.id);
            if (!previo || (borrador.updated_at || '') > (previo.updated_at || '')) {
              encontrados.set(borrador.id, borrador);
            }
          }
        }
        inicio = -1;
      }
    }
  }

  return Array.from(encontrados.values());
};

/** Leer el índice de ids. Nunca lanza. */
const leerIndice = async (): Promise<string[] | null> => {
  try {
    const crudo = await AsyncStorage.getItem(DRAFT_INDEX_KEY);
    if (!crudo) return null;
    const ids = parseSeguro<string[]>(crudo);
    if (!Array.isArray(ids)) return null;
    return ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return null;
  }
};

/** Escribir el índice de ids. */
const escribirIndice = async (ids: string[]): Promise<void> => {
  await AsyncStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(Array.from(new Set(ids))));
};

/**
 * Reconstruye el índice listando las claves físicas de AsyncStorage.
 * Es la red de seguridad: aunque el índice se corrompa o se pierda,
 * los borradores siguen intactos en sus claves y se recuperan solos.
 */
const reconstruirIndiceDesdeClaves = async (): Promise<string[]> => {
  const claves = await AsyncStorage.getAllKeys();
  return claves
    .filter((k) => k.startsWith(DRAFT_ITEM_PREFIX))
    .map((k) => k.slice(DRAFT_ITEM_PREFIX.length))
    .filter((id) => id.length > 0);
};

/**
 * Migra el formato antiguo (array en una sola clave) al nuevo
 * (una clave por borrador). Idempotente y segura ante interrupciones:
 * escribe primero los borradores y el índice, y solo al final borra la
 * clave antigua. Si se corta a mitad, en el siguiente arranque se
 * vuelve a ejecutar sin perder nada.
 */
const migrarFormatoAntiguo = async (): Promise<void> => {
  try {
    const crudoAntiguo = await AsyncStorage.getItem(DRAFTS_KEY);
    if (!crudoAntiguo) return;

    const antiguos = parseSeguro<FormDraft[]>(crudoAntiguo);
    const formatoAntiguoValido = Array.isArray(antiguos);
    const borradoresAntiguos = formatoAntiguoValido
      ? antiguos
      : rescatarBorradoresCompletos(crudoAntiguo);
    if (borradoresAntiguos.length === 0) {
      // La clave antigua se conserva aunque no haya objetos recuperables.
      console.warn('[Drafts] El formato antiguo esta danado; se conserva para rescate manual');
      return;
    }

    const idsExistentes = (await leerIndice()) ?? (await reconstruirIndiceDesdeClaves());

    let omitidos = 0;
    let rescatados = 0;
    for (const draft of borradoresAntiguos) {
      if (!draft || typeof draft.id !== 'string' || !draft.id) {
        // 🛑 Entrada sin id: no se puede migrar a una clave propia. NO se
        // cuenta como migrada y por eso más abajo la clave antigua NO se
        // borra: si se borrara, ese borrador desaparecería para siempre.
        omitidos += 1;
        continue;
      }
      // No pisar una versión más reciente ya migrada/guardada.
      const actual = parseSeguro<FormDraft>(await AsyncStorage.getItem(itemKey(draft.id)));
      if (actual) continue;
      await AsyncStorage.setItem(itemKey(draft.id), JSON.stringify(draft));
      rescatados += 1;
      if (!idsExistentes.includes(draft.id)) idsExistentes.push(draft.id);
    }

    await escribirIndice(idsExistentes);

    if (!formatoAntiguoValido) {
      console.warn(
        `[Drafts] JSON antiguo danado: ${rescatados} borrador(es) completo(s) rescatado(s); ` +
          'se conserva intacta la clave original.'
      );
      return;
    }

    if (omitidos > 0) {
      console.warn(
        `[Drafts] ${omitidos} entrada(s) del formato antiguo no tienen id: se CONSERVA la clave ` +
          'antigua (sin borrarla) para no perder esos borradores.'
      );
      return;
    }

    await AsyncStorage.removeItem(DRAFTS_KEY);
    console.log(`[Drafts] Migrados ${borradoresAntiguos.length} borrador(es) al formato por clave`);
  } catch (e) {
    console.warn('[Drafts] No se pudo migrar el formato antiguo:', e);
  }
};

/**
 * Guardar borrador del formulario actual.
 *
 * Se escribe la clave del borrador ANTES de tocar el índice: si algo se
 * interrumpe entre ambas, el borrador ya está a salvo y `cargarBorradores`
 * lo encuentra escaneando claves.
 */
export const guardarBorrador = async (draft: FormDraft): Promise<boolean> => {
  if (!draft?.id) {
    console.warn('[Drafts] Se intentó guardar un borrador sin id; ignorado');
    ultimoErrorBorrador = 'El borrador no tiene identificador.';
    return false;
  }
  const aGuardar: FormDraft = { ...draft, updated_at: new Date().toISOString() };
  try {
    await guardarBorradorLocal(aGuardar);
    programarSubidaBorrador(aGuardar);
    ultimoErrorBorrador = null;

    console.log(
      '[Drafts] Borrador guardado:',
      draft.id,
      `(tamaño: ${JSON.stringify(aGuardar).length} bytes)`
    );
    return true;
  } catch (error) {
    // ─── Auto-reparación ───
    // El fallo típico en campo es que AsyncStorage (SQLite, tope de 6 MB en
    // Android) se llenó con las firmas en base64 que "Otros Formatos"
    // guardaba por beneficiario. Se compactan esas claves —moviendo las
    // firmas a archivo— y se reintenta UNA vez. Si no hubo nada que
    // compactar, el problema es otro: se propaga el error real.
    try {
      const compactadas = await compactarDatosOtrosFormatos();
      if (compactadas > 0) {
        console.log(
          `[Drafts] Guardado falló; se liberó espacio en ${compactadas} formato(s). Reintentando...`
        );
        await guardarBorradorLocal(aGuardar);
        programarSubidaBorrador(aGuardar);
        ultimoErrorBorrador = null;
        return true;
      }
    } catch (e) {
      console.warn('[Drafts] La auto-reparación falló:', e);
    }

    ultimoErrorBorrador = describirError(error);
    console.warn('[Drafts] Error al guardar borrador:', error);
    return false;
  }
};

/** Persiste una copia exacta recibida del servidor sin cambiar su versionado. */
const guardarBorradorLocal = async (draft: FormDraft): Promise<void> => {
  await AsyncStorage.setItem(itemKey(draft.id), JSON.stringify(draft));
  const ids = (await leerIndice()) ?? (await reconstruirIndiceDesdeClaves());
  if (!ids.includes(draft.id)) {
    await escribirIndice([draft.id, ...ids]);
  }
};

/**
 * Cargar todos los borradores.
 *
 * Nunca devuelve `[]` en silencio por un problema de lectura: si el índice
 * no es utilizable, se reconstruye desde las claves reales.
 */
export const cargarBorradores = async (): Promise<FormDraft[]> => {
  try {
    await migrarFormatoAntiguo();

    // Índice + claves reales (UNIÓN). El índice es solo un atajo de orden:
    // si por una carrera entre los dos autoguardados que corren en paralelo
    // (el intervalo de 20 s y el debounce) o por una escritura interrumpida
    // un borrador quedó guardado en su clave pero fuera del índice, la unión
    // igual lo carga. Antes eso se veía como "el borrador desapareció":
    // seguía en el teléfono, pero la lista nunca lo mostraba.
    const idsIndice = (await leerIndice()) ?? [];
    const idsClaves = await reconstruirIndiceDesdeClaves();
    const ids = Array.from(new Set([...idsIndice, ...idsClaves]));
    if (ids.length === 0) return [];

    if (ids.length !== idsIndice.length) {
      console.log(`[Drafts] Índice incompleto — reparado desde las claves (${ids.length} borrador/es)`);
      await escribirIndice(ids).catch(() => {});
    }

    const claves = ids.map(itemKey);
    const pares = await AsyncStorage.multiGet(claves);
    const borradores: FormDraft[] = [];
    const idsValidos: string[] = [];

    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const crudo = pares[i]?.[1] ?? null;
      const draft = parseSeguro<FormDraft>(crudo);
      if (draft && typeof draft.id === 'string') {
        borradores.push(draft);
        idsValidos.push(id);
      } else if (crudo !== null) {
        // La clave existe pero el JSON está roto: se descarta ese borrador
        // (y solo ese) y se repara el índice. Antes, un JSON roto en la
        // clave compartida borraba de la vista TODOS los borradores.
        console.warn('[Drafts] Borrador ilegible, se omite:', id);
      }
    }

    if (idsValidos.length !== ids.length) {
      await escribirIndice(idsValidos).catch(() => {});
    }

    // ─── Respaldo del formato antiguo (red de seguridad final) ───
    // Si la migración no pudo completarse (p. ej. el almacenamiento estaba
    // lleno, la app murió a mitad o alguna entrada no tenía id), los
    // borradores siguen existiendo en la clave antigua. Antes esta lectura no
    // existía: la lista mostraba cero y el técnico veía "se me borraron los
    // borradores" aunque seguían en el teléfono. Se leen SÓLO para mostrarlos
    // (sin migrar ni borrar nada) y `eliminarBorrador` los limpia también.
    const idsCargados = new Set(borradores.map((b) => b.id));
    const crudoAntiguo = await AsyncStorage.getItem(DRAFTS_KEY).catch(() => null);
    const antiguos = parseSeguro<FormDraft[]>(crudoAntiguo);
    if (Array.isArray(antiguos)) {
      const rescatados = antiguos.filter(
        (d) => d && typeof d.id === 'string' && d.id.length > 0 && !idsCargados.has(d.id)
      );
      if (rescatados.length > 0) {
        console.warn(
          `[Drafts] ${rescatados.length} borrador(es) recuperados del formato antiguo ` +
            '(la migración no había podido completarse).'
        );
        borradores.push(...rescatados);
      }
    }

    return borradores;
  } catch (error) {
    console.warn('[Drafts] Error al cargar borradores:', error);
    // Último recurso: escanear las claves directamente.
    try {
      const ids = await reconstruirIndiceDesdeClaves();
      const pares = await AsyncStorage.multiGet(ids.map(itemKey));
      return pares
        .map(([, valor]) => parseSeguro<FormDraft>(valor))
        .filter((d): d is FormDraft => !!d && typeof d.id === 'string');
    } catch {
      return [];
    }
  }
};

/** Sincroniza borradores del usuario con el servidor y fusiona por updated_at. */
export const sincronizarBorradoresConServidor = async (
  usuarioId: string,
  cedula: string | undefined,
  locales: FormDraft[]
): Promise<FormDraft[]> => {
  const claves = await AsyncStorage.getAllKeys();
  const eliminadosPendientes = claves
    .filter((clave) => clave.startsWith(DRAFT_DELETED_PREFIX))
    .map((clave) => clave.slice(DRAFT_DELETED_PREFIX.length));

  for (const id of eliminadosPendientes) {
    if (await eliminarBorradorDelServidor(id)) {
      await AsyncStorage.removeItem(`${DRAFT_DELETED_PREFIX}${id}`);
    }
  }

  await vaciarColaBorradores(usuarioId);
  let remotos = await listarBorradoresDelServidor();
  let subidasFallidas = 0;

  const perteneceAlUsuario = (draft: FormDraft): boolean => {
    if (draft.tecnico?.usuario_id) return draft.tecnico.usuario_id === usuarioId;
    return !!cedula && draft.tecnico?.cedula === cedula;
  };
  const marcaTiempo = (draft: FormDraft): number => {
    const timestamp = Date.parse(draft.updated_at || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
  };
  const porIdRemoto = new Map(remotos.map((draft) => [draft.id, draft]));

  for (const local of locales.filter(perteneceAlUsuario)) {
    const remoto = porIdRemoto.get(local.id);
    if (!remoto || marcaTiempo(local) >= marcaTiempo(remoto)) {
      const estado = await guardarBorradorEnServidor(local);
      if (estado === 'completed') {
        cancelarSubidaBorrador(local.id);
        await AsyncStorage.removeItem(itemKey(local.id));
        continue;
      }
      if (estado === 'conflict') {
        remotos = await listarBorradoresDelServidor();
        const actual = remotos.find((draft) => draft.id === local.id);
        if (actual) porIdRemoto.set(actual.id, actual);
      } else if (estado === 'saved') {
        porIdRemoto.set(local.id, local);
      } else if (estado === 'failed') {
        subidasFallidas += 1;
      }
      continue;
    }

    const evidenciasRemotas = await resolverEvidenciasRemotas(remoto.id, remoto.fotos);
    const actualizado = {
      ...remoto,
      fotos: evidenciasRemotas || (remoto.fotos || []).filter((foto) => !foto.uri?.startsWith('file://')),
    };
    await guardarBorradorLocal(actualizado);
  }

  for (const remoto of porIdRemoto.values()) {
    if (locales.some((local) => local.id === remoto.id)) continue;
    const evidenciasRemotas = await resolverEvidenciasRemotas(remoto.id, remoto.fotos);
    const importado = {
      ...remoto,
      fotos: evidenciasRemotas || (remoto.fotos || []).filter((foto) => !foto.uri?.startsWith('file://')),
    };
    await guardarBorradorLocal(importado);
  }

  if (subidasFallidas > 0) {
    throw new Error(`${subidasFallidas} borrador(es) no se pudieron respaldar en el servidor`);
  }

  return cargarBorradores();
};

/**
 * Obtener un borrador por ID (lectura directa de su clave).
 */
export const getBorrador = async (id: string): Promise<FormDraft | null> => {
  if (!id) return null;
  try {
    const directo = parseSeguro<FormDraft>(await AsyncStorage.getItem(itemKey(id)));
    if (directo && typeof directo.id === 'string') return directo;
  } catch {
    // cae al barrido completo
  }
  await migrarFormatoAntiguo().catch(() => {});
  const drafts = await cargarBorradores();
  return drafts.find((d) => d.id === id) || null;
};

/**
 * Eliminar un borrador por ID.
 */
export const eliminarBorrador = async (id: string): Promise<void> => {
  if (!id) return;
  cancelarSubidaBorrador(id);
  try {
    // El tombstone es best-effort: solo sirve para reintentar el borrado
    // remoto cuando vuelva la conexión y pesa 2 bytes. Si el almacenamiento
    // está lleno su escritura puede fallar y NO debe impedir el borrado
    // local — si no, el borrador "resucita" en Formularios Incompletos justo
    // después de haber completado el formulario.
    await AsyncStorage.setItem(`${DRAFT_DELETED_PREFIX}${id}`, '1').catch(() => {});
    // ⚠️ ORDEN: PRIMERO la clave y DESPUÉS el índice.
    // `cargarBorradores` une el índice con las claves reales, así que si se
    // borrara el índice primero y el `removeItem` fallara, el borrador
    // "resucitaría" y volvería a aparecer en "Formularios Incompletos"
    // justo después de haber completado el formulario. Al revés, si falla la
    // escritura del índice, lo peor es un id apuntando a una clave
    // inexistente, que se omite y se repara solo.
    await AsyncStorage.removeItem(itemKey(id));
    const ids = (await leerIndice()) ?? (await reconstruirIndiceDesdeClaves());
    await escribirIndice(ids.filter((i) => i !== id));

    // Si el borrador también vive en la clave del formato antiguo (porque la
    // migración no se pudo completar), hay que quitarlo de ahí: si no, el
    // respaldo de `cargarBorradores` lo "resucitaría" justo después de
    // completar el formulario.
    try {
      const crudoAntiguo = await AsyncStorage.getItem(DRAFTS_KEY);
      const antiguos = parseSeguro<FormDraft[]>(crudoAntiguo);
      if (Array.isArray(antiguos)) {
        const restantes = antiguos.filter((d) => d?.id !== id);
        if (restantes.length !== antiguos.length) {
          if (restantes.length === 0) {
            await AsyncStorage.removeItem(DRAFTS_KEY);
          } else {
            await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(restantes));
          }
        }
      }
    } catch (e) {
      console.warn('[Drafts] No se pudo limpiar el formato antiguo al eliminar:', e);
    }

    if (await eliminarBorradorDelServidor(id)) {
      await AsyncStorage.removeItem(`${DRAFT_DELETED_PREFIX}${id}`);
    }

    console.log('[Drafts] Borrador eliminado:', id);
  } catch (error) {
    console.warn('[Drafts] Error al eliminar borrador:', error);
  }
};

/**
 * Contar borradores pendientes
 */
export const contarBorradores = async (): Promise<number> => {
  const drafts = await cargarBorradores();
  return drafts.length;
};

/**
 * Migrar borradores antiguos desde SecureStore (si existen).
 * Llamar una vez al inicio de la app.
 *
 * OJO: esta función corre en CADA arranque. Su versión anterior podía
 * escribir encima de lo que hubiera en AsyncStorage cuando este quedaba
 * momentáneamente vacío, lo que se veía como "me borró todos los
 * borradores" al abrir la app. Ahora:
 *   - si hay CUALQUIER borrador en el formato actual, no se toca nada y se
 *     borra la copia vieja de SecureStore (ya no sirve);
 *   - si no hay nada, se migra respetando el formato por clave;
 *   - el valor de SecureStore nunca se escribe sobre claves existentes.
 */
export const migrarBorradoresDesdeSecureStore = async (): Promise<void> => {
  try {
    const { default: SecureStore } = await import('expo-secure-store');
    const oldDraftsStr = await SecureStore.getItemAsync(DRAFTS_KEY);
    if (!oldDraftsStr) return;

    // ¿Hay ya borradores en el formato actual (por clave)?
    // Se mira el índice Y las claves reales: si solo se mirara el índice y
    // este quedara vacío por una escritura interrumpida, esta migración
    // escribiría encima de un índice que en realidad sí tenía borradores.
    const idsIndice = (await leerIndice()) ?? [];
    const idsClaves = await reconstruirIndiceDesdeClaves();
    if (idsIndice.length > 0 || idsClaves.length > 0) {
      await SecureStore.deleteItemAsync(DRAFTS_KEY);
      return;
    }

    // Tampoco se re-migra si el formato antiguo en AsyncStorage ya tiene datos:
    // `cargarBorradores` se encarga de pasarlos al formato por clave.
    const antiguoEnAsync = await AsyncStorage.getItem(DRAFTS_KEY);
    if (antiguoEnAsync) {
      await SecureStore.deleteItemAsync(DRAFTS_KEY);
      return;
    }

    const antiguos = parseSeguro<FormDraft[]>(oldDraftsStr);
    if (!Array.isArray(antiguos)) {
      // Contenido ilegible: se descarta la copia vieja (no aporta nada).
      await SecureStore.deleteItemAsync(DRAFTS_KEY);
      return;
    }

    const ids: string[] = [];
    for (const draft of antiguos) {
      if (!draft || typeof draft.id !== 'string' || !draft.id) continue;
      await AsyncStorage.setItem(itemKey(draft.id), JSON.stringify(draft));
      ids.push(draft.id);
    }
    await escribirIndice(ids);
    await SecureStore.deleteItemAsync(DRAFTS_KEY);
    console.log('[Drafts] Borradores migrados de SecureStore a AsyncStorage (formato por clave)');
  } catch {
    // SecureStore puede no estar disponible (Expo Go, web)
  }
};
