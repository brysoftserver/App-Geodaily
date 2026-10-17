// ============================================================
// GEODAILY — Revisar Anexos (roles superiores)
// ============================================================
// Coordinador / Interventor / Gerente / Admin pueden revisar los anexos que
// cada técnico organiza en su espacio. Es de SOLO LECTURA: navegar carpetas
// y abrir/descargar archivos, sin crear, renombrar ni eliminar.
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
  TextInput,
  ScrollView,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';
import VisorAnexoModal from '../../components/VisorAnexoModal';
import VideoPlayerModal from '../../components/VideoPlayerModal';
import {
  AnexoItem,
  AnexoTecnico,
  listarAnexos,
  listarTecnicosAnexos,
  abrirAnexoExterno,
  cabecerasAnexo,
  rutaCompletaAnexo,
  tipoAnexo,
  urlDescargaAnexo,
  formatearTamano,
  iconoDeAnexo,
} from '../../services/anexos.service';

type RevisarAnexosScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const RevisarAnexosScreen: React.FC<RevisarAnexosScreenProps> = () => {
  const insets = useSafeAreaInsets();

  // Técnico seleccionado (null = mostrar la lista de técnicos)
  const [tecnico, setTecnico] = useState<AnexoTecnico | null>(null);
  const [tecnicos, setTecnicos] = useState<AnexoTecnico[]>([]);
  const [filtro, setFiltro] = useState('');

  const [path, setPath] = useState('');
  const [items, setItems] = useState<AnexoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  // Visor interno: imágenes y videos se abren dentro de la app, sin delegar
  // en el selector de apps del sistema del dispositivo.
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

  // ─── Cargar técnicos ────────────────────────────────────────
  const cargarTecnicos = useCallback(async () => {
    setLoading(true);
    const datos = await listarTecnicosAnexos();
    setTecnicos(datos);
    setLoading(false);
  }, []);

  // ─── Cargar contenido de un técnico ─────────────────────────
  const cargarAnexos = useCallback(
    async (ruta: string, usuario: string, esRefresh = false) => {
      try {
        if (esRefresh) setRefrescando(true);
        else setLoading(true);
        const datos = await listarAnexos(ruta, usuario);
        setItems(datos);
      } catch {
        Alert.alert('Sin conexión', 'No se pudieron cargar los anexos.');
      } finally {
        setLoading(false);
        setRefrescando(false);
      }
    },
    []
  );

  useEffect(() => {
    cargarTecnicos();
  }, [cargarTecnicos]);

  useEffect(() => {
    if (tecnico) cargarAnexos(path, tecnico.usuario);
  }, [tecnico, path, cargarAnexos]);

  // ─── Navegación ─────────────────────────────────────────────
  const entrarCarpeta = (item: AnexoItem) =>
    setPath(path ? `${path}/${item.nombre}` : item.nombre);

  const subirNivel = () => {
    const partes = path.split('/').filter(Boolean);
    partes.pop();
    setPath(partes.join('/'));
  };

  const volverATecnicos = () => {
    setTecnico(null);
    setPath('');
    setItems([]);
  };

  const handleAbrir = async (item: AnexoItem) => {
    if (item.esCarpeta) {
      entrarCarpeta(item);
      return;
    }
    const usuario = tecnico?.usuario;
    const tipo = tipoAnexo(item);

    // En web el navegador ya muestra imágenes y PDF en una pestaña nueva.
    if (Platform.OS === 'web' || tipo === 'otro') {
      setAbriendo(item.nombre);
      try {
        await abrirAnexoExterno(item, path, usuario);
      } catch (error) {
        console.error('[RevisarAnexos] Error al abrir externamente:', error);
        Alert.alert('Error', 'No se pudo abrir el archivo. Verifica tu conexión.');
      } finally {
        setAbriendo(null);
      }
      return;
    }

    try {
      const ruta = rutaCompletaAnexo(item, path);
      const url = urlDescargaAnexo(ruta, usuario);
      const headers = await cabecerasAnexo();
      if (tipo === 'imagen') {
        setImagenVisor({ item, url, headers });
      } else {
        setVideoVisor({ nombre: item.nombre, uri: url, headers });
      }
    } catch (error) {
      console.error('[RevisarAnexos] Error al preparar el visor:', error);
      Alert.alert('Error', 'No se pudo preparar el archivo.');
    }
  };

  const segmentos = path.split('/').filter(Boolean);
  const tecnicosFiltrados = tecnicos.filter((t) => {
    const q = filtro.trim().toLowerCase();
    if (!q) return true;
    return (
      (t.nombre || '').toLowerCase().includes(q) ||
      (t.usuario || '').toLowerCase().includes(q) ||
      (t.cedula || '').toLowerCase().includes(q)
    );
  });

  // ─── Vista: lista de técnicos ───────────────────────────────
  if (!tecnico) {
    return (
      <View style={styles.container}>
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            placeholder="Buscar técnico por nombre, usuario o cédula"
            placeholderTextColor={COLORS.textLight}
            value={filtro}
            onChangeText={setFiltro}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.centerText}>Cargando técnicos…</Text>
          </View>
        ) : (
          <FlatList
            data={tecnicosFiltrados}
            keyExtractor={(t) => t.usuario}
            contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl }}
            refreshControl={<RefreshControl refreshing={false} onRefresh={cargarTecnicos} />}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => setTecnico(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.rowIcon}>👷</Text>
                <View style={styles.rowContent}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.nombre}</Text>
                  <Text style={styles.rowMeta}>
                    {item.usuario}
                    {item.cedula ? ` · C.C. ${item.cedula}` : ''}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyIcon}>👷</Text>
                <Text style={styles.emptyTitle}>No hay técnicos</Text>
                <Text style={styles.centerText}>No se encontraron técnicos activos.</Text>
              </View>
            }
          />
        )}
      </View>
    );
  }

  // ─── Vista: anexos del técnico seleccionado (solo lectura) ──
  return (
    <View style={styles.container}>
      {/* Encabezado con técnico y navegación */}
      <View style={styles.techHeader}>
        <TouchableOpacity onPress={volverATecnicos} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Técnicos</Text>
        </TouchableOpacity>
        <Text style={styles.techName} numberOfLines={1}>👷 {tecnico.nombre}</Text>
      </View>

      <View style={styles.breadcrumbWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumb}>
          <TouchableOpacity onPress={() => setPath('')}>
            <Text style={[styles.crumb, segmentos.length === 0 && styles.crumbActivo]}>
              🏠 Anexos
            </Text>
          </TouchableOpacity>
          {segmentos.map((seg, idx) => (
            <View key={`${seg}-${idx}`} style={styles.crumbItem}>
              <Text style={styles.crumbSep}>›</Text>
              <TouchableOpacity onPress={() => setPath(segmentos.slice(0, idx + 1).join('/'))}>
                <Text style={[styles.crumb, idx === segmentos.length - 1 && styles.crumbActivo]}>
                  {seg}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      </View>

      {path ? (
        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={subirNivel}>
            <Text style={styles.actionIcon}>⬆️</Text>
            <Text style={styles.actionText}>Subir nivel</Text>
          </TouchableOpacity>
          <View style={styles.readonlyBadge}>
            <Text style={styles.readonlyText}>👁️ Solo lectura</Text>
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.centerText}>Cargando anexos…</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.esCarpeta ? 'd' : 'f'}-${item.nombre}`}
          contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl }}
          refreshControl={
            <RefreshControl
              refreshing={refrescando}
              onRefresh={() => cargarAnexos(path, tecnico.usuario, true)}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => handleAbrir(item)}
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
              ) : item.esCarpeta ? (
                <Text style={styles.chevron}>›</Text>
              ) : (
                <Text style={styles.downloadIcon}>⬇️</Text>
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>📂</Text>
              <Text style={styles.emptyTitle}>Sin anexos</Text>
              <Text style={styles.centerText}>
                Este técnico todavía no ha subido anexos aquí.
              </Text>
            </View>
          }
        />
      )}
      {/* Visor interno de imágenes */}
      <VisorAnexoModal
        visible={!!imagenVisor}
        nombre={imagenVisor?.item.nombre || null}
        url={imagenVisor?.url || null}
        headers={imagenVisor?.headers || {}}
        onClose={() => setImagenVisor(null)}
        onCompartir={
          imagenVisor
            ? () => abrirAnexoExterno(imagenVisor.item, path, tecnico?.usuario)
            : undefined
        }
      />

      {/* Visor interno de videos (ya existente en la app) */}
      <VideoPlayerModal
        visible={!!videoVisor}
        uri={videoVisor?.uri || null}
        headers={videoVisor?.headers || {}}
        subtitulo={videoVisor?.nombre}
        onClose={() => setVideoVisor(null)}
      />    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  searchWrap: {
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  search: {
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  techHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    gap: SPACING.md,
  },
  backBtn: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surfaceAlt,
  },
  backText: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  techName: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
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
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionIcon: { fontSize: 15 },
  actionText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  readonlyBadge: {
    marginLeft: 'auto',
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  readonlyText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontWeight: FONTS.weights.medium },
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
  chevron: { fontSize: 24, color: COLORS.textLight, fontWeight: FONTS.weights.bold },
  downloadIcon: { fontSize: 18 },
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
});

export default RevisarAnexosScreen;
