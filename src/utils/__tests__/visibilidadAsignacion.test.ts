import { crearFiltroAsignacion } from '../visibilidadAsignacion';

const padron = [
  { cedula: '1.111', tecnico_asignado_id: 'T1' }, // asignado a mí
  { cedula: '2222', tecnico_asignado_id: null }, // desasignado
  { cedula: '3333', tecnico_asignado_id: 'T2' }, // reasignado a otro
  { cedula: '4444', tecnico_asignado_id: 'T2' }, // cédula duplicada:
  { cedula: '4444', tecnico_asignado_id: 'T1' }, //   una fila es mía
];

describe('crearFiltroAsignacion', () => {
  const visible = crearFiltroAsignacion(padron, 'T1');

  it('muestra los beneficiarios asignados hoy al técnico', () => {
    expect(visible('1111')).toBe(true);
    expect(visible('1 111')).toBe(true);
  });

  it('oculta los desasignados y los reasignados a otro técnico', () => {
    expect(visible('2222')).toBe(false);
    expect(visible('3333')).toBe(false);
  });

  it('con cédula duplicada basta con que una fila sea suya', () => {
    expect(visible('4444')).toBe(true);
  });

  it('no oculta lo que no puede decidir: sin cédula o fuera del padrón', () => {
    expect(visible('')).toBe(true);
    expect(visible(undefined)).toBe(true);
    expect(visible('9999')).toBe(true);
  });

  it('padrón vacío o sin usuario: no oculta nada', () => {
    expect(crearFiltroAsignacion([], 'T1')('2222')).toBe(true);
    expect(crearFiltroAsignacion(padron, null)('2222')).toBe(true);
  });
});
