// ============================================================
// GEODAILY — Captura de Fotos y Videos con Geotag
// ============================================================
// Recibe route.params.mode: 'photo' | 'video'
// - photo: solo captura de fotos, instrucciones al inicio
// - video: solo grabación de video (máx 30s), instrucciones al inicio
// Cada modo tiene su propia lógica de subida a MinIO y almacenamiento local
// ============================================================

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  Dimensions,
  Pressable,
} from 'react-native';
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { Camera, CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useCamera } from '../../hooks/useCamera';
import { useClimate } from '../../hooks/useClimate';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForm } from '../../store/FormContext';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { formatCoordenadas } from '../../utils/formatters';
import LoadingSpinner from '../../components/LoadingSpinner';
import VideoPlayerModal from '../../components/VideoPlayerModal';
import { eliminarArchivoLocal } from '../../services/mediaStorage.service';
import { FotoGeotag } from '../../types';
import { saveFotoLocal, saveVideoLocal, deleteEvidenciaLocal } from '../../services/database';
import { cabecerasDeArchivo } from '../../services/archivos.service';

type CamaraScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: RouteProp<Record<string, any> & { params: { mode?: 'photo' | 'video'; requisito?: string; formularioId?: string; beneficiarioCedula?: string; beneficiarioNombre?: string; tipoFormulario?: string } }, 'params'>;
};

