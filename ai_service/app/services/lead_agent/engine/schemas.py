"""Structured outputs the engine asks the model for (passed as ``OutputModel`` to an injected ``ask``).

Extraction and discovery replies accept empty text: an empty quote, name or question drops that
one item (or gets a default) when the lead is assembled, instead of failing the whole reply.

Field descriptions are sent to the model as part of the JSON schema. Hard constraints are
kept only where a wrong value would be unsafe or meaningless (product keys, page types,
counts). Free-text lengths and list sizes are *guidance* in the description and are
trimmed on the way in, so a slightly long answer is shortened rather than failing a run.
The engine separately clamps anything that controls research effort to its own limits.
"""

from __future__ import annotations

import typing

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

# "offer" = the agent's own offer (brief["offer"], engine/offer.py); the others are Vacademy's products.
ProductKey = Literal["complete_vacademy", "crm", "lms", "ai_calling", "tutezy", "offer"]
PRODUCT_NAMES: dict[str, str] = {
    "complete_vacademy": "Complete Vacademy",
    "crm": "CRM",
    "lms": "LMS",
    "ai_calling": "AI Calling",
    "tutezy": "Tutezy",
}

PageType = Literal["home", "about", "team", "admissions", "courses", "careers", "contact", "branches", "news"]


def _clip_text(limit: int) -> BeforeValidator:
    def clip(value: Any) -> Any:
        if isinstance(value, str):
            value = " ".join(value.split())
            return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"
        return value

    return BeforeValidator(clip)


def _clip_list(limit: int) -> BeforeValidator:
    return BeforeValidator(lambda value: value[:limit] if isinstance(value, list) else value)


def _clamp(low: int, high: int) -> BeforeValidator:
    return BeforeValidator(
        lambda v: max(low, min(high, v)) if isinstance(v, int) and not isinstance(v, bool) else v
    )


Text80 = Annotated[str, _clip_text(80)]
Text120 = Annotated[str, _clip_text(120)]
Text160 = Annotated[str, _clip_text(160)]
Text200 = Annotated[str, _clip_text(200)]
Text240 = Annotated[str, _clip_text(240)]
Text300 = Annotated[str, _clip_text(300)]


class ResearchPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: Text300 = Field(min_length=1, description="One sentence restating what will be researched (max 300 characters).")
    segment: Text120 = Field(min_length=1, description="Type of organisation, e.g. 'coaching institutes', 'logistics companies' (max 120 characters).")
    locations: Annotated[list[Text80], _clip_list(10)] = Field(
        description="Cities or regions to cover; empty if none was given (max 10)."
    )
    target_products: Annotated[list[ProductKey], _clip_list(5)] = Field(
        min_length=1, description="Products to assess, by key."
    )
    candidate_count: Annotated[int, _clamp(1, 200)] = Field(
        description="Number of organisations requested; 20 if not stated."
    )
    priority_signals: Annotated[list[Text160], _clip_list(10)] = Field(
        description="Observable signals to prioritise, e.g. 'recent admissions activity' (max 10, short phrases)."
    )
    buyer_roles: Annotated[list[Text80], _clip_list(10)] = Field(
        description="Roles likely to own the purchase, e.g. 'owner', 'admissions head' (max 10)."
    )
    search_queries: Annotated[list[Text120], _clip_list(20)] = Field(
        description="Short web-search queries that find candidate organisations' own websites, including the "
        "location, e.g. 'coaching institute Pune JEE NEET' (max 20)."
    )
    hiring_roles: Annotated[list[Text60], _clip_list(6)] = Field(
        default_factory=list,
        description="Job titles whose hiring shows the organisation needs what is being sold, e.g. 'telecaller' "
        "for an AI calling product, 'sales executive' for a CRM (max 6, short).",
    )
    keywords: Annotated[list[Text60], _clip_list(10)] = Field(
        default_factory=list,
        description="8-10 short phrases a buyer (not a seller) writes when they need what is being sold, e.g. "
        "'looking for LMS', 'which LMS for coaching institute', 'LMS tender'.",
    )
    search_term: Text40 = Field(
        description="The organisation type as a 1-3 word search term, singular, e.g. 'coaching institute', 'school', "
        "'training institute'."
    )
    page_types: Annotated[list[PageType], _clip_list(9)] = Field(
        min_length=1, description="Website sections most likely to show the priority signals."
    )
    assumptions: Annotated[list[Text240], _clip_list(8)] = Field(
        description="Interpretations made where the request was unclear (max 8)."
    )
    not_possible: Annotated[list[Text200], _clip_list(8)] = Field(
        description="Parts of the request this system cannot deliver, e.g. verified direct phone numbers, "
        "personal emails, budgets or confirmed purchase intent (max 8)."
    )


