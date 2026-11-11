"""
The admissions report behind ``crm_collections``: ``admissions`` (one masked page
plus totals) and ``admissions_export`` (the same rows with full contact, as a CSV
behind a private link). Institute admins only; read-only apart from the export's
own ``mcp_file_export`` row.

An admission is a person who was converted (``user_lead_profile``, not merged into
another person) or enrolled (``student_session_institute_group_mapping``) in the window. A row is one person
and plan, so a person with a plan in the window and a separate enrolment gets one
row for each. Totals are per person and ignore the basis, plan and lead_state
filters; ``matched`` and ``matched_people`` respect them.

The statements run on a worker thread on a session of their own, and a report holds
a slot (see ``try_acquire``) until that thread has finished. The handlers live in
``assistant_tools_crm_money``.
"""
from __future__ import annotations

import asyncio
import contextvars
import csv
import dataclasses
import functools
import io
import json
import logging
import random
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Set, Tuple, Union

from sqlalchemy.orm import Session

from . import crm_data as cd
from .assistant_tool_registry import ToolContext
from .file_exports import ExportHandle, ExportKind, create_export, register_kind

logger = logging.getLogger(__name__)

SOURCE_TOOL = "crm_collections"
EXPORT_KIND = "CRM_ADMISSIONS"
STATEMENT_TIMEOUT_MS = 15000
#: Rows the masked pages walk through, from offset 0.
MAX_ROWS_PAGED = 1000
PAGE_END_NOTE = "Pages end here; use action='admissions_export' for the rest."
EXPORT_MAX_ROWS = 5000
EXPORTS_PER_HOUR = 6
MAX_REPORTS_PER_POD = 2
#: Text cell length in the file.
CSV_TEXT_LIMIT = 2000
#: Text field length on a page.
PAGE_TEXT_LIMIT = 120
#: Reply size of one page.
MAX_PAGE_BYTES = 60_000
UNUSUAL_SOURCE = "OTHER (unusual source text)"

register_kind(EXPORT_KIND, ExportKind(
    label="CRM admissions with contact details and fees (names, phone numbers, emails, amounts)",
    ttl_minutes=15, max_downloads=2, max_bytes=10 * 1024 * 1024, content_types=("text/csv",)))

# ── filters ──────────────────────────────────────────────────────────────

PLAN_STATES = ("plan_in_window", "plan_after_window", "older_plan_only", "ended_plans_only", "plan_on_linked_person",
               "plan_elsewhere", "no_plan")
LEAD_STATES = ("active_enquiry", "enquiry_deleted", "no_enquiry_on_record")

#: Literal predicates over ``per p``; an argument only ever selects one of these, it is never bound or pasted.
BASIS = {"either": "TRUE", "converted": "p.is_conv", "enrolled": "p.is_enr",
         "late_conversion": "p.late_conversion", "excluding_late_conversions": "NOT p.late_conversion"}
PLAN = {"any": "TRUE",
        "plan_missing": "p.plan_state NOT IN ('plan_in_window', 'plan_after_window', 'plan_on_linked_person')",
        **{s: f"p.plan_state = '{s}'" for s in PLAN_STATES}}
LEAD = {"any": "TRUE", "no_active_enquiry": "p.lead_state <> 'active_enquiry'",
        **{s: f"p.lead_state = '{s}'" for s in LEAD_STATES}}
_FILTER_ARGS = (("basis", BASIS, "either"), ("plan", PLAN, "any"), ("lead_state", LEAD, "any"))


def filters_sql(args: Dict[str, Any]) -> Union[str, Dict[str, Any]]:
    """The WHERE of the rows statement for these arguments, or ``invalid_argument`` naming the allowed values."""
    parts = []
    for key, allowed, default in _FILTER_ARGS:
        value = str(args.get(key) or "").strip() or default
        if value not in allowed:
            return cd.err("invalid_argument", argument=key, allowed=list(allowed),
                          message=f"{key} is one of: {', '.join(allowed)}.")
        parts.append(allowed[value])
    return " AND ".join(parts)


# ── SQL ──────────────────────────────────────────────────────────────────
# The enrolment day: enrolled_date holds the UTC date when it was stamped at creation, so that case reads the
# created moment in the institute's timezone. Any other enrolled_date was set on purpose and stands.

_ENR_DAY = ("CASE WHEN {m}.enrolled_date IS NULL OR {m}.enrolled_date = CAST({m}.created_at AS date) "
            "THEN CAST({m}.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz AS date) ELSE {m}.enrolled_date END")
#: A row of an opt-out list (its own source, or its audience's campaign type). It is a consent record, not an enquiry.
_ON_LIST = "(COALESCE({r}.source_type, '') = 'OPT_OUT' OR COALESCE({a}.campaign_type, '') LIKE '%OPT_OUT%')"
#: An enrolment that counts: the same rule as the Admissions tab and lead_dues.
_COUNTED = ("{m}.status IN ('ACTIVE', 'COMPLETED', 'INVITED') "
            "AND NOT ({m}.status = 'INVITED' AND COALESCE({m}.source, '') = 'TERMINATED')")
#: What Python's str.strip() removes, which the CRM's send check applies to an email.
_WHITESPACE = r"[\s\u001C-\u001F\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+"
#: A contact as the CRM's send check compares it: a number's last 10 digits, an email in lower case with no whitespace
#: around it.
_CONTACT_KEYS = ("(VALUES (CASE WHEN length(regexp_replace(COALESCE({p}, ''), '[^0-9]', '', 'g')) >= 7 "
                 "THEN right(regexp_replace(COALESCE({p}, ''), '[^0-9]', '', 'g'), 10) END), "
                 "(CASE WHEN {e} LIKE '%@%.%' THEN LOWER(regexp_replace({e}, '^" + _WHITESPACE + "|" + _WHITESPACE
                 + "$', '', 'g')) END)) v(k)")
#: The statuses of a plan that has ended.
_ENDED_PLAN = "('TERMINATED', 'CANCELED', 'CANCELLED', 'DELETED', 'EXPIRED', 'PAYMENT_FAILED')"
#: A plan's currency: its price's, else its invite's.
_PLAN_CURRENCY = "UPPER(COALESCE(NULLIF(TRIM(pp.currency), ''), NULLIF(TRIM(ei.currency), '')))"
_LOG_CURRENCY = "NULLIF(UPPER(TRIM(l.currency)), '')"

