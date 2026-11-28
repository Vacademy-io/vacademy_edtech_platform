package vacademy.io.admin_core_service.features.telephony.core;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.enums.CallDirection;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyProviderNumber;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.spi.dto.BridgeCallRequest;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationContext;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationPlan;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OutboundCallHandle;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderNumberView;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.UUID;

/**
 * Holds the @Transactional methods of the call-orchestration flow in a
 * separate bean from {@link CallOrchestrator}.
 *
 * Why a separate bean: Spring AOP wraps every Spring-managed bean in a proxy
 * that enforces @Transactional / @Async semantics. When code inside a bean
 * calls another method on `this`, the call goes through the raw object,
 * NOT the proxy, so the annotation has no effect. By placing each
 * transactional unit on its own bean and injecting it into the
 * orchestrator, every call goes through the proxy and the annotations
 * actually engage.
 *
 * Three units of work, each its own short transaction:
 *   - prepareAndPersist:  read config from cache + validate + INSERT row
 *   - commitDispatched:   UPDATE row with provider Sid; only if still INITIATED
 *                         (so a fast webhook arriving with IN_PROGRESS isn't
 *                         clobbered back to QUEUED)
 *   - markFailedAfterDispatch: REQUIRES_NEW — runs in its own tx even if the
 *                         caller is mid-rollback.
 */
@Service
public class CallLifecycleTxOps {

    @Autowired private TelephonyCallLogRepository callLogRepo;
    @Autowired private AudienceResponseRepository audienceResponseRepo;
    @Autowired private StudentSessionInstituteGroupMappingRepository studentMappingRepo;
    @Autowired private TelephonyProviderRegistry registry;
    @Autowired private UserMobileResolver userMobileResolver;
    @Autowired private TelephonyConfigCache configCache;

    @Value("${telephony.webhook.callback-base:}")
    private String webhookBase;

    @Transactional
    public CallOrchestrator.Prepared prepareAndPersist(String instituteId,
                                                       ConnectCallRequestDTO req,
                                                       CustomUserDetails actor) {
        TelephonyConfigCache.Resolved resolved = requireEnabledConfig(instituteId);

        // Two entry points converge here: a CRM lead (responseId) and an enrolled
        // learner called from the LMS side-view (userId only). Resolve both onto the
        // same (responseId, subjectUserId, phone) triple so everything downstream —
        // the call row, the CDR matcher, call history, the timeline — is identical.
        Subject subject = resolveSubject(instituteId, req);
        return persist(instituteId, resolved, subject.responseId(), subject.userId(), subject.phone(),
                actor.getUserId(), req.getPreferredNumberId(), null, null);
    }

    /**
     * Who a call placed WITHOUT a signed-in counsellor is for — the public API's
     * POST /v1/human-calls. The caller has already resolved and authorised every part:
     * the counsellor is a member of {@code instituteId}, {@code responseId} (when set) is
     * a lead of that institute, and {@code phone} is the E.164 number to dial.
     * {@code subjectType}/{@code subjectId} are null for a lead (as on the dashboard path)
     * and API_CONTACT / the public call id otherwise.
     */
    public record DialTarget(String responseId, String userId, String phone,
                             String subjectType, String subjectId) {}

    /**
     * The public API's entry point: the same validation, origination and INSERT as
     * {@link #prepareAndPersist(String, ConnectCallRequestDTO, CustomUserDetails)}, for a
     * counsellor named by id instead of the request's principal.
     */
    @Transactional
    public CallOrchestrator.Prepared prepareAndPersistForCounsellor(String instituteId,
                                                                    String counsellorUserId,
                                                                    DialTarget target) {
        TelephonyConfigCache.Resolved resolved = requireEnabledConfig(instituteId);
        return persist(instituteId, resolved, target.responseId(), target.userId(), target.phone(),
                counsellorUserId, null, target.subjectType(), target.subjectId());
    }

    private TelephonyConfigCache.Resolved requireEnabledConfig(String instituteId) {
        return configCache.get(instituteId)
                .filter(r -> Boolean.TRUE.equals(r.getConfig().getEnabled()))
                .orElseThrow(() -> new VacademyException("Calling is not configured for this institute"));
    }

