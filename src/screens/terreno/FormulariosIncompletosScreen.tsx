// ============================================================
// GEODAILY — Lista de Formularios Incompletos (Borradores)
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { cargarBorradores, eliminarBorrador, FormDraft } from '../../store/FormDraftStore';
import LoadingSpinner from '../../components/LoadingSpinner';

type FormulariosIncompletosScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const FormulariosIncompletosScreen: React.FC<FormulariosIncompletosScreenProps> = ({ navigation }) => {
  const [drafts, setDrafts] = useState<FormDraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDrafts = useCallback(async () => {
    try {
      const loaded = await cargarBorradores();
      setDrafts(loaded);
    } catch (error) {
      console.warn('[Incompletos] Error cargando borradores:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadDrafts();
    });
    return unsubscribe;
  }, [navigation, loadDrafts]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDrafts();
  };

  const handleContinueDraft = (draft: FormDraft) => {
    navigation.navigate('Formulario', {
      tipo: draft.tipo || 'visita_tecnica',
      draftId: draft.id,
    });
  };

  const handleDeleteDraft = (draft: FormDraft) => {
    Alert.alert(
      'Eliminar borrador',
      `¿Estás seguro de eliminar el borrador de ${draft.tecnico?.nombre || 'desconocido'}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await eliminarBorrador(draft.id);
            loadDrafts();
          },
        },
      ]
    );
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Fecha desconocida';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Cargando borradores..." fullScreen />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Borradores Guardados</Text>
        <Text style={styles.count}>
          {drafts.length} borrador(es)
        </Text>
      </View>

      {drafts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📝</Text>
          <Text style={styles.emptyText}>No hay formularios incompletos</Text>
          <Text style={styles.emptySubtext}>
            Los formularios guardados como borrador aparecerán aquí para que puedas continuarlos después
          </Text>
        </View>
      ) : (
        <FlatList
          data={drafts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.draftCard}
              onPress={() => handleContinueDraft(item)}
              onLongPress={() => handleDeleteDraft(item)}
              activeOpacity={0.7}
            >
              <View style={styles.draftHeader}>
                <Text style={styles.draftType}>
                  {item.tipo === 'plantacion' ? '🌱 Plantación' : '🔍 Visita Técnica'}
                </Text>
                <Text style={styles.draftStep}>
                  Paso {item.step || 1} de 4
                </Text>
              </View>

              <View style={styles.draftBody}>
                <Text style={styles.draftField}>
                  <Text style={styles.fieldLabel}>Técnico: </Text>
                  {item.tecnico?.nombre || '—'}
                </Text>
                <Text style={styles.draftField}>
                  <Text style={styles.fieldLabel}>Beneficiario: </Text>
                  {item.beneficiario?.nombre || '—'}
                </Text>
                {item.beneficiario?.municipio && (
                  <Text style={styles.draftField}>
                    <Text style={styles.fieldLabel}>Ubicación: </Text>
                    {item.beneficiario.municipio}
                    {item.beneficiario.departamento ? `, ${item.beneficiario.departamento}` : ''}
                  </Text>
                )}
              </View>

              <View style={styles.draftFooter}>
                <Text style={styles.savedAt}>
                  💾 {formatDate(item.updated_at)}
                </Text>
                <Text style={styles.continueHint}>Tocar para continuar</Text>
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  count: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  listContent: {
    padding: SPACING.md,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  emptySubtext: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  draftCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning,
    ...SHADOWS.sm,
  },
  draftHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  draftType: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  draftStep: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.warning,
    fontWeight: FONTS.weights.medium,
    backgroundColor: COLORS.warning + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  draftBody: {
    marginBottom: SPACING.sm,
  },
  draftField: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  fieldLabel: {
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  draftFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    paddingTop: SPACING.sm,
  },
  savedAt: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
  continueHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.info,
    fontWeight: FONTS.weights.medium,
  },
});

export default FormulariosIncompletosScreen;
