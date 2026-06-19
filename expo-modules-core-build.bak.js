var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// node_modules/expo-modules-core/src/index.ts
var index_exports = {};
__export(index_exports, {
  CodedError: () => CodedError,
  EventEmitter: () => EventEmitter_default,
  LegacyEventEmitter: () => LegacyEventEmitter,
  NativeModule: () => NativeModule_default,
  NativeModulesProxy: () => NativeModulesProxy_default,
  PermissionStatus: () => PermissionStatus,
  Platform: () => Platform_default,
  SharedObject: () => SharedObject_default,
  SharedRef: () => SharedRef_default,
  UnavailabilityError: () => UnavailabilityError,
  createPermissionHook: () => createPermissionHook,
  createSnapshotFriendlyRef: () => createSnapshotFriendlyRef,
  registerWebModule: () => registerWebModule,
  reloadAppAsync: () => reloadAppAsync,
  requireNativeModule: () => requireNativeModule,
  requireNativeViewManager: () => requireNativeViewManager,
  requireOptionalNativeModule: () => requireOptionalNativeModule,
  useReleasingSharedObject: () => useReleasingSharedObject,
  uuid: () => uuid_default
});
module.exports = __toCommonJS(index_exports);

// node_modules/expo-modules-core/src/ensureNativeModulesAreInstalled.ts
var import_react_native = require("react-native");

// node_modules/expo-modules-core/src/web/index.ts
function registerWebGlobals() {
  if (globalThis.expo) return;
  // Implementación mínima de EventEmitter para Node.js/CLI
  class EventEmitter {
    constructor() { this.listeners = new Map(); }
    addListener(eventName, listener) {
      if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
      this.listeners.get(eventName).add(listener);
      return { remove: () => { this.listeners.get(eventName)?.delete(listener); } };
    }
    removeListener(eventName, listener) { this.listeners.get(eventName)?.delete(listener); }
    removeAllListeners(eventName) { this.listeners.get(eventName)?.clear(); }
    emit(eventName, ...args) {
      (this.listeners.get(eventName) || new Set()).forEach(l => { try { l(...args); } catch(e) { console.error(e); } });
    }
    listenerCount(eventName) { return this.listeners.get(eventName)?.size ?? 0; }
    startObserving() {}
    stopObserving() {}
  }
  class NativeModule extends EventEmitter {}
  class SharedObject extends EventEmitter { release() {} }
  class SharedRef extends SharedObject { nativeRefType = 'unknown'; }
  const nativeModulesProxy = {};
  const modules = {};
  // Mocks para módulos nativos que se cargan como config plugins
  const mockNativeModules = {
    ExpoSharing: { shareAsync: async () => {} },
    ExpoSplashScreen: { preventAutoHideAsync: async () => {}, hideAsync: async () => {} },
    ExpoStatusBar: { setStyle: () => {}, setHidden: () => {} },
    ExpoSystemUI: { getUserInterfaceStyle: () => 'light' },
    ExpoKeepAwake: { activate: () => {}, deactivate: () => {} },
    ExpoHaptics: { notificationAsync: async () => {} },
    ExpoCrypto: { digestStringAsync: async () => '' },
  };
  Object.assign(modules, mockNativeModules);
  Object.assign(nativeModulesProxy, mockNativeModules);
  globalThis.expo = { EventEmitter, NativeModule, SharedObject, SharedRef, modules, uuidv4: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }), uuidv5: () => '', getViewConfig: () => { throw new Error('Not implemented'); }, reloadAppAsync: async () => {} };
}

// node_modules/expo-modules-core/src/ensureNativeModulesAreInstalled.ts
function ensureNativeModulesAreInstalled() {
  if (globalThis.expo) {
    return;
  }
  try {
    if (import_react_native.Platform.OS === "web") {
      registerWebGlobals();
    } else {
      import_react_native.NativeModules.ExpoModulesCore?.installModules();
    }
  } catch (error) {
    console.error(`Unable to install Expo modules: ${error}`);
  }
}

// node_modules/expo-modules-core/src/EventEmitter.ts
ensureNativeModulesAreInstalled();
var EventEmitter_default = globalThis.expo.EventEmitter;

