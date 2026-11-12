// ============================================================
// GEODAILY — Exportar cronograma de visitas planificadas a Excel
// ============================================================
// Genera un .xlsx real (vía SheetJS) con las visitas planificadas de una
// sola persona (técnico, coordinador o interventor) y lo guarda en el
// dispositivo — ver `guardarXlsxEnDispositivo`.

import { Alert, Platform } from 'react-native';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Formulario, VisitaProgramada } from '../types';
import { formatFecha } from '../utils/formatters';
import { descargarBlobEnNavegador } from '../utils/webDownload';
import { fetchResumenRevisiones, EstadoRevision } from './revisiones.service';
import { avisar } from '../utils/dialogos';

/**
 * Si el rango no tiene visitas, avisa y devuelve `true` para NO descargar
 * un Excel vacío (confundía: parecía que el reporte estaba dañado). Si el
 * calendario no tiene ningún formulario cargado, lo más probable es que aún
 * esté cargando (recién abierta la app), así que se dice eso.
 */
function avisarSiNoHayVisitas(
  totalEnRango: number,
  formulariosCargados: number,
  sinDatosMensaje: string
): boolean {
  if (totalEnRango > 0) return false;
  if (formulariosCargados === 0) {
    avisar(
      'Sin datos todavía',
      'Las visitas del calendario aún se están cargando. Espera unos segundos a que aparezcan y vuelve a descargar.'
    );
  } else {
    avisar('Sin visitas', sinDatosMensaje);
  }
  return true;
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ETIQUETA_ROL: Record<string, string> = {
  tecnico: 'Técnico',
  coordinador: 'Coordinador',
  interventor: 'Interventor',
  gerente: 'Gerente',
  admin: 'Administrador',
};

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
};

/**
 * Guarda el libro .xlsx en el dispositivo.
 *
 * Antes se usaba `Sharing.shareAsync` (menú de compartir). En Android eso
 * abría el selector de apps y, al elegir una app de Excel, esta intentaba
 * ABRIR el archivo en vez de descargarlo — el usuario veía "se abre otra
 * app" y ningún archivo guardado. Ahora:
 *  - Android: selector nativo de carpetas (Storage Access Framework) para
 *    elegir dónde guardar el archivo — es una descarga real.
 *  - iOS: no hay SAF; se mantiene el menú de compartir ("Guardar en
 *    Archivos" / enviar por correo, etc.).
 */
