package vacademy.io.admin_core_service.features.institute.manager;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import jakarta.servlet.http.HttpServletRequest;
import vacademy.io.admin_core_service.features.institute.util.PublicSettingRedactor;
import vacademy.io.admin_core_service.features.institute.dto.PaginatedPackageSessionResponse;
import vacademy.io.admin_core_service.features.institute.dto.BatchesSummaryResponse;
import vacademy.io.admin_core_service.features.institute.dto.BatchLookupResponse;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldDTO;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.enroll_invite.enums.SubOrgRoles;
import vacademy.io.admin_core_service.features.group.repository.PackageGroupMappingRepository;
import vacademy.io.admin_core_service.features.institute.dto.InstituteSetupDTO;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.domain_routing.service.LearnerPortalUrlResolver;
import vacademy.io.admin_core_service.features.institute.service.InstituteModuleService;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteInfoDTOForTableSetup;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.slide.service.SlideService;
import vacademy.io.admin_core_service.features.subject.repository.SubjectRepository;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.common.auth.enums.Gender;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.dto.*;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import vacademy.io.common.tracing.PerformanceTracer;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Component
public class InstituteInitManager {

        private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(InstituteInitManager.class);

        @Autowired
        InstituteModuleService instituteModuleService;
        @Autowired
        InstituteRepository instituteRepository;

        @Autowired
        PackageRepository packageRepository;

        @Autowired
        SubjectRepository subjectRepository;

        @Autowired
        PackageSessionRepository packageSessionRepository;

        @Autowired
        private PackageGroupMappingRepository packageGroupMappingRepository;

        @Autowired
        private SlideService slideService;

        @Autowired
        private LearnerPortalUrlResolver learnerPortalUrlResolver;

        @Autowired
        private InstituteCustomFiledService instituteCustomFiledService;

        @Autowired
        private FacultySubjectPackageSessionMappingRepository facultyMappingRepository;

        @Autowired
        private JwtService jwtService;


        @Transactional
        public InstituteInfoDTO getInstituteDetails(String instituteId, boolean includeBatches) {
                return buildInstituteInfoDTO(instituteId, true, includeBatches, null);
        }

        @Transactional
        public InstituteInfoDTO getInstituteDetails(String instituteId, boolean includeBatches,
                        CustomUserDetails user) {
                return buildInstituteInfoDTO(instituteId, true, includeBatches, user);
        }

        @Transactional
        public InstituteInfoDTO getPublicInstituteDetails(String instituteId, boolean includeBatches) {
                return buildInstituteInfoDTO(instituteId, false, includeBatches, null);
        }