// node_modules/expo-modules-core/src/LegacyEventEmitter.ts
var import_invariant = __toESM(require("invariant"));
var import_react_native2 = require("react-native");
var nativeEmitterSubscriptionKey = "@@nativeEmitterSubscription@@";
var LegacyEventEmitter = class {
  constructor(nativeModule) {
    __publicField(this, "_listenerCount", 0);
    // @ts-expect-error
    __publicField(this, "_nativeModule");
    // @ts-expect-error
    __publicField(this, "_eventEmitter");
    if (nativeModule.__expo_module_name__) {
      return nativeModule;
    }
    this._nativeModule = nativeModule;
    this._eventEmitter = new import_react_native2.NativeEventEmitter(nativeModule);
  }
  addListener(eventName, listener) {
    if (!this._listenerCount && import_react_native2.Platform.OS !== "ios" && this._nativeModule.startObserving) {
      this._nativeModule.startObserving();
    }
    this._listenerCount++;
    const nativeEmitterSubscription = this._eventEmitter.addListener(eventName, listener);
    const subscription = {
      [nativeEmitterSubscriptionKey]: nativeEmitterSubscription,
      remove: () => {
        this.removeSubscription(subscription);
      }
    };
    return subscription;
  }
  removeAllListeners(eventName) {
    const removedListenerCount = this._eventEmitter.listenerCount ? (
      // @ts-ignore: this is available since 0.64
      this._eventEmitter.listenerCount(eventName)
    ) : (
      // @ts-ignore: this is available in older versions
      this._eventEmitter.listeners(eventName).length
    );
    this._eventEmitter.removeAllListeners(eventName);
    this._listenerCount -= removedListenerCount;
    (0, import_invariant.default)(
      this._listenerCount >= 0,
      `EventEmitter must have a non-negative number of listeners`
    );
    if (!this._listenerCount && import_react_native2.Platform.OS !== "ios" && this._nativeModule.stopObserving) {
      this._nativeModule.stopObserving();
    }
  }
  removeSubscription(subscription) {
    const nativeEmitterSubscription = subscription[nativeEmitterSubscriptionKey];
    if (!nativeEmitterSubscription) {
      return;
    }
    if ("remove" in nativeEmitterSubscription) {
      nativeEmitterSubscription.remove();
    }
    this._listenerCount--;
    delete subscription[nativeEmitterSubscriptionKey];
    subscription.remove = () => {
    };
    if (!this._listenerCount && import_react_native2.Platform.OS !== "ios" && this._nativeModule.stopObserving) {
      this._nativeModule.stopObserving();
    }
  }
  emit(eventName, ...params) {
    this._eventEmitter.emit(eventName, ...params);
  }
};

// node_modules/expo-modules-core/src/NativeModule.ts
ensureNativeModulesAreInstalled();
var NativeModule_default = globalThis.expo.NativeModule;

// node_modules/expo-modules-core/src/NativeModulesProxy.ts
var NativeModulesProxy_default = {};

// node_modules/expo-modules-core/src/errors/CodedError.ts
var CodedError = class extends Error {
  constructor(code, message) {
    super(message);
    __publicField(this, "code");
    __publicField(this, "info");
    this.code = code;
  }
};

// node_modules/expo-modules-core/src/Platform.ts
var import_react_native3 = require("react-native");

// node_modules/expo-modules-core/src/environment/browser.ts
var isDOMAvailable = false;
var canUseEventListeners = false;
var canUseViewport = false;
var isAsyncDebugging = false;
if (__DEV__) {
  isAsyncDebugging = !global.nativeExtensions && !global.nativeCallSyncHook && !global.RN$Bridgeless;
}

// node_modules/expo-modules-core/src/Platform.ts
if (__DEV__ && typeof process.env.EXPO_OS === "undefined") {
  console.warn(
    `The global process.env.EXPO_OS is not defined. This should be inlined by babel-preset-expo during transformation.`
  );
}
var nativeSelect = typeof window !== "undefined" ? import_react_native3.Platform.select : (
  // process.env.EXPO_OS is injected by `babel-preset-expo` and available in both client and `react-server` environments.
  // Opt to use the env var when possible, and fallback to the React Native Platform module when it's not (arbitrary bundlers and transformers).
  function select(specifics) {
    if (!process.env.EXPO_OS) return void 0;
    if (specifics.hasOwnProperty(process.env.EXPO_OS)) {
      return specifics[process.env.EXPO_OS];
    } else if (process.env.EXPO_OS !== "web" && specifics.hasOwnProperty("native")) {
      return specifics.native;
    } else if (specifics.hasOwnProperty("default")) {
      return specifics.default;
    }
    return void 0;
  }
);
var Platform3 = {
  /**
   * Denotes the currently running platform.
   * Can be one of ios, android, web.
   */
  OS: process.env.EXPO_OS || import_react_native3.Platform.OS,
  /**
   * Returns the value with the matching platform.
   * Object keys can be any of ios, android, native, web, default.
   *
   * @ios ios, native, default
   * @android android, native, default
   * @web web, default
   */
  select: nativeSelect,
  /**
   * Denotes if the DOM API is available in the current environment.
   * The DOM is not available in native React runtimes and Node.js.
   */
  isDOMAvailable,
  /**
   * Denotes if the current environment can attach event listeners
   * to the window. This will return false in native React
   * runtimes and Node.js.
   */
  canUseEventListeners,
  /**
   * Denotes if the current environment can inspect properties of the
   * screen on which the current window is being rendered. This will
   * return false in native React runtimes and Node.js.
   */
  canUseViewport,
  /**
   * If the JavaScript is being executed in a remote JavaScript environment.
   * When `true`, synchronous native invocations cannot be executed.
   */
  isAsyncDebugging
};
var Platform_default = Platform3;

