package vacademy.io.admin_core_service.features.doubts.manager;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.doubts.dtos.AllDoubtsResponse;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtActivityDto;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsDto;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtsRequestFilter;
import vacademy.io.admin_core_service.features.doubts.dtos.OpenDoubtConfigResponse;
import vacademy.io.admin_core_service.features.doubts.entity.DoubtActivity;
import vacademy.io.admin_core_service.features.doubts.entity.DoubtAssignee;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtActivityActionEnum;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtActivityActorTypeEnum;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtAssigneeSourceEnum;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtAssigneeStatusEnum;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtStatusEnum;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtsSourceEnum;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtsAssigneeRepository;
import vacademy.io.admin_core_service.features.doubts.service.DoubtService;
import vacademy.io.admin_core_service.features.doubts.service.DoubtStatusCatalog;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtDefaultAssigneeSourceEnum;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.slide.dto.SlideMetadataProjection;
import vacademy.io.admin_core_service.features.slide.service.SlideMetaDataService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgStaffLookupService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.standard_classes.ListService;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.UnaryOperator;

@Slf4j
@Component
public class DoubtsManager {

    @Autowired
    DoubtService doubtService;

    @Autowired
    FacultySubjectPackageSessionMappingRepository facultyMappingRepository;

    @Autowired
    InstituteSettingService instituteSettingService;

    @Autowired
    SlideMetaDataService slideMetaDataService;

    @Autowired
    DoubtNotificationService doubtNotificationService;

    @Autowired
    DoubtsAssigneeRepository doubtsAssigneeRepository;

    @Autowired
    vacademy.io.admin_core_service.features.auth_service.service.AuthService authService;

    @Autowired
    vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService workflowTriggerService;

    @Autowired
    SubOrgStaffLookupService subOrgStaffLookupService;

    @Autowired
    InstituteAccessValidator instituteAccessValidator;

    /**
     * Lenient on purpose: this mapper reads a settings blob the admin frontend owns and extends.
     * Jackson's default is to THROW on an unknown property, and the caller swallows that into
     * "no setting" — so one field written by a newer frontend would silently drop the institute's
     * whole doubt-routing config back to defaults. Unknown keys are ignored instead.
     */
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /** Role name as configured in auth_service for institute-level admins. */
    private static final String ADMIN_ROLE = "ADMIN";

    /** Default query type key for legacy/untyped doubts (academic, slide-anchored). */
    private static final String DEFAULT_TYPE = "DOUBT";

    /** Attempts for the role lookup that backs the admin fallback (see {@link #resolveUsersByRole}). */
    private static final int ROLE_LOOKUP_ATTEMPTS = 2;

    /** Backoff between role-lookup attempts — long enough to clear a blip, short enough to not stall creation. */
    private static final long ROLE_LOOKUP_RETRY_DELAY_MS = 150L;

    public ResponseEntity<String> updateOrCreateDoubt(CustomUserDetails userDetails, String doubtId, DoubtsDto request) {
        String actorUserId = userDetails == null ? null : userDetails.getUserId();
        if(StringUtils.hasText(doubtId)){
            authorizeUpdate(userDetails, doubtId, request);
            return ResponseEntity.ok(updateDoubt(doubtId, request, actorUserId, isStaffViewer(userDetails)));
        }

        // The body's user_id is client-controlled: resolve who the doubt is raised as once the
        // doubt's institute is known (see resolveAuthorUserId).
        return ResponseEntity.ok(createNewDoubt(request, actorUserId,
                instituteId -> resolveAuthorUserId(userDetails, request.getUserId(), instituteId)));
    }

    /**
     * Who an authenticated {@code doubts/create} call raises the doubt as. The body's
     * {@code user_id} is kept only when the caller is STAFF of the institute the doubt belongs to
     * (a teacher/admin raising it on a learner's behalf); everyone else — learners, staff of
     * another institute, or a doubt whose institute can't be resolved — raises it as themselves.
     * A mismatch is not rejected (the learner app may echo a stale id), just overridden and logged.
     *
     * <p>Staff is {@link InstituteAccessValidator#requireInstituteStaff}: no root-user bypass
     * (learners are created as root users), membership via the clientId-header authorities, and a
     * learner role only counts as staff alongside ADMIN or COUNSELLOR.
     */
    String resolveAuthorUserId(CustomUserDetails caller, String requestedUserId, String instituteId) {
        String callerUserId = caller == null ? null : caller.getUserId();
        if (!StringUtils.hasText(requestedUserId) || requestedUserId.equals(callerUserId)) {
            return callerUserId;
        }
        if (StringUtils.hasText(instituteId) && isInstituteStaff(caller, instituteId)) {
            return requestedUserId;
        }
        log.warn("doubts/create: caller {} sent user_id {} without staff access to institute {} — "
                + "raising the doubt as the caller", callerUserId, requestedUserId, instituteId);
        return callerUserId;
    }

    /**
     * What a caller may do to an existing doubt, strongest first. STAFF = staff of the doubt's
     * institute (anything). AUTHOR = raised this doubt/reply (edit its text, resolve/reopen, delete).
     * ASSIGNEE = an ACTIVE assignee of the thread, or faculty of its batch — the same people the
     * inbox ({@code get-all}) already shows the doubt to (status changes and replies, not text or delete).
     */
    enum DoubtAccess { NONE, ASSIGNEE, AUTHOR, STAFF }

    /** Max parent hops when walking a reply up to its top-level doubt. */
    private static final int MAX_THREAD_DEPTH = 10;

    DoubtAccess resolveAccess(CustomUserDetails caller, Doubts doubt) {
        if (caller == null || doubt == null) return DoubtAccess.NONE;
        Doubts root = threadRoot(doubt);
        String instituteId = resolveNotificationInstituteId(root);
        if (StringUtils.hasText(instituteId) && isInstituteStaff(caller, instituteId)) return DoubtAccess.STAFF;
        String callerUserId = caller.getUserId();
        if (!StringUtils.hasText(callerUserId)) return DoubtAccess.NONE;
        if (callerUserId.equals(doubt.getUserId())) return DoubtAccess.AUTHOR;
        if (isAssigneeOrBatchFaculty(callerUserId, root)) return DoubtAccess.ASSIGNEE;
        return DoubtAccess.NONE;
    }

    /** Read access: any {@link DoubtAccess} above, plus the learner who raised the thread (reading its replies). */
    private boolean canRead(CustomUserDetails caller, Doubts doubt) {
        if (resolveAccess(caller, doubt) != DoubtAccess.NONE) return true;
        String callerUserId = caller == null ? null : caller.getUserId();
        return StringUtils.hasText(callerUserId) && callerUserId.equals(threadRoot(doubt).getUserId());
    }

    /**
     * Gate for {@code doubts/create?doubtId=X}: refuses (403) a caller with no access to the doubt,
     * and strips what their access level doesn't cover from the request. Assignment is staff-only;
     * it is dropped rather than refused because the learner app echoes the whole doubt back on
     * resolve/delete — including the excluded-assignee list the response carries.
     */
    private void authorizeUpdate(CustomUserDetails caller, String doubtId, DoubtsDto request) {
        Optional<Doubts> existing = doubtService.getDoubtById(doubtId);
        if (existing.isEmpty()) return; // updateDoubt reports "Doubt Not Found"
        Doubts doubt = existing.get();
        DoubtAccess access = resolveAccess(caller, doubt);
        if (access == DoubtAccess.NONE) {
            log.warn("doubts/create?doubtId={}: caller {} has no access to this doubt — refused",
                    doubtId, caller == null ? null : caller.getUserId());
            throw new ForbiddenException("You can only change your own doubts");
        }
        if (access == DoubtAccess.STAFF) return;
        request.setDoubtAssigneeRequestUserIds(null);
        request.setDeleteAssigneeRequest(null);
        request.setExcludedAssigneeUserIds(null);
        if (access == DoubtAccess.ASSIGNEE) {
            request.setHtmlText(null); // the text is the author's
            if (DoubtStatusEnum.DELETED.name().equals(request.getStatus())
                    && !DoubtStatusEnum.DELETED.name().equals(doubt.getStatus())) {
                throw new ForbiddenException("Only the author or institute staff can delete a doubt");
            }
        }
    }

    /** The top-level doubt of a reply thread (the doubt itself when it has no parent). */
    private Doubts threadRoot(Doubts doubt) {
        Doubts current = doubt;
        for (int i = 0; i < MAX_THREAD_DEPTH && StringUtils.hasText(current.getParentId()); i++) {
            Optional<Doubts> parent = doubtService.getDoubtById(current.getParentId());
            if (parent.isEmpty()) break;
            current = parent.get();
        }
        return current;
    }

    /**
     * Mirrors the non-admin visibility of {@code get-all} (DoubtsRepository): an ACTIVE USER
     * assignee row on the doubt, or an ACTIVE FSPSSM mapping to the doubt's batch.
     */
    private boolean isAssigneeOrBatchFaculty(String userId, Doubts root) {
        if (StringUtils.hasText(root.getId())) {
            boolean assignee = doubtsAssigneeRepository
                    .findByDoubtIdAndStatusNotIn(root.getId(), List.of(DoubtAssigneeStatusEnum.DELETED.name()))
                    .stream()
                    .anyMatch(a -> DoubtAssigneeSourceEnum.USER.name().equalsIgnoreCase(a.getSource())
                            && DoubtAssigneeStatusEnum.ACTIVE.name().equalsIgnoreCase(a.getStatus())
                            && userId.equals(a.getSourceId()));
            if (assignee) return true;
        }
        String packageSessionId = root.getPackageSessionId();
        if (!StringUtils.hasText(packageSessionId)) return false;
        try {
            return facultyMappingRepository.findByUserId(userId).stream()
                    .filter(fm -> "ACTIVE".equalsIgnoreCase(fm.getStatus()))
                    .anyMatch(fm -> packageSessionId.equals(fm.getPackageSessionId())
                            || ("PACKAGE_SESSION".equals(fm.getAccessType()) && packageSessionId.equals(fm.getAccessId())));
        } catch (Exception e) {
            log.warn("FSPSSM lookup failed for doubt access, userId={}: {}", userId, e.getMessage());
            return false;
        }
    }

