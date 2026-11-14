-- Per-assessment exam interface (the look and behaviour of the learner test screen).
--
-- Shape: {"v":1,"preset":"<id>","layout":"<variant>","strict":true|false}, stored as
-- sent (unknown keys kept), at most 4 KB. Written only through ExamInterfaceService.
-- NULL means the platform's default test screen, which is what every assessment that
-- predates this column keeps. JSONB rather than JSON because learner list queries
-- use SELECT DISTINCT, and JSON has no equality operator.
ALTER TABLE assessment ADD COLUMN IF NOT EXISTS exam_interface JSONB;