        /**
         * Builds InstituteInfoDTO with common logic for both public and private access
         * 
         * @param instituteId          The institute ID
         * @param includePrivateFields Whether to include private fields (email, phone,
         *                             subjects, etc.)
         * @return Populated InstituteInfoDTO
         */
        private InstituteInfoDTO buildInstituteInfoDTO(String instituteId, boolean includePrivateFields,
                        boolean includeBatches, CustomUserDetails user) {
                // Trace the main database lookup
                Institute institute = PerformanceTracer.traceDbQuery(
                                "instituteRepository.findById",
                                () -> instituteRepository.findById(instituteId)
                                                .orElseThrow(() -> new VacademyException("Invalid Institute Id")));

                InstituteInfoDTO dto = new InstituteInfoDTO();

                // Basic institute information (in-memory, fast)
                dto.setInstituteName(institute.getInstituteName());
                dto.setId(institute.getId());
                dto.setCity(institute.getCity());
                dto.setCountry(institute.getCountry());
                dto.setCurrency(institute.getCurrency());
                dto.setState(institute.getState());
                dto.setPinCode(institute.getPinCode());
                dto.setAddress(institute.getAddress());
                dto.setWebsiteUrl(institute.getWebsiteUrl());
                dto.setDescription(institute.getDescription());
                dto.setHeldBy(institute.getHeldBy());
                dto.setFoundedDate(institute.getFoundedData());
                dto.setType(institute.getInstituteType());
                dto.setLanguage(institute.getLanguage());
                dto.setInstituteThemeCode(institute.getInstituteThemeCode());

                // Portal URLs with defaults. The learner portal goes through the shared
                // resolver (learner_portal_base_url → institute_domain_routing role=LEARNER
                // → configured default) instead of falling straight back to a hardcoded
                // host: institutes with no column value — sub-orgs especially — do have a
                // branded LEARNER routing row, and every caller that builds a learner link
                // from this field was sending them to learner.vacademy.io. Kept host-only,
                // exactly as before, since callers prepend their own scheme.
                dto.setLearnerPortalBaseUrl(
                                learnerPortalUrlResolver.resolveBaseUrl(instituteId, institute)
                                                .replaceFirst("^https?://", ""));
                dto.setTeacherPortalBaseUrl(
                                Optional.ofNullable(institute.getTeacherPortalBaseUrl()).orElse("teacher.vacademy.io"));
                dto.setAdminPortalBaseUrl(
                                Optional.ofNullable(institute.getAdminPortalBaseUrl()).orElse("dash.vacademy.io"));

                // File IDs
                dto.setInstituteLogoFileId(institute.getLogoFileId());
                dto.setCoverImageFileId(institute.getCoverImageFileId());
                dto.setCoverTextJson(institute.getCoverTextJson());
                // The public (no login) details carry no credentials: the blob holds the
                // SMTP password, WhatsApp apiKey and LMS tokens alongside display settings.
                dto.setSetting(includePrivateFields
                                ? institute.getSetting()
                                : PublicSettingRedactor.redact(institute.getSetting()));

                // School-specific fields
                dto.setBoard(institute.getBoard());
                dto.setGstDetails(institute.getGstDetails());
                dto.setAffiliationNumber(institute.getAffiliationNumber());
                dto.setStaffStrength(institute.getStaffStrength());
                dto.setSchoolStrength(institute.getSchoolStrength());

                // Private fields (email, phone, etc.)
                if (includePrivateFields) {
                        dto.setEmail(institute.getEmail());
                        dto.setPhone(institute.getMobileNumber());
                        dto.setLetterHeadFileId(institute.getLetterHeadFileId());
                }

                // Fetch related data from repositories - TRACE EACH QUERY
                String instId = institute.getId();
                List<String> activeStatuses = List.of(PackageSessionStatusEnum.ACTIVE.name());

                // Trace tags lookup. Admin callers see the tags of unpublished courses too;
                // the public catalogue keeps seeing only published ones.
                dto.setTags(includePrivateFields
                                ? PerformanceTracer.traceDbQuery(
                                                "packageRepository.findAllDistinctAdminTagsByInstituteId",
                                                () -> packageRepository.findAllDistinctAdminTagsByInstituteId(instId))
                                : PerformanceTracer.traceDbQuery(
                                                "packageRepository.findAllDistinctTagsByInstituteId",
                                                () -> packageRepository.findAllDistinctTagsByInstituteId(instId)));

                // Trace sessions lookup
                dto.setSessions(PerformanceTracer.traceDbQuery(
                                "packageRepository.findDistinctSessionsByInstituteIdAndStatusIn",
                                () -> packageRepository
                                                .findDistinctSessionsByInstituteIdAndStatusIn(instId, activeStatuses)
                                                .stream().map(SessionDTO::new).toList()));

                // Trace levels lookup
                dto.setLevels(PerformanceTracer.traceDbQuery(
                                "packageRepository.findDistinctLevelsByInstituteIdAndStatusIn",
                                () -> packageRepository
                                                .findDistinctLevelsByInstituteIdAndStatusIn(instId, activeStatuses)
                                                .stream().map(LevelDTO::new).toList()));

                // Trace package groups lookup
                dto.setPackageGroups(PerformanceTracer.traceDbQuery(
                                "packageGroupMappingRepository.findAllByInstituteId",
                                () -> packageGroupMappingRepository.findAllByInstituteId(instId)
                                                .stream().map(obj -> obj.mapToDTO()).toList()));

                if (includeBatches) {
                        // OPTIMIZATION: Fetch all package sessions first, then batch query read times
                        List<PackageSession> packageSessions = PerformanceTracer.traceDbQuery(
                                        "packageSessionRepository.findPackageSessionsByInstituteId",
                                        () -> packageSessionRepository.findPackageSessionsByInstituteId(instId,
                                                        activeStatuses));

                        // Skip faculty filtering for users with ADMIN/TEACHER role — they should see all package sessions.
                        // Sub-org admins (no ADMIN/TEACHER role, but have FSPSSM) → filtering applies, scoped to their access.
                        if (user != null && !hasRole(user, instId, "ADMIN", "TEACHER") && hasFacultyAssignedPermission(user)) {
                                List<String> allowedAccessIds = facultyMappingRepository
                                                .findAccessIdsByUserIdAndInstituteId(
                                                                user.getUserId(), instId, List.of("ACTIVE"));
                                log.info("[FACULTY-FILTER] userId={}, instituteId={}, allowedAccessIds={}",
                                                user.getUserId(), instId, allowedAccessIds);
                                if (!allowedAccessIds.isEmpty()) {
                                        Set<String> allowedSet = new HashSet<>(allowedAccessIds);
                                        int beforeSize = packageSessions.size();
                                        packageSessions = packageSessions.stream()
                                                        .filter(ps -> allowedSet.contains(ps.getId()))
                                                        .toList();
                                        log.info("[FACULTY-FILTER] filtered packageSessions from {} to {}", beforeSize,
                                                        packageSessions.size());
                                }
                        }

                        // Batch query to get all read times at once (eliminates N+1 query problem)
                        List<String> sessionIds = packageSessions.stream().map(PackageSession::getId).toList();

                        // This is likely the SLOWEST operation - trace it carefully
                        Map<String, Double> readTimeMap = PerformanceTracer.trace(
                                        "compute.heavy",
                                        "slideService.calculateReadTimesForPackageSessions",
                                        () -> slideService.calculateReadTimesForPackageSessions(sessionIds));

                        // Map package sessions to DTOs with read times from the batch result
                        dto.setBatchesForSessions(packageSessions.stream()
                                        .map(obj -> new PackageSessionDTO(obj,
                                                        readTimeMap.getOrDefault(obj.getId(), 0.0).doubleValue()))
                                        .toList());

                } else {
                        dto.setBatchesForSessions(List.of());
                }

                // Private fields that require additional queries
                if (includePrivateFields) {
                        dto.setGenders(Stream.of(Gender.values()).map(Enum::name).toList());
                        dto.setStudentStatuses(List.of("ACTIVE", "INACTIVE"));

                        // Trace subjects lookup
                        dto.setSubjects(PerformanceTracer.traceDbQuery(
                                        "subjectRepository.findDistinctSubjectsByInstituteId",
                                        () -> subjectRepository.findDistinctSubjectsByInstituteId(instId)
                                                        .stream().map(SubjectDTO::new).toList()));
                        dto.setSessionExpiryDays(List.of(30, 180, 360));
                }

                dto.setSubModules(new ArrayList<>());

                return dto;
        }