    private boolean isInstituteStaff(CustomUserDetails caller, String instituteId) {
        if (caller == null) return false;
        try {
            instituteAccessValidator.requireInstituteStaff(caller, instituteId);
            return true;
        } catch (VacademyException | ForbiddenException e) {
            return false;
        }
    }

    /**
     * The audit trail of a doubt (assignments — manual and by rule — status changes, remarks).
     * Staff only: learners and guests never see it, so the internal notes stay internal.
     */
    public ResponseEntity<List<DoubtActivityDto>> getDoubtActivity(CustomUserDetails userDetails, String doubtId) {
        if (!isStaffViewer(userDetails)) {
            throw new VacademyException("Only institute staff can view doubt activity");
        }
        Optional<Doubts> doubt = doubtService.getDoubtById(doubtId);
        if (doubt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        // Staff by role is not enough: they must be staff of THIS doubt's institute, or work it.
        if (!canRead(userDetails, doubt.get())) {
            throw new ForbiddenException("You don't have access to this doubt");
        }
        return ResponseEntity.ok(doubtService.getActivity(doubtId));
    }

    /**
     * Anyone who works doubts from the admin app: ADMIN / TEACHER / root, and every other
     * institute role (EVALUATOR, CONTENT CREATOR, custom roles — they're all offered in the
     * assignee picker). A learner account (STUDENT role, no ADMIN/TEACHER) and a guest (no
     * principal) are not staff. Same role precedence as {@link #resolveViewerUserId}.
     */
    private boolean isStaffViewer(CustomUserDetails user) {
        if (user == null) return false;
        if (hasRole(user, "ADMIN") || hasRole(user, "TEACHER") || user.isRootUser()) return true;
        return !hasRole(user, "STUDENT");
    }

    /** Sentinel rule label for assignees a person picked by hand (as opposed to a routing rule). */
    private static final String MANUAL_RULE = "MANUAL";

    /** Basic shape check; deliverability is not verified — the reply email just bounces if fake. */
    private static final java.util.regex.Pattern EMAIL_PATTERN =
            java.util.regex.Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private static final int GUEST_TEXT_MAX_CHARS = 5000;
    private static final int GUEST_CONTACT_MAX_CHARS = 255;

    /**
     * Public (unauthenticated) view of the query-intake config for the login page. Never throws —
     * any failure reads as "disabled" so the public endpoint can't 5xx.
     */
    public OpenDoubtConfigResponse getOpenDoubtConfig(String instituteId) {
        try {
            DoubtManagementSettingDataDto setting = loadDoubtManagementSettingByInstitute(instituteId);
            if (setting == null || setting.getLearnerQuery() == null
                    || !Boolean.TRUE.equals(setting.getLearnerQuery().getEnabled())) {
                return OpenDoubtConfigResponse.disabled();
            }
            List<OpenDoubtConfigResponse.QueryTypeOption> types = learnerSelectableTypes(setting).stream()
                    .map(t -> new OpenDoubtConfigResponse.QueryTypeOption(t.getKey(), t.getLabel()))
                    .toList();
            return OpenDoubtConfigResponse.builder()
                    .learnerQuery(new OpenDoubtConfigResponse.LearnerQueryFlags(
                            true, Boolean.TRUE.equals(setting.getLearnerQuery().getAllowGuest())))
                    .queryTypes(types)
                    .build();
        } catch (Exception e) {
            log.warn("Open doubt config lookup failed for institute {}: {}", instituteId, e.getMessage());
            return OpenDoubtConfigResponse.disabled();
        }
    }

    /**
     * Logged-out guest query creation (open endpoint). Server-side gate: the institute's
     * allow-guest toggle must be ON regardless of what the client claims; contact + content are
     * validated and the doubt is forced to a batchless GENERAL shape with no user id.
     */
    public String createGuestDoubt(DoubtsDto request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("instituteId is required");
        }
        DoubtManagementSettingDataDto setting = loadDoubtManagementSettingByInstitute(request.getInstituteId());
        boolean guestAllowed = setting != null && setting.getLearnerQuery() != null
                && Boolean.TRUE.equals(setting.getLearnerQuery().getEnabled())
                && Boolean.TRUE.equals(setting.getLearnerQuery().getAllowGuest());
        if (!guestAllowed) {
            throw new VacademyException("Guest queries are not enabled for this institute");
        }
        if (!StringUtils.hasText(request.getGuestName())
                || request.getGuestName().trim().length() > GUEST_CONTACT_MAX_CHARS) {
            throw new VacademyException("Name is required");
        }
        if (!StringUtils.hasText(request.getGuestEmail())
                || request.getGuestEmail().trim().length() > GUEST_CONTACT_MAX_CHARS
                || !EMAIL_PATTERN.matcher(request.getGuestEmail().trim()).matches()) {
            throw new VacademyException("A valid email is required");
        }
        if (!StringUtils.hasText(request.getHtmlText())) {
            throw new VacademyException("Query text is required");
        }
        if (request.getHtmlText().length() > GUEST_TEXT_MAX_CHARS) {
            throw new VacademyException("Query text is too long");
        }
        // Match case-insensitively but persist the CONFIGURED key so the admin inbox type filter
        // (exact d.type IN :types) still matches; uppercasing the raw client echo would diverge.
        String requestedType = StringUtils.hasText(request.getType()) ? request.getType().trim() : DEFAULT_TYPE;
        String canonicalKey = learnerSelectableTypes(setting).stream()
                .filter(t -> requestedType.equalsIgnoreCase(t.getKey()))
                .map(DoubtManagementSettingDataDto.QueryTypeConfig::getKey)
                .findFirst()
                .orElse(null);
        if (canonicalKey == null) {
            throw new VacademyException("Unknown query type");
        }

        DoubtsDto sanitized = DoubtsDto.builder()
                .source(DoubtsSourceEnum.GENERAL.name())
                .type(canonicalKey)
                .instituteId(request.getInstituteId())
                .guestName(request.getGuestName().trim())
                .guestEmail(request.getGuestEmail().trim())
                .htmlText(request.getHtmlText())
                .build();
        return createNewDoubt(sanitized);
    }

    /**
     * A doubt raised on the learner's behalf by the learner AI chatbot (ai_service, internal HMAC
     * call), after the learner agreed to send their question to a teacher. Goes through the same
     * {@link #createNewDoubt} as the learner app, so routing, notifications and the DOUBT_RAISED
     * workflow all fire. The caller supplies the learner identity from its authenticated chat
     * session and has already picked one of the learner's ACTIVE batches.
     *
     * <p>The text is ALWAYS escaped (it is model-written plain text, also for SLIDE doubts, whose
     * html_text is otherwise stored raw), and an unknown type falls back to the institute's first
     * learner-selectable type rather than failing the hand-off.
     */
    public String createDoubtForLearner(String userId, String instituteId, String batchId,
                                        String slideId, String type, String text) {
        if (!StringUtils.hasText(userId) || !StringUtils.hasText(instituteId)) {
            throw new VacademyException("userId and instituteId are required");
        }
        if (!StringUtils.hasText(text)) {
            throw new VacademyException("Query text is required");
        }
        String trimmed = text.trim();
        if (trimmed.length() > 4000) {
            trimmed = trimmed.substring(0, 4000);
        }
        List<DoubtManagementSettingDataDto.QueryTypeConfig> selectable =
                learnerSelectableTypes(loadDoubtManagementSettingByInstitute(instituteId));
        String requested = StringUtils.hasText(type) ? type.trim() : DEFAULT_TYPE;
        String canonicalKey = selectable.stream()
                .filter(t -> requested.equalsIgnoreCase(t.getKey()))
                .map(DoubtManagementSettingDataDto.QueryTypeConfig::getKey)
                .findFirst()
                .orElseGet(() -> selectable.stream()
                        .filter(t -> DEFAULT_TYPE.equalsIgnoreCase(t.getKey()))
                        .map(DoubtManagementSettingDataDto.QueryTypeConfig::getKey)
                        .findFirst()
                        .orElse(selectable.get(0).getKey()));
        boolean onSlide = StringUtils.hasText(slideId);
        DoubtsDto request = DoubtsDto.builder()
                .userId(userId)
                .instituteId(instituteId)
                .batchId(StringUtils.hasText(batchId) ? batchId : null)
                .source(onSlide ? DoubtsSourceEnum.SLIDE.name() : DoubtsSourceEnum.GENERAL.name())
                .sourceId(onSlide ? slideId : "")
                .type(canonicalKey)
                // GENERAL text is escaped by createNewDoubt; SLIDE html is stored as-is, so
                // escape it here — this text is model-written, never editor HTML.
                .htmlText(onSlide
                        ? org.springframework.web.util.HtmlUtils.htmlEscape(trimmed).replace("\n", "<br>")
                        : trimmed)
                .parentLevel(0)
                .build();
        return createNewDoubt(request, userId);
    }

    /**
     * GENERAL queries (the "?" dialog + the unauthenticated guest endpoint) carry PLAIN TEXT from a
     * textarea — but it lands in the {@code html_text} column that the admin renders with
     * dangerouslySetInnerHTML. HTML-escape it so a guest can't inject {@code <img onerror=…>}/script
     * that would execute in an admin's session (stored XSS). Newlines become {@code <br>} so the
     * escaped text still reads naturally. SLIDE doubts keep their rich editor HTML untouched.
     */
    private String sanitizeDoubtHtml(String source, String htmlText) {
        if (htmlText == null) return null;
        if (!DoubtsSourceEnum.GENERAL.name().equals(source)) return htmlText;
        return org.springframework.web.util.HtmlUtils.htmlEscape(htmlText).replace("\n", "<br>");
    }