class DiscoveredOrganisation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result_id: int = Field(description="The [id] of the search result that is this organisation's own website.")
    name: Text120 = Field(
        description="The organisation's name as shown in that result. Do not invent or expand names."
    )
    reason: Text80 = Field(
        description="A few words on why it fits, e.g. 'own site, JEE coaching in Indore'."
    )


class DiscoverySelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organisations: Annotated[list[DiscoveredOrganisation], _clip_list(60)] = Field(
        description="Organisations to research, best matches first. Empty if none qualify."
    )


SignalKey = Literal[
    "explicit_software_need", "admissions_open", "enquiry_forms", "high_call_volume", "hiring",
    "hiring_faculty", "multiple_branches", "new_centre", "online_courses", "test_series", "large_scale",
    "own_app_or_portal",
    # An offer's own fit signals (engine/offer.py CUSTOM_KEYS); the prompt lists the ones a run uses.
    "fit_1", "fit_2", "fit_3", "fit_4", "fit_5", "fit_6", "fit_7", "fit_8",
]
Text40 = Annotated[str, _clip_text(40)]


class Cite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int = Field(description="The page id number, e.g. 2 for [P2].")
    quote: Text200 = Field(
        description="Exact words copied from that page that support the item (max 200 characters)."
    )


class Branch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Text120 = Field(description="Branch or centre name or area, as written.")
    city: Text80 | None = Field(description="City, if stated.")
    cite: Cite


class Signal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signal: SignalKey
    observation: Text200 = Field(description="What the page shows, in one short sentence.")
    event_date: Text40 | None = Field(description="A date shown on the page for this, exactly as written; null if none.")
    cite: Cite


