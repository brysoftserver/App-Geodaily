// ============================================================
// Loader ESM personalizado para Node 22
// Resuelve imports ESM sin extensión dentro de node_modules
// (Expo SDK 52 usa imports estilo bundler: './ExpoSharing' sin .js)
//
// NOTA: El Flow stripping se maneja via register-flow-strip.js (CJS hook)
// ============================================================

// -------------------------------------------
// Hook: resolve — añade extensión .js a imports sin extensión
// -------------------------------------------
export function resolve(specifier, context, nextResolve) {
  // Solo aplica a imports relativos dentro de node_modules que no tengan extensión
  if (
    specifier.startsWith('.') &&
    !specifier.endsWith('.js') &&
    !specifier.endsWith('.mjs') &&
    !specifier.endsWith('.cjs') &&
    !specifier.endsWith('.json') &&
    !specifier.endsWith('.node') &&
    !specifier.endsWith('.ts') &&
    !specifier.endsWith('.tsx') &&
    !specifier.endsWith('.d.ts') &&
    context.parentURL?.includes('node_modules')
  ) {
    try {
      return nextResolve(specifier + '.js', context);
    } catch {
      // Fallback al specifier original
    }
  }
  return nextResolve(specifier, context);
}

// -------------------------------------------
// Hook: load — transforma archivos Flow a JS válido
// -------------------------------------------
export async function load(url, context, nextLoad) {
  // El Flow stripping se maneja via register-flow-strip.js (CJS hook)
  // Este hook solo pasa através
  return nextLoad(url, context);
}