        private InstituteInfoDTOForTableSetup buildInstituteInfoDTOForTableSetup(String instituteId,
                        boolean includePrivateFields, boolean includeBatches) {
                Institute institute = instituteRepository.findById(instituteId)
                                .orElseThrow(() -> new VacademyException("Invalid Institute Id"));
                InstituteInfoDTOForTableSetup idto = new InstituteInfoDTOForTableSetup();

                String instId = institute.getId();
                List<String> activeStatuses = List.of(PackageSessionStatusEnum.ACTIVE.name());

                // Only the authenticated admin setup endpoints build this DTO.
                idto.setTags(packageRepository.findAllDistinctAdminTagsByInstituteId(instId));
                idto.setLevels(packageRepository.findDistinctLevelsByInstituteIdAndStatusIn(instId, activeStatuses)
                                .stream().map(LevelDTO::new).toList());
                idto.setPackageGroups(packageGroupMappingRepository.findAllByInstituteId(instId)
                                .stream().map(obj -> obj.mapToDTO()).toList());
                if (includeBatches) {

                        // OPTIMIZATION: Fetch all package sessions first, then batch query read times
                        List<PackageSession> packageSessions = packageSessionRepository
                                        .findPackageSessionsByInstituteId(instId,
                                                        activeStatuses);

                        // Batch query to get all read times at once (eliminates N+1 query problem)
                        List<String> sessionIds = packageSessions.stream().map(PackageSession::getId).toList();
                        Map<String, Double> readTimeMap = slideService.calculateReadTimesForPackageSessions(sessionIds);

                        // Map package sessions to DTOs with read times from the batch result
                        idto.setBatchesForSessions(packageSessions.stream()
                                        .map(obj -> new PackageSessionDTO(obj,
                                                        readTimeMap.getOrDefault(obj.getId(), 0.0).doubleValue()))
                                        .toList());
                } else {
                        idto.setBatchesForSessions(List.of());
                }

                // Private fields that require additional queries
                if (includePrivateFields) {
                        idto.setGenders(Stream.of(Gender.values()).map(Enum::name).toList());
                        idto.setStudentStatuses(List.of("ACTIVE", "INACTIVE", "INVITED", "PENDING_FOR_APPROVAL"));
                        idto.setSessionExpiryDays(List.of(30, 180, 360));
                }

                return idto;
        }

