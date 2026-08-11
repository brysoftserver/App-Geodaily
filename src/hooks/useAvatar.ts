// ============================================================
// GEODAILY — Hook de foto de perfil
// ============================================================
// Encapsula selección + persistencia de la foto de perfil, para que las
// 5 pantallas de menú (técnico, supervisor, interventor, gerente, admin)
// compartan la misma lógica en vez de reimplementarla cada una.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../store/AuthContext';
import {
  obtenerAvatarGuardado,
  guardarAvatar,
  subirAvatarAlServidor,
  sincronizarAvatarDesdeServidor,
  eliminarAvatar,
} from '../services/avatar.service';

export function useAvatar() {
  const { user, actualizarAvatarLocal } = useAuth();
  const userId = user?.id;
  const avatarArchivoId = user?.avatar_archivo_id;
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    if (!userId) {
      setAvatarUri(null);
      return;
    }
    (async () => {
      // 1) Mostrar de inmediato lo que ya haya en este dispositivo.
      const local = await obtenerAvatarGuardado(userId);
      if (cancelado) return;
      if (local) setAvatarUri(local);

      // 2) En segundo plano, revisar si el servidor tiene algo distinto
      // (foto puesta/cambiada/quitada desde OTRO dispositivo). Primera vez
      // en un celular nuevo: no hay copia local, así que esto es lo único
      // que trae la foto.
      const resultado = await sincronizarAvatarDesdeServidor(userId, avatarArchivoId);
      if (cancelado || resultado === undefined) return;
      setAvatarUri(resultado); // string nueva foto, o null si se confirmó que no hay
    })();
    return () => {
      cancelado = true;
    };
  }, [userId, avatarArchivoId]);

  const cambiarAvatar = useCallback(async () => {
    if (!userId) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permiso requerido',
          'Necesitamos acceso a tu galería para cambiar la foto de perfil.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });

      if (result.canceled || !result.assets[0]) return;

      setCambiando(true);
      const uriPersistente = await guardarAvatar(userId, result.assets[0].uri);
      if (uriPersistente) {
        setAvatarUri(uriPersistente);
        // Best-effort: si falla (sin conexión) la foto local sigue
        // funcionando igual para el propio dueño; solo no la verán los
        // demás roles hasta que haya señal y se reintente.
        const archivoId = await subirAvatarAlServidor(userId, uriPersistente);
        if (archivoId) await actualizarAvatarLocal(archivoId);
      } else {
        Alert.alert('Error', 'No se pudo guardar la foto de perfil.');
      }
    } catch (error) {
      console.warn('[Avatar] Error al seleccionar imagen:', error);
      Alert.alert('Error', 'No se pudo actualizar la foto de perfil.');
    } finally {
      setCambiando(false);
    }
  }, [userId, actualizarAvatarLocal]);

  const quitarAvatar = useCallback(async () => {
    if (!userId) return;
    setCambiando(true);
    try {
      await eliminarAvatar(userId);
      setAvatarUri(null);
      await actualizarAvatarLocal(null);
    } catch (error) {
      console.warn('[Avatar] Error al quitar la foto:', error);
      Alert.alert('Error', 'No se pudo quitar la foto de perfil.');
    } finally {
      setCambiando(false);
    }
  }, [userId, actualizarAvatarLocal]);

  return { avatarUri, cambiarAvatar, quitarAvatar, cambiando };
}
