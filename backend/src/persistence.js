// ============================================================
// Persistencia a JSON — Almacenamiento en archivos .json
// para que los datos de plantaciones, mediciones y tracking
// sobrevivan reinicios del servidor.
// ============================================================

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Asegurar que el directorio data existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Crea un store persistente respaldado por un archivo JSON.
 * @param {string} nombre Nombre del archivo (sin extensión)
 * @returns {{ getMap(): Map, set(key, value): void, get(key): any, delete(key): boolean, getAll(): any[], toArray(): any[] }}
 */
function createPersistentStore(nombre) {
  const filePath = path.join(DATA_DIR, `${nombre}.json`);
  const map = new Map();

  // Cargar datos existentes al inicio
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && item.id) {
            map.set(item.id, item);
          }
        }
      }
      console.log(`[Store] ${nombre}: ${map.size} registros cargados desde ${filePath}`);
    } catch (err) {
      console.error(`[Store] Error cargando ${nombre}:`, err.message);
    }
  } else {
    console.log(`[Store] ${nombre}: archivo no existe, se creará al primer guardado`);
  }

  // Persistir el Map completo al archivo JSON
  function persist() {
    try {
      const arr = Array.from(map.values());
      fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), 'utf8');
    } catch (err) {
      console.error(`[Store] Error persistiendo ${nombre}:`, err.message);
    }
  }

  return {
    /** Obtener el Map interno (para compatibilidad) */
    getMap: () => map,

    /** Guardar un valor por ID y persistir */
    set: (id, value) => {
      map.set(id, value);
      persist();
    },

    /** Obtener un valor por ID */
    get: (id) => map.get(id),

    /** Eliminar un valor por ID y persistir */
    delete: (id) => {
      const existed = map.delete(id);
      if (existed) persist();
      return existed;
    },

    /** Obtener todos los valores como array */
    getAll: () => Array.from(map.values()),

    /** Alias de getAll */
    toArray: () => Array.from(map.values()),

    /** Cargar múltiples items de una vez (para sync) */
    setMany: (items) => {
      let changed = false;
      for (const item of items) {
        if (item && item.id) {
          // Merge: preservar datos existentes + nuevos
          const existing = map.get(item.id);
          map.set(item.id, { ...existing, ...item, sincronizado: true });
          changed = true;
        }
      }
      if (changed) persist();
    },

    /** Vaciar todo */
    clear: () => {
      map.clear();
      persist();
    },
  };
}

module.exports = { createPersistentStore };
