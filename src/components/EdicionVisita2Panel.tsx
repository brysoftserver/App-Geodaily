// ============================================================
// GEODAILY — Panel de edición de la Visita 2 (admin autorizado)
// ============================================================
// Se muestra en el detalle de una Visita 2 (formato v2) SOLO si el servidor
// confirma que el usuario puede editarla (/api/edicion-visitas/permiso).
//   · "✎ Corregir" junto a cada respuesta (campo por campo).
//   · Polígono 1 y (opcional) polígono 2: desde una medición del técnico o
//     subiendo un archivo KML/KMZ si no está guardado. El 2 se puede quitar.
// Cada cambio se guarda en el servidor al momento y devuelve la actividad
// actualizada para refrescar el detalle (onActualizada).
// ============================================================

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import { ActividadRealizada } from '../types';
import { avisar, confirmar } from '../utils/dialogos';
import { leerPoligonoDeArchivo } from '../utils/kmlPoligono';
import {
  CAMPOS_VISITA_2,
  cargarPoligonoVisita2,
  corregirCampoVisita2,
  DefCampoVisita2,
  listarMedicionesVisita2,
  MedicionDisponible,
  obtenerPermisoEdicionVisita2,
  PosicionPoligono,
  quitarPoligono2Visita2,
} from '../services/edicionVisitas.service';

interface Props {
  formularioId: string;
  actividad: ActividadRealizada;
  onActualizada: (actividad: ActividadRealizada) => void;
}

/** ¿Es una Visita 2 del formato nuevo (la única que se edita aquí)? */
export const esVisita2Editable = (a?: ActividadRealizada | null): boolean =>
  !!a && Number(a.visita_numero) === 2 && a.formato_visita === 'v2';

const mensajeError = (e: any) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Editar la visita requiere internet.' : 'Inténtalo de nuevo.');

