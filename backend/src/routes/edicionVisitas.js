// ============================================================
// Edición de la Visita 2 por un administrador autorizado
// ============================================================
// Solo los usuarios de USUARIOS_EDITAN_VISITA_2 (rol admin) pueden:
//   · PATCH /:id/campo      corregir una respuesta de la Visita 2 (campo por campo)
//   · GET   /:id/mediciones mediciones del técnico, para elegir el polígono
//   · PUT   /:id/poligono   cargar el polígono 1 o 2 (ítem 4) desde una medición
//                           del técnico o desde un KML/KMZ (puntos ya leídos)
//   · DELETE /:id/poligono/2 quitar el polígono 2
// Cada corrección actualiza el campo legible de `actividad_json` (lo que
// muestran el detalle y el PDF) y su espejo en `actividad_json.visita_datos`
// (con lo que se reabre el formulario), y queda en `actividad_log` con el
// valor anterior y el nuevo.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

/** Usuarios (login) autorizados. Por ahora solo el admin principal. */
const USUARIOS_EDITAN_VISITA_2 = ['mynoquest'];

const puedeEditar = (user) => user?.rol === 'admin' && USUARIOS_EDITAN_VISITA_2.includes(user?.usuario);

const soloAutorizados = (req, res, next) => {
  if (!puedeEditar(req.user)) {
    return res.status(403).json({ estado: 'error', mensaje: 'No tienes permiso para editar la Visita 2' });
  }
  next();
};

const aObjeto = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : v || {});

/**
 * Campos corregibles. `act` = claves en actividad_json (la primera es la que
 * se reporta como valor anterior); `datos` = clave en visita_datos.
 */
const CAMPOS = {
  objetivo: { act: ['objetivo'], datos: 'objetivo', tipo: 'texto' },
  descripcion: { act: ['descripcion'], datos: 'descripcion_visita', tipo: 'texto' },
  seguimiento_compromisos: { act: ['seguimiento_compromisos', 'descripcion_detallada'], datos: 'seguimiento_compromisos', tipo: 'texto' },
  valoracion_cumplimiento: { act: ['valoracion_cumplimiento'], datos: 'valoracion_cumplimiento', tipo: 'porcentaje' },
  recomendaciones: { act: ['recomendaciones'], datos: 'recomendaciones', tipo: 'texto' },
  observaciones: { act: ['observaciones'], datos: 'observaciones', tipo: 'texto' },
  area_intervencion: { act: ['area_intervencion'], datos: 'area_intervencion', tipo: 'area' },
  compromisos_siguiente_visita: { act: ['compromisos_siguiente_visita'], datos: 'compromisos', tipo: 'lista' },
};

/** Valida y normaliza el valor según el tipo de campo. Devuelve { ok, valor } o { ok:false, mensaje }. */
function normalizar(tipo, crudo) {
  if (tipo === 'texto') {
    if (typeof crudo !== 'string') return { ok: false, mensaje: 'El valor debe ser texto' };
    return { ok: true, valor: crudo.trim().slice(0, 5000) };
  }
  if (tipo === 'porcentaje') {
    const t = String(crudo ?? '').trim();
    if (t === '') return { ok: true, valor: '' };
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > 100) return { ok: false, mensaje: 'La valoración debe ser un número entero entre 0 y 100' };
    return { ok: true, valor: String(n) };
  }
  if (tipo === 'area') {
    const t = String(crudo ?? '').trim().replace(',', '.');
    if (t === '') return { ok: true, valor: '' };
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0 || n > 10000) return { ok: false, mensaje: 'El área debe ser un número mayor que 0 (hectáreas)' };
    return { ok: true, valor: String(Math.round(n * 100) / 100) };
  }
  if (tipo === 'lista') {
    const lista = Array.isArray(crudo) ? crudo : String(crudo ?? '').split('\n');
    const limpia = lista.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 50).map((x) => x.slice(0, 500));
    return { ok: true, valor: limpia };
  }
  return { ok: false, mensaje: 'Campo no soportado' };
}

