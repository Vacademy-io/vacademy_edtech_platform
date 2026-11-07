package vacademy.io.assessment_service.features.assessment.enums;

public enum UserRegistrationSources {
    ADMIN_PRE_REGISTRATION, BATCH_PREVIEW_REGISTRATION, OPEN_REGISTRATION,
    /**
     * A copy uploaded to a bulk AI check without mapping it to a student. Not a
     * participant: every participant list filters on one of the sources above,
     * and the attempt carries {@code COPY_CHECK} so stats and releases skip it.
     */
    COPY_CHECK_ONLY
}
