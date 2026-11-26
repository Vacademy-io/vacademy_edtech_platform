package vacademy.io.admin_core_service.features.institute.manager;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.certificate.notification.CertificateIssuedNotificationService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateNumberService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateSettingsResolver;
import vacademy.io.admin_core_service.features.institute.enums.CertificateTypeEnum;
import vacademy.io.admin_core_service.features.institute.dto.CertificationGenerationRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateNumberingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateNumberingStatusDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingRequest;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.media.dto.FileDetailsDTO;

import java.util.*;
import java.util.stream.Collectors;

@Component
public class InstituteCertificateManager {

    private final InstituteSettingService instituteSettingService;
    private final StudentSessionInstituteGroupMappingRepository studentSessionInstituteGroupMappingRepository;
    private final InstituteRepository instituteRepository;
    private final MediaService mediaService;
    private final CertificateIssuedNotificationService certificateIssuedNotificationService;
    private final AuthService authService;
    private final CertificateSettingsResolver certificateSettingsResolver;
    private final CertificateNumberService certificateNumberService;

    public InstituteCertificateManager(InstituteSettingService instituteSettingService,
                                       StudentSessionInstituteGroupMappingRepository studentSessionInstituteGroupMappingRepository,
                                       InstituteRepository instituteRepository,
                                       MediaService mediaService,
                                       CertificateIssuedNotificationService certificateIssuedNotificationService,
                                       AuthService authService,
                                       CertificateSettingsResolver certificateSettingsResolver,
                                       CertificateNumberService certificateNumberService) {
        this.instituteSettingService = instituteSettingService;
        this.studentSessionInstituteGroupMappingRepository = studentSessionInstituteGroupMappingRepository;
        this.instituteRepository = instituteRepository;
        this.mediaService = mediaService;
        this.certificateIssuedNotificationService = certificateIssuedNotificationService;
        this.authService = authService;
        this.certificateSettingsResolver = certificateSettingsResolver;
        this.certificateNumberService = certificateNumberService;
    }

    public ResponseEntity<String> generateAutomatedCourseCompletionCertificate(CustomUserDetails userDetails, String learnerId, String packageSessionId, String instituteId, CertificationGenerationRequest request) {
        return generateAutomatedCourseCompletionCertificate(userDetails, learnerId, packageSessionId, instituteId, request, false);
    }

    /**
     * @param bypassCriteria admin "Issue anyway" - skip the course's earning rule
     *                       (progress and/or test marks). A parameter rather than a
     *                       request-body field on purpose: the learner endpoint shares
     *                       {@link CertificationGenerationRequest}, and a body flag would
     *                       let any learner switch the gate off.
     */
    public ResponseEntity<String> generateAutomatedCourseCompletionCertificate(CustomUserDetails userDetails, String learnerId, String packageSessionId, String instituteId, CertificationGenerationRequest request, boolean bypassCriteria) {
        Optional<StudentSessionInstituteGroupMapping> instituteStudentMapping = studentSessionInstituteGroupMappingRepository.findByUserIdAndPackageSessionIdAndInstituteId(learnerId, packageSessionId, instituteId);
        if(instituteStudentMapping.isEmpty()) throw new VacademyException(HttpStatus.NOT_FOUND, "Student Mapping Not Present");

        // Force a fresh render when the caller opts in (preview flows, post-
        // template-edit refresh). Without this opt-in the cached file id
        // wins and learners keep seeing pre-fix output regardless of how the
        // template/tokens have changed.
        boolean forceRegenerate = request != null && Boolean.TRUE.equals(request.getRegenerate());

        // Enablement is checked here, before the cached-file shortcut, not only
        // inside the render path. Previously a learner whose mapping already had
        // a cached file id got the certificate URL back without the resolver
        // ever being consulted — so switching certificates off stopped new
        // issuance but kept serving existing ones, and the audit-row self-heal
        // below ran too. "Off" now means off for both paths.
        if (!isCertificateEnabledFor(instituteStudentMapping.get())) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Certificates are not enabled for this course");
        }

