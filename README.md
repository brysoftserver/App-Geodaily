# 🌱 GEODAILY — App Móvil

> Gestión de Visitas Técnicas y Supervisión de Terreno para cultivos de cacao.

Aplicación móvil desarrollada con **React Native 0.81 (Expo SDK 54)** y **TypeScript**.
Backend: **QGIS Server** (`:8088` vía nginx) + **Mock API Express** (`:8089`)

---

## 🏗️ Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Framework** | React Native 0.81 + Expo SDK 54 |
| **Lenguaje** | TypeScript 5.x |
| **Navegación** | React Navigation 7 (Native Stack) |
| **Mapas Offline** | MapLibre GL Native |
| **BD Local** | SQLite (expo-sqlite) |
| **Estado** | Context API + useReducer |
| **HTTP** | Axios con interceptores JWT |
| **Auth** | JWT (SecureStore) |
| **Backend (QGIS)** | QGIS Server + PostGIS vía nginx (`:8088`) |
| **Backend (Mock)** | Express API para pruebas (`:8089`) |

---

## 📁 Estructura del Proyecto

```
/opt/App-movil/
├── App.tsx                          # Punto de entrada
├── app.json                         # Configuración Expo
├── package.json                     # Dependencias
├── tsconfig.json                    # TypeScript
├── babel.config.js                  # Babel / Metro
├── metro.config.js                  # Metro Bundler
├── .env                             # Variables de entorno
├── .eslintrc.js                     # ESLint
├── jest.config.js                   # Jest
├── .gitignore
├── register-flow-strip.js           # [Node 22] CJS hook — Flow stripping
├── expo-loader.mjs                  # [Node 22] ESM loader
├── src/
│   ├── components/     (7)          # FilterBar, FormCard, FormField, LoadingSpinner,
│   │                                # MapViewOffline, MetricCard, SignaturePad
│   ├── hooks/          (4)          # useCamera, useClimate, useLocation, useOfflineSync
│   ├── navigation/     (3)          # AppNavigator, TerrenoNavigator, SupervisionNavigator
│   ├── screens/
│   │   ├── auth/       (1)          # LoginScreen
│   │   ├── terreno/    (9)          # Menú, Formulario, Cámara, Firmas, Mapa, etc.
│   │   └── supervision/(4)          # Menú, Dashboard, Listado, Calendario
│   ├── services/       (7)          # api, auth, database, climate, georeference,
│   │                                # photos, pdf
│   ├── store/          (3)          # AuthContext, FormContext, SyncContext
│   ├── theme/          (1)          # Colores, tipografía, API_CONFIG
│   ├── types/          (1)          # Interfaces globales
│   └── utils/          (2)          # constants, formatters
└── assets/
    ├── fonts/
    ├── images/                      # icon, splash, favicon, adaptive-icon
    └── tiles/                       # Mapas offline
```

