// ============================================================
// GEODAILY — Pantalla de Mapa Offline (Mejorada)
// ============================================================
// Mapa interactivo con: navegación GPS, medición de terreno
// (Shoelace), conteo de plantas, importación/exportación KML.
// ============================================================

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useLocation } from '../../hooks/useLocation';
import MapViewOffline from '../../components/MapViewOffline';
import { calcularArea, exportarKML, importarKML } from '../../services/kml.service';

type ModoMapa = 'navegar' | 'medir' | 'contar';

interface PuntoPoligono {
  latitud: number;
  longitud: number;
  orden: number;
}

interface EspecieConteo {
  nombre: string;
  cantidad: string;
}

const MapaScreen: React.FC = () => {
  const { coordenadas, getCurrentPosition, isLoading: gpsLoading } = useLocation();
  const [modo, setModo] = useState<ModoMapa>('navegar');
  const [ultimoPunto, setUltimoPunto] = useState<{ lat: number; lon: number } | null>(null);

  // --- Estado para Medición ---
  const [poligono, setPoligono] = useState<PuntoPoligono[]>([]);
  const [resultadoArea, setResultadoArea] = useState<{
    areaMetros2: number;
    areaHectareas: number;
    perimetroMetros: number;
  } | null>(null);
  const [mostrarResultado, setMostrarResultado] = useState(false);

  // --- Estado para Conteo ---
  const [especies, setEspecies] = useState<EspecieConteo[]>([
    { nombre: 'Cacao', cantidad: '' },
  ]);
  const [mostrarPanelConteo, setMostrarPanelConteo] = useState(false);

  // --- Estado para KML ---
  const [mostrarModalKML, setMostrarModalKML] = useState(false);

  // Centrar en ubicación actual
  const centrarEnGPS = useCallback(async () => {
    await getCurrentPosition();
    setUltimoPunto(null);
  }, [getCurrentPosition]);

  // Manejar tap en el mapa
  const handleMapPress = useCallback(
    (latitud: number, longitud: number) => {
      setUltimoPunto({ lat: latitud, lon: longitud });

      if (modo === 'medir') {
        setPoligono((prev) => [
          ...prev,
          { latitud, longitud, orden: prev.length + 1 },
        ]);
        setResultadoArea(null);
        setMostrarResultado(false);
      }
    },
    [modo]
  );

  // --- Funciones de Medición ---
  const calcularMedicion = useCallback(() => {
    if (poligono.length < 3) {
      Alert.alert('Insuficiente', 'Se necesitan al menos 3 puntos para medir un área.');
      return;
    }
    const area = calcularArea(poligono);
    setResultadoArea(area);
    setMostrarResultado(true);
  }, [poligono]);

  const limpiarPoligono = useCallback(() => {
    setPoligono([]);
    setResultadoArea(null);
    setMostrarResultado(false);
  }, []);

  const deshacerUltimoPunto = useCallback(() => {
    setPoligono((prev) => prev.slice(0, -1));
    setResultadoArea(null);
    setMostrarResultado(false);
  }, []);

  // --- Funciones de Conteo ---
  const agregarEspecie = useCallback(() => {
    setEspecies((prev) => [...prev, { nombre: '', cantidad: '' }]);
  }, []);

  const actualizarEspecie = useCallback(
    (index: number, field: keyof EspecieConteo, value: string) => {
      setEspecies((prev) =>
        prev.map((e, i) => (i === index ? { ...e, [field]: value } : e))
      );
    },
    []
  );

  const eliminarEspecie = useCallback((index: number) => {
    setEspecies((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const guardarConteo = useCallback(() => {
    const validas = especies.filter(
      (e) => e.nombre.trim().length > 0 && e.cantidad.trim().length > 0 && parseInt(e.cantidad) > 0
    );
    if (validas.length === 0) {
      Alert.alert('Sin datos', 'Agrega al menos una especie con cantidad válida.');
      return;
    }
    Alert.alert(
      '✅ Conteo guardado',
      validas
        .map((e) => `• ${e.nombre}: ${e.cantidad} plantas`)
        .join('\n')
    );
    setMostrarPanelConteo(false);
  }, [especies]);

  // --- Funciones KML ---
  const handleExportarKML = useCallback(async () => {
    if (poligono.length < 3) {
      Alert.alert('Sin polígono', 'Dibuja un polígono en modo Medición primero.');
      return;
    }
    const nombre = `Medicion_${new Date().toISOString().split('T')[0]}`;
    await exportarKML(nombre, poligono);
    setMostrarModalKML(false);
  }, [poligono]);

  const handleImportarKML = useCallback(async () => {
    try {
      const result = await importarKML('');
      // Note: real implementation would use DocumentPicker
      Alert.alert(
        'Importar KML',
        'Selecciona un archivo .kml desde el explorador de archivos del dispositivo.'
      );
      setMostrarModalKML(false);
    } catch (error) {
      console.warn('[Mapa] Error al importar KML:', error);
    }
  }, []);

  // Cambiar modo
  const cambiarModo = useCallback(
    (nuevoModo: ModoMapa) => {
      setModo(nuevoModo);
      if (nuevoModo !== 'medir') {
        setMostrarResultado(false);
      }
      if (nuevoModo !== 'contar') {
        setMostrarPanelConteo(false);
      }
    },
    []
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface} />

      {/* Selector de modo */}
      <View style={styles.modeSelector}>
        <TouchableOpacity
          style={[styles.modeBtn, modo === 'navegar' && styles.modeBtnActive]}
          onPress={() => cambiarModo('navegar')}
        >
          <Text style={styles.modeIcon}>🧭</Text>
          <Text style={[styles.modeLabel, modo === 'navegar' && styles.modeLabelActive]}>
            Navegar
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, modo === 'medir' && styles.modeBtnActiveMedir]}
          onPress={() => cambiarModo('medir')}
        >
          <Text style={styles.modeIcon}>📐</Text>
          <Text style={[styles.modeLabel, modo === 'medir' && styles.modeLabelActive]}>
            Medición
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, modo === 'contar' && styles.modeBtnActiveContar]}
          onPress={() => cambiarModo('contar')}
        >
          <Text style={styles.modeIcon}>🌱</Text>
          <Text style={[styles.modeLabel, modo === 'contar' && styles.modeLabelActive]}>
            Conteo
          </Text>
        </TouchableOpacity>
      </View>

      {/* Mapa */}
      <View style={styles.mapContainer}>
        <MapViewOffline
          center={coordenadas ?? undefined}
          zoom={15}
          height={'100%'}
          markers={poligono.map((p) => ({
            id: `p_${p.orden}`,
            latitud: p.latitud,
            longitud: p.longitud,
            title: `Punto ${p.orden}`,
            color: modo === 'medir' ? COLORS.secondary : COLORS.primary,
          }))}
          showUserLocation={true}
          interactive={true}
          onMapPress={handleMapPress}
        />

        {/* Overlay de coordenadas */}
        {ultimoPunto && (
          <View style={styles.coordsOverlay}>
            <Text style={styles.coordsLabel}>
              {modo === 'medir' ? `Punto #${poligono.length}` : 'Coordenadas'}
            </Text>
            <Text style={styles.coordsValue}>
              Lat: {ultimoPunto.lat.toFixed(6)}
            </Text>
            <Text style={styles.coordsValue}>
              Lon: {ultimoPunto.lon.toFixed(6)}
            </Text>
            {modo === 'medir' && (
              <Text style={styles.coordsHint}>
                Toca el mapa para agregar puntos al polígono
              </Text>
            )}
          </View>
        )}

        {/* Resultado de medición */}
        {mostrarResultado && resultadoArea && (
          <View style={styles.resultOverlay}>
            <Text style={styles.resultTitle}>📐 Resultado</Text>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Área:</Text>
              <Text style={styles.resultValue}>
                {resultadoArea.areaHectareas} ha
              </Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Área (m²):</Text>
              <Text style={styles.resultValue}>
                {resultadoArea.areaMetros2.toLocaleString()} m²
              </Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Perímetro:</Text>
              <Text style={styles.resultValue}>
                {resultadoArea.perimetroMetros.toLocaleString()} m
              </Text>
            </View>
            <View style={styles.resultActions}>
              <TouchableOpacity
                style={styles.resultBtn}
                onPress={() => setMostrarModalKML(true)}
              >
                <Text style={styles.resultBtnText}>Exportar KML</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultBtn, styles.resultBtnSecondary]}
                onPress={limpiarPoligono}
              >
                <Text style={styles.resultBtnTextSecondary}>Nuevo</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Panel de Conteo */}
        {mostrarPanelConteo && (
          <View style={styles.conteoPanel}>
            <View style={styles.conteoHeader}>
              <Text style={styles.conteoTitle}>🌱 Conteo de Plantas</Text>
              <TouchableOpacity onPress={() => setMostrarPanelConteo(false)}>
                <Text style={styles.conteoClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.conteoList}>
              {especies.map((esp, index) => (
                <View key={index} style={styles.conteoRow}>
                  <TextInput
                    style={[styles.conteoInput, styles.conteoInputName]}
                    value={esp.nombre}
                    onChangeText={(v) => actualizarEspecie(index, 'nombre', v)}
                    placeholder="Especie"
                    placeholderTextColor={COLORS.textLight}
                  />
                  <TextInput
                    style={[styles.conteoInput, styles.conteoInputCant]}
                    value={esp.cantidad}
                    onChangeText={(v) => actualizarEspecie(index, 'cantidad', v)}
                    placeholder="Cant."
                    placeholderTextColor={COLORS.textLight}
                    keyboardType="numeric"
                  />
                  {especies.length > 1 && (
                    <TouchableOpacity onPress={() => eliminarEspecie(index)}>
                      <Text style={styles.conteoDelete}>🗑️</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
            <View style={styles.conteoActions}>
              <TouchableOpacity style={styles.conteoAddBtn} onPress={agregarEspecie}>
                <Text style={styles.conteoAddText}>+ Agregar especie</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.conteoSaveBtn} onPress={guardarConteo}>
                <Text style={styles.conteoSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Barra de herramientas inferior */}
      <View style={styles.toolbar}>
        {modo === 'navegar' && (
          <>
            <TouchableOpacity
              style={[styles.toolBtn, gpsLoading && styles.toolBtnDisabled]}
              onPress={centrarEnGPS}
              disabled={gpsLoading}
            >
              <Text style={styles.toolBtnIcon}>📍</Text>
              <Text style={styles.toolBtnLabel}>
                {gpsLoading ? 'GPS...' : 'Mi Ubicación'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => setMostrarModalKML(true)}
            >
              <Text style={styles.toolBtnIcon}>🗺️</Text>
              <Text style={styles.toolBtnLabel}>KML</Text>
            </TouchableOpacity>
          </>
        )}

        {modo === 'medir' && (
          <>
            <View style={styles.toolInfo}>
              <Text style={styles.toolInfoText}>
                {poligono.length} punto(s)
              </Text>
            </View>
            {poligono.length > 0 && (
              <>
                <TouchableOpacity style={styles.toolBtn} onPress={deshacerUltimoPunto}>
                  <Text style={styles.toolBtnLabel}>↩ Deshacer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolBtn, styles.toolBtnPrimary]}
                  onPress={calcularMedicion}
                >
                  <Text style={styles.toolBtnLabelPrimary}>Calcular</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toolBtn} onPress={limpiarPoligono}>
                  <Text style={styles.toolBtnLabel}>✕ Limpiar</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {modo === 'contar' && (
          <>
            <View style={styles.toolInfo}>
              <Text style={styles.toolInfoText}>
                {especies.length} especie(s)
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.toolBtn, styles.toolBtnPrimary]}
              onPress={() => setMostrarPanelConteo(true)}
            >
              <Text style={styles.toolBtnLabelPrimary}>
                {mostrarPanelConteo ? 'Ocultar' : 'Panel'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Modal KML */}
      <Modal visible={mostrarModalKML} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🗺️ Importar / Exportar KML</Text>
            <TouchableOpacity style={styles.modalBtn} onPress={handleExportarKML}>
              <Text style={styles.modalBtnIcon}>📤</Text>
              <Text style={styles.modalBtnText}>Exportar polígono a KML</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtn} onPress={handleImportarKML}>
              <Text style={styles.modalBtnIcon}>📥</Text>
              <Text style={styles.modalBtnText}>Importar KML</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setMostrarModalKML(false)}
            >
              <Text style={styles.modalBtnTextCancel}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  // --- Selector de modo ---
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginHorizontal: 4,
    backgroundColor: COLORS.background,
  },
  modeBtnActive: {
    backgroundColor: COLORS.primary + '20',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  modeBtnActiveMedir: {
    backgroundColor: COLORS.secondary + '20',
    borderWidth: 1,
    borderColor: COLORS.secondary,
  },
  modeBtnActiveContar: {
    backgroundColor: COLORS.success + '20',
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  modeIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  modeLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
  },
  modeLabelActive: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  // --- Overlay coordenadas ---
  coordsOverlay: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    backgroundColor: COLORS.surface,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    ...SHADOWS.sm,
  },
  coordsLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
    marginBottom: 2,
  },
  coordsValue: {
    fontSize: FONTS.sizes.xs,
    fontFamily: 'monospace',
    color: COLORS.textPrimary,
  },
  coordsHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  // --- Resultado medición ---
  resultOverlay: {
    position: 'absolute',
    bottom: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.lg,
  },
  resultTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.secondary,
    marginBottom: SPACING.sm,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  resultLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  resultValue: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  resultActions: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  resultBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  resultBtnSecondary: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultBtnText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  resultBtnTextSecondary: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  // --- Panel Conteo ---
  conteoPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.lg,
    borderTopRightRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    maxHeight: 300,
    ...SHADOWS.lg,
  },
  conteoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  conteoTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.success,
  },
  conteoClose: {
    fontSize: 18,
    color: COLORS.textSecondary,
    padding: SPACING.xs,
  },
  conteoList: {
    maxHeight: 160,
  },
  conteoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  conteoInput: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  conteoInputName: {
    flex: 2,
  },
  conteoInputCant: {
    flex: 1,
  },
  conteoDelete: {
    fontSize: 16,
  },
  conteoActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  conteoAddBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.success,
    borderStyle: 'dashed',
  },
  conteoAddText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.success,
    fontWeight: FONTS.weights.medium,
  },
  conteoSaveBtn: {
    flex: 1,
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  conteoSaveText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  // --- Toolbar ---
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    ...SHADOWS.sm,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginRight: SPACING.sm,
  },
  toolBtnDisabled: {
    opacity: 0.5,
  },
  toolBtnPrimary: {
    backgroundColor: COLORS.primary,
  },
  toolBtnIcon: {
    fontSize: 16,
    marginRight: SPACING.xs,
  },
  toolBtnLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  toolBtnLabelPrimary: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
  },
  toolInfo: {
    flex: 1,
  },
  toolInfoText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  // --- Modal ---
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    width: '85%',
    ...SHADOWS.lg,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  modalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
  },
  modalBtnIcon: {
    fontSize: 20,
    marginRight: SPACING.md,
  },
  modalBtnText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  modalBtnCancel: {
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalBtnTextCancel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
});

export default MapaScreen;
