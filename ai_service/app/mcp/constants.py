"""Constants for the Vacademy MCP server."""
from __future__ import annotations

from typing import Any, Dict, Tuple

#: Institute-settings key holding the MCP server configuration. Written by the
#: admin dashboard through the generic settings endpoint, read here.
#:
#: Payload shape (deliberately the SAME shape the Assistant tool gate consumes,
#: so ``is_tool_allowed``/``execute_tool`` can be reused verbatim):
#:
#:     {
#:       "enabled": false,
#:       "allowed_roles": ["ADMIN"],
#:       "enabled_tools": ["institute_overview"],
#:       "role_overrides": {"TEACHER": {"enabled_tools": ["institute_overview"]}}
#:     }
MCP_SERVER_SETTING_KEY = "MCP_SERVER_SETTING"

#: Deep link the denial messages point admins at.
MCP_SETTINGS_PATH = "/settings?selectedTab=mcpServer"

#: The ONLY registry tools this server exposes. Everything else in
#: ASSISTANT_TOOLS stays invisible and uncallable over MCP regardless of any
#: institute setting.
#:
#: Each feature is ONE tool with an ``action`` argument (see
#: docs/ai-page-builder/WEBSITE_BUILDER_MCP_PLAN.md §4), so the institute's
#: settings tab has one toggle per feature to manage per role.
MCP_EXPOSED_TOOLS: Tuple[str, ...] = (
    "whoami",               # READ:  the caller's own identity + institute profile; always on, no toggle
    "get_institute_overview",
    "website",              # READ:  sites, pages, courses/campaigns to link, analytics, audit
    "website_edit",         # WRITE: draft-only — every change lands as a draft the admin publishes
    "design_import",        # WRITE: a Figma design the AI app read itself → site plan; save_draft = website_edit drafts
    "catalog_data_edit",    # WRITE: additive live data — HIDDEN folders, appended course tags, DRAFT product pages
    "website_publish",      # WRITE (live): publish a checked draft / roll back — two-step confirm token, opt-in only
    "audience_forms",       # READ:  lead campaigns, their form fields, recent leads
    "audience_forms_edit",  # WRITE: additive only — create a campaign, add fields, send a test lead
    "workflows",            # READ:  automations, their runs, the authoring catalog, real entity ids
    "workflows_edit",       # WRITE: draft-only — validates and saves DRAFT automations the admin publishes
    "blog",                 # READ:  blog posts, their bodies, and which website pages show them
    "blog_edit",            # WRITE: draft-only — creates/edits DRAFT posts the admin publishes in Manage Pages → Blog
    "courses",              # READ:  courses, their tree, the authoring contract, review, drip, invites
    "course_edit",          # WRITE: draft-only — DRAFT courses and DRAFT slides; nothing publishes
    "course_drip_edit",     # WRITE: drip rules on courses that are not live yet
    "course_invites_edit",  # WRITE: new invites / plans; edits an invite's page and form fields
    "course_structure_edit",  # WRITE (live): change a course's depth / regroup it — preview + confirm token, opt-in
    "learners",             # READ:  find learners, their profile + courses, enrol options, the bulk-enrol CSV template
    "learner_report",       # READ:  a learner's progress-report data (facts + discarded detail) for the AI app to write the report
    "learner_enroll",       # WRITE: additive — enrols learners into courses via an invite; preview + confirm token
    "learner_edit",         # WRITE: live — edits a learner's details (never email / username); preview + confirm token
    "sub_orgs",             # READ:  sub-organisations, their courses / seats / admins / members, set-up options, CSV template
    "sub_org_edit",         # WRITE: live — create a sub-org, add courses / change seats / roles, add its admin; preview + confirm token
    "sub_org_enroll",       # WRITE: additive — adds LEARNERS to a sub-org's courses (CSV / list); preview + confirm token
    # CRM (docs/crm/CRM_MCP.md): every CRM tool is mcp_only, verifies each id against the institute and the
    # caller's dashboard lead scope, and needs its plan feature (ToolSpec.module_feature). Writes are opt-in.
    "crm_leads",            # READ:  find / list / one lead, timeline, my day, the CRM catalog, export
    "crm_lead_activity",    # WRITE: live additive — log interactions and notes, schedule / move / complete follow-ups
    "crm_lead_edit",        # WRITE: live — status, tier, details, tags; preview + confirm token
    "crm_team_edit",        # WRITE: live — assign / reassign leads, pause / resume a counsellor's routing; preview + confirm
    "crm_lead_intake",      # WRITE: live — add a lead (walk-ins too) or import a short list; preview + confirm token
    "crm_calls",            # READ:  calls, transcripts, callbacks due, missed inbound, AI agents / queue / runs
    "crm_dial",             # WRITE: outbound — one call or one AI call to one lead; single-use confirm token
    "crm_ai_campaign",      # WRITE: outbound, admin only — AI-call a resolved list of ≤500 leads; single-use confirm
    "crm_meetings",         # READ:  meetings (mine / team / a lead's), free slots, booking pages
    "crm_meetings_edit",    # WRITE: outbound — book a meeting for a lead (they get the invite); log a meeting's outcome
    "crm_messages",         # READ:  a lead's WhatsApp / email history, inbox, approved templates, escalations
    "crm_send",             # WRITE: outbound — one approved WhatsApp template or one email to one lead; single-use confirm token
    "crm_reports",          # READ:  CRM reports, custom reports and the live activity feed, each figure with its definition
    "crm_collections",      # READ:  a lead's dues, who owes, what falls due, converted-not-paid, failed checkouts, collections
    "crm_payment_reminders",  # WRITE: outbound, admins only — fee reminders for unpaid installments / pending invoices
)

