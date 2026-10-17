// ============================================================
// GEODAILY — Captura de una medición de terreno
// ============================================================
// Muestra una "foto" estática de un polígono medido: fondo de teselas
// Esri/ArcGIS (las mismas del mapa en vivo) y encima el polígono dibujado
// con SVG a partir de las coordenadas guardadas.
//
// Se usa en el formulario de visita técnica (ítem 4, al elegir una
// medición del historial) y en el Detalle del Formulario, para que el
// coordinador o el interventor puedan ver el área medida y abrirla en
// Google Earth sin tener que ir al mapa.
//
// Sin internet las teselas no cargan: el polígono se sigue viendo sobre un
// fondo neutro (nunca bloquea ni rompe la pantalla).
// ============================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { COLORS, FONTS, BORDER_RADIUS, SPACING } from '../theme';
import { construirVistaMapa } from '../utils/staticMap';
import { abrirKMLEnGoogleEarth } from '../services/googleEarth.service';

const TAMANO_TESELA = 256;
/** Alto reservado al pie (nombre + área/perímetro + coordenadas). */
const ALTURA_PIE = 56;

export interface MedicionCapturaDatos {
  nombre?: string | null;
  area_hectareas?: number;
  area_metros2?: number;
  perimetro_metros?: number;
  puntos: { latitud: number; longitud: number }[];
  created_at?: string;
}

interface Props {
  medicion: MedicionCapturaDatos;
  /** Alto del recuadro del mapa en píxeles. */
  altura?: number;
  /** Muestra los botones «Abrir en Google Earth» / «Compartir KML». */
  mostrarAcciones?: boolean;
  /** Título opcional encima de la captura. */
  titulo?: string;
}

const formatearNumero = (valor?: number, decimales = 1) =>
  typeof valor === 'number' && Number.isFinite(valor)
    ? valor.toLocaleString('es-CO', { maximumFractionDigits: decimales })
    : '—';

