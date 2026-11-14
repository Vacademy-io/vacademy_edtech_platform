package vacademy.io.admin_core_service.features.notification.enums;

public enum NotificationSourceType {
    BATCH("batch"),
    PACKAGE("package"),
    USER("user"),
    INSTITUTE("institute"),
    COURSE("course"),
    SESSION("session"),
    AUDIENCE("audience"),
    APPLICATION_STAGE("application_stage"),
    /** A single assessment: overrides the institute binding for that assessment only. */
    ASSESSMENT("assessment");

    private final String value;

    NotificationSourceType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
