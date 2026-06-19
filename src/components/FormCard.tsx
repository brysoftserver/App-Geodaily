// ============================================================
// GEODAILY — Componente de Tarjeta de Formulario
// ============================================================

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { Formulario } from '../types';
import { formatFecha, formatCoordenadas, truncarTexto, capitalizar } from '../utils/formatters';

interface FormCardProps {
  formulario: Formulario;
  onPress: (formulario: Formulario) => void;
  onViewPDF?: (formulario: Formulario) => void;
}

const FormCard: React.FC<FormCardProps> = ({ formulario, onPress, onViewPDF }) => {
  const getTipoColor = () => {
    return formulario.tipo === 'visita_tecnica' ? COLORS.roleTecnico : COLORS.primary;
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(formulario)}
      activeOpacity={0.7}
    >
      <View style={[styles.tipoBadge, { backgroundColor: getTipoColor() }]}>
        <Text style={styles.tipoText}>
          {formulario.tipo === 'visita_tecnica' ? 'Visita Técnica' : 'Plantación'}
        </Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.beneficiario}>
          {truncarTexto(formulario.beneficiario.nombre, 40)}
        </Text>

        <Text style={styles.detalle}>
          {formulario.beneficiario.municipio}
          {formulario.beneficiario.vereda && ` — ${formulario.beneficiario.vereda}`}
        </Text>

        <View style={styles.footer}>
          <Text style={styles.fecha}>
            {formatFecha(formulario.created_at)}
          </Text>
          <Text style={styles.coordenadas}>
            {formatCoordenadas(
              formulario.coordenadas.latitud,
              formulario.coordenadas.longitud,
              4
            )}
          </Text>
        </View>

        {!formulario.sincronizado && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>Pendiente de sincronizar</Text>
          </View>
        )}
      </View>

      {onViewPDF && formulario.pdf_url && (
        <TouchableOpacity
          style={styles.pdfButton}
          onPress={() => onViewPDF(formulario)}
        >
          <Text style={styles.pdfButtonText}>PDF</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginHorizontal: SPACING.md,
    marginVertical: SPACING.xs,
    ...SHADOWS.sm,
    overflow: 'hidden',
  },
  tipoBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
    width: 32,
  },
  tipoText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.bold,
    transform: [{ rotate: '-90deg' }],
    width: 80,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: SPACING.md,
  },
  beneficiario: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  detalle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
  coordenadas: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
  pendingBadge: {
    backgroundColor: COLORS.warning + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    alignSelf: 'flex-start',
    marginTop: SPACING.xs,
  },
  pendingText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.warning,
  },
  pdfButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.error + '10',
  },
  pdfButtonText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.bold,
    color: COLORS.error,
  },
});

export default FormCard;
