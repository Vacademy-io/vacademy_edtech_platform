package vacademy.io.admin_core_service.features.workflow.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import vacademy.io.admin_core_service.features.workflow.service.TriggerContextKeyRegistry;

/**
 * AI-grade grounding schema for the workflow drafter (see WORKFLOW_AI_ASSIST_DESIGN.md).
 *
 * The plain {@code /catalog/*} endpoints describe query INPUTS for the human builder's
 * dropdowns. An LLM that generates a whole workflow JSON needs more: each query's OUTPUT
 * keys and per-item field names, which nodes are safe / mutating / dead, the hard
 * generation rules, and the exact workflow JSON shape. This endpoint returns all of that
 * as one document so the drafter can ground a single completion.
 *
 * This is static, code-grounded metadata (verified against QueryServiceImpl and the node
 * handlers on 2026-07-07). Institute-specific grounding (real audiences / batches /
 * templates) is assembled by the drafter at request time, not here.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/v1/workflow/ai-catalog")
@RequiredArgsConstructor
public class WorkflowAiCatalogController {

    private final TriggerContextKeyRegistry triggerContextKeyRegistry;

    @GetMapping
    public ResponseEntity<Map<String, Object>> getAiCatalog() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", "2026-09-11");
        out.put("workflowJsonShape", workflowJsonShape());
        out.put("generationRules", generationRules());
        out.put("nodeTypes", nodeTypes());
        out.put("readQueries", readQueries());
        out.put("mutatingQueryKeys", new ArrayList<>(
                vacademy.io.admin_core_service.features.workflow.engine.MutatingQueryKeys.KEYS));
        // Exact parameter contracts — the generator MUST use these names verbatim
        // (audited failure: drafts inventing liveSessionId/scheduledDate/sessionType).
        out.put("mutatingQueryParams", m(
                "createLiveSession",
                "params: title (required), createdByUserId (REQUIRED - omitting fails silently per item), "
                        + "status ('LIVE'), accessLevel ('private'), linkType ('youtube'), "
                        + "sessionStreamingServiceType ('embed'), defaultMeetLink, timezone ('Asia/Kolkata'), "
                        + "waitingRoomTime (int), subject, learnerButtonConfig (JSON string OR SpEL-built "
                        + "List of {text,url,background_color,text_color,visible} maps), "
                        + "startTime + lastEntryTime (ZonedDateTime — build with "
                        + "T(java.time.ZonedDateTime).of(T(java.time.LocalDate).now(zone), T(java.time.LocalTime).of(5,30), zone)). "
                        + "instituteId auto-injected. OUTPUT: sessionId — inside an ITERATOR the result merges "
                        + "INTO the item, so later nodes read #ctx['item']['sessionId'] (NOT liveSessionId).",
                "createSessionSchedule",
                "params: sessionId (= #ctx['item']['sessionId'] from createLiveSession), recurrenceType ('once'), "
                        + "meetingDate (java.sql.Date — T(java.sql.Date).valueOf(T(java.time.LocalDate).now(zone))), "
                        + "startTime + lastEntryTime (java.sql.Time — T(java.sql.Time).valueOf('05:30:00')), "
                        + "linkType, customMeetingLink, status ('LIVE'), dailyAttendance (true). "
                        + "Returns NO scheduleId and its success status is the literal 'SUCCEESS' (typo, do not fix).",
                "createSessionParticipent",
                "params: sessionId, sourceId (the packageSessionId), sourceType ('BATCH' uppercase, or 'USER').",
                "getOrCreateShortLink",
                "params: destinationUrl (required — the long URL), source (e.g. 'LEARNER_JOIN'), sourceId "
                        + "(optional shortCode asks for a readable code, e.g. the learner's mobile number, "
                        + "giving u.<host>/s/919829227181; ignored once a link exists, and a taken code "
                        + "gets a random suffix. Only use it where the destination needs a login — a "
                        + "readable code is a guessable one.) "
                        + "(e.g. the learner's userId), instituteId (pass #ctx['instituteId'] explicitly inside "
                        + "an iterator). Idempotent per (source,sourceId): the same learner keeps the same URL "
                        + "across daily runs instead of minting a code per send. OUTPUT: shortUrl — inside an "
                        + "ITERATOR it merges INTO the item, so a SEND node uses #item['shortUrl']. Falls back to "
                        + "the long URL when media_service is unreachable, so the link is never empty. Deliberately "
                        + "NOT gated in Test Run: it writes only a short-link row, and gating it would make dry-run "
                        + "messages carry a blank link."));
        out.put("unsafeInDryRun", List.of(
                "SET_LEAD_STATUS (mutates lead status even in Test Run)",
                "COMBOT (sends real WhatsApp even in Test Run)"));
        out.put("avoidNodeTypes", m(
                "ROUTER", "In the enum + FE palette but has NO handler — a workflow containing it cannot execute that node.",
                "SEND_PUSH_NOTIFICATION", "Stub — logs and returns status 'dispatched' without sending. Do not use."));
        out.put("commonTriggers", commonTriggers());
        // Every #ctx key each event puts on the seed context, from the same registry the
        // validator enforces. Inlined because the model cannot follow the URLs under
        // `references` — audited failure: the drafter invented #ctx['lead'] for
        // AUDIENCE_LEAD_SUBMISSION and the trigger silently never ran.
        out.put("triggerContextKeys", triggerContextKeys());
        out.put("engineContextKeys", "Present on every event run in addition to triggerContextKeys: "
                + String.join(", ", TriggerContextKeyRegistry.ENGINE_KEYS)
                + ". Only triggerId, eventName, eventId exist while the idempotency key is evaluated.");
        out.put("references", m(
                "allTriggerEvents", "/admin-core-service/v1/workflow/catalog/trigger-events",
                "leadContextVariables", "/admin-core-service/v1/workflow/catalog/trigger-context-variables",
                "allQueryParams", "/admin-core-service/v1/workflow/catalog/query-keys",
                "actions", "/admin-core-service/v1/workflow/catalog/actions"));
        return ResponseEntity.ok(out);
    }

    /** The exact JSON the drafter must emit, matching what the builder persists. */
    private Map<String, Object> workflowJsonShape() {
        Map<String, Object> shape = new LinkedHashMap<>();
        shape.put("name", "string");
        shape.put("description", "string");
        shape.put("workflow_type", "EVENT_DRIVEN | SCHEDULED");
        shape.put("trigger", m(
                "trigger_event_name", "e.g. AUDIENCE_LEAD_SUBMISSION (EVENT_DRIVEN only)",
                "event_applied_type", "e.g. AUDIENCE (metadata only — does NOT scope matching)",
                "event_id", "specific entity id, or null for 'all'",
                "idempotency_generation_setting", "optional JSON object controlling execution dedup — see the idempotency generation rule"));
        shape.put("schedule", m(
                "schedule_type", "CRON (SCHEDULED only)",
                "cron_expression", "Quartz 6-field, e.g. 0 0 9 * * ? = 9AM daily",
                "timezone", "e.g. Asia/Kolkata"));
        shape.put("nodes", List.of(m(
                "id", "client-generated uuid (referenced by edges + routing)",
                "name", "human label",
                "node_type", "TRIGGER | QUERY | SEND_EMAIL | ... (flat field, NOT nested under data)",
                "config", m("...", "per-node config incl. routing[]"),
                "position_x", 250,
                "position_y", 80,
                "is_start_node", "true for the TRIGGER / first node, else false")));
        shape.put("edges", List.of(m(
                "id", "client-generated uuid",
                "source_node_id", "<nodeId>",
                "target_node_id", "<nodeId>")));
        return shape;
    }

    /** Hard rules the generator must obey — each encodes an audited failure mode. */
    private List<String> generationRules() {
        return List.of(
            "QUERY 'resultKey' is IGNORED — reference a query's real output keys (e.g. 'students', 'leads', 'ssigm_list'), never a made-up key. Two queries emitting the same key clobber each other.",
            "SEND_EMAIL / SEND_WHATSAPP 'on' must resolve to a List. Wrap a single object as a SpEL list literal: \"{#ctx['user']}\".",
            "Recipient and templateVars field names must exist in the source query's output item fields. Casing differs per query (snake_case vs camelCase) — copy from readQueries[].itemFields.",
            "Trigger scoping is by event_id only; event_applied_type is metadata and does NOT scope. Set event_id to a real institute-owned entity, or null for 'all'.",
            "Idempotency: set trigger.idempotency_generation_setting. Per-person flows (enrollment/lead drips) need CUSTOM_EXPRESSION including the person, e.g. {\"strategy\":\"CUSTOM_EXPRESSION\",\"customExpression\":\"'wf_' + #ctx['triggerId'] + '_' + #ctx['eventId'] + '_' + #ctx['user']['id']\"}. The person key MUST be one the event actually emits (see triggerContextKeys): #ctx['user']['id'] only where 'user' is listed; otherwise the id key that IS listed (#ctx['userId'], #ctx['responseId'], #ctx['leadId'], #ctx['userPlanId']). A key that is not there makes the SpEL throw and the trigger is skipped with NO execution row. EVENT_BASED is ONLY for periodic-scan emitters (LIVE_SESSION_START/END, MEMBERSHIP_EXPIRY) — its key has no person in it, so on an enrollment event it would let only the first learner ever enter. Omitted = UUID = no dedup (event retries double-fire).",
            "Trigger context keys are a closed list: only reference #ctx['<key>'] values listed for the event in triggerContextKeys / commonTriggers[].producedContextKeys, in engineContextKeys, or produced by an upstream node in this graph. Never invent a key such as 'lead' or 'student' — a missing key yields null (or throws when indexed), and a send node's 'on' of \"{#ctx['missing']}\" sends nothing.",
            "Mutating prebuilt keys (see mutatingQueryKeys) are allowed ONLY when the goal explicitly asks to create/modify data (e.g. 'create the live sessions every morning'). They are skipped in Test Run (dryRun gate), but ALWAYS warn in rationale that the workflow writes real data when active. Never use them for read/reporting goals.",
            "Never use ROUTER (no handler) or SEND_PUSH_NOTIFICATION (stub). See avoidNodeTypes.",
            "DELAY config is nested: config.delay.{value,unit} or config.delay.{until:NEXT_DAY_OF_WEEK,dayOfWeek,time,timezone}. Never flat delayValue/delayUnit (executes as 0-delay).",
            "A multi-day drip/nurture sequence is ONE event-driven workflow: TRIGGER -> [DELAY until weekday, if it must start on a fixed day] -> SEND -> DELAY {value,unit} -> SEND -> ... -> end. Never one workflow per message, never a LOOP node for the days.",
            "Every node must be reachable from the start node; every path must reach a routing {type:end}; every routing targetNodeId must reference a real node id.",
            "templateName must reference an ACTIVE institute template of the right channel (EMAIL/WHATSAPP). If none exists, ask the admin to create it rather than inventing one.",
            "RUN-TIME TEMPLATE CHOICE (SEND_WHATSAPP only): templateName may be an expression instead of a literal name when the message legitimately differs run to run — e.g. a per-weekday class where Sunday is a different session. Write it as a single reference, \"#ctx['todaysTemplate']\", and do the choosing in a TRANSFORM row, so the Configuration tab stays readable. Values not starting with '#' or 'T(' are treated as literal names exactly as before. CONSTRAINT: templateVars is ONE map for the node, so every template it can resolve to MUST take the same variables in the same positions — a template with a different variable count fails at Meta with error 132000. Prefer a literal name unless the goal actually asks for different copy on different runs.",
            "All entity ids (event_id, batchId, audienceId, ...) must belong to the requesting institute — never cross-tenant.",
            "Warn (in rationale) when using INVITE_FORM_FILL (fires on invite-page view, not submit) or LIVE_SESSION_START/END (5-min scan approximations).",
            "ADMIN-EDITABLE PER-DAY SEQUENCE (scheduled roster drip): when a daily message's content depends on each learner's OWN day-in-program (day 1..N since enrollment) and admins must edit each day's text, do NOT use the DELAY-chain drip. Build ONE SCHEDULED workflow: TRIGGER named 'Workflow settings' (outputDataPoints value rows hold every editable setting: template name, link bases, timing text) -> QUERY getSSIGMByStatusAndPackageSessionIds -> one SEND_WHATSAPP node PER DAY named 'Day N message — <topic>'. Each day node filters the roster inline: on = \"#ctx['ssigmList'].?[#this['enrolledDate'] != null && T(java.time.temporal.ChronoUnit).DAYS.between(T(java.time.LocalDate).parse(new java.text.SimpleDateFormat('yyyy-MM-dd').format(#this['enrolledDate'])), T(java.time.LocalDate).now(T(java.time.ZoneId).of('Asia/Kolkata'))) + 1 == N]\" with forEach.eval = \"#ctx['item']\" and node-level templateName/languageCode/templateVars. Day nodes chain goto day1->day2->...->dayN->end (non-matching days simply send nothing).",
            "ADMIN-EDITABILITY: in templateVars, day-specific message text MUST be plain literal strings (admins edit them in the Configuration tab); use '#'-prefixed SpEL ONLY for auto-filled values (learner name via item field 'name', links like \"#ctx['joinBaseUrl'] + #item['username']\", dates). Name logic nodes with a '(do not edit)' suffix. Editable settings live as TRIGGER outputDataPoints VALUE rows and are referenced from other nodes via #ctx['<fieldName>'].",
            "TRIGGER outputDataPoints rows are evaluated against the ORIGINAL context — one row canNOT reference another trigger row. Derived values (e.g. a computed day key or a looked-up sub-map) go in a TRANSFORM node placed after the trigger: TRANSFORM rows DO evaluate sequentially and can reference earlier rows.",
            "DAILY SESSION-CREATOR PATTERN (mutating): to create live sessions every morning for a batch, build a SCHEDULED workflow: [1] TRIGGER 'Workflow settings' with a sessions spec as a VALUE array of objects — a REAL JSON array, never a JSON-encoded string (a string cannot be iterated) — with every string field SpEL-quoted for OBJECT_PARSER, e.g. \"'Yoga'\"; plus editable link/time settings; [2] optional TRANSFORM for derived values; [3] ACTION ITERATOR forEach OBJECT_PARSER over the spec; [4] ACTION ITERATOR forEach QUERY createLiveSession; [5] ACTION ITERATOR forEach QUERY createSessionSchedule; [6] ACTION ITERATOR forEach QUERY createSessionParticipent. Use the EXACT parameter names and output keys from catalog.mutatingQueryParams — never invent parameter names. Always warn in rationale that this writes real sessions when active (Test Run skips the writes).",
            "NESTED ITERATORS (cross-product, e.g. every learner into every one of today's sessions) HAVE TWO RULES THAT ARE EASY TO GET WRONG AND FAIL SILENTLY. (1) SHAPE: the inner iterator's 'on' and 'forEach' sit DIRECTLY on the forEach object — {\"forEach\":{\"operation\":\"ITERATOR\",\"on\":\"#ctx['learners']\",\"forEach\":{\"operation\":\"QUERY\",...}}}. Do NOT wrap them in a \"config\" block the way the OUTER ACTION node does: the engine converts the inner forEach straight to IteratorConfigDTO, so a nested \"config\" leaves getOn() null and the whole inner loop no-ops with 'missing_on_expression'. (2) BINDING: the inner item is bound as #ctx['item1'], NOT #ctx['item'] — 'item' still refers to the OUTER item throughout. So the outer slot's id stays \"#ctx['item']['sessionId']\" while the inner learner is \"#ctx['item1']['userId']\". Writing #ctx['item']['userId'] inside the inner loop reads the outer object, yields null, and every row fails. Nesting is one level (index is always 1).",
            "NULL-GUARD DATE PARSING IN FILTER/SELECTION CONDITIONS: new java.text.SimpleDateFormat('yyyy-MM-dd').format(x) throws on a null date, and one learner with a null enrolledDate aborts the whole node. Always lead the condition with the null check, e.g. \"#ctx['item']['enrolledDate'] != null && T(java.time.temporal.ChronoUnit).DAYS.between(...) + 1 > 14\".",
            "WEEKDAY-VARYING CLASSES: when classes differ by day of week, do NOT build one node per weekday. Keep ONE settings row per class slot and give the row its own columns — {\"time\",\"entryEnd\",\"days\":\"MON,WED,FRI\",\"link\",\"template\",\"title\"} — where a BLANK column means 'use the workflow default'. A TRANSFORM then derives todayDow (LocalDate.now(zone).getDayOfWeek().name().substring(0,3)), todaysSlots (select rows whose days is blank or contains todayDow), and first-non-blank picks for the day's link/template/title. Iterators run 'on' todaysSlots and the SEND is gated so a rest day sends nothing rather than announcing a class that does not exist. Adding a Saturday class is then one new row, which a non-technical admin can do.",
            "ROW TYPES ARE STRICT: a TRIGGER/TRANSFORM outputDataPoints row holding an EXPRESSION (T(...), inline lists/maps, #ctx refs) MUST be a 'compute' row — a 'value' row is stored as a LITERAL (a value row containing \"T(java.util.Arrays).asList(...)\" stays a raw string and breaks every consumer). 'value' rows are for plain admin-editable text/links and real JSON arrays/objects only. Same discipline in QUERY params: a param string is passed literally unless it starts with '#' — put expressions in a compute row and reference them as \"#ctx['<fieldName>']\", never inline T(...) in a param.",
            "ITERATOR QUERY PARAMS ARE ALL SPEL-EVALUATED (unlike a plain QUERY node, where only '#'-prefixed params are): inside ACTION/ITERATOR forEach params every string is parsed as an expression, so literals MUST be quoted (\"'LIVE'\", \"'USER'\", \"'Asia/Kolkata'\") or they blow up as unknown identifiers. ALSO: instituteId is auto-injected ONLY for plain QUERY nodes — inside an iterator you MUST pass \"instituteId\": \"#ctx['instituteId']\" explicitly or createLiveSession fails with 'Missing required parameters' on every item.",
            "NUMBER TYPES: values computed from dates (ChronoUnit.DAYS.between + 1) are Long while numbers parsed from config JSON are Integer, and Set.contains()/List.contains() are type-strict — a HashSet of Longs never matches an Integer. When matching computed day numbers against configured ones, compare STRINGS on both sides (e.g. build keys like 'day' + #this['trialDay'] and match #this['dayKey']). SpEL '==' on numbers is safe; .contains() is not.",
            "SPEL HAS NO LAMBDAS OR STREAMS: 's -> ...', .stream(), .flatMap(...) and .collect(...) are NOT valid SpEL and throw at runtime — there is NO way to flatten a list of lists. When you need a cross-product (e.g. day x time-slot), pre-build the FLAT array in the TRIGGER settings as a real JSON array and narrow it at runtime with a selection, e.g. \"#ctx['daySlotSpecs'].?[#ctx['activeDayKeys'].contains(#this['dayKey'])]\" — never build nested lists and try to flatten them. Use selection \"list.?[<predicate on #this>]\", projection \"list.![<expr>]\", first-match \"list.^[<predicate>]\", and 'new java.util.HashSet(...).size()' for distinct counts. To attach per-item derived fields, use ACTION ITERATOR forEach SPEL_EVALUATOR (eval = field name, compute = expression) — not a TRANSFORM building maps of the whole list.",
            "ATTENDANCE RECAP PATTERN: per-learner weekly attendance messages = SCHEDULED: [1] settings TRIGGER (incl. compute row weekDates = list of this week's 7 ISO dates via TemporalAdjusters.previousOrSame(MONDAY).plusDays(n).toString()); [2] QUERY getSSIGMByStatusAndPackageSessionIds; [3] QUERY fetch_batch_attendance_report (params batchId, daysBack 7); [4] ACTION ITERATOR SPEL_EVALUATOR stamping myAtt = \"#ctx['students'] == null ? null : #ctx['students'].^[#this['studentId'] == #ctx['item']['userId']]\"; [5] further SPEL_EVALUATOR stamps off myAtt['sessions'] (per-day presence via .?[#this['meetingDate'] == <date> && #this['attendanceStatus'] == 'PRESENT'].size() > 0, distinct days via new java.util.HashSet(sessions.?[...].![#this['meetingDate']]).size()); [6] SEND_WHATSAPP over the stamped roster.");
    }

    private List<Map<String, Object>> nodeTypes() {
        List<Map<String, Object>> nodes = new ArrayList<>();
        nodes.add(node("TRIGGER", "Marks the start node; can seed context via outputDataPoints.", true, false,
                "{\"outputDataPoints\":[{\"fieldName\":\"joinBaseUrl\",\"value\":\"https://...\"},{\"fieldName\":\"psIds\",\"compute\":\"T(java.util.Arrays).asList('<id>')\"}],\"routing\":[{\"type\":\"goto\",\"targetNodeId\":\"...\"}]}",
                "isStartNode=true on its mapping. outputDataPoints VALUE rows are the workflow's admin-editable "
                        + "settings (rendered as plain fields in the Configuration tab) — put every editable text/link "
                        + "there and name the node 'Workflow settings'. Rows are evaluated against the ORIGINAL "
                        + "context: one row cannot reference another (use a TRANSFORM node for derived values)."));
        nodes.add(node("QUERY", "Runs a prebuilt query; flat-merges output keys into context.", true, false,
                "{\"prebuiltKey\":\"fetch_students_by_batch\",\"params\":{\"batchId\":\"#ctx['packageSessionIds']\"},\"routing\":[{\"type\":\"goto\",\"targetNodeId\":\"...\"}]}",
                "resultKey ignored. instituteId auto-injected. NO dryRun gate — mutating keys run for real."));
        nodes.add(node("SEND_EMAIL", "Iterates 'on' (a List) and sends one email per item.", true, false,
                "{\"templateName\":\"...\",\"on\":\"#ctx['students']\",\"forEach\":{\"operation\":\"SEND_EMAIL\",\"eval\":\"#ctx['item']\"},\"recipientField\":\"email\",\"templateVars\":{\"fullName\":\"fullName\"},\"routing\":[{\"type\":\"end\"}]}",
                "'on' must be a List. Recipient resolved from recipientField then to/email/... Rate-limited."));
        nodes.add(node("SEND_WHATSAPP", "Like SEND_EMAIL for WhatsApp; mobile-based recipients.", true, false,
                "{\"templateName\":\"...\",\"on\":\"#ctx['leads']\",\"forEach\":{\"operation\":\"SEND_WHATSAPP\",\"eval\":\"#ctx['item']\"},\"templateVars\":{\"1\":\"full_name\"},\"routing\":[{\"type\":\"end\"}]}",
                "'on' must be a List. Mobile from mobileNumber/mobile_number/mobile/phone/to. Rate-limited. "
                        + "templateVars values resolve per item: '#'-prefixed SpEL (both #ctx and #item bound, e.g. \"#item['full_name']\"), "
                        + "else an item field name (preferred — e.g. \"full_name\"), else sent as a literal. Keys are the Meta template's positional placeholders (\"1\", \"2\", ...)."));
        nodes.add(node("HTTP_REQUEST", "Generic HTTP call; response namespaced under resultKey.", true, false,
                "{\"resultKey\":\"httpResult\",\"config\":{\"requestType\":\"EXTERNAL\",\"method\":\"POST\",\"url\":\"...\",\"body\":{}},\"routing\":[{\"type\":\"end\"}]}",
                "Response at #ctx['<resultKey>']['body']. Optional SpEL 'condition' to skip."));
        nodes.add(node("DELAY", "Pauses; >60s persists and resumes via Quartz (survives restart).", true, false,
                "{\"delay\":{\"value\":3,\"unit\":\"DAYS\"},\"routing\":[{\"type\":\"goto\",\"targetNodeId\":\"...\"}]} OR "
                        + "{\"delay\":{\"until\":\"NEXT_DAY_OF_WEEK\",\"dayOfWeek\":\"MONDAY\",\"time\":\"09:00\",\"timezone\":\"Asia/Kolkata\"},\"routing\":[{\"type\":\"goto\",\"targetNodeId\":\"...\"}]}",
                "Nested delay.{value,unit} (units SECONDS/MINUTES/HOURS/DAYS) for fixed waits. "
                        + "delay.until=NEXT_DAY_OF_WEEK waits until the STRICTLY NEXT occurrence of dayOfWeek at time in timezone "
                        + "(an event on that same weekday waits a full week; set includeSameDay=true to fire the same day when the time is still ahead). "
                        + "Use it to align event-driven sequences to a fixed weekday, e.g. 'trial drip starts next Monday'."));
        nodes.add(node("CONDITION", "Boolean SpEL branch.", true, false,
                "{\"condition\":\"#ctx['enrolled'] == false\",\"routing\":[{\"type\":\"conditional\",\"condition\":\"#ctx['enrolled'] == false\",\"label\":\"true\",\"trueNodeId\":\"<node>\",\"falseNodeId\":\"<node>\"}]}",
                "The SpEL 'condition' MUST also be inside the routing entry (that is what the engine evaluates); routes to trueNodeId when true, falseNodeId when false. Both branch targets must be real node ids."));
        nodes.add(node("FILTER", "Filters a list by a per-item SpEL predicate.", true, false,
                "{\"source\":\"#ctx['leads']\",\"condition\":\"#ctx['item']['age'] > 18\",\"routing\":[{\"type\":\"goto\",\"targetNodeId\":\"...\"}]}",
                "The per-item variable is #ctx['item'] (NOT #item — only #ctx and #dates are bound). "
                        + "OUTPUT KEY IS ALWAYS 'filteredList' (plus filteredCount): resultKey is IGNORED, so "
                        + "downstream nodes must read #ctx['filteredList']. Only one FILTER per path, or the "
                        + "second overwrites the first."));
        nodes.add(node("TRANSFORM", "Computes context fields via SpEL (outputDataPoints).", true, false,
                "{\"outputDataPoints\":[{\"fieldName\":\"whatsappMessages\",\"compute\":\"...SpEL...\"}],\"routing\":[{\"type\":\"goto\",\"targetNodeId\":\"...\"}]}",
                "Returns only the diff, flat-merged."));
        nodes.add(node("ACTION", "ITERATOR data processor: runs a forEach operation per item of a list.", true, false,
                "{\"dataProcessor\":\"ITERATOR\",\"config\":{\"on\":\"#ctx['liveSessions']\",\"forEach\":{\"operation\":\"QUERY\",\"prebuiltKey\":\"createLiveSession\",\"params\":{\"title\":\"#ctx['item']['title']\"}}},\"routing\":[{\"type\":\"goto\",\"targetNodeId\":\"...\"}]}",
                "forEach.operation ∈ OBJECT_PARSER (evaluates every string field of each item as SpEL in place — "
                        + "string literals must be SpEL-quoted like \"'Yoga'\"), QUERY (runs prebuiltKey per item, merges "
                        + "result keys back INTO the item), SPEL_EVALUATOR (stamps eval=<fieldName> with compute's result "
                        + "on each item), SWITCH, SEND_WHATSAPP, HTTP_REQUEST. CAVEAT: an inner error map still counts "
                        + "as a processed success — verify created data, don't trust the success counter."));
        nodes.add(node("SET_LEAD_STATUS", "Sets a CRM lead's status.", false, true,
                "{\"statusKey\":\"INTERESTED\",\"routing\":[{\"type\":\"end\"}]}",
                "Resolves lead by responseId/leadId. NO dryRun gate — mutates in Test Run."));
        nodes.add(node("COMBOT", "Meta Cloud-API WhatsApp send.", false, true,
                "{\"templateName\":\"...\",\"on\":\"#ctx['leads']\",\"routing\":[{\"type\":\"end\"}]}",
                "No dryRun/rate-limit/log/dedup — sends real messages in Test Run. Prefer SEND_WHATSAPP."));
        return nodes;
    }

    /** Read-only queries the generator will actually compose with, plus their output shapes. */
    private List<Map<String, Object>> readQueries() {
        List<Map<String, Object>> q = new ArrayList<>();
        q.add(query("fetch_audience_responses_filtered",
                List.of("instituteId"), List.of("audienceId", "daysAgo", "startDate", "endDate"),
                List.of("leads"),
                "leads[]: email, parentEmail, parentName, mobileNumber, userId, instituteName + all custom fields in RAW case"));
        q.add(query("getAudienceResponsesByDayDifference",
                List.of("instituteId", "audienceId", "daysAgo"), List.of("conversionStatus"),
                List.of("leads"),
                "leads[]: same as filtered but custom-field keys are LOWERCASED. Matches responses exactly N days ago."));
        q.add(query("fetch_batch_attendance_report",
                List.of("instituteId"), List.of("batchId", "daysBack"),
                List.of("students", "totalStudents", "batchCount", "startDate", "endDate"),
                "students[]: studentId, fullName, email, mobileNumber, attendancePercentage, sessionsAttended, totalDurationMinutes, totalChats, totalHandRaises, parentsEmail, guardianEmail, sessionsTableHtml (camelCase)"));
        q.add(query("fetch_students_by_batch",
                List.of("instituteId"), List.of("batchId"),
                List.of("students", "totalStudents"),
                "students[]: userId, fullName, email, mobileNumber, parentsEmail, guardianEmail (camelCase; lightweight, no attendance)"));
        q.add(query("fetch_ssigm_by_package",
                List.of("instituteId"), List.of("batchId", "statusList"),
                List.of("ssigm_list", "mapping_count"),
                "ssigm_list[]: mapping_id, user_id, expiry_date, full_name, mobile_number, email, username, package_session_id (snake_case)"));
        q.add(query("getUpcomingAutopayCharges",
                List.of("packageSessionIds"), List.of("daysAhead", "trialOnly"),
                List.of("autopayDueList", "autopayDueCount"),
                "autopayDueList[]: userPlanId, userId, name, mobileNumber, username, nextChargeAt, "
                        + "endDate, chargeDate ('11 Aug 2026' label), isTrial. THE audience for pre-charge "
                        + "notices ('we auto-deduct tomorrow'): plans whose next charge is exactly daysAhead "
                        + "days away (default 1), autopay still ON — cancelled learners excluded. Use this, "
                        + "NOT ssigm expiryDate (that is the batch ACCESS window, a different date). "
                        + "trialOnly=true keeps only trials ('your free trial ends tomorrow'), false keeps "
                        + "only paying members ('your plan renews tomorrow'), omitted keeps both — a trial's "
                        + "upcoming charge is its FIRST charge and a member's is a RENEWAL, so one wording "
                        + "cannot serve both; split the workflow rather than reword one template."));
        q.add(query("getManualRenewalDuePlans",
                List.of("packageSessionIds"), List.of("daysAhead", "graceDays"),
                List.of("manualRenewalList", "manualRenewalCount"),
                "manualRenewalList[]: userPlanId, userId, name, mobileNumber, username, planStatus, "
                        + "endDate, endDateLabel ('11 Aug 2026'). THE audience for 'pay to continue your "
                        + "membership' messages: plans ending within daysAhead days (default 1) or ended up "
                        + "to graceDays ago (default 2) that autopay will NOT charge (autopay off / "
                        + "CANCELED / PAYMENT_FAILED / EXPIRED). Message link: manage-page base + username."));
        q.add(query("getSSIGMByStatusAndPackageSessionIds",
                List.of("instituteId", "packageSessionIds", "statusList"), List.of(),
                List.of("ssigmList"),
                "ssigmList[]: ssigmId, userId, name, mobileNumber, email, username, packageSessionId, "
                        + "enrolledDate, expiryDate, remainingDays, daysPastExpiry (camelCase). THE roster for "
                        + "per-day sequences: enrolledDate drives day-in-program filters, expiryDate drives "
                        + "'trial ends tomorrow' filters. packageSessionIds/statusList are SpEL list params, "
                        + "e.g. \"#ctx['psIds']\" from a trigger settings row."));
        q.add(query("fetch_institute_admin_emails",
                List.of("instituteId"), List.of("roles"),
                List.of("adminContacts"),
                "adminContacts[]: userId, email, fullName, mobileNumber, role (roles default 'ADMIN,TEACHER')"));
        q.add(query("fetch_expiring_memberships",
                List.of("instituteId"), List.of("daysUntilExpiry"),
                List.of("expiringMemberships", "expiringCount"),
                "expiringMemberships[]: userPlanId, userId, email, fullName, mobileNumber, endDate (institute-scoped, ACTIVE plans expiring within N days)"));
        q.add(query("fetch_live_session_attendance",
                List.of("sessionId", "scheduleId"), List.of(),
                List.of("presentStudents", "absentStudents", "presentCount", "absentCount", "sessionTitle"),
                "present/absentStudents[]: fullName, email, mobileNumber, joinTime, attendedMinutes, attendancePercentage, attendanceBlockHtml"));
        q.add(query("fetch_enrollment_details",
                List.of("userId"), List.of("packageSessionId", "packageSessionIds", "instituteId"),
                List.of("(flat enrollment + payment fields)"),
                "flat camelCase map of the learner's enrollment + payment status; used to gate abandoned-cart / webhook flows"));
        q.add(query("getUpcomingFeeInstallments",
                List.of("instituteId"), List.of("daysBeforeWindow", "daysAfterWindow"),
                List.of("feePaymentList"),
                "feePaymentList[]: learner fee installments due in the window (camelCase)"));
        return q;
    }

    /**
     * producedContextKeys come from {@link TriggerContextKeyRegistry} — the same list the
     * validator enforces — so this text can no longer drift from what the emitters set. The
     * notes carry what a bare key list cannot: types, which key is the person, and traps.
     */
    private List<Map<String, Object>> commonTriggers() {
        List<Map<String, Object>> t = new ArrayList<>();
        t.add(trigger("AUDIENCE_LEAD_SUBMISSION", "AUDIENCE", "audienceId (or null=all)",
                keysOf("AUDIENCE_LEAD_SUBMISSION"),
                "Fires once per form submission with that single lead's data. The person is #ctx['user'] (UserDTO: id, fullName, email, mobileNumber) — there is NO 'lead' key. Send node on = \"{#ctx['user']}\"; idempotency person = #ctx['user']['id'], or #ctx['responseId'] for once-per-submission. customFields is a Map keyed by the form's field labels."));
        t.add(trigger("LEARNER_BATCH_ENROLLMENT", "PACKAGE_SESSION", "packageSessionId (or null=all)",
                keysOf("LEARNER_BATCH_ENROLLMENT"),
                "Person = #ctx['user'] (UserDTO). packageSessionIds is a SINGLE id string despite the plural name. packageName is the course name."));
        t.add(trigger("LIVE_SESSION_CREATE", "LIVE_SESSION", "liveSessionId (or null=all)",
                keysOf("LIVE_SESSION_CREATE"),
                "liveSession has title, startTime, defaultMeetLink...; createdBy is the admin's user id. No student emails in context — add a QUERY to fetch recipients."));
        t.add(trigger("ABANDONED_CART", "ENROLL_INVITE", "enrollInviteId (or null=all)",
                keysOf("ABANDONED_CART"),
                "'user' is present only when the account could be resolved — use #ctx['userId'] as the idempotency person, not #ctx['user']['id']."));
        t.add(trigger("PAYMENT_FAILED", "ENROLL_INVITE", "enrollInviteId (or null=all)",
                keysOf("PAYMENT_FAILED"),
                "The main (first-payment) emitter sets NO 'user' — only userId. 'user' and 'renewal' appear on the renewal-charge emitter. Idempotency person = #ctx['userId'] (or #ctx['userPlanId'])."));
        t.add(trigger("MEMBERSHIP_EXPIRY", "USER_PLAN", "null (institute-wide, daily 09:00 cron)",
                keysOf("MEMBERSHIP_EXPIRY"),
                "Emitted by a daily scheduler, once per expiring plan; ids only (no 'user' object) — QUERY for the learner if a name/email is needed. Use EVENT_BASED idempotency."));
        t.add(trigger("LEAD_ASSIGNED_TO_COUNSELOR", "AUDIENCE", "audienceId or poolId",
                keysOf("LEAD_ASSIGNED_TO_COUNSELOR"),
                "Flat lead keys (leadName, leadEmail, leadMobile, counselorEmail...) — no 'user' object. Idempotency person = #ctx['leadId']."));
        return t;
    }

    private String keysOf(String event) {
        Set<String> keys = triggerContextKeyRegistry.emittedKeys(event);
        return keys == null ? "(not catalogued)" : String.join(", ", keys);
    }

    /** event → comma-joined emitted keys, for every event the registry knows. */
    private Map<String, Object> triggerContextKeys() {
        Map<String, Object> out = new LinkedHashMap<>();
        triggerContextKeyRegistry.allKnown().forEach((event, keys) -> out.put(event, String.join(", ", keys)));
        return out;
    }

    // ---- small builders --------------------------------------------------

    private Map<String, Object> node(String type, String purpose, boolean dryRunSafe, boolean mutating,
                                     String configExample, String notes) {
        Map<String, Object> n = new LinkedHashMap<>();
        n.put("type", type);
        n.put("purpose", purpose);
        n.put("dryRunSafe", dryRunSafe);
        n.put("mutating", mutating);
        n.put("configExample", configExample);
        n.put("notes", notes);
        return n;
    }

    private Map<String, Object> query(String key, List<String> required, List<String> optional,
                                      List<String> outputKeys, String itemFields) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("key", key);
        q.put("requiredParams", required);
        q.put("optionalParams", optional);
        q.put("outputKeys", outputKeys);
        q.put("itemFields", itemFields);
        return q;
    }

    private Map<String, Object> trigger(String event, String appliedType, String eventIdMeaning,
                                        String producedContextKeys, String notes) {
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("event", event);
        t.put("eventAppliedType", appliedType);
        t.put("eventIdMeaning", eventIdMeaning);
        t.put("producedContextKeys", producedContextKeys);
        if (notes != null) t.put("notes", notes);
        return t;
    }

    /** Ordered map from alternating key/value pairs (avoids Map.of's 10-entry cap + null rejection). */
    private Map<String, Object> m(Object... kv) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            map.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return map;
    }
}
