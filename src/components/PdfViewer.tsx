// ============================================================
// GEODAILY — Visor de PDF interno
// ============================================================
// Muestra documentos PDF dentro de la app, sin abrir una app externa.
//
// Estrategia por plataforma:
//   · Android  → PDF.js renderizado a <canvas> dentro de un WebView
//                (el WebView de Android no tiene visor de PDF nativo).
//   · iOS      → WKWebView sí renderiza el PDF directamente (mejor zoom).
//   · Web      → el navegador renderiza el PDF en el iframe.
//
// Todo lo necesario (react-native-webview + PDF.js) ya viene empaquetado,
// así que este visor se distribuye por OTA sin recompilar la APK.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  SafeAreaView,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import { crearHtmlVisorPdf } from '../services/pdfRenderer.service';

interface PdfViewerProps {
  /** Módulo devuelto por require() del archivo PDF. */
  archivo: number;
  titulo: string;
  onClose: () => void;
  /** Clave estable para cachear el HTML generado. */
  cacheKey: string;
  /** Último recurso: delegar en una app externa si el visor falla. */
  onFallback?: () => void;
}

type Estado = 'cargando' | 'listo' | 'error';

const PdfViewer: React.FC<PdfViewerProps> = ({
  archivo,
  titulo,
  onClose,
  cacheKey,
  onFallback,
}) => {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [fuente, setFuente] = useState<string | null>(null);
  const [mensajeError, setMensajeError] = useState('');
  const [progreso, setProgreso] = useState<{ page: number; total: number } | null>(null);
  const [intento, setIntento] = useState(0);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelado = false;

    const preparar = async () => {
      setEstado('cargando');
      setMensajeError('');
      setFuente(null);
      setProgreso(null);

      try {
        const asset = Asset.fromModule(archivo);
        if (!asset.localUri) {
          await asset.downloadAsync();
        }
        const pdfUri = asset.localUri;
        if (!pdfUri) {
          throw new Error('No se encontró el archivo del documento.');
        }

        // Android necesita el HTML con PDF.js; iOS y web abren el PDF tal cual.
        const uri =
          Platform.OS === 'android'
            ? await crearHtmlVisorPdf(archivo, cacheKey)
            : pdfUri;

        if (cancelado) return;
        setFuente(uri);
        setEstado('listo');
      } catch (error) {
        if (cancelado) return;
        const detalle = error instanceof Error ? error.message : 'Error desconocido';
        setMensajeError(detalle);
        setEstado('error');
      }
    };

    preparar();

    return () => {
      cancelado = true;
    };
  }, [archivo, cacheKey, intento]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'progress' && data.payload) {
        setProgreso({ page: data.payload.page, total: data.payload.total });
        return;
      }
      if (data.type === 'done') {
        setProgreso(null);
        return;
      }
      if (data.type === 'error') {
        setMensajeError(String(data.payload || 'No se pudo mostrar el documento.'));
        setEstado('error');
      }
    } catch (error) {
      // Mensajes que no son JSON se ignoran.
    }
  }, []);

  const handleReintentar = useCallback(() => setIntento((valor) => valor + 1), []);

  const subtitulo =
    estado === 'cargando'
      ? 'Preparando documento…'
      : progreso
        ? `Página ${progreso.page} de ${progreso.total}`
        : 'PDF';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          📄 {titulo}
        </Text>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Cerrar documento"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {estado === 'cargando' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Preparando documento…</Text>
            <Text style={styles.loadingHint}>La primera apertura puede tardar unos segundos.</Text>
          </View>
        )}

        {estado === 'error' && (
          <View style={styles.centered}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>No se pudo mostrar el documento</Text>
            <Text style={styles.errorDetail}>{mensajeError}</Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleReintentar}>
              <Text style={styles.primaryBtnText}>Reintentar</Text>
            </TouchableOpacity>

            {onFallback && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={onFallback}>
                <Text style={styles.secondaryBtnText}>Abrir con otra aplicación</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {estado === 'listo' && fuente && (
          <WebView
            key={fuente}
            source={{ uri: fuente }}
            style={styles.webview}
            originWhitelist={['*']}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            javaScriptEnabled
            domStorageEnabled={false}
            mixedContentMode="always"
            androidLayerType="hardware"
            onMessage={handleMessage}
            onError={() => {
              setMensajeError('El visor interno no pudo cargar el archivo.');
              setEstado('error');
            }}
            setSupportMultipleWindows={false}
            textZoom={100}
          />
        )}
      </View>

      {estado === 'listo' && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>{subtitulo}</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  closeText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.bold,
  },
  content: {
    flex: 1,
    backgroundColor: '#525659',
  },
  webview: {
    flex: 1,
    backgroundColor: '#525659',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  loadingHint: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: 34,
    marginBottom: SPACING.sm,
  },
  errorTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  errorDetail: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  primaryBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  secondaryBtn: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  secondaryBtnText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textDecorationLine: 'underline',
  },
  footer: {
    paddingVertical: SPACING.xs + 2,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  footerText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
});

export default PdfViewer;