/** Carga la visita y verifica que sea una Visita 2 del formato nuevo. Responde y devuelve null si no. */
async function cargarVisita2(req, res) {
  const f = await db.queryOne(
    'SELECT id, tipo, usuario_id, tecnico_json, beneficiario_json, actividad_json FROM formularios WHERE id = $1',
    [String(req.params.id)]
  );
  if (!f) {
    res.status(404).json({ estado: 'error', mensaje: 'Formulario no encontrado' });
    return null;
  }
  const actividad = aObjeto(f.actividad_json);
  if (f.tipo !== 'visita_tecnica' || Number(actividad.visita_numero) !== 2) {
    res.status(409).json({ estado: 'error', mensaje: 'Solo se puede editar la Visita 2' });
    return null;
  }
  if (actividad.formato_visita !== 'v2') {
    res.status(409).json({ estado: 'error', mensaje: 'Esta visita es del formato antiguo y no se puede editar aquí' });
    return null;
  }
  return { f, actividad };
}

async function guardarActividad(id, actividad) {
  await db.query('UPDATE formularios SET actividad_json = $2::jsonb, updated_at = NOW() WHERE id = $1', [id, JSON.stringify(actividad)]);
}

async function auditar(req, accion, detalle) {
  try {
    // Mismas columnas que el resto del backend (la tabla en producción no tiene `ip`).
    await db.query('INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3::jsonb)', [
      req.user.id,
      accion,
      JSON.stringify(detalle),
    ]);
  } catch (e) {
    console.warn('[EdicionVisitas] No se pudo registrar la auditoría:', e.message);
  }
}

// GET /api/edicion-visitas/permiso — ¿el usuario actual puede editar la Visita 2?
router.get('/permiso', authenticateToken, (req, res) => {
  res.json({ estado: 'ok', puedeEditarVisita2: puedeEditar(req.user) });
});

// PATCH /api/edicion-visitas/:id/campo — { campo, valor }
router.patch('/:id/campo', authenticateToken, soloAutorizados, async (req, res) => {
  try {
    const def = CAMPOS[req.body?.campo];
    if (!def) return res.status(400).json({ estado: 'error', mensaje: 'Campo no editable' });
    const n = normalizar(def.tipo, req.body?.valor);
    if (!n.ok) return res.status(400).json({ estado: 'error', mensaje: n.mensaje });
    const v = await cargarVisita2(req, res);
    if (!v) return;
    const { f, actividad } = v;

    const anterior = actividad[def.act[0]] ?? null;
    let valorActividad = n.valor;
    // Igual que el formulario: sin descripción se usa el rótulo de la visita.
    if (req.body.campo === 'descripcion' && !n.valor) valorActividad = 'Visita Técnica 2';
    for (const clave of def.act) {
      if (valorActividad === '' && clave !== 'descripcion') delete actividad[clave];
      else actividad[clave] = valorActividad;
    }
    const datos = actividad.visita_datos && typeof actividad.visita_datos === 'object' ? actividad.visita_datos : {};
    if (def.tipo === 'lista') {
      datos.compromisos = n.valor.map((texto, i) => ({ id: `c-admin-${i}-${Date.now()}`, texto, activo: true }));
      datos.sin_compromisos = n.valor.length === 0;
    } else {
      datos[def.datos] = n.valor;
    }
    actividad.visita_datos = datos;

    await guardarActividad(f.id, actividad);
    await auditar(req, 'editar_visita2_campo', { formulario_id: f.id, campo: req.body.campo, anterior, nuevo: n.valor });
    res.json({ estado: 'ok', actividad });
  } catch (error) {
    console.error('[EdicionVisitas] Error al corregir campo:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al guardar la corrección' });
  }
});

/** Polígono 1 = el de siempre; polígono 2 = segundo polígono opcional. */
const CLAVE_POLIGONO = { 1: 'medicion_historial', 2: 'medicion_historial_2' };

/**
 * Área y perímetro con la MISMA aproximación plana que usa la app al medir
 * (src/services/kml.service.ts → calcularArea), para que un KML subido y una
 * medición del mapa den el mismo número.
 */