_BASE = """WITH enr AS MATERIALIZED (
    SELECT s.id, s.user_id AS pid, s.user_plan_id, s.status,
           {enr_day} AS enr_day
    FROM student_session_institute_group_mapping s
    JOIN package_session ps ON ps.id = s.package_session_id
    JOIN package p ON p.id = ps.package_id
    WHERE s.institute_id = :inst
      AND {counted}
      AND {enr_day} >= CAST(:d_from AS date)
      AND {enr_day} <  CAST(:d_to AS date)
), pop AS MATERIALIZED (
    SELECT x.pid, BOOL_OR(x.c) AS is_conv, BOOL_OR(NOT x.c) AS is_enr
    FROM (SELECT ulp.user_id AS pid, TRUE AS c FROM user_lead_profile ulp
          WHERE ulp.institute_id = :inst AND ulp.conversion_status = 'CONVERTED' AND ulp.merged_into_user_id IS NULL
            AND ulp.converted_at >= CAST(:w_from AS timestamp) AND ulp.converted_at < CAST(:w_to AS timestamp)
          UNION ALL SELECT DISTINCT pid, FALSE FROM enr) x
    GROUP BY x.pid
), leads AS MATERIALIZED (
    SELECT l.pid, COUNT(*) FILTER (WHERE l.audience_status = 'ACTIVE' AND NOT l.on_list) AS live_leads,
           COUNT(*) FILTER (WHERE NOT l.on_list) AS any_leads,
           BOOL_OR(l.on_list OR l.overall_status IS NOT DISTINCT FROM 'OPTED_OUT') AS opted_out
    FROM (SELECT pop.pid, ar.id, ar.audience_status, ar.overall_status, {on_list} AS on_list FROM pop
          JOIN audience_response ar ON ar.user_id = pop.pid
          JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :inst
          UNION
          SELECT pop.pid, ar.id, ar.audience_status, ar.overall_status, {on_list} FROM pop
          JOIN audience_response ar ON ar.student_user_id = pop.pid
          JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :inst) l
    GROUP BY l.pid
), opt_keys AS MATERIALIZED (
    SELECT DISTINCT v.k
    FROM audience_response o
    JOIN audience oa ON oa.id = o.audience_id AND oa.institute_id = :inst
    CROSS JOIN LATERAL {o_keys}
    WHERE v.k IS NOT NULL AND (o.overall_status = 'OPTED_OUT' OR {on_list_o})
), opt_people AS MATERIALIZED (
    SELECT DISTINCT x.pid
    FROM (SELECT pop.pid, ar.parent_mobile AS phone, ar.parent_email AS email FROM pop
          JOIN audience_response ar ON ar.user_id = pop.pid
          JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :inst
          UNION ALL
          SELECT pop.pid, ar.parent_mobile, ar.parent_email FROM pop
          JOIN audience_response ar ON ar.student_user_id = pop.pid
          JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :inst
          UNION ALL
          SELECT pop.pid, s0.mobile_number, s0.email FROM pop
          JOIN student s0 ON s0.user_id = pop.pid
          WHERE EXISTS (SELECT 1 FROM student_session_institute_group_mapping sm
                        WHERE sm.user_id = pop.pid AND sm.institute_id = :inst)) x
    CROSS JOIN LATERAL {x_keys}
    JOIN opt_keys ok ON ok.k = v.k
), enr_plan AS MATERIALIZED (
    SELECT e.user_plan_id, MIN(e.enr_day) AS enr_day FROM enr e WHERE e.user_plan_id IS NOT NULL GROUP BY e.user_plan_id
), lines AS MATERIALIZED (
    SELECT up.id AS plan_id, up.user_id AS pid, up.status AS plan_status, up.created_at AS plan_created_at, ep.enr_day,
           (ep.user_plan_id IS NOT NULL OR (up.created_at >= CAST(:w_from AS timestamp) AND up.created_at < CAST(:w_to AS timestamp))) AS in_window
    FROM pop
    JOIN user_plan up ON up.user_id = pop.pid
    JOIN enroll_invite ei ON ei.id = up.enroll_invite_id AND ei.institute_id = :inst
    LEFT JOIN enr_plan ep ON ep.user_plan_id = up.id
), unmatched_enr AS MATERIALIZED (
    SELECT e.id, e.pid, e.user_plan_id, e.enr_day
    FROM enr e
    LEFT JOIN lines l ON l.plan_id = e.user_plan_id AND l.pid = e.pid
    WHERE l.plan_id IS NULL
), linked_plan AS MATERIALIZED (
    SELECT DISTINCT ON (k.pid) k.pid, k.other_pid
    FROM (SELECT pop.pid, ar.student_user_id AS other_pid FROM pop
          JOIN audience_response ar ON ar.user_id = pop.pid
          JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :inst
          WHERE ar.student_user_id IS NOT NULL AND ar.student_user_id <> pop.pid
          UNION
          SELECT pop.pid, ar.user_id FROM pop
          JOIN audience_response ar ON ar.student_user_id = pop.pid
          JOIN audience a ON a.id = ar.audience_id AND a.institute_id = :inst
          WHERE ar.user_id IS NOT NULL AND ar.user_id <> pop.pid) k
    JOIN user_plan up ON up.user_id = k.other_pid
    JOIN enroll_invite ei ON ei.id = up.enroll_invite_id AND ei.institute_id = :inst
    WHERE up.status NOT IN {ended_plan}
    ORDER BY k.pid, up.created_at DESC, up.id
), per AS MATERIALIZED (
    SELECT pop.pid, pop.is_conv, pop.is_enr, CASE WHEN ulp.conversion_status = 'CONVERTED' THEN ulp.converted_at END AS converted_at,
           ulp.assigned_counselor_id, ulp.best_score_response_id, ulp.best_source_type,
           COALESCE(pf.n_plans, 0) > 0 AS has_plan, COALESCE(pf.any_in_window, FALSE) AS plan_in_window,
           COALESCE(pf.plan_before, FALSE) AS plan_before, COALESCE(ld.opted_out, FALSE) OR op.pid IS NOT NULL AS opted_out,
           lp.other_pid AS linked_person_id,
           (pop.is_conv AND NOT pop.is_enr AND NOT COALESCE(pf.any_in_window, FALSE)
            AND (COALESCE(pf.plan_before, FALSE) OR EXISTS (
                SELECT 1 FROM student_session_institute_group_mapping sb
                WHERE sb.user_id = pop.pid AND sb.institute_id = :inst AND {counted_b}
                  AND {enr_day_b} < CAST(:d_from AS date)))) AS late_conversion,
           CASE WHEN ld.live_leads > 0 THEN 'active_enquiry' WHEN ld.any_leads > 0 THEN 'enquiry_deleted' ELSE 'no_enquiry_on_record' END AS lead_state,
           CASE WHEN COALESCE(pf.n_plans, 0) > 0 AND NOT COALESCE(pf.any_open, FALSE) THEN 'ended_plans_only'
                WHEN COALESCE(pf.any_in_window, FALSE) THEN 'plan_in_window'
                WHEN COALESCE(pf.any_open_after, FALSE) THEN 'plan_after_window'
                WHEN COALESCE(pf.n_plans, 0) > 0 THEN 'older_plan_only'
                WHEN lp.pid IS NOT NULL THEN 'plan_on_linked_person'
                WHEN EXISTS (SELECT 1 FROM unmatched_enr u WHERE u.pid = pop.pid AND u.user_plan_id IS NOT NULL) THEN 'plan_elsewhere'
                ELSE 'no_plan' END AS plan_state
    FROM pop
    LEFT JOIN (SELECT pid, COUNT(*) AS n_plans, BOOL_OR(in_window) AS any_in_window,
                      BOOL_OR(plan_created_at < CAST(:w_from AS timestamp)) AS plan_before,
                      BOOL_OR(plan_status NOT IN {ended_plan}) AS any_open,
                      BOOL_OR(plan_status NOT IN {ended_plan} AND plan_created_at >= CAST(:w_to AS timestamp)) AS any_open_after
               FROM lines GROUP BY pid) pf ON pf.pid = pop.pid
    LEFT JOIN leads ld ON ld.pid = pop.pid
    LEFT JOIN opt_people op ON op.pid = pop.pid
    LEFT JOIN linked_plan lp ON lp.pid = pop.pid
    LEFT JOIN user_lead_profile ulp ON ulp.user_id = pop.pid AND ulp.institute_id = :inst
)""".replace("{enr_day}", _ENR_DAY.format(m="s")).replace("{on_list}", _ON_LIST.format(r="ar", a="a")).replace(
    "{counted}", _COUNTED.format(m="s")).replace("{counted_b}", _COUNTED.format(m="sb")).replace(
    "{enr_day_b}", _ENR_DAY.format(m="sb")).replace("{on_list_o}", _ON_LIST.format(r="o", a="oa")).replace(
    "{o_keys}", _CONTACT_KEYS.format(p="o.parent_mobile", e="o.parent_email")).replace(
    "{x_keys}", _CONTACT_KEYS.format(p="x.phone", e="x.email")).replace("{ended_plan}", _ENDED_PLAN)

