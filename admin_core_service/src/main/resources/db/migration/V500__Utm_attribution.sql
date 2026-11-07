-- Campaign attribution for the people who actually arrive.
--
-- WHY: an admin can now generate utm_* links for audience forms, live sessions,
-- assessments, enrolment invites, product pages and catalogue sites — but until
-- now the parameters were read only by whatever tag manager the institute had
-- connected (usually none). GA could say "47 clicks from instagram"; nothing
-- could say WHICH 47 people, so the counsellor looking at a learner had no way
-- to know the campaign that produced them.
--
-- catalogue_page_event already records anonymous UTM traffic for catalogue
-- sites. That is deliberately un-joinable to a person (its visitor hash rotates
-- daily). This table is the other half and the opposite trade: it is written
-- only on a SUCCESSFUL submission, when the person has already given us their
-- details, and it is keyed to them.
CREATE TABLE IF NOT EXISTS utm_attribution (
    id VARCHAR(36) PRIMARY KEY,
    institute_id VARCHAR(36) NOT NULL,

    -- The learner/lead this touch belongs to. Nullable because a few capture
    -- surfaces answer with the created user id only after a second call; the
    -- row is still worth keeping, matched later on email/mobile.
    user_id VARCHAR(255),
    email VARCHAR(255),
    mobile_number VARCHAR(32),

    -- AUDIENCE | LIVE_SESSION | ASSESSMENT | ENROLL_INVITE | PRODUCT_PAGE | CATALOGUE
    source_type VARCHAR(32) NOT NULL,
    -- The campaign/session/assessment/invite/page identifier the link pointed at.
    source_id VARCHAR(255),

    utm_source VARCHAR(128),
    utm_medium VARCHAR(128),
    utm_campaign VARCHAR(191),
    utm_content VARCHAR(191),
    utm_term VARCHAR(191),

    -- Host only. A full referring URL routinely carries search terms and
    -- occasionally personal data in its query string; the host answers "where
    -- did they come from" without keeping any of it.
    referrer_host VARCHAR(255),
    -- Path only (query stripped client-side) — which page of ours they landed on.
    landing_path VARCHAR(512),

    -- No updated_at: a touch is a fact about a moment, never edited. The one
    -- mutation that exists (attaching a late-resolved user_id) does not change
    -- when the touch happened, and a column nothing maintains only lies.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The learner side-view's only question: every touch for this person, oldest
-- first (first touch is the one that gets the credit).
CREATE INDEX IF NOT EXISTS idx_utm_attr_institute_user_created
    ON utm_attribution (institute_id, user_id, created_at);

-- "Which campaign produced these enrolments?" over a date range.
CREATE INDEX IF NOT EXISTS idx_utm_attr_institute_campaign_created
    ON utm_attribution (institute_id, utm_campaign, created_at);

-- Late identity matching: rows written before the user id was known are joined
-- back on the contact details the form did capture.
CREATE INDEX IF NOT EXISTS idx_utm_attr_institute_email
    ON utm_attribution (institute_id, email);
CREATE INDEX IF NOT EXISTS idx_utm_attr_institute_mobile
    ON utm_attribution (institute_id, mobile_number);
