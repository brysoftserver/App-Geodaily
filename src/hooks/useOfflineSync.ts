// ============================================================
// GEODAILY — Hook de Sincronización Offline
// ============================================================

import { useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useSync } from '../store/SyncContext';

export const useOfflineSync = () => {
  const { syncNow, checkPending, status, pendingCount, lastSync } = useSync();

  // Escuchar cambios de conectividad
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      if (netState.isConnected && netState.isInternetReachable !== false) {
        // Hay conexión — intentar sincronizar automáticamente
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