_ROWS_TAIL = """
, out_rows AS MATERIALIZED (
    SELECT p.pid, l.plan_id, CAST(NULL AS varchar) AS enr_id, 'in_window' AS plan_timing,
           COALESCE(l.enr_day, CASE WHEN p.is_conv THEN CAST(p.converted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz AS date) END,
                    CAST(l.plan_created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz AS date)) AS admission_date
    FROM per p
    JOIN lines l ON l.pid = p.pid AND l.in_window
    UNION ALL
    SELECT * FROM (
        SELECT DISTINCT ON (p.pid) p.pid, l.plan_id, CAST(NULL AS varchar), 'outside_window',
               CAST(p.converted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz AS date)
        FROM per p JOIN lines l ON l.pid = p.pid
        WHERE p.has_plan AND NOT p.plan_in_window AND p.is_conv
        ORDER BY p.pid, CASE WHEN l.plan_status NOT IN {ended_plan} THEN 0 ELSE 1 END, l.plan_created_at DESC, l.plan_id) old
    UNION ALL
    SELECT u.pid, CAST(NULL AS varchar), u.id, CASE WHEN u.user_plan_id IS NULL THEN 'none' ELSE 'elsewhere' END, u.enr_day
    FROM unmatched_enr u
    UNION ALL
    SELECT p.pid, CAST(NULL AS varchar), CAST(NULL AS varchar), 'none',
           CAST(p.converted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz AS date)
    FROM per p
    WHERE NOT p.has_plan AND NOT p.is_enr
), picked AS MATERIALIZED (
    SELECT r.*, p.is_conv, p.is_enr, p.late_conversion, p.lead_state, p.plan_state, p.linked_person_id, p.opted_out, p.converted_at, p.assigned_counselor_id, p.best_score_response_id, p.best_source_type
    FROM out_rows r JOIN per p ON p.pid = r.pid
    WHERE {filters}
), page AS MATERIALIZED (
    SELECT r.*, COUNT(*) OVER () AS matched
    FROM picked r
    ORDER BY r.admission_date DESC NULLS LAST, r.pid, r.plan_id NULLS LAST, r.enr_id
    LIMIT :lim OFFSET :off
), final AS (
SELECT pg.*, (SELECT COUNT(DISTINCT x.pid) FROM picked x) AS matched_people, mp.here AS has_mapping,
       st.full_name AS student_name, st.mobile_number AS student_phone, st.email AS student_email,
       ll.lead_id, ll.parent_name, ll.parent_mobile, ll.parent_email,
       COALESCE(lu.user_id, pg.assigned_counselor_id) AS counsellor_id,
       fe.audience_id AS list_id, fe.campaign_name AS list_name,
       CASE WHEN NULLIF(TRIM(fe.campaign_type), '') IS NOT NULL THEN TRIM(fe.campaign_type)
            ELSE COALESCE(fe.source_type, pg.best_source_type) END AS source_key,
       CASE WHEN NULLIF(TRIM(fe.campaign_type), '') IS NOT NULL OR fe.source_type IS NOT NULL THEN 'enquiry'
            WHEN pg.best_source_type IS NOT NULL THEN 'profile' ELSE 'none' END AS source_origin,
       up.status AS plan_status, up.created_at AS plan_created_at, ei.name AS plan_name, po.type AS plan_type,
       CASE WHEN po.type = 'CPO' THEN COALESCE(sc.expected, 0)
            WHEN up.id IS NOT NULL THEN COALESCE(pp.actual_price, 0) * COALESCE(up.quantity, 1) END AS billed,
       CASE WHEN po.type = 'CPO' THEN COALESCE(sc.paid, 0)
            WHEN up.id IS NOT NULL THEN COALESCE(lg.paid, 0) END AS paid,
       {plan_currency} AS currency,
       CASE WHEN po.type = 'CPO' THEN NULL ELSE lg.other END AS paid_other_currency,
       crs.courses, crs.batches, crs.enrolled_on, crs.enrolment_status,
       ap.id AS admission_package_id, ap.net_total AS package_total, ap.discount_total AS package_discount
FROM page pg
CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM student_session_institute_group_mapping sm
                   WHERE sm.user_id = pg.pid AND sm.institute_id = :inst) AS here
) mp
LEFT JOIN LATERAL (
    SELECT s0.full_name, s0.mobile_number, s0.email FROM student s0
    WHERE s0.user_id = pg.pid AND mp.here ORDER BY s0.updated_at DESC NULLS LAST, s0.id LIMIT 1
) st ON TRUE
LEFT JOIN LATERAL (
    SELECT r.id AS lead_id,
           CASE WHEN ow.opted THEN NULL ELSE r.parent_name END AS parent_name,
           CASE WHEN ow.opted THEN NULL ELSE r.parent_mobile END AS parent_mobile,
           CASE WHEN ow.opted THEN NULL ELSE r.parent_email END AS parent_email
    FROM audience_response r
    JOIN audience a0 ON a0.id = r.audience_id AND a0.institute_id = :inst
    CROSS JOIN LATERAL (
        SELECT r.user_id IS DISTINCT FROM pg.pid AND EXISTS (
            SELECT 1 FROM audience_response o JOIN audience oa ON oa.id = o.audience_id AND oa.institute_id = :inst
            WHERE (o.user_id = r.user_id OR o.student_user_id = r.user_id)
              AND (o.overall_status = 'OPTED_OUT' OR {on_list_o})) AS opted
    ) ow
    WHERE (r.user_id = pg.pid OR r.student_user_id = pg.pid) AND r.audience_status = 'ACTIVE' AND NOT {on_list_r}
    ORDER BY ow.opted, (r.overall_status IS NOT DISTINCT FROM 'OPTED_OUT'), r.submitted_at DESC NULLS LAST, r.id LIMIT 1
) ll ON TRUE
LEFT JOIN LATERAL (
    SELECT fr.source_type, fa.campaign_type, fa.campaign_name, fr.audience_id
    FROM audience_response fr
    JOIN audience fa ON fa.id = fr.audience_id AND fa.institute_id = :inst
    WHERE (fr.user_id = pg.pid OR fr.student_user_id = pg.pid) AND NOT {on_list_f}
    ORDER BY {fe_order} LIMIT 1
) fe ON TRUE
LEFT JOIN audience_response br ON br.id = pg.best_score_response_id
LEFT JOIN LATERAL (
    SELECT l.user_id FROM linked_users l
    WHERE l.source = 'ENQUIRY' AND l.source_id = br.enquiry_id
    ORDER BY l.created_at DESC LIMIT 1
) lu ON TRUE
LEFT JOIN user_plan up ON up.id = pg.plan_id
LEFT JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
LEFT JOIN payment_option po ON po.id = up.payment_option_id
LEFT JOIN payment_plan pp ON pp.id = up.plan_id
LEFT JOIN LATERAL (
    SELECT SUM(f.amount_expected) AS expected, SUM(COALESCE(f.amount_paid, 0)) AS paid
    FROM student_fee_payment f
    WHERE f.user_plan_id = pg.plan_id AND f.institute_id = :inst
      AND f.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED')
) sc ON TRUE
LEFT JOIN LATERAL (
    SELECT SUM(x.paid) FILTER (WHERE x.cur IS NULL OR x.cur = {plan_currency}) AS paid,
           json_agg(json_build_object('currency', x.cur, 'paid', x.paid) ORDER BY x.cur)
               FILTER (WHERE x.cur IS NOT NULL AND x.cur IS DISTINCT FROM {plan_currency}) AS other
    FROM (SELECT {log_currency} AS cur, SUM(l.payment_amount) AS paid FROM payment_log l
          WHERE l.user_plan_id = pg.plan_id AND l.payment_status = 'PAID' GROUP BY 1) x
) lg ON TRUE
LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT p2.package_name, ' | ') AS courses, string_agg(DISTINCT ps2.name, ' | ') AS batches,
           string_agg(DISTINCT m.status, ' | ') AS enrolment_status,
           MIN({enr_day_m}) AS enrolled_on
    FROM student_session_institute_group_mapping m
    JOIN package_session ps2 ON ps2.id = m.package_session_id
    JOIN package p2 ON p2.id = ps2.package_id
    WHERE m.user_id = pg.pid AND m.institute_id = :inst AND (m.user_plan_id = pg.plan_id OR m.id = pg.enr_id)
      AND {counted_m}
) crs ON TRUE
LEFT JOIN admission_package_course apc ON apc.user_plan_id = pg.plan_id
LEFT JOIN admission_package ap ON ap.id = apc.admission_package_id AND ap.institute_id = :inst
)
SELECT * FROM final ORDER BY admission_date DESC NULLS LAST, pid, plan_id NULLS LAST, enr_id""".replace(
    "{enr_day_m}", _ENR_DAY.format(m="m")).replace("{on_list_o}", _ON_LIST.format(r="o", a="oa")).replace(
    "{on_list_r}", _ON_LIST.format(r="r", a="a0")).replace("{on_list_f}", _ON_LIST.format(r="fr", a="fa")).replace(
    "{counted_m}", _COUNTED.format(m="m")).replace("{plan_currency}", _PLAN_CURRENCY).replace(
    "{log_currency}", _LOG_CURRENCY).replace("{ended_plan}", _ENDED_PLAN)

