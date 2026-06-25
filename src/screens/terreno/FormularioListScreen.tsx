// ============================================================
// GEODAILY — Listado de Formularios (Técnico)
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { useAuth } from '../../store/AuthContext';
import { getFormulariosLocales } from '../../services/database';
import { Formulario } from '../../types';
import FormCard from '../../components/FormCard';
import LoadingSpinner from '../../components/LoadingSpinner';
import { TerrenoStackParamList } from '../../navigation/TerrenoNavigator';

type FormularioListScreenProps = {
  navigation: NativeStackNavigationProp<TerrenoStackParamList, 'TerrenoFormularioList'>;
};

/** Valida que un formulario tenga los campos esenciales para renderizar */
const isValidFormulario = (f: any): f is import('../../types').Formulario => {
  if (!f || !f.id || !f.tipo) return false;
  if (!f.beneficiario || typeof f.beneficiario !== 'object') return false;
  if (!f.beneficiario.nombre) return false;
  // Coordenadas pueden ser opcionales, pero si existen deben ser válidas
  return true;
};

const FormularioListScreen: React.FC<FormularioListScreenProps> = ({ navigation }) => {
  const { formularios, cargarFormularios } = useForm();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadForms = useCallback(async () => {
    try {
      // Técnico solo ve sus propios formularios
      const localForms = await getFormulariosLocales(user?.id);
      // Filtrar formularios inválidos para evitar white screen
      const validForms = localForms.filter(isValidFormulario);
      if (validForms.length < localForms.length) {
        console.warn(
          `[Listado] Se omitieron ${localForms.length - validForms.length} formularios inválidos`
        );
      }
      // Siempre actualizar contexto, incluso si está vacío (limpia datos de otro usuario)
      cargarFormularios(validForms);
    } catch (error) {
      console.warn('[Listado] Error cargando formularios locales:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [cargarFormularios, user?.id]);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  // Recargar al enfocar la pantalla
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

  const handleFormPress = (formulario: Formulario) => {
    navigation.navigate('FormularioDetail', { formulario });
  };

  const handleViewPDF = (formulario: Formulario) => {
    // Ahora manejado desde FormularioDetailScreen
    navigation.navigate('FormularioDetail', { formulario });
  };

  if (isLoading) {
    return <LoadingSpinner message="Cargando formularios..." fullScreen />;
  }

  // Safely filter formularios again just in case context has invalid ones
  const safeFormularios = formularios.filter(isValidFormulario);

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, SPACING.md) }]}>
        <Text style={styles.title}>Historial de Formularios</Text>
        <Text style={styles.count}>
          {safeFormularios.length} formulario(s)
        </Text>
      </View>

      {safeFormularios.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>No hay formularios registrados</Text>
          <Text style={styles.emptySubtext}>
            Completa un formulario desde el menú principal para verlo aquí
          </Text>
        </View>
      ) : (
        <FlatList
          data={safeFormularios}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FormCard
              formulario={item}
              onPress={handleFormPress}
              onViewPDF={handleViewPDF}
            />
          )}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + SPACING.xxl }]}
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
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
