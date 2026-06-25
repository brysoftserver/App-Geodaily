// ============================================================
// GEODAILY — Perfil de Técnicos (Gerencia)
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { Formulario } from '../../types';
import { formatFecha } from '../../utils/formatters';

type PerfilTecnicosProps = {
  navigation: NativeStackNavigationProp<any>;
};

const PerfilTecnicosScreen: React.FC<PerfilTecnicosProps> = ({ navigation }) => {
  const { formularios } = useForm();
  const [selectedTecnico, setSelectedTecnico] = useState<string | null>(null);

  // Agrupar por técnico
  const tecnicosMap = useMemo(() => {
    const map: Record<string, Formulario[]> = {};
    formularios.forEach(f => {
      const nombre = f.tecnico.nombre;
      if (!map[nombre]) map[nombre] = [];
      map[nombre].push(f);
    });
    return map;
  }, [formularios]);

  const tecnicosList = useMemo(() => {
    return Object.entries(tecnicosMap).map(([nombre, forms]) => ({
      nombre,
      total: forms.length,
      ultimaVisita: forms.sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
      sincronizadas: forms.filter(f => f.sincronizado).length,
      tecnicas: forms.filter(f => f.tipo === 'visita_tecnica').length,
      plantaciones: forms.filter(f => f.tipo === 'plantacion').length,
      forms,
    }));
  }, [tecnicosMap]);

  const selectedData = tecnicosList.find(t => t.nombre === selectedTecnico);

  if (selectedTecnico && selectedData) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => setSelectedTecnico(null)} style={styles.backRow}>
          <Text style={styles.backArrow}>‹ Volver a lista</Text>
        </TouchableOpacity>

        <View style={styles.perfilHeader}>
          <View style={[styles.avatar, { backgroundColor: COLORS.roleTecnico }]}>
            <Text style={styles.avatarText}>{selectedTecnico.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.perfilNombre}>{selectedTecnico}</Text>
          <Text style={styles.perfilRole}>Técnico de Campo</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValor}>{selectedData.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValor, { color: COLORS.roleTecnico }]}>{selectedData.tecnicas}</Text>
            <Text style={styles.statLabel}>Visitas</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValor, { color: COLORS.primary }]}>{selectedData.plantaciones}</Text>
            <Text style={styles.statLabel}>Plantaciones</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValor, { color: COLORS.success }]}>{selectedData.sincronizadas}</Text>
            <Text style={styles.statLabel}>Sinc.</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Historial de visitas</Text>
        {selectedData.forms.slice(0, 20).map((form) => (
          <TouchableOpacity key={form.id} style={styles.formItem}
            onPress={() => navigation.navigate('DashboardGerencial' as never)}
          >
            <View style={styles.formDot} />
            <View style={styles.formInfo}>
              <Text style={styles.formName}>{form.beneficiario.nombre}</Text>
              <Text style={styles.formMeta}>
                {formatFecha(form.created_at)} · {form.beneficiario.municipio}
              </Text>
            </View>
            <Text style={styles.formType}>
              {form.tipo === 'visita_tecnica' ? '🔧' : '🌱'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Equipo de Campo</Text>
      <Text style={styles.subtitle}>{tecnicosList.length} técnico(s) activo(s)</Text>

      {tecnicosList.map((tecnico) => (
        <TouchableOpacity
          key={tecnico.nombre}
          style={styles.tecnicoCard}
          onPress={() => setSelectedTecnico(tecnico.nombre)}
          activeOpacity={0.7}
        >
          <View style={[styles.avatar, { backgroundColor: COLORS.roleTecnico }]}>
            <Text style={styles.avatarText}>{tecnico.nombre.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.tecnicoInfo}>
            <Text style={styles.tecnicoNombre}>{tecnico.nombre}</Text>
            <Text style={styles.tecnicoStats}>
              {tecnico.total} visitas · {tecnico.sincronizadas} sincronizadas
            </Text>
            <Text style={styles.tecnicoUltima}>
              Última: {tecnico.ultimaVisita?.beneficiario.nombre} · {formatFecha(tecnico.ultimaVisita?.created_at || '')}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}

      {tecnicosList.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyText}>No hay datos de técnicos aún.</Text>
          <Text style={styles.emptySubtext}>Completa formularios en campo para ver estadísticas.</Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  title: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.md },
  backRow: { marginBottom: SPACING.md },
  backArrow: { fontSize: FONTS.sizes.md, color: COLORS.info, fontWeight: FONTS.weights.semibold },
  perfilHeader: { alignItems: 'center', marginBottom: SPACING.lg },
  perfilNombre: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginTop: SPACING.sm },
  perfilRole: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  statsRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  statCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, alignItems: 'center', ...SHADOWS.sm,
  },
  statValor: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  statLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  sectionTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  formItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.xs, ...SHADOWS.sm,
  },
  formDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginRight: SPACING.sm },
  formInfo: { flex: 1 },
  formName: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.medium, color: COLORS.textPrimary },
  formMeta: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  formType: { fontSize: 20 },
  tecnicoCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOWS.md,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginRight: SPACING.md },
  avatarText: { color: '#fff', fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold },
  tecnicoInfo: { flex: 1 },
  tecnicoNombre: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  tecnicoStats: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  tecnicoUltima: { fontSize: FONTS.sizes.xs, color: COLORS.textLight, marginTop: 1 },
  chevron: { fontSize: 24, color: COLORS.textLight },
  emptyState: { alignItems: 'center', paddingVertical: SPACING.xxl },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyText: { fontSize: FONTS.sizes.lg, color: COLORS.textSecondary },
  emptySubtext: { fontSize: FONTS.sizes.sm, color: COLORS.textLight, marginTop: SPACING.xs },
});

export default PerfilTecnicosScreen;
