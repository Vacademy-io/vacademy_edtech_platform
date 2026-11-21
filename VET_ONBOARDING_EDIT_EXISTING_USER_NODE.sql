-- =============================================================================
-- Workflow: "Vet Admin Onboarding (Group Leader)"  (LEARNER_BATCH_ENROLLMENT)
-- Purpose:  Add an "Update Existing User" HTTP_REQUEST node that pushes the
--           learner's current name to their EXISTING LearnDash/WordPress
--           account, gated on the new course setting.
-- Date:     2026-09-02
-- Target:   Vet Education prod RDS (database-1...ap-southeast-2), admin_core_service
--           institute 0bd9421e-2e74-4cfb-bbee-03bc09845bc6
--
-- WHY
-- ---
-- The workflow finds the learner by email:
--     nt_vet_onb_03_find_user  GET /crm/v1/user?email=#ctx['user']['email']
--     nt_vet_onb_04_extract_user_id  -> #ctx['learndashUserId'] = found id | null
--     nt_vet_onb_05_create_user      condition: #ctx['learndashUserId'] == null
--
-- So on a hit, creation is skipped and the existing account is left exactly as
-- it was -- a returning learner whose name changed in Vacademy keeps the old
-- name on the LMS. This node closes that gap.
--
-- GATING
-- ------
-- Two conditions, both required:
--
--   #ctx['lmsEditExistingUser'] == true   the course setting
--                                         (COURSE_SETTING.data.lms.editExistingUser,
--                                         course-level then institute-level;
--                                         resolved by LmsExistingUserEditPolicyService
--                                         and seeded onto the context by
--                                         StudentRegistrationManager)
--
--   #ctx['learndashUserId'] != null       the user actually already existed
--                                         (exact inverse of node 05's condition)
--
-- HttpRequestNodeHandler evaluates `condition` with a false default on any
-- evaluation error, so a run whose context predates the flag simply skips this
-- node and logs it SKIPPED. That is why this is safe to install before the
-- backend change ships.
--
-- WHAT IT SENDS
-- -------------
--     POST /crm/v1/edit-user   { email, first_name, last_name }
--
-- `email` is the LOOKUP KEY, not an edit. The learner was found BY that address,
-- so `new_email` is deliberately absent -- there is no second email to move them
-- to, and sending one would risk pointing the account at an address the find
-- step never matched. `password` is absent too: existing users keep the password
-- they already have.
--
-- PLACEMENT
-- ---------
--     04 extract_user_id  --> [NEW] edit_existing_user --> 05 create_user --> ...
--
-- Inserted between 04 and 05 so it runs while `learndashUserId` still means
-- "was already there". The only change to an existing node is node 04's routing
-- target. When the node skips, routing still carries the run on to node 05.
--
-- VERIFIED AGAINST PROD BEFORE WRITING THIS (read-only):
--   * workflow id            = wf_ld_vet_onboarding_01, name exactly
--                              'Vet Admin Onboarding (Group Leader)', ACTIVE
--   * nt_vet_onb_04_extract_user_id is mapped to that ONE workflow only, so
--     re-routing it cannot affect another graph
--   * it is also the ONLY node routing to nt_vet_onb_05_create_user
--   * its stored config_json contains the exact literal being replaced in STEP 3,
--     including the space after the colon
--   * neither the new node id nor the new mapping id exists yet
--   * node_template_pkey is a PRIMARY KEY on id, so ON CONFLICT (id) is valid
--
-- node_order 4 duplicates node 04's. That is cosmetic: the engine routes by
-- targetNodeId and picks its start node via is_start_node (nt_vet_onb_01_init),
-- so node_order only affects list ordering in the builder.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- STEP 0: BACKUP -- run this FIRST. Authoritative source of truth for revert.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.node_template_backup_20260902_edit_existing_user AS
SELECT * FROM public.node_template WHERE id = 'nt_vet_onb_04_extract_user_id';

CREATE TABLE IF NOT EXISTS public.wnm_backup_20260902_edit_existing_user AS
SELECT * FROM public.workflow_node_mapping WHERE workflow_id = 'wf_ld_vet_onboarding_01';


-- ---------------------------------------------------------------------------
-- STEP 1: the new node template.
-- Mirrors nt_vet_onb_03/05 exactly for url derivation and Basic auth, and reuses
-- their first/last name split so a one-word full name does not produce a stray
-- last_name.
-- ---------------------------------------------------------------------------

INSERT INTO public.node_template (id, institute_id, node_name, node_type, status, config_json, created_at, updated_at, version)
VALUES (
    'nt_vet_onb_04b_edit_existing_user',
    '0bd9421e-2e74-4cfb-bbee-03bc09845bc6',
    'Update Existing User',
    'HTTP_REQUEST',
    'ACTIVE',
    $json${
      "config": {
        "url": "#ctx['lmsConfig']['apiUrl'].replace('/wp/v2', '') + '/crm/v1/edit-user'",
        "method": "POST",
        "requestType": "EXTERNAL",
        "condition": "#ctx['lmsEditExistingUser'] == true && #ctx['learndashUserId'] != null",
        "authentication": {
          "type": "BASIC",
          "username": "#ctx['lmsConfig']['apiKey']",
          "password": "#ctx['lmsConfig']['apiSecret']"
        },
        "body": {
          "email": "#ctx['user']['email']",
          "first_name": "#ctx['user']['fullName'] != null && #ctx['user']['fullName'].contains(' ') ? #ctx['user']['fullName'].substring(0, #ctx['user']['fullName'].indexOf(' ')) : (#ctx['user']['fullName'] != null ? #ctx['user']['fullName'] : '')",
          "last_name": "#ctx['user']['fullName'] != null && #ctx['user']['fullName'].contains(' ') ? #ctx['user']['fullName'].substring(#ctx['user']['fullName'].indexOf(' ') + 1) : ''"
        }
      },
      "routing": [
        { "type": "goto", "targetNodeId": "nt_vet_onb_05_create_user" }
      ],
      "resultKey": "'editUserHttpResponse'"
    }$json$,
    NOW(), NOW(), 1
)
ON CONFLICT (id) DO UPDATE
    SET config_json = EXCLUDED.config_json,
        node_name   = EXCLUDED.node_name,
        node_type   = EXCLUDED.node_type,
        status      = EXCLUDED.status,
        updated_at  = NOW();


-- ---------------------------------------------------------------------------
-- STEP 2: map the node into the workflow.
-- node_order 4 keeps it adjacent to 04 in the builder's list view; ordering is
-- cosmetic here because the engine routes by targetNodeId, not by node_order.
-- ---------------------------------------------------------------------------

INSERT INTO public.workflow_node_mapping (id, workflow_id, node_template_id, node_order, is_start_node, is_end_node, created_at)
SELECT
    'wnm_vet_onb_04b_edit_existing_user',
    w.id,
    'nt_vet_onb_04b_edit_existing_user',
    4,
    false,
    false,
    NOW()
FROM public.workflow w
WHERE w.id = 'wf_ld_vet_onboarding_01'
  AND NOT EXISTS (
      SELECT 1 FROM public.workflow_node_mapping m
      WHERE m.workflow_id = w.id AND m.node_template_id = 'nt_vet_onb_04b_edit_existing_user'
  );


-- ---------------------------------------------------------------------------
-- STEP 3: re-route node 04 to the new node.
-- The ONLY edit to a pre-existing node. Guarded so re-running is a no-op.
-- ---------------------------------------------------------------------------

UPDATE public.node_template
SET config_json = replace(
        config_json,
        '"targetNodeId": "nt_vet_onb_05_create_user"',
        '"targetNodeId": "nt_vet_onb_04b_edit_existing_user"'
    ),
    updated_at = NOW()
WHERE id = 'nt_vet_onb_04_extract_user_id'
  AND config_json LIKE '%"targetNodeId": "nt_vet_onb_05_create_user"%'
RETURNING id, node_name;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Expect: node 04 routes to 04b, and 04b routes to 05.
--
-- SELECT id, node_name, config_json::jsonb -> 'routing' AS routing
-- FROM public.node_template
-- WHERE id IN ('nt_vet_onb_04_extract_user_id',
--              'nt_vet_onb_04b_edit_existing_user',
--              'nt_vet_onb_05_create_user')
-- ORDER BY id;


-- ---------------------------------------------------------------------------
-- REVERT
-- ---------------------------------------------------------------------------
-- UPDATE public.node_template nt
-- SET config_json = b.config_json, updated_at = NOW()
-- FROM public.node_template_backup_20260902_edit_existing_user b
-- WHERE nt.id = b.id;
--
-- DELETE FROM public.workflow_node_mapping WHERE id = 'wnm_vet_onb_04b_edit_existing_user';
-- DELETE FROM public.node_template        WHERE id = 'nt_vet_onb_04b_edit_existing_user';
