// ============================================================
// GEODAILY — Selector de persona para descargar el cronograma en Excel
// ============================================================
// Antes de exportar el cronograma de otra persona, deja elegir a un solo
// técnico, coordinador o interventor de la lista (roles superiores). El
// propio técnico nunca ve este modal: descarga directo su propio cronograma.
//
// Desglose técnico → beneficiario: al tocar el nombre de un técnico se
// despliega la lista de SUS beneficiarios (asignados en la base o con
// visitas en el mes). Se puede marcar el técnico completo (todas sus
// visitas) o solo algunos beneficiarios. Si se marcan beneficiarios, el
// reporte se limita a ellos y agrega la hoja "Resumen por beneficiario".

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { PersonalCronograma } from '../services/admin.service';
import { BeneficiarioReporteExcel } from '../services/cronogramaExcel.service';

/** Beneficiario mostrado bajo un técnico, con su conteo de visitas del mes. */
export interface BeneficiarioCronograma {
  cedula: string;
  nombre: string;
  /** Visitas (realizadas + planificadas) del mes para ese beneficiario. */
  visitas: number;
}

interface CronogramaPersonalModalProps {
  visible: boolean;
  cargando: boolean;
  personal: PersonalCronograma[];
  /** Texto del rango a exportar, ej. "Mes de septiembre 2025 (01 al 30)". */
  rangoTexto: string;
  /** Beneficiarios por técnico (clave = id del técnico). */
  beneficiariosPorTecnico?: Record<string, BeneficiarioCronograma[]>;
  /** Se está cargando el desglose de beneficiarios. */
  cargandoBeneficiarios?: boolean;
  onCancelar: () => void;
  onConfirmar: (
    personas: PersonalCronograma[],
    beneficiarios: BeneficiarioReporteExcel[]
  ) => void;
}

const TITULO_GRUPO: Record<PersonalCronograma['rol'], string> = {
  tecnico: 'Técnicos',
  coordinador: 'Coordinadores',
  interventor: 'Interventores',
};

const claveBeneficiario = (tecnicoId: string, cedula: string, nombre: string) =>
  `${tecnicoId}::${cedula || nombre}`;