_TOTALS_TAIL = """
, plan_paid AS MATERIALIZED (
    SELECT l.user_plan_id, ln.pid, ln.in_window
    FROM lines ln JOIN payment_log l ON l.user_plan_id = ln.plan_id AND l.payment_status = 'PAID'
    UNION
    SELECT ln.plan_id, ln.pid, ln.in_window
    FROM lines ln
    JOIN user_plan up ON up.id = ln.plan_id
    JOIN payment_option po ON po.id = up.payment_option_id AND po.type = 'CPO'
    WHERE EXISTS (SELECT 1 FROM student_fee_payment f
                  WHERE f.user_plan_id = ln.plan_id AND f.institute_id = :inst AND f.amount_paid > 0
                    AND f.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED'))
), paid_people AS MATERIALIZED (
    SELECT pid, BOOL_OR(in_window) AS paid_on_window_plan FROM plan_paid GROUP BY pid
), m AS MATERIALIZED (
    SELECT ln.plan_id,
           {plan_currency} AS currency,
           CASE WHEN po.type = 'CPO' THEN COALESCE(sc.expected, 0) ELSE COALESCE(pp.actual_price, 0) * COALESCE(up.quantity, 1) END AS billed,
           CASE WHEN po.type = 'CPO' THEN COALESCE(sc.paid, 0) ELSE COALESCE(lg.paid, 0) END AS paid,
           po.type IS DISTINCT FROM 'CPO' AND lg.other AS has_other
    FROM lines ln
    JOIN user_plan up ON up.id = ln.plan_id
    JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
    LEFT JOIN payment_option po ON po.id = up.payment_option_id
    LEFT JOIN payment_plan pp ON pp.id = up.plan_id
    LEFT JOIN (SELECT f.user_plan_id, SUM(f.amount_expected) AS expected, SUM(COALESCE(f.amount_paid, 0)) AS paid
               FROM student_fee_payment f
               WHERE f.institute_id = :inst AND f.status NOT IN ('DELETED', 'CANCELLED', 'DROPPED', 'WAIVED')
               GROUP BY f.user_plan_id) sc ON sc.user_plan_id = ln.plan_id
    LEFT JOIN LATERAL (
        SELECT SUM(l.payment_amount) FILTER (WHERE {log_currency} IS NULL OR {log_currency} = {plan_currency}) AS paid,
               BOOL_OR({log_currency} IS NOT NULL AND {log_currency} IS DISTINCT FROM {plan_currency}) AS other
        FROM payment_log l
        WHERE l.user_plan_id = ln.plan_id AND l.payment_status = 'PAID'
    ) lg ON TRUE
    WHERE ln.in_window AND ln.plan_status = 'ACTIVE'
), other_paid AS MATERIALIZED (
    SELECT {log_currency} AS currency, SUM(l.payment_amount) AS paid
    FROM m
    JOIN payment_log l ON l.user_plan_id = m.plan_id AND l.payment_status = 'PAID'
    WHERE m.has_other AND {log_currency} IS NOT NULL AND {log_currency} IS DISTINCT FROM m.currency
    GROUP BY 1
)
SELECT COUNT(*) AS people, COUNT(*) FILTER (WHERE per.is_conv) AS converted, COUNT(*) FILTER (WHERE per.is_enr) AS enrolled,
       COUNT(*) FILTER (WHERE per.is_conv AND per.is_enr) AS both_bases,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'active_enquiry' AND per.has_plan) AS conv_live_plan,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'active_enquiry' AND per.has_plan AND pd.pid IS NOT NULL) AS conv_live_plan_paid_ever,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'active_enquiry' AND pd.paid_on_window_plan) AS conv_live_paid_window_plan,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'active_enquiry' AND NOT per.has_plan) AS conv_live_no_plan,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'no_enquiry_on_record') AS conv_no_enquiry,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'no_enquiry_on_record' AND pd.pid IS NOT NULL) AS conv_no_enquiry_paid_ever,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'no_enquiry_on_record' AND pd.paid_on_window_plan) AS conv_no_enquiry_paid_window_plan,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'enquiry_deleted') AS conv_enquiry_deleted,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'enquiry_deleted' AND pd.pid IS NOT NULL) AS conv_enquiry_deleted_paid_ever,
       COUNT(*) FILTER (WHERE per.is_conv AND per.lead_state = 'enquiry_deleted' AND pd.paid_on_window_plan) AS conv_enquiry_deleted_paid_window_plan,
       COUNT(*) FILTER (WHERE per.is_conv AND per.plan_before) AS conv_plan_before_window,
       COUNT(*) FILTER (WHERE per.late_conversion) AS late_conversions,
       COUNT(*) FILTER (WHERE per.plan_state = 'plan_in_window') AS ps_plan_in_window,
       COUNT(*) FILTER (WHERE per.plan_state = 'plan_after_window') AS ps_plan_after_window,
       COUNT(*) FILTER (WHERE per.plan_state = 'older_plan_only') AS ps_older_plan_only,
       COUNT(*) FILTER (WHERE per.plan_state = 'ended_plans_only') AS ps_ended_plans_only,
       COUNT(*) FILTER (WHERE per.plan_state = 'plan_on_linked_person') AS ps_plan_on_linked_person,
       COUNT(*) FILTER (WHERE per.plan_state = 'plan_elsewhere') AS ps_plan_elsewhere,
       COUNT(*) FILTER (WHERE per.plan_state = 'no_plan') AS ps_no_plan,
       COUNT(*) FILTER (WHERE per.opted_out) AS opted_out,
       (SELECT json_agg(json_build_object('currency', x.currency, 'plans', x.n, 'billed', x.b, 'paid', x.p) ORDER BY x.currency NULLS LAST)
          FROM (SELECT u.currency, SUM(u.n) AS n, SUM(u.b) AS b, SUM(u.p) AS p
                  FROM (SELECT currency, COUNT(*) AS n, SUM(billed) AS b, SUM(paid) AS p FROM m GROUP BY currency
                        UNION ALL
                        SELECT currency, 0, 0, paid FROM other_paid) u
                  GROUP BY u.currency) x) AS money,
       (SELECT json_agg(json_build_object('status', z.status, 'people', z.n) ORDER BY z.status)
          FROM (SELECT status, COUNT(DISTINCT pid) AS n FROM enr GROUP BY status) z) AS enrolled_by_status,
       (SELECT json_agg(json_build_object('month', y.month, 'enrolled', y.e, 'converted', y.c) ORDER BY y.month)
          FROM (SELECT COALESCE(a.month, b.month) AS month, COALESCE(a.n, 0) AS e, COALESCE(b.n, 0) AS c
                  FROM (SELECT to_char(enr_day, 'YYYY-MM') AS month, COUNT(DISTINCT pid) AS n FROM enr GROUP BY 1) a
                  FULL JOIN (SELECT to_char(converted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz, 'YYYY-MM') AS month, COUNT(*) AS n
                             FROM per WHERE is_conv GROUP BY 1) b ON a.month = b.month) y) AS by_month
FROM per LEFT JOIN paid_people pd ON pd.pid = per.pid""".replace("{plan_currency}", _PLAN_CURRENCY).replace(
    "{log_currency}", _LOG_CURRENCY)


