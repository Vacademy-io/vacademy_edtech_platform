-- Order of the tests inside an assessment folder, set from the admin folder menu (Test order).
--
-- assessment_folder_mapping.display_order now means:
--   0 for every test in the folder  = tests are listed by name, A to Z (the default)
--   1..N                            = the order an admin arranged by hand
--
-- Until now the column only recorded the order tests were added in, and nothing read it.
-- Reset it so every existing folder starts in name order.
UPDATE assessment_folder_mapping SET display_order = 0 WHERE display_order <> 0;
