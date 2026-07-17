-- ============================================================
-- GEODAILY — Esquema REAL de producción (dump de referencia)
-- Generado: 2026-07-13, vía `docker exec geodaily-postgres pg_dump --schema-only`
-- Solo documentación — NO reemplaza ni sincroniza backend/src/database.js::initSchema()
-- ============================================================
--
-- DRIFT CONOCIDO vs. initSchema() (backend/src/database.js):
-- `initSchema()` usa `CREATE TABLE IF NOT EXISTS`, así que en una BD ya
-- inicializada nunca corrige columnas existentes — por eso el código fuente
-- quedó desactualizado respecto al esquema real sin que nadie lo notara.
-- Drift confirmado tabla por tabla:
--
--   formularios: initSchema() define solo (id, tipo, usuario_id, datos jsonb,
--     sincronizado, created_at, updated_at). La BD real tiene en cambio
--     beneficiario_json, actividad_json, sociodemografico_json,
--     caracterizacion_nueva_json, coordenadas_json, georeferencia_json,
--     clima_json, fotos_json, firma_beneficiario, firma_tecnico,
--     huella_beneficiario, pdf_url — exactamente las columnas que
--     routes/forms.js ya inserta/actualiza hoy.
--
--   archivos: initSchema() usa VARCHAR(100) id, nombre_original,
--     nombre_almacenado, ruta_minio, tamaño, metadata (sin formulario_id,
--     sin latitud/longitud/altitud). La BD real usa id UUID (gen_random_uuid()),
--     filename, originalname, size_bytes, minio_path, minio_bucket,
--     metadata_json, formulario_id, latitud, longitud, altitud — lo que
--     routes/photos.js, pdfs.js, firmas.js, documentos.js, videos.js
--     ya usan hoy.
--
--   tracking: initSchema() usa id SERIAL, precision_gps, sin `timestamp`
--     obligatorio ni `sincronizado`. La BD real usa id UUID, precision_metros,
--     "timestamp" NOT NULL, sincronizado — lo que routes/tracking.js espera.
--
--   mediciones / plantaciones: initSchema() usa id VARCHAR(100), valor
--     DECIMAL, datos jsonb, sin formulario_id ni sincronizado. La BD real
--     usa metadata_json (no `datos`), formulario_id, "timestamp" NOT NULL,
--     sincronizado — lo que routes/mediciones.js y routes/plantaciones.js
--     esperan.
--
--   actividad_log: initSchema() usa id SERIAL, ip VARCHAR(50). La BD real
--     usa id UUID, ip_address (no `ip`).
--
--   usuarios: sin drift de columnas relevante (solo tipos VARCHAR(n) vs
--     text, equivalentes en Postgres).
--
-- Conclusión: initSchema() está muy desactualizado en casi todas las tablas
-- salvo `usuarios`. Funciona en producción porque las tablas ya existen con
-- el esquema real (creadas/migradas manualmente en algún momento no
-- documentado) y `CREATE TABLE IF NOT EXISTS` no las toca. El riesgo real
-- es un entorno nuevo (disaster recovery, staging, entorno de otro dev):
-- ahí initSchema() crearía tablas con las columnas viejas y CADA INSERT de
-- los routes actuales fallaría con "column does not exist".
--
-- Este dump es la fuente de verdad para una futura migración formal que
-- reemplace initSchema() por el esquema real — fuera del alcance de esta
-- fase (documentación únicamente, sin tocar código).
-- ============================================================

--
-- PostgreSQL database dump
--

\restrict BtwDPQeoI1dwcegxRAiBmIbfdG5CNGG6iOVrpZtIAQtYUkq2WyKJQRRjSbCFyUU

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: geodaily_admin
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at() OWNER TO geodaily_admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: actividad_log; Type: TABLE; Schema: public; Owner: geodaily_admin
--

CREATE TABLE public.actividad_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id text,
    accion text NOT NULL,
    detalle_json jsonb DEFAULT '{}'::jsonb,
    ip_address text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.actividad_log OWNER TO geodaily_admin;

