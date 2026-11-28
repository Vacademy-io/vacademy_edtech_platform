-- ================================================================================
-- V522: a second embedder — in-process, no per-token cost
--
-- V435 designed kb_embedding_model so that adding an embedder is a row here
-- (plus a vector column if the width is new). BAAI/bge-base-en-v1.5 is 768
-- wide, the same as the default, so it reuses embedding_768 — one knowledge
-- base is always pinned to exactly one model, and every query against it is
-- embedded with that model, so the two never rank against each other.
--
-- Why: the curriculum libraries (V517) are ~35k chunks of NCERT that every
-- institute searches. Embedding them through a metered key costs money once
-- and, worse, puts that key behind every client's search forever. bge runs
-- inside ai_service on CPU (fastembed / ONNX, no torch).
--
-- NOT the default: institutes' own uploads keep google/gemini-embedding-001,
-- which is stronger on Indic scripts. The curriculum loader opts in per base.
-- ================================================================================
INSERT INTO kb_embedding_model (model_id, dim, vector_column, provider, is_default, is_active, notes)
VALUES (
    'BAAI/bge-base-en-v1.5', 768, 'embedding_768', 'local', FALSE, TRUE,
    'In-process via fastembed (ONNX, CPU). Used by the curriculum libraries. '
    'English-centric; do not use for Hindi/regional corpora.'
)
ON CONFLICT (model_id) DO NOTHING;
