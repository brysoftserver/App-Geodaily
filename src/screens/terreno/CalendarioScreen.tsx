// ============================================================
// GEODAILY — Calendario de Visitas (Técnico)
// ============================================================

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Calendar, DateData, LocaleConfig } from 'react-native-calendars';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { formatFecha } from '../../utils/formatters';

// Configurar calendario en español
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

const STORAGE_KEY = '@geodaily/visitas_planificadas';

interface VisitaPlanificada {
  id: string;
  titulo: string;
  ubicacion: string;
  fecha: string; // YYYY-MM-DD
}

type CalendarioScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const CalendarioScreen: React.FC<CalendarioScreenProps> = ({ navigation }) => {
  const { formularios } = useForm();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [visitasPlanificadas, setVisitasPlanificadas] = useState<VisitaPlanificada[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [newVisitTitulo, setNewVisitTitulo] = useState('');
  const [newVisitUbicacion, setNewVisitUbicacion] = useState('');

  // Cargar visitas planificadas guardadas
  const loadPlannedVisits = useCallback(async () => {
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) {
        setVisitasPlanificadas(JSON.parse(data));
      }
    } catch (error) {
      console.warn('[Calendario] Error cargando visitas planificadas:', error);
    }
  }, []);

  useEffect(() => {
    loadPlannedVisits();
  }, [loadPlannedVisits]);

  // Guardar visitas planificadas
  const savePlannedVisits = async (visitas: VisitaPlanificada[]) => {
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(visitas));
    } catch (error) {
      console.warn('[Calendario] Error guardando visitas planificadas:', error);
    }
  };

  // Marcar fechas con visitas
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};

    // Visitas realizadas (formularios completados) → dots verde
    formularios.forEach((form) => {
      const dateKey = form.created_at.split('T')[0];
      const dot = {
        key: `realizada-${form.id}`,
        color: COLORS.success, // verde
      };
      if (marks[dateKey]) {
        marks[dateKey].dots.push(dot);
      } else {
        marks[dateKey] = { dots: [dot] };
      }
    });

    // Visitas planificadas → dots azul oscuro
    visitasPlanificadas.forEach((visita) => {
      const dot = {
        key: `planificada-${visita.id}`,
        color: COLORS.info, // azul
      };
      if (marks[visita.fecha]) {
        marks[visita.fecha].dots.push(dot);
      } else {
        marks[visita.fecha] = { dots: [dot] };
      }
    });

    // Selección actual
    if (marks[selectedDate]) {
      marks[selectedDate].selected = true;
      marks[selectedDate].selectedColor = COLORS.primary;
    } else {
      marks[selectedDate] = {
        selected: true,
        selectedColor: COLORS.primary,
      };
    }

    return marks;
  }, [formularios, visitasPlanificadas, selectedDate]);

  // Items del día seleccionado
  const dayItems = useMemo(() => {
    const forms = formularios.filter(
      (form) => form.created_at.split('T')[0] === selectedDate
    );
    const planned = visitasPlanificadas.filter(
      (v) => v.fecha === selectedDate
    );
    return { realizadas: forms, planificadas: planned };
  }, [formularios, visitasPlanificadas, selectedDate]);

  const onDayPress = (day: DateData) => {
    setSelectedDate(day.dateString);
  };

  const onDayLongPress = (day: DateData) => {
    setNewVisitTitulo('');
    setNewVisitUbicacion('');
    setSelectedDate(day.dateString);
    setModalVisible(true);
  };

  const handleAddPlannedVisit = async () => {
    if (!newVisitTitulo.trim()) {
      Alert.alert('Campo requerido', 'Debes ingresar un título para la visita.');
      return;
    }
    const newVisit: VisitaPlanificada = {
      id: `planned-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      titulo: newVisitTitulo.trim(),
      ubicacion: newVisitUbicacion.trim(),
      fecha: selectedDate,
    };
    const updated = [...visitasPlanificadas, newVisit];
    setVisitasPlanificadas(updated);
    await savePlannedVisits(updated);
    setModalVisible(false);
  };

  const handleDeletePlannedVisit = (visita: VisitaPlanificada) => {
    Alert.alert(
      'Eliminar visita planificada',
      `¿Eliminar "${visita.titulo}" del ${formatFecha(visita.fecha)}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const updated = visitasPlanificadas.filter((v) => v.id !== visita.id);
            setVisitasPlanificadas(updated);
            await savePlannedVisits(updated);
          },
        },
      ]
    );
  };

  const getStats = () => {
    const total = formularios.length;
    const tecnicas = formularios.filter((f) => f.tipo === 'visita_tecnica').length;
    const plantaciones = formularios.filter((f) => f.tipo === 'plantacion').length;
    const sincronizadas = formularios.filter((f) => f.sincronizado).length;
    const planificadas = visitasPlanificadas.length;
    return { total, tecnicas, plantaciones, sincronizadas, planificadas };
  };

  const stats = getStats();

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xxl }}>
        <Calendar
          onDayPress={onDayPress}
          onDayLongPress={onDayLongPress}
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

        {/* Leyenda */}
        <View style={styles.legendContainer}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.success }]} />
            <Text style={styles.legendText}>Visitas realizadas</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.info }]} />
            <Text style={styles.legendText}>Visitas planificadas</Text>
          </View>
          <TouchableOpacity
            style={styles.addVisitButton}
            onPress={() => {
              setNewVisitTitulo('');
              setNewVisitUbicacion('');
              setModalVisible(true);
            }}
          >
            <Text style={styles.addVisitButtonText}>+ Programar</Text>
          </TouchableOpacity>
        </View>

        {/* Estadísticas */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.roleTecnico }]}>
              {stats.tecnicas}
            </Text>
            <Text style={styles.statLabel}>Visitas</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.primary }]}>
              {stats.plantaciones}
            </Text>
            <Text style={styles.statLabel}>Plantac.</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.success }]}>
              {stats.sincronizadas}
            </Text>
            <Text style={styles.statLabel}>Sinc.</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.info }]}>
              {stats.planificadas}
            </Text>
            <Text style={styles.statLabel}>Planif.</Text>
          </View>
        </View>

        {/* Items del día */}
        <View style={styles.dayFormsSection}>
          <Text style={styles.sectionTitle}>
            {formatFecha(selectedDate)}
          </Text>

          {/* Visitas planificadas del día */}
          {dayItems.planificadas.length > 0 && (
            <>
              <Text style={styles.subsectionTitle}>📌 Planificadas</Text>
              {dayItems.planificadas.map((visita) => (
                <TouchableOpacity
                  key={visita.id}
                  style={[styles.itemCard, { borderLeftColor: COLORS.info }]}
                  onLongPress={() => handleDeletePlannedVisit(visita)}
                  activeOpacity={0.7}
                >
                  <View style={styles.itemDot}>
                    <View style={[styles.dot, { backgroundColor: COLORS.info }]} />
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle}>{visita.titulo}</Text>
                    {visita.ubicacion ? (
                      <Text style={styles.itemSubtitle}>{visita.ubicacion}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.plannedBadge}>📌</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {/* Visitas realizadas del día */}
          {dayItems.realizadas.length > 0 && (
            <>
              <Text style={styles.subsectionTitle}>✅ Realizadas</Text>
              {dayItems.realizadas.map((form) => (
                <TouchableOpacity
                  key={form.id}
                  style={[styles.itemCard, { borderLeftColor: COLORS.success }]}
                  onPress={() => navigation.navigate('TerrenoFormularioList')}
                  activeOpacity={0.7}
                >
                  <View style={styles.itemDot}>
                    <View
                      style={[
                        styles.dot,
                        {
                          backgroundColor:
                            form.tipo === 'visita_tecnica'
                              ? COLORS.roleTecnico
                              : COLORS.primary,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle}>
                      {form.beneficiario?.nombre || 'Beneficiario'}
                    </Text>
                    <Text style={styles.itemSubtitle}>
                      {form.beneficiario?.municipio || ''}
                      {form.beneficiario?.vereda ? ` — ${form.beneficiario.vereda}` : ''}
                    </Text>
                  </View>
                  <View style={styles.itemStatus}>
                    {form.sincronizado ? (
                      <Text style={styles.syncBadge}>✓</Text>
                    ) : (
                      <Text style={styles.pendingBadge}>⏳</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}

          {dayItems.planificadas.length === 0 && dayItems.realizadas.length === 0 && (
            <View style={styles.emptyDay}>
              <Text style={styles.noFormsText}>
                No hay visitas en esta fecha
              </Text>
              <TouchableOpacity
                style={styles.emptyAddButton}
                onPress={() => {
                  setNewVisitTitulo('');
                  setNewVisitUbicacion('');
                  setModalVisible(true);
                }}
              >
                <Text style={styles.emptyAddButtonText}>+ Agregar visita planificada</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modal para agregar visita planificada */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Programar Visita</Text>
            <Text style={styles.modalDate}>{formatFecha(selectedDate)}</Text>

            <Text style={styles.modalLabel}>Título *</Text>
            <TextInput
              style={styles.modalInput}
              value={newVisitTitulo}
              onChangeText={setNewVisitTitulo}
              placeholder="Ej: Visita de seguimiento mensual"
              placeholderTextColor={COLORS.textLight}
              autoFocus
            />

            <Text style={styles.modalLabel}>Ubicación</Text>
            <TextInput
              style={styles.modalInput}
              value={newVisitUbicacion}
              onChangeText={setNewVisitUbicacion}
              placeholder="Ej: Vereda San Antonio, Puerto Rico"
              placeholderTextColor={COLORS.textLight}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={handleAddPlannedVisit}
              >
                <Text style={styles.modalSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  legendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.md,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  addVisitButton: {
    backgroundColor: COLORS.info + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
    marginLeft: 'auto',
  },
  addVisitButtonText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.info,
    fontWeight: FONTS.weights.semibold,
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
  dayFormsSection: {
    padding: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  subsectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  noFormsText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textLight,
    textAlign: 'center',
    padding: SPACING.xl,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 3,
    ...SHADOWS.sm,
  },
  itemDot: {
    marginRight: SPACING.md,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  itemSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  itemStatus: {
    marginLeft: SPACING.sm,
  },
  syncBadge: {
    fontSize: 18,
    color: COLORS.success,
  },
  pendingBadge: {
    fontSize: 18,
  },
  plannedBadge: {
    fontSize: 18,
    marginLeft: SPACING.sm,
  },
  emptyDay: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },
  emptyAddButton: {
    backgroundColor: COLORS.info + '15',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.info + '30',
  },
  emptyAddButtonText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.info,
    fontWeight: FONTS.weights.medium,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: 400,
    ...SHADOWS.lg,
  },
  modalTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  modalDate: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  modalLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  modalInput: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.divider,
    marginBottom: SPACING.md,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  modalCancelButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  modalCancelText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  modalSaveButton: {
    backgroundColor: COLORS.info,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  modalSaveText: {
    fontSize: FONTS.sizes.md,
    color: '#fff',
    fontWeight: FONTS.weights.bold,
  },
});

export default CalendarioScreen;
