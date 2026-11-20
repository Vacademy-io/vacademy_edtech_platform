-- V734: Telleo's own plans, one list per way of using Telleo (telleo_onboarding.access_mode, V718).
--
-- V713 copied Evalezy's Starter plan into product.telleo, so a Telleo workspace was offered
-- Evalezy's price and credits. This replaces the plan list with the telleo.ai/pricing plans:
--
--   access_mode PLATFORM (the dashboard): Starter, Pro (monthly minimum billing) and Annual.
--   access_mode API (calls from the customer's software): none yet. They are added from the
--   health dashboard (Products -> Telleo -> Pricing) once their prices are set; until then the
--   Telleo plan page shows API workspaces a "talk to us" card.
--
-- Credits: 5 credits are one minute of AI calling (ai_call_out, as the 50-credit trial in V713).
-- Starter's Rs 3,499 minimum covers about 875 minutes (4,375 credits), Pro's Rs 6,999 about
-- 1,750 minutes (8,750 credits). Annual is a platform fee with no bundled minutes.
-- Users: the website sets no user limit, so 100.
--
-- This changes only the product row. The storefront (ai_plan) is what checkout charges, and its
-- price wins on the plan page: re-save Telleo's pricing on the health dashboard after this runs.
-- A no-op when the row is missing.
UPDATE ai_platform_settings
   SET setting_value = setting_value
           || jsonb_build_object(
                  'plans', jsonb_build_array(
                      jsonb_build_object('key', 'starter', 'name', 'Starter', 'price_inr', 3499,
                                         'credits', 4375, 'users', 100,
                                         'access_mode', 'PLATFORM', 'validity_months', 1),
                      jsonb_build_object('key', 'pro', 'name', 'Pro', 'price_inr', 6999,
                                         'credits', 8750, 'users', 100,
                                         'access_mode', 'PLATFORM', 'validity_months', 1),
                      jsonb_build_object('key', 'annual', 'name', 'Annual', 'price_inr', 29999,
                                         'credits', 0, 'users', 100,
                                         'access_mode', 'PLATFORM', 'validity_months', 12)),
                  'plan_validity_months', 1),
       updated_by    = 'V734',
       updated_at    = CURRENT_TIMESTAMP
 WHERE setting_key = 'product.telleo';
