// ============================================================
// GEODAILY — Hook de revisiones de un formulario (novedad/visto bueno)
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { fetchRevisiones, Revision } from '../services/revisiones.service';

export function useRevisiones(formularioId: string) {
  const [revisiones, setRevisiones] = useState<Revision[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    setCargando(true);
    setRevisiones(await fetchRevisiones(formularioId));
    setCargando(false);
  }, [formularioId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { revisiones, cargando, recargar };
}
