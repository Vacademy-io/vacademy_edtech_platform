-- The Content Library is now open to every institute by default.
--
-- V64 made question_library_access a list of topics given to an institute, and an institute
-- with no row saw nothing. That turned the library off for every institute until someone
-- gave it a course. Now every institute sees the whole library, and a row here hides one
-- topic (with everything below it) from one institute. Platform staff add and remove these
-- rows per institute from the health dashboard.
--
-- Rows written under the old meaning would now hide the very topics they gave, so they are
-- cleared. The table only arrived with V64 and the old meaning was never used to restrict
-- anyone in production.

DELETE FROM question_library_access;

COMMENT ON TABLE question_library_access IS
    'Topics of the Content Library hidden from one institute. No row means the institute sees the whole library.';
