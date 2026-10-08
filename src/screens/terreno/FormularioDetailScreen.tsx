// ============================================================
// GEODAILY — Detalle de Formulario (Read-Only + PDF)
// ============================================================
// Muestra todos los datos de un formulario completado,
// con miniaturas de evidencias y opciones de PDF.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  Platform,
  Dimensions,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { Formulario, DatosCaracterizacionNueva, FotoGeotag } from '../../types';
import VideoPlayerModal from '../../components/VideoPlayerModal';
import CapturaGPSPrecisa from '../../components/CapturaGPSPrecisa';
import {
  resolverEvidenciasRemotas,
  cabecerasDeArchivo,
  resolverFirmasRemotas,
  fuenteConAuth,
  FirmaResuelta,
  eliminarEvidenciaRemota,
  ROLES_PUEDEN_ELIMINAR_EVIDENCIA,
} from '../../services/archivos.service';
import { deleteEvidenciaLocal, saveFormularioLocal, getUnsyncedPhotos, getUnsyncedVideos } from '../../services/database';
import { eliminarArchivoLocal } from '../../services/mediaStorage.service';
import { useSync } from '../../store/SyncContext';
import { fetchDocumentosDeFormulario, fetchDocumentosDeBeneficiario, DocumentoDeFormulario } from '../../services/documentos.service';
import { formatFecha } from '../../utils/formatters';
import { construirSeccionesEncuesta, esEncuestaSocial } from '../../utils/encuestaSchema';
import { esVisitaTecnicaV2, tituloVisitaTecnica } from '../../utils/visitaTecnica';
import {
  RECONOCIMIENTO_OPTS,
  NIVEL_EDUCATIVO_ENV_OPTS,
  FUENTE_INGRESOS_ENV_OPTS,
  INGRESOS_SALARIOS_OPTS,
  OCUPACION_SECUNDARIA_OPTS,
  TIPO_ASOCIACION_OPTS,
  VIVIENDA_UBICACION_OPTS,
  TIPO_ENERGIA_OPTS,
  AGUA_CONSUMO_OPTS,
  ELEMENTOS_TECNOLOGICOS_OPTS,
  QUIENES_TRABAJAN_OPTS,
  MEDIO_TRANSPORTE_OPTS,
  MEDIO_SALIDA_OPTS,
  ANALISIS_SUELO_REALIZADO_OPTS,
  TEXTURA_SUELO_OPTS,
  COLOR_SUELO_OPTS,
  DRENAJE_OPTS,
  USO_TIERRA_HISTORICO_OPTS,
  PRESENCIA_PIEDRAS_OPTS,
  COMPACTACION_OPTS,
  COBERTURA_SUELO_OPTS,
  EVIDENCIA_EROSION_OPTS,
  PROCESOS_EROSION_OPTS,
  FUENTES_HIDRICAS_OPTS,
  AREAS_CONSERVACION_OPTS,
  PRACTICAS_CONSERVACION_OPTS,
  TIPO_AGROQUIMICO_OPTS,
  MANEJO_RESIDUOS_OPTS,
  SEXO_OPTS,
  SINO_OPTS,
} from '../../utils/constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { convertirFotosAHTML, generarSelloBiometrico } from '../../services/pdfLocal.service';
import { abrirVentanaDeCarga, imprimirHtmlEnVentana } from '../../utils/printWeb';
import { useAuth } from '../../store/AuthContext';
import {
  registrarRevision,
  Revision,
} from '../../services/revisiones.service';
import { useRevisiones } from '../../hooks/useRevisiones';
import { descargarPaqueteMedia } from '../../services/mediaPackage.service';
import SeguimientoCoordinacionSection from '../../components/SeguimientoCoordinacionSection';
import { actualizarRespuestaFormulario } from '../../services/formularios.service';

type FormularioDetailScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: RouteProp<Record<string, any> & { params: { formulario: Formulario; modo?: 'online' | 'campo' } }, 'params'>;
};

const RUTAS_RESPUESTAS_FORMULARIO_1: Record<string, string> = {
  'DATOS GENERALES__Fecha': 'fecha',
  'DATOS GENERALES__Municipio': 'municipio',
  'DATOS GENERALES__Vereda': 'vereda',
  'DATOS GENERALES__Nombre del productor': 'productor_nombre',
  'DATOS GENERALES__Edad (años)': 'edad',
  'DATOS GENERALES__Sexo': 'sexo',
  'DATOS GENERALES__Documento (C.C.)': 'documento',
  'DATOS GENERALES__Teléfono': 'telefono',
  'DATOS GENERALES__Técnico responsable': 'tecnico_responsable',
  'DATOS GENERALES__Corregimiento': 'corregimiento',
  'COMPONENTE SOCIAL__1': 'componente_social.reconocimiento',
  'COMPONENTE SOCIAL__2': 'componente_social.nivel_educativo',
  'COMPONENTE SOCIAL__3': 'componente_social.participo_eca',
  'COMPONENTE SOCIAL__4': 'componente_social.personas_nucleo',
  'COMPONENTE SOCIAL__5': 'componente_social.fuente_ingresos',
  'COMPONENTE SOCIAL__6': 'componente_social.ingresos_salarios',
  'COMPONENTE SOCIAL__7': 'componente_social.ocupacion_secundaria',
  'COMPONENTE SOCIAL__8': 'componente_social.participa_organizacion',
  'COMPONENTE SOCIAL__9': 'componente_social.tipo_asociacion',
  'COMPONENTE SOCIAL__10': 'componente_social.rol_asociacion',
  'COMPONENTE SOCIAL__11': 'componente_social.vivienda_ubicacion',
  'COMPONENTE SOCIAL__12': 'componente_social.energia_electrica',
  'COMPONENTE SOCIAL__13': 'componente_social.tipo_energia',
  'COMPONENTE SOCIAL__14': 'componente_social.agua_consumo',
  'COMPONENTE SOCIAL__15': 'componente_social.elementos_tecnologicos',
  'COMPONENTE SOCIAL__16': 'componente_social.senal_celular',
  'COMPONENTE SOCIAL__17': 'componente_social.quienes_trabajan',
  'COMPONENTE SOCIAL__18': 'componente_social.medio_transporte',
  'CARACTERIZACIÓN DE LA FINCA__19': 'caracterizacion_finca.nombre_finca',
  'CARACTERIZACIÓN DE LA FINCA__20': 'caracterizacion_finca.latitud',
  'CARACTERIZACIÓN DE LA FINCA__21': 'caracterizacion_finca.area_total',
  'CARACTERIZACIÓN DE LA FINCA__22': 'caracterizacion_finca.division_bosque',
  'CARACTERIZACIÓN DE LA FINCA__23': 'caracterizacion_finca.medio_salida',
  'CARACTERIZACIÓN DE LA FINCA__24': 'caracterizacion_finca.distancia_km',
  'CARACTERIZACIÓN DE LA FINCA__25': 'caracterizacion_finca.distancia_observaciones',
  'CARACTERIZACIÓN DE LA FINCA__26': 'caracterizacion_finca.aprovechamiento_directo',
  'CARACTERIZACIÓN DE LA FINCA__27': 'caracterizacion_finca.actividades_finca',
  'COMPONENTE PRODUCTIVO__28': 'componente_productivo.actividad_principal',
  'COMPONENTE PRODUCTIVO__29': 'componente_productivo.acceso_agua',
  'COMPONENTE PRODUCTIVO__30': 'componente_productivo.sistemas_riego',
  'COMPONENTE PRODUCTIVO__31': 'componente_productivo.asistencia_tecnica',
  'SECCIÓN DE SUELO__32': 'analisis_suelo.intervencion_latitud',
  'SECCIÓN DE SUELO__33': 'analisis_suelo.analisis_realizado',
  'SECCIÓN DE SUELO__34': 'analisis_suelo.textura',
  'SECCIÓN DE SUELO__35': 'analisis_suelo.color',
  'SECCIÓN DE SUELO__36': 'analisis_suelo.drenaje',
  'SECCIÓN DE SUELO__37': 'analisis_suelo.uso_tierra',
  'SECCIÓN DE SUELO__38': 'analisis_suelo.piedras',
  'SECCIÓN DE SUELO__39': 'analisis_suelo.compactacion',
  'SECCIÓN DE SUELO__40': 'analisis_suelo.cobertura',
  'SECCIÓN DE SUELO__41': 'analisis_suelo.erosion',
  'SECCIÓN DE SUELO__42': 'analisis_suelo.pendiente',
  'COMPONENTE AGROAMBIENTAL__43': 'componente_agroambiental.procesos_erosion',
  'COMPONENTE AGROAMBIENTAL__44': 'componente_agroambiental.fuentes_hidricas',
  'COMPONENTE AGROAMBIENTAL__45': 'componente_agroambiental.areas_conservacion',
  'COMPONENTE AGROAMBIENTAL__46': 'componente_agroambiental.practicas_conservacion',
  'COMPONENTE AGROAMBIENTAL__47': 'componente_agroambiental.uso_agroquimicos',
  'COMPONENTE AGROAMBIENTAL__48': 'componente_agroambiental.tipo_agroquimicos',
  'COMPONENTE AGROAMBIENTAL__49': 'componente_agroambiental.herbicidas_cuales',
  'COMPONENTE AGROAMBIENTAL__50': 'componente_agroambiental.manejo_residuos',
  'RECOMENDACIONES DEL TÉCNICO__51': 'recomendaciones.recomendaciones_tecnicas',
  'RECOMENDACIONES DEL TÉCNICO__52': 'recomendaciones.compromisos_productor',
  'RECOMENDACIONES DEL TÉCNICO__53': 'recomendaciones.recomendaciones_ambientales',
  'DESARROLLO ACOMPAÑAMIENTO TÉCNICO__1': 'acompaniamiento.actividades_realizadas_obs',
  'DESARROLLO ACOMPAÑAMIENTO TÉCNICO__2': 'acompaniamiento.manejo_plagas_hectareas',
  'DESARROLLO ACOMPAÑAMIENTO TÉCNICO__3': 'acompaniamiento.manejo_suelo_cantidad',
  'DESARROLLO ACOMPAÑAMIENTO TÉCNICO__4': 'acompaniamiento.capacitacion_obs',
  'DESARROLLO ACOMPAÑAMIENTO TÉCNICO__5': 'acompaniamiento.seguimiento_obs',
  'DESARROLLO ACOMPAÑAMIENTO TÉCNICO__6': 'acompaniamiento.entresacado_obs',
  'DESARROLLO ACOMPAÑAMIENTO TÉCNICO__7': 'acompaniamiento.observaciones_visita',
};

/**
 * Tipo de control con el que se completa cada pregunta del Formulario 1.
 * Es el espejo del formulario original (FormularioCaracterizacionScreen):
 * las preguntas de opción múltiple se responden marcando casillas, las de
 * selección única tocando una opción, y el resto son campo abierto (texto).
 * La clave es el path destino (mismo valor de RUTAS_RESPUESTAS_FORMULARIO_1).
 * Si un path no aparece aquí, cae en campo de texto (comportamiento previo).
 */
type EspecRespuesta = {
  tipo: 'texto' | 'seleccion' | 'multiple' | 'gps';
  opciones?: readonly string[];
  keyboardType?: 'default' | 'numeric' | 'phone-pad';
  multiline?: boolean;
  /**
   * Solo para tipo 'gps': paths de los campos hermanos que acompañan a la
   * latitud (longitud, altitud y precisión). La captura GPS de alta precisión
   * produce los cuatro valores a la vez, así que al guardar hay que escribir
   * cada uno en su propio campo del formulario.
   */
  gpsCampos?: {
    latitud: string;
    longitud: string;
    altitud?: string;
    precision?: string;
  };
};

