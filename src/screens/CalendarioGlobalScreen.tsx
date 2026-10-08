// ============================================================
// GEODAILY — Calendario Global Unificado
// Un solo componente para todos los roles (técnico, coordinador,
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
import { getPersonalCronograma, PersonalCronograma } from '../services/admin.service';
import {
  generarYCompartirReporteMensualExcel,
  generarYCompartirReporteSemanalExcel,
  RangoSemanaCalendario,
} from '../services/cronogramaExcel.service';
import CronogramaPersonalModal from '../components/CronogramaPersonalModal';
import { getBeneficiarios } from '../services/beneficiariosDB.service';
import { BeneficiarioDB } from '../types';
import { tituloVisitaTecnica } from '../utils/visitaTecnica';

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

const formatearDiaMes = (fecha: string) => fecha.slice(8, 10);

type CalendarioGlobalScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const CalendarioGlobalScreen: React.FC<CalendarioGlobalScreenProps> = ({ navigation }) => {
  const { user, puedeEliminarFormulario } = useAuth();
  const { syncNow } = useSync();
  const insets = useSafeAreaInsets();

  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateString());
  const [mesVisible, setMesVisible] = useState<string>(getLocalDateString().slice(0, 7));
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

  // Modal para crear visita (todos los roles)
  const [modalVisible, setModalVisible] = useState(false);
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioDB[]>([]);
  const [beneficiarioBusqueda, setBeneficiarioBusqueda] = useState('');
  const [actividadProgramada, setActividadProgramada] = useState<number | null>(null);
  const [beneficiarioSeleccionado, setBeneficiarioSeleccionado] = useState<BeneficiarioDB | null>(null);

  // Descargar cronograma en Excel: roles superiores eligen de quién
  const [cronogramaModalVisible, setCronogramaModalVisible] = useState(false);
  const [cargandoPersonal, setCargandoPersonal] = useState(false);
  const [personalCronograma, setPersonalCronograma] = useState<PersonalCronograma[]>([]);

  const lastLoadRef = useRef(0);
  /** Evita solapar peticiones: con el refresco cada 30 s, una carga lenta
   *  podría alcanzar a la siguiente y dejar en pantalla una respuesta vieja. */
  const cargandoRef = useRef(false);

  /** Estado visual del botón de sincronizar (idle → cargando → ok/error). */
  const [syncEstado, setSyncEstado] = useState<'idle' | 'cargando' | 'ok' | 'error'>('idle');
  const syncEstadoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (syncEstadoTimeoutRef.current) clearTimeout(syncEstadoTimeoutRef.current);
    },
    []
  );

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

  const loadBeneficiariosLocal = useCallback(async () => {
    try {
      const data = await getBeneficiarios();
      setBeneficiarios(data);
    } catch (e) {
      console.warn('[Calendario] Error cargando beneficiarios:', e);
    }
  }, []);

  useEffect(() => {
    loadCalendarData();
    loadVisitas();
    loadBeneficiariosLocal();
  }, [loadCalendarData, loadVisitas, loadBeneficiariosLocal]);

  /**
   * Refresco silencioso: vuelve a pedir formularios y visitas programadas
   * sin tocar `loadingCal`, así la pantalla no parpadea con el spinner
   * (lo único que cambia son las marcas y las listas del día).
   */
  const refrescarCalendario = useCallback(async () => {
    if (cargandoRef.current) return;
    cargandoRef.current = true;
    try {
      await Promise.all([loadCalendarData(), loadVisitas()]);
    } finally {
      cargandoRef.current = false;
    }
  }, [loadCalendarData, loadVisitas]);

  // Refresco automático: al entrar a la pantalla y luego cada 30 s mientras
  // siga visible. Antes solo recargaba al abrir/volver a la pantalla, así
  // que un coordinador o interventor que dejara el calendario abierto NO veía
  // las visitas que los técnicos iban programando hasta salir y entrar de
  // nuevo. El intervalo se limpia al perder el foco, sin fugas.
  useFocusEffect(
    useCallback(() => {
      // Tick inmediato al ganar el foco — salvo si acabamos de cargar, para
      // no duplicar la carga del montaje ni encadenar peticiones seguidas.
      if (Date.now() - lastLoadRef.current >= 20000) {
        refrescarCalendario();
      }

      const intervalo = setInterval(() => {
        refrescarCalendario();
      }, 30000);

      return () => clearInterval(intervalo);
    }, [refrescarCalendario])
  );

  // ================================================================
  // SINCRONIZACIÓN MANUAL (botón arriba a la derecha del calendario)
  // ================================================================
  /**
   * Sube lo pendiente y vuelve a pedir todo al servidor. El refresco
   * automático comparte `cargandoRef` para no solapar peticiones, pero aquí
   * el usuario pidió explícitamente recargar, así que se libera el candado
   * antes de la carga para que no la salte si el intervalo está corriendo.
   */
  const handleSincronizarManual = async () => {
    if (syncEstado === 'cargando') return;
    if (syncEstadoTimeoutRef.current) clearTimeout(syncEstadoTimeoutRef.current);
    setSyncEstado('cargando');
    try {
      await syncNow();
      cargandoRef.current = false;
      await Promise.all([loadCalendarData(), loadVisitas()]);
      setSyncEstado('ok');
    } catch (e) {
      console.warn('[Calendario] Error en sincronización manual:', e);
      setSyncEstado('error');
    } finally {
      syncEstadoTimeoutRef.current = setTimeout(() => setSyncEstado('idle'), 2500);
    }
  };

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
      const dotColor = v.estado === 'realizada' ? COLORS.success : v.estado === 'cancelada' ? '#9AA0A6' : COLORS.info;
      const dot = { key: `plan-${v.id}`, color: dotColor };
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

  const semanasDelMes = useMemo<RangoSemanaCalendario[]>(() => {
    const [year, month] = mesVisible.split('-').map(Number);
    const ultimoDia = new Date(year, month, 0).getDate();
    const primerDia = new Date(year, month - 1, 1).getDay();
    const desplazamiento = primerDia === 0 ? 6 : primerDia - 1;
    const semanas: RangoSemanaCalendario[] = [];
    for (let inicio = 1 - desplazamiento; inicio <= ultimoDia; inicio += 7) {
      const desde = Math.max(1, inicio);
      const hasta = Math.min(ultimoDia, inicio + 6);
      const inicioTexto = `${year}-${String(month).padStart(2, '0')}-${String(desde).padStart(2, '0')}`;
      const finTexto = `${year}-${String(month).padStart(2, '0')}-${String(hasta).padStart(2, '0')}`;
      semanas.push({
        inicio: inicioTexto,
        fin: finTexto,
        etiqueta: `${formatearDiaMes(inicioTexto)} al ${formatearDiaMes(finTexto)}`,
      });
    }
    return semanas;
  }, [mesVisible]);

  const nombreMesVisible = useMemo(
    () => new Date(`${mesVisible}-01T12:00:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }),
    [mesVisible]
  );

  /**
   * Rango del reporte mensual: el mes completo visible en el calendario, del
   * día 01 al último día real del mes (28/29/30/31 según corresponda). El
   * último día se calcula con `new Date(year, month, 0)` en vez de asumir 31,
   * así febrero y los meses de 30 quedan correctos.
   */
  const rangoMesVisible = useMemo<RangoSemanaCalendario>(() => {
    const [year, month] = mesVisible.split('-').map(Number);
    const ultimoDia = new Date(year, month, 0).getDate();
    const diaFin = String(ultimoDia).padStart(2, '0');
    return {
      inicio: `${mesVisible}-01`,
      fin: `${mesVisible}-${diaFin}`,
      etiqueta: `01 al ${diaFin}`,
    };
  }, [mesVisible]);

  const textoRangoMes = `Mes de ${nombreMesVisible} (${rangoMesVisible.etiqueta})`;

  const handleDescargarReporteSemanal = async (rango: RangoSemanaCalendario) => {
    await generarYCompartirReporteSemanalExcel(
      todasLasVisitas,
      visitasProgramadas,
      rango,
      nombreMesVisible
    );
  };

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
      conFirma: forms.filter((f) => f.firma_beneficiario).length,
      tecnicos: Object.keys(formsByTecnico).length,
      planificadas: visitasProgramadas.length,
    };
  }, [formulariosLength, visitasProgramadas, formsByTecnico]);

  // ================================================================
  // ACCIONES: visita planificada (todos los roles)
  // ================================================================
  const beneficiariosFiltrados = useMemo(() => {
    const texto = beneficiarioBusqueda.trim().toLowerCase();
    if (!texto) return beneficiarios.slice(0, 50);
    return beneficiarios.filter((b) => {
      const nombre = `${b.nombre_completo} ${b.cedula} ${b.vereda} ${b.corregimiento || ''}`.toLowerCase();
      return nombre.includes(texto);
    }).slice(0, 80);
  }, [beneficiarios, beneficiarioBusqueda]);

  const resetProgramacionModal = () => {
    setActividadProgramada(null);
    setBeneficiarioSeleccionado(null);
    setBeneficiarioBusqueda('');
  };

  const handleAddPlannedVisit = async () => {
    if (!actividadProgramada) {
      Alert.alert('Campo requerido', 'Debes seleccionar la visita a programar.');
      return;
    }
    if (!beneficiarioSeleccionado) {
      Alert.alert('Campo requerido', 'Debes seleccionar un beneficiario.');
      return;
    }

    const yaExiste = visitasProgramadas.some((v) => {
      if (!v.actividad_numero || !v.beneficiario_cedula) return false;
      return v.beneficiario_cedula === beneficiarioSeleccionado.cedula && v.actividad_numero === actividadProgramada;
    });

    if (yaExiste) {
      Alert.alert('Visita duplicada', `Ya existe una programación para la Visita ${actividadProgramada} del beneficiario ${beneficiarioSeleccionado.nombre_completo}.`);
      return;
    }

    const titulo = `Visita ${actividadProgramada} - ${beneficiarioSeleccionado.nombre_completo}`;
    const lugar = [beneficiarioSeleccionado.vereda, beneficiarioSeleccionado.corregimiento].filter(Boolean).join(' · ');

    const newVisit: VisitaProgramada = {
      id: generarId(),
      usuario_id: user?.id,
      // Quién creó la planificación (técnico, interventor, coordinador…). El
      // backend lo devuelve por JOIN, pero se guarda también localmente para
      // que la tarjeta muestre el nombre de inmediato, sin esperar un refresco.
      usuario_nombre: user?.nombre,
      titulo,
      ubicacion: lugar,
      fecha: selectedDate,
      estado: 'pendiente',
      beneficiario_cedula: beneficiarioSeleccionado.cedula,
      beneficiario_nombre: beneficiarioSeleccionado.nombre_completo,
      actividad_numero: actividadProgramada,
      vereda: beneficiarioSeleccionado.vereda,
      corregimiento: beneficiarioSeleccionado.corregimiento || undefined,
      sincronizado: false,
    };

    setVisitasProgramadas((prev) => [...prev, newVisit]);
    try {
      await saveVisitaProgramada(newVisit);
    } catch (error) {
      setVisitasProgramadas((prev) => prev.filter((v) => v.id !== newVisit.id));
      Alert.alert('No se pudo guardar', 'La visita no quedó guardada en este dispositivo. Inténtalo de nuevo.');
      return;
    }
    resetProgramacionModal();
    setModalVisible(false);
    syncNow();
  };

  const handleMarcarComoRealizada = async (visita: VisitaProgramada) => {
    const updated = {
      ...visita,
      estado: 'realizada' as const,
      titulo: visita.titulo || `Visita ${visita.actividad_numero || ''}`,
      sincronizado: false,
    };

    setVisitasProgramadas((prev) => prev.map((v) => (v.id === visita.id ? updated : v)));
    try {
      await saveVisitaProgramada(updated);
    } catch (error) {
      setVisitasProgramadas((prev) => prev.map((v) => (v.id === visita.id ? visita : v)));
      Alert.alert('No se pudo guardar', 'El cambio no quedó guardado en este dispositivo. Inténtalo de nuevo.');
      return;
    }
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

  // ================================================================
  // DESCARGAR CRONOGRAMA EN EXCEL
  // ================================================================
  // Técnico: descarga directo su propio cronograma, sin selector.
  // Roles superiores: eligen una sola persona (técnico, coordinador o
  // interventor) de la lista antes de generar el archivo.
  const handleDescargarCronograma = async () => {
    if (esTecnico) {
      // El técnico solo tiene datos propios: descarga directo su mes, sin
      // selector, con el mismo formato de 2 hojas que el reporte semanal.
      await generarYCompartirReporteMensualExcel(
        todasLasVisitas,
        visitasProgramadas,
        rangoMesVisible,
        nombreMesVisible,
        [{ id: user?.id || '', nombre: user?.nombre || 'Técnico', rol: 'tecnico' }]
      );
      return;
    }

    setCronogramaModalVisible(true);
    setCargandoPersonal(true);
    try {
      const personal = await getPersonalCronograma();
      setPersonalCronograma(personal);
    } catch (e) {
      console.warn('[Calendario] Error cargando personal para cronograma:', e);
      Alert.alert('Error', 'No se pudo cargar la lista de personal. Intenta de nuevo.');
      setCronogramaModalVisible(false);
    } finally {
      setCargandoPersonal(false);
    }
  };

  const handleConfirmarCronograma = async (personas: PersonalCronograma[]) => {
    setCronogramaModalVisible(false);
    await generarYCompartirReporteMensualExcel(
      todasLasVisitas,
      visitasProgramadas,
      rangoMesVisible,
      nombreMesVisible,
      personas
    );
  };

  // --- ELIMINAR VISITA REALIZADA (solo admin) ---
  // Borra el formulario y TODO su árbol (revisiones, notificaciones,
  // mediciones, plantaciones, archivos en MinIO) — ver
  // backend/src/routes/forms.js DELETE /api/formularios/:id.
  const [eliminandoFormId, setEliminandoFormId] = useState<string | null>(null);

  const handleDeleteFormulario = (form: Formulario) => {
    if (!puedeEliminarFormulario) return;
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
    resetProgramacionModal();
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
            <View style={styles.calendarWithWeeklyReports}>
              <View style={styles.calendarScaled}>
                <Calendar
                  onDayPress={onDayPress}
                  onDayLongPress={onDayLongPress}
                  onMonthChange={(month) => setMesVisible(`${month.year}-${String(month.month).padStart(2, '0')}`)}
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
              </View>
              <View style={styles.weeklyReportColumn}>
                <View style={styles.weeklyReportHeaderSpace}>
                  <TouchableOpacity
                    style={[
                      styles.syncButton,
                      syncEstado === 'ok' && styles.syncButtonOk,
                      syncEstado === 'error' && styles.syncButtonError,
                    ]}
                    onPress={handleSincronizarManual}
                    disabled={syncEstado === 'cargando'}
                    accessibilityLabel="Sincronizar datos del calendario"
                    activeOpacity={0.7}
                  >
                    {syncEstado === 'cargando' ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Text style={styles.syncButtonText}>
                        {syncEstado === 'ok' ? '✅' : syncEstado === 'error' ? '⚠️' : '🔄'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
                {semanasDelMes.map((rango) => (
                  <View key={rango.inicio} style={styles.weeklyReportRow}>
                    <TouchableOpacity
                      style={styles.weeklyReportButton}
                      onPress={() => handleDescargarReporteSemanal(rango)}
                      accessibilityLabel={`Descargar reporte semanal del ${rango.etiqueta}`}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.weeklyReportButtonText}>XLSX</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Leyenda + botón programar (todos los roles) */}
          <View style={styles.legendContainer}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.success }]} />
              <Text style={styles.legendText}>Visitas realizadas</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.info }]} />
              <Text style={styles.legendText}>Planificadas</Text>
            </View>
            <TouchableOpacity
              style={styles.addVisitButton}
              onPress={() => {
                resetProgramacionModal();
                setModalVisible(true);
              }}
            >
              <Text style={styles.addVisitButtonText}>+ Programar</Text>
            </TouchableOpacity>
          </View>

          {/* Estadísticas */}
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: COLORS.success }]}>
                {stats.total}
              </Text>
              <Text style={styles.statLabel}>Visitas realizadas</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: COLORS.info }]}>
                {stats.planificadas}
              </Text>
              <Text style={styles.statLabel}>Visitas planificadas</Text>
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

          {/* Descargar cronograma en Excel */}
          <View style={styles.downloadContainer}>
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={handleDescargarCronograma}
              activeOpacity={0.7}
            >
              <Text style={styles.downloadButtonText}>📊 Descargar Cronograma - Excel</Text>
            </TouchableOpacity>
          </View>

          {/* Detalle del día — visitas planificadas */}
          <View style={styles.daySection}>
            <Text style={styles.sectionTitle}>
              {formatFecha(selectedDate)}
            </Text>

            {dayVisitas.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>📌 Planificadas</Text>
                {dayVisitas.map((visita) => {
                  const esRealizada = visita.estado === 'realizada';
                  const colorBorde = esRealizada ? COLORS.success : COLORS.info;
                  const colorPunto = esRealizada ? COLORS.success : COLORS.info;
                  return (
                    <TouchableOpacity
                      key={visita.id}
                      style={[styles.itemCard, { borderLeftColor: colorBorde }]}
                      onLongPress={
                        esAdmin || visita.usuario_id === user?.id
                          ? () => handleDeletePlannedVisit(visita)
                          : undefined
                      }
                      activeOpacity={0.7}
                    >
                      <View style={styles.itemDot}>
                        <View style={[styles.dot, { backgroundColor: colorPunto }]} />
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle}>{visita.titulo}</Text>
                        {visita.actividad_numero && (
                          <Text style={styles.itemSubtitle}>Actividad: Visita {visita.actividad_numero}</Text>
                        )}
                        {visita.beneficiario_nombre && (
                          <Text style={styles.itemSubtitle}>Beneficiario: {visita.beneficiario_nombre}</Text>
                        )}
                        {visita.usuario_nombre && (
                          <Text style={styles.itemSubtitle}>
                            Planeada por: {visita.usuario_nombre}
                          </Text>
                        )}
                        {visita.ubicacion ? (
                          <Text style={styles.itemSubtitle}>{visita.ubicacion}</Text>
                        ) : null}
                        {visita.estado === 'pendiente' && (
                          <TouchableOpacity
                            style={styles.realizadaButton}
                            onPress={() => handleMarcarComoRealizada(visita)}
                          >
                            <Text style={styles.realizadaButtonText}>Marcar como realizada</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {visita.usuario_id === user?.id && (
                        <Text style={styles.plannedBadge}>{esRealizada ? '✅' : '📌'}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
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
                    onLongPress={puedeEliminarFormulario ? () => handleDeleteFormulario(form) : undefined}
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
                              ? tituloVisitaTecnica(form.actividad?.visita_numero)
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
                      {puedeEliminarFormulario && (
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
                <TouchableOpacity
                  style={styles.emptyAddButton}
                  onPress={() => {
                    resetProgramacionModal();
                    setModalVisible(true);
                  }}
                >
                  <Text style={styles.emptyAddButtonText}>
                    + Programar visita
                  </Text>
                </TouchableOpacity>
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

        {/* Modal para crear visita (todos los roles) */}
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

              <Text style={styles.modalLabel}>Actividad a realizar</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.activitySelector}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((numero) => {
                  const activo = actividadProgramada === numero;
                  return (
                    <TouchableOpacity
                      key={numero}
                      style={[styles.activityChip, activo && styles.activityChipSelected]}
                      onPress={() => setActividadProgramada(numero)}
                    >
                      <Text style={[styles.activityChipText, activo && styles.activityChipTextSelected]}>
                        Visita {numero}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.modalLabel}>Beneficiario a visitar</Text>
              <TextInput
                style={styles.modalInput}
                value={beneficiarioBusqueda}
                onChangeText={setBeneficiarioBusqueda}
                placeholder="Buscar por nombre o cédula"
                placeholderTextColor={COLORS.textLight}
                autoCorrect={false}
              />

              <View style={styles.beneficiarioListBox}>
                <ScrollView style={styles.beneficiarioList} nestedScrollEnabled>
                  {beneficiariosFiltrados.length > 0 ? (
                    beneficiariosFiltrados.map((beneficiario) => {
                      const activo = beneficiarioSeleccionado?.cedula === beneficiario.cedula;
                      return (
                        <TouchableOpacity
                          key={beneficiario.cedula}
                          style={[styles.beneficiarioItem, activo && styles.beneficiarioItemSelected]}
                          onPress={() => {
                            setBeneficiarioSeleccionado(beneficiario);
                            setBeneficiarioBusqueda(beneficiario.nombre_completo);
                          }}
                        >
                          <Text style={styles.beneficiarioItemTitle}>{beneficiario.nombre_completo}</Text>
                          <Text style={styles.beneficiarioItemMeta}>{beneficiario.cedula}</Text>
                        </TouchableOpacity>
                      );
                    })
                  ) : (
                    <Text style={styles.emptyBeneficiarios}>No se encontraron beneficiarios.</Text>
                  )}
                </ScrollView>
              </View>

              {beneficiarioSeleccionado && (
                <View style={styles.selectedBeneficiarioCard}>
                  <Text style={styles.modalLabel}>Vereda</Text>
                  <Text style={styles.selectedBeneficiarioValue}>{beneficiarioSeleccionado.vereda || '—'}</Text>
                  <Text style={styles.modalLabel}>Corregimiento</Text>
                  <Text style={styles.selectedBeneficiarioValue}>{beneficiarioSeleccionado.corregimiento || '—'}</Text>
                </View>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => {
                    resetProgramacionModal();
                    setModalVisible(false);
                  }}
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

        {/* Modal para elegir de quién descargar el cronograma (roles superiores) */}
        <CronogramaPersonalModal
          visible={cronogramaModalVisible}
          cargando={cargandoPersonal}
          personal={personalCronograma}
          rangoTexto={textoRangoMes}
          onCancelar={() => setCronogramaModalVisible(false)}
          onConfirmar={handleConfirmarCronograma}
        />
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
  calendarWithWeeklyReports: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: SPACING.xs,
  },
  calendarScaled: {
    flex: 1,
    paddingRight: 4,
  },
  weeklyReportColumn: {
    width: 42,
    alignItems: 'center',
  },
  weeklyReportHeaderSpace: {
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButton: {
    width: 34,
    height: 34,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary + '15',
    borderWidth: 1,
    borderColor: COLORS.primary + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButtonOk: {
    backgroundColor: COLORS.success + '20',
    borderColor: COLORS.success + '66',
  },
  syncButtonError: {
    backgroundColor: COLORS.error + '15',
    borderColor: COLORS.error + '66',
  },
  syncButtonText: {
    fontSize: 16,
  },
  weeklyReportRow: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weeklyReportButton: {
    width: 25,
    height: 24,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.success + '18',
    borderWidth: 1,
    borderColor: COLORS.success + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weeklyReportButtonText: {
    fontSize: 9,
    color: COLORS.success,
    fontWeight: FONTS.weights.bold,
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
  downloadContainer: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  downloadButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  downloadButtonText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
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
  activitySelector: {
    marginBottom: SPACING.md,
    maxHeight: 46,
  },
  activityChip: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.divider,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    marginRight: SPACING.sm,
  },
  activityChipSelected: {
    backgroundColor: COLORS.info + '20',
    borderColor: COLORS.info,
  },
  activityChipText: {
    color: COLORS.textSecondary,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
  },
  activityChipTextSelected: {
    color: COLORS.info,
    fontWeight: FONTS.weights.bold,
  },
  beneficiarioListBox: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
    maxHeight: 220,
    marginBottom: SPACING.md,
  },
  beneficiarioList: {
    maxHeight: 220,
    padding: SPACING.xs,
  },
  beneficiarioItem: {
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    marginBottom: 4,
    backgroundColor: '#fff',
  },
  beneficiarioItemSelected: {
    backgroundColor: COLORS.info + '12',
    borderWidth: 1,
    borderColor: COLORS.info + '50',
  },
  beneficiarioItemTitle: {
    color: COLORS.textPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
  },
  beneficiarioItemMeta: {
    color: COLORS.textSecondary,
    fontSize: FONTS.sizes.xs,
    marginTop: 2,
  },
  emptyBeneficiarios: {
    padding: SPACING.md,
    color: COLORS.textSecondary,
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
  },
  selectedBeneficiarioCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  selectedBeneficiarioValue: {
    color: COLORS.textPrimary,
    fontSize: FONTS.sizes.md,
    marginBottom: SPACING.sm,
  },
  realizadaButton: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.success + '15',
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: 6,
    paddingHorizontal: SPACING.sm,
    alignSelf: 'flex-start',
  },
  realizadaButtonText: {
    color: COLORS.success,
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
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
