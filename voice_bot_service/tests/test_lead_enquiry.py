"""The enquiry date and source in the prompt (call 6313b454, 2026-10-10).

The parent asked "कब inquiry किए थे?", "कब?", "किस महीने में?" and the bot could only
repeat "आपने Shiksha Nation में live classes के लिए inquiry की थी" — three times — before
"Not interested madam." admin_core now sends a leadEnquiry block; the bot turns it into
one prompt line. The date is stated ONLY when admin_core marked it genuine: most leads
called that week came from a bulk import whose stamp is the import day.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import app.bot as b

IST = ZoneInfo("Asia/Kolkata")


def _iso(days_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


def test_genuine_date_is_named_with_source_and_age():
    ctx = {"instituteName": "Shiksha Nation",
           "leadEnquiry": {"sourceType": "META_LEAD_ADS", "dateKnown": True, "submittedAt": _iso(13)}}
    line = b._lead_enquiry_line(ctx)
    day = (datetime.now(timezone.utc) - timedelta(days=13)).astimezone(IST).date()
    assert day.strftime("%A %-d %B %Y") in line, line
    assert "13 days ago" in line or "12 days ago" in line or "14 days ago" in line
    assert "Shiksha Nation's ads on Facebook or Instagram" in line
    # Which of the two apps is not on record; the probe heard "Facebook पर" alone.
    assert "always name both: 'Facebook या Instagram'" in line
    assert "ONLY if they ask" in line
    assert "do not repeat it word for word" in line


def test_imported_lead_never_gets_a_date():
    recorded = datetime.now(timezone.utc) - timedelta(days=96)
    ctx = {"instituteName": "Shiksha Nation",
           "leadEnquiry": {"sourceType": "AUDIENCE_CAMPAIGN", "dateKnown": False,
                           "recordedAt": recorded.isoformat()}}
    line = b._lead_enquiry_line(ctx)
    assert "some months ago" in line
    assert "NOT on record" in line
    # The import day must not leak in any form.
    assert recorded.astimezone(IST).strftime("%B") not in line, line
    assert recorded.astimezone(IST).strftime("%-d %B") not in line
    assert "an enquiry form for Shiksha Nation" in line


def test_recent_import_says_some_time_ago():
    ctx = {"leadEnquiry": {"sourceType": "WEBSITE", "dateKnown": False, "recordedAt": _iso(10)}}
    line = b._lead_enquiry_line(ctx)
    assert "some time ago" in line and "some months ago" not in line
    assert "the enquiry form on the institute's website" in line


def test_date_known_flag_must_be_true_to_name_a_date():
    """A missing or malformed flag is treated as unknown, never as genuine."""
    ctx = {"leadEnquiry": {"sourceType": "META_LEAD_ADS", "submittedAt": _iso(5)}}
    line = b._lead_enquiry_line(ctx)
    assert "NOT on record" in line
    ctx["leadEnquiry"]["dateKnown"] = "true"
    assert "NOT on record" in b._lead_enquiry_line(ctx)


def test_bad_timestamp_falls_back_to_unknown():
    ctx = {"leadEnquiry": {"sourceType": "META_LEAD_ADS", "dateKnown": True, "submittedAt": "garbage"}}
    assert "NOT on record" in b._lead_enquiry_line(ctx)


def test_no_block_adds_nothing():
    assert b._lead_enquiry_line({}) == ""
    assert b._lead_enquiry_line({"leadEnquiry": None}) == ""
    assert b._lead_enquiry_line({"leadEnquiry": {}}) == ""


def test_ago_wording():
    assert b._ago(0) == "today"
    assert b._ago(1) == "yesterday"
    assert b._ago(9) == "9 days ago"
    assert b._ago(21) == "about 3 weeks ago"
    assert b._ago(96) == "about 3 months ago"


def _agent(prompt: str) -> dict:
    return {"name": "Shreya", "systemPrompt": prompt, "direction": "OUTBOUND", "openingLine": "Hi!"}


def test_prompt_carries_the_line_in_both_branches_and_only_when_sent():
    enq = {"sourceType": "META_LEAD_ADS", "dateKnown": True, "submittedAt": _iso(20)}
    for prompt in ("Bot: Hi! " * 80, "short"):          # authored script, thin prompt
        with_it = b.build_system_prompt({"agent": _agent(prompt), "instituteName": "Shiksha Nation",
                                         "leadFields": {"Class": "9"}, "leadEnquiry": enq})
        assert "WHEN AND WHERE THEY ENQUIRED" in with_it
        # Sits right after what we already know about the lead.
        assert with_it.index("What you ALREADY KNOW") < with_it.index("WHEN AND WHERE THEY ENQUIRED")
        without = b.build_system_prompt({"agent": _agent(prompt), "instituteName": "Shiksha Nation",
                                         "leadFields": {"Class": "9"}})
        assert "WHEN AND WHERE THEY ENQUIRED" not in without
