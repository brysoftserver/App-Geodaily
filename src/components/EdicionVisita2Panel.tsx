// ============================================================
// GEODAILY — Panel de edición de la Visita 2 (admin autorizado)
// ============================================================
// Se muestra en el detalle de una Visita 2 (formato v2) SOLO si el servidor
// confirma que el usuario puede editarla (/api/edicion-visitas/permiso).
//   · "✎ Corregir" junto a cada respuesta (campo por campo).
//   · Polígonos de la visita (uno o varios lotes): agregar, cambiar o quitar,
//     desde una medición del técnico o subiendo un archivo KML/KMZ.
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
import { formatFechaHoraColombia } from '../utils/formatters';
import { MAX_POLIGONOS_VISITA, medicionesDeVisita, sumaHectareas } from '../utils/medicionesVisita';
import {
  CAMPOS_VISITA_2,
  cargarPoligonoVisita2,
  corregirCampoVisita2,
  DefCampoVisita2,
  guardarSeleccionPoligonosVisita2,
  listarMedicionesVisita2,
  MedicionDisponible,
  obtenerPermisoEdicionVisita2,
  quitarPoligonoVisita2,
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
  const [mediciones, setMediciones] = useState<{ actuales: string[]; lista: MedicionDisponible[] } | null>(null);
  // Polígono que se está cargando: 1..N reemplaza, 0 = agregar uno nuevo.
  const [posicion, setPosicion] = useState<number | null>(null);
  const [eligiendoOrigen, setEligiendoOrigen] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Selección múltiple (al agregar): ids marcados, en el orden en que se marcaron.
  const [seleccion, setSeleccion] = useState<string[]>([]);

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

  const poligonos = medicionesDeVisita(actividad);
  const tituloCarga = posicion ? `Cambiar polígono ${posicion}` : 'Agregar polígonos';

  const iniciarCarga = (p: number) => {
    setPosicion(p);
    setEligiendoOrigen(true);
  };

  const abrirMediciones = async () => {
    setEligiendoOrigen(false);
    setOcupado('mediciones');
    try {
      const r = await listarMedicionesVisita2(formularioId);
      setMediciones({ actuales: r.actuales, lista: r.mediciones });
      // Las ya adjuntas aparecen marcadas: desmarcarlas las quita.
      setSeleccion(r.actuales.filter((id) => r.mediciones.some((m) => m.id === id)));
    } catch (e) {
      avisar('No se pudieron cargar las mediciones', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  const aplicarMedicion = async (m: MedicionDisponible) => {
    if (ocupado || posicion == null) return;
    setOcupado(m.id);
    try {
      const nueva = await cargarPoligonoVisita2(formularioId, posicion || null, { medicionId: m.id });
      onActualizada(nueva);
      setMediciones(null);
      avisar(posicion ? `Polígono ${posicion} cambiado` : 'Polígono agregado', `Se cargó "${m.nombre}" (${fmtHa(m.area_hectareas)} ha).`);
    } catch (e) {
      avisar('No se pudo cargar el polígono', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  const multiple = posicion === 0;
  const alternar = (id: string) =>
    setSeleccion((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  /** Polígonos que quedarían: los que no están en la lista (KML, etc.) + los marcados. */
  const totalQuedaria = (() => {
    if (!mediciones) return { n: 0, ha: 0 };
    const enLista = new Set(mediciones.lista.map((m) => m.id));
    const fijos = poligonos.filter((p) => !enLista.has(p.id));
    const marcadas = mediciones.lista.filter((m) => seleccion.includes(m.id));
    return { n: fijos.length + marcadas.length, ha: sumaHectareas([...fijos, ...marcadas]) };
  })();

  const guardarSeleccion = async () => {
    if (ocupado) return;
    if (totalQuedaria.n > MAX_POLIGONOS_VISITA) {
      avisar('Demasiados polígonos', `Máximo ${MAX_POLIGONOS_VISITA} polígonos por visita.`);
      return;
    }
    setOcupado('seleccion');
    try {
      const nueva = await guardarSeleccionPoligonosVisita2(formularioId, seleccion);
      onActualizada(nueva);
      setMediciones(null);
      const lista = medicionesDeVisita(nueva);
      avisar('Polígonos guardados', `La visita queda con ${lista.length} polígono(s) · ${fmtHa(sumaHectareas(lista))} ha.`);
    } catch (e) {
      avisar('No se pudieron guardar los polígonos', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  /** Sube un KML/KMZ que no esté guardado como medición. */
  const subirKml = async () => {
    setEligiendoOrigen(false);
    if (posicion == null) return;
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
      const nueva = await cargarPoligonoVisita2(formularioId, posicion || null, { kml: poligono });
      onActualizada(nueva);
      const lista = medicionesDeVisita(nueva);
      const cargado = posicion ? lista[posicion - 1] : lista[lista.length - 1];
      avisar(posicion ? `Polígono ${posicion} cambiado` : 'Polígono agregado', `Se cargó "${poligono.nombre}" desde el archivo (${poligono.puntos.length} puntos, ${fmtHa(cargado?.area_hectareas)} ha).`);
    } catch (e) {
      avisar('No se pudo leer el archivo', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  const quitarPoligono = async (p: number) => {
    const m = poligonos[p - 1];
    if (!(await confirmar(`Quitar polígono ${p}`, `¿Quitar "${m?.nombre || 'el polígono'}" de esta visita?`, 'Quitar', true))) return;
    setOcupado(`quitar-${p}`);
    try {
      onActualizada(await quitarPoligonoVisita2(formularioId, p));
    } catch (e) {
      avisar('No se pudo quitar', mensajeError(e));
    } finally {
      setOcupado(null);
    }
  };

  const filaPoligono = (m: (typeof poligonos)[number], idx: number) => {
    const p = idx + 1;
    return (
      <View key={`${m.id}-${p}`} style={styles.fila}>
        <View style={{ flex: 1 }}>
          <Text style={styles.etiqueta}>Polígono {p}{p === 1 ? ' (ítem 4)' : ''}</Text>
          <Text style={styles.valor}>
            {`${m.nombre} · ${fmtHa(m.area_hectareas)} ha${m.origen === 'kml' ? ' · desde KML' : ''}`}
          </Text>
        </View>
        <View style={{ gap: 6 }}>
          <TouchableOpacity style={styles.btnCorregir} onPress={() => iniciarCarga(p)} disabled={!!ocupado}>
            {ocupado && posicion === p && !ocupado.startsWith('quitar') ? <ActivityIndicator size="small" color={COLORS.roleAdmin} /> : <Text style={styles.btnCorregirTxt}>🗺️ Cambiar</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btnCorregir, { borderColor: COLORS.error }]} onPress={() => quitarPoligono(p)} disabled={!!ocupado}>
            {ocupado === `quitar-${p}` ? <ActivityIndicator size="small" color={COLORS.error} /> : <Text style={[styles.btnCorregirTxt, { color: COLORS.error }]}>Quitar</Text>}
          </TouchableOpacity>
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

      <View style={styles.fila}>
        <View style={{ flex: 1 }}>
          <Text style={styles.etiqueta}>Polígonos de la visita</Text>
          <Text style={[styles.valor, poligonos.length === 0 && styles.vacio]}>
            {poligonos.length === 0
              ? 'Sin polígono cargado'
              : `${poligonos.length} · total ${fmtHa(sumaHectareas(poligonos))} ha`}
          </Text>
        </View>
        <TouchableOpacity style={styles.btnCorregir} onPress={() => iniciarCarga(0)} disabled={!!ocupado}>
          {ocupado && posicion === 0 ? <ActivityIndicator size="small" color={COLORS.roleAdmin} /> : <Text style={styles.btnCorregirTxt}>＋ Elegir</Text>}
        </TouchableOpacity>
      </View>
      {poligonos.map(filaPoligono)}

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
            <Text style={styles.modalTitulo}>{tituloCarga}</Text>
            <TouchableOpacity style={styles.opcion} onPress={abrirMediciones}>
              <Text style={styles.opcionTitulo}>📏 {posicion ? 'Elegir una medición del técnico' : 'Elegir mediciones del técnico'}</Text>
              <Text style={styles.opcionTxt}>{posicion ? 'Mediciones ya guardadas en la app' : 'Puedes marcar varias (lotes separados del mismo predio)'}</Text>
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
            <Text style={styles.modalTitulo}>{posicion ? `Medición para el polígono ${posicion}` : 'Polígonos de la visita'}</Text>
            <TouchableOpacity onPress={() => setMediciones(null)}><Text style={styles.enlace}>Cerrar</Text></TouchableOpacity>
          </View>
          <FlatList
            data={mediciones?.lista ?? []}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + SPACING.xl }}
            ListHeaderComponent={
              <Text style={[styles.medDato, { marginBottom: SPACING.sm }]}>
                {multiple ? 'Marca todas las mediciones que correspondan a la visita (las ya adjuntas vienen marcadas; desmarcar una la quita). ' : ''}
                Se muestran las mediciones del técnico para este beneficiario y las antiguas sin beneficiario que quedan a menos de 500 m de la visita.
              </Text>
            }
            ListEmptyComponent={<Text style={styles.vacioLista}>El técnico no tiene mediciones de este beneficiario ni cercanas a la visita. Puedes subir un archivo KML/KMZ.</Text>}
            renderItem={({ item: m }) => {
              const datos = (
                <>
                  <Text style={styles.medNombre}>{m.nombre}</Text>
                  <Text style={styles.medDato}>
                    {m.area_hectareas.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ha · {m.puntos.length} puntos
                    {m.created_at ? ` · ${formatFechaHoraColombia(m.created_at)}` : ''}
                  </Text>
                  {m.delBeneficiario && <Text style={styles.medEtiqueta}>✓ Tomada para este beneficiario</Text>}
                  {m.cercana && <Text style={styles.medCercana}>Sin beneficiario asignado · a {m.distancia_m ?? 0} m de la visita</Text>}
                </>
              );
              if (multiple) {
                const marcada = seleccion.includes(m.id);
                return (
                  <TouchableOpacity
                    style={[styles.medicion, marcada && styles.medicionActual]}
                    onPress={() => alternar(m.id)}
                    disabled={!!ocupado}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: marcada }}
                  >
                    <Text style={[styles.check, marcada && { color: COLORS.roleAdmin }]}>{marcada ? '☑' : '☐'}</Text>
                    <View style={{ flex: 1 }}>{datos}</View>
                  </TouchableOpacity>
                );
              }
              const idxActual = mediciones?.actuales.indexOf(m.id) ?? -1;
              const actual = !!posicion && idxActual === posicion - 1;
              const enLaOtra = idxActual >= 0 && !actual;
              return (
                <TouchableOpacity
                  style={[styles.medicion, actual && styles.medicionActual, enLaOtra && { opacity: 0.5 }]}
                  onPress={() => aplicarMedicion(m)}
                  disabled={!!ocupado || enLaOtra}
                >
                  <View style={{ flex: 1 }}>
                    {datos}
                    {actual && <Text style={styles.medEtiqueta}>● Es la cargada actualmente</Text>}
                    {enLaOtra && <Text style={styles.medDato}>Ya está cargada como polígono {idxActual + 1}</Text>}
                  </View>
                  {ocupado === m.id ? <ActivityIndicator color={COLORS.roleAdmin} /> : <Text style={styles.enlace}>Usar</Text>}
                </TouchableOpacity>
              );
            }}
          />
          {multiple && (mediciones?.lista.length ?? 0) > 0 && (
            <View style={[styles.pie, { paddingBottom: insets.bottom + SPACING.sm }]}>
              <TouchableOpacity
                style={[styles.btnPri, (ocupado || totalQuedaria.n > MAX_POLIGONOS_VISITA) && { opacity: 0.6 }]}
                onPress={guardarSeleccion}
                disabled={!!ocupado}
              >
                {ocupado === 'seleccion' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.btnPriTxt}>
                    Guardar · {totalQuedaria.n} polígono(s) · {fmtHa(totalQuedaria.ha)} ha
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
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
  check: { fontSize: 22, color: COLORS.textLight, marginRight: SPACING.sm },
  pie: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, backgroundColor: COLORS.surface },
  medCercana: { fontSize: FONTS.sizes.xs, color: COLORS.warning, fontWeight: FONTS.weights.semibold, marginTop: 2 },
  medEtiqueta: { fontSize: FONTS.sizes.xs, color: COLORS.success, fontWeight: FONTS.weights.semibold, marginTop: 2 },
});

export default EdicionVisita2Panel;
