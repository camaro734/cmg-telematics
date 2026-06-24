--
-- PostgreSQL database dump
--

\restrict wBvzyMaapL77l2hRuXfwmZvFUbXGoH9jf4j1cE8qRAvFbmAz1uJcLAkoF0bbcRz

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
-- Name: work_cycle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_cycle (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    duration_seconds integer,
    cycle_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    lat numeric(9,6),
    lon numeric(9,6)
);


--
-- Name: work_cycle_definition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_cycle_definition (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_type_id uuid NOT NULL,
    tenant_id uuid,
    name character varying(100) NOT NULL,
    trigger_type character varying(30) NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    snapshot_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    aggregate_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Data for Name: work_cycle; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.work_cycle (id, vehicle_id, definition_id, tenant_id, started_at, ended_at, duration_seconds, cycle_data, lat, lon) FROM stdin;
fd82040c-9956-4eba-a4f2-eb439912457c	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 08:13:47.6+00	2026-06-19 08:25:17.6+00	690	{}	39.470423	-0.496607
82f3350e-b78c-4a9f-82be-794b41e172b0	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 09:04:53.1+00	2026-06-19 09:05:56.6+00	63	{}	39.470400	-0.496683
88274d15-c66b-4f44-a601-df9c7abf019f	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 10:45:30+00	2026-06-19 10:49:00+00	210	{}	39.471118	-0.495963
d66f5504-beb0-4dfb-a11d-8dc66dd11334	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 12:23:37+00	2026-06-19 12:30:37+00	420	{}	39.470345	-0.496622
1715970b-0218-4493-9256-9934c618376e	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 12:38:48+00	2026-06-19 12:49:21+00	633	{}	39.470345	-0.496622
4d56990b-103e-4397-aae4-0a13c1552199	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 13:15:29+00	2026-06-19 13:15:29+00	0	{}	39.444172	-0.513205
b5535fde-790c-4471-acd1-dfd5d557a74d	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 15:24:47.6+00	2026-06-19 15:25:04.8+00	17	{}	39.274382	-0.464855
31d8924e-7ac0-4317-aed9-cf974c2ffb07	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 15:25:36.6+00	2026-06-19 15:25:48.8+00	12	{}	39.274293	-0.464872
18147dcd-adf5-4872-86de-4c367ddbb112	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 15:26:50.6+00	2026-06-19 15:39:50.6+00	780	{}	39.274293	-0.464872
39e18f6e-86ba-45d5-8e71-c7319ce1edf1	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 16:30:56.6+00	2026-06-19 16:35:56.6+00	300	{}	39.274180	-0.464783
d26924d2-c1ea-425f-80cd-258b8344756f	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 18:04:43.6+00	2026-06-19 18:04:43.6+00	0	{}	39.274157	-0.464953
95dee4a6-a215-4336-9505-4dd0b3e32303	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 18:05:18.1+00	2026-06-19 18:05:19.8+00	1	{}	39.274247	-0.464985
cfe72334-4d32-4019-84ec-d6f5c08ddb30	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 18:06:10.6+00	2026-06-19 18:06:10.6+00	0	{}	39.274303	-0.464950
f97f4b09-703b-428b-8bef-480bbf742864	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-19 18:07:40.6+00	2026-06-19 18:07:47.8+00	7	{}	39.274303	-0.464950
e791181e-50f2-4709-94ef-936956897703	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-22 06:14:19.648+00	2026-06-22 06:33:40.507+00	1160	{}	39.507303	-0.412890
1720645d-9eba-4a64-b198-b7dcec18ffea	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-22 06:57:25.704+00	2026-06-22 06:58:55.71+00	90	{}	39.513910	-0.443837
7341f9b7-6b0f-4e75-bb97-9d8398284467	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-22 08:24:19.02+00	2026-06-22 09:02:49.167+00	2310	{}	39.683878	-0.268362
5798feed-dadf-4fc8-a168-8c5f6d0dc658	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-22 10:55:41.143+00	2026-06-22 10:55:41.747+00	0	{}	38.974973	-0.508828
5e83d8fc-204d-4631-82f6-fd9cbcb7faa6	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-22 10:56:15.586+00	2026-06-22 11:15:45.66+00	1170	{}	38.974973	-0.508828
b601e996-f48d-46cc-88fa-e2e12a18c61a	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-22 12:38:15.955+00	2026-06-22 12:58:16.027+00	1200	{}	39.264842	-0.404118
57261609-e3d2-4449-be7b-70d9269cbefc	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-22 13:21:58.109+00	2026-06-22 14:00:58.246+00	2340	{}	39.291102	-0.416213
2493cefd-a24f-4a4e-9d5c-146c564acb8a	8120ac70-7dc4-4af8-9afd-0cc61bde690a	2dd0e757-052d-45ed-9ae3-ff332eb5a226	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	2026-06-22 14:48:09.411+00	2026-06-22 14:54:09.432+00	360	{}	39.281367	-0.384208
\.


--
-- Data for Name: work_cycle_definition; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.work_cycle_definition (id, vehicle_type_id, tenant_id, name, trigger_type, trigger_config, snapshot_fields, aggregate_fields, active, created_at) FROM stdin;
3dc580dd-d53d-417e-9557-f81f728d0404	07f0774b-09ec-4179-ab7e-707263d82c5d	\N	contenedores	pto_change	{}	["Cantidad de contenedores"]	[]	t	2026-06-04 05:10:55.206538+00
2dd0e757-052d-45ed-9ae3-ff332eb5a226	608ba0fa-8160-4ac1-a9a9-447fb18d51b7	\N	Depresor ON	pto_change	{}	["depresor_encendido"]	["min_depresor"]	t	2026-06-22 14:53:59.576563+00
\.


--
-- Name: work_cycle_definition work_cycle_definition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cycle_definition
    ADD CONSTRAINT work_cycle_definition_pkey PRIMARY KEY (id);


--
-- Name: work_cycle work_cycle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cycle
    ADD CONSTRAINT work_cycle_pkey PRIMARY KEY (id);


--
-- Name: ix_wc_definition_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_wc_definition_id ON public.work_cycle USING btree (definition_id);


--
-- Name: ix_wc_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_wc_started_at ON public.work_cycle USING btree (started_at);


--
-- Name: ix_wc_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_wc_tenant_id ON public.work_cycle USING btree (tenant_id);


--
-- Name: ix_wc_vehicle_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_wc_vehicle_id ON public.work_cycle USING btree (vehicle_id);


--
-- Name: ix_wcd_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_wcd_tenant_id ON public.work_cycle_definition USING btree (tenant_id);


--
-- Name: ix_wcd_vehicle_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_wcd_vehicle_type_id ON public.work_cycle_definition USING btree (vehicle_type_id);


--
-- Name: work_cycle work_cycle_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cycle
    ADD CONSTRAINT work_cycle_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.work_cycle_definition(id) ON DELETE CASCADE;


--
-- Name: work_cycle_definition work_cycle_definition_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cycle_definition
    ADD CONSTRAINT work_cycle_definition_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: work_cycle_definition work_cycle_definition_vehicle_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cycle_definition
    ADD CONSTRAINT work_cycle_definition_vehicle_type_id_fkey FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_type(id) ON DELETE CASCADE;


--
-- Name: work_cycle work_cycle_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cycle
    ADD CONSTRAINT work_cycle_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: work_cycle work_cycle_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cycle
    ADD CONSTRAINT work_cycle_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicle(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict wBvzyMaapL77l2hRuXfwmZvFUbXGoH9jf4j1cE8qRAvFbmAz1uJcLAkoF0bbcRz