#: WRITE tools this server may expose, with the property that makes each safe
#: without a confirm card (MCP has none). A write tool is allowed here only
#: when nothing it does can destroy or publish anything: it writes DRAFTS the
#: admin publishes from the dashboard, or it only ADDS records. Live edits that
#: change or remove existing data (update_learner_profile, announcements) stay off.
#: The exceptions are live writes that carry their own confirm and whose groups
#: are opt-in only (MCP_OPT_IN_GROUPS):
#:   * website_publish (product decision 2026-10-10): it publishes, with a
#:     single-use token from a check the admin was shown less than 10 minutes
#:     earlier, bound to that exact state;
#:   * course_structure_edit (product decision 2026-10-12): regroups a course, live
#:     ones included, through a dry run the admin is shown → a signed confirm_token
#:     over the identical request → one admin-core transaction;
#:   * learner_enroll / learner_edit (product decision 2026-10-10): a preview the
#:     admin is shown → a signed confirm_token over the identical request → the
#:     write (see services/learner_data.py).
#:   * sub_org_edit / sub_org_enroll (product decision 2026-10-19): same preview →
#:     confirm_token → write; no delete / deactivate / course removal / payment
#:     swap from here (see services/sub_org_data.py).
#:   * the CRM writes (crm_*): live lead edits and outbound contact (calls,
#:     WhatsApp, meeting invites). Each verifies every id against the institute
#:     and the caller's dashboard lead scope; changes and every contact with a
#:     lead go through a preview the user is shown → a confirm_token (signed over
#:     the resolved leads and their current state, or single-use for outbound and
#:     bulk actions, bound to the exact resolved target list) → the write.
MCP_ALLOWED_WRITE_TOOLS: Dict[str, str] = {
    "website_edit": (
        "draft-only: every action saves a draft revision; discard_draft undoes it; request_publish only reads "
        "(checks + diff vs live + editor link) — publishing is an admin click"
    ),
    "design_import": (
        "draft-only: plan parses the Figma results the caller sends and stores them 24 h for this institute "
        "(its own table, never served elsewhere); save_draft saves a DRAFT through website_edit's create_site / "
        "create_page and also needs website_edit's group"
    ),
    "catalog_data_edit": (
        "additive only; never deletes or renames existing records; new folder nodes start HIDDEN; tags are "
        "appended; product pages are created DRAFT. Every action is a dry run first: applying needs the dry run's "
        "plan_token (10 minutes, refused when the data changed); a shown folder changes only while no live site "
        "uses its library; the store sync never switches a course off; activating a product page and invite "
        "payment vendors stay admin clicks"
    ),
    "website_publish": (
        "LIVE, two-step confirmed: publish needs a single-use confirm_token from website_edit(request_publish) "
        "less than 10 minutes earlier on the same draft (id + JSON hash) and live revision, and admin-core "
        "refuses a draft older than live (409, never overrideStale); rollback republishes an earlier PUBLISHED "
        "revision through a new draft + publish with the same token rule and refuses while a draft is open. "
        "Nothing is deleted: every version stays in the history"
    ),
    "audience_forms_edit": "additive: creates campaigns / adds fields / sends a test lead; never removes",
    "workflows_edit": (
        "draft-only + additive: every workflow save forces status=DRAFT, which never fires (triggers and "
        "the scheduler only run ACTIVE workflows); update/discard refuse anything that is not a DRAFT; the "
        "template actions only CREATE new email/WhatsApp templates (unused until an automation references "
        "them) and never edit or remove an existing one"
    ),
    "blog_edit": (
        "draft-only: create forces status=DRAFT (never served publicly); update/discard refuse anything "
        "that is not a DRAFT; request_publish only returns the dashboard link — publishing is an admin click"
    ),
    "course_edit": "draft-only: creates DRAFT courses and edits only DRAFT courses; slides are DRAFT unless the admin "
                   "asks to publish them (publish_slides); a course goes live only through dashboard approval. "
                   "Exception by the admin's choice: update_media sets a course's images on any course and only "
                   "fills invite image slots that are empty",
    "course_drip_edit": "not-live only: drip rules of DRAFT / IN_REVIEW courses; never flips the institute switches",
    "course_invites_edit": (
        "creates invites and payment plans (re-pointing / default only on non-live courses); edits an invite's "
        "page and form in place — the admin's explicit choice, live courses included — but only binds existing "
        "fields and never changes a field's shared label / type / options or the invite's payment links"
    ),
    "course_structure_edit": (
        "LIVE, confirm-gated, the admin's explicit choice: changes a course's depth / grouping in ONE admin-core "
        "transaction for every batch; nothing is copied or deleted — slides and kept containers keep their ids, "
        "emptied containers are soft-deleted; refuses content shared with another course and trees that drop or "
        "duplicate a slide; every write needs the confirm_token of a dry-run preview of the identical request"
    ),
    "learner_enroll": (
        "additive + confirm-gated: only ENROLS (never de-assigns; duplicates SKIP or ERROR, never RE_ENROLL) and "
        "only through this institute's active invites of the chosen batch; refuses organisation batches; every "
        "write needs the confirm_token of a dry-run preview of the identical request"
    ),
    "learner_edit": (
        "confirm-gated live edit, the admin's explicit choice: changes one learner of this institute at a time; "
        "never email or username; needs the confirm_token of a preview that showed every before → after"
    ),
    "sub_org_edit": (
        "confirm-gated live write, the admin's explicit choice: creates a sub-org of this institute, adds courses / "
        "changes seats, validity and roles of one (add-only for courses), or gives a sub-org without an admin its "
        "admin; never deletes or deactivates a sub-org, removes a course or swaps its payment option; every write "
        "needs the confirm_token of a preview of the identical request"
    ),
    "sub_org_enroll": (
        "additive + confirm-gated: only ADDS learners (role LEARNER, never admin) to the courses of a sub-org of "
        "this institute; skips anyone already active in a course; refuses uploads over the sub-org's seat cap; "
        "every write needs the confirm_token of a preview of the identical request"
    ),
    "crm_lead_activity": (
        "live additive, the admin's explicit choice: adds notes / logged interactions to one lead at a time as "
        "timeline activity and schedules or moves follow-ups; never edits or deletes earlier activity; every lead, "
        "call and follow-up id is verified to belong to this institute and the caller's lead scope; completing a "
        "follow-up, and a status change that would fire an automation, apply only with the confirm_token of a "
        "preview of the identical request"
    ),
    "crm_lead_edit": (
        "confirm-gated live edit, the admin's explicit choice: changes the status, tier, details or tags of leads "
        "in the caller's lead scope (at most 500 per call), and institute admins can label lead lists with "
        "report tags (at most 50 lists per call); never deletes a lead; every write needs the "
        "confirm_token of a preview that showed each before → after, signed over the resolved leads and their "
        "current state (single-use for more than one lead), so a changed lead or target list is refused"
    ),
    "crm_team_edit": (
        "confirm-gated live edit, admins and managers only: assigns or reassigns leads of this institute (at most "
        "500) to counsellors verified to be in the caller's assignable set, and pauses / resumes a counsellor's routing without moving "
        "leads; never deletes leads or follow-ups; every write needs the confirm_token of a preview listing each "
        "lead's current → new owner"
    ),
    "crm_lead_intake": (
        "live additive, confirm-gated: adds leads (one, or up to 100 from a list) to a lead list verified to belong "
        "to this institute; looks the person up first and refuses an existing lead or an opted-out person unless "
        "the user asks for a re-enquiry; never edits or removes existing leads; every write needs the confirm_token "
        "of a preview of the identical request"
    ),
    "crm_dial": (
        "outbound, single-use confirmed: places ONE call (the caller's own phone rings first) or queues ONE AI call "
        "to a lead in the caller's scope, to the number on the lead's record; refuses opted-out and do-not-call "
        "leads, AI calls outside calling hours or inside the recall gaps; each call needs a single-use confirm_token "
        "from a preview of that exact lead and counts toward an hourly cap; cancel_queued cancels only the caller's "
        "own queued items"
    ),
    "crm_ai_campaign": (
        "outbound, admins only, single-use confirmed: AI-calls at most 500 leads resolved in the caller's scope and "
        "listed in the preview (opted-out, converted, lost, do-not-call and recently contacted leads are dropped "
        "with a reason); the apply sends exactly that stored list, re-checked against the scope, never an empty or "
        "whole list; cancelling a run or pausing / resuming the queue acts only on runs verified to belong to this "
        "institute"
    ),
    "crm_meetings_edit": (
        "outbound, confirm-gated: books one meeting for one lead in the caller's scope on a booking page and slot "
        "verified to belong to this institute and still free, after a preview showing what the lead receives "
        "(calendar invite, email, WhatsApp); log_outcome only adds timeline activity; never cancels or deletes a "
        "booking"
    ),
    "crm_send": (
        "outbound, single-use confirmed: sends ONE approved WhatsApp template or ONE email (an institute email "
        "template or a subject and body written with the user) to ONE lead in the caller's scope, to the number or "
        "address on the lead's record (never one typed in the chat); refuses opted-out leads and addresses on the "
        "institute's email unsubscribe list; needs a single-use confirm_token from a preview of that exact message "
        "and counts toward an hourly cap per user (WhatsApp and email counted separately)"
    ),
    "crm_payment_reminders": (
        "outbound, admins only, single-use confirmed: reminds at most 50 unpaid installments or pending invoices "
        "verified to belong to this institute through admin-core's own reminder endpoints (the institute's "
        "installment-due automations; the invoice's in-app alert and email); refuses paid, cancelled and waived "
        "bills, inactive enrolments and opted-out people; the apply sends exactly the previewed items, re-checked; "
        "capped at 50 reminders per user per hour"
    ),
}