function calcularArea(puntos) {
  if (puntos.length < 3) return { areaMetros2: 0, areaHectareas: 0, perimetroMetros: 0 };
  const cerrado = puntos[0].latitud === puntos[puntos.length - 1].latitud && puntos[0].longitud === puntos[puntos.length - 1].longitud;
  const pts = cerrado ? puntos : [...puntos, puntos[0]];
  const lat0 = pts[0].latitud;
  const lon0 = pts[0].longitud;
  const m = pts.map((p) => ({ x: (p.longitud - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), y: (p.latitud - lat0) * 110540 }));
  let a2 = 0;
  let per = 0;
  for (let i = 0; i < m.length - 1; i++) {
    a2 += m[i].x * m[i + 1].y - m[i + 1].x * m[i].y;
    per += Math.hypot(m[i + 1].x - m[i].x, m[i + 1].y - m[i].y);
  }
  const areaM2 = Math.abs(a2) / 2;
  return { areaMetros2: Math.round(areaM2), areaHectareas: Math.round((areaM2 / 10000) * 100) / 100, perimetroMetros: Math.round(per) };
}

/** Valida los puntos de un KML: 3 a 5000 vértices dentro de rangos geográficos. */
function puntosValidosKml(crudos) {
  if (!Array.isArray(crudos)) return null;
  const pts = crudos
    .map((p) => ({ latitud: Number(p?.latitud), longitud: Number(p?.longitud) }))
    .filter((p) => Number.isFinite(p.latitud) && Number.isFinite(p.longitud) && Math.abs(p.latitud) <= 90 && Math.abs(p.longitud) <= 180);
  if (pts.length !== crudos.length || pts.length < 3 || pts.length > 5000) return null;
  return pts;
}

/** Medición de la tabla `mediciones` en el formato que usa la visita (MedicionAdjunta). */
function aMedicionAdjunta(m) {
  const meta = aObjeto(m.metadata_json);
  const puntos = (Array.isArray(meta.puntos) ? meta.puntos : [])
    .map((p) => ({ latitud: Number(p?.latitud), longitud: Number(p?.longitud) }))
    .filter((p) => Number.isFinite(p.latitud) && Number.isFinite(p.longitud));
  return {
    id: m.id,
    nombre: meta.nombre || 'Medición sin nombre',
    area_hectareas: Number(meta.area_hectareas) || 0,
    area_metros2: Number(meta.area_metros2) || 0,
    perimetro_metros: Number(meta.perimetro_metros) || 0,
    puntos,
    created_at: m.created_at,
    beneficiario_cedula: meta.beneficiario_cedula || null,
  };
}

const duenoDe = (f) => aObjeto(f.tecnico_json).usuario_id || f.usuario_id;
const soloDigitos = (t) => String(t || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

// GET /api/edicion-visitas/:id/mediciones — mediciones del técnico de la visita (las del beneficiario primero)
router.get('/:id/mediciones', authenticateToken, soloAutorizados, async (req, res) => {
  try {
    const v = await cargarVisita2(req, res);
    if (!v) return;
    const filas = await db.queryAll(
      'SELECT id, metadata_json, created_at FROM mediciones WHERE usuario_id = $1 ORDER BY created_at DESC',
      [duenoDe(v.f)]
    );
    const cedula = soloDigitos(aObjeto(v.f.beneficiario_json).cedula);
    const mediciones = filas
      .map(aMedicionAdjunta)
      .filter((m) => m.puntos.length >= 3)
      .map((m) => ({ ...m, delBeneficiario: !!cedula && soloDigitos(m.beneficiario_cedula) === cedula }))
      .sort((a, b) => Number(b.delBeneficiario) - Number(a.delBeneficiario));
    res.json({
      estado: 'ok',
      actual: v.actividad.medicion_historial?.id || null,
      actual2: v.actividad.medicion_historial_2?.id || null,
      mediciones,
    });
  } catch (error) {
    console.error('[EdicionVisitas] Error al listar mediciones:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al listar las mediciones' });
  }
});

