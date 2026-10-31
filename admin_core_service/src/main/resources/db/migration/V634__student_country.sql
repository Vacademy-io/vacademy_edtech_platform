-- Country as a system field on student, so a Country custom field can be mapped to it
-- through system_field_custom_field_mapping the same way City and State map to city and region.

ALTER TABLE student ADD COLUMN IF NOT EXISTS country VARCHAR(255) NULL;