const CronogramaPersonalModal: React.FC<CronogramaPersonalModalProps> = ({
  visible,
  cargando,
  personal,
  rangoTexto,
  beneficiariosPorTecnico,
  cargandoBeneficiarios,
  onCancelar,
  onConfirmar,
}) => {
  const [seleccionIds, setSeleccionIds] = useState<string[]>([]);
  const [expandidos, setExpandidos] = useState<string[]>([]);
  const [beneficiariosMarcados, setBeneficiariosMarcados] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setSeleccionIds([]);
      setExpandidos([]);
      setBeneficiariosMarcados([]);
    }
  }, [visible]);

  const alternar = (id: string) => {
    setSeleccionIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
    // Al desmarcar el técnico se limpian sus beneficiarios marcados.
    setBeneficiariosMarcados((prev) => prev.filter((clave) => !clave.startsWith(`${id}::`)));
  };

  const alternarExpandido = (id: string) => {
    setExpandidos((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const alternarBeneficiario = (tecnicoId: string, cedula: string, nombre: string) => {
    const clave = claveBeneficiario(tecnicoId, cedula, nombre);
    setBeneficiariosMarcados((prev) =>
      prev.includes(clave) ? prev.filter((c) => c !== clave) : [...prev, clave]
    );
    // Marcar un beneficiario implica incluir a su técnico en el reporte.
    setSeleccionIds((prev) => (prev.includes(tecnicoId) ? prev : [...prev, tecnicoId]));
  };

  const alternarTodosBeneficiarios = (tecnicoId: string, lista: BeneficiarioCronograma[]) => {
    const claves = lista.map((b) => claveBeneficiario(tecnicoId, b.cedula, b.nombre));
    const todosMarcados = claves.length > 0 && claves.every((c) => beneficiariosMarcados.includes(c));
    setBeneficiariosMarcados((prev) =>
      todosMarcados
        ? prev.filter((c) => !claves.includes(c))
        : Array.from(new Set([...prev, ...claves]))
    );
    if (!todosMarcados) {
      setSeleccionIds((prev) => (prev.includes(tecnicoId) ? prev : [...prev, tecnicoId]));
    }
  };

  const todosSeleccionados = personal.length > 0 && seleccionIds.length === personal.length;
  const alternarTodos = () => {
    setSeleccionIds(todosSeleccionados ? [] : personal.map((p) => p.id));
    if (todosSeleccionados) setBeneficiariosMarcados([]);
  };

  /** Beneficiarios marcados, resueltos a su técnico para el filtro del Excel. */
  const beneficiariosSeleccionados = useMemo<BeneficiarioReporteExcel[]>(() => {
    if (beneficiariosMarcados.length === 0) return [];
    const resultado: BeneficiarioReporteExcel[] = [];
    for (const persona of personal) {
      const lista = beneficiariosPorTecnico?.[persona.id] || [];
      for (const b of lista) {
        const clave = claveBeneficiario(persona.id, b.cedula, b.nombre);
        if (beneficiariosMarcados.includes(clave)) {
          resultado.push({
            cedula: b.cedula,
            nombre: b.nombre,
            tecnicoId: persona.id,
            tecnicoNombre: persona.nombre,
          });
        }
      }
    }
    return resultado;
  }, [beneficiariosMarcados, personal, beneficiariosPorTecnico]);

  const confirmar = () => {
    const personas = personal.filter((p) => seleccionIds.includes(p.id));
    if (personas.length === 0) return;
    onConfirmar(personas, beneficiariosSeleccionados);
  };

  const grupos: PersonalCronograma['rol'][] = ['tecnico', 'coordinador', 'interventor'];

  const etiquetaBoton = () => {
    if (beneficiariosSeleccionados.length > 0) {
      return `Descargar (${beneficiariosSeleccionados.length} beneficiario${
        beneficiariosSeleccionados.length === 1 ? '' : 's'
      })`;
    }
    return seleccionIds.length > 1 ? `Descargar (${seleccionIds.length})` : 'Descargar';
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={styles.overlay}>
        <View style={styles.contenedor}>
          <Text style={styles.titulo}>Descargar Cronograma — Excel</Text>
          <Text style={styles.subtitulo}>
            Marca quiénes quieres ver en el reporte del mes. Toca el nombre de un técnico
            para desglosar sus beneficiarios.{rangoTexto ? `\n${rangoTexto}` : ''}
          </Text>

          {cargando ? (
            <ActivityIndicator size="large" color={COLORS.primary} style={{ marginVertical: SPACING.xl }} />
          ) : (
            <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
              {personal.length > 0 && (
                <TouchableOpacity
                  style={styles.opcionTodos}
                  onPress={alternarTodos}
                  activeOpacity={0.7}
                >
                  <View style={[styles.casilla, todosSeleccionados && styles.casillaMarcada]}>
                    {todosSeleccionados && <Text style={styles.casillaCheck}>✓</Text>}
                  </View>
                  <Text style={styles.opcionTodosTexto}>
                    {todosSeleccionados ? 'Quitar selección' : 'Seleccionar todos'}
                  </Text>
                </TouchableOpacity>
              )}
              {grupos.map((rol) => {
                const personasDelGrupo = personal.filter((p) => p.rol === rol);
                if (personasDelGrupo.length === 0) return null;
                return (
                  <View key={rol} style={styles.grupo}>
                    <Text style={styles.grupoTitulo}>{TITULO_GRUPO[rol]}</Text>
                    {personasDelGrupo.map((p) => {
                      const marcada = seleccionIds.includes(p.id);
                      const abierto = expandidos.includes(p.id);
                      const listaBeneficiarios = beneficiariosPorTecnico?.[p.id] || [];
                      const marcadosDelTecnico = beneficiariosMarcados.filter((c) =>
                        c.startsWith(`${p.id}::`)
                      ).length;
                      return (
                        <View key={p.id}>
                          <View style={[styles.opcion, marcada && styles.opcionMarcada]}>
                            <TouchableOpacity
                              onPress={() => alternar(p.id)}
                              activeOpacity={0.7}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <View style={[styles.casilla, marcada && styles.casillaMarcada]}>
                                {marcada && <Text style={styles.casillaCheck}>✓</Text>}
                              </View>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.opcionNombreZona}
                              onPress={() => alternarExpandido(p.id)}
                              activeOpacity={0.7}
                            >
                              <Text
                                style={[styles.opcionTexto, marcada && styles.opcionTextoMarcado]}
                                numberOfLines={1}
                              >
                                {p.nombre}
                              </Text>
                              {marcadosDelTecnico > 0 && (
                                <Text style={styles.contadorBeneficiarios}>
                                  {marcadosDelTecnico} beneficiario
                                  {marcadosDelTecnico === 1 ? '' : 's'}
                                </Text>
                              )}
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => alternarExpandido(p.id)}
                              activeOpacity={0.7}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Text style={styles.flecha}>{abierto ? '▾' : '▸'}</Text>
                            </TouchableOpacity>
                          </View>

                          {abierto && (
                            <View style={styles.beneficiariosContenedor}>
                              {cargandoBeneficiarios && listaBeneficiarios.length === 0 ? (
                                <ActivityIndicator
                                  size="small"
                                  color={COLORS.primary}
                                  style={{ marginVertical: SPACING.sm }}
                                />
                              ) : listaBeneficiarios.length === 0 ? (
                                <Text style={styles.beneficiariosVacio}>
                                  Sin beneficiarios asignados ni visitas este mes.
                                </Text>
                              ) : (
                                <>
                                  <TouchableOpacity
                                    style={styles.beneficiarioTodos}
                                    onPress={() => alternarTodosBeneficiarios(p.id, listaBeneficiarios)}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={styles.beneficiarioTodosTexto}>
                                      {listaBeneficiarios.every((b) =>
                                        beneficiariosMarcados.includes(
                                          claveBeneficiario(p.id, b.cedula, b.nombre)
                                        )
                                      )
                                        ? 'Quitar todos los beneficiarios'
                                        : `Seleccionar los ${listaBeneficiarios.length} beneficiarios`}
                                    </Text>
                                  </TouchableOpacity>
                                  {listaBeneficiarios.map((b) => {
                                    const clave = claveBeneficiario(p.id, b.cedula, b.nombre);
                                    const bMarcado = beneficiariosMarcados.includes(clave);
                                    return (
                                      <TouchableOpacity
                                        key={clave}
                                        style={styles.beneficiarioOpcion}
                                        onPress={() => alternarBeneficiario(p.id, b.cedula, b.nombre)}
                                        activeOpacity={0.7}
                                      >
                                        <View
                                          style={[styles.casillaPequena, bMarcado && styles.casillaMarcada]}
                                        >
                                          {bMarcado && <Text style={styles.casillaCheck}>✓</Text>}
                                        </View>
                                        <View style={styles.beneficiarioTextos}>
                                          <Text
                                            style={[
                                              styles.beneficiarioNombre,
                                              bMarcado && styles.opcionTextoMarcado,
                                            ]}
                                            numberOfLines={1}
                                          >
                                            {b.nombre}
                                          </Text>
                                          <Text style={styles.beneficiarioDetalle}>
                                            {b.cedula ? `CC ${b.cedula} · ` : ''}
                                            {b.visitas} visita{b.visitas === 1 ? '' : 's'} este mes
                                          </Text>
                                        </View>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </>
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.botones}>
            <TouchableOpacity style={[styles.boton, styles.botonCancelar]} onPress={onCancelar} activeOpacity={0.7}>
              <Text style={styles.botonCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.boton, styles.botonGenerar, seleccionIds.length === 0 && styles.botonDeshabilitado]}
              onPress={confirmar}
              disabled={seleccionIds.length === 0}
              activeOpacity={0.7}
            >
              <Text style={styles.botonGenerarTexto}>{etiquetaBoton()}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  contenedor: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.lg,
    borderTopRightRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    maxHeight: '85%',
    ...SHADOWS.md,
  },
  titulo: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  subtitulo: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: SPACING.md,
  },
  lista: {
    marginBottom: SPACING.md,
  },
  grupo: {
    marginBottom: SPACING.md,
  },
  grupoTitulo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  opcionTodos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  opcionTodosTexto: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  opcionNombreZona: {
    flex: 1,
  },
  opcionTexto: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  opcionMarcada: {
    backgroundColor: COLORS.primary + '14',
    borderColor: COLORS.primary,
  },
  opcionTextoMarcado: {
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
  contadorBeneficiarios: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.primary,
    marginTop: 1,
  },
  flecha: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    paddingHorizontal: 2,
  },
  beneficiariosContenedor: {
    marginLeft: SPACING.lg,
    marginBottom: SPACING.sm,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: SPACING.sm,
  },
  beneficiariosVacio: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    paddingVertical: SPACING.xs,
  },
  beneficiarioTodos: {
    paddingVertical: SPACING.xs,
  },
  beneficiarioTodosTexto: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  beneficiarioOpcion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
  },
  beneficiarioTextos: {
    flex: 1,
  },
  beneficiarioNombre: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  beneficiarioDetalle: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  casilla: {
    width: 20,
    height: 20,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casillaPequena: {
    width: 16,
    height: 16,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casillaMarcada: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  casillaCheck: {
    color: COLORS.textOnPrimary,
    fontSize: 12,
    fontWeight: FONTS.weights.bold,
  },
  botones: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  boton: {
    flex: 1,
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
  },
  botonCancelar: {
    backgroundColor: COLORS.background,
  },
  botonCancelarTexto: {
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
  },
  botonGenerar: {
    backgroundColor: COLORS.primary,
  },
  botonDeshabilitado: {
    opacity: 0.5,
  },
  botonGenerarTexto: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
  },
});

export default CronogramaPersonalModal;
