-- =============================================================================
-- V527: Vsmart Extract — digitising an existing question paper
-- -----------------------------------------------------------------------------
-- pdf-to-questions?mode=extract reads a teacher's own paper verbatim (every
-- question, its options, passages, marks and the printed answer key /
-- solutions). A digital PDF is read locally for free, so the only cost is
-- the model (≈ ₹0.5 for a 40-question paper, ₹1.2 for 60 with solutions);
-- a scanned or mathematical page additionally goes through MathPix OCR,
-- billed per page.
--
--   extract_questions     = one price per band of questions (params_json.slabs):
--                             up to 20 → 2, 21–50 → 3, 51–100 → 5, 101+ → 7 credits
--   extract_questions_ocr = num_pages × 0.5 credits   (only pages that went to MathPix)
--
-- The actual charge is max(parametric, real token cost). Slabs are read by
-- ToolCostEstimator (unit_field 'questions' + params.slabs) and mirrored in
-- the admin FE computeToolCredits. MUST agree with DEFAULT_TOOL_PRICING in
-- ai_service tool_cost_estimator.py. DB row wins while active; tune here —
-- no release needed to change a band.
-- =============================================================================

INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES
    ('extract_questions', 'pdf_questions', 0, 0, 'questions',
     '{"slabs": [{"upto": 20, "credits": "2"}, {"upto": 50, "credits": "3"}, {"upto": 100, "credits": "5"}, {"upto": null, "credits": "7"}]}'),
    ('extract_questions_ocr', 'pdf_questions', 0, 0.5, 'pages', '{}')
ON CONFLICT (tool_key) DO NOTHING;
