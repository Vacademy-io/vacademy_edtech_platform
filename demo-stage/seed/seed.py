#!/usr/bin/env python3
"""Seed a demo institute through the platform's HTTP APIs.

    python seed.py --base https://backend-stage.vacademy.io --data data/vacademy.json

prints the plan and touches nothing (no network at all). Add `--apply --institute <id>`
to execute. Read README.md first: backend-stage IS production.

Layout of this file:
  1. pure helpers  (dates, refs, state file, institute guard, payload lint)
  2. plan builders (dataset -> ordered list of Step; no network)
  3. executor      (the only part that talks to the network; needs --apply)
"""
import argparse
import base64
import datetime as dt
import json
import os
import random
import re
import secrets
import sys
import time
import uuid

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
STATE_DIR = os.path.expanduser("~/vacademy-private/demo-agent/seed-state")
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
PLACEHOLDER_INSTITUTE = "<institute-id>"

# name -> (on by default, what it writes, why it is on or off)
SECTIONS = [
    ("settings", True, "turns off the credentials email and the result email for this institute"),
    ("structure", True, "session, levels, courses, batches, catalogue flag, optional thumbnails"),
    ("content", True, "subjects, modules, chapters, slides (published with notify=false)"),
    ("fee_plans", True, "fee plans with instalments, linked to batches"),
    ("learners", True, "learners enrolled in batches (send_credentials=false, notify_learners=false)"),
    ("payments", True, "offline payments against fee plans (generate_invoice=false)"),
    ("team", False, "counsellor accounts. OFF: the invite endpoint always emails the invited address"),
    ("leads", True, "lead stages, lead lists, leads, stage changes, follow-ups, counsellor assignment"),
    ("ai_agents", True, "AI calling agents, configuration only"),
    ("assessments", True, "question papers and published assessments (all notify flags off)"),
    ("attempts", True, "attempts with marks through offline entry (blank email, result email off)"),
    ("live_classes", True, "live classes with a pasted link, no notification actions, attendance for past ones"),
    ("announcements", False, "in-app announcements. OFF: creating one delivers it to its recipients at once"),
]
SECTION_NAMES = [s[0] for s in SECTIONS]
DEFAULT_ON = {s[0] for s in SECTIONS if s[1]}

# Endpoints this script must never call, whatever the dataset says.
FORBIDDEN_PATH_PARTS = [
    "/test-call", "/provider/meeting", "/send-reminder", "/release-result", "/resend-invitation",
    "/notification/upcoming", "/notification/started", "/open/", "/signup", "/self-signup",
    "/lead/submit-with-enquiry", "/walk-in/", "/lead/submit/v2", "/live-sessions/v1/delete",
    "/add-institute_learner", "/learner/enroll", "/upload-csv", "/ai-call", "/workflow",
]
MUST_BE_FALSE = {"send_credentials", "notify_learners", "notify", "send_respondent_email", "generate_invoice",
                 "when_assessment_created", "when_assessment_live", "when_assessment_report_generated",
                 "when_student_appears", "when_student_finishes_test", "ai_evaluation_enabled", "dry_run"}
MUST_BE_EMPTY = {"added_notification_actions", "updated_notification_actions", "mediums", "to_notify",
                 "add_faculty_to_course", "sendRules", "handoffNumbers", "individual_user_ids"}
MUST_BE_ZERO = {"before_assessment_goes_live"}
EMAIL_KEYS = {"email", "user_email", "parents_email", "parents_to_mother_email"}
PHONE_KEYS = {"mobile_number", "parents_mobile_number", "parents_to_mother_mobile_number"}


class SeedError(Exception):
    """Stops the run. Printed as is."""


class SoftSkip(Exception):
    """A step that cannot run yet (something it needs has not been created). Not an error."""


# --------------------------------------------------------------------------------------
# 1. pure helpers
# --------------------------------------------------------------------------------------

def parse_today(text=None):
    if text:
        return dt.date.fromisoformat(text)
    return dt.datetime.now(IST).date()


def rel_date(spec, today):
    """{"days": -3} -> date."""
    return today + dt.timedelta(days=int(spec["days"]))


def rel_local(spec, today):
    """{"days": -3, "time": "17:00"} -> aware datetime in India time (midnight when no time)."""
    hh, mm = (spec.get("time") or "00:00").split(":")
    return dt.datetime.combine(rel_date(spec, today), dt.time(int(hh), int(mm)), tzinfo=IST)


def iso_date(spec, today):
    return rel_date(spec, today).isoformat()


def iso_utc(spec, today):
    """Real instant, as the admin frontend's Date.toISOString() sends it."""
    return rel_local(spec, today).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def iso_wall_z(spec, today):
    """India wall-clock time written with a Z. The live-class form sends this and the zone separately."""
    return rel_local(spec, today).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def iso_local(spec, today):
    return rel_local(spec, today).strftime("%Y-%m-%dT%H:%M:%S")


class Ref(object):
    """A value that only exists after an earlier step ran. Resolved from the state file."""
    _missing = object()

    def __init__(self, key, default=_missing):
        self.key = key
        self.default = default

    def __repr__(self):
        return "<ref:%s>" % self.key

    def __eq__(self, other):
        return isinstance(other, Ref) and other.key == self.key

    def __hash__(self):
        return hash(("Ref", self.key))


class MissingRef(SoftSkip):
    def __init__(self, key):
        SoftSkip.__init__(self, "needs %s, which has not been created yet" % key)
        self.key = key


PATH_REF = re.compile(r"\{ref:([^}]+)\}")


def resolve(obj, values):
    """Replace every Ref (and every {ref:key} inside a string path) with its stored value."""
    if isinstance(obj, Ref):
        if obj.key in values:
            return values[obj.key]
        if obj.default is not Ref._missing:
            return obj.default
        raise MissingRef(obj.key)
    if isinstance(obj, dict):
        return {k: resolve(v, values) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [resolve(v, values) for v in obj]
    return obj


def resolve_path(path, values):
    def sub(m):
        if m.group(1) not in values:
            raise MissingRef(m.group(1))
        return str(values[m.group(1)])
    return PATH_REF.sub(sub, path)


def printable(obj):
    """Same structure with refs shown as text, for the plan printout."""
    if isinstance(obj, Ref):
        return repr(obj)
    if isinstance(obj, dict):
        return {k: printable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [printable(v) for v in obj]
    return obj


class Step(object):
    def __init__(self, key, section, title, method="POST", path="", params=None, body=None,
                 store=None, handler=None, args=None, tag=None, always=False):
        self.key = key              # idempotency key in the state file
        self.section = section
        self.title = title
        self.method = method
        self.path = path
        self.params = params or {}
        self.body = body
        self.store = store          # None | "text" | "uuid" | "json:<field>"
        self.handler = handler      # name of an Executor method for steps that need more than one call
        self.args = args or {}
        self.tag = tag
        self.always = always        # read-only lookups run every time

    def line(self):
        return "[%s] %-58s %s %s" % (self.section, self.title[:58], self.method, self.path)


class State(object):
    """Created ids, kept on disk so a second run skips what exists."""

    def __init__(self, path, institute_id=None, base=None):
        self.path = path
        self.data = {"institute_id": institute_id, "base": base, "values": {}, "done": {}}
        if os.path.exists(path):
            with open(path) as fh:
                self.data = json.load(fh)
            self.data.setdefault("values", {})
            self.data.setdefault("done", {})

    @property
    def values(self):
        return self.data["values"]

    def bound_to(self, institute_id, base):
        """A state file belongs to one institute on one server."""
        problems = []
        if self.data.get("institute_id") not in (None, institute_id):
            problems.append("state file %s belongs to institute %s, not %s"
                            % (self.path, self.data.get("institute_id"), institute_id))
        if self.data.get("base") not in (None, base):
            problems.append("state file %s was written against %s, not %s" % (self.path, self.data.get("base"), base))
        return problems

    def is_done(self, key):
        return key in self.data["done"]

    def set(self, key, value):
        self.data["values"][key] = value

    def mark_done(self, key):
        self.data["done"][key] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def save(self):
        folder = os.path.dirname(self.path)
        if folder and not os.path.isdir(folder):
            os.makedirs(folder, 0o700)
        tmp = self.path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.data, fh, indent=1, sort_keys=True)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)


