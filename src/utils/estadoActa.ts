// ============================================================
// GEODAILY — Presentación del estado del Acta de Entrega y Recibo
// ============================================================
// Un solo código de colores para todas las pantallas (detalle de la entrega,
// lista de entregas, ficha del beneficiario):
//   · Gris     — sin diligenciar
//   · Amarillo — borrador, o completada con pendientes (faltan firmas/datos)
//   · Verde    — completada por el técnico
// Si el acta ya está en el servidor o se subirá con señal va en la línea
// secundaria, NO en el color: completar es lo que hace el técnico y debe
// verse verde al instante, aunque no haya señal.
//
// Módulo puro (sin React ni servicios) para poder probarlo.
// ============================================================

export type EstadoActa =
  | 'sin_diligenciar'
  | 'borrador'
  | 'borrador_respaldado'
  | 'borrador_servidor'
  | 'completada'
  | 'completada_servidor'
  | 'pendiente_subir';

export type TonoActa = 'gris' | 'amarillo' | 'verde';

export interface PresentacionActa {
  tono: TonoActa;
  /** Línea principal (estado). */
  txt: string;
  /** Línea secundaria (dónde está guardada), o null. */
  sub: string | null;
  /** Texto del botón del detalle de la entrega. */
  boton: string;
}

const esCompletada = (e: EstadoActa): boolean =>
  e === 'completada' || e === 'completada_servidor' || e === 'pendiente_subir';

/** Pendientes válidos (texto no vacío) de la lista `faltantes` del acta. */
export const limpiarFaltantes = (faltantes: unknown): string[] =>
  Array.isArray(faltantes) ? faltantes.map((f) => String(f ?? '').trim()).filter(Boolean) : [];

export const presentacionActa = (estado: EstadoActa, faltantes: unknown = []): PresentacionActa => {
  const pendientes = limpiarFaltantes(faltantes);
  if (esCompletada(estado)) {
    const sub =
      estado === 'pendiente_subir' ? '📱 Guardada en el teléfono · se subirá con señal' : '☁️ En el servidor';
    return pendientes.length
      ? { tono: 'amarillo', txt: `✓ Completada con pendientes: ${pendientes.join(', ')}`, sub, boton: '✏️ Ver / editar acta' }
      : { tono: 'verde', txt: '✓ Acta completada', sub, boton: '✏️ Ver / editar acta' };
  }
  switch (estado) {
    case 'borrador':
      return { tono: 'amarillo', txt: '⏳ Borrador', sub: '📱 Solo en este dispositivo · pendiente de respaldar en el servidor', boton: '📝 Continuar acta' };
    case 'borrador_respaldado':
      return { tono: 'amarillo', txt: '⏳ Borrador', sub: '☁️ Respaldado en el servidor', boton: '📝 Continuar acta' };
    case 'borrador_servidor':
      return { tono: 'amarillo', txt: '⏳ Borrador', sub: '☁️ Guardado en el servidor', boton: '📝 Continuar acta' };
    default:
      return { tono: 'gris', txt: 'Acta sin diligenciar', sub: null, boton: '📝 Diligenciar acta' };
  }
};
