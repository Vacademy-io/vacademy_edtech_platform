package vacademy.io.admin_core_service.features.institute.enums;

public enum CertificateTypeEnum {
    COURSE_COMPLETION,
    /**
     * Issued to a channel partner (sub-organisation) when its subscription becomes active —
     * a "Certificate of Affiliation" for the organisation, not a learner's course award.
     * Configured as its own entry (key SUB_ORG_AFFILIATION) in CERTIFICATE_SETTING; the
     * completion-percentage gate does not apply.
     */
    SUB_ORG_AFFILIATION
}
