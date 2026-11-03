// ============================================================
// GEODAILY — Diálogos que funcionan en el teléfono y en el navegador
// ============================================================
// `Alert.alert` de react-native-web es un no-op: no dibuja nada, así que un
// aviso o una confirmación (ej. "¿Quitar el PDF?") nunca aparecían en web y
// el botón parecía muerto. En web se usan los diálogos del navegador.
// ============================================================

import { Alert, Platform } from 'react-native';

const esWeb = () => Platform.OS === 'web' && typeof window !== 'undefined';

export const avisar = (titulo: string, mensaje: string): void => {
  if (esWeb()) window.alert(`${titulo}\n\n${mensaje}`);
  else Alert.alert(titulo, mensaje);
};

/** Pregunta de sí/no. Resuelve `true` solo si el usuario acepta. */
export const confirmar = (
  titulo: string,
  mensaje: string,
  textoAceptar = 'Aceptar',
  destructivo = false
): Promise<boolean> => {
  if (esWeb()) return Promise.resolve(window.confirm(`${titulo}\n\n${mensaje}`));
  return new Promise((resolve) => {
    Alert.alert(
      titulo,
      mensaje,
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: textoAceptar, style: destructivo ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
};