#: The moment an admission row's last enquiry must not be after: the conversion for a person converted in the
#: window, else the end of the admission day in the institute's timezone.
_LAST_BEFORE = ("((pg.is_conv AND pg.converted_at IS NOT NULL AND fr.created_at <= pg.converted_at) "
                "OR (NOT (pg.is_conv AND pg.converted_at IS NOT NULL) AND fr.created_at < "
                "CAST(((CAST(pg.admission_date AS timestamp) + INTERVAL '1 day') AT TIME ZONE :tz) "
                "AT TIME ZONE 'UTC' AS timestamp)))")
#: Which enquiry gives a row its list and source. An argument only ever selects one of these.
#: first: the earliest; last: the latest on or before the admission, else (all came after it) the earliest.
FE_ORDER = {"first": "fr.created_at, fr.id",
            "last": f"CASE WHEN {_LAST_BEFORE} THEN fr.created_at END DESC NULLS LAST, fr.created_at, fr.id"}


def totals_sql() -> str:
    return "-- crm_money.admissions_totals\n" + _BASE + _TOTALS_TAIL


def rows_sql(filters: str, attribution: str = "first") -> str:
    return ("-- crm_money.admissions_rows\n" + _BASE
            + _ROWS_TAIL.replace("{filters}", filters).replace("{fe_order}", FE_ORDER[attribution]))


