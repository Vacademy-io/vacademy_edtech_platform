package vacademy.io.admin_core_service.features.telephony.core;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Instant;
import java.util.Optional;

/**
 * Get-or-create the engagement rows an AI-call action needs to ride the existing
 * dispatcher: one system ENGINE per institute, one MEMBER per lead we act on.
 *
 * <p>WHY REUSE THE ENGAGEMENT LEDGER AT ALL. {@code engagement_action} already carries
 * at-most-once dispatch (the claim CAS), Meta fixed-template enforcement, per-message
 * credit billing with reconciliation, a failure inbox a human can reopen, and the
 * {@code id -> notification_log.correlation_id} join that answers "did this parent
 * actually receive the quiz link?". Re-implementing that for calls would be a second,
 * worse copy of a subsystem that took months to harden.
 *
 * <h2>The isolation contract — read before changing anything here</h2>
 *
 * The engagement ENGINE is an autonomous LLM decision-maker: {@code EngagementSweepJob}
 * picks up due engines, finds their due members, and asks a model what to say to each.
 * We want NONE of that. We want only the dispatch half. Two invariants keep the brain out:
 *
 * <ol>
 *   <li><b>The engine is never due.</b> {@code findDueEngines} selects
 *       {@code next_due_at IS NULL OR next_due_at <= now} — NULL IS DUE, so the cursor is
 *       stamped {@link #NEVER} explicitly rather than left unset.
 *   <li><b>The members are never ACTIVE.</b> {@code findDueMembers} requires
 *       {@code status = 'ACTIVE'}, so members are created PAUSED (and, belt and braces,
 *       also stamped {@link #NEVER}). PAUSED specifically, not EXITED: the sweep's
 *       enrolment upsert RESURRECTS an EXITED row to ACTIVE, which would hand these leads
 *       straight to the brain. A paused member still dispatches: {@code EngagementDispatcher}
 *       refuses only OPTED_OUT/EXITED, and {@code EngagementDispatchJob} accepts PAUSED for
 *       source=AI_CALL rows only. Its send-time check once required ACTIVE and withdrew every
 *       promise from 2026-09-29 to 10-17 — keep the two in step if either changes.
 * </ol>
 *
 * The engine must still be status ACTIVE — {@code EngagementDispatchJob} refuses to
 * dispatch for any other status. That is the only reason it is ACTIVE, and with an
 * empty audience and no due members it decides nothing.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiCallEngagementProvisioner {

    /** The name that identifies the per-institute system engine. Matched exactly. */
    public static final String SYSTEM_ENGINE_NAME = "AI Call Actions";

    /**
     * Far-future cursor = "never due". Not Instant.MAX: that overflows a Postgres
     * TIMESTAMP and the insert fails.
     */
    static final Instant NEVER = Instant.parse("2999-01-01T00:00:00Z");

    /**
     * Channel autonomy the dispatcher re-checks at send time. Without {@code auto:true}
     * every call-originated send would be demoted to a copilot task, i.e. silently never
     * sent — which is the exact credibility gap this feature exists to close.
     */
    private static final String CHANNELS_JSON = """
            {"WHATSAPP":{"enabled":true,"auto":true,"autoReply":false},\
            "EMAIL":{"enabled":true,"auto":true},\
            "IN_APP":{"enabled":false,"auto":false},\
            "AI_CALL":{"enabled":false,"auto":false}}""";

    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;

    /** The institute's system engine id, creating it on first use. */
    public String engineIdFor(String instituteId) {
        Optional<EngagementEngine> existing = findSystemEngine(instituteId);
        if (existing.isPresent()) return existing.get().getId();
        EngagementEngine e = new EngagementEngine();
        e.setInstituteId(instituteId);
        e.setName(SYSTEM_ENGINE_NAME);
        e.setObjective("Deliver what the AI voice agent promised on a call "
                + "(WhatsApp / email / meeting). System-managed: this engine never decides "
                + "anything on its own and never messages anyone the call did not.");
        e.setStatus("ACTIVE");
        e.setDataPoints("[]");
        e.setChannels(CHANNELS_JSON);
        e.setAudience("[]");
        e.setQuietHours("{}");
        e.setNextDueAt(NEVER);
        e.setCreatedBy("SYSTEM_AI_CALL");
        try {
            return engineRepository.save(e).getId();
        } catch (DataIntegrityViolationException race) {
            // Two calls for a fresh institute landed together. Re-read the winner.
            return findSystemEngine(instituteId)
                    .map(EngagementEngine::getId)
                    .orElseThrow(() -> race);
        }
    }

    private Optional<EngagementEngine> findSystemEngine(String instituteId) {
        return engineRepository.findByInstituteIdOrderByCreatedAtDesc(instituteId).stream()
                .filter(e -> SYSTEM_ENGINE_NAME.equals(e.getName()))
                .findFirst();
    }

    /**
     * The member row for this lead on the system engine. Subject identity follows the
     * engagement convention: user_id for a converted lead, audience_response_id otherwise
     * (ck_em_subject requires at least one).
     *
     * @return the member id, or null when the lead has neither identifier — the caller
     *         must then skip the action rather than write an orphan.
     */
    public String memberIdFor(String engineId, String instituteId, String userId, String responseId) {
        String uid = blankToNull(userId);
        String rid = blankToNull(responseId);
        if (uid == null && rid == null) return null;

        Optional<EngagementMember> found = uid != null
                ? memberRepository.findFirstByEngineIdAndUserId(engineId, uid)
                : memberRepository.findFirstByEngineIdAndAudienceResponseId(engineId, rid);
        if (found.isPresent()) return found.get().getId();

        EngagementMember m = new EngagementMember();
        m.setEngineId(engineId);
        m.setInstituteId(instituteId);
        m.setUserId(uid);
        m.setAudienceResponseId(rid);
        m.setStatus("PAUSED");          // see the isolation contract in the class javadoc
        m.setNextActionAt(NEVER);
        try {
            return memberRepository.save(m).getId();
        } catch (DataIntegrityViolationException race) {
            Optional<EngagementMember> winner = uid != null
                    ? memberRepository.findFirstByEngineIdAndUserId(engineId, uid)
                    : memberRepository.findFirstByEngineIdAndAudienceResponseId(engineId, rid);
            return winner.map(EngagementMember::getId).orElseThrow(() -> race);
        }
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }
}
