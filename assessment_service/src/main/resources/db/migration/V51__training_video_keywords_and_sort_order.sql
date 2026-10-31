-- Training videos (community_service feature/trainingvideo, table created in V47):
--  * keywords   - extra words admins might search with (synonyms, Hinglish, old feature names),
--                 set by super admins from the health-check dashboard. jsonb array of strings.
--  * sort_order - the video's step number inside its section, so the admin popup can show a
--                 section as an ordered series (1, 2, 3 ...). NULL = unordered.
-- Both are additive with defaults, so existing rows and older community_service builds keep working.
ALTER TABLE public.training_video
    ADD COLUMN IF NOT EXISTS keywords jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.training_video
    ADD COLUMN IF NOT EXISTS sort_order integer;
