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
import { FotoGeotag, ClimaActual } from '../../types';

type CamaraScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const CamaraScreen: React.FC<CamaraScreenProps> = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const { capturarFoto, removeFoto, fotos, isLoading } = useCamera();
  const { addFoto } = useForm();
  const { climaActual, resumen, isLoading: climaLoading, error: climaError, fetchClimate } = useClimate();
  const cameraRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const [fotosGuardadas, setFotosGuardadas] = useState<Set<string>>(new Set());

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
            departamento: addr.region || addr.state || '—',
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

  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          <View style={styles.cameraOverlay}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowCamera(false)}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.cameraBottom}>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={handleTakePhoto}
            >
              <View style={styles.captureInner} />
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  const todasGuardadas = fotos.length > 0 && fotos.every((f) => fotosGuardadas.has(f.id));
  const pendientes = fotos.length - fotosGuardadas.size;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + SPACING.lg }]}>
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
                <Image source={{ uri: item.uri }} style={styles.fotoPreview} />
                <View style={styles.fotoInfo}>
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
});

export default CamaraScreen;