#: Friendly labels for the settings groups the exposed tools belong to. Serves
#: the settings UI so the FE never hardcodes a catalogue that can drift.
MCP_TOOL_GROUP_LABELS: Dict[str, str] = {
    "identity": "Who is connected",
    "institute_overview": "Institute stats",
    "website_builder": "Website: view",
    "website_builder_edits": "Website: edit drafts",
    "design_import": "Website: import Figma designs",
    "website_data_edits": "Website: set up course data",
    "website_publish": "Website: publish",
    "audience_forms": "Lead forms: view",
    "audience_forms_edits": "Lead forms: edit",
    "workflows": "Automations: view",
    "workflows_edits": "Automations: draft",
    "blog": "Blog: view",
    "blog_edits": "Blog: draft posts",
    "courses": "Courses: view",
    "course_edits": "Courses: build drafts",
    "course_drip_edits": "Courses: drip rules",
    "course_invite_edits": "Courses: invite links & payment plans",
    "course_structure_edits": "Courses: change structure / depth",
    "learners": "Learners: view",
    "learner_enrollments": "Learners: enrol into courses",
    "learner_profile_edits": "Learners: edit details",
    "learner_reports": "Progress reports: view data",
    "sub_orgs": "Sub-organisations: view",
    "sub_org_edits": "Sub-organisations: create and change",
    "sub_org_enrollments": "Sub-organisations: add learners",
    "crm_leads": "CRM leads: view",
    "crm_lead_activity": "CRM leads: log activity and follow-ups",
    "crm_lead_edits": "CRM leads: edit status, tier, details and tags",
    "crm_team_edits": "CRM leads: assign and route",
    "crm_lead_intake": "CRM leads: add leads",
    "crm_calls": "CRM calls: view",
    "crm_calling_outbound": "CRM calls: place calls",
    "crm_ai_campaigns": "CRM calls: AI-call campaigns",
    "crm_meetings": "CRM meetings: view",
    "crm_meeting_edits": "CRM meetings: book and log",
    "crm_messages": "CRM messages: view",
    "crm_messaging_outbound": "CRM messages: send WhatsApp and email",
    "crm_reports": "CRM reports: view",
    "crm_collections": "CRM payments: view dues and collections",
    "crm_payment_reminders": "CRM payments: send fee reminders",
}

