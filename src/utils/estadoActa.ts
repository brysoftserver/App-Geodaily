// ============================================================
// GEODAILY — Presentación del estado del Acta de Entrega y Recibo
// ============================================================
// Un solo código para todas las pantallas (detalle de la entrega, lista de
// entregas, ficha del beneficiario), para saber qué pasa con cada acta sin
// tener que entrar:
//   Línea del acta:
//     · "Acta sin diligenciar"            · "⏳ Acta en borrador"
//     · "✓ Acta completa por parte del técnico"
//     · "⚠ Completada con pendientes: …"
//   Línea del interventor (solo si el técnico ya la completó):
//     · "⏳ Falta firma del interventor"  · "✓ Firmada por el interventor"
//   Tono (borde de la tarjeta):
//     · Gris     — sin acta o en borrador
//     · Amarillo — el técnico la completó y falta el interventor, o quedó con pendientes
//     · Verde    — todo completo: técnico e interventor
// Si el acta está en el servidor o se subirá con señal va en `sub`, NO en el tono.
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
  /** Línea del acta (lo que hizo el técnico). */
  txt: string;
  /** Tono del texto de la línea del acta. */
  tonoTxt: TonoActa;
  /** Línea del interventor, o null si el técnico aún no la completó. */
  interventor: { txt: string; tono: TonoActa } | null;
  /** Dónde está guardada el acta, o null. */
  sub: string | null;
  /** Texto del botón del detalle de la entrega. */
  boton: string;
}

export const esCompletada = (e: EstadoActa): boolean =>
  e === 'completada' || e === 'completada_servidor' || e === 'pendiente_subir';

/** Pendientes válidos (texto no vacío) de la lista `faltantes` del acta. */
export const limpiarFaltantes = (faltantes: unknown): string[] =>
  Array.isArray(faltantes) ? faltantes.map((f) => String(f ?? '').trim()).filter(Boolean) : [];

/** ¿El valor es una firma dibujada (imagen)? */
export const esFirmaDibujada = (v: unknown): boolean => typeof v === 'string' && v.startsWith('data:image');

export const presentacionActa = (
  estado: EstadoActa,
  faltantes: unknown = [],
  firmaInterventoria = false
): PresentacionActa => {
  const pendientes = limpiarFaltantes(faltantes);
  if (esCompletada(estado)) {
    const sub =
      estado === 'pendiente_subir' ? '📱 Acta guardada en el teléfono · se subirá con señal' : '☁️ Acta en el servidor';
    const interventor = firmaInterventoria
      ? { txt: '✓ Firmada por el interventor', tono: 'verde' as const }
      : { txt: '⏳ Falta firma del interventor', tono: 'amarillo' as const };
    const boton = '✏️ Ver / editar acta';
    if (pendientes.length) {
      return { tono: 'amarillo', tonoTxt: 'amarillo', txt: `⚠ Completada con pendientes: ${pendientes.join(', ')}`, interventor, sub, boton };
    }
    return {
      tono: firmaInterventoria ? 'verde' : 'amarillo',
      tonoTxt: 'verde',
      txt: '✓ Acta completa por parte del técnico',
      interventor,
      sub,
      boton,
    };
  }
  const borrador = (sub: string): PresentacionActa => ({
    tono: 'gris',
    tonoTxt: 'amarillo',
    txt: '⏳ Acta en borrador',
    interventor: null,
    sub,
    boton: '📝 Continuar acta',
  });
  switch (estado) {
    case 'borrador':
      return borrador('📱 Solo en este dispositivo · pendiente de respaldar en el servidor');
    case 'borrador_respaldado':
      return borrador('☁️ Borrador respaldado en el servidor');
    case 'borrador_servidor':
      return borrador('☁️ Borrador guardado en el servidor');
    default:
      return { tono: 'gris', tonoTxt: 'gris', txt: 'Acta sin diligenciar', interventor: null, sub: null, boton: '📝 Diligenciar acta' };
  }
};

