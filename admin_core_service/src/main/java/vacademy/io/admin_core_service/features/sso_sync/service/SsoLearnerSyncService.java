package vacademy.io.admin_core_service.features.sso_sync.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.sso_sync.dto.SsoLearnerSyncRequest;
import vacademy.io.admin_core_service.features.sso_sync.dto.SsoLearnerSyncResponse;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Keeps a single-sign-on learner's record and batches in step with their provider's groups.
 *
 * <p>Adds go through the same {@link StudentRegistrationManager#linkStudentToInstitute} an admin
 * enrolment uses (policies, re-enrolment, enrolment workflow). Removals mark the mapping
 * INACTIVE, exactly what "make inactive" does from the learner list, so progress is kept.
 * auth-service only ever asks to remove batches it granted itself.
 *
 * <p>Each batch is added in its own transaction: an enrolment policy that refuses one batch (or
 * a failed write inside it) must not roll back the learner record and the other batches.
 */
@Slf4j
@Service
public class SsoLearnerSyncService {

    private static final List<String> LIVE = List.of(LearnerSessionStatusEnum.ACTIVE.name());

    private final StudentRegistrationManager registrationManager;
    private final StudentSessionRepository studentSessionRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final TransactionTemplate perBatch;

    public SsoLearnerSyncService(StudentRegistrationManager registrationManager,
                                 StudentSessionRepository studentSessionRepository,
                                 PackageSessionRepository packageSessionRepository,
                                 PlatformTransactionManager transactionManager) {
        this.registrationManager = registrationManager;
        this.studentSessionRepository = studentSessionRepository;
        this.packageSessionRepository = packageSessionRepository;
        this.perBatch = new TransactionTemplate(transactionManager);
        this.perBatch.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public SsoLearnerSyncResponse sync(SsoLearnerSyncRequest request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId()) || !StringUtils.hasText(request.getUserId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id and user_id are required");
        }
        String instituteId = request.getInstituteId();
        UserDTO user = new UserDTO();
        user.setId(request.getUserId());
        user.setUsername(request.getUsername());
        user.setFullName(request.getFullName());
        user.setEmail(request.getEmail());
        user.setMobileNumber(request.getMobileNumber());
        Student student = registrationManager.createStudentFromRequest(user, null);

        Set<String> add = clean(request.getAddPackageSessionIds());
        Set<String> remove = clean(request.getRemovePackageSessionIds());
        remove.removeAll(add);
        Set<String> wanted = new LinkedHashSet<>(add);
        wanted.addAll(remove);
        Map<String, PackageSession> ours = wanted.isEmpty() ? Map.of()
                : packageSessionRepository.findPackageSessionsByInstituteIdAndIds(instituteId, new ArrayList<>(wanted))
                .stream().collect(Collectors.toMap(PackageSession::getId, Function.identity(), (a, b) -> a));

        List<String> added = new ArrayList<>();
        List<String> alreadyActive = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        for (String id : add) {
            PackageSession packageSession = ours.get(id);
            if (packageSession == null || Boolean.TRUE.equals(packageSession.getIsOrgAssociated())) {
                skipped.add(id);
                continue;
            }
            if (studentSessionRepository.findTopByPackageSessionIdAndUserIdAndStatusIn(id, instituteId,
                    request.getUserId(), LIVE).isPresent()) {
                alreadyActive.add(id);
                continue;
            }
            InstituteStudentDetails details = InstituteStudentDetails.builder()
                    .instituteId(instituteId)
                    .packageSessionId(id)
                    .enrollmentStatus(LearnerSessionStatusEnum.ACTIVE.name())
                    .enrollmentDate(new Date())
                    .build();
            try {
                perBatch.executeWithoutResult(status -> {
                    registrationManager.linkStudentToInstitute(student, details);
                    registrationManager.triggerEnrollmentWorkflow(instituteId, user, id, null);
                });
                added.add(id);
            } catch (RuntimeException e) {
                // An enrolment policy (re-enrolment gap, blocked while active elsewhere) said no,
                // or the write failed; that batch alone is rolled back.
                log.info("SSO sync: batch {} not added for user {}: {}", id, request.getUserId(), e.getMessage());
                skipped.add(id);
            }
        }

        List<String> removed = new ArrayList<>();
        List<String> removable = remove.stream().filter(ours::containsKey).toList();
        if (!removable.isEmpty()) {
            studentSessionRepository.updateStatusForPackageSessions(request.getUserId(), removable, instituteId,
                    LearnerSessionStatusEnum.INACTIVE.name());
            removed.addAll(removable);
        }
        remove.stream().filter(id -> !ours.containsKey(id)).forEach(skipped::add);

        log.info("SSO sync user={} institute={} added={} alreadyActive={} removed={} skipped={}",
                request.getUserId(), instituteId, added, alreadyActive, removed, skipped);
        return new SsoLearnerSyncResponse(student.getId(), added, alreadyActive, removed, skipped);
    }

    private static Set<String> clean(List<String> ids) {
        Set<String> out = new LinkedHashSet<>();
        if (ids != null) {
            for (String id : ids) {
                if (StringUtils.hasText(id)) {
                    out.add(id.trim());
                }
            }
        }
        return out;
    }
}
