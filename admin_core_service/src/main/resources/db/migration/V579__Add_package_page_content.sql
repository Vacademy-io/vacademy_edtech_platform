-- Per-course "course page content" (FAQs, course mode, ...) that admins set when adding or
-- editing a course and that the public course page reads (course-init -> course.course_page_json).
-- One JSON text per package, owned by admin_core only. Kept out of the shared package table on
-- purpose: PackageEntity lives in common_service and is mapped by several services, so a new
-- column there could break a service that deploys before this migration runs.
-- The JSON shape belongs to the frontends ({"v":1,"mode":...,"faqs":[{"q":...,"a":...}]});
-- the backend only checks it is a JSON object of at most 100,000 characters.
CREATE TABLE IF NOT EXISTS package_page_content (
    package_id VARCHAR(255) PRIMARY KEY,
    content_json TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