def state_path(product, institute_id, state_dir=STATE_DIR):
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", "%s-%s" % (product, institute_id))
    return os.path.join(state_dir, safe + ".json")


def jwt_claims(token):
    """Payload of a JWT, without checking the signature (the server does that)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except Exception:
        raise SeedError("the token is not a JWT this script can read")


def institute_guard(cli_institute_id, dataset_name, details, claims):
    """Reasons to refuse to write. Empty list = this is the institute the dataset was made for.

    details = body of GET /admin-core-service/institute/v1/details/{id}; claims = jwt_claims(token).
    """
    problems = []
    if not cli_institute_id or cli_institute_id == PLACEHOLDER_INSTITUTE:
        problems.append("--institute is required with --apply")
        return problems
    if not isinstance(details, dict):
        return ["the institute details response was not a JSON object"]
    got_id = details.get("id")
    if got_id != cli_institute_id:
        problems.append("server returned institute id %r, --institute is %r" % (got_id, cli_institute_id))
    got_name = (details.get("institute_name") or "").strip()
    if got_name != (dataset_name or "").strip() or not got_name:
        problems.append("institute %s is named %r on the server; the dataset is for %r"
                        % (cli_institute_id, got_name, dataset_name))
    authorities = (claims or {}).get("authorities")
    if not isinstance(authorities, dict) or cli_institute_id not in authorities:
        problems.append("the token has no role in institute %s" % cli_institute_id)
    return problems


def lint_steps(steps, dataset, institute_id):
    """Check every planned request against the no-side-effect rules. Returns a list of problems."""
    domain = "@" + dataset.get("email_domain", "example.com")
    phone_re = re.compile(dataset.get("phone_pattern", r"^9110\d{8}$"))
    problems = []

    def walk(step, node, trail):
        if isinstance(node, dict):
            for k, v in node.items():
                here = "%s.%s" % (trail, k)
                if k in MUST_BE_FALSE and v is not False:
                    problems.append("%s: %s must be false, is %r" % (step.key, here, v))
                if k in MUST_BE_EMPTY and v not in ([], "", None):
                    problems.append("%s: %s must be empty, is %r" % (step.key, here, v))
                if k in MUST_BE_ZERO and v != 0:
                    problems.append("%s: %s must be 0, is %r" % (step.key, here, v))
                if k in EMAIL_KEYS and isinstance(v, str) and v and step.section != "team" and not v.endswith(domain):
                    problems.append("%s: %s is %r, only %s addresses are allowed" % (step.key, here, v, domain))
                if k in PHONE_KEYS and isinstance(v, str) and v and not phone_re.match(v):
                    problems.append("%s: %s is %r, which does not match %s" % (step.key, here, v, phone_re.pattern))
                if k in ("institute_id", "instituteId") and v != institute_id:
                    problems.append("%s: %s is %r, not the target institute" % (step.key, here, v))
                walk(step, v, here)
        elif isinstance(node, (list, tuple)):
            for i, v in enumerate(node):
                walk(step, v, "%s[%d]" % (trail, i))

    seen = set()
    for step in steps:
        if step.key in seen:
            problems.append("%s: duplicate step key" % step.key)
        seen.add(step.key)
        if step.section not in SECTION_NAMES:
            problems.append("%s: unknown section %s" % (step.key, step.section))
        for part in FORBIDDEN_PATH_PARTS:
            if part in step.path:
                problems.append("%s: path %s contains forbidden %s" % (step.key, step.path, part))
        if step.section == "team" and "/user-invitation/invite" not in step.path:
            problems.append("%s: unexpected path in team section" % step.key)
        if step.section != "team" and "/user-invitation/" in step.path:
            problems.append("%s: invite endpoint outside the team section" % step.key)
        for name in ("instituteId", "institute_id"):
            if name in step.params and step.params[name] != institute_id:
                problems.append("%s: query %s is not the target institute" % (step.key, name))
        walk(step, step.body, "body")
        walk(step, step.args, "args")
    return problems


def select_sections(only, allowed, skip=()):
    """Which sections run. `only` picks one; off-by-default sections always need their --allow flag."""
    chosen = []
    for name, on, _ in SECTIONS:
        if only and name != only:
            continue
        if name in skip:
            continue
        if not on and name not in allowed:
            continue
        chosen.append(name)
    if only and only not in SECTION_NAMES:
        raise SeedError("unknown section %r; sections are: %s" % (only, ", ".join(SECTION_NAMES)))
    if only and not chosen:
        raise SeedError("section %r is off by default; pass --allow-%s as well (see README)"
                        % (only, only.replace("_", "-")))
    return chosen


def stable_uuid(institute_id, key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "vacademy-demo-seed/%s/%s" % (institute_id, key)))


def chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def attempt_answers(spec, learner_n, question_count):
    """Deterministic answer sheet: 'C' correct, 'W' wrong, '-' not attempted."""
    rnd = random.Random("%s/%s" % (spec["seed"], learner_n))
    lo, hi = spec["ability"]
    ability = lo + (hi - lo) * rnd.random()
    out = []
    for _ in range(question_count):
        r = rnd.random()
        out.append("C" if r < ability else ("-" if r > 0.93 else "W"))
    return "".join(out)


def attendance_marks(spec, learner_ns):
    rnd = random.Random("attendance/%s" % spec["seed"])
    return [[n, "PRESENT" if rnd.random() < spec["present_rate"] else "ABSENT"] for n in learner_ns]


# --------------------------------------------------------------------------------------
# 2. plan builders (pure: dataset -> steps)
# --------------------------------------------------------------------------------------

def batch_keys(ds):
    return ["%s/%s" % (c["key"], lv) for c in ds["courses"] for lv in c["levels"]]


def plan_settings(ds, inst, today):
    mk = lambda key, name, patch: Step(
        "setting/" + key, "settings", "Institute setting %s" % key, "GET+POST",
        "/admin-core-service/institute/setting/v1/save-setting", {"instituteId": inst, "settingKey": key},
        handler="merge_setting", args={"setting_key": key, "setting_name": name, "patch": patch})
    return [
        mk("LEARNER_ENROLLMENT_SETTING", "Learner Enrollment Setting", {"sendCredentials": False}),
        mk("ASSESSMENT_SETTING", "Assessment Setting",
           {"resultNotifications": {"version": 1, "roles": {"STUDENT": False, "LEARNER": False}}}),
    ]


def plan_structure(ds, inst, today):
    steps = []
    session = ds["session"]
    for c in ds["courses"]:
        if c.get("thumbnail_file"):
            steps.append(Step("media/" + c["key"], "structure", "Upload thumbnail for %s" % c["name"], "POST+PUT",
                              "/media-service/get-signed-url", handler="upload_media",
                              args={"file": c["thumbnail_file"], "course": c["key"]}))
        body = {
            "id": "", "new_course": True, "course_name": c["name"], "thumbnail_file_id": "",
            "contain_levels": True, "status": "ACTIVE",
            "sessions": [{
                "id": "", "session_name": session["name"], "status": "ACTIVE",
                "start_date": iso_date(session["start"], today), "new_session": True,
                "levels": [{"id": "", "new_level": True, "level_name": lv, "duration_in_days": 365,
                            "thumbnail_file_id": "", "package_id": ""} for lv in c["levels"]],
            }],
            "is_course_published_to_catalaouge": bool(c.get("catalogue")),
            "course_preview_image_media_id": Ref("media/" + c["key"], c.get("thumbnail_url", "")),
            "course_banner_media_id": "", "course_media_id": "",
            "why_learn_html": "<p>%s</p>" % c.get("why_learn", ""),
            "who_should_learn_html": "<p>%s</p>" % c.get("who_should_learn", ""),
            "about_the_course_html": "<p>%s</p>" % c.get("about", ""),
            "course_html_description": "<p>%s</p>" % c.get("about", ""),
            "tags": c.get("tags", []), "course_depth": 5, "add_faculty_to_course": [],
        }
        steps.append(Step("course/" + c["key"], "structure", "Course %s (%d batches)" % (c["name"], len(c["levels"])),
                          "POST", "/admin-core-service/course/v1/add-course/%s" % inst, body=body,
                          store="text", handler="ensure_course", args={"name": c["name"]}))
    steps.append(Step("batches", "structure", "Read back batch ids", "GET",
                      "/admin-core-service/institute/v1/details/%s" % inst, handler="resolve_batches", always=True))
    return steps


def plan_content(ds, inst, today):
    steps = []
    for block in ds.get("content", []):
        b = block["batch"]
        bref = Ref("batch/" + b)
        for si, subj in enumerate(block["subjects"], 1):
            skey = "subject/%s/%s" % (b, subj["name"])
            steps.append(Step(skey, "content", "Subject %s in %s" % (subj["name"], b), "POST",
                              "/admin-core-service/subject/v1/add-subject", {"commaSeparatedPackageSessionIds": bref},
                              {"subject_name": subj["name"], "subject_code": "", "credit": 0, "thumbnail_id": "",
                               "subject_order": si}, store="json:id"))
            for mod in subj["modules"]:
                mkey = "module/%s/%s/%s" % (b, subj["name"], mod["name"])
                steps.append(Step(mkey, "content", "Module %s" % mod["name"], "POST",
                                  "/admin-core-service/subject/v1/add-module",
                                  {"subjectId": Ref(skey), "packageSessionId": bref},
                                  {"module_name": mod["name"], "status": "ACTIVE", "description": "",
                                   "thumbnail_id": ""}, store="json:id"))
                for ci, ch in enumerate(mod["chapters"], 1):
                    ckey = "chapter/%s/%s/%s" % (b, subj["name"], ch["name"])
                    steps.append(Step(ckey, "content", "Chapter %s" % ch["name"], "POST",
                                      "/admin-core-service/chapter/v1/add-chapter",
                                      {"subjectId": Ref(skey), "moduleId": Ref(mkey),
                                       "commaSeparatedPackageSessionIds": bref},
                                      {"chapter_name": ch["name"], "status": "ACTIVE", "file_id": "",
                                       "description": "", "chapter_order": ci}, store="json:id"))
                    for li, sl in enumerate(ch["slides"], 1):
                        lkey = "slide/%s/%s/%s/%d" % (b, subj["name"], ch["name"], li)
                        sid = stable_uuid(inst, lkey)
                        inner = stable_uuid(inst, lkey + "/inner")
                        params = {"chapterId": Ref(ckey), "moduleId": Ref(mkey), "subjectId": Ref(skey),
                                  "packageSessionId": bref, "instituteId": inst}
                        if sl["type"] == "DOC":
                            body = {"id": sid, "title": sl["title"], "image_file_id": "", "description": "",
                                    "slide_order": li, "status": "PUBLISHED", "new_slide": True, "notify": False,
                                    "document_slide": {"id": inner, "type": "DOC", "data": sl["html"],
                                                       "title": sl["title"], "cover_file_id": "", "total_pages": 1,
                                                       "published_data": sl["html"],
                                                       "published_document_total_pages": 1}}
                            steps.append(Step(lkey, "content", "Document slide %s" % sl["title"], "POST",
                                              "/admin-core-service/slide/v1/add-update-document-slide", params, body))
                        else:
                            if "REPLACE_ME" in sl["url"]:
                                continue  # placeholder video: listed in the plan summary, never sent
                            body = {"id": sid, "title": sl["title"], "image_file_id": "", "description": "",
                                    "slide_order": li, "status": "PUBLISHED", "new_slide": True,
                                    "video_slide": {"id": inner, "title": sl["title"], "description": "",
                                                    "url": sl["url"], "video_length_in_millis": 0,
                                                    "published_url": sl["url"],
                                                    "published_video_length_in_millis": 0, "source_type": "VIDEO"}}
                            steps.append(Step(lkey, "content", "Video slide %s" % sl["title"], "POST",
                                              "/admin-core-service/slide/video-slide/add-or-update", params, body))
    return steps


def placeholder_videos(ds):
    return [sl["title"] for block in ds.get("content", []) for subj in block["subjects"] for mod in subj["modules"]
            for ch in mod["chapters"] for sl in ch["slides"] if sl["type"] == "VIDEO" and "REPLACE_ME" in sl["url"]]


def plan_fee_plans(ds, inst, today):
    steps = []
    for p in ds.get("fee_plans", []):
        fee_types = []
        for ft in p["fee_types"]:
            ins = [{"installment_number": i["number"], "amount": i["amount"],
                    "start_date": iso_date({"days": i["due"]["days"] - 15}, today),
                    "due_date": iso_date(i["due"], today), "end_date": iso_date(i["due"], today)}
                   for i in ft["installments"]]
            fee_types.append({"name": ft["name"], "code": ft["code"], "description": "", "status": "ACTIVE",
                              "assigned_fee_value": {"amount": ft["amount"], "original_amount": ft["amount"],
                                                     "no_of_installments": len(ins), "has_installment": True,
                                                     "is_refundable": False, "has_penalty": False,
                                                     "status": "ACTIVE", "installments": ins}})
        body = {"name": p["name"], "institute_id": inst, "require_approval": False, "schedule_mode": "FIXED",
                "fee_types": fee_types,
                "package_session_links": [{"package_session_id": Ref("batch/" + b)} for b in p["batches"]]}
        steps.append(Step("cpo/" + p["key"], "fee_plans", "Fee plan %s" % p["name"], "POST",
                          "/admin-core-service/v1/fee-management/cpo", body=body, store="json:id"))
    return steps


def plan_learners(ds, inst, today):
    steps = []
    fee_batches = {b: p["key"] for p in ds.get("fee_plans", []) for b in p["batches"]}
    by_batch = {}
    for l in ds["learners"]:
        by_batch.setdefault(l["batch"], []).append(l)
    for b in batch_keys(ds):
        for ci, group in enumerate(chunks(by_batch.get(b, []), 20), 1):
            users = [{"email": l["email"], "full_name": l["name"], "mobile_number": l["phone"],
                      "username": l["username"], "password": "<random at apply>",
                      "roles": ["STUDENT"], "gender": l["gender"], "date_of_birth": l["dob"],
                      "address_line": l.get("area", ""), "city": l.get("city", ""), "region": "Karnataka",
                      "fathers_name": l.get("father", ""), "parents_mobile_number": l.get("parent_phone", "")}
                     for l in group]
            body = {"institute_id": inst, "new_users": users,
                    "assignments": [{"package_session_id": Ref("batch/" + b)}],
                    "options": {"duplicate_handling": "SKIP", "notify_learners": False, "send_credentials": False,
                                "dry_run": False}}
            steps.append(Step("learners/%s/%d" % (b, ci), "learners", "Enrol %d learners in %s" % (len(group), b),
                              "POST", "/admin-core-service/v3/learner-management/assign", body=body,
                              handler="enroll",
                              args={"emails": {l["email"]: l["n"] for l in group},
                                    "needs": ["cpo/" + fee_batches[b]] if b in fee_batches else []}))
    return steps


def plan_payments(ds, inst, today):
    steps = []
    for l in ds["learners"]:
        for i, p in enumerate(l.get("payments", []), 1):
            day = iso_date(p["on"], today)
            body = {"amount": p["amount"], "payment_date": day, "reference": p["reference"], "currency": "INR",
                    "generate_invoice": False,
                    "payment_details": {"mode": p["mode"], "reference": p["reference"], "payment_date": day}}
            steps.append(Step("payment/%d/%d" % (l["n"], i), "payments",
                              "Offline payment Rs %s for %s on %s" % (p["amount"], l["name"], day), "GET+POST",
                              "/admin-core-service/v1/fee-management/user-plan/{user_plan}/record-offline-payment",
                              body=body, handler="record_payment", args={"learner": l["n"]}))
    return steps


def team_email(template, member):
    if member.get("email"):
        return member["email"]
    if not template:
        return None
    return template.replace("{key}", member["key"])


def plan_team(ds, inst, today, team_email_template=None):
    steps = []
    for m in ds.get("team", []):
        body = {"email": team_email(team_email_template, m) or "<set --team-email-template>",
                "full_name": m["name"], "roles": [m["role"]], "root_user": False, "mobile_number": m["phone"]}
        steps.append(Step("team/" + m["key"], "team", "Invite %s as %s (SENDS AN EMAIL)" % (m["name"], m["role"]),
                          "POST", "/auth-service/v1/user-invitation/invite", {"instituteId": inst}, body,
                          handler="invite_member", args={"role": m["role"]}))
    return steps


def plan_leads(ds, inst, today):
    steps = [Step("lead-statuses", "leads", "Lead stages: reuse the defaults, add the missing ones", "GET+POST",
                  "/admin-core-service/v1/lead-status", {"instituteId": inst}, handler="ensure_lead_statuses",
                  args={"statuses": ds["lead_statuses"]})]
    for c in ds["campaigns"]:
        body = {"institute_id": inst, "campaign_name": c["name"], "campaign_type": c["type"],
                "description": c["description"], "campaign_objective": c["objective"],
                "start_date_local": iso_local(c["start"], today), "end_date_local": iso_local(c["end"], today),
                "status": "ACTIVE", "json_web_metadata": "", "to_notify": "", "send_respondent_email": False,
                "created_by_user_id": Ref("me")}
        steps.append(Step("campaign/" + c["key"], "leads", "Lead list %s" % c["name"], "POST",
                          "/admin-core-service/v1/audience/campaign", body=body, store="text"))
    for l in ds["leads"]:
        body = {"audience_id": Ref("campaign/" + l["campaign"]), "source_type": l["source_type"],
                "source_id": l["source_id"],
                "user_dto": {"full_name": l["name"], "email": l["email"], "mobile_number": l["phone"]}}
        steps.append(Step("lead/%d" % l["n"], "leads", "Lead %s (%s)" % (l["name"], l["source_type"]), "POST",
                          "/admin-core-service/v1/audience/lead/submit", body=body, store="uuid", tag="lead-submit"))
    for l in ds["leads"]:
        if l["status"] != "LEAD":
            steps.append(Step("lead-stage/%d" % l["n"], "leads", "Stage %s -> %s" % (l["name"], l["status"]), "POST",
                              "/admin-core-service/v1/lead-status/lead/{ref:lead/%d}" % l["n"],
                              {"statusId": Ref("lead_status/" + l["status"]), "source": "MANUAL"}))
        fu = l.get("follow_up")
        if fu:
            body = {"audience_response_id": Ref("lead/%d" % l["n"]), "institute_id": inst,
                    "schedule_time": iso_utc(fu["at"], today), "content": fu["content"],
                    "follow_up_mode": fu["mode"], "interest_level": fu["interest_level"]}
            steps.append(Step("lead-followup/%d" % l["n"], "leads",
                              "Follow-up for %s at %s" % (l["name"], iso_local(fu["at"], today)), "POST",
                              "/admin-core-service/v1/lead-followup", body=body))
    by_owner = {}
    for l in ds["leads"]:
        by_owner.setdefault(l["counsellor"], []).append(l["n"])
    for owner in sorted(by_owner):
        for ci, group in enumerate(chunks(by_owner[owner], 25), 1):
            steps.append(Step("lead-assign/%s/%d" % (owner, ci), "leads",
                              "Assign %d leads to %s (only once the team section has run)" % (len(group), owner),
                              "GET+POST", "/admin-core-service/v1/counsellor-workbench/assign",
                              handler="assign_leads", args={"leads": group, "counsellor": owner}))
    return steps


def plan_ai_agents(ds, inst, today):
    steps = []
    for a in ds.get("ai_agents", []):
        body = {"instituteId": inst, "name": a["name"], "enabled": bool(a["enabled"]), "direction": a["direction"],
                "language": a["language"], "ttsModel": "rumik", "voice": "ira", "openingLine": a["openingLine"],
                "systemPrompt": a["systemPrompt"], "extractionQuestions": a.get("extractionQuestions", []),
                "dispositions": a.get("dispositions", []), "handoffNumbers": [], "sendRules": [],
                "maxCallMinutes": a.get("maxCallMinutes", 6), "speechCacheMode": "OFF"}
        steps.append(Step("agent/" + a["name"], "ai_agents", "AI agent %s (config only)" % a["name"], "GET+POST",
                          "/admin-core-service/v1/telephony/ai-agents", body=body, handler="ensure_agent",
                          args={"name": a["name"]}))
    return steps


MARKING = json.dumps({"type": "MCQS", "data": {"totalMark": 4, "negativeMark": 1, "negativeMarkingPercentage": 25}})


def rich(text):
    return {"id": None, "type": "HTML", "content": text}


def plan_assessments(ds, inst, today):
    steps = []
    for p in ds["question_papers"]:
        questions = [{
            "text": rich("<p>%s</p>" % q["text"]), "question_type": "MCQS",
            "auto_evaluation_json": json.dumps({"type": "MCQS", "data": {"correctOptionIds": [str(q["answer"])]}}),
            "explanation_text": rich(""), "default_question_time_mins": 2,
            "options": [{"preview_id": str(i), "text": rich("<p>%s</p>" % o), "explanation_text": rich("")}
                        for i, o in enumerate(q["options"])],
        } for q in p["questions"]]
        steps.append(Step("paper/" + p["key"], "assessments", "Question paper %s" % p["title"], "POST",
                          "/assessment-service/question-paper/manage/v1/add",
                          body={"title": p["title"], "institute_id": inst, "level_id": None, "subject_id": None,
                                "tags": [], "questions": questions}, store="json:saved_question_paper_id"))
        steps.append(Step("paperq/" + p["key"], "assessments", "Read back question ids of %s" % p["title"], "GET",
                          "/assessment-service/question-paper/view/v1/get-by-id",
                          {"questionPaperId": Ref("paper/" + p["key"])}, handler="resolve_paper",
                          args={"paper": p["key"], "count": len(p["questions"])}))
    quiet = {"when_assessment_created": False, "show_leaderboard": False, "before_assessment_goes_live": 0,
             "when_assessment_live": False, "when_assessment_report_generated": False}
    quiet_parent = dict(quiet, when_student_appears=False, when_student_finishes_test=False)
    for a in ds["assessments"]:
        akey = "assessment/" + a["key"]
        common = {"instituteId": inst, "type": "EXAM"}
        with_id = dict(common, assessmentId=Ref(akey))
        steps.append(Step(akey, "assessments", "Assessment %s" % a["name"], "POST",
                          "/assessment-service/assessment/basic/create/v1/submit", common,
                          {"assessment_type": "ASSESSMENT",
                           "test_creation": {"assessment_name": a["name"], "subject_id": "",
                                             "assessment_instructions_html": "<p>%s</p>" % a["instructions"]},
                           "test_boundation": {"start_date": iso_utc(a["start"], today),
                                               "end_date": iso_utc(a["end"], today)},
                           "assessment_preview_time": 0, "switch_sections": False, "submission_type": "",
                           "evaluation_type": "AUTO", "result_type": a["result_type"],
                           "default_reattempt_count": 0, "raise_reattempt_request": False,
                           "raise_time_increase_request": False, "has_omr_mode": False,
                           "ai_evaluation_enabled": False}, store="json:assessment_id"))
        steps.append(Step(akey + "/questions", "assessments", "  questions of %s" % a["name"], "POST",
                          "/assessment-service/assessment/add-questions/create/v1/submit", with_id,
                          handler="assessment_questions",
                          args={"paper": a["paper"], "duration_min": a["duration_min"]}))
        steps.append(Step(akey + "/participants", "assessments", "  batches of %s" % a["name"], "POST",
                          "/assessment-service/assessment/add-participants/create/v1/submit", with_id,
                          {"closed_test": True, "open_test_details": None,
                           "added_pre_register_batches_details": [Ref("batch/" + b) for b in a["batches"]],
                           "deleted_pre_register_batches_details": [],
                           "added_pre_register_students_details": [],
                           "deleted_pre_register_students_details": [], "updated_join_link": "",
                           "notify_student": dict(quiet), "notify_parent": dict(quiet_parent)}))
        steps.append(Step(akey + "/publish", "assessments", "  publish %s" % a["name"], "POST",
                          "/assessment-service/assessment/publish/v1/", with_id, {}))
    return steps


def plan_attempts(ds, inst, today):
    with_attempts = [a for a in ds["assessments"] if a.get("attempts")]
    if not with_attempts:
        return []
    steps = [Step("attempts/muted-check", "attempts", "Confirm the result email is off for learners", "GET",
                  "/admin-core-service/institute/setting/v1/all", {"instituteId": inst},
                  handler="check_results_muted", always=True)]
    papers = {p["key"]: p for p in ds["question_papers"]}
    by_batch = {}
    for l in ds["learners"]:
        by_batch.setdefault(l["batch"], []).append(l)
    for a in with_attempts:
        spec = a["attempts"]
        akey = "assessment/" + a["key"]
        steps.append(Step(akey + "/section", "attempts", "Read back section id of %s" % a["name"], "GET",
                          "/assessment-service/assessment/create/v1/status",
                          {"assessmentId": Ref(akey), "instituteId": inst, "type": "EXAM"},
                          handler="resolve_section", args={"assessment": a["key"]}))
        sitters = by_batch.get(spec["batch"], [])[:spec["count"]]
        for l in sitters:
            answers = attempt_answers(spec, l["n"], len(papers[a["paper"]]["questions"]))
            steps.append(Step("attempt/%s/%d" % (a["key"], l["n"]), "attempts",
                              "Attempt by %s: %s" % (l["name"], answers), "POST",
                              "/assessment-service/assessment/offline-entry/create-and-submit",
                              {"assessmentId": Ref(akey), "instituteId": inst}, handler="offline_attempt",
                              args={"assessment": a["key"], "paper": a["paper"], "learner": l["n"],
                                    "full_name": l["name"], "username": l["username"], "batch": spec["batch"],
                                    "answers": answers}))
    return steps


def plan_live_classes(ds, inst, today):
    steps = []
    by_batch = {}
    for l in ds["learners"]:
        by_batch.setdefault(l["batch"], []).append(l["n"])
    for c in ds.get("live_classes", []):
        lkey = "live/" + c["key"]
        steps.append(Step(lkey, "live_classes", "Live class %s at %s" % (c["title"], iso_local(c["start"], today)),
                          "POST", "/admin-core-service/live-sessions/v1/create/step1",
                          body={"session_id": "", "institute_id": inst, "title": c["title"], "subject": c["subject"],
                                "description_html": "<p>%s</p>" % c["description"], "default_meet_link": c["link"],
                                "start_time": iso_wall_z(c["start"], today),
                                "last_entry_time": iso_wall_z(c["end"], today),
                                "session_end_date": iso_date(c["end"], today), "recurrence_type": "NONE",
                                "link_type": c["link_type"], "time_zone": ds["institute"]["timezone"],
                                "show_to_learners": True, "source": "DEMO_SEED", "source_id": c["key"],
                                "added_schedules": [], "updated_schedules": [], "deleted_schedule_ids": []},
                          store="json:id"))
        steps.append(Step(lkey + "/audience", "live_classes", "  batches of %s" % c["title"], "POST",
                          "/admin-core-service/live-sessions/v1/create/step2",
                          body={"session_id": Ref(lkey), "access_type": "PRIVATE",
                                "package_session_ids": [Ref("batch/" + b) for b in c["batches"]],
                                "deleted_package_session_ids": [], "individual_user_ids": [],
                                "added_notification_actions": [], "updated_notification_actions": [],
                                "deleted_notification_action_ids": [], "added_fields": [], "updated_fields": [],
                                "deleted_field_ids": []}))
        if c.get("attendance"):
            ns = [n for b in c["batches"] for n in by_batch.get(b, [])]
            steps.append(Step(lkey + "/attendance", "live_classes",
                              "  attendance of %d learners for %s" % (len(ns), c["title"]), "GET+POST",
                              "/admin-core-service/live-session/admin-mark-attendance", handler="mark_attendance",
                              args={"live": c["key"], "marks": attendance_marks(c["attendance"], ns)}))
    return steps


def plan_announcements(ds, inst, today):
    steps = []
    for a in ds.get("announcements", []):
        body = {"title": a["title"], "content": {"type": "html", "content": a["html"]}, "instituteId": inst,
                "createdBy": Ref("me"),
                "recipients": [{"recipientType": "PACKAGE_SESSION", "recipientId": Ref("batch/" + b),
                                "recipientName": b} for b in a["batches"]],
                "modes": [{"modeType": a["mode"], "settings": {}}], "mediums": []}
        steps.append(Step("announcement/" + a["key"], "announcements",
                          "Announcement %s (in-app, DELIVERED AT ONCE to the batch)" % a["title"], "POST",
                          "/notification-service/v1/announcements", body=body))
    return steps


PLANNERS = {
    "settings": plan_settings, "structure": plan_structure, "content": plan_content, "fee_plans": plan_fee_plans,
    "learners": plan_learners, "payments": plan_payments, "team": plan_team, "leads": plan_leads,
    "ai_agents": plan_ai_agents, "assessments": plan_assessments, "attempts": plan_attempts,
    "live_classes": plan_live_classes, "announcements": plan_announcements,
}


def build_plan(ds, institute_id, today, sections, team_email_template=None):
    steps = []
    for name in SECTION_NAMES:
        if name not in sections:
            continue
        if name == "team":
            steps.extend(plan_team(ds, institute_id, today, team_email_template))
        else:
            steps.extend(PLANNERS[name](ds, institute_id, today))
    return steps


def validate_dataset(ds):
    problems = []
    bk = set(batch_keys(ds))
    domain = "@" + ds.get("email_domain", "example.com")
    phone_re = re.compile(ds.get("phone_pattern", r"^9110\d{8}$"))

    def need_batch(where, b):
        if b not in bk:
            problems.append("%s: unknown batch %r" % (where, b))

    for who in ("learners", "leads"):
        seen_mail, seen_n = set(), set()
        for p in ds[who]:
            if not p["email"].endswith(domain):
                problems.append("%s %s: email outside %s" % (who, p["n"], domain))
            if not phone_re.match(p["phone"]):
                problems.append("%s %s: phone %s does not match %s" % (who, p["n"], p["phone"], phone_re.pattern))
            if p["email"] in seen_mail or p["n"] in seen_n:
                problems.append("%s %s: duplicate email or number" % (who, p["n"]))
            seen_mail.add(p["email"])
            seen_n.add(p["n"])
    for l in ds["learners"]:
        need_batch("learner %s" % l["n"], l["batch"])
    for block in ds.get("content", []):
        need_batch("content", block["batch"])
    for p in ds.get("fee_plans", []):
        for b in p["batches"]:
            need_batch("fee plan %s" % p["key"], b)
        for ft in p["fee_types"]:
            if sum(i["amount"] for i in ft["installments"]) != ft["amount"]:
                problems.append("fee plan %s / %s: instalments do not add up to the amount" % (p["key"], ft["name"]))
    stage_keys = {s["key"] for s in ds["lead_statuses"]}
    camp_keys = {c["key"] for c in ds["campaigns"]}
    team_keys = {m["key"] for m in ds.get("team", [])}
    for l in ds["leads"]:
        if l["status"] not in stage_keys:
            problems.append("lead %s: unknown stage %s" % (l["n"], l["status"]))
        if l["campaign"] not in camp_keys:
            problems.append("lead %s: unknown list %s" % (l["n"], l["campaign"]))
        if l["counsellor"] not in team_keys:
            problems.append("lead %s: unknown counsellor %s" % (l["n"], l["counsellor"]))
    papers = {p["key"]: p for p in ds["question_papers"]}
    for p in ds["question_papers"]:
        for i, q in enumerate(p["questions"], 1):
            if not 0 <= q["answer"] < len(q["options"]):
                problems.append("paper %s question %d: answer index out of range" % (p["key"], i))
    for a in ds["assessments"]:
        if a["paper"] not in papers:
            problems.append("assessment %s: unknown paper %s" % (a["key"], a["paper"]))
        for b in a["batches"]:
            need_batch("assessment %s" % a["key"], b)
        if a.get("attempts") and a["result_type"] != "NO_AUTO_RELEASE":
            problems.append("assessment %s: attempts are only seeded with result_type NO_AUTO_RELEASE" % a["key"])
    for c in ds.get("live_classes", []):
        for b in c["batches"]:
            need_batch("live class %s" % c["key"], b)
    for a in ds.get("announcements", []):
        for b in a["batches"]:
            need_batch("announcement %s" % a["key"], b)
    return problems


def print_plan(steps, ds, sections, state, show_bodies, out=None):
    w = (out or sys.stdout).write
    w("Dataset: %s (%s)\n" % (ds["institute"]["name"], ds["product"]))
    w("Sections:\n")
    counts = {}
    for s in steps:
        counts[s.section] = counts.get(s.section, 0) + 1
    for name, on, what in SECTIONS:
        mark = "RUN " if name in sections else ("off " if not on else "skip")
        w("  %s %-14s %4d steps  %s\n" % (mark, name, counts.get(name, 0), what))
    w("\n")
    for s in steps:
        done = " (done, will skip)" if state is not None and state.is_done(s.key) and not s.always else ""
        w(s.line() + done + "\n")
        if show_bodies:
            if s.params:
                w("      query: %s\n" % json.dumps(printable(s.params), ensure_ascii=False))
            if s.body is not None:
                w("      body:  %s\n" % json.dumps(printable(s.body), ensure_ascii=False))
            if s.args:
                w("      args:  %s\n" % json.dumps(printable(s.args), ensure_ascii=False))
    videos = placeholder_videos(ds)
    if videos and "content" in sections:
        w("\nNot sent: %d video slides still have a REPLACE_ME link in the dataset.\n" % len(videos))
    w("\n%d steps. Nothing was sent. Add --apply --institute <id> to execute.\n" % len(steps))


# --------------------------------------------------------------------------------------
# 3. executor (network; only reached with --apply)
# --------------------------------------------------------------------------------------

def find_objects(node, pred, out=None):
    """Every dict anywhere in a JSON tree for which pred(dict) is true."""
    out = [] if out is None else out
    if isinstance(node, dict):
        if pred(node):
            out.append(node)
        for v in node.values():
            find_objects(v, pred, out)
    elif isinstance(node, list):
        for v in node:
            find_objects(v, pred, out)
    return out


def pick(d, *names):
    for n in names:
        if isinstance(d, dict) and d.get(n) not in (None, ""):
            return d[n]
    return None


def deep_merge(base, patch):
    out = dict(base or {})
    for k, v in patch.items():
        out[k] = deep_merge(out.get(k), v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


class Executor(object):
    def __init__(self, base, institute_id, token, state, ds, data_dir, delay=0.2, limit=None, log=print):
        import requests  # imported here so the pure parts work without it
        self.http = requests.Session()
        self.base = base.rstrip("/")
        self.inst = institute_id
        self.token = token
        self.state = state
        self.ds = ds
        self.data_dir = data_dir
        self.delay = delay
        self.limit = limit
        self.log = log
        self.claims = jwt_claims(token)
        self.sent_tagged = {}

    # ---- transport -----------------------------------------------------------------
    def call(self, method, path, params=None, body=None, ok=(200, 201)):
        if method != "GET" and any(part in path for part in FORBIDDEN_PATH_PARTS):
            raise SeedError("refusing to call %s" % path)
        url = self.base + path
        headers = {"Authorization": "Bearer " + self.token, "clientId": self.inst, "Accept": "application/json"}
        resp = self.http.request(method, url, params=params, json=body, headers=headers, timeout=90)
        if resp.status_code not in ok:
            raise SeedError("unexpected response from %s %s\n  HTTP %s\n  %s"
                            % (method, path, resp.status_code, resp.text[:3000]))
        if method != "GET":
            time.sleep(self.delay)
        return resp

    def json_of(self, resp, path):
        try:
            return resp.json()
        except ValueError:
            raise SeedError("expected JSON from %s, got:\n  %s" % (path, resp.text[:3000]))

    # ---- preflight -----------------------------------------------------------------
    def preflight(self):
        details = self.json_of(self.call("GET", "/admin-core-service/institute/v1/details/%s" % self.inst), "details")
        problems = institute_guard(self.inst, self.ds["institute"]["name"], details, self.claims)
        if problems:
            raise SeedError("refusing to write:\n  - " + "\n  - ".join(problems))
        self.state.data["institute_id"] = self.inst
        self.state.data["institute_name"] = details.get("institute_name")
        self.state.data["base"] = self.base
        self.state.set("me", self.claims.get("user"))
        if not self.state.values.get("me"):
            raise SeedError("the token carries no user id")
        # Workflows are how almost every outbound message gets attached to a write. None may exist.
        resp = self.call("GET", "/admin-core-service/v1/workflow/institute/%s" % self.inst)
        flows = self.json_of(resp, "workflow list")
        if isinstance(flows, dict) and "content" in flows:
            flows = flows["content"]
        if not isinstance(flows, list):
            raise SeedError("could not read the workflow list:\n  %s" % resp.text[:2000])
        if flows:
            raise SeedError("institute has %d workflow(s). Seeding would trigger them; remove them first." % len(flows))
        self.state.save()
        self.log("Guard passed: %s is %r and has no workflows." % (self.inst, details.get("institute_name")))

    # ---- run -----------------------------------------------------------------------
    def run(self, steps):
        done = skipped = waiting = 0
        for step in steps:
            if self.state.is_done(step.key) and not step.always:
                skipped += 1
                continue
            if step.tag and self.limit is not None and self.sent_tagged.get(step.tag, 0) >= self.limit:
                waiting += 1
                continue
            try:
                self.execute(step)
            except SoftSkip as e:
                waiting += 1
                self.log("  wait  %s: %s" % (step.key, e))
                continue
            except SeedError:
                self.state.save()
                self.log("STOPPED at step %s (%s)" % (step.key, step.title))
                raise
            if step.tag:
                self.sent_tagged[step.tag] = self.sent_tagged.get(step.tag, 0) + 1
            if not step.always:
                self.state.mark_done(step.key)
            self.state.save()
            done += 1
            self.log("  ok    %s" % step.line())
        self.log("%d done, %d already existed, %d waiting for something else." % (done, skipped, waiting))
        return done, skipped, waiting

    def execute(self, step):
        if step.handler:
            return getattr(self, "h_" + step.handler)(step)
        return self.plain(step)

    def plain(self, step):
        v = self.state.values
        resp = self.call(step.method, resolve_path(step.path, v), resolve(step.params, v), resolve(step.body, v))
        self.store(step, resp)

    def store(self, step, resp):
        if not step.store:
            return
        text = resp.text.strip().strip('"')
        if step.store == "text":
            if not text or len(text) > 80:
                raise SeedError("expected an id from %s, got:\n  %s" % (step.path, resp.text[:2000]))
            self.state.set(step.key, text)
        elif step.store == "uuid":
            if not UUID_RE.match(text):
                raise SeedError("expected a UUID from %s, got:\n  %s" % (step.path, resp.text[:2000]))
            self.state.set(step.key, text)
        elif step.store.startswith("json:"):
            value = pick(self.json_of(resp, step.path), step.store[5:])
            if not value:
                raise SeedError("no %r in the response of %s:\n  %s" % (step.store[5:], step.path, resp.text[:2000]))
            self.state.set(step.key, value)

    def need(self, key):
        if key not in self.state.values:
            raise MissingRef(key)
        return self.state.values[key]

    def all_settings(self):
        data = self.json_of(self.call("GET", "/admin-core-service/institute/setting/v1/all",
                                      {"instituteId": self.inst}), "settings")
        return (data or {}).get("setting") or {}

    # ---- handlers ------------------------------------------------------------------
    def h_merge_setting(self, step):
        key = step.args["setting_key"]
        current = (self.all_settings().get(key) or {}).get("data") or {}
        merged = deep_merge(current, step.args["patch"])
        self.call("POST", step.path, step.params, {"setting_name": step.args["setting_name"], "setting_data": merged})
        after = (self.all_settings().get(key) or {}).get("data") or {}
        if deep_merge(after, step.args["patch"]) != after:
            raise SeedError("setting %s did not keep the values just saved; it now reads:\n  %s"
                            % (key, json.dumps(after)[:2000]))

    def h_upload_media(self, step):
        path = os.path.join(self.data_dir, step.args["file"])
        if not os.path.isfile(path):
            self.log("  note  no file %s; the course is created without a thumbnail" % step.args["file"])
            return
        ext = os.path.splitext(path)[1].lower()
        ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(ext)
        if not ctype:
            raise SeedError("thumbnail %s must be png, jpg or webp" % path)
        signed = self.json_of(self.call("POST", "/media-service/get-signed-url", body={
            "file_name": os.path.basename(path), "file_type": ctype, "source": self.inst, "source_id": "COURSES"}),
            "get-signed-url")
        if not signed.get("id") or not signed.get("url"):
            raise SeedError("get-signed-url returned no id/url: %s" % signed)
        with open(path, "rb") as fh:
            put = self.http.put(signed["url"], data=fh.read(), headers={"Content-Type": ctype}, timeout=120)
        if put.status_code not in (200, 201, 204):
            raise SeedError("file upload failed: HTTP %s %s" % (put.status_code, put.text[:500]))
        self.call("POST", "/media-service/acknowledge", body={"file_id": signed["id"], "user_id": self.need("me")})
        self.state.set(step.key, signed["id"])

    def details(self):
        return self.json_of(self.call("GET", "/admin-core-service/institute/v1/details/%s" % self.inst), "details")

    def h_ensure_course(self, step):
        for b in self.details().get("batches_for_sessions") or []:
            pkg = b.get("package_dto") or {}
            if pkg.get("package_name") == step.args["name"]:
                self.state.set(step.key, pkg.get("id"))
                self.log("  note  course %r already exists; reusing it" % step.args["name"])
                return
        self.plain(step)

    def h_resolve_batches(self, step):
        session = self.ds["session"]["name"]
        found = {}
        for b in self.details().get("batches_for_sessions") or []:
            pkg, lvl, ses = b.get("package_dto") or {}, b.get("level") or {}, b.get("session") or {}
            if ses.get("session_name") == session:
                found.setdefault((pkg.get("package_name"), lvl.get("level_name")), []).append(b.get("id"))
        for c in self.ds["courses"]:
            if "course/" + c["key"] not in self.state.values:
                continue
            for lv in c["levels"]:
                ids = found.get((c["name"], lv), [])
                if len(ids) != 1:
                    raise SeedError("expected one batch for %s / %s / %s, found %d"
                                    % (c["name"], lv, session, len(ids)))
                self.state.set("batch/%s/%s" % (c["key"], lv), ids[0])

    def h_enroll(self, step):
        for key in step.args["needs"]:
            self.need(key)  # a batch with a fee plan must not be filled before the plan is linked
        body = resolve(step.body, self.state.values)
        for u in body["new_users"]:
            u["password"] = secrets.token_urlsafe(12)  # never stored: nobody signs in as a seeded learner
        resp = self.call("POST", step.path, body=body)
        data = self.json_of(resp, step.path)
        summary = data.get("summary") or {}
        if summary.get("failed"):
            raise SeedError("enrolment reported failures:\n  %s" % resp.text[:3000])
        by_email = {}
        for r in data.get("results") or []:
            mail, uid = pick(r, "user_email", "email"), pick(r, "user_id")
            if mail and uid:
                by_email[mail.lower()] = uid
        missing = [m for m in step.args["emails"] if m.lower() not in by_email]
        if missing:
            raise SeedError("enrolment response did not name these learners: %s\n  %s"
                            % (", ".join(missing[:5]), resp.text[:3000]))
        for mail, n in step.args["emails"].items():
            self.state.set("learner/%s" % n, by_email[mail.lower()])

    def h_record_payment(self, step):
        n = step.args["learner"]
        user_id = self.need("learner/%s" % n)
        plan_key = "user_plan/%s" % n
        if plan_key not in self.state.values:
            path = "/admin-core-service/v1/fee-management/user/%s/cpo-user-plans" % user_id
            plans = self.json_of(self.call("GET", path), path)
            # Accounts are matched by email across the whole platform, so a learner can
            # hold plans in another institute too. Keep only this institute's fee plans.
            ours = {v for k, v in self.state.values.items() if k.startswith("cpo/")}
            ids = [pick(p, "user_plan_id", "id") for p in find_objects(
                plans, lambda d: "user_plan_id" in d or ("id" in d and "cpo_id" in d))
                if p.get("cpo_id") in ours]
            ids = [i for i in ids if i]
            if len(set(ids)) != 1:
                raise SeedError("expected one fee plan for learner %s, got: %s" % (n, json.dumps(plans)[:2000]))
            self.state.set(plan_key, ids[0])
        path = step.path.replace("{user_plan}", self.state.values[plan_key])
        self.call("POST", path, body=step.body)

    def h_invite_member(self, step):
        body = dict(step.body)
        if body["email"].startswith("<") or "@" not in body["email"]:
            raise SeedError("team needs --team-email-template (a mailbox you own, e.g. you+{key}@yourdomain)")
        if body["email"].endswith("@" + self.ds.get("email_domain", "example.com")):
            raise SeedError("the invite endpoint always sends mail; do not use the reserved domain for the team")
        self.call("POST", step.path, step.params, body)
        path = "/auth-service/v1/user-roles/users-of-status"
        found = self.json_of(self.call("POST", path, {"instituteId": self.inst, "pageNumber": 0, "pageSize": 200},
                                       {"roles": [step.args["role"]], "status": ["ACTIVE", "INVITED"]}), path)
        hits = find_objects(found, lambda d: (d.get("email") or "").lower() == body["email"].lower() and d.get("id"))
        if not hits:
            raise SeedError("invited %s but could not find the account: %s" % (body["email"], json.dumps(found)[:2000]))
        self.state.set(step.key, hits[0]["id"])

    def h_ensure_lead_statuses(self, step):
        existing = self.json_of(self.call("GET", step.path, step.params), step.path)
        have = {pick(s, "status_key"): pick(s, "id") for s in find_objects(existing, lambda d: "status_key" in d)}
        for s in step.args["statuses"]:
            if s["key"] not in have:
                made = self.json_of(self.call("POST", step.path, step.params, {
                    "status_key": s["key"], "label": s["label"], "color": s["color"],
                    "display_order": s["order"], "is_default": False, "show_in_filter": True}), step.path)
                have[s["key"]] = pick(made, "id")
            if not have[s["key"]]:
                raise SeedError("no id for lead stage %s" % s["key"])
            self.state.set("lead_status/" + s["key"], have[s["key"]])

    def h_assign_leads(self, step):
        target = self.need("team/" + step.args["counsellor"])
        user_ids = []
        for n in step.args["leads"]:
            response_id = self.need("lead/%d" % n)
            key = "lead-user/%d" % n
            if key not in self.state.values:
                path = "/admin-core-service/v1/audience/lead/%s" % response_id
                uid = pick(self.json_of(self.call("GET", path), path), "user_id", "userId")
                if not uid:
                    raise SeedError("lead %s has no user id" % response_id)
                self.state.set(key, uid)
            user_ids.append(self.state.values[key])
        self.call("POST", step.path, body={"institute_id": self.inst, "user_ids": user_ids, "mode": "SINGLE",
                                           "target_user_id": target})

    def h_ensure_agent(self, step):
        listed = self.json_of(self.call("GET", step.path, {"instituteId": self.inst}), step.path)
        for a in listed if isinstance(listed, list) else []:
            if a.get("name") == step.args["name"]:
                self.state.set(step.key, a.get("id"))
                return
        made = self.json_of(self.call("POST", step.path, body=step.body), step.path)
        self.state.set(step.key, pick(made, "id"))

    def h_resolve_paper(self, step):
        v = self.state.values
        data = self.json_of(self.call("GET", step.path, resolve(step.params, v)), step.path)
        questions = []
        for q in pick(data, "question_dtolist") or pick(data, "question_dto_list") or []:
            option_ids = [o.get("id") for o in q.get("options") or []]
            try:
                correct = json.loads(q.get("auto_evaluation_json") or "{}")["data"]["correctOptionIds"]
            except (ValueError, KeyError, TypeError):
                correct = []
            correct = [c for c in correct if c in option_ids]
            if not q.get("id") or len(option_ids) < 2 or len(correct) != 1:
                raise SeedError("question paper came back without usable ids:\n  %s" % json.dumps(q)[:2000])
            questions.append({"id": q["id"], "options": option_ids, "correct": correct[0]})
        if len(questions) != step.args["count"]:
            raise SeedError("paper %s has %d questions on the server, expected %d"
                            % (step.args["paper"], len(questions), step.args["count"]))
        self.state.set(step.key, questions)

    def h_assessment_questions(self, step):
        questions = self.need("paperq/" + step.args["paper"])
        body = {"added_sections": [{
            "section_name": "Section A", "section_description_html": "", "section_id": None,
            "section_duration": None, "section_order": 1, "total_marks": 4 * len(questions), "cutoff_marks": 0,
            "problem_randomization": False,
            "question_and_marking": [{"question_id": q["id"], "marking_json": MARKING, "question_duration_in_min": 0,
                                      "question_order": i, "is_added": True, "is_deleted": False,
                                      "is_updated": False} for i, q in enumerate(questions, 1)]}],
            "updated_sections": [], "deleted_sections": [],
            "test_duration": {"entire_test_duration": step.args["duration_min"],
                              "distribution_duration": "ASSESSMENT"}}
        self.call("POST", step.path, resolve(step.params, self.state.values), body)

    def h_check_results_muted(self, step):
        roles = (((self.all_settings().get("ASSESSMENT_SETTING") or {}).get("data") or {})
                 .get("resultNotifications") or {}).get("roles") or {}
        if roles.get("STUDENT") is not False or roles.get("LEARNER") is not False:
            raise SeedError("the learner result email is not switched off; run the settings section first")

    def h_resolve_section(self, step):
        data = self.json_of(self.call("GET", step.path, resolve(step.params, self.state.values)), step.path)
        hits = find_objects(data, lambda d: pick(d, "section_name", "name") == "Section A" and pick(d, "id", "section_id"))
        ids = {pick(h, "id", "section_id") for h in hits}
        if len(ids) != 1:
            raise SeedError("could not find the section of assessment %s in:\n  %s"
                            % (step.args["assessment"], json.dumps(data)[:3000]))
        self.state.set(step.key, ids.pop())

    def h_offline_attempt(self, step):
        a = step.args
        questions = self.need("paperq/" + a["paper"])
        section = self.need("assessment/%s/section" % a["assessment"])
        rnd = random.Random(step.key)
        answered = []
        for q, mark in zip(questions, a["answers"]):
            if mark == "-":
                continue
            wrong = [o for o in q["options"] if o != q["correct"]]
            answered.append({"question_id": q["id"], "type": "MCQS",
                             "option_ids": [q["correct"] if mark == "C" else rnd.choice(wrong)]})
        body = {"user_id": self.need("learner/%s" % a["learner"]), "full_name": a["full_name"], "email": "",
                "username": a["username"], "mobile_number": "", "batch_id": self.need("batch/" + a["batch"]),
                "sections": [{"section_id": section, "questions": answered}]}
        self.call("POST", step.path, resolve(step.params, self.state.values), body)

    def h_mark_attendance(self, step):
        session_id = self.need("live/" + step.args["live"])
        path = "/admin-core-service/get-sessions/by-session-id"
        data = self.json_of(self.call("GET", path, {"sessionId": session_id}), path)
        # The session comes back as {schedule: {added_schedules: [{id, meetingDate, ...}]}}.
        added = (data.get("schedule") or {}).get("added_schedules") or []
        ids = {x.get("id") for x in added if x.get("id")}
        if len(ids) != 1:
            raise SeedError("expected one schedule for live class %s, got:\n  %s"
                            % (step.args["live"], json.dumps(data)[:2000]))
        entries = [{"userSourceId": self.need("learner/%s" % n), "userSourceType": "USER", "status": status}
                   for n, status in step.args["marks"]]
        self.call("POST", step.path, body={"sessionId": session_id, "scheduleId": ids.pop(), "entries": entries})


def sign_in(base, user, password, institute_id):
    import requests
    resp = requests.post(base.rstrip("/") + "/auth-service/v1/login-root", json={
        "user_name": user, "password": password, "client_name": "ADMIN_PORTAL", "institute_id": institute_id},
        timeout=60)
    if resp.status_code != 200:
        raise SeedError("sign-in failed: HTTP %s %s" % (resp.status_code, resp.text[:500]))
    token = pick(resp.json(), "accessToken", "access_token")
    if not token:
        raise SeedError("sign-in returned no access token")
    return token


def get_token(base, institute_id, env=os.environ):
    if env.get("SEED_TOKEN"):
        return env["SEED_TOKEN"].strip()
    if env.get("SEED_USER") and env.get("SEED_PASS"):
        return sign_in(base, env["SEED_USER"], env["SEED_PASS"], institute_id)
    raise SeedError("set SEED_TOKEN, or SEED_USER and SEED_PASS")


def parse_args(argv):
    ap = argparse.ArgumentParser(description="Seed a demo institute. Prints a plan unless --apply is given.")
    ap.add_argument("--base", required=True, help="backend base URL, e.g. https://backend-stage.vacademy.io")
    ap.add_argument("--data", required=True, help="dataset JSON, e.g. data/vacademy.json")
    ap.add_argument("--institute", default=PLACEHOLDER_INSTITUTE, help="target institute id (required with --apply)")
    ap.add_argument("--apply", action="store_true", help="execute the writes. Without it nothing is sent.")
    ap.add_argument("--only", help="run one section: " + ", ".join(SECTION_NAMES))
    ap.add_argument("--skip", action="append", default=[], help="leave a section out (repeatable)")
    ap.add_argument("--limit", type=int, help="create at most this many new leads in this run")
    ap.add_argument("--today", help="YYYY-MM-DD to plan against instead of today in India time")
    ap.add_argument("--show-bodies", action="store_true", help="print every request body in the plan")
    ap.add_argument("--delay", type=float, default=0.2, help="seconds to wait after each write")
    ap.add_argument("--state-dir", default=STATE_DIR)
    ap.add_argument("--team-email-template", default=os.environ.get("SEED_TEAM_EMAIL_TEMPLATE"),
                    help="address for invited staff, {key} is replaced, e.g. you+{key}@yourdomain")
    for name, on, _ in SECTIONS:
        if not on:
            ap.add_argument("--allow-" + name.replace("_", "-"), action="store_true",
                            help="include the %s section (it has a side effect that cannot be avoided)" % name)
    return ap.parse_args(argv)


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    with open(args.data) as fh:
        ds = json.load(fh)
    today = parse_today(args.today)
    allowed = {name for name, on, _ in SECTIONS if not on and getattr(args, "allow_" + name, False)}
    sections = select_sections(args.only, allowed, args.skip)

    problems = validate_dataset(ds)
    steps = build_plan(ds, args.institute, today, sections, args.team_email_template)
    problems += lint_steps(steps, ds, args.institute)
    if problems:
        raise SeedError("the plan breaks the safety rules; nothing was sent:\n  - " + "\n  - ".join(problems[:40]))

    path = state_path(ds["product"], args.institute, args.state_dir)
    if not args.apply:
        state = State(path) if os.path.exists(path) else None
        print_plan(steps, ds, sections, state, args.show_bodies)
        return 0

    if args.institute == PLACEHOLDER_INSTITUTE:
        raise SeedError("--apply needs --institute <id>")
    state = State(path, args.institute, args.base.rstrip("/"))
    bound = state.bound_to(args.institute, args.base.rstrip("/"))
    if bound:
        raise SeedError("\n".join(bound))
    token = get_token(args.base, args.institute)
    ex = Executor(args.base, args.institute, token, state, ds, os.path.dirname(os.path.abspath(args.data)),
                  delay=args.delay, limit=args.limit)
    ex.preflight()
    ex.run(steps)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SeedError as e:
        sys.stderr.write("seed: %s\n" % e)
        sys.exit(2)
