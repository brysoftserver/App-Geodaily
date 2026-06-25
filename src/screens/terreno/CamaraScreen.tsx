// ============================================================
// GEODAILY — Captura Fotográfica con Geotag
// ============================================================

import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useCamera } from '../../hooks/useCamera';
import { useClimate } from '../../hooks/useClimate';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForm } from '../../store/FormContext';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { formatCoordenadas } from '../../utils/formatters';
import LoadingSpinner from '../../components/LoadingSpinner';
import { FotoGeotag, ClimaActual, DocumentoFinca } from '../../types';
import * as DocumentPicker from 'expo-document-picker';
import { getDb } from '../../services/database';

type CamaraScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const CamaraScreen: React.FC<CamaraScreenProps> = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [modoVideo, setModoVideo] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const { capturarFoto, removeFoto, fotos, isLoading, clearFotos } = useCamera();
  const { addFoto, formularioActual } = useForm();
  const { climaActual, resumen, isLoading: climaLoading, error: climaError, fetchClimate } = useClimate();
  const cameraRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const [fotosGuardadas, setFotosGuardadas] = useState<Set<string>>(new Set());

  // ---- Estado para Gestión Documental ----
  const [documentos, setDocumentos] = useState<DocumentoFinca[]>([]);
  const [subiendoDoc, setSubiendoDoc] = useState(false);

  // Limpiar fotos del hook al entrar (evita arrastrar evidencias de formularios anteriores)
  useEffect(() => {
    clearFotos();
  }, []);

  // Cargar documentos existentes al montar, solo del formulario actual
  useEffect(() => {
    const cargarDocs = async () => {
      try {
        const db = getDb();
        const formId = formularioActual?.id;
        if (db && formId) {
          const docs = await db.getAllAsync<any>(
            'SELECT * FROM documentos_finca WHERE formulario_id = ? ORDER BY created_at DESC',
            [formId]
          );
          if (docs && docs.length > 0) {
            setDocumentos(docs as DocumentoFinca[]);
          }
        }
      } catch (e) {
        // Ignorar si no hay formulario activo aún
      }
    };
    cargarDocs();
  }, [formularioActual?.id]);

  // Seleccionar y subir documento
  const handleSubirDocumento = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSubiendoDoc(true);
        const asset = result.assets[0];
        const nuevoDoc: DocumentoFinca = {
          id: 'doc-' + Date.now(),
          formulario_id: formularioActual?.id || 'sin-formulario',
          tipo: asset.name?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'foto',
          uri: asset.uri,
          nombre: asset.name,
          descripcion: '',
          created_at: new Date().toISOString(),
        };
        const db = getDb();
        if (db) {
          await db.runAsync(
            `INSERT OR REPLACE INTO documentos_finca (id, formulario_id, tipo, uri, nombre, descripcion, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [nuevoDoc.id, nuevoDoc.formulario_id, nuevoDoc.tipo, nuevoDoc.uri, nuevoDoc.nombre, nuevoDoc.descripcion || null, nuevoDoc.created_at]
          );
        }
        setDocumentos(prev => [...prev, nuevoDoc]);
        Alert.alert('✅ Documento agregado', `${asset.name} se ha vinculado al formulario.`);
        setSubiendoDoc(false);
      }
    } catch (error) {
      console.error('[Camara] Error al seleccionar documento:', error);
      Alert.alert('Error', 'No se pudo agregar el documento.');
      setSubiendoDoc(false);
    }
  };

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
      return (
        <View style={[styles.climaCard, styles.climaCardError]}>
          <Text style={styles.climaErrorIcon}>⚠️</Text>
          <View style={styles.climaErrorContent}>
            <Text style={styles.climaErrorTitle}>Clima no disponible</Text>
            <Text style={styles.climaErrorText}>{climaError}</Text>
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
    setShowCamera(true);
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        exif: true,
      });

      if (photo?.uri) {
        const nuevaFoto = await capturarFoto(photo.uri);
        if (nuevaFoto) {
          nuevaFoto.tipo = 'foto';
          // Resolver la ubicación real desde las coordenadas GPS
          resolverUbicacion(
            nuevaFoto.id,
            nuevaFoto.coordenadas.latitud,
            nuevaFoto.coordenadas.longitud
          );
        }
      }
      setShowCamera(false);
    } catch (error) {
      Alert.alert('Error', 'No se pudo tomar la foto');
      setShowCamera(false);
    }
  };

  const handleGuardarFotos = async () => {
    const sinGuardar = fotos.filter((f) => !fotosGuardadas.has(f.id));
    if (sinGuardar.length === 0) {
      Alert.alert('Sin novedades', 'Todas las fotos ya están guardadas.');
      return;
    }

    try {
      for (const foto of sinGuardar) {
        addFoto(foto);
      }
      setFotosGuardadas(new Set(fotos.map((f) => f.id)));
      Alert.alert('✅ Guardadas', `${sinGuardar.length} foto(s) guardada(s) correctamente.`);
    } catch (err) {
      console.error('[Camara] Error al guardar fotos:', err);
      Alert.alert('Error', 'No se pudieron guardar las fotos.');
    }
  };

  const handleDeleteFoto = (foto: FotoGeotag) => {
    Alert.alert('Eliminar foto', '¿Estás seguro de eliminar esta foto?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', onPress: () => {
        removeFoto(foto.id);
        setFotosGuardadas((prev) => {
          const next = new Set(prev);
          next.delete(foto.id);
          return next;
        });
      }, style: 'destructive' },
    ]);
  };

  const handleContinue = () => {
    const sinGuardar = fotos.filter((f) => !fotosGuardadas.has(f.id));
    if (sinGuardar.length > 0) {
      Alert.alert(
        'Fotos sin guardar',
        `Tienes ${sinGuardar.length} foto(s) sin guardar. ¿Deseas guardarlas antes de continuar?`,
        [
          { text: 'Descartar', style: 'destructive', onPress: () => navigation.goBack() },
          { text: 'Guardar', onPress: handleGuardarFotos },
        ]
      );
      return;
    }
    navigation.goBack();
  };

  if (!permission) {
    return <LoadingSpinner message="Solicitando permisos..." fullScreen />;
  }

  const handleRecordVideo = async () => {
    if (!cameraRef.current) return;

    if (isRecording) {
      // Detener grabación
      try {
        const video = await cameraRef.current.stopRecording();
        if (video?.uri) {
          const nuevaFoto = await capturarFoto(video.uri);
          if (nuevaFoto) {
            nuevaFoto.tipo = 'video';
            resolverUbicacion(
              nuevaFoto.id,
              nuevaFoto.coordenadas.latitud,
              nuevaFoto.coordenadas.longitud
            );
          }
        }
      } catch (error) {
        console.error('[Camara] Error al detener grabación:', error);
      }
      setIsRecording(false);
      setShowCamera(false);
    } else {
      // Iniciar grabación
      try {
        setIsRecording(true);
        await cameraRef.current.recordAsync({ maxDuration: 60 });
        // La grabación continúa hasta que se presione de nuevo
      } catch (error) {
        console.error('[Camara] Error al iniciar grabación:', error);
        setIsRecording(false);
      }
    }
  };

  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" mode={modoVideo ? 'video' : 'picture'}>
          <View style={[styles.cameraOverlay, { paddingTop: Math.max(insets.top, SPACING.xxl) }]}>
            <View style={styles.cameraTopRow}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowCamera(false)}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
              {/* Toggle Foto/Video */}
              <TouchableOpacity
                style={[styles.modeToggle, modoVideo && styles.modeToggleActive]}
                onPress={() => { setModoVideo(!modoVideo); setIsRecording(false); }}
              >
                <Text style={styles.modeToggleText}>
                  {modoVideo ? '🎥 Video' : '📷 Foto'}
                </Text>
              </TouchableOpacity>
            </View>
            {isRecording && (
              <View style={styles.recordingBadge}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>GRABANDO</Text>
              </View>
            )}
          </View>
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
                style={styles.captureButton}
                onPress={handleTakePhoto}
              >
                <View style={styles.captureInner} />
              </TouchableOpacity>
            )}
          </View>
        </CameraView>
      </View>
    );
  }

  const todasGuardadas = fotos.length > 0 && fotos.every((f) => fotosGuardadas.has(f.id));
  const pendientes = fotos.length - fotosGuardadas.size;

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, SPACING.xxl), paddingBottom: insets.bottom + SPACING.lg }]}>
      <Text style={styles.title}>Evidencia Fotográfica</Text>
      <Text style={styles.subtitle}>
        Las fotos se georreferenciarán automáticamente. Los datos climáticos se obtienen desde tu ubicación actual.
      </Text>

      {renderClimaCard()}

      <TouchableOpacity
        style={styles.openCameraButton}
        onPress={handleOpenCamera}
        disabled={isLoading}
      >
        <Text style={styles.cameraIcon}>📷</Text>
        <Text style={styles.openCameraText}>
          {isLoading ? 'Capturando...' : 'Abrir Cámara'}
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
          <FlatList
            data={fotos}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={styles.fotosGrid}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.fotoCard}
                onLongPress={() => handleDeleteFoto(item)}
              >
                {item.tipo === 'video' ? (
                  <View style={styles.videoPreview}>
                    <Text style={styles.videoPlayIcon}>▶️</Text>
                    <Text style={styles.videoLabel}>VIDEO</Text>
                  </View>
                ) : (
                  <Image source={{ uri: item.uri }} style={styles.fotoPreview} />
                )}
                <View style={styles.fotoInfo}>
                  {item.tipo === 'video' && (
                    <Text style={styles.fotoVideoTag}>🎥 Video</Text>
                  )}
                  {ubicacionesFotos[item.id] ? (
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
            )}
          />
        </View>
      )}

      {/* ---- Sección de Gestión Documental ---- */}
      <View style={styles.docSection}>
        <View style={styles.docHeader}>
          <Text style={styles.docTitle}>📄 Documentos de la Finca</Text>
          <Text style={styles.docCount}>{documentos.length} archivo(s)</Text>
        </View>

        <TouchableOpacity
          style={styles.subirDocBtn}
          onPress={handleSubirDocumento}
          disabled={subiendoDoc}
        >
          <Text style={styles.subirDocBtnText}>
            {subiendoDoc ? '⏳ Subiendo...' : '+ Agregar documento (PDF/imagen)'}
          </Text>
        </TouchableOpacity>

        {documentos.length > 0 && (
          <View style={styles.docList}>
            {documentos.map((doc) => (
              <View key={doc.id} style={styles.docItem}>
                <Text style={styles.docIcon}>
                  {doc.nombre.endsWith('.pdf') ? '📕' : '🖼️'}
                </Text>
                <View style={styles.docInfo}>
                  <Text style={styles.docNombre} numberOfLines={1}>{doc.nombre}</Text>
                  <Text style={styles.docFecha}>
                    {new Date(doc.created_at).toLocaleDateString('es-CO')}
                  </Text>
                </View>
                {doc.tipo === 'pdf' && (
                  <Text style={styles.docSynced}>📕</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </View>

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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.lg,
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
  fotosSection: {
    flex: 1,
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
    gap: SPACING.sm,
  },
  fotoCard: {
    flex: 1,
    margin: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
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
  climaCardError: {
    borderLeftColor: COLORS.warning,
    flexDirection: 'row',
    alignItems: 'center',
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
});

export default CamaraScreen;
