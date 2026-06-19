// ============================================================
// GEODAILY — Calendario General (Supervisión)
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

// Español
LocaleConfig.locales['es'] = {
  monthNames: [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ],
  monthNamesShort: [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
  ],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  dayNamesShort: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

type CalendarioScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const CalendarioScreen: React.FC<CalendarioScreenProps> = ({ navigation }) => {
  const { formularios } = useForm();
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Agrupar por técnico
  const formsByTecnico = useMemo(() => {
    const map: Record<string, typeof formularios> = {};
    formularios.forEach((f) => {
      const key = f.tecnico.nombre;
      if (!map[key]) map[key] = [];
      map[key].push(f);
    });
    return map;
  }, [formularios]);

  // Marcar fechas en el calendario
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};

    formularios.forEach((form) => {
      const dateKey = form.created_at.split('T')[0];
      if (marks[dateKey]) {
        marks[dateKey].dots.push({
          key: form.id,
          color: COLORS.primary,
        });
      } else {
        marks[dateKey] = {
          dots: [{ key: form.id, color: COLORS.primary }],
        };
      }
    });

    // Día seleccionado
    marks[selectedDate] = {
      ...(marks[selectedDate] || {}),
      selected: true,
      selectedColor: COLORS.primary,
    };

    return marks;
  }, [formularios, selectedDate]);

  // Formularios del día seleccionado
  const dayForms = useMemo(
    () =>
      formularios.filter(
        (f) => f.created_at.split('T')[0] === selectedDate
      ),
    [formularios, selectedDate]
  );

  const onDayPress = (day: DateData) => {
    setSelectedDate(day.dateString);
  };

  const stats = useMemo(() => {
    const total = formularios.length;
    const conFotos = formularios.filter((f) => (f.fotos?.length || 0) > 0).length;
    const conFirma = formularios.filter((f) => f.firma_beneficiario).length;
    return { total, conFotos, conFirma };
  }, [formularios]);

  return (
    <ScrollView style={styles.container}>
      <Calendar
        onDayPress={onDayPress}
        markedDates={markedDates}
        markingType="multi-dot"
        theme={{
          todayTextColor: COLORS.primary,
          selectedDayBackgroundColor: COLORS.primary,
          selectedDayTextColor: '#fff',
          arrowColor: COLORS.primary,
          monthTextColor: COLORS.textPrimary,
          textMonthFontWeight: 'bold',
          dotColor: COLORS.primary,
        }}
      />

      {/* Resumen de cobertura */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: COLORS.info }]}>
            {stats.conFotos}
          </Text>
          <Text style={styles.statLabel}>Con fotos</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: COLORS.success }]}>
            {stats.conFirma}
          </Text>
          <Text style={styles.statLabel}>Con firma</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: COLORS.secondary }]}>
            {Object.keys(formsByTecnico).length}
          </Text>
          <Text style={styles.statLabel}>Técnicos</Text>
        </View>
      </View>

      {/* Detalle del día */}
      <View style={styles.daySection}>
        <Text style={styles.sectionTitle}>
          Actividades del {formatFecha(selectedDate)}
        </Text>
        {dayForms.length === 0 ? (
          <Text style={styles.noData}>No hay actividades registradas en esta fecha</Text>
        ) : (
          dayForms.map((form) => (
            <TouchableOpacity
              key={form.id}
              style={styles.activityCard}
              onPress={() => navigation.navigate('SupervisionFormularioList')}
            >
              <View style={styles.activityHeader}>
                <Text style={styles.activityName}>
                  {form.beneficiario.nombre}
                </Text>
                <View
                  style={[
                    styles.activityBadge,
                    {
                      backgroundColor:
                        form.tipo === 'visita_tecnica'
                          ? COLORS.roleTecnico + '20'
                          : COLORS.primary + '20',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.activityBadgeText,
                      {
                        color:
                          form.tipo === 'visita_tecnica'
                            ? COLORS.roleTecnico
                            : COLORS.primary,
                      },
                    ]}
                  >
                    {form.tipo === 'visita_tecnica' ? 'Visita' : 'Plantación'}
                  </Text>
                </View>
              </View>
              <Text style={styles.activityTecnico}>
                Técnico: {form.tecnico.nombre}
              </Text>
              <Text style={styles.activityLocation}>
                {form.beneficiario.municipio}
                {form.beneficiario.vereda && ` — ${form.beneficiario.vereda}`}
              </Text>
              <View style={styles.activityFooter}>
                {form.sincronizado ? (
                  <Text style={styles.syncedText}>✓ Sincronizado</Text>
                ) : (
                  <Text style={styles.pendingText}>⏳ Pendiente</Text>
                )}
                {form.pdf_url && <Text style={styles.pdfText}>📄 PDF</Text>}
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Resumen por técnico */}
      <View style={styles.daySection}>
        <Text style={styles.sectionTitle}>Resumen por Técnico</Text>
        {Object.entries(formsByTecnico).map(([nombre, forms]) => (
          <View key={nombre} style={styles.tecnicoCard}>
            <Text style={styles.tecnicoName}>{nombre}</Text>
            <Text style={styles.tecnicoStats}>
              {forms.length} formulario(s) ·{' '}
              {forms.filter((f) => f.sincronizado).length} sincronizados
            </Text>
            <View style={styles.tecnicoBar}>
              <View
                style={[
                  styles.tecnicoBarFill,
                  {
                    width: `${
                      forms.length > 0
                        ? (forms.filter((f) => f.sincronizado).length /
                            forms.length) *
                          100
                        : 0
                    }%`,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  statsContainer: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  statValue: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  statLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  daySection: {
    padding: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  noData: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textLight,
    textAlign: 'center',
    padding: SPACING.xl,
  },
  activityCard: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  activityName: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    flex: 1,
  },
  activityBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  activityBadgeText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  activityTecnico: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  activityLocation: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  activityFooter: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.xs,
  },
  syncedText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.success,
  },
  pendingText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.warning,
  },
  pdfText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.info,
  },
  tecnicoCard: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  tecnicoName: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  tecnicoStats: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  tecnicoBar: {
    height: 6,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
  },
  tecnicoBarFill: {
    height: '100%',
    backgroundColor: COLORS.success,
    borderRadius: 3,
  },
});

export default CalendarioScreen;