// node_modules/expo-modules-core/src/errors/UnavailabilityError.ts
var UnavailabilityError = class extends CodedError {
  constructor(moduleName, propertyName) {
    super(
      "ERR_UNAVAILABLE",
      `The method or property ${moduleName}.${propertyName} is not available on ${Platform_default.OS}, are you sure you've linked all the native dependencies properly?`
    );
  }
};

// node_modules/expo-modules-core/src/NativeViewManagerAdapter.tsx
function requireNativeViewManager(viewName) {
  throw new UnavailabilityError("expo-modules-core", "requireNativeViewManager");
}

// node_modules/expo-modules-core/src/SharedObject.ts
ensureNativeModulesAreInstalled();
var SharedObject = globalThis.expo.SharedObject;
var SharedObject_default = SharedObject;

// node_modules/expo-modules-core/src/SharedRef.ts
ensureNativeModulesAreInstalled();
var SharedRef = globalThis.expo.SharedRef;
var SharedRef_default = SharedRef;

// node_modules/expo-modules-core/src/sweet/NativeErrorManager.ts
var NativeErrorManager_default = NativeModulesProxy_default.ExpoModulesCoreErrorManager;

// node_modules/expo-modules-core/src/sweet/setUpErrorManager.fx.ts
if (__DEV__ && Platform_default.OS === "android" && NativeErrorManager_default) {
  const onNewException = "ExpoModulesCoreErrorManager.onNewException";
  const onNewWarning = "ExpoModulesCoreErrorManager.onNewWarning";
  NativeErrorManager_default.addListener(onNewException, ({ message }) => {
    console.error(message);
  });
  NativeErrorManager_default.addListener(onNewWarning, ({ message }) => {
    console.warn(message);
  });
}
globalThis.ExpoModulesCore_CodedError = CodedError;

// node_modules/expo-modules-core/src/uuid/lib/bytesToUuid.ts
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex[i] = (i + 256).toString(16).substr(1);
}
function bytesToUuid(buf, offset) {
  let i = offset || 0;
  const bth = byteToHex;
  return [
    bth[buf[i++]],
    bth[buf[i++]],
    bth[buf[i++]],
    bth[buf[i++]],
    "-",
    bth[buf[i++]],
    bth[buf[i++]],
    "-",
    bth[buf[i++]],
    bth[buf[i++]],
    "-",
    bth[buf[i++]],
    bth[buf[i++]],
    "-",
    bth[buf[i++]],
    bth[buf[i++]],
    bth[buf[i++]],
    bth[buf[i++]],
    bth[buf[i++]],
    bth[buf[i++]]
  ].join("");
}
var bytesToUuid_default = bytesToUuid;

// node_modules/expo-modules-core/src/uuid/uuid.types.ts
var Uuidv5Namespace = /* @__PURE__ */ ((Uuidv5Namespace2) => {
  Uuidv5Namespace2["dns"] = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  Uuidv5Namespace2["url"] = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
  Uuidv5Namespace2["oid"] = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";
  Uuidv5Namespace2["x500"] = "6ba7b814-9dad-11d1-80b4-00c04fd430c8";
  return Uuidv5Namespace2;
})(Uuidv5Namespace || {});

// node_modules/expo-modules-core/src/uuid/uuid.ts
function uuidv4() {
  const nativeUuidv4 = globalThis?.expo?.uuidv4;
  if (!nativeUuidv4) {
    throw Error(
      "Native UUID version 4 generator implementation wasn't found in `expo-modules-core`"
    );
  }
  return nativeUuidv4();
}
function uuidv5(name, namespace) {
  const parsedNamespace = Array.isArray(namespace) && namespace.length === 16 ? bytesToUuid_default(namespace) : namespace;
  if (Array.isArray(parsedNamespace)) {
    throw new Error("`namespace` must be a valid UUID string or an Array of 16 byte values");
  }
  const nativeUuidv5 = globalThis?.expo?.uuidv5;
  if (!nativeUuidv5) {
    throw Error("Native UUID type 5 generator implementation wasn't found in `expo-modules-core`");
  }
  return nativeUuidv5(name, parsedNamespace);
}
var uuid = {
  v4: uuidv4,
  v5: uuidv5,
  namespace: Uuidv5Namespace
};
var uuid_default = uuid;