    /**
     * Shared body of both entry points, moved verbatim out of prepareAndPersist: phone
     * checks, provider origination, the INITIATED row, the bridge request. The dashboard
     * path passes null subject type/id, which is exactly what it stored before.
     */
    private CallOrchestrator.Prepared persist(String instituteId, TelephonyConfigCache.Resolved resolved,
                                              String responseId, String subjectUserId, String leadPhone,
                                              String counsellorUserId, String preferredNumberId,
                                              String subjectType, String subjectId) {
        if (leadPhone == null) throw new VacademyException("This contact has no phone on file");
        if (!leadPhone.matches("^\\+?[0-9]{8,15}$")) {
            throw new VacademyException("Phone number format not supported");
        }

        String providerType = resolved.getConfig().getProviderType();
        List<ProviderNumberView> views = resolved.getEnabledNumbers().stream()
                .map(CallLifecycleTxOps::toView).toList();

        // Provider-specific origination (Exotel: verified mobile + pooled ExoPhone
        // via selector; Airtel/Vonage: the counsellor's extension + DID). The core
        // no longer assumes either model — the registered resolver decides.
        OriginationPlan plan = registry.originationResolver(providerType).resolve(
                OriginationContext.builder()
                        .instituteId(instituteId)
                        .providerType(providerType)
                        .counsellorUserId(counsellorUserId)
                        .leadUserId(subjectUserId)
                        .leadPhone(leadPhone)
                        .preferredNumberId(preferredNumberId)
                        .selectorKey(resolved.getConfig().getDefaultSelectorKey())
                        .available(views)
                        .build());

        String callLogId = UUID.randomUUID().toString();
        TelephonyCallLog row = TelephonyCallLog.builder()
                .id(callLogId)
                .instituteId(instituteId)
                .providerType(providerType)
                .providerNumberId(plan.getProviderNumberId())
                .responseId(responseId)
                .userId(subjectUserId)
                .counsellorUserId(counsellorUserId)
                .subjectType(subjectType)
                .subjectId(subjectId)
                .direction(CallDirection.OUTBOUND.name())
                .fromNumber(plan.getFrom())
                .toNumber(leadPhone)
                .callerId(plan.getCallerId())
                .status(CallStatus.INITIATED.name())
                .recordingFetchAttempts(0)
                .recordingLogged(false)
                .build();
        // Tell JPA this is a brand-new row — avoids the pre-INSERT SELECT
        // that Spring Data JPA does when the entity has an assigned ID.
        row.markNew();
        callLogRepo.save(row);

        BridgeCallRequest bridge = BridgeCallRequest.builder()
                .from(plan.getFrom())
                .to(leadPhone)
                .callerId(plan.getCallerId())
                .record(Boolean.TRUE.equals(resolved.getConfig().getRecordCalls()))
                .correlationId(callLogId)
                .statusCallbackUrl(buildStatusCallbackUrl(providerType,
                        resolved.getWebhookToken(), callLogId))
                .build();

        return new CallOrchestrator.Prepared(callLogId, providerType,
                plan.getCallerId(), responseId, bridge, resolved);
    }

    /** Who the call is for: the lead row it files under (may be null), the person's
     *  user id, and the number to dial. */
    private record Subject(String responseId, String userId, String phone) {}

    /**
     * Resolve the call subject from whichever identifier the caller sent.
     *
     * <p>CRM path (responseId): unchanged — the lead's own mobile wins, falling
     * back to the auth record.
     *
     * <p>LMS path (userId only): the learner must be enrolled in THIS institute,
     * checked against student_session_institute_group_mapping. Without that check a
     * user id alone would let anyone with a calling-enabled institute dial any user
     * in the platform, since the phone lookup is a global auth_service call. We then
     * best-effort attach the learner's newest lead row so a learner who also came
     * through a form keeps one unified call history + timeline.
     */
    private Subject resolveSubject(String instituteId, ConnectCallRequestDTO req) {
        if (req.getResponseId() != null && !req.getResponseId().isBlank()) {
            AudienceResponse lead = audienceResponseRepo.findById(req.getResponseId())
                    .orElseThrow(() -> new VacademyException("Lead not found"));
            // The lead must be one of THIS institute's: the id comes from the browser, and
            // the caller is only proven to belong to {@code instituteId}. Same message as a
            // missing lead, so a foreign id reveals nothing about whether it exists.
            if (!leadBelongsTo(lead, instituteId)) {
                throw new VacademyException("Lead not found");
            }
            String phone = firstNonBlank(lead.getParentMobile(),
                    userMobileResolver.findMobile(lead.getUserId()).orElse(null));
            return new Subject(lead.getId(), lead.getUserId(), phone);
        }

        String userId = req.getUserId();
        if (userId == null || userId.isBlank()) {
            throw new VacademyException("responseId or userId is required");
        }
        boolean enrolledHere = studentMappingRepo
                .findLatestPackageSessionIdByUserIdAndInstituteId(userId, instituteId)
                .isPresent();
        if (!enrolledHere) {
            throw new VacademyException("This learner is not enrolled in this institute");
        }
        String responseId = audienceResponseRepo
                .findLatestResponseIdForUserInInstitute(instituteId, userId, PageRequest.of(0, 1))
                .stream().findFirst().orElse(null);
        return new Subject(responseId, userId, userMobileResolver.findMobile(userId).orElse(null));
    }

