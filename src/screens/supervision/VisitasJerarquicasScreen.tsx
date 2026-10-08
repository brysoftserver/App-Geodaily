// ============================================================
// GEODAILY — Visitas Jerárquicas (Técnicos → Beneficiarios → Visitas)
// ============================================================
// Estructura de 3 niveles:
//   Nivel 1: Lista de técnicos
//   Nivel 2: Beneficiarios de ese técnico
//   Nivel 3: Visitas numeradas del beneficiario (Visita 1…N)
//   Nivel 4: Detalle del formulario + ver/descargar PDF
// ============================================================

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  BackHandler,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { Formulario, BeneficiarioDB } from '../../types';
import { useAuth } from '../../store/AuthContext';
import { getFormulariosLocales, mergeFormulariosDelServidor } from '../../services/database';
import {
  fetchFormulariosDelServidor,
  eliminarFormularioDelServidor,
} from '../../services/formularios.service';
import { fetchBeneficiariosDelServidor } from '../../services/beneficiariosDB.service';
import LoadingSpinner from '../../components/LoadingSpinner';
import BotonPdfDashboard from '../../components/dashboard/BotonPdfDashboard';
import BotonPdfTecnico from '../../components/dashboard/BotonPdfTecnico';
import { descargarPaqueteMedia } from '../../services/mediaPackage.service';
import { BeneficiarioInformeTecnico } from '../../services/informeTecnicoPdf.service';
import { tituloVisitaTecnica } from '../../utils/visitaTecnica';

type VisitasJerarquicasScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

// --- Tipos auxiliares ---
interface TecnicoAgrupado {
  id: string;
  nombre: string;
  cedula: string;
  telefono: string;
  email: string;
  /** usuario_id real (FK) del técnico — para cruzar con beneficiarios.tecnico_asignado_id. */
  usuarioId: string;
  totalVisitas: number;
  totalBeneficiarios: number;
  beneficiarios: BeneficiarioAgrupado[];
}

/** Progreso de una visita numerada (1..12) sobre los beneficiarios ASIGNADOS actualmente al técnico. */
interface VisitaStat {
  numero: number;
  completados: number;
  total: number;
}

interface TecnicoConEstadisticas extends TecnicoAgrupado {
  /** Total de beneficiarios asignados vigente (tabla beneficiarios), no el histórico de formularios. */
  totalBeneficiariosAsignados: number;
  visitasStats: VisitaStat[];
}

const MAX_VISITAS_TARJETA = 12;

interface BeneficiarioAgrupado {
  nombre: string;
  cedula: string;
  telefono: string;
  municipio: string;
  vereda: string;
  finca: string;
  visitas: Formulario[];
}

type Nivel = 'tecnicos' | 'beneficiarios' | 'visitas';