    /** Enabled + learner-selectable types; falls back to the built-in DOUBT when none configured. */
    private List<DoubtManagementSettingDataDto.QueryTypeConfig> learnerSelectableTypes(
            DoubtManagementSettingDataDto setting) {
        List<DoubtManagementSettingDataDto.QueryTypeConfig> configured =
                setting == null || setting.getQueryTypes() == null ? List.of() : setting.getQueryTypes();
        List<DoubtManagementSettingDataDto.QueryTypeConfig> selectable = configured.stream()
                .filter(t -> t != null && StringUtils.hasText(t.getKey()))
                .filter(t -> !Boolean.FALSE.equals(t.getEnabled()))
                .filter(t -> !Boolean.FALSE.equals(t.getLearnerSelectable()))
                .toList();
        if (!selectable.isEmpty()) return selectable;
        DoubtManagementSettingDataDto.QueryTypeConfig doubtDefault =
                new DoubtManagementSettingDataDto.QueryTypeConfig();
        doubtDefault.setKey(DEFAULT_TYPE);
        doubtDefault.setLabel("Doubt");
        return List.of(doubtDefault);
    }

    private String createNewDoubt(DoubtsDto request) {
        return createNewDoubt(request, null);
    }

    /** Guest + internal (HMAC) paths: the request's user id was set server-side, so it is kept. */
    private String createNewDoubt(DoubtsDto request, String actorUserId) {
        return createNewDoubt(request, actorUserId, instituteId -> request.getUserId());
    }

    /**
     * @param actorUserId        the authenticated caller (learner, staff) — recorded on the CREATED row and
     *                           as the actor of any assignees they picked by hand. {@code null} for guests.
     * @param authorForInstitute maps the doubt's resolved institute (may be null) to the user id the
     *                           doubt is raised as.
     */
    private String createNewDoubt(DoubtsDto request, String actorUserId, UnaryOperator<String> authorForInstitute) {
        boolean isReply = StringUtils.hasText(request.getParentId());

        // Resolve type / institute / batch up-front — needed for per-type routing, the admin
        // fallback, AND the notification dispatch below.
        String type;
        String instituteId;
        String packageSessionId;
        Doubts parentDoubt = null;
        if (isReply) {
            // A reply belongs to its parent's thread — inherit tenancy/type/batch from the parent so
            // the row is consistent regardless of what the client echoed back.
            parentDoubt = doubtService.getDoubtById(request.getParentId()).orElse(null);
            Doubts parent = parentDoubt;
            type = (parent != null && StringUtils.hasText(parent.getType())) ? parent.getType() : DEFAULT_TYPE;
            instituteId = parent != null ? parent.getInstituteId() : request.getInstituteId();
            packageSessionId = parent != null ? parent.getPackageSessionId() : request.getBatchId();
            if (!StringUtils.hasText(instituteId) && StringUtils.hasText(packageSessionId)) {
                instituteId = facultyMappingRepository.findInstituteIdByPackageSessionId(packageSessionId).orElse(null);
            }
        } else {
            type = StringUtils.hasText(request.getType()) ? request.getType() : DEFAULT_TYPE;
            packageSessionId = request.getBatchId();
            // When the doubt is on a batch (SLIDE doubts), the batch is the source of truth for
            // tenancy — derive institute from it FIRST so a learner's stored "home" institute can't
            // mis-scope a doubt on a cross-institute course. Only batch-less GENERAL queries trust
            // the request's instituteId.
            if (StringUtils.hasText(packageSessionId)) {
                instituteId = facultyMappingRepository.findInstituteIdByPackageSessionId(packageSessionId)
                        .orElse(StringUtils.hasText(request.getInstituteId()) ? request.getInstituteId() : null);
            } else {
                instituteId = StringUtils.hasText(request.getInstituteId()) ? request.getInstituteId() : null;
            }
            // A GENERAL query has no batch to fall back on — fail loud rather than silently
            // orphaning it with a null institute (no routing, no notification, invisible in inbox).
            if (DoubtsSourceEnum.GENERAL.name().equals(request.getSource())
                    && !StringUtils.hasText(instituteId)) {
                throw new VacademyException("instituteId is required for general queries");
            }
        }

        Doubts doubts = Doubts.builder()
                .status(DoubtStatusEnum.ACTIVE.name())
                .userId(authorForInstitute.apply(instituteId))
                .source(request.getSource())
                .sourceId(request.getSourceId())
                .type(type)
                .instituteId(instituteId)
                .guestName(request.getGuestName())
                .guestEmail(request.getGuestEmail())
                .htmlText(sanitizeDoubtHtml(request.getSource(), request.getHtmlText()))
                .parentLevel(request.getParentLevel() == null ? 0 : request.getParentLevel())
                .raisedTime(new Date())
                .parentId(request.getParentId())
                .contentPosition(request.getContentPosition())
                .contentType(request.getContentType())
                .packageSessionId(packageSessionId)
                .build();

        Doubts savedDoubt = doubtService.updateOrCreateDoubt(doubts);
        List<String> finalAssigneeIds = new ArrayList<>();
        // Which rule put each assignee on the doubt (first source wins) — feeds the audit trail so
        // an admin can see "auto-assigned by Technical Issue → Role: Admin" vs "picked by Shreyash".
        Map<String, String> assigneeRules = new LinkedHashMap<>();
        if (savedDoubt.getParentId() == null) {
            Set<String> assigneeIds = new LinkedHashSet<>();
            DoubtManagementSettingDataDto setting = loadDoubtManagementSettingByInstitute(instituteId);
            doubtService.recordActivity(DoubtActivity.builder()
                    .doubtId(savedDoubt.getId())
                    .action(DoubtActivityActionEnum.CREATED.name())
                    .actorType(actorUserId != null ? DoubtActivityActorTypeEnum.USER.name() : DoubtActivityActorTypeEnum.SYSTEM.name())
                    .actorUserId(actorUserId)
                    .toValue(DoubtStatusCatalog.PENDING)
                    .build());

            // Resolve the sub-org routing up front — it decides whether the PARENT institute's
            // cascade even runs. A doubt from a sub-org learner can be handled by the sub-org
            // exclusively (parent staff not notified) or additively (parent staff notified too).
            SubOrgRouting subOrg = resolveSubOrgRouting(savedDoubt, instituteId, setting);

            if (subOrg.isSubOrgLearner() && subOrg.exclusive()) {
                // EXCLUSIVE sub-org handling: notify ONLY the sub-org's own staff. The parent
                // institute's teachers/admins are deliberately NOT added as assignees, so they get
                // no email/push/bell — but the doubt still surfaces in their Doubt Management inbox
                // because inbox visibility is scoped by institute/batch, not by assignee. Explicit
                // admin-picked ids at creation time are still honored.
                assigneeIds.addAll(subOrg.staff());
                subOrg.staff().forEach(id -> assigneeRules.putIfAbsent(id, "SUB_ORG"));
                addExplicitAssignees(request, assigneeIds);
                explicitAssigneeIds(request).forEach(id -> assigneeRules.putIfAbsent(id, MANUAL_RULE));
                // Never drop the doubt on the floor: if the sub-org resolved to nobody (e.g. a
                // sub-org with no admin/team yet), fall back to the parent admin so at least one
                // person is notified rather than zero.
                if (assigneeIds.isEmpty() && instituteId != null) {
                    log.info("Doubt {} is sub-org-exclusive but resolved 0 sub-org staff — "
                            + "falling back to parent admin so it isn't dropped", savedDoubt.getId());
                    List<String> fallback = resolveAdminFallback(instituteId);
                    assigneeIds.addAll(fallback);
                    fallback.forEach(id -> assigneeRules.putIfAbsent(id, "ADMIN_FALLBACK"));
                }
            } else {
                // ADDITIVE / non-sub-org: resolve the assignee list via per-type routing
                // (DOUBT_MANAGEMENT_SETTING.queryTypes): each type may route to subject/batch
                // teacher, a role, or specific staff. Types with no config fall back to the global
                // defaultAssigneeSource cascade. Resolution is best-effort: a transient failure here
                // (e.g. slide-metadata / faculty lookup) must NOT leave the doubt with zero
                // recipients — that silently drops BOTH the email and the bell alert. We fall back to
                // the institute admin below so every raised doubt notifies at least one person.
                boolean resolutionFailed = false;
                try {
                    String subjectId = resolveSubjectIdForDoubt(savedDoubt);
                    String rule = describeRoutingRule(savedDoubt, setting);
                    List<String> routed = resolveAssigneesForDoubt(savedDoubt, subjectId, instituteId, setting);
                    assigneeIds.addAll(routed);
                    routed.forEach(id -> assigneeRules.putIfAbsent(id, rule));
                    addExplicitAssignees(request, assigneeIds);
                    explicitAssigneeIds(request).forEach(id -> assigneeRules.putIfAbsent(id, MANUAL_RULE));
                } catch (Exception e) {
                    resolutionFailed = true;
                    log.error("Failed to resolve doubt assignees for doubt {}: {}", savedDoubt.getId(), e.getMessage());
                }
                // Safety net: if assignee routing *threw* before returning, fall back to the institute
                // admin(s) so a transient failure (slide-metadata / faculty lookup) never silently drops
                // the raise notification — no email AND no bell. A deliberate empty result (e.g. per-type
                // NONE routing = manual triage from the admin inbox) is respected: we only backfill when
                // resolution errored out, since the faculty cascade already appends the admin fallback on
                // its own genuinely-empty results.
                if (resolutionFailed && assigneeIds.isEmpty() && instituteId != null) {
                    List<String> fallback = resolveAdminFallback(instituteId);
                    assigneeIds.addAll(fallback);
                    fallback.forEach(id -> assigneeRules.putIfAbsent(id, "ADMIN_FALLBACK"));
                }
                // Sub-org staff are ADDITIVE here, on top of the parent cascade: none of the
                // institute-level routes can reach them — batch-teacher lookups exclude sub-org
                // access rows and role lookups run against the PARENT institute — so a sub-org
                // learner's doubt would otherwise land only on the parent institute's desk. Keyed on
                // the raiser's own sub-org linkage, so parent-institute learners are unaffected.
                assigneeIds.addAll(subOrg.staff());
                subOrg.staff().forEach(id -> assigneeRules.putIfAbsent(id, "SUB_ORG"));
            }
            // Persist the assignee rows best-effort. A transient save failure must not drop the
            // notification — we keep the resolved ids and still notify below.
            if (!assigneeIds.isEmpty()) {
                try {
                    createDoubtsAssignee(savedDoubt, new ArrayList<>(assigneeIds));
                    // One ASSIGNED row per person: RULE-actor rows name the routing rule, MANUAL
                    // ones name the caller who picked them. Only once the rows are really saved —
                    // the trail must not claim an assignment that never persisted.
                    for (String id : assigneeIds) {
                        String rule = assigneeRules.getOrDefault(id, MANUAL_RULE);
                        boolean manual = MANUAL_RULE.equals(rule);
                        doubtService.recordActivity(DoubtActivity.builder()
                                .doubtId(savedDoubt.getId())
                                .action(DoubtActivityActionEnum.ASSIGNED.name())
                                .actorType(manual && actorUserId != null
                                        ? DoubtActivityActorTypeEnum.USER.name()
                                        : DoubtActivityActorTypeEnum.RULE.name())
                                .actorUserId(manual ? actorUserId : null)
                                .targetUserId(id)
                                .ruleSource(manual ? null : rule)
                                .build());
                    }
                } catch (Exception e) {
                    log.error("Failed to persist doubt assignees for doubt {}: {}", savedDoubt.getId(), e.getMessage());
                }
            }
            finalAssigneeIds.addAll(assigneeIds);
        }

        // Fire "doubt raised" notifications after the assignees are resolved. Only for top-level
        // doubts (not replies) and only when we have at least one recipient to notify. Notification
        // failures are swallowed inside the service and must not affect the doubt creation response.
        if (savedDoubt.getParentId() == null && !finalAssigneeIds.isEmpty() && instituteId != null) {
            doubtNotificationService.notifyDoubtRaised(savedDoubt, finalAssigneeIds, instituteId);
        } else if (savedDoubt.getParentId() == null && finalAssigneeIds.isEmpty()
                && !isDeliberatelyUnassigned(savedDoubt, instituteId)) {
            // Nobody was notified — no email, no push, no bell — and the doubt only surfaces if
            // someone happens to open the Doubt Management inbox. Anything that lands here is a
            // routing failure rather than a configured choice (per-type NONE is filtered out above),
            // so make it greppable: previously this dropped in complete silence, which is why the
            // loss went unnoticed across many institutes.
            log.error("Doubt {} (institute {}, type {}, batch {}) resolved 0 recipients — "
                    + "raise notification skipped entirely (no email/push/bell)",
                    savedDoubt.getId(), instituteId, savedDoubt.getType(), savedDoubt.getPackageSessionId());
        }

        // A staff reply on a GUEST doubt (no user account) is emailed to the guest's address —
        // that email is the guest's only way to receive the answer. Service swallows failures.
        if (isReply && parentDoubt != null && instituteId != null) {
            doubtNotificationService.notifyGuestReply(parentDoubt, savedDoubt.getHtmlText(), instituteId);
        }

        // Fire the DOUBT_RAISED workflow trigger so admin/team-notification
        // recipes can react. Only for top-level doubts (replies don't count as
        // a "raised" event) and only when we know the institute. Wrapped so
        // workflow failures can't affect the doubt creation response.
        if (savedDoubt.getParentId() == null && instituteId != null && !instituteId.isBlank()) {
            try {
                java.util.Map<String, Object> ctx = new java.util.HashMap<>();
                ctx.put("doubtId", savedDoubt.getId());
                ctx.put("userId", savedDoubt.getUserId());
                ctx.put("packageSessionId", savedDoubt.getPackageSessionId());
                ctx.put("source", savedDoubt.getSource());
                ctx.put("sourceId", savedDoubt.getSourceId());
                ctx.put("contentType", savedDoubt.getContentType());
                ctx.put("htmlText", savedDoubt.getHtmlText());
                ctx.put("raisedTime", savedDoubt.getRaisedTime());
                ctx.put("assigneeIds", finalAssigneeIds);
                workflowTriggerService.handleTriggerEvents(
                        vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.DOUBT_RAISED.name(),
                        savedDoubt.getId(),
                        instituteId,
                        ctx);
            } catch (Exception wfe) {
                log.warn("Failed to trigger DOUBT_RAISED workflow for doubt {}: {}",
                        savedDoubt.getId(), wfe.getMessage());
            }
        }

        return savedDoubt.getId();
    }

