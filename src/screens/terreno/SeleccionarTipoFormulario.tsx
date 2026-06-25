// ============================================================
// GEODAILY — Selección de Tipo de Formulario
// ============================================================

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { contarBorradores } from '../../store/FormDraftStore';

type SeleccionarTipoProps = {
  navigation: NativeStackNavigationProp<any>;
};

const SeleccionarTipoFormulario: React.FC<SeleccionarTipoProps> = ({ navigation }) => {
  const [borradorCount, setBorradorCount] = useState(0);

  useEffect(() => {
    const loadCount = async () => {
      const count = await contarBorradores();
      setBorradorCount(count);
    };
    loadCount();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      contarBorradores().then(setBorradorCount);
    });
    return unsubscribe;
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Selecciona el tipo de formulario</Text>

      <TouchableOpacity
        style={[styles.card, { borderLeftColor: '#2E7D32' }]}
        onPress={() => navigation.navigate('Formulario', { tipo: 'caracterizacion' })}
        activeOpacity={0.7}
      >
        <Text style={styles.cardIcon}>👥</Text>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>Caracterización Sociodemográfica</Text>
          <Text style={styles.cardDesc}>
            Registro completo de datos personales, familiares, educación y condiciones de vida del beneficiario
          </Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.card, { borderLeftColor: COLORS.roleTecnico }]}
        onPress={() => navigation.navigate('Formulario', { tipo: 'visita_tecnica' })}
        activeOpacity={0.7}
      >
        <Text style={styles.cardIcon}>🔍</Text>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>Visita Técnica</Text>
          <Text style={styles.cardDesc}>
            Seguimiento a beneficiarios, evaluación de cultivos y asistencia técnica
          </Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.card, { borderLeftColor: COLORS.primary }]}
        onPress={() => navigation.navigate('Formulario', { tipo: 'plantacion' })}
        activeOpacity={0.7}
      >
        <Text style={styles.cardIcon}>🌱</Text>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>Plantación</Text>
          <Text style={styles.cardDesc}>
            Registro de nuevas plantaciones, monitoreo de crecimiento y producción
          </Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.card, { borderLeftColor: COLORS.warning }]}
        onPress={() => navigation.navigate('FormulariosIncompletos')}
        activeOpacity={0.7}
      >
        <Text style={styles.cardIcon}>📝</Text>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>
            Formularios Incompletos {borradorCount > 0 && `(${borradorCount})`}
          </Text>
          <Text style={styles.cardDesc}>
            Continuar formularios guardados como borrador
          </Text>
        </View>
        <View style={styles.badgeContainer}>
          {borradorCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{borradorCount}</Text>
            </View>
          )}
          <Text style={styles.arrow}>›</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.lg,
    justifyContent: 'center',
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    ...SHADOWS.md,
  },
  cardIcon: {
    fontSize: 36,
    marginRight: SPACING.md,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  cardDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  arrow: {
    fontSize: 28,
    color: COLORS.textLight,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  badge: {
    backgroundColor: COLORS.warning,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.bold,
  },
});

export default SeleccionarTipoFormulario;
