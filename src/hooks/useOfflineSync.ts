// ============================================================
// GEODAILY — Hook de Sincronización Offline
// ============================================================

import { useEffect, useCallback, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useSync } from '../store/SyncContext';

export const useOfflineSync = () => {
  const { syncNow, checkPending, status, pendingCount, lastSync } = useSync();
  const wasConnected = useRef<boolean | null>(null);

  // Escuchar cambios de conectividad — solo sincronizar en la transición offline→online
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      const isOnlineNow = !!netState.isConnected && netState.isInternetReachable !== false;
      const cameOnline = isOnlineNow && wasConnected.current !== true;
      wasConnected.current = isOnlineNow;

      if (cameOnline) {
        console.log('[Sync] Conexión detectada — sincronizando...');
        syncNow();
      }
    });

    return () => unsubscribe();
  }, [syncNow]);

  // Verificar pendientes periódicamente
  useEffect(() => {
    const interval = setInterval(() => {
      checkPending();
    }, 30000); // cada 30 segundos

    return () => clearInterval(interval);
  }, [checkPending]);

  const isOnline = useCallback(async (): Promise<boolean> => {
    const netState = await NetInfo.fetch();
    return netState.isConnected === true && netState.isInternetReachable !== false;
  }, []);

  return {
    isOnline,
    syncNow,
    checkPending,
    status,
    pendingCount,
    lastSync,
  };
};
