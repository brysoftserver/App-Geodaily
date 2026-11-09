// ============================================================
// GEODAILY — Lista de Borradores o de Verificaciones Completas
// ============================================================
// Borradores: solo los de este dispositivo (nunca suben al servidor).
// Completas: las de este dispositivo (subidas o por subir) + las que el
// usuario completó en otro dispositivo (servidor). Se abren en solo lectura.
// ============================================================

import React, { useCallback, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../../theme';
import { useAuth } from '../../../store/AuthContext';
import { buscarMaterialVerificacion, DatosVerificacion, fechaVerificacionIso } from '../../../data/verificacionesEntrega';
import { confirmar } from '../../../utils/dialogos';
import {
  eliminarVerificacionLocal,
  listarVerificacionesLocales,
  listarVerificacionesServidor,
  VerificacionServidor,
} from '../../../services/verificacionesEntrega.service';

interface Fila {
  id: string;
  datos: DatosVerificacion;
  fecha: string;
  origen: 'local' | 'servidor';
  sincronizado: boolean;
  servidor?: VerificacionServidor;
}

const fechaTxt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const VerificacionListaScreen: React.FC<any> = ({ navigation, route }) => {
  const { user } = useAuth();
  const material = buscarMaterialVerificacion(route?.params?.material);
  const tipo: 'borradores' | 'completas' = route?.params?.tipo === 'completas' ? 'completas' : 'borradores';
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [sinConexion, setSinConexion] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: tipo === 'borradores' ? 'Borradores' : 'Verificaciones Completas' });
  }, [navigation, tipo]);

  const cargar = useCallback(async (esRefresh = false) => {
    if (!material) return;
    if (esRefresh) setRefrescando(true);
    const locales = await listarVerificacionesLocales({ material: material.id, autorId: user?.id, completado: tipo === 'completas' });
    const lista: Fila[] = locales.map((v) => ({
      id: v.id,
      datos: v.datos,
      fecha: tipo === 'borradores' ? v.updated_at : fechaVerificacionIso(v.datos.encabezado?.fecha) || v.created_at,
      origen: 'local',
      sincronizado: v.sincronizado,
    }));
    if (tipo === 'completas') {
      try {
        const remotas = await listarVerificacionesServidor(material.id);
        const ids = new Set(lista.map((f) => f.id));
        for (const r of remotas) {
          if (ids.has(r.id)) continue;
          lista.push({ id: r.id, datos: r.datos, fecha: fechaVerificacionIso(r.datos?.encabezado?.fecha) || r.created_at, origen: 'servidor', sincronizado: true, servidor: r });
        }
        setSinConexion(false);
      } catch {
        setSinConexion(true);
      }
      lista.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    }
    setFilas(lista);
    setCargando(false);
    setRefrescando(false);
  }, [material, tipo, user?.id]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const abrir = (f: Fila) => {
    if (!material) return;
    if (tipo === 'borradores') navigation.navigate('VerificacionForm', { material: material.id, id: f.id });
    else navigation.navigate('VerificacionForm', { material: material.id, id: f.origen === 'local' ? f.id : undefined, servidor: f.servidor, soloLectura: true });
  };

  const descartar = async (f: Fila) => {
    if (!(await confirmar('Eliminar borrador', '¿Eliminar este borrador? Se perderá lo diligenciado.', 'Eliminar', true))) return;
    await eliminarVerificacionLocal(f.id);
    cargar();
  };

  if (!material) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      {cargando ? (
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      ) : (
        <FlatList
          data={filas}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.lista}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
          ListHeaderComponent={
            sinConexion ? <Text style={styles.aviso}>Sin conexión: se muestran solo las de este dispositivo.</Text> : null
          }
          ListEmptyComponent={
            <Text style={styles.vacio}>{tipo === 'borradores' ? 'No tienes borradores.' : 'Aún no has completado verificaciones.'}</Text>
          }
          renderItem={({ item: f }) => {
            const e = f.datos?.encabezado;
            return (
              <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => abrir(f)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.titulo}>{e?.proveedor?.trim() || 'Proveedor sin registrar'}</Text>
                  <Text style={styles.dato}>
                    {e?.puntoRecepcion?.trim() || 'Punto sin registrar'}{e?.remision ? ` · Remisión ${e.remision}` : ''}
                  </Text>
                  <Text style={styles.dato}>
                    {tipo === 'borradores'
                      ? `Guardado ${fechaTxt(f.fecha)}`
                      : e?.fecha?.trim()
                        ? `Fecha: ${e.fecha}`
                        : 'Sin fecha registrada'}
                  </Text>
                  {tipo === 'completas' && (
                    <Text style={[styles.estado, { color: f.sincronizado ? COLORS.success : COLORS.warning }]}>
                      {f.sincronizado ? '☁️ En el servidor' : '📱 Pendiente de subir · se subirá con señal'}
                    </Text>
                  )}
                </View>
                {tipo === 'borradores' ? (
                  <TouchableOpacity onPress={() => descartar(f)} style={styles.btnEliminar}>
                    <Text style={styles.btnEliminarTxt}>Eliminar</Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  lista: { padding: SPACING.md },
  aviso: { fontSize: FONTS.sizes.sm, color: COLORS.warning, marginBottom: SPACING.sm },
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.lg },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, borderLeftColor: COLORS.roleInterventor, ...SHADOWS.sm },
  titulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  estado: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 3 },
  btnEliminar: { borderWidth: 1, borderColor: COLORS.error, borderRadius: BORDER_RADIUS.md, paddingVertical: 4, paddingHorizontal: SPACING.sm, marginLeft: SPACING.sm },
  btnEliminarTxt: { color: COLORS.error, fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold },
  chevron: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
});

export default VerificacionListaScreen;
