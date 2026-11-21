-- V718: how a Telleo account uses Telleo, chosen on the first setup step.
-- PLATFORM: the dashboard (business questions, a draft agent, the lead pages).
-- API: calls over the API (trial line and keys, AI agents and Call log only, no draft agent).
-- NULL: not chosen yet (accounts set up before this ran keep the dashboard).
ALTER TABLE telleo_onboarding ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NULL;
