// ============================================================
// GEODAILY — Formulario de Caracterización (NUEVO)
// Pantalla única con secciones fijas visibles y dropdowns
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '../../components/AppBackground';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useForm } from '../../store/FormContext';
import { useLocation } from '../../hooks/useLocation';
import { useClimate } from '../../hooks/useClimate';
import {
  getVeredasByMunicipio,
  NIVEL_EDUCATIVO_OPTS,
  PERSONAS_NUCLEO_OPTS,
  FUENTE_INGRESOS_OPTS,
  SINO_OPTS,
  SERVICIOS_PUBLICOS_OPTS,
  MANO_OBRA_OPTS,
  ACTIVIDAD_PRODUCTIVA_OPTS,
  PROCESOS_EROSION_OPTS,
  FUENTES_HIDRICAS_OPTS,
  PRACTICAS_CONSERVACION_OPTS,
  MANEJO_RESIDUOS_OPTS,
  TEXTURA_SUELO_OPTS,
  COLOR_SUELO_OPTS,
  DRENAJE_OPTS,
  PROFUNDIDAD_OPTS,
  PRESENCIA_PIEDRAS_OPTS,
  COMPACTACION_OPTS,
  COBERTURA_SUELO_OPTS,
  EVIDENCIA_EROSION_OPTS,
} from '../../utils/constants';
import { guardarBorrador, getBorrador, FormDraft } from '../../store/FormDraftStore';
import {
  DatosCaracterizacionNueva,
  ComponenteSocial,
  ComponenteProductivo,
  ComponenteAgroambiental,
  AnalisisSueloCaracterizacion,
  RecomendacionesCaracterizacion,
  Formulario,
} from '../../types';
import { saveFormularioLocal, getDb } from '../../services/database';
import DropdownPicker from '../../components/DropdownPicker';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{ params: { draftId?: string } }, 'params'>;
};

// ─── Estado inicial ───────────────────────────────────────────
const EMPTY_SOCIAL: ComponenteSocial = {
  nivel_educativo: '',
  personas_nucleo: '',
  fuente_ingresos: '',
  participa_organizacion: '',
  servicios_publicos: '',
  mano_obra: '',
};

const EMPTY_PRODUCTIVO: ComponenteProductivo = {
  actividad_productiva: '',
  acceso_agua: '',
  sistemas_riego: '',
  asistencia_tecnica: '',
};

const EMPTY_AGROAMBIENTAL: ComponenteAgroambiental = {
  procesos_erosion: '',
  fuentes_hidricas: '',
  areas_conservacion: '',
  practicas_conservacion: '',
  manejo_residuos: '',
};

const EMPTY_ANALISIS: AnalisisSueloCaracterizacion = {
  observacion_suelo: '',
  textura: '',
  color: '',
  drenaje: '',
  profundidad: '',
  piedras: '',
  compactacion: '',
  cobertura: '',
  evidencia_erosion: '',
};

const EMPTY_RECOMENDACIONES: RecomendacionesCaracterizacion = {
  recomendaciones_tecnicas: '',
  recomendaciones_ambientales: '',
};

const EMPTY_CARACTERIZACION: DatosCaracterizacionNueva = {
  municipio: 'Puerto Rico',
  fecha: format(new Date(), 'dd/MM/yyyy', { locale: es }),
  vereda: '',
  encuesta_numero: '',
  productor_nombre: '',
  documento: '',
  telefono: '',
  tecnico_responsable: '',
  tecnico_cedula: '',
  finca: '',
  componente_social: { ...EMPTY_SOCIAL },
  componente_productivo: { ...EMPTY_PRODUCTIVO },
  componente_agroambiental: { ...EMPTY_AGROAMBIENTAL },
  analisis_suelo: { ...EMPTY_ANALISIS },
  recomendaciones: { ...EMPTY_RECOMENDACIONES },
};