class Person(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Text80 = Field(description="The person's name exactly as written on the page.")
    role: Text80 = Field(description="Their role or title exactly as written, e.g. 'Founder & Director'.")
    cite: Cite


class SoftwareMention(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Text120 = Field(description="A tool, app, portal or platform the organisation visibly uses.")
    cite: Cite


class JobPostDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Text120 = Field(description="The job title as written.")
    openings: Text40 | None = Field(description="Number of openings, as written; null if not shown.")
    experience: Text80 | None = Field(description="Experience required, as written; null if not shown.")
    salary: Text80 | None = Field(description="Salary or pay, as written; null if not shown.")
    location: Text80 | None = Field(description="Job location, as written; null if not shown.")
    posted: Text40 | None = Field(description="When it was posted, as written (e.g. '3 days ago'); null if not shown.")
    requirements: Text240 = Field(description="The key requirements and duties, briefly, in the page's words.")
    cite: Cite


class AccountExtraction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organisation_name: Text120 = Field(description="The organisation's name as shown on its website.")
    is_target_segment: bool = Field(description="True if this organisation matches the requested segment and location.")
    what_they_do: Text240 = Field(description="What the organisation offers, in one sentence.")
    sells_the_offer: bool = Field(
        default=False,
        description="True if the organisation itself sells, makes, installs or resells what is being sold: a "
        "competitor or reseller, not a buyer.",
    )
    city: Text80 | None = Field(description="Main city, if stated.")
    branches: Annotated[list[Branch], _clip_list(15)] = Field(description="Centres or branches named on the pages.")
    signals: Annotated[list[Signal], _clip_list(15)] = Field(description="Buying signals shown on the pages.")
    people: Annotated[list[Person], _clip_list(12)] = Field(
        description="Named people with a role (owners, directors, heads, managers), only as written on the pages."
    )
    current_software: Annotated[list[SoftwareMention], _clip_list(5)] = Field(
        description="Software, apps or portals they visibly use."
    )
    job_posts: Annotated[list[JobPostDetail], _clip_list(5)] = Field(
        default_factory=list,
        description="Job posts on the pages (especially 'job_post' pages): one entry per post. Empty if none.",
    )
    unknowns: Annotated[list[Text160], _clip_list(8)] = Field(
        description="Important things a salesperson would want to know that the pages do not show."
    )
    discovery_question: Text240 = Field(
        description="One question a salesperson should ask first, based on the evidence."
    )
    summary: Text300 = Field(description="Two short sentences on why this organisation may or may not be a fit.")


# Discovery may also report keyword matches (only keyword-search results can show them).
DiscoverySignalKey = Literal[(*typing.get_args(SignalKey), "keyword_need")]  # type: ignore[valid-type]


class SignalFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result_id: int = Field(description="The [id] of the search result showing the signal.")
    organisation_name: Text120 = Field(
        description="The organisation that is hiring or asking, as written. Not the job portal, recruiter or placement agency."
    )
    signal: DiscoverySignalKey
    role_or_need: Text120 = Field(description="The job title being hired for, or what they are looking for, as written.")
    quote: Text200 = Field(description="Exact words copied from that result's title or snippet that show the signal.")
    event_date: Text40 | None = Field(description="A date or age shown in the result (e.g. '3 days ago'), exactly as written; null if none.")
    location: Text80 | None = Field(description="Location shown in the result, if any.")


class SignalSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    findings: Annotated[list[SignalFinding], _clip_list(40)] = Field(
        description="Organisations showing a buying signal, strongest first. Empty if none qualify."
    )


Text60 = Annotated[str, _clip_text(60)]


class IndustrySuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Text80 = Field(description="The industry or kind of organisation, e.g. 'Coaching institutes', 'Real estate developers'.")
    search_term: Text40 = Field(description="The organisation type as a 1-3 word singular search term, e.g. 'coaching institute'.")
    fit: Literal["high", "medium", "low"] = Field(
        description="How strongly this industry needs the product: high = most such organisations need it and are "
        "core buyers; medium = many could use it; low = only some would."
    )
    why: Text240 = Field(description="Why organisations in this industry need the product, in one or two sentences.")
    products: Annotated[list[ProductKey], _clip_list(5)] = Field(description="Which of the products fit this industry.")
    buyer_roles: Annotated[list[Text80], _clip_list(5)] = Field(description="Roles that usually buy it, e.g. 'owner', 'sales head'.")
    hiring_phrases: Annotated[list[Text60], _clip_list(3)] = Field(
        description="Short job-post phrases that show the need, e.g. 'hiring telecaller', 'hiring admission counsellor'."
    )
    need_phrases: Annotated[list[Text60], _clip_list(3)] = Field(
        description="Short phrases an organisation would post when looking for the product, e.g. 'looking for CRM software'."
    )


CompetitorKind = Literal["lms", "crm", "whatsapp", "chat", "payments", "website"]
COMPETITOR_KIND_KEYS = typing.get_args(CompetitorKind)


def _known(allowed: tuple[str, ...]) -> BeforeValidator:
    """Drops list items outside allowed, so one stray value does not fail the whole reply."""
    return BeforeValidator(lambda value: [v for v in value if v in allowed] if isinstance(value, list) else value)


class FitSignalSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: Text60 = Field(description="A short name, e.g. 'Runs a fleet', 'Online courses', 'Several factories'.")
    description: Text200 = Field(
        description="What on the organisation's own website shows it, in one sentence, so a reader can check a page "
        "for it, e.g. 'The site says it operates its own trucks or a delivery fleet.'"
    )
    weight: Annotated[int, _clamp(1, 3)] = Field(description="How strongly it shows a fit: 1 low, 2 medium, 3 high.")


class CompetitorSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Text80 = Field(description="A product or company that sells the same thing.")
    domain: Text80 | None = Field(description="Its website domain, e.g. 'zoho.com', only if you are sure; else null.")


def _all_required(schema: dict[str, Any]) -> None:
    schema["required"] = list(schema.get("properties") or {})


class ProductProfile(BaseModel):
    # Every field is required in the schema the model sees (it skips optional ones), while parsing
    # keeps the defaults for older replies.
    model_config = ConfigDict(extra="forbid", json_schema_extra=_all_required)

    summary: Text300 = Field(description="What the product does, in one or two sentences, from the information given.")
    industries: Annotated[list[IndustrySuggestion], _clip_list(8)] = Field(
        description="Industries that need the product, best fit first (up to 8)."
    )
    keywords: Annotated[list[Text60], _clip_list(10)] = Field(
        default_factory=list,
        description="8-10 short phrases a buyer (not a seller) writes when they need this product, e.g. "
        "'looking for LMS', 'rooftop solar tender'.",
    )
    # What the brief form stores as the offer (engine/offer.py). After the fields above: a reply that
    # starts with them tends to run on (GLM Flash, 2026-10-26).
    offer_name: Text80 = Field(default="", description="What is sold, as a short name, e.g. 'Rooftop solar installation'.")
    fit_signals: Annotated[list[FitSignalSuggestion], _clip_list(8)] = Field(
        default_factory=list,
        description="4-8 things on a prospect's own website that show it fits what is sold (it has the problem "
        "this solves). Not hiring, tenders or size.",
    )
    competitors: Annotated[list[CompetitorSuggestion], _clip_list(8)] = Field(
        default_factory=list,
        description="Real, named products or companies that sell the same thing (up to 8); empty if you know none.",
    )
    competitor_kinds: Annotated[list[CompetitorKind], _known(COMPETITOR_KIND_KEYS), _clip_list(6)] = Field(
        default_factory=list,
        description="Only if what is sold is software: which of lms, crm, whatsapp, chat, payments, website compete "
        "with it. Empty otherwise.",
    )
    education: bool = Field(default=False, description="True only if most buyers are education providers.")
    discovery_question: Text160 = Field(
        default="", description="The first question to ask a prospect about how they handle this today."
    )


class LookupPerson(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result: int = Field(description="The number of the search result that shows this person, e.g. 2 for [R2].")
    name: Text80 = Field(description="The person's name exactly as written in that result.")
    role: Text80 = Field(description="Their role at the organisation as written, e.g. 'Founder & Director'.")
    phone: Text40 | None = Field(description="A phone number printed right next to their name in that result; null if none.")
    email: Text120 | None = Field(description="An email address printed right next to their name in that result; null if none.")
    quote: Text240 = Field(description="Exact words copied from that result showing the name, and the phone or email if given.")


class ContactLookup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    people: Annotated[list[LookupPerson], _clip_list(4)] = Field(
        description="People who work at this organisation (owners and leaders first), at most 4. Empty if none."
    )


class ReachResearch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audience: Text240 = Field(description="Who buys this product (organisations and the roles who decide), in one sentence.")
    buyer_roles: Annotated[list[Text80], _clip_list(5)] = Field(description="Roles that decide the purchase, e.g. 'coaching institute owner'.")
    queries: Annotated[list[Text120], _clip_list(8)] = Field(
        description="6-8 web searches that find where these buyers gather: online communities and groups, "
        "associations, trade events and expos, publications, newsletters, YouTube channels or podcasts they follow, "
        "and the platforms they use for business. Include the location."
    )


class ContentIdea(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Text60 = Field(description="The kind of post or video, e.g. '45-second screen recording', 'carousel post', 'case-study post'.")
    hook: Text160 = Field(description="The opening line or first 3 seconds.")
    message: Text240 = Field(description="The one point the content makes, in the buyer's words.")
    call_to_action: Text80 = Field(description="What the viewer should do next, e.g. 'Book a 15-minute demo'.")


class ReachChannel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: Text60 = Field(description="The channel, specific, e.g. 'LinkedIn Ads', 'Coaching owners' Facebook groups', 'EdTech expo stalls'.")
    kind: Literal["paid_ads", "organic_social", "community", "event", "partnership", "search_ads", "email", "other"]
    fit: Literal["high", "medium", "low"] = Field(description="How well it reaches the buyers named above.")
    why: Text240 = Field(description="Why the buyers can be reached here.")
    targeting: Annotated[list[Text80], _clip_list(6)] = Field(
        description="How to reach them on this channel: job titles, interests, keywords, groups, event names. Only names seen in the results or general categories."
    )
    content_ideas: Annotated[list[ContentIdea], _clip_list(2)] = Field(description="1-2 content ideas for this channel.")
    sources: Annotated[list[int], _clip_list(3)] = Field(
        description="Numbers of the search results that show the buyers are here, e.g. [2, 5]. Empty if none."
    )


class ReachPlanOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: Text300 = Field(description="The approach in two sentences.")
    channels: Annotated[list[ReachChannel], _clip_list(6)] = Field(description="4-6 channels, best first.")
    avoid: Annotated[list[Text160], _clip_list(5)] = Field(
        description="Things not to do: ad-policy and claim risks, channels that would waste money for this audience."
    )


class AdSetup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: Text60 = Field(description="The paid channel this is for, exactly as named in the plan.")
    objective: Text120 = Field(description="The campaign objective to choose and why, e.g. 'Lead generation with an in-platform lead form: owners can enquire without leaving'.")
    audience: Annotated[list[Text80], _clip_list(6)] = Field(
        description="Targeting settings: locations, languages, job titles or functions, company type, keywords. Broad enough to reach every relevant buyer."
    )
    keep_broad: Text160 = Field(description="Which filters not to add because they would shrink the audience needlessly.")
    placements: Annotated[list[Text60], _clip_list(4)] = Field(description="Where the ad should show, e.g. 'LinkedIn feed', 'Google Search'.")
    formats: Annotated[list[Text80], _clip_list(4)] = Field(description="Ad formats and versions to prepare, e.g. 'single image 1:1 and 4:5', '15-second vertical video with captions'.")
    test_variations: Annotated[list[Text120], _clip_list(3)] = Field(description="2-3 headline, image or video variations to compare.")
    measure: Annotated[list[Text60], _clip_list(4)] = Field(description="What to watch, e.g. 'unique reach', 'frequency', 'qualified enquiries'.")


class AdSetupPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ads: Annotated[list[AdSetup], _clip_list(3)] = Field(description="One set-up per paid channel, best first.")


class SearchQueryList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queries: Annotated[list[Text120], _clip_list(200)] = Field(
        description="Distinct web searches that each find different organisations' own websites."
    )
