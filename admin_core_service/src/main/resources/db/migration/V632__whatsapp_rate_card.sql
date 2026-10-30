-- V632: what one WhatsApp message costs, by recipient country and Meta pricing category.
--
-- Meta's status webhook says whether a message was billable and in which category, but never
-- the amount, so the engagement daily report prices each engine WhatsApp message with this
-- table: the longest country_code that prefixes the recipient's digits, then the row with the
-- latest effective_from on or before the report day. A new Meta price list is a new row with a
-- new effective_from; old rows stay so past days keep their price. category is lower case, as
-- Meta sends it (marketing, utility, authentication, service).
--
-- The India rows below come from public summaries of Meta's India rate card. They are NOT
-- verified: check them against Meta Business Manager (WhatsApp Manager -> Insights / pricing)
-- and add a corrected row with the right effective_from before trusting the report's amounts.
CREATE TABLE IF NOT EXISTS whatsapp_rate_card (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    country_code   VARCHAR(6)    NOT NULL,
    category       VARCHAR(40)   NOT NULL,
    currency       VARCHAR(3)    NOT NULL,
    price          NUMERIC(10,4) NOT NULL,
    effective_from DATE          NOT NULL,
    source         TEXT,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_whatsapp_rate_card UNIQUE (country_code, category, effective_from)
);

INSERT INTO whatsapp_rate_card (country_code, category, currency, price, effective_from, source)
VALUES ('91', 'marketing',      'INR', 0.8631, DATE '2026-01-01', 'Public India rate summary; verify in Meta Business Manager'),
       ('91', 'utility',        'INR', 0.1150, DATE '2026-01-01', 'Public India rate summary; verify in Meta Business Manager'),
       ('91', 'authentication', 'INR', 0.1150, DATE '2026-01-01', 'Public India rate summary; verify in Meta Business Manager'),
       ('91', 'service',        'INR', 0.0000, DATE '2026-01-01', 'Public India rate summary; verify in Meta Business Manager')
ON CONFLICT (country_code, category, effective_from) DO NOTHING;
