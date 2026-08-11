// ============================================================
// GEODAILY — Calendario Global Unificado
// Un solo componente para todos los roles (técnico, supervisor,
// interventor, gerente, admin) con comportamiento adaptativo.
// ============================================================

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Calendar, DateData, LocaleConfig } from 'react-native-calendars';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { useAuth } from '../store/AuthContext';
import { useSync } from '../store/SyncContext';
import {
  fetchFormulariosDelServidor,
  fetchVisitasProgramadasDelServidor,
  eliminarVisitaProgramadaDelServidor,
  eliminarFormularioDelServidor,
} from '../services/formularios.service';
import { getFormulariosLocales, getVisitasProgramadas, saveVisitaProgramada, deleteVisitaProgramadaLocal } from '../services/database';
import { formatFecha, getLocalDateString, generarId } from '../utils/formatters';
import { VisitaProgramada, Formulario } from '../types';

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

type CalendarioGlobalScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const CalendarioGlobalScreen: React.FC<CalendarioGlobalScreenProps> = ({ navigation }) => {
  const { user } = useAuth();
  const { syncNow } = useSync();
  const insets = useSafeAreaInsets();

  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateString());
  /**
   * Estado LOCAL de esta pantalla — a propósito NO vive en el FormContext
   * compartido. El calendario pide la vista universal (todas las visitas de
   * todos los técnicos, pidiendo `vista=calendario` al backend); publicar
   * eso en el contexto global contaminaría pantallas como "Historial de
   * Formularios" del técnico, que deben seguir mostrando solo sus propios
   * formularios.
   */
  const [todasLasVisitas, setTodasLasVisitas] = useState<Formulario[]>([]);
  const [visitasProgramadas, setVisitasProgramadas] = useState<VisitaProgramada[]>([]);
  const [loadingCal, setLoadingCal] = useState(true);

  // Modal para crear visita (solo técnico)
  const [modalVisible, setModalVisible] = useState(false);
  const [newVisitTitulo, setNewVisitTitulo] = useState('');
  const [newVisitUbicacion, setNewVisitUbicacion] = useState('');

  const lastLoadRef = useRef(0);

  const rol = user?.rol ?? 'tecnico';
  const esTecnico = rol === 'tecnico';
  const esAdmin = rol === 'admin';

  // ================================================================
  // CARGA DE DATOS
  // ================================================================
  const loadCalendarData = useCallback(async () => {
    lastLoadRef.current = Date.now();
    try {
      // vista=calendario: el backend ignora "solo mis formularios" (técnico)
      // y la jerarquía de aprobación (interventor) — todos ven lo mismo.
      const [locales, servidor] = await Promise.all([
        getFormulariosLocales(),
        fetchFormulariosDelServidor({ vista: 'calendario' }),
      ]);

      const mapa = new Map<string, any>();
      for (const f of locales) mapa.set(f.id, f);
      for (const f of servidor) mapa.set(f.id, { ...f, sincronizado: true });

      setTodasLasVisitas(Array.from(mapa.values()));
    } catch (e) {
      console.warn('[Calendario] Error cargando formularios:', e);
    }
  }, []);

  const loadVisitas = useCallback(async () => {
    try {
      const [locales, servidor] = await Promise.all([
        getVisitasProgramadas(),
        fetchVisitasProgramadasDelServidor(),
      ]);
      const mapa = new Map<string, VisitaProgramada>();
      for (const v of locales) mapa.set(v.id, v);
      for (const v of servidor) mapa.set(v.id, { ...v, sincronizado: true });
      setVisitasProgramadas(Array.from(mapa.values()));
    } catch (e) {
      console.warn('[Calendario] Error cargando visitas programadas:', e);
    } finally {
      setLoadingCal(false);
    }
  }, []);

  useEffect(() => {
    loadCalendarData();
    loadVisitas();
  }, [loadCalendarData, loadVisitas]);

  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastLoadRef.current < 20000) return;
      loadCalendarData();
      loadVisitas();
    }, [loadCalendarData, loadVisitas])
  );

  // ================================================================
  // MARCAS DEL CALENDARIO
  // ================================================================
  const formulariosLength = todasLasVisitas.length;
  const formulariosRef = useRef(todasLasVisitas);
  formulariosRef.current = todasLasVisitas;

  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};

    for (const form of formulariosRef.current) {
      const dateKey = (form.created_at || '').split('T')[0];
      if (!dateKey) continue;
      const dot = { key: `form-${form.id}`, color: COLORS.success };
      if (marks[dateKey]) {
        marks[dateKey].dots.push(dot);
      } else {
        marks[dateKey] = { dots: [dot] };
      }
    }

    for (const v of visitasProgramadas) {
      const dot = { key: `plan-${v.id}`, color: COLORS.info };
      if (marks[v.fecha]) {
        marks[v.fecha].dots.push(dot);
      } else {
        marks[v.fecha] = { dots: [dot] };
      }
    }

    marks[selectedDate] = {
      ...(marks[selectedDate] || {}),
      selected: true,
      selectedColor: COLORS.primary,
    };

    return marks;
  }, [formulariosLength, visitasProgramadas, selectedDate]);

  // ================================================================
  // FILTROS DEL DÍA SELECCIONADO
  // ================================================================
  const dayForms = useMemo(
    () =>
      formulariosRef.current.filter(
        (f) => (f.created_at || '').split('T')[0] === selectedDate
      ),
    [formulariosLength, selectedDate]
  );

  const dayVisitas = useMemo(
    () => visitasProgramadas.filter((v) => v.fecha === selectedDate),
    [visitasProgramadas, selectedDate]
  );

  // ================================================================
  // AGRUPACIÓN POR TÉCNICO (para roles superiores)
  // ================================================================
  const formsByTecnico = useMemo(() => {
    const map: Record<string, Formulario[]> = {};
    for (const f of formulariosRef.current) {
      const key = f.tecnico?.nombre || 'Desconocido';
      if (!map[key]) map[key] = [];
      map[key].push(f);
    }
    return map;
  }, [formulariosLength]);

  // ================================================================
  // ESTADÍSTICAS
  // ================================================================
  const stats = useMemo(() => {
    const forms = formulariosRef.current;
    return {
      total: forms.length,
      conFotos: forms.filter((f) => (f.fotos?.length || 0) > 0).length,
      conFirma: forms.filter((f) => f.firma_beneficiario).length,
      tecnicos: Object.keys(formsByTecnico).length,
      planificadas: visitasProgramadas.length,
    };
  }, [formulariosLength, visitasProgramadas, formsByTecnico]);

  // ================================================================
  // ACCIONES: visita planificada (solo técnico)
  // ================================================================
  const handleAddPlannedVisit = async () => {
    if (!newVisitTitulo.trim()) {
      Alert.alert('Campo requerido', 'Debes ingresar un título para la visita.');
      return;
    }
    const newVisit: VisitaProgramada = {
      id: generarId(),
      usuario_id: user?.id,
      titulo: newVisitTitulo.trim(),
      ubicacion: newVisitUbicacion.trim(),
      fecha: selectedDate,
      estado: 'pendiente',
      sincronizado: false,
    };
    setVisitasProgramadas((prev) => [...prev, newVisit]);
    await saveVisitaProgramada(newVisit);
    setModalVisible(false);
    syncNow();
  };

  const handleDeletePlannedVisit = (visita: VisitaProgramada) => {
    Alert.alert(
      'Eliminar visita',
      `¿Eliminar "${visita.titulo}" del ${formatFecha(visita.fecha)}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setVisitasProgramadas((prev) => prev.filter((v) => v.id !== visita.id));
            await deleteVisitaProgramadaLocal(visita.id);
            await eliminarVisitaProgramadaDelServidor(visita.id);
          },
        },
      ]
    );
  };

  // --- ELIMINAR VISITA REALIZADA (solo admin) ---
  // Borra el formulario y TODO su árbol (revisiones, notificaciones,
  // mediciones, plantaciones, archivos en MinIO) — ver
  // backend/src/routes/forms.js DELETE /api/formularios/:id.
  const [eliminandoFormId, setEliminandoFormId] = useState<string | null>(null);

  const handleDeleteFormulario = (form: Formulario) => {
    if (!esAdmin) return;
    Alert.alert(
      'Eliminar visita realizada',
      `¿Eliminar definitivamente esta visita de "${form.beneficiario?.nombre || 'este beneficiario'}"?\n\nSe borrará también todo lo asociado: revisiones, notificaciones, mediciones, plantaciones, fotos, videos, firmas y PDF. Esta acción NO se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar todo',
          style: 'destructive',
          onPress: async () => {
            setEliminandoFormId(form.id);
            try {
              await eliminarFormularioDelServidor(form.id);
              setTodasLasVisitas((prev) => prev.filter((f) => f.id !== form.id));
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'No se pudo eliminar la visita');
            } finally {
              setEliminandoFormId(null);
            }
          },
        },
      ]
    );
  };

  // ================================================================
  // NAVEGACIÓN A DETALLE
  // ================================================================
  const navigateToDetail = (form: any) => {
    // El calendario es universal (todos ven que la visita ocurrió), pero un
    // técnico NO puede abrir el detalle completo de una visita que no es
    // suya — el backend ya recorta esos datos en vista=calendario, así que
    // esto evita además que aterrice en una pantalla de detalle incompleta.
    const esDueno = form.usuario_id === user?.id || form.tecnico?.usuario_id === user?.id;
    if (esTecnico && !esDueno) {
      Alert.alert(
        'Visita de otro técnico',
        `Esta visita fue realizada por ${form.tecnico?.nombre || 'otro técnico'}. Solo puedes ver el detalle de tus propias visitas.`
      );
      return;
    }

    // Detecta el navigador activo para escoger la ruta correcta
    const state = navigation.getState();
    const currentRoute = state?.routes?.[state.index];
    const routeName = currentRoute?.name ?? '';
    // Nombres REALES registrados en cada navigator. Antes se derivaban del
    // prefijo de la ruta y salían nombres inexistentes:
    //   TerrenoCalendario → 'TerrenoFormularioDetail'  (no existe)
    //   AdminCalendario   → 'AdminFormularioDetail'    (no existe)
    // El gerente funcionaba solo por casualidad (su ruta es 'CronogramaGerente',
    // no empieza por 'Gerente', así que caía al valor por defecto).
    // Resultado: tocar una visita del calendario no hacía nada para técnico
    // ni para admin.
    const DETALLE_POR_NAVIGATOR: Record<string, string> = {
      TerrenoCalendario: 'FormularioDetail',
      SupervisionCalendario: 'SupervisionFormularioDetail',
      InterventorCalendario: 'InterventorFormularioDetail',
      CronogramaGerente: 'SupervisionFormularioDetail',
      AdminCalendario: 'SupervisionFormularioDetail',
    };
    const detailScreen = DETALLE_POR_NAVIGATOR[routeName] ?? 'SupervisionFormularioDetail';

    // Navigate with type-safe approach: cast navigation to any for
    // cross-navigator navigation (different param lists per stack)
    (navigation as any).navigate(detailScreen, { formulario: form });
  };

  // ================================================================
  // DÍA SELECCIONADO
  // ================================================================
  const onDayPress = (day: DateData) => {
    setSelectedDate(day.dateString);
  };

  const onDayLongPress = (day: DateData) => {
    if (!esTecnico) return; // solo técnico programa visitas
    setNewVisitTitulo('');
    setNewVisitUbicacion('');
    setSelectedDate(day.dateString);
    setModalVisible(true);
  };

  // ================================================================
  // RENDER
  // ================================================================
  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xxl }}>
          {loadingCal ? (
            <View style={styles.loadingCal}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Cargando calendario...</Text>
            </View>
          ) : (
            <Calendar
              onDayPress={onDayPress}
              onDayLongPress={esTecnico ? onDayLongPress : undefined}
              markedDates={markedDates}
              markingType="multi-dot"
              theme={{
                calendarBackground: '#FFFFFF',
                todayTextColor: COLORS.primary,
                selectedDayBackgroundColor: COLORS.primary,
                selectedDayTextColor: '#fff',
                arrowColor: COLORS.primary,
                monthTextColor: COLORS.textPrimary,
                textMonthFontWeight: 'bold',
                dotColor: COLORS.primary,
              }}
            />
          )}

          {/* Leyenda + botón programar (solo técnico) */}
          <View style={styles.legendContainer}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.success }]} />
              <Text style={styles.legendText}>Visitas realizadas</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.info }]} />
              <Text style={styles.legendText}>Planificadas</Text>
            </View>
            {esTecnico && (
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
            )}
          </View>

          {/* Estadísticas */}
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
              <Text style={[styles.statValue, { color: COLORS.primary }]}>
                {stats.tecnicos}
              </Text>
              <Text style={styles.statLabel}>Técnicos</Text>
            </View>
          </View>

          {/* Detalle del día — visitas planificadas */}
          <View style={styles.daySection}>
            <Text style={styles.sectionTitle}>
              {formatFecha(selectedDate)}
            </Text>

            {dayVisitas.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>📌 Planificadas</Text>
                {dayVisitas.map((visita) => (
                  <TouchableOpacity
                    key={visita.id}
                    style={[styles.itemCard, { borderLeftColor: COLORS.info }]}
                    onLongPress={
                      esAdmin || (esTecnico && visita.usuario_id === user?.id)
                        ? () => handleDeletePlannedVisit(visita)
                        : undefined
                    }
                    activeOpacity={0.7}
                  >
                    <View style={styles.itemDot}>
                      <View style={[styles.dot, { backgroundColor: COLORS.info }]} />
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemTitle}>{visita.titulo}</Text>
                      {visita.usuario_nombre && (
                        <Text style={styles.itemSubtitle}>
                          Técnico: {visita.usuario_nombre}
                        </Text>
                      )}
                      {visita.ubicacion ? (
                        <Text style={styles.itemSubtitle}>{visita.ubicacion}</Text>
                      ) : null}
                    </View>
                    {visita.usuario_id === user?.id && esTecnico && (
                      <Text style={styles.plannedBadge}>📌</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Detalle del día — visitas realizadas */}
            {dayForms.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>✅ Realizadas</Text>
                {dayForms.map((form) => (
                  <TouchableOpacity
                    key={form.id}
                    style={[
                      styles.itemCard,
                      { borderLeftColor: COLORS.success },
                      eliminandoFormId === form.id && { opacity: 0.5 },
                    ]}
                    onPress={() => navigateToDetail(form)}
                    onLongPress={esAdmin ? () => handleDeleteFormulario(form) : undefined}
                    disabled={eliminandoFormId === form.id}
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
                      <View style={styles.activityHeader}>
                        <Text style={styles.itemTitle}>
                          {form.beneficiario?.nombre || 'Beneficiario'}
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
                            {form.tipo === 'visita_tecnica'
                              ? 'Visita'
                              : form.tipo === 'caracterizacion'
                              ? 'Caracterización'
                              : 'Plantación'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.itemSubtitle}>
                        Técnico: {form.tecnico?.nombre || '—'}
                      </Text>
                      <Text style={styles.itemSubtitle}>
                        {form.beneficiario?.municipio || ''}
                        {form.beneficiario?.vereda ? ` — ${form.beneficiario.vereda}` : ''}
                      </Text>
                      {esAdmin && (
                        <Text style={[styles.itemSubtitle, { color: COLORS.error }]}>
                          {eliminandoFormId === form.id ? 'Eliminando…' : '🗑 Mantener presionado para eliminar'}
                        </Text>
                      )}
                      <View style={styles.activityFooter}>
                        {form.sincronizado ? (
                          <Text style={styles.syncedText}>✓ Sincronizado</Text>
                        ) : (
                          <Text style={styles.pendingText}>⏳ Pendiente</Text>
                        )}
                        {form.pdf_url && <Text style={styles.pdfText}>📄 PDF</Text>}
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {dayVisitas.length === 0 && dayForms.length === 0 && (
              <View style={styles.emptyDay}>
                <Text style={styles.noDataText}>No hay actividades en esta fecha</Text>
                {esTecnico && (
                  <TouchableOpacity
                    style={styles.emptyAddButton}
                    onPress={() => {
                      setNewVisitTitulo('');
                      setNewVisitUbicacion('');
                      setModalVisible(true);
                    }}
                  >
                    <Text style={styles.emptyAddButtonText}>
                      + Programar visita
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Resumen por técnico — visible para todos los roles: el
              calendario es universal, así que esta sección ya no se oculta
              para el técnico (antes solo veía sus propios formularios y el
              resumen habría mostrado un único técnico; ahora ve los de
              todo el equipo, igual que el resto de roles). */}
          {Object.keys(formsByTecnico).length > 0 && (
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
          )}
        </ScrollView>

        {/* Modal para crear visita (solo técnico) */}
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

// ================================================================
// ESTILOS
// ================================================================
const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingCal: {
    padding: SPACING.xl * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
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
  daySection: {
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
  noDataText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textLight,
    textAlign: 'center',
    padding: SPACING.xl,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 3,
    ...SHADOWS.sm,
  },
  itemDot: {
    marginRight: SPACING.md,
    marginTop: 3,
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
  plannedBadge: {
    fontSize: 18,
    marginLeft: SPACING.sm,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  activityBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 1,
    borderRadius: BORDER_RADIUS.full,
  },
  activityBadgeText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  activityFooter: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: 2,
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
  // Resumen por técnico
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
  // Modal
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

export default CalendarioGlobalScreen;
