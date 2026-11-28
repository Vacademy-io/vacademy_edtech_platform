-- AI evaluation from the dashboard: 1 credit per page of the copy (1 per answer on a typed
-- attempt), at a fixed price, the same as the published price and the partner API. Change
-- the rate later on this row, from the tool pricing screen; no release is needed.
INSERT INTO ai_tool_pricing_history (tool_key, old_json, new_json, changed_by, reason)
SELECT p.tool_key,
       jsonb_build_object('flat_base_credits', p.flat_base_credits, 'per_unit_credits', p.per_unit_credits,
                          'unit_field', p.unit_field, 'params', p.params_json),
       jsonb_build_object('flat_base_credits', 0, 'per_unit_credits', 1, 'unit_field', 'pages',
                          'params', '{"fixed_price": true, "typed_per_answer": 1}'::jsonb),
       'V646',
       'Dashboard copy check moves to the published price: 1 credit per page'
FROM ai_tool_pricing p
WHERE p.tool_key = 'copy_check_evaluation';

UPDATE ai_tool_pricing
SET flat_base_credits = 0,
    per_unit_credits = 1,
    unit_field = 'pages',
    params_json = '{"fixed_price": true, "typed_per_answer": 1}'::jsonb,
    updated_at = now()
WHERE tool_key = 'copy_check_evaluation';

-- The credit history names the copy a charge was for.
UPDATE ai_use_case_catalog
SET label_template = 'AI evaluation · {assessment_name} · {student_name} · {units_label}'
WHERE use_case = 'evaluation';