    /**
     * A campaign lead belongs to its campaign's institute; an admission / application lead
     * (no campaign, audience_id NULL) to the institute of its application stage. Anything
     * else — another institute's lead, or a campaign-less lead with no application — is not
     * this institute's.
     */
    private boolean leadBelongsTo(AudienceResponse lead, String instituteId) {
        if (lead.getAudienceId() != null) {
            return audienceResponseRepo.isLeadInInstitute(lead.getId(), instituteId);
        }
        return lead.getApplicantId() != null
                && audienceResponseRepo.isApplicantLeadInInstitute(lead.getId(), instituteId);
    }

    /**
     * Update the row with the provider Sid + QUEUED — but ONLY if the row is
     * still in INITIATED state. A webhook delivered before this method runs
     * may have already moved status forward (RINGING / IN_PROGRESS); we must
     * never reverse those.
     */
    @Transactional
    public void commitDispatched(String callLogId, OutboundCallHandle handle) {
        TelephonyCallLog row = callLogRepo.findById(callLogId).orElse(null);
        if (row == null) return;
        // Always set providerCallId — webhooks may have matched only via corr
        // up to this point, and storing the Sid helps debugging.
        if (row.getProviderCallId() == null) {
            row.setProviderCallId(handle.getProviderCallId());
        }
        if (CallStatus.INITIATED.name().equals(row.getStatus())) {
            row.setStatus(CallStatus.QUEUED.name());
        }
        callLogRepo.save(row);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailedAfterDispatch(String callLogId, String reason) {
        TelephonyCallLog row = callLogRepo.findById(callLogId).orElse(null);
        if (row == null) return;
        row.setStatus(CallStatus.FAILED.name());
        row.setTerminationReason(reason);
        callLogRepo.save(row);
    }

    /**
     * FAILED only if the provider was never reached (still INITIATED): for a dispatch that
     * stopped before the HTTP call (circuit breaker open), whose row would otherwise look
     * live for the public API's busy / in-progress checks. A row the initiate failure
     * already marked, or a webhook already moved, is left alone.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailedIfNotDispatched(String callLogId, String reason) {
        TelephonyCallLog row = callLogRepo.findById(callLogId).orElse(null);
        if (row == null || !CallStatus.INITIATED.name().equals(row.getStatus())) return;
        row.setStatus(CallStatus.FAILED.name());
        row.setTerminationReason(reason);
        callLogRepo.save(row);
    }

    private static ProviderNumberView toView(TelephonyProviderNumber n) {
        return ProviderNumberView.builder()
                .id(n.getId())
                .phoneNumber(n.getPhoneNumber())
                .label(n.getLabel())
                .region(n.getRegion())
                .priority(n.getPriority() == null ? 100 : n.getPriority())
                .enabled(Boolean.TRUE.equals(n.getEnabled()))
                .build();
    }

    private String buildStatusCallbackUrl(String providerType, String token, String corr) {
        String base = webhookBase == null || webhookBase.isBlank()
                ? "https://api.vacademy.io"
                : webhookBase;
        StringBuilder url = new StringBuilder(base)
                .append("/admin-core-service/v1/telephony/webhook/status")
                .append("?provider=").append(providerType)
                .append("&corr=").append(corr);
        // ?token= is only included when the institute has set a webhook
        // secret. In "open" mode (token null/blank) we leave it off entirely
        // so the URL stays clean and the handler accepts all callbacks.
        if (token != null && !token.isBlank()) {
            url.append("&token=").append(token);
        }
        return url.toString();
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.isBlank()) return a;
        if (b != null && !b.isBlank()) return b;
        return null;
    }
}