def window_binds(inst: str, w: "cd.Window") -> Dict[str, Any]:
    w_from, w_to = w.utc_naive()
    return {"inst": inst, "tz": w.tz, "d_from": w.start.date(), "d_to": w.end.date(), "w_from": w_from, "w_to": w_to}


# ── report slot ──────────────────────────────────────────────────────────

_slot_lock = threading.Lock()
_running: Set[str] = set()


def try_acquire(inst: str) -> Optional[Dict[str, Any]]:
    """None when this report may run, else the refusal. Safe from any loop or thread; pair with ``release``."""
    retry = random.randint(10, 30)
    with _slot_lock:
        if inst in _running:
            return cd.err("rate_limited", limit_type="report_running", retry_after_s=retry, retryable=True,
                          started=False, changed=False,
                          message="This institute's admissions report is already running. Wait for it, then retry.")
        if len(_running) >= MAX_REPORTS_PER_POD:
            return cd.err("server_busy", retry_after_s=retry, retryable=True, started=False, changed=False,
                          message=f"Vacademy is busy right now. This call did not run and nothing changed. "
                                  f"Retry in about {retry} seconds. This is not caused by your usage.")
        _running.add(inst)
    return None


def release(inst: str) -> None:
    with _slot_lock:
        _running.discard(inst)


# ── running the statements (worker thread) ───────────────────────────────

@contextmanager
def own_session(ctx: ToolContext) -> Iterator[Session]:
    """A short session on the tool session's engine, so the report does not hold the tool session's connection."""
    db = Session(bind=ctx.db.get_bind(), future=True, expire_on_commit=False)
    try:
        yield db
    finally:
        try:
            db.rollback()
        finally:
            db.close()


async def in_thread(fn: Callable[..., Any], *args: Any) -> Any:
    """
    ``fn(*args, stop=event)`` on a worker thread, waited for to its end. A cancel sets
    ``stop``, which ends ``fn`` after its current statement, and is passed on only then,
    so the report slot, the call's slot and the connection all come back together.
    """
    stop = threading.Event()
    call = functools.partial(contextvars.copy_context().run, fn, *args, stop=stop)
    thread = asyncio.get_running_loop().run_in_executor(None, call)
    cancelled: Optional[asyncio.CancelledError] = None
    while not thread.done():
        try:
            await asyncio.wait({thread})
        except asyncio.CancelledError as exc:
            stop.set()
            cancelled = exc
    if cancelled is not None:
        if not thread.cancelled():
            thread.exception()
        raise cancelled
    return thread.result()


def _run_statements(rctx: ToolContext, statements: Sequence[Tuple[str, Dict[str, Any]]],
                    stop: Optional[threading.Event]) -> Optional[List[List[Dict]]]:
    out = []
    for sql, params in statements:
        if stop is not None and stop.is_set():
            return None
        found, ok = cd.rows(rctx, sql, params, timeout_ms=STATEMENT_TIMEOUT_MS)
        if not ok:
            return None
        out.append(found)
    return out


def query(ctx: ToolContext, statements: Sequence[Tuple[str, Dict[str, Any]]],
          stop: Optional[threading.Event] = None) -> Optional[List[List[Dict[str, Any]]]]:
    """Each statement's rows, or None when one fails or ``stop`` is set."""
    with own_session(ctx) as db:
        return _run_statements(dataclasses.replace(ctx, db=db), statements, stop)


_EXPORT_CAP_SQL = """-- crm_money.admissions_export_cap
SELECT COUNT(*) AS used, MIN(created_at) AS oldest FROM mcp_file_export
WHERE institute_id = :i AND created_by_user_id = :u AND kind = 'CRM_ADMISSIONS' AND created_at > :since"""


def _hourly_refusal(row: Dict[str, Any], now: datetime) -> Optional[Dict[str, Any]]:
    if int(row.get("used") or 0) < EXPORTS_PER_HOUR:
        return None
    oldest = row.get("oldest")
    if isinstance(oldest, datetime) and oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=timezone.utc)
    wait = int((oldest + timedelta(hours=1) - now).total_seconds()) + 1 if isinstance(oldest, datetime) else 3600
    return cd.err("rate_limited", limit_type="hourly", cap_per_hour=EXPORTS_PER_HOUR, retry_after_s=max(1, wait),
                  started=False, changed=False,
                  message=f"At most {EXPORTS_PER_HOUR} admissions files an hour. Use the link you already have, or "
                          "try again later.")


def query_export(ctx: ToolContext, statements: Sequence[Tuple[str, Dict[str, Any]]],
                 stop: Optional[threading.Event] = None) -> Union[List[List[Dict[str, Any]]], Dict[str, Any]]:
    """The hourly cap, then the statements, on one session. A refusal or ``query_failed`` comes back as a dict."""
    now = datetime.now(timezone.utc)
    with own_session(ctx) as db:
        rctx = dataclasses.replace(ctx, db=db)
        used, ok = cd.rows(rctx, _EXPORT_CAP_SQL, {"i": ctx.principal.institute_id, "u": ctx.principal.user_id,
                                                   "since": now - timedelta(hours=1)},
                           timeout_ms=STATEMENT_TIMEOUT_MS)
        if not ok:
            return cd.err("query_failed")
        refusal = _hourly_refusal(used[0], now) if used else None
        if refusal:
            return refusal
        return _run_statements(rctx, statements, stop) or cd.err("query_failed")


# ── views ────────────────────────────────────────────────────────────────

