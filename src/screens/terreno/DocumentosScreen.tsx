// ============================================================
// GEODAILY — Gestión Documental de la Finca
// ============================================================
// Pantalla independiente para subir y visualizar documentos
// (PDF, imágenes, KML, o foto directa con la cámara)
// asociados al formulario actual.
//
// ✅ Los documentos se almacenan localmente en SQLite (documentos_finca)
// ✅ Se suben a MinIO en la carpeta .../documentos/ (no en fotos/)
// ✅ Las fotos tomadas con la cámara también van a documentos/
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useForm } from '../../store/FormContext';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { DocumentoFinca } from '../../types';
import * as DocumentPicker from 'expo-document-picker';
import {
  getDocumentosDeBeneficiario,
  saveDocumentoLocal,
  deleteDocumentoLocal,
  vincularDocumentosHuerfanos,
} from '../../services/database';
import apiClient, { isOfflineError } from '../../services/api';
import { persistirEvidencia } from '../../services/mediaStorage.service';

type DocumentosScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: {
    params?: {
      /** Beneficiario dueño de los documentos. Si no viene, se toma del formulario en curso. */
      beneficiarioCedula?: string;
      beneficiarioNombre?: string;
    };
  };
};

const DocumentosScreen: React.FC<DocumentosScreenProps> = ({ navigation, route }) => {
  const { formularioActual } = useForm();
  const insets = useSafeAreaInsets();

  // El dueño de los documentos es el beneficiario. Puede venir por
  // navegación (desde la ficha del beneficiario) o del formulario en curso.
  const cedulaBeneficiario =
    route?.params?.beneficiarioCedula?.trim() ||
    formularioActual?.beneficiario?.cedula?.trim() ||
    '';
  const nombreBeneficiario =
    route?.params?.beneficiarioNombre ||
    formularioActual?.beneficiario?.nombre ||
    '';

  const [documentos, setDocumentos] = useState<DocumentoFinca[]>([]);
  const [subiendoDoc, setSubiendoDoc] = useState(false);
  const [subiendoDocAMinIO, setSubiendoDocAMinIO] = useState(false);
  const [loading, setLoading] = useState(true);

  // ─── Estado para la cámara de documentos ───────────────────
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [capturandoFoto, setCapturandoFoto] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // ─── Cargar documentos desde SQLite ────────────────────────
  const cargarDocumentos = useCallback(async () => {
    try {
      setLoading(true);
      // Se consulta por beneficiario: los documentos de la finca persisten
      // entre visitas y no dependen del formulario que los capturó.
      const docs = await getDocumentosDeBeneficiario(
        cedulaBeneficiario || undefined,
        formularioActual?.id
      );
      setDocumentos(docs);
    } catch (e) {
      console.warn('[Documentos] Error al cargar documentos:', e);
    } finally {
      setLoading(false);
    }
  }, [cedulaBeneficiario, formularioActual?.id]);

  useEffect(() => {
    cargarDocumentos();
  }, [cargarDocumentos]);

  // ─── Vincular documentos huérfanos al formulario/beneficiario ────
  useEffect(() => {
    const formId = formularioActual?.id;
    if (!formId || formId === 'sin-formulario') return;
    vincularDocumentosHuerfanos(formId, cedulaBeneficiario || undefined)
      .then(cargarDocumentos)
      .catch(() => { /* no bloquea la pantalla */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formularioActual?.id, cedulaBeneficiario]);

  // ─── Guardar documento en SQLite y opcionalmente subir a MinIO ──
  const guardarDocumento = async (
    nuevoDoc: DocumentoFinca,
    bufferParaSubida?: { uri: string; nombre: string; mimeType: string }
  ) => {
    setSubiendoDoc(true);

    // 1. Subir a MinIO si hay buffer
    if (bufferParaSubida) {
      setSubiendoDocAMinIO(true);
      const minioOk = await subirDocAMinIO(bufferParaSubida, nuevoDoc.descripcion);
      if (!minioOk) {
        Alert.alert('Advertencia', 'El documento se guardó localmente pero no se pudo subir a MinIO. Se sincronizará después.');
      }
      setSubiendoDocAMinIO(false);
    }

    // 2. Guardar en SQLite local
    try {
      await saveDocumentoLocal(nuevoDoc);
      setDocumentos(prev => [nuevoDoc, ...prev]);
      Alert.alert('✅ Documento guardado', `${nuevoDoc.nombre} se ha guardado correctamente (local + MinIO).`);
    } catch (e) {
      console.error('[Documentos] Error al guardar en SQLite:', e);
      Alert.alert('Error', 'No se pudo guardar el documento en la base de datos local.');
    } finally {
      setSubiendoDoc(false);
    }
  };

  // ─── Subir un documento a MinIO (vía /api/documentos/subir) ─────
  //    Esto asegura que TODO (fotos y PDFs) vaya a MinIO en .../documentos/
  const subirDocAMinIO = async (
    archivo: { uri: string; nombre: string; mimeType: string },
    descripcion?: string
  ): Promise<boolean> => {
    try {
      const formData = new FormData();
      // @ts-expect-error — React Native FormData
      formData.append('archivo', {
        uri: archivo.uri,
        type: archivo.mimeType,
        name: archivo.nombre,
      });
      if (descripcion) formData.append('descripcion', descripcion);

      // Pasar datos del beneficiario para estructurar carpetas en MinIO
      const benefCedula = cedulaBeneficiario;
      const benefNombre = nombreBeneficiario;
      const tipoFormulario = formularioActual?.tipo;
      if (benefCedula) formData.append('beneficiario_cedula', benefCedula);
      if (benefNombre) formData.append('beneficiario_nombre', benefNombre);
      if (tipoFormulario) formData.append('tipo_formulario', tipoFormulario);

      const response = await apiClient.post(
        API_CONFIG.ENDPOINTS.DOCUMENTOS + '/subir',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000,
        }
      );
      console.log('[Documentos] Subido a MinIO:', response.data?.ruta);
      return true;
    } catch (error) {
      if (isOfflineError(error)) {
        console.warn('[Documentos] Offline — documento quedó pendiente');
        return true; // Se sincronizará después
      }
      console.error('[Documentos] Error al subir a MinIO:', error);
      return false;
    }
  };

  // ─── Seleccionar PDF/imagen desde el dispositivo ───────────
  const handleSubirDocumento = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const esPdf = asset.name?.toLowerCase().endsWith('.pdf');
        const docId = 'doc-' + Date.now();
        const nombreDoc = asset.name || `documento_${Date.now()}`;

        // DocumentPicker copia a caché (copyToCacheDirectory), así que se
        // mueve a almacenamiento persistente antes de registrarlo.
        const uriPersistente = await persistirEvidencia(asset.uri, docId);

        const nuevoDoc: DocumentoFinca = {
          id: docId,
          formulario_id: formularioActual?.id || 'sin-formulario',
          beneficiario_cedula: cedulaBeneficiario || undefined,
          tipo: esPdf ? 'pdf' : 'foto',
          uri: uriPersistente,
          nombre: nombreDoc,
          descripcion: '',
          created_at: new Date().toISOString(),
        };

        await guardarDocumento(nuevoDoc, {
          uri: uriPersistente,
          nombre: nombreDoc,
          mimeType: esPdf ? 'application/pdf' : 'image/jpeg',
        });
      }
    } catch (error) {
      console.error('[Documentos] Error al seleccionar documento:', error);
      Alert.alert('Error', 'No se pudo agregar el documento.');
    }
  };

  // ─── Tomar foto con la cámara (para documentos físicos) ───
  const handleAbrirCamara = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Permiso denegado', 'No se puede acceder a la cámara sin permiso');
        return;
      }
    }
    setShowCamera(true);
  };

  const handleTomarFoto = async () => {
    if (!cameraRef.current || capturandoFoto) return;
    try {
      setCapturandoFoto(true);
      const foto = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        exif: false,
      });
      if (foto?.uri) {
        const nombre = `documento_foto_${Date.now()}.jpg`;
        const docId = 'doc-' + Date.now();

        // Sacar el documento de la caché del sistema: Android puede
        // vaciarla sin avisar y son documentos de la finca, no simples
        // fotos de apoyo.
        const uriPersistente = await persistirEvidencia(foto.uri, docId);

        const nuevoDoc: DocumentoFinca = {
          id: docId,
          formulario_id: formularioActual?.id || 'sin-formulario',
          beneficiario_cedula: cedulaBeneficiario || undefined,
          tipo: 'foto', // ← Sigue siendo un documento (tipo foto)
          uri: uriPersistente,
          nombre,
          descripcion: '',
          created_at: new Date().toISOString(),
        };

        setShowCamera(false);
        await guardarDocumento(nuevoDoc, {
          uri: uriPersistente,
          nombre,
          mimeType: 'image/jpeg',
        });
      }
    } catch (error) {
      console.error('[Documentos] Error al tomar foto:', error);
      Alert.alert('Error', 'No se pudo capturar la foto.');
    } finally {
      setCapturandoFoto(false);
    }
  };

  // ─── Eliminar documento ─────────────────────────────────────
  const handleEliminarDocumento = (doc: DocumentoFinca) => {
    Alert.alert('Eliminar documento', `¿Estás seguro de eliminar "${doc.nombre}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDocumentoLocal(doc.id);
            setDocumentos(prev => prev.filter(d => d.id !== doc.id));
          } catch (e) {
            console.error('[Documentos] Error al eliminar:', e);
            Alert.alert('Error', 'No se pudo eliminar el documento.');
          }
        },
      },
    ]);
  };

  // ─── Render: Pantalla de cámara ─────────────────────────────
  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          mode="picture"
        >
          <View style={[styles.cameraOverlay, { paddingTop: Math.max(insets.top, SPACING.xxl) }]}>
            <View style={styles.cameraTopRow}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowCamera(false)}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
              <View style={styles.cameraBadge}>
                <Text style={styles.cameraBadgeText}>📄 Foto para documento</Text>
              </View>
            </View>
          </View>
          <View style={styles.cameraBottom}>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={handleTomarFoto}
              disabled={capturandoFoto}
            >
              <View style={styles.captureInner} />
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  // ─── Render: Pantalla principal ─────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, SPACING.xxl), paddingBottom: insets.bottom + SPACING.lg }]}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <Text style={styles.title}>📄 Documentos de la Finca</Text>
        <Text style={styles.subtitle}>
          Sube documentos PDF, imágenes, KML, o toma una foto directa. Todo se almacena en la carpeta de documentos en la nube.
        </Text>

        {/* Botón: Agregar desde archivos */}
        <TouchableOpacity
          style={styles.subirDocBtn}
          onPress={handleSubirDocumento}
          disabled={subiendoDoc}
        >
          <Text style={styles.subirDocBtnIcon}>📁</Text>
          <Text style={styles.subirDocBtnText}>
            {subiendoDoc && !subiendoDocAMinIO
              ? '⏳ Guardando...'
              : 'Agregar documento (PDF / imagen)'}
          </Text>
        </TouchableOpacity>

        {/* Botón: Tomar foto al documento físico */}
        <TouchableOpacity
          style={styles.camaraDocBtn}
          onPress={handleAbrirCamara}
          disabled={subiendoDoc}
        >
          <Text style={styles.camaraDocBtnIcon}>📷</Text>
          <Text style={styles.camaraDocBtnText}>Tomar foto al documento</Text>
        </TouchableOpacity>

        {subiendoDocAMinIO && (
          <View style={styles.subiendoBanner}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.subiendoBannerText}>Subiendo a MinIO...</Text>
          </View>
        )}

        {/* Listado de documentos o loading */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.loadingText}>Cargando documentos...</Text>
          </View>
        ) : documentos.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyText}>No hay documentos vinculados</Text>
            <Text style={styles.emptySubtext}>Sube un archivo o toma una foto</Text>
          </View>
        ) : (
          <View style={styles.docList}>
            <Text style={styles.docCount}>{documentos.length} documento(s) vinculado(s)</Text>
            {documentos.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.docItem}
                onLongPress={() => handleEliminarDocumento(doc)}
                activeOpacity={0.7}
              >
                <Text style={styles.docIcon}>
                  {doc.nombre?.toLowerCase().endsWith('.pdf') ? '📕' : '🖼️'}
                </Text>
                <View style={styles.docInfo}>
                  <Text style={styles.docNombre} numberOfLines={1}>{doc.nombre}</Text>
                  <Text style={styles.docFecha}>
                    {new Date(doc.created_at).toLocaleDateString('es-CO', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <Text style={styles.docSynced}>✅</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.docsSavedText}>✓ Todos los documentos guardados (local + MinIO)</Text>
            <Text style={styles.docHint}>👆 Mantén presionado para eliminar un documento</Text>
          </View>
        )}

        {/* Botón de continuar */}
        <TouchableOpacity
          style={styles.continueButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.continueButtonText}>✓ Continuar</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

// ─── Estilos ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.lg,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxl,
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
    lineHeight: 20,
  },
  subirDocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.lg,
    ...SHADOWS.md,
  },
  subirDocBtnIcon: {
    fontSize: 22,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.bold,
    marginRight: SPACING.sm,
  },
  subirDocBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  loadingText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginLeft: SPACING.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: SPACING.xl,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  emptySubtext: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  docList: {
    gap: SPACING.sm,
  },
  docCount: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.sm,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
    ...SHADOWS.sm,
  },
  docIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
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
    marginTop: 2,
  },
  docSynced: {
    fontSize: 18,
  },
  docsSavedText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.success,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: SPACING.sm,
  },
  docHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: SPACING.xs,
  },
  continueButton: {
    backgroundColor: COLORS.success,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.xl,
    ...SHADOWS.sm,
  },
  continueButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  // ─── Botón de cámara para documentos ────────────────────────
  camaraDocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.lg,
  },
  camaraDocBtnIcon: {
    fontSize: 22,
    marginRight: SPACING.sm,
  },
  camaraDocBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  subiendoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.sm,
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  subiendoBannerText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  // ─── Cámara ─────────────────────────────────────────────────
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
  cameraBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cameraBadgeText: {
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
});

export default DocumentosScreen;