const RESPUESTA_ESPEC: Record<string, EspecRespuesta> = {
  // --- DATOS GENERALES ---
  fecha: { tipo: 'texto' },
  municipio: { tipo: 'seleccion', opciones: ['Puerto Rico'] },
  vereda: { tipo: 'texto' },
  productor_nombre: { tipo: 'texto' },
  edad: { tipo: 'texto', keyboardType: 'numeric' },
  sexo: { tipo: 'seleccion', opciones: SEXO_OPTS },
  documento: { tipo: 'texto', keyboardType: 'numeric' },
  telefono: { tipo: 'texto', keyboardType: 'phone-pad' },
  tecnico_responsable: { tipo: 'texto' },
  corregimiento: { tipo: 'texto' },

  // --- COMPONENTE SOCIAL ---
  'componente_social.reconocimiento': { tipo: 'seleccion', opciones: RECONOCIMIENTO_OPTS },
  'componente_social.nivel_educativo': { tipo: 'seleccion', opciones: NIVEL_EDUCATIVO_ENV_OPTS },
  'componente_social.participo_eca': { tipo: 'seleccion', opciones: SINO_OPTS },
  'componente_social.personas_nucleo': { tipo: 'texto', keyboardType: 'numeric' },
  'componente_social.fuente_ingresos': { tipo: 'seleccion', opciones: FUENTE_INGRESOS_ENV_OPTS },
  'componente_social.ingresos_salarios': { tipo: 'seleccion', opciones: INGRESOS_SALARIOS_OPTS },
  'componente_social.ocupacion_secundaria': { tipo: 'seleccion', opciones: OCUPACION_SECUNDARIA_OPTS },
  'componente_social.participa_organizacion': { tipo: 'seleccion', opciones: SINO_OPTS },
  'componente_social.tipo_asociacion': { tipo: 'seleccion', opciones: TIPO_ASOCIACION_OPTS },
  'componente_social.rol_asociacion': { tipo: 'texto' },
  'componente_social.vivienda_ubicacion': { tipo: 'seleccion', opciones: VIVIENDA_UBICACION_OPTS },
  'componente_social.energia_electrica': { tipo: 'seleccion', opciones: SINO_OPTS },
  'componente_social.tipo_energia': { tipo: 'seleccion', opciones: TIPO_ENERGIA_OPTS },
  'componente_social.agua_consumo': { tipo: 'seleccion', opciones: AGUA_CONSUMO_OPTS },
  'componente_social.elementos_tecnologicos': { tipo: 'multiple', opciones: ELEMENTOS_TECNOLOGICOS_OPTS },
  'componente_social.senal_celular': { tipo: 'seleccion', opciones: SINO_OPTS },
  'componente_social.quienes_trabajan': { tipo: 'multiple', opciones: QUIENES_TRABAJAN_OPTS },
  'componente_social.medio_transporte': { tipo: 'multiple', opciones: MEDIO_TRANSPORTE_OPTS },

  // --- CARACTERIZACIÓN DE LA FINCA ---
  'caracterizacion_finca.nombre_finca': { tipo: 'texto' },
  // P20 — Coordenada de la finca: captura GPS de alta precisión (cuenta
  // regresiva + mapa), igual que en el formulario original. Al guardar se
  // escriben latitud, longitud y altitud en sus campos hermanos.
  'caracterizacion_finca.latitud': {
    tipo: 'gps',
    gpsCampos: {
      latitud: 'caracterizacion_finca.latitud',
      longitud: 'caracterizacion_finca.longitud',
      altitud: 'caracterizacion_finca.altitud',
    },
  },
  'caracterizacion_finca.area_total': { tipo: 'texto', keyboardType: 'numeric' },
  'caracterizacion_finca.medio_salida': { tipo: 'seleccion', opciones: MEDIO_SALIDA_OPTS },
  'caracterizacion_finca.distancia_km': { tipo: 'texto', keyboardType: 'numeric' },
  'caracterizacion_finca.distancia_observaciones': { tipo: 'texto', multiline: true },
  'caracterizacion_finca.aprovechamiento_directo': { tipo: 'seleccion', opciones: SINO_OPTS },

  // --- COMPONENTE PRODUCTIVO ---
  'componente_productivo.acceso_agua': { tipo: 'seleccion', opciones: SINO_OPTS },
  'componente_productivo.sistemas_riego': { tipo: 'seleccion', opciones: SINO_OPTS },
  'componente_productivo.asistencia_tecnica': { tipo: 'seleccion', opciones: SINO_OPTS },

  // --- SECCIÓN DE SUELO ---
  // P32 — Coordenada de la intervención: captura GPS de alta precisión.
  'analisis_suelo.intervencion_latitud': {
    tipo: 'gps',
    gpsCampos: {
      latitud: 'analisis_suelo.intervencion_latitud',
      longitud: 'analisis_suelo.intervencion_longitud',
      altitud: 'analisis_suelo.intervencion_altitud',
    },
  },
  'analisis_suelo.analisis_realizado': { tipo: 'seleccion', opciones: ANALISIS_SUELO_REALIZADO_OPTS },
  'analisis_suelo.textura': { tipo: 'multiple', opciones: TEXTURA_SUELO_OPTS },
  'analisis_suelo.color': { tipo: 'seleccion', opciones: COLOR_SUELO_OPTS },
  'analisis_suelo.drenaje': { tipo: 'seleccion', opciones: DRENAJE_OPTS },
  'analisis_suelo.uso_tierra': { tipo: 'seleccion', opciones: USO_TIERRA_HISTORICO_OPTS },
  'analisis_suelo.piedras': { tipo: 'seleccion', opciones: PRESENCIA_PIEDRAS_OPTS },
  'analisis_suelo.compactacion': { tipo: 'seleccion', opciones: COMPACTACION_OPTS },
  'analisis_suelo.cobertura': { tipo: 'seleccion', opciones: COBERTURA_SUELO_OPTS },
  'analisis_suelo.erosion': { tipo: 'seleccion', opciones: EVIDENCIA_EROSION_OPTS },
  'analisis_suelo.pendiente': { tipo: 'texto', keyboardType: 'numeric' },

  // --- COMPONENTE AGROAMBIENTAL ---
  'componente_agroambiental.procesos_erosion': { tipo: 'seleccion', opciones: PROCESOS_EROSION_OPTS },
  'componente_agroambiental.fuentes_hidricas': { tipo: 'seleccion', opciones: FUENTES_HIDRICAS_OPTS },
  'componente_agroambiental.areas_conservacion': { tipo: 'multiple', opciones: AREAS_CONSERVACION_OPTS },
  'componente_agroambiental.practicas_conservacion': { tipo: 'seleccion', opciones: PRACTICAS_CONSERVACION_OPTS },
  'componente_agroambiental.uso_agroquimicos': { tipo: 'seleccion', opciones: SINO_OPTS },
  'componente_agroambiental.tipo_agroquimicos': { tipo: 'seleccion', opciones: TIPO_AGROQUIMICO_OPTS },
  'componente_agroambiental.herbicidas_cuales': { tipo: 'texto' },
  'componente_agroambiental.manejo_residuos': { tipo: 'seleccion', opciones: MANEJO_RESIDUOS_OPTS },

  // --- RECOMENDACIONES DEL TÉCNICO ---
  'recomendaciones.recomendaciones_tecnicas': { tipo: 'texto', multiline: true },
  'recomendaciones.compromisos_productor': { tipo: 'texto', multiline: true },
  'recomendaciones.recomendaciones_ambientales': { tipo: 'texto', multiline: true },

  // --- DESARROLLO ACOMPAÑAMIENTO TÉCNICO (observaciones) ---
  'acompaniamiento.actividades_realizadas_obs': { tipo: 'texto', multiline: true },
  'acompaniamiento.capacitacion_obs': { tipo: 'texto', multiline: true },
  'acompaniamiento.seguimiento_obs': { tipo: 'texto', multiline: true },
  'acompaniamiento.entresacado_obs': { tipo: 'texto', multiline: true },
  'acompaniamiento.observaciones_visita': { tipo: 'texto', multiline: true },
};

// ============================================================
// Sección de Revisión — flujo jerárquico de retroalimentación
// (técnico ve el estado; coordinador/interventor/gerente/admin revisan)
// ============================================================

const ROL_LABEL: Record<string, string> = {
  coordinador: 'Coordinador/a',
  interventor: 'Interventor',
  gerente: 'Gerente',
  admin: 'Administrador',
};

const SeccionRevision: React.FC<{ formulario: Formulario; revisiones: Revision[]; cargando: boolean; recargar: () => Promise<void> }> = ({ formulario, revisiones, recargar }) => {
  const formularioId = formulario.id;
  const { user } = useAuth();
  const rol = user?.rol || 'tecnico';
  const esRevisor = ['coordinador', 'interventor', 'gerente', 'admin'].includes(rol);

  const [enviando, setEnviando] = useState(false);
  const [modalNovedad, setModalNovedad] = useState(false);
  const [novedadTexto, setNovedadTexto] = useState('');

  const cargar = recargar;

  const estadoDe = (r: string): 'ok' | 'novedades' | null => {
    if (revisiones.some((x) => x.revisor_rol === r && x.tipo === 'visto_bueno')) return 'ok';
    if (revisiones.some((x) => x.revisor_rol === r && x.tipo === 'novedad')) return 'novedades';
    return null;
  };
  const yaAprobePorMiRol = estadoDe(rol) === 'ok';
  const novedades = revisiones.filter((r) => r.tipo === 'novedad');

  const enviarNovedad = async () => {
    if (!novedadTexto.trim()) {
      Alert.alert('Novedad vacía', 'Escribe la observación o corrección solicitada.');
      return;
    }
    setEnviando(true);
    try {
      await registrarRevision(formularioId, 'novedad', novedadTexto.trim());
      setNovedadTexto('');
      setModalNovedad(false);
      await cargar();
      Alert.alert('✅ Novedad registrada', 'El técnico verá esta observación en el formulario.');
    } catch (error) {
      Alert.alert('No se pudo registrar', error instanceof Error ? error.message : String(error));
    } finally {
      setEnviando(false);
    }
  };

  const enviarVistoBueno = async () => {
    setEnviando(true);
    try {
      await registrarRevision(formularioId, 'visto_bueno');
      await cargar();
      Alert.alert('✅ Todo OK', 'Visto bueno registrado correctamente.');
    } catch (error) {
      Alert.alert('No se pudo aprobar', error instanceof Error ? error.message : String(error));
    } finally {
      setEnviando(false);
    }
  };

  const handleTodoOK = () => {
    Alert.alert('Dar visto bueno', '¿Confirmas que este formulario está correcto (Todo OK)?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Todo OK', onPress: () => enviarVistoBueno() },
    ]);
  };

  const Chip = ({ rolChip }: { rolChip: 'coordinador' | 'interventor' }) => {
    const est = estadoDe(rolChip);
    return (
      <View style={[rev.chip, est === 'ok' ? rev.chipOk : est === 'novedades' ? rev.chipNov : rev.chipPend]}>
        <Text style={rev.chipText}>
          {ROL_LABEL[rolChip]}: {est === 'ok' ? '✔ Todo OK' : est === 'novedades' ? '⚠ Novedades' : '— Pendiente'}
        </Text>
      </View>
    );
  };

  return (
    <View style={rev.section}>
      <Text style={rev.title}>🔎 Revisión y Aprobación</Text>

      {/* Estado jerárquico (visible para todos, incluido el técnico) */}
      <View style={rev.chipsRow}>
        <Chip rolChip="coordinador" />
        <Chip rolChip="interventor" />
      </View>

      {/* Novedades registradas */}
      {novedades.length > 0 && (
        <View style={rev.novedadesBox}>
          <Text style={rev.novedadesTitle}>⚠ Novedades ({novedades.length})</Text>
          {novedades.map((n) => (
            <View key={n.id} style={rev.novedadItem}>
              <Text style={rev.novedadMeta}>
                {ROL_LABEL[n.revisor_rol] || n.revisor_rol} · {n.revisor_nombre || ''} · {formatFecha(n.created_at)}
              </Text>
              <Text style={rev.novedadTexto}>{n.comentario}</Text>
            </View>
          ))}
        </View>
      )}
      {novedades.length === 0 && revisiones.length === 0 && (
        <Text style={rev.sinRevisiones}>Aún no hay revisiones para este formulario.</Text>
      )}

      {/* Acciones (solo roles superiores) — botones independientes.
          El detalle por sección de la encuesta trae su propio control de
          Novedad/Aprobado (ver SeccionMiniRevision); estos dos botones
          quedan como aprobación/novedad GLOBAL del formulario, útiles
          también para formularios que no tienen secciones clonadas
          (ej. visita técnica). */}
      {esRevisor && (
        <View style={rev.botonesRow}>
          <TouchableOpacity style={[rev.boton, rev.botonNovedad]} onPress={() => setModalNovedad(true)} disabled={enviando}>
            <Text style={rev.botonTexto}>📝 Novedad general</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[rev.boton, yaAprobePorMiRol ? rev.botonDeshabilitado : rev.botonOk]}
            onPress={handleTodoOK}
            disabled={enviando || yaAprobePorMiRol}
          >
            <Text style={rev.botonTexto}>
              {yaAprobePorMiRol ? '✔ Ya aprobado por ti' : '✅ Todo OK'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modal: registrar novedad */}
      <Modal visible={modalNovedad} transparent animationType="fade" onRequestClose={() => setModalNovedad(false)}>
        <View style={rev.modalFondo}>
          <View style={rev.modalCard}>
            <Text style={rev.modalTitulo}>📝 Registrar Novedad</Text>
            <Text style={rev.modalSub}>Describe la observación o corrección que el técnico debe atender:</Text>
            <TextInput
              style={rev.inputMultiline}
              multiline
              numberOfLines={4}
              value={novedadTexto}
              onChangeText={setNovedadTexto}
              placeholder="Ej: Falta la foto del lote norte…"
              placeholderTextColor={COLORS.textLight}
            />
            <View style={rev.modalBotones}>
              <TouchableOpacity style={[rev.boton, rev.botonCancelar]} onPress={() => setModalNovedad(false)}>
                <Text style={rev.botonTextoOscuro}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[rev.boton, rev.botonNovedad]} onPress={enviarNovedad} disabled={enviando}>
                <Text style={rev.botonTexto}>{enviando ? 'Enviando…' : 'Registrar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ============================================================
// Control de Novedad/Aprobado POR SECCIÓN — reemplaza los antiguos
// checklists genéricos "Formulario en línea"/"Formulario en campo".
// Se renderiza debajo de cada sección de la encuesta clonada.
// ============================================================

const SeccionMiniRevision: React.FC<{
  formularioId: string;
  seccionTitulo: string;
  revisiones: Revision[];
  rol: string;
  esRevisor: boolean;
  recargar: () => Promise<void>;
}> = ({ formularioId, seccionTitulo, revisiones, rol, esRevisor, recargar }) => {
  const [enviando, setEnviando] = useState(false);
  const [mostrarInput, setMostrarInput] = useState(false);
  const [texto, setTexto] = useState('');

  const deEstaSeccion = revisiones.filter((r) => r.seccion === seccionTitulo);
  const estadoDeRol = (r: string): 'ok' | 'novedades' | null => {
    const propias = deEstaSeccion
      .filter((x) => x.revisor_rol === r)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (!propias[0]) return null;
    return propias[0].tipo === 'visto_bueno' ? 'ok' : 'novedades';
  };
  const miEstado = estadoDeRol(rol);

  const marcarAprobado = async () => {
    setEnviando(true);
    try {
      await registrarRevision(formularioId, 'visto_bueno', undefined, undefined, seccionTitulo);
      await recargar();
    } catch (error) {
      Alert.alert('No se pudo aprobar', error instanceof Error ? error.message : String(error));
    } finally {
      setEnviando(false);
    }
  };

  const enviarNovedadSeccion = async () => {
    if (!texto.trim()) {
      Alert.alert('Novedad vacía', 'Escribe la observación de esta sección.');
      return;
    }
    setEnviando(true);
    try {
      await registrarRevision(formularioId, 'novedad', texto.trim(), undefined, seccionTitulo);
      setTexto('');
      setMostrarInput(false);
      await recargar();
    } catch (error) {
      Alert.alert('No se pudo registrar', error instanceof Error ? error.message : String(error));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <View style={mini.container}>
      {(['coordinador', 'interventor'] as const).map((r) => {
        const est = estadoDeRol(r);
        if (!est) return null;
        return (
          <View key={r} style={[mini.chip, est === 'ok' ? mini.chipOk : mini.chipNov]}>
            <Text style={mini.chipText}>
              {ROL_LABEL[r]}: {est === 'ok' ? '✔ Aprobado' : '⚠ Novedad'}
            </Text>
          </View>
        );
      })}

      {deEstaSeccion.filter((r) => r.tipo === 'novedad').map((n) => (
        <Text key={n.id} style={mini.novedadTexto}>
          ⚠ {ROL_LABEL[n.revisor_rol] || n.revisor_rol}: {n.comentario}
        </Text>
      ))}

      {esRevisor && (
        <View style={mini.accionesRow}>
          <TouchableOpacity
            style={[mini.btn, mini.btnNovedad]}
            onPress={() => setMostrarInput((v) => !v)}
            disabled={enviando}
          >
            <Text style={mini.btnText}>📝 Novedad</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[mini.btn, miEstado === 'ok' ? mini.btnDeshabilitado : mini.btnOk]}
            onPress={marcarAprobado}
            disabled={enviando || miEstado === 'ok'}
          >
            <Text style={mini.btnText}>{miEstado === 'ok' ? '✔ Aprobado' : '✅ Aprobado'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {mostrarInput && (
        <View style={mini.inputRow}>
          <TextInput
            style={mini.input}
            multiline
            value={texto}
            onChangeText={setTexto}
            placeholder="Describe la novedad de esta sección..."
            placeholderTextColor={COLORS.textLight}
          />
          <TouchableOpacity style={[mini.btn, mini.btnNovedad]} onPress={enviarNovedadSeccion} disabled={enviando}>
            <Text style={mini.btnText}>{enviando ? '...' : 'Enviar'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const mini = StyleSheet.create({
  container: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider },
  chip: { alignSelf: 'flex-start', paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: BORDER_RADIUS.full, marginBottom: 4 },
  chipOk: { backgroundColor: COLORS.success + '22' },
  chipNov: { backgroundColor: COLORS.warning + '22' },
  chipText: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary },
  novedadTexto: { fontSize: FONTS.sizes.xs, color: COLORS.error, marginBottom: 2 },
  accionesRow: { flexDirection: 'row', gap: SPACING.xs, marginTop: 4 },
  btn: { paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: BORDER_RADIUS.sm },
  btnNovedad: { backgroundColor: COLORS.info },
  btnOk: { backgroundColor: COLORS.success },
  btnDeshabilitado: { backgroundColor: COLORS.textLight },
  btnText: { color: '#fff', fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold },
  inputRow: { marginTop: SPACING.xs, gap: SPACING.xs },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm, minHeight: 44, textAlignVertical: 'top',
    fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, backgroundColor: COLORS.background,
  },
});

const rev = StyleSheet.create({
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.info,
    ...SHADOWS.sm,
  },
  title: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  chipsRow: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap', marginBottom: SPACING.sm },
  chip: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: BORDER_RADIUS.full },
  chipOk: { backgroundColor: COLORS.success + '22' },
  chipNov: { backgroundColor: COLORS.warning + '22' },
  chipPend: { backgroundColor: COLORS.divider },
  chipText: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary },
  novedadesBox: { marginBottom: SPACING.sm },
  novedadesTitle: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.error, marginBottom: 4 },
  novedadItem: { borderLeftWidth: 3, borderLeftColor: COLORS.error, paddingLeft: SPACING.sm, marginBottom: SPACING.xs },
  novedadMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  novedadTexto: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary },
  sinRevisiones: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  botonesRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  boton: { flex: 1, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.md, alignItems: 'center', paddingHorizontal: SPACING.sm },
  botonNovedad: { backgroundColor: COLORS.info },
  botonOk: { backgroundColor: COLORS.success },
  botonCancelar: { backgroundColor: COLORS.divider },
  botonDeshabilitado: { backgroundColor: COLORS.textLight },
  botonTexto: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm, textAlign: 'center' },
  botonTextoOscuro: { color: COLORS.textPrimary, fontWeight: FONTS.weights.medium, fontSize: FONTS.sizes.sm },
  modalFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: SPACING.lg },
  modalScroll: { flexGrow: 1, justifyContent: 'center' },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg },
  modalTitulo: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  modalSub: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  inputMultiline: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, minHeight: 70, textAlignVertical: 'top',
    fontSize: FONTS.sizes.md, color: COLORS.textPrimary, marginBottom: SPACING.sm,
  },
  modalBotones: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  // Aviso de novedades que ve el TÉCNICO arriba del detalle
  avisoBox: {
    backgroundColor: COLORS.warning + '18',
    borderRadius: BORDER_RADIUS.lg,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  avisoTitulo: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  avisoSub: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  avisoItem: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.error,
    paddingLeft: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  avisoMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  avisoTexto: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary },
  avisoPie: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
});

