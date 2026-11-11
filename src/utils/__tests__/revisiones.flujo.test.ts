// Casos COMPARTIDOS con el backend (backend/src/lib/__tests__/estadoRevision.test.js):
// la regla de la app debe coincidir exactamente con la del servidor.
import { describe, expect, it } from '@jest/globals';
import { estaNovedadResuelta, rolEstaOk, seccionesAprobadasPorRol } from '../revisiones';
import type { Revision } from '../../services/revisiones.service';
import datos from '../../../backend/src/lib/__tests__/casosEstadoRevision.json';

type Caso = {
  nombre: string;
  revisiones: Array<Partial<Revision> & { id: number }>;
  esperado: { abiertas?: number[]; cerrado_coordinador?: boolean; secciones_aprobadas?: number; rol_flujo?: string | null };
};

const completar = (r: Caso['revisiones'][number]): Revision => ({
  formulario_id: 'f1',
  revisor_id: 'x',
  revisor_nombre: null,
  comentario: null,
  datos_formulario_json: null,
  seccion: null,
  ...(r as any),
});

describe('regla de revisiones = backend (casos compartidos)', () => {
  for (const caso of (datos as { casos: Caso[] }).casos) {
    it(caso.nombre, () => {
      const revs = caso.revisiones.map(completar);
      const esp = caso.esperado;
      if (esp.abiertas) {
        const abiertas = revs
          .filter((r) => r.tipo === 'novedad' && !estaNovedadResuelta(r, revs))
          .map((r) => r.id)
          .sort();
        expect(abiertas).toEqual(esp.abiertas);
      }
      if (esp.cerrado_coordinador !== undefined) {
        expect(rolEstaOk('coordinador', revs)).toBe(esp.cerrado_coordinador);
      }
      if (esp.secciones_aprobadas !== undefined && esp.rol_flujo !== 'interventor') {
        expect(seccionesAprobadasPorRol('coordinador', revs).length).toBe(esp.secciones_aprobadas);
      }
    });
  }
});