#: One plain sentence per group for the settings page. The registry's tool
#: descriptions are written for the model (argument lists, rules) and read as
#: a wall of text next to a toggle.
MCP_TOOL_GROUP_SUMMARIES: Dict[str, str] = {
    "identity": "The connected user's name and contact details, and the institute's name, logo and theme. Always on.",
    "institute_overview": "The institute's profile (name, logo, theme, terminology), outstanding fees, classes live now and active learner counts.",
    "website_builder": (
        "See the institute's websites: pages and what each section shows, traffic, lead-capture "
        "health, pre-publish checks, and the interview an AI runs before building a site."
    ),
    "website_builder_edits": (
        "Let the connected AI app build and change websites — compose pages, edit sections, set "
        "colours and fonts, course formats and languages, translations, wire forms to lead campaigns "
        "and sections to folder libraries or product pages. Every change is saved as a draft; nothing "
        "goes live until you publish it in Manage Pages. Uses no AI credits."
    ),
    "design_import": (
        "Let the connected AI app turn a Figma design it read with its own Figma tools into a site plan "
        "(colours, fonts, sections, the data it needs) and save it as a DRAFT site. The design files it sends "
        "are kept 24 hours for this institute only. Saving also needs 'Build and edit pages'. Uses no AI credits."
    ),
    "website_data_edits": (
        "Let the connected AI app add the course data a website design needs: create folder libraries and "
        "folders (new folders start hidden), append tags to courses (existing tags are kept), create product "
        "pages as DRAFT and add catalogue courses to a store page. It shows each change first and never deletes, "
        "renames or hides anything; activating a product page and payment settings stay with you. These are "
        "live records, not drafts: tags added to live courses change the site's filters at once, and courses "
        "added to an active store page are on sale at once. Uses no AI credits."
    ),
    "website_publish": (
        "Let the connected AI app publish a website draft, or roll the live site back to an earlier published "
        "version, after you say yes in the chat. Changes go live at once. Each publish needs a fresh check of that "
        "exact draft from the last 10 minutes; a draft older than the live site, or edited after the check, is "
        "refused, and a rollback never overwrites an unpublished draft. Every version stays in the history. "
        "Needs 'Build and edit pages' for the check. Turned on separately."
    ),
    "audience_forms": (
        "See lead campaigns: their form fields, where they are used on the websites, and leads received."
    ),
    "audience_forms_edits": (
        "Create lead campaigns, add fields to their forms and send test leads. Never removes anything."
    ),
    "workflows": (
        "See the institute's automations (workflows): each one's trigger or schedule, its nodes, recent "
        "runs and per-node results, plus the authoring catalog and the batches, lead campaigns and "
        "message templates an automation can reference."
    ),
    "workflows_edits": (
        "Let the connected AI app build automations by conversation — compose the workflow (trigger, "
        "queries, emails, WhatsApp, delays, conditions), check it against the builder's rules and save it "
        "as a DRAFT, and create the new email and WhatsApp templates it needs (WhatsApp templates go to "
        "Meta for approval). A draft never runs until you open it in the builder and publish it; published "
        "automations and existing templates cannot be changed or removed from here. Uses no AI credits."
    ),
    "blog": (
        "See the institute's blog posts — drafts and published articles, their bodies and SEO fields, and "
        "which website pages show them."
    ),
    "blog_edits": (
        "Let the connected AI app write blog posts by conversation and save them as DRAFTS in Manage Pages → "
        "Blog. A draft is never shown on the website until you open it and press Publish; published posts "
        "cannot be changed or removed from here. Uses no AI credits."
    ),
    "courses": (
        "See courses: their chapters and slides, slide content, drip rules, invite links and prices, and a "
        "quality check of a course before it is submitted."
    ),
    "course_edits": (
        "Let the connected AI app build courses — outline, reading pages, YouTube videos, PDFs, quizzes, "
        "questions and assignments — and publish slides when you ask it to. Courses are saved as DRAFT and go "
        "live only when an admin approves them in the dashboard. It can also set a course's preview image, "
        "banner and intro video, on live courses too. The AI app writes the content itself, so it uses no AI "
        "credits."
    ),
    "course_drip_edits": (
        "Let the connected AI app set content release (drip) rules on courses that are not live yet. Never "
        "changes the institute-wide drip switches."
    ),
    "course_invite_edits": (
        "Let the connected AI app create invite links and payment plans for courses, and edit an invite's page "
        "(name, dates, text, images, where learners land after enrolling) and its registration form (add your "
        "existing fields, remove, reorder, make required). Invite edits apply right away, also on live "
        "courses. Payment plans are never edited or removed."
    ),
    "course_structure_edits": (
        "Let the connected AI app change how many levels a course has (subjects / modules / chapters) or regroup "
        "its content — for example turn a chapters-only course into modules of chapters, with groups it proposes "
        "from the content and you adjust. It always shows you the new structure first and changes it only after "
        "you confirm. Works on live courses too: learners see the new structure at once and keep their slide "
        "progress. Nothing is copied or deleted."
    ),
    "learners": (
        "Find learners by name, email or phone, and see their profile and the courses they are enrolled in, "
        "plus each course's invites and the bulk-enrol CSV template."
    ),
    "learner_reports": (
        "Let the connected AI app read the data behind a learner's progress report — attendance and every live "
        "class, test scores with rank and class average, marks by subject, study time and what was studied, "
        "course progress next to the batch average, assignments with feedback, doubts with their replies and "
        "the analysis of each attempt — plus the reports already generated in the dashboard, so it can write "
        "the report for you. Read-only. The AI app writes the report itself, so it uses no AI credits."
    ),
    "learner_enrollments": (
        "Let the connected AI app enrol learners — one, a list or a CSV, existing or new — into one or more "
        "courses through the invite you pick. It always shows you a preview (who is new, who is already enrolled) "
        "and enrols only after you confirm. It asks you every time whether to send the welcome email and the "
        "login-details email, and whether you want a CSV of the learners' usernames and passwords (delivered as a "
        "private download link that expires after 30 minutes, never shown in the chat). Never removes anyone from a "
        "course. Batches sold to organisations stay dashboard-only."
    ),
    "sub_orgs": (
        "See the institute's sub-organisations (partner organisations / centres): each one's admin, courses, seats "
        "used against the cap, plan status, invite link and learners, plus the payment options and roles a new one "
        "can be set up with."
    ),
    "sub_org_edits": (
        "Let the connected AI app create sub-organisations (name, courses, payment option, seats, validity, admin "
        "roles), add courses to one or change its seats, validity and roles, and give a new one its admin. It always "
        "shows you the change first and makes it only after you confirm. Changes apply right away. It never deletes "
        "or deactivates a sub-organisation, never removes a course from one and never changes how its admin pays."
    ),
    "sub_org_enrollments": (
        "Let the connected AI app add learners — one, a list or a CSV — to a sub-organisation's courses. It always "
        "shows you a preview (who is added, who is already in and skipped, seats left) and adds them only after you "
        "confirm, never past the sub-organisation's seat cap. Adds learners only — never admins — and never removes "
        "anyone. It asks whether you want a CSV of the learners' usernames and passwords (a private download link "
        "that expires after 30 minutes, never shown in the chat)."
    ),
    "learner_profile_edits": (
        "Let the connected AI app change a learner's details — name, phone, password, address, parents and custom "
        "fields — after showing you the before and after and getting your confirmation. Changes apply right away. "
        "Email and username can never be changed from here."
    ),
    "crm_leads": (
        "Find leads by name, phone or email and see each lead's details, status, owner, follow-ups, calls and "
        "timeline, a counsellor's day plan, and the statuses, lists and counsellors the CRM uses. Each user sees "
        "only the leads they see on the dashboard; lists show phone numbers and emails masked, and a bulk export "
        "comes as a private download link."
    ),
    "crm_lead_activity": (
        "Let the connected AI app log calls, visits and notes on a lead and schedule, move or complete follow-ups — "
        "for example after a counsellor says \"spoke to her, call back Friday 5 pm\". Adds to the lead's history and "
        "never removes anything. Follow-ups can trigger your follow-up automations. Turned on separately."
    ),
    "crm_lead_edits": (
        "Let the connected AI app change leads' status, tier, details and tags, one lead or up to 500 at a time, and "
        "(admins) tag lead lists with state, course or channel for reports. It always shows you each change first "
        "and applies it only after you confirm. Status changes can trigger your automations. Turned on separately."
    ),
    "crm_team_edits": (
        "Let the connected AI app assign or reassign leads between counsellors (for example while someone is on "
        "leave) and pause or resume a counsellor's lead routing. For admins and managers; shows the moves first and "
        "applies them only after you confirm. Turned on separately."
    ),
    "crm_lead_intake": (
        "Let the connected AI app add new leads — a walk-in or a phone enquiry, or a short list of up to 100 — to "
        "one of your lead lists. It checks first whether the person already is a lead and adds only after you "
        "confirm. New leads can trigger your automations. Turned on separately."
    ),
    "crm_calls": (
        "See calls with leads — human and AI calls, their outcomes, transcripts and summaries — plus callbacks due, "
        "missed inbound calls, and the AI calling agents, queue and campaign runs."
    ),
    "crm_calling_outbound": (
        "Let the connected AI app call a lead for you (your phone rings first, then the lead's) or have an AI agent "
        "call one lead. Each call is shown to you first and placed only after you confirm; opted-out and do-not-call "
        "leads are refused, and calls can use telephony or AI credits. Turned on separately."
    ),
    "crm_ai_campaigns": (
        "Let the connected AI app start AI-calling campaigns for up to 500 leads at a time, and cancel a run or "
        "pause the AI call queue. Admins only. It shows you exactly who will be called (and who was left out, and "
        "why) and the estimated credits before you confirm. Turned on separately."
    ),
    "crm_meetings": (
        "See counselling meetings — yours, your team's or a lead's — free slots and the booking pages leads book "
        "through."
    ),
    "crm_meeting_edits": (
        "Let the connected AI app book a meeting with a lead (the lead receives the calendar invite, email and "
        "WhatsApp your booking page sends) and record how a meeting went. Bookings are shown to you first and made "
        "only after you confirm. Turned on separately."
    ),
    "crm_messages": (
        "See a lead's WhatsApp and email history, the WhatsApp inbox, your approved message templates, whether a "
        "lead can be messaged, and conversations escalated to staff."
    ),
    "crm_messaging_outbound": (
        "Let the connected AI app send one of your approved WhatsApp templates, or an email (one of your email "
        "templates or one written with you), to one lead at a time. Each message is shown to you first and sent only "
        "after you confirm; opted-out leads and unsubscribed addresses are refused and sends per hour are capped. "
        "Turned on separately."
    ),
    "crm_reports": (
        "See CRM reports — lead sources and campaigns, the funnel, counsellor performance and workload, calling and "
        "AI calling, follow-up ageing, SLA breaches, meetings and revenue — each figure with its date range and how "
        "it is counted — plus custom reports the AI app builds (your own breakdowns and metrics) and the live "
        "activity feed (what happened in the last hour or today). Each user sees the figures for the leads they "
        "can see."
    ),
    "crm_collections": (
        "See what a lead owes, who is overdue, what falls due soon, converted leads who have not paid and failed "
        "checkouts — for the people behind the leads each user can see. Admins also see money collected, by day, "
        "method, course and counsellor."
    ),
    "crm_payment_reminders": (
        "Let the connected AI app send fee reminders for unpaid installments or pending invoices — through your "
        "installment-due automations or the invoice reminder. Admins only; shown to you first and sent only after "
        "you confirm, at most 50 an hour. Turned on separately."
    ),
}

