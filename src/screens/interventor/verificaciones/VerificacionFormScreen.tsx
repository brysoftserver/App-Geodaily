// ============================================================
// GEODAILY — Formulario de Verificación de Entrega (material vegetal)
// ============================================================
// Se arma con la definición del material (src/data/verificacionesEntrega.ts).
// La fecha se escribe a mano (DD/MM/AAAA); no se registra la hora.
//   · Nueva: formulario en blanco. Se guarda como BORRADOR en el dispositivo
//     apenas se escribe algo (autoguardado) y al salir.
//   · Borrador: se retoma desde la lista de Borradores (params.id).
//   · Completar: se puede aunque falten datos; sube en cuanto hay señal.
//   · Solo lectura: verificaciones completadas (locales o del servidor).
// Fotos: cámara o almacenamiento, SIN marca de agua; firmas con SignaturePad,
// igual que en los formularios de visita.
// ============================================================

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../../theme';
import { useAuth } from '../../../store/AuthContext';
import { avisar, confirmar } from '../../../utils/dialogos';
import SignaturePad from '../../../components/SignaturePad';
import CapturaGPSPrecisa from '../../../components/CapturaGPSPrecisa';
import { persistirEvidencia, eliminarArchivoLocal } from '../../../services/mediaStorage.service';
import {
  buscarMaterialVerificacion,
  datosVacios,
  DatosVerificacion,
  fechaVerificacionIso,
  formatearFechaEscrita,
  FotoVerificacion,
  MAX_FOTOS_CRITERIO,
  MAX_FOTOS_EVIDENCIAS,
  RespuestaSiNo,
} from '../../../data/verificacionesEntrega';
import {
  completarVerificacion,
  fuenteArchivoVerificacion,
  guardarVerificacionLocal,
  nuevoIdVerificacion,
  obtenerVerificacionLocal,
  VerificacionLocal,
  VerificacionServidor,
} from '../../../services/verificacionesEntrega.service';

type Firmante = 'tecnico' | 'interventoria';

const OPCIONES: Array<{ valor: RespuestaSiNo; texto: string }> = [
  { valor: 'si', texto: 'SÍ' },
  { valor: 'no', texto: 'NO' },
  { valor: 'na', texto: 'N/A' },
];

const soloDigitos = (t: string) => t.replace(/[^0-9]/g, '');

