// ============================================================
// GEODAILY — Estado "Revisado por interventoría" de una actividad
// ============================================================
// Carga los OK de la actividad al enfocar la pantalla y expone `alternar`
// (marcar / quitar, este último con confirmación). `puedeRevisar` solo es
// true para admin e interventor.
// ============================================================

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../store/AuthContext';
import { avisar, confirmar } from '../utils/dialogos';
import {
  ROLES_REVISAN_INTERVENTORIA,
  RevisionInterventoria,
  listarRevisionesInterventoria,
  marcarRevisadoInterventoria,
  quitarRevisadoInterventoria,
} from '../services/revisionInterventoria.service';

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

export function useRevisionInterventoria(actividad: string, activo = true) {
  const { user } = useAuth();
  const puedeRevisar = ROLES_REVISAN_INTERVENTORIA.includes(user?.rol ?? '');
  const [revisiones, setRevisiones] = useState<Record<string, RevisionInterventoria>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!activo) return;
    try {
      const lista = await listarRevisionesInterventoria(actividad);
      setRevisiones(Object.fromEntries(lista.map((r) => [r.referencia, r])));
    } catch {
      // Sin red: se muestran como pendientes; el OK se vuelve a consultar al enfocar.
    }
  }, [actividad, activo]);

  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));

  const estaRevisado = useCallback((referencia: string | number) => !!revisiones[String(referencia)], [revisiones]);

  const alternar = useCallback(
    async (referencia: string | number) => {
      const ref = String(referencia);
      if (!puedeRevisar || ocupado !== null) return;
      const yaRevisado = !!revisiones[ref];
      if (yaRevisado && !(await confirmar('Quitar revisión', '¿Quitar el "Revisado por interventoría"? El registro vuelve a quedar pendiente.', 'Quitar', true))) {
        return;
      }
      setOcupado(ref);
      try {
        if (yaRevisado) {
          await quitarRevisadoInterventoria(actividad, ref);
          setRevisiones(({ [ref]: _, ...resto }) => resto);
        } else {
          const r = await marcarRevisadoInterventoria(actividad, ref);
          setRevisiones((prev) => ({ ...prev, [ref]: r }));
        }
      } catch (e) {
        avisar('No se pudo guardar la revisión', mensajeError(e, 'Inténtalo de nuevo.'));
      } finally {
        setOcupado(null);
      }
    },
    [actividad, ocupado, puedeRevisar, revisiones]
  );

  return { puedeRevisar, revisiones, estaRevisado, alternar, ocupado, recargar };
}
