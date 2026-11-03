import { describe, expect, it } from '@jest/globals';

import {
  COMPROMISOS_V3,
  DESCRIPCION_VISITA3_DEFAULT,
  OBJETIVO_VISITA3_DEFAULT,
  PREGUNTAS_V3,
  crearEstadoInicialV3,
  faltantesV3,
  hidratarEstadoV3,
  respuestaPreguntaV3,
  sanearPorcentajeManual,
  textoCompromiso,
} from '../visitaTecnica3';
import { tipoFormularioEvidencia, VISITAS_TECNICAS } from '../visitaTecnica';

/** Estado con todo lo obligatorio diligenciado. */
const completo = () => {
  const d = crearEstadoInicialV3();
  d.p1_estado_terreno = 'a';
  d.p2_actividades_adecuacion = 'a';
  d.p3_terreno_limpio = 'a';
  d.p4_area_delimitada = 'Sí';
  d.p5_condiciones_siembra = 'Sí';
  d.p5_1_recomendaciones_material = 'a';
  d.p6_problemas_drenaje = 'No';
  d.p7_medidas_preventivas = 'a';
  d.p8_recomendaciones_adecuacion = 'a';
  d.p9_sistema_trazado = 'Cuadrado';
  d.p10_orientacion_surcos = 'Pendiente del terreno';
  d.p11_manejo_drenaje = 'Drenaje natural';
  d.p12_ajustes_previos = 'a';
  for (const { clave } of COMPROMISOS_V3) d.compromisos[clave].estado = 'Cumplido';
  d.cumple_recomendaciones = 'Sí';
  d.dificultades = 'Ninguna';
  d.observaciones = 'a';
  d.recomendaciones = 'a';
  return d;
};

describe('Visita Técnica 3 — estado y validación', () => {
  it('arranca con objetivo y descripción por defecto (editables)', () => {
    const d = crearEstadoInicialV3();
    expect(d.objetivo).toBe(OBJETIVO_VISITA3_DEFAULT);
    expect(d.descripcion_visita).toBe(DESCRIPCION_VISITA3_DEFAULT);
  });

  it('un formulario vacío reporta faltantes y uno completo no', () => {
    expect(faltantesV3(crearEstadoInicialV3()).length).toBeGreaterThan(10);
    expect(faltantesV3(completo())).toEqual([]);
  });

  it('no existe la pregunta 3.1 (se eliminó por duplicar la 8)', () => {
    expect(PREGUNTAS_V3.map((p) => p.numero)).not.toContain('3.1');
    expect(PREGUNTAS_V3.map((p) => p.numero)).toContain('5.1');
  });

  it('la 6 exige problemas solo si la respuesta es Sí, y el "cuál" si marcó Otro', () => {
    const d = completo();
    d.p6_problemas_drenaje = 'Sí';
    expect(faltantesV3(d)).toContain('Pregunta 6 (indica los problemas)');
    d.p6_problemas = ['Otro'];
    expect(faltantesV3(d)).toContain('Pregunta 6 (¿Cuál otro?)');
    d.p6_otro = 'Salinidad';
    expect(faltantesV3(d)).toEqual([]);
    expect(respuestaPreguntaV3(d, 'p6_problemas_drenaje')).toBe('Sí — Otro: Salinidad');
  });

  it('"Parcial" exige porcentaje; con "Otro" exige el valor manual', () => {
    const d = completo();
    d.compromisos.cercado.estado = 'Parcial';
    expect(faltantesV3(d)).toContain('Seguimiento 1');
    d.compromisos.cercado.porcentaje = '30%';
    expect(faltantesV3(d)).toEqual([]);
    expect(textoCompromiso(d.compromisos.cercado)).toBe('Parcial (30%)');
    d.compromisos.cercado.porcentaje = 'Otro';
    expect(faltantesV3(d)).toContain('Seguimiento 1');
    d.compromisos.cercado.porcentaje_otro = '65';
    expect(faltantesV3(d)).toEqual([]);
    expect(textoCompromiso(d.compromisos.cercado)).toBe('Parcial (65%)');
  });

  it('solo el compromiso 1 admite "No aplica"', () => {
    expect(COMPROMISOS_V3[0].opciones).toContain('No aplica');
    for (const c of COMPROMISOS_V3.slice(1)) expect(c.opciones).not.toContain('No aplica');
  });

  it('sanea el porcentaje manual a 1–2 dígitos', () => {
    expect(sanearPorcentajeManual('6a5')).toBe('65');
    expect(sanearPorcentajeManual('123')).toBe('12');
    expect(sanearPorcentajeManual('007')).toBe('0');
    expect(sanearPorcentajeManual('')).toBe('');
  });

  it('hidrata borradores parciales sin romper', () => {
    const d = hidratarEstadoV3({ p1_estado_terreno: 'x' } as any);
    expect(d.p1_estado_terreno).toBe('x');
    expect(d.compromisos.ahoyado.estado).toBe('');
    expect(hidratarEstadoV3(undefined).objetivo).toBe(OBJETIVO_VISITA3_DEFAULT);
  });
});

describe('Visita Técnica 3 — carpeta de evidencia (MinIO)', () => {
  it('la visita 3 usa visita_tecnica_3; la 2, la antigua y la caracterización conservan su tipo', () => {
    expect(tipoFormularioEvidencia({ tipo: 'visita_tecnica', actividad: { visita_numero: 3 } })).toBe('visita_tecnica_3');
    expect(tipoFormularioEvidencia({ tipo: 'visita_tecnica', actividad: { visita_numero: 2 } })).toBe('visita_tecnica');
    expect(tipoFormularioEvidencia({ tipo: 'visita_tecnica', actividad: {} })).toBe('visita_tecnica');
    expect(tipoFormularioEvidencia({ tipo: 'caracterizacion', actividad: { visita_numero: 3 } })).toBe('caracterizacion');
    expect(tipoFormularioEvidencia(undefined)).toBeUndefined();
  });

  it('la visita 3 está registrada con formato v3', () => {
    expect(VISITAS_TECNICAS.find((v) => v.numero === 3)?.formato).toBe('v3');
  });
});