--
-- Name: archivos; Type: TABLE; Schema: public; Owner: geodaily_admin
--

CREATE TABLE public.archivos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    formulario_id text,
    usuario_id text,
    tipo text NOT NULL,
    filename text NOT NULL,
    originalname text NOT NULL,
    mimetype text NOT NULL,
    size_bytes bigint DEFAULT 0 NOT NULL,
    minio_path text NOT NULL,
    minio_bucket text DEFAULT 'geodaily-archivos'::text NOT NULL,
    latitud double precision,
    longitud double precision,
    altitud double precision,
    metadata_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT archivos_tipo_check CHECK ((tipo = ANY (ARRAY['foto'::text, 'video'::text, 'firma'::text, 'pdf'::text, 'capacitacion'::text, 'other'::text])))
);


ALTER TABLE public.archivos OWNER TO geodaily_admin;

--
-- Name: formularios; Type: TABLE; Schema: public; Owner: geodaily_admin
--

CREATE TABLE public.formularios (
    id text NOT NULL,
    tipo text NOT NULL,
    usuario_id text,
    beneficiario_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    actividad_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    sociodemografico_json jsonb,
    caracterizacion_nueva_json jsonb,
    coordenadas_json jsonb,
    georeferencia_json jsonb,
    clima_json jsonb,
    fotos_json jsonb DEFAULT '[]'::jsonb,
    firma_beneficiario text,
    firma_tecnico text,
    huella_beneficiario boolean DEFAULT false,
    pdf_url text,
    sincronizado boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT formularios_tipo_check CHECK ((tipo = ANY (ARRAY['visita'::text, 'visita_tecnica'::text, 'caracterizacion'::text, 'capacitacion'::text])))
);


ALTER TABLE public.formularios OWNER TO geodaily_admin;

--
-- Name: mediciones; Type: TABLE; Schema: public; Owner: geodaily_admin
--

