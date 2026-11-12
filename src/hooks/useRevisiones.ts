// ============================================================
// GEODAILY — Hook de revisiones de un formulario (novedad/visto bueno)
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { fetchRevisionesYCorrecciones, Revision, Correccion, FlujoRevision } from '../services/revisiones.service';

export function useRevisiones(formularioId: string) {
  const [revisiones, setRevisiones] = useState<Revision[]>([]);
  /** Correcciones del técnico (para marcar novedades "por verificar"). */
  const [correcciones, setCorrecciones] = useState<Correccion[]>([]);
  /** Estado del flujo calculado por el servidor (null offline / backend viejo). */
  const [flujo, setFlujo] = useState<FlujoRevision | null>(null);
  const [cargando, setCargando] = useState(true);

  /**
   * `silencioso` (recarga automática): sin indicador de carga y, si el
   * servidor no respondió, se conserva lo que ya se ve en vez de vaciarlo.
   */
  const recargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    const datos = await fetchRevisionesYCorrecciones(formularioId);
    if (silencioso && !datos.ok) return;
    setRevisiones(datos.revisiones);
    setCorrecciones(datos.correcciones);
    setFlujo(datos.flujo);
    setCargando(false);
  }, [formularioId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { revisiones, correcciones, flujo, cargando, recargar };
}
