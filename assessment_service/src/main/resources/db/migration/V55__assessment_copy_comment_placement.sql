-- Checked-copy template chosen when copies are sent for AI checking.
-- INSIDE (or NULL) = teacher remarks written on the copy itself
-- OUTSIDE = marks on the copy, remarks in a Teacher Comments panel beside it
ALTER TABLE assessment ADD COLUMN IF NOT EXISTS copy_comment_placement VARCHAR(20);
