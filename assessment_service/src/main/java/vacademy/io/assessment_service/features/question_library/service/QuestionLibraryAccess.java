package vacademy.io.assessment_service.features.question_library.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.common.exceptions.ForbiddenException;

/**
 * Who owns the Question Library.
 * <p>
 * There is one library for the whole platform. Its topics, papers and questions live under
 * one owner institute, set by question.library.owner-institute-id. That institute's staff
 * manage it; every other institute can only read it and copy from it. With the setting
 * empty the library is empty for everyone and nobody can write to it.
 */
@Component
public class QuestionLibraryAccess {

    @Value("${question.library.owner-institute-id:}")
    private String ownerInstituteId;

    /** The owner institute, or null when none is configured. */
    public String ownerInstituteId() {
        return ownerInstituteId == null || ownerInstituteId.isBlank() ? null : ownerInstituteId.trim();
    }

    public boolean isOwner(String instituteId) {
        String owner = ownerInstituteId();
        return owner != null && owner.equals(instituteId);
    }

    public void requireOwner(String instituteId) {
        if (!isOwner(instituteId)) {
            throw new ForbiddenException("The Question Library can only be changed by its owner");
        }
    }
}