    /**
     * Routes a freshly-created top-level doubt to its default assignees based on its {@code type}.
     * Looks up the type's config in {@code DOUBT_MANAGEMENT_SETTING.queryTypes}; when present, uses
     * its per-type {@code assignee} block, otherwise falls back to the institute-wide
     * {@code defaultAssigneeSource} cascade (legacy behavior). The admin safety net inside the
     * cascade ensures a doubt is never silently dropped.
     */
    private List<String> resolveAssigneesForDoubt(Doubts doubt, String subjectId, String instituteId,
                                                  DoubtManagementSettingDataDto setting) {
        String typeKey = StringUtils.hasText(doubt.getType()) ? doubt.getType() : DEFAULT_TYPE;
        DoubtManagementSettingDataDto.QueryTypeConfig typeConfig = findTypeConfig(setting, typeKey);
        if (typeConfig != null && typeConfig.getAssignee() != null
                && (StringUtils.hasText(typeConfig.getAssignee().getSource())
                    || hasAdditionalHandlers(typeConfig.getAssignee()))) {
            return resolveTypeAssignees(typeConfig.getAssignee(), doubt.getPackageSessionId(),
                    subjectId, instituteId, setting);
        }
        // No per-type routing for this type → institute-wide default cascade.
        return resolveImplicitAssignees(parseAssigneeSource(setting), doubt.getPackageSessionId(),
                subjectId, instituteId, setting);
    }

    /**
     * True when this doubt's type is configured with per-type {@code assignee.source = NONE} — the
     * institute deliberately chose manual triage from the inbox, so zero recipients is the intended
     * outcome and must not be reported as a routing failure.
     *
     * <p>The global {@code defaultAssigneeSource = NONE} is deliberately NOT this case: that one
     * routes to the institute's admins (see {@link #resolveImplicitAssignees}), so ending up with
     * nobody there IS a failure worth logging.</p>
     *
     * <p>Only consulted on the zero-recipient path, so the extra setting read stays off the hot path.</p>
     */
    private boolean isDeliberatelyUnassigned(Doubts doubt, String instituteId) {
        try {
            DoubtManagementSettingDataDto setting = loadDoubtManagementSettingByInstitute(instituteId);
            String typeKey = StringUtils.hasText(doubt.getType()) ? doubt.getType() : DEFAULT_TYPE;
            DoubtManagementSettingDataDto.QueryTypeConfig typeConfig = findTypeConfig(setting, typeKey);
            if (typeConfig == null || typeConfig.getAssignee() == null
                    || !StringUtils.hasText(typeConfig.getAssignee().getSource())) {
                return false;
            }

            if (parseSource(typeConfig.getAssignee().getSource()) != DoubtDefaultAssigneeSourceEnum.NONE) {
                return false;
            }
            // NONE plus additive handlers that resolved to nobody is a failed lookup, not a choice.
            return !hasAdditionalHandlers(typeConfig.getAssignee());
        } catch (Exception e) {
            // Can't confirm the empty result was intentional → treat it as a real drop and log it.
            return false;
        }
    }

    /**
     * Outcome of resolving how a doubt should be routed with respect to the raiser's sub-org.
     *
     * @param isSubOrgLearner whether the raiser belongs to a sub-org at all (drives whether the
     *                        exclusive branch is even considered).
     * @param exclusive       when true, ONLY {@link #staff()} are notified — the parent institute's
     *                        cascade is skipped so its staff get no notification (they still see the
     *                        doubt in Doubt Management). When false, {@link #staff()} are additive on
     *                        top of the parent cascade.
     * @param staff           the sub-org's own recipients (admins, optionally + team), raiser removed.
     */
    private record SubOrgRouting(boolean isSubOrgLearner, boolean exclusive, List<String> staff) {
        static SubOrgRouting none() { return new SubOrgRouting(false, false, List.of()); }
    }

    /**
     * Resolves the sub-org recipients for a doubt and whether they handle it exclusively.
     *
     * <p>Why the sub-org can't fall out of the normal cascade: a sub-org shares the parent
     * institute's id, courses and batches. {@code findRealTeachersByPackageSessionId} deliberately
     * skips rows carrying a {@code suborg_id} (they are access grants, not teachers of the batch) and
     * {@code resolveUsersByRole} asks auth-service about the PARENT institute — so every existing
     * route resolves to parent-institute staff only, and the people actually responsible for that
     * learner never hear about the query.
     *
     * <p>Governed by {@code DOUBT_MANAGEMENT_SETTING.sub_org_notifications}: {@code enabled=false}
     * disables sub-org routing entirely; {@code notify_parent_staff=false} makes it exclusive
     * (parent staff not notified). Returns {@link SubOrgRouting#none()} for guest doubts (no user
     * id), learners with no sub-org linkage, and on any lookup failure.
     */
    private SubOrgRouting resolveSubOrgRouting(Doubts doubt, String instituteId,
                                               DoubtManagementSettingDataDto setting) {
        if (doubt == null || !StringUtils.hasText(doubt.getUserId())) return SubOrgRouting.none();
        try {
            DoubtManagementSettingDataDto effective = setting != null
                    ? setting
                    : loadDoubtManagementSettingByInstitute(instituteId);
            DoubtManagementSettingDataDto.SubOrgNotificationPrefs prefs =
                    effective == null ? null : effective.getSubOrgNotifications();
            if (prefs != null && Boolean.FALSE.equals(prefs.getEnabled())) return SubOrgRouting.none();

            List<String> subOrgIds = subOrgStaffLookupService.resolveLearnerSubOrgIds(
                    doubt.getUserId(), instituteId, doubt.getPackageSessionId());
            if (subOrgIds.isEmpty()) return SubOrgRouting.none(); // not a sub-org learner

            SubOrgStaffLookupService.Audience audience =
                    parseSubOrgAudience(prefs == null ? null : prefs.getRecipients());
            List<String> staff = new ArrayList<>(
                    subOrgStaffLookupService.resolveStaffUserIds(subOrgIds, audience));
            staff.remove(doubt.getUserId()); // never notify a learner about their own doubt
            // Additive by default; only an explicit notify_parent_staff=false makes it exclusive.
            boolean exclusive = prefs != null && Boolean.FALSE.equals(prefs.getNotifyParentStaff());
            if (!staff.isEmpty()) {
                log.info("Doubt {} raised by sub-org learner {} — {} sub-org staff recipient(s), exclusive={}",
                        doubt.getId(), doubt.getUserId(), staff.size(), exclusive);
            }
            return new SubOrgRouting(true, exclusive, staff);
        } catch (Exception e) {
            log.warn("Sub-org routing resolution failed for doubt {}: {}", doubt.getId(), e.getMessage());
            return SubOrgRouting.none();
        }
    }