const MedicionCaptura: React.FC<Props> = ({
  medicion,
  altura = 180,
  mostrarAcciones = true,
  titulo,
}) => {
  const [ancho, setAncho] = useState(0);
  const [teselasConError, setTeselasConError] = useState(0);
  const [abriendoEarth, setAbriendoEarth] = useState(false);

  const puntos = useMemo(
    () =>
      (medicion.puntos || []).filter(
        (p) => Number.isFinite(p?.latitud) && Number.isFinite(p?.longitud)
      ),
    [medicion.puntos]
  );

  // Máximo 3×3 teselas: suficiente para ver el predio y no castigar los datos.
  // Fondo satélite: es el mismo mapa que el técnico ve al trazar el área
  // (World_Imagery). El relieve claro de los PDF no tiene datos a partir de
  // zoom 17 y devolvía teselas grises «Map data not yet available».
  const vista = useMemo(() => construirVistaMapa(puntos, 3, 'satelite'), [puntos]);

  // Centro del área medida: es la coordenada que se muestra en el pie.
  const centro = useMemo(() => {
    if (puntos.length === 0) return null;
    const suma = puntos.reduce(
      (acc, p) => ({ lat: acc.lat + p.latitud, lon: acc.lon + p.longitud }),
      { lat: 0, lon: 0 }
    );
    return { latitud: suma.lat / puntos.length, longitud: suma.lon / puntos.length };
  }, [puntos]);

  // El mapa se dibuja por encima del pie, para que el polígono no quede tapado.
  const alturaMapa = Math.max(altura - ALTURA_PIE, 80);

  const escala = useMemo(() => {
    if (!vista || ancho <= 0) return 1;
    return Math.min(ancho / vista.anchoPx, alturaMapa / vista.altoPx);
  }, [vista, ancho, alturaMapa]);

  const desplazamiento = useMemo(() => {
    if (!vista || ancho <= 0) return { x: 0, y: 0 };
    return {
      x: (ancho - vista.anchoPx * escala) / 2,
      y: (alturaMapa - vista.altoPx * escala) / 2,
    };
  }, [vista, ancho, alturaMapa, escala]);

  const poligonoPuntos = useMemo(() => {
    if (!vista) return '';
    return puntos
      .map((p) => {
        const proyectado = vista.proyectar(p.latitud, p.longitud);
        return `${desplazamiento.x + proyectado.x * escala},${desplazamiento.y + proyectado.y * escala}`;
      })
      .join(' ');
  }, [vista, puntos, escala, desplazamiento]);

  const totalTeselas = vista ? vista.columnas * vista.filas : 0;
  const sinMapa = totalTeselas > 0 && teselasConError >= totalTeselas;

  // Si cambia la medición mostrada, se vuelve a intentar cargar el fondo.
  useEffect(() => {
    setTeselasConError(0);
  }, [vista]);

  const handleAbrirEarth = useCallback(async () => {
    if (puntos.length < 3) {
      Alert.alert(
        'Área incompleta',
        'Esta medición no tiene un polígono (3 puntos o más), así que no se puede abrir como área en Google Earth.'
      );
      return;
    }
    setAbriendoEarth(true);
    try {
      const abierto = await abrirKMLEnGoogleEarth(
        medicion.nombre || 'Medición de terreno',
        puntos
      );
      if (!abierto) {
        Alert.alert(
          'No se pudo abrir',
          'No se encontró una aplicación para abrir el KML. Instala Google Earth o comparte el archivo desde el mapa.'
        );
      }
    } finally {
      setAbriendoEarth(false);
    }
  }, [medicion.nombre, puntos]);

  if (puntos.length === 0) {
    return (
      <View style={[styles.contenedor, styles.contenedorVacio, { height: altura }]}>
        <Text style={styles.textoVacio}>Esta medición no tiene coordenadas guardadas.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {!!titulo && <Text style={styles.titulo}>{titulo}</Text>}

      <View
        style={[styles.contenedor, { height: altura }]}
        onLayout={(e) => setAncho(e.nativeEvent.layout.width)}
      >
        {/* Fondo: teselas del mapa (se ven solo con conexión). */}
        {!!vista &&
          !sinMapa &&
          Array.from({ length: vista.columnas }).map((_, col) =>
            Array.from({ length: vista.filas }).map((__, fila) => {
              const x = vista.xMin + col;
              const y = vista.yMin + fila;
              return (
                <Image
                  key={`t-${x}-${y}`}
                  source={{ uri: vista.urlTesela(x, y) }}
                  style={{
                    position: 'absolute',
                    left: desplazamiento.x + col * TAMANO_TESELA * escala,
                    top: desplazamiento.y + fila * TAMANO_TESELA * escala,
                    width: TAMANO_TESELA * escala,
                    height: TAMANO_TESELA * escala,
                  }}
                  resizeMode="cover"
                  onError={() => setTeselasConError((prev) => prev + 1)}
                />
              );
            })
          )}

        {/* Polígono medido, siempre visible (aunque no haya teselas). */}
        {ancho > 0 && (
          <Svg width={ancho} height={alturaMapa} style={StyleSheet.absoluteFill}>
            {puntos.length >= 3 && (
              <Polygon
                points={poligonoPuntos}
                fill="rgba(27, 94, 32, 0.22)"
                stroke="#1B5E20"
                strokeWidth={2.5}
              />
            )}
            {puntos.length === 2 && (
              <Polygon
                points={poligonoPuntos}
                fill="none"
                stroke="#1B5E20"
                strokeWidth={2.5}
              />
            )}
            {puntos.map((p, i) => {
              const proyectado = vista ? vista.proyectar(p.latitud, p.longitud) : null;
              if (!proyectado) return null;
              return (
                <Circle
                  key={`p-${i}`}
                  cx={desplazamiento.x + proyectado.x * escala}
                  cy={desplazamiento.y + proyectado.y * escala}
                  r={i === 0 ? 5 : 3.5}
                  fill={i === 0 ? '#1B5E20' : '#FFFFFF'}
                  stroke="#1B5E20"
                  strokeWidth={1.5}
                />
              );
            })}
          </Svg>
        )}

        {sinMapa && (
          <View style={styles.avisoSinMapa}>
            <Text style={styles.avisoSinMapaTexto}>
              Mapa no disponible sin conexión — el área medida se ve abajo
            </Text>
          </View>
        )}

        {/* Pie con los datos de la medición. */}
        <View style={styles.pie}>
          <Text style={styles.pieNombre} numberOfLines={1}>
            {medicion.nombre || 'Medición de terreno'}
          </Text>
          <Text style={styles.pieDetalle} numberOfLines={1}>
            {typeof medicion.area_hectareas === 'number' && medicion.area_hectareas > 0
              ? `📐 ${formatearNumero(medicion.area_hectareas, 2)} ha · perímetro ${formatearNumero(medicion.perimetro_metros, 0)} m`
              : `📏 ${formatearNumero(medicion.perimetro_metros, 0)} m`}
            {' · '}
            {puntos.length} punto(s)
          </Text>
          {!!centro && (
            <Text style={styles.pieCoordenadas} numberOfLines={1}>
              📍 Lat {centro.latitud.toFixed(6)} · Lon {centro.longitud.toFixed(6)}
            </Text>
          )}
        </View>
      </View>

      {mostrarAcciones && (
        <View style={styles.acciones}>
          <TouchableOpacity
            style={[styles.accionBtn, (abriendoEarth || puntos.length < 3) && styles.accionBtnDisabled]}
            onPress={handleAbrirEarth}
            disabled={abriendoEarth || puntos.length < 3}
            activeOpacity={0.8}
          >
            <Text style={styles.accionBtnText}>
              {abriendoEarth ? 'Abriendo…' : '🌍 Abrir en Google Earth'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginTop: SPACING.sm,
  },
  titulo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  contenedor: {
    width: '100%',
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: '#E9EEF2',
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  contenedorVacio: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  textoVacio: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  avisoSinMapa: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
  },
  avisoSinMapaTexto: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  pie: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  pieNombre: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  pieDetalle: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  pieCoordenadas: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
    marginTop: 1,
  },
  acciones: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  accionBtn: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  accionBtnDisabled: {
    opacity: 0.5,
  },
  accionBtnText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
});

export default MedicionCaptura;
