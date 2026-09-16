// ============================================================
// GEODAILY — Otros Formatos
// ============================================================
// Lista de formatos institucionales adicionales a los 3 formularios
// principales (Encuesta Social AgroAmbiental, Visita Técnica):
// ingreso de beneficiarios, actas, autorizaciones y consentimientos.
// Fuente: Nuevos_Formatos_10_Sept.
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { DatosBeneficiario } from '../../types';

type OtrosFormatosScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: {
    params?: {
      beneficiario?: DatosBeneficiario;
    };
  };
};

type ItemFormato = {
  id: string;
  icon: string;
  titulo: string;
  subtitulo: string;
  ruta?: string;
};

const FORMATOS: ItemFormato[] = [
  {
    id: 'ingreso_beneficiarios',
    icon: '📋',
    titulo: 'Formato Ingreso de Beneficiarios',
    subtitulo: 'PA. 2 FO. 31 — Planilla de beneficiarios nuevos por vereda',
    ruta: 'FormatoIngresoBeneficiarios',
  },
  {
    id: 'acta_compromiso',
    icon: '📝',
    titulo: 'Acta de Compromiso',
    subtitulo: 'PA. 2 FO. 30 — Implementación de Unidades Productoras',
    ruta: 'ActaCompromiso',
  },
  {
    id: 'autorizacion_imagen',
    icon: '📷',
    titulo: 'Autorización Uso de Imagen',
    subtitulo: 'PA. 2 FO. 11 — Beneficiario mayor de edad',
    ruta: 'AutorizacionImagen',
  },
  {
    id: 'autorizacion_imagen_menor',
    icon: '👶',
    titulo: 'Autorización Uso de Imagen — Menores de Edad',
    subtitulo: 'PA. 2 FO. 11 — Requiere firma del acudiente',
    ruta: 'AutorizacionImagenMenor',
  },
  {
    id: 'consentimiento_datos',
    icon: '🔒',
    titulo: 'Consentimiento Informado y Tratamiento de Datos',
    subtitulo: 'PA. 2 FO. 32 — Protección de datos personales',
    ruta: 'ConsentimientoDatos',
  },
  {
    id: 'evaluacion_eca',
    icon: '✅',
    titulo: 'Evaluación ECA 1',
    subtitulo: 'PA. 2 FO. 33 — Escuela de Campo para Agricultores',
    ruta: 'EvaluacionEca',
  },
];

const OtrosFormatosScreen: React.FC<OtrosFormatosScreenProps> = ({ navigation, route }) => {
  const beneficiario = route?.params?.beneficiario;

  const handlePress = (item: ItemFormato) => {
    if (item.ruta) {
      navigation.navigate(item.ruta, { beneficiario });
    } else {
      Alert.alert('Próximamente', `"${item.titulo}" estará disponible pronto.`);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Otros Formatos</Text>
      <Text style={styles.subtitle}>Formatos institucionales complementarios</Text>

      {FORMATOS.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={[styles.card, !item.ruta && styles.cardDisabled]}
          onPress={() => handlePress(item)}
          activeOpacity={0.7}
        >
          <Text style={styles.cardIcon}>{item.icon}</Text>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>{item.titulo}</Text>
            <Text style={styles.cardDesc}>{item.subtitulo}</Text>
          </View>
          {item.ruta ? (
            <Text style={styles.arrow}>›</Text>
          ) : (
            <View style={styles.badgeProximamente}>
              <Text style={styles.badgeProximamenteText}>Próximamente</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
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
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.secondary,
    ...SHADOWS.md,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  cardIcon: {
    fontSize: 30,
    marginRight: SPACING.md,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  arrow: {
    fontSize: 26,
    color: COLORS.textLight,
  },
  badgeProximamente: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeProximamenteText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
});

export default OtrosFormatosScreen;