// ============================================================
// Aviso de Novedades — se muestra ARRIBA del detalle cuando el
// técnico abre un formulario que sus superiores marcaron con
// observaciones. En modo revisión (online/campo) ya existe
// SeccionRevision con esta misma información, por eso ese caso
// no usa este banner.
// ============================================================

const BannerNovedades: React.FC<{ revisiones: Revision[] }> = ({ revisiones }) => {
  // Si coordinación (o admin) ya dio el visto bueno global, las novedades
  // quedan resueltas y el aviso desaparece — igual que el badge del listado.
  const aprobadoGlobal = revisiones.some(
    (r) =>
      r.tipo === 'visto_bueno' &&
      (r.revisor_rol === 'coordinador' || r.revisor_rol === 'admin') &&
      !r.seccion
  );
  const novedades = revisiones
    .filter((r) => r.tipo === 'novedad')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (novedades.length === 0 || aprobadoGlobal) return null;

  return (
    <View style={rev.avisoBox}>
      <Text style={rev.avisoTitulo}>⚠️ {novedades.length} novedad(es) por corregir</Text>
      <Text style={rev.avisoSub}>Esto fue lo que señalaron tus superiores:</Text>
      {novedades.map((n) => (
        <View key={n.id} style={rev.avisoItem}>
          <Text style={rev.avisoMeta}>
            {ROL_LABEL[n.revisor_rol] || n.revisor_rol}
            {n.revisor_nombre ? ` · ${n.revisor_nombre}` : ''}
            {` · ${formatFecha(n.created_at)}`}
            {n.seccion ? ` · Sección: ${n.seccion}` : ''}
          </Text>
          <Text style={rev.avisoTexto}>{n.comentario}</Text>
        </View>
      ))}
      <Text style={rev.avisoPie}>
        Corrige lo señalado. Si falta responder alguna pregunta, usa el botón «✎ Completar».
      </Text>
    </View>
  );
};

/**
 * Bloque de texto largo para el detalle: la etiqueta arriba y el contenido
 * debajo, en vez de la fila etiqueta/valor alineada a la derecha (que queda
 * ilegible con descripciones, objetivos y recomendaciones de varios renglones).
 */
const BloqueTexto: React.FC<{ titulo: string; texto: string }> = ({ titulo, texto }) => (
  <View style={styles.bloqueTexto}>
    <Text style={styles.bloqueTextoLabel}>{titulo}</Text>
    <Text style={styles.listaItem}>{texto}</Text>
  </View>
);

