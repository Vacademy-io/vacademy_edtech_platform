package vacademy.io.admin_core_service.features.institute_learner.manager;

import com.fasterxml.jackson.core.type.TypeReference;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.hibernate.Session;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.institute_learner.constants.StudentConstants;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentBasicDetailsDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentV2DTO;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldValueMap;
import vacademy.io.admin_core_service.features.institute_learner.dto.projection.StudentListV2Projection;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.AllStudentResponse;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.AllStudentV2Response;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.StudentListFilter;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.institute_learner.service.StudentFilterService;
import vacademy.io.admin_core_service.features.live_session.service.AttendanceReportService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.common.auth.dto.UserCredentials;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.core.standard_classes.ListService;
import vacademy.io.common.core.utils.DataToCsvConverter;
import vacademy.io.common.exceptions.VacademyException;

import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import jakarta.servlet.http.HttpServletRequest;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.sql.Statement;
import java.util.*;
import java.util.function.BinaryOperator;
import java.util.stream.Collectors;

import com.fasterxml.jackson.core.JsonProcessingException;

@Component
public class StudentListManager {

    @Autowired
    private vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository enrollInviteRepository;

    @Autowired
    InternalClientUtils internalClientUtils;

    @Autowired
    InstituteStudentRepository instituteStudentRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver customFieldListFilterResolver;

    @Autowired
    vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver utmListFilterResolver;

    @Autowired
    StudentSessionRepository studentSessionRepository;

    @Autowired
    StudentFilterService studentFilterService;

    @Autowired
    AttendanceReportService attendanceReportService;

    @Autowired
    FacultySubjectPackageSessionMappingRepository facultyMappingRepository;

    @Autowired
    PackageSessionLearnerInvitationToPaymentOptionRepository pslipoRepository;

    @Autowired
    JwtService jwtService;


    @Value("${auth.server.baseurl}")
    private String authServerBaseUrl;
    @Value("${spring.application.name}")
    private String applicationName;

    /**
     * Applies faculty access filtering to the student list filter.
     * If the user has HAS_FACULTY_ASSIGNED permission:
     * - Restricts packageSessionIds to only accessible package sessions
     * - For PS with ENROLL_INVITE access: only shows learners enrolled via those invites
     * - For PS without invite access: shows all learners
     */
    private void applyFacultyAccessFilter(CustomUserDetails user, StudentListFilter filter) {
        // Handle user-selected invite filter (works for ALL users, not just faculty)
        applyUserInviteFilter(filter);

        if (user == null) return;

        String instituteId = (filter.getInstituteIds() != null && !filter.getInstituteIds().isEmpty())
                ? filter.getInstituteIds().get(0) : null;

        // Skip faculty filtering for ADMIN/TEACHER — they should see all students.
        // Sub-org admins (no ADMIN/TEACHER role, but have FSPSSM) → filtering applies.
        if (hasRole(user, instituteId, "ADMIN", "TEACHER") || !hasFacultyAssignedPermission(user)) {
            return;
        }

        if (instituteId == null) {
            return;
        }

        List<String> activeStatuses = List.of("ACTIVE");

        List<String> accessiblePsIds = facultyMappingRepository
                .findAccessIdsByUserIdAndInstituteId(user.getUserId(), instituteId, activeStatuses);

        if (accessiblePsIds.isEmpty()) {
            filter.setPackageSessionIds(List.of("__NONE__"));
            return;
        }

        // Intersect with user's requested packageSessionIds filter
        List<String> requestedPsIds = filter.getPackageSessionIds();
        List<String> effectivePsIds;
        if (requestedPsIds != null && !requestedPsIds.isEmpty()) {
            List<String> cleanRequestedPsIds = requestedPsIds.stream()
                    .filter(id -> id != null && !id.isEmpty())
                    .collect(Collectors.toList());
            if (cleanRequestedPsIds.isEmpty()) {
                effectivePsIds = new ArrayList<>(accessiblePsIds);
            } else {
                Set<String> accessibleSet = new HashSet<>(accessiblePsIds);
                effectivePsIds = cleanRequestedPsIds.stream()
                        .filter(accessibleSet::contains)
                        .collect(Collectors.toList());
                if (effectivePsIds.isEmpty()) {
                    filter.setPackageSessionIds(List.of("__NONE__"));
                    return;
                }
            }
        } else {
            effectivePsIds = new ArrayList<>(accessiblePsIds);
        }
        filter.setPackageSessionIds(effectivePsIds);

        // Get ENROLL_INVITE access_ids directly from FSPSSM
        List<String> accessibleInviteIds = facultyMappingRepository
                .findEnrollInviteAccessIdsByUserIdAndInstituteId(user.getUserId(), instituteId, activeStatuses);

        if (!accessibleInviteIds.isEmpty()) {
            // If user explicitly selected invites from the filter, intersect with accessible set
            List<String> userSelectedInvites = filter.getEnrollInviteIds();
            List<String> effectiveInviteIds;
            if (userSelectedInvites != null && !userSelectedInvites.isEmpty()) {
                Set<String> accessibleSet = new HashSet<>(accessibleInviteIds);
                effectiveInviteIds = userSelectedInvites.stream()
                        .filter(accessibleSet::contains)
                        .collect(Collectors.toList());
            } else {
                effectiveInviteIds = accessibleInviteIds;
            }

            List<String> invitePsIds = pslipoRepository.findPackageSessionIdsByEnrollInviteIds(effectiveInviteIds);
            Set<String> effectiveSet = new HashSet<>(effectivePsIds);
            List<String> enrollInvitePsIds = invitePsIds.stream()
                    .filter(effectiveSet::contains)
                    .collect(Collectors.toList());

            if (!enrollInvitePsIds.isEmpty()) {
                filter.setServerEnrollInviteIds(effectiveInviteIds);
                filter.setEnrollInvitePackageSessionIds(enrollInvitePsIds);
            }
        }
    }