    /** Overlay any explicit ids the client asked for (e.g. an admin picked someone from the
     *  dropdown at creation time). Blank ids are skipped. */
    private void addExplicitAssignees(DoubtsDto request, Set<String> assigneeIds) {
        if (request.getDoubtAssigneeRequestUserIds() == null) return;
        request.getDoubtAssigneeRequestUserIds().stream()
                .filter(id -> id != null && !id.isEmpty())
                .forEach(assigneeIds::add);
    }

    private List<String> explicitAssigneeIds(DoubtsDto request) {
        if (request.getDoubtAssigneeRequestUserIds() == null) return List.of();
        return request.getDoubtAssigneeRequestUserIds().stream()
                .filter(id -> id != null && !id.isEmpty())
                .toList();
    }

    /**
     * Human-readable code for the rule that routed a doubt, stored on the audit row:
     * {@code TYPE:<key>:<source>[:<role>]} when the type has its own routing, else
     * {@code DEFAULT:<default_assignee_source>}. The admin app formats these; keep them stable.
     */
    private String describeRoutingRule(Doubts doubt, DoubtManagementSettingDataDto setting) {
        String typeKey = StringUtils.hasText(doubt.getType()) ? doubt.getType() : DEFAULT_TYPE;
        DoubtManagementSettingDataDto.QueryTypeConfig typeConfig = findTypeConfig(setting, typeKey);
        if (typeConfig != null && typeConfig.getAssignee() != null
                && (StringUtils.hasText(typeConfig.getAssignee().getSource())
                    || hasAdditionalHandlers(typeConfig.getAssignee()))) {
            StringBuilder sb = new StringBuilder("TYPE:").append(typeKey);
            if (StringUtils.hasText(typeConfig.getAssignee().getSource())) {
                sb.append(':').append(typeConfig.getAssignee().getSource().trim().toUpperCase());
                if (StringUtils.hasText(typeConfig.getAssignee().getRole())) {
                    sb.append(':').append(typeConfig.getAssignee().getRole().trim().toUpperCase());
                }
            }
            return sb.toString();
        }
        return "DEFAULT:" + parseAssigneeSource(setting).name();
    }

    /** Unknown/blank values default to ALL_TEAM (admins + team members), the documented default. */
    private SubOrgStaffLookupService.Audience parseSubOrgAudience(String raw) {
        if (!StringUtils.hasText(raw)) return SubOrgStaffLookupService.Audience.ALL_TEAM;
        try {
            return SubOrgStaffLookupService.Audience.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            log.warn("Unknown sub_org_notifications.recipients '{}', falling back to ALL_TEAM", raw);
            return SubOrgStaffLookupService.Audience.ALL_TEAM;
        }
    }

    private boolean hasAdditionalHandlers(DoubtManagementSettingDataDto.QueryTypeAssignee assignee) {
        return (assignee.getAlsoUserIds() != null && !assignee.getAlsoUserIds().isEmpty())
                || (assignee.getAlsoRoles() != null && !assignee.getAlsoRoles().isEmpty());
    }

    private DoubtManagementSettingDataDto.QueryTypeConfig findTypeConfig(
            DoubtManagementSettingDataDto setting, String typeKey) {
        if (setting == null || setting.getQueryTypes() == null) return null;
        return setting.getQueryTypes().stream()
                .filter(t -> t != null && typeKey.equalsIgnoreCase(t.getKey()))
                .findFirst().orElse(null);
    }

    /**
     * Resolves assignees for a type whose {@code assignee.source} is set. The result is the UNION of
     * two independent parts, which is what lets one type route to "subject teacher AND these three
     * people" rather than forcing a single winner:
     *
     * <ul>
     *   <li>the base route — SPECIFIC_USERS → the configured user ids; ROLE → all users holding that
     *       role; SUBJECT/BATCH/BOTH → the faculty cascade; NONE → nobody;</li>
     *   <li>the additive handlers — {@code also_user_ids} plus everyone holding an {@code also_roles}
     *       role, always added on top of the base.</li>
     * </ul>
     *
     * <p>The admin safety net now fires only when the whole union comes out empty. Once an institute
     * has named additive handlers they ARE the safety net, and adding every admin on top of them
     * would notify exactly the people the admin routed around. A per-type {@code NONE} with no
     * additive handlers still means "assign nobody" — deliberate manual triage from the inbox.</p>
     */
    private List<String> resolveTypeAssignees(DoubtManagementSettingDataDto.QueryTypeAssignee assignee,
                                              String packageSessionId, String subjectId, String instituteId,
                                              DoubtManagementSettingDataDto setting) {
        // A blank source means the type never overrode the institute default — keep that cascade as
        // the base so "default auto-assignment PLUS these two people" is expressible.
        DoubtDefaultAssigneeSourceEnum source = StringUtils.hasText(assignee.getSource())
                ? parseSource(assignee.getSource())
                : parseAssigneeSource(setting);
        List<String> additional = resolveAdditionalAssignees(assignee, instituteId);
        // With additive handlers configured, the base route must not drag in its own admin fallback.
        boolean allowAdminFallback = additional.isEmpty();

        Set<String> assignees = new LinkedHashSet<>(resolveBaseTypeAssignees(
                assignee, source, packageSessionId, subjectId, instituteId, setting, allowAdminFallback));
        assignees.addAll(additional);

        // Only needed when the base route's own safety net was suppressed above. With no additive
        // handlers the base already applied it, and repeating the identical (retrying) ADMIN lookup
        // here would double its cost for a guaranteed-identical result.
        if (assignees.isEmpty() && !allowAdminFallback
                && source != DoubtDefaultAssigneeSourceEnum.NONE) {
            assignees.addAll(resolveAdminFallback(instituteId));
        }
        return new ArrayList<>(assignees);
    }

    /** The {@code assignee.source} leg of {@link #resolveTypeAssignees}, minus the additive handlers. */
    private List<String> resolveBaseTypeAssignees(DoubtManagementSettingDataDto.QueryTypeAssignee assignee,
                                                  DoubtDefaultAssigneeSourceEnum source, String packageSessionId,
                                                  String subjectId, String instituteId,
                                                  DoubtManagementSettingDataDto setting,
                                                  boolean allowAdminFallback) {
        switch (source) {
            case SPECIFIC_USERS: {
                List<String> ids = assignee.getUserIds() == null ? List.of()
                        : assignee.getUserIds().stream().filter(StringUtils::hasText).distinct().toList();
                if (!ids.isEmpty()) return ids;
                return allowAdminFallback ? resolveAdminFallback(instituteId) : List.of();
            }
            case ROLE: {
                String role = StringUtils.hasText(assignee.getRole()) ? assignee.getRole() : ADMIN_ROLE;
                List<String> ids = resolveUsersByRole(instituteId, role);
                // When the configured role IS admin, resolveAdminFallback would repeat the identical
                // lookup — which now carries its own retries — for a guaranteed-identical result.
                // Skip it so an empty admin role costs the same attempts as any other empty role.
                if (!ids.isEmpty() || ADMIN_ROLE.equalsIgnoreCase(role)) return ids;
                return allowAdminFallback ? resolveAdminFallback(instituteId) : List.of();
            }
            case NONE:
                return List.of();
            default:
                return resolveImplicitAssignees(source, packageSessionId, subjectId, instituteId,
                        setting, allowAdminFallback);
        }
    }

    /**
     * The additive handlers for a type: {@code also_user_ids} verbatim, plus every user holding one
     * of {@code also_roles}. Order is preserved (explicit ids first) and duplicates collapse, so a
     * person named both explicitly and via a role is assigned once. Empty when neither is configured
     * — the overwhelmingly common case, and it costs zero lookups.
     */
    private List<String> resolveAdditionalAssignees(DoubtManagementSettingDataDto.QueryTypeAssignee assignee,
                                                    String instituteId) {
        Set<String> additional = new LinkedHashSet<>();
        if (assignee.getAlsoUserIds() != null) {
            assignee.getAlsoUserIds().stream().filter(StringUtils::hasText).forEach(additional::add);
        }
        if (assignee.getAlsoRoles() != null) {
            assignee.getAlsoRoles().stream()
                    .filter(StringUtils::hasText)
                    .distinct()
                    .forEach(role -> additional.addAll(resolveUsersByRole(instituteId, role)));
        }
        return new ArrayList<>(additional);
    }

    /**
     * Faculty cascade for SUBJECT_TEACHER / BATCH_TEACHER / BOTH (cascades teacher → batch → admin).
     * Reused by both the legacy global-default path and per-type routing — the caller passes the
     * resolved {@code source} and the loaded {@code setting}. Admin fallback is the safety net: even
     * with no faculty mapped, the institute's ADMIN users still receive the doubt. Returns empty only
     * when neither faculty nor admin lookup yields anyone.
     *
     * @param subjectId  may be {@code null} (non-slide); SUBJECT_TEACHER then skips the subject step.
     * @param instituteId required for the admin fallback; if null the admin step is skipped.
     */
    List<String> resolveImplicitAssignees(DoubtDefaultAssigneeSourceEnum source, String packageSessionId,
                                          String subjectId, String instituteId,
                                          DoubtManagementSettingDataDto setting) {
        return resolveImplicitAssignees(source, packageSessionId, subjectId, instituteId, setting, true);
    }

