// ============================================================
// GEODAILY — Anexos (Explorador de archivos del técnico)
// ============================================================
// Espacio propio del técnico, tipo "explorador de Windows", respaldado por
// MinIO: crear/renombrar/eliminar carpetas y subir cualquier tipo de archivo.
// Todo vive en {rol}/{usuario}/Anexos/ del servidor, así que se ve igual
// desde cualquier dispositivo donde el técnico inicie sesión.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import VisorAnexoModal from '../../components/VisorAnexoModal';
import VideoPlayerModal from '../../components/VideoPlayerModal';
import {
  AnexoItem,
  listarAnexos,
  crearCarpetaAnexo,
  subirAnexos,
  renombrarAnexo,
  eliminarAnexo,
  abrirAnexoExterno,
  cabecerasAnexo,
  rutaCompletaAnexo,
  tipoAnexo,
  urlDescargaAnexo,
  formatearTamano,
  iconoDeAnexo,
} from '../../services/anexos.service';

type AnexosScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const AnexosScreen: React.FC<AnexosScreenProps> = () => {
  const insets = useSafeAreaInsets();

  const [path, setPath] = useState('');          // ruta relativa actual ('' = raíz)
  const [items, setItems] = useState<AnexoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  // Modal para crear carpeta / renombrar (Alert.prompt no existe en Android)
  const [modalVisible, setModalVisible] = useState(false);
  const [modalModo, setModalModo] = useState<'crear' | 'renombrar'>('crear');
  const [modalValor, setModalValor] = useState('');
  const [itemEnEdicion, setItemEnEdicion] = useState<AnexoItem | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Visor interno: las imágenes y videos se abren dentro de la app, sin
  // delegar en el selector de apps del sistema.
  const [imagenVisor, setImagenVisor] = useState<{
    item: AnexoItem;
    url: string;
    headers: Record<string, string>;
  } | null>(null);
  const [videoVisor, setVideoVisor] = useState<{
    nombre: string;
    uri: string;
    headers: Record<string, string>;
  } | null>(null);

  const cargar = useCallback(async (ruta: string, esRefresh = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      else setLoading(true);
      const datos = await listarAnexos(ruta);
      setItems(datos);
    } catch {
      Alert.alert(
        'Sin conexión',
        'No se pudieron cargar los anexos. Verifica tu conexión a internet.'
      );
    } finally {
      setLoading(false);
      setRefrescando(false);
    }
  }, []);

  useEffect(() => {
    cargar(path);
  }, [path, cargar]);

  // ─── Navegación tipo explorador ─────────────────────────────
  const entrarCarpeta = (item: AnexoItem) => {
    setPath(path ? `${path}/${item.nombre}` : item.nombre);
  };

  const subirNivel = () => {
    const partes = path.split('/').filter(Boolean);
    partes.pop();
    setPath(partes.join('/'));
  };

  const irARaiz = () => setPath('');

  // ─── Abrir archivo ──────────────────────────────────────────
  // Imágenes y videos → visor interno de la app.
  // PDF / Office / ZIP / web → apps externas (respaldo).
  const entregarAfuera = async (item: AnexoItem) => {
    setAbriendo(item.nombre);
    try {
      await abrirAnexoExterno(item, path);
    } catch (error) {
      console.error('[Anexos] Error al abrir externamente:', error);
      Alert.alert('Error', 'No se pudo abrir el archivo. Verifica tu conexión.');
    } finally {
      setAbriendo(null);
    }
  };

  const handleAbrir = async (item: AnexoItem) => {
    if (item.esCarpeta) {
      entrarCarpeta(item);
      return;
    }

    const tipo = tipoAnexo(item);

    // En web el navegador ya muestra imágenes y PDF en una pestaña nueva.
    if (Platform.OS === 'web' || tipo === 'otro') {
      await entregarAfuera(item);
      return;
    }

    try {
      const ruta = rutaCompletaAnexo(item, path);
      const url = urlDescargaAnexo(ruta);
      const headers = await cabecerasAnexo();
      if (tipo === 'imagen') {
        setImagenVisor({ item, url, headers });
      } else {
        setVideoVisor({ nombre: item.nombre, uri: url, headers });
      }
    } catch (error) {
      console.error('[Anexos] Error al preparar el visor:', error);
      await entregarAfuera(item);
    }
  };

  // ─── Subir archivos ─────────────────────────────────────────
  const handleSubir = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      setSubiendo(true);
      const archivos = result.assets.map((a) => ({
        uri: a.uri,
        nombre: a.name || `archivo_${Date.now()}`,
        mimeType: a.mimeType || 'application/octet-stream',
      }));

      const { ok, subidos } = await subirAnexos(path, archivos);
      if (ok) {
        Alert.alert('✅ Subido', `${subidos} archivo(s) subido(s) correctamente.`);
        await cargar(path, true);
      } else {
        Alert.alert('Error', 'No se pudieron subir los archivos. Verifica tu conexión.');
      }
    } catch (error) {
      console.error('[Anexos] Error al seleccionar archivos:', error);
      Alert.alert('Error', 'No se pudieron agregar los archivos.');
    } finally {
      setSubiendo(false);
    }
  };

  // ─── Crear carpeta ──────────────────────────────────────────
  const abrirModalCrear = () => {
    setModalModo('crear');
    setItemEnEdicion(null);
    setModalValor('');
    setModalVisible(true);
  };

  const abrirModalRenombrar = (item: AnexoItem) => {
    setModalModo('renombrar');
    setItemEnEdicion(item);
    setModalValor(item.nombre);
    setModalVisible(true);
  };

  const confirmarModal = async () => {
    const valor = modalValor.trim();
    if (!valor) {
      Alert.alert('Nombre requerido', 'Escribe un nombre válido.');
      return;
    }
    setGuardando(true);
    let ok = false;
    if (modalModo === 'crear') {
      ok = await crearCarpetaAnexo(path, valor);
    } else if (itemEnEdicion) {
      const ruta = path ? `${path}/${itemEnEdicion.nombre}` : itemEnEdicion.nombre;
      ok = await renombrarAnexo(ruta, valor);
    }
    setGuardando(false);

    if (ok) {
      setModalVisible(false);
      await cargar(path, true);
    } else {
      Alert.alert('Error', 'No se pudo guardar el cambio.');
    }
  };

  // ─── Eliminar ───────────────────────────────────────────────
  const handleEliminar = (item: AnexoItem) => {
    const tipo = item.esCarpeta ? 'la carpeta y todo su contenido' : 'el archivo';
    Alert.alert(
      'Eliminar',
      `¿Seguro que quieres eliminar ${tipo} "${item.nombre}"? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const ruta = path ? `${path}/${item.nombre}` : item.nombre;
            const ok = await eliminarAnexo(ruta);
            if (ok) await cargar(path, true);
            else Alert.alert('Error', 'No se pudo eliminar.');
          },
        },
      ]
    );
  };

  // ─── Menú de acciones por elemento ──────────────────────────
  const abrirAcciones = (item: AnexoItem) => {
    Alert.alert(
      item.nombre,
      item.esCarpeta ? 'Carpeta' : `Archivo · ${formatearTamano(item.tamaño)}`,
      [
        ...(item.esCarpeta
          ? [{ text: 'Abrir', onPress: () => entrarCarpeta(item) }]
          : [{ text: 'Abrir', onPress: () => handleAbrir(item) }]),
        { text: 'Renombrar', onPress: () => abrirModalRenombrar(item) },
        { text: 'Eliminar', style: 'destructive' as const, onPress: () => handleEliminar(item) },
        { text: 'Cancelar', style: 'cancel' as const },
      ]
    );
  };

  // ─── Migas de pan (breadcrumb) ──────────────────────────────
  const segmentos = path.split('/').filter(Boolean);

  const renderItem = ({ item }: { item: AnexoItem }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => handleAbrir(item)}
      onLongPress={() => abrirAcciones(item)}
      activeOpacity={0.7}
      disabled={abriendo === item.nombre}
    >
      <Text style={styles.rowIcon}>{iconoDeAnexo(item)}</Text>
      <View style={styles.rowContent}>
        <Text style={styles.rowName} numberOfLines={1}>{item.nombre}</Text>
        <Text style={styles.rowMeta}>
          {item.esCarpeta ? 'Carpeta' : formatearTamano(item.tamaño)}
        </Text>
      </View>
      {abriendo === item.nombre ? (
        <ActivityIndicator size="small" color={COLORS.primary} />
      ) : (
        <TouchableOpacity
          style={styles.rowMenu}
          onPress={() => abrirAcciones(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.rowMenuText}> ⋯ </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Migas de pan */}
      <View style={styles.breadcrumbWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumb}>
          <TouchableOpacity onPress={irARaiz}>
            <Text style={[styles.crumb, segmentos.length === 0 && styles.crumbActivo]}>
              🏠 Anexos
            </Text>
          </TouchableOpacity>
          {segmentos.map((seg, idx) => (
            <View key={`${seg}-${idx}`} style={styles.crumbItem}>
              <Text style={styles.crumbSep}>›</Text>
              <TouchableOpacity
                onPress={() => setPath(segmentos.slice(0, idx + 1).join('/'))}
              >
                <Text style={[styles.crumb, idx === segmentos.length - 1 && styles.crumbActivo]}>
                  {seg}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Barra de acciones */}
      <View style={styles.actionsBar}>
        {path ? (
          <TouchableOpacity style={styles.actionBtn} onPress={subirNivel}>
            <Text style={styles.actionIcon}>⬆️</Text>
            <Text style={styles.actionText}>Subir</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.actionBtn} onPress={abrirModalCrear}>
          <Text style={styles.actionIcon}>📁</Text>
          <Text style={styles.actionText}>Nueva carpeta</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnPrimary]}
          onPress={handleSubir}
          disabled={subiendo}
        >
          {subiendo ? (
            <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
          ) : (
            <>
              <Text style={styles.actionIcon}>⬆️</Text>
              <Text style={[styles.actionText, styles.actionTextPrimary]}>Subir archivos</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Listado */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.centerText}>Cargando anexos…</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.esCarpeta ? 'd' : 'f'}-${item.nombre}`}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl }}
          refreshControl={
            <RefreshControl refreshing={refrescando} onRefresh={() => cargar(path, true)} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>📂</Text>
              <Text style={styles.emptyTitle}>Esta carpeta está vacía</Text>
              <Text style={styles.centerText}>
                Crea una carpeta o sube archivos para empezar.
              </Text>
            </View>
          }
        />
      )}

      {/* Modal crear / renombrar */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {modalModo === 'crear' ? '📁 Nueva carpeta' : '✏️ Renombrar'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={modalValor}
              onChangeText={setModalValor}
              placeholder="Nombre"
              placeholderTextColor={COLORS.textLight}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={confirmarModal}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setModalVisible(false)}
                disabled={guardando}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, guardando && styles.modalConfirmDisabled]}
                onPress={confirmarModal}
                disabled={guardando}
              >
                {guardando ? (
                  <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    {modalModo === 'crear' ? 'Crear' : 'Guardar'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Visor interno de imágenes */}
      <VisorAnexoModal
        visible={!!imagenVisor}
        nombre={imagenVisor?.item.nombre || null}
        url={imagenVisor?.url || null}
        headers={imagenVisor?.headers || {}}
        onClose={() => setImagenVisor(null)}
        onCompartir={imagenVisor ? () => entregarAfuera(imagenVisor.item) : undefined}
      />

      {/* Visor interno de videos (ya existente en la app) */}
      <VideoPlayerModal
        visible={!!videoVisor}
        uri={videoVisor?.uri || null}
        headers={videoVisor?.headers || {}}
        subtitulo={videoVisor?.nombre}
        onClose={() => setVideoVisor(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  breadcrumbWrap: {
    backgroundColor: COLORS.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  breadcrumb: {
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  crumbItem: { flexDirection: 'row', alignItems: 'center' },
  crumb: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  crumbActivo: { color: COLORS.primary, fontWeight: FONTS.weights.bold },
  crumbSep: { fontSize: FONTS.sizes.lg, color: COLORS.textLight, marginHorizontal: SPACING.xs },
  actionsBar: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  actionIcon: { fontSize: 15 },
  actionText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  actionTextPrimary: { color: COLORS.textOnPrimary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  rowIcon: { fontSize: 26, marginRight: SPACING.md },
  rowContent: { flex: 1 },
  rowName: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  rowMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  rowMenu: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  rowMenuText: { fontSize: 20, color: COLORS.textLight, fontWeight: FONTS.weights.bold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, marginTop: SPACING.xxl },
  centerText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.sm },
  emptyTitle: {
    fontSize: FONTS.sizes.lg,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.lg,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  modalCancel: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
  },
  modalCancelText: { color: COLORS.textSecondary, fontWeight: FONTS.weights.medium },
  modalConfirm: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
    minWidth: 100,
    alignItems: 'center',
  },
  modalConfirmDisabled: { opacity: 0.6 },
  modalConfirmText: { color: COLORS.textOnPrimary, fontWeight: FONTS.weights.semibold },
});

export default AnexosScreen;
