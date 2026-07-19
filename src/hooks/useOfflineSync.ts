// ============================================================
// GEODAILY — Hook de Sincronización Offline
// ============================================================

import { useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useSync } from '../store/SyncContext';

export const useOfflineSync = () => {
  const { syncNow, checkPending, status, pendingCount, lastSync } = useSync();

  // El auto-sync por reconexión vive ahora en SyncContext (a nivel de
  // provider, siempre montado). Aquí ya no se registra otro listener para
  // no duplicar ciclos de sincronización.

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
