// ============================================================
// GEODAILY — Fondo de los menús principales
// ============================================================
// En el teléfono es el mismo ImageBackground de siempre. En el navegador, un
// ImageBackground dentro de un ScrollView se dimensiona con el contenedor y
// al cambiar el zoom o el tamaño de la ventana la imagen se cortaba y dejaba
// franjas grises. Ahí el fondo es una capa FIJA a la ventana, con la imagen
// como `background-size: cover`, que siempre cubre todo sin importar el zoom
// ni el scroll.
// ============================================================

import React from 'react';
import { ImageBackground, Platform, StyleProp, View, ViewStyle } from 'react-native';
import { Asset } from 'expo-asset';

const FONDO = require('../../assets/images/fondo_login_geo_daily.jpg');

interface FondoMenuProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const FondoMenu: React.FC<FondoMenuProps> = ({ children, style }) => {
  if (Platform.OS === 'web') {
    // (Image.resolveAssetSource no existe en react-native-web: rompía el render.)
    const uri = Asset.fromModule(FONDO).uri;
    const capaFija: any = {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundImage: uri ? `url(${uri})` : undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
    return (
      <View style={style}>
        <View pointerEvents="none" style={capaFija} />
        {children}
      </View>
    );
  }
  return (
    <ImageBackground source={FONDO} style={style} resizeMode="cover">
      {children}
    </ImageBackground>
  );
};

export default FondoMenu;
