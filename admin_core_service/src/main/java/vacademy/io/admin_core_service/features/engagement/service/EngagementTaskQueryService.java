package vacademy.io.admin_core_service.features.engagement.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.report.EngagementActionOutcomeService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementActionOutcomeService.ActionOutcome;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportDay;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao.Query;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao.TaskRow;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The task inbox as the daily report's drill-down: rows filtered by engine, channel, kind, day,
 * template and outcome, so each number on the report opens the rows behind it; and each row's
 * outcome for the inbox's outcome column. The unfiltered inbox stays on
 * EngagementActionRepository.findInbox; this is only reached when a filter is given.
 */
@Slf4j
@Service
public class EngagementTaskQueryService {

    /** Most rows of one day an outcome filter reads; the newest win past it. */
    static final int MAX_OUTCOME_CANDIDATES = 5000;
    /** Most ids one outcomes lookup takes: an inbox page is at most 200 tasks. */
    public static final int MAX_OUTCOME_LOOKUP = 200;

    static final Set<String> CHANNELS = Set.of("EMAIL", "WHATSAPP", "IN_APP", "AI_CALL");
    static final Set<String> KINDS = Set.of("TASK", "REPLY", "SEND", "NO_OP", "CRM");

    private final EngagementActionRepository actionRepository;
    private final EngagementEngineRepository engineRepository;
    private final EngagementTaskQueryDao dao;
    private final EngagementActionOutcomeService outcomeService;
    private final InstituteTimezoneService timezoneService;

    public EngagementTaskQueryService(EngagementActionRepository actionRepository,
                                      EngagementEngineRepository engineRepository,
                                      EngagementTaskQueryDao dao,
                                      EngagementActionOutcomeService outcomeService,
                                      InstituteTimezoneService timezoneService) {
        this.actionRepository = actionRepository;
        this.engineRepository = engineRepository;
        this.dao = dao;
        this.outcomeService = outcomeService;
        this.timezoneService = timezoneService;
    }

    /** The inbox's optional filters, as the request carries them (blank = not given). */
    public record TaskFilter(String engineId, String channel, String kind, String date, String template,
                             String outcome) {
        public boolean isEmpty() {
            return blank(engineId) && blank(channel) && blank(kind) && blank(date) && blank(template)
                    && blank(outcome);
        }
    }

    /**
     * @throws InvalidRequestException   an unknown channel, kind or outcome; an outcome without a
     *                                   date; a bad date; a negative page
     * @throws ResourceNotFoundException the engine is not one of this institute's
     */
    public Page<EngagementAction> inbox(String instituteId, List<String> statuses, TaskFilter f, int page, int size) {
        if (page < 0) throw new InvalidRequestException("page must be 0 or more");
        if (size < 1) throw new InvalidRequestException("size must be at least 1");
        String channel = oneOf("channel", upper(f.channel()), CHANNELS);
        String kind = oneOf("kind", upper(f.kind()), KINDS);
        String outcome = oneOf("outcome", lower(f.outcome()), EngagementActionOutcomeService.OUTCOMES);
        if (outcome != null && blank(f.date())) {
            throw new InvalidRequestException("outcome needs a date");
        }
        List<String> statusList = statuses.stream().map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
        if (statusList.isEmpty()) throw new InvalidRequestException("statuses is required");
        List<String> engineIds = engineIds(instituteId, trim(f.engineId()));

        EngagementReportDay.Bounds day = null;
        if (!blank(f.date())) {
            ZoneId zone = EngagementReportDay.zone(timezoneService.getTimezoneId(instituteId));
            day = EngagementReportDay.bounds(EngagementReportDay.parse(f.date()), zone);
        }
        List<String> channels = channel == null ? null : List.of(channel);
        if (outcome != null) {
            // Read only the channels the outcome can occur on.
            Set<String> possible = EngagementActionOutcomeService.channelsFor(outcome);
            channels = (channels == null ? List.copyOf(CHANNELS) : channels).stream()
                    .filter(possible::contains).sorted().toList();
        }

        PageRequest pageable = PageRequest.of(page, size);
        if (engineIds.isEmpty() || (channels != null && channels.isEmpty())) return Page.empty(pageable);
        Query q = new Query(instituteId, statusList, engineIds, channels, kind,
                day == null ? null : day.from(), day == null ? null : day.to(),
                day == null ? null : day.scanFrom(), trim(f.template()));

        if (outcome == null) {
            List<String> ids = dao.pageIds(q, size, pageable.getOffset());
            return new PageImpl<>(load(ids), pageable, dao.count(q));
        }
        List<String> matched = matching(instituteId, outcome, dao.rows(q, MAX_OUTCOME_CANDIDATES));
        int from = (int) Math.min(pageable.getOffset(), matched.size());
        int to = Math.min(from + size, matched.size());
        return new PageImpl<>(load(matched.subList(from, to)), pageable, matched.size());
    }

