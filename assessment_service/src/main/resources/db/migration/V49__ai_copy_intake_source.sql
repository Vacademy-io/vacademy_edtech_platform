-- Bulk AI check of copies the learners submitted themselves.
--
-- The bulk check so far started from a pile of PDFs the admin uploaded: each file
-- had to be read for a name and matched to a student before it could be queued.
-- A test where 100 learners uploaded their own sheets already has every copy on
-- the right student - the admin only wants them all checked, without opening 100
-- rows one by one. Such a batch is built straight from the attempts (items start
-- QUEUED, nothing to identify) and is otherwise the same batch: same poller cap,
-- same panel, same one email and bell when it settles.
--
-- source tells the panel and the notice which kind this was.
--   UPLOAD    - PDFs uploaded by the admin (every batch before this column)
--   SUBMITTED - copies the learners submitted on their own attempts

ALTER TABLE ai_copy_intake_batch ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'UPLOAD';