def _amount(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _count(row: Dict[str, Any], key: str) -> int:
    return int(row.get(key) or 0)


def _json_list(value: Any) -> List[Dict[str, Any]]:
    """json_agg comes back parsed or as text, depending on the driver's type setup."""
    if isinstance(value, str):
        value = json.loads(value)
    return list(value or [])


def totals_view(row: Dict[str, Any]) -> Dict[str, Any]:
    converted, enrolled, both = _count(row, "converted"), _count(row, "enrolled"), _count(row, "both_bases")
    people, late = _count(row, "people"), _count(row, "late_conversions")
    return {
        "people": people,
        "late_conversions": late,
        "people_excluding_late_conversions": people - late,
        "by_basis": {"converted": converted, "enrolled": enrolled, "both": both, "converted_only": converted - both,
                     "enrolled_only": enrolled - both},
        "converted_breakdown": {
            "active_enquiry_with_plan": _count(row, "conv_live_plan"),
            "active_enquiry_with_plan_paid_ever": _count(row, "conv_live_plan_paid_ever"),
            "active_enquiry_paid_on_window_plan": _count(row, "conv_live_paid_window_plan"),
            "active_enquiry_no_plan": _count(row, "conv_live_no_plan"),
            "no_enquiry_on_record": _count(row, "conv_no_enquiry"),
            "no_enquiry_on_record_paid_ever": _count(row, "conv_no_enquiry_paid_ever"),
            "no_enquiry_on_record_paid_on_window_plan": _count(row, "conv_no_enquiry_paid_window_plan"),
            "enquiry_deleted": _count(row, "conv_enquiry_deleted"),
            "enquiry_deleted_paid_ever": _count(row, "conv_enquiry_deleted_paid_ever"),
            "enquiry_deleted_paid_on_window_plan": _count(row, "conv_enquiry_deleted_paid_window_plan"),
            "held_a_plan_before_window": _count(row, "conv_plan_before_window"),
        },
        "by_plan_state": {s: _count(row, "ps_" + s) for s in PLAN_STATES},
        "enrolled_by_status": [{"status": x.get("status"), "people": int(x.get("people") or 0)}
                               for x in _json_list(row.get("enrolled_by_status"))],
        "opted_out": _count(row, "opted_out"),
        "by_month": [{"month": x.get("month"), "enrolled": int(x.get("enrolled") or 0),
                      "converted": int(x.get("converted") or 0)} for x in _json_list(row.get("by_month"))],
        "money": [{"currency": x.get("currency"), "plans": int(x.get("plans") or 0), "billed": _amount(x.get("billed")),
                   "paid": _amount(x.get("paid"))} for x in _json_list(row.get("money"))],
    }


def local_day(value: Any, tz: str) -> Optional[str]:
    """A naive-UTC timestamp as its calendar day in ``tz``; a plain date as is."""
    if value is None:
        return None
    if isinstance(value, datetime):
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(cd.zone(tz) or timezone.utc).date().isoformat()
    return value.isoformat() if isinstance(value, date) else str(value)


def _other_currency(r: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    """Payments logged in a currency other than the row's, per currency; they are in no ``amount_paid``."""
    found = _json_list(r.get("paid_other_currency"))
    return [{"currency": cd.clean(x.get("currency"), 20), "paid": _amount(x.get("paid"))} for x in found] or None


def _contact(r: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], str]:
    """
    (phone, email, contact_source). Per field: the student's own first, then the active
    enquiry's parent_*. contact_source is student, lead, mixed (one of each) or none.
    """
    phone = r.get("student_phone") or r.get("parent_mobile")
    email = r.get("student_email") or r.get("parent_email")
    used = {"student" if own else "lead"
            for value, own in ((phone, r.get("student_phone")), (email, r.get("student_email"))) if value}
    return phone, email, "mixed" if len(used) == 2 else used.pop() if used else "none"


def _known_here(r: Dict[str, Any]) -> bool:
    """Enrolled at this institute at some time, or with an enquiry here, deleted or not."""
    return bool(r.get("has_mapping")) or r.get("lead_state") in ("active_enquiry", "enquiry_deleted")


def _name(r: Dict[str, Any], display: Dict[str, str]) -> Optional[str]:
    found = cd.clean(r.get("student_name"), CSV_TEXT_LIMIT) or cd.clean(r.get("parent_name"), CSV_TEXT_LIMIT)
    return found or (cd.clean(display.get(str(r.get("pid"))), CSV_TEXT_LIMIT) if _known_here(r) else None)


def _file_name(r: Dict[str, Any], display: Dict[str, str]) -> Optional[str]:
    """
    The file's name cell. A name that holds an email or phone number stays out for a
    person who opted out, and when it is their account's name and they have no
    enrolment here.
    """
    name = _name(r, display)
    if not cd.name_is_contact(name):
        return name
    from_account = not (cd.clean(r.get("student_name"), CSV_TEXT_LIMIT) or cd.clean(r.get("parent_name"), CSV_TEXT_LIMIT))
    return None if r.get("opted_out") or (from_account and not r.get("has_mapping")) else name


def _source_view(value: Any) -> Any:
    """A page's source: a fixed label when it holds an email or phone number, else as cd.safe_source shows it."""
    if not value:
        return None
    return UNUSUAL_SOURCE if cd.name_is_contact(value) else cd.safe_source(value)


def _basis(r: Dict[str, Any]) -> str:
    return "both" if r.get("is_conv") and r.get("is_enr") else "converted" if r.get("is_conv") else "enrolled"


def _counts_in_totals(r: Dict[str, Any]) -> bool:
    return r.get("plan_timing") == "in_window" and r.get("plan_status") == "ACTIVE"


def blank_name_ids(rows: Sequence[Dict[str, Any]]) -> List[str]:
    """The people whose name must come from auth-service."""
    return [r["pid"] for r in rows
            if _known_here(r) and not (cd.clean(r.get("student_name")) or cd.clean(r.get("parent_name")))]


def row_view(r: Dict[str, Any], owners: Dict[str, str], display: Dict[str, str], tz: str) -> Dict[str, Any]:
    """One masked row of a page."""
    phone, email, source = _contact(r)
    owner = r.get("counsellor_id")
    return {
        "person_id": r.get("pid"), "lead_id": r.get("lead_id"),
        "name": cd.clean(cd.mask_name(_name(r, display)), PAGE_TEXT_LIMIT),
        "phone": cd.mask_phone(phone), "email": cd.mask_email(email),
        "contact_source": source, "lead_state": r.get("lead_state"), "opted_out": bool(r.get("opted_out")),
        "plan_state": r.get("plan_state"), "linked_person_id": r.get("linked_person_id"),
        "course": cd.clean(r.get("courses") or r.get("plan_name"), PAGE_TEXT_LIMIT),
        "batch": cd.clean(r.get("batches"), PAGE_TEXT_LIMIT), "plan": cd.clean(r.get("plan_name"), PAGE_TEXT_LIMIT),
        "plan_id": r.get("plan_id"), "plan_status": r.get("plan_status"), "plan_type": r.get("plan_type"),
        "plan_timing": r.get("plan_timing"), "enrolment_status": r.get("enrolment_status"),
        "counts_in_totals": _counts_in_totals(r), "late_conversion": bool(r.get("late_conversion")),
        "fee_billed": _amount(r.get("billed")),
        "amount_paid": _amount(r.get("paid")), "currency": r.get("currency"),
        "paid_other_currency": _other_currency(r),
        "admission_package": ({"id": r["admission_package_id"], "total": _amount(r.get("package_total")),
                               "discount": _amount(r.get("package_discount"))}
                              if r.get("admission_package_id") else None),
        "admission_date": local_day(r.get("admission_date"), tz), "enrolled_on": local_day(r.get("enrolled_on"), tz),
        "converted_on": local_day(r.get("converted_at"), tz), "plan_created_on": local_day(r.get("plan_created_at"), tz),
        "basis": _basis(r),
        "counsellor": {"counsellor_id": owner, "name": cd.mask_name(owners.get(owner)) or None} if owner else None,
        "list_id": r.get("list_id"), "list": cd.clean(r.get("list_name"), PAGE_TEXT_LIMIT),
        "source": _source_view(r.get("source_key")),
        "source_origin": r.get("source_origin"),
    }


def page_rows(rows: Sequence[Dict[str, Any]], owners: Dict[str, str], display: Dict[str, str], tz: str,
              spare_bytes: int) -> List[Dict[str, Any]]:
    """
    The masked rows that fit ``spare_bytes`` of reply, from the first and at least
    one. The rest are on the next page: text is never cut to make room.
    """
    out: List[Dict[str, Any]] = []
    used = 2
    for r in rows:
        view = row_view(r, owners, display, tz)
        used += len(json.dumps(view, ensure_ascii=False, default=str).encode("utf-8")) + 2
        if out and used > spare_bytes:
            break
        out.append(view)
    return out


CSV_COLUMNS = ("admission_date", "basis", "name", "phone", "email", "contact_source", "course", "batch", "plan",
               "plan_status", "plan_type", "plan_timing", "plan_state", "enrolment_status", "counts_in_totals",
               "late_conversion", "fee_billed", "amount_paid", "currency", "paid_other_currency", "admission_package_id", "package_total", "enrolled_on",
               "converted_on", "plan_created_on", "counsellor", "list", "source", "source_origin", "lead_state",
               "opted_out", "linked_person_id", "person_id", "lead_id", "plan_id")


def _csv_value(value: Any) -> Any:
    if isinstance(value, bool):
        return "true" if value else "false"
    return value if isinstance(value, (int, float, Decimal)) else cd.csv_cell(value)


def csv_row(r: Dict[str, Any], owners: Dict[str, str], display: Dict[str, str], tz: str) -> List[Any]:
    """One row of the file, in CSV_COLUMNS order, with full contact except for people who opted out."""
    phone, email, source = _contact(r)
    name = _file_name(r, display)
    source_cell = cd.clean(r.get("source_key"))
    if r.get("opted_out"):
        phone, email, source = None, None, None
        source_cell = None if cd.name_is_contact(source_cell) else source_cell
    owner = r.get("counsellor_id")
    other = " | ".join(f"{x['currency']} {x['paid']}" for x in _other_currency(r) or [])
    return [_csv_value(v) for v in (
        local_day(r.get("admission_date"), tz), _basis(r), name, cd.clean(phone, CSV_TEXT_LIMIT),
        cd.clean(email, CSV_TEXT_LIMIT), source, cd.clean(r.get("courses") or r.get("plan_name"), CSV_TEXT_LIMIT),
        cd.clean(r.get("batches"), CSV_TEXT_LIMIT), cd.clean(r.get("plan_name"), CSV_TEXT_LIMIT),
        r.get("plan_status"), r.get("plan_type"), r.get("plan_timing"), r.get("plan_state"),
        r.get("enrolment_status"), _counts_in_totals(r), bool(r.get("late_conversion")), r.get("billed"), r.get("paid"), r.get("currency"),
        other, r.get("admission_package_id"), r.get("package_total"), local_day(r.get("enrolled_on"), tz),
        local_day(r.get("converted_at"), tz), local_day(r.get("plan_created_at"), tz),
        cd.clean(owners.get(owner) or owner), cd.clean(r.get("list_name"), CSV_TEXT_LIMIT), source_cell,
        r.get("source_origin"), r.get("lead_state"), bool(r.get("opted_out")), r.get("linked_person_id"),
        r.get("pid"), r.get("lead_id"), r.get("plan_id"))]


def store_export(ctx: ToolContext, file_name: str, rows: Sequence[Dict[str, Any]], owners: Dict[str, str],
                 display: Dict[str, str], tz: str, metadata: Dict[str, Any],
                 stop: Optional[threading.Event] = None) -> Optional[ExportHandle]:
    """
    Build the CSV and store it encrypted, on a worker thread. Stores nothing, and
    returns None, when ``stop`` is set by then.
    """
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_COLUMNS)
    for r in rows:
        writer.writerow(csv_row(r, owners, display, tz))
    if stop is not None and stop.is_set():
        return None
    with own_session(ctx) as db:
        return create_export(db, institute_id=ctx.principal.institute_id, user_id=ctx.principal.user_id,
                             source_tool=SOURCE_TOOL, kind=EXPORT_KIND, file_name=file_name, content=buf.getvalue(),
                             metadata=metadata)


__all__ = ["BASIS", "PLAN", "LEAD", "FE_ORDER", "PLAN_STATES", "LEAD_STATES", "CSV_COLUMNS", "MAX_ROWS_PAGED", "PAGE_END_NOTE", "MAX_PAGE_BYTES",
           "EXPORT_KIND", "EXPORT_MAX_ROWS", "EXPORTS_PER_HOUR", "MAX_REPORTS_PER_POD", "filters_sql", "totals_sql",
           "rows_sql", "window_binds", "try_acquire", "release", "own_session", "in_thread", "query", "query_export",
           "totals_view", "local_day", "blank_name_ids", "row_view", "page_rows", "csv_row", "store_export"]
