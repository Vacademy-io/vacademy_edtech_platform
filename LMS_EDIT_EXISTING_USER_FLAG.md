# Course setting: update existing LMS users on enrolment

A per-course flag deciding whether an enrolment workflow may overwrite the details of a
learner who **already has an account** on the connected LMS, plus the workflow node that
does the overwriting.

---

## The gap this closes

The Vet enrolment workflow (`wf_ld_vet_onboarding_01`, fires on `LEARNER_BATCH_ENROLLMENT`)
looks the learner up by email and skips creation when it finds them:

```
nt_vet_onb_03_find_user        GET /crm/v1/user?email=#ctx['user']['email']
nt_vet_onb_04_extract_user_id  -> #ctx['learndashUserId'] = <found id> | null
nt_vet_onb_05_create_user      condition: #ctx['learndashUserId'] == null
```

On a hit the existing account is left exactly as it was. A returning learner whose name
changed in Vacademy keeps the old name on the LMS, forever.

So **existing user ⇔ `#ctx['learndashUserId'] != null`** — the exact inverse of the
condition `create_user` already carries. That is the hook the new node gates on.

## The flag

Stored as `COURSE_SETTING.data.lms.editExistingUser`, resolved by
`LmsExistingUserEditPolicyService`:

1. `package.course_setting.setting.COURSE_SETTING.data.lms.editExistingUser` — this course
2. `INSTITUTE.setting.COURSE_SETTING.data.lms.editExistingUser` — institute-wide default
3. `false`

Course-then-institute mirrors how `LearnerLmsUserSyncService` already resolves LMS
connections, because the LMS connection itself is attached per course.

The reader returns `Boolean` (nullable) at each level rather than a primitive, which is what
makes the fallback correct: a course that has *never seen* the setting falls through to the
institute, while a course that has explicitly set it to `false` is **not** overridden by an
institute-wide `true`.

**Defaults false, and every failure path returns false.** This is the opposite of
`EnrollmentCredentialPolicyService`, which defaults true, and deliberately so: not sending
an email is recoverable; overwriting a live account on a customer's LMS is not.

## Reaching the workflow

`StudentRegistrationManager.triggerEnrollmentWorkflow` resolves the flag once and puts it on
the seed context as `lmsEditExistingUser`, next to `packageId` / `packageName`.

Resolved in Java rather than by a QUERY node in each graph because the course → institute
fallback has no clean SpEL expression. The call is wrapped in its own try/catch: failing to
read a display flag must never stop an enrolment.

## The node

`VET_ONBOARDING_EDIT_EXISTING_USER_NODE.sql` — an ordinary `HTTP_REQUEST` node, **not** a new
`NodeType`. `HttpRequestNodeHandler` already supports a SpEL `condition` that skips the call
and logs the node `SKIPPED`.

```
"condition": "#ctx['lmsEditExistingUser'] == true && #ctx['learndashUserId'] != null"
```

That handler evaluates the condition with a **false default on any evaluation error**, so a
run whose context never carried the key simply skips. Which is why the SQL is safe to apply
before the backend change ships.

Placement — inserted between 04 and 05, so it runs while `learndashUserId` still means "was
already there":

```
04 extract_user_id --> [NEW] 04b edit_existing_user --> 05 create_user --> ...
```

The only edit to a pre-existing node is node 04's routing target.

### What it sends, and what it deliberately doesn't

```
POST /crm/v1/edit-user   { email, first_name, last_name }
```

- **`email` is the lookup key, not an edit.** The learner was found *by* that address, so the
  account already has it.
- **No `new_email`.** There is no second address to move them to — and sending one would
  point the account at an address the find step never matched. Propagating email changes
  would require node 03 to look users up by something other than email; that is a different
  change.
- **No `password`.** Existing users keep the password they already have, consistent with the
  VetPartners migration.

## Verification

- `admin_core_service` compiles clean.
- `tsc --noEmit`: no errors in the touched frontend files.
- `eslint` + `scripts/design-lint.mjs`: clean.

Checked against Vet-Ed prod read-only before writing the SQL: the workflow id, that node 04
belongs to that one workflow only, that it is the only node routing to node 05, that its
stored `config_json` contains the exact literal being replaced, that neither new id collides,
and that `node_template_pkey` is a PK (so `ON CONFLICT (id)` is valid).

**Not run, and not exercised.** The SQL writes to Vet-Ed prod and re-routes a live ACTIVE
workflow — it is for a human to review and run. No enrolment has been put through the new
node.

## Not covered

`SUB_ORG_MEMBER_ENROLLMENT` (the add-member flow) does not get the flag on its context. That
trigger has no single course, so it would always fall through to the institute-level setting;
worth adding only if that flow needs the same behaviour.
