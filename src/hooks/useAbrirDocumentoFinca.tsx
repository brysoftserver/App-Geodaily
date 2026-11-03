// ============================================================
// GEODAILY — Abrir un documento de la finca (PDF dentro de la app)
// ============================================================
// Antes cada pantalla lo abría con FileSystem.downloadAsync + Sharing, que no
// existen en el navegador (fallaba en silencio: "no pasa nada") y en el
// teléfono mandaban el PDF al selector "Abrir con…" en vez de mostrarlo.
//
//   · Teléfono: el PDF se descarga a caché con el token y se muestra en el
//     visor interno (PdfViewer). Otros formatos (Word, Excel…) siguen
//     entregándose a una app externa, porque la app no los puede mostrar.
//   · Web: se abre en una pestaña nueva (el navegador ya muestra PDF e
//     imágenes), con el token como query param.
// ============================================================

import React, { useCallback, useState } from 'react';
import { Modal, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import PdfViewer from '../components/PdfViewer';
import { API_CONFIG } from '../theme';
import { cabecerasDeArchivo } from '../services/archivos.service';
import { DocumentoDeFormulario } from '../services/documentos.service';
import { avisar } from '../utils/dialogos';

const esPdf = (doc: DocumentoDeFormulario): boolean =>
  !!doc.mimetype?.toLowerCase().includes('pdf') || doc.nombre.toLowerCase().endsWith('.pdf');

export const useAbrirDocumentoFinca = () => {
  const [abriendoId, setAbriendoId] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ uri: string; titulo: string; key: string } | null>(null);

  const abrirDocumento = useCallback(
    async (doc: DocumentoDeFormulario) => {
      if (abriendoId) return;
      const url = doc.url.startsWith('http') ? doc.url : `${API_CONFIG.BASE_URL}${doc.url}`;

      if (Platform.OS === 'web') {
        // window.open() debe ser lo primero, antes de cualquier await, o el
        // navegador lo bloquea como pop-up.
        const ventana = window.open('', '_blank');
        if (!ventana) {
          avisar('Ventana bloqueada', 'Habilita las ventanas emergentes para ver el documento.');
          return;
        }
        try {
          const headers = await cabecerasDeArchivo();
          const token = headers.Authorization?.replace('Bearer ', '');
          ventana.location.href = token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;
        } catch (error) {
          console.warn('[Documento finca] No se pudo abrir (web):', doc.id, error);
          ventana.close();
          avisar('Error', 'No se pudo abrir el documento.');
        }
        return;
      }

      setAbriendoId(doc.id);
      try {
        const headers = await cabecerasDeArchivo();
        const extension = doc.nombre.includes('.') ? doc.nombre.split('.').pop() : 'dat';
        // Con marca de tiempo: ni la caché del visor ni la del disco deben servir una versión vieja.
        const sufijo = `${doc.id}_${Date.now()}`;
        const { uri, status } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}doc_${sufijo}.${extension}`, { headers });
        if (status !== 200) throw new Error(`Descarga fallida (${status})`);

        if (esPdf(doc)) {
          setPdf({ uri, titulo: doc.nombre, key: `doc_${sufijo}` });
        } else if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: doc.mimetype });
        } else {
          avisar('Documento descargado', `Guardado en: ${uri}`);
        }
      } catch (error) {
        console.warn('[Documento finca] No se pudo abrir:', doc.id, error);
        avisar('Error', 'No se pudo abrir el documento. Verifica tu conexión.');
      } finally {
        setAbriendoId(null);
      }
    },
    [abriendoId]
  );

  const visor = (
    <Modal visible={pdf !== null} animationType="slide" onRequestClose={() => setPdf(null)}>
      {pdf && (
        <PdfViewer
          archivo={pdf.uri}
          titulo={pdf.titulo}
          cacheKey={pdf.key}
          onClose={() => setPdf(null)}
          onFallback={async () => {
            if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
          }}
        />
      )}
    </Modal>
  );

  return { abrirDocumento, abriendoId, visor };
};