/** Foto local (file:// o data: en web) o, si ya no está, la del servidor. */
const FotoMiniatura: React.FC<{ foto: FotoVerificacion; onPress: () => void; onQuitar?: () => void }> = ({ foto, onPress, onQuitar }) => {
  const [fuente, setFuente] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  useEffect(() => {
    let vivo = true;
    if (foto.uri && !foto.perdido) setFuente({ uri: foto.uri });
    else if (foto.archivo_id) fuenteArchivoVerificacion(foto.archivo_id).then((f) => vivo && setFuente(f));
    return () => { vivo = false; };
  }, [foto.uri, foto.archivo_id, foto.perdido]);
  return (
    <View style={styles.miniWrap}>
      <TouchableOpacity style={styles.mini} onPress={onPress} activeOpacity={0.8} disabled={!fuente}>
        {fuente ? <Image source={fuente} style={styles.miniImg} resizeMode="cover" /> : <Text style={styles.miniVacia}>{foto.perdido ? 'Sin archivo' : '…'}</Text>}
      </TouchableOpacity>
      {onQuitar && (
        <TouchableOpacity style={styles.miniQuitar} onPress={onQuitar} hitSlop={8}>
          <Text style={styles.miniQuitarTxt}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const VerificacionFormScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const material = buscarMaterialVerificacion(route?.params?.material);
  const idParam: string | undefined = route?.params?.id;
  const servidor: VerificacionServidor | undefined = route?.params?.servidor;
  const soloLectura = !!route?.params?.soloLectura;

  const [v, setV] = useState<VerificacionLocal | null>(null);
  const [cargando, setCargando] = useState(true);
  const [padActivo, setPadActivo] = useState<Firmante | null>(null);
  const [completando, setCompletando] = useState(false);
  const [visor, setVisor] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);

  // `tocado`: hubo cambios → se guarda como borrador. Una verificación nueva
  // que se abre y se cierra sin escribir nada no deja borradores vacíos.
  const tocadoRef = useRef(false);
  const vRef = useRef<VerificacionLocal | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  vRef.current = v;

  useLayoutEffect(() => {
    navigation.setOptions({ title: soloLectura ? 'Verificación' : idParam ? 'Borrador' : 'Nueva Verificación' });
  }, [navigation, soloLectura, idParam]);

  // ─── Carga ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!material) return setCargando(false);
      if (servidor) {
        setV({
          id: servidor.id,
          material: material.id,
          autor_id: user?.id || '',
          autor_nombre: servidor.autor_nombre || '',
          datos: { ...datosVacios(material), ...servidor.datos },
          completado: true,
          sincronizado: true,
          created_at: servidor.created_at,
          updated_at: servidor.updated_at,
        });
      } else if (idParam) {
        const local = await obtenerVerificacionLocal(idParam);
        if (local) setV({ ...local, datos: { ...datosVacios(material), ...local.datos } });
        else avisar('No se encontró', 'Este borrador ya no está en el dispositivo.');
      } else {
        const ahora = new Date().toISOString();
        setV({
          id: nuevoIdVerificacion(material.id),
          material: material.id,
          autor_id: user?.id || '',
          autor_nombre: user?.nombre || '',
          datos: datosVacios(material, user?.nombre || ''),
          completado: false,
          sincronizado: false,
          created_at: ahora,
          updated_at: ahora,
        });
      }
      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Guardado del borrador ────────────────────────────────
  const guardarAhora = useCallback(async (): Promise<boolean> => {
    if (temporizador.current) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    const actual = vRef.current;
    if (!actual || soloLectura || actual.completado || !tocadoRef.current) return true;
    return guardarVerificacionLocal(actual);
  }, [soloLectura]);

  // Al salir de la pantalla (atrás) se guarda lo pendiente.
  useEffect(() => {
    const quitar = navigation.addListener('beforeRemove', () => { void guardarAhora(); });
    return () => {
      quitar();
      void guardarAhora();
    };
  }, [navigation, guardarAhora]);

  /** Aplica un cambio a los datos y programa el autoguardado. */
  const cambiar = useCallback((fn: (d: DatosVerificacion) => void, inmediato = false) => {
    if (soloLectura) return;
    setV((prev) => {
      if (!prev) return prev;
      const datos: DatosVerificacion = JSON.parse(JSON.stringify(prev.datos));
      fn(datos);
      const sig = { ...prev, datos };
      vRef.current = sig;
      return sig;
    });
    tocadoRef.current = true;
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => { void guardarAhora(); }, inmediato ? 0 : 700);
  }, [soloLectura, guardarAhora]);

  // ─── Fotos (sin marca de agua) ────────────────────────────
  const elegirFoto = (alElegir: (f: FotoVerificacion) => void) => {
    const desdeCamara = async () => {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) return avisar('Permiso requerido', 'Se necesita acceso a la cámara para tomar la foto.');
      const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
      if (!r.canceled && r.assets?.[0]?.uri) await registrar(r.assets[0].uri);
    };
    const desdeAlmacenamiento = async () => {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (!r.canceled && r.assets?.[0]?.uri) await registrar(r.assets[0].uri);
    };
    const registrar = async (uri: string) => {
      const id = `foto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // La cámara escribe en caché (Android la puede vaciar): se copia a almacenamiento persistente.
      const persistente = await persistirEvidencia(uri, `verif-${id}`);
      alElegir({ id, uri: persistente });
    };
    if (Platform.OS === 'web') {
      void desdeAlmacenamiento();
      return;
    }
    Alert.alert('Agregar foto', 'Elige de dónde obtener la foto.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: '📷 Cámara', onPress: () => { void desdeCamara(); } },
      { text: '🖼️ Almacenamiento', onPress: () => { void desdeAlmacenamiento(); } },
    ]);
  };

  const verFoto = async (f: FotoVerificacion) => {
    if (f.uri && !f.perdido) setVisor({ uri: f.uri });
    else if (f.archivo_id) setVisor(await fuenteArchivoVerificacion(f.archivo_id));
  };

  const quitarFoto = async (f: FotoVerificacion, quitar: () => void) => {
    if (!(await confirmar('Quitar foto', '¿Quitar esta foto?', 'Quitar', true))) return;
    quitar();
    if (f.uri && !f.archivo_id) void eliminarArchivoLocal(f.uri);
  };

  const filaFotos = (fotos: FotoVerificacion[], max: number, agregar: (f: FotoVerificacion) => void, quitar: (id: string) => void) => (
    <View style={styles.fotosFila}>
      {fotos.map((f) => (
        <FotoMiniatura
          key={f.id}
          foto={f}
          onPress={() => verFoto(f)}
          onQuitar={soloLectura ? undefined : () => quitarFoto(f, () => quitar(f.id))}
        />
      ))}
      {!soloLectura && fotos.length < max && (
        <TouchableOpacity style={styles.fotoAgregar} onPress={() => elegirFoto(agregar)}>
          <Text style={styles.fotoAgregarTxt}>📷{'\n'}Foto</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ─── Completar ────────────────────────────────────────────
  const completar = async () => {
    if (!v || !material || completando) return;
    const sinResponder = Object.values(v.datos.respuestas).filter((r) => !r.valor).length;
    const faltan: string[] = [];
    if (!fechaVerificacionIso(v.datos.encabezado.fecha)) faltan.push(v.datos.encabezado.fecha ? 'fecha válida' : 'fecha');
    if (sinResponder) faltan.push(`${sinResponder} criterio(s) sin responder`);
    if (!v.datos.firmas.tecnico.firma && !v.datos.firmas.tecnico.archivo_id) faltan.push('firma del técnico agroindustrial');
    if (!v.datos.firmas.interventoria.firma && !v.datos.firmas.interventoria.archivo_id) faltan.push('firma de interventoría');
    const msg = faltan.length
      ? `Quedan pendientes: ${faltan.join(', ')}.\n\nPuedes completarla de todos modos. Una vez completada ya no se puede editar.`
      : 'Una vez completada ya no se puede editar.';
    if (!(await confirmar('Completar verificación', msg, 'Completar'))) return;

    setCompletando(true);
    try {
      if (temporizador.current) clearTimeout(temporizador.current);
      const r = await completarVerificacion(vRef.current || v);
      if (!r.guardada) {
        avisar('No se pudo completar', 'No se pudo guardar en el dispositivo. Revisa el espacio disponible e inténtalo de nuevo.');
        return;
      }
      tocadoRef.current = false; // ya está guardada como completada: no volver a guardarla como borrador
      setV((prev) => (prev ? { ...prev, completado: true } : prev));
      avisar(
        'Verificación completada',
        r.sincronizada ? 'Quedó guardada en el servidor.' : 'Quedó guardada en el dispositivo y se subirá automáticamente cuando haya señal.'
      );
      navigation.goBack();
    } finally {
      setCompletando(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────
  if (cargando) {
    return <View style={styles.centro}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }
  if (!material || !v) {
    return <View style={styles.centro}><Text style={styles.vacio}>No se pudo abrir la verificación.</Text></View>;
  }

  if (padActivo) {
    const titulo = padActivo === 'tecnico' ? 'Firma Técnico Agroindustrial' : 'Firma Profesional de Interventoría';
    return (
      <View style={styles.container}>
        <View style={[styles.padHeader, { paddingTop: insets.top + SPACING.sm }]}>
          <Text style={styles.padTitulo}>✍️ {titulo}</Text>
        </View>
        <SignaturePad
          description={titulo}
          onOK={(firma) => {
            cambiar((d) => {
              d.firmas[padActivo].firma = firma;
              delete d.firmas[padActivo].archivo_id;
            }, true);
            setPadActivo(null);
          }}
        />
        <TouchableOpacity style={styles.padCancelar} onPress={() => setPadActivo(null)}>
          <Text style={styles.padCancelarTxt}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const d = v.datos;
  const e = d.encabezado;
  const editable = !soloLectura;

  const campo = (
    label: string,
    valor: string,
    onChange: (t: string) => void,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {}
  ) => (
    <View style={styles.campo}>
      <Text style={styles.campoLabel}>{label}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputLectura]}
        value={valor}
        onChangeText={onChange}
        editable={editable}
        placeholder={editable ? label : '—'}
        placeholderTextColor={COLORS.textLight}
        {...extra}
      />
    </View>
  );

  const firmaBloque = (quien: Firmante, titulo: string) => {
    const f = d.firmas[quien];
    const tieneFirma = !!f.firma || !!f.archivo_id;
    return (
      <View style={styles.firmaBloque}>
        <Text style={styles.campoLabel}>{titulo}</Text>
        {campo('Nombre', f.nombre, (t) => cambiar((x) => { x.firmas[quien].nombre = t; }))}
        {tieneFirma && (
          <FirmaImagen firma={f.firma} archivoId={f.archivo_id} />
        )}
        {editable && (
          <TouchableOpacity style={[styles.firmaBtn, tieneFirma && styles.firmaBtnOk]} onPress={() => setPadActivo(quien)}>
            <Text style={styles.firmaBtnTxt}>{tieneFirma ? '✓ Firma registrada · volver a firmar' : '✍️ Firmar'}</Text>
          </TouchableOpacity>
        )}
        {!editable && !tieneFirma && <Text style={styles.sinDato}>Sin firma</Text>}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.titulo}>{material.titulo}</Text>
        {soloLectura && <Text style={styles.lectura}>Verificación completada · solo lectura</Text>}

        {/* Encabezado */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>ENCABEZADO DEL REGISTRO</Text>
          {campo('Fecha (DD/MM/AAAA)', e.fecha || '', (t) => cambiar((x) => { x.encabezado.fecha = formatearFechaEscrita(t); }), { keyboardType: 'number-pad', maxLength: 10 })}
          {editable && (e.fecha || '').length === 10 && !fechaVerificacionIso(e.fecha) && (
            <Text style={styles.fechaInvalida}>La fecha no es válida. Revisa día, mes y año.</Text>
          )}
          {campo('Punto de Recepción / Acopio', e.puntoRecepcion, (t) => cambiar((x) => { x.encabezado.puntoRecepcion = t; }))}
          <View style={styles.campo}>
            {editable ? (
              <CapturaGPSPrecisa
                label="Coordenadas GPS"
                latitud={e.latitud}
                longitud={e.longitud}
                altitud={e.altitud}
                precision={e.precision}
                onCapture={(lat, lon, alt, prec) =>
                  cambiar((x) => { Object.assign(x.encabezado, { latitud: lat, longitud: lon, altitud: alt, precision: prec }); }, true)
                }
              />
            ) : (
              <>
                <Text style={styles.campoLabel}>Coordenadas GPS</Text>
                <Text style={styles.valorFijo}>{e.latitud && e.longitud ? `${e.latitud}, ${e.longitud}${e.precision ? ` (±${e.precision} m)` : ''}` : 'Sin capturar'}</Text>
              </>
            )}
          </View>
          {campo('Nombre del Proveedor / Vivero', e.proveedor, (t) => cambiar((x) => { x.encabezado.proveedor = t; }))}
          {campo('Placa del Vehículo', e.placa, (t) => cambiar((x) => { x.encabezado.placa = t.toUpperCase(); }), { autoCapitalize: 'characters' })}
          {material.tipoMaterialEditable ? (
            campo('Tipo de Material Vegetal', e.tipoMaterial, (t) => cambiar((x) => { x.encabezado.tipoMaterial = t; }))
          ) : (
            <View style={styles.campo}>
              <Text style={styles.campoLabel}>Tipo de Material Vegetal</Text>
              <Text style={styles.valorFijo}>{e.tipoMaterial}</Text>
            </View>
          )}
          {campo('N.° de Remisión / Guía de Despacho', e.remision, (t) => cambiar((x) => { x.encabezado.remision = t; }))}
          {campo('Cantidad Declarada en Remisión', e.cantidadDeclarada, (t) => cambiar((x) => { x.encabezado.cantidadDeclarada = soloDigitos(t); }), { keyboardType: 'number-pad' })}
        </View>

        {/* Módulos 1–4 */}
        {material.modulos.map((mod) => (
          <View key={mod.id} style={styles.seccion}>
            <Text style={styles.seccionTitulo}>{mod.titulo}</Text>
            <Text style={styles.seccionSub}>{mod.subtitulo}</Text>
            {mod.criterios.map((c) => {
              const r = d.respuestas[c.id] || { valor: null, observacion: '', fotos: [] };
              return (
                <View key={c.id} style={styles.criterio}>
                  <Text style={styles.criterioTxt}>
                    <Text style={styles.criterioId}>{c.id} </Text>
                    {c.rotulo ? <Text style={styles.criterioRotulo}>{c.rotulo}: </Text> : null}
                    {c.pregunta}
                  </Text>
                  <View style={styles.opciones}>
                    {OPCIONES.map((o) => {
                      const activa = r.valor === o.valor;
                      return (
                        <TouchableOpacity
                          key={o.valor}
                          disabled={!editable}
                          style={[styles.opcion, activa && (o.valor === 'si' ? styles.opcionSi : o.valor === 'no' ? styles.opcionNo : styles.opcionNa)]}
                          onPress={() => cambiar((x) => {
                            const actual = x.respuestas[c.id] || { valor: null, observacion: '', fotos: [] };
                            x.respuestas[c.id] = { ...actual, valor: actual.valor === o.valor ? null : o.valor };
                          })}
                        >
                          <Text style={[styles.opcionTxt, activa && styles.opcionTxtActiva]}>{o.texto}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput
                    style={[styles.input, styles.inputObs, !editable && styles.inputLectura]}
                    value={r.observacion}
                    editable={editable}
                    multiline
                    placeholder={editable ? `Observaciones — ${c.ayuda}` : '—'}
                    placeholderTextColor={COLORS.textLight}
                    onChangeText={(t) => cambiar((x) => {
                      const actual = x.respuestas[c.id] || { valor: null, observacion: '', fotos: [] };
                      x.respuestas[c.id] = { ...actual, observacion: t };
                    })}
                  />
                  {(editable || r.fotos.length > 0) &&
                    filaFotos(
                      r.fotos,
                      MAX_FOTOS_CRITERIO,
                      (f) => cambiar((x) => {
                        const actual = x.respuestas[c.id] || { valor: null, observacion: '', fotos: [] };
                        x.respuestas[c.id] = { ...actual, fotos: [...actual.fotos, f] };
                      }, true),
                      (id) => cambiar((x) => {
                        const actual = x.respuestas[c.id];
                        if (actual) actual.fotos = actual.fotos.filter((f) => f.id !== id);
                      }, true)
                    )}
                </View>
              );
            })}
          </View>
        ))}

        {/* Módulo 5 */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>MÓDULO 5: Dictamen de Recepción y Control de Cantidades</Text>
          <Text style={styles.seccionSub}>Balance y cierre de la inspección</Text>
          {campo('Total Unidades Inspeccionadas en Muestra', d.dictamen.inspeccionadas, (t) => cambiar((x) => { x.dictamen.inspeccionadas = soloDigitos(t); }), { keyboardType: 'number-pad' })}
          {campo('Unidades Conformes (Aprobadas)', d.dictamen.conformes, (t) => cambiar((x) => { x.dictamen.conformes = soloDigitos(t); }), { keyboardType: 'number-pad' })}
          {campo('Unidades No Conformes (Rechazadas)', d.dictamen.noConformes, (t) => cambiar((x) => { x.dictamen.noConformes = soloDigitos(t); }), { keyboardType: 'number-pad' })}
          <Text style={styles.campoLabel}>Principales Daños</Text>
          {material.danos.map((dano) => {
            const marcado = d.dictamen.danos.includes(dano);
            return (
              <TouchableOpacity
                key={dano}
                style={styles.check}
                disabled={!editable}
                onPress={() => cambiar((x) => {
                  x.dictamen.danos = marcado ? x.dictamen.danos.filter((y) => y !== dano) : [...x.dictamen.danos, dano];
                })}
              >
                <Text style={[styles.checkCaja, marcado && styles.checkCajaOn]}>{marcado ? '✓' : ''}</Text>
                <Text style={styles.checkTxt}>{dano}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Concepto final */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>CONCEPTO FINAL</Text>
          <TextInput
            style={[styles.input, styles.inputLargo, !editable && styles.inputLectura]}
            value={d.conceptoFinal}
            editable={editable}
            multiline
            placeholder={editable ? 'Texto libre' : '—'}
            placeholderTextColor={COLORS.textLight}
            onChangeText={(t) => cambiar((x) => { x.conceptoFinal = t; })}
          />
        </View>

        {/* Evidencias */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>EVIDENCIAS DIGITALES</Text>
          <Text style={styles.seccionSub}>Fotografías (máximo {MAX_FOTOS_EVIDENCIAS})</Text>
          {filaFotos(
            d.evidencias,
            MAX_FOTOS_EVIDENCIAS,
            (f) => cambiar((x) => { x.evidencias = [...x.evidencias, f]; }, true),
            (id) => cambiar((x) => { x.evidencias = x.evidencias.filter((f) => f.id !== id); }, true)
          )}
          {!editable && d.evidencias.length === 0 && <Text style={styles.sinDato}>Sin fotografías</Text>}
        </View>

        {/* Firmas */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>FIRMAS</Text>
          {firmaBloque('tecnico', 'Firma Técnico Agroindustrial')}
          {firmaBloque('interventoria', 'Firma Profesional de Interventoría')}
        </View>

        {editable && (
          <>
            <Text style={styles.avisoOffline}>📴 Funciona sin conexión: se guarda como borrador mientras escribes y se sube al completar cuando haya señal.</Text>
            <TouchableOpacity
              style={styles.btnBorrador}
              onPress={async () => {
                tocadoRef.current = true;
                const ok = await guardarAhora();
                avisar(ok ? 'Borrador guardado' : 'No se pudo guardar', ok ? 'Puedes continuarlo desde Borradores.' : 'Revisa el espacio del dispositivo.');
              }}
            >
              <Text style={styles.btnBorradorTxt}>💾 Guardar borrador</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnCompletar, completando && { opacity: 0.6 }]} onPress={completar} disabled={completando}>
              {completando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnCompletarTxt}>✅ Completar</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal visible={visor !== null} transparent animationType="fade" onRequestClose={() => setVisor(null)}>
        <View style={styles.visorFondo}>
          {visor && <Image source={visor} style={styles.visorImg} resizeMode="contain" />}
          <TouchableOpacity style={[styles.visorCerrar, { marginBottom: insets.bottom + SPACING.md }]} onPress={() => setVisor(null)}>
            <Text style={styles.visorCerrarTxt}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

/** Firma ya tomada: la del dispositivo (data URI) o la subida al servidor. */
const FirmaImagen: React.FC<{ firma?: string | null; archivoId?: number }> = ({ firma, archivoId }) => {
  const [fuente, setFuente] = useState<{ uri: string; headers?: Record<string, string> } | null>(firma ? { uri: firma } : null);
  useEffect(() => {
    let vivo = true;
    if (firma) setFuente({ uri: firma });
    else if (archivoId) fuenteArchivoVerificacion(archivoId).then((f) => vivo && setFuente(f));
    return () => { vivo = false; };
  }, [firma, archivoId]);
  return fuente ? <Image source={fuente} style={styles.firmaImg} resizeMode="contain" /> : null;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centro: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  content: { padding: SPACING.md, gap: SPACING.md },
  titulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.roleInterventor, textAlign: 'center' },
  lectura: { textAlign: 'center', fontSize: FONTS.sizes.sm, color: COLORS.success, fontWeight: FONTS.weights.semibold },
  vacio: { color: COLORS.textSecondary },
  seccion: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.roleInterventor, ...SHADOWS.sm },
  seccionTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  seccionSub: { fontSize: FONTS.sizes.xs, fontStyle: 'italic', color: COLORS.textSecondary, marginTop: 2, marginBottom: SPACING.sm },
  campo: { marginTop: SPACING.sm },
  campoLabel: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: 4 },
  valorFijo: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  fechaInvalida: { fontSize: FONTS.sizes.xs, color: COLORS.error, marginTop: 4 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, color: COLORS.textPrimary, backgroundColor: COLORS.surface, fontSize: FONTS.sizes.sm },
  inputLectura: { backgroundColor: COLORS.background, color: COLORS.textSecondary },
  inputObs: { marginTop: SPACING.sm, minHeight: 44, textAlignVertical: 'top' },
  inputLargo: { minHeight: 100, textAlignVertical: 'top', marginTop: SPACING.sm },
  criterio: { paddingVertical: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  criterioTxt: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, lineHeight: 19 },
  criterioId: { fontWeight: FONTS.weights.bold, color: COLORS.roleInterventor },
  criterioRotulo: { fontWeight: FONTS.weights.bold },
  opciones: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  opcion: { flex: 1, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingVertical: 8, alignItems: 'center', backgroundColor: COLORS.surface },
  opcionSi: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  opcionNo: { backgroundColor: COLORS.error, borderColor: COLORS.error },
  opcionNa: { backgroundColor: COLORS.textSecondary, borderColor: COLORS.textSecondary },
  opcionTxt: { fontWeight: FONTS.weights.bold, color: COLORS.textSecondary, fontSize: FONTS.sizes.sm },
  opcionTxtActiva: { color: '#fff' },
  fotosFila: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  miniWrap: { position: 'relative' },
  mini: { width: 72, height: 72, borderRadius: BORDER_RADIUS.md, overflow: 'hidden', backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  miniImg: { width: '100%', height: '100%' },
  miniVacia: { fontSize: FONTS.sizes.xs, color: COLORS.textLight, textAlign: 'center' },
  miniQuitar: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.error, alignItems: 'center', justifyContent: 'center' },
  miniQuitarTxt: { color: '#fff', fontSize: 12, fontWeight: FONTS.weights.bold },
  fotoAgregar: { width: 72, height: 72, borderRadius: BORDER_RADIUS.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.roleInterventor, alignItems: 'center', justifyContent: 'center' },
  fotoAgregarTxt: { fontSize: FONTS.sizes.xs, color: COLORS.roleInterventor, textAlign: 'center', fontWeight: FONTS.weights.semibold },
  check: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  checkCaja: { width: 22, height: 22, borderWidth: 1.5, borderColor: COLORS.roleInterventor, borderRadius: 4, textAlign: 'center', lineHeight: 19, color: '#fff', marginRight: SPACING.sm, overflow: 'hidden' },
  checkCajaOn: { backgroundColor: COLORS.roleInterventor },
  checkTxt: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary },
  firmaBloque: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  firmaImg: { width: '100%', height: 110, marginTop: SPACING.sm, backgroundColor: '#fff', borderRadius: BORDER_RADIUS.md },
  firmaBtn: { marginTop: SPACING.sm, borderWidth: 1.5, borderColor: COLORS.roleInterventor, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center' },
  firmaBtnOk: { borderColor: COLORS.success, backgroundColor: '#E8F5E9' },
  firmaBtnTxt: { color: COLORS.roleInterventor, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  sinDato: { fontSize: FONTS.sizes.sm, color: COLORS.textLight, fontStyle: 'italic', marginTop: 4 },
  avisoOffline: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, textAlign: 'center' },
  btnBorrador: { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.md, alignItems: 'center', backgroundColor: COLORS.surface },
  btnBorradorTxt: { color: COLORS.primary, fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
  btnCompletar: { backgroundColor: COLORS.success, borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.md, alignItems: 'center' },
  btnCompletarTxt: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
  padHeader: { backgroundColor: COLORS.roleInterventor, paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  padTitulo: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
  padCancelar: { padding: SPACING.md, alignItems: 'center' },
  padCancelarTxt: { color: COLORS.error, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
  visorFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  visorImg: { flex: 1, width: '100%' },
  visorCerrar: { alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: BORDER_RADIUS.md },
  visorCerrarTxt: { color: '#fff', fontWeight: FONTS.weights.semibold },
});

export default VerificacionFormScreen;
