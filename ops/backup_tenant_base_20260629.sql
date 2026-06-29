--
-- PostgreSQL database dump
--

\restrict RNNHai2IeUIyb7EypSXfN6FqNrdEiGbGRyNpIsyBfTcuMSGSWh7bjhWxkgbPk9g

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: tenant; Type: TABLE; Schema: public; Owner: cmg
--

CREATE TABLE public.tenant (
    id uuid NOT NULL,
    parent_id uuid,
    tier character varying(20) NOT NULL,
    name character varying(200) NOT NULL,
    slug character varying(100) NOT NULL,
    active boolean DEFAULT true,
    brand_name character varying(200),
    brand_color character varying(7),
    logo_url character varying(500),
    custom_domain character varying(200),
    brand_tokens jsonb,
    created_at timestamp with time zone DEFAULT now(),
    notification_email text,
    enabled_modules text[] DEFAULT '{}'::text[] NOT NULL,
    portal_access_token character varying(64),
    business_cif character varying(20),
    business_address character varying(300),
    parent_manufacturer_id uuid,
    manufacturer_can_view_operations boolean DEFAULT true NOT NULL,
    manufacturer_can_view_can_data boolean DEFAULT true NOT NULL,
    manufacturer_can_create_rules boolean DEFAULT true NOT NULL,
    compliance_level character varying(20) DEFAULT 'standard'::character varying NOT NULL,
    manufacturer_can_manage_clients boolean DEFAULT false NOT NULL,
    manufacturer_can_transfer_vehicles boolean DEFAULT false NOT NULL,
    can_actuate_controls boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_compliance_level CHECK (((compliance_level)::text = ANY ((ARRAY['standard'::character varying, 'enhanced'::character varying, 'defense'::character varying])::text[]))),
    CONSTRAINT chk_only_clients_have_manufacturer CHECK (((parent_manufacturer_id IS NULL) OR ((tier)::text = 'client'::text))),
    CONSTRAINT ck_tenant_tier CHECK (((tier)::text = ANY ((ARRAY['cmg'::character varying, 'manufacturer'::character varying, 'client'::character varying, 'subclient'::character varying])::text[])))
);


ALTER TABLE public.tenant OWNER TO cmg;

--
-- Data for Name: tenant; Type: TABLE DATA; Schema: public; Owner: cmg
--

COPY public.tenant (id, parent_id, tier, name, slug, active, brand_name, brand_color, logo_url, custom_domain, brand_tokens, created_at, notification_email, enabled_modules, portal_access_token, business_cif, business_address, parent_manufacturer_id, manufacturer_can_view_operations, manufacturer_can_view_can_data, manufacturer_can_create_rules, compliance_level, manufacturer_can_manage_clients, manufacturer_can_transfer_vehicles, can_actuate_controls) FROM stdin;
ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	518dda8a-82f2-4221-bd1f-9d7a142670cd	client	DELIMEX	deli	t	\N	\N	\N	\N	\N	2026-06-18 17:27:21.232283+00	\N	{alerts,fleet,maintenance,reports,work-orders}	\N	\N	\N	518dda8a-82f2-4221-bd1f-9d7a142670cd	t	t	t	standard	f	f	f
518dda8a-82f2-4221-bd1f-9d7a142670cd	\N	manufacturer	VACUUM PRESURE SYSTEM	vps	t	\N	\N	/uploads/logos/518dda8a-82f2-4221-bd1f-9d7a142670cd.png	\N	{"brand_name": "", "brand_color": "#00d5d5"}	2026-06-18 16:50:11.270599+00	\N	{}	\N	B54639083	CALLE CANAL XUQUER TURIA, 13. 46930, QUART DE POBLET	\N	t	t	t	standard	t	t	f
dfe3b1ef-be60-4af2-a784-e3676ae2dc25	\N	cmg	CMG Metalhidráulica S.L.	cmg	t	CMG Track	\N	/static/logos/cmgtrack.png	\N	\N	2026-04-20 12:51:25.510729+00	\N	{}	\N	\N	\N	\N	f	t	t	standard	f	f	f
\.


--
-- Name: tenant tenant_custom_domain_key; Type: CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_custom_domain_key UNIQUE (custom_domain);


--
-- Name: tenant tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_pkey PRIMARY KEY (id);


--
-- Name: tenant tenant_portal_access_token_key; Type: CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_portal_access_token_key UNIQUE (portal_access_token);


--
-- Name: tenant tenant_slug_key; Type: CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_slug_key UNIQUE (slug);


--
-- Name: ix_tenant_parent_manufacturer_id; Type: INDEX; Schema: public; Owner: cmg
--

CREATE INDEX ix_tenant_parent_manufacturer_id ON public.tenant USING btree (parent_manufacturer_id) WHERE (parent_manufacturer_id IS NOT NULL);


--
-- Name: ix_tenant_portal_access_token; Type: INDEX; Schema: public; Owner: cmg
--

CREATE UNIQUE INDEX ix_tenant_portal_access_token ON public.tenant USING btree (portal_access_token);


--
-- Name: tenant tenant_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.tenant(id) ON DELETE SET NULL;


--
-- Name: tenant tenant_parent_manufacturer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_parent_manufacturer_id_fkey FOREIGN KEY (parent_manufacturer_id) REFERENCES public.tenant(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict RNNHai2IeUIyb7EypSXfN6FqNrdEiGbGRyNpIsyBfTcuMSGSWh7bjhWxkgbPk9g