#: Settings-page areas, in display order. Each exposed tool group sits in one
#: area as its `view` or one of its `edit` capabilities, so the page can show
#: one row per area (Off / View / Edit) instead of one toggle per tool.
MCP_TOOL_AREAS: Dict[str, Dict[str, str]] = {
    "identity": {"label": "Who is connected", "summary": "Name, contact details and the institute's branding."},
    "institute": {"label": "Institute stats", "summary": "Profile, outstanding fees, live classes, learner counts."},
    "website": {"label": "Website", "summary": "Pages, sections, theme, SEO and site traffic."},
    "lead_forms": {"label": "Lead forms", "summary": "Lead campaigns, their form fields and leads received."},
    "automations": {"label": "Automations", "summary": "Workflows, their runs, and email / WhatsApp templates."},
    "blog": {"label": "Blog", "summary": "Blog posts and the pages that show them."},
    "courses": {"label": "Courses", "summary": "Course content, drip rules, invite links and pricing."},
    "learners": {"label": "Learners", "summary": "Find learners, enrol them into courses and edit their details."},
    "learner_reports": {"label": "Progress reports",
                        "summary": "A learner's attendance, scores, study time and progress, for the AI app to write "
                                   "their report."},
    "sub_orgs": {"label": "Sub-organisations",
                 "summary": "Partner organisations / centres: their courses, seats, admins and learners."},
    "crm_leads": {"label": "CRM: Leads",
                  "summary": "Find and work leads: details, follow-ups, status, owners and new enquiries."},
    "crm_calls": {"label": "CRM: Calls", "summary": "Calls, transcripts and callbacks; calling leads and AI campaigns."},
    "crm_meetings": {"label": "CRM: Meetings", "summary": "Counselling meetings, free slots and booking pages."},
    "crm_messages": {"label": "CRM: Messages", "summary": "Lead WhatsApp and email history, inbox and templates."},
    "crm_reports": {"label": "CRM: Reports",
                    "summary": "Sources, funnel, counsellors, calling, follow-ups, SLAs, custom reports, live activity."},
    "crm_payments": {"label": "CRM: Payments", "summary": "Dues, overdue fees, collections and fee reminders."},
}