// ─── Componente ──────────────────────────────────────────────
const FormularioCaracterizacionScreen: React.FC<Props> = ({ navigation, route }) => {
  const { user } = useAuth();
  const {
    iniciarFormulario,
    setCoordenadas,
    addFoto,
    setFirmaBeneficiario,
    setFirmaTecnico,
    setHuella,
    setCaracterizacionNueva,
    finalizarFormulario,
    formularioActual,
  } = useForm();
  const { getCurrentPosition, coordenadas } = useLocation();
  const { fetchClimate } = useClimate();
  const insets = useSafeAreaInsets();

  const draftId = route.params.draftId;

  // ─── Estado del formulario ────────────────────────────────
  const [data, setData] = useState<DatosCaracterizacionNueva>({ ...EMPTY_CARACTERIZACION });
  const [selectedMunicipio, setSelectedMunicipio] = useState('Puerto Rico');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Evidencias
  const [fotosCount, setFotosCount] = useState(0);
  const [firmaBeneficiarioOk, setFirmaBeneficiarioOk] = useState(false);
  const [firmaTecnicoOk, setFirmaTecnicoOk] = useState(false);
  const [huellaOk, setHuellaOk] = useState(false);
  const [documentosCount, setDocumentosCount] = useState(0);

  const formIdRef = useRef<string>('');

  // ─── Inicializar ──────────────────────────────────────────
  useEffect(() => {
    iniciarFormulario('caracterizacion');

    // Autocompletar técnico desde el usuario autenticado
    if (user) {
      setData((prev) => ({
        ...prev,
        tecnico_responsable: user.nombre || '',
        tecnico_cedula: user.cedula || '',
      }));
    }

    const init = async () => {
      // Cargar borrador si existe
      if (draftId) {
        const draft = await getBorrador(draftId);
        if (draft?.caracterizacion_nueva) {
          setData(draft.caracterizacion_nueva);
          if (draft.caracterizacion_nueva.municipio) {
            setSelectedMunicipio(draft.caracterizacion_nueva.municipio);
          }
        }
      }

      // Capturar ubicación
      const coords = await getCurrentPosition();
      if (coords) {
        setCoordenadas(coords);
        fetchClimate(coords.latitud, coords.longitud);
      }
    };
    init();
  }, []);

  // Sincronizar formIdRef con el ID real del contexto cuando esté disponible
  useEffect(() => {
    if (formularioActual?.id) {
      formIdRef.current = formularioActual.id;
    }
  }, [formularioActual?.id]);

  // Refrescar evidencias al volver de pantallas
  useFocusEffect(
    useCallback(() => {
      if (formularioActual) {
        setFotosCount(formularioActual.fotos?.length || 0);
        setFirmaBeneficiarioOk(!!formularioActual.firma_beneficiario);
        setFirmaTecnicoOk(!!formularioActual.firma_tecnico);
        setHuellaOk(!!formularioActual.huella_beneficiario);
      }
      // Cargar documentos vinculados desde SQLite
      const cargarDocs = async () => {
        const formId = formularioActual?.id || formIdRef.current;
        if (formId) {
          try {
            const db = getDb();
            if (db) {
              const rows = await db.getAllAsync<any>(
                'SELECT COUNT(*) as cnt FROM documentos_finca WHERE formulario_id = ?',
                [formId]
              );
              if (rows && rows.length > 0) {
                setDocumentosCount(rows[0].cnt || 0);
              }
            }
          } catch (e) {
            // Ignorar
          }
        }
      };
      cargarDocs();
    }, [formularioActual])
  );

  // ─── Helpers ──────────────────────────────────────────────
  const updateData = useCallback((partial: Partial<DatosCaracterizacionNueva>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  const updateSocial = useCallback((partial: Partial<ComponenteSocial>) => {
    setData((prev) => ({
      ...prev,
      componente_social: { ...prev.componente_social, ...partial },
    }));
  }, []);

  const updateProductivo = useCallback((partial: Partial<ComponenteProductivo>) => {
    setData((prev) => ({
      ...prev,
      componente_productivo: { ...prev.componente_productivo, ...partial },
    }));
  }, []);

  const updateAgroambiental = useCallback((partial: Partial<ComponenteAgroambiental>) => {
    setData((prev) => ({
      ...prev,
      componente_agroambiental: { ...prev.componente_agroambiental, ...partial },
    }));
  }, []);

  const updateAnalisis = useCallback((partial: Partial<AnalisisSueloCaracterizacion>) => {
    setData((prev) => ({
      ...prev,
      analisis_suelo: { ...prev.analisis_suelo, ...partial },
    }));
  }, []);

  const updateRecomendaciones = useCallback((partial: Partial<RecomendacionesCaracterizacion>) => {
    setData((prev) => ({
      ...prev,
      recomendaciones: { ...prev.recomendaciones, ...partial },
    }));
  }, []);

  // Veredas disponibles según municipio
  const veredasDisponibles = React.useMemo(() => {
    return getVeredasByMunicipio('Caquetá', selectedMunicipio);
  }, [selectedMunicipio]);

  // ─── Guardar borrador ────────────────────────────────────
  const guardarBorradorHandler = useCallback(async () => {
    setIsSaving(true);
    try {
      const draftIdActual = formIdRef.current || formularioActual?.id || 'draft-' + Date.now();
      const draft: FormDraft = {
        id: draftIdActual,
        tipo: 'caracterizacion',
        step: 0,
        tecnico: {
          usuario_id: user?.id || '',
          nombre: data.tecnico_responsable,
          cedula: user?.cedula || '',
          telefono: data.telefono,
          email: user?.email || '',
        },
        beneficiario: {
          nombre: data.productor_nombre,
          cedula: data.documento,
          telefono: data.telefono,
          departamento: 'Caquetá',
          municipio: data.municipio,
          vereda: data.vereda,
          finca: data.finca,
        },
        actividad: {
          descripcion: 'Caracterización',
          observaciones: data.recomendaciones.recomendaciones_tecnicas,
          recomendaciones: data.recomendaciones.recomendaciones_ambientales,
        },
        caracterizacion_nueva: data,
        coordenadas: coordenadas || undefined,
        selectedDepartamento: 'Caquetá',
        selectedActividad: '',
        otraActividadText: '',
        descripcionDetallada: '',
        updated_at: new Date().toISOString(),
      };
      await guardarBorrador(draft);
      Alert.alert('💾 Guardado', 'Borrador guardado correctamente');
    } catch (err) {
      console.warn('[Carac] Error al guardar borrador:', err);
      Alert.alert('Error', 'No se pudo guardar el borrador');
    } finally {
      setIsSaving(false);
    }
  }, [data, coordenadas, user]);

  // ─── Navegar a evidencia ─────────────────────────────────
  const goToEvidencia = useCallback(
    (screen: string) => {
      navigation.navigate(screen);
    },
    [navigation]
  );

  // ─── Completar formulario ────────────────────────────────
  const handleCompletar = useCallback(async () => {
    if (isSubmitting) return;

    // Validar campos obligatorios del header
    if (!data.productor_nombre.trim()) {
      Alert.alert('Campo requerido', 'El nombre del productor es obligatorio');
      return;
    }
    if (!data.documento.trim()) {
      Alert.alert('Campo requerido', 'El número de documento es obligatorio');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Guardar en contexto
      setCaracterizacionNueva(data);
      setCoordenadas(coordenadas || { latitud: 0, longitud: 0 });

      // 2. Generar PDF
      let pdfUrl: string | undefined;
      try {
        const { generarPDFLocal } = await import('../../services/pdfLocal.service');
        const formData: Formulario = {
          id: formIdRef.current || 'carac-' + Date.now(),
          tipo: 'caracterizacion',
          tecnico: {
            usuario_id: user?.id || '',
            nombre: data.tecnico_responsable,
            cedula: user?.cedula || '',
            telefono: data.telefono,
            email: user?.email || '',
          },
          beneficiario: {
            nombre: data.productor_nombre,
            cedula: data.documento,
            telefono: data.telefono,
            departamento: 'Caquetá',
            municipio: data.municipio,
            vereda: data.vereda,
            finca: data.finca,
          },
          actividad: {
            descripcion: 'Caracterización',
            observaciones: data.recomendaciones.recomendaciones_tecnicas,
            recomendaciones: data.recomendaciones.recomendaciones_ambientales,
          },
          sociodemografico: undefined,
          coordenadas: coordenadas || { latitud: 0, longitud: 0 },
          fotos: formularioActual?.fotos || [],
          firma_beneficiario: formularioActual?.firma_beneficiario || '',
          firma_tecnico: formularioActual?.firma_tecnico || '',
          huella_beneficiario: formularioActual?.huella_beneficiario || false,
          sincronizado: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          caracterizacion_nueva: data,
        } as any;
        const localUri = await generarPDFLocal(formData);
        if (localUri) pdfUrl = localUri;
      } catch (e) {
        console.warn('[Carac] No se pudo generar PDF:', e);
      }

      // 3. Finalizar formulario
      const form = finalizarFormulario();
      if (!form) {
        Alert.alert('Error', 'No se pudo finalizar el formulario');
        setIsSubmitting(false);
        return;
      }
      form.pdf_url = pdfUrl || form.pdf_url;
      (form as any).caracterizacion_nueva = data;

      // 4. Persistir a SQLite
      try {
        await saveFormularioLocal(form);
      } catch (dbError) {
        console.error('[Carac] Error al guardar en SQLite:', dbError);
      }

      // 5. Actualizar documentos vinculados: si se guardaron con 'sin-formulario',
      //    reasignarlos al ID real del formulario completado
      try {
        const db = getDb();
        if (db) {
          const formRealId = form.id;
          // Actualizar docs guardados con ID temporal
          await db.runAsync(
            "UPDATE documentos_finca SET formulario_id = ? WHERE formulario_id = ?",
            [formRealId, formularioActual?.id || 'sin-formulario']
          );
          // También los que tengan el formIdRef anterior si es distinto
          const refId = formIdRef.current;
          if (refId && refId !== formRealId && refId !== 'sin-formulario') {
            await db.runAsync(
              "UPDATE documentos_finca SET formulario_id = ? WHERE formulario_id = ?",
              [formRealId, refId]
            );
          }
        }
      } catch (e) {
        console.warn('[Carac] No se pudieron actualizar documentos:', e);
      }

      // 6. Eliminar borrador
      if (draftId) {
        try {
          const { eliminarBorrador } = await import('../../store/FormDraftStore');
          await eliminarBorrador(draftId);
        } catch {}
      }

      setIsSubmitting(false);

      Alert.alert(
        '✅ Formulario completado',
        'La caracterización ha sido guardada correctamente.',
        [{ text: 'Ver listado', onPress: () => navigation.navigate('TerrenoFormularioList') }]
      );
    } catch (err) {
      console.error('[Carac] Error al completar:', err);
      setIsSubmitting(false);
      Alert.alert('Error inesperado', 'Ocurrió un error al completar el formulario');
    }
  }, [
    data,
    coordenadas,
    isSubmitting,
    formularioActual,
    draftId,
    user,
    navigation,
    setCaracterizacionNueva,
    setCoordenadas,
    finalizarFormulario,
  ]);

  // ─── Render ──────────────────────────────────────────────

  // --- Sección reutilizable ---
  const renderSection = (
    title: string,
    icon: string,
    color: string,
    children: React.ReactNode
  ) => (
    <View style={[styles.sectionCard, { borderLeftColor: color }]}>
      <View style={[styles.sectionHeader, { backgroundColor: color + '12' }]}>
        <Text style={[styles.sectionTitle, { color }]}>
          {icon}  {title}
        </Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );

  // --- Input field corto ---
  const renderField = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    opts?: {
      placeholder?: string;
      keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'email-address';
      multiline?: boolean;
      numberOfLines?: number;
      required?: boolean;
    }
  ) => (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>
        {label}
        {opts?.required && <Text style={styles.required}> *</Text>}
      </Text>
      <TextInput
        style={[
          styles.textInput,
          opts?.multiline && { minHeight: 70, textAlignVertical: 'top' },
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={opts?.placeholder || ''}
        placeholderTextColor={COLORS.textLight}
        keyboardType={opts?.keyboardType || 'default'}
        multiline={opts?.multiline || false}
        numberOfLines={opts?.numberOfLines || 1}
        autoCapitalize="sentences"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
      <AppBackground overlay={0.35}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {/* ═══ DATOS GENERALES ═══ */}
          {renderSection('DATOS GENERALES', '📋', COLORS.primary, (
            <>
              <DropdownPicker
                label="Municipio"
                value={selectedMunicipio}
                options={['Puerto Rico']}
                onSelect={(val) => {
                  setSelectedMunicipio(val);
                  updateData({ municipio: val, vereda: '' });
                }}
                required
              />

              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Fecha *</Text>
                <View style={styles.lockedField}>
                  <Text style={styles.lockedFieldText}>
                    📅 {format(new Date(), 'dd/MM/yyyy', { locale: es })}
                  </Text>
                </View>
              </View>

              <DropdownPicker
                label="Vereda"
                value={data.vereda || null}
                options={veredasDisponibles}
                onSelect={(val) => updateData({ vereda: val })}
                placeholder="Seleccionar vereda..."
                required
              />

              {renderField('Encuesta N.°', data.encuesta_numero, (t) => updateData({ encuesta_numero: t }), {
                placeholder: 'Número de encuesta',
                keyboardType: 'numeric',
              })}

              {renderField('Nombre del productor', data.productor_nombre, (t) => updateData({ productor_nombre: t }), {
                placeholder: 'Nombre completo del productor',
                required: true,
              })}

              {renderField('Documento', data.documento, (t) => updateData({ documento: t }), {
                placeholder: 'Número de cédula',
                keyboardType: 'numeric',
                required: true,
              })}

              {renderField('Teléfono', data.telefono, (t) => updateData({ telefono: t }), {
                placeholder: 'Teléfono de contacto',
                keyboardType: 'phone-pad',
              })}

              {renderField('Nombre de la finca / predio', data.finca, (t) => updateData({ finca: t }), {
                placeholder: 'Nombre de la finca',
              })}

              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Técnico responsable *</Text>
                <View style={styles.lockedField}>
                  <Text style={styles.lockedFieldText}>
                    👤 {data.tecnico_responsable || (user?.nombre || '—')}
                  </Text>
                </View>
              </View>
            </>
          ))}

          {/* ═══ COMPONENTE SOCIAL ═══ */}
          {renderSection('COMPONENTE SOCIAL', '👥', '#2E7D32', (
            <>
              <DropdownPicker
                label="1. Nivel educativo del productor"
                value={data.componente_social.nivel_educativo || null}
                options={NIVEL_EDUCATIVO_OPTS}
                onSelect={(val) => updateSocial({ nivel_educativo: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="2. Número de personas del núcleo familiar"
                value={data.componente_social.personas_nucleo || null}
                options={PERSONAS_NUCLEO_OPTS}
                onSelect={(val) => updateSocial({ personas_nucleo: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="3. Principal fuente de ingresos"
                value={data.componente_social.fuente_ingresos || null}
                options={FUENTE_INGRESOS_OPTS}
                onSelect={(val) => updateSocial({ fuente_ingresos: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="4. Participa en alguna organización o asociación"
                value={data.componente_social.participa_organizacion || null}
                options={SINO_OPTS}
                onSelect={(val) => updateSocial({ participa_organizacion: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="5. Acceso a servicios públicos básicos"
                value={data.componente_social.servicios_publicos || null}
                options={SERVICIOS_PUBLICOS_OPTS}
                onSelect={(val) => updateSocial({ servicios_publicos: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="6. Mano de obra utilizada"
                value={data.componente_social.mano_obra || null}
                options={MANO_OBRA_OPTS}
                onSelect={(val) => updateSocial({ mano_obra: val })}
                placeholder="Seleccionar..."
              />
            </>
          ))}

          {/* ═══ COMPONENTE PRODUCTIVO ═══ */}
          {renderSection('COMPONENTE PRODUCTIVO', '🌱', '#1565C0', (
            <>
              <DropdownPicker
                label="7. Principal actividad productiva"
                value={data.componente_productivo.actividad_productiva || null}
                options={ACTIVIDAD_PRODUCTIVA_OPTS}
                onSelect={(val) => updateProductivo({ actividad_productiva: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="8. El predio cuenta con acceso permanente al agua"
                value={data.componente_productivo.acceso_agua || null}
                options={SINO_OPTS}
                onSelect={(val) => updateProductivo({ acceso_agua: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="9. Dispone de sistemas de riego"
                value={data.componente_productivo.sistemas_riego || null}
                options={SINO_OPTS}
                onSelect={(val) => updateProductivo({ sistemas_riego: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="10. Ha recibido asistencia técnica en los últimos dos años"
                value={data.componente_productivo.asistencia_tecnica || null}
                options={SINO_OPTS}
                onSelect={(val) => updateProductivo({ asistencia_tecnica: val })}
                placeholder="Seleccionar..."
              />
            </>
          ))}

          {/* ═══ COMPONENTE AGROAMBIENTAL ═══ */}
          {renderSection('COMPONENTE AGROAMBIENTAL', '🌿', '#E65100', (
            <>
              <DropdownPicker
                label="11. El predio presenta procesos de erosión"
                value={data.componente_agroambiental.procesos_erosion || null}
                options={PROCESOS_EROSION_OPTS}
                onSelect={(val) => updateAgroambiental({ procesos_erosion: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="12. Existen fuentes hídricas dentro o cerca del predio"
                value={data.componente_agroambiental.fuentes_hidricas || null}
                options={FUENTES_HIDRICAS_OPTS}
                onSelect={(val) => updateAgroambiental({ fuentes_hidricas: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="13. El predio cuenta con áreas de conservación o protección"
                value={data.componente_agroambiental.areas_conservacion || null}
                options={SINO_OPTS}
                onSelect={(val) => updateAgroambiental({ areas_conservacion: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="14. Realiza prácticas de conservación del suelo"
                value={data.componente_agroambiental.practicas_conservacion || null}
                options={PRACTICAS_CONSERVACION_OPTS}
                onSelect={(val) => updateAgroambiental({ practicas_conservacion: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="15. Manejo de residuos de agroquímicos"
                value={data.componente_agroambiental.manejo_residuos || null}
                options={MANEJO_RESIDUOS_OPTS}
                onSelect={(val) => updateAgroambiental({ manejo_residuos: val })}
                placeholder="Seleccionar..."
              />
            </>
          ))}

          {/* ═══ ANÁLISIS DE SUELO ═══ */}
          {renderSection('ANÁLISIS DE SUELO (EVALUACIÓN EN CAMPO)', '🔬', '#6A1B9A', (
            <>
              <DropdownPicker
                label="16. Se realizó la observación y caracterización física del suelo"
                value={data.analisis_suelo.observacion_suelo || null}
                options={SINO_OPTS}
                onSelect={(val) => updateAnalisis({ observacion_suelo: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="17. Textura predominante"
                value={data.analisis_suelo.textura || null}
                options={TEXTURA_SUELO_OPTS}
                onSelect={(val) => updateAnalisis({ textura: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="18. Color predominante"
                value={data.analisis_suelo.color || null}
                options={COLOR_SUELO_OPTS}
                onSelect={(val) => updateAnalisis({ color: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="19. Drenaje del suelo"
                value={data.analisis_suelo.drenaje || null}
                options={DRENAJE_OPTS}
                onSelect={(val) => updateAnalisis({ drenaje: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="20. Profundidad efectiva del suelo"
                value={data.analisis_suelo.profundidad || null}
                options={PROFUNDIDAD_OPTS}
                onSelect={(val) => updateAnalisis({ profundidad: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="21. Presencia de piedras o fragmentos rocosos"
                value={data.analisis_suelo.piedras || null}
                options={PRESENCIA_PIEDRAS_OPTS}
                onSelect={(val) => updateAnalisis({ piedras: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="22. Estado de la compactación del suelo"
                value={data.analisis_suelo.compactacion || null}
                options={COMPACTACION_OPTS}
                onSelect={(val) => updateAnalisis({ compactacion: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="23. Cobertura del suelo"
                value={data.analisis_suelo.cobertura || null}
                options={COBERTURA_SUELO_OPTS}
                onSelect={(val) => updateAnalisis({ cobertura: val })}
                placeholder="Seleccionar..."
              />
              <DropdownPicker
                label="24. Evidencia de erosión en el suelo"
                value={data.analisis_suelo.evidencia_erosion || null}
                options={EVIDENCIA_EROSION_OPTS}
                onSelect={(val) => updateAnalisis({ evidencia_erosion: val })}
                placeholder="Seleccionar..."
              />
            </>
          ))}

          {/* ═══ RECOMENDACIONES ═══ */}
          {renderSection('RECOMENDACIONES DEL TÉCNICO', '📝', '#F57F17', (
            <>
              {renderField(
                '25. Recomendaciones técnicas para el sistema productivo',
                data.recomendaciones.recomendaciones_tecnicas,
                (t) => updateRecomendaciones({ recomendaciones_tecnicas: t }),
                { placeholder: 'Describa las recomendaciones técnicas...', multiline: true, numberOfLines: 3 }
              )}
              {renderField(
                '26. Recomendaciones ambientales y de conservación',
                data.recomendaciones.recomendaciones_ambientales,
                (t) => updateRecomendaciones({ recomendaciones_ambientales: t }),
                { placeholder: 'Describa las recomendaciones ambientales...', multiline: true, numberOfLines: 3 }
              )}
            </>
          ))}

          {/* ═══ EVIDENCIAS ═══ */}
          {renderSection('EVIDENCIAS', '📸', '#0984E3', (
            <>
              <TouchableOpacity
                style={[styles.evidenciaCard, fotosCount > 0 && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('Camara')}
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>📸</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Evidencia Fotográfica</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {fotosCount > 0 ? `${fotosCount} foto(s) capturada(s)` : 'Tomar fotos de la visita'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.evidenciaCard, firmaBeneficiarioOk && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('FirmaBeneficiario')}
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>✍️</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Firma del Beneficiario</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {firmaBeneficiarioOk ? 'Firma registrada ✓' : 'Capturar firma del beneficiario'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.evidenciaCard, firmaTecnicoOk && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('FirmaDigital')}
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>🖊️</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Firma del Técnico en Terreno</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {firmaTecnicoOk ? 'Firma registrada ✓' : 'Capturar firma del técnico'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.evidenciaCard, huellaOk && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('FirmaBiometrica')}
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>🖐️</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Huella Biométrica del Beneficiario</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {huellaOk ? 'Huella registrada ✓' : 'Escanear huella del beneficiario'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.evidenciaCard, documentosCount > 0 && styles.evidenciaCardOk]}
                onPress={() => goToEvidencia('Camara')}
                activeOpacity={0.7}
              >
                <View style={styles.evidenciaIcon}>
                  <Text style={styles.evidenciaIconText}>📄</Text>
                </View>
                <View style={styles.evidenciaContent}>
                  <Text style={styles.evidenciaCardTitle}>Documentos de la Finca</Text>
                  <Text style={styles.evidenciaCardDesc}>
                    {documentosCount > 0 ? `${documentosCount} documento(s) vinculado(s) ✓` : 'Subir PDF, fotos, KML...'}
                  </Text>
                </View>
                <Text style={styles.evidenciaArrow}>›</Text>
              </TouchableOpacity>

              <Text style={styles.evidenciasProgress}>
                {[fotosCount > 0, firmaBeneficiarioOk, firmaTecnicoOk, huellaOk, documentosCount > 0].filter(Boolean).length} de 5 evidencias completadas
              </Text>
            </>
          ))}

          {/* ═══ UBICACIÓN ═══ */}
          {coordenadas && (
            <View style={styles.locationBox}>
              <Text style={styles.locationTitle}>📍 Ubicación capturada</Text>
              <Text style={styles.locationText}>
                Lat: {coordenadas.latitud.toFixed(6)} | Lon: {coordenadas.longitud.toFixed(6)}
              </Text>
              {coordenadas.altitud && (
                <Text style={styles.locationText}>Alt: {coordenadas.altitud.toFixed(1)} m</Text>
              )}
            </View>
          )}
        </ScrollView>

        {/* ═══ BOTTOM BAR ═══ */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, SPACING.sm) }]}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={guardarBorradorHandler}
            disabled={isSaving}
          >
            <Text style={styles.saveBtnText}>{isSaving ? '💾 Guardando...' : '💾 Guardar borrador'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.completeBtn, isSubmitting && styles.buttonDisabled]}
            onPress={handleCompletar}
            disabled={isSubmitting}
          >
            <Text style={styles.completeBtnText}>
              {isSubmitting ? '⏳...' : '✓ Completar'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Overlay de carga */}
        {isSubmitting && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Generando PDF y guardando datos...</Text>
            </View>
          </View>
        )}
      </View>
      </AppBackground>
    </SafeAreaView>
  );
};

// ─── Estilos ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  // Section card
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderLeftWidth: 4,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
    overflow: 'hidden',
  },
  sectionHeader: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  // Field
  fieldContainer: {
    marginBottom: SPACING.md,
  },
  fieldLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  required: {
    color: COLORS.error,
  },
  textInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  lockedField: {
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lockedFieldText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  // Evidencias
  evidenciaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  evidenciaCardOk: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '08',
  },
  evidenciaIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  evidenciaIconText: {
    fontSize: 24,
  },
  evidenciaContent: {
    flex: 1,
  },
  evidenciaCardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  evidenciaCardDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  evidenciaArrow: {
    fontSize: 28,
    color: '#b2bec3',
    fontWeight: '300',
    marginLeft: SPACING.sm,
  },
  evidenciasProgress: {
    textAlign: 'center',
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  // Ubicación
  locationBox: {
    backgroundColor: COLORS.surfaceAlt,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  locationTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  locationText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    ...SHADOWS.md,
  },
  saveBtn: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.info,
    ...SHADOWS.sm,
  },
  saveBtnText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  completeBtn: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.success,
    ...SHADOWS.sm,
  },
  completeBtnText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Loading overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loadingBox: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    marginHorizontal: SPACING.lg,
    ...SHADOWS.lg,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
});

export default FormularioCaracterizacionScreen;
