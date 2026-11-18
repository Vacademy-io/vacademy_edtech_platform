-- A white-label domain stores the roles allowed to sign in on it as a
-- comma-separated list in this column. An institute with several custom
-- staff roles needs more than 100 characters for that list.
ALTER TABLE institute_domain_routing ALTER COLUMN role TYPE varchar(255);
