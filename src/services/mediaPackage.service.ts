// ============================================================
// GEODAILY — Paquete de Media (ZIP de fotos/videos de un formulario)
// ============================================================
// Descarga todas las fotos y videos que el servidor tiene asociados a un
// formulario y arma un único .zip para compartir — pensado para cuando un
// coordinador pide "las fotos o videos aparte" del técnico: en vez de
// reenviar archivo por archivo, se genera un paquete con todo.
//
// Se usa el servidor como única fuente de verdad (fetchArchivosDeFormulario)
// en vez de las URIs locales del formulario: así funciona igual desde el
// teléfono del técnico que capturó la visita que desde el de un coordinador
// que solo la está revisando.
// ============================================================

import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import { Formulario } from '../types';
import { fetchArchivosDeFormulario, cabecerasDeArchivo, urlDeArchivo } from './archivos.service';
import { descargarBlobEnNavegador } from '../utils/webDownload';

const sanitizarNombre = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60);

/**
 * Descarga fotos y videos de un formulario, arma un .zip y abre el diálogo
 * de compartir del sistema. No lanza excepciones: los errores se muestran
 * con Alert y la función simplemente retorna.
 */
export const descargarPaqueteMedia = async (formulario: Formulario): Promise<void> => {
  const archivos = await fetchArchivosDeFormulario(formulario.id);
  const evidencias = archivos.filter((a) => a.tipo === 'foto' || a.tipo === 'video');

  if (evidencias.length === 0) {
    Alert.alert(
      'Sin evidencias',
      'No se encontraron fotos ni videos en el servidor para este formulario (o no hay conexión a internet).'
    );
    return;
  }

  const headers = await cabecerasDeArchivo();
  const nombreBenef = sanitizarNombre(formulario.beneficiario?.nombre || 'beneficiario');
  const nombreZip = `Evidencias_${nombreBenef}_${formulario.id.slice(0, 8)}.zip`;

  // En web no existe FileSystem.cacheDirectory (es del dispositivo, no del
  // navegador) — expo-file-system/expo-sharing no aplican ahí. `fetch` SÍ
  // puede mandar la cabecera Authorization (a diferencia de <img>/<video>),
  // así que el zip se arma en memoria y se descarga con un <a download>.
  if (Platform.OS === 'web') {
    const zipWeb = new JSZip();
    let descargadosWeb = 0;
    for (const archivo of evidencias) {
      try {
        const carpeta = archivo.tipo === 'video' ? 'videos' : 'fotos';
        const nombreArchivo = archivo.filename || `${archivo.tipo}_${archivo.id}`;
        const respuesta = await fetch(urlDeArchivo(archivo), { headers });
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const blob = await respuesta.blob();
        zipWeb.file(`${carpeta}/${nombreArchivo}`, blob);
        descargadosWeb++;
      } catch (err) {
        console.warn('[MediaPackage] No se pudo descargar', archivo.filename, err);
      }
    }

    if (descargadosWeb === 0) {
      Alert.alert('Error', 'No se pudo descargar ninguna evidencia. Verifica tu conexión e intenta de nuevo.');
      return;
    }
    if (descargadosWeb < evidencias.length) {
      Alert.alert(
        'Paquete parcial',
        `Se incluyeron ${descargadosWeb} de ${evidencias.length} evidencias — algunas no se pudieron descargar.`
      );
    }

    const zipBlob = await zipWeb.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    descargarBlobEnNavegador(zipBlob, nombreZip);
    return;
  }

  const tmpDir = `${FileSystem.cacheDirectory}media_${formulario.id}_${Date.now()}/`;
  const zip = new JSZip();
  let descargados = 0;

  try {
    await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true });

    for (const archivo of evidencias) {
      try {
        const carpeta = archivo.tipo === 'video' ? 'videos' : 'fotos';
        const nombreArchivo = archivo.filename || `${archivo.tipo}_${archivo.id}`;
        const destinoLocal = `${tmpDir}${nombreArchivo}`;

        const descarga = await FileSystem.downloadAsync(urlDeArchivo(archivo), destinoLocal, { headers });
        const base64 = await FileSystem.readAsStringAsync(descarga.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        zip.file(`${carpeta}/${nombreArchivo}`, base64, { base64: true });
        await FileSystem.deleteAsync(descarga.uri, { idempotent: true });
        descargados++;
      } catch (err) {
        // Un archivo fallido no debe tumbar el paquete completo — se sigue
        // con el resto y al final se avisa si faltó alguno.
        console.warn('[MediaPackage] No se pudo descargar', archivo.filename, err);
      }
    }
  } finally {
    await FileSystem.deleteAsync(tmpDir, { idempotent: true }).catch(() => {});
  }

  if (descargados === 0) {
    Alert.alert('Error', 'No se pudo descargar ninguna evidencia. Verifica tu conexión e intenta de nuevo.');
    return;
  }

  const zipBase64 = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const zipPath = `${FileSystem.cacheDirectory}${nombreZip}`;
  await FileSystem.writeAsStringAsync(zipPath, zipBase64, { encoding: FileSystem.EncodingType.Base64 });

  if (descargados < evidencias.length) {
    Alert.alert(
      'Paquete parcial',
      `Se incluyeron ${descargados} de ${evidencias.length} evidencias — algunas no se pudieron descargar. Se compartirá el paquete con lo disponible.`
    );
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(zipPath, { mimeType: 'application/zip', dialogTitle: 'Descargar Media' });
  } else {
    Alert.alert('Guardado', `Paquete guardado en:\n${zipPath}`);
  }
};