        @Transactional
        public InstituteSetupDTO getInstituteSetupDetails(String instituteId, boolean includeBatches) {

                InstituteInfoDTOForTableSetup instituteInfoDTOForTableSetup = buildInstituteInfoDTOForTableSetup(
                                instituteId, true, includeBatches);

                // Get active dropdown custom fields
                List<CustomFieldDTO> dropdownCustomFields = instituteCustomFiledService
                                .getActiveDropdownCustomFields(instituteId);

                // Build and return setup DTO
                return InstituteSetupDTO.builder()
                                .instituteInfoDTO(instituteInfoDTOForTableSetup)
                                .dropdownCustomFields(dropdownCustomFields)
                                .subOrgRoles(List.of(SubOrgRoles.LEARNER, SubOrgRoles.ADMIN, SubOrgRoles.ROOT_ADMIN))
                                .build();
        }

        public ResponseEntity<String> getInstituteIdOrSubDomain(String instituteId, String subdomain) {
                if (Objects.isNull(instituteId) && Objects.isNull(subdomain))
                        throw new VacademyException("Invalid Request");

                if (Objects.isNull(instituteId)) {
                        Optional<Institute> institute = instituteRepository.findBySubdomainLimit1(subdomain);
                        if (institute.isEmpty())
                                return ResponseEntity.ok("Data not found");
                        return ResponseEntity.ok(institute.get().getId());
                }

                Optional<Institute> institute = instituteRepository.findById(instituteId);
                if (institute.isEmpty())
                        return ResponseEntity.ok("Data not found");
                return ResponseEntity.ok(institute.get().getSubdomain());
        }