#: group key → where it sits on the settings page.
#:   level: "view" | "edit"   (edit needs view — the page turns view on with it)
#:   risk:  what an edit can touch — "drafts" (nothing goes live), "additive"
#:          (only adds), "not_live" (only courses not live yet), "live_additive"
#:          (only adds, but to live records: new folders / pages start hidden or
#:          draft, while tags on live courses and courses added to an active
#:          store page show at once; the settings page never turns it on with
#:          the area's Edit level), "live"
#:          (changes what learners see straight away), "outbound" (contacts
#:          leads: calls, WhatsApp, meeting invites; always opt-in)
#:   sub_label: the edit's own name, shown when an area has several edits
MCP_TOOL_PLACEMENT: Dict[str, Dict[str, str]] = {
    "identity": {"area": "identity", "level": "view"},
    "institute_overview": {"area": "institute", "level": "view"},
    "website_builder": {"area": "website", "level": "view"},
    "website_builder_edits": {"area": "website", "level": "edit", "risk": "drafts", "sub_label": "Build and edit pages"},
    "design_import": {"area": "website", "level": "edit", "risk": "drafts", "sub_label": "Import Figma designs"},
    "website_data_edits": {"area": "website", "level": "edit", "risk": "live_additive",
                           "sub_label": "Set up folders, course tags and product pages"},
    "website_publish": {"area": "website", "level": "edit", "risk": "live", "sub_label": "Publish and roll back"},
    "audience_forms": {"area": "lead_forms", "level": "view"},
    "audience_forms_edits": {"area": "lead_forms", "level": "edit", "risk": "additive",
                             "sub_label": "Create campaigns and add fields"},
    "workflows": {"area": "automations", "level": "view"},
    "workflows_edits": {"area": "automations", "level": "edit", "risk": "drafts", "sub_label": "Draft automations"},
    "blog": {"area": "blog", "level": "view"},
    "blog_edits": {"area": "blog", "level": "edit", "risk": "drafts", "sub_label": "Draft posts"},
    "courses": {"area": "courses", "level": "view"},
    "course_edits": {"area": "courses", "level": "edit", "risk": "drafts", "sub_label": "Content (chapters, slides)"},
    "course_drip_edits": {"area": "courses", "level": "edit", "risk": "not_live", "sub_label": "Drip release rules"},
    "course_invite_edits": {"area": "courses", "level": "edit", "risk": "live",
                            "sub_label": "Invite links, pricing and enrolment forms"},
    "course_structure_edits": {"area": "courses", "level": "edit", "risk": "live",
                               "sub_label": "Structure and depth"},
    "learners": {"area": "learners", "level": "view"},
    "learner_enrollments": {"area": "learners", "level": "edit", "risk": "live", "sub_label": "Enrol into courses"},
    "learner_profile_edits": {"area": "learners", "level": "edit", "risk": "live", "sub_label": "Edit learner details"},
    "learner_reports": {"area": "learner_reports", "level": "view"},
    "sub_orgs": {"area": "sub_orgs", "level": "view"},
    "sub_org_edits": {"area": "sub_orgs", "level": "edit", "risk": "live",
                      "sub_label": "Create and change sub-organisations"},
    "sub_org_enrollments": {"area": "sub_orgs", "level": "edit", "risk": "live", "sub_label": "Add learners"},
    "crm_leads": {"area": "crm_leads", "level": "view"},
    "crm_lead_activity": {"area": "crm_leads", "level": "edit", "risk": "live_additive",
                          "sub_label": "Log activity and follow-ups"},
    "crm_lead_edits": {"area": "crm_leads", "level": "edit", "risk": "live",
                       "sub_label": "Edit status, tier, details and tags"},
    "crm_team_edits": {"area": "crm_leads", "level": "edit", "risk": "live", "sub_label": "Assign leads and routing"},
    "crm_lead_intake": {"area": "crm_leads", "level": "edit", "risk": "live", "sub_label": "Add leads"},
    "crm_calls": {"area": "crm_calls", "level": "view"},
    "crm_calling_outbound": {"area": "crm_calls", "level": "edit", "risk": "outbound", "sub_label": "Place calls"},
    "crm_ai_campaigns": {"area": "crm_calls", "level": "edit", "risk": "outbound", "sub_label": "AI-call campaigns"},
    "crm_meetings": {"area": "crm_meetings", "level": "view"},
    "crm_meeting_edits": {"area": "crm_meetings", "level": "edit", "risk": "outbound",
                          "sub_label": "Book meetings and log outcomes"},
    "crm_messages": {"area": "crm_messages", "level": "view"},
    "crm_messaging_outbound": {"area": "crm_messages", "level": "edit", "risk": "outbound",
                               "sub_label": "Send WhatsApp templates and emails"},
    "crm_reports": {"area": "crm_reports", "level": "view"},
    "crm_collections": {"area": "crm_payments", "level": "view"},
    "crm_payment_reminders": {"area": "crm_payments", "level": "edit", "risk": "outbound",
                              "sub_label": "Send fee reminders"},
}