const EdicionVisita2Panel: React.FC<Props> = ({ formularioId, actividad, onActualizada }) => {
  const insets = useSafeAreaInsets();
  const [permitido, setPermitido] = useState(false);
  const [editando, setEditando] = useState<DefCampoVisita2 | null>(null);
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mediciones, setMediciones] = useState<{ actual: string | null; actual2: string | null; lista: MedicionDisponible[] } | null>(null);
  // Polígono que se está cargando (1 o 2): primero se elige el origen.
  const [posicion, setPosicion] = useState<PosicionPoligono | null>(null);
  const [eligiendoOrigen, setEligiendoOrigen] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    if (esVisita2Editable(actividad)) obtenerPermisoEdicionVisita2().then((p) => vivo && setPermitido(p));
    return () => { vivo = false; };
  }, [actividad]);

  if (!permitido || !esVisita2Editable(actividad)) return null;

  const abrirEditor = (def: DefCampoVisita2) => {
    setTexto(def.leer(actividad));
    setEditando(def);
  };

  const guardar = async () => {
    if (!editando || guardando) return;
    setGuardando(true);
    try {
      const nueva = await corregirCampoVisita2(formularioId, editando.campo, texto);
      onActualizada(nueva);
      setEditando(null);
    } catch (e) {
      avisar('No se pudo guardar', mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  const fmtHa = (n?: number) => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });

  const iniciarCarga = (p: PosicionPoligono) => {
    setPosicion(p);
    setEligiendoOrigen(true);
  };

  const abrirMediciones = async () => {
    setEligiendoOrigen(false);
    setOcupado('mediciones');
    try {
      const r = await listarMedicionesVisita2(formularioId);
      setMediciones({ actual: r.actual, actual2: r.actual2, lista: r.mediciones });
    } catch (e) {
      avisar('No se pudieron cargar las mediciones', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  const aplicarMedicion = async (m: MedicionDisponible) => {
    if (ocupado || !posicion) return;
    setOcupado(m.id);
    try {
      const nueva = await cargarPoligonoVisita2(formularioId, posicion, { medicionId: m.id });
      onActualizada(nueva);
      setMediciones(null);
      avisar(`Polígono ${posicion} cargado`, `Se cargó "${m.nombre}" (${fmtHa(m.area_hectareas)} ha).`);
    } catch (e) {
      avisar('No se pudo cargar el polígono', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  /** Sube un KML/KMZ que no esté guardado como medición. */
  const subirKml = async () => {
    setEligiendoOrigen(false);
    if (!posicion) return;
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const archivo = r.assets[0];
    if (!/\.(kml|kmz)$/i.test(archivo.name || '')) {
      avisar('Archivo no válido', 'Elige un archivo .kml o .kmz (por ejemplo, exportado de Google Earth).');
      return;
    }
    setOcupado('kml');
    try {
      const poligono = await leerPoligonoDeArchivo({ uri: archivo.uri, name: archivo.name });
      if (!poligono) {
        avisar('Sin polígono', 'El archivo no trae un polígono con al menos 3 puntos.');
        return;
      }
      const nueva = await cargarPoligonoVisita2(formularioId, posicion, { kml: poligono });
      onActualizada(nueva);
      const cargado = posicion === 1 ? nueva.medicion_historial : nueva.medicion_historial_2;
      avisar(`Polígono ${posicion} cargado`, `Se cargó "${poligono.nombre}" desde el archivo (${poligono.puntos.length} puntos, ${fmtHa(cargado?.area_hectareas)} ha).`);
    } catch (e) {
      avisar('No se pudo leer el archivo', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  const quitarPoligono2 = async () => {
    if (!(await confirmar('Quitar polígono 2', '¿Quitar el segundo polígono de esta visita?', 'Quitar', true))) return;
    setOcupado('quitar');
    try {
      onActualizada(await quitarPoligono2Visita2(formularioId));
    } catch (e) {
      avisar('No se pudo quitar', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  const filaPoligono = (p: PosicionPoligono) => {
    const m = p === 1 ? actividad.medicion_historial : actividad.medicion_historial_2;
    return (
      <View key={p} style={styles.fila}>
        <View style={{ flex: 1 }}>
          <Text style={styles.etiqueta}>{p === 1 ? 'Polígono 1 (ítem 4)' : 'Polígono 2 (opcional)'}</Text>
          <Text style={[styles.valor, !m && styles.vacio]}>
            {m ? `${m.nombre} · ${fmtHa(m.area_hectareas)} ha${m.origen === 'kml' ? ' · desde KML' : ''}` : p === 1 ? 'Sin polígono cargado' : 'Sin segundo polígono'}
          </Text>
        </View>
        <View style={{ gap: 6 }}>
          <TouchableOpacity style={styles.btnCorregir} onPress={() => iniciarCarga(p)} disabled={!!ocupado}>
            {ocupado && posicion === p && ocupado !== 'quitar' ? <ActivityIndicator size="small" color={COLORS.roleAdmin} /> : <Text style={styles.btnCorregirTxt}>🗺️ {m ? 'Cambiar' : 'Cargar'}</Text>}
          </TouchableOpacity>
          {p === 2 && m && (
            <TouchableOpacity style={[styles.btnCorregir, { borderColor: COLORS.error }]} onPress={quitarPoligono2} disabled={!!ocupado}>
              {ocupado === 'quitar' ? <ActivityIndicator size="small" color={COLORS.error} /> : <Text style={[styles.btnCorregirTxt, { color: COLORS.error }]}>Quitar</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const teclado = editando?.tipo === 'porcentaje' ? 'number-pad' : editando?.tipo === 'area' ? 'decimal-pad' : 'default';
  const multilinea = editando?.tipo === 'texto' || editando?.tipo === 'lista';

  return (
    <View style={styles.panel}>
      <Text style={styles.titulo}>🛠️ Edición de administrador — Visita 2</Text>
      <Text style={styles.ayuda}>Cada corrección se guarda en el servidor y queda registrada a tu nombre.</Text>

      {CAMPOS_VISITA_2.map((def) => {
        const valor = def.leer(actividad);
        return (
          <View key={def.campo} style={styles.fila}>
            <View style={{ flex: 1 }}>
              <Text style={styles.etiqueta}>{def.titulo}</Text>
              <Text style={[styles.valor, !valor && styles.vacio]} numberOfLines={3}>{valor || 'Sin responder'}</Text>
            </View>
            <TouchableOpacity style={styles.btnCorregir} onPress={() => abrirEditor(def)}>
              <Text style={styles.btnCorregirTxt}>✎ {valor ? 'Corregir' : 'Completar'}</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {filaPoligono(1)}
      {filaPoligono(2)}

      {/* Editor de un campo */}
      <Modal visible={editando !== null} transparent animationType="fade" onRequestClose={() => setEditando(null)}>
        <View style={styles.modalFondo}>
          <View style={styles.modalCaja}>
            <Text style={styles.modalTitulo}>{editando?.titulo}</Text>
            <TextInput
              style={[styles.input, multilinea && styles.inputMulti]}
              value={texto}
              onChangeText={setTexto}
              multiline={multilinea}
              keyboardType={teclado as any}
              autoFocus
              placeholder={editando?.tipo === 'lista' ? 'Un compromiso por línea (vacío = sin compromisos)' : 'Escribe la respuesta'}
              placeholderTextColor={COLORS.textLight}
            />
            <View style={styles.modalBotones}>
              <TouchableOpacity style={styles.btnSec} onPress={() => setEditando(null)} disabled={guardando}>
                <Text style={styles.btnSecTxt}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnPri, guardando && { opacity: 0.6 }]} onPress={guardar} disabled={guardando}>
                {guardando ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPriTxt}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ¿De dónde cargar el polígono? */}
      <Modal visible={eligiendoOrigen} transparent animationType="fade" onRequestClose={() => setEligiendoOrigen(false)}>
        <View style={styles.modalFondo}>
          <View style={styles.modalCaja}>
            <Text style={styles.modalTitulo}>Cargar polígono {posicion}</Text>
            <TouchableOpacity style={styles.opcion} onPress={abrirMediciones}>
              <Text style={styles.opcionTitulo}>📏 Elegir una medición del técnico</Text>
              <Text style={styles.opcionTxt}>Mediciones ya guardadas en la app</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.opcion} onPress={subirKml}>
              <Text style={styles.opcionTitulo}>📂 Subir archivo KML / KMZ</Text>
              <Text style={styles.opcionTxt}>Si el polígono no está guardado (ej. exportado de Google Earth)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSec} onPress={() => setEligiendoOrigen(false)}>
              <Text style={styles.btnSecTxt}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Elegir medición */}
      <Modal visible={mediciones !== null} animationType="slide" onRequestClose={() => setMediciones(null)}>
        <View style={[styles.lista, { paddingTop: insets.top + SPACING.sm }]}>
          <View style={styles.listaCabecera}>
            <Text style={styles.modalTitulo}>Medición para el polígono {posicion}</Text>
            <TouchableOpacity onPress={() => setMediciones(null)}><Text style={styles.enlace}>Cerrar</Text></TouchableOpacity>
          </View>
          <FlatList
            data={mediciones?.lista ?? []}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + SPACING.xl }}
            ListEmptyComponent={<Text style={styles.vacioLista}>El técnico de esta visita no tiene mediciones con polígono (mínimo 3 puntos).</Text>}
            renderItem={({ item: m }) => {
              const actual = (posicion === 2 ? mediciones?.actual2 : mediciones?.actual) === m.id;
              const enLaOtra = (posicion === 2 ? mediciones?.actual : mediciones?.actual2) === m.id;
              return (
                <TouchableOpacity
                  style={[styles.medicion, actual && styles.medicionActual, enLaOtra && { opacity: 0.5 }]}
                  onPress={() => aplicarMedicion(m)}
                  disabled={!!ocupado || enLaOtra}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medNombre}>{m.nombre}</Text>
                    <Text style={styles.medDato}>
                      {m.area_hectareas.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ha · {m.puntos.length} puntos
                      {m.created_at ? ` · ${new Date(m.created_at).toLocaleDateString('es-CO')}` : ''}
                    </Text>
                    {m.delBeneficiario && <Text style={styles.medEtiqueta}>✓ Tomada para este beneficiario</Text>}
                    {actual && <Text style={styles.medEtiqueta}>● Es la cargada actualmente</Text>}
                    {enLaOtra && <Text style={styles.medDato}>Ya está en el polígono {posicion === 2 ? 1 : 2}</Text>}
                  </View>
                  {ocupado === m.id ? <ActivityIndicator color={COLORS.roleAdmin} /> : <Text style={styles.enlace}>Usar</Text>}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: { marginTop: SPACING.md, padding: SPACING.md, borderRadius: BORDER_RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.roleAdmin, backgroundColor: '#FFF5F5' },
  titulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.roleAdmin },
  ayuda: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2, marginBottom: SPACING.sm },
  fila: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  etiqueta: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLORS.textSecondary },
  valor: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, marginTop: 2 },
  vacio: { color: COLORS.textLight, fontStyle: 'italic' },
  btnCorregir: { borderWidth: 1, borderColor: COLORS.roleAdmin, borderRadius: BORDER_RADIUS.md, paddingVertical: 6, paddingHorizontal: SPACING.sm, marginLeft: SPACING.sm, minWidth: 90, alignItems: 'center' },
  btnCorregirTxt: { color: COLORS.roleAdmin, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.xs },
  modalFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: SPACING.lg },
  modalCaja: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, gap: SPACING.sm },
  modalTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, color: COLORS.textPrimary, fontSize: FONTS.sizes.sm },
  inputMulti: { minHeight: 110, textAlignVertical: 'top' },
  modalBotones: { flexDirection: 'row', gap: SPACING.sm },
  btnSec: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center' },
  btnSecTxt: { color: COLORS.textSecondary, fontWeight: FONTS.weights.semibold },
  btnPri: { flex: 1, backgroundColor: COLORS.roleAdmin, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center' },
  btnPriTxt: { color: '#fff', fontWeight: FONTS.weights.bold },
  lista: { flex: 1, backgroundColor: COLORS.background },
  listaCabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.md },
  enlace: { color: COLORS.roleAdmin, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm, marginLeft: SPACING.sm },
  vacioLista: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.lg },
  medicion: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, borderLeftColor: COLORS.border },
  medicionActual: { borderLeftColor: COLORS.roleAdmin },
  medNombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  medDato: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  opcion: { borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, padding: SPACING.md },
  opcionTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  opcionTxt: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  medEtiqueta: { fontSize: FONTS.sizes.xs, color: COLORS.success, fontWeight: FONTS.weights.semibold, marginTop: 2 },
});

export default EdicionVisita2Panel;