    /** Ids of the rows that count toward the outcome, in the rows' order. */
    List<String> matching(String instituteId, String outcome, List<TaskRow> rows) {
        if (rows.size() >= MAX_OUTCOME_CANDIDATES) {
            log.warn("[EngagementInbox] outcome {} for institute {} read the newest {} rows of the day only",
                    outcome, instituteId, MAX_OUTCOME_CANDIDATES);
        }
        if (rows.isEmpty()) return List.of();
        Map<String, ActionOutcome> outcomes = outcomeService.outcomes(instituteId, rows);
        return rows.stream()
                .filter(r -> EngagementActionOutcomeService.matches(outcome, r, outcomes.get(r.id())))
                .map(TaskRow::id)
                .toList();
    }

    /**
     * Each action's outcome (GET /tasks/outcomes), in the order asked; actions of another
     * institute, and unknown ids, are left out.
     *
     * @throws InvalidRequestException more than {@link #MAX_OUTCOME_LOOKUP} ids
     */
    public List<ActionOutcome> outcomes(String instituteId, String actionIdsCsv) {
        List<String> ids = actionIdsCsv == null ? List.of() : Arrays.stream(actionIdsCsv.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
        if (ids.size() > MAX_OUTCOME_LOOKUP) {
            throw new InvalidRequestException("actionIds takes at most " + MAX_OUTCOME_LOOKUP + " ids");
        }
        if (ids.isEmpty()) return List.of();
        Map<String, EngagementAction> found = actionRepository.findAllById(ids).stream()
                .filter(a -> instituteId.equals(a.getInstituteId()))
                .collect(Collectors.toMap(EngagementAction::getId, Function.identity(), (a, b) -> a));
        List<TaskRow> rows = ids.stream().map(found::get).filter(Objects::nonNull)
                .map(a -> new TaskRow(a.getId(), a.getEngineId(), a.getMemberId(), a.getKind(), a.getActionType(),
                        a.getChannel(), a.getStatus()))
                .toList();
        if (rows.isEmpty()) return List.of();
        Map<String, ActionOutcome> outcomes = outcomeService.outcomes(instituteId, rows);
        return rows.stream().map(r -> outcomes.get(r.id())).filter(Objects::nonNull).toList();
    }

    /** The one engine asked for (404 when it is not this institute's), else every engine of the institute. */
    private List<String> engineIds(String instituteId, String engineId) {
        if (engineId == null) {
            return engineRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId).stream()
                    .map(EngagementEngine::getId).toList();
        }
        EngagementEngine engine = engineRepository.findById(engineId)
                .filter(e -> instituteId.equals(e.getInstituteId()) && !"DELETED".equals(e.getStatus()))
                .orElseThrow(() -> new ResourceNotFoundException("Engagement engine not found: " + engineId));
        return List.of(engine.getId());
    }

    /** The actions, in the order of ids (findAllById does not keep it). */
    private List<EngagementAction> load(List<String> ids) {
        if (ids.isEmpty()) return List.of();
        Map<String, EngagementAction> byId = actionRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(EngagementAction::getId, Function.identity(), (a, b) -> a));
        List<EngagementAction> out = new ArrayList<>(ids.size());
        for (String id : ids) {
            EngagementAction a = byId.get(id);
            if (a != null) out.add(a);
        }
        return out;
    }

    private static String oneOf(String param, String value, Set<String> allowed) {
        if (value != null && !allowed.contains(value)) {
            throw new InvalidRequestException(param + " must be one of " + allowed.stream().sorted().toList());
        }
        return value;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static String trim(String s) {
        return blank(s) ? null : s.trim();
    }

    private static String upper(String s) {
        return blank(s) ? null : s.trim().toUpperCase(Locale.ROOT);
    }

    private static String lower(String s) {
        return blank(s) ? null : s.trim().toLowerCase(Locale.ROOT);
    }
}
