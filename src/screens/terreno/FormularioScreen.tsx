// ============================================================
// GEODAILY — Formulario de Terreno (Visita Técnica / Plantación)
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
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useForm } from '../../store/FormContext';
import { useLocation } from '../../hooks/useLocation';
import { useClimate } from '../../hooks/useClimate';
import {
  DEPARTAMENTOS_COLOMBIA,
  DEPARTAMENTOS_LIST,
  getMunicipiosByDepartamento,
  getVeredasByMunicipio,
  TIPOS_ACTIVIDAD,
} from '../../utils/constants';
import { guardarBorrador, getBorrador, FormDraft } from '../../store/FormDraftStore';
import { TipoFormulario, DatosTecnico, DatosBeneficiario, DatosSociodemograficos, ActividadRealizada } from '../../types';
import { saveFormularioLocal } from '../../services/database';
import { buscarBeneficiarioPorCedula } from '../../services/beneficiarios.service';
import FormField from '../../components/FormField';

type FormularioScreenProps = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{ params: { tipo: TipoFormulario; draftId?: string } }, 'params'>;
};

const FormularioScreen: React.FC<FormularioScreenProps> = ({ navigation, route }) => {
  const { user } = useAuth();
  const {
    iniciarFormulario,
    setTecnico,
    setBeneficiario,
    setActividad,
    setSociodemografico,
    setCoordenadas,
    finalizarFormulario,
    formularioActual,
  } = useForm();
  const { getCurrentPosition, coordenadas } = useLocation();
  const { fetchClimate } = useClimate();
  const insets = useSafeAreaInsets();

  const tipo = route.params.tipo;

  // Estado del formulario
  const [step, setStep] = useState(1);
  const [isStepSaved, setIsStepSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tecnico, setTecnicoState] = useState<DatosTecnico>({
    usuario_id: user?.id,
    nombre: user?.nombre || '',
    cedula: user?.cedula || '',
    telefono: user?.telefono || '',
    email: user?.email || '',
  });
  const [beneficiario, setBeneficiarioState] = useState<DatosBeneficiario>({
    nombre: '',
    cedula: '',
    telefono: '',
    departamento: 'Caquetá',
    municipio: 'Puerto Rico',
    vereda: '',
    finca: '',
  });
  const [actividad, setActividadState] = useState<ActividadRealizada>({
    descripcion: '',
    observaciones: '',
    recomendaciones: '',
  });
  const [selectedDepartamento, setSelectedDepartamento] = useState('Caquetá');
  const [selectedMunicipio, setSelectedMunicipio] = useState('Puerto Rico');
  const [selectedActividad, setSelectedActividad] = useState('');
  const [otraActividadText, setOtraActividadText] = useState('');
  const [descripcionDetallada, setDescripcionDetallada] = useState('');

  // Estado sociodemográfico (Fase 3)
  const [socioData, setSocioData] = useState<DatosSociodemograficos>({
    genero: 'masculino',
    escolaridad: '',
    etnia: '',
    personas_cargo: 0,
    hectareas: 0,
    vive_en_finca: true,
    asociado: false,
    asociacion_nombre: '',
    telefono_emergencia: '',
  });
  const [searchLoading, setSearchLoading] = useState(false);

  // Estado de evidencias
  const [fotosCount, setFotosCount] = useState(0);
  const [firmaBeneficiarioOk, setFirmaBeneficiarioOk] = useState(false);
  const [firmaTecnicoOk, setFirmaTecnicoOk] = useState(false);
  const [huellaOk, setHuellaOk] = useState(false);

  const totalSteps = tipo === 'caracterizacion' ? 5 : 5;
  const draftId = route.params.draftId;

  // Inicializar formulario al montar
  useEffect(() => {
    iniciarFormulario(tipo);

    const initForm = async () => {
      // Si hay un draftId, cargar borrador
      if (draftId) {
        const draft = await getBorrador(draftId);
        if (draft) {
          if (draft.tecnico) {
            setTecnicoState(draft.tecnico);
            setTecnico(draft.tecnico);
          }
          if (draft.beneficiario) {
            setBeneficiarioState(draft.beneficiario);
            setBeneficiario(draft.beneficiario);
            if (draft.beneficiario.departamento) {
              setSelectedDepartamento(draft.beneficiario.departamento);
            }
            if (draft.beneficiario.municipio) {
              setSelectedMunicipio(draft.beneficiario.municipio);
            }
          }
          if (draft.actividad) {
            setActividadState(draft.actividad);
            setActividad(draft.actividad);
          }
          if (draft.socioData) {
            setSocioData(draft.socioData);
          }
          if (draft.selectedActividad) {
            setSelectedActividad(draft.selectedActividad);
          }
          if (draft.otraActividadText) {
            setOtraActividadText(draft.otraActividadText);
          }
          if (draft.descripcionDetallada) {
            setDescripcionDetallada(draft.descripcionDetallada);
          }
          if (draft.step) {
            setStep(draft.step);
          }
          if (draft.coordenadas) {
            setCoordenadas(draft.coordenadas as any);
          }
        }
      }

      // Solo obtener ubicación si no viene del draft
      if (!draftId) {
        const coords = await getCurrentPosition();
        if (coords) {
          setCoordenadas(coords);
          fetchClimate(coords.latitud, coords.longitud);
        }
      }
    };
    initForm();
  }, []);

  // Refrescar estado de evidencias al volver de pantallas (cámara, firmas, huella)
  useFocusEffect(
    useCallback(() => {
      if (formularioActual) {
        setFotosCount(formularioActual.fotos?.length || 0);
        setFirmaBeneficiarioOk(!!formularioActual.firma_beneficiario);
        setFirmaTecnicoOk(!!formularioActual.firma_tecnico);
        setHuellaOk(!!formularioActual.huella_beneficiario);
      }
    }, [formularioActual])
  );

  // Guardar paso actual como borrador
  const saveCurrentStep = useCallback(async () => {
    // Asegurar que el borrador siempre tenga el usuario_id del técnico autenticado
    const tecnicoConUsuarioId = {
      ...tecnico,
      usuario_id: user?.id || tecnico.usuario_id,
    };
    const draft: FormDraft = {
      id: formularioActual?.id || 'draft-' + Date.now(),
      tipo,
      step,
      tecnico: tecnicoConUsuarioId,
      beneficiario,
      actividad,
      socioData: tipo === 'caracterizacion' ? socioData : undefined,
      coordenadas: coordenadas || undefined,
      selectedDepartamento,
      selectedActividad,
      otraActividadText,
      descripcionDetallada,
      updated_at: new Date().toISOString(),
    };
    await guardarBorrador(draft);
    setIsStepSaved(true);
    Alert.alert('Guardado', 'Progreso guardado correctamente');
  }, [formularioActual, tipo, step, tecnico, beneficiario, actividad, socioData, coordenadas, selectedDepartamento, selectedActividad, otraActividadText, descripcionDetallada, user?.id]);

  // Avanzar paso
  const nextStep = useCallback(() => {
    const resumenStep = totalSteps - 1; // paso 4

    if (step === resumenStep) {
      // Paso de Resumen: solo requiere guardar
      if (!isStepSaved) {
        Alert.alert('Guardar primero', 'Debes guardar el progreso antes de continuar');
        return;
      }
      setIsStepSaved(false);
      setStep(step + 1);
      return;
    }

    // Validar que el paso actual esté guardado
    if (!isStepSaved) {
      Alert.alert('Guardar primero', 'Debes guardar el progreso antes de continuar');
      return;
    }

    // Validar paso actual
    if (step === 1) {
      if (!tecnico.nombre || !tecnico.cedula) {
        Alert.alert('Campos requeridos', 'Completa los datos del técnico');
        return;
      }
      setTecnico(tecnico);
    } else if (step === 2) {
      if (!beneficiario.nombre || !beneficiario.municipio) {
        Alert.alert('Campos requeridos', 'Completa los datos del beneficiario');
        return;
      }
      setBeneficiario(beneficiario);
    } else if (step === 3 && tipo !== 'caracterizacion') {
      // Solo validar actividad en visita_tecnica / plantacion
      if (!actividad.descripcion || !descripcionDetallada.trim()) {
        Alert.alert('Campos requeridos', 'Selecciona el tipo de actividad y escribe una descripción');
        return;
      }
      // Combinar tipo + descripción detallada
      const actividadCompleta = {
        ...actividad,
        descripcion_detallada: descripcionDetallada,
      };
      setActividad(actividadCompleta);
    }

    if (step < totalSteps) {
      setIsStepSaved(false);
      setStep(step + 1);
    }
  }, [step, tecnico, beneficiario, actividad, isStepSaved, tipo]);

  // Paso anterior
  const prevStep = () => {
    if (step > 1) {
      setIsStepSaved(true);
      setStep(step - 1);
    }
  };

  // Navegar a captura de evidencia
  const goToEvidencia = (screen: string) => {
    navigation.navigate(screen);
  };

  // Completar formulario (desde paso de evidencias)
  const handleCompletar = async () => {
    if (isSubmitting) return; // Evita doble clic
    setIsSubmitting(true);

    try {
      // Guardar datos en contexto según tipo
      if (tipo !== 'caracterizacion') {
        setActividad(actividad);
      }
      if (tipo === 'caracterizacion') {
        setSociodemografico(socioData);
      }

      // ---- PASO 1: Generar PDF LOCAL (protegido contra errores) ----
      let pdfUrl: string | undefined;
      try {
        const { generarPDFLocal } = await import('../../services/pdfLocal.service');
        // Construir objeto completo con defaults para evitar undefined
        const formData = {
          ...formularioActual,
          tecnico: tecnico || formularioActual?.tecnico,
          beneficiario: beneficiario || formularioActual?.beneficiario,
          actividad: actividad || formularioActual?.actividad || { descripcion: '', observaciones: '', recomendaciones: '' },
          sociodemografico: socioData,
          clima: formularioActual?.clima || undefined,
          coordenadas: coordenadas || { latitud: 0, longitud: 0 },
          fotos: formularioActual?.fotos || [],
          firma_beneficiario: formularioActual?.firma_beneficiario || '',
          firma_tecnico: formularioActual?.firma_tecnico || '',
          huella_beneficiario: formularioActual?.huella_beneficiario || false,
        } as any;
        const localUri = await generarPDFLocal(formData);
        if (localUri) {
          pdfUrl = localUri;
          console.log('[Formulario] PDF local generado con evidencias:', localUri);
        }
      } catch (e) {
        console.warn('[Formulario] No se pudo generar PDF local:', e);
        // Fallback: intentar generar PDF en servidor
        try {
          const { generarPDF } = await import('../../services/pdf.service');
          const url = await generarPDF({
            ...formularioActual,
            tecnico,
            beneficiario,
            actividad,
            coordenadas: coordenadas || undefined,
          } as any);
          if (url) pdfUrl = url;
        } catch (e2) {
          console.warn('[Formulario] Tampoco se pudo generar PDF en servidor:', e2);
        }
      }

      // ---- PASO 2: Finalizar formulario en memoria (sin mutar estado) ----
      const form = finalizarFormulario();
      if (!form) {
        Alert.alert('Error', 'No se pudo finalizar el formulario');
        setIsSubmitting(false);
        return;
      }

      // Asignar pdf_url a la copia devuelta (NO al estado directamente)
      form.pdf_url = pdfUrl || form.pdf_url;

      // ---- PASO 3: Persistir a SQLite ----
      try {
        await saveFormularioLocal(form);
        console.log('[Formulario] Formulario persistido en SQLite:', form.id);
      } catch (dbError) {
        console.error('[Formulario] Error al persistir en SQLite:', dbError);
        Alert.alert('Advertencia', 'El formulario se completó pero no se pudo guardar localmente.');
      }

      // ---- PASO 4: Eliminar borrador si existe ----
      if (draftId) {
        try {
          const { eliminarBorrador } = await import('../../store/FormDraftStore');
          await eliminarBorrador(draftId);
        } catch {}
      }

      setIsSubmitting(false);

      Alert.alert(
        '✅ Formulario completado',
        'Todos los datos, evidencias y PDF han sido guardados correctamente.',
        [
          { text: 'Ver listado', onPress: () => navigation.navigate('TerrenoFormularioList') },
        ]
      );
    } catch (err) {
      console.error('[Formulario] Error en handleCompletar:', err);
      setIsSubmitting(false);
      Alert.alert('Error inesperado', 'Ocurrió un error al completar el formulario. Intenta de nuevo.');
    }
  };

  const getStepTitle = () => {
    if (tipo === 'caracterizacion') {
      switch (step) {
        case 1: return 'Datos del Técnico';
        case 2: return 'Datos del Beneficiario';
        case 3: return 'Caracterización Sociodemográfica';
        case 4: return 'Resumen del Formulario';
        case 5: return 'Evidencias';
        default: return '';
      }
    }
    // visita_tecnica / plantacion
    switch (step) {
      case 1: return 'Datos del Técnico';
      case 2: return 'Datos del Beneficiario';
      case 3: return 'Actividad Realizada';
      case 4: return 'Resumen del Formulario';
      case 5: return 'Evidencias';
      default: return '';
    }
  };

  // Renderizar paso 1: Datos del Técnico
  const renderStep1 = () => (
    <View>
      <FormField
        label="Nombre completo"
        value={tecnico.nombre}
        onChangeText={(t) => {
          setTecnicoState({ ...tecnico, nombre: t });
          setIsStepSaved(false);
        }}
        placeholder="Nombre del técnico"
        required
        autoCapitalize="words"
      />
      <FormField
        label="Cédula"
        value={tecnico.cedula}
        onChangeText={(t) => {
          setTecnicoState({ ...tecnico, cedula: t });
          setIsStepSaved(false);
        }}
        placeholder="Número de cédula"
        required
        keyboardType="numeric"
      />
      <FormField
        label="Teléfono"
        value={tecnico.telefono}
        onChangeText={(t) => {
          setTecnicoState({ ...tecnico, telefono: t });
          setIsStepSaved(false);
        }}
        placeholder="Teléfono de contacto"
        keyboardType="phone-pad"
      />
      <FormField
        label="Email"
        value={tecnico.email}
        onChangeText={(t) => {
          setTecnicoState({ ...tecnico, email: t });
          setIsStepSaved(false);
        }}
        placeholder="Correo electrónico"
        keyboardType="email-address"
        autoCapitalize="none"
      />
    </View>
  );

  // Renderizar paso 2: Datos del Beneficiario
  const renderStep2 = () => (
    <View>
      <FormField
        label="Nombre del beneficiario"
        value={beneficiario.nombre}
        onChangeText={(t) => {
          setBeneficiarioState({ ...beneficiario, nombre: t });
          setIsStepSaved(false);
        }}
        placeholder="Nombre completo"
        required
        autoCapitalize="words"
      />
      <FormField
        label="Cédula"
        value={beneficiario.cedula}
        onChangeText={(t) => {
          setBeneficiarioState({ ...beneficiario, cedula: t });
          setIsStepSaved(false);
        }}
        placeholder="Número de cédula"
        keyboardType="numeric"
      />

      {/* Botón de búsqueda por cédula */}
      <TouchableOpacity
        style={styles.searchCedulaBtn}
        onPress={async () => {
          if (!beneficiario.cedula || beneficiario.cedula.length < 5) {
            Alert.alert('Cédula inválida', 'Ingresa un número de cédula válido para buscar.');
            return;
          }
          setSearchLoading(true);
          const encontrado = await buscarBeneficiarioPorCedula(beneficiario.cedula);
          if (encontrado) {
            setBeneficiarioState({
              nombre: encontrado.nombre,
              cedula: encontrado.cedula,
              telefono: encontrado.telefono,
              departamento: encontrado.departamento || 'Caquetá',
              municipio: encontrado.municipio || 'Puerto Rico',
              vereda: encontrado.vereda || '',
              finca: encontrado.finca || '',
            });
            if (encontrado.sociodemografico) {
              setSocioData(encontrado.sociodemografico);
            }
            Alert.alert('✅ Beneficiario encontrado', `Datos cargados para ${encontrado.nombre}`);
          } else {
            Alert.alert('No encontrado', 'El beneficiario no existe en el padrón local. Puedes continuar con los datos manualmente.');
          }
          setSearchLoading(false);
          setIsStepSaved(false);
        }}
        disabled={searchLoading}
      >
        <Text style={styles.searchCedulaText}>
          {searchLoading ? '🔍 Buscando...' : '🔍 Buscar por cédula en padrón'}
        </Text>
      </TouchableOpacity>

      <FormField
        label="Teléfono"
        value={beneficiario.telefono}
        onChangeText={(t) => {
          setBeneficiarioState({ ...beneficiario, telefono: t });
          setIsStepSaved(false);
        }}
        placeholder="Teléfono de contacto"
        keyboardType="phone-pad"
      />

      {/* Departamento (fijo: Caquetá) */}
      <Text style={styles.fieldLabel}>Departamento *</Text>
      <View style={styles.lockedField}>
        <Text style={styles.lockedFieldText}>📍 Caquetá</Text>
      </View>

      {/* Municipio (fijo: Puerto Rico) */}
      <Text style={styles.fieldLabel}>Municipio *</Text>
      <View style={styles.lockedField}>
        <Text style={styles.lockedFieldText}>📍 Puerto Rico</Text>
      </View>

      {/* Vereda (solo las de Puerto Rico, Caquetá) */}
      {(() => {
        const veredas = getVeredasByMunicipio('Caquetá', 'Puerto Rico');
        return (
          <>
            <Text style={styles.fieldLabel}>Zona Rural / Vereda *</Text>
            <View style={styles.veredasContainer}>
              {veredas.map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.veredaChip, beneficiario.vereda === v && styles.veredaChipSelected]}
                  onPress={() => {
                    setBeneficiarioState({ ...beneficiario, vereda: v });
                    setIsStepSaved(false);
                  }}
                >
                  <Text style={[styles.veredaChipText, beneficiario.vereda === v && styles.veredaChipTextSelected]}>
                    {beneficiario.vereda === v ? '✓ ' : ''}{v}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        );
      })()}

      <FormField
        label="Nombre de la finca / predio"
        value={beneficiario.finca}
        onChangeText={(t) => {
          setBeneficiarioState({ ...beneficiario, finca: t });
          setIsStepSaved(false);
        }}
        placeholder="Nombre de la finca"
        autoCapitalize="words"
      />
    </View>
  );

  // Renderizar paso 3: Actividad Realizada
  const renderStep3 = () => (
    <View>
      <Text style={styles.fieldLabel}>Tipo de actividad</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsContainer}>
        {(TIPOS_ACTIVIDAD as readonly string[]).map((a) => (
          <TouchableOpacity
            key={a}
            style={[styles.chip, selectedActividad === a && styles.chipSelected]}
            onPress={() => {
              setSelectedActividad(a);
              if (a === 'Otra') {
                setActividadState({ ...actividad, descripcion: 'Otra: ' + otraActividadText });
              } else {
                setActividadState({ ...actividad, descripcion: a });
              }
              setIsStepSaved(false);
            }}
          >
            <Text style={[styles.chipText, selectedActividad === a && styles.chipTextSelected]}>
              {a}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Campo "Otra" actividad */}
      {selectedActividad === 'Otra' && (
        <FormField
          label="Especificar actividad"
          value={otraActividadText}
          onChangeText={(t) => {
            setOtraActividadText(t);
            setActividadState({ ...actividad, descripcion: 'Otra: ' + t });
            setIsStepSaved(false);
          }}
          placeholder="Describe la actividad realizada"
          required
        />
      )}

      {/* Descripción detallada de la actividad */}
      <FormField
        label="Descripción de la actividad *"
        value={descripcionDetallada}
        onChangeText={(t) => {
          setDescripcionDetallada(t);
          setActividadState({ ...actividad, descripcion: selectedActividad === 'Otra' ? 'Otra: ' + otraActividadText : selectedActividad });
          setIsStepSaved(false);
        }}
        placeholder="Describe en detalle lo que el técnico realizó en la visita"
        multiline
        numberOfLines={4}
        required
      />

      <FormField
        label="Observaciones"
        value={actividad.observaciones}
        onChangeText={(t) => {
          setActividadState({ ...actividad, observaciones: t });
          setIsStepSaved(false);
        }}
        placeholder="Observaciones de la visita"
        multiline
        numberOfLines={3}
      />

      <FormField
        label="Recomendaciones"
        value={actividad.recomendaciones}
        onChangeText={(t) => {
          setActividadState({ ...actividad, recomendaciones: t });
          setIsStepSaved(false);
        }}
        placeholder="Recomendaciones para el beneficiario"
        multiline
        numberOfLines={3}
      />

      {/* Ubicación actual */}
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
    </View>
  );

  // Renderizar paso 4: Datos Sociodemográficos
  const renderStep4 = () => (
    <View>
      <Text style={styles.evidenciasTitle}>📊 Datos Sociodemográficos</Text>
      <Text style={styles.evidenciasDesc}>
        Información complementaria del beneficiario para caracterización.
      </Text>

      <Text style={styles.fieldLabel}>Género *</Text>
      <View style={styles.veredasContainer}>
        {(['masculino', 'femenino', 'otro'] as const).map((g) => (
          <TouchableOpacity
            key={g}
            style={[styles.veredaChip, socioData.genero === g && styles.veredaChipSelected]}
            onPress={() => {
              setSocioData({ ...socioData, genero: g });
              setIsStepSaved(false);
            }}
          >
            <Text style={[styles.veredaChipText, socioData.genero === g && styles.veredaChipTextSelected]}>
              {socioData.genero === g ? '✓ ' : ''}{g === 'masculino' ? 'Masculino' : g === 'femenino' ? 'Femenino' : 'Otro'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FormField
        label="Nivel de escolaridad"
        value={socioData.escolaridad}
        onChangeText={(t) => {
          setSocioData({ ...socioData, escolaridad: t });
          setIsStepSaved(false);
        }}
        placeholder="Ej: Primaria, Secundaria, Universitario"
        autoCapitalize="sentences"
      />

      <FormField
        label="Etnia (opcional)"
        value={socioData.etnia || ''}
        onChangeText={(t) => {
          setSocioData({ ...socioData, etnia: t });
          setIsStepSaved(false);
        }}
        placeholder="Ej: Mestizo, Indígena, Afrocolombiano"
        autoCapitalize="sentences"
      />

      <FormField
        label="Personas a cargo"
        value={String(socioData.personas_cargo)}
        onChangeText={(t) => {
          setSocioData({ ...socioData, personas_cargo: parseInt(t) || 0 });
          setIsStepSaved(false);
        }}
        placeholder="0"
        keyboardType="numeric"
      />

      <FormField
        label="Hectáreas del predio"
        value={String(socioData.hectareas)}
        onChangeText={(t) => {
          setSocioData({ ...socioData, hectareas: parseFloat(t) || 0 });
          setIsStepSaved(false);
        }}
        placeholder="0"
        keyboardType="decimal-pad"
      />

      {/* Vive en la finca */}
      <Text style={styles.fieldLabel}>¿Vive en la finca?</Text>
      <View style={styles.veredasContainer}>
        <TouchableOpacity
          style={[styles.veredaChip, socioData.vive_en_finca && styles.veredaChipSelected]}
          onPress={() => {
            setSocioData({ ...socioData, vive_en_finca: true });
            setIsStepSaved(false);
          }}
        >
          <Text style={[styles.veredaChipText, socioData.vive_en_finca && styles.veredaChipTextSelected]}>
            {socioData.vive_en_finca ? '✓ ' : ''}Sí
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.veredaChip, !socioData.vive_en_finca && styles.veredaChipSelected]}
          onPress={() => {
            setSocioData({ ...socioData, vive_en_finca: false });
            setIsStepSaved(false);
          }}
        >
          <Text style={[styles.veredaChipText, !socioData.vive_en_finca && styles.veredaChipTextSelected]}>
            {!socioData.vive_en_finca ? '✓ ' : ''}No
          </Text>
        </TouchableOpacity>
      </View>

      {/* Asociado */}
      <Text style={styles.fieldLabel}>¿Está asociado a alguna organización?</Text>
      <View style={styles.veredasContainer}>
        <TouchableOpacity
          style={[styles.veredaChip, socioData.asociado && styles.veredaChipSelected]}
          onPress={() => {
            setSocioData({ ...socioData, asociado: true });
            setIsStepSaved(false);
          }}
        >
          <Text style={[styles.veredaChipText, socioData.asociado && styles.veredaChipTextSelected]}>
            {socioData.asociado ? '✓ ' : ''}Sí
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.veredaChip, !socioData.asociado && styles.veredaChipSelected]}
          onPress={() => {
            setSocioData({ ...socioData, asociado: false });
            setIsStepSaved(false);
          }}
        >
          <Text style={[styles.veredaChipText, !socioData.asociado && styles.veredaChipTextSelected]}>
            {!socioData.asociado ? '✓ ' : ''}No
          </Text>
        </TouchableOpacity>
      </View>

      {socioData.asociado && (
        <FormField
          label="Nombre de la asociación"
          value={socioData.asociacion_nombre || ''}
          onChangeText={(t) => {
            setSocioData({ ...socioData, asociacion_nombre: t });
            setIsStepSaved(false);
          }}
          placeholder="Nombre de la asociación"
          autoCapitalize="words"
        />
      )}

      <FormField
        label="Teléfono de emergencia (opcional)"
        value={socioData.telefono_emergencia || ''}
        onChangeText={(t) => {
          setSocioData({ ...socioData, telefono_emergencia: t });
          setIsStepSaved(false);
        }}
        placeholder="Teléfono de contacto alterno"
        keyboardType="phone-pad"
      />
    </View>
  );

  // Renderizar paso 5: Resumen Completo
  const renderStep5 = () => (
    <View>
      <Text style={styles.resumenTitle}>Resumen del Formulario</Text>

      <View style={styles.resumenSection}>
        <Text style={styles.resumenSectionTitle}>👤 Datos del Técnico</Text>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Nombre:</Text>
          <Text style={styles.resumenValue}>{tecnico.nombre}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Cédula:</Text>
          <Text style={styles.resumenValue}>{tecnico.cedula}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Teléfono:</Text>
          <Text style={styles.resumenValue}>{tecnico.telefono || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Email:</Text>
          <Text style={styles.resumenValue}>{tecnico.email || '—'}</Text>
        </View>
      </View>

      <View style={styles.resumenSection}>
        <Text style={styles.resumenSectionTitle}>👥 Datos del Beneficiario</Text>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Nombre:</Text>
          <Text style={styles.resumenValue}>{beneficiario.nombre}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Cédula:</Text>
          <Text style={styles.resumenValue}>{beneficiario.cedula || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Teléfono:</Text>
          <Text style={styles.resumenValue}>{beneficiario.telefono || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Departamento:</Text>
          <Text style={styles.resumenValue}>{beneficiario.departamento || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Municipio:</Text>
          <Text style={styles.resumenValue}>{beneficiario.municipio || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Vereda:</Text>
          <Text style={styles.resumenValue}>{beneficiario.vereda || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Finca:</Text>
          <Text style={styles.resumenValue}>{beneficiario.finca || '—'}</Text>
        </View>
      </View>

      <View style={styles.resumenSection}>
        <Text style={styles.resumenSectionTitle}>📋 Actividad Realizada</Text>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Tipo:</Text>
          <Text style={styles.resumenValue}>{actividad.descripcion || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Descripción:</Text>
          <Text style={styles.resumenValue}>{descripcionDetallada || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Observaciones:</Text>
          <Text style={styles.resumenValue}>{actividad.observaciones || '—'}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Recomendaciones:</Text>
          <Text style={styles.resumenValue}>{actividad.recomendaciones || '—'}</Text>
        </View>
      </View>

      {coordenadas && (
        <View style={styles.resumenSection}>
          <Text style={styles.resumenSectionTitle}>📍 Ubicación</Text>
          <View style={styles.resumenRow}>
            <Text style={styles.resumenLabel}>Latitud:</Text>
            <Text style={styles.resumenValue}>{coordenadas.latitud.toFixed(6)}</Text>
          </View>
          <View style={styles.resumenRow}>
            <Text style={styles.resumenLabel}>Longitud:</Text>
            <Text style={styles.resumenValue}>{coordenadas.longitud.toFixed(6)}</Text>
          </View>
          {coordenadas.altitud && (
            <View style={styles.resumenRow}>
              <Text style={styles.resumenLabel}>Altitud:</Text>
              <Text style={styles.resumenValue}>{coordenadas.altitud.toFixed(1)} m</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.resumenNextHint}>
        <Text style={styles.resumenNextHintText}>
          ↓ Revisa que todos los datos sean correctos y continúa al paso de evidencias
        </Text>
      </View>
    </View>
  );

  // Renderizar paso 6: Evidencias
  const renderStep6 = () => (
    <View>
      <Text style={styles.evidenciasTitle}>Captura de Evidencias</Text>
      <Text style={styles.evidenciasDesc}>
        Registra las evidencias del formulario. Puedes hacerlo en cualquier orden.
      </Text>

      {/* Botón 1: Evidencia Fotográfica */}
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
            {fotosCount > 0
              ? `${fotosCount} foto(s) capturada(s)`
              : 'Tomar fotos de la visita'}
          </Text>
        </View>
        <View style={styles.evidenciaArrow}>
          <Text style={styles.evidenciaArrowText}>›</Text>
        </View>
      </TouchableOpacity>

      {/* Botón 2: Firma del Beneficiario */}
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
            {firmaBeneficiarioOk
              ? 'Firma registrada ✓'
              : 'Capturar firma del beneficiario'}
          </Text>
        </View>
        <View style={styles.evidenciaArrow}>
          <Text style={styles.evidenciaArrowText}>›</Text>
        </View>
      </TouchableOpacity>

      {/* Botón 3: Firma del Técnico en Terreno */}
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
            {firmaTecnicoOk
              ? 'Firma registrada ✓'
              : 'Capturar firma del técnico'}
          </Text>
        </View>
        <View style={styles.evidenciaArrow}>
          <Text style={styles.evidenciaArrowText}>›</Text>
        </View>
      </TouchableOpacity>

      {/* Botón 4: Huella Biométrica */}
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
            {huellaOk
              ? 'Huella registrada ✓'
              : 'Escanear huella del beneficiario'}
          </Text>
        </View>
        <View style={styles.evidenciaArrow}>
          <Text style={styles.evidenciaArrowText}>›</Text>
        </View>
      </TouchableOpacity>

      {/* Indicador de progreso de evidencias */}
      <Text style={styles.evidenciasProgress}>
        {[fotosCount > 0, firmaBeneficiarioOk, firmaTecnicoOk, huellaOk].filter(Boolean).length}
        {' '}de 4 evidencias completadas
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
    <View style={styles.container}>
      {/* Barra de progreso */}
      <View style={[styles.progressBar, { paddingTop: Math.max(insets.top, SPACING.lg) }]}>
        {Array.from({ length: totalSteps }, (_, i) => (
          <View
            key={i}
            style={[
              styles.progressStep,
              i + 1 <= step && styles.progressStepActive,
              i < totalSteps - 1 && styles.progressStepWithGap,
            ]}
          />
        ))}
      </View>

      <Text style={styles.stepTitle}>
        Paso {step} de {totalSteps}: {getStepTitle()}
      </Text>

      <ScrollView
        style={styles.formContainer}
        contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + SPACING.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && (tipo === 'caracterizacion' ? renderStep4() : renderStep3())}
        {step === 4 && renderStep5()}
        {step === 5 && renderStep6()}
      </ScrollView>

      {/* Botones de navegación */}
      <View style={[styles.buttonContainer, { paddingBottom: insets.bottom + SPACING.md }]}>
        {step > 1 ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={prevStep}>
            <Text style={styles.secondaryButtonText}>Anterior</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.buttonPlaceholder} />
        )}

        {/* Botón Guardar — visible en pasos anteriores a evidencias */}
        {step < totalSteps && (
          <TouchableOpacity
            style={styles.saveButton}
            onPress={saveCurrentStep}
          >
            <Text style={styles.primaryButtonText}>💾 Guardar</Text>
          </TouchableOpacity>
        )}

        {step === totalSteps ? (
          <>
            <TouchableOpacity
              style={[styles.saveButton]}
              onPress={saveCurrentStep}
            >
              <Text style={styles.primaryButtonText}>💾 Guardar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, styles.submitButton, isSubmitting && styles.buttonDisabled]}
              onPress={handleCompletar}
              disabled={isSubmitting}
            >
              <Text style={styles.primaryButtonText}>
                {isSubmitting ? '⏳ Procesando...' : '✓ Completar'}
              </Text>
            </TouchableOpacity>
          </>
        ) : step < totalSteps ? (
          <TouchableOpacity
            style={[styles.primaryButton, !isStepSaved && styles.buttonDisabled]}
            onPress={nextStep}
            disabled={!isStepSaved}
          >
            <Text style={styles.primaryButtonText}>
              {isStepSaved ? 'Siguiente →' : 'Guarda primero'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Overlay de carga al completar */}
      {isSubmitting && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Generando PDF y guardando datos...</Text>
          </View>
        </View>
      )}
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
  progressBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  progressStep: {
    flex: 1,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
  },
  progressStepActive: {
    backgroundColor: COLORS.primary,
  },
  progressStepWithGap: {
    marginRight: SPACING.xs,
  },
  stepTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  formContainer: {
    flex: 1,
  },
  formContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  fieldLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  chipsContainer: {
    flexDirection: 'row',
    marginBottom: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  chipTextSelected: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.medium,
  },
  lockedField: {
    backgroundColor: COLORS.surfaceAlt || COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  lockedFieldText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  veredasContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: SPACING.sm,
    gap: SPACING.xs,
  },
  veredaChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.xs,
  },
  veredaChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  veredaChipText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  veredaChipTextSelected: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.medium,
  },
  locationBox: {
    backgroundColor: COLORS.surfaceAlt,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.md,
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
  resumenTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  resumenSection: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  resumenSectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
  },
  resumenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  resumenLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    flex: 1,
  },
  resumenValue: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
    flex: 2,
    textAlign: 'right',
  },
  // --- Evidencias (Paso 5) ---
  evidenciasTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  evidenciasDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
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
  evidenciaBadgeOk: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.success,
    justifyContent: 'center',
    alignItems: 'center',
  },
  evidenciaBadgeOkText: {
    color: '#FFFFFF',
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
  },
  evidenciaArrow: {
    width: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  evidenciaArrowText: {
    fontSize: 28,
    color: '#b2bec3',
    fontWeight: '300',
  },
  evidenciasProgress: {
    textAlign: 'center',
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    alignSelf: 'center',
  },
  // --- Resumen (Paso 4) ---
  resumenNextHint: {
    backgroundColor: COLORS.primary + '12',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  resumenNextHintText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.medium,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  saveButton: {
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.info,
    ...SHADOWS.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  submitButton: {
    backgroundColor: COLORS.success,
  },
  buttonPlaceholder: {
    flex: 1,
  },
  primaryButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  secondaryButtonText: {
    color: COLORS.textPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
  },
  // Overlay de carga al completar
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
  // --- Botón búsqueda cédula ---
  searchCedulaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.info + '15',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.info + '40',
    marginBottom: SPACING.sm,
  },
  searchCedulaText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.info,
  },
});

export default FormularioScreen;
