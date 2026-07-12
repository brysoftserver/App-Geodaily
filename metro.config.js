// ============================================================
// GEODAILY — Configuración de Metro Bundler
// ============================================================

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Soportar archivos .wasm para expo-sqlite en web
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];

module.exports = config;
