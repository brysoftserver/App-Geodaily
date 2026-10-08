// ============================================================
// GEODAILY — Firmas de "Otros Formatos" guardadas como archivo
// ============================================================
// El SignaturePad devuelve la firma como data URI base64
// (data:image/png;base64,....) y pesa 40–140 KB.
//
// Guardarlas DENTRO de AsyncStorage las hacía acumularse sin límite:
// AsyncStorage en Android es una base SQLite (RKStorage) con un tope
// duro de 6 MB por aplicación. Al llenarse, las ESCRITURAS empiezan a
// fallar pero las LECTURAS siguen funcionando — el síntoma exacto de
// campo: el técnico VE sus borradores, pero ya no puede guardar nada,
// y la app le dice "libera espacio" aunque el teléfono tenga GB libres.
//
// Aquí las firmas se escriben como archivo en el almacenamiento
// privado de la app y en AsyncStorage queda solo la URI (unos cientos
// de bytes). Es el mismo patrón que ya se usa con las fotos.
//
// Si algo falla (sin documentDirectory, disco lleno), se devuelve el
// valor original: nunca se pierde una firma por no poder externalizarla.
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';

/** Carpeta persistente de firmas de "Otros Formatos" */
export const FIRMAS_FORMATOS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}firmas_formatos/`
  : null;

/** ¿Es un data URI de imagen (lo que entrega el SignaturePad)? */
export const esDataUriImagen = (valor: unknown): valor is string =>
  typeof valor === 'string' && /^data:image\/(png|jpeg|jpg);base64,/i.test(valor);

/** ¿Es un archivo que esta app escribió en su carpeta de firmas? */
export const esFirmaEnArchivo = (valor?: string | null): boolean =>
  !!valor && !!FIRMAS_FORMATOS_DIR && valor.startsWith(FIRMAS_FORMATOS_DIR);

let directorioListo = false;

/** Crea la carpeta de firmas si no existe (idempotente). */
const asegurarDirectorio = async (): Promise<boolean> => {
  if (!FIRMAS_FORMATOS_DIR) return false;
  if (directorioListo) return true;
  try {
    const info = await FileSystem.getInfoAsync(FIRMAS_FORMATOS_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(FIRMAS_FORMATOS_DIR, { intermediates: true });
    }
    directorioListo = true;
    return true;
  } catch (e) {
    console.warn('[Firmas] No se pudo crear la carpeta de firmas:', e);
    return false;
  }
};

/**
 * Última firma escrita por destino. Evita reescribir el archivo en cada
 * autoguardado (estos formularios guardan en CADA pulsación de tecla y la
 * firma casi nunca cambia).
 */
const ultimoEscrito = new Map<string, string>();

const rutaDe = (destinoBase: string): string | null =>
  FIRMAS_FORMATOS_DIR ? `${FIRMAS_FORMATOS_DIR}${destinoBase}.png` : null;

/**
 * Escribe la firma como archivo PNG y devuelve su URI.
 *
 * Degrada con seguridad: si no se puede externalizar devuelve el data URI
 * original (el comportamiento que había antes), de modo que la firma nunca
 * se pierde por un fallo de disco.
 */
export const externalizarFirma = async (
  dataUri: string,
  destinoBase: string
): Promise<string> => {
  if (!esDataUriImagen(dataUri)) return dataUri;
  const destino = rutaDe(destinoBase);
  if (!destino) return dataUri;

  // Ya se escribió exactamente esta firma antes: reusar el archivo.
  if (ultimoEscrito.get(destinoBase) === dataUri) return destino;

  try {
    if (!(await asegurarDirectorio())) return dataUri;

    const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
    if (!base64) return dataUri;

    await FileSystem.writeAsStringAsync(destino, base64, { encoding: 'base64' });

    const info = await FileSystem.getInfoAsync(destino);
    if (!info.exists || info.size === 0) {
      console.warn('[Firmas] Archivo vacío, se conserva el base64');
      return dataUri;
    }

    ultimoEscrito.set(destinoBase, dataUri);
    return destino;
  } catch (e) {
    console.warn('[Firmas] No se pudo externalizar la firma, se conserva el base64:', e);
    return dataUri;
  }
};

/**
 * Devuelve el data URI de una firma guardada como archivo.
 *
 * `null` si no se pudo leer (archivo ausente o ilegible). En ese caso la
 * pantalla —que exige firma para generar el PDF— pedirá firmar de nuevo, en
 * vez de producir un documento sin firma.
 */
export const hidratarFirma = async (valor?: string | null): Promise<string | null> => {
  if (!valor) return null;
  if (esDataUriImagen(valor)) return valor;
  if (!esFirmaEnArchivo(valor)) return null;
  try {
    const base64 = await FileSystem.readAsStringAsync(valor as string, { encoding: 'base64' });
    if (!base64) return null;
    return `data:image/png;base64,${base64}`;
  } catch (e) {
    console.warn('[Firmas] No se pudo leer la firma en archivo:', e);
    return null;
  }
};

/** Borrar el archivo de firma de un destino (best-effort). */
export const eliminarFirmaExportada = async (destinoBase: string): Promise<void> => {
  const destino = rutaDe(destinoBase);
  if (!destino) return;
  try {
    await FileSystem.deleteAsync(destino, { idempotent: true });
    ultimoEscrito.delete(destinoBase);
  } catch {
    // Ya no existe o no se puede borrar — no es crítico
  }
};
