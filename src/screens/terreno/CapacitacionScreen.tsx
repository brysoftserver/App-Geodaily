// ============================================================
// GEODAILY — Educación y Capacitaciones (Técnico de Campo)
// ============================================================

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

interface MaterialEducativo {
  id: string;
  titulo: string;
  descripcion: string;
  // Módulo devuelto por require(): Metro lo empaqueta como asset local.
  archivo: number;
}

// Documentos oficiales del proyecto (Base_de_datos_beneficiarios ↔
// Logos_imagenes_pdf/Educacion_tecnicos). Se empaquetan con la app (require)
// para que estén disponibles sin conexión, igual que el resto de GEODAILY.
const MATERIALES: MaterialEducativo[] = [
  {
    id: 'colecta-muestras-suelo',
    titulo: 'Colecta de Muestras de Suelo y Fertilidad',
    descripcion: 'Guía para la toma de muestras de suelo en Puerto Rico, Caquetá.',
    archivo: require('../../../assets/educacion_tecnicos/colecta-muestras-suelo-fertilidad.pdf'),
  },
  {
    id: 'presentacion-proyecto-cacao-2026',
    titulo: 'Presentación Proyecto Cacao 2026',
    descripcion: 'Presentación oficial del proyecto de cacao para el técnico de campo.',
    archivo: require('../../../assets/educacion_tecnicos/presentacion-proyecto-cacao-2026.pdf'),
  },
];

const CapacitacionScreen: React.FC = () => {
  const [cargandoId, setCargandoId] = useState<string | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pdfTitulo, setPdfTitulo] = useState('');

  const resolverUri = useCallback(async (material: MaterialEducativo) => {
    const asset = Asset.fromModule(material.archivo);
    if (!asset.localUri) {
      await asset.downloadAsync();
    }
    if (!asset.localUri) {
      throw new Error('No se pudo resolver el archivo local');
    }
    return asset.localUri;
  }, []);

  /**
   * El WebView de Android no tiene visor de PDF nativo (mismo caso que en
   * FormularioDetailScreen: un file://…/x.pdf carga en blanco), así que ahí
   * se abre con el visor del sistema vía content://. En iOS el WKWebView sí
   * renderiza el PDF embebido directamente.
   */
  const handleAbrir = useCallback(
    async (material: MaterialEducativo) => {
      setCargandoId(material.id);
      try {
        const uri = await resolverUri(material);

        if (Platform.OS !== 'android') {
          setPdfTitulo(material.titulo);
          setPdfUri(uri);
          return;
        }

        try {
          const contentUri = await FileSystem.getContentUriAsync(uri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
            type: 'application/pdf',
          });
        } catch (e) {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
              mimeType: 'application/pdf',
              UTI: 'com.adobe.pdf',
            });
          } else {
            Alert.alert(
              'No se puede abrir el PDF',
              'No hay un lector de PDF instalado en este dispositivo.'
            );
          }
        }
      } catch (e) {
        Alert.alert('Error', 'No se pudo abrir el documento');
      } finally {
        setCargandoId(null);
      }
    },
    [resolverUri]
  );

  const handleCerrarPdf = useCallback(() => {
    setPdfUri(null);
    setPdfTitulo('');
  }, []);

  if (pdfUri) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.pdfEmbedHeader}>
          <Text style={styles.pdfEmbedTitle} numberOfLines={1}>
            📄 {pdfTitulo}
          </Text>
          <TouchableOpacity onPress={handleCerrarPdf} style={styles.pdfEmbedCloseBtn}>
            <Text style={styles.pdfEmbedCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <WebView
          source={{ uri: pdfUri }}
          style={styles.webview}
          originWhitelist={['file://', 'http://', 'https://']}
          allowFileAccess={true}
          javaScriptEnabled={false}
          scalesPageToFit={Platform.OS === 'android'}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.pageTitle}>📚 Educación y Capacitaciones</Text>
        <Text style={styles.pageSubtitle}>
          Material técnico oficial del proyecto para consulta en campo.
        </Text>

        {MATERIALES.map((material) => (
          <TouchableOpacity
            key={material.id}
            style={styles.card}
            onPress={() => handleAbrir(material)}
            activeOpacity={0.7}
            disabled={cargandoId !== null}
          >
            <View style={styles.cardIcon}>
              <Text style={styles.cardIconText}>📄</Text>
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle}>{material.titulo}</Text>
              <Text style={styles.cardDesc}>{material.descripcion}</Text>
            </View>
            {cargandoId === material.id ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Text style={styles.cardArrow}>Abrir →</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  pageTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  pageSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  // --- Card ---
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  cardIconText: {
    fontSize: 18,
  },
  cardInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  cardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  cardDesc: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cardArrow: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
  // ---- Visor PDF embebido ----
  pdfEmbedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  pdfEmbedTitle: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginRight: SPACING.sm,
  },
  pdfEmbedCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.error + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pdfEmbedCloseText: {
    fontSize: 14,
    fontWeight: FONTS.weights.bold,
    color: COLORS.error,
  },
  webview: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
});

export default CapacitacionScreen;
