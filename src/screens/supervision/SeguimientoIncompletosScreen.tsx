// ============================================================
// GEODAILY — Seguimientos Incompletos (Borradores)
// ============================================================
// Calcada de FormulariosIncompletosScreen.tsx (técnico): lista los
// seguimientos que se autoguardaron a medio llenar (se salió o cerró la
// app antes de presionar "Guardar Seguimiento") para continuarlos o
// descartarlos. Nunca se sincronizan mientras estén aquí.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { getSeguimientosIncompletos, eliminarSeguimientoLocal, SeguimientoLocal } from '../../services/database';
import { formatFecha } from '../../utils/formatters';
import LoadingSpinner from '../../components/LoadingSpinner';

type SeguimientoIncompletosScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const SeguimientoIncompletosScreen: React.FC<SeguimientoIncompletosScreenProps> = ({ navigation }) => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [borradores, setBorradores] = useState<SeguimientoLocal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const cargar = useCallback(async () => {
    const data = await getSeguimientosIncompletos(user?.id);
    setBorradores(data);
    setIsLoading(false);
    setRefreshing(false);
  }, [user?.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', cargar);
    return unsubscribe;
  }, [navigation, cargar]);

  const onRefresh = () => {
    setRefreshing(true);
    cargar();
  };

  const continuar = (borrador: SeguimientoLocal) => {
    navigation.navigate('SeguimientoForm', { seguimientoId: borrador.id });
  };

  const eliminar = (borrador: SeguimientoLocal) => {
    Alert.alert(
      'Eliminar borrador',
      `¿Estás seguro de eliminar el borrador "${borrador.actividad || 'sin actividad'}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await eliminarSeguimientoLocal(borrador.id);
            cargar();
          },
        },
      ]
    );
  };

  if (isLoading) {
    return <LoadingSpinner message="Cargando borradores..." fullScreen />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Borradores Guardados</Text>
        <Text style={styles.count}>{borradores.length} borrador(es)</Text>
      </View>

      {borradores.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📝</Text>
          <Text style={styles.emptyText}>No hay seguimientos incompletos</Text>
          <Text style={styles.emptySubtext}>
            Si sales o cierras la app antes de presionar &quot;Guardar Seguimiento&quot;, el borrador aparecerá aquí para continuarlo después.
          </Text>
        </View>
      ) : (
        <FlatList
          data={borradores}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + SPACING.xxl }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.draftCard}
              onPress={() => continuar(item)}
              onLongPress={() => eliminar(item)}
              activeOpacity={0.7}
            >
              <View style={styles.draftHeader}>
                <Text style={styles.draftType} numberOfLines={1} ellipsizeMode="tail">
                  {item.actividad || 'Sin actividad todavía'}
                </Text>
                <Text style={styles.draftStep}>Incompleto</Text>
              </View>

              <View style={styles.draftBody}>
                {item.objetivo_visita ? (
                  <Text style={styles.draftField} numberOfLines={1} ellipsizeMode="tail">
                    <Text style={styles.fieldLabel}>Objetivo: </Text>
                    {item.objetivo_visita}
                  </Text>
                ) : null}
                <Text style={styles.draftField}>
                  <Text style={styles.fieldLabel}>Evidencias: </Text>
                  {item.fotos.length} foto(s), {item.videos.length} video(s)
                  {item.firma_beneficiario || item.firma_autor ? ', con firma' : ''}
                </Text>
              </View>

              <View style={styles.draftFooter}>
                <Text style={styles.savedAt}>💾 {formatFecha(item.updated_at)}</Text>
                <Text style={styles.continueHint}>Tocar para continuar</Text>
              </View>
            </TouchableOpacity>
          )}
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
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  count: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    backgroundColor: COLORS.background,
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
    color: COLORS.textSecondary,
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
    gap: SPACING.xs,
  },
  draftType: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  draftStep: {
    flexShrink: 0,
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
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
  },
  savedAt: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  continueHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.info,
    fontWeight: FONTS.weights.medium,
  },
});

export default SeguimientoIncompletosScreen;
