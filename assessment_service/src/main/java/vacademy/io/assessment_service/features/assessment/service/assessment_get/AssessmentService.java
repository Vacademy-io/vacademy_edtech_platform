package vacademy.io.assessment_service.features.assessment.service.assessment_get;

import org.hibernate.Session;
import org.hibernate.SessionFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentStatus;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

@Service
public class AssessmentService {

    @Autowired
    private SessionFactory sessionFactory;

    @Autowired
    private AssessmentRepository assessmentRepository;

    @Autowired
    private AssessmentInstituteMappingRepository assessmentInstituteMappingRepository;

    /**
     * NOTE: despite the name, this does NOT filter out deleted sections today.
     * <p>
     * The `activeSections` filter is enabled on a session opened here, while the query
     * below runs through the Spring-managed session — so the filter never applies.
     * (`Assessment.java` also declares the filter condition against an `active` column
     * that does not exist, with a parameter name that does not match `Section`'s
     * FilterDef, so enabling it correctly would produce invalid SQL.)
     * <p>
     * Deliberately left as-is: making the filter work would start excluding DELETED
     * sections from three endpoints that currently return them — a behaviour change
     * that needs its own pass. What IS fixed here is the session leak: the session was
     * opened on every call and never closed, leaking a Hibernate session and its JDBC
     * connection on three hot endpoints.
     */
    public Optional<Assessment> getAssessmentWithActiveSections(String assessmentId, String instituteId) {
        if (assessmentId == null) return Optional.empty();

        try (Session session = sessionFactory.openSession()) {
            session.enableFilter("activeSections").setParameter("status", "ACTIVE");
        }
        return assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId);
    }

    public ResponseEntity<String> deleteAssessment(CustomUserDetails user, String assessmentId, String instituteId) {
        Optional<AssessmentInstituteMapping> optionalAssessmentInstituteMapping = assessmentInstituteMappingRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId);
        if (optionalAssessmentInstituteMapping.isEmpty()) throw new VacademyException("Assessment Not Found");

        Assessment assessment = optionalAssessmentInstituteMapping.get().getAssessment();
        assessment.setStatus(AssessmentStatus.DELETED.name());
        assessmentRepository.save(assessment);

        return ResponseEntity.ok("Done");
    }

    public Optional<Assessment> getAssessmentFromId(String assessmentId) {
        return assessmentRepository.findById(assessmentId);
    }
}