const VisitasJerarquicasScreen: React.FC<VisitasJerarquicasScreenProps> = ({ navigation }) => {
  const { user, puedeEliminarFormulario, isCoordinador, isInterventor } = useAuth();
  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [beneficiariosAsignados, setBeneficiariosAsignados] = useState<BeneficiarioDB[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [descargandoMediaId, setDescargandoMediaId] = useState<string | null>(null);

  // Estado de navegación jerárquica
  const [nivel, setNivel] = useState<Nivel>('tecnicos');
  const nivelRef = useRef<Nivel>('tecnicos');
  const [tecnicoSeleccionado, setTecnicoSeleccionado] = useState<TecnicoConEstadisticas | null>(null);
  const [beneficiarioSeleccionado, setBeneficiarioSeleccionado] = useState<BeneficiarioAgrupado | null>(null);

  // --- Agrupar datos (con protección contra null) ---
  const tecnicos = useMemo(() => {
    const mapa = new Map<string, TecnicoAgrupado>();

    for (const form of formularios) {
      try {
        const tec = form.tecnico;
        if (!tec || !tec.nombre) continue;
        const key = tec.cedula || tec.nombre;
        if (!key) continue;

        if (!mapa.has(key)) {
          mapa.set(key, {
            id: tec.cedula || tec.nombre,
            nombre: tec.nombre || 'Sin nombre',
            cedula: tec.cedula || '',
            telefono: tec.telefono || '',
            email: tec.email || '',
            usuarioId: '',
            totalVisitas: 0,
            totalBeneficiarios: 0,
            beneficiarios: [],
          });
        }

        const grupo = mapa.get(key)!;
        if (tec.cedula && !grupo.cedula) {
          grupo.cedula = tec.cedula;
        }
        // Preferir tecnico.usuario_id (snapshot dentro de tecnico_json) sobre
        // la columna formularios.usuario_id: esta última puede quedar a
        // nombre de quien revisó/sincronizó el formulario (un interventor,
        // p. ej.) y no del técnico dueño de la visita — se vio en datos
        // reales formularios con usuario_id='int-007' pero
        // tecnico_json.usuario_id='tec-004', lo que hacía que el cruce con
        // beneficiarios.tecnico_asignado_id fallara y la tarjeta mostrara
        // 0/0 aunque el técnico sí tuviera beneficiarios y visitas.
        if (tec.usuario_id) {
          grupo.usuarioId = tec.usuario_id;
        } else if (!grupo.usuarioId && form.usuario_id) {
          grupo.usuarioId = form.usuario_id;
        }
        grupo.totalVisitas++;

        // Agrupar beneficiarios dentro del técnico
        const benef = form.beneficiario;
        if (!benef || !benef.nombre) continue;
        const benefKey = benef.cedula || benef.nombre;
        let benefGrupo = grupo.beneficiarios.find(
          (b) => (b.cedula || b.nombre) === benefKey
        );
        if (!benefGrupo) {
          benefGrupo = {
            nombre: benef.nombre || 'Sin nombre',
            cedula: benef.cedula || '',
            telefono: benef.telefono || '',
            municipio: benef.municipio || '',
            vereda: benef.vereda || '',
            finca: benef.finca || '',
            visitas: [],
          };
          grupo.beneficiarios.push(benefGrupo);
        }
        benefGrupo.visitas.push(form);
      } catch (err) {
        console.warn('[VisitasJerarquicas] Error agrupando formulario:', err, form?.id);
      }
    }

    // Ordenar: técnicos por nombre, beneficiarios por nombre, visitas por fecha
    for (const tec of mapa.values()) {
      tec.totalBeneficiarios = tec.beneficiarios.length;
      tec.beneficiarios.sort((a, b) => a.nombre?.localeCompare(b.nombre || '') || 0);
      for (const benef of tec.beneficiarios) {
        benef.visitas.sort(
          (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        );
      }
    }

    return Array.from(mapa.values()).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }, [formularios]);

  // --- Estadísticas de progreso por técnico (Visita 1..12 sobre beneficiarios ASIGNADOS) ---
  // A diferencia de `totalBeneficiarios` (que solo cuenta beneficiarios que ya
  // tienen algún formulario), esto usa la asignación vigente de la tabla
  // beneficiarios: si un técnico tiene 35 asignados y le ha hecho la primera
  // visita a 5, la tarjeta debe mostrar 5/35, no 5/5. Si el padrón de
  // asignación aún no cargó (sin conexión), se degrada al conteo histórico
  // de formularios para no dejar la tarjeta en 0/0.
  const tecnicosConStats = useMemo<TecnicoConEstadisticas[]>(() => {
    const huboCargaDeAsignacion = beneficiariosAsignados.length > 0;

    return tecnicos.map((tec) => {
      const asignados = tec.usuarioId
        ? beneficiariosAsignados.filter((b) => b.tecnico_asignado_id === tec.usuarioId)
        : [];

      // Cuántos formularios ya diligenció este técnico a cada beneficiario
      // (por cédula) — tec.beneficiarios ya viene filtrado por técnico.
      const visitasPorCedula = new Map<string, number>();
      for (const b of tec.beneficiarios) {
        if (b.cedula) visitasPorCedula.set(b.cedula, b.visitas.length);
      }

      const totalBeneficiariosAsignados = huboCargaDeAsignacion
        ? asignados.length
        : tec.totalBeneficiarios;

      const visitasStats: VisitaStat[] = [];
      for (let n = 1; n <= MAX_VISITAS_TARJETA; n++) {
        const completados = huboCargaDeAsignacion
          ? asignados.filter((b) => (visitasPorCedula.get(b.cedula) || 0) >= n).length
          : tec.beneficiarios.filter((b) => b.visitas.length >= n).length;
        visitasStats.push({ numero: n, completados, total: totalBeneficiariosAsignados });
      }

      return { ...tec, totalBeneficiariosAsignados, visitasStats };
    });
  }, [tecnicos, beneficiariosAsignados]);

  /** Todas las visitas del técnico actualmente seleccionado (para el informe PDF general del dashboard). */
  const formulariosDelTecnicoSeleccionado = useMemo(
    () => (tecnicoSeleccionado ? tecnicoSeleccionado.beneficiarios.flatMap((b) => b.visitas) : []),
    [tecnicoSeleccionado]
  );

  /**
   * TODOS los beneficiarios asignados a un técnico (tengan o no visitas
   * aún) para el informe PDF por técnico — mismo criterio que las
   * estadísticas "Visita (N): x/total" de la tarjeta: usa el padrón vigente
   * de asignación (beneficiariosAsignados) cuando está cargado, y solo cae
   * al histórico de formularios (tec.beneficiarios) si aún no cargó (ej.
   * sin conexión), igual que en `tecnicosConStats`.
   */
  const beneficiariosParaInformeTecnico = useCallback(
    (tec: TecnicoConEstadisticas): BeneficiarioInformeTecnico[] => {
      const huboCargaDeAsignacion = beneficiariosAsignados.length > 0;
      if (huboCargaDeAsignacion && tec.usuarioId) {
        const visitasPorCedula = new Map<string, BeneficiarioAgrupado>();
        tec.beneficiarios.forEach((b) => {
          if (b.cedula) visitasPorCedula.set(b.cedula, b);
        });
        return beneficiariosAsignados
          .filter((b) => b.tecnico_asignado_id === tec.usuarioId)
          .map((b) => ({
            nombre: b.nombre_completo,
            cedula: b.cedula,
            vereda: b.vereda,
            municipio: b.municipio || '',
            visitas: visitasPorCedula.get(b.cedula)?.visitas || [],
          }));
      }
      return tec.beneficiarios.map((b) => ({
        nombre: b.nombre,
        cedula: b.cedula,
        vereda: b.vereda,
        municipio: b.municipio,
        visitas: b.visitas,
      }));
    },
    [beneficiariosAsignados]
  );

  // --- Cargar datos (servidor + local) ---
  const loadData = useCallback(async () => {
    setLoadError(null);
    let localesCount = 0;
    let servidorCount = 0;
    try {
      // Cargar en paralelo: local + servidor + padrón de asignación vigente
      // (beneficiarios.tecnico_asignado_id) — este último no depende de
      // SQLite, así que funciona igual en la app y en el navegador (web).
      const [locales, servidor, padron] = await Promise.all([
        getFormulariosLocales(),
        fetchFormulariosDelServidor(),
        fetchBeneficiariosDelServidor(),
      ]);
      localesCount = locales.length;
      servidorCount = servidor.length;
      setBeneficiariosAsignados(padron);

      // Persistir lo del servidor en el SQLite local y purgar de paso
      // cualquier formulario que ya no exista ahí (p. ej. borrado por un
      // admin desde otro dispositivo) — sin esto, un formulario borrado
      // reaparecía en este listado porque `locales` seguía trayéndolo.
      let localesActualizados = locales;
      if (servidor.length > 0) {
        await mergeFormulariosDelServidor(servidor);
        localesActualizados = await getFormulariosLocales();
      }

      // Fusionar: servidor tiene los datos más completos,
      // locales tienen lo que aún no se ha sincronizado
      const mapaFusion = new Map<string, Formulario>();

      // Primero insertar locales (en caso de que haya datos no sincronizados)
      for (const f of localesActualizados) {
        mapaFusion.set(f.id, f);
      }

      // Luego insertar/sobrescribir con datos del servidor
      for (const f of servidor) {
        mapaFusion.set(f.id, { ...f, sincronizado: true });
      }

      const fusionados = Array.from(mapaFusion.values());
      console.log(
        `[VisitasJerarquicas] ${fusionados.length} formularios: ${localesCount} locales + ${servidorCount} servidor`
      );

      if (fusionados.length === 0) {
        setLoadError(
          servidorCount === 0 && localesCount === 0
            ? 'No se encontraron formularios en el servidor. Verifica que el backend esté activo.'
            : 'No hay formularios disponibles.'
        );
      }

      setFormularios(fusionados);
    } catch (error: any) {
      console.warn('[VisitasJerarquicas] Error cargando:', error?.message || error);
      setLoadError(`Error de conexión: ${error?.message || 'No se pudo conectar con el servidor'}`);
      // Fallback: solo locales
      try {
        const locales = await getFormulariosLocales();
        setFormularios(locales);
        if (locales.length === 0) {
          setLoadError(`Error de conexión — no se pudieron cargar los datos del servidor. Verifica que el backend esté activo.`);
        }
      } catch {
        setLoadError('Error al cargar los datos. Intenta de nuevo más tarde.');
      }
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Cargar al montar y recargar cada vez que la pantalla obtiene foco
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Interceptar botón físico/gesto de atrás para navegación jerárquica interna
  useEffect(() => {
    const onBackPress = () => {
      if (nivel === 'beneficiarios') {
        volverATecnicos();
        return true; // prevenir salida
      }
      if (nivel === 'visitas') {
        volverABeneficiarios();
        return true; // prevenir salida
      }
      return false; // salir de la pantalla
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [nivel]);

  // Interceptar gesto/swipe de navegación (iOS) para subir nivel jerárquico
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (nivelRef.current === 'tecnicos') return; // dejar salir
      e.preventDefault(); // prevenir salida
      // Subir un nivel (usar refs para evitar stale closure)
      if (nivelRef.current === 'visitas') {
        setNivel('beneficiarios');
        setBeneficiarioSeleccionado(null);
      } else if (nivelRef.current === 'beneficiarios') {
        setNivel('tecnicos');
        setTecnicoSeleccionado(null);
        setBeneficiarioSeleccionado(null);
      }
    });
    return unsubscribe;
  }, [navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // --- Navegación entre niveles ---
  const seleccionarTecnico = (tec: TecnicoConEstadisticas) => {
    setTecnicoSeleccionado(tec);
    setNivel('beneficiarios');
  };

  const seleccionarBeneficiario = (benef: BeneficiarioAgrupado) => {
    setBeneficiarioSeleccionado(benef);
    setNivel('visitas');
  };

  // Mantener ref sincronizada con estado nivel
  useEffect(() => {
    nivelRef.current = nivel;
  }, [nivel]);

  const volverATecnicos = () => {
    setNivel('tecnicos');
    setTecnicoSeleccionado(null);
    setBeneficiarioSeleccionado(null);
  };

  const volverABeneficiarios = () => {
    setNivel('beneficiarios');
    setBeneficiarioSeleccionado(null);
  };

  // --- ELIMINAR (solo admin, long-press) ---
  // Borra el formulario y TODO su árbol: revisiones, notificaciones,
  // mediciones, plantaciones y archivos (fotos/videos/firmas/PDF) —
  // ver backend/src/routes/forms.js (DELETE /api/formularios/:id).
  const confirmarEliminarVisita = (form: Formulario) => {
    if (!puedeEliminarFormulario) return;
    Alert.alert(
      'Eliminar visita',
      `¿Eliminar definitivamente esta visita de "${form.beneficiario?.nombre || 'este beneficiario'}"?\n\nSe borrará también todo lo asociado: revisiones, notificaciones, mediciones, plantaciones, fotos, videos, firmas y PDF. Esta acción NO se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar todo',
          style: 'destructive',
          onPress: async () => {
            setEliminandoId(form.id);
            try {
              await eliminarFormularioDelServidor(form.id);
              setFormularios((prev) => prev.filter((f) => f.id !== form.id));
              setBeneficiarioSeleccionado((prev) =>
                prev ? { ...prev, visitas: prev.visitas.filter((v) => v.id !== form.id) } : prev
              );
              setTecnicoSeleccionado((prev) =>
                prev ? { ...prev, totalVisitas: Math.max(0, prev.totalVisitas - 1) } : prev
              );
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'No se pudo eliminar la visita');
            } finally {
              setEliminandoId(null);
            }
          },
        },
      ]
    );
  };

  const abrirDetalleFormulario = (form: Formulario, modo?: 'online' | 'campo') => {
    // Detectar qué navegador está usando esta pantalla
    const state = navigation.getState();
    const currentRoute = state?.routes?.[state.index];
    const isInterventor = currentRoute?.name?.startsWith('Interventor');
    const detailScreen = isInterventor ? 'InterventorFormularioDetail' : 'SupervisionFormularioDetail';
    navigation.navigate(detailScreen, { formulario: form, modo });
  };

  const descargarMedia = async (form: Formulario) => {
    if (descargandoMediaId) return; // evita doble toque mientras arma otro paquete
    setDescargandoMediaId(form.id);
    try {
      await descargarPaqueteMedia(form);
    } finally {
      setDescargandoMediaId(null);
    }
  };

  // --- Render por nivel ---

  const renderBreadcrumb = () => (
    <View style={styles.breadcrumb}>
      <TouchableOpacity onPress={volverATecnicos} style={styles.breadcrumbItem}>
        <Text style={[styles.breadcrumbText, nivel === 'tecnicos' && styles.breadcrumbActive]}>
          Técnicos
        </Text>
      </TouchableOpacity>
      {nivel !== 'tecnicos' && (
        <>
          <Text style={styles.breadcrumbSep}>›</Text>
          <TouchableOpacity onPress={volverABeneficiarios} style={styles.breadcrumbItem}>
            <Text style={[styles.breadcrumbText, nivel === 'beneficiarios' && styles.breadcrumbActive]}>
              {tecnicoSeleccionado?.nombre || 'Beneficiarios'}
            </Text>
          </TouchableOpacity>
        </>
      )}
      {nivel === 'visitas' && (
        <>
          <Text style={styles.breadcrumbSep}>›</Text>
          <TouchableOpacity style={styles.breadcrumbItem}>
            <Text style={[styles.breadcrumbText, styles.breadcrumbActive]}>
              {beneficiarioSeleccionado?.nombre}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // --- Nivel 1: Técnicos ---
  const renderTecnico = ({ item }: { item: TecnicoConEstadisticas }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => seleccionarTecnico(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={[styles.avatarChip, { backgroundColor: COLORS.roleTecnico + '20' }]}>
          <Text style={[styles.avatarLetter, { color: COLORS.roleTecnico }]}>
            {item.nombre.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{item.nombre}</Text>
          <Text style={styles.cardSubtitle}>
            📍 {item.cedula || 'Sin cédula'} {item.telefono ? `· ${item.telefono}` : ''}
          </Text>
        </View>
        <View style={styles.cardHeaderAcciones}>
          <BotonPdfTecnico
            datos={{
              tecnicoNombre: item.nombre,
              tecnicoCedula: item.cedula,
              beneficiarios: beneficiariosParaInformeTecnico(item),
              rolUsuario: user?.rol || 'coordinador',
              nombreUsuario: user?.nombre || 'Usuario',
            }}
          />
          <Text style={styles.chevron}>›</Text>
        </View>
      </View>

      <View style={styles.visitasGrid}>
        {item.visitasStats.map((stat) => (
          <View key={stat.numero} style={styles.visitaGridCell}>
            <Text style={styles.visitaGridLabel}>Visita ({stat.numero}):</Text>
            <Text style={styles.visitaGridValue}>
              {stat.completados}/{stat.total}
            </Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );

  // --- Nivel 2: Beneficiarios ---
  const renderBeneficiario = ({ item }: { item: BeneficiarioAgrupado }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => seleccionarBeneficiario(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={[styles.avatarChip, { backgroundColor: COLORS.secondary + '20' }]}>
          <Text style={[styles.avatarLetter, { color: COLORS.secondaryDark }]}>
            {item.nombre.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{item.nombre}</Text>
          <Text style={styles.cardSubtitle}>
            📍 {item.vereda}, {item.municipio} {item.finca ? `· ${item.finca}` : ''}
          </Text>
        </View>
        <View style={styles.badgeContainer}>
          <View style={styles.badge}>
            <Text style={styles.badgeNumber}>{item.visitas.length}</Text>
            <Text style={styles.badgeLabel}>Visitas</Text>
          </View>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );

  // --- Nivel 3: Visitas ---
  const renderVisita = ({ item, index }: { item: Formulario; index: number }) => (
    <TouchableOpacity
      style={[styles.visitaCard, eliminandoId === item.id && styles.visitaCardEliminando]}
      onPress={() => abrirDetalleFormulario(item)}
      onLongPress={puedeEliminarFormulario ? () => confirmarEliminarVisita(item) : undefined}
      disabled={eliminandoId === item.id}
      activeOpacity={0.7}
    >
      <View style={styles.visitaHeader}>
        <View style={styles.visitaNumero}>
          <Text style={styles.visitaNumeroText}>Visita {index + 1}</Text>
        </View>
        {puedeEliminarFormulario && (
          <Text style={styles.visitaAdminHint}>
            {eliminandoId === item.id ? 'Eliminando…' : '🗑 Mantener para eliminar'}
          </Text>
        )}
        <Text style={styles.visitaFecha}>
          {new Date(item.created_at).toLocaleDateString('es-CO', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Text>
      </View>

      <View style={styles.visitaBody}>
        <View style={styles.visitaTag}>
          <Text style={styles.visitaTagText}>
            {item.tipo === 'caracterizacion' ? '📋 Caracterización'
              : item.tipo === 'visita_tecnica' ? `🔧 ${tituloVisitaTecnica(item.actividad?.visita_numero)}`
              : '🌱 Plantación'}
          </Text>
        </View>
        {item.actividad?.descripcion ? (
          <Text style={styles.visitaDesc} numberOfLines={2}>
            {item.actividad.descripcion}
          </Text>
        ) : null}
      </View>

      <View style={styles.visitaFooter}>
        <View style={styles.statusIndicator}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: item.sincronizado ? COLORS.success : COLORS.warning },
            ]}
          />
          <Text style={styles.statusText}>
            {item.sincronizado ? 'Sincronizado' : 'Pendiente'}
          </Text>
        </View>
        <View style={styles.visitaActions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnRevisionOnline]}
            onPress={() => abrirDetalleFormulario(item, 'online')}
          >
            <Text style={styles.actionBtnTextRevisionOnline}>🌐 Revisión en línea</Text>
          </TouchableOpacity>
          {/* Solo coordinación e interventoría registran el seguimiento de
              campo (es su propio formulario) — mismo rol que acepta el
              backend en /api/seguimientos. */}
          {(isCoordinador || isInterventor) && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnSeguimiento]}
              onPress={() => abrirDetalleFormulario(item, 'campo')}
            >
              <Text style={styles.actionBtnTextSeguimiento}>🛰️ Seguimiento en Campo</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPDF]}
            onPress={() => abrirDetalleFormulario(item)}
          >
            <Text style={styles.actionBtnTextPDF}>📄 PDF</Text>
          </TouchableOpacity>
          {item.sincronizado && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnMedia]}
              onPress={() => descargarMedia(item)}
              disabled={descargandoMediaId === item.id}
            >
              {descargandoMediaId === item.id ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Text style={styles.actionBtnTextMedia}>📦 Media</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  // --- Pantalla de carga ---
  if (isLoading) {
    return <LoadingSpinner message="Cargando visitas..." fullScreen />;
  }

  // --- Estadísticas generales ---
  const totalVisitas = formularios.length;
  const totalTecnicos = tecnicos.length;
  const totalBeneficiarios = tecnicos.reduce((sum, t) => sum + t.totalBeneficiarios, 0);

  return (
    <View style={styles.container}>
      {/* Header resumen */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalTecnicos}</Text>
          <Text style={styles.summaryLabel}>Técnicos</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalBeneficiarios}</Text>
          <Text style={styles.summaryLabel}>Beneficiarios</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalVisitas}</Text>
          <Text style={styles.summaryLabel}>Visitas</Text>
        </View>
      </View>

      {/* Breadcrumb */}
      {renderBreadcrumb()}

      {/* Lista según nivel */}
      {nivel === 'tecnicos' && (
        <FlatList
          data={tecnicosConStats}
          keyExtractor={(item) => item.id}
          renderItem={renderTecnico}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>👷</Text>
              <Text style={styles.emptyText}>No hay técnicos registrados</Text>
              <Text style={styles.emptySubtext}>
                {loadError || 'Aún no hay formularios en el sistema.'}
                {'\n'}Tira hacia abajo para refrescar.
              </Text>
            </View>
          }
        />
      )}

      {nivel === 'beneficiarios' && tecnicoSeleccionado && (
        <FlatList
          data={tecnicoSeleccionado.beneficiarios}
          keyExtractor={(item) => item.cedula || item.nombre}
          renderItem={renderBeneficiario}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.levelHeader}>
              <View style={styles.levelHeaderRow}>
                <View style={styles.levelHeaderTextos}>
                  <Text style={styles.levelTitle}>Beneficiarios de {tecnicoSeleccionado.nombre}</Text>
                  <Text style={styles.levelCount}>
                    {tecnicoSeleccionado.totalBeneficiarios} beneficiario(s), {tecnicoSeleccionado.totalVisitas} visita(s)
                  </Text>
                </View>
                <BotonPdfDashboard
                  datos={{
                    formularios: formulariosDelTecnicoSeleccionado,
                    rolUsuario: user?.rol || 'coordinador',
                    nombreUsuario: user?.nombre || 'Usuario',
                  }}
                />
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Sin beneficiarios</Text>
            </View>
          }
        />
      )}

      {nivel === 'visitas' && beneficiarioSeleccionado && (
        <FlatList
          data={beneficiarioSeleccionado.visitas}
          keyExtractor={(item) => item.id}
          renderItem={renderVisita}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.levelHeader}>
              <Text style={styles.levelTitle}>
                {beneficiarioSeleccionado.nombre}
              </Text>
              <Text style={styles.levelCount}>
                {beneficiarioSeleccionado.vereda}, {beneficiarioSeleccionado.municipio}
                {' · '}{beneficiarioSeleccionado.visitas.length} visita(s)
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Sin visitas registradas</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

// ============================================================
// ESTILOS
// ============================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // --- Summary bar ---
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
  },
  summaryLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.divider,
  },

  // --- Breadcrumb ---
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  breadcrumbItem: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  breadcrumbText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  breadcrumbActive: {
    color: COLORS.primary,
    fontWeight: FONTS.weights.bold,
  },
  breadcrumbSep: {
    fontSize: FONTS.sizes.lg,
    color: COLORS.textLight,
    marginHorizontal: 4,
  },

  // --- Level header ---
  levelHeader: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  levelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  levelHeaderTextos: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  levelTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  levelCount: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // --- Cards genéricos ---
  card: {
    backgroundColor: COLORS.surface,
    marginHorizontal: SPACING.md,
    marginVertical: 4,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarLetter: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  cardSubtitle: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: 6,
    marginRight: SPACING.sm,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: COLORS.primary + '10',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    minWidth: 44,
  },
  badgeSecondary: {
    backgroundColor: COLORS.roleCoordinador + '10',
  },
  badgeNumber: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
  },
  badgeLabel: {
    fontSize: 9,
    color: COLORS.textLight,
    textTransform: 'uppercase',
  },
  chevron: {
    fontSize: 22,
    color: COLORS.textLight,
    marginLeft: 4,
  },
  cardHeaderAcciones: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  // --- Grid de progreso "Visita (N): x/total" (tarjeta de técnico) ---
  visitasGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    columnGap: 6,
    rowGap: 6,
  },
  visitaGridCell: {
    width: '31%',
    backgroundColor: COLORS.primary + '0D',
    borderRadius: BORDER_RADIUS.sm,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitaGridLabel: {
    fontSize: 10,
    color: COLORS.textLight,
    fontWeight: FONTS.weights.medium,
  },
  visitaGridValue: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    marginTop: 1,
  },

  // --- Visita card (nivel 3) ---
  visitaCard: {
    backgroundColor: COLORS.surface,
    marginHorizontal: SPACING.md,
    marginVertical: 4,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  visitaCardEliminando: {
    opacity: 0.5,
  },
  visitaAdminHint: {
    fontSize: 10,
    color: COLORS.error,
  },
  visitaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  visitaNumero: {
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  visitaNumeroText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
  },
  visitaFecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  visitaBody: {
    marginBottom: SPACING.sm,
  },
  visitaTag: {
    marginBottom: 4,
  },
  visitaTagText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  visitaDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  visitaFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    paddingTop: SPACING.sm,
    gap: SPACING.xs,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  visitaActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.info + '15',
  },
  actionBtnPDF: {
    backgroundColor: COLORS.error + '10',
  },
  actionBtnTextPDF: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.error,
  },
  actionBtnMedia: {
    backgroundColor: COLORS.primary + '10',
    minWidth: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnTextMedia: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.primary,
  },
  actionBtnRevisionOnline: {
    backgroundColor: COLORS.roleCoordinador + '15',
  },
  actionBtnTextRevisionOnline: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.roleCoordinador,
  },
  actionBtnSeguimiento: {
    backgroundColor: COLORS.success + '15',
  },
  actionBtnTextSeguimiento: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.success,
  },

  // --- List ---
  listContent: {
    paddingVertical: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },

  // --- Empty state ---
  emptyState: {
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});

export default VisitasJerarquicasScreen;