const FormularioDetailScreen: React.FC<FormularioDetailScreenProps> = ({ route, navigation: _navigation }) => {
  const { formulario: formularioInicial, modo } = route.params;
  const [formulario, setFormulario] = useState(formularioInicial);
  const insets = useSafeAreaInsets();
  const { user: usuarioActual } = useAuth();
  const rolActual = usuarioActual?.rol || 'tecnico';
  const esRevisorActual = ['coordinador', 'interventor', 'gerente', 'admin'].includes(rolActual);
  const esAdmin = rolActual === 'admin';
  /**
   * Dueño de la visita. Mismo criterio y mismo orden que el backend en
   * PATCH /formularios/:id/respuesta: el snapshot `tecnico.usuario_id` manda
   * (es la atribución vigente — se reescribe al reasignar el beneficiario y
   * POST /guardar lo protege de snapshots viejos); la columna `usuario_id`
   * queda como respaldo para filas antiguas. Si aquí se usara un criterio
   * distinto al del backend, el botón aparecería para luego responder 403.
   */
  const duenoFormulario = formulario.tecnico?.usuario_id || formulario.usuario_id;
  /**
   * Quién puede completar las preguntas que quedaron "Sin responder": el
   * admin (cualquier formulario) y el técnico dueño de la visita. El backend
   * valida lo mismo en PATCH /formularios/:id/respuesta.
   */
  const puedeCompletarRespuestas =
    esAdmin || (rolActual === 'tecnico' && !!duenoFormulario && duenoFormulario === usuarioActual?.id);
  /**
   * Modo de la pantalla: 'online' y 'campo' habilitan los controles de
   * Novedad/Aprobado por sección (revisión); solo 'campo' añade además el
   * formulario de Seguimiento de Coordinación/Interventoría al final (el
   * mismo que se registra desde la tarjeta de inicio), para revisar la
   * visita en terreno sin conexión.
   * Sin modo (entrada normal desde "PDF") se ve el formulario tal cual lo
   * diligenció el técnico, sin nada de revisión.
   */
  const mostrarRevision = modo === 'online' || modo === 'campo';
  const mostrarSeguimientoCampo = modo === 'campo' && (rolActual === 'coordinador' || rolActual === 'interventor');
  const { revisiones, cargando: cargandoRevisiones, recargar: recargarRevisiones } = useRevisiones(formulario.id);
  /**
   * Sincronización: al volver de la cámara tras agregar evidencia, la foto
   * queda en la cola local (`fotos_locales`) con formulario_id = este
   * formulario, pero NO está en el servidor todavía. Sin subirla, el detalle
   * (que lee las evidencias del servidor) no la muestra. Por eso se dispara
   * un sync al enfocar la pantalla si hay evidencias pendientes de este
   * formulario.
   */
  const { syncNow } = useSync();
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [descargandoMedia, setDescargandoMedia] = useState(false);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  /** Evidencia abierta en visor ampliado (null = cerrado) */
  const [fotoPreview, setFotoPreview] = useState<FotoGeotag | null>(null);
  const [videoPreview, setVideoPreview] = useState<FotoGeotag | null>(null);
  /** Firma abierta en visor ampliado (null = cerrado) */
  const [firmaPreview, setFirmaPreview] = useState<{ uri: string; headers: Record<string, string>; titulo: string } | null>(null);
  /**
   * Evidencias recuperadas del servidor cuando los archivos locales no
   * existen (formulario abierto desde otro teléfono). null = usar las
   * del formulario, que están en este dispositivo.
   */
  const [evidenciasRemotas, setEvidenciasRemotas] = useState<FotoGeotag[] | null>(null);
  /** Cabeceras de autenticación para descargar evidencias de la API */
  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});
  /** Documentos de finca vinculados a este formulario — visibles para todos los roles */
  const [documentos, setDocumentos] = useState<DocumentoDeFormulario[]>([]);
  const [abriendoDocumentoId, setAbriendoDocumentoId] = useState<string | null>(null);
  /**
   * Firmas listas para <Image>: URI + cabeceras si hace falta autenticación.
   * null = no registrada; undefined (estado inicial) = aún resolviendo.
   */
  const [firmasResueltas, setFirmasResueltas] = useState<{
    beneficiario: FirmaResuelta | null;
    tecnico: FirmaResuelta | null;
  } | null>(null);
  const [respuestaEditando, setRespuestaEditando] = useState<{ path: string; texto: string; espec?: EspecRespuesta; modo?: 'completar' | 'corregir' } | null>(null);
  const [valorRespuesta, setValorRespuesta] = useState('');
  const [guardandoRespuesta, setGuardandoRespuesta] = useState(false);
  /**
   * Captura GPS de alta precisión para las preguntas de coordenada (P20/P32).
   * Se guarda aparte del `valorRespuesta` de texto porque la captura produce
   * lat/lon/alt a la vez y hay que escribir cada uno en su campo hermano.
   */
  const [gpsCaptura, setGpsCaptura] = useState<{ lat: string; lon: string; alt: string; precision: string } | null>(null);
  /** Evidencia que se está borrando (para mostrar el spinner) */
  const [eliminandoEvidenciaId, setEliminandoEvidenciaId] = useState<string | null>(null);
  /**
   * Quién puede eliminar evidencias individuales: admin y coordinador
   * (cualquier formulario) y el técnico dueño de la visita (solo las suyas).
   * Debe coincidir con la validación de backend/src/routes/archivos.js.
   */
  const puedeEliminarEvidencias =
    ROLES_PUEDEN_ELIMINAR_EVIDENCIA.includes(rolActual) ||
    (rolActual === 'tecnico' && !!duenoFormulario && duenoFormulario === usuarioActual?.id);
  /**
   * Quién puede AGREGAR evidencia nueva a una visita ya completada: los
   * mismos que pueden eliminarla (admin/coordinador y el técnico dueño).
   * La captura se encola contra este formulario (modo "evidencia dirigida"
   * de CamaraScreen) sin tocar el formulario en curso.
   */
  const puedeAgregarEvidencias = puedeEliminarEvidencias;

  const abrirEdicionRespuesta = (
    seccionTitulo: string,
    pregunta: { numero: string; texto: string; valor: string },
    modo: 'completar' | 'corregir' = 'completar'
  ) => {
    if (!puedeCompletarRespuestas) return;
    // Completar solo aplica a preguntas vacías; corregir solo a las que ya
    // tienen respuesta. Evita abrir el modal en el caso equivocado.
    if (modo === 'completar' && pregunta.valor) return;
    if (modo === 'corregir' && !pregunta.valor) return;
    const path = RUTAS_RESPUESTAS_FORMULARIO_1[`${seccionTitulo}__${pregunta.numero === '\u2022' ? pregunta.texto : pregunta.numero}`];
    if (!path) return;
    const espec = RESPUESTA_ESPEC[path];
    setRespuestaEditando({ path, texto: pregunta.texto, espec, modo });
    // Al corregir se precarga el valor actual para editarlo; al completar se
    // parte de vacío.
    setValorRespuesta(modo === 'corregir' ? pregunta.valor : '');
    // Preguntas de coordenada (P20/P32): precargar la captura GPS existente
    // para que el mapa y el botón "Volver a capturar" muestren el punto actual.
    if (espec?.tipo === 'gps' && espec.gpsCampos) {
      const enc = ((formulario as any).caracterizacion_nueva || {}) as Record<string, any>;
      const leer = (p: string) => {
        const [sec, campo] = p.split('.');
        return campo ? enc[sec]?.[campo] : enc[sec];
      };
      setGpsCaptura({
        lat: String(leer(espec.gpsCampos.latitud) ?? ''),
        lon: String(leer(espec.gpsCampos.longitud) ?? ''),
        alt: espec.gpsCampos.altitud ? String(leer(espec.gpsCampos.altitud) ?? '') : '',
        precision: espec.gpsCampos.precision ? String(leer(espec.gpsCampos.precision) ?? '') : '',
      });
    } else {
      setGpsCaptura(null);
    }
  };

  /** Marca/desmarca una opción cuando la pregunta es de respuesta múltiple */
  const toggleValorMultiple = (opt: string) => {
    setValorRespuesta((prev) => {
      const actuales = prev ? prev.split(', ').filter(Boolean) : [];
      const next = actuales.includes(opt) ? actuales.filter((o) => o !== opt) : [...actuales, opt];
      return next.join(', ');
    });
  };

  const guardarRespuestaAdmin = async () => {
    if (!respuestaEditando || !valorRespuesta.trim()) {
      Alert.alert('Respuesta vacía', 'Escribe una respuesta antes de guardar.');
      return;
    }
    setGuardandoRespuesta(true);
    try {
      await actualizarRespuestaFormulario(
        formulario.id,
        respuestaEditando.path,
        valorRespuesta.trim(),
        respuestaEditando.modo || 'completar'
      );
      const partes = respuestaEditando.path.split('.');
      setFormulario((prev) => {
        const encuesta = { ...((prev as any).caracterizacion_nueva || {}) };
        if (partes.length === 1) {
          encuesta[partes[0]] = valorRespuesta.trim();
        } else {
          const [seccion, campo] = partes;
          encuesta[seccion] = { ...(encuesta[seccion] || {}), [campo]: valorRespuesta.trim() };
        }
        return { ...prev, caracterizacion_nueva: encuesta } as typeof prev;
      });
      const fueCorreccion = respuestaEditando.modo === 'corregir';
      setRespuestaEditando(null);
      Alert.alert(
        fueCorreccion ? 'Respuesta corregida' : 'Respuesta guardada',
        'La respuesta quedó actualizada para este formulario.'
      );
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : String(error));
    } finally {
      setGuardandoRespuesta(false);
    }
  };

  /**
   * Guarda una respuesta de tipo coordenada (P20/P32).
   *
   * La captura GPS produce lat/lon/alt a la vez, así que hay que escribir cada
   * valor en su campo hermano del formulario. Se guarda primero el campo que
   * abrió el modal (latitud) y luego los compañeros (longitud, altitud) para
   * que el backend valide el modo correcto (completar/corregir) sobre el campo
   * principal. La precisión no se persiste porque el backend no la permite.
   */
  const guardarRespuestaGPS = async () => {
    if (!respuestaEditando?.espec?.gpsCampos) return;
    const campos = respuestaEditando.espec.gpsCampos;
    const lat = (gpsCaptura?.lat || '').trim();
    const lon = (gpsCaptura?.lon || '').trim();
    if (!lat || !lon) {
      Alert.alert('Sin coordenada', 'Captura la ubicación antes de guardar.');
      return;
    }
    setGuardandoRespuesta(true);
    try {
      const modo = respuestaEditando.modo || 'completar';
      const aGuardar: Array<[string, string]> = [[campos.latitud, lat]];
      if (campos.longitud) aGuardar.push([campos.longitud, lon]);
      if (campos.altitud && (gpsCaptura?.alt || '').trim()) {
        aGuardar.push([campos.altitud, (gpsCaptura?.alt || '').trim()]);
      }
      for (const [path, value] of aGuardar) {
        await actualizarRespuestaFormulario(formulario.id, path, value, modo);
      }
      // Reflejar los cambios en el estado local del formulario.
      setFormulario((prev) => {
        const encuesta = { ...((prev as any).caracterizacion_nueva || {}) };
        for (const [path, value] of aGuardar) {
          const [seccion, campo] = path.split('.');
          if (campo) {
            encuesta[seccion] = { ...(encuesta[seccion] || {}), [campo]: value };
          } else {
            encuesta[seccion] = value;
          }
        }
        return { ...prev, caracterizacion_nueva: encuesta } as typeof prev;
      });
      const fueCorreccion = modo === 'corregir';
      setRespuestaEditando(null);
      setGpsCaptura(null);
      Alert.alert(
        fueCorreccion ? 'Coordenada corregida' : 'Coordenada guardada',
        'La ubicación quedó actualizada para este formulario.'
      );
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : String(error));
    } finally {
      setGuardandoRespuesta(false);
    }
  };

  /**
   * Eliminar una evidencia (foto o video) del formulario.
   *
   * En campo se acumulan fotos idénticas (reintentos, duplicados de la misma
   * toma), así que admin y coordinador pueden depurar la visita borrando la
   * que sobra. El borrado es real, en tres capas:
   *  1. Servidor: DELETE /api/archivos/:id → borra el objeto de MinIO, la
   *     fila de `archivos`, la entrada del fotos_json del formulario y deja
   *     una "tumba" para que la evidencia no reaparezca si el teléfono que la
   *     capturó todavía la conserva en local y la reintenta subir.
   *  2. Local: quita la fila de fotos_locales/videos_locales y el archivo
   *     físico, para que el sincronizador no la vuelva a enviar.
   *  3. Estado: la quita de la lista visible sin recargar la pantalla.
   */
  const eliminarEvidencia = async (foto: FotoGeotag) => {
    setEliminandoEvidenciaId(foto.id);
    try {
      // El backend acepta tanto el id de `archivos` (evidencia recuperada del
      // servidor) como el id local de la captura, así que no hace falta
      // resolver la correspondencia aquí.
      const borradoOk = await eliminarEvidenciaRemota(foto.id);
      if (!borradoOk) {
        Alert.alert(
          'No se pudo eliminar',
          'No fue posible eliminar la evidencia en el servidor. Revisa la conexión e inténtalo de nuevo.',
        );
        return;
      }

      // Capas locales: best-effort, el servidor ya es la fuente de verdad.
      try {
        await deleteEvidenciaLocal(foto.id);
        await eliminarArchivoLocal(foto.uri);
      } catch (localErr) {
        console.warn('[Detalle] No se pudo limpiar la evidencia local:', localErr);
      }

      // Estado de la pantalla: lista remota (si se está mostrando esa) y
      // fotos del formulario.
      setEvidenciasRemotas((prev) => (prev ? prev.filter((f) => f.id !== foto.id) : prev));

      const fotosLocales = formulario.fotos || [];
      const nuevasFotos = fotosLocales.filter((f) => f.id !== foto.id);
      setFormulario((prev) => ({ ...prev, fotos: nuevasFotos }));

      if (nuevasFotos.length !== fotosLocales.length) {
        // Se persiste la lista ya depurada: si solo se cambiara el estado, al
        // reabrir la visita desde este mismo teléfono volvería a aparecer
        // (sus archivos locales todavía existían y la pantalla los prefería
        // sobre la lista del servidor).
        saveFormularioLocal({ ...formulario, fotos: nuevasFotos }).catch((persistErr) =>
          console.warn('[Detalle] No se pudo persistir la evidencia eliminada:', persistErr),
        );
      }

      // Si estaba abierta en el visor ampliado, se cierra.
      setFotoPreview((prev) => (prev?.id === foto.id ? null : prev));
      setVideoPreview((prev) => (prev?.id === foto.id ? null : prev));

      console.log(`[Detalle] Evidencia ${foto.id} eliminada del formulario ${formulario.id}`);
    } finally {
      setEliminandoEvidenciaId(null);
    }
  };

  /** Confirmación antes de borrar — el borrado es irreversible */
  const confirmarEliminarEvidencia = (foto: FotoGeotag) => {
    const esVideo = foto.tipo === 'video';
    Alert.alert(
      esVideo ? 'Eliminar video' : 'Eliminar foto',
      `¿Está seguro que desea eliminar este ${esVideo ? 'video' : 'foto'} del formulario?\n\n` +
        'Esta acción no se puede deshacer: la evidencia también se borra del servidor.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void eliminarEvidencia(foto);
          },
        },
      ],
    );
  };

  // Las evidencias mostradas: locales si están, remotas si no
  const evidencias = evidenciasRemotas ?? formulario.fotos ?? [];
  /** Una evidencia servida por la API necesita la cabecera Authorization */
  const fuenteEvidencia = useCallback(
    (uri: string) => fuenteConAuth(uri, authHeaders),
    [authHeaders]
  );

  /**
   * Agregar evidencia nueva a esta visita ya completada. Abre la cámara en
   * modo "evidencia dirigida": la captura se encola contra ESTE formulario
   * (no contra el formulario en curso del FormContext). Al volver, se
   * recargan las evidencias para que aparezca la recién capturada.
   */
  const agregarEvidencia = (tipo: 'photo' | 'video') => {
    _navigation.navigate('Camara', {
      mode: tipo,
      formularioId: formulario.id,
      beneficiarioCedula: formulario.beneficiario?.cedula,
      beneficiarioNombre: formulario.beneficiario?.nombre,
      tipoFormulario: formulario.tipo,
    });
  };

  /** Menú para elegir foto o video al agregar evidencia */
  const elegirTipoEvidencia = () => {
    Alert.alert(
      'Agregar evidencia',
      '¿Qué deseas capturar? Se guardará con ubicación GPS y quedará vinculada a esta visita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: '📷 Foto', onPress: () => agregarEvidencia('photo') },
        { text: '🎥 Video', onPress: () => agregarEvidencia('video') },
      ],
    );
  };

  /**
   * Carga (o recarga) evidencias, documentos y firmas de la visita.
   * Se reutiliza al montar y al volver de la cámara tras agregar evidencia.
   */
  const cargarEvidenciasYDocumentos = useCallback(async (): Promise<void> => {
    try {
      const cedulaBeneficiario = formulario.beneficiario?.cedula;
      const [headers, remotas, docsFormulario, docsBeneficiario, firmas] = await Promise.all([
        cabecerasDeArchivo(),
        resolverEvidenciasRemotas(formulario.id, formulario.fotos),
        fetchDocumentosDeFormulario(formulario.id),
        // Los documentos de la finca se comparten por beneficiario (cédula):
        // pueden haberse subido desde OTRA visita del mismo beneficiario, así
        // que se combinan con los vinculados a este formulario.
        cedulaBeneficiario
          ? fetchDocumentosDeBeneficiario(cedulaBeneficiario).catch(() => [] as DocumentoDeFormulario[])
          : Promise.resolve([] as DocumentoDeFormulario[]),
        resolverFirmasRemotas(formulario.id, formulario.firma_beneficiario, formulario.firma_tecnico),
      ]);
      setAuthHeaders(headers);
      if (remotas) setEvidenciasRemotas(remotas);
      // Merge + dedupe por id (los del formulario primero).
      const mapaDocs = new Map<string, DocumentoDeFormulario>();
      for (const d of [...docsFormulario, ...docsBeneficiario]) {
        if (!mapaDocs.has(d.id)) mapaDocs.set(d.id, d);
      }
      setDocumentos(Array.from(mapaDocs.values()));
      setFirmasResueltas(firmas);
    } catch (e) {
      console.warn('[Detalle] No se pudieron resolver las evidencias:', e);
    }
  }, [formulario.id, formulario.fotos, formulario.beneficiario?.cedula, formulario.firma_beneficiario, formulario.firma_tecnico]);

  useEffect(() => {
    void cargarEvidenciasYDocumentos();
  }, [cargarEvidenciasYDocumentos]);

  // Al volver a esta pantalla (p. ej. tras capturar evidencia nueva en la
  // cámara) se recargan evidencias y documentos para reflejar los cambios.
  // Si quedaron evidencias pendientes de subir para ESTE formulario (la
  // captura dirigida se encola localmente), se dispara un sync para subirlas
  // y, al terminar, se recarga la lista para que aparezcan.
  useFocusEffect(
    useCallback(() => {
      let activo = true;
      void (async () => {
        try {
          const [fotosPend, videosPend] = await Promise.all([
            getUnsyncedPhotos(formulario.id),
            getUnsyncedVideos(formulario.id),
          ]);
          if (activo && (fotosPend.length > 0 || videosPend.length > 0)) {
            await syncNow();
          }
        } catch (e) {
          console.warn('[Detalle] No se pudieron subir evidencias pendientes:', e);
        }
        if (activo) await cargarEvidenciasYDocumentos();
      })();
      return () => {
        activo = false;
      };
    }, [cargarEvidenciasYDocumentos, formulario.id, syncNow])
  );

  /**
   * Abrir un documento de finca: se descarga (con autenticación) a un
   * archivo temporal y se ofrece con el selector nativo "Abrir con…", ya
   * que un documento puede ser PDF, imagen, Word, Excel, etc. — no tiene
   * sentido construir un visor propio por cada formato posible.
   */
  const abrirDocumento = async (doc: DocumentoDeFormulario) => {
    setAbriendoDocumentoId(doc.id);
    try {
      const headers = await cabecerasDeArchivo();
      const url = doc.url.startsWith('http') ? doc.url : `${API_CONFIG.BASE_URL}${doc.url}`;
      const extension = doc.nombre.includes('.') ? doc.nombre.split('.').pop() : 'dat';
      const destino = `${FileSystem.cacheDirectory}doc_${doc.id}.${extension}`;
      const { uri } = await FileSystem.downloadAsync(url, destino, { headers });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: doc.mimetype });
      } else {
        Alert.alert('Documento descargado', `Guardado en: ${uri}`);
      }
    } catch (e) {
      console.warn('[Detalle] No se pudo abrir el documento:', doc.id, e);
      Alert.alert('Error', 'No se pudo abrir el documento. Verifica tu conexión.');
    } finally {
      setAbriendoDocumentoId(null);
    }
  };
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');
  const PDF_HEIGHT = SCREEN_HEIGHT * 0.55;

  const generarHtml = async (): Promise<string> => {
    const f = formulario;

    // Convertir fotos con redimensionamiento (async)
    const fotosHtml = await convertirFotosAHTML(f.fotos || []);

    // Firmas (ya están en base64 data URIs)
    const firmaBenefHtml = f.firma_beneficiario
      ? `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario — <strong>${escapeHtml(f.beneficiario.nombre)}</strong> (C.C. ${escapeHtml(f.beneficiario.cedula || '—')})</p><img src="${f.firma_beneficiario}" alt="Firma del beneficiario" class="firma-img" /></div>`
      : `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><p class="no-data">No registrada</p></div>`;

    const firmaTecHtml = f.firma_tecnico
      ? `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico — <strong>${escapeHtml(f.tecnico.nombre)}</strong> (C.C. ${escapeHtml(f.tecnico.cedula || '—')})</p><img src="${f.firma_tecnico}" alt="Firma del técnico" class="firma-img" /></div>`
      : `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><p class="no-data">No registrada</p></div>`;

    // Sello biométrico con gráfico de huella SVG (async-safe)
    const huellaHtml = f.huella_beneficiario
      ? generarSelloBiometrico(f.beneficiario.nombre)
      : `<div class="evidencia-item"><p class="evidencia-label">🖐️ Huella Biométrica</p><p class="no-data">No registrada</p></div>`;

    const c = (f as any).caracterizacion_nueva as DatosCaracterizacionNueva | undefined;

    const valOr = (v: string | undefined | null): string => v || '—';

    const row2 = (label: string, val: string | undefined | null) =>
      val ? `<div class="row"><span class="label">${label}:</span><span class="value">${escapeHtml(val)}</span></div>` : '';

    const section2 = (title: string, icon: string, rows: string) =>
      rows ? `<div class="section"><h2>${icon} ${title}</h2>${rows}</div>` : '';

    // Caracterización sections (if applicable)
    let caracterizacionHtml = '';
    if (c) {
      const cs = c.componente_social;
      const cp = c.componente_productivo;
      const ca = c.componente_agroambiental;
      const as = c.analisis_suelo;
      const rec = c.recomendaciones;

      const datosGenerales = `
        <div class="row"><span class="label">Municipio:</span><span class="value">${escapeHtml(valOr(c.municipio))}</span></div>
        <div class="row"><span class="label">Fecha:</span><span class="value">${escapeHtml(valOr(c.fecha))}</span></div>
        <div class="row"><span class="label">Vereda:</span><span class="value">${escapeHtml(valOr(c.vereda))}</span></div>
        <div class="row"><span class="label">N° Encuesta:</span><span class="value">${escapeHtml(valOr(c.encuesta_numero))}</span></div>
        <div class="row"><span class="label">Productor:</span><span class="value">${escapeHtml(valOr(c.productor_nombre))}</span></div>
        <div class="row"><span class="label">Documento:</span><span class="value">${escapeHtml(valOr(c.documento))}</span></div>
        <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(valOr(c.telefono))}</span></div>
        <div class="row"><span class="label">Técnico:</span><span class="value">${escapeHtml(valOr(c.tecnico_responsable))}</span></div>
        <div class="row"><span class="label">Finca / Predio:</span><span class="value">${escapeHtml(valOr(c.finca))}</span></div>
      `;
      const socialRows = [
        row2('1. Nivel educativo del productor', cs?.nivel_educativo),
        row2('2. Personas del núcleo familiar', cs?.personas_nucleo),
        row2('3. Principal fuente de ingresos', cs?.fuente_ingresos),
        row2('4. Participa en organización o asociación', cs?.participa_organizacion),
        row2('5. Acceso a servicios públicos básicos', cs?.servicios_publicos),
        row2('6. Mano de obra utilizada', cs?.mano_obra),
      ].join('');
      const prodRows = [
        row2('7. Principal actividad productiva', cp?.actividad_productiva),
        row2('8. Acceso permanente al agua', cp?.acceso_agua),
        row2('9. Dispone de sistemas de riego', cp?.sistemas_riego),
        row2('10. Ha recibido asistencia técnica', cp?.asistencia_tecnica),
      ].join('');
      const agroRows = [
        row2('11. Procesos de erosión', ca?.procesos_erosion),
        row2('12. Fuentes hídricas', ca?.fuentes_hidricas),
        row2('13. Áreas de conservación o protección', ca?.areas_conservacion),
        row2('14. Prácticas de conservación del suelo', ca?.practicas_conservacion),
        row2('15. Manejo de residuos de agroquímicos', ca?.manejo_residuos),
      ].join('');
      const sueloRows = [
        row2('16. Observación del suelo', as?.observacion_suelo),
        row2('17. Textura predominante', as?.textura),
        row2('18. Color predominante', as?.color),
        row2('19. Drenaje del suelo', as?.drenaje),
        row2('20. Uso de la tierra', (as as any)?.uso_tierra),
        row2('21. Presencia de piedras', as?.piedras),
        row2('22. Compactación del suelo', as?.compactacion),
        row2('23. Cobertura del suelo', as?.cobertura),
        row2('24. Evidencia de erosión', as?.evidencia_erosion),
      ].join('');
      const recomHtml = (rec?.recomendaciones_tecnicas || rec?.recomendaciones_ambientales) ? `
        <div class="section"><h2>📝 Recomendaciones del Técnico</h2>
        ${rec?.recomendaciones_tecnicas ? `<div class="row" style="margin-bottom:4px;"><span class="label">25. Recomendaciones técnicas:</span></div><div class="desc-detallada">${escapeHtml(rec.recomendaciones_tecnicas)}</div>` : ''}
        ${rec?.recomendaciones_ambientales ? `<div class="row" style="margin-top:12px;margin-bottom:4px;"><span class="label">26. Recomendaciones ambientales:</span></div><div class="desc-detallada">${escapeHtml(rec.recomendaciones_ambientales)}</div>` : ''}
        </div>` : '';

      caracterizacionHtml = `
        <div class="section"><h2>📋 Datos Generales</h2>${datosGenerales}</div>
        ${section2('Componente Social', '👥', socialRows)}
        ${section2('Componente Productivo', '🌱', prodRows)}
        ${section2('Componente Agroambiental', '🌿', agroRows)}
        ${section2('Análisis de Suelo', '🔬', sueloRows)}
        ${recomHtml}
      `;
    }

    // Visita Técnica del formato nuevo (v2): el detalle por ítems. Se añade
    // a la sección "Actividad Realizada" del PDF para que los compromisos
    // adquiridos y la valoración del cumplimiento no se pierdan al generar
    // el documento (antes solo salían descripción/observaciones/recomendaciones).
    const act = f.actividad;
    const compromisosV2 = act?.compromisos_siguiente_visita || [];
    const visitaV2Html = esVisitaTecnicaV2(act)
      ? `
      ${row2('N° de visita', act?.visita_numero != null ? String(act.visita_numero) : undefined)}
      ${row2('Identificación', act?.no_identificacion)}
      ${row2('Objetivo', act?.objetivo)}
      ${act?.seguimiento_compromisos ? `<div class="row" style="margin-top:8px;"><span class="label">Seguimiento de compromisos:</span></div><div class="desc-detallada">${escapeHtml(act.seguimiento_compromisos)}</div>` : ''}
      ${row2('Valoración del cumplimiento', act?.valoracion_cumplimiento ? `${act.valoracion_cumplimiento}%` : undefined)}
      ${act?.area_intervencion ? row2('Área a intervenir', `${act.area_intervencion} ha`) : ''}
      ${compromisosV2.length > 0 ? `<div class="row" style="margin-top:8px;"><span class="label">Compromisos próxima visita:</span></div><div class="desc-detallada">${compromisosV2.map((t) => `• ${escapeHtml(t)}`).join('<br/>')}</div>` : ''}
    `
      : '';

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Formulario ${f.id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #2d3436; line-height: 1.6; }
  .header { text-align: center; border-bottom: 3px solid #1B5E20; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { color: #1B5E20; font-size: 24px; margin-bottom: 4px; }
  .header p { color: #636e72; font-size: 13px; }
  .section { margin: 20px 0; padding: 16px 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #1B5E20; }
  .section h2 { color: #1B5E20; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  .row { display: flex; margin: 3px 0; font-size: 13px; }
  .label { font-weight: bold; color: #555; min-width: 160px; }
  .value { flex: 1; color: #2d3436; }
  .foto-item { margin: 16px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .foto-img { width: 100%; max-width: 350px; max-height: 240px; height: auto; border-radius: 4px; margin: 8px auto; display: block; object-fit: cover; }
  .foto-coords { font-size: 11px; color: #636e72; font-family: monospace; }
  .foto-heading { font-size: 11px; color: #0984e3; font-family: monospace; }
  .firma-item { display: inline-block; vertical-align: top; margin: 8px; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; width: calc(50% - 16px); min-width: 200px; }
  .firmas-contiguo { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .evidencia-item { margin: 12px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .evidencia-label { font-size: 13px; color: #2d3436; margin-bottom: 8px; }
  .firma-img { max-width: 100%; max-height: 100px; border: 1px dashed #b2bec3; border-radius: 4px; padding: 8px; background: #fff; }
  .desc-detallada { font-size: 13px; color: #2d3436; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 6px; line-height: 1.5; }
  /* --- Sello de verificación biométrica --- */
  .huella-sello { margin: 16px 0; page-break-inside: avoid; }
  .huella-sello-inner { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #1B5E20; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(27,94,32,0.15); }
  .huella-sello-header { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #bbf7d0; padding-bottom: 14px; margin-bottom: 14px; }
  .huella-sello-img { width: 64px; height: 64px; flex-shrink: 0; }
  .huella-sello-titles { flex: 1; }
  .huella-sello-verificado { font-size: 20px; font-weight: bold; color: #15803d; }
  .huella-sello-label { font-size: 13px; color: #16a34a; }
  .huella-sello-body { margin-bottom: 14px; }
  .huella-sello-table { width: 100%; border-collapse: collapse; }
  .huella-sello-table td { padding: 4px 8px; font-size: 13px; }
  .huella-sello-label-cell { color: #555; font-weight: bold; width: 120px; }
  .huella-sello-value-cell { color: #2d3436; }
  .huella-sello-exitoso { display: inline-block; background: #15803d; color: #fff; font-size: 12px; font-weight: bold; padding: 2px 12px; border-radius: 10px; }
  .huella-sello-footer { text-align: center; border-top: 1px solid #bbf7d0; padding-top: 12px; }
  .huella-sello-stamp { display: inline-block; font-size: 14px; font-weight: bold; color: #15803d; letter-spacing: 1px; border: 2px solid #15803d; border-radius: 6px; padding: 4px 16px; transform: rotate(-2deg); }
  /* --- Fin sello biométrico --- */
  .no-data { font-size: 12px; color: #b2bec3; font-style: italic; padding: 8px 0; }
  .desc-detallada { font-size: 13px; color: #2d3436; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 6px; line-height: 1.5; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #b2bec3; }
  @media print { .foto-img { max-width: 100%; } .section { break-inside: avoid; } }
</style></head>
<body>
  <div class="header">
    <h1>🌱 GEODAILY — ${c || f.tipo === 'caracterizacion' ? 'Caracterización Sociodemográfica' : 'Formulario de Campo'}</h1>
    <p><strong>ID:</strong> ${escapeHtml(f.id)} | <strong>Tipo:</strong> ${c || f.tipo === 'caracterizacion' ? 'Caracterización Sociodemográfica' : tituloVisitaTecnica(f.actividad?.visita_numero)} | <strong>Fecha:</strong> ${c?.fecha || formatFecha(f.created_at)}</p>
  </div>

  ${caracterizacionHtml}

  <div class="section">
    <h2>👤 Datos del Técnico</h2>
    <div class="row"><span class="label">Nombre:</span><span class="value">${escapeHtml(f.tecnico.nombre)}</span></div>
    <div class="row"><span class="label">Cédula:</span><span class="value">${escapeHtml(f.tecnico.cedula)}</span></div>
    <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(f.tecnico.telefono || '—')}</span></div>
    <div class="row"><span class="label">Email:</span><span class="value">${escapeHtml(f.tecnico.email || '—')}</span></div>
  </div>

  <div class="section">
    <h2>👥 Datos del Beneficiario</h2>
    <div class="row"><span class="label">Nombre:</span><span class="value">${escapeHtml(f.beneficiario.nombre)}</span></div>
    <div class="row"><span class="label">Cédula:</span><span class="value">${escapeHtml(f.beneficiario.cedula || '—')}</span></div>
    <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(f.beneficiario.telefono || '—')}</span></div>
    <div class="row"><span class="label">Departamento:</span><span class="value">${escapeHtml(f.beneficiario.departamento || '—')}</span></div>
    <div class="row"><span class="label">Municipio:</span><span class="value">${escapeHtml(f.beneficiario.municipio || '—')}</span></div>
    <div class="row"><span class="label">Vereda:</span><span class="value">${escapeHtml(f.beneficiario.vereda || '—')}</span></div>
    <div class="row"><span class="label">Finca:</span><span class="value">${escapeHtml(f.beneficiario.finca || '—')}</span></div>
  </div>

  <div class="section">
    <h2>📋 Actividad Realizada</h2>
    <div class="row"><span class="label">Tipo:</span><span class="value">${escapeHtml(f.actividad.descripcion || '—')}</span></div>
    ${f.actividad.descripcion_detallada ? `<div class="row"><span class="label">Descripción detallada:</span></div><div class="desc-detallada">${escapeHtml(f.actividad.descripcion_detallada)}</div>` : ''}
    <div class="row" style="margin-top:8px;"><span class="label">Observaciones:</span><span class="value">${escapeHtml(f.actividad.observaciones || '—')}</span></div>
    <div class="row"><span class="label">Recomendaciones:</span><span class="value">${escapeHtml(f.actividad.recomendaciones || '—')}</span></div>
    ${visitaV2Html}
  </div>

  <div class="section">
    <h2>📍 Ubicación Geográfica</h2>
    <div class="row"><span class="label">Latitud:</span><span class="value">${f.coordenadas?.latitud?.toFixed(6) || '—'}</span></div>
    <div class="row"><span class="label">Longitud:</span><span class="value">${f.coordenadas?.longitud?.toFixed(6) || '—'}</span></div>
    ${f.coordenadas?.altitud ? `<div class="row"><span class="label">Altitud:</span><span class="value">${f.coordenadas.altitud.toFixed(1)} m</span></div>` : ''}
    ${f.coordenadas?.precision_gps ? `<div class="row"><span class="label">Precisión:</span><span class="value">±${f.coordenadas.precision_gps} m</span></div>` : ''}
  </div>

  ${f.clima?.actual ? `
  <div class="section">
    <h2>🌤 Condiciones Ambientales</h2>
    <div class="row"><span class="label">Ubicación:</span><span class="value">${escapeHtml(f.clima.actual.ubicacion?.nombre || f.clima.ubicacion?.latitud?.toFixed(4) + ', ' + f.clima.ubicacion?.longitud?.toFixed(4) || '—')}</span></div>
    <div class="row"><span class="label">Temperatura:</span><span class="value">${f.clima.actual.temperatura?.actual != null ? Math.round(f.clima.actual.temperatura.actual) + '°C' : '—'}</span></div>
    <div class="row"><span class="label">Sensación térmica:</span><span class="value">${f.clima.actual.temperatura?.sensacion_termica != null ? Math.round(f.clima.actual.temperatura.sensacion_termica) + '°C' : '—'}</span></div>
    <div class="row"><span class="label">Humedad:</span><span class="value">${f.clima.actual.humedad != null ? f.clima.actual.humedad + '%' : '—'}</span></div>
    <div class="row"><span class="label">Viento:</span><span class="value">${f.clima.actual.viento?.velocidad != null ? Math.round(f.clima.actual.viento.velocidad) + ' m/s' : '—'}</span></div>
    <div class="row"><span class="label">Nubosidad:</span><span class="value">${f.clima.actual.nubosidad != null ? f.clima.actual.nubosidad + '%' : '—'}</span></div>
    <div class="row"><span class="label">Presión:</span><span class="value">${f.clima.actual.presion != null ? f.clima.actual.presion + ' hPa' : '—'}</span></div>
    <div class="row"><span class="label">Visibilidad:</span><span class="value">${f.clima.actual.visibilidad != null ? f.clima.actual.visibilidad + ' km' : '—'}</span></div>
  </div>
  ` : ''}

  <!-- EVIDENCIAS AL FINAL (como documentos oficiales) -->
  <div class="section">
    <h2>📸 Evidencias de Campo</h2>

    <h3 style="color:#0984e3;font-size:14px;margin:12px 0 4px;">Fotografías</h3>
    ${fotosHtml}

    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Firmas</h3>
    <div class="firmas-contiguo">
      ${firmaBenefHtml}
      ${firmaTecHtml}
    </div>

    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Registro Biométrico</h3>
    ${huellaHtml}
  </div>

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
    <p>Este es un documento digital válido como evidencia de campo.</p>
  </div>
</body></html>`;
  };

  // Helper escapeHtml
  function escapeHtml(text: string): string {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // Generar el PDF local SIEMPRE con el generador canónico del servicio,
  // sea cual sea el tipo de formulario. Es el único que aplica el membrete
  // oficial de ACPR (encabezado y pie repetidos en todas las páginas,
  // tamaño Carta) además de las 52 preguntas, clima, GPS y anexo de videos.
  //
  // Antes solo la Encuesta Social AgroAmbiental pasaba por él: las visitas
  // técnicas caían al generador de esta pantalla, que no lleva membrete —
  // por eso el formato institucional no salía en el PDF generado.
  /**
   * En web no existe forma de generar un archivo PDF real (expo-print no
   * está implementado ahí — ver `utils/printWeb.ts`): en su lugar se abre
   * el documento HTML en una pestaña aparte y se dispara la impresión del
   * navegador sobre ese contenido; el usuario elige "Guardar como PDF"
   * para descargarlo. Usada por "Ver PDF" y "Descargar PDF" en web.
   */
  const mostrarPdfEnNavegador = async (ventana: Window | null) => {
    const { construirHtmlFormulario } = await import('../../services/pdfLocal.service');
    const html = await construirHtmlFormulario(formulario, evidencias);
    imprimirHtmlEnVentana(ventana, html);
  };

  const generarPdfUri = async (): Promise<string | null> => {
    try {
      const { generarPDFLocal } = await import('../../services/pdfLocal.service');
      // 'evidencias' ya está resuelto (local si existe en este dispositivo,
      // o URL del servidor si no) — antes se pasaba 'formulario' a secas y
      // el generador leía formulario.fotos directo, con rutas file:// que
      // solo existen en el teléfono que capturó la visita. Generar el PDF
      // desde cualquier otro rol/dispositivo daba un documento sin fotos.
      const uri = await generarPDFLocal(formulario, evidencias);
      if (uri) return uri;
      console.warn('[PDF] El generador canónico falló, usando el de respaldo');
    } catch (e) {
      console.warn('[PDF] Error en el generador canónico, usando el de respaldo:', e);
    }
    // Respaldo: generador propio de la pantalla (sin membrete)
    const html = await generarHtml();
    const { uri } = await Print.printToFileAsync({ html });
    return uri;
  };

  /**
   * Mostrar un PDF ya existente en disco.
   *
   * El WebView de Android NO tiene visor de PDF nativo: al cargar un
   * file://…/x.pdf mostraba una pantalla en blanco — por eso "Ver PDF"
   * parecía no hacer nada. En Android se abre con el visor del sistema
   * mediante un content:// URI; en iOS el WKWebView sí renderiza PDFs,
   * así que allí se mantiene la vista previa embebida.
   */
  const mostrarPdf = async (uri: string) => {
    if (Platform.OS !== 'android') {
      setPdfUri(uri);
      setShowPdf(true);
      return;
    }

    try {
      // Android exige content:// — un file:// lanza FileUriExposedException
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/pdf',
      });
    } catch (e) {
      console.warn('[PDF] Sin visor de PDF instalado, ofreciendo compartir:', e);
      // Sin app lectora de PDF: ofrecer abrir/guardar por otra vía
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            UTI: 'com.adobe.pdf',
          });
        } else {
          Alert.alert(
            'No se puede abrir el PDF',
            'No hay un lector de PDF instalado en este dispositivo. Usa "Descargar PDF" para guardarlo.'
          );
        }
      } catch {
        Alert.alert('Error', 'No se pudo abrir el PDF');
      }
    }
  };

  const handleViewPDF = async () => {
    if (Platform.OS === 'web') {
      // window.open() debe llamarse ANTES de cualquier await — si se abre
      // después de esperar una promesa, el navegador la bloquea como pop-up.
      const ventana = abrirVentanaDeCarga();
      setGeneratingPdf(true);
      try {
        await mostrarPdfEnNavegador(ventana);
      } catch (e) {
        console.warn('[PDF] Error generando el documento en el navegador:', e);
        Alert.alert(
          'No se pudo generar el documento',
          'Verifica que el navegador no haya bloqueado la ventana emergente e inténtalo de nuevo.'
        );
      } finally {
        setGeneratingPdf(false);
      }
      return;
    }
    setGeneratingPdf(true);
    try {
      // 1. Regenerar el PDF a partir de los datos del formulario.
      //    Es una operación local (funciona sin conexión) y garantiza que
      //    el documento salga siempre con el membrete vigente: los PDF
      //    guardados en pdf_url antes de implementarlo conservan el
      //    formato antiguo, y reutilizarlos hacía que "Ver PDF" mostrara
      //    un documento sin encabezado ni pie institucional.
      const generado = await generarPdfUri();
      if (generado) {
        await mostrarPdf(generado);
        return;
      }

      // 2. Si no se pudo generar y hay una copia en este dispositivo, usarla
      if (formulario.pdf_url?.startsWith('file://')) {
        const info = await FileSystem.getInfoAsync(formulario.pdf_url);
        if (info.exists) {
          await mostrarPdf(formulario.pdf_url);
          return;
        }
        console.warn('[PDF] El PDF local ya no existe');
      }

      // 3. Último recurso: descargar el PDF del servidor
      if (formulario.pdf_url && !formulario.pdf_url.startsWith('file://')) {
        const url = formulario.pdf_url.startsWith('http')
          ? formulario.pdf_url
          : `${API_CONFIG.BASE_URL}${formulario.pdf_url}`;
        try {
          if (!FileSystem.documentDirectory) {
            throw new Error('documentDirectory no disponible');
          }
          const { uri: localUri } = await FileSystem.downloadAsync(
            url,
            FileSystem.documentDirectory + 'pdf_preview.pdf'
          );
          await mostrarPdf(localUri);
          return;
        } catch {
          console.warn('[PDF] No se pudo descargar el remoto');
        }
      }

      throw new Error('sin uri');
    } catch (e) {
      Alert.alert('Error', 'No se pudo generar el PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleClosePdf = () => {
    setShowPdf(false);
    setPdfUri(null);
  };

  const handleSharePDF = async () => {
    if (!pdfUri) {
      // Si no hay pdfUri, generar primero
      setGeneratingPdf(true);
      try {
        const uri = await generarPdfUri();
        if (!uri) throw new Error('sin uri');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          Alert.alert('Compartir no disponible', 'El dispositivo no soporta compartir archivos');
        }
      } catch {
        Alert.alert('Error', 'No se pudo generar el PDF');
      } finally {
        setGeneratingPdf(false);
      }
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(pdfUri);
    } else {
      Alert.alert('Compartir no disponible', 'El dispositivo no soporta compartir archivos');
    }
  };

  const handleDownloadPDF = async () => {
    if (Platform.OS === 'web') {
      const ventana = abrirVentanaDeCarga();
      setGeneratingPdf(true);
      try {
        await mostrarPdfEnNavegador(ventana);
      } catch (e) {
        console.warn('[PDF] Error generando el documento en el navegador:', e);
        Alert.alert(
          'No se pudo generar el documento',
          'Verifica que el navegador no haya bloqueado la ventana emergente e inténtalo de nuevo.'
        );
      } finally {
        setGeneratingPdf(false);
      }
      return;
    }
    setGeneratingPdf(true);
    try {
      const uri = await generarPdfUri();
      if (!uri) throw new Error('sin uri');

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('PDF generado', `PDF disponible en: ${uri}`);
      }
    } catch (e) {
      Alert.alert('Error', 'No se pudo descargar el PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDownloadMedia = async () => {
    if (descargandoMedia) return;
    setDescargandoMedia(true);
    try {
      await descargarPaqueteMedia(formulario);
    } finally {
      setDescargandoMedia(false);
    }
  };

  const evidenciaCount = [
    ...evidencias,
    ...(formulario.firma_beneficiario ? [true] : []),
    ...(formulario.firma_tecnico ? [true] : []),
    ...(formulario.huella_beneficiario ? [true] : []),
  ].length;

  /** Abre Google Maps (app o navegador) centrado en la coordenada capturada. */
  const abrirEnGoogleMaps = (lat: string, lon: string) => {
    Linking.openURL(`https://www.google.com/maps?q=${lat},${lon}`);
  };

  // Coordenadas crudas (no el texto ya formateado) de las preguntas 20 y 32,
  // para el botón "Ver en Google Maps" — solo esas dos preguntas del
  // formulario son capturas GPS con lat/lon propias.
  const cCoordsRaw = (formulario as any).caracterizacion_nueva || {};
  const coordenadasPorPregunta: Record<string, { lat?: string; lon?: string }> = {
    'CARACTERIZACIÓN DE LA FINCA__20': {
      lat: cCoordsRaw.caracterizacion_finca?.latitud,
      lon: cCoordsRaw.caracterizacion_finca?.longitud,
    },
    'SECCIÓN DE SUELO__32': {
      lat: cCoordsRaw.analisis_suelo?.intervencion_latitud,
      lon: cCoordsRaw.analisis_suelo?.intervencion_longitud,
    },
  };

  // Texto de referencia (municipio · vereda/corregimiento) que se muestra como
  // insignia en la captura GPS del modal de corrección.
  const ubicacionGPSTexto = [cCoordsRaw.municipio, cCoordsRaw.vereda || cCoordsRaw.corregimiento]
    .filter(Boolean)
    .join(' · ');

  /** Control de Novedad/Aprobado al pie de cada sección, solo en modo revisión. */
  const renderMiniRevision = (seccionTitulo: string) =>
    mostrarRevision ? (
      <SeccionMiniRevision
        formularioId={formulario.id}
        seccionTitulo={seccionTitulo}
        revisiones={revisiones}
        rol={rolActual}
        esRevisor={esRevisorActual}
        recargar={recargarRevisiones}
      />
    ) : null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xxl }]}>
        {/* Novedades de los superiores — ARRIBA, para que el técnico sepa
            de inmediato qué debe corregir. Solo en la vista normal (sin
            controles de revisión) y solo para quien NO es revisor: en modo
            "Revisión en línea/campo" ya lo muestra SeccionRevision. */}
        {!mostrarRevision && !esRevisorActual && <BannerNovedades revisiones={revisiones} />}

        {/* Estado del formulario */}
        <View style={styles.statusBar}>
          <Text style={styles.statusTipo}>
            {(formulario as any).caracterizacion_nueva || formulario.tipo === 'caracterizacion'
              ? 'Caracterización Sociodemográfica'
              : formulario.tipo === 'visita_tecnica'
              ? tituloVisitaTecnica(formulario.actividad?.visita_numero)
              : 'Plantación'}
          </Text>
          <Text style={[styles.statusSync, formulario.sincronizado && styles.statusSyncOk]}>
            {formulario.sincronizado ? '✓ Sincronizado' : '⏳ Pendiente'}
          </Text>
        </View>

        {/* Revisión jerárquica: novedades y vistos buenos — solo en modo
            "Revisión en línea"/"Revisión en campo", nunca en el formulario
            normal que ve el técnico. */}
        {mostrarRevision && (
          <SeccionRevision
            formulario={formulario}
            revisiones={revisiones}
            cargando={cargandoRevisiones}
            recargar={recargarRevisiones}
          />
        )}

        {/* Encuesta Social AgroAmbiental — resumen COMPLETO (53 preguntas).
            Las secciones vienen del esquema canónico compartido con el
            generador de PDF, así el detalle y el documento siempre coinciden.
            Cada sección trae su propio control de Novedad/Aprobado. */}
        {esEncuestaSocial(formulario) &&
          construirSeccionesEncuesta(
            (formulario as any).caracterizacion_nueva,
            formulario
          ).map((seccion) => (
            <View key={seccion.titulo} style={styles.section}>
              <Text style={styles.sectionTitle}>{seccion.titulo}</Text>
              {seccion.preguntas.map((pregunta) => {
                const coordenadas = coordenadasPorPregunta[`${seccion.titulo}__${pregunta.numero}`];
                const lat = coordenadas?.lat;
                const lon = coordenadas?.lon;
                return (
                  <View key={`${seccion.titulo}-${pregunta.numero}-${pregunta.texto}`} style={styles.pregunta}>
                    <Text style={styles.preguntaTexto}>
                      {pregunta.numero === '\u2022' ? '' : `${pregunta.numero}. `}
                      {pregunta.texto}
                    </Text>
                    <View style={styles.preguntaValorRow}>
                      <Text
                        style={[
                          styles.preguntaValor,
                          styles.preguntaValorFlex,
                          !pregunta.valor && styles.preguntaValorVacio,
                        ]}
                      >
                        {pregunta.valor || 'Sin responder'}
                      </Text>
                      {puedeCompletarRespuestas && !pregunta.valor && RUTAS_RESPUESTAS_FORMULARIO_1[`${seccion.titulo}__${pregunta.numero === '\u2022' ? pregunta.texto : pregunta.numero}`] && (
                        <TouchableOpacity
                          style={styles.adminEditarBtn}
                          onPress={() => abrirEdicionRespuesta(seccion.titulo, pregunta, 'completar')}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.adminEditarBtnText}>✎ Completar</Text>
                        </TouchableOpacity>
                      )}
                      {puedeCompletarRespuestas && !!pregunta.valor && RUTAS_RESPUESTAS_FORMULARIO_1[`${seccion.titulo}__${pregunta.numero === '\u2022' ? pregunta.texto : pregunta.numero}`] && (
                        <TouchableOpacity
                          style={styles.adminEditarBtn}
                          onPress={() => abrirEdicionRespuesta(seccion.titulo, pregunta, 'corregir')}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.adminEditarBtnText}>✎ Corregir</Text>
                        </TouchableOpacity>
                      )}
                      {lat && lon && (
                        <TouchableOpacity
                          style={styles.verEnMapsBtn}
                          onPress={() => abrirEnGoogleMaps(lat, lon)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.verEnMapsBtnText}>Ver en Google Maps</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {!!pregunta.observacion && (
                      <Text style={styles.preguntaObs}>Obs: {pregunta.observacion}</Text>
                    )}
                  </View>
                );
              })}
              {mostrarRevision && (
                <SeccionMiniRevision
                  formularioId={formulario.id}
                  seccionTitulo={seccion.titulo}
                  revisiones={revisiones}
                  rol={rolActual}
                  esRevisor={esRevisorActual}
                  recargar={recargarRevisiones}
                />
              )}
            </View>
          ))}

        {/* Datos del Técnico */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Datos del Técnico</Text>
          <View style={styles.row}><Text style={styles.label}>Nombre:</Text><Text style={styles.value}>{formulario.tecnico?.nombre || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Cédula:</Text><Text style={styles.value}>{formulario.tecnico.cedula}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Teléfono:</Text><Text style={styles.value}>{formulario.tecnico.telefono || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Email:</Text><Text style={styles.value}>{formulario.tecnico.email || '—'}</Text></View>
          {renderMiniRevision('Datos del Técnico')}
        </View>

        {/* Datos del Beneficiario */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👥 Datos del Beneficiario</Text>
          <View style={styles.row}><Text style={styles.label}>Nombre:</Text><Text style={styles.value}>{formulario.beneficiario?.nombre || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Cédula:</Text><Text style={styles.value}>{formulario.beneficiario.cedula || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Teléfono:</Text><Text style={styles.value}>{formulario.beneficiario.telefono || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Depto:</Text><Text style={styles.value}>{formulario.beneficiario.departamento || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Municipio:</Text><Text style={styles.value}>{formulario.beneficiario.municipio || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Vereda:</Text><Text style={styles.value}>{formulario.beneficiario.vereda || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Finca:</Text><Text style={styles.value}>{formulario.beneficiario.finca || '—'}</Text></View>
          {renderMiniRevision('Datos del Beneficiario')}
        </View>

        {/* Actividad (solo para formularios tradicionales) */}
        {!(formulario as any).caracterizacion_nueva && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📋 Actividad Realizada</Text>

            {/* Visita Técnica formato nuevo (v2): se muestran TODOS los ítems
                del formulario. Antes solo salían descripción/observaciones/
                recomendaciones, así que los compromisos adquiridos y la
                valoración del cumplimiento quedaban invisibles en el detalle. */}
            {esVisitaTecnicaV2(formulario.actividad) ? (
              <>
                {!!formulario.actividad.no_identificacion && (
                  <View style={styles.row}>
                    <Text style={styles.label}>Identificación:</Text>
                    <Text style={styles.value}>{formulario.actividad.no_identificacion}</Text>
                  </View>
                )}
                {!!formulario.actividad.objetivo && (
                  <BloqueTexto titulo="Objetivo" texto={formulario.actividad.objetivo} />
                )}
                {!!formulario.actividad.descripcion && (
                  <BloqueTexto titulo="Descripción de la visita" texto={formulario.actividad.descripcion} />
                )}
                {!!formulario.actividad.seguimiento_compromisos && (
                  <BloqueTexto titulo="Seguimiento de compromisos" texto={formulario.actividad.seguimiento_compromisos} />
                )}
                {!!formulario.actividad.valoracion_cumplimiento && (
                  <View style={styles.row}>
                    <Text style={styles.label}>Valoración cumplimiento:</Text>
                    <Text style={styles.value}>{formulario.actividad.valoracion_cumplimiento}%</Text>
                  </View>
                )}
                {!!formulario.actividad.recomendaciones && (
                  <BloqueTexto titulo="Recomendaciones" texto={formulario.actividad.recomendaciones} />
                )}
                {!!formulario.actividad.area_intervencion && (
                  <View style={styles.row}>
                    <Text style={styles.label}>Área a intervenir:</Text>
                    <Text style={styles.value}>{formulario.actividad.area_intervencion} ha</Text>
                  </View>
                )}
                {(formulario.actividad.compromisos_siguiente_visita || []).length > 0 && (
                  <View style={styles.bloqueTexto}>
                    <Text style={styles.bloqueTextoLabel}>Compromisos próxima visita</Text>
                    {(formulario.actividad.compromisos_siguiente_visita || []).map((compromiso, idx) => (
                      <Text key={`${idx}-${compromiso}`} style={styles.listaItem}>• {compromiso}</Text>
                    ))}
                  </View>
                )}
                {!!formulario.actividad.observaciones && (
                  <BloqueTexto titulo="Observaciones" texto={formulario.actividad.observaciones} />
                )}
              </>
            ) : (
              <>
                <View style={styles.row}><Text style={styles.label}>Descripción:</Text><Text style={styles.value}>{formulario.actividad.descripcion || '—'}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Observaciones:</Text><Text style={styles.value}>{formulario.actividad.observaciones || '—'}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Recomendaciones:</Text><Text style={styles.value}>{formulario.actividad.recomendaciones || '—'}</Text></View>
              </>
            )}
            {renderMiniRevision('Actividad Realizada')}
          </View>
        )}

        {/* Sección "📍 Ubicación" (coordenadas GPS del formulario) OCULTA a
            propósito en el Detalle de formulario: se retiró por solicitud
            para que ningún rol la vea. Las coordenadas siguen guardándose
            y siguen viajando al PDF/informes; solo no se muestran aquí.
            Si algún día se necesita reactivar, recuperar el bloque desde el
            historial de Git (buscaba `formulario.coordenadas.latitud`). */}

        {/* Fecha */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⏱️ Fechas</Text>
          <View style={styles.row}><Text style={styles.label}>Creado:</Text><Text style={styles.value}>{formatFecha(formulario.created_at)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Actualizado:</Text><Text style={styles.value}>{formatFecha(formulario.updated_at)}</Text></View>
          {renderMiniRevision('Fechas')}
        </View>

        {/* ───── Evidencias al FINAL del detalle ─────
            Resumen, miniaturas de fotos/videos, firmas y documentos de la
            finca. Antes aparecían al principio (justo después de la encuesta)
            y empujaban los datos del formulario hacia abajo; ahora cierran la
            pantalla, después de la información y las fechas. */}
        {/* Resumen de evidencias */}
        <View style={styles.evidenciasSummary}>
          <Text style={styles.evidenciasSummaryTitle}>📸 Evidencias ({evidenciaCount})</Text>
          <Text style={styles.evidenciasSummaryItem}>
            • {evidencias.filter(f => f.tipo !== 'video').length} foto(s)
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • {evidencias.filter(f => f.tipo === 'video').length} video(s)
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Firma beneficiario: {formulario.firma_beneficiario ? '✓' : '✗'}
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Firma técnico: {formulario.firma_tecnico ? '✓' : '✗'}
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Huella biométrica: {formulario.huella_beneficiario ? '✓' : '✗'}
          </Text>
        </View>

        {/* Fotos/Videos en miniatura */}
        <View style={styles.fotosSection}>
          <View style={styles.evidenciasHeaderRow}>
            <Text style={styles.sectionTitle}>
              Evidencias capturadas ({evidencias.length})
              {evidenciasRemotas ? ' · desde el servidor' : ''}
            </Text>
            {puedeAgregarEvidencias && (
              <TouchableOpacity
                style={styles.agregarEvidenciaBtn}
                onPress={elegirTipoEvidencia}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Agregar evidencia"
              >
                <Text style={styles.agregarEvidenciaBtnText}>＋ Agregar</Text>
              </TouchableOpacity>
            )}
          </View>
          {evidencias.length === 0 ? (
            <Text style={styles.evidenciasVacias}>
              No hay evidencias registradas en esta visita.
              {puedeAgregarEvidencias ? ' Usa «＋ Agregar» para capturar una foto o video.' : ''}
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {evidencias.map((foto) => (
                <View key={foto.id} style={styles.fotoThumbContainer}>
                  <TouchableOpacity
                    style={styles.fotoThumbTouchable}
                    // Los videos abren el reproductor; las fotos, el visor ampliado
                    onPress={() =>
                      foto.tipo === 'video'
                        ? setVideoPreview(foto)
                        : setFotoPreview(foto)
                    }
                    activeOpacity={0.8}
                  >
                    {foto.tipo === 'video' ? (
                      <View style={styles.videoThumb}>
                        <Text style={styles.videoThumbIcon}>▶️</Text>
                      </View>
                    ) : (
                      <Image
                        source={fuenteEvidencia(foto.uri)}
                        style={styles.fotoThumb}
                      />
                    )}
                    {foto.tipo === 'video' && (
                      <Text style={styles.videoThumbLabel}>🎥</Text>
                    )}
                  </TouchableOpacity>

                  {/* ✕ Eliminar evidencia — admin/coordinador (cualquiera) y
                      el técnico dueño de la visita. Va fuera del
                      TouchableOpacity de la miniatura a propósito: así
                      tocarla NO abre la foto ampliada. */}
                  {puedeEliminarEvidencias && (
                    <TouchableOpacity
                      style={styles.fotoDeleteBtn}
                      onPress={() => confirmarEliminarEvidencia(foto)}
                      disabled={eliminandoEvidenciaId === foto.id}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        foto.tipo === 'video' ? 'Eliminar video' : 'Eliminar foto'
                      }
                    >
                      {eliminandoEvidenciaId === foto.id ? (
                        <ActivityIndicator size="small" color={COLORS.surface} />
                      ) : (
                        <Text style={styles.fotoDeleteBtnText}>✕</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
        {renderMiniRevision('Evidencias')}

        {/* Firmas recolectadas — antes solo se contaban (✓/✗) en el resumen
            de arriba, pero no había forma de VERLAS en la pantalla; solo
            aparecían dentro del PDF. Los roles de supervisión necesitan
            poder revisarlas aquí mismo, sin generar el documento completo. */}
        {(formulario.firma_beneficiario || formulario.firma_tecnico) && (
          <View style={styles.fotosSection}>
            <Text style={styles.sectionTitle}>✍️ Firmas</Text>
            <View style={styles.firmasRow}>
              <View style={styles.firmaCard}>
                <Text style={styles.firmaCardLabel}>
                  Beneficiario{formulario.beneficiario?.nombre ? ` — ${formulario.beneficiario.nombre}` : ''}
                </Text>
                {!formulario.firma_beneficiario ? (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <Text style={styles.firmaVaciaTexto}>No registrada</Text>
                  </View>
                ) : !firmasResueltas ? (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  </View>
                ) : firmasResueltas.beneficiario ? (
                  <TouchableOpacity
                    onPress={() =>
                      setFirmaPreview({
                        uri: firmasResueltas.beneficiario!.uri,
                        headers: firmasResueltas.beneficiario!.headers,
                        titulo: `✍️ Firma del Beneficiario — ${formulario.beneficiario?.nombre || '—'}`,
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: firmasResueltas.beneficiario.uri, headers: firmasResueltas.beneficiario.headers }}
                      style={styles.firmaImg}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <Text style={styles.firmaVaciaTexto}>No se pudo cargar</Text>
                  </View>
                )}
              </View>
              <View style={styles.firmaCard}>
                <Text style={styles.firmaCardLabel}>
                  Técnico{formulario.tecnico?.nombre ? ` — ${formulario.tecnico.nombre}` : ''}
                </Text>
                {!formulario.firma_tecnico ? (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <Text style={styles.firmaVaciaTexto}>No registrada</Text>
                  </View>
                ) : !firmasResueltas ? (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  </View>
                ) : firmasResueltas.tecnico ? (
                  <TouchableOpacity
                    onPress={() =>
                      setFirmaPreview({
                        uri: firmasResueltas.tecnico!.uri,
                        headers: firmasResueltas.tecnico!.headers,
                        titulo: `🖊️ Firma del Técnico — ${formulario.tecnico?.nombre || '—'}`,
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: firmasResueltas.tecnico.uri, headers: firmasResueltas.tecnico.headers }}
                      style={styles.firmaImg}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <Text style={styles.firmaVaciaTexto}>No se pudo cargar</Text>
                  </View>
                )}
              </View>
            </View>
            {renderMiniRevision('Firmas')}
          </View>
        )}

        {/* Documentos de la finca — visible para todos los roles, no solo
            el técnico que los subió. Se combinan los documentos vinculados a
            este formulario con los del beneficiario (compartidos entre
            visitas de la misma finca). */}
        <View style={styles.fotosSection}>
          <Text style={styles.sectionTitle}>📎 Documentos de la finca ({documentos.length})</Text>
          {documentos.length === 0 ? (
            <Text style={styles.evidenciasVacias}>
              No hay documentos de finca registrados para este beneficiario.
            </Text>
          ) : (
            documentos.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.documentoItem}
                onPress={() => abrirDocumento(doc)}
                disabled={abriendoDocumentoId === doc.id}
                activeOpacity={0.7}
              >
                <Text style={styles.documentoIcon}>
                  {doc.mimetype?.includes('pdf') ? '📕' : doc.mimetype?.includes('image') ? '🖼️' : '📄'}
                </Text>
                <View style={styles.documentoInfo}>
                  <Text style={styles.documentoNombre} numberOfLines={1}>{doc.nombre}</Text>
                  <Text style={styles.documentoMeta}>
                    {formatFecha(doc.created_at)}
                    {doc.descripcion ? ` · ${doc.descripcion}` : ''}
                  </Text>
                </View>
                <Text style={styles.documentoAccion}>
                  {abriendoDocumentoId === doc.id ? '…' : '⬇️'}
                </Text>
              </TouchableOpacity>
            ))
          )}
          {renderMiniRevision('Documentos')}
        </View>

        {/* Sección final en modo "Revisión en Campo": el formulario de
            Seguimiento de Coordinación/Interventoría (campos + Cuadro de
            Evidencias + Ubicación), el mismo componente que usa la pantalla
            de Seguimiento. Va al final de todo el detalle, después de Fechas,
            y funciona sin conexión (se guarda en el dispositivo). */}
        {mostrarSeguimientoCampo && (
          <View style={styles.seccionSeguimientoCampo}>
            <SeguimientoCoordinacionSection
              embedded
              formularioId={formulario.id}
              beneficiarioCedula={formulario.beneficiario?.cedula}
              beneficiarioNombre={formulario.beneficiario?.nombre}
            />
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!respuestaEditando}
        transparent
        animationType="fade"
        onRequestClose={() => !guardandoRespuesta && setRespuestaEditando(null)}
      >
        <View style={styles.adminModalOverlay}>
          <View style={styles.adminModalCard}>
            <Text style={styles.adminModalTitle}>
              {respuestaEditando?.modo === 'corregir' ? 'Corregir respuesta' : 'Completar respuesta'}
            </Text>
            <Text style={styles.adminModalQuestion}>{respuestaEditando?.texto}</Text>

            {respuestaEditando?.espec?.tipo === 'gps' ? (
              <CapturaGPSPrecisa
                label={respuestaEditando?.texto || 'Coordenada'}
                latitud={gpsCaptura?.lat}
                longitud={gpsCaptura?.lon}
                altitud={gpsCaptura?.alt}
                precision={gpsCaptura?.precision}
                ubicacionTexto={ubicacionGPSTexto}
                onCapture={(lat, lon, alt, precision) => setGpsCaptura({ lat, lon, alt, precision })}
              />
            ) : respuestaEditando?.espec?.tipo === 'seleccion' || respuestaEditando?.espec?.tipo === 'multiple' ? (
              <>
                {respuestaEditando?.espec?.tipo === 'multiple' && (
                  <Text style={styles.adminOpcionHint}>Puedes marcar varias opciones.</Text>
                )}
                <ScrollView
                  style={styles.adminOpcionesScroll}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {(respuestaEditando?.espec?.opciones || []).map((opt) => {
                    const esMultiple = respuestaEditando?.espec?.tipo === 'multiple';
                    const seleccionado = esMultiple
                      ? valorRespuesta.split(', ').filter(Boolean).includes(opt)
                      : valorRespuesta === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        style={[styles.adminOpcionRow, seleccionado && styles.adminOpcionRowActiva]}
                        activeOpacity={0.7}
                        onPress={() => (esMultiple ? toggleValorMultiple(opt) : setValorRespuesta(opt))}
                      >
                        <Text style={[styles.adminOpcionMarca, seleccionado && styles.adminOpcionMarcaActiva]}>
                          {esMultiple ? (seleccionado ? '☑' : '☐') : seleccionado ? '◉' : '○'}
                        </Text>
                        <Text style={[styles.adminOpcionTexto, seleccionado && styles.adminOpcionTextoActivo]}>
                          {opt}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            ) : (
              <TextInput
                style={styles.adminRespuestaInput}
                value={valorRespuesta}
                onChangeText={setValorRespuesta}
                placeholder="Escribe la respuesta"
                placeholderTextColor={COLORS.textLight}
                multiline={(respuestaEditando?.espec?.keyboardType ?? 'default') === 'default'}
                keyboardType={respuestaEditando?.espec?.keyboardType || 'default'}
                autoFocus
              />
            )}

            <View style={styles.adminModalButtons}>
              <TouchableOpacity
                style={[styles.adminModalButton, styles.adminCancelButton]}
                onPress={() => {
                  setRespuestaEditando(null);
                  setGpsCaptura(null);
                }}
                disabled={guardandoRespuesta}
              >
                <Text style={styles.adminCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adminModalButton, styles.adminSaveButton]}
                onPress={respuestaEditando?.espec?.tipo === 'gps' ? guardarRespuestaGPS : guardarRespuestaAdmin}
                disabled={
                  guardandoRespuesta ||
                  (respuestaEditando?.espec?.tipo === 'gps' && (!gpsCaptura?.lat || !gpsCaptura?.lon))
                }
              >
                <Text style={styles.adminSaveText}>{guardandoRespuesta ? 'Guardando...' : 'Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 📄 Visor PDF embebido */}
      {showPdf && pdfUri && (
        <View style={[styles.pdfEmbedContainer, { height: PDF_HEIGHT }]}>
          <View style={styles.pdfEmbedHeader}>
            <Text style={styles.pdfEmbedTitle}>📄 Vista previa del PDF</Text>
            <View style={styles.pdfEmbedActions}>
              <TouchableOpacity onPress={handleSharePDF} style={styles.pdfEmbedActionBtn}>
                <Text style={styles.pdfEmbedActionText}>Compartir</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClosePdf} style={styles.pdfEmbedCloseBtn}>
                <Text style={styles.pdfEmbedCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          <WebView
            source={{ uri: pdfUri }}
            style={styles.webview}
            originWhitelist={['file://', 'http://', 'https://']}
            allowFileAccess={true}
            javaScriptEnabled={false}
            scalesPageToFit={Platform.OS === 'android'}
          />
        </View>
      )}

      {/* 🎥 Reproductor de video de evidencia */}
      <VideoPlayerModal
        uri={videoPreview?.uri ?? null}
        visible={!!videoPreview}
        onClose={() => setVideoPreview(null)}
        headers={authHeaders}
        subtitulo={
          videoPreview
            ? `📅 ${formatFecha(videoPreview.timestamp)}${
                videoPreview.coordenadas
                  ? `  ·  📍 ${videoPreview.coordenadas.latitud?.toFixed(6)}, ${videoPreview.coordenadas.longitud?.toFixed(6)}`
                  : ''
              }${
                formulario.coordenadas?.lugar || formulario.clima?.actual?.ubicacion?.nombre
                  ? `  ·  🏙️ ${formulario.coordenadas?.lugar || formulario.clima?.actual?.ubicacion?.nombre}`
                  : ''
              }`
            : undefined
        }
      />

      {/* 📸 Visor de foto ampliada */}
      <Modal
        visible={!!fotoPreview}
        transparent
        animationType="fade"
        onRequestClose={() => setFotoPreview(null)}
      >
        <Pressable style={styles.fotoModalOverlay} onPress={() => setFotoPreview(null)}>
          {fotoPreview && (
            <>
              <Image
                source={fuenteEvidencia(fotoPreview.uri)}
                style={styles.fotoModalImage}
                resizeMode="contain"
              />
              <Text style={styles.fotoModalInfo}>
                📅 {formatFecha(fotoPreview.timestamp)}
                {fotoPreview.coordenadas
                  ? `  ·  📍 ${fotoPreview.coordenadas.latitud?.toFixed(6)}, ${fotoPreview.coordenadas.longitud?.toFixed(6)}`
                  : ''}
                {/* Municipio de la visita — todas las evidencias de una
                    misma visita están a metros de distancia, comparten lugar */}
                {(formulario.coordenadas?.lugar || formulario.clima?.actual?.ubicacion?.nombre)
                  ? `  ·  🏙️ ${formulario.coordenadas?.lugar || formulario.clima?.actual?.ubicacion?.nombre}`
                  : ''}
              </Text>
              <Text style={styles.fotoModalHint}>Toca para cerrar</Text>
              {puedeEliminarEvidencias && (
                <TouchableOpacity
                  style={styles.fotoModalDeleteBtn}
                  onPress={() => confirmarEliminarEvidencia(fotoPreview)}
                  disabled={eliminandoEvidenciaId === fotoPreview.id}
                  accessibilityRole="button"
                  accessibilityLabel="Eliminar foto"
                >
                  <Text style={styles.fotoModalDeleteText}>
                    {eliminandoEvidenciaId === fotoPreview.id ? 'Eliminando…' : '🗑️ Eliminar foto'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </Pressable>
      </Modal>

      {/* ✍️ Visor de firma ampliada */}
      <Modal
        visible={!!firmaPreview}
        transparent
        animationType="fade"
        onRequestClose={() => setFirmaPreview(null)}
      >
        <Pressable style={styles.fotoModalOverlay} onPress={() => setFirmaPreview(null)}>
          {firmaPreview && (
            <>
              <Image
                source={{ uri: firmaPreview.uri, headers: firmaPreview.headers }}
                style={[styles.fotoModalImage, { backgroundColor: '#fff' }]}
                resizeMode="contain"
              />
              <Text style={styles.fotoModalInfo}>{firmaPreview.titulo}</Text>
              <Text style={styles.fotoModalHint}>Toca para cerrar</Text>
            </>
          )}
        </Pressable>
      </Modal>

      {/* Botones inferiores */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
        <TouchableOpacity
          style={styles.pdfButton}
          onPress={showPdf ? handleClosePdf : handleViewPDF}
          disabled={generatingPdf}
        >
          <Text style={styles.pdfButtonText}>
            {generatingPdf ? 'Generando...' : showPdf ? '✕ Cerrar PDF' : '📄 Ver PDF'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.downloadButton}
          onPress={handleDownloadPDF}
          disabled={generatingPdf}
        >
          <Text style={styles.downloadButtonText}>
            {generatingPdf ? 'Generando...' : '⬇️ Descargar PDF'}
          </Text>
        </TouchableOpacity>
        {formulario.sincronizado && (
          <TouchableOpacity
            style={styles.mediaButton}
            onPress={handleDownloadMedia}
            disabled={descargandoMedia}
          >
            {descargandoMedia ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Text style={styles.mediaButtonText}>📦 Media</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
  },
  /** Envuelve el formulario de Seguimiento incrustado al final del detalle en modo campo. */
  seccionSeguimientoCampo: {
    marginTop: SPACING.xl,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  statusTipo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  statusSync: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.warning,
  },
  statusSyncOk: {
    color: COLORS.success,
  },
  evidenciasSummary: {
    backgroundColor: COLORS.info + '12',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
  },
  evidenciasSummaryTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.info,
    marginBottom: SPACING.xs,
  },
  evidenciasSummaryItem: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    marginLeft: SPACING.sm,
  },
  fotosSection: {
    marginBottom: SPACING.md,
  },
  /** Fila del título de evidencias con el botón "＋ Agregar" a la derecha */
  evidenciasHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  agregarEvidenciaBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    marginBottom: SPACING.xs,
  },
  agregarEvidenciaBtnText: {
    color: COLORS.surface,
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.bold,
  },
  evidenciasVacias: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    paddingVertical: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
  },
  // --- Preguntas de la encuesta (resumen completo) ---
  pregunta: {
    paddingVertical: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  preguntaTexto: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  preguntaValor: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  preguntaValorVacio: {
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    fontWeight: FONTS.weights.regular,
  },
  preguntaValorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  preguntaValorFlex: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  adminEditarBtn: {
    backgroundColor: COLORS.roleAdmin + '12',
    borderWidth: 1,
    borderColor: COLORS.roleAdmin,
    borderRadius: BORDER_RADIUS.sm,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  adminEditarBtnText: {
    color: COLORS.roleAdmin,
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  adminModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  adminModalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  adminModalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  adminModalQuestion: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  adminRespuestaInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  adminOpcionesScroll: {
    maxHeight: 280,
    marginBottom: SPACING.md,
  },
  adminOpcionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.xs,
  },
  adminOpcionRowActiva: {
    borderColor: COLORS.roleAdmin,
    backgroundColor: COLORS.roleAdmin + '12',
  },
  adminOpcionMarca: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textLight,
    marginRight: SPACING.sm,
  },
  adminOpcionMarcaActiva: {
    color: COLORS.roleAdmin,
  },
  adminOpcionTexto: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  adminOpcionTextoActivo: {
    fontWeight: FONTS.weights.semibold,
  },
  adminOpcionHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  adminModalButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  adminModalButton: {
    flex: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  adminCancelButton: {
    backgroundColor: COLORS.divider,
  },
  adminSaveButton: {
    backgroundColor: COLORS.roleAdmin,
  },
  adminCancelText: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  adminSaveText: {
    color: '#fff',
    fontWeight: FONTS.weights.semibold,
  },
  verEnMapsBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.sm,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  verEnMapsBtnText: {
    color: '#fff',
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  preguntaObs: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  fotoThumb: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surfaceAlt,
  },
  fotoThumbContainer: {
    position: 'relative',
    marginRight: SPACING.sm,
  },
  /** Zona táctil de la miniatura (abre el visor) */
  fotoThumbTouchable: {
    width: 100,
    height: 100,
  },
  /**
   * "✕" para eliminar la evidencia — solo admin y coordinador.
   * Vive FUERA del TouchableOpacity que abre el visor, para que tocarla no
   * abra la foto además de borrarla.
   */
  fotoDeleteBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  fotoDeleteBtnText: {
    color: COLORS.surface,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 15,
  },
  /** Botón "Eliminar" del visor ampliado */
  fotoModalDeleteBtn: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.error,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  fotoModalDeleteText: {
    color: COLORS.surface,
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
  },
  fotoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  fotoModalImage: {
    width: '100%',
    height: '75%',
  },
  fotoModalInfo: {
    color: COLORS.surface,
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  fotoModalHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: FONTS.sizes.xs,
    marginTop: SPACING.xs,
  },
  videoThumb: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoThumbIcon: {
    fontSize: 32,
  },
  videoThumbLabel: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    fontSize: 16,
  },
  documentoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  documentoIcon: {
    fontSize: 24,
    marginRight: SPACING.sm,
  },
  documentoInfo: {
    flex: 1,
  },
  documentoNombre: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  documentoMeta: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  documentoAccion: {
    fontSize: 18,
    marginLeft: SPACING.sm,
  },
  firmasRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  firmaCard: {
    flex: 1,
  },
  firmaCardLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  firmaImg: {
    width: '100%',
    height: 90,
    backgroundColor: '#fff',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  firmaImgVacia: {
    justifyContent: 'center',
    alignItems: 'center',
    borderStyle: 'dashed',
  },
  firmaVaciaTexto: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  section: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  /** Bloque de texto largo (etiqueta arriba, contenido debajo) — ítems v2 */
  bloqueTexto: {
    paddingVertical: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  bloqueTextoLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
    marginBottom: 2,
  },
  listaItem: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    lineHeight: 18,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
    width: 110,
  },
  value: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  bottomBar: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  pdfButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  pdfButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  downloadButton: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  downloadButtonText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  mediaButton: {
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  mediaButtonText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
  },
  // ---- Visor PDF embebido ----
  pdfEmbedContainer: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  pdfEmbedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  pdfEmbedTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  pdfEmbedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  pdfEmbedActionBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.primary + '20',
    borderRadius: BORDER_RADIUS.sm,
  },
  pdfEmbedActionText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  pdfEmbedCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.error + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pdfEmbedCloseText: {
    fontSize: 14,
    fontWeight: FONTS.weights.bold,
    color: COLORS.error,
  },
  webview: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
});

export default FormularioDetailScreen;
