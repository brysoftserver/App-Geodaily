// ============================================================
// GEODAILY — Selección de Tipo de Formulario
// ============================================================
// Recibe opcionalmente un beneficiario desde BeneficiarioDetailScreen
// para pre-cargar los datos en el formulario.
// ============================================================

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { contarBorradores } from '../../store/FormDraftStore';
import { useForm } from '../../store/FormContext';
import { DatosBeneficiario } from '../../types';

type SeleccionarTipoProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: {
    params: {
      beneficiario?: DatosBeneficiario;
    };
  };
};

const SeleccionarTipoFormulario: React.FC<SeleccionarTipoProps> = ({ navigation, route }) => {
  const { setBeneficiario } = useForm();
  const insets = useSafeAreaInsets();
  const [borradorCount, setBorradorCount] = useState(0);

  const beneficiario = route?.params?.beneficiario;

  // Si viene con beneficiario, pre-cargarlo en el contexto del formulario
  useEffect(() => {
    if (beneficiario) {
      setBeneficiario(beneficiario);
    }
  }, [beneficiario, setBeneficiario]);

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
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]}
      showsVerticalScrollIndicator={false}
    >
      {beneficiario && (
        <View style={styles.beneficiarioBanner}>
          <Text style={styles.beneficiarioBannerIcon}>👤</Text>
          <View style={styles.beneficiarioBannerInfo}>
            <Text style={styles.beneficiarioBannerLabel}>Formulario para:</Text>
            <Text style={styles.beneficiarioBannerName}>{beneficiario.nombre}</Text>
            {beneficiario.cedula && (
              <Text style={styles.beneficiarioBannerDetail}>C.C. {beneficiario.cedula}</Text>
            )}
          </View>
        </View>
      )}

      <Text style={styles.title}>Selecciona el tipo de formulario</Text>

      <TouchableOpacity
        style={[styles.card, { borderLeftColor: '#2E7D32' }]}
        onPress={() => navigation.navigate('FormularioCaracterizacion', {})}
        activeOpacity={0.7}
      >
        <Text style={styles.cardIcon}>🌿</Text>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>Encuesta Social AgroAmbiental</Text>
          <Text style={styles.cardDesc}>
            Registro completo de 52 preguntas: social, finca, productivo, análisis de suelo, agroambiental, recomendaciones y acompañamiento
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

      <TouchableOpacity
        style={[styles.card, { borderLeftColor: COLORS.secondary }]}
        onPress={() => navigation.navigate('OtrosFormatos', { beneficiario })}
        activeOpacity={0.7}
      >
        <Text style={styles.cardIcon}>🗂️</Text>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>Otros Formatos</Text>
          <Text style={styles.cardDesc}>
            Ingreso de beneficiarios, actas, autorizaciones y consentimientos
          </Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    ...SHADOWS.sm,
  },
  cardIcon: {
    fontSize: 24,
    marginRight: SPACING.sm,
  },
  cardContent: {
    flex: 1,
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
    lineHeight: 16,
  },
  arrow: {
    fontSize: 22,
    color: COLORS.textLight,
    marginLeft: SPACING.xs,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  badge: {
    backgroundColor: COLORS.warning,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: '#fff',
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.bold,
  },
  // ─── Banner de beneficiario ─────────────────────────────────
  beneficiarioBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.secondary + '15',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.secondary + '30',
  },
  beneficiarioBannerIcon: {
    fontSize: 26,
    marginRight: SPACING.sm,
  },
  beneficiarioBannerInfo: {
    flex: 1,
  },
  beneficiarioBannerLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  beneficiarioBannerName: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  beneficiarioBannerDetail: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
});

export default SeleccionarTipoFormulario;
