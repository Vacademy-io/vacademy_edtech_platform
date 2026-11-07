-- V473: the AI call queue's primary keys are VARCHAR, not UUID.
--
-- V472 declared ai_call_queue.id and ai_voice_box.id as UUID with a
-- gen_random_uuid() default. Both entities map that id as a Java String annotated
-- @UuidGenerator, exactly like every other telephony entity, so Hibernate binds a
-- varchar parameter -- and Postgres will not implicitly cast varchar to uuid in an
-- INSERT or in a WHERE. Every enqueue failed on staging with:
--
--   column "id" is of type uuid but expression is of type character varying
--
-- and the drain job's claimForDispatch (WHERE id = :id) would have failed the same
-- way. The rest of the schema was already right; only these two columns deviated
-- from the convention every sibling table follows -- telephony_call_log (V319),
-- ai_calling_config (V344) and the rest all use VARCHAR(36) PRIMARY KEY.
--
-- Fixed forward in a new migration rather than by editing V472: that migration has
-- already run, and rewriting an applied script breaks Flyway's checksum validation
-- for every environment that has it.
--
-- The DEFAULT goes with the type. It was only ever used by V472's own seed row --
-- the application always supplies its own id through @UuidGenerator -- and
-- gen_random_uuid() cannot be a default for a varchar column anyway.
--
-- Safe on data: both tables hold at most the seeded voice-box row and queue rows
-- that never dialled, and uuid::text is lossless in any case.

ALTER TABLE ai_call_queue ALTER COLUMN id DROP DEFAULT;
ALTER TABLE ai_call_queue ALTER COLUMN id TYPE VARCHAR(36) USING id::text;

ALTER TABLE ai_voice_box ALTER COLUMN id DROP DEFAULT;
ALTER TABLE ai_voice_box ALTER COLUMN id TYPE VARCHAR(36) USING id::text;
