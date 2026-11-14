-- Key -> value tags on a lead list (e.g. state, course, channel) so CRM reports
-- can group leads by them. Canonical JSON object of string -> string with sorted
-- keys, written by the admin_core service; NULL when the list has no tags.
ALTER TABLE audience ADD COLUMN IF NOT EXISTS tags_json TEXT;
