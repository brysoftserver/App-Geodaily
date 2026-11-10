// Lector de polígonos KML/KMZ para cargar el polígono de la Visita 2.
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn(), EncodingType: { UTF8: 'utf8', Base64: 'base64' } }));

import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system/legacy';
import { leerPoligonoDeArchivo, parsearPoligonoKML } from '../kmlPoligono';

const KML_POLIGONO = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Proyecto</name>
  <Placemark><name><![CDATA[Finca La Cabaña & lote 2]]></name>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>
      -75.0011,2.0071,0 -75.0001,2.0071,0 -75.0001,2.0081,0 -75.0011,2.0081,0 -75.0011,2.0071,0
    </coordinates></LinearRing></outerBoundaryIs>
    <innerBoundaryIs><LinearRing><coordinates>-75.0008,2.0074 -75.0006,2.0074 -75.0006,2.0076 -75.0008,2.0074</coordinates></LinearRing></innerBoundaryIs>
    </Polygon></Placemark></Document></kml>`;

describe('parsearPoligonoKML', () => {
  it('toma el borde exterior del polígono, sin el punto de cierre repetido', () => {
    const p = parsearPoligonoKML(KML_POLIGONO)!;
    expect(p.puntos).toHaveLength(4);
    expect(p.puntos[0]).toEqual({ latitud: 2.0071, longitud: -75.0011 });
    // No mezcla el hueco interior.
    expect(p.puntos.some((x) => x.longitud === -75.0008)).toBe(false);
  });

  it('usa el nombre del Placemark (con CDATA y &amp;)', () => {
    expect(parsearPoligonoKML(KML_POLIGONO)!.nombre).toBe('Finca La Cabaña & lote 2');
  });

  it('acepta una línea cerrada cuando no hay <Polygon>', () => {
    const kml = '<kml><Placemark><LineString><coordinates>-75,2 -74.99,2 -74.99,2.01 -75,2</coordinates></LineString></Placemark></kml>';
    const p = parsearPoligonoKML(kml, 'archivo')!;
    expect(p.puntos).toHaveLength(3);
    expect(p.nombre).toBe('archivo');
  });

  it('rechaza archivos sin un polígono de al menos 3 puntos', () => {
    expect(parsearPoligonoKML('<kml><Placemark><Point><coordinates>-75,2</coordinates></Point></Placemark></kml>')).toBeNull();
    expect(parsearPoligonoKML('esto no es un kml')).toBeNull();
  });

  it('descarta coordenadas fuera de rango', () => {
    const kml = '<kml><Polygon><outerBoundaryIs><coordinates>-75,2 -74.99,2 999,999 -74.99,2.01</coordinates></outerBoundaryIs></Polygon></kml>';
    expect(parsearPoligonoKML(kml)!.puntos).toHaveLength(3);
  });
});

describe('leerPoligonoDeArchivo', () => {
  it('lee un KMZ (ZIP con doc.kml) en el teléfono', async () => {
    const zip = new JSZip();
    zip.file('doc.kml', KML_POLIGONO);
    const b64 = await zip.generateAsync({ type: 'base64' });
    (FileSystem.readAsStringAsync as any).mockResolvedValueOnce(b64);
    const p = await leerPoligonoDeArchivo({ uri: 'file:///x/lote.kmz', name: 'lote.kmz' });
    expect(p!.puntos).toHaveLength(4);
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith('file:///x/lote.kmz', { encoding: 'base64' });
  });

  it('lee un KML de texto en el teléfono', async () => {
    (FileSystem.readAsStringAsync as any).mockResolvedValueOnce(KML_POLIGONO);
    const p = await leerPoligonoDeArchivo({ uri: 'file:///x/lote.kml', name: 'lote.kml' });
    expect(p!.nombre).toBe('Finca La Cabaña & lote 2');
  });
});
