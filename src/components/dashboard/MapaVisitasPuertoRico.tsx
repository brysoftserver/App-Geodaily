// ============================================================
// GEODAILY — Mapa de visitas y áreas de cultivo (Puerto Rico, Caquetá)
// ============================================================
// Mapa REAL (teselas OpenStreetMap/CartoDB vía MapViewOffline — el mismo
// componente que usa "Mapa General del Proyecto"), anclado al municipio de
// Puerto Rico (Caquetá). No pide ni muestra la ubicación GPS del
// dispositivo — solo datos ya guardados: puntos de visita (Formulario 1/2,
// con pin clásico) y áreas de cultivo marcadas por los técnicos
// (plantaciones, ícono por especie) para supervisor/interventor.
// Al georreferenciarse con un mapa real, las coordenadas son exactas por
// construcción — no depende de ninguna calibración manual.

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { Formulario } from '../../types';
import { useSyncMapData } from '../../hooks/useSyncMapData';
import { getIconoEspecie } from '../../utils/constants';
import { resolverCorregimiento, NOMBRE_VISIBLE_CORREGIMIENTO } from '../../utils/corregimientos';
import MapViewOffline from '../MapViewOffline';

interface MapaVisitasPuertoRicoProps {
  formularios: Formulario[];
  onVerDetalle: (formulario: Formulario) => void;
}

interface Plantacion {
  id: string;
  especie: string;
  cantidad: number;
  latitud: number;
  longitud: number;
  usuario_nombre?: string;
  created_at?: string;
  poligono?: { latitud: number; longitud: number; orden: number }[] | null;
  beneficiario_nombre?: string | null;
  vereda?: string | null;
  corregimiento?: string | null;
}

/** Mismo centro que MapaGeneralScreen.tsx — cabecera municipal de Puerto Rico, Caquetá. */
const PUERTO_RICO_CENTER = { latitud: 1.914, longitud: -75.145 };
const ZOOM_MUNICIPIO = 13;
const REFRESCO_PLANTACIONES_MS = 45000;

const etiquetaTipo = (tipo: Formulario['tipo']) =>
  tipo === 'visita_tecnica' ? 'Visita Técnica' : 'Encuesta Socioambiental';

const colorPorTipo = (tipo: Formulario['tipo']) =>
  tipo === 'visita_tecnica' ? COLORS.roleTecnico : COLORS.secondary;