        /**
         * Fetches paginated package sessions (batches) for an institute.
         * This method is designed for scalability - only fetches a page at a time
         * and calculates read times only for the fetched sessions.
         *
         * @param instituteId       The institute ID
         * @param page              Page number (0-indexed)
         * @param size              Page size (default 20)
         * @param sessionId         Optional session ID filter
         * @param levelId           Optional level ID filter
         * @param packageId         Optional package ID filter
         * @param search            Optional search query (matches package, level,
         *                          session names)
         * @param packageSessionIds Optional list of specific package session IDs to
         *                          include
         * @param sortBy            Sort field (package_name, level_name, session_name,
         *                          created_at)
         * @param sortDirection     Sort direction (ASC, DESC)
         * @param statuses          List of statuses to filter (default: ACTIVE)
         * @return Paginated response with package sessions and pagination metadata
         */
        @Transactional(readOnly = true)
        public PaginatedPackageSessionResponse getPaginatedPackageSessions(
                        String instituteId,
                        int page,
                        int size,
                        String sessionId,
                        String levelId,
                        String packageId,
                        String search,
                        List<String> packageSessionIds,
                        String sortBy,
                        String sortDirection,
                        List<String> statuses) {

                // Validate institute exists
                if (!instituteRepository.existsById(instituteId)) {
                        throw new VacademyException("Invalid Institute Id");
                }

                // Default to ACTIVE status if not provided
                final List<String> finalStatuses;
                if (statuses == null || statuses.isEmpty()) {
                        finalStatuses = List.of(PackageSessionStatusEnum.ACTIVE.name());
                } else {
                        finalStatuses = statuses;
                }

                // Default sort values
                final String finalSortBy = (sortBy == null || sortBy.isEmpty()) ? "created_at" : sortBy;
                final String finalSortDirection = (sortDirection == null || sortDirection.isEmpty()) ? "DESC"
                                : sortDirection.toUpperCase();

                // Create pageable request
                Pageable pageable = PageRequest.of(page, size);

                // Fetch paginated package sessions
                Page<PackageSession> packageSessionPage = PerformanceTracer.traceDbQuery(
                                "packageSessionRepository.findPackageSessionsByInstituteIdPaginated",
                                () -> packageSessionRepository.findPackageSessionsByInstituteIdPaginated(
                                                instituteId,
                                                finalStatuses,
                                                sessionId,
                                                levelId,
                                                packageId,
                                                search,
                                                packageSessionIds,
                                                finalSortBy,
                                                finalSortDirection,
                                                pageable));

                // Get session IDs for the current page only
                List<String> psIds = packageSessionPage.getContent().stream()
                                .map(PackageSession::getId)
                                .toList();

                // Calculate read times only for the current page (optimized)
                Map<String, Double> readTimeMap = PerformanceTracer.trace(
                                "compute.heavy",
                                "slideService.calculateReadTimesForPackageSessions",
                                () -> slideService.calculateReadTimesForPackageSessions(psIds));

                // Map to DTOs with read times
                List<PackageSessionDTO> content = packageSessionPage.getContent().stream()
                                .map(ps -> new PackageSessionDTO(ps,
                                                readTimeMap.getOrDefault(ps.getId(), 0.0)))
                                .toList();

                // Build paginated response
                return PaginatedPackageSessionResponse.builder()
                                .content(content)
                                .pageNumber(packageSessionPage.getNumber())
                                .pageSize(packageSessionPage.getSize())
                                .totalElements(packageSessionPage.getTotalElements())
                                .totalPages(packageSessionPage.getTotalPages())
                                .first(packageSessionPage.isFirst())
                                .last(packageSessionPage.isLast())
                                .hasNext(packageSessionPage.hasNext())
                                .hasPrevious(packageSessionPage.hasPrevious())
                                .build();
        }

        /**
         * Fetches package sessions by specific IDs for batch lookup.
         * Used for ID resolution (displaying selected filter badges, showing batch
         * names in tables).
         *
         * @param instituteId The institute ID
         * @param ids         List of package session IDs to fetch
         * @return Response with matching package sessions
         */
        @Transactional(readOnly = true)
        public BatchLookupResponse getBatchesByIds(String instituteId, List<String> ids) {
                // Validate institute exists
                if (!instituteRepository.existsById(instituteId)) {
                        throw new VacademyException("Invalid Institute Id");
                }

                if (ids == null || ids.isEmpty()) {
                        return BatchLookupResponse.builder().content(List.of()).build();
                }

                // Fetch package sessions by IDs
                List<PackageSession> packageSessions = PerformanceTracer.traceDbQuery(
                                "packageSessionRepository.findPackageSessionsByInstituteIdAndIds",
                                () -> packageSessionRepository.findPackageSessionsByInstituteIdAndIds(instituteId,
                                                ids));

                // Get IDs for read time calculation
                List<String> psIds = packageSessions.stream()
                                .map(PackageSession::getId)
                                .toList();

                // Calculate read times
                Map<String, Double> readTimeMap = PerformanceTracer.trace(
                                "compute.heavy",
                                "slideService.calculateReadTimesForPackageSessions",
                                () -> slideService.calculateReadTimesForPackageSessions(psIds));

                // Map to DTOs
                List<PackageSessionDTO> content = packageSessions.stream()
                                .map(ps -> new PackageSessionDTO(ps,
                                                readTimeMap.getOrDefault(ps.getId(), 0.0)))
                                .toList();

                return BatchLookupResponse.builder().content(content).build();
        }

