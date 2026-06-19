// ============================================================
// CJS require hook para Node 22
// Intercepta archivos .js de react-native y strippe Flow types
// con @babel/preset-flow
//
// Uso: node --require ./register-flow-strip.js app.js
// ============================================================

const Module = require('module');
const path = require('path');

const FLOW_PACKAGES = [
  'react-native',
  'react-native-web',
  '@react-native',
  'react-native-gesture-handler',
  'react-native-reanimated',
  'react-native-safe-area-context',
  'react-native-screens',
];

// Cache de módulos ya transformados
const transformCache = new Map();

// Cargar babel perezosamente
let babelCore = null;
let flowPlugin = null;

function getBabel() {
  if (!babelCore) {
    babelCore = require('@babel/core');
    flowPlugin = require('@babel/preset-flow');
  }
  return { babelCore, flowPlugin };
}

function isFlowPackage(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return FLOW_PACKAGES.some(pkg => normalized.includes(`/node_modules/${pkg}/`));
}

// ============================================================
// Hook: interceptar _extensions['.js'] para transformar Flow
// ============================================================
const origJsExtension = Module._extensions['.js'];

Module._extensions['.js'] = function (module, filename) {
  // Solo transformar archivos de paquetes Flow
  if (isFlowPackage(filename)) {
    // Verificar si el archivo contiene sintaxis Flow
    const fs = require('fs');
    const source = fs.readFileSync(filename, 'utf8');

    // Detección rápida: busca @flow, import typeof, o anotaciones :
    if (
      source.includes('@flow') ||
      source.includes('import typeof') ||
      source.includes('import type ') ||
      /\/\/\s*\$FlowFixMe/.test(source) ||
      // Detectar anotaciones Flow comunes (get foo(): Type)
      /\bget\s+\w+\s*\(\s*\)\s*:\s*\w/.test(source)
    ) {
      try {
        const { babelCore, flowPlugin } = getBabel();
        const result = babelCore.transformSync(source, {
          filename,
          presets: [flowPlugin],
          sourceMaps: false,
          retainLines: true,
          compact: false,
          babelrc: false,
          configFile: false,
        });

        if (result && result.code) {
          // Reemplazar el source en la caché de módulos
          module._compile(result.code, filename);
          return;
        }
      } catch (err) {
        console.error(`[flow-strip] ⚠️ Error processing ${path.basename(filename)}: ${err.message}`);
        // Fallback: compilar source original (probablemente falle)
      }
    }
  }

  // Compilación normal
  origJsExtension(module, filename);
};

console.error('[flow-strip] ✅ CJS hook active — will strip Flow from react-native files');