const MapaVisitasPuertoRico: React.FC<MapaVisitasPuertoRicoProps> = ({ formularios, onVerDetalle }) => {
  const { plantaciones, fetchAllPlantaciones } = useSyncMapData();
  const [seleccionado, setSeleccionado] = useState<Formulario | null>(null);
  const [plantacionSeleccionada, setPlantacionSeleccionada] = useState<Plantacion | null>(null);
  const enFocoRef = useRef(true);

  useEffect(() => {
    fetchAllPlantaciones();
    const intervalo = setInterval(() => {
      if (enFocoRef.current) fetchAllPlantaciones();
    }, REFRESCO_PLANTACIONES_MS);
    return () => {
      enFocoRef.current = false;
      clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visitaMarkers = useMemo(
    () =>
      formularios
        .filter((f) => typeof f.coordenadas?.latitud === 'number' && typeof f.coordenadas?.longitud === 'number')
        .map((f) => ({
          id: `visita-${f.id}`,
          latitud: f.coordenadas.latitud,
          longitud: f.coordenadas.longitud,
          title: f.beneficiario?.nombre || etiquetaTipo(f.tipo),
          color: colorPorTipo(f.tipo),
          tipoIcono: 'pin' as const,
        })),
    [formularios]
  );

  const plantacionMarkers = useMemo(
    () =>
      (plantaciones as Plantacion[])
        .filter((p) => typeof p.latitud === 'number' && typeof p.longitud === 'number')
        .map((p) => ({
          id: `plantacion-${p.id}`,
          latitud: p.latitud,
          longitud: p.longitud,
          title: `${p.cantidad}x ${p.especie}`,
          icon: getIconoEspecie(p.especie),
        })),
    [plantaciones]
  );

  const allMarkers = useMemo(() => [...visitaMarkers, ...plantacionMarkers], [visitaMarkers, plantacionMarkers]);

  // Polígonos rellenos de las áreas de cultivo que tienen forma trazada
  // (no solo un punto) — mismo estilo que MapaScreen.tsx del técnico.
  const plantacionPoligonos = useMemo(() => {
    const features = (plantaciones as Plantacion[])
      .filter((p) => (p.poligono?.length ?? 0) >= 3)
      .map((p) => {
        const pts = p.poligono!;
        return {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              ...pts.map((pt) => [pt.longitud, pt.latitud]),
              [pts[0].longitud, pts[0].latitud],
            ]],
          },
          properties: { id: p.id, especie: p.especie },
        };
      });
    if (features.length === 0) return [];
    return [{
      id: 'plantaciones-poligonos',
      features,
      fillColor: 'rgba(46, 125, 50, 0.18)',
      strokeColor: '#2E7D32',
      strokeWidth: 2,
      strokeOpacity: 0.75,
      fillOpacity: 0.18,
    }];
  }, [plantaciones]);

  const handleMarkerPress = useCallback(
    (id: string) => {
      if (id.startsWith('visita-')) {
        const realId = id.slice('visita-'.length);
        const f = formularios.find((x) => x.id === realId);
        if (f) setSeleccionado(f);
      } else if (id.startsWith('plantacion-')) {
        const realId = id.slice('plantacion-'.length);
        const p = (plantaciones as Plantacion[]).find((x) => String(x.id) === realId);
        if (p) setPlantacionSeleccionada(p);
      }
    },
    [formularios, plantaciones]
  );

  const totalConCoordenadas = visitaMarkers.length;
  const totalSinCoordenadas = formularios.length - totalConCoordenadas;

  return (
    <View style={styles.card}>
      <Text style={styles.titulo}>Mapa — Puerto Rico (Caquetá)</Text>
      <Text style={styles.subtitulo}>
        {totalConCoordenadas} {totalConCoordenadas === 1 ? 'visita' : 'visitas'} · {plantacionMarkers.length}{' '}
        {plantacionMarkers.length === 1 ? 'área de cultivo' : 'áreas de cultivo'} · toca un punto para ver el detalle
      </Text>

      <MapViewOffline
        center={PUERTO_RICO_CENTER}
        zoom={ZOOM_MUNICIPIO}
        height={340}
        markers={allMarkers}
        mapStyle="relieve"
        showUserLocation={false}
        onMarkerPress={handleMarkerPress}
        geojsonLayers={plantacionPoligonos}
      />

      <View style={styles.leyenda}>
        <View style={styles.leyendaItem}>
          <View style={[styles.leyendaPin, { backgroundColor: COLORS.roleTecnico }]} />
          <Text style={styles.leyendaTexto}>Visita Técnica</Text>
        </View>
        <View style={styles.leyendaItem}>
          <View style={[styles.leyendaPin, { backgroundColor: COLORS.secondary }]} />
          <Text style={styles.leyendaTexto}>Encuesta Socioambiental</Text>
        </View>
        <View style={styles.leyendaItem}>
          <Text style={styles.leyendaEmoji}>🌱</Text>
          <Text style={styles.leyendaTexto}>Área de cultivo</Text>
        </View>
      </View>

      {totalSinCoordenadas > 0 && (
        <Text style={styles.avisoSinCoordenadas}>
          ⚠️ {totalSinCoordenadas} {totalSinCoordenadas === 1 ? 'visita no tiene' : 'visitas no tienen'} coordenadas GPS y no {totalSinCoordenadas === 1 ? 'aparece' : 'aparecen'} en el mapa.
        </Text>
      )}

      {/* Popup de la visita tocada */}
      <Modal visible={!!seleccionado} transparent animationType="fade" onRequestClose={() => setSeleccionado(null)}>
        <Pressable style={styles.overlay} onPress={() => setSeleccionado(null)}>
          <Pressable style={styles.popup} onPress={() => {}}>
            {seleccionado && (
              <>
                <View style={[styles.popupBadge, { backgroundColor: colorPorTipo(seleccionado.tipo) }]}>
                  <Text style={styles.popupBadgeTexto}>{etiquetaTipo(seleccionado.tipo)}</Text>
                </View>
                <Text style={styles.popupNombre}>{seleccionado.beneficiario?.nombre || '—'}</Text>
                <View style={styles.popupFila}>
                  <Text style={styles.popupEtiqueta}>Técnico</Text>
                  <Text style={styles.popupValor}>{seleccionado.tecnico?.nombre || '—'}</Text>
                </View>
                <View style={styles.popupFila}>
                  <Text style={styles.popupEtiqueta}>Vereda</Text>
                  <Text style={styles.popupValor}>{seleccionado.beneficiario?.vereda || '—'}</Text>
                </View>
                <View style={styles.popupFila}>
                  <Text style={styles.popupEtiqueta}>Corregimiento</Text>
                  <Text style={styles.popupValor}>
                    {(() => {
                      const c = resolverCorregimiento(seleccionado);
                      return c ? NOMBRE_VISIBLE_CORREGIMIENTO[c] : 'Sin determinar';
                    })()}
                  </Text>
                </View>
                <View style={styles.popupFila}>
                  <Text style={styles.popupEtiqueta}>Fecha</Text>
                  <Text style={styles.popupValor}>
                    {seleccionado.created_at ? new Date(seleccionado.created_at).toLocaleDateString('es-CO') : '—'}
                  </Text>
                </View>

                <View style={styles.popupBotones}>
                  <TouchableOpacity style={styles.botonSecundario} onPress={() => setSeleccionado(null)}>
                    <Text style={styles.botonSecundarioTexto}>Cerrar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.botonPrimario}
                    onPress={() => {
                      const form = seleccionado;
                      setSeleccionado(null);
                      if (form) onVerDetalle(form);
                    }}
                  >
                    <Text style={styles.botonPrimarioTexto}>Ver detalle completo</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Popup del área de cultivo tocada */}
      <Modal
        visible={!!plantacionSeleccionada}
        transparent
        animationType="fade"
        onRequestClose={() => setPlantacionSeleccionada(null)}
      >
        <Pressable style={styles.overlay} onPress={() => setPlantacionSeleccionada(null)}>
          <Pressable style={styles.popup} onPress={() => {}}>
            {plantacionSeleccionada && (
              <>
                <View style={[styles.popupBadge, { backgroundColor: COLORS.primary }]}>
                  <Text style={styles.popupBadgeTexto}>🌱 Área de cultivo</Text>
                </View>
                <Text style={styles.popupNombre}>{plantacionSeleccionada.especie}</Text>
                <View style={styles.popupFila}>
                  <Text style={styles.popupEtiqueta}>Cantidad</Text>
                  <Text style={styles.popupValor}>{plantacionSeleccionada.cantidad}</Text>
                </View>
                <View style={styles.popupFila}>
                  <Text style={styles.popupEtiqueta}>Técnico</Text>
                  <Text style={styles.popupValor}>{plantacionSeleccionada.usuario_nombre || '—'}</Text>
                </View>
                {!!plantacionSeleccionada.beneficiario_nombre && (
                  <View style={styles.popupFila}>
                    <Text style={styles.popupEtiqueta}>Beneficiario</Text>
                    <Text style={styles.popupValor}>{plantacionSeleccionada.beneficiario_nombre}</Text>
                  </View>
                )}
                {!!plantacionSeleccionada.vereda && (
                  <View style={styles.popupFila}>
                    <Text style={styles.popupEtiqueta}>Vereda</Text>
                    <Text style={styles.popupValor}>{plantacionSeleccionada.vereda}</Text>
                  </View>
                )}
                {!!plantacionSeleccionada.corregimiento && (
                  <View style={styles.popupFila}>
                    <Text style={styles.popupEtiqueta}>Corregimiento</Text>
                    <Text style={styles.popupValor}>{plantacionSeleccionada.corregimiento}</Text>
                  </View>
                )}
                <View style={styles.popupFila}>
                  <Text style={styles.popupEtiqueta}>Fecha</Text>
                  <Text style={styles.popupValor}>
                    {plantacionSeleccionada.created_at
                      ? new Date(plantacionSeleccionada.created_at).toLocaleDateString('es-CO')
                      : '—'}
                  </Text>
                </View>

                <TouchableOpacity style={styles.botonPrimario} onPress={() => setPlantacionSeleccionada(null)}>
                  <Text style={styles.botonPrimarioTexto}>Cerrar</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  titulo: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  subtitulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: SPACING.sm,
    lineHeight: 16,
  },
  leyenda: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
  leyendaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leyendaPin: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: SPACING.xs,
  },
  leyendaEmoji: {
    fontSize: 12,
    marginRight: SPACING.xs,
  },
  leyendaTexto: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  avisoSinCoordenadas: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.warning,
    marginTop: SPACING.sm,
  },
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  popup: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  popupBadge: {
    alignSelf: 'flex-start',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    marginBottom: SPACING.sm,
  },
  popupBadgeTexto: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  popupNombre: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  popupFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  popupEtiqueta: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  popupValor: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
    flexShrink: 1,
    textAlign: 'right',
  },
  popupBotones: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  botonSecundario: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  botonSecundarioTexto: {
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  botonPrimario: {
    marginTop: SPACING.md,
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  botonPrimarioTexto: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
  },
});

export default MapaVisitasPuertoRico;