    /**
     * @param allowAdminFallback false only when the caller has its own guaranteed recipients (a
     *        type's additive handlers). The cascade then returns empty instead of widening to every
     *        admin, so "batch teacher + these two people" doesn't quietly become "+ all admins" on a
     *        batch with no faculty mapped.
     */
    List<String> resolveImplicitAssignees(DoubtDefaultAssigneeSourceEnum source, String packageSessionId,
                                          String subjectId, String instituteId,
                                          DoubtManagementSettingDataDto setting,
                                          boolean allowAdminFallback) {
        // NONE → skip teachers entirely, go straight to admin so the doubt is still routed.
        if (source == DoubtDefaultAssigneeSourceEnum.NONE) {
            return adminFallbackIfAllowed(instituteId, allowAdminFallback);
        }
        // ROLE / SPECIFIC_USERS are only meaningful as a per-type choice, not a global cascade — if
        // one reaches here, route to admin rather than nobody.
        if (source == DoubtDefaultAssigneeSourceEnum.ROLE
                || source == DoubtDefaultAssigneeSourceEnum.SPECIFIC_USERS) {
            return adminFallbackIfAllowed(instituteId, allowAdminFallback);
        }
        // The faculty cascade needs a batch. GENERAL queries (no batch) → admin fallback.
        if (packageSessionId == null || packageSessionId.isEmpty()) {
            return adminFallbackIfAllowed(instituteId, allowAdminFallback);
        }

        // Step 1: SUBJECT_TEACHER → try the subject-specific faculty first.
        if (source == DoubtDefaultAssigneeSourceEnum.SUBJECT_TEACHER
                && subjectId != null && !subjectId.isEmpty()) {
            List<String> subjectFaculty = activeUserIdsFromMappings(
                    facultyMappingRepository.findByPackageSessionIdAndSubjectId(packageSessionId, subjectId));
            if (!subjectFaculty.isEmpty()) return subjectFaculty;
            // Subject teacher missing — honor fallback toggle. Default true: cascade to batch.
            boolean fallback = setting == null
                    || setting.getFallbackToBatchWhenNoSubjectTeacher() == null
                    || Boolean.TRUE.equals(setting.getFallbackToBatchWhenNoSubjectTeacher());
            if (!fallback) {
                // Strict subject-only mode: skip batch but still keep the admin safety net so
                // the doubt isn't dropped on the floor.
                return adminFallbackIfAllowed(instituteId, allowAdminFallback);
            }
        }

        // Step 2: batch-wide faculty (this is what BATCH_TEACHER mode hits directly, and what
        // SUBJECT_TEACHER mode falls back to when subject teacher is empty).
        List<String> batchFaculty = activeUserIdsFromMappings(
                facultyMappingRepository.findRealTeachersByPackageSessionId(packageSessionId));
        if (!batchFaculty.isEmpty()) return batchFaculty;

        // Step 3: final fallback — institute admin(s).
        return adminFallbackIfAllowed(instituteId, allowAdminFallback);
    }

    private List<String> adminFallbackIfAllowed(String instituteId, boolean allowAdminFallback) {
        return allowAdminFallback ? resolveAdminFallback(instituteId) : List.of();
    }

    /**
     * Returns admin user IDs for the institute, or an empty list if none exist or instituteId is
     * unknown. Failures in auth_service are swallowed by AuthService.getUserIdsByRole.
     */
    private List<String> resolveAdminFallback(String instituteId) {
        return resolveUsersByRole(instituteId, ADMIN_ROLE);
    }

    /**
     * Returns the user ids holding {@code role} in the institute, or empty on any failure/blank input.
     *
     * <p>Retried once on an empty result. This lookup is the cascade's last line of defense — for an
     * institute on {@code defaultAssigneeSource=NONE} it is the ONLY source of recipients — and
     * {@link AuthService#getUserIdsByRole} collapses a transport failure and a genuinely-empty role
     * into the same empty list. A transient blip therefore costs the doubt every recipient, with no
     * way to tell the two apart here. One cheap retry converts most blips into a normal delivery; a
     * genuinely empty role just pays one extra call on a rare path.</p>
     */
    private List<String> resolveUsersByRole(String instituteId, String role) {
        if (instituteId == null || instituteId.isEmpty() || !StringUtils.hasText(role)) return List.of();
        for (int attempt = 1; attempt <= ROLE_LOOKUP_ATTEMPTS; attempt++) {
            try {
                List<String> ids = authService.getUserIdsByRole(instituteId, role);
                if (!ids.isEmpty()) return ids;
            } catch (Exception e) {
                log.warn("Role lookup attempt {} failed for institute {} role {}: {}",
                        attempt, instituteId, role, e.getMessage());
            }
            if (attempt < ROLE_LOOKUP_ATTEMPTS) sleepQuietly(ROLE_LOOKUP_RETRY_DELAY_MS);
        }
        log.warn("Role lookup resolved 0 users for institute {} role {} after {} attempts — "
                + "either the role is genuinely unassigned or auth_service is failing",
                instituteId, role, ROLE_LOOKUP_ATTEMPTS);
        return List.of();
    }

