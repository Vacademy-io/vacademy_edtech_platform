-- Knowledge Base companions can teach in Kannada (Karnataka State Board books).
-- Design doc: docs/student-ai/KB_COMPANIONS_DESIGN.md
ALTER TABLE public.kb_companion DROP CONSTRAINT IF EXISTS kb_companion_language_chk;
ALTER TABLE public.kb_companion
    ADD CONSTRAINT kb_companion_language_chk CHECK (language IN ('en', 'hi', 'kn'));
