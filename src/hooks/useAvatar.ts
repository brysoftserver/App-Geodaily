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
import { obtenerAvatarGuardado, guardarAvatar } from '../services/avatar.service';

export function useAvatar(userId: string | undefined) {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    if (!userId) {
      setAvatarUri(null);
      return;
    }
    obtenerAvatarGuardado(userId).then((uri) => {
      if (!cancelado) setAvatarUri(uri);
    });
    return () => {
      cancelado = true;
    };
  }, [userId]);

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
      } else {
        Alert.alert('Error', 'No se pudo guardar la foto de perfil.');
      }
    } catch (error) {
      console.warn('[Avatar] Error al seleccionar imagen:', error);
      Alert.alert('Error', 'No se pudo actualizar la foto de perfil.');
    } finally {
      setCambiando(false);
    }
  }, [userId]);

  return { avatarUri, cambiarAvatar, cambiando };
}
