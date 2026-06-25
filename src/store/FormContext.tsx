// ============================================================
// GEODAILY — Contexto de Formularios
// ============================================================

import React, { createContext, useContext, useReducer, useCallback } from 'react';
import {
  Formulario,
  TipoFormulario,
  DatosTecnico,
  DatosBeneficiario,
  ActividadRealizada,
  DatosSociodemograficos,
  Coordenadas,
  FotoGeotag,
} from '../types';
import { generarId } from '../utils/formatters';

// --- Estado ---
interface FormState {
  formularioActual: Partial<Formulario> | null;
  formularios: Formulario[];
  isLoading: boolean;
  error: string | null;
}

type FormAction =
  | { type: 'INICIAR_FORMULARIO'; tipo: TipoFormulario }
  | { type: 'SET_TECNICO'; data: DatosTecnico }
  | { type: 'SET_BENEFICIARIO'; data: DatosBeneficiario }
  | { type: 'SET_ACTIVIDAD'; data: ActividadRealizada }
  | { type: 'SET_SOCIODEMOGRAFICO'; data: DatosSociodemograficos }
  | { type: 'SET_COORDENADAS'; data: Coordenadas }
  | { type: 'ADD_FOTO'; foto: FotoGeotag }
  | { type: 'SET_FIRMA_BENEFICIARIO'; firma: string }
  | { type: 'SET_FIRMA_TECNICO'; firma: string }
  | { type: 'SET_HUELLA'; value: boolean }
  | { type: 'FINALIZAR_FORMULARIO'; formulario: Formulario }
  | { type: 'CARGAR_FORMULARIOS'; formularios: Formulario[] }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CANCELAR_FORMULARIO' }
  | { type: 'SET_LOADING'; isLoading: boolean };

const initialState: FormState = {
  formularioActual: null,
  formularios: [],
  isLoading: false,
  error: null,
};

// --- Reducer ---
function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'INICIAR_FORMULARIO':
      return {
        ...state,
        formularioActual: {
          id: generarId(),
          tipo: action.tipo,
          fotos: [],
          firma_beneficiario: '',
          firma_tecnico: '',
          huella_beneficiario: false,
          sincronizado: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      };

    case 'SET_TECNICO':
      return {
        ...state,
        formularioActual: { ...state.formularioActual, tecnico: action.data },
      };

    case 'SET_BENEFICIARIO':
      return {
        ...state,
        formularioActual: { ...state.formularioActual, beneficiario: action.data },
      };

    case 'SET_ACTIVIDAD':
      return {
        ...state,
        formularioActual: { ...state.formularioActual, actividad: action.data },
      };

    case 'SET_SOCIODEMOGRAFICO':
      return {
        ...state,
        formularioActual: { ...state.formularioActual, sociodemografico: action.data },
      };

    case 'SET_COORDENADAS':
      return {
        ...state,
        formularioActual: { ...state.formularioActual, coordenadas: action.data },
      };

    case 'ADD_FOTO':
      return {
        ...state,
        formularioActual: {
          ...state.formularioActual,
          fotos: [...(state.formularioActual?.fotos || []), action.foto],
        },
      };

    case 'SET_FIRMA_BENEFICIARIO':
      return {
        ...state,
        formularioActual: { ...state.formularioActual, firma_beneficiario: action.firma },
      };

    case 'SET_FIRMA_TECNICO':
      return {
        ...state,
        formularioActual: { ...state.formularioActual, firma_tecnico: action.firma },
      };

    case 'SET_HUELLA':
      return {
        ...state,
        formularioActual: { ...state.formularioActual, huella_beneficiario: action.value },
      };

    case 'FINALIZAR_FORMULARIO': {
      // El formulario ya viene completo en la acción
      return {
        ...state,
        formularios: [action.formulario, ...state.formularios],
        formularioActual: null,
        error: null,
      };
    }

    case 'CARGAR_FORMULARIOS':
      return {
        ...state,
        formularios: action.formularios,
      };

    case 'SET_ERROR':
      return { ...state, error: action.error };

    case 'CANCELAR_FORMULARIO':
      return { ...state, formularioActual: null, error: null };

    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };

    default:
      return state;
  }
}