// PUT /api/edicion-visitas/:id/poligono
//   { posicion: 1|2, medicionId }                       → desde una medición del técnico
//   { posicion: 1|2, kml: { nombre, puntos: [...] } }   → desde un archivo KML/KMZ
router.put('/:id/poligono', authenticateToken, soloAutorizados, async (req, res) => {
  try {
    const posicion = Number(req.body?.posicion ?? 1);
    const clave = CLAVE_POLIGONO[posicion];
    if (!clave) return res.status(400).json({ estado: 'error', mensaje: 'Posición de polígono inválida (1 o 2)' });
    const v = await cargarVisita2(req, res);
    if (!v) return;

    let adjunta;
    let origen;
    if (req.body?.kml) {
      const puntos = puntosValidosKml(req.body.kml.puntos);
      if (!puntos) return res.status(400).json({ estado: 'error', mensaje: 'El KML no trae un polígono válido (mínimo 3 puntos con coordenadas correctas)' });
      // El área la calcula el servidor: no se confía en la que envíe el cliente.
      const a = calcularArea(puntos);
      adjunta = {
        id: `kml-${Date.now().toString(36)}`,
        nombre: String(req.body.kml.nombre || 'Polígono KML').trim().slice(0, 150) || 'Polígono KML',
        area_hectareas: a.areaHectareas,
        area_metros2: a.areaMetros2,
        perimetro_metros: a.perimetroMetros,
        puntos,
        created_at: new Date().toISOString(),
        origen: 'kml',
      };
      origen = 'kml';
    } else {
      const m = await db.queryOne(
        'SELECT id, metadata_json, created_at FROM mediciones WHERE id = $1 AND usuario_id = $2',
        [String(req.body?.medicionId || ''), duenoDe(v.f)]
      );
      if (!m) return res.status(404).json({ estado: 'error', mensaje: 'Medición no encontrada para el técnico de esta visita' });
      const { beneficiario_cedula, ...resto } = aMedicionAdjunta(m);
      if (resto.puntos.length < 3) return res.status(400).json({ estado: 'error', mensaje: 'La medición no tiene un polígono válido (mínimo 3 puntos)' });
      adjunta = resto;
      origen = 'medicion';
    }

    const { actividad } = v;
    const otra = actividad[CLAVE_POLIGONO[posicion === 1 ? 2 : 1]];
    if (origen === 'medicion' && otra?.id === adjunta.id) {
      return res.status(409).json({ estado: 'error', mensaje: 'Esa medición ya está cargada en el otro polígono' });
    }
    const anterior = actividad[clave]?.id || null;
    actividad[clave] = adjunta;
    const datos = actividad.visita_datos && typeof actividad.visita_datos === 'object' ? actividad.visita_datos : {};
    datos[clave] = adjunta;
    actividad.visita_datos = datos;

    await guardarActividad(v.f.id, actividad);
    await auditar(req, 'cargar_poligono_visita2', { formulario_id: v.f.id, posicion, origen, anterior, nuevo: adjunta.id, area_hectareas: adjunta.area_hectareas });
    res.json({ estado: 'ok', actividad });
  } catch (error) {
    console.error('[EdicionVisitas] Error al cargar polígono:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al cargar el polígono' });
  }
});

// DELETE /api/edicion-visitas/:id/poligono/2 — quitar el segundo polígono (el 1 no se quita)
router.delete('/:id/poligono/:posicion', authenticateToken, soloAutorizados, async (req, res) => {
  try {
    if (Number(req.params.posicion) !== 2) return res.status(400).json({ estado: 'error', mensaje: 'Solo se puede quitar el polígono 2' });
    const v = await cargarVisita2(req, res);
    if (!v) return;
    const { actividad } = v;
    const anterior = actividad.medicion_historial_2?.id || null;
    if (!anterior) return res.status(404).json({ estado: 'error', mensaje: 'La visita no tiene polígono 2' });
    delete actividad.medicion_historial_2;
    if (actividad.visita_datos && typeof actividad.visita_datos === 'object') delete actividad.visita_datos.medicion_historial_2;
    await guardarActividad(v.f.id, actividad);
    await auditar(req, 'quitar_poligono_visita2', { formulario_id: v.f.id, posicion: 2, anterior });
    res.json({ estado: 'ok', actividad });
  } catch (error) {
    console.error('[EdicionVisitas] Error al quitar polígono:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al quitar el polígono' });
  }
});

router.puedeEditarVisita2 = puedeEditar;
router.calcularArea = calcularArea;
module.exports = router;
