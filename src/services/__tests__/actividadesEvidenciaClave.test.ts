// Clave de la evidencia (acta + fotos) de actividades y subactividades.
// Debe coincidir con backend/src/lib/actividadesEvidencia.js.

import { buscarActividad, claveEvidencia, descomponerClaveEvidencia, filaInicialActa, revisionEvidencia } from '../../data/actividades';

describe('Clave de la evidencia por subactividad', () => {
  it('la principal conserva su id; la subactividad usa {actividad}.{sub}', () => {
    expect(claveEvidencia('preparacion_terreno')).toBe('preparacion_terreno');
    expect(claveEvidencia('siembra_platano', 'fertilizacion')).toBe('siembra_platano.fertilizacion');
    // No se mezcla con la actividad principal "fertilizacion".
    expect(claveEvidencia('siembra_platano', 'fertilizacion')).not.toBe('fertilizacion');
  });

  it('descompone la clave', () => {
    expect(descomponerClaveEvidencia('preparacion_terreno')).toEqual({ actividad: 'preparacion_terreno', sub: null });
    expect(descomponerClaveEvidencia('siembra_forestales.siembra_plantulas')).toEqual({ actividad: 'siembra_forestales', sub: 'siembra_plantulas' });
  });

  it('el OK de interventoría: principal por item, subactividad "{sub}:{item}" en la actividad padre', () => {
    expect(revisionEvidencia('preparacion_terreno', 7)).toEqual({ actividad: 'preparacion_terreno', referencia: '7' });
    expect(revisionEvidencia('siembra_platano.trazado_ahoyado_encalado', 7)).toEqual({ actividad: 'siembra_platano', referencia: 'trazado_ahoyado_encalado:7' });
  });

  it('buscarActividad resuelve la subactividad sin cambiar las principales', () => {
    expect(buscarActividad('preparacion_terreno')?.nombre).toBe('Preparación del Terreno');
    expect(buscarActividad('siembra_platano.fertilizacion')).toEqual({ id: 'siembra_platano.fertilizacion', nombre: 'Siembra de Plátano · Fertilización', icon: '🧴' });
    expect(buscarActividad('siembra_platano.no_existe')).toBeUndefined();
    expect(buscarActividad(undefined)).toBeUndefined();
  });

  it('fila inicial del acta: igual que antes en las principales; la subactividad lleva su nombre', () => {
    expect(filaInicialActa('preparacion_terreno')).toEqual({ descripcion: 'Preparación del terreno', actividad: '2', cantidad: '2,5', unidad: 'Hectárea' });
    // Sin fila propia: el nombre de la actividad.
    expect(filaInicialActa('control_sanitario')).toEqual({ descripcion: 'Control Sanitario', actividad: '', cantidad: '', unidad: '' });
    // Cacao tiene su fila (como Plátano y Forestales).
    expect(filaInicialActa('siembra_cacao')).toEqual({ descripcion: 'Realizar siembra de cacao.', actividad: '3', cantidad: '', unidad: 'Plántula de cacao' });
    expect(filaInicialActa('siembra_cacao.siembra_plantulas_cacao')).toEqual({ descripcion: 'Siembra de las Plántulas de Cacao', actividad: '3', cantidad: '', unidad: '' });
    expect(filaInicialActa('siembra_platano.siembra_colinos')).toEqual({ descripcion: 'Siembra de los Colinos de Plátano', actividad: '4', cantidad: '', unidad: '' });
  });
});
