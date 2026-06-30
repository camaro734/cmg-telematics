--
-- PostgreSQL database dump
--

\restrict 0h3pbeKm8CwYe4pYleF4jBbTZQbrheqwJarbhPeLJKYMY7MbLwqenuu3FjSSNaS

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
-- Name: work_order; Type: TABLE; Schema: public; Owner: cmg
--

CREATE TABLE public.work_order (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    title character varying(300) NOT NULL,
    description text,
    vehicle_id uuid,
    driver_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    priority character varying(10) DEFAULT 'normal'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    location_address character varying(500),
    location_lat double precision,
    location_lon double precision,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    final_client_name character varying(200),
    final_client_address character varying(300),
    doc_number character varying(40),
    auto_close_config jsonb,
    CONSTRAINT ck_work_order_priority CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'normal'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT ck_work_order_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'done'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.work_order OWNER TO cmg;

--
-- Data for Name: work_order; Type: TABLE DATA; Schema: public; Owner: cmg
--

COPY public.work_order (id, tenant_id, title, description, vehicle_id, driver_id, status, priority, scheduled_at, started_at, completed_at, location_address, location_lat, location_lon, notes, created_by, created_at, final_client_name, final_client_address, doc_number, auto_close_config) FROM stdin;
d61084f8-cff8-47b8-ad43-7e7a073361fe	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	prueba	hs	8120ac70-7dc4-4af8-9afd-0cc61bde690a	6fb2f6b5-965f-45de-be72-7e7850569af9	in_progress	normal	\N	2026-06-22 08:23:26.598638+00	\N	\N	\N	\N	\N	823be7db-1407-43b8-80ab-94118211a065	2026-06-22 08:22:25.739544+00	\N	\N	\N	null
00ddb109-2471-43b6-ac2d-91593b71f132	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	Órdenes CR2530	\N	8120ac70-7dc4-4af8-9afd-0cc61bde690a	6fb2f6b5-965f-45de-be72-7e7850569af9	in_progress	normal	\N	2026-06-26 13:37:14.253689+00	\N	\N	\N	\N	\N	823be7db-1407-43b8-80ab-94118211a065	2026-06-26 13:24:46.566589+00	\N	\N	\N	{"enabled": true, "signal_op": "==", "signal_value": true, "exit_margin_m": 25, "min_active_seconds": 60, "service_signal_key": "pto_active", "min_inactive_seconds": 300}
59a2d033-e215-4a88-a62c-ea5fe03318ff	ce6d6fa6-72b8-4d1a-9f91-8eb4f43186a5	prueba	\N	8120ac70-7dc4-4af8-9afd-0cc61bde690a	6fb2f6b5-965f-45de-be72-7e7850569af9	pending	normal	\N	\N	\N	\N	\N	\N	\N	823be7db-1407-43b8-80ab-94118211a065	2026-06-29 14:57:50.588046+00	prueba	Carrer de la Font, Barri Batalla, Meliana, l'Horta Nord, València / Valencia, Comunitat Valenciana, 46133, España	\N	null
\.


--
-- Name: work_order work_order_pkey; Type: CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_pkey PRIMARY KEY (id);


--
-- Name: ix_work_order_status; Type: INDEX; Schema: public; Owner: cmg
--

CREATE INDEX ix_work_order_status ON public.work_order USING btree (status);


--
-- Name: ix_work_order_tenant_id; Type: INDEX; Schema: public; Owner: cmg
--

CREATE INDEX ix_work_order_tenant_id ON public.work_order USING btree (tenant_id);


--
-- Name: ix_work_order_vehicle_id; Type: INDEX; Schema: public; Owner: cmg
--

CREATE INDEX ix_work_order_vehicle_id ON public.work_order USING btree (vehicle_id);


--
-- Name: work_order_doc_number_idx; Type: INDEX; Schema: public; Owner: cmg
--

CREATE UNIQUE INDEX work_order_doc_number_idx ON public.work_order USING btree (tenant_id, doc_number) WHERE (doc_number IS NOT NULL);


--
-- Name: work_order work_order_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: work_order work_order_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.driver(id) ON DELETE SET NULL;


--
-- Name: work_order work_order_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: work_order work_order_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: cmg
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicle(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 0h3pbeKm8CwYe4pYleF4jBbTZQbrheqwJarbhPeLJKYMY7MbLwqenuu3FjSSNaS

