-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.edit_tokens (
  short_id text NOT NULL,
  incident_id uuid,
  token text,
  expires_at timestamp with time zone,
  CONSTRAINT edit_tokens_pkey PRIMARY KEY (short_id)
);
CREATE TABLE public.incidentes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  phone text NOT NULL,
  descripcion text NOT NULL,
  gravedad integer NOT NULL CHECK (gravedad >= 1 AND gravedad <= 5),
  prioridad integer,
  estado text NOT NULL DEFAULT 'pendiente'::text CHECK (estado = ANY (ARRAY['pendiente'::text, 'publicado'::text, 'rechazado'::text])),
  raw jsonb,
  foto_url text NOT NULL,
  lat numeric NOT NULL,
  lon numeric NOT NULL,
  denied_reason text,
  categoria text NOT NULL,
  subcategoria text NOT NULL,
  direccion_text text,
  referencias text,
  delete_at timestamp with time zone,
  responsable text,
  incidente_master uuid,
  CONSTRAINT incidentes_pkey PRIMARY KEY (id)
);
