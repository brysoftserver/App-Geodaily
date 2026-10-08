// ============================================================
// GEODAILY — Exportar cronograma de visitas planificadas a Excel
// ============================================================
// Genera un .xlsx real (vía SheetJS) con las visitas planificadas de una
// sola persona (técnico, coordinador o interventor) y lo comparte con el
// visor/apps del dispositivo — mismo patrón de escritura base64 +
// expo-sharing que ya usa mediaPackage.service.ts para los .zip.

import { Alert, Platform } from 'react-native';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Formulario, VisitaProgramada } from '../types';
import { formatFecha } from '../utils/formatters';
import { descargarBlobEnNavegador } from '../utils/webDownload';

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

    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const uri = `${FileSystem.cacheDirectory}${nombreArchivo}`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: MIME_XLSX,
        dialogTitle: 'Descargar cronograma',
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    } else {
      Alert.alert('Cronograma generado', `Archivo guardado en: ${uri}`);
    }
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
 * Escribe el libro como .xlsx y lo comparte (móvil) o lo descarga (web) —
 * misma mecánica base64 + expo-sharing para todas las exportaciones del
 * calendario, así no se duplica la rama de plataforma en cada reporte.
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

  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const uri = `${FileSystem.cacheDirectory}${nombreArchivo}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: MIME_XLSX,
      dialogTitle,
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  } else {
    Alert.alert('Reporte generado', `Archivo guardado en: ${uri}`);
  }
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
  planificadas: VisitaProgramada[]
): XLSX.WorkBook {
  const porTecnico = new Map<string, { realizadas: number; planificadas: number }>();

  for (const form of realizadas) {
    const tecnico = form.tecnico?.nombre || 'Sin técnico';
    const datos = porTecnico.get(tecnico) || { realizadas: 0, planificadas: 0 };
    datos.realizadas += 1;
    porTecnico.set(tecnico, datos);
  }
  for (const visita of planificadas) {
    const tecnico = visita.usuario_nombre || 'Sin técnico asignado';
    const datos = porTecnico.get(tecnico) || { realizadas: 0, planificadas: 0 };
    datos.planificadas += 1;
    porTecnico.set(tecnico, datos);
  }

  const resumenFilas: (string | number)[][] = [
    [encabezadoResumen[0]],
    [encabezadoResumen[1]],
    [],
    ['Técnico', 'Visitas realizadas', 'Visitas planificadas', 'Total'],
    ...Array.from(porTecnico.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([tecnico, datos]) => [
      tecnico,
      datos.realizadas,
      datos.planificadas,
      datos.realizadas + datos.planificadas,
    ]),
    [],
    ['TOTAL', realizadas.length, planificadas.length, realizadas.length + planificadas.length],
  ];

  const detalleFilas: (string | number)[][] = [
    [tituloDetalle],
    [],
    ['Fecha', 'Estado', 'Técnico', 'Beneficiario', 'Visita', 'Vereda', 'Corregimiento', 'Ubicación'],
    ...realizadas.map((form) => [
      form.created_at.split('T')[0],
      'Realizada',
      form.tecnico?.nombre || 'Sin técnico',
      form.beneficiario?.nombre || '',
      form.actividad?.visita_numero ? `Visita ${form.actividad.visita_numero}` : form.tipo,
      form.beneficiario?.vereda || '',
      form.beneficiario?.corregimiento || '',
      form.beneficiario?.municipio || '',
    ]),
    ...planificadas.map((visita) => [
      visita.fecha,
      'Planificada',
      visita.usuario_nombre || 'Sin técnico asignado',
      visita.beneficiario_nombre || '',
      visita.actividad_numero ? `Visita ${visita.actividad_numero}` : visita.titulo,
      visita.vereda || '',
      visita.corregimiento || '',
      visita.ubicacion || '',
    ]),
  ];

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenFilas);
  wsResumen['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 21 }, { wch: 12 }];
  wsResumen['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
  ];

  const wsDetalle = XLSX.utils.aoa_to_sheet(detalleFilas);
  wsDetalle['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 28 }, { wch: 30 },
    { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 30 },
  ];
  wsDetalle['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumen, nombreHojaResumen);
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle de visitas');
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

    const wb = construirLibroReporteVisitas(
      [`Reporte semanal de visitas — ${nombreMes}`, `Semana: ${rango.etiqueta}`],
      `Detalle de visitas — ${rango.etiqueta}`,
      'Resumen semanal',
      realizadas,
      planificadas
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
 *    con respaldo por nombre para registros locales aún sin sincronizar).
 */
export async function generarYCompartirReporteMensualExcel(
  formularios: Formulario[],
  visitasProgramadas: VisitaProgramada[],
  rango: RangoSemanaCalendario,
  nombreMes: string,
  personas: PersonaReporteExcel[]
): Promise<void> {
  try {
    const idsSeleccionados = new Set(personas.map((p) => p.id).filter(Boolean));
    const nombresSeleccionados = new Set(personas.map((p) => p.nombre).filter(Boolean));

    const esDelPersonal = (usuarioId?: string, nombre?: string) =>
      (!!usuarioId && idsSeleccionados.has(usuarioId)) ||
      (!!nombre && nombresSeleccionados.has(nombre));

    const realizadas = formularios.filter((form) => {
      const fecha = (form.created_at || '').split('T')[0];
      if (!(fecha >= rango.inicio && fecha <= rango.fin)) return false;
      return esDelPersonal(form.usuario_id, form.tecnico?.nombre);
    });

    const planificadas = visitasProgramadas.filter((visita) => {
      if (visita.estado !== 'pendiente') return false;
      if (!(visita.fecha >= rango.inicio && visita.fecha <= rango.fin)) return false;
      return esDelPersonal(visita.usuario_id, visita.usuario_nombre);
    });

    const wb = construirLibroReporteVisitas(
      [`Reporte mensual de visitas — ${nombreMes}`, `Mes: ${rango.etiqueta}`],
      `Detalle de visitas — ${nombreMes}`,
      'Resumen mensual',
      realizadas,
      planificadas
    );

    const nombreArchivo = `Reporte_Mensual_${nombreMes.replace(/\s+/g, '_')}.xlsx`;
    await compartirLibroXlsx(wb, nombreArchivo, 'Descargar reporte mensual');
  } catch (error) {
    console.error('[CronogramaExcel] Error generando reporte mensual:', error);
    Alert.alert('Error', 'No se pudo generar el reporte mensual en Excel. Intenta de nuevo.');
  }
}
