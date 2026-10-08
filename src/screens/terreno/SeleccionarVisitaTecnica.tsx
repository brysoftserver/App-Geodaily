// ============================================================
// GEODAILY — Selección de Visita Técnica
// ============================================================
// Reemplaza el "boseto" que antes abría directamente el formulario de
// visita técnica. Ahora se muestran UN BOTÓN POR VISITA (definidos en
// `utils/visitaTecnica.ts`), así se pueden ir agregando Visita 3, 4, …
// sin tocar esta pantalla.
// ============================================================

import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { DatosBeneficiario } from '../../types';
import { VISITAS_TECNICAS } from '../../utils/visitaTecnica';

type SeleccionarVisitaProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: {
    params: {
      beneficiario?: DatosBeneficiario;
      visitaNumero?: number;
    };
  };
};

const SeleccionarVisitaTecnicaScreen: React.FC<SeleccionarVisitaProps> = ({ navigation, route }) => {
  const { setBeneficiario } = useForm();
  const insets = useSafeAreaInsets();

  const beneficiario = route?.params?.beneficiario;

  // Pre-cargar el beneficiario en el contexto del formulario (mismo patrón
  // que SeleccionarTipoFormulario) para que el formulario de la visita lo
  // encuentre ya listo aunque venga de un borrador o del detalle.
  useEffect(() => {
    if (beneficiario) {
      setBeneficiario(beneficiario);
    }
  }, [beneficiario, setBeneficiario]);

  const abrirVisita = (numero: number) => {
    navigation.navigate('VisitaTecnicaForm', {
      visitaNumero: numero,
      beneficiario,
    });
  };

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
            <Text style={styles.beneficiarioBannerLabel}>Visita para:</Text>
            <Text style={styles.beneficiarioBannerName}>{beneficiario.nombre}</Text>
            {!!beneficiario.cedula && (
              <Text style={styles.beneficiarioBannerDetail}>C.C. {beneficiario.cedula}</Text>
            )}
          </View>
        </View>
      )}

      <Text style={styles.title}>Selecciona la visita</Text>
      <Text style={styles.subtitle}>
        Cada visita guarda su propio formulario y evidencia.
      </Text>

      {VISITAS_TECNICAS.map((visita) => (
        <TouchableOpacity
          key={visita.numero}
          style={[styles.card, { borderLeftColor: visita.color }]}
          onPress={() => abrirVisita(visita.numero)}
          activeOpacity={0.7}
        >
          <Text style={styles.cardIcon}>{visita.icono}</Text>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>{visita.titulo}</Text>
            <Text style={styles.cardDesc}>{visita.descripcion}</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      ))}

      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>ℹ️</Text>
        <Text style={styles.infoText}>
          Muy pronto se habilitarán las demás visitas (3, 4, …). Si un formulario queda
          incompleto, se guarda como borrador y lo encuentras en “Formularios Incompletos”.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
  },
  beneficiarioBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  beneficiarioBannerIcon: {
    fontSize: 28,
    marginRight: SPACING.sm,
  },
  beneficiarioBannerInfo: {
    flex: 1,
  },
  beneficiarioBannerLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  beneficiarioBannerName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  beneficiarioBannerDetail: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  title: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderLeftWidth: 5,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.md,
  },
  cardIcon: {
    fontSize: 30,
    marginRight: SPACING.md,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  arrow: {
    fontSize: 28,
    color: COLORS.textLight,
    marginLeft: SPACING.sm,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  infoIcon: {
    fontSize: 16,
    marginRight: SPACING.sm,
  },
  infoText: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
});

export default SeleccionarVisitaTecnicaScreen;
