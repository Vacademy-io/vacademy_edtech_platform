-- Per-course display role of an author, e.g. Author, Instructor, Facilitator or
-- an institute's own word such as Acharya. NULL means the page falls back to the
-- institute's naming term. Written to every mapping row of that user in the course.
ALTER TABLE faculty_subject_package_session_mapping
    ADD COLUMN IF NOT EXISTS role_label VARCHAR(100);
