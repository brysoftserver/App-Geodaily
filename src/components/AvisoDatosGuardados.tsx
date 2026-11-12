// ============================================================
// GEODAILY — Aviso "Sin conexión · mostrando datos guardados"
// ============================================================
// Antes, si el servidor no respondía, las pantallas caían en silencio a la
// copia guardada en el equipo y el supervisor creía estar viendo datos al
// día. Esta franja avisa cuando no hay conexión (o la última consulta al
// servidor falló) y dice a qué hora fue la última actualización.
//
// Solo muestra información: no recarga ni toca datos.
// ============================================================

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { obtenerEstadoServidor, suscribirEstadoServidor } from '../services/estadoServidor';

const horaCorta = (ms: number): string => {
  const d = new Date(ms);
  const hoy = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia ? `${hh}:${mm}` : `${d.getDate()}/${d.getMonth() + 1} ${hh}:${mm}`;
};

export const useEstadoServidor = () =>
  useSyncExternalStore(suscribirEstadoServidor, obtenerEstadoServidor, obtenerEstadoServidor);

/**
 * ¿Sin red? En el navegador con `navigator.onLine` y sus eventos (NetInfo en
 * Chromium puede quedarse "sin internet" tras un corte, ver useAutoRefresh);
 * en el celular con NetInfo.
 */
const useSinRed = (): boolean => {
  const esWeb = Platform.OS === 'web';
  const red = useNetInfo();
  const [offlineWeb, setOfflineWeb] = useState(
    () => esWeb && typeof navigator !== 'undefined' && navigator.onLine === false
  );
  useEffect(() => {
    if (!esWeb || typeof window === 'undefined') return;
    const actualizar = () => setOfflineWeb(navigator.onLine === false);
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
    return () => {
      window.removeEventListener('online', actualizar);
      window.removeEventListener('offline', actualizar);
    };
  }, [esWeb]);
  if (esWeb) return offlineWeb;
  return red.isConnected === false || red.isInternetReachable === false;
};

const AvisoDatosGuardados: React.FC = () => {
  const { alcanzable, ultimaRespuesta } = useEstadoServidor();
  const sinRed = useSinRed();

  if (!sinRed && alcanzable) return null;

  return (
    <View style={styles.franja} accessibilityRole="alert">
      <Text style={styles.texto}>
        {sinRed ? 'Sin conexión' : 'No se pudo consultar el servidor'} · mostrando datos guardados en este equipo
        {ultimaRespuesta ? ` (última actualización ${horaCorta(ultimaRespuesta)})` : ''}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  franja: {
    backgroundColor: '#FFF3E0',
    borderBottomWidth: 1,
    borderBottomColor: '#FFB74D',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  texto: {
    color: '#8D4A00',
    fontSize: 12,
    textAlign: 'center',
  },
});

export default AvisoDatosGuardados;