    /** Sleeps without propagating interruption as an exception, preserving the interrupt flag. */
    private void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }

    private List<String> activeUserIdsFromMappings(List<FacultySubjectPackageSessionMapping> mappings) {
        return mappings.stream()
                .filter(m -> "ACTIVE".equalsIgnoreCase(m.getStatus()))
                .map(FacultySubjectPackageSessionMapping::getUserId)
                .filter(id -> id != null && !id.isEmpty())
                .distinct()
                .toList();
    }

    private DoubtDefaultAssigneeSourceEnum parseAssigneeSource(DoubtManagementSettingDataDto setting) {
        // No setting configured → preserve legacy behavior (batch-wide) so existing institutes
        // aren't surprised by a narrower auto-assign after deploy.
        if (setting == null || setting.getDefaultAssigneeSource() == null) {
            return DoubtDefaultAssigneeSourceEnum.BATCH_TEACHER;
        }
        try {
            return DoubtDefaultAssigneeSourceEnum.valueOf(setting.getDefaultAssigneeSource());
        } catch (IllegalArgumentException e) {
            log.warn("Unknown default_assignee_source value '{}', falling back to BATCH_TEACHER",
                    setting.getDefaultAssigneeSource());
            return DoubtDefaultAssigneeSourceEnum.BATCH_TEACHER;
        }
    }

    /**
     * Parses a per-type {@code assignee.source} string into the enum, tolerating unknown/blank
     * values (older/newer frontend) by falling back to BATCH_TEACHER rather than throwing.
     */
    private DoubtDefaultAssigneeSourceEnum parseSource(String raw) {
        if (!StringUtils.hasText(raw)) return DoubtDefaultAssigneeSourceEnum.BATCH_TEACHER;
        try {
            return DoubtDefaultAssigneeSourceEnum.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            log.warn("Unknown per-type assignee source '{}', falling back to BATCH_TEACHER", raw);
            return DoubtDefaultAssigneeSourceEnum.BATCH_TEACHER;
        }
    }

    /**
     * Institute for notification dispatch on an existing doubt. Prefers the stored institute_id
     * (always set for new doubts, and the ONLY source for GENERAL/guest doubts which have no
     * batch) and falls back to the batch lookup for legacy rows that predate the column.
     */
    private String resolveNotificationInstituteId(Doubts doubt) {
        if (doubt == null) return null;
        if (StringUtils.hasText(doubt.getInstituteId())) return doubt.getInstituteId();
        if (!StringUtils.hasText(doubt.getPackageSessionId())) return null;
        return facultyMappingRepository
                .findInstituteIdByPackageSessionId(doubt.getPackageSessionId())
                .orElse(null);
    }

    private DoubtManagementSettingDataDto loadDoubtManagementSettingByInstitute(String instituteId) {
        if (instituteId == null || instituteId.isEmpty()) return null;
        try {
            Object raw = instituteSettingService.getSettingByInstituteIdAndKey(
                    instituteId, SettingKeyEnums.DOUBT_MANAGEMENT_SETTING.name());
            if (raw == null) return null;
            return objectMapper.convertValue(raw, DoubtManagementSettingDataDto.class);
        } catch (Exception e) {
            log.warn("Failed to read DOUBT_MANAGEMENT_SETTING for institute {}: {}",
                    instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * For SLIDE-source doubts, the subject isn't on the doubt row — it lives on the slide's
     * metadata (subject → module → chapter → slide). Returns {@code null} for non-slide sources
     * or when metadata can't be resolved; callers treat null as "no subject narrowing possible."
     */
    private String resolveSubjectIdForDoubt(Doubts doubt) {
        if (!DoubtsSourceEnum.SLIDE.name().equals(doubt.getSource())) return null;
        if (doubt.getSourceId() == null || doubt.getSourceId().isEmpty()) return null;
        try {
            Optional<SlideMetadataProjection> projection =
                    slideMetaDataService.getSlideMetadataForAdmin(doubt.getSourceId());
            return projection.map(SlideMetadataProjection::getSubjectId).orElse(null);
        } catch (Exception e) {
            // The subject is only needed for SUBJECT_TEACHER routing. A transient/duplicate-mapping
            // failure in the slide-metadata lookup must not propagate and abort the whole assignee
            // resolution (which would leave the doubt with no recipient, hence no notification) —
            // degrade to "no subject narrowing" so the batch-teacher / admin cascade still runs.
            log.warn("Failed to resolve subject for doubt {} (slide {}): {}",
                    doubt.getId(), doubt.getSourceId(), e.getMessage());
            return null;
        }
    }

    /**
     * @param actorIsStaff whether the caller works doubts from the admin app. Learners (and guests)
     *                     keep exactly what they had before: flipping ACTIVE ⇄ RESOLVED on their own
     *                     doubt. Custom workflow statuses and remarks are staff-only — a learner
     *                     echoing the doubt back can't move it to "Escalated" or write into the trail.
     */
    private String updateDoubt(String doubtId, DoubtsDto request, String actorUserId, boolean actorIsStaff) {
        Doubts resolvedDoubtForNotification = null;
        Doubts assignedDoubtForNotification = null;
        List<String> newlyAssignedUserIds = List.of();
        // Audit rows are written AFTER the entity save succeeds so a failed update never leaves a
        // trail claiming it happened.
        List<DoubtActivity> pendingActivity = new ArrayList<>();
        try{
            Optional<Doubts> doubtsOpt = doubtService.getDoubtById(doubtId);
            if(doubtsOpt.isEmpty()) throw new VacademyException("Doubt Not Found");
            Doubts doubt = doubtsOpt.get();

            // Detect status transition to RESOLVED before we mutate the entity, so we only notify
            // on the actual flip (not every subsequent update while status already == RESOLVED).
            String previousStatus = doubt.getStatus();
            String previousWorkflow = DoubtStatusCatalog.effectiveKey(doubt);
            String actorType = actorUserId != null
                    ? DoubtActivityActorTypeEnum.USER.name() : DoubtActivityActorTypeEnum.SYSTEM.name();
            String remark = actorIsStaff && StringUtils.hasText(request.getRemark())
                    ? request.getRemark().trim() : null;

            // Snapshot the set of currently-active assignee user ids BEFORE createDoubtsAssignee
            // writes any new rows. The delta (request − snapshot) is who we'll notify as newly
            // assigned. Without this, we'd re-notify existing assignees every time any field on
            // the doubt changes.
            List<DoubtAssignee> existingAssignees = doubtsAssigneeRepository
                    .findByDoubtIdAndStatusNotIn(doubtId, List.of(DoubtAssigneeStatusEnum.DELETED.name()));
            Set<String> existingAssigneeUserIds = existingAssignees.stream()
                    .filter(a -> DoubtAssigneeSourceEnum.USER.name().equalsIgnoreCase(a.getSource()))
                    .filter(a -> DoubtAssigneeStatusEnum.ACTIVE.name().equalsIgnoreCase(a.getStatus()))
                    .map(DoubtAssignee::getSourceId)
                    .filter(id -> id != null && !id.isEmpty())
                    .collect(java.util.stream.Collectors.toSet());

            updateIfNotNull(request.getHtmlText(), doubt::setHtmlText);

            // Status. Two ways in, kept consistent with each other:
            //  1. workflow_status (configurable key) — the admin/teacher status picker and board.
            //     Validated against the institute catalog; its kind drives the coarse status.
            //  2. status (ACTIVE/RESOLVED/DELETED) — the legacy resolve toggle and the learner app.
            //     Flipping it snaps workflow_status to the matching built-in (RESOLVED / PENDING).
            // A request that echoes both unchanged is a no-op either way.
            String requestedWorkflow = StringUtils.hasText(request.getWorkflowStatus())
                    ? request.getWorkflowStatus().trim().toUpperCase() : null;
            boolean workflowMoveRequested = requestedWorkflow != null
                    && !requestedWorkflow.equalsIgnoreCase(previousWorkflow);
            boolean builtInKey = DoubtStatusCatalog.PENDING.equals(requestedWorkflow)
                    || DoubtStatusCatalog.RESOLVED.equals(requestedWorkflow);
            // Only an actual MOVE is gated — the learner app echoes the doubt back unchanged
            // (custom key included) when it flips resolved, and that must keep working.
            if (workflowMoveRequested && !actorIsStaff && !builtInKey) {
                throw new VacademyException("Only institute staff can set a custom doubt status");
            }
            if (workflowMoveRequested) {
                List<DoubtManagementSettingDataDto.WorkflowStatusConfig> catalog =
                        doubtService.getStatusCatalog(resolveNotificationInstituteId(doubt));
                DoubtManagementSettingDataDto.WorkflowStatusConfig target =
                        DoubtStatusCatalog.find(catalog, requestedWorkflow)
                                .filter(c -> !Boolean.FALSE.equals(c.getEnabled()))
                                .orElseThrow(() -> new VacademyException("Unknown doubt status: " + requestedWorkflow));
                doubt.setWorkflowStatus(target.getKey());
                doubt.setStatus(DoubtStatusCatalog.coarseStatusFor(target));
            } else if (request.getStatus() != null && !request.getStatus().equals(previousStatus)) {
                doubt.setStatus(request.getStatus());
                if (DoubtStatusEnum.RESOLVED.name().equals(request.getStatus())) {
                    doubt.setWorkflowStatus(DoubtStatusCatalog.RESOLVED);
                } else if (DoubtStatusEnum.ACTIVE.name().equals(request.getStatus())) {
                    doubt.setWorkflowStatus(DoubtStatusCatalog.PENDING);
                }
                // DELETED leaves the workflow key untouched — the row is hidden anyway.
            }
            boolean transitioningToResolved = DoubtStatusEnum.RESOLVED.name().equals(doubt.getStatus())
                    && !DoubtStatusEnum.RESOLVED.name().equals(previousStatus);
            if (transitioningToResolved) {
                doubt.setResolvedTime(new Date());
            }
            String newWorkflow = DoubtStatusCatalog.effectiveKey(doubt);
            boolean workflowChanged = !newWorkflow.equalsIgnoreCase(previousWorkflow);
            if (workflowChanged) {
                pendingActivity.add(DoubtActivity.builder()
                        .doubtId(doubtId)
                        .action(DoubtActivityActionEnum.STATUS_CHANGED.name())
                        .actorType(actorType)
                        .actorUserId(actorUserId)
                        .fromValue(previousWorkflow)
                        .toValue(newWorkflow)
                        .remark(remark)
                        .build());
            } else if (remark != null) {
                // A note left on the current status without moving it.
                pendingActivity.add(DoubtActivity.builder()
                        .doubtId(doubtId)
                        .action(DoubtActivityActionEnum.REMARK.name())
                        .actorType(actorType)
                        .actorUserId(actorUserId)
                        .toValue(newWorkflow)
                        .remark(remark)
                        .build());
            }

            if(request.getDoubtAssigneeRequestUserIds()!=null){
                createDoubtsAssignee(doubt, request.getDoubtAssigneeRequestUserIds());
                newlyAssignedUserIds = request.getDoubtAssigneeRequestUserIds().stream()
                        .filter(id -> id != null && !id.isEmpty())
                        .filter(id -> !existingAssigneeUserIds.contains(id))
                        .distinct()
                        .toList();
                for (String id : newlyAssignedUserIds) {
                    pendingActivity.add(DoubtActivity.builder()
                            .doubtId(doubtId)
                            .action(DoubtActivityActionEnum.ASSIGNED.name())
                            .actorType(actorType)
                            .actorUserId(actorUserId)
                            .targetUserId(id)
                            .build());
                }
            }
            doubtService.updateOrCreateDoubt(doubt);

            if(request.getDeleteAssigneeRequest()!=null){
                // Resolve row ids → user ids BEFORE the rows flip to DELETED, for the trail.
                existingAssignees.stream()
                        .filter(a -> request.getDeleteAssigneeRequest().contains(a.getId()))
                        .map(DoubtAssignee::getSourceId)
                        .filter(id -> id != null && !id.isEmpty())
                        .distinct()
                        .forEach(id -> pendingActivity.add(DoubtActivity.builder()
                                .doubtId(doubtId)
                                .action(DoubtActivityActionEnum.UNASSIGNED.name())
                                .actorType(actorType)
                                .actorUserId(actorUserId)
                                .targetUserId(id)
                                .build()));
                doubtService.deleteAssigneeForDoubt(request.getDeleteAssigneeRequest());
            }

            if(request.getExcludedAssigneeUserIds()!=null && !request.getExcludedAssigneeUserIds().isEmpty()){
                persistExcludedAssignees(doubt, request.getExcludedAssigneeUserIds());
                request.getExcludedAssigneeUserIds().stream()
                        .filter(id -> id != null && !id.isEmpty())
                        .distinct()
                        .forEach(id -> pendingActivity.add(DoubtActivity.builder()
                                .doubtId(doubtId)
                                .action(DoubtActivityActionEnum.UNASSIGNED.name())
                                .actorType(actorType)
                                .actorUserId(actorUserId)
                                .targetUserId(id)
                                .ruleSource("DEFAULT_EXCLUDED")
                                .build()));
            }

            if (transitioningToResolved) {
                resolvedDoubtForNotification = doubt;
            }
            if (!newlyAssignedUserIds.isEmpty() && doubt.getParentId() == null
                    && !DoubtStatusEnum.RESOLVED.name().equalsIgnoreCase(doubt.getStatus())) {
                assignedDoubtForNotification = doubt;
            }
        } catch (Exception e) {
            throw new VacademyException("Failed To Update Doubt: " +e.getMessage());
        }

        pendingActivity.forEach(doubtService::recordActivity);

        // Fire notifications outside the try/catch — notification-service errors must never surface
        // as a doubt-update failure. The service itself also swallows its own errors; this is
        // defence-in-depth.
        if (resolvedDoubtForNotification != null) {
            try {
                String instituteId = resolveNotificationInstituteId(resolvedDoubtForNotification);
                if (instituteId != null) {
                    doubtNotificationService.notifyDoubtResolved(resolvedDoubtForNotification, instituteId);
                }
            } catch (Exception e) {
                log.warn("Doubt resolved notification dispatch failed: {}", e.getMessage());
            }
        }
        if (assignedDoubtForNotification != null) {
            // Admin just added new assignee(s). Reuse the "doubt raised" event — from the teacher's
            // perspective this is the same "please look at this doubt" signal. The channel prefs
            // (push_enabled / email_enabled / email_template_id) under on_doubt_raised apply.
            try {
                String instituteId = resolveNotificationInstituteId(assignedDoubtForNotification);
                if (instituteId != null) {
                    doubtNotificationService.notifyDoubtRaised(
                            assignedDoubtForNotification, newlyAssignedUserIds, instituteId);
                }
            } catch (Exception e) {
                log.warn("Doubt newly-assigned notification dispatch failed: {}", e.getMessage());
            }
        }

        return doubtId;
    }

    private void createDoubtsAssignee(Doubts doubts, List<String> doubtAssigneeRequestUserIds) {
        List<DoubtAssignee> allNewAssignee = new ArrayList<>();

        doubtAssigneeRequestUserIds.forEach(userId->{
            allNewAssignee.add(DoubtAssignee.builder()
                    .doubts(doubts)
                    .source(DoubtAssigneeSourceEnum.USER.name())
                    .sourceId(userId)
                    .status(DoubtAssigneeStatusEnum.ACTIVE.name()).build());
        });

        doubtService.saveOrUpdateDoubtsAssignee(allNewAssignee);
    }

    /**
     * Persist an "exclusion" — the admin has removed a default (FSPSSM-implicit) teacher from this
     * doubt. We store a {@link DoubtAssignee} row with status {@code DELETED} so the exclusion
     * survives page reloads; the UI reads these back via {@code excluded_assignee_user_ids} and
     * filters them out of the default pill list.
     */
    private void persistExcludedAssignees(Doubts doubts, List<String> userIds) {
        List<DoubtAssignee> rows = new ArrayList<>();
        userIds.stream()
                .filter(id -> id != null && !id.isEmpty())
                .distinct()
                .forEach(userId -> rows.add(DoubtAssignee.builder()
                        .doubts(doubts)
                        .source(DoubtAssigneeSourceEnum.USER.name())
                        .sourceId(userId)
                        .status(DoubtAssigneeStatusEnum.DELETED.name())
                        .build()));
        if (!rows.isEmpty()) {
            doubtService.saveOrUpdateDoubtsAssignee(rows);
        }
    }

    private <T> void updateIfNotNull(T value, java.util.function.Consumer<T> setterMethod) {
        if (value != null) {
            setterMethod.accept(value);
        }
    }

    public ResponseEntity<AllDoubtsResponse> getAllDoubts(CustomUserDetails userDetails, DoubtsRequestFilter filter, int pageNo, int pageSize) {
        // Newest doubt first unless the caller asked for something else. An unsorted page leaves the
        // row order up to Postgres, which both puts stale doubts on top of the inbox and lets rows
        // repeat/disappear across pages.
        Sort sortColumns = ListService.createSortObject(filter.getSortColumns());
        if (sortColumns.isUnsorted()) {
            sortColumns = Sort.by(Sort.Direction.DESC, "raised_time");
        }
        Pageable pageable = PageRequest.of(pageNo,pageSize,sortColumns);

        String viewerUserId = resolveViewerUserId(userDetails);
        String instituteId = StringUtils.hasText(filter.getInstituteId()) ? filter.getInstituteId() : null;
        filter.setInstituteId(instituteId);

        // The unscoped (whole-institute) list is for staff of the institute asked for. Roles come
        // from the clientId-header institute, so an ADMIN role alone does not cover a body
        // institute_id of another institute, nor no institute at all; and a root flag (every learner
        // has one) with an empty role list is not staff. Those callers get the scoped view instead:
        // their own doubts, the ones assigned to them and their batches'.
        if (viewerUserId == null && (instituteId == null || !isInstituteStaff(userDetails, instituteId))) {
            viewerUserId = userDetails == null ? null : userDetails.getUserId();
            if (!StringUtils.hasText(viewerUserId)) {
                return ResponseEntity.ok(createDoubtAllResponse(Page.empty(pageable)));
            }
        }

        // For a scoped viewer (teacher / non-admin staff), their LIVE FSPSSM visibility mirrors the
        // institute's configured default_assignee_source so what a teacher can see matches what the
        // admin set: BATCH_TEACHER/BOTH (and the no-setting default) → they see their whole batch;
        // SUBJECT_TEACHER → only their subject's doubts; NONE/ROLE/SPECIFIC_USERS → assignment-only.
        // Admin/root callers (viewerUserId == null) are unscoped, so the flags are left off.
        boolean scopeBatch = false;
        boolean scopeSubject = false;
        if (viewerUserId != null) {
            DoubtDefaultAssigneeSourceEnum mode = parseAssigneeSource(
                    loadDoubtManagementSettingByInstitute(filter.getInstituteId()));
            scopeBatch = (mode == DoubtDefaultAssigneeSourceEnum.BATCH_TEACHER
                    || mode == DoubtDefaultAssigneeSourceEnum.BOTH);
            scopeSubject = (mode == DoubtDefaultAssigneeSourceEnum.SUBJECT_TEACHER);
        }

        Page<Doubts> paginatedDoubts = doubtService.getAllDoubtsWithFilter(filter.getContentTypes(), filter.getContentPositions(), filter.getSources(),
                filter.getSourceIds(), filter.getTypes(), filter.getStartDate(), filter.getEndDate(), filter.getUserIds(), filter.getStatus(),
                filter.getBatchIds(), filter.getInstituteId(), viewerUserId, scopeBatch, scopeSubject,
                filter.getAssigneeUserIds(), Boolean.TRUE.equals(filter.getUnassignedOnly()), filter.getWorkflowStatuses(),
                pageable);

        return ResponseEntity.ok(createDoubtAllResponse(paginatedDoubts));
    }

    /**
     * Loads one doubt by id and maps it to the same {@link DoubtsDto} the inbox list renders (via
     * {@link DoubtService#createDtoFromDoubts}, so child replies / slide metadata are populated too).
     * Backs the doubt-management deep link (?doubtId=X) — the inbox fetches the target doubt this way
     * when it isn't on the loaded page. Returns 404 when the id doesn't resolve to a doubt, 403 when
     * the caller is neither its author, staff of its institute, nor someone who works it (assignee /
     * batch faculty) — the same people {@code get-all} lists it for. Learners only ever list their
     * own doubts, so a learner reads only their own threads.
     */
    public ResponseEntity<DoubtsDto> getDoubtById(CustomUserDetails userDetails, String doubtId) {
        if (doubtId == null || doubtId.isBlank()) {
            return ResponseEntity.notFound().build();
        }
        Optional<Doubts> doubt = doubtService.getDoubtById(doubtId);
        if (doubt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        if (!canRead(userDetails, doubt.get())) {
            throw new ForbiddenException("You don't have access to this doubt");
        }
        List<DoubtsDto> dtos = doubtService.createDtoFromDoubts(List.of(doubt.get()));
        if (dtos.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(dtos.get(0));
    }

    /**
     * Returns {@code null} when the caller should see all doubts (admin / unrestricted), and the
     * user id when the caller's view should be scoped by doubt_assignee / FSPSSM / self-raised.
     *
     * Check order:
     *   1. Null caller → no filter (defensive).
     *   2. Explicit ADMIN role → no filter. This is the authoritative admin signal and is checked
     *      FIRST, before the teaching-role probe, because an admin-portal account may legitimately
     *      hold BOTH an ADMIN role and a TEACHER role (or faculty/FSPSSM batch assignments) — see
     *      {@code VALID_ROLES_FOR_ADMIN_PORTAL}. Without this ordering the TEACHER branch would
     *      scope a real admin down to only their assigned batches.
     *   3. Explicit TEACHER or STUDENT role → scope, ignoring {@code isRootUser}. Handles teacher
     *      accounts that were wrongly flagged root — the TEACHER role wins and they don't leak.
     *   4. {@code isRootUser} (no ADMIN/TEACHER role) → no filter.
     *   5. Has ACTIVE FSPSSM mapping → scope (custom role teachers like FACULTY/INSTRUCTOR).
     *   6. Otherwise → scope by user id.
     *
     * Tradeoff: an account flagged {@code isRootUser=true} with NO formal ADMIN/TEACHER role will
     * pass through step 4 and see everything. That's a data-provisioning concern, not a code bug —
     * fix on the account by adding the right role. Giving real admins back their full doubt
     * visibility is the higher priority.
     */
    private String resolveViewerUserId(CustomUserDetails user) {
        if (user == null) {
            return null;
        }
        if (hasRole(user, "ADMIN")) {
            return null;
        }
        if (hasRole(user, "TEACHER") || hasRole(user, "STUDENT")) {
            return user.getUserId();
        }
        if (user.isRootUser()) {
            return null;
        }
        if (hasAnyFacultyMapping(user.getUserId())) {
            return user.getUserId();
        }
        return user.getUserId();
    }

    private boolean hasAnyFacultyMapping(String userId) {
        if (userId == null || userId.isEmpty()) return false;
        try {
            return !facultyMappingRepository.findByUserId(userId).isEmpty();
        } catch (Exception e) {
            log.warn("FSPSSM lookup failed for viewer scope detection, userId={}: {}", userId, e.getMessage());
            return false;
        }
    }

    private boolean hasRole(CustomUserDetails user, String... roles) {
        return user.getAuthorities().stream()
                .map(auth -> auth.getAuthority())
                .anyMatch(authority -> {
                    for (String role : roles) {
                        if (role.equalsIgnoreCase(authority)) return true;
                    }
                    return false;
                });
    }

    private AllDoubtsResponse createDoubtAllResponse(Page<Doubts> paginatedDoubts) {
        if(paginatedDoubts == null){
            return AllDoubtsResponse.builder()
                    .content(new ArrayList<>())
                    .last(true)
                    .pageNo(0)
                    .pageSize(0)
                    .totalElements(0)
                    .totalPages(0)
                    .build();
        }

        List<Doubts> allDoubts = paginatedDoubts.getContent();
        return AllDoubtsResponse.builder()
                .content(doubtService.createDtoFromDoubts(allDoubts))
                .totalPages(paginatedDoubts.getTotalPages())
                .last(paginatedDoubts.isLast())
                .pageNo(paginatedDoubts.getNumber())
                .pageSize(paginatedDoubts.getSize())
                .totalElements(paginatedDoubts.getTotalElements()).build();
    }



}
