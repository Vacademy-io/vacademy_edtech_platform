package vacademy.io.admin_core_service.features.access_pass.enums;

/** Value sets of the access_pass tables (stored as strings). */
public final class AccessPassEnums {

    private AccessPassEnums() {
    }

    public enum AccessPassStatus {
        /** Being set up: not listed, invite INACTIVE. */
        DRAFT,
        /** Listed and purchasable. */
        ACTIVE,
        /** No new buyers; current holders keep access until their plan ends. */
        ARCHIVED,
        DELETED
    }

    public enum AudienceType {
        /** Sold to learners through the catalogue and the pass invite. */
        B2C,
        /** Held by sub-orgs; the pass's courses are pushed to each linked sub-org. */
        B2B
    }

    public enum CourseScope {
        /** The courses an admin picked. */
        SELECTED,
        /** Every live course batch of the institute, kept current by the sync job. */
        ALL_COURSES
    }

    public enum SubOrgLinkStatus {
        ACTIVE, REMOVED
    }

    public enum ItemStatus {
        ACTIVE, REMOVED
    }

    public enum ItemRemovalPolicy {
        /** Current holders keep a removed course until their plan ends. */
        KEEP_FOR_EXISTING,
        /** The next sync deactivates the course for holders the pass granted it to. */
        REVOKE
    }

    public enum GrantType {
        /** The access row carries the holder's plan: the pass owns it. */
        GRANTED,
        /** Held through another plan: the pass leaves it alone. */
        COVERED
    }

    public enum GrantStatus {
        ACTIVE, REVOKED
    }
}