/** Estado del acta según el teléfono. */
export interface ActaSegunTelefono {
  estado: EstadoActa;
  faltantes: string[];
  firmaInterventoria: boolean;
}

/** Estado del acta según el servidor (resumen de POST /actas/estado). */
export interface ActaSegunServidor {
  estado: 'publicada' | 'borrador';
  firmaInterventoria: boolean;
  faltantes?: string[];
}

/**
 * Combina lo del teléfono con lo del servidor. Lo completado en el teléfono
 * manda (es lo más nuevo del técnico), pero la firma del interventor puede
 * haberse puesto en otro dispositivo: basta que esté en cualquiera de los dos.
 * Si el teléfono no tiene el acta completada (p. ej. la tablet con la misma
 * cuenta), se usa lo del servidor.
 */
export const combinarActa = (tel: ActaSegunTelefono, srv?: ActaSegunServidor | null): ActaSegunTelefono => {
  if (esCompletada(tel.estado)) {
    return { ...tel, firmaInterventoria: tel.firmaInterventoria || !!srv?.firmaInterventoria };
  }
  if (srv?.estado === 'publicada') {
    return { estado: 'completada_servidor', faltantes: limpiarFaltantes(srv.faltantes), firmaInterventoria: !!srv.firmaInterventoria };
  }
  if (tel.estado !== 'sin_diligenciar') return tel;
  if (srv?.estado === 'borrador') return { estado: 'borrador_servidor', faltantes: [], firmaInterventoria: false };
  return tel;
};

// ─── Varias actas de un beneficiario (ej. Preparación del Terreno) ──────────

/** Acta de una actividad según el servidor (resumen de POST /actas/por-actividad). */
export interface ActaDeActividadSegunServidor extends ActaSegunServidor {
  id: string;
}

/** Acta completada guardada en el teléfono (aún sin subir o ya subida). */
export interface ActaCompletadaEnTelefono {
  id: string;
  sincronizado: boolean;
  faltantes: string[];
  firmaInterventoria: boolean;
}

/**
 * Une, por id, las actas del servidor con las completadas en el teléfono.
 * Lo completado en el teléfono manda (lo más nuevo del técnico); la firma del
 * interventor basta que esté en cualquiera de los dos.
 */
export const unirActasBeneficiario = (
  servidor: ActaDeActividadSegunServidor[] = [],
  telefono: ActaCompletadaEnTelefono[] = []
): ActaSegunTelefono[] => {
  const porId = new Map<string, ActaSegunTelefono>();
  for (const s of servidor) {
    porId.set(
      s.id,
      s.estado === 'publicada'
        ? { estado: 'completada_servidor', faltantes: limpiarFaltantes(s.faltantes), firmaInterventoria: !!s.firmaInterventoria }
        : { estado: 'borrador_servidor', faltantes: [], firmaInterventoria: false }
    );
  }
  for (const t of telefono) {
    const srv = servidor.find((s) => s.id === t.id);
    porId.set(t.id, {
      estado: t.sincronizado ? 'completada' : 'pendiente_subir',
      faltantes: limpiarFaltantes(t.faltantes),
      firmaInterventoria: t.firmaInterventoria || !!srv?.firmaInterventoria,
    });
  }
  return [...porId.values()];
};

/**
 * Resume varias actas en la que más importa mostrar: primero la que necesita
 * algo (falta el interventor o quedó con pendientes), luego una completa del
 * todo, luego un borrador. `total` = cuántas actas tiene.
 */
export const resumirActas = (actas: ActaSegunTelefono[]): { acta: ActaSegunTelefono; total: number } => {
  const completadas = actas.filter((a) => esCompletada(a.estado));
  const porAtender = completadas.find((a) => !a.firmaInterventoria || limpiarFaltantes(a.faltantes).length > 0);
  const acta =
    porAtender ??
    completadas[0] ??
    actas.find((a) => !esCompletada(a.estado) && a.estado !== 'sin_diligenciar') ??
    { estado: 'sin_diligenciar' as const, faltantes: [], firmaInterventoria: false };
  return { acta, total: actas.length };
};