async function guardarXlsxEnDispositivo(
  wb: XLSX.WorkBook,
  nombreArchivo: string,
  dialogTitle: string
): Promise<void> {
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const uri = `${FileSystem.cacheDirectory}${nombreArchivo}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });

  if (Platform.OS === 'android') {
    try {
      const permiso = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (permiso.granted) {
        const destino = await FileSystem.StorageAccessFramework.createFileAsync(
          permiso.directoryUri,
          nombreArchivo.replace(/\.xlsx$/i, ''),
          MIME_XLSX
        );
        await FileSystem.writeAsStringAsync(destino, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        Alert.alert('Excel descargado', `El archivo se guardó como ${nombreArchivo}.`);
        return;
      }
      // El usuario canceló el selector de carpetas: no se hace nada más.
      return;
    } catch (error) {
      console.warn('[CronogramaExcel] No se pudo guardar con el selector de carpetas:', error);
    }
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: MIME_XLSX,
      dialogTitle,
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  } else {
    Alert.alert('Excel generado', `Archivo guardado en: ${uri}`);
  }
}

/**
 * Genera el cronograma de `visitas` (ya filtradas a una sola persona) como
 * .xlsx y lo comparte de inmediato. No lanza si el usuario no tiene ninguna
 * visita planificada — igual genera el archivo, solo con la tabla vacía.
 */
export async function generarYCompartirCronogramaExcel(
  visitas: VisitaProgramada[],
  nombrePersona: string,
  rolPersona: string
): Promise<void> {
  try {
    const ordenadas = [...visitas].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const rolEtiqueta = ETIQUETA_ROL[rolPersona] || rolPersona;

    const filas: (string | number)[][] = [
      [`Cronograma de visitas — ${nombrePersona} (${rolEtiqueta})`],
      [`Generado el ${formatFecha(new Date().toISOString().slice(0, 10))}`],
      [],
      ['Fecha', 'Título', 'Ubicación', 'Estado'],
      ...ordenadas.map((v) => [
        formatFecha(v.fecha),
        v.titulo,
        v.ubicacion || '',
        ETIQUETA_ESTADO[v.estado] || v.estado,
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 30 }, { wch: 14 }];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cronograma');

    const fechaArchivo = new Date().toISOString().slice(0, 10);
    const nombreArchivo = `Cronograma_${nombrePersona.replace(/\s+/g, '_')}_${fechaArchivo}.xlsx`;

    // En web no existe FileSystem.cacheDirectory (es del dispositivo, no del
    // navegador) ni expo-sharing — se arma el binario en memoria y se
    // descarga con un <a download>, igual que mediaPackage.service.ts para
    // los .zip de evidencias. Sin esta rama, en web salía un archivo vacío.
    if (Platform.OS === 'web') {
      const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      descargarBlobEnNavegador(new Blob([arrayBuffer], { type: MIME_XLSX }), nombreArchivo);
      return;
    }

    await guardarXlsxEnDispositivo(wb, nombreArchivo, 'Descargar cronograma');
  } catch (error) {
    console.error('[CronogramaExcel] Error generando el Excel:', error);
    Alert.alert('Error', 'No se pudo generar el cronograma en Excel. Intenta de nuevo.');
  }
}

export interface RangoSemanaCalendario {
  inicio: string;
  fin: string;
  etiqueta: string;
}

/** Persona incluida en un reporte (técnico, coordinador o interventor). */
export interface PersonaReporteExcel {
  id: string;
  nombre: string;
  rol: string;
}

/**
 * Beneficiario incluido en un reporte. `tecnicoId` / `tecnicoNombre` dicen a
 * qué técnico pertenece, para que el filtro no mezcle beneficiarios con el
 * mismo nombre o cédula asignados a técnicos distintos.
 */
export interface BeneficiarioReporteExcel {
  cedula: string;
  nombre: string;
  tecnicoId?: string;
  tecnicoNombre?: string;
}

/** Normaliza texto para comparar nombres/cédulas sin tildes ni mayúsculas. */
const normalizarTexto = (valor?: string | null): string =>
  (valor || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

/** Cédula comparable: solo dígitos (el backend a veces la guarda con puntos). */
const normalizarCedula = (valor?: string | null): string =>
  (valor || '').toString().replace(/\D/g, '');

/**
 * Escribe el libro como .xlsx y lo guarda (móvil) o lo descarga (web) —
 * misma mecánica para todas las exportaciones del calendario, así no se
 * duplica la rama de plataforma en cada reporte.
 */
async function compartirLibroXlsx(
  wb: XLSX.WorkBook,
  nombreArchivo: string,
  dialogTitle: string
): Promise<void> {
  if (Platform.OS === 'web') {
    const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    descargarBlobEnNavegador(new Blob([arrayBuffer], { type: MIME_XLSX }), nombreArchivo);
    return;
  }

  await guardarXlsxEnDispositivo(wb, nombreArchivo, dialogTitle);
}

/** Columnas fijas de la hoja de detalle (antes de los bloques de visitas). */
const COLUMNAS_BASE_DETALLE = ['Técnico', 'Beneficiario', 'Cédula', 'Vereda', 'Corregimiento', 'Ubicación'];
/** Bloque de visitas sin número de visita (capacitaciones, sueltas). */
const BLOQUE_OTRAS = 'otras';

interface VisitaDetalle {
  fecha: string;
  planificada: boolean;
  /** Qué fue la visita; solo se muestra en el bloque "Otras visitas". */
  descripcion: string;
  /** Solo los formularios realizados pueden tener revisión. */
  coordinacionOk: boolean;
  interventoriaOk: boolean;
}

interface BeneficiarioDetalle {
  nombre: string;
  cedula: string;
  tecnicos: Set<string>;
  vereda: string;
  corregimiento: string;
  ubicacion: string;
  /** Visitas agrupadas por bloque: número de visita del proyecto u "otras". */
  bloques: Map<string, VisitaDetalle[]>;
}

/**
 * Número de visita del proyecto de un formulario. La caracterización es la
 * Visita 1 pero se guarda como tipo, sin `visita_numero`; las visitas
 * técnicas traen su número (2, 3…). Lo demás no tiene número.
 */
function numeroVisitaFormulario(form: Formulario): number | null {
  const n = Number(form.actividad?.visita_numero);
  if (Number.isFinite(n) && n > 0) return n;
  if (form.tipo === 'caracterizacion') return 1;
  return null;
}

const tituloBloque = (bloque: string) =>
  bloque === BLOQUE_OTRAS ? 'Otras visitas' : bloque === '1' ? 'Visita 1 — Caracterización' : `Visita ${bloque}`;

/**
 * Hoja "Detalle de visitas": UNA fila por beneficiario y, hacia la derecha,
 * un bloque por NÚMERO DE VISITA DEL PROYECTO (Visita 1 — Caracterización,
 * Visita 2, Visita 3…), igual para todas las filas: la columna "Visita 2"
 * siempre es la Visita 2, aunque la Visita 1 se haya hecho en otro mes (ese
 * bloque queda vacío). Antes los bloques eran el orden dentro del rango y
 * la Visita 2 caía bajo el título "Visita 1".
 *
 * Cada bloque: fecha, X si coordinación cerró la revisión, X si
 * interventoría la cerró. "Cerró" = `'ok'` de /api/revisiones/resumen
 * (visto bueno final, no secciones sueltas), la regla de los badges.
 *  - Si en un bloque hay formulario realizado y visita planificada, manda
 *    el realizado (es el que tiene revisión).
 *  - Si hay dos formularios del mismo número, van ambas fechas y la X solo
 *    si TODOS están cerrados.
 *  - Solo salen los bloques que existen en el rango; lo que no tiene número
 *    va al bloque final "Otras visitas", con su descripción.
 */
function construirHojaDetallePorBeneficiario(
  tituloDetalle: string,
  realizadas: Formulario[],
  planificadas: VisitaProgramada[],
  estadosRevision: Record<string, EstadoRevision>
): XLSX.WorkSheet {
  // Un mismo beneficiario puede venir con cédula en el formulario y sin
  // ella en la visita planificada (o al revés): se resuelve la cédula por
  // nombre para no partirlo en dos filas.
  const cedulaPorNombre = new Map<string, string>();
  const registrarCedula = (nombre?: string, cedula?: string) => {
    const c = normalizarCedula(cedula);
    const n = normalizarTexto(nombre);
    if (c && n && !cedulaPorNombre.has(n)) cedulaPorNombre.set(n, c);
  };
  realizadas.forEach((f) => registrarCedula(f.beneficiario?.nombre, f.beneficiario?.cedula));
  planificadas.forEach((v) => registrarCedula(v.beneficiario_nombre, v.beneficiario_cedula));

  const clave = (nombre?: string, cedula?: string) => {
    const c = normalizarCedula(cedula) || cedulaPorNombre.get(normalizarTexto(nombre)) || '';
    return c ? `c:${c}` : `n:${normalizarTexto(nombre)}`;
  };

  const porBeneficiario = new Map<string, BeneficiarioDetalle>();
  const bloquesUsados = new Set<string>();

  const agregar = (
    nombre: string,
    cedula: string,
    tecnico: string,
    datos: { vereda?: string; corregimiento?: string; ubicacion?: string },
    numero: number | null,
    visita: VisitaDetalle
  ) => {
    const k = clave(nombre, cedula);
    let b = porBeneficiario.get(k);
    if (!b) {
      b = { nombre, cedula, tecnicos: new Set(), vereda: '', corregimiento: '', ubicacion: '', bloques: new Map() };
      porBeneficiario.set(k, b);
    }
    if (!b.cedula && cedula) b.cedula = cedula;
    if (!b.vereda && datos.vereda) b.vereda = datos.vereda;
    if (!b.corregimiento && datos.corregimiento) b.corregimiento = datos.corregimiento;
    if (!b.ubicacion && datos.ubicacion) b.ubicacion = datos.ubicacion;
    b.tecnicos.add(tecnico);
    const bloque = numero ? String(numero) : BLOQUE_OTRAS;
    bloquesUsados.add(bloque);
    if (!b.bloques.has(bloque)) b.bloques.set(bloque, []);
    b.bloques.get(bloque)!.push(visita);
  };

  for (const form of realizadas) {
    const estado = estadosRevision[form.id];
    agregar(
      form.beneficiario?.nombre || 'Sin beneficiario',
      form.beneficiario?.cedula || '',
      form.tecnico?.nombre || 'Sin técnico',
      {
        vereda: form.beneficiario?.vereda,
        corregimiento: form.beneficiario?.corregimiento,
        ubicacion: form.beneficiario?.municipio,
      },
      numeroVisitaFormulario(form),
      {
        fecha: (form.created_at || '').split('T')[0],
        planificada: false,
        descripcion: form.tipo,
        coordinacionOk: estado?.coordinador === 'ok',
        interventoriaOk: estado?.interventor === 'ok',
      }
    );
  }
  for (const v of planificadas) {
    // Visitas creadas por versiones viejas del calendario no guardaban el
    // beneficiario ni el número aparte, solo en el título:
    // "Visita 1 - Jair Peralta Ortíz". Se usan como respaldo para que caigan
    // en la fila y el bloque correctos y no en una fila "Sin beneficiario".
    const delTitulo = /^\s*Visita\s+(\d+)\s*-\s*(.+?)\s*$/i.exec(v.titulo || '');
    const n = Number(v.actividad_numero) || (delTitulo ? Number(delTitulo[1]) : NaN);
    agregar(
      v.beneficiario_nombre || delTitulo?.[2] || 'Sin beneficiario',
      v.beneficiario_cedula || '',
      v.usuario_nombre || 'Sin técnico asignado',
      { vereda: v.vereda, corregimiento: v.corregimiento, ubicacion: v.ubicacion },
      Number.isFinite(n) && n > 0 ? n : null,
      { fecha: v.fecha, planificada: true, descripcion: v.titulo, coordinacionOk: false, interventoriaOk: false }
    );
  }

  const bloques = Array.from(bloquesUsados)
    .filter((b) => b !== BLOQUE_OTRAS)
    .sort((a, b) => Number(a) - Number(b));
  if (bloquesUsados.has(BLOQUE_OTRAS)) bloques.push(BLOQUE_OTRAS);
  if (bloques.length === 0) bloques.push('1');

  /** Las 3 casillas de un bloque para un beneficiario. */
  const celdasBloque = (bloque: string, visitas: VisitaDetalle[] = []): string[] => {
    const realizadasBloque = visitas.filter((v) => !v.planificada);
    const usar = (realizadasBloque.length > 0 ? realizadasBloque : visitas).sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
    );
    if (usar.length === 0) return ['', '', ''];
    const fecha = usar
      .map(
        (v) =>
          `${v.fecha}${bloque === BLOQUE_OTRAS ? ` — ${v.descripcion}` : ''}${v.planificada ? ' (planificada)' : ''}`
      )
      .join('; ');
    return [
      fecha,
      usar.every((v) => v.coordinacionOk) ? 'X' : '',
      usar.every((v) => v.interventoriaOk) ? 'X' : '',
    ];
  };

  const filasBeneficiarios = Array.from(porBeneficiario.values())
    .map((b) => ({ ...b, tecnico: Array.from(b.tecnicos).sort().join(', ') }))
    .sort((a, b) => a.tecnico.localeCompare(b.tecnico) || a.nombre.localeCompare(b.nombre));

  const nBase = COLUMNAS_BASE_DETALLE.length;
  const totalColumnas = nBase + bloques.length * 3;

  // Dos filas de encabezado: el título del bloque agrupando sus 3 columnas
  // y, debajo, el nombre de cada columna.
  const encabezadoGrupos: string[] = [...COLUMNAS_BASE_DETALLE];
  const encabezadoColumnas: string[] = COLUMNAS_BASE_DETALLE.map(() => '');
  for (const bloque of bloques) {
    encabezadoGrupos.push(tituloBloque(bloque), '', '');
    encabezadoColumnas.push(
      bloque === BLOQUE_OTRAS ? 'Fecha / Visita' : 'Fecha',
      'Revisión Coordinación',
      'Revisión Interventoría'
    );
  }

  const filas: string[][] = [
    [tituloDetalle],
    [],
    encabezadoGrupos,
    encabezadoColumnas,
    ...filasBeneficiarios.map((b) => [
      b.tecnico,
      b.nombre,
      b.cedula,
      b.vereda,
      b.corregimiento,
      b.ubicacion,
      ...bloques.flatMap((bloque) => celdasBloque(bloque, b.bloques.get(bloque))),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [
    { wch: 28 }, { wch: 32 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 24 },
    ...bloques.flatMap((bloque) => [
      { wch: bloque === BLOQUE_OTRAS ? 40 : 26 },
      { wch: 23 },
      { wch: 23 },
    ]),
  ];
  const merges: XLSX.Range[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalColumnas - 1 } }];
  // Columnas fijas: su título ocupa las dos filas de encabezado.
  for (let c = 0; c < nBase; c++) merges.push({ s: { r: 2, c }, e: { r: 3, c } });
  bloques.forEach((_, i) => {
    const c = nBase + i * 3;
    merges.push({ s: { r: 2, c }, e: { r: 2, c: c + 2 } });
  });
  ws['!merges'] = merges;
  return ws;
}

/**
 * Arma el libro de 2 hojas (Resumen por técnico + Detalle de visitas) que
 * comparten el reporte semanal y el mensual. Recibe ya filtradas las visitas
 * realizadas y planificadas del rango, así el mismo formato sale idéntico en
 * ambos reportes.
 */
function construirLibroReporteVisitas(
  encabezadoResumen: [string, string],
  tituloDetalle: string,
  nombreHojaResumen: string,
  realizadas: Formulario[],
  planificadas: VisitaProgramada[],
  /** Estado de revisión por formulario (GET /api/revisiones/resumen). */
  estadosRevision: Record<string, EstadoRevision>,
  /** Si viene, se agrega una hoja extra "Resumen por beneficiario". */
  incluirResumenBeneficiarios = false
): XLSX.WorkBook {
  // Revisadas = formularios realizados con la revisión CERRADA por ese rol
  // (`'ok'` de /api/revisiones/resumen, las mismas X de la hoja de detalle).
  // Pendientes = realizadas − revisadas: las planificadas no tienen
  // formulario, así que no cuentan para la revisión.
  interface ResumenTecnico {
    realizadas: number;
    planificadas: number;
    revisadasCoordinacion: number;
    revisadasInterventoria: number;
  }
  const vacio = (): ResumenTecnico => ({
    realizadas: 0,
    planificadas: 0,
    revisadasCoordinacion: 0,
    revisadasInterventoria: 0,
  });
  const porTecnico = new Map<string, ResumenTecnico>();
  const totales = vacio();

  for (const form of realizadas) {
    const tecnico = form.tecnico?.nombre || 'Sin técnico';
    const datos = porTecnico.get(tecnico) || vacio();
    const estado = estadosRevision[form.id];
    datos.realizadas += 1;
    totales.realizadas += 1;
    if (estado?.coordinador === 'ok') {
      datos.revisadasCoordinacion += 1;
      totales.revisadasCoordinacion += 1;
    }
    if (estado?.interventor === 'ok') {
      datos.revisadasInterventoria += 1;
      totales.revisadasInterventoria += 1;
    }
    porTecnico.set(tecnico, datos);
  }
  for (const visita of planificadas) {
    const tecnico = visita.usuario_nombre || 'Sin técnico asignado';
    const datos = porTecnico.get(tecnico) || vacio();
    datos.planificadas += 1;
    totales.planificadas += 1;
    porTecnico.set(tecnico, datos);
  }

  const filaResumen = (etiqueta: string, d: ResumenTecnico): (string | number)[] => [
    etiqueta,
    d.realizadas,
    d.planificadas,
    d.realizadas + d.planificadas,
    d.revisadasCoordinacion,
    d.revisadasInterventoria,
    d.realizadas - d.revisadasCoordinacion,
    d.realizadas - d.revisadasInterventoria,
  ];

  const resumenFilas: (string | number)[][] = [
    [encabezadoResumen[0]],
    [encabezadoResumen[1]],
    [],
    [
      'Técnico',
      'Visitas realizadas',
      'Visitas planificadas',
      'Total',
      'Revisadas Coordinación',
      'Revisadas Interventoría',
      'Pendientes Coordinación',
      'Pendientes Interventoría',
    ],
    ...Array.from(porTecnico.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tecnico, datos]) => filaResumen(tecnico, datos)),
    [],
    filaResumen('TOTAL', totales),
  ];

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenFilas);
  wsResumen['!cols'] = [
    { wch: 30 }, { wch: 18 }, { wch: 20 }, { wch: 10 },
    { wch: 23 }, { wch: 23 }, { wch: 24 }, { wch: 24 },
  ];
  wsResumen['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
  ];

  const wsDetalle = construirHojaDetallePorBeneficiario(
    tituloDetalle,
    realizadas,
    planificadas,
    estadosRevision
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumen, nombreHojaResumen);
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle de visitas');

  if (incluirResumenBeneficiarios) {
    // Resumen por beneficiario: cuántas visitas realizadas/planificadas tiene
    // cada uno y con qué técnico. Sirve para el desglose técnico → beneficiario.
    const porBeneficiario = new Map<
      string,
      { nombre: string; cedula: string; tecnico: string; realizadas: number; planificadas: number }
    >();

    const claveBeneficiario = (nombre?: string, cedula?: string) =>
      `${normalizarCedula(cedula)}|${normalizarTexto(nombre)}`;

    for (const form of realizadas) {
      const nombre = form.beneficiario?.nombre || 'Sin beneficiario';
      const cedula = form.beneficiario?.cedula || '';
      const clave = claveBeneficiario(nombre, cedula);
      const datos =
        porBeneficiario.get(clave) ||
        { nombre, cedula, tecnico: form.tecnico?.nombre || 'Sin técnico', realizadas: 0, planificadas: 0 };
      datos.realizadas += 1;
      porBeneficiario.set(clave, datos);
    }
    for (const visita of planificadas) {
      const nombre = visita.beneficiario_nombre || 'Sin beneficiario';
      const cedula = visita.beneficiario_cedula || '';
      const clave = claveBeneficiario(nombre, cedula);
      const datos =
        porBeneficiario.get(clave) ||
        {
          nombre,
          cedula,
          tecnico: visita.usuario_nombre || 'Sin técnico asignado',
          realizadas: 0,
          planificadas: 0,
        };
      datos.planificadas += 1;
      porBeneficiario.set(clave, datos);
    }

    const filasBeneficiarios: (string | number)[][] = [
      [`Resumen por beneficiario — ${encabezadoResumen[1]}`],
      [],
      ['Beneficiario', 'Cédula', 'Técnico', 'Visitas realizadas', 'Visitas planificadas', 'Total'],
      ...Array.from(porBeneficiario.values())
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .map((d) => [
          d.nombre,
          d.cedula,
          d.tecnico,
          d.realizadas,
          d.planificadas,
          d.realizadas + d.planificadas,
        ]),
    ];

    const wsBeneficiarios = XLSX.utils.aoa_to_sheet(filasBeneficiarios);
    wsBeneficiarios['!cols'] = [
      { wch: 34 }, { wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 20 }, { wch: 10 },
    ];
    wsBeneficiarios['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
    XLSX.utils.book_append_sheet(wb, wsBeneficiarios, 'Resumen por beneficiario');
  }

  return wb;
}

/** Genera el reporte semanal con resumen por técnico y detalle de visitas. */
export async function generarYCompartirReporteSemanalExcel(
  formularios: Formulario[],
  visitasProgramadas: VisitaProgramada[],
  rango: RangoSemanaCalendario,
  nombreMes: string
): Promise<void> {
  try {
    const realizadas = formularios.filter((form) => {
      const fecha = (form.created_at || '').split('T')[0];
      return fecha >= rango.inicio && fecha <= rango.fin;
    });
    const planificadas = visitasProgramadas.filter(
      (visita) => visita.fecha >= rango.inicio && visita.fecha <= rango.fin && visita.estado === 'pendiente'
    );

    if (
      avisarSiNoHayVisitas(
        realizadas.length + planificadas.length,
        formularios.length,
        `No hay visitas realizadas ni planificadas en la semana ${rango.etiqueta}.`
      )
    ) {
      return;
    }

    // Sin red devuelve {}: el Excel sale igual, con las casillas de revisión vacías.
    const estadosRevision = await fetchResumenRevisiones();

    const wb = construirLibroReporteVisitas(
      [`Reporte semanal de visitas — ${nombreMes}`, `Semana: ${rango.etiqueta}`],
      `Detalle de visitas — ${rango.etiqueta}`,
      'Resumen semanal',
      realizadas,
      planificadas,
      estadosRevision
    );

    const nombreArchivo = `Reporte_Semanal_${nombreMes.replace(/\s+/g, '_')}_${rango.inicio}.xlsx`;
    await compartirLibroXlsx(wb, nombreArchivo, 'Descargar reporte semanal');
  } catch (error) {
    console.error('[CronogramaExcel] Error generando reporte semanal:', error);
    Alert.alert('Error', 'No se pudo generar el reporte semanal en Excel. Intenta de nuevo.');
  }
}

/**
 * Reporte MENSUAL de las personas seleccionadas (casillas del modal). Usa
 * exactamente el mismo formato de 2 hojas que el semanal, pero:
 *  - el rango es el mes completo visible (01 al último día del mes);
 *  - solo entran las visitas de las personas marcadas (por `usuario_id`,
 *    con respaldo por nombre para registros locales aún sin sincronizar);
 *  - si se pasan `beneficiarios`, además se limita a esos beneficiarios
 *    (desglose técnico → beneficiario) y se agrega la hoja
 *    "Resumen por beneficiario". Sin ese parámetro el reporte sale igual
 *    que siempre.
 */
export async function generarYCompartirReporteMensualExcel(
  formularios: Formulario[],
  visitasProgramadas: VisitaProgramada[],
  rango: RangoSemanaCalendario,
  nombreMes: string,
  personas: PersonaReporteExcel[],
  beneficiarios?: BeneficiarioReporteExcel[]
): Promise<void> {
  try {
    const idsSeleccionados = new Set(personas.map((p) => p.id).filter(Boolean));
    const nombresSeleccionados = new Set(personas.map((p) => normalizarTexto(p.nombre)).filter(Boolean));

    const esDelPersonal = (usuarioId?: string, nombre?: string) =>
      (!!usuarioId && idsSeleccionados.has(usuarioId)) ||
      (!!nombre && nombresSeleccionados.has(normalizarTexto(nombre)));

    // Filtro por beneficiario: se compara por cédula (solo dígitos) y, si no
    // hay cédula, por nombre normalizado. Cuando el beneficiario trae su
    // técnico, también se exige que coincida, para no mezclar homónimos.
    const filtroBeneficiarios = beneficiarios && beneficiarios.length > 0 ? beneficiarios : null;
    const cedulasFiltro = new Set(
      (filtroBeneficiarios || []).map((b) => normalizarCedula(b.cedula)).filter(Boolean)
    );
    const nombresFiltro = new Set(
      (filtroBeneficiarios || []).map((b) => normalizarTexto(b.nombre)).filter(Boolean)
    );

    const esDelBeneficiario = (nombre?: string, cedula?: string, tecnicoNombre?: string) => {
      if (!filtroBeneficiarios) return true;
      const cedulaNorm = normalizarCedula(cedula);
      const nombreNorm = normalizarTexto(nombre);
      const coincide =
        (!!cedulaNorm && cedulasFiltro.has(cedulaNorm)) ||
        (!!nombreNorm && nombresFiltro.has(nombreNorm));
      if (!coincide) return false;
      // Si el beneficiario seleccionado tiene técnico asignado, exigir que la
      // visita sea de ese técnico (evita homónimos entre técnicos).
      const tecnicoNorm = normalizarTexto(tecnicoNombre);
      const tecnicosDelBeneficiario = (filtroBeneficiarios || [])
        .filter(
          (b) =>
            (!!cedulaNorm && normalizarCedula(b.cedula) === cedulaNorm) ||
            (!!nombreNorm && normalizarTexto(b.nombre) === nombreNorm)
        )
        .map((b) => normalizarTexto(b.tecnicoNombre))
        .filter(Boolean);
      if (tecnicosDelBeneficiario.length === 0) return true;
      return tecnicosDelBeneficiario.includes(tecnicoNorm);
    };

    const realizadas = formularios.filter((form) => {
      const fecha = (form.created_at || '').split('T')[0];
      if (!(fecha >= rango.inicio && fecha <= rango.fin)) return false;
      if (!esDelPersonal(form.usuario_id, form.tecnico?.nombre)) return false;
      return esDelBeneficiario(
        form.beneficiario?.nombre,
        form.beneficiario?.cedula,
        form.tecnico?.nombre
      );
    });

    const planificadas = visitasProgramadas.filter((visita) => {
      if (visita.estado !== 'pendiente') return false;
      if (!(visita.fecha >= rango.inicio && visita.fecha <= rango.fin)) return false;
      if (!esDelPersonal(visita.usuario_id, visita.usuario_nombre)) return false;
      return esDelBeneficiario(
        visita.beneficiario_nombre,
        visita.beneficiario_cedula,
        visita.usuario_nombre
      );
    });

    const quien =
      personas.length === 1
        ? `${personas[0].nombre} no tiene`
        : 'Las personas seleccionadas no tienen';
    const deBeneficiarios = filtroBeneficiarios ? ' con los beneficiarios marcados' : '';
    if (
      avisarSiNoHayVisitas(
        realizadas.length + planificadas.length,
        formularios.length,
        `${quien} visitas realizadas ni planificadas${deBeneficiarios} en ${nombreMes}.`
      )
    ) {
      return;
    }

    // Sin red devuelve {}: el Excel sale igual, con las casillas de revisión vacías.
    const estadosRevision = await fetchResumenRevisiones();

    const wb = construirLibroReporteVisitas(
      [`Reporte mensual de visitas — ${nombreMes}`, `Mes: ${rango.etiqueta}`],
      `Detalle de visitas — ${nombreMes}`,
      'Resumen mensual',
      realizadas,
      planificadas,
      estadosRevision,
      !!filtroBeneficiarios
    );

    // Nombre del archivo: si el filtro deja un solo beneficiario, se nombra
    // con su nombre para que sea fácil identificarlo en Descargas.
    const sufijoBeneficiario =
      filtroBeneficiarios && filtroBeneficiarios.length === 1
        ? `_${filtroBeneficiarios[0].nombre.replace(/\s+/g, '_')}`
        : '';
    const nombreArchivo = `Reporte_Mensual_${nombreMes.replace(/\s+/g, '_')}${sufijoBeneficiario}.xlsx`;
    await compartirLibroXlsx(wb, nombreArchivo, 'Descargar reporte mensual');
  } catch (error) {
    console.error('[CronogramaExcel] Error generando reporte mensual:', error);
    Alert.alert('Error', 'No se pudo generar el reporte mensual en Excel. Intenta de nuevo.');
  }
}
