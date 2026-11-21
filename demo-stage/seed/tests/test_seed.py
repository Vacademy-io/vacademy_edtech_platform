"""Tests for the pure parts of seed.py and for the executor against a fake server.

Run:  python3 -m unittest discover -s tests -v     (from demo-stage/seed)
Nothing here opens a network connection.
"""
import base64
import copy
import datetime as dt
import io
import json
import os
import socket
import stat
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import seed  # noqa: E402

DATA = os.path.join(os.path.dirname(HERE), "data", "vacademy.json")
TODAY = dt.date(2026, 11, 20)
INST = "11111111-2222-3333-4444-555555555555"


def dataset():
    with open(DATA) as fh:
        return json.load(fh)


def token(authorities=None, user="admin-user-id"):
    payload = {"user": user, "authorities": {INST: {"roles": ["ADMIN"]}} if authorities is None else authorities}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return "h.%s.s" % body


class Dates(unittest.TestCase):
    def test_relative_dates(self):
        self.assertEqual(seed.iso_date({"days": -3}, TODAY), "2026-11-17")
        self.assertEqual(seed.iso_date({"days": 12}, TODAY), "2026-12-02")

    def test_india_time_to_utc(self):
        self.assertEqual(seed.iso_utc({"days": 0, "time": "17:00"}, TODAY), "2026-11-20T11:30:00.000Z")
        # 02:00 India time is still the previous day in UTC
        self.assertEqual(seed.iso_utc({"days": 0, "time": "02:00"}, TODAY), "2026-11-19T20:30:00.000Z")

    def test_wall_clock_and_local(self):
        self.assertEqual(seed.iso_wall_z({"days": 1, "time": "17:00"}, TODAY), "2026-11-21T17:00:00.000Z")
        self.assertEqual(seed.iso_local({"days": -1}, TODAY), "2026-11-19T00:00:00")


class Refs(unittest.TestCase):
    def test_resolve_nested(self):
        body = {"a": seed.Ref("x"), "b": [seed.Ref("y"), {"c": seed.Ref("z", "dflt")}], "d": 1}
        self.assertEqual(seed.resolve(body, {"x": "1", "y": "2"}), {"a": "1", "b": ["2", {"c": "dflt"}], "d": 1})

    def test_missing_ref_is_a_soft_skip(self):
        with self.assertRaises(seed.MissingRef) as cm:
            seed.resolve({"a": seed.Ref("nope")}, {})
        self.assertEqual(cm.exception.key, "nope")
        self.assertIsInstance(cm.exception, seed.SoftSkip)

    def test_path_refs(self):
        self.assertEqual(seed.resolve_path("/lead/{ref:lead/7}", {"lead/7": "abc"}), "/lead/abc")
        with self.assertRaises(seed.MissingRef):
            seed.resolve_path("/lead/{ref:lead/7}", {})