CREATE TABLE public.mediciones (
    id text NOT NULL,
    usuario_id text,
    formulario_id text,
    tipo_medicion text NOT NULL,
    valor double precision NOT NULL,
    unidad text DEFAULT ''::text,
    latitud double precision,
    longitud double precision,
    metadata_json jsonb DEFAULT '{}'::jsonb,
    "timestamp" timestamp without time zone NOT NULL,
    sincronizado boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.mediciones OWNER TO geodaily_admin;

--
-- Name: plantaciones; Type: TABLE; Schema: public; Owner: geodaily_admin
--

CREATE TABLE public.plantaciones (
    id text NOT NULL,
    usuario_id text,
    formulario_id text,
    especie text NOT NULL,
    cantidad integer DEFAULT 1 NOT NULL,
    latitud double precision NOT NULL,
    longitud double precision NOT NULL,
    altitud double precision,
    metadata_json jsonb DEFAULT '{}'::jsonb,
    "timestamp" timestamp without time zone NOT NULL,
    sincronizado boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.plantaciones OWNER TO geodaily_admin;

--
-- Name: tracking; Type: TABLE; Schema: public; Owner: geodaily_admin
--

CREATE TABLE public.tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id text,
    latitud double precision NOT NULL,
    longitud double precision NOT NULL,
    altitud double precision,
    precision_metros double precision,
    velocidad double precision,
    "timestamp" timestamp without time zone NOT NULL,
    sincronizado boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.tracking OWNER TO geodaily_admin;

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: geodaily_admin
--

CREATE TABLE public.usuarios (
    id text NOT NULL,
    usuario text NOT NULL,
    contrasena text NOT NULL,
    nombre text NOT NULL,
    cedula text DEFAULT ''::text,
    email text DEFAULT ''::text,
    rol text NOT NULL,
    telefono text DEFAULT ''::text,
    activo boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT usuarios_rol_check CHECK ((rol = ANY (ARRAY['tecnico'::text, 'supervisor'::text, 'interventor'::text, 'gerente'::text, 'admin'::text])))
);


ALTER TABLE public.usuarios OWNER TO geodaily_admin;

--
-- Name: v_dashboard_general; Type: VIEW; Schema: public; Owner: geodaily_admin
--

CREATE VIEW public.v_dashboard_general AS
 SELECT ( SELECT count(*) AS count
           FROM public.usuarios
          WHERE (usuarios.rol = 'tecnico'::text)) AS total_tecnicos,
    ( SELECT count(*) AS count
           FROM public.formularios) AS total_formularios,
    ( SELECT count(*) AS count
           FROM public.formularios
          WHERE (formularios.created_at >= (now() - '7 days'::interval))) AS formularios_ultima_semana,
    ( SELECT count(*) AS count
           FROM public.archivos) AS total_archivos,
    ( SELECT count(*) AS count
           FROM public.archivos
          WHERE (archivos.tipo = 'foto'::text)) AS total_fotos,
    ( SELECT count(*) AS count
           FROM public.archivos
          WHERE (archivos.tipo = 'video'::text)) AS total_videos,
    ( SELECT count(*) AS count
           FROM public.plantaciones) AS total_plantaciones,
    ( SELECT sum(plantaciones.cantidad) AS sum
           FROM public.plantaciones) AS total_arboles_sembrados;


ALTER VIEW public.v_dashboard_general OWNER TO geodaily_admin;

--
-- Name: v_plantaciones_resumen; Type: VIEW; Schema: public; Owner: geodaily_admin
--

CREATE VIEW public.v_plantaciones_resumen AS
 SELECT especie,
    count(*) AS conteo,
    sum(cantidad) AS total_sembrados,
    count(DISTINCT usuario_id) AS tecnicos_involucrados,
    min(created_at) AS primera_siembra,
    max(created_at) AS ultima_siembra
   FROM public.plantaciones
  GROUP BY especie
  ORDER BY (sum(cantidad)) DESC;


ALTER VIEW public.v_plantaciones_resumen OWNER TO geodaily_admin;

--
-- Name: v_tecnicos_resumen; Type: VIEW; Schema: public; Owner: geodaily_admin
--

CREATE VIEW public.v_tecnicos_resumen AS
 SELECT u.id,
    u.nombre,
    u.usuario,
    u.rol,
    count(DISTINCT f.id) AS total_formularios,
    count(DISTINCT
        CASE
            WHEN (f.tipo = 'visita'::text) THEN f.id
            ELSE NULL::text
        END) AS visitas,
    count(DISTINCT
        CASE
            WHEN (f.tipo = 'caracterizacion'::text) THEN f.id
            ELSE NULL::text
        END) AS caracterizaciones,
    count(DISTINCT
        CASE
            WHEN (f.tipo = 'capacitacion'::text) THEN f.id
            ELSE NULL::text
        END) AS capacitaciones,
    count(DISTINCT a.id) AS total_archivos,
    max(f.created_at) AS ultima_actividad
   FROM ((public.usuarios u
     LEFT JOIN public.formularios f ON ((f.usuario_id = u.id)))
     LEFT JOIN public.archivos a ON ((a.usuario_id = u.id)))
  WHERE (u.rol = 'tecnico'::text)
  GROUP BY u.id, u.nombre, u.usuario, u.rol;


ALTER VIEW public.v_tecnicos_resumen OWNER TO geodaily_admin;

--
-- Name: actividad_log actividad_log_pkey; Type: CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.actividad_log
    ADD CONSTRAINT actividad_log_pkey PRIMARY KEY (id);


--
-- Name: archivos archivos_pkey; Type: CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.archivos
    ADD CONSTRAINT archivos_pkey PRIMARY KEY (id);


--
-- Name: formularios formularios_pkey; Type: CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.formularios
    ADD CONSTRAINT formularios_pkey PRIMARY KEY (id);


--
-- Name: mediciones mediciones_pkey; Type: CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.mediciones
    ADD CONSTRAINT mediciones_pkey PRIMARY KEY (id);


--
-- Name: plantaciones plantaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.plantaciones
    ADD CONSTRAINT plantaciones_pkey PRIMARY KEY (id);


--
-- Name: tracking tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.tracking
    ADD CONSTRAINT tracking_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_usuario_key; Type: CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_usuario_key UNIQUE (usuario);


--
-- Name: idx_actividad_created; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_actividad_created ON public.actividad_log USING btree (created_at DESC);


--
-- Name: idx_actividad_usuario; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_actividad_usuario ON public.actividad_log USING btree (usuario_id);


--
-- Name: idx_archivos_formulario; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_archivos_formulario ON public.archivos USING btree (formulario_id);


--
-- Name: idx_archivos_tipo; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_archivos_tipo ON public.archivos USING btree (tipo);


--
-- Name: idx_archivos_usuario; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_archivos_usuario ON public.archivos USING btree (usuario_id);


--
-- Name: idx_formularios_beneficiario; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_formularios_beneficiario ON public.formularios USING gin (beneficiario_json);


--
-- Name: idx_formularios_created; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_formularios_created ON public.formularios USING btree (created_at DESC);


--
-- Name: idx_formularios_tipo; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_formularios_tipo ON public.formularios USING btree (tipo);


--
-- Name: idx_formularios_usuario; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_formularios_usuario ON public.formularios USING btree (usuario_id);


--
-- Name: idx_mediciones_tipo; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_mediciones_tipo ON public.mediciones USING btree (tipo_medicion);


--
-- Name: idx_mediciones_usuario; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_mediciones_usuario ON public.mediciones USING btree (usuario_id);


--
-- Name: idx_plantaciones_especie; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_plantaciones_especie ON public.plantaciones USING btree (especie);


--
-- Name: idx_plantaciones_usuario; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_plantaciones_usuario ON public.plantaciones USING btree (usuario_id);


--
-- Name: idx_tracking_created; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_tracking_created ON public.tracking USING btree (created_at);


--
-- Name: idx_tracking_timestamp; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_tracking_timestamp ON public.tracking USING btree ("timestamp" DESC);


--
-- Name: idx_tracking_usuario; Type: INDEX; Schema: public; Owner: geodaily_admin
--

CREATE INDEX idx_tracking_usuario ON public.tracking USING btree (usuario_id);


--
-- Name: formularios trg_formularios_updated_at; Type: TRIGGER; Schema: public; Owner: geodaily_admin
--

CREATE TRIGGER trg_formularios_updated_at BEFORE UPDATE ON public.formularios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: usuarios trg_usuarios_updated_at; Type: TRIGGER; Schema: public; Owner: geodaily_admin
--

CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: actividad_log actividad_log_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.actividad_log
    ADD CONSTRAINT actividad_log_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: archivos archivos_formulario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.archivos
    ADD CONSTRAINT archivos_formulario_id_fkey FOREIGN KEY (formulario_id) REFERENCES public.formularios(id) ON DELETE CASCADE;


--
-- Name: archivos archivos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.archivos
    ADD CONSTRAINT archivos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: formularios formularios_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.formularios
    ADD CONSTRAINT formularios_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: mediciones mediciones_formulario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.mediciones
    ADD CONSTRAINT mediciones_formulario_id_fkey FOREIGN KEY (formulario_id) REFERENCES public.formularios(id) ON DELETE SET NULL;


--
-- Name: mediciones mediciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.mediciones
    ADD CONSTRAINT mediciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: plantaciones plantaciones_formulario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.plantaciones
    ADD CONSTRAINT plantaciones_formulario_id_fkey FOREIGN KEY (formulario_id) REFERENCES public.formularios(id) ON DELETE SET NULL;


--
-- Name: plantaciones plantaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.plantaciones
    ADD CONSTRAINT plantaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: tracking tracking_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: geodaily_admin
--

ALTER TABLE ONLY public.tracking
    ADD CONSTRAINT tracking_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- PostgreSQL database dump complete
--

\unrestrict BtwDPQeoI1dwcegxRAiBmIbfdG5CNGG6iOVrpZtIAQtYUkq2WyKJQRRjSbCFyUU