#: Groups an admin turns on ONE BY ONE: the settings page never switches them
#: on with their area's Edit level or the "Turn everything on" preset (the
#: catalogue marks them ``opt_in``). Off for every existing institute. Every
#: CRM edit is opt-in, so the area's Edit level never turns on a write that
#: changes leads or contacts them.
MCP_OPT_IN_GROUPS = frozenset({"website_data_edits", "website_publish",
                               "learner_enrollments", "learner_profile_edits", "course_structure_edits",
                               "sub_org_edits", "sub_org_enrollments",
                               "crm_lead_activity", "crm_lead_edits", "crm_team_edits", "crm_lead_intake",
                               "crm_calling_outbound", "crm_ai_campaigns", "crm_meeting_edits",
                               "crm_messaging_outbound", "crm_payment_reminders"})

#: Roles that must NEVER reach this server, even if an admin lists them. The MCP
#: surface is staff-only by product decision.
LEARNER_ROLES = frozenset({"STUDENT", "LEARNER", "PARENT"})

#: Roles offered by default when an institute first enables the server.
DEFAULT_ALLOWED_ROLES = ("ADMIN",)

#: The single OAuth scope this resource server understands.
MCP_SCOPE_READ = "vacademy.read"

#: Name given to the OAuth client every institute gets automatically.
AUTO_CLIENT_NAME = "Vacademy"

