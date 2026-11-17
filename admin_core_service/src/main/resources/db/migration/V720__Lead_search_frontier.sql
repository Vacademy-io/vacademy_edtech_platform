-- Lead Agent search frontier (ai_service app/services/lead_agent/frontier.py).
-- Once an agent's plan has searched its first lists (the major cities, the brief's business kinds), it keeps
-- finding organisations through cells: one Maps search term in one place. Cells open in rings (more cities)
-- and with new business kinds, rest after a search finds nothing new, and are chosen by how their leads did.

CREATE TABLE IF NOT EXISTS lead_search_cell (
    id               VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    agent_id         VARCHAR(36)  NOT NULL REFERENCES lead_agent (id) ON DELETE CASCADE,
    term             VARCHAR(200) NOT NULL,
    place            VARCHAR(120) NOT NULL,
    origin           VARCHAR(12)  NOT NULL DEFAULT 'city',  -- city (a plan kind in a ring city) | kind (a new kind)
    place_rank       INT          NOT NULL DEFAULT 0,       -- the city's order (bigger places first)
    next_page        INT          NOT NULL DEFAULT 1,
    searches         INT          NOT NULL DEFAULT 0,
    found            INT          NOT NULL DEFAULT 0,       -- new organisations its searches added
    status           VARCHAR(10)  NOT NULL DEFAULT 'OPEN',
    rest_until       TIMESTAMPTZ  NULL,
    last_searched_at TIMESTAMPTZ  NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_lead_search_cell UNIQUE (agent_id, term, place),
    CONSTRAINT lead_search_cell_status_valid CHECK (status IN ('OPEN', 'RESTING', 'RETIRED'))
);
CREATE INDEX IF NOT EXISTS idx_lead_search_cell_agent_status ON lead_search_cell (agent_id, status);

-- One row per agent: rings opened, the outcome stats the choice uses, the day's checks.
CREATE TABLE IF NOT EXISTS lead_search_frontier (
    agent_id   VARCHAR(36) PRIMARY KEY REFERENCES lead_agent (id) ON DELETE CASCADE,
    state_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