const CamaraScreen: React.FC<CamaraScreenProps> = ({ navigation, route }) => {
  const mode = route.params?.mode || 'photo';
  const esVideo = mode === 'video';
  // Requisito de evidencias del formulario que abrió la cámara
  // (ej. "5 Fotos (4 Fotos De Realizacion De Actividades + 1 Foto Del Cuaderno De Visita)")
  const requisito = route.params?.requisito;
  /**
   * Modo "evidencia dirigida": cuando el detalle de un formulario YA
   * completado abre la cámara para AGREGAR una foto/video, pasa el id del
   * formulario destino. En ese caso la captura se encola contra ESE
   * formulario (no contra el formulario en curso del FormContext) y NO se
   * toca el contexto activo — así el técnico puede añadir evidencia a una
   * visita pasada sin alterar el borrador que tenga abierto.
   */
  const formularioDestinoId = route.params?.formularioId;
  const esEvidenciaDirigida = !!formularioDestinoId;
  const beneficiarioDestino = esEvidenciaDirigida
    ? { cedula: route.params?.beneficiarioCedula, nombre: route.params?.beneficiarioNombre }
    : undefined;
  const tipoFormularioDestino = route.params?.tipoFormulario;

  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [modoVideo, setModoVideo] = useState(esVideo);
  const [isRecording, setIsRecording] = useState(false);
  const { capturarFoto, removeFoto, fotos, isLoading, setFotos } = useCamera();
  const { addFoto, removeFotoDelFormulario, formularioActual } = useForm();
  const { climaActual, isLoading: climaLoading, error: climaError, fetchClimate } = useClimate();
  const cameraRef = useRef<CameraView>(null);
  const capturandoRef = useRef(false);
  const insets = useSafeAreaInsets();
  const [fotosGuardadas, setFotosGuardadas] = useState<Set<string>>(new Set());
  const [headersArchivo, setHeadersArchivo] = useState<Record<string, string>>({});

  useEffect(() => {
    cabecerasDeArchivo().then(setHeadersArchivo).catch(() => {});
  }, []);

  // Mientras se resuelve el GPS y se registra la evidencia en disco/cola.
  // La cámara YA se cerró cuando esto está activo (se muestra un aviso
  // discreto); el técnico no queda atrapado esperando al GPS.
  const [procesandoEvidencia, setProcesandoEvidencia] = useState(false);

  // ---- Cámara frontal + temporizador (solo fotos) ----
  // El técnico debe aparecer en la foto junto al beneficiario. La cámara
  // frontal permite encuadrar a los dos, pero un “selfie” a pulso no sirve
  // como evidencia: se combina con una cuenta regresiva para que alcancen a
  // acomodarse y la foto salga estable. El video sigue siendo solo trasero.
  const [camaraFrontal, setCamaraFrontal] = useState(false);
  const [temporizador, setTemporizador] = useState(0); // 0 = sin temporizador
  const [cuentaRegresiva, setCuentaRegresiva] = useState<number | null>(null);

  // ---- Modal de instrucciones (se muestra al entrar) ----
  const [showInstrucciones, setShowInstrucciones] = useState(true);

  // ---- Estado para previsualización de foto a pantalla completa ----
  const [fotoPreview, setFotoPreview] = useState<FotoGeotag | null>(null);
  const [videoPreview, setVideoPreview] = useState<FotoGeotag | null>(null);

  // Sincronizar fotos desde FormContext cada vez que la pantalla obtiene foco
  // (para que no se pierdan al ir a otra pantalla y volver). En modo
  // "evidencia dirigida" NO se sincroniza: la cámara trabaja sobre una visita
  // ya completada, no sobre el formulario en curso.
  useFocusEffect(
    useCallback(() => {
      if (esEvidenciaDirigida) return;
      const fotosExistentes = formularioActual?.fotos || [];
      if (fotosExistentes.length > 0) {
        setFotos(fotosExistentes);
        setFotosGuardadas(new Set(fotosExistentes.map(f => f.id)));
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formularioActual?.fotos?.length, esEvidenciaDirigida])
  );

  // Refs para leer el estado más reciente dentro del listener de navegación
  // (evita stale closures — mismo patrón que VisitasJerarquicasScreen)
  const fotosRef = useRef(fotos);
  const fotosGuardadasRef = useRef(fotosGuardadas);
  const formularioActualRef = useRef(formularioActual);
  useEffect(() => { fotosRef.current = fotos; }, [fotos]);
  useEffect(() => { fotosGuardadasRef.current = fotosGuardadas; }, [fotosGuardadas]);
  useEffect(() => { formularioActualRef.current = formularioActual; }, [formularioActual]);

  // Interceptar salida (botón atrás nativo, swipe, etc.) si hay fotos sin guardar —
  // antes se perdían silenciosamente porque solo "Continuar" las guardaba
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      const sinGuardar = fotosRef.current.filter((f) => !fotosGuardadasRef.current.has(f.id));
      if (sinGuardar.length === 0) return; // nada pendiente, dejar salir

      e.preventDefault();
      Alert.alert(
        'Fotos sin guardar',
        `Tienes ${sinGuardar.length} foto(s) sin guardar. ¿Deseas guardarlas antes de salir?`,
        [
          { text: 'Descartar', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
          {
            text: 'Guardar',
            onPress: async () => {
              const ok = await guardarFotosEnContexto();
              if (!ok) {
                // No salir si el guardado falló: sería perder la evidencia
                Alert.alert(
                  'No se pudieron guardar',
                  'Las fotos siguen aquí. Revisa el espacio disponible e inténtalo de nuevo.'
                );
                return;
              }
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // Obtener la última coordenada disponible para el clima
  const ultimaCoordenada = useMemo(() => {
    if (fotos.length === 0) return null;
    const ultima = fotos[fotos.length - 1];
    if (ultima.coordenadas.latitud !== 0 || ultima.coordenadas.longitud !== 0) {
      return ultima.coordenadas;
    }
    return null;
  }, [fotos]);

  // Solicitar clima cuando se tiene una coordenada
  useEffect(() => {
    if (ultimaCoordenada && !climaActual && !climaLoading && !climaError) {
      fetchClimate(ultimaCoordenada.latitud, ultimaCoordenada.longitud);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimaCoordenada?.latitud, ultimaCoordenada?.longitud]);

  const [ubicacionesFotos, setUbicacionesFotos] = useState<Record<string, { municipio: string; departamento: string; pais: string }>>({});

  // Resolver nombre de ubicación desde coordenadas GPS (reverse geocode)
  const resolverUbicacion = async (fotoId: string, lat: number, lon: number) => {
    try {
      const geocode = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (geocode && geocode.length > 0) {
        const addr = geocode[0];
        setUbicacionesFotos((prev) => ({
          ...prev,
          [fotoId]: {
            municipio: addr.city || addr.subregion || addr.district || '—',
            departamento: addr.region || '—',
            pais: addr.country || '—',
          },
        }));
      }
    } catch (e) {
      console.warn('[Camara] Error al resolver ubicación:', e);
    }
  };

  const headingCompass = (degrees?: number): string => {
    if (degrees === undefined || degrees === null) return '—';
    const direcciones = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    return `${direcciones[Math.round(degrees / 45) % 8]} (${Math.round(degrees)}°)`;
  };

  const renderClimaCard = () => {
    if (climaLoading) {
      return (
        <View style={styles.climaCard}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.climaLoadingText}>Obteniendo datos climáticos...</Text>
        </View>
      );
    }
    if (climaError) {
      // El clima es best-effort: si no se pudo obtener (sin señal o servidor
      // sin salida a internet) se muestra un aviso neutro, NUNCA el mensaje
      // crudo del backend (p. ej. "HTTP status code 502"). La evidencia y sus
      // coordenadas ya quedaron guardadas correctamente.
      return (
        <View style={styles.climaCard}>
          <Text style={styles.climaErrorIcon}>ℹ️</Text>
          <View style={styles.climaErrorContent}>
            <Text style={styles.climaErrorTitle}>Clima no disponible</Text>
            <Text style={styles.climaErrorText}>
              Se completará automáticamente al recuperar conexión.
            </Text>
          </View>
        </View>
      );
    }
    if (!climaActual) return null;

    return (
      <View style={styles.climaCard}>
        <View style={styles.climaHeader}>
          <Text style={styles.climaTitle}>🌤 Condiciones Ambientales</Text>
          <Text style={styles.climaUbicacion}>{climaActual.ubicacion.nombre}</Text>
        </View>
        <View style={styles.climaGrid}>
          <View style={styles.climaItem}>
            <Text style={styles.climaItemIcon}>🌡</Text>
            <Text style={styles.climaItemValue}>{Math.round(climaActual.temperatura.actual)}°</Text>
            <Text style={styles.climaItemLabel}>Temp.</Text>
          </View>
          <View style={styles.climaItem}>
            <Text style={styles.climaItemIcon}>💧</Text>
            <Text style={styles.climaItemValue}>{climaActual.humedad}%</Text>
            <Text style={styles.climaItemLabel}>Humedad</Text>
          </View>
          <View style={styles.climaItem}>
            <Text style={styles.climaItemIcon}>🌬</Text>
            <Text style={styles.climaItemValue}>{Math.round(climaActual.viento.velocidad)}</Text>
            <Text style={styles.climaItemLabel}>Viento m/s</Text>
          </View>
          <View style={styles.climaItem}>
            <Text style={styles.climaItemIcon}>☁️</Text>
            <Text style={styles.climaItemValue}>{climaActual.nubosidad}%</Text>
            <Text style={styles.climaItemLabel}>Nubosidad</Text>
          </View>
        </View>
        <View style={styles.climaExtra}>
          <Text style={styles.climaExtraText}>
            Presión: {climaActual.presion} hPa | Visibilidad: {climaActual.visibilidad} km | 
            Sensación térmica: {Math.round(climaActual.temperatura.sensacion_termica)}°
          </Text>
        </View>
      </View>
    );
  };

  const handleOpenCamera = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Permiso denegado', 'No se puede acceder a la cámara sin permiso');
        return;
      }
    }
    setShowInstrucciones(false);
    setShowCamera(true);
  };

  // Persistir la evidencia apenas se captura, no cuando el técnico presiona
  // "Guardar" (eso quedaba para más tarde). Antes, una foto recién tomada
  // solo vivía en memoria (React) hasta que se guardaba el formulario o
  // pasaban hasta 60 segundos del autoguardado — si la app se cerraba de
  // golpe (batería, Android matando el proceso en segundo plano) en el
  // medio, el archivo sobrevivía en disco (persistirEvidencia ya lo pone a
  // salvo) pero quedaba huérfano: nada volvía a saber que existía, y
  // parecía que la foto "se había borrado sola". Ahora queda anotada en el
  // formulario en curso y en la cola de sincronización al instante.
  const guardarEvidenciaInmediata = async (foto: FotoGeotag): Promise<boolean> => {
    // En modo "evidencia dirigida" NO se toca el formulario en curso: la
    // captura pertenece a una visita ya completada, así que solo se encola
    // contra ese formulario destino.
    if (!esEvidenciaDirigida) {
      addFoto(foto);
    }
    // Se encola SIEMPRE, aunque todavía no exista un formulario en curso.
    // Antes, sin `formularioActual.id` (app recién abierta, sesión aún
    // restaurándose, cámara abierta antes de iniciar el formulario) la foto
    // quedaba solo en memoria: el archivo sobrevivía en disco pero nadie
    // volvía a saber de él, y el técnico lo vivía como "se borraron las
    // fotos". Con `formulario_id = ''` entra al barrido de evidencias
    // huérfanas (ver getEvidenciasPendientes) y, al completar el formulario,
    // handleCompletar reescribe `formulario_id` con el id real.
    const formId = esEvidenciaDirigida
      ? formularioDestinoId!
      : (formularioActualRef.current?.id || '');
    const formActual = formularioActualRef.current;
    const beneficiarioActual = esEvidenciaDirigida
      ? beneficiarioDestino
      : formActual
      ? { cedula: formActual.beneficiario?.cedula, nombre: formActual.beneficiario?.nombre }
      : undefined;
    const tipoFormularioActual = esEvidenciaDirigida ? tipoFormularioDestino : formActual?.tipo;
    try {
      if (foto.tipo === 'video') {
        await saveVideoLocal(foto.id, formId, foto.uri, foto.coordenadas, beneficiarioActual, tipoFormularioActual);
      } else {
        await saveFotoLocal(foto.id, formId, foto.uri, foto.coordenadas, beneficiarioActual, tipoFormularioActual);
      }
    } catch (queueErr) {
      console.warn('[Camara] No se pudo encolar para sync de inmediato:', foto.id, queueErr);
      return false;
    }
    // Ya quedó a salvo — que no la cuente como "sin guardar" al salir.
    setFotosGuardadas((prev) => new Set(prev).add(foto.id));
    return true;
  };

  /**
   * Geotag + registro de una captura ya hecha.
   *
   * La cámara se cierra ANTES de llamar aquí: resolver el GPS (y su fallback)
   * puede tardar hasta ~12 s sin cielo abierto, y tener la cámara congelada
   * ese rato era justo el reporte "aparecía capturando y duraba minutos".
   * Si el GPS no llega, la evidencia se guarda igual y se reintenta el
   * geotag al encolarla con la última posición conocida.
   */
  const procesarCapturaEnSegundoPlano = async (uri: string, esVideoCaptura: boolean) => {
    setProcesandoEvidencia(true);
    try {
      const nuevaFoto = await capturarFoto(uri, undefined, esVideoCaptura);
      if (!nuevaFoto) {
        Alert.alert(
          'Evidencia no registrada',
          'La foto se tomó pero no se pudo guardar. Vuelve a intentarlo; si persiste, reinicia la aplicación.'
        );
        return;
      }
      nuevaFoto.tipo = esVideoCaptura ? 'video' : 'foto';
      const encolada = await guardarEvidenciaInmediata(nuevaFoto);
      if (!encolada) {
        Alert.alert(
          'Evidencia sin respaldo local',
          'La captura sigue visible en este formulario, pero no se pudo registrar para sincronización. Mantén la pantalla abierta e inténtalo de nuevo antes de salir.'
        );
      }
      // El nombre del lugar es cosmético: si falla o no hay red, no importa.
      if (!nuevaFoto.metadata?.sinUbicacion) {
        resolverUbicacion(
          nuevaFoto.id,
          nuevaFoto.coordenadas.latitud,
          nuevaFoto.coordenadas.longitud
        );
      }
    } catch (err) {
      console.error('[Camara] Error registrando la evidencia:', err);
      Alert.alert('Evidencia no registrada', 'Ocurrió un error al guardar la evidencia.');
    } finally {
      setProcesandoEvidencia(false);
    }
  };

  // ---- Temporizador (cuenta regresiva) ----
  // El intervalo se guarda en un ref y se limpia explícitamente: si el técnico
  // cierra la cámara a mitad de la cuenta, no debe quedar un disparo fantasma
  // corriendo contra una cámara ya desmontada.
  const cuentaRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cancelarTemporizador = useCallback(() => {
    if (cuentaRef.current) {
      clearInterval(cuentaRef.current);
      cuentaRef.current = null;
    }
    setCuentaRegresiva(null);
    capturandoRef.current = false;
  }, []);

  // Cerrar la cámara siempre cancela la cuenta: si quedara corriendo, el
  // disparo llegaría con la cámara ya desmontada (captura fantasma).
  const cerrarCamara = useCallback(() => {
    cancelarTemporizador();
    setShowCamera(false);
  }, [cancelarTemporizador]);

  // Limpieza al desmontar y al cerrar la vista de cámara
  useEffect(() => cancelarTemporizador, [cancelarTemporizador]);
  useEffect(() => {
    if (!showCamera) cancelarTemporizador();
  }, [showCamera, cancelarTemporizador]);

  const dispararFoto = async () => {
    // Bloqueo síncrono contra doble-toque: `takePictureAsync` tarda varios
    // cientos de ms y el botón no se deshabilitaba mientras tanto, así que
    // un segundo toque (común en campo, con guantes o pantallas resistentes)
    // alcanzaba a disparar una segunda captura casi idéntica antes de que
    // `setShowCamera(false)` cerrara la cámara.
    if (!cameraRef.current || capturandoRef.current) return;
    capturandoRef.current = true;

    let uri: string | undefined;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        exif: true,
      });
      uri = photo?.uri;
    } catch (error) {
      Alert.alert('Error', 'No se pudo tomar la foto');
    } finally {
      capturandoRef.current = false;
      // La cámara se cierra SIEMPRE, con foto o sin ella. Antes solo se
      // cerraba dentro del `try` (tras el geotag) y de un `catch`: si el
      // geotag se quedaba colgado —GPS sin señal, que es lo normal en
      // vereda— el `await` nunca terminaba y la vista de cámara quedaba
      // congelada, sin forma de continuar hasta cerrar la app.
      setShowCamera(false);
    }

    if (!uri) return;

    // Ya no hay cámara en pantalla: el geotag y el registro corren aparte.
    await procesarCapturaEnSegundoPlano(uri, false);
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current || capturandoRef.current) return;

    // Con temporizador: primero la cuenta regresiva (el técnico se acomoda
    // junto al beneficiario) y al llegar a 0 se dispara la captura normal —
    // mismo geotag y mismo flujo de guardado que sin temporizador.
    if (temporizador > 0) {
      capturandoRef.current = true;
      setCuentaRegresiva(temporizador);
      let restante = temporizador;
      cuentaRef.current = setInterval(() => {
        restante -= 1;
        if (restante <= 0) {
          if (cuentaRef.current) {
            clearInterval(cuentaRef.current);
            cuentaRef.current = null;
          }
          setCuentaRegresiva(null);
          capturandoRef.current = false;
          dispararFoto();
        } else {
          setCuentaRegresiva(restante);
        }
      }, 1000);
      return;
    }

    await dispararFoto();
  };

  // IMPORTANTE: lee SIEMPRE de las refs, nunca del estado.
  // El listener de 'beforeRemove' se registra una sola vez (deps [navigation])
  // y captura la versión de esta función del PRIMER render. Si leyera el estado,
  // vería `fotos = []`, saldría por "nada que guardar" y el técnico perdería
  // todas las fotos justo al pulsar "Guardar" al salir.
  const guardarFotosEnContexto = async (): Promise<boolean> => {
    const fotosActuales = fotosRef.current;
    const guardadasActuales = fotosGuardadasRef.current;
    const sinGuardar = fotosActuales.filter((f) => !guardadasActuales.has(f.id));
    if (sinGuardar.length === 0) return true;
    try {
      const formId = esEvidenciaDirigida
        ? formularioDestinoId
        : formularioActualRef.current?.id;
      if (!formId && !esEvidenciaDirigida) {
        console.warn(
          '[Camara] Sin formulario en curso: las evidencias quedan en memoria y se encolarán al completar el formulario'
        );
      }
      const formActual = formularioActualRef.current;
      const beneficiarioActual = esEvidenciaDirigida
        ? beneficiarioDestino
        : formActual
        ? { cedula: formActual.beneficiario?.cedula, nombre: formActual.beneficiario?.nombre }
        : undefined;
      const tipoFormularioActual = esEvidenciaDirigida ? tipoFormularioDestino : formActual?.tipo;
      for (const foto of sinGuardar) {
        // En modo dirigido la evidencia pertenece a otra visita: no se añade
        // al formulario en curso.
        if (!esEvidenciaDirigida) {
          addFoto(foto);
        }
        if (foto.tipo === 'video') {
          await saveVideoLocal(foto.id, formId || '', foto.uri, foto.coordenadas, beneficiarioActual, tipoFormularioActual);
          console.log('[Camara] Video encolado para sync:', foto.id);
        } else {
          await saveFotoLocal(foto.id, formId || '', foto.uri, foto.coordenadas, beneficiarioActual, tipoFormularioActual);
        }
      }
      setFotosGuardadas(new Set(fotosActuales.map((f) => f.id)));
      return true;
    } catch (err) {
      console.error('[Camara] Error al guardar fotos/videos:', err);
      return false;
    }
  };

  const handleGuardarFotos = async () => {
    const ok = await guardarFotosEnContexto();
    if (ok) {
      Alert.alert('✅ Guardadas', 'Fotos guardadas correctamente.');
    } else {
      Alert.alert('Error', 'No se pudieron guardar las fotos.');
    }
  };

  const handleDeleteFoto = (foto: FotoGeotag) => {
    Alert.alert('Eliminar foto', '¿Estás seguro de eliminar esta foto?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', onPress: async () => {
        // Borrado COMPLETO. Antes solo se quitaba del estado de la pantalla:
        // la foto seguía en el formulario, se subía a MinIO, salía en el PDF
        // y reaparecía al reenfocar la cámara.
        removeFoto(foto.id);                 // estado local del hook
        if (!esEvidenciaDirigida) {
          removeFotoDelFormulario(foto.id);  // formulario en curso (contexto)
        }
        await deleteEvidenciaLocal(foto.id); // cola de sincronización
        await eliminarArchivoLocal(foto.uri); // archivo en disco
        setFotosGuardadas((prev) => {
          const next = new Set(prev);
          next.delete(foto.id);
          return next;
        });
      }, style: 'destructive' },
    ]);
  };

  const handleContinue = async () => {
    const sinGuardar = fotos.filter((f) => !fotosGuardadas.has(f.id));
    if (sinGuardar.length > 0) {
      Alert.alert(
        'Fotos sin guardar',
        `Tienes ${sinGuardar.length} foto(s) sin guardar. ¿Deseas guardarlas antes de continuar?`,
        [
          { text: 'Descartar', style: 'destructive', onPress: () => navigation.goBack() },
          { text: 'Guardar', onPress: async () => {
            const ok = await guardarFotosEnContexto();
            if (ok) {
              navigation.goBack();
            } else {
              Alert.alert('No se pudieron asegurar', 'Las evidencias siguen en pantalla. Revisa el almacenamiento del dispositivo e inténtalo de nuevo.');
            }
          }},
        ]
      );
      return;
    }
    // Ya todo está guardado
    navigation.goBack();
  };

  if (!permission) {
    return <LoadingSpinner message="Solicitando permisos..." fullScreen />;
  }

  const handleRecordVideo = async () => {
    if (!cameraRef.current) return;

    if (isRecording) {
      // === DETENER GRABACIÓN ===
      try {
        // stopRecording() resuelve el promise de recordAsync()
        // y el video se procesa en el bloque "else" automáticamente
        await cameraRef.current.stopRecording();
      } catch (error) {
        console.error('[Camara] Error al detener grabación:', error);
        // Si falla, aseguramos limpiar el estado
        setIsRecording(false);
        setShowCamera(false);
      }
    } else {
      // === INICIAR GRABACIÓN ===
      try {
        // 1. Solicitar permiso de micrófono (obligatorio en Android para video)
        const micStatus = await Camera.requestMicrophonePermissionsAsync();
        if (!micStatus.granted) {
          Alert.alert(
            'Permiso de micrófono requerido',
            'Para grabar video necesitamos acceso al micrófono. Puedes habilitarlo en Ajustes del dispositivo.'
          );
          return;
        }

        // 2. Pequeño delay para que la cámara cambie a modo video
        await new Promise(resolve => setTimeout(resolve, 200));

        setIsRecording(true);

        // 3. Iniciar grabación — se bloquea hasta que se detenga
        const video = await cameraRef.current.recordAsync({ maxDuration: 30 });

        // 4. Grabación finalizada (por stopRecording o por maxDuration)
        if (video?.uri) {
          // La cámara se cierra ANTES del geotag, igual que en las fotos: el
          // video ya está en disco y el técnico no debe esperar al GPS.
          setIsRecording(false);
          setShowCamera(false);
          // esVideo=true → se persiste con extensión .mp4
          await procesarCapturaEnSegundoPlano(video.uri, true);
          return;
        }
        console.warn('[Camara] La grabación no devolvió URI');
      } catch (error) {
        console.error('[Camara] Error en grabación de video:', error);
      }
      setIsRecording(false);
      setShowCamera(false);
    }
  };

  // Solo las fotos pueden usar la cámara frontal; el video sigue con la trasera.
  const facing: 'back' | 'front' = !modoVideo && camaraFrontal ? 'front' : 'back';

  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing={facing} mode={modoVideo ? 'video' : 'picture'}>
          <View style={[styles.cameraOverlay, { paddingTop: Math.max(insets.top, SPACING.xxl) }]}>
            <View style={styles.cameraTopRow}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={cerrarCamara}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
              {/* Indicador del modo actual (fijo) */}
              <View style={[styles.modeToggle, modoVideo && styles.modeToggleActive]}>
                <Text style={styles.modeToggleText}>
                  {modoVideo ? '🎥 Video' : '📷 Foto'}
                </Text>
              </View>
              {!modoVideo && (
                <TouchableOpacity
                  style={styles.flipButton}
                  onPress={() => setCamaraFrontal((prev) => !prev)}
                >
                  <Text style={styles.flipButtonText}>🔄</Text>
                  <Text style={styles.flipButtonLabel}>
                    {camaraFrontal ? 'Frontal' : 'Trasera'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {isRecording && (
              <View style={styles.recordingBadge}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>GRABANDO</Text>
              </View>
            )}
            {modoVideo && (
              <View style={styles.maxDurationBadge}>
                <Text style={styles.maxDurationText}>⏱ Máx 30s</Text>
              </View>
            )}
          </View>

          {/* Cuenta regresiva: banda central para no tapar el botón de cierre
              (arriba) ni el de captura/cancelar (abajo) */}
          {cuentaRegresiva !== null && (
            <View style={styles.countdownOverlay}>
              <Text style={styles.countdownNumber}>{cuentaRegresiva}</Text>
              <Text style={styles.countdownHint}>
                Acomódate junto al beneficiario…
              </Text>
              <Text style={styles.countdownCancelHint}>
                Toca el botón para cancelar
              </Text>
            </View>
          )}

          {!modoVideo && cuentaRegresiva === null && (
            <View style={styles.timerRow}>
              {[0, 5, 10].map((seg) => (
                <TouchableOpacity
                  key={seg}
                  style={[styles.timerChip, temporizador === seg && styles.timerChipActive]}
                  onPress={() => setTemporizador(seg)}
                >
                  <Text style={styles.timerChipText}>
                    {seg === 0 ? 'Sin temporizador' : `${seg}s`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.cameraBottom}>
            {modoVideo ? (
              <TouchableOpacity
                style={[styles.recordButton, isRecording && styles.recordButtonActive]}
                onPress={handleRecordVideo}
              >
                <View style={[styles.recordInner, isRecording && styles.recordInnerActive]} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.captureButton, cuentaRegresiva !== null && styles.captureButtonCounting]}
                onPress={cuentaRegresiva !== null ? cancelarTemporizador : handleTakePhoto}
              >
                {cuentaRegresiva !== null ? (
                  <Text style={styles.captureCancelText}>✕</Text>
                ) : (
                  <View style={styles.captureInner} />
                )}
              </TouchableOpacity>
            )}
          </View>
        </CameraView>
      </View>
    );
  }

  const todasGuardadas = fotos.length > 0 && fotos.every((f) => fotosGuardadas.has(f.id));
  const pendientes = fotos.length - fotosGuardadas.size;

  const titulo = esVideo ? 'Grabar Video' : 'Evidencia Fotográfica';
  const subtitulo = esVideo
    ? 'Graba un video corto (máx. 30 segundos) como evidencia. Se georreferenciará automáticamente y se subirá a la nube.'
    : 'Las fotos se georreferenciarán automáticamente. Los datos climáticos se obtienen desde tu ubicación actual.';
  const iconoBoton = esVideo ? '🎥' : '📷';
  const textoBoton = esVideo ? 'Abrir Cámara de Video' : 'Abrir Cámara';

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, SPACING.xxl), paddingBottom: insets.bottom + SPACING.lg }]}>
      {/*
       * ─── MODAL DE INSTRUCCIONES ───
       * Se muestra al entrar a la pantalla, antes de abrir la cámara
       */}
      <Modal
        visible={showInstrucciones}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInstrucciones(false)}
      >
        <View style={styles.instModalOverlay}>
          <View style={styles.instModal}>
            <Text style={styles.instTitle}>
              {esVideo ? '🎥 Instrucciones para grabar video' : '📷 Instrucciones para tomar fotos'}
            </Text>
            <Text style={styles.instSubtitle}>
              {esVideo
                ? 'Sigue estas recomendaciones para obtener un buen video:'
                : 'Sigue estas recomendaciones para obtener buenas fotos:'}
            </Text>

            {!esVideo && requisito && (
              <View style={styles.requisitoBanner}>
                <Text style={styles.requisitoTexto}>📌 Requisito: {requisito}</Text>
              </View>
            )}

            {esVideo ? (
              <>
                <View style={styles.instItem}>
                  <Text style={styles.instNum}>1</Text>
                  <Text style={styles.instText}>Asegúrate de tener buena iluminación y enfocar correctamente la escena.</Text>
                </View>
                <View style={styles.instItem}>
                  <Text style={styles.instNum}>2</Text>
                  <Text style={styles.instText}>Sostén el dispositivo firme o apóyalo para evitar movimientos bruscos.</Text>
                </View>
                <View style={styles.instItem}>
                  <Text style={styles.instNum}>3</Text>
                  <Text style={styles.instText}>El video durará máximo 30 segundos — captura lo esencial.</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.instItem}>
                  <Text style={styles.instNum}>1</Text>
                  <Text style={styles.instText}>Asegúrate de tener buena iluminación y que el objeto esté bien enfocado.</Text>
                </View>
                <View style={styles.instItem}>
                  <Text style={styles.instNum}>2</Text>
                  <Text style={styles.instText}>Sostén el dispositivo firme para evitar fotos borrosas.</Text>
                </View>
                <View style={styles.instItem}>
                  <Text style={styles.instNum}>3</Text>
                  <Text style={styles.instText}>Toma fotos desde diferentes ángulos para cubrir toda el área.</Text>
                </View>
                <View style={styles.instItem}>
                  <Text style={styles.instNum}>4</Text>
                  <Text style={styles.instText}>
                    Si debes aparecer con el beneficiario, usa el botón 🔄 para cambiar a la cámara frontal
                    y activa el temporizador de 5s o 10s: así alcanzas a acomodarte y la foto sale enfocada
                    (no es una selfie a pulso).
                  </Text>
                </View>
              </>
            )}

            <TouchableOpacity style={styles.instBoton} onPress={handleOpenCamera}>
              <Text style={styles.instBotonText}>
                {esVideo ? '🎥 Empezar a grabar' : '📷 Abrir cámara'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Aviso mientras se georreferencia y guarda la captura. La cámara ya
          está cerrada: es informativo, no bloquea nada. */}
      {procesandoEvidencia && (
        <View style={styles.procesandoBanner}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.procesandoBannerText}>Guardando evidencia…</Text>
        </View>
      )}

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
      >
        <Text style={styles.title}>{titulo}</Text>
        <Text style={styles.subtitle}>{subtitulo}</Text>

        {!esVideo && renderClimaCard()}

        <TouchableOpacity
          style={[styles.openCameraButton, esVideo && styles.openCameraButtonVideo]}
          onPress={handleOpenCamera}
          disabled={isLoading}
        >
          <Text style={styles.cameraIcon}>{iconoBoton}</Text>
          <Text style={styles.openCameraText}>
            {isLoading ? 'Capturando...' : textoBoton}
          </Text>
        </TouchableOpacity>

        {fotos.length > 0 && (
          <View style={styles.fotosSection}>
            <View style={styles.fotosHeader}>
              <Text style={styles.fotosCount}>
                {fotos.length} foto(s) capturada(s)
              </Text>
              {todasGuardadas && (
                <Text style={styles.fotosSavedBadge}>✓ Guardadas</Text>
              )}
            </View>
            <View style={styles.fotosGrid}>
              {fotos.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.fotoCard}
                  onPress={() =>
                    item.tipo === 'video'
                      ? setVideoPreview(item)
                      : setFotoPreview(item)
                  }
                  onLongPress={() => handleDeleteFoto(item)}
                  activeOpacity={0.8}
                >
                  {item.tipo === 'video' ? (
                    <View style={styles.videoPreview}>
                      <Text style={styles.videoPlayIcon}>▶️</Text>
                      <Text style={styles.videoLabel}>VIDEO</Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: item.uri, ...(item.uri.startsWith('http') ? { headers: headersArchivo } : {}) }}
                      style={styles.fotoPreview}
                      resizeMode="cover"
                    />
                  )}
                  <View style={styles.fotoInfo}>
                    {item.tipo === 'video' && (
                      <Text style={styles.fotoVideoTag}>🎥 Video</Text>
                    )}
                    {item.metadata?.sinUbicacion ? (
                      <Text style={styles.fotoSinUbicacion}>
                        ⚠️ Sin ubicación GPS
                      </Text>
                    ) : ubicacionesFotos[item.id] ? (
                      <>
                        <Text style={styles.fotoUbicacionNombre}>
                          {ubicacionesFotos[item.id].municipio}
                        </Text>
                        <Text style={styles.fotoUbicacionDetalle}>
                          {ubicacionesFotos[item.id].departamento}, {ubicacionesFotos[item.id].pais}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.fotoCoords}>
                        Obteniendo ubicación...
                      </Text>
                    )}
                    <Text style={styles.fotoHeading}>
                      {headingCompass(item.coordenadas.heading)}
                    </Text>
                    {fotosGuardadas.has(item.id) && (
                      <Text style={styles.fotoGuardadaLabel}>✓</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fotoTapHint}>👆 Toca una foto para verla en grande | Mantén presionado para eliminar</Text>
          </View>
        )}

        {/* Botón Guardar fotos en FormContext */}
        {fotos.length > 0 && pendientes > 0 && (
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleGuardarFotos}
          >
            <Text style={styles.saveButtonText}>
              💾 Guardar {pendientes} foto(s) en el formulario
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.continueButton, todasGuardadas && styles.continueButtonOk]}
          onPress={handleContinue}
        >
          <Text style={[styles.continueButtonText, todasGuardadas && styles.continueButtonTextOk]}>
            {todasGuardadas ? '✓ Continuar' : 'Continuar'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ---- Modal de previsualización de foto a pantalla completa ---- */}
      <Modal
        visible={!!fotoPreview}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFotoPreview(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setFotoPreview(null)}>
          {fotoPreview && (
            <Pressable style={styles.modalContent} onPress={() => {}}>
              <Image
                source={{ uri: fotoPreview.uri, ...(fotoPreview.uri.startsWith('http') ? { headers: headersArchivo } : {}) }}
                style={styles.modalImage}
                resizeMode="contain"
              />
              <View style={styles.modalInfo}>
                <Text style={styles.modalTitle}>📸 Foto</Text>
                {ubicacionesFotos[fotoPreview.id] && (
                  <Text style={styles.modalText}>
                    📍 {ubicacionesFotos[fotoPreview.id].municipio}, {ubicacionesFotos[fotoPreview.id].departamento}
                  </Text>
                )}
                <Text style={styles.modalText}>
                  🧭 {headingCompass(fotoPreview.coordenadas.heading)}
                </Text>
                <Text style={styles.modalText}>
                  📅 {new Date(fotoPreview.timestamp).toLocaleString('es-CO')}
                </Text>
                <Text style={styles.modalCoords}>
                  {formatCoordenadas(fotoPreview.coordenadas.latitud, fotoPreview.coordenadas.longitud, 6)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setFotoPreview(null)}
              >
                <Text style={styles.modalCloseText}>✕ Cerrar</Text>
              </TouchableOpacity>
            </Pressable>
          )}
        </Pressable>
      </Modal>

      {/* ---- Reproductor de video a pantalla completa ---- */}
      <VideoPlayerModal
        uri={videoPreview?.uri ?? null}
        headers={headersArchivo}
        visible={!!videoPreview}
        onClose={() => setVideoPreview(null)}
        subtitulo={
          videoPreview
            ? `📅 ${new Date(videoPreview.timestamp).toLocaleString('es-CO')}  ·  📍 ${formatCoordenadas(
                videoPreview.coordenadas.latitud,
                videoPreview.coordenadas.longitud,
                6
              )}`
            : undefined
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.lg,
  },
  // Aviso flotante mientras se georreferencia/registra la captura ya tomada.
  procesandoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  procesandoBannerText: {
    color: '#fff',
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    paddingTop: SPACING.xxl,
    paddingHorizontal: SPACING.md,
  },
  cameraTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modeToggle: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modeToggleActive: {
    backgroundColor: COLORS.primary,
  },
  modeToggleText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: FONTS.weights.bold,
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: SPACING.md,
    backgroundColor: 'rgba(255,0,0,0.7)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.lg,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff0000',
    marginRight: SPACING.sm,
  },
  recordingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: FONTS.weights.bold,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: FONTS.weights.bold,
  },
  flipButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButtonText: {
    color: '#fff',
    fontSize: 20,
  },
  flipButtonLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: FONTS.weights.bold,
    marginTop: 1,
  },
  timerRow: {
    position: 'absolute',
    bottom: 140,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.xs,
  },
  timerChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginHorizontal: 3,
  },
  timerChipActive: {
    backgroundColor: COLORS.primary,
  },
  timerChipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: FONTS.weights.bold,
  },
  countdownOverlay: {
    position: 'absolute',
    top: 160,
    bottom: 220,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownNumber: {
    color: '#fff',
    fontSize: 140,
    fontWeight: FONTS.weights.bold,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  countdownHint: {
    color: '#fff',
    fontSize: 16,
    fontWeight: FONTS.weights.bold,
    marginTop: SPACING.sm,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  countdownCancelHint: {
    color: '#fff',
    fontSize: 12,
    marginTop: SPACING.xs,
    textAlign: 'center',
    opacity: 0.85,
  },
  cameraBottom: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  captureButtonCounting: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderColor: COLORS.primary,
  },
  captureCancelText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: FONTS.weights.bold,
  },
  captureInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  recordButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#ff0000',
  },
  recordButtonActive: {
    backgroundColor: 'rgba(255,0,0,0.6)',
  },
  recordInner: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#ff0000',
  },
  recordInnerActive: {
    borderRadius: 12,
    width: 20,
    height: 20,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  openCameraButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.lg,
    ...SHADOWS.md,
  },
  cameraIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  openCameraText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxl,
  },
  fotosSection: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  fotosHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  fotosCount: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
  },
  fotosSavedBadge: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.success,
    backgroundColor: COLORS.success + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  fotosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  fotoTapHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },
  fotoCard: {
    width: '48%',
    marginBottom: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    ...SHADOWS.sm,
  },
  fotoPreview: {
    width: '100%',
    height: 150,
    backgroundColor: COLORS.surfaceAlt,
  },
  fotoInfo: {
    backgroundColor: COLORS.overlay,
    padding: SPACING.xs,
  },
  videoPreview: {
    width: '100%',
    height: 150,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayIcon: {
    fontSize: 40,
  },
  videoLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: FONTS.weights.bold,
    marginTop: 4,
  },
  fotoVideoTag: {
    fontSize: 10,
    color: '#ff6b6b',
    fontWeight: FONTS.weights.bold,
  },
  fotoCoords: {
    fontSize: 10,
    color: '#fff',
    fontFamily: 'monospace',
  },
  fotoSinUbicacion: {
    fontSize: 11,
    color: COLORS.warning,
    fontWeight: FONTS.weights.bold,
  },
  fotoUbicacionNombre: {
    fontSize: 12,
    fontWeight: FONTS.weights.bold,
    color: '#fff',
  },
  fotoUbicacionDetalle: {
    fontSize: 10,
    color: '#cceeff',
    marginTop: 1,
  },
  fotoGuardadaLabel: {
    fontSize: 14,
    color: COLORS.success,
    fontWeight: 'bold',
    position: 'absolute',
    top: 4,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  saveButton: {
    backgroundColor: COLORS.info,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    ...SHADOWS.sm,
  },
  saveButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  continueButton: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: SPACING.md,
  },
  continueButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  continueButtonOk: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  continueButtonTextOk: {
    color: COLORS.textOnPrimary,
  },
  // ---- Panel de clima / ambiente ----
  climaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.info,
    ...SHADOWS.sm,
  },
  climaErrorIcon: {
    fontSize: 20,
    marginRight: SPACING.sm,
  },
  climaErrorContent: {
    flex: 1,
  },
  climaErrorTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.warning,
  },
  climaErrorText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  climaLoadingText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginLeft: SPACING.sm,
  },
  climaHeader: {
    marginBottom: SPACING.sm,
  },
  climaTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  climaUbicacion: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  climaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  climaItem: {
    alignItems: 'center',
    flex: 1,
  },
  climaItemIcon: {
    fontSize: 18,
  },
  climaItemValue: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  climaItemLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  climaExtra: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  climaExtraText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  // ---- Heading (brújula) ----
  fotoHeading: {
    fontSize: 9,
    color: '#cceeff',
    fontFamily: 'monospace',
    marginTop: 1,
  },
  // ---- Gestión Documental ----
  docSection: {
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
  },
  docHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  docTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  docCount: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  subirDocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
  },
  subirDocBtnText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  docList: {
    gap: SPACING.xs,
  },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
  },
  docIcon: {
    fontSize: 20,
    marginRight: SPACING.sm,
  },
  docInfo: {
    flex: 1,
  },
  docNombre: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  docFecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  docSynced: {
    fontSize: 16,
  },
  docsSavedText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.success,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: SPACING.xs,
  },
  // ---- Modal de previsualización de foto ----
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '85%',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.55,
    borderRadius: BORDER_RADIUS.md,
  },
  modalInfo: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.sm,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: '#fff',
    marginBottom: SPACING.xs,
  },
  modalText: {
    fontSize: FONTS.sizes.sm,
    color: '#ddd',
    marginTop: 2,
  },
  modalCoords: {
    fontSize: FONTS.sizes.xs,
    color: '#aaa',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  modalCloseBtn: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
  },
  modalCloseText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  // ---- Modal de instrucciones iniciales ----
  instModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  instModal: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    ...SHADOWS.lg,
  },
  instTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  instSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  requisitoBanner: {
    backgroundColor: COLORS.warning + '18',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  requisitoTexto: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  instItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
    backgroundColor: COLORS.background,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  instNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    color: COLORS.textOnPrimary,
    textAlign: 'center',
    lineHeight: 28,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    marginRight: SPACING.md,
    overflow: 'hidden',
  },
  instText: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  instBoton: {
    backgroundColor: COLORS.primary,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  instBotonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  // ---- Indicador de duración máxima en video ----
  maxDurationBadge: {
    alignSelf: 'center',
    marginTop: SPACING.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.lg,
  },
  maxDurationText: {
    color: '#ffcc00',
    fontSize: 13,
    fontWeight: FONTS.weights.bold,
  },
  // ---- Botón de abrir cámara en modo video ----
  openCameraButtonVideo: {
    backgroundColor: COLORS.error || '#d32f2f',
  },
});

export default CamaraScreen;