class StateFile(unittest.TestCase):
    def test_roundtrip_and_permissions(self):
        with tempfile.TemporaryDirectory() as d:
            path = seed.state_path("vacademy", INST, os.path.join(d, "nested"))
            st = seed.State(path, INST, "https://x")
            self.assertFalse(st.is_done("course/a"))
            st.set("course/a", "id-1")
            st.mark_done("course/a")
            st.save()
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            again = seed.State(path)
            self.assertTrue(again.is_done("course/a"))
            self.assertEqual(again.values["course/a"], "id-1")
            self.assertFalse(again.is_done("course/b"))
            self.assertFalse(os.path.exists(path + ".tmp"))

    def test_bound_to_one_institute_and_server(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.json")
            st = seed.State(path, INST, "https://x")
            st.save()
            again = seed.State(path)
            self.assertEqual(again.bound_to(INST, "https://x"), [])
            self.assertEqual(len(again.bound_to("other", "https://x")), 1)
            self.assertEqual(len(again.bound_to(INST, "https://y")), 1)

    def test_state_path_is_per_institute(self):
        self.assertNotEqual(seed.state_path("vacademy", "a", "/s"), seed.state_path("vacademy", "b", "/s"))
        self.assertNotIn("/", os.path.basename(seed.state_path("v", "../../etc", "/s")))


class Guard(unittest.TestCase):
    details = {"id": INST, "institute_name": "Northlight Academy"}
    claims = seed.jwt_claims(token())

    def test_accepts_the_right_institute(self):
        self.assertEqual(seed.institute_guard(INST, "Northlight Academy", self.details, self.claims), [])

    def test_refuses_another_name(self):
        other = dict(self.details, institute_name="Some Real School")
        self.assertTrue(seed.institute_guard(INST, "Northlight Academy", other, self.claims))

    def test_name_must_match_exactly(self):
        other = dict(self.details, institute_name="Northlight Academy 2")
        self.assertTrue(seed.institute_guard(INST, "Northlight Academy", other, self.claims))
        lower = dict(self.details, institute_name="northlight academy")
        self.assertTrue(seed.institute_guard(INST, "Northlight Academy", lower, self.claims))

    def test_refuses_another_id(self):
        other = dict(self.details, id="99999999-0000-0000-0000-000000000000")
        self.assertTrue(seed.institute_guard(INST, "Northlight Academy", other, self.claims))

    def test_refuses_missing_name_or_bad_body(self):
        self.assertTrue(seed.institute_guard(INST, "Northlight Academy", {"id": INST}, self.claims))
        self.assertTrue(seed.institute_guard(INST, "", {"id": INST, "institute_name": ""}, self.claims))
        self.assertTrue(seed.institute_guard(INST, "Northlight Academy", ["x"], self.claims))

    def test_refuses_token_without_role_here(self):
        claims = seed.jwt_claims(token(authorities={"other-institute": {}}))
        self.assertTrue(seed.institute_guard(INST, "Northlight Academy", self.details, claims))
        self.assertTrue(seed.institute_guard(INST, "Northlight Academy", self.details, {}))

    def test_refuses_placeholder(self):
        self.assertTrue(seed.institute_guard(seed.PLACEHOLDER_INSTITUTE, "Northlight Academy", self.details, self.claims))

    def test_unreadable_token(self):
        with self.assertRaises(seed.SeedError):
            seed.jwt_claims("not-a-jwt")


class Sections(unittest.TestCase):
    def test_default_leaves_out_the_off_sections(self):
        chosen = seed.select_sections(None, set())
        self.assertNotIn("team", chosen)
        self.assertNotIn("announcements", chosen)
        self.assertIn("leads", chosen)

    def test_allow_flag_adds_a_section(self):
        self.assertIn("team", seed.select_sections(None, {"team"}))

    def test_only(self):
        self.assertEqual(seed.select_sections("leads", set()), ["leads"])
        with self.assertRaises(seed.SeedError):
            seed.select_sections("team", set())
        self.assertEqual(seed.select_sections("team", {"team"}), ["team"])
        with self.assertRaises(seed.SeedError):
            seed.select_sections("nonsense", set())

    def test_skip(self):
        self.assertNotIn("payments", seed.select_sections(None, set(), ["payments"]))


class Plan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds = dataset()
        cls.sections = seed.select_sections(None, set())
        cls.steps = seed.build_plan(cls.ds, INST, TODAY, cls.sections)

    def test_dataset_is_valid(self):
        self.assertEqual(seed.validate_dataset(self.ds), [])
        self.assertEqual(self.ds["institute"]["name"], "Northlight Academy")
        self.assertEqual(len(self.ds["learners"]), 120)
        self.assertEqual(len(self.ds["leads"]), 200)

    def test_real_plan_passes_the_lint(self):
        self.assertEqual(seed.lint_steps(self.steps, self.ds, INST), [])

    def test_plan_with_every_section_passes_the_lint(self):
        steps = seed.build_plan(self.ds, INST, TODAY, seed.SECTION_NAMES, "owner+{key}@mailbox.test")
        self.assertEqual(seed.lint_steps(steps, self.ds, INST), [])
        self.assertEqual(len([s for s in steps if s.section == "team"]), 4)
        self.assertEqual(len([s for s in steps if s.section == "announcements"]), 3)

    def test_plan_is_deterministic(self):
        again = seed.build_plan(self.ds, INST, TODAY, self.sections)
        dump = lambda steps: json.dumps([[s.key, s.path, seed.printable(s.params), seed.printable(s.body),
                                          seed.printable(s.args)] for s in steps], sort_keys=True)
        self.assertEqual(dump(self.steps), dump(again))

    def test_keys_are_unique(self):
        keys = [s.key for s in self.steps]
        self.assertEqual(len(keys), len(set(keys)))

    def test_section_order(self):
        first = {}
        for i, s in enumerate(self.steps):
            first.setdefault(s.section, i)
        self.assertEqual(self.steps[0].section, "settings")
        self.assertLess(first["structure"], first["fee_plans"])
        self.assertLess(first["fee_plans"], first["learners"])   # fees are billed at enrolment
        self.assertLess(first["learners"], first["payments"])
        self.assertLess(first["assessments"], first["attempts"])

    def test_counts(self):
        enrolled = sum(len(s.body["new_users"]) for s in self.steps if s.section == "learners")
        self.assertEqual(enrolled, 120)
        self.assertEqual(len([s for s in self.steps if s.tag == "lead-submit"]), 200)
        self.assertEqual(len([s for s in self.steps if s.key.startswith("course/")]), 6)
        self.assertEqual(len([s for s in self.steps if s.key.startswith("lead-followup/")]),
                         len([l for l in self.ds["leads"] if l.get("follow_up")]))

    def test_every_enrolment_is_silent(self):
        for s in self.steps:
            if s.section == "learners":
                self.assertEqual(s.body["options"]["send_credentials"], False)
                self.assertEqual(s.body["options"]["notify_learners"], False)
                self.assertEqual(s.path, "/admin-core-service/v3/learner-management/assign")

    def test_lead_lists_do_not_email(self):
        lists = [s for s in self.steps if s.key.startswith("campaign/")]
        self.assertEqual(len(lists), 3)
        for s in lists:
            self.assertIs(s.body["send_respondent_email"], False)
            self.assertEqual(s.body["to_notify"], "")

    def test_assessment_and_live_class_notifications_are_off(self):
        for s in self.steps:
            if s.key.endswith("/participants"):
                self.assertFalse(any(s.body["notify_student"].values()))
                self.assertFalse(any(s.body["notify_parent"].values()))
            if s.key.endswith("/audience"):
                self.assertEqual(s.body["added_notification_actions"], [])

    def test_slides_published_without_notify(self):
        docs = [s for s in self.steps if "add-update-document-slide" in s.path]
        self.assertTrue(docs)
        for s in docs:
            self.assertIs(s.body["notify"], False)

    def test_placeholder_videos_are_not_planned(self):
        self.assertFalse([s for s in self.steps if "video-slide" in s.path])
        self.assertEqual(len(seed.placeholder_videos(self.ds)), 3)

    def test_attempts_only_with_blank_contact(self):
        attempts = [s for s in self.steps if s.key.startswith("attempt/")]
        self.assertEqual(len(attempts), 18 + 16 + 12)
        self.assertEqual(self.steps[[s.section for s in self.steps].index("attempts")].handler, "check_results_muted")
        for s in attempts:
            self.assertRegex(s.args["answers"], r"^[CW-]{10}$")

    def test_agents_are_config_only(self):
        for s in self.steps:
            if s.section == "ai_agents":
                self.assertEqual(s.body["speechCacheMode"], "OFF")
                self.assertEqual(s.body["sendRules"], [])
                self.assertNotIn("test-call", s.path)

    def test_dates_follow_today(self):
        later = seed.build_plan(self.ds, INST, TODAY + dt.timedelta(days=10), ["assessments"])
        a = [s for s in self.steps if s.key == "assessment/live-phy"][0].body["test_boundation"]
        b = [s for s in later if s.key == "assessment/live-phy"][0].body["test_boundation"]
        self.assertEqual(a["start_date"], "2026-11-19T03:30:00.000Z")
        self.assertEqual(b["start_date"], "2026-11-29T03:30:00.000Z")
        now = dt.datetime(2026, 11, 20, 12, 0, tzinfo=seed.IST)
        live = [x for x in self.ds["assessments"]
                if seed.rel_local(x["start"], TODAY) <= now <= seed.rel_local(x["end"], TODAY)]
        self.assertEqual([x["key"] for x in live], ["live-phy"])


class Lint(unittest.TestCase):
    def setUp(self):
        self.ds = dataset()

    def lint(self, **kw):
        base = dict(key="k", section="learners", title="t", path="/admin-core-service/x", body={})
        base.update(kw)
        return seed.lint_steps([seed.Step(**base)], self.ds, INST)

    def test_clean_step(self):
        self.assertEqual(self.lint(body={"institute_id": INST, "email": "a@example.com"}), [])

    def test_flags_that_send(self):
        self.assertTrue(self.lint(body={"options": {"send_credentials": True}}))
        self.assertTrue(self.lint(body={"options": {"notify_learners": True}}))
        self.assertTrue(self.lint(body={"notify": True}))
        self.assertTrue(self.lint(body={"send_respondent_email": None}))   # null means "send" on the server
        self.assertTrue(self.lint(body={"generate_invoice": True}))
        self.assertTrue(self.lint(body={"notify_student": {"before_assessment_goes_live": 10}}))
        self.assertTrue(self.lint(body={"notify_student": {"when_assessment_live": True}}))

    def test_lists_that_send(self):
        self.assertTrue(self.lint(body={"mediums": [{"mediumType": "EMAIL"}]}))
        self.assertTrue(self.lint(body={"added_notification_actions": [{"type": "ON_CREATE", "notify": False}]}))
        self.assertTrue(self.lint(body={"to_notify": "someone@example.com"}))
        self.assertTrue(self.lint(body={"add_faculty_to_course": [{"new_user": True}]}))
        self.assertTrue(self.lint(body={"sendRules": [{"x": 1}]}))

    def test_real_addresses_and_numbers(self):
        self.assertTrue(self.lint(body={"user_dto": {"email": "parent@gmail.com"}}))
        self.assertTrue(self.lint(body={"new_users": [{"mobile_number": "919876543210"}]}))
        self.assertTrue(self.lint(body={"new_users": [{"mobile_number": "9876543210"}]}))
        self.assertEqual(self.lint(body={"new_users": [{"mobile_number": "911002012345"}]}), [])

    def test_forbidden_paths(self):
        for path in ("/admin-core-service/v1/telephony/ai-agents/abc/test-call",
                     "/admin-core-service/live-sessions/provider/meeting/create",
                     "/admin-core-service/open/v1/audience/lead/submit",
                     "/auth-service/v1/signup-root",
                     "/admin-core-service/institute/institute_learner/v1/learner/enroll",
                     "/auth-service/v1/user-invitation/invite"):
            self.assertTrue(self.lint(path=path), path)

    def test_other_institute(self):
        self.assertTrue(self.lint(body={"institute_id": "someone-else"}))
        self.assertTrue(self.lint(body={"instituteId": "someone-else"}))
        self.assertTrue(self.lint(params={"instituteId": "someone-else"}))

    def test_duplicate_keys(self):
        steps = [seed.Step("k", "leads", "a", path="/x"), seed.Step("k", "leads", "b", path="/y")]
        self.assertTrue(seed.lint_steps(steps, self.ds, INST))

    def test_dataset_validation_catches_edits(self):
        ds = copy.deepcopy(self.ds)
        ds["learners"][0]["email"] = "real.person@gmail.com"
        ds["leads"][0]["phone"] = "919812345678"
        ds["fee_plans"][0]["fee_types"][0]["installments"][0]["amount"] += 1
        ds["assessments"][4]["result_type"] = "AUTO_AFTER_SUBMISSION"
        self.assertEqual(len(seed.validate_dataset(ds)), 4)


class Generators(unittest.TestCase):
    def test_answers_are_stable(self):
        spec = {"seed": 14, "ability": [0.4, 0.9]}
        self.assertEqual(seed.attempt_answers(spec, 3, 10), seed.attempt_answers(spec, 3, 10))
        self.assertNotEqual(seed.attempt_answers(spec, 3, 10), seed.attempt_answers(spec, 4, 10))

    def test_attendance_is_stable(self):
        spec = {"seed": 3, "present_rate": 0.8}
        marks = seed.attendance_marks(spec, list(range(1, 41)))
        self.assertEqual(marks, seed.attendance_marks(spec, list(range(1, 41))))
        present = [m for m in marks if m[1] == "PRESENT"]
        self.assertTrue(20 < len(present) < 40)

    def test_helpers(self):
        self.assertEqual(seed.deep_merge({"a": {"b": 1, "c": 2}, "z": 1}, {"a": {"b": 9}}), {"a": {"b": 9, "c": 2}, "z": 1})
        self.assertEqual(len(seed.find_objects({"x": [{"id": 1}, {"y": {"id": 2}}]}, lambda d: "id" in d)), 2)
        self.assertEqual(seed.stable_uuid(INST, "a"), seed.stable_uuid(INST, "a"))
        self.assertNotEqual(seed.stable_uuid(INST, "a"), seed.stable_uuid("other", "a"))


# ------------------------------------------------------------------ executor against a fake server

class FakeResponse(object):
    def __init__(self, status, payload):
        self.status_code = status
        self.text = payload if isinstance(payload, str) else json.dumps(payload)

    def json(self):
        return json.loads(self.text)


class FakeServer(object):
    """Stands in for requests.Session. Records every call; answers the handful of routes the tests use."""

    def __init__(self, name="Northlight Academy", workflows=None, fail_on=None):
        self.name = name
        self.workflows = workflows or []
        self.fail_on = fail_on
        self.calls = []
        self.settings = {}
        self.lead_seq = 0
        self.stages = [{"id": "st-LEAD", "status_key": "LEAD"}, {"id": "st-CONVERTED", "status_key": "CONVERTED"},
                       {"id": "st-LOST", "status_key": "LOST"}]

    def writes(self):
        return [c for c in self.calls if c[0] != "GET"]

    def request(self, method, url, params=None, json=None, headers=None, timeout=None):
        path = url.split("https://fake", 1)[1]
        self.calls.append((method, path, params, json, headers))
        if self.fail_on and self.fail_on in path and method != "GET":
            return FakeResponse(500, "boom")
        if path.startswith("/admin-core-service/institute/v1/details/"):
            return FakeResponse(200, {"id": INST, "institute_name": self.name, "batches_for_sessions": []})
        if path.startswith("/admin-core-service/v1/workflow/institute/"):
            return FakeResponse(200, self.workflows)
        if path.endswith("/setting/v1/all"):
            return FakeResponse(200, {"setting": self.settings})
        if path.endswith("/setting/v1/save-setting"):
            self.settings[params["settingKey"]] = {"key": params["settingKey"], "data": json["setting_data"]}
            return FakeResponse(200, "Done")
        if path == "/admin-core-service/v1/lead-status" and method == "GET":
            return FakeResponse(200, self.stages)
        if path == "/admin-core-service/v1/lead-status":
            made = {"id": "st-" + json["status_key"], "status_key": json["status_key"]}
            self.stages.append(made)
            return FakeResponse(200, made)
        if path == "/admin-core-service/v1/audience/campaign":
            return FakeResponse(200, "camp-%d" % len(self.writes()))
        if path == "/admin-core-service/v1/audience/lead/submit":
            self.lead_seq += 1
            return FakeResponse(200, "00000000-0000-0000-0000-%012d" % self.lead_seq)
        if path.startswith("/admin-core-service/v1/lead-status/lead/") or path == "/admin-core-service/v1/lead-followup":
            return FakeResponse(200, {"ok": True})
        return FakeResponse(404, "no such route in the fake: %s %s" % (method, path))


def small_dataset():
    ds = dataset()
    ds["leads"] = ds["leads"][:12]
    return ds


class ExecutorRuns(unittest.TestCase):
    def make(self, server, d, ds=None, limit=None):
        ds = ds or small_dataset()
        state = seed.State(seed.state_path("vacademy", INST, d), INST, "https://fake")
        ex = seed.Executor("https://fake", INST, token(), state, ds, d, delay=0, limit=limit, log=lambda *_: None)
        ex.http = server
        return ex, ds

    def plan(self, ds, sections=("settings", "leads")):
        steps = seed.build_plan(ds, INST, TODAY, list(sections))
        self.assertEqual(seed.lint_steps(steps, ds, INST), [])
        return steps

    def test_refuses_an_institute_with_another_name_before_any_write(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer(name="A Real Customer School")
            ex, ds = self.make(server, d)
            with self.assertRaises(seed.SeedError) as cm:
                ex.preflight()
            self.assertIn("A Real Customer School", str(cm.exception))
            self.assertEqual(server.writes(), [])
            self.assertFalse(os.path.exists(ex.state.path))

    def test_refuses_when_workflows_exist(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer(workflows=[{"id": "wf-1"}])
            ex, ds = self.make(server, d)
            with self.assertRaises(seed.SeedError):
                ex.preflight()
            self.assertEqual(server.writes(), [])

    def test_second_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer()
            ex, ds = self.make(server, d)
            steps = self.plan(ds)
            ex.preflight()
            done, skipped, waiting = ex.run(steps)
            first_writes = len(server.writes())
            self.assertGreater(first_writes, 12)
            self.assertEqual(skipped, 0)
            self.assertEqual(len([c for c in server.writes() if c[1].endswith("/lead/submit")]), 12)
            # every request carried the token and the institute header
            for call in server.calls:
                self.assertEqual(call[4]["clientId"], INST)
                self.assertTrue(call[4]["Authorization"].startswith("Bearer "))

            server2 = FakeServer()
            server2.settings, server2.stages = server.settings, server.stages
            ex2, _ = self.make(server2, d, ds)
            ex2.preflight()
            done2, skipped2, _ = ex2.run(self.plan(ds))
            self.assertEqual(server2.writes(), [])
            self.assertEqual(done2, 0)
            self.assertEqual(skipped2, done)

    def test_assignment_waits_for_the_team(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer()
            ex, ds = self.make(server, d)
            ex.preflight()
            _, _, waiting = ex.run(self.plan(ds))
            self.assertEqual(waiting, len({l["counsellor"] for l in ds["leads"]}))
            self.assertFalse([c for c in server.calls if "counsellor-workbench" in c[1]])

    def test_stops_on_the_first_unexpected_response_and_keeps_state(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer(fail_on="/lead-followup")
            ex, ds = self.make(server, d)
            ex.preflight()
            with self.assertRaises(seed.SeedError) as cm:
                ex.run(self.plan(ds))
            self.assertIn("HTTP 500", str(cm.exception))
            self.assertIn("boom", str(cm.exception))
            failed_calls = [c for c in server.writes() if c[1].endswith("/lead-followup")]
            self.assertEqual(len(failed_calls), 1)            # stopped, did not carry on
            saved = seed.State(ex.state.path)
            self.assertTrue(saved.is_done("lead/1"))
            self.assertFalse(any(k.startswith("lead-followup/") for k in saved.data["done"]))

            # after the fault is fixed the rerun only sends what is missing
            server2 = FakeServer()
            server2.settings, server2.stages, server2.lead_seq = server.settings, server.stages, 500
            ex2, _ = self.make(server2, d, ds)
            ex2.preflight()
            ex2.run(self.plan(ds))
            self.assertFalse([c for c in server2.writes() if c[1].endswith("/lead/submit")])
            self.assertTrue([c for c in server2.writes() if c[1].endswith("/lead-followup")])

    def test_a_non_uuid_lead_answer_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer()
            ex, ds = self.make(server, d)
            ex.preflight()
            real = server.request

            def odd(method, url, **kw):
                if url.endswith("/lead/submit"):
                    server.calls.append((method, url.split("https://fake", 1)[1], None, kw.get("json"), kw.get("headers")))
                    return FakeResponse(200, "You have already submitted a response")
                return real(method, url, **kw)
            server.request = odd
            with self.assertRaises(seed.SeedError):
                ex.run(self.plan(ds))

    def test_limit_spreads_leads_over_runs(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer()
            ex, ds = self.make(server, d, limit=5)
            ex.preflight()
            ex.run(self.plan(ds))
            self.assertEqual(len([c for c in server.writes() if c[1].endswith("/lead/submit")]), 5)
            ex2, _ = self.make(server, d, ds, limit=5)
            ex2.run(self.plan(ds))
            self.assertEqual(len([c for c in server.writes() if c[1].endswith("/lead/submit")]), 10)

    def test_settings_are_merged_not_replaced(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer()
            server.settings["ASSESSMENT_SETTING"] = {"key": "ASSESSMENT_SETTING", "data": {
                "keepMe": 1, "resultNotifications": {"roles": {"ADMIN": True, "STUDENT": True}}}}
            ex, ds = self.make(server, d)
            ex.preflight()
            ex.run(self.plan(ds, ["settings"]))
            data = server.settings["ASSESSMENT_SETTING"]["data"]
            self.assertEqual(data["keepMe"], 1)
            self.assertEqual(data["resultNotifications"]["roles"], {"ADMIN": True, "STUDENT": False, "LEARNER": False})
            self.assertEqual(server.settings["LEARNER_ENROLLMENT_SETTING"]["data"], {"sendCredentials": False})

    def test_attempts_refuse_to_start_while_result_email_is_on(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer()
            ex, ds = self.make(server, d)
            ex.preflight()
            with self.assertRaises(seed.SeedError) as cm:
                ex.run(self.plan(ds, ["attempts"]))
            self.assertIn("result email", str(cm.exception))
            self.assertEqual(server.writes(), [])

    def test_executor_refuses_forbidden_paths(self):
        with tempfile.TemporaryDirectory() as d:
            server = FakeServer()
            ex, _ = self.make(server, d)
            with self.assertRaises(seed.SeedError):
                ex.call("POST", "/admin-core-service/v1/telephony/ai-agents/x/test-call")
            self.assertEqual(server.calls, [])


class DryRun(unittest.TestCase):
    def test_default_run_prints_a_plan_and_opens_no_socket(self):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(socket, "socket", side_effect=AssertionError("network used in a dry run")), \
                mock.patch.object(sys, "stdout", out):
            code = seed.main(["--base", "https://backend-stage.vacademy.io", "--data", DATA, "--state-dir", d])
            self.assertEqual(os.listdir(d), [])            # a dry run writes no state either
        self.assertEqual(code, 0)
        text = out.getvalue()
        self.assertIn("Nothing was sent", text)
        self.assertIn("Northlight Academy", text)
        self.assertIn("off  team", text)
        self.assertIn("off  announcements", text)

    def test_apply_needs_an_institute_and_a_token(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(seed.SeedError):
                seed.main(["--base", "https://fake", "--data", DATA, "--state-dir", d, "--apply"])
            with mock.patch.dict(os.environ, {}, clear=True), \
                    mock.patch.object(socket, "socket", side_effect=AssertionError("network used")):
                with self.assertRaises(seed.SeedError) as cm:
                    seed.main(["--base", "https://fake", "--data", DATA, "--state-dir", d, "--apply",
                               "--institute", INST])
                self.assertIn("SEED_TOKEN", str(cm.exception))

    def test_apply_refuses_a_state_file_from_another_server(self):
        with tempfile.TemporaryDirectory() as d:
            st = seed.State(seed.state_path("vacademy", INST, d), INST, "https://somewhere-else")
            st.save()
            with mock.patch.object(socket, "socket", side_effect=AssertionError("network used")):
                with self.assertRaises(seed.SeedError):
                    seed.main(["--base", "https://fake", "--data", DATA, "--state-dir", d, "--apply",
                               "--institute", INST])


if __name__ == "__main__":
    unittest.main()