    /**
     * Handles user-selected enroll_invite_ids filter (works for all users).
     * If no faculty FSPSSM filtering will happen, this sets serverEnrollInviteIds directly.
     */
    private void applyUserInviteFilter(StudentListFilter filter) {
        List<String> userInviteIds = filter.getEnrollInviteIds();
        if (userInviteIds == null || userInviteIds.isEmpty()) {
            return;
        }
        // Pre-set serverEnrollInviteIds from user selection.
        // If applyFacultyAccessFilter runs later, it will intersect/override.
        List<String> invitePsIds = pslipoRepository.findPackageSessionIdsByEnrollInviteIds(userInviteIds);
        if (!invitePsIds.isEmpty()) {
            filter.setServerEnrollInviteIds(userInviteIds);
            filter.setEnrollInvitePackageSessionIds(invitePsIds);
        }
    }

    private boolean hasRole(CustomUserDetails user, String instituteId, String... roles) {
        // Fast path: check storedAuthorities from auth-service
        boolean fromAuthorities = user.getAuthorities().stream()
                .map(auth -> auth.getAuthority())
                .anyMatch(authority -> {
                    for (String role : roles) {
                        if (role.equalsIgnoreCase(authority)) return true;
                    }
                    return false;
                });
        if (fromAuthorities) return true;

        // JWT fallback: read roles directly from the token (no DB call needed)
        // storedAuthorities can be empty when clientId header mismatches UserRole.instituteId in auth-service
        if (instituteId == null) return false;
        try {
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs == null) return false;
            HttpServletRequest request = attrs.getRequest();
            String authHeader = request.getHeader("Authorization");
            if (authHeader == null || !authHeader.startsWith("Bearer ")) return false;
            String jwt = authHeader.substring(7);

            @SuppressWarnings("unchecked")
            Map<String, Object> authorities = jwtService.extractClaim(jwt,
                    claims -> (Map<String, Object>) claims.get("authorities"));
            if (authorities == null) return false;

            @SuppressWarnings("unchecked")
            Map<String, Object> instituteAuth = (Map<String, Object>) authorities.get(instituteId);
            if (instituteAuth == null) return false;

            @SuppressWarnings("unchecked")
            List<String> jwtRoles = (List<String>) instituteAuth.get("roles");
            if (jwtRoles == null) return false;

            for (String role : roles) {
                if (jwtRoles.stream().anyMatch(r -> role.equalsIgnoreCase(r))) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private boolean hasFacultyAssignedPermission(CustomUserDetails user) {
        // Check Spring Security authorities
        boolean fromAuthorities = user.getAuthorities().stream()
                .map(auth -> auth.getAuthority())
                .anyMatch(authority -> "HAS_FACULTY_ASSIGNED".equalsIgnoreCase(authority));
        if (fromAuthorities) return true;

        // Fallback: check if user has any active FSPSSM entries (direct DB check)
        List<FacultySubjectPackageSessionMapping> mappings = facultyMappingRepository.findByUserId(user.getUserId());
        return mappings.stream().anyMatch(m -> "ACTIVE".equals(m.getStatus()));
    }

    public ResponseEntity<AllStudentResponse> getLinkedStudents(CustomUserDetails user,
            StudentListFilter studentListFilter, int pageNo, int pageSize) {
        // Apply faculty access filter (restricts PS and injects invite filter)
        applyFacultyAccessFilter(user, studentListFilter);

        // Strip custom-field sort keys ("cf:<id>") — this V1 path (also used by
        // the CSV exports) has no custom-field sort support, and letting the
        // key through createSortObject would produce an invalid ORDER BY
        // property and 500 the request.
        if (studentListFilter.getSortColumns() != null) {
            studentListFilter.getSortColumns().keySet().removeIf(k -> k != null && k.startsWith("cf:"));
        }

        // Create a sorting object based on the provided sort columns
        Sort thisSort = ListService.createSortObject(studentListFilter.getSortColumns());

        // Create a pageable instance for pagination
        Pageable pageable = PageRequest.of(pageNo, pageSize, thisSort);

        // Retrieve employees based on the filter criteria
        Page<StudentDTO> studentPage = null;

        // Check if the filter contains a numeric name
        if (StringUtils.hasText(studentListFilter.getName())) {
            studentPage = studentFilterService.getAllStudentWithSearch(studentListFilter.getName(),studentListFilter.getStatuses(),
                    studentListFilter.getGender(), studentListFilter.getInstituteIds(), studentListFilter.getGroupIds(),
                    studentListFilter.getPackageSessionIds(),studentListFilter.getSubOrgIds(),studentListFilter.getCustomFields(), pageable);
        }

        if (Objects.isNull(studentPage) && !studentListFilter.getInstituteIds().isEmpty()) {
            studentPage = studentFilterService.getAllStudentWithFilterAndCustomFields(studentListFilter.getStatuses(),
                    studentListFilter.getGender(), studentListFilter.getInstituteIds(), studentListFilter.getGroupIds(),
                    studentListFilter.getPackageSessionIds(),studentListFilter.getSubOrgIds(),studentListFilter.getCustomFields(), pageable);
        }

        return ResponseEntity.ok(createAllStudentResponseFromPaginatedData(studentPage));

    }

    /**
     * Enriches students with attendance percentage data
     * @param students List of students to enrich with attendance data
     */
    private void enrichStudentsWithAttendancePercentage(List<StudentDTO> students) {
        if (students == null || students.isEmpty()) {
            return;
        }

        // Calculate attendance percentage for each student
        for (StudentDTO student : students) {
            try {
                // Get the package session ID for the student
                String packageSessionId = student.getPackageSessionId();
                String userId = student.getUserId();
                
                if (packageSessionId != null && userId != null) {
                    // Calculate attendance for the last 30 days as a reasonable default period
                    LocalDate endDate = LocalDate.now();
                    LocalDate startDate = endDate.minusDays(30);
                    
                    // Get attendance report for the student
                    var attendanceReport = attendanceReportService.getStudentReport(userId, packageSessionId, startDate, endDate);
                    student.setAttendancePercent(attendanceReport.getAttendancePercentage());
                } else {
                    // Set to 0.0 if no package session or user ID
                    student.setAttendancePercent(0.0);
                }
            } catch (Exception e) {
                // Log error and set attendance to 0.0 in case of any issues
                // You might want to add proper logging here
                student.setAttendancePercent(0.0);
            }
        }
    }

    private AllStudentResponse createAllStudentResponseFromPaginatedData(Page<StudentDTO> studentPage) {
        List<StudentDTO> content = new ArrayList<>();
        if (!Objects.isNull(studentPage)) {
            content = studentPage.getContent();
            // Calculate attendance percentage for each student
            enrichStudentsWithAttendancePercentage(content);
            return AllStudentResponse.builder().content(content).pageNo(studentPage.getNumber())
                    .last(studentPage.isLast()).pageSize(studentPage.getSize()).totalPages(studentPage.getTotalPages())
                    .totalElements(studentPage.getTotalElements()).build();
        }
        return AllStudentResponse.builder().totalPages(0).content(content).pageNo(0).totalPages(0).build();
    }

    public ResponseEntity<AllStudentV2Response> getLinkedStudentsV2(CustomUserDetails user,
                                                                    StudentListFilter studentListFilter, int pageNo, int pageSize) {
        applyFacultyAccessFilter(user, studentListFilter);

        // Custom-field sort arrives as a sortColumns entry keyed
        // "cf:<custom_field_id>". Extract it (so createPageable/ListService only
        // sees real columns) and stash it on the filter — the heavy custom-repo
        // path orders by the field's latest USER-scoped answer.
        if (studentListFilter.getSortColumns() != null) {
            for (Map.Entry<String, String> entry : new HashMap<>(studentListFilter.getSortColumns()).entrySet()) {
                if (entry.getKey() != null && entry.getKey().startsWith("cf:")) {
                    studentListFilter.setSortCustomFieldId(entry.getKey().substring(3));
                    studentListFilter.setSortCustomFieldDirection(entry.getValue());
                    studentListFilter.getSortColumns().remove(entry.getKey());
                }
            }
        }
        boolean hasCustomFieldSort = StringUtils.hasText(studentListFilter.getSortCustomFieldId());

        // Pre-resolve typed (operator-aware) custom-field filters into user-id
        // sets. Positive operators intersect into a matched set (empty → no
        // results at all); IS_EMPTY entries become an exclusion set. The sets
        // ride the filter object into the dynamic-SQL repository as IN/NOT IN.
        if (studentListFilter.getCustomFieldTypedFilters() != null
                && !studentListFilter.getCustomFieldTypedFilters().isEmpty()) {
            vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution
                    typedResolution = customFieldListFilterResolver.resolve(
                            studentListFilter.getCustomFieldTypedFilters(),
                            vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface.USER);
            if (typedResolution.shortCircuitsToEmpty()) {
                return ResponseEntity.ok(AllStudentV2Response.builder()
                        .content(new ArrayList<>()).pageNo(pageNo).pageSize(pageSize)
                        .totalElements(0L).totalPages(0).last(true)
                        .membershipTypesAvailable(membershipTypesAvailable(studentListFilter.getInstituteIds()))
                        .build());
            }
            studentListFilter.setCfTypedMatchedUserIds(
                    typedResolution.matchedIds == null ? null : new ArrayList<>(typedResolution.matchedIds));
            studentListFilter.setCfTypedExcludedUserIds(
                    typedResolution.excludedIds == null ? null : new ArrayList<>(typedResolution.excludedIds));
        }
        // Campaign (UTM) filter: resolve touches → user ids and fold them into
        // the same matched / excluded user-id sets the typed custom-field
        // filters use, so it rides the existing custom-repo path unchanged.
        if (vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver
                .hasFilter(studentListFilter.getUtmFilters())) {
            String utmInstituteId = (studentListFilter.getInstituteIds() != null
                    && !studentListFilter.getInstituteIds().isEmpty())
                    ? studentListFilter.getInstituteIds().get(0) : null;
            vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution
                    existing = new vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution(
                            studentListFilter.getCfTypedMatchedUserIds() == null ? null
                                    : new java.util.HashSet<>(studentListFilter.getCfTypedMatchedUserIds()),
                            studentListFilter.getCfTypedExcludedUserIds() == null ? null
                                    : new java.util.HashSet<>(studentListFilter.getCfTypedExcludedUserIds()));
            vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution
                    combined = existing.and(utmListFilterResolver.resolve(
                            studentListFilter.getUtmFilters(),
                            vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface.USER,
                            utmInstituteId));
            if (combined.shortCircuitsToEmpty()) {
                return ResponseEntity.ok(AllStudentV2Response.builder()
                        .content(new ArrayList<>()).pageNo(pageNo).pageSize(pageSize)
                        .totalElements(0L).totalPages(0).last(true)
                        .membershipTypesAvailable(membershipTypesAvailable(studentListFilter.getInstituteIds()))
                        .build());
            }
            studentListFilter.setCfTypedMatchedUserIds(
                    combined.matchedIds == null ? null : new ArrayList<>(combined.matchedIds));
            studentListFilter.setCfTypedExcludedUserIds(
                    combined.excludedIds == null ? null : new ArrayList<>(combined.excludedIds));
        }
        boolean hasTypedCustomFieldFilters =
                (studentListFilter.getCfTypedMatchedUserIds() != null && !studentListFilter.getCfTypedMatchedUserIds().isEmpty())
                        || (studentListFilter.getCfTypedExcludedUserIds() != null && !studentListFilter.getCfTypedExcludedUserIds().isEmpty());

        boolean hasCustomFieldFilters = (studentListFilter.getCustomFieldFilters() != null && !studentListFilter.getCustomFieldFilters().isEmpty())
                || hasTypedCustomFieldFilters;
        boolean hasEnrollInviteFilter = studentListFilter.getServerEnrollInviteIds() != null && !studentListFilter.getServerEnrollInviteIds().isEmpty();
        boolean hasNameSearch = StringUtils.hasText(studentListFilter.getName());
        boolean hasPaymentStatusFilter = studentListFilter.getPaymentStatuses() != null && !studentListFilter.getPaymentStatuses().isEmpty();
        // Sub-org is a plain ssigm column, so the default two-phase paginator filters it directly
        // (sub_org_id clause added to findPagedCombinedUserIdsForLearnerList). hasSubOrgFilter only
        // (a) excludes audience-only rows below, and (b) — in fetchStudentPage — forces the
        // custom-repo variant when sub-org is combined with a payment/custom/invite filter (the raw
        // @Query variants have no sub_org_id clause).
        boolean hasSubOrgFilter = studentListFilter.getSubOrgIds() != null && !studentListFilter.getSubOrgIds().isEmpty();

        // Complex filters (custom fields, payment status, invite filter) and
        // custom-field sorting require the full JOIN query
        if (hasCustomFieldFilters || hasEnrollInviteFilter || hasPaymentStatusFilter || hasCustomFieldSort) {
            Pageable pageable = createPageable(studentListFilter, pageNo, pageSize);
            Page<StudentListV2Projection> page = fetchStudentPage(studentListFilter, pageable);
            List<StudentV2DTO> content = page != null ? mapProjectionsToDTOs(page.getContent()) : new ArrayList<>();
            if (!content.isEmpty()) enrichWithUserCredentials(content);
            return ResponseEntity.ok(buildResponse(content, page, pageSize, false));
        }

        // The learner-list is a superset: institute-enrolled users + audience-only respondents.
        // Audience-only rows are dropped the moment any enrollment-scoped filter is active
        // (status, batch, group, source/type/typeId, destPSID, levelId, subOrgUserType, subOrgId,
        // date range); gender / audience / name search are user-scoped and do not gate them out.
        boolean includeAudienceOnly = CollectionUtils.isEmpty(studentListFilter.getStatuses())
                && CollectionUtils.isEmpty(studentListFilter.getPackageSessionIds())
                && CollectionUtils.isEmpty(studentListFilter.getGroupIds())
                && CollectionUtils.isEmpty(studentListFilter.getSources())
                && CollectionUtils.isEmpty(studentListFilter.getTypes())
                && CollectionUtils.isEmpty(studentListFilter.getTypeIds())
                && CollectionUtils.isEmpty(studentListFilter.getDestinationPackageSessionIds())
                && CollectionUtils.isEmpty(studentListFilter.getLevelIds())
                && CollectionUtils.isEmpty(studentListFilter.getSubOrgUserTypes())
                && !hasSubOrgFilter
                && CollectionUtils.isEmpty(studentListFilter.getMembershipTypes())
                && studentListFilter.getStartDate() == null
                && studentListFilter.getEndDate() == null;

        // Two-phase approach: 1) get IDs (combined UNION when audience-only included), 2) enrich page IDs.
        // The id page and its count run in one read-write transaction (stays on the primary; a
        // read-only one would route to the replica) with per-call planning. Through pgbouncer these
        // are named prepared statements, and the generic plan Postgres switches to after five
        // executions does not fold the optional-filter guards: 2-5x slower here. SET LOCAL ends with
        // the transaction, so nothing leaks to other clients on the pooled connection.
        Page<String> idPage = new TransactionTemplate(transactionManager).execute(status -> {
            entityManager.unwrap(Session.class).doWork(connection -> {
                try (Statement statement = connection.createStatement()) {
                    statement.execute("SET LOCAL plan_cache_mode = force_custom_plan");
                }
            });
            return hasNameSearch
                    ? instituteStudentRepository.findPagedCombinedUserIdsForLearnerList(
                studentListFilter.getStatuses(),
                studentListFilter.getGender(),
                studentListFilter.getInstituteIds(),
                studentListFilter.getGroupIds(),
                studentListFilter.getPackageSessionIds(),
                studentListFilter.getSources(),
                studentListFilter.getTypes(),
                studentListFilter.getTypeIds(),
                studentListFilter.getDestinationPackageSessionIds(),
                studentListFilter.getLevelIds(),
                studentListFilter.getSubOrgIds(),
                studentListFilter.getSubOrgUserTypes(),
                studentListFilter.getMembershipTypes(),
                studentListFilter.getStartDate(),
                studentListFilter.getEndDate(),
                studentListFilter.getAudienceIds(),
                studentListFilter.getName(),
                includeAudienceOnly,
                PageRequest.of(pageNo, pageSize))
                    : instituteStudentRepository.findPagedCombinedUserIdsForLearnerListNoName(
                studentListFilter.getStatuses(),
                studentListFilter.getGender(),
                studentListFilter.getInstituteIds(),
                studentListFilter.getGroupIds(),
                studentListFilter.getPackageSessionIds(),
                studentListFilter.getSources(),
                studentListFilter.getTypes(),
                studentListFilter.getTypeIds(),
                studentListFilter.getDestinationPackageSessionIds(),
                studentListFilter.getLevelIds(),
                studentListFilter.getSubOrgIds(),
                studentListFilter.getSubOrgUserTypes(),
                studentListFilter.getMembershipTypes(),
                studentListFilter.getStartDate(),
                studentListFilter.getEndDate(),
                studentListFilter.getAudienceIds(),
                null,
                includeAudienceOnly,
                PageRequest.of(pageNo, pageSize));
        });

        List<String> pagedUserIds = idPage.getContent();
        if (pagedUserIds.isEmpty()) {
            return ResponseEntity.ok(AllStudentV2Response.builder()
                    .content(new ArrayList<>()).pageNo(pageNo).pageSize(pageSize)
                    .totalElements(0L).totalPages(0).last(true)
                    .membershipTypesAvailable(membershipTypesAvailable(studentListFilter.getInstituteIds()))
                    .build());
        }

        // Slim enrichment: skip user_plan/payment_log/enroll_invite joins and the
        // auth-service credential call. Side-view tabs hydrate plan/payment/credentials
        // on demand. Heavy path above already handles paymentStatus/enrollInvite/customField filters.
        List<StudentListV2Projection> projections = instituteStudentRepository.getStudentSlimDataForUserIds(
                pagedUserIds,
                studentListFilter.getInstituteIds(),
                List.of(StatusEnum.ACTIVE.name()));

        // When the caller filtered by package_session_ids, the surfaced row's batch
        // column must reflect the filtered batch — not the user's most recent
        // enrollment in some other batch. The slim query intentionally joins ALL of
        // a user's ssigm rows (so allPackageSessionIds below can fan out for side-view
        // tabs), so we pick the matching row here at the collapse step.
        Set<String> filterPsIds = studentListFilter.getPackageSessionIds() == null
                ? Collections.emptySet()
                : new HashSet<>(studentListFilter.getPackageSessionIds());
        BinaryOperator<StudentListV2Projection> pickWinner = filterPsIds.isEmpty()
                ? (existing, incoming) -> existing
                : (existing, incoming) -> {
                    if (existing.getPackageSessionId() != null && filterPsIds.contains(existing.getPackageSessionId())) {
                        return existing;
                    }
                    if (incoming.getPackageSessionId() != null && filterPsIds.contains(incoming.getPackageSessionId())) {
                        return incoming;
                    }
                    return existing;
                };
        Map<String, StudentListV2Projection> projMap = projections.stream()
                .filter(p -> p.getUserId() != null)
                .collect(Collectors.toMap(StudentListV2Projection::getUserId, p -> p, pickWinner, LinkedHashMap::new));

        // Aggregate every enrollment's package_session_id per user BEFORE collapsing,
        // so side-view tabs that fetch batch-scoped data can iterate every ps_id, not
        // just the latest one. Latest-first because the slim query ORDERs by enrolled_date DESC.
        Map<String, List<String>> allPsIdsByUser = new LinkedHashMap<>();
        for (StudentListV2Projection p : projections) {
            if (p.getUserId() == null) continue;
            String psId = p.getPackageSessionId();
            if (psId != null) {
                allPsIdsByUser
                        .computeIfAbsent(p.getUserId(), k -> new ArrayList<>())
                        .add(psId);
            }
        }

        List<StudentListV2Projection> ordered = pagedUserIds.stream()
                .map(projMap::get)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());

        List<StudentV2DTO> content = mapProjectionsToDTOs(ordered);
        // Attach the per-user enrollment fan-out, dedup preserving order.
        for (StudentV2DTO dto : content) {
            List<String> psIds = allPsIdsByUser.getOrDefault(dto.getUserId(), new ArrayList<>());
            dto.setAllPackageSessionIds(psIds.stream().distinct().collect(Collectors.toList()));
        }
        // No enrichWithUserCredentials on the slim path — password isn't shown in the list.

        long totalElements = idPage.getTotalElements();
        int totalPages = (int) Math.ceil((double) totalElements / pageSize);
        return ResponseEntity.ok(AllStudentV2Response.builder()
                .content(content)
                .pageNo(pageNo)
                .pageSize(pageSize)
                .totalElements(totalElements)
                .totalPages(totalPages)
                .last(pageNo >= totalPages - 1)
                .membershipTypesAvailable(membershipTypesAvailable(studentListFilter.getInstituteIds()))
                .build());
    }

    private Pageable createPageable(StudentListFilter filter, int pageNo, int pageSize) {
        Sort sort = ListService.createSortObject(filter.getSortColumns());
        return PageRequest.of(pageNo, pageSize, sort);
    }

    private Page<StudentListV2Projection> fetchStudentPage(StudentListFilter filter, Pageable pageable) {
        boolean hasCustomFieldFilters = (filter.getCustomFieldFilters() != null && !filter.getCustomFieldFilters().isEmpty())
                || (filter.getCfTypedMatchedUserIds() != null && !filter.getCfTypedMatchedUserIds().isEmpty())
                || (filter.getCfTypedExcludedUserIds() != null && !filter.getCfTypedExcludedUserIds().isEmpty());
        boolean hasEnrollInviteFilter = filter.getServerEnrollInviteIds() != null && !filter.getServerEnrollInviteIds().isEmpty();
        boolean hasSubOrgFilter = filter.getSubOrgIds() != null && !filter.getSubOrgIds().isEmpty();
        boolean hasCustomFieldSort = StringUtils.hasText(filter.getSortCustomFieldId());
        // Use custom repo methods when custom field filters/sort, enroll invite, or sub-org filters are present
        // (the raw @Query variants have no ssigm.sub_org_id clause; the custom impl applies it via addListFilter)
        boolean useCustomRepo = hasCustomFieldFilters || hasEnrollInviteFilter || hasSubOrgFilter || hasCustomFieldSort;

        if (StringUtils.hasText(filter.getName())) {
            if (useCustomRepo) {
                return instituteStudentRepository.getAllStudentV2WithSearchAndCustomFieldFilters(
                        filter.getName(),
                        filter.getInstituteIds(),
                        filter.getStatuses(),
                        filter.getPaymentStatuses(),
                        List.of(StatusEnum.ACTIVE.name()),
                        filter.getSources(),
                        filter.getTypes(),
                        filter.getTypeIds(),
                        filter.getDestinationPackageSessionIds(),
                        filter.getLevelIds(),
                        filter.getSubOrgUserTypes(),
                        filter.getSubOrgIds(),
                        filter.getCustomFieldFilters(),
                        filter.getStartDate(),
                        filter.getEndDate(),
                        filter.getServerEnrollInviteIds(),
                        filter.getEnrollInvitePackageSessionIds(),
                        filter.getCfTypedMatchedUserIds(),
                        filter.getCfTypedExcludedUserIds(),
                        filter.getSortCustomFieldId(),
                        filter.getSortCustomFieldDirection(),
                        pageable);
            } else {
                return instituteStudentRepository.getAllStudentV2WithSearchRaw(
                        filter.getName(),
                        filter.getInstituteIds(),
                        filter.getStatuses(),
                        filter.getPaymentStatuses(),
                        List.of(StatusEnum.ACTIVE.name()),
                        filter.getSources(),
                        filter.getTypes(),
                        filter.getTypeIds(),
                        filter.getDestinationPackageSessionIds(),
                        filter.getLevelIds(),
                        filter.getSubOrgUserTypes(),
                        filter.getStartDate(),
                        filter.getEndDate(),
                        pageable);
            }
        }

        if (!filter.getInstituteIds().isEmpty()) {
            if (useCustomRepo) {
                return instituteStudentRepository.getAllStudentV2WithFilterAndCustomFieldFilters(
                        filter.getStatuses(),
                        filter.getGender(),
                        filter.getInstituteIds(),
                        filter.getGroupIds(),
                        filter.getPackageSessionIds(),
                        filter.getPaymentStatuses(),
                        List.of(StatusEnum.ACTIVE.name()),
                        filter.getSources(),
                        filter.getTypes(),
                        filter.getTypeIds(),
                        filter.getDestinationPackageSessionIds(),
                        filter.getLevelIds(),
                        filter.getSubOrgUserTypes(),
                        filter.getSubOrgIds(),
                        filter.getCustomFieldFilters(),
                        filter.getStartDate(),
                        filter.getEndDate(),
                        filter.getServerEnrollInviteIds(),
                        filter.getEnrollInvitePackageSessionIds(),
                        filter.getCfTypedMatchedUserIds(),
                        filter.getCfTypedExcludedUserIds(),
                        filter.getSortCustomFieldId(),
                        filter.getSortCustomFieldDirection(),
                        pageable);
            } else {
                // Use existing @Query method
                return instituteStudentRepository.getAllStudentV2WithFilterRaw(
                        filter.getStatuses(),
                        filter.getGender(),
                        filter.getInstituteIds(),
                        filter.getGroupIds(),
                        filter.getPackageSessionIds(),
                        filter.getPaymentStatuses(),
                        List.of(StatusEnum.ACTIVE.name()),
                        filter.getSources(),
                        filter.getTypes(),
                        filter.getTypeIds(),
                        filter.getDestinationPackageSessionIds(),
                        filter.getLevelIds(),
                        filter.getSubOrgUserTypes(),
                        filter.getStartDate(),
                        filter.getEndDate(),
                        pageable);
            }
        }

        return null;
    }

    /**
     * TRIAL / PAID / null from user_plan.is_trial. Null means the learner has no plan at
     * all, which is not the same as paying -- the badge stays off rather than guessing.
     */
    /**
     * True when the institute has a live invite configuring a trial. Parsed in Java after a
     * LIKE prefilter; an unreadable settings blob is skipped rather than allowed to decide
     * that an institute runs no trials, or to fail the list.
     */
    private boolean membershipTypesAvailable(List<String> instituteIds) {
        if (CollectionUtils.isEmpty(instituteIds)) {
            return false;
        }
        for (String instituteId : instituteIds) {
            try {
                for (String settingJson : enrollInviteRepository.findTrialBearingSettingJson(instituteId)) {
                    if (settingJson == null || settingJson.isBlank()) continue;
                    try {
                        if (new com.fasterxml.jackson.databind.ObjectMapper().readTree(settingJson)
                                .path("setting").path("AUTOPAY_SETTING").path("TRIAL_DAYS").asInt(0) > 0) {
                            return true;
                        }
                    } catch (Exception ignored) {
                        // malformed invite; try the next
                    }
                }
            } catch (Exception ignored) {
                // availability is a display hint; never fail the list over it
            }
        }
        return false;
    }

    private static String membershipTypeOf(Boolean isTrial, String planEndDate) {
        if (isTrial == null) {
            return null;
        }
        if (!Boolean.TRUE.equals(isTrial)) {
            return "PAID";
        }
        // A trial that has run out is not a trial member any more, and calling it one put
        // learners whose trial ended weeks ago next to people currently in theirs. It is
        // also not PAID -- they never paid. TRIAL_ENDED is the third, honest state.
        return hasPassed(planEndDate) ? "TRIAL_ENDED" : "TRIAL";
    }

    /** True when the timestamp is in the past. Unparseable or absent reads as still running. */
    private static boolean hasPassed(String timestamp) {
        if (timestamp == null || timestamp.isBlank()) {
            return false;
        }
        try {
            String normalised = timestamp.trim().replace(' ', 'T');
            if (normalised.length() > 19) {
                normalised = normalised.substring(0, 19);
            }
            return java.time.LocalDateTime.parse(normalised).isBefore(java.time.LocalDateTime.now());
        } catch (Exception e) {
            return false;
        }
    }

    private List<StudentV2DTO> mapProjectionsToDTOs(List<StudentListV2Projection> projections) {
        List<StudentV2DTO> dtos = new ArrayList<>();
        ObjectMapper mapper = new ObjectMapper();

        for (StudentListV2Projection p : projections) {
            StudentV2DTO dto = new StudentV2DTO();

            dto.setId(p.getId());
            dto.setUserId(p.getUserId());
            dto.setUsername(p.getUsername());
            dto.setEmail(p.getEmail());
            dto.setFullName(p.getFullName());
            dto.setAddressLine(p.getAddressLine());
            dto.setRegion(p.getRegion());
            dto.setCity(p.getCity());
            dto.setPinCode(p.getPinCode());
            dto.setMobileNumber(p.getPhone());

            dto.setDateOfBirth(parseTimestamp(p.getDateOfBirth()));
            dto.setGender(p.getGender());
            // Defensive: this mapper is fed by several projections, and a Spring Data
            // interface projection throws when a getter has no matching result column. A list
            // that cannot show a badge must still show the learner.
            try {
                dto.setEnrolledDate(p.getEnrolledDate());
                dto.setMembershipType(membershipTypeOf(p.getIsTrial(), p.getPlanEndDate()));
            } catch (Exception e) {
                dto.setMembershipType(null);
            }
            dto.setFathersName(p.getFathersName());
            dto.setMothersName(p.getMothersName());
            dto.setParentsMobileNumber(p.getParentsMobileNumber());
            dto.setParentsEmail(p.getParentsEmail());
            dto.setLinkedInstituteName(p.getLinkedInstituteName());
            dto.setCreatedAt(parseTimestamp(p.getCreatedAt()));
            dto.setUpdatedAt(parseTimestamp(p.getUpdatedAt()));
            dto.setFaceFileId(p.getFaceFileId());
            dto.setExpiryDate(parseTimestamp(p.getExpiryDate()));
            dto.setParentsToMotherMobileNumber(p.getParentsToMotherMobileNumber());
            dto.setParentsToMotherEmail(p.getParentsToMotherEmail());
            dto.setBillingContactName(p.getBillingContactName());
            dto.setBillingContactEmail(p.getBillingContactEmail());
            dto.setBillingContactRole(p.getBillingContactRole());

            dto.setPaymentStatus(p.getPaymentStatus());
            dto.setPackageSessionId(p.getPackageSessionId());
            dto.setAccessDays(p.getAccessDays());
            dto.setInstituteEnrollmentNumber(p.getInstituteEnrollmentNumber());
            dto.setInstituteId(p.getInstituteId());
            dto.setGroupId(p.getGroupId());
            dto.setStatus(p.getStatus());

            dto.setDestinationPackageSessionId(p.getDestinationPackageSessionId());

            // ---- ADDED MAPPINGS ----
            dto.setPaymentAmount(p.getPaymentAmount());
            dto.setSource(p.getSource());
            dto.setType(p.getType());
            dto.setTypeId(p.getTypeId());

            PaymentPlan paymentPlan = JsonUtil.fromJson(p.getPaymentPlanJson(), PaymentPlan.class);
            if (paymentPlan != null) {
                dto.setPaymentPlan(paymentPlan.mapToPaymentPlanDTO());
            }
            PaymentOption paymentOption = JsonUtil.fromJson(p.getPaymentOptionJson(), PaymentOption.class);
            if (paymentOption != null) {
                dto.setPaymentOption(paymentOption.mapToPaymentOptionDTO());
            }
            dto.setCustomFields(parseCustomFields(mapper, p.getCustomFieldsJson()));
            dto.setEnrollInviteId(p.getEnrollInviteId());
            dto.setEnrollInviteName(p.getEnrollInviteName());
            dto.setDesiredLevelId(p.getDesiredLevelId());

            dto.setSubOrgId(p.getSubOrgId());
            dto.setSubOrgName(p.getSubOrgName());
            dto.setCommaSeparatedOrgRoles(p.getCommaSeparatedOrgRoles());

            dto.setTncAccepted(p.getTncAccepted());
            dto.setTncFileId(p.getTncFileId());
            dto.setTncAcceptedDate(p.getTncAcceptedDate());
            dto.setIsAudienceOnly(p.getIsAudienceOnly());

            dtos.add(dto);
        }

        return dtos;
    }

    private <T> T parseJsonSafe(ObjectMapper mapper, String json, Class<T> clazz) {
        if (json == null || json.trim().isEmpty())
            return null;
        try {
            return mapper.readValue(json, clazz);
        } catch (JsonProcessingException e) {
            // Log error if needed
            return null;
        }
    }

    private Map<String, String> parseCustomFields(ObjectMapper mapper, String json) {
        if (json == null || json.equals("[]"))
            return new HashMap<>();
        try {
            List<CustomFieldValueMap> list = mapper.readValue(json, new TypeReference<List<CustomFieldValueMap>>() {
            });
            // Skip null values: an institute can have thousands of custom-field
            // definitions but only a handful are filled per learner. Emitting
            // {uuid: null} for each empty definition bloats the page response
            // ~250x (observed: 4077 defs * 10 rows = 1.77 MB; populated == ~7 KB).
            Map<String, String> map = new HashMap<>();
            for (CustomFieldValueMap cf : list) {
                if (cf.getValue() != null) {
                    map.put(cf.getCustomFieldId(), cf.getValue());
                }
            }
            return map;
        } catch (JsonProcessingException e) {
            return new HashMap<>();
        }
    }

    private void enrichWithUserCredentials(List<StudentV2DTO> dtos) {
        List<String> userIds = dtos.stream()
                .map(StudentV2DTO::getUserId)
                .filter(Objects::nonNull)
                .toList();

        List<UserCredentials> creds = getUsersCredentialFromAuthService(userIds);
        Map<String, UserCredentials> credsMap = creds.stream()
                .collect(Collectors.toMap(UserCredentials::getUserId, c -> c));

        for (StudentV2DTO dto : dtos) {
            UserCredentials c = credsMap.get(dto.getUserId());
            if (c != null) {
                dto.setPassword(c.getPassword());
            }
        }
    }

    private AllStudentV2Response buildResponse(List<StudentV2DTO> content, Page<StudentListV2Projection> page,
            int pageSize, boolean unused) {
        if (page == null) {
            return AllStudentV2Response.builder()
                    .content(content)
                    .pageNo(0)
                    .pageSize(pageSize)
                    .totalElements(0)
                    .totalPages(0)
                    .last(true)
                    .build();
        }

        return AllStudentV2Response.builder()
                .content(content)
                .pageNo(page.getNumber())
                .pageSize(page.getSize())
                .totalElements(page.getTotalElements())
                .totalPages(page.getTotalPages())
                .last(page.isLast())
                .build();
    }

    private Date parseTimestamp(String ts) {
        if (ts == null)
            return null;
        try {
            return Timestamp.valueOf(ts); // parses "yyyy-MM-dd HH:mm:ss.SSSSSS"
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public ResponseEntity<byte[]> getStudentsCsvExport(CustomUserDetails user, StudentListFilter studentListFilter,
            int pageNo, int pageSize) {

        // Get the total number of pages for the given filter
        int totalPages = getLinkedStudents(user, studentListFilter, pageNo, pageSize).getBody().getTotalPages();
        // List to store all employees
        List<StudentDTO> allStudents = new ArrayList<>();

        // Loop through all pages and append data
        for (int page = 0; page < totalPages; page++) {
            // Retrieve employees for the current page and add them to the list
            List<StudentDTO> employees = getLinkedStudents(user, studentListFilter, page, pageSize).getBody()
                    .getContent();
            allStudents.addAll(employees);
        }

        return DataToCsvConverter.convertListToCsv(allStudents);
    }

    public ResponseEntity<byte[]> getStudentsBasicDetailsCsv(CustomUserDetails user,
            StudentListFilter studentListFilter, int pageNo, int pageSize) {
        // Get the total number of pages
        int totalPages = getLinkedStudents(user, studentListFilter, pageNo, pageSize).getBody().getTotalPages();

        // Map to store students and List to collect user IDs
        Map<String, StudentDTO> studentMap = new HashMap<>();
        List<String> userIds = new ArrayList<>();

        // Fetch students across all pages
        for (int page = 0; page < totalPages; page++) {
            for (StudentDTO student : getLinkedStudents(user, studentListFilter, page, pageSize).getBody()
                    .getContent()) {
                studentMap.put(student.getUserId(), student);
                userIds.add(student.getUserId());
            }
        }

        // Fetch user credentials
        List<UserCredentials> userCredentials = getUsersCredentialFromAuthService(userIds);

        // Convert to StudentBasicDetailsDTO
        List<StudentBasicDetailsDTO> studentBasicDetailsDTOS = new ArrayList<>();
        for (UserCredentials userCredential : userCredentials) {
            StudentDTO studentDTO = studentMap.get(userCredential.getUserId());
            studentBasicDetailsDTOS.add(new StudentBasicDetailsDTO(
                    studentDTO.getFullName(),
                    studentDTO.getInstituteEnrollmentId(),
                    userCredential.getUsername(),
                    userCredential.getPassword()));
        }

        return DataToCsvConverter.convertListToCsv(studentBasicDetailsDTOS);
    }

    public List<UserCredentials> getUsersCredentialFromAuthService(List<String> userIds) {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    applicationName, HttpMethod.POST.name(), authServerBaseUrl,
                    StudentConstants.USERS_CREDENTIALS_ROUTE, userIds);

            return objectMapper.readValue(response.getBody(),
                    new TypeReference<List<UserCredentials>>() {
                    });

        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }
}
