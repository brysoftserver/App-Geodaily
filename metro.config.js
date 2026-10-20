// ============================================================
// GEODAILY — Configuración de Metro Bundler
// ============================================================

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Soportar archivos .wasm para expo-sqlite en web
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

// PDF.js se empaqueta como asset con extensión .txt para que Metro no lo
// parsee como módulo JS (el visor lo lee como texto en tiempo de ejecución).
config.resolver.assetExts = [...config.resolver.assetExts, 'txt'];

module.exports = config;