// --- Context ---
interface FormContextType extends FormState {
  iniciarFormulario: (tipo: TipoFormulario) => void;
  setTecnico: (data: DatosTecnico) => void;
  setBeneficiario: (data: DatosBeneficiario) => void;
  setActividad: (data: ActividadRealizada) => void;
  setSociodemografico: (data: DatosSociodemograficos) => void;
  setCoordenadas: (data: Coordenadas) => void;
  addFoto: (foto: FotoGeotag) => void;
  setFirmaBeneficiario: (firma: string) => void;
  setFirmaTecnico: (firma: string) => void;
  setHuella: (value: boolean) => void;
  finalizarFormulario: () => Formulario | null;
  cancelarFormulario: () => void;
  cargarFormularios: (formularios: Formulario[]) => void;
}

const FormContext = createContext<FormContextType | undefined>(undefined);

// --- Provider ---
export const FormProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(formReducer, initialState);

  const iniciarFormulario = useCallback((tipo: TipoFormulario) => {
    dispatch({ type: 'INICIAR_FORMULARIO', tipo });
  }, []);

  const setTecnico = useCallback((data: DatosTecnico) => {
    dispatch({ type: 'SET_TECNICO', data });
  }, []);

  const setBeneficiario = useCallback((data: DatosBeneficiario) => {
    dispatch({ type: 'SET_BENEFICIARIO', data });
  }, []);

  const setActividad = useCallback((data: ActividadRealizada) => {
    dispatch({ type: 'SET_ACTIVIDAD', data });
  }, []);

  const setSociodemografico = useCallback((data: DatosSociodemograficos) => {
    dispatch({ type: 'SET_SOCIODEMOGRAFICO', data });
  }, []);

  const setCoordenadas = useCallback((data: Coordenadas) => {
    dispatch({ type: 'SET_COORDENADAS', data });
  }, []);

  const addFoto = useCallback((foto: FotoGeotag) => {
    dispatch({ type: 'ADD_FOTO', foto });
  }, []);

  const setFirmaBeneficiario = useCallback((firma: string) => {
    dispatch({ type: 'SET_FIRMA_BENEFICIARIO', firma });
  }, []);

  const setFirmaTecnico = useCallback((firma: string) => {
    dispatch({ type: 'SET_FIRMA_TECNICO', firma });
  }, []);

  const setHuella = useCallback((value: boolean) => {
    dispatch({ type: 'SET_HUELLA', value });
  }, []);

  const finalizarFormulario = useCallback((): Formulario | null => {
    const current = state.formularioActual;
    if (!current) return null;

    const formCompleto: Formulario = {
      id: current.id || '',
      tipo: current.tipo || 'visita_tecnica',
      tecnico: current.tecnico || { nombre: '', cedula: '', telefono: '', email: '' },
      beneficiario: current.beneficiario || { nombre: '', cedula: '', telefono: '', departamento: '', municipio: '', vereda: '', finca: '' },
      actividad: current.actividad || { descripcion: '', observaciones: '', recomendaciones: '' },
      sociodemografico: current.sociodemografico,
      coordenadas: current.coordenadas || { latitud: 0, longitud: 0 },
      georeferencia: current.georeferencia,
      clima: current.clima,
      fotos: current.fotos || [],
      firma_beneficiario: current.firma_beneficiario || '',
      firma_tecnico: current.firma_tecnico || '',
      huella_beneficiario: current.huella_beneficiario || false,
      pdf_url: current.pdf_url,
      sincronizado: current.sincronizado || false,
      created_at: current.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Validar que tenga los campos mínimos requeridos
    if (!formCompleto.tecnico.nombre || !formCompleto.beneficiario.nombre) {
      dispatch({ type: 'SET_ERROR', error: 'Faltan campos requeridos (técnico y beneficiario)' });
      return null;
    }

    dispatch({ type: 'FINALIZAR_FORMULARIO', formulario: formCompleto });
    return formCompleto;
  }, [state.formularioActual]);

  const cancelarFormulario = useCallback(() => {
    dispatch({ type: 'CANCELAR_FORMULARIO' });
  }, []);

  const cargarFormularios = useCallback((formularios: Formulario[]) => {
    dispatch({ type: 'CARGAR_FORMULARIOS', formularios });
  }, []);

  return (
    <FormContext.Provider
      value={{
        ...state,
        iniciarFormulario,
        setTecnico,
        setBeneficiario,
        setActividad,
        setSociodemografico,
        setCoordenadas,
        addFoto,
        setFirmaBeneficiario,
        setFirmaTecnico,
        setHuella,
        finalizarFormulario,
        cancelarFormulario,
        cargarFormularios,
      }}
    >
      {children}
    </FormContext.Provider>
  );
};

// --- Hook ---
export const useForm = (): FormContextType => {
  const context = useContext(FormContext);
  if (!context) {
    throw new Error('useForm debe usarse dentro de un FormProvider');
  }
  return context;
};

export default FormContext;