// node_modules/expo-modules-core/src/requireNativeModule.ts
function requireNativeModule(moduleName) {
  const nativeModule = requireOptionalNativeModule(moduleName);
  if (!nativeModule) {
    throw new Error(`Cannot find native module '${moduleName}'`);
  }
  return nativeModule;
}
function requireOptionalNativeModule(moduleName) {
  ensureNativeModulesAreInstalled();
  return globalThis.expo?.modules?.[moduleName] ?? NativeModulesProxy_default[moduleName] ?? null;
}

// node_modules/expo-modules-core/src/registerWebModule.ts
function registerWebModule(moduleImplementation) {
  ensureNativeModulesAreInstalled();
  const moduleName = moduleImplementation.name;
  if (!moduleName) {
    throw new Error("Module implementation must be a class");
  }
  if (!globalThis?.expo?.modules) {
    globalThis.expo.modules = {};
  }
  if (globalThis.expo.modules[moduleName]) {
    return globalThis.expo.modules[moduleName];
  }
  globalThis.expo.modules[moduleName] = new moduleImplementation();
  return globalThis.expo.modules[moduleName];
}

// node_modules/expo-modules-core/src/PermissionsInterface.ts
var PermissionStatus = /* @__PURE__ */ ((PermissionStatus2) => {
  PermissionStatus2["GRANTED"] = "granted";
  PermissionStatus2["UNDETERMINED"] = "undetermined";
  PermissionStatus2["DENIED"] = "denied";
  return PermissionStatus2;
})(PermissionStatus || {});

// node_modules/expo-modules-core/src/PermissionsHook.ts
var import_react = require("react");
function usePermission(methods, options) {
  const isMounted = (0, import_react.useRef)(true);
  const [status, setStatus] = (0, import_react.useState)(null);
  const { get = true, request = false, ...permissionOptions } = options || {};
  const getPermission = (0, import_react.useCallback)(async () => {
    const response = await methods.getMethod(
      Object.keys(permissionOptions).length > 0 ? permissionOptions : void 0
    );
    if (isMounted.current) setStatus(response);
    return response;
  }, [methods.getMethod]);
  const requestPermission = (0, import_react.useCallback)(async () => {
    const response = await methods.requestMethod(
      Object.keys(permissionOptions).length > 0 ? permissionOptions : void 0
    );
    if (isMounted.current) setStatus(response);
    return response;
  }, [methods.requestMethod]);
  (0, import_react.useEffect)(
    function runMethods() {
      if (request) requestPermission();
      if (!request && get) getPermission();
    },
    [get, request, requestPermission, getPermission]
  );
  (0, import_react.useEffect)(function didMount() {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  return [status, requestPermission, getPermission];
}
function createPermissionHook(methods) {
  return (options) => usePermission(methods, options);
}

// node_modules/expo-modules-core/src/Refs.ts
var import_react2 = __toESM(require("react"));
function createSnapshotFriendlyRef() {
  return import_react2.default.createRef();
}

// node_modules/expo-modules-core/src/hooks/useReleasingSharedObject.ts
var import_react3 = require("react");
function useReleasingSharedObject(factory, dependencies) {
  const objectRef = (0, import_react3.useRef)(null);
  const isFastRefresh = (0, import_react3.useRef)(false);
  const previousDependencies = (0, import_react3.useRef)(dependencies);
  if (objectRef.current == null) {
    objectRef.current = factory();
  }
  const object = (0, import_react3.useMemo)(() => {
    let newObject = objectRef.current;
    const dependenciesAreEqual = previousDependencies.current?.length === dependencies.length && dependencies.every((value, index) => value === previousDependencies.current[index]);
    if (!newObject || !dependenciesAreEqual) {
      objectRef.current?.release();
      newObject = factory();
      objectRef.current = newObject;
      previousDependencies.current = dependencies;
    } else {
      isFastRefresh.current = true;
    }
    return newObject;
  }, dependencies);
  (0, import_react3.useEffect)(() => {
    isFastRefresh.current = false;
    return () => {
      if (!isFastRefresh.current && objectRef.current) {
        objectRef.current.release();
      }
    };
  }, []);
  return object;
}

// node_modules/expo-modules-core/src/reload.ts
async function reloadAppAsync(reason = "Reloaded from JS call") {
  await globalThis.expo?.reloadAppAsync(reason);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CodedError,
  EventEmitter,
  LegacyEventEmitter,
  NativeModule,
  NativeModulesProxy,
  PermissionStatus,
  Platform,
  SharedObject,
  SharedRef,
  UnavailabilityError,
  createPermissionHook,
  createSnapshotFriendlyRef,
  registerWebModule,
  reloadAppAsync,
  requireNativeModule,
  requireNativeViewManager,
  requireOptionalNativeModule,
  useReleasingSharedObject,
  uuid
});
