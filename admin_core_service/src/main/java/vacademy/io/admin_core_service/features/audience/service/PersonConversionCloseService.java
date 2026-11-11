package vacademy.io.admin_core_service.features.audience.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatusHistory;
import vacademy.io.admin_core_service.features.audience.enums.LeadFollowupStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusHistoryRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * When a person converts in an institute, their other enquiries there stop asking for work.
 *
 * <p>A person can hold several enquiries in one institute (as the submitter, or as the child an
 * enquiry was made for). Converting one of them, or enrolling, used to leave the others at
 * statuses like Call Back with their follow-ups still open and turning overdue. After a
 * conversion this service, for every enquiry of that person in that institute:
 * <ol>
 *   <li>closes the open follow-ups, with a plain closing note;</li>
 *   <li>moves the enquiry to Converted when it is not already Converted or Lost, writing a
 *       lead_status_history row with source {@value #SOURCE};</li>
 *   <li>adds one timeline entry saying what was closed and why.</li>
 * </ol>
 *
 * <p>People are matched by user id only, as the enquiry's user_id or student_user_id. Opt-out
 * list rows and deleted rows are left as they are. An institute can switch this off
 * ({@link LeadFollowupSettingService#closeOtherEnquiriesOnConversion}); it is on by default.
 *
 * <p><b>This is bookkeeping, never an automation event.</b> The status is written directly
 * rather than through {@link LeadStatusService#changeLeadStatus}, so no LEAD_STATUS_CHANGED
 * trigger is emitted and no workflow, engagement step, AI call, notification or message is set
 * off. The timeline entries are JOURNEY events of types the engagement wake hook does not react
 * to, written with no actor (so they do not count as a counsellor's response either), and they
 * carry metadata.source = {@value #SOURCE}, which the hook skips outright.
 *
 * <p>The work runs after the converting transaction commits, on the shared task executor, in a
 * transaction of its own: it sees the committed conversion, can never roll it back, and holds
 * no lock the caller is waiting on.
 */
@Slf4j
@Service
public class PersonConversionCloseService {

    /** lead_status_history.source and timeline metadata.source for everything written here. */
    public static final String SOURCE = "PERSON_CONVERTED";

    static final String CLOSER_REASON = "Closed automatically: this person has converted.";

    private static final String CONVERTED = "CONVERTED";
    private static final String LOST = "LOST";

    /** Per-transaction set of (user, institute) pairs waiting for the commit. */
    private static final Object PENDING_KEY = new Object();

    private final AudienceResponseRepository audienceResponseRepository;
    private final AudienceRepository audienceRepository;
    private final LeadFollowupRepository leadFollowupRepository;
    private final LeadStatusRepository leadStatusRepository;
    private final LeadStatusHistoryRepository leadStatusHistoryRepository;
    private final UserLeadProfileRepository userLeadProfileRepository;
    private final TimelineEventService timelineEventService;
    private final LeadFollowupSettingService settings;
    private final TransactionTemplate newTransaction;
    private final Executor executor;

    public PersonConversionCloseService(AudienceResponseRepository audienceResponseRepository,
                                        AudienceRepository audienceRepository,
                                        LeadFollowupRepository leadFollowupRepository,
                                        LeadStatusRepository leadStatusRepository,
                                        LeadStatusHistoryRepository leadStatusHistoryRepository,
                                        UserLeadProfileRepository userLeadProfileRepository,
                                        TimelineEventService timelineEventService,
                                        LeadFollowupSettingService settings,
                                        PlatformTransactionManager transactionManager,
                                        @Qualifier("taskExecutor") Executor executor) {
        this.audienceResponseRepository = audienceResponseRepository;
        this.audienceRepository = audienceRepository;
        this.leadFollowupRepository = leadFollowupRepository;
        this.leadStatusRepository = leadStatusRepository;
        this.leadStatusHistoryRepository = leadStatusHistoryRepository;
        this.userLeadProfileRepository = userLeadProfileRepository;
        this.timelineEventService = timelineEventService;
        this.settings = settings;
        this.newTransaction = new TransactionTemplate(transactionManager);
        this.newTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.executor = executor;
    }

    /**
     * Called by every path that marks a person CONVERTED in an institute. Runs once the caller's
     * transaction commits (straight away when there is none); a person converted twice in one
     * transaction is handled once. Never throws.
     */
    public void onPersonConverted(String userId, String instituteId) {
        if (isBlank(userId) || isBlank(instituteId)) return;
        try {
            if (!TransactionSynchronizationManager.isSynchronizationActive()) {
                submit(userId, instituteId);
                return;
            }
            pendingForThisTransaction().add(List.of(userId, instituteId));
        } catch (Exception e) {
            log.warn("[PersonConverted] Could not schedule closing for user={} institute={}: {}",
                    userId, instituteId, e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private Set<List<String>> pendingForThisTransaction() {
        Set<List<String>> pending = (Set<List<String>>) TransactionSynchronizationManager.getResource(PENDING_KEY);
        if (pending != null) return pending;
        Set<List<String>> fresh = new LinkedHashSet<>();
        TransactionSynchronizationManager.bindResource(PENDING_KEY, fresh);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                for (List<String> p : fresh) submit(p.get(0), p.get(1));
            }

            @Override
            public void afterCompletion(int status) {
                TransactionSynchronizationManager.unbindResourceIfPossible(PENDING_KEY);
            }
        });
        return fresh;
    }

    /**
     * Off the caller's thread: after a commit Spring still holds the caller's connection, and a
     * second one taken inline would double this thread's share of the pool.
     */
    private void submit(String userId, String instituteId) {
        try {
            executor.execute(() -> run(userId, instituteId));
        } catch (Exception e) {
            log.warn("[PersonConverted] Could not start closing for user={} institute={}: {}",
                    userId, instituteId, e.getMessage());
        }
    }

    void run(String userId, String instituteId) {
        try {
            Outcome outcome = newTransaction.execute(status -> close(userId, instituteId));
            if (outcome == null || outcome.isEmpty()) return;
            // Written after the closing commits, so a note never describes a change that rolled back.
            outcome.notes().forEach(this::writeNote);
            log.info("[PersonConverted] user={} institute={}: closed {} follow-up(s), moved {} enquiry(ies) to Converted",
                    userId, instituteId, outcome.followupsClosed(), outcome.enquiriesMoved());
        } catch (Exception e) {
            log.warn("[PersonConverted] Closing failed for user={} institute={}: {}",
                    userId, instituteId, e.getMessage());
        }
    }

    /** The closing itself, inside the transaction run() opens. Writes no timeline entry; returns them. */
    Outcome close(String userId, String instituteId) {
        List<AudienceResponse> rows = audienceResponseRepository.findAllByInstituteAndUserOrStudent(instituteId, userId);
        if (rows == null || rows.isEmpty()) return Outcome.NONE;

        Set<String> audienceIds = rows.stream().map(AudienceResponse::getAudienceId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        Map<String, Audience> audiences = audienceRepository.findAllById(audienceIds).stream()
                .collect(Collectors.toMap(Audience::getId, Function.identity(), (a, b) -> a));
        List<AudienceResponse> live = rows.stream()
                .filter(r -> isLive(r, audiences.get(r.getAudienceId()), instituteId, userId))
                .toList();
        if (live.isEmpty()) return Outcome.NONE;
        if (!settings.closeOtherEnquiriesOnConversion(instituteId)) return Outcome.NONE;

        Timestamp now = new Timestamp(System.currentTimeMillis());
        Map<String, AudienceResponse> byId = new LinkedHashMap<>();
        live.forEach(r -> byId.put(r.getId(), r));

        // 1. Open follow-ups on any of these enquiries.
        List<LeadFollowup> open = leadFollowupRepository.findByAudienceResponseIdInAndIsClosedFalse(byId.keySet())
                .stream()
                .filter(f -> instituteId.equals(f.getInstituteId()) && byId.containsKey(f.getAudienceResponseId()))
                .toList();
        Map<String, List<String>> closedByLead = new LinkedHashMap<>();
        for (LeadFollowup f : open) {
            f.setStatus(LeadFollowupStatus.COMPLETED.name());
            f.setIsClosed(true);
            f.setCloserReason(CLOSER_REASON);
            f.setClosedAt(now);
            closedByLead.computeIfAbsent(f.getAudienceResponseId(), k -> new ArrayList<>()).add(f.getId());
        }
        if (!open.isEmpty()) leadFollowupRepository.saveAll(open);

        // 2. Live enquiries not yet Converted or Lost move to Converted.
        Map<String, String> movedFrom = new LinkedHashMap<>();
        LeadStatus converted = leadStatusRepository.findByInstituteIdAndStatusKey(instituteId, CONVERTED).orElse(null);
        if (converted != null && !Boolean.FALSE.equals(converted.getIsActive())) {
            Map<String, String> keyByStatusId = statusKeys(live);
            Map<String, String> profileStatusByUser = new HashMap<>();
            List<AudienceResponse> toSave = new ArrayList<>();
            List<LeadStatusHistory> history = new ArrayList<>();
            for (AudienceResponse r : live) {
                if (converted.getId().equals(r.getLeadStatusId())) continue;
                String key = r.getLeadStatusId() != null ? keyByStatusId.get(r.getLeadStatusId()) : null;
                // The list shows the per-enquiry status first, then the submitter's profile status.
                if (key == null) key = profileStatus(r.getUserId(), instituteId, profileStatusByUser);
                if (CONVERTED.equals(key) || LOST.equals(key)) continue;
                history.add(LeadStatusHistory.builder()
                        .audienceResponseId(r.getId())
                        .instituteId(instituteId)
                        .fromStatusId(r.getLeadStatusId())
                        .toStatusId(converted.getId())
                        .changedByUserId(null)
                        .source(SOURCE)
                        .build());
                movedFrom.put(r.getId(), r.getLeadStatusId());
                r.setLeadStatusId(converted.getId());
                toSave.add(r);
            }
            if (!toSave.isEmpty()) {
                audienceResponseRepository.saveAll(toSave);
                leadStatusHistoryRepository.saveAll(history);
            }
        }

        if (closedByLead.isEmpty() && movedFrom.isEmpty()) return Outcome.NONE;

        List<Note> notes = new ArrayList<>();
        for (AudienceResponse r : live) {
            List<String> closed = closedByLead.getOrDefault(r.getId(), List.of());
            boolean moved = movedFrom.containsKey(r.getId());
            if (closed.isEmpty() && !moved) continue;
            notes.add(new Note(r.getId(), r.getUserId() != null ? r.getUserId() : userId, closed, moved,
                    movedFrom.get(r.getId()), moved ? converted : null));
        }
        return new Outcome(open.size(), movedFrom.size(), notes);
    }

    private void writeNote(Note n) {
        try {
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("source", SOURCE);
            meta.put("followups_closed", n.closedFollowupIds().size());
            if (!n.closedFollowupIds().isEmpty()) meta.put("followup_ids", n.closedFollowupIds());
            if (n.moved()) {
                meta.put("from_status_id", n.fromStatusId() != null ? n.fromStatusId() : "");
                meta.put("to_status_id", n.to().getId());
                meta.put("to_status_key", n.to().getStatusKey());
                meta.put("to_status_label", n.to().getLabel() != null ? n.to().getLabel() : "");
            }
            timelineEventService.logJourneyEvent(
                    "LEAD", n.responseId(),
                    n.moved() ? LeadJourneyActionType.LEAD_CONVERTED : LeadJourneyActionType.FOLLOWUP,
                    "SYSTEM", null, null,
                    n.moved() ? "Moved to Converted" : "Follow-ups closed",
                    describe(n.closedFollowupIds().size(), n.moved()),
                    meta,
                    n.studentUserId());
        } catch (Exception e) {
            log.warn("[PersonConverted] Timeline note failed for lead {}: {}", n.responseId(), e.getMessage());
        }
    }

    /** "This person has converted, so 2 open follow-ups on this enquiry were closed and ..." */
    static String describe(int followupsClosed, boolean moved) {
        StringBuilder s = new StringBuilder("This person has converted, so ");
        if (followupsClosed > 0) {
            s.append(followupsClosed).append(followupsClosed == 1 ? " open follow-up" : " open follow-ups")
                    .append(" on this enquiry ").append(followupsClosed == 1 ? "was" : "were").append(" closed");
            if (moved) s.append(" and this enquiry was moved to Converted");
        } else {
            s.append("this enquiry was moved to Converted");
        }
        return s.append('.').toString();
    }

    /**
     * An enquiry this closes: in the institute, held by the person, not deleted, and not a row
     * of an opt-out list.
     */
    static boolean isLive(AudienceResponse r, Audience audience, String instituteId, String userId) {
        if (r == null || audience == null || !instituteId.equals(audience.getInstituteId())) return false;
        if (!userId.equals(r.getUserId()) && !userId.equals(r.getStudentUserId())) return false;
        if (r.getAudienceStatus() != null && !"ACTIVE".equalsIgnoreCase(r.getAudienceStatus())) return false;
        if ("OPT_OUT".equalsIgnoreCase(r.getSourceType())) return false;
        return audience.getCampaignType() == null || !audience.getCampaignType().contains("OPT_OUT");
    }

    private Map<String, String> statusKeys(List<AudienceResponse> rows) {
        Set<String> ids = rows.stream().map(AudienceResponse::getLeadStatusId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        if (ids.isEmpty()) return Map.of();
        Map<String, String> keys = new HashMap<>();
        for (LeadStatus s : leadStatusRepository.findAllById(ids)) {
            if (s.getStatusKey() != null) keys.put(s.getId(), s.getStatusKey());
        }
        return keys;
    }

    private String profileStatus(String userId, String instituteId, Map<String, String> cache) {
        if (userId == null) return null;
        if (cache.containsKey(userId)) return cache.get(userId);
        String status = userLeadProfileRepository.findByUserIdAndInstituteId(userId, instituteId)
                .map(p -> p.getConversionStatus()).orElse(null);
        cache.put(userId, status);
        return status;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /** One timeline entry to write once the closing has committed. */
    record Note(String responseId, String studentUserId, List<String> closedFollowupIds, boolean moved,
                String fromStatusId, LeadStatus to) {}

    record Outcome(int followupsClosed, int enquiriesMoved, List<Note> notes) {
        static final Outcome NONE = new Outcome(0, 0, List.of());

        boolean isEmpty() {
            return followupsClosed == 0 && enquiriesMoved == 0;
        }
    }
}
