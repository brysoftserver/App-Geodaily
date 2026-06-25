// ============================================================
// GEODAILY — Configuración del Sistema (Admin) Mejorado
// ============================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

interface ServiceStatus {
  id: string;
  title: string;
  value: string;
  icon: string;
  online: boolean;
  lastCheck?: string;
}

const INITIAL_SERVICES: ServiceStatus[] = [
  { id: 'version', title: 'Versión de la App', value: 'GEODAILY v2.0.0', icon: '📱', online: true },
  { id: 'api', title: 'API Backend', value: 'http://192.168.1.20:8089/api', icon: '🔌', online: true, lastCheck: 'hace 2 min' },
  { id: 'qgis', title: 'Servidor QGIS', value: 'http://192.168.1.20:8081', icon: '🗺️', online: true, lastCheck: 'hace 5 min' },
  { id: 'database', title: 'Base de Datos', value: 'PostgreSQL / PostGIS', icon: '🗄️', online: true, lastCheck: 'hace 1 min' },
  { id: 'auth', title: 'Autenticación', value: 'JWT (bcrypt + jsonwebtoken)', icon: '🔐', online: true },
];

const MOCK_TECNICOS = [
  { id: 't1', nombre: 'Carlos Martínez', estado: 'En ruta', ultimaPos: 'hace 5 min', color: COLORS.roleTecnico },
  { id: 't2', nombre: 'Ana López', estado: 'En campo', ultimaPos: 'hace 12 min', color: COLORS.roleTecnico },
  { id: 't3', nombre: 'Jorge Pérez', estado: 'Detenido', ultimaPos: 'hace 45 min', color: COLORS.roleTecnico },
];

const SystemConfigScreen: React.FC = () => {
  const [services, setServices] = useState<ServiceStatus[]>(INITIAL_SERVICES);
  const [verificando, setVerificando] = useState<string | null>(null);

  const verificarServicio = useCallback(async (serviceId: string) => {
    setVerificando(serviceId);
    // Simular verificación
    await new Promise((r) => setTimeout(r, 1500));
    setServices((prev) =>
      prev.map((s) =>
        s.id === serviceId
          ? { ...s, online: Math.random() > 0.2, lastCheck: 'ahora' }
          : s
      )
    );
    setVerificando(null);
    Alert.alert('Verificación completa', `Servicio ${serviceId} verificado.`);
  }, []);

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
                  { backgroundColor: svc.online ? COLORS.success : COLORS.error },
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

      {/* Técnicos en tiempo real */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>👷 Técnicos en Campo</Text>
        <Text style={styles.cardSubtitle}>
          {MOCK_TECNICOS.length} técnico(s) registrados hoy
        </Text>
        {MOCK_TECNICOS.map((tec) => (
          <View key={tec.id} style={styles.tecnicoRow}>
            <View style={[styles.tecnicoAvatar, { backgroundColor: tec.color }]}>
              <Text style={styles.tecnicoAvatarText}>
                {tec.nombre.charAt(0)}
              </Text>
            </View>
            <View style={styles.tecnicoInfo}>
              <Text style={styles.tecnicoName}>{tec.nombre}</Text>
              <Text style={styles.tecnicoStatus}>
                {tec.estado} · {tec.ultimaPos}
              </Text>
            </View>
            <View
              style={[
                styles.tecnicoLiveDot,
                {
                  backgroundColor:
                    tec.estado === 'En ruta' || tec.estado === 'En campo'
                      ? COLORS.success
                      : COLORS.textLight,
                },
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
          <Text style={styles.configLabel}>Retención de datos</Text>
          <Text style={styles.configValue}>30 días</Text>
        </View>
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Sincronización automática</Text>
          <Text style={[styles.configValue, { color: COLORS.success }]}>Activada</Text>
        </View>
      </View>

      {/* Registro de Auditoría */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📋 Registro de Auditoría</Text>
        <View style={styles.auditRow}>
          <Text style={styles.auditIcon}>📋</Text>
          <View style={styles.auditContent}>
            <Text style={styles.auditTitle}>Inicios de sesión</Text>
            <Text style={styles.auditText}>12 intentos hoy · 3 administradores activos</Text>
          </View>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.auditIcon}>📄</Text>
          <View style={styles.auditContent}>
            <Text style={styles.auditTitle}>Formularios generados</Text>
            <Text style={styles.auditText}>48 formularios en la última semana</Text>
          </View>
        </View>
        <View style={styles.auditRow}>
          <Text style={styles.auditIcon}>🔄</Text>
          <View style={styles.auditContent}>
            <Text style={styles.auditTitle}>Sincronización QGIS</Text>
            <Text style={styles.auditText}>Última sincronización: hoy 10:30 AM</Text>
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
