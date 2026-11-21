-- V18: Author metadata on users (Add Course -> Add Authors flow).
--
-- author_subtitle: short headline shown under the author name on course
-- pages / catalogue cards (e.g. "Ph.D. in Physics, Educator & Author").
-- author_description: rich-text (HTML) bio of the author.
--
-- Both columns are nullable and only written when the admin supplies a value,
-- so this is a no-op for existing users and every other write path.

ALTER TABLE public.users
ADD COLUMN author_subtitle VARCHAR(255) NULL;

ALTER TABLE public.users
ADD COLUMN author_description TEXT NULL;

COMMENT ON COLUMN public.users.author_subtitle IS 'Short author headline shown on course pages/catalogue (set from Add Course -> Add Authors); NULL = not set';

COMMENT ON COLUMN public.users.author_description IS 'Rich-text (HTML) author bio shown on course pages/catalogue (set from Add Course -> Add Authors); NULL = not set';