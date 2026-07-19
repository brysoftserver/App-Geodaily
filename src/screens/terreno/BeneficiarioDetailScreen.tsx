// ============================================================
// GEODAILY — Detalle del Beneficiario (Técnico)
// ============================================================
// Nivel 2 de la jerarquía: muestra la información del beneficiario
// y las acciones disponibles (Diligenciar Formulario, Ver visitas, etc.)
// ============================================================

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { Formulario, DatosBeneficiario } from '../../types';

type BeneficiarioDetailScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: {
    params: {
      beneficiario: DatosBeneficiario;
      visitas: Formulario[];
    };
  };
};

const ACCIONES = [
  {
    id: 'diligenciar',
    title: '📋 Diligenciar Formulario',
    subtitle: 'Capturar una visita técnica o caracterización para este beneficiario',
    color: COLORS.primary,
  },
  {
    id: 'historial',
    title: '📄 Ver visitas anteriores',
    subtitle: 'Historial completo de formularios registrados',
    color: COLORS.info,
  },
  {
    id: 'documentos',
    title: '📁 Documentos de la finca',
    subtitle: 'PDFs, imágenes y fotos de documentos asociados',
    color: COLORS.success,
  },
];

const BeneficiarioDetailScreen: React.FC<BeneficiarioDetailScreenProps> = ({ navigation, route }) => {
  const { beneficiario, visitas } = route.params;
  const insets = useSafeAreaInsets();

  const handleAccion = (accionId: string) => {
    switch (accionId) {
      case 'diligenciar':
        navigation.navigate('SeleccionarTipoFormulario', {
          beneficiario: {
            nombre: beneficiario.nombre,
            cedula: beneficiario.cedula,
            telefono: beneficiario.telefono,
            departamento: beneficiario.departamento || '',
            municipio: beneficiario.municipio || '',
            vereda: beneficiario.vereda || '',
            finca: beneficiario.finca || '',
          },
        });
        break;
      case 'historial':
        navigation.navigate('TerrenoFormularioList', {
          beneficiarioCedula: beneficiario.cedula,
        });
        break;
      case 'documentos':
        // Los documentos son de la finca (beneficiario), no de una visita:
        // sin estos parámetros la pantalla mostraba los del formulario en
        // curso, que puede ser de otro beneficiario o no existir.
        navigation.navigate('Documentos', {
          beneficiarioCedula: beneficiario.cedula,
          beneficiarioNombre: beneficiario.nombre,
        });
        break;
    }
  };

  const abrirDetalleVisita = (form: Formulario) => {
    navigation.navigate('FormularioDetail', { formulario: form });
  };

  // Últimas 5 visitas
  const visitasRecientes = [...visitas]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);

  const getTipoIcono = (tipo: string) => {
    switch (tipo) {
      case 'caracterizacion': return '👥';
      case 'visita_tecnica': return '🔧';
      default: return '📋';
    }
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: Math.max(insets.top, SPACING.lg) }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ─── Cabecera del beneficiario ────────────────────────── */}
      <View style={styles.header}>
        <View style={[styles.avatarLarge, { backgroundColor: COLORS.secondary + '25' }]}>
          <Text style={[styles.avatarLargeText, { color: COLORS.secondaryDark }]}>
            {beneficiario.nombre.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.headerName}>{beneficiario.nombre}</Text>
        {beneficiario.cedula ? (
          <Text style={styles.headerId}>C.C. {beneficiario.cedula}</Text>
        ) : null}
        <View style={styles.headerInfo}>
          <View style={styles.infoBadge}>
            <Text style={styles.infoBadgeText}>
              📍 {[beneficiario.vereda, beneficiario.municipio].filter(Boolean).join(', ')}
            </Text>
          </View>
          {beneficiario.finca ? (
            <View style={styles.infoBadge}>
              <Text style={styles.infoBadgeText}>🏠 {beneficiario.finca}</Text>
            </View>
          ) : null}
          {beneficiario.telefono ? (
            <View style={styles.infoBadge}>
              <Text style={styles.infoBadgeText}>📞 {beneficiario.telefono}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.visitaCount}>
          {visitas.length} visita(s) registrada(s)
        </Text>
      </View>

      {/* ─── Acciones ─────────────────────────────────────────── */}
      <View style={styles.accionesSection}>
        <Text style={styles.sectionTitle}>Acciones</Text>
        {ACCIONES.map((accion) => (
          <TouchableOpacity
            key={accion.id}
            style={[styles.accionCard, { borderLeftColor: accion.color }]}
            onPress={() => handleAccion(accion.id)}
            activeOpacity={0.7}
          >
            <View style={styles.accionContent}>
              <Text style={styles.accionTitle}>{accion.title}</Text>
              <Text style={styles.accionSubtitle}>{accion.subtitle}</Text>
            </View>
            <Text style={styles.accionArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ─── Visitas Recientes ────────────────────────────────── */}
      {visitasRecientes.length > 0 && (
        <View style={styles.visitasSection}>
          <Text style={styles.sectionTitle}>
            📅 Últimas visitas
          </Text>
          {visitasRecientes.map((visita, index) => (
            <TouchableOpacity
              key={visita.id}
              style={styles.visitaItem}
              onPress={() => abrirDetalleVisita(visita)}
              activeOpacity={0.7}
            >
              <View style={styles.visitaIcon}>
                <Text style={styles.visitaIconText}>{getTipoIcono(visita.tipo)}</Text>
              </View>
              <View style={styles.visitaInfo}>
                <Text style={styles.visitaTipo}>
                  {visita.tipo === 'caracterizacion' ? 'Caracterización'
                    : visita.tipo === 'visita_tecnica' ? 'Visita Técnica'
                    : 'Plantación'}
                </Text>
                <Text style={styles.visitaFecha}>
                  {new Date(visita.created_at).toLocaleDateString('es-CO', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </Text>
                {visita.actividad?.descripcion ? (
                  <Text style={styles.visitaDesc} numberOfLines={1}>
                    {visita.actividad.descripcion}
                  </Text>
                ) : null}
              </View>
              <View style={styles.visitaStatus}>
                <View style={[
                  styles.statusDot,
                  { backgroundColor: visita.sincronizado ? COLORS.success : COLORS.warning }
                ]} />
                <Text style={styles.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
          {visitas.length > 5 && (
            <TouchableOpacity
              style={styles.verTodasBtn}
              onPress={() => handleAccion('historial')}
            >
              <Text style={styles.verTodasText}>
                Ver todas las {visitas.length} visitas →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingBottom: SPACING.xxl,
  },
  // ─── Cabecera ───────────────────────────────────────────────
  header: {
    alignItems: 'center',
    padding: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
    ...SHADOWS.md,
  },
  avatarLargeText: {
    fontSize: 32,
    fontWeight: FONTS.weights.bold,
  },
  headerName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  headerId: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  headerInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  infoBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoBadgeText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  visitaCount: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    marginTop: SPACING.md,
  },
  // ─── Acciones ──────────────────────────────────────────────
  accionesSection: {
    padding: SPACING.lg,
    paddingTop: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  accionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    ...SHADOWS.sm,
  },
  accionContent: {
    flex: 1,
  },
  accionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  accionSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  accionArrow: {
    fontSize: 22,
    color: COLORS.textLight,
    marginLeft: SPACING.sm,
  },
  // ─── Visitas recientes ─────────────────────────────────────
  visitasSection: {
    padding: SPACING.lg,
    paddingTop: 0,
  },
  visitaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  visitaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  visitaIconText: {
    fontSize: 18,
  },
  visitaInfo: {
    flex: 1,
  },
  visitaTipo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  visitaFecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  visitaDesc: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: 2,
  },
  visitaStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chevron: {
    fontSize: 18,
    color: COLORS.textLight,
  },
  verTodasBtn: {
    alignItems: 'center',
    padding: SPACING.md,
    marginTop: SPACING.xs,
  },
  verTodasText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
});

export default BeneficiarioDetailScreen;
