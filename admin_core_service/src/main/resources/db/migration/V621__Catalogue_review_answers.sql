-- Answers to the admin's own questions on a review form.
--
-- A reviewCollector block can now carry custom fields (short text, dropdown,
-- number, email, phone ...) next to the built-in ones (stars, name, review,
-- course, city, designation, which keep their own columns because the
-- testimonials section reads them). The custom answers are stored here as a
-- JSON array of {key, label, value}; the label is saved as the visitor saw it,
-- so renaming or deleting a field later does not change past reviews.
-- NULL on every review written before this.
ALTER TABLE catalogue_review ADD COLUMN IF NOT EXISTS answers TEXT;
