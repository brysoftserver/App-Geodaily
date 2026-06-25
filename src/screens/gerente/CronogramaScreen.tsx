// ============================================================
// GEODAILY — Cronograma General (Gerencia)
// ============================================================

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Calendar, DateData, LocaleConfig } from 'react-native-calendars';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { formatFecha } from '../../utils/formatters';

LocaleConfig.locales['es'] = {
  monthNames: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],
  monthNamesShort: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
  dayNames: ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'],
  dayNamesShort: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

type CronogramaProps = {
  navigation: NativeStackNavigationProp<any>;
};

const CronogramaScreen: React.FC<CronogramaProps> = ({ navigation }) => {
  const { formularios } = useForm();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterTecnico, setFilterTecnico] = useState<string | null>(null);

  // Agrupar por técnico
  const tecnicos = useMemo(() => {
    return [...new Set(formularios.map(f => f.tecnico.nombre))].sort();
  }, [formularios]);

  // Marcar fechas
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    const filtered = filterTecnico
      ? formularios.filter(f => f.tecnico.nombre === filterTecnico)
      : formularios;

    filtered.forEach(form => {
      const dateKey = form.created_at.split('T')[0];
      if (!marks[dateKey]) {
        marks[dateKey] = { dots: [] };
      }
      marks[dateKey].dots.push({
        key: form.id,
        color: form.tipo === 'visita_tecnica' ? COLORS.roleTecnico : COLORS.primary,
      });
    });

    marks[selectedDate] = {
      ...marks[selectedDate],
      selected: true,
      selectedColor: COLORS.roleGerente,
    };

    return marks;
  }, [formularios, selectedDate, filterTecnico]);

  const dayForms = useMemo(() => {
    return formularios.filter(f => f.created_at.startsWith(selectedDate) &&
      (!filterTecnico || f.tecnico.nombre === filterTecnico));
  }, [formularios, selectedDate, filterTecnico]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Cronograma General</Text>
      <Text style={styles.subtitle}>{formularios.length} visitas registradas</Text>

      {/* Filtro por técnico */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, !filterTecnico && styles.filterChipActive]}
          onPress={() => setFilterTecnico(null)}
        >
          <Text style={[styles.filterChipText, !filterTecnico && styles.filterChipTextActive]}>Todos</Text>
        </TouchableOpacity>
        {tecnicos.map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.filterChip, filterTecnico === t && styles.filterChipActive]}
            onPress={() => setFilterTecnico(t)}
          >
            <Text style={[styles.filterChipText, filterTecnico === t && styles.filterChipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Calendar
        onDayPress={(day: DateData) => setSelectedDate(day.dateString)}
        markedDates={markedDates}
        markingType="multi-dot"
        theme={{
          selectedDayBackgroundColor: COLORS.roleGerente,
          arrowColor: COLORS.roleGerente,
          todayDotColor: COLORS.roleGerente,
        }}
      />

      <View style={styles.daySection}>
        <Text style={styles.dayTitle}>Visitas del {formatFecha(selectedDate)}</Text>
        {dayForms.length === 0 && (
          <Text style={styles.emptyText}>No hay visitas en esta fecha.</Text>
        )}
        {dayForms.map(form => (
          <View key={form.id} style={styles.visitItem}>
            <View style={[styles.typeBadge, {
              backgroundColor: form.tipo === 'visita_tecnica' ? COLORS.roleTecnico + '20' : COLORS.primary + '20'
            }]}>
              <Text style={styles.typeIcon}>
                {form.tipo === 'visita_tecnica' ? '🔧' : '🌱'}
              </Text>
            </View>
            <View style={styles.visitInfo}>
              <Text style={styles.visitName}>{form.beneficiario.nombre}</Text>
              <Text style={styles.visitMeta}>
                {form.tecnico.nombre} · {form.beneficiario.municipio}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  title: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.md },
  filterRow: { marginBottom: SPACING.md },
  filterChip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface, marginRight: SPACING.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: COLORS.roleGerente, borderColor: COLORS.roleGerente },
  filterChipText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  filterChipTextActive: { color: '#fff', fontWeight: FONTS.weights.semibold },
  daySection: { marginTop: SPACING.lg },
  dayTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  visitItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.xs, ...SHADOWS.sm,
  },
  typeBadge: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: SPACING.md },
  typeIcon: { fontSize: 18 },
  visitInfo: { flex: 1 },
  visitName: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.medium, color: COLORS.textPrimary },
  visitMeta: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  emptyText: { fontSize: FONTS.sizes.md, color: COLORS.textLight, textAlign: 'center', paddingVertical: SPACING.lg },
});

export default CronogramaScreen;
