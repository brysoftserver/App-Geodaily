// ============================================================
// GEODAILY — Configuración del Sistema (Admin)
// Estado REAL de servicios (health check del backend), técnicos con
// posiciones reales reportadas por sus teléfonos, y actividad real.
// ============================================================

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import apiClient from '../../services/api';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';

interface ServiceStatus {
  id: string;
  title: string;
  value: string;
  icon: string;
  online: boolean | null; // null = aún sin verificar
  lastCheck?: string;
}

interface TecnicoEnCampo {
  id: string;
  nombre: string;
  ultimaPos: string;
  activo: boolean;
}

const INITIAL_SERVICES: ServiceStatus[] = [
  { id: 'api', title: 'API Backend', value: `${API_CONFIG.BASE_URL}/api`, icon: '🔌', online: null },
  { id: 'database', title: 'Base de Datos', value: 'PostgreSQL (vía API /health)', icon: '🗄️', online: null },
  { id: 'auth', title: 'Autenticación', value: 'JWT (bcrypt + jsonwebtoken)', icon: '🔐', online: null },
];

const formatHace = (ts: string): string => {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const horas = Math.floor(mins / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} día(s)`;
};

const SystemConfigScreen: React.FC = () => {
  const [services, setServices] = useState<ServiceStatus[]>(INITIAL_SERVICES);
  const [verificando, setVerificando] = useState<string | null>(null);
  const [tecnicos, setTecnicos] = useState<TecnicoEnCampo[]>([]);
  const [formulariosSemana, setFormulariosSemana] = useState<number | null>(null);

  // Verificación REAL de cada servicio contra el backend
  const verificarServicio = useCallback(async (serviceId: string) => {
    setVerificando(serviceId);
    let online = false;
    try {
      if (serviceId === 'api') {
        const res = await apiClient.get(API_CONFIG.ENDPOINTS.HEALTH, { timeout: 8000 });
        online = res.data?.estado === 'ok' || res.data?.estado === 'degradado';
      } else if (serviceId === 'database') {
        const res = await apiClient.get(API_CONFIG.ENDPOINTS.HEALTH, { timeout: 8000 });
        online = res.data?.db === 'ok';
      } else if (serviceId === 'auth') {
        const res = await apiClient.get(`${API_CONFIG.ENDPOINTS.AUTH}/verify`, { timeout: 8000 });
        online = res.data?.success === true;
      }
    } catch {
      online = false;
    }
    setServices((prev) =>
      prev.map((s) => (s.id === serviceId ? { ...s, online, lastCheck: 'ahora' } : s))
    );
    setVerificando(null);
  }, []);

  // Técnicos con posición reportada (datos reales de /api/tracking/ultimas)
  const cargarTecnicos = useCallback(async () => {
    try {
      const res = await apiClient.get(`${API_CONFIG.ENDPOINTS.TRACKING}/ultimas`, { timeout: 10000 });
      const posiciones: Record<string, any>[] = res.data?.posiciones || [];
      setTecnicos(
        posiciones.map((p) => ({
          id: p.usuario_id,
          nombre: p.usuario_nombre || p.usuario_login || p.usuario_id,
          ultimaPos: formatHace(p.created_at || p.timestamp),
          activo: Date.now() - new Date(p.created_at || p.timestamp).getTime() < 30 * 60000,
        }))
      );
    } catch (error) {
      console.warn('[SystemConfig] Error cargando técnicos:', error);
    }
  }, []);

  // Formularios reales de la última semana
  const cargarActividad = useCallback(async () => {
    try {
      const formularios = await fetchFormulariosDelServidor();
      const hace7dias = Date.now() - 7 * 24 * 3600 * 1000;
      setFormulariosSemana(
        formularios.filter((f) => new Date(f.created_at || 0).getTime() >= hace7dias).length
      );
    } catch (error) {
      console.warn('[SystemConfig] Error cargando actividad:', error);
    }
  }, []);

  useEffect(() => {
    verificarServicio('api');
    verificarServicio('database');
    verificarServicio('auth');
    cargarTecnicos();
    cargarActividad();
  }, [verificarServicio, cargarTecnicos, cargarActividad]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.sectionTitle}>Configuración del Sistema</Text>
      <Text style={styles.sectionSubtitle}>
        Estado de servicios, técnicos activos y configuración de tracking
      </Text>

      {/* Estado de Servicios */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔌 Estado de Servicios</Text>
        {services.map((svc) => (
          <View key={svc.id} style={styles.serviceRow}>
            <Text style={styles.serviceIcon}>{svc.icon}</Text>
            <View style={styles.serviceContent}>
              <Text style={styles.serviceLabel}>{svc.title}</Text>
              <Text style={styles.serviceValue}>{svc.value}</Text>
              {svc.lastCheck && (
                <Text style={styles.serviceCheck}>Verificado {svc.lastCheck}</Text>
              )}
            </View>
            <View style={styles.serviceRight}>
              <View
                style={[
                  styles.serviceDot,
                  {
                    backgroundColor:
                      svc.online === null
                        ? COLORS.textLight
                        : svc.online
                          ? COLORS.success
                          : COLORS.error,
                  },
                ]}
              />
              <TouchableOpacity
                style={styles.verifyBtn}
                onPress={() => verificarServicio(svc.id)}
                disabled={verificando === svc.id}
              >
                <Text style={styles.verifyBtnText}>
                  {verificando === svc.id ? '...' : 'Verificar'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Técnicos con posición reportada (datos reales del servidor) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>👷 Técnicos en Campo</Text>
        <Text style={styles.cardSubtitle}>
          {tecnicos.length > 0
            ? `${tecnicos.length} técnico(s) con posición reportada`
            : 'Ningún técnico ha reportado posición aún'}
        </Text>
        {tecnicos.map((tec) => (
          <View key={tec.id} style={styles.tecnicoRow}>
            <ImageBackground source={require('../../../Logos_imagenes/fondo_login_geo_daily.png')} style={[styles.tecnicoAvatar, { overflow: 'hidden' }]} imageStyle={{ borderRadius: 18 }}>
              <Text style={styles.tecnicoAvatarText}>
                {tec.nombre.charAt(0)}
              </Text>
            </ImageBackground>
            <View style={styles.tecnicoInfo}>
              <Text style={styles.tecnicoName}>{tec.nombre}</Text>
              <Text style={styles.tecnicoStatus}>
                Última posición · {tec.ultimaPos}
              </Text>
            </View>
            <View
              style={[
                styles.tecnicoLiveDot,
                { backgroundColor: tec.activo ? COLORS.success : COLORS.textLight },
              ]}
            />
          </View>
        ))}
      </View>

      {/* Configuración de Tracking */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>⚙️ Configuración de Tracking</Text>
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Intervalo de captura</Text>
          <Text style={styles.configValue}>15 segundos</Text>
        </View>
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Almacenamiento local</Text>
          <Text style={styles.configValue}>SQLite</Text>
        </View>
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Sincronización automática</Text>
          <Text style={[styles.configValue, { color: COLORS.success }]}>Activada</Text>
        </View>
      </View>

      {/* Actividad real del sistema */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📋 Actividad del Sistema</Text>
        <View style={styles.auditRow}>
          <Text style={styles.auditIcon}>📄</Text>
          <View style={styles.auditContent}>
            <Text style={styles.auditTitle}>Formularios generados</Text>
            <Text style={styles.auditText}>
              {formulariosSemana === null
                ? 'Consultando…'
                : `${formulariosSemana} formulario(s) en los últimos 7 días`}
            </Text>
          </View>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.auditIcon}>👷</Text>
          <View style={styles.auditContent}>
            <Text style={styles.auditTitle}>Técnicos reportando posición</Text>
            <Text style={styles.auditText}>
              {tecnicos.length === 0
                ? 'Ninguno todavía'
                : `${tecnicos.filter((t) => t.activo).length} activo(s) en los últimos 30 min · ${tecnicos.length} en total`}
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  // Services
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  serviceIcon: {
    fontSize: 20,
    marginRight: SPACING.md,
  },
  serviceContent: {
    flex: 1,
  },
  serviceLabel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  serviceValue: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  serviceCheck: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: 1,
  },
  serviceRight: {
    alignItems: 'center',
    gap: SPACING.xs,
  },
  serviceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  verifyBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  verifyBtnText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.primary,
  },
  // Técnicos
  tecnicoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  tecnicoAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  tecnicoAvatarText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  tecnicoInfo: { flex: 1 },
  tecnicoName: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  tecnicoStatus: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  tecnicoLiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  // Config
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  configLabel: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  configValue: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  // Audit
  auditRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  auditIcon: {
    fontSize: 20,
    marginRight: SPACING.md,
    marginTop: 2,
  },
  auditContent: { flex: 1 },
  auditTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  auditText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});

export default SystemConfigScreen;