#: Client ids of the auto-provisioned client start with this; manually created
#: ones use ``vcm-``. The prefix is how the primary client is told apart, so it
#: can be shown first and protected from deletion.
AUTO_CLIENT_ID_PREFIX = "vacademy-"


def is_auto_client(client_id: Any) -> bool:
    """True for the institute's auto-provisioned (primary) client id."""
    return isinstance(client_id, str) and client_id.startswith(AUTO_CLIENT_ID_PREFIX)


#: Callback URLs the auto-provisioned client accepts out of the box.
#:
#: Most AI apps never need this client at all — Claude, ChatGPT and Cursor all
#: register themselves via Dynamic Client Registration (RFC 7591) and bring their
#: own callback. This list exists for apps that ask an admin to paste a client id
#: instead, and it is pre-seeded with the callbacks of the apps we know so that
#: an admin does not have to hunt for a URL. Anything not covered can be added
#: from the settings page.
#:
#: OAuth 2.1 requires exact-match redirect validation, which is why these are
#: literal URLs and not patterns.
AUTO_CLIENT_REDIRECT_URIS = (
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://cursor.com/connector/callback",
)

#: Denial reasons surfaced to clients (and rendered by the consent page).
DENY_DISABLED = "mcp_disabled"
DENY_LEARNER = "learner_not_allowed"
DENY_ROLE = "role_not_allowed"

DENIAL_MESSAGES = {
    DENY_DISABLED: (
        "The MCP server is not enabled for this institute. An admin can turn it on "
        f"under MCP settings ({MCP_SETTINGS_PATH})."
    ),
    DENY_LEARNER: "The MCP server is available to institute staff only.",
    DENY_ROLE: (
        "This user's role is not allowed to connect to the MCP server. An admin can "
        f"grant the role under MCP settings ({MCP_SETTINGS_PATH})."
    ),
}


__all__ = [
    "MCP_SERVER_SETTING_KEY",
    "MCP_SETTINGS_PATH",
    "MCP_EXPOSED_TOOLS",
    "MCP_ALLOWED_WRITE_TOOLS",
    "MCP_TOOL_GROUP_LABELS",
    "MCP_TOOL_GROUP_SUMMARIES",
    "MCP_TOOL_AREAS",
    "MCP_TOOL_PLACEMENT",
    "MCP_OPT_IN_GROUPS",
    "LEARNER_ROLES",
    "DEFAULT_ALLOWED_ROLES",
    "MCP_SCOPE_READ",
    "AUTO_CLIENT_NAME",
    "AUTO_CLIENT_ID_PREFIX",
    "is_auto_client",
    "AUTO_CLIENT_REDIRECT_URIS",
    "DENY_DISABLED",
    "DENY_LEARNER",
    "DENY_ROLE",
    "DENIAL_MESSAGES",
]