        /**
         * Fetches summary/aggregates for batches - provides filter options.
         * Returns unique packages, levels, sessions, and aggregate counts.
         *
         * @param instituteId The institute ID
         * @param statuses    Optional status filter (default: ACTIVE)
         * @return Summary with filter options
         */
        @Transactional(readOnly = true)
        public BatchesSummaryResponse getBatchesSummary(String instituteId, List<String> statuses) {
                // Validate institute exists
                if (!instituteRepository.existsById(instituteId)) {
                        throw new VacademyException("Invalid Institute Id");
                }

                // Default to ACTIVE status if not provided
                final List<String> finalStatuses;
                if (statuses == null || statuses.isEmpty()) {
                        finalStatuses = List.of(PackageSessionStatusEnum.ACTIVE.name());
                } else {
                        finalStatuses = statuses;
                }

                // Fetch all package sessions for the institute
                List<PackageSession> packageSessions = PerformanceTracer.traceDbQuery(
                                "packageSessionRepository.findPackageSessionsByInstituteId",
                                () -> packageSessionRepository.findPackageSessionsByInstituteId(instituteId,
                                                finalStatuses));

                // Extract unique packages
                Set<String> seenPackageIds = new HashSet<>();
                List<BatchesSummaryResponse.IdNameDTO> packages = packageSessions.stream()
                                .filter(ps -> ps.getPackageEntity() != null)
                                .filter(ps -> seenPackageIds.add(ps.getPackageEntity().getId()))
                                .map(ps -> BatchesSummaryResponse.IdNameDTO.builder()
                                                .id(ps.getPackageEntity().getId())
                                                .name(ps.getPackageEntity().getPackageName())
                                                .build())
                                .collect(Collectors.toList());

                // Extract unique levels
                Set<String> seenLevelIds = new HashSet<>();
                List<BatchesSummaryResponse.IdNameDTO> levels = packageSessions.stream()
                                .filter(ps -> ps.getLevel() != null)
                                .filter(ps -> seenLevelIds.add(ps.getLevel().getId()))
                                .map(ps -> BatchesSummaryResponse.IdNameDTO.builder()
                                                .id(ps.getLevel().getId())
                                                .name(ps.getLevel().getLevelName())
                                                .build())
                                .collect(Collectors.toList());

                // Extract unique sessions
                Set<String> seenSessionIds = new HashSet<>();
                List<BatchesSummaryResponse.IdNameDTO> sessions = packageSessions.stream()
                                .filter(ps -> ps.getSession() != null)
                                .filter(ps -> seenSessionIds.add(ps.getSession().getId()))
                                .map(ps -> BatchesSummaryResponse.IdNameDTO.builder()
                                                .id(ps.getSession().getId())
                                                .name(ps.getSession().getSessionName())
                                                .build())
                                .collect(Collectors.toList());

                // Check if any batch has org association
                boolean hasOrgAssociated = packageSessions.stream()
                                .anyMatch(ps -> Boolean.TRUE.equals(ps.getIsOrgAssociated()));

                return BatchesSummaryResponse.builder()
                                .totalBatches(packageSessions.size())
                                .hasOrgAssociated(hasOrgAssociated)
                                .packages(packages)
                                .levels(levels)
                                .sessions(sessions)
                                .build();
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

        /**
         * Checks if the user has HAS_FACULTY_ASSIGNED permission.
         * Falls back to checking FSPSSM directly if not found in Spring Security authorities.
         */
        private boolean hasFacultyAssignedPermission(CustomUserDetails user) {
                boolean fromAuthorities = user.getAuthorities().stream()
                                .map(auth -> auth.getAuthority())
                                .anyMatch(authority -> "HAS_FACULTY_ASSIGNED".equalsIgnoreCase(authority));
                if (fromAuthorities) return true;

                // Fallback: check if user has any active FSPSSM entries
                return facultyMappingRepository.findByUserId(user.getUserId()).stream()
                                .anyMatch(m -> "ACTIVE".equals(m.getStatus()));
        }
}
