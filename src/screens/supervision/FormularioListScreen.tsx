// ============================================================
// GEODAILY — Listado de Formularios (Supervisión)
// ============================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { getFormulariosLocales } from '../../services/database';
import { Formulario, FiltrosFormulario } from '../../types';
import FormCard from '../../components/FormCard';
import FilterBar from '../../components/FilterBar';
import LoadingSpinner from '../../components/LoadingSpinner';

type FormularioListScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const TIPO_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'visita_tecnica', label: 'Visitas Técnicas' },
  { value: 'plantacion', label: 'Plantaciones' },
];

const SYNC_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'synced', label: 'Sincronizados' },
  { value: 'pending', label: 'Pendientes' },
];

const FormularioListScreen: React.FC<FormularioListScreenProps> = ({ navigation }) => {
  const { formularios, cargarFormularios } = useForm();
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<FiltrosFormulario>({
    tipo: 'all',
    sincronizado: 'all',
  });

  const loadForms = useCallback(async () => {
    try {
      const localForms = await getFormulariosLocales();
      // Siempre actualizar contexto (limpia datos si el listado está vacío)
      cargarFormularios(localForms);
    } catch (error) {
      console.warn('[Supervision Listado] Error cargando:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [cargarFormularios]);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadForms();
    });
    return unsubscribe;
  }, [navigation, loadForms]);

  const onRefresh = () => {
    setRefreshing(true);
    loadForms();
  };

  const filteredForms = useMemo(() => {
    let result = [...formularios];

    if (filters.tipo && filters.tipo !== 'all') {
      result = result.filter((f) => f.tipo === filters.tipo);
    }
    if (filters.sincronizado === 'synced') {
      result = result.filter((f) => f.sincronizado);
    } else if (filters.sincronizado === 'pending') {
      result = result.filter((f) => !f.sincronizado);
    }

    return result.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [formularios, filters]);

  const handleFormPress = (form: Formulario) => {
    Alert.alert(
      form.beneficiario.nombre,
      `Tipo: ${form.tipo === 'visita_tecnica' ? 'Visita Técnica' : 'Plantación'}\n` +
        `Técnico: ${form.tecnico.nombre}\n` +
        `Municipio: ${form.beneficiario.municipio}\n` +
        `Actividad: ${form.actividad.descripcion}\n` +
        `Fecha: ${form.created_at}\n` +
        `Estado: ${form.sincronizado ? '✓ Sincronizado' : '⏳ Pendiente'}` +
        (form.pdf_url ? '\n\nPDF disponible' : ''),
      [
        { text: 'Cerrar', style: 'cancel' },
        ...(form.pdf_url
          ? [{ text: 'Ver PDF', onPress: () => handleViewPDF(form) }]
          : []),
      ]
    );
  };

  const handleViewPDF = (form: Formulario) => {
    if (form.pdf_url) {
      Alert.alert('PDF', `Abrir PDF: ${form.pdf_url}`);
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Cargando formularios..." fullScreen />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Formularios</Text>
        <Text style={styles.count}>{filteredForms.length} resultado(s)</Text>
      </View>

      <View style={styles.filtersContainer}>
        <FilterBar
          options={TIPO_FILTERS}
          selected={filters.tipo || 'all'}
          onSelect={(key) =>
            setFilters((prev) => ({
              ...prev,
              tipo: key as FiltrosFormulario['tipo'],
            }))
          }
        />
        <FilterBar
          options={SYNC_FILTERS}
          selected={filters.sincronizado || 'all'}
          onSelect={(key) =>
            setFilters((prev) => ({
              ...prev,
              sincronizado: key as FiltrosFormulario['sincronizado'],
            }))
          }
        />
      </View>

      {filteredForms.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>No se encontraron formularios</Text>
          <Text style={styles.emptySubtext}>
            {formularios.length === 0
              ? 'Aún no hay formularios registrados en el sistema'
              : 'No hay formularios que coincidan con los filtros seleccionados'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredForms}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FormCard
              formulario={item}
              onPress={handleFormPress}
              onViewPDF={handleViewPDF}
            />
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
  filtersContainer: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  listContent: {
    paddingVertical: SPACING.sm,
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
});

export default FormularioListScreen;
