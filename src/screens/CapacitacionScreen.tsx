// ============================================================
// GEODAILY — Educación y Capacitaciones (componente compartido)
// ============================================================
// Pantalla única para técnico, gerente y administrador.
// Antes existían dos versiones divergentes:
//   - terreno/CapacitacionScreen: abría los PDFs reales (offline)
//   - gerente/CapacitacionScreen: checklist con materiales ficticios
// que no abrían ningún documento. Este componente reúne ambas
// funcionalidades: catálogo real de documentos + seguimiento de avance.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Platform,
} from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import PdfViewer from '../components/PdfViewer';

// Persistencia local del avance de lectura.
const STORAGE_KEY_COMPLETADOS = '@geodaily/capacitaciones_completadas';

interface MaterialEducativo {
  id: string;
  titulo: string;
  descripcion: string;
  tema: string;
  // Módulo devuelto por require(): Metro lo empaqueta como asset local.
  archivo: number;
}

// Documentos oficiales del proyecto (assets/educacion_tecnicos). Se
// empaquetan con require() para que estén disponibles sin conexión.
const MATERIALES: MaterialEducativo[] = [
  {
    id: 'colecta-muestras-suelo',
    titulo: 'Colecta de Muestras de Suelo y Fertilidad',
    descripcion: 'Guía para la toma de muestras de suelo en Puerto Rico, Caquetá.',
    tema: 'Suelo',
    archivo: require('../../assets/educacion_tecnicos/colecta-muestras-suelo-fertilidad.pdf'),
  },
  {
    id: 'presentacion-proyecto-cacao-2026',
    titulo: 'Presentación Proyecto Cacao 2026',
    descripcion: 'Presentación oficial del proyecto de cacao para el técnico de campo.',
    tema: 'Producción',
    archivo: require('../../assets/educacion_tecnicos/presentacion-proyecto-cacao-2026.pdf'),
  },
  {
    id: 'guia-toma-evidencias-fotograficas',
    titulo: 'Guía para la Toma de Evidencias Fotográficas',
    descripcion: 'Lineamientos para capturar correctamente las evidencias fotográficas en campo.',
    tema: 'Evidencias',
    archivo: require('../../assets/educacion_tecnicos/guia-toma-evidencias-fotograficas.pdf'),
  },
];

const TEMAS = ['Todos', ...Array.from(new Set(MATERIALES.map((m) => m.tema)))];

const CapacitacionScreen: React.FC = () => {
  const [selectedTema, setSelectedTema] = useState('Todos');
  const [completados, setCompletados] = useState<Set<string>>(new Set());
  const [visor, setVisor] = useState<MaterialEducativo | null>(null);

  // Cargar avance guardado.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_COMPLETADOS)
      .then((json) => {
        if (json) setCompletados(new Set(JSON.parse(json) as string[]));
      })
      .catch((error) => console.warn('[Capacitacion] Error cargando avance:', error));
  }, []);

  const filteredMateriales = useMemo(() => {
    if (selectedTema === 'Todos') return MATERIALES;
    return MATERIALES.filter((m) => m.tema === selectedTema);
  }, [selectedTema]);

  const toggleCompletado = useCallback((id: string) => {
    setCompletados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      AsyncStorage.setItem(STORAGE_KEY_COMPLETADOS, JSON.stringify([...next])).catch(
        (error) => console.warn('[Capacitacion] Error guardando avance:', error)
      );
      return next;
    });
  }, []);

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
   * Último recurso: si el visor interno falla, se delega en el visor del
   * sistema con un content:// (Android) o se comparte el archivo. Ya no es
   * el camino principal — ver PdfViewer.
   */
  const abrirConAppExterna = useCallback(
    async (material: MaterialEducativo) => {
      try {
        const uri = await resolverUri(material);

        if (Platform.OS !== 'android') {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
              mimeType: 'application/pdf',
              UTI: 'com.adobe.pdf',
            });
          }
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
      }
    },
    [resolverUri]
  );

  const handleAbrir = useCallback((material: MaterialEducativo) => {
    setVisor(material);
  }, []);

  const handleCerrarVisor = useCallback(() => setVisor(null), []);

  // Visor interno (PDF.js en WebView) a pantalla completa.
  if (visor) {
    return (
      <PdfViewer
        archivo={visor.archivo}
        titulo={visor.titulo}
        cacheKey={visor.id}
        onClose={handleCerrarVisor}
        onFallback={() => abrirConAppExterna(visor)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.pageTitle}>📚 Educación y Capacitaciones</Text>
        <Text style={styles.pageSubtitle}>
          Material técnico oficial del proyecto para consulta en campo.
        </Text>
        <Text style={styles.progress}>
          {completados.size}/{MATERIALES.length} materiales completados
        </Text>

        {/* Filtro por tema */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.temaRow}
          contentContainerStyle={styles.temaRowContent}
        >
          {TEMAS.map((tema) => (
            <TouchableOpacity
              key={tema}
              style={[styles.temaChip, selectedTema === tema && styles.temaChipActive]}
              onPress={() => setSelectedTema(tema)}
            >
              <Text
                style={[
                  styles.temaChipText,
                  selectedTema === tema && styles.temaChipTextActive,
                ]}
              >
                {tema}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filteredMateriales.map((material) => {
          const isCompleted = completados.has(material.id);
          return (
            <View
              key={material.id}
              style={[styles.card, isCompleted && styles.cardCompleted]}
            >
              <TouchableOpacity
                style={styles.cardMain}
                onPress={() => handleAbrir(material)}
                activeOpacity={0.7}
              >
                <View style={styles.cardIcon}>
                  <Text style={styles.cardIconText}>📄</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text
                    style={[styles.cardTitle, isCompleted && styles.cardTitleCompleted]}
                  >
                    {material.titulo}
                  </Text>
                  <Text style={styles.cardDesc}>{material.descripcion}</Text>
                  <View style={styles.cardMeta}>
                    <View style={styles.temaBadge}>
                      <Text style={styles.temaBadgeText}>{material.tema}</Text>
                    </View>
                    <Text style={styles.typeLabel}>PDF</Text>
                  </View>
                </View>
                <Text style={styles.cardArrow}>Abrir →</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.checkboxHit}
                onPress={() => toggleCompletado(material.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isCompleted }}
                accessibilityLabel={`Marcar como completado: ${material.titulo}`}
              >
                <View style={[styles.checkbox, isCompleted && styles.checkboxDone]}>
                  {isCompleted && <Text style={styles.checkMark}>✓</Text>}
                </View>
              </TouchableOpacity>
            </View>
          );
        })}
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
    marginBottom: SPACING.xs,
  },
  progress: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginBottom: SPACING.md,
  },
  // --- Filtros por tema ---
  temaRow: {
    marginBottom: SPACING.md,
    flexGrow: 0,
  },
  temaRowContent: {
    paddingRight: SPACING.md,
  },
  temaChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  temaChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  temaChipText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  temaChipTextActive: {
    color: '#fff',
    fontWeight: FONTS.weights.semibold,
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
  cardCompleted: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.success,
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
  cardTitleCompleted: {
    color: COLORS.success,
  },
  cardDesc: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  temaBadge: {
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  temaBadgeText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  typeLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
  cardArrow: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
  // --- Check de completado ---
  checkboxHit: {
    marginLeft: SPACING.sm,
    paddingLeft: SPACING.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxDone: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  checkMark: {
    color: '#fff',
    fontWeight: FONTS.weights.bold,
    fontSize: 14,
  },
});

export default CapacitacionScreen;
