-- V734: Telleo's plans, one list per way of using Telleo (telleo_onboarding.access_mode, V718).
--
--   access_mode PLATFORM (the dashboard): Evalezy's plan, as V713 copied it into product.telleo
--   (its Starter: price, credits, users, plan length). The plans already on product.telleo are kept
--   and tagged; when there are none, Evalezy's Starter is copied now. Prices stay in the database.
--
--   access_mode API (calls from the customer's software): the plans on telleo.ai/pricing
--   (telleo.ai src/content/pricing.ts): API Starter Rs 3,499 / month and API Pro Rs 6,999 / month
--   (monthly minimum billing), API Annual Rs 29,999 / year. Enterprise is "talk to us", not a plan.
--   Credits: 5 credits are one minute of AI calling (ai_call_out, as the 50-credit trial in V713):
--   Starter's minimum covers about 875 minutes (4,375 credits), Pro's about 1,750 (8,750). Annual is
--   a platform fee with no bundled minutes. The website sets no user limit, so 100.
--
-- Each plan carries its own validity_months, so the product's plan_validity_months (Evalezy's) is
-- left as it is. The storefront (ai_plan) is what checkout charges: re-save Telleo's pricing on the
-- health dashboard after this runs. A no-op when the row is missing.
WITH cur AS (
    SELECT setting_value AS v FROM ai_platform_settings WHERE setting_key = 'product.telleo'
), evz AS (
    SELECT setting_value AS v FROM ai_platform_settings WHERE setting_key = 'product.evalezy'
), months AS (
    SELECT COALESCE(
               (SELECT NULLIF(cur.v ->> 'plan_validity_months', '')::int FROM cur),
               (SELECT NULLIF(evz.v ->> 'plan_validity_months', '')::int FROM evz),
               12) AS m
), base AS (
    SELECT COALESCE(
               (SELECT jsonb_agg(p)
                  FROM cur, jsonb_array_elements(CASE WHEN jsonb_typeof(cur.v -> 'plans') = 'array'
                                                      THEN cur.v -> 'plans' ELSE '[]'::jsonb END) p
                 WHERE upper(COALESCE(p ->> 'access_mode', '')) <> 'API'),
               (SELECT jsonb_agg(p)
                  FROM evz, jsonb_array_elements(CASE WHEN jsonb_typeof(evz.v -> 'plans') = 'array'
                                                      THEN evz.v -> 'plans' ELSE '[]'::jsonb END) p
                 WHERE lower(p ->> 'key') = 'starter'),
               '[]'::jsonb) AS plans
), platform AS (
    SELECT COALESCE(jsonb_agg(p || jsonb_build_object(
               'access_mode', 'PLATFORM',
               'validity_months', COALESCE(NULLIF(p ->> 'validity_months', '')::int, (SELECT m FROM months)))),
               '[]'::jsonb) AS plans
      FROM base, jsonb_array_elements(base.plans) p
)
UPDATE ai_platform_settings
   SET setting_value = setting_value || jsonb_build_object('plans',
           (SELECT plans FROM platform)
           || jsonb_build_array(
                  jsonb_build_object('key', 'api-starter', 'name', 'API Starter', 'price_inr', 3499,
                                     'credits', 4375, 'users', 100,
                                     'access_mode', 'API', 'validity_months', 1),
                  jsonb_build_object('key', 'api-pro', 'name', 'API Pro', 'price_inr', 6999,
                                     'credits', 8750, 'users', 100,
                                     'access_mode', 'API', 'validity_months', 1),
                  jsonb_build_object('key', 'api-annual', 'name', 'API Annual', 'price_inr', 29999,
                                     'credits', 0, 'users', 100,
                                     'access_mode', 'API', 'validity_months', 12))),
       updated_by    = 'V734',
       updated_at    = CURRENT_TIMESTAMP
 WHERE setting_key = 'product.telleo';