        if(forceRegenerate || !StringUtils.hasText(instituteStudentMapping.get().getAutomatedCompletionCertificateFileId())){
            return handleCaseWhereCertificateNotPresent(learnerId,packageSessionId,instituteId, instituteStudentMapping, request, bypassCriteria);
        }

        // Self-heal the issued_certificate audit table for legacy issuances
        // that pre-date it. Fresh issuances always write a row via the render
        // path; this catches the historical gap where a learner's mapping has
        // a cached file id but the audit table has no row. No-op if a row
        // already exists.
        StudentSessionInstituteGroupMapping mapping = instituteStudentMapping.get();
        String courseName = (request != null && request.getCourseName() != null) ? request.getCourseName()
                : Optional.ofNullable(mapping.getPackageSession())
                        .map(ps -> ps.getPackageEntity())
                        .map(PackageEntity::getPackageName)
                        .orElse("");
        instituteSettingService.backfillIssuedCertificateIfMissing(
                mapping, mapping.getAutomatedCompletionCertificateFileId(), courseName);

        return new ResponseEntity<>(getPdfUrlFromFileId(mapping.getAutomatedCompletionCertificateFileId()), HttpStatus.ACCEPTED);
    }

    /**
     * Whether certificates are switched on for this learner's course, resolved
     * through the same {@code course override -> institute -> disabled} rule the
     * render path uses, so the two can never disagree.
     */
    private boolean isCertificateEnabledFor(StudentSessionInstituteGroupMapping mapping) {
        String packageId = Optional.ofNullable(mapping.getPackageSession())
                .map(ps -> ps.getPackageEntity())
                .map(PackageEntity::getId)
                .orElse(null);
        return certificateSettingsResolver
                .resolve(mapping.getInstitute(), packageId, CertificateTypeEnum.COURSE_COMPLETION.name())
                .isEnabled();
    }

    private String getPdfUrlFromFileId(String automatedCompletionCertificateFileId) {
        return mediaService.getFilePublicUrlById(automatedCompletionCertificateFileId);
    }

    private ResponseEntity<String> handleCaseWhereCertificateNotPresent(String learnerId, String packageSessionId, String instituteId, Optional<StudentSessionInstituteGroupMapping> instituteStudentMapping, CertificationGenerationRequest request, boolean bypassCriteria) {
        Optional<FileDetailsDTO> file = instituteSettingService.ifEligibleForCourseCertificationForUserAndPackageSession(learnerId,packageSessionId,instituteId,instituteStudentMapping, request, bypassCriteria);
        if(instituteStudentMapping.isEmpty()) throw new VacademyException("Mapping Not Found");
        if(file.isEmpty()) throw new VacademyException(HttpStatus.NOT_FOUND, "Failed To Fetch Certificate");

        StudentSessionInstituteGroupMapping mapping = instituteStudentMapping.get();
        mapping.setAutomatedCompletionCertificateFileId(file.get().getId());
        studentSessionInstituteGroupMappingRepository.save(mapping);

        // Fire the certificate-issued email asynchronously of failure: never block
        // the response or surface a failure to the learner if the email fails.
        try {
            String studentName = "";
            try {
                List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(mapping.getUserId()));
                if (users != null && !users.isEmpty()) {
                    studentName = users.get(0).getFullName();
                }
            } catch (Exception ignored) { /* fall back to empty name */ }

            String courseName = (request != null && request.getCourseName() != null) ? request.getCourseName()
                    : Optional.ofNullable(mapping.getPackageSession())
                            .map(ps -> ps.getPackageEntity())
                            .map(PackageEntity::getPackageName)
                            .orElse("");

            certificateIssuedNotificationService.notifyCertificateIssued(
                    mapping.getInstitute(),
                    mapping.getUserId(),
                    studentName,
                    courseName,
                    file.get().getId(),
                    file.get().getUrl());
        } catch (Exception ignored) {
            // notification path is best-effort
        }

        return new ResponseEntity<>(file.get().getUrl(), HttpStatus.OK);
    }

    public ResponseEntity<String> updateCurrentCertificateTemplate(CustomUserDetails userDetails, String instituteId, CertificationGenerationRequest request) {
        try{
            Optional<Institute> institute = instituteRepository.findById(instituteId);
            if(institute.isEmpty()) throw new VacademyException(HttpStatus.NOT_FOUND, "Institute Not Found");

            return ResponseEntity.ok(instituteSettingService.updateInstituteCurrentTemplate(institute.get(), request));
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed To Update Current Template");
        }
    }

    public ResponseEntity<Map<String, String>> getAllCertificateForLearner(CustomUserDetails userDetails, String learnerId, String commaSeparatedPackageSessionIds, String instituteId) {
        List<String> allPackageSessionIds = getListFromCommaSeparated(commaSeparatedPackageSessionIds);
        Map<String, String> response = new HashMap<>();
        List<StudentSessionInstituteGroupMapping> studentSessionInstituteGroupMappings = studentSessionInstituteGroupMappingRepository.findAllByLearnerIdAndPackageSessionIdInAndInstituteIdAndStatusInAndCertificate(learnerId,allPackageSessionIds,instituteId,new ArrayList<>());

        for (StudentSessionInstituteGroupMapping mapping : studentSessionInstituteGroupMappings) {
            response.put(mapping.getPackageSession().getId(), mediaService.getFileUrlById(mapping.getAutomatedCompletionCertificateFileId()));
        }

        return ResponseEntity.ok(response);
    }

    public static List<String> getListFromCommaSeparated(String input) {
        if (input == null || input.isBlank()) {
            return List.of(); // return empty list if null/blank
        }

        return Arrays.stream(input.split(","))
                .map(String::trim)      // remove spaces around values
                .filter(s -> !s.isEmpty()) // skip empty values
                .collect(Collectors.toList());
    }

    public ResponseEntity<String> updateCertificateSetting(CustomUserDetails userDetails, String instituteId, CertificateSettingRequest request) {

        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if(institute.isEmpty()) throw new VacademyException(HttpStatus.NOT_FOUND, "Institute Not Found");

        instituteSettingService.updateCertificateSetting(institute.get(), request);
        return ResponseEntity.ok("Updated Successfully");
    }

    /**
     * Where the counter stands for a candidate numbering config.
     *
     * <p>Deliberately takes the values the admin is currently typing rather than
     * what is saved: the settings screen previews live, and a preview computed
     * from saved settings would show numbers the unsaved form is not going to
     * produce. Nothing is reserved — see
     * {@link CertificateNumberService#peekNextSequence}.
     */
    public ResponseEntity<CertificateNumberingStatusDto> getNumberingStatus(CustomUserDetails userDetails,
                                                                            String instituteId,
                                                                            Long startFrom,
                                                                            Boolean resetAnnually) {
        if (!instituteRepository.existsById(instituteId)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Institute Not Found");
        }

        CertificateNumberingDto candidate = CertificateNumberingDto.builder()
                .startFrom(startFrom)
                .resetAnnually(resetAnnually)
                .build();

        long highestIssued = certificateNumberService.highestIssuedSequence(instituteId, candidate);
        long next = certificateNumberService.peekNextSequence(instituteId, candidate);

        return ResponseEntity.ok(CertificateNumberingStatusDto.builder()
                .nextSequence(next)
                .highestIssuedSequence(highestIssued)
                .bucket(CertificateNumberService.bucketFor(candidate, Calendar.getInstance().get(Calendar.YEAR)))
                .startFromIgnored(startFrom != null && startFrom > 0 && startFrom <= highestIssued)
                .build());
    }
}
