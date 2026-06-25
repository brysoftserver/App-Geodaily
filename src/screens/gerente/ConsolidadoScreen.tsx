// ============================================================
// GEODAILY — Consolidador de Información (Gerencia)
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import FilterBar from '../../components/FilterBar';
import { formatFecha } from '../../utils/formatters';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

type ConsolidadoProps = {
  navigation: NativeStackNavigationProp<any>;
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'Todo' },
  { value: 'visita_tecnica', label: 'Visitas' },
  { value: 'plantacion', label: 'Plantación' },
];

const ConsolidadoScreen: React.FC<ConsolidadoProps> = ({ navigation }) => {
  const { formularios } = useForm();
  const [filter, setFilter] = useState('all');

  const filteredForms = useMemo(() => {
    if (filter === 'all') return formularios;
    return formularios.filter(f => f.tipo === filter);
  }, [formularios, filter]);

  const indicadores = useMemo(() => {
    const total = filteredForms.length;
    if (total === 0) return null;
    const visitas = filteredForms.filter(f => f.tipo === 'visita_tecnica').length;
    const plantaciones = filteredForms.filter(f => f.tipo === 'plantacion').length;
    const sincronizadas = filteredForms.filter(f => f.sincronizado).length;
    const municipios = new Set(filteredForms.map(f => f.beneficiario.municipio)).size;
    const tecnicos = new Set(filteredForms.map(f => f.tecnico.nombre)).size;
    return { total, visitas, plantaciones, sincronizadas, pendientes: total - sincronizadas, municipios, tecnicos };
  }, [filteredForms]);

  // Agrupar por municipio
  const porMunicipio = useMemo(() => {
    const map: Record<string, number> = {};
    filteredForms.forEach(f => {
      const m = f.beneficiario.municipio;
      map[m] = (map[m] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredForms]);

  // Agrupar por técnico
  const porTecnico = useMemo(() => {
    const map: Record<string, number> = {};
    filteredForms.forEach(f => {
      const t = f.tecnico.nombre;
      map[t] = (map[t] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredForms]);

  const exportToCSV = async () => {
    try {
      const headers = 'ID,Fecha,Tipo,Técnico,Beneficiario,Municipio,Vereda,Sincronizado';
      const rows = filteredForms.map(f =>
        `${f.id},${f.created_at.split('T')[0]},${f.tipo},"${f.tecnico.nombre}","${f.beneficiario.nombre}","${f.beneficiario.municipio}","${f.beneficiario.vereda}",${f.sincronizado ? 'Sí' : 'No'}`
      );
      const csv = `\uFEFF${headers}\n${rows.join('\n')}`;

      const filename = `consolidado_${new Date().toISOString().split('T')[0]}.csv`;
      const fileUri = FileSystem.documentDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'Exportar reporte consolidado',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('✅ Exportado', `Archivo guardado en: ${fileUri}`);
      }
    } catch (err) {
      console.warn('[Consolidado] Error al exportar CSV:', err);
      Alert.alert('Error', 'No se pudo generar el reporte.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Consolidador</Text>
      <Text style={styles.subtitle}>{filteredForms.length} registro(s) encontrados</Text>

      <FilterBar options={FILTER_OPTIONS} selected={filter} onSelect={(v) => setFilter(v ?? 'all')} />

      {/* Indicadores */}
      {indicadores && (
        <View style={styles.indicatorGrid}>
          <View style={styles.indCard}>
            <Text style={styles.indValor}>{indicadores.total}</Text>
            <Text style={styles.indLabel}>Total</Text>
          </View>
          <View style={styles.indCard}>
            <Text style={[styles.indValor, { color: COLORS.roleTecnico }]}>{indicadores.visitas}</Text>
            <Text style={styles.indLabel}>Visitas</Text>
          </View>
          <View style={styles.indCard}>
            <Text style={[styles.indValor, { color: COLORS.primary }]}>{indicadores.plantaciones}</Text>
            <Text style={styles.indLabel}>Plantación</Text>
          </View>
          <View style={styles.indCard}>
            <Text style={[styles.indValor, { color: COLORS.success }]}>{indicadores.sincronizadas}</Text>
            <Text style={styles.indLabel}>Sinc.</Text>
          </View>
          <View style={styles.indCard}>
            <Text style={[styles.indValor, { color: COLORS.warning }]}>{indicadores.pendientes}</Text>
            <Text style={styles.indLabel}>Pend.</Text>
          </View>
          <View style={styles.indCard}>
            <Text style={[styles.indValor, { color: COLORS.secondary }]}>{indicadores.municipios}</Text>
            <Text style={styles.indLabel}>Municipios</Text>
          </View>
        </View>
      )}

      {/* Botón exportar */}
      <TouchableOpacity style={styles.exportBtn} onPress={exportToCSV}>
        <Text style={styles.exportBtnText}>📥 Exportar Reporte CSV</Text>
      </TouchableOpacity>

      {/* Distribución por municipio */}
      {porMunicipio.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Por Municipio</Text>
          {porMunicipio.map(([municipio, count]) => (
            <View key={municipio} style={styles.distRow}>
              <Text style={styles.distLabel}>{municipio}</Text>
              <View style={styles.distBarContainer}>
                <View style={[styles.distBar, { width: `${(count / indicadores!.total) * 100}%` }]} />
              </View>
              <Text style={styles.distCount}>{count}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Distribución por técnico */}
      {porTecnico.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Por Técnico</Text>
          {porTecnico.map(([tecnico, count]) => (
            <View key={tecnico} style={styles.distRow}>
              <Text style={styles.distLabel}>{tecnico}</Text>
              <View style={styles.distBarContainer}>
                <View style={[styles.distBar, { width: `${(count / indicadores!.total) * 100}%`, backgroundColor: COLORS.roleTecnico }]} />
              </View>
              <Text style={styles.distCount}>{count}</Text>
            </View>
          ))}
        </View>
      )}

      {filteredForms.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>No hay formularios registrados.</Text>
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
  indicatorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md },
  indCard: {
    flex: 1, minWidth: 80, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, alignItems: 'center', ...SHADOWS.sm,
  },
  indValor: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  indLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  exportBtn: {
    backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md,
    alignItems: 'center', marginBottom: SPACING.md, ...SHADOWS.sm,
  },
  exportBtnText: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: '#fff' },
  sectionCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.md, ...SHADOWS.sm,
  },
  sectionTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  distRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  distLabel: { width: 100, fontSize: FONTS.sizes.sm, color: COLORS.textPrimary },
  distBarContainer: {
    flex: 1, height: 12, backgroundColor: COLORS.surfaceAlt, borderRadius: 6, marginHorizontal: SPACING.sm, overflow: 'hidden',
  },
  distBar: {
    height: '100%', backgroundColor: COLORS.primary, borderRadius: 6,
  },
  distCount: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, width: 30, textAlign: 'right' },
  emptyState: { alignItems: 'center', paddingVertical: SPACING.xxl },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyText: { fontSize: FONTS.sizes.lg, color: COLORS.textSecondary },
});

export default ConsolidadoScreen;
