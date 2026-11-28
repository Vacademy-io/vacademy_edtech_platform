# Site Assistant: product requirements

The AI assistant that greets every visitor to an institute's website, whether
it is a site hosted by Vacademy or the institute's own site with our widget
embedded. It answers from what the institute has made public, takes visitors
to the right page or course, tells them what's happening (live classes,
notices), and hands a warm lead to the institute's team when someone wants to
talk.

Status: approved for build, 2026-10-20. Pilot: **Brahm Varchas**
(learning.brahmvarchas.org, then their own Next.js site).

## 1. Owner decisions (2026-10-20)

| Decision | Choice |
|---|---|
| Who pays | The institute, from AI credits. **1 credit per answer.** |
| When to ask for contact details | **Only on intent** (wants to talk, enrol help, a question we can't answer, price negotiation, bulk). Never cold. |
| OTP | Not in v1. |
| Live classes | Sessions marked **PUBLIC** are listed to anonymous visitors, with their registration link. |
| Scope of settings | **Per site.** Knowledge such as FAQs can be shared across an institute's sites. |
| Pilot | Brahm Varchas. |
| Institute's own website | Must work there too, via an embed snippet (the same widget). |

## 2. Who comes, and what they want

| Visitor | What they're trying to do | What success looks like |
|---|---|---|
| **Prospect** (most traffic, anonymous) | Find the right course, understand price/format/language, decide | Lands on the right course page, adds to cart, or leaves a number |
| **Parent** (often for a child) | "Is this right for my 6-year-old?", safety, schedule, language | Gets a clear fit answer and a next step |
| **Enrolled learner, not logged in** | Log in, find their class, "paid but no access" | Sent to login / support quickly, not sold to |
| **Logged-in learner** browsing the site | Another course, a class link | Recognised; no lead form |
| **Curious / brand visitor** | Who are you, philosophy, founders, contact, address | Short answer + the About/Contact page |
| **Others** | Jobs, partnerships, press, vendors | Contact details; never logged as a sales lead |

## 3. What people will actually ask (and how we answer)

Every answer is short (2-4 sentences), grounded in a source, and ends with **one
next step** (a card, a button, or a question). The bot never dead-ends: when it
doesn't know, it says so and offers a person.

| Group | Typical questions | Answered from | Next step offered |
|---|---|---|---|
| **Discovery** | "What courses do you have?", "Anything on parenting?", "Courses for kids", "Free courses?", "In Hindi?", "Most popular?", "Cheapest?" | Courses (Catalogue API filters: stream, category, format, language, price, popular) | 2-4 course cards |
| **Course details** | Price, discounts, duration, format (live/recorded/e-book), language, start date, schedule, access validity, certificate, eligibility/age, syllabus, instructor | Course detail: price, FAQs, outline, authors, course_page_json; site pages | "Open course" / Add to cart; unknown detail → offer a person |
| **Comparison** | "Difference between X and Y?", "Which should I start with?" | Courses, learning paths | Comparison card; the path's first step |
| **Buying** | "How do I enrol?", "Payment methods?", "EMI?", "Is it safe?", "Invoice/GST?" | FAQs, site pages, course | Enrol / cart link; EMI or bulk → lead (intent) |
| **Live / public classes** | "Any free class?", "When is the next live session?", "Is it recorded?" | Public live sessions | Register link |
| **Notices** | "Any new batch?", "Holiday schedule?", "Upcoming events?" | Assistant notices (admin-written, with expiry) | Notice card |
| **Institute** | "Who are you?", founders, philosophy, address, phone, timings, social | Institute KB, About/Contact pages, FAQs | Go to About / Contact |
| **Policies** | Refund, cancellation, privacy, terms | FAQs, policy pages | Go to the policy page |
| **Navigation** | "Where's the blog / resources / contact?" | Site page index | "Take me there" |
| **Support (existing learners)** | Login, password, "paid but no access", certificate download, class link | FAQs; login link | Login link, or support contact. **Tagged support, not a sales lead.** |
| **Sales intent** | "Can someone call me?", "Group/school pricing", "Talk to a counsellor" | — | Contact card (lead) |
| **Domain questions** | "What is Garbha Sanskar?", "Benefits of Ayurveda?" | Only the institute's own content | A short grounded answer + the relevant course. If the content doesn't cover it: say so. |
| **Out of scope** | Homework, weather, coding, news, other institutes | — | Polite decline, steer back |
| **Sensitive** | Medical, pregnancy, mental-health, legal or money advice | — | No advice. Educational framing only; suggest a qualified professional. Distress → a caring fixed reply (no model call). |
| **Abuse** | Jailbreaks, "ignore your instructions", prompt extraction, spam | — | Refuse briefly; caps apply |
| **Small talk** | "Hi", "Thanks", "Who are you?" | Persona | One line + suggested questions |

Hindi or English: the bot answers in the language the visitor writes in.

## 4. Behaviour rules

1. **Facts only from tools.** Prices, dates, links, availability and names come
   from tool results, never from the model's memory. If a tool didn't return it,
   the bot doesn't state it.
2. **Prices follow the site.** If the site hides prices, the bot doesn't reveal
   them. "From ₹X" when versions differ.
3. **One next step, every time.**
4. **Ask for contact details only on intent**, at most once per conversation
   unless the visitor brings it up again. Logged-in learners are never asked.
5. **Coming-soon courses** → "Notify me" (the course's notify campaign).
6. **Unknown answer** → honest "I don't have that detail" + offer a person; the
   question is logged as **unanswered** for the admin.
7. **Short.** No walls of text; cards do the heavy lifting.
8. **Brand voice** from the site's persona setting (warm, formal, …).

## 5. Contact handoff (leads)

- Triggered by intent only. The bot shows a **contact card** inside the chat
  with the campaign's own form fields (name, phone, email, plus custom fields),
  consent text, and why we're asking ("so our counsellor can call you about
  Vedic Parenting").
- It goes through the existing website-lead pipeline: dedupe, scoring and
  counsellor assignment work unchanged. Campaign: chosen per site, optionally
  per stream.
- **The lead carries the context**: course(s) asked about, the page, UTM tags,
  and a 3-line summary of the conversation. The counsellor starts warm.
- **Support requests are not sales leads**: they go to the support contact (or
  a separate campaign) and are tagged so sales teams don't chase existing
  customers.

## 6. Where it appears

- **Hosted sites**: a launcher on every catalogue page (configurable: all,
  catalogue + course pages, or listed routes). Not on login/checkout.
- **The institute's own website**: one script tag. It uses the Catalogue API's
  publishable key and verified-website lock. "Take me there" links point to the
  institute's own pages (learned from their sitemap/URLs via a knowledge base)
  and to course pages.
- One launcher at a time: on the learner dashboard the Student AI stays.

## 7. Admin experience

- **Five-minute setup** in Manage Pages → the site's settings → *Site
  Assistant*: on/off, name and avatar (defaults from the site), greeting,
  persona, suggested questions (defaults from the site's "Popular:" searches),
  where it shows, knowledge switches, linked knowledge bases, lead campaign,
  support contact, daily answer cap.
- **Knowledge**: FAQs and notices (with an end date), shared institute-wide or
  per site. "Draft FAQs from my site" (one-off, credits) to fill the first set.
- **Test before going live**: a preview chat in the admin, plus a starter set of
  test questions for the site.
- **Conversations**: transcripts, which ones produced a lead, thumbs up/down.
- **Unanswered questions** with one-click **Add as FAQ**. This is the loop that
  makes the bot better every week.

## 8. Safety, cost and abuse

- Anonymous by design: the site/institute is resolved on the server (domain
  routing, or the publishable key + verified origin), never trusted from the
  browser. Each conversation has a signed visitor token.
- Caps: per visitor per day, per IP per day, and **per site per day** (default
  300 answers). When the cap or the institute's credits run out, the bot shows
  the contact card instead of failing.
- Platform kill switch. Content from pages and KBs is fenced as data.
- Only public tools; no visitor PII echoed back; no arbitrary URL fetching.
- Transcripts retained 180 days (configurable later); deletable on request.

## 9. Success metrics

| Metric | Target for the pilot |
|---|---|
| Visitors who open the assistant | 5-10% of catalogue visitors |
| Answered (not "I don't know") | ≥ 85% after week 2 |
| Thumbs up rate | ≥ 80% of rated answers |
| Chats that lead to a course page view / cart | track (baseline in pilot) |
| Leads from chat, and their quality (counsellor feedback) | track |
| Price/date accuracy (audited) | 100% |
| First token latency | p50 < 2 s |
| Cost | ≤ 1 credit per answer by design; cost per lead tracked |

## 10. Phases

- **P1 (pilot):** widget on hosted sites + embed snippet; answers from pages,
  courses, FAQs, notices, linked KBs; navigation; public live classes; contact
  handoff; admin settings, knowledge editor, conversations, unanswered list;
  all limits.
- **P2:** Add to cart / checkout from chat, logged-in "my courses / my classes"
  via the Student AI's learner tools, insights dashboard, "draft FAQs from my
  site", blog answers, per-page proactive nudges.
- **P3:** human live handoff in working hours, counsellor booking, WhatsApp
  channel (same brain), voice.

## 11. Open risks

- **Data quality decides answer quality.** Brahm Varchas today has courses with
  no language tags and weak stream tags (see the Catalogue API notes); the bot
  will inherit those gaps. The unanswered list will surface them.
- **Health-adjacent content** (Garbha Vigyan, Ayurveda): strict "educational,
  not medical advice" guardrail.
- **Model latency**: use a fast non-reasoning model; GLM reasoning modes are too
  slow for chat.