---

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 22.x (recomendado: [fnm](https://github.com/Schniz/fnm))
- npm 10+
- Backend QGIS corriendo en `192.168.1.20:8088`
- Backend Mock Express en `192.168.1.20:8089`

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

```bash
cp env.example .env
# Editar .env según el entorno
```

### 3. Iniciar servidor de desarrollo (Node 22)

```bash
fnm use v22.22.3
node --require ./register-flow-strip.js \
  --import 'data:text/javascript,import{register}from"node:module";import{pathToFileURL}from"node:url";register("./expo-loader.mjs",pathToFileURL("./"));' \
  ./node_modules/expo/bin/cli start --port 8082
```

> ⚠️ El puerto `8082` está configurado en `app.json` para evitar conflictos.
> Los hooks `register-flow-strip.js` + `expo-loader.mjs` son necesarios para que React Native (Flow) funcione con Node 22.
> En SDK 54 la ruta del CLI cambió a `./node_modules/expo/bin/cli` (ya no es `@expo/cli`).

### 4. Abrir en dispositivo

```
# Escanear QR con Expo Go
# O presionar 'a' (Android) / 'i' (iOS) en la terminal
```

---

## 📋 Comandos Disponibles

| Comando | Descripción |
|---------|-------------|
| `npm start` | Iniciar Expo (con Node por defecto) |
| `npm run android` | Iniciar para Android |
| `npm run ios` | Iniciar para iOS |
| `npm run web` | Iniciar para web |
| `npm run lint` | Ejecutar ESLint |
| `npm test` | Ejecutar Jest |
| `npx tsc --noEmit` | Verificar TypeScript |

---

## 🌐 Backend Mock Express (`192.168.1.20:8089`)

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/auth/login` | POST | Login JWT |
| `/api/auth/verify` | GET | Verificar token |
| `/api/formularios/guardar` | POST | Guardar formulario (mock en memoria) |
| `/api/georeference` | GET | Georreferenciación (UTM, MGRS) |
| `/api/climate/actual` | GET | Clima actual |
| `/api/climate/historico` | GET | Clima histórico |
| `/api/photos/subir` | POST | Subir foto georreferenciada |
| `/api/pdfs/generar` | POST | Generar PDF del formulario |
| `/api/maps` | GET | Mapas offline |
| `/health` | GET | Health check |

---

## 🔐 Roles de Usuario

| Rol | Acceso |
|-----|--------|
| `tecnico` | Módulo Terreno — formularios, cámaras, firmas, mapas offline |
| `supervisor` | Módulo Supervisión — dashboard, listados, calendario general |
| `admin` | Terreno + permisos totales |

---

## 🧪 Pruebas

```bash
# Verificar TypeScript
npx tsc --noEmit

# Linting
npm run lint

# Tests
npm test

# Iniciar servidor de desarrollo
npm start
```

---

## 🔧 Compatibilidad Node 22

React Native 0.76.x distribuye su código con sintaxis **Flow** (type annotations),
que Node 22 no puede procesar nativamente. Se requieren dos hooks:

| Hook | Tipo | Propósito |
|------|------|-----------|
| `register-flow-strip.js` | `--require` (CJS) | Intercepta `Module._extensions['.js']` y elimina tipos Flow via Babel |
| `expo-loader.mjs` | `--import register` (ESM) | Resuelve imports sin extensión dentro de node_modules |

---

## ⚙️ Variables de Entorno (`.env`)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `BACKEND_URL` | `http://192.168.1.20:8089` | URL del backend mock Express |
| `API_TIMEOUT` | `15000` | Timeout en ms |
| `GOOGLE_MAPS_API_KEY` | — | Google Maps API key |
| `LOGBOX_ENABLED` | `false` | Expo Logbox |

---

---

## 🚀 Despliegue en Producción

### Infraestructura (`api.geodaily.brysoftsas.com`)

| Componente | Tecnología | Puerto |
|------------|-----------|--------|
| **Backend API** | Express.js | `:8089` |
| **Almacenamiento** | MinIO (Docker) | `:9000` (API), `:9001` (Console) |
| **Base de Datos** | PostgreSQL | `:5432` |
| **Dominio** | `api.geodaily.brysoftsas.com` | Cloudflare Tunnel (sin puertos abiertos) |
| **HTTPS** | Cloudflare (automático) | — |

### Configuración de Producción

```bash
# .env — backend
PROD_DOMAIN=api.geodaily.brysoftsas.com
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=geodaily_admin
MINIO_BUCKET=geodaily-archivos

# eas.json — production profile
BACKEND_URL=https://api.geodaily.brysoftsas.com
```

### Servicios

| Comando | Descripción |
|---------|-------------|
| `docker restart geodaily-minio` | Reiniciar MinIO |
| `node src/index.js` (en `backend/`) | Iniciar backend Express |
| `python3 -m http.server 9090` | QR server (alternativo, no usa `:9000`) |

### Puertos (sin conflictos)

| Puerto | Servicio | Nota |
|--------|----------|------|
| `8082` | Expo dev server | Desarrollo |
| `8088` | QGIS Server (nginx) | — |
| `8089` | Backend Express | Principal |
| `9000` | MinIO API | No ocupar |
| `9001` | MinIO Console | No ocupar |
| `9090` | QR server alternativo | Para compartir QR dev |
| `5432` | PostgreSQL | — |

---

## 📄 Licencia

Uso interno — Proyecto Cacao.
