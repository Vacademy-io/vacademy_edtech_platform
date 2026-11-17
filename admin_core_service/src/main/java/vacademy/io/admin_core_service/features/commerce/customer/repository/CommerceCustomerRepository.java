package vacademy.io.admin_core_service.features.commerce.customer.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;

import java.util.Date;
import java.util.Optional;

public interface CommerceCustomerRepository extends JpaRepository<CommerceCustomer, String> {

    Optional<CommerceCustomer> findByInstituteIdAndPhone(String instituteId, String phone);

    Optional<CommerceCustomer> findByIdAndInstituteId(String id, String instituteId);

    /** A row with the phone alone when the shop has not seen the phone; else nothing. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO commerce_customer (id, institute_id, phone)
            VALUES (:id, :instituteId, :phone)
            ON CONFLICT (institute_id, phone) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(@Param("id") String id, @Param("instituteId") String instituteId,
                       @Param("phone") String phone);

    /**
     * Creates the customer of a phone, or fills what an existing row lacks. One statement, so
     * two first orders of one phone at the same moment end with one row. Name, e-mail and user
     * are never overwritten: a later checkout that types another name changes its order only.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO commerce_customer (id, institute_id, user_id, phone, name, email)
            VALUES (:id, :instituteId, CAST(:userId AS VARCHAR), :phone, CAST(:name AS VARCHAR),
                    CAST(:email AS VARCHAR))
            ON CONFLICT (institute_id, phone) DO UPDATE
            SET user_id = COALESCE(commerce_customer.user_id, EXCLUDED.user_id),
                name = COALESCE(commerce_customer.name, EXCLUDED.name),
                email = COALESCE(commerce_customer.email, EXCLUDED.email),
                updated_at = CURRENT_TIMESTAMP
            """, nativeQuery = true)
    int upsert(@Param("id") String id, @Param("instituteId") String instituteId, @Param("userId") String userId,
               @Param("phone") String phone, @Param("name") String name, @Param("email") String email);

    /** What a shopper session is checked against, read fresh from the table. */
    interface SessionRow {
        String getId();

        String getPhone();

        Integer getSessionEpoch();

        Date getAnonymisedAt();
    }

    @Query(value = """
            SELECT c.id AS id, c.phone AS phone, c.session_epoch AS sessionEpoch, c.anonymised_at AS anonymisedAt
            FROM commerce_customer c WHERE c.id = :id AND c.institute_id = :instituteId
            """, nativeQuery = true)
    Optional<SessionRow> findSessionRow(@Param("id") String id, @Param("instituteId") String instituteId);

    @Query(value = """
            SELECT c.id AS id, c.phone AS phone, c.session_epoch AS sessionEpoch, c.anonymised_at AS anonymisedAt
            FROM commerce_customer c WHERE c.institute_id = :instituteId AND c.phone = :phone
            """, nativeQuery = true)
    Optional<SessionRow> findSessionRowByPhone(@Param("instituteId") String instituteId, @Param("phone") String phone);

    /** Ends every shopper session of this customer: one atomic increment. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE commerce_customer SET session_epoch = session_epoch + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND institute_id = :instituteId
            """, nativeQuery = true)
    int bumpSessionEpoch(@Param("id") String id, @Param("instituteId") String instituteId);

    // -- Cash on delivery (WP-31) --

    /**
     * The customer row of a phone, locked FOR UPDATE: its refusal count. Two COD orders of one
     * phone placed at the same moment queue here, so the limits read below are race-free.
     * Null when the shop has no row for the phone.
     */
    @Query(value = """
            SELECT c.cod_refusals FROM commerce_customer c
            WHERE c.institute_id = :instituteId AND c.phone = :phone
            FOR UPDATE
            """, nativeQuery = true)
    Integer lockCodRefusalsByPhone(@Param("instituteId") String instituteId, @Param("phone") String phone);

    /** The refusal count of a phone, not locked (the early check before the order transaction). */
    @Query(value = """
            SELECT c.cod_refusals FROM commerce_customer c
            WHERE c.institute_id = :instituteId AND c.phone = :phone
            """, nativeQuery = true)
    Integer findCodRefusalsByPhone(@Param("instituteId") String instituteId, @Param("phone") String phone);

    /**
     * Cash-on-delivery orders of a phone that are open and not paid: placed, confirmed, packed or
     * on their way. A delivered order waiting for the courier's money does not count.
     */
    @Query(value = """
            SELECT COUNT(*) FROM commerce_order o
            WHERE o.institute_id = :instituteId AND o.customer_phone = :phone
              AND o.payment_method = 'COD' AND o.payment_status = 'UNPAID'
              AND o.status IN ('COD_PENDING_CONFIRMATION', 'CONFIRMED', 'PACKED', 'SHIPPED')
            """, nativeQuery = true)
    long countOpenCodOrders(@Param("instituteId") String instituteId, @Param("phone") String phone);

    // -- Staff customer views (WP-34), read-only --

    /**
     * A customer as the staff list and profile show it, with what their orders add up to. Orders
     * still waiting for payment do not count; a cancelled order counts only when money was paid.
     * {@code dues} mirrors the DUES queue of the order desk (staff orders on credit); money a
     * courier still owes on a cash-on-delivery order is not a due.
     */
    interface StaffRow {
        String getId();

        String getName();

        String getPhone();

        String getEmail();

        Integer getCodRefusals();

        Boolean getMarketingConsent();

        Date getConsentAt();

        String getConsentSource();

        String getNotes();

        Date getAnonymisedAt();

        Date getCreatedAt();

        Long getOrdersCount();

        java.math.BigDecimal getTotalSpent();

        java.math.BigDecimal getDues();

        Date getLastOrderAt();
    }

    String STAFF_ROW = """
            SELECT c.id AS id, c.name AS name, c.phone AS phone, c.email AS email, c.cod_refusals AS codRefusals,
                   c.marketing_consent AS marketingConsent, c.consent_at AS consentAt,
                   c.consent_source AS consentSource, c.notes AS notes, c.anonymised_at AS anonymisedAt,
                   c.created_at AS createdAt,
                   COALESCE(a.orders_count, 0) AS ordersCount, COALESCE(a.total_spent, 0) AS totalSpent,
                   COALESCE(a.dues, 0) AS dues, a.last_order_at AS lastOrderAt
            FROM commerce_customer c
            LEFT JOIN LATERAL (
                SELECT COUNT(*) FILTER (WHERE o.status <> 'PENDING_PAYMENT'
                                          AND NOT (o.status = 'CANCELLED' AND o.amount_paid = 0)) AS orders_count,
                       SUM(o.amount_paid - o.amount_refunded) FILTER (WHERE o.status <> 'PENDING_PAYMENT') AS total_spent,
                       SUM(o.total - o.amount_paid) FILTER (WHERE o.channel = 'ADMIN'
                                          AND o.payment_status IN ('UNPAID', 'PARTIALLY_PAID')
                                          AND o.status NOT IN ('CANCELLED', 'RTO')) AS dues,
                       MAX(o.created_at) FILTER (WHERE o.status <> 'PENDING_PAYMENT') AS last_order_at
                FROM commerce_order o
                WHERE o.institute_id = c.institute_id AND o.customer_id = c.id) a ON TRUE
            """;

    /** The search of the staff list: an exact (normalised) phone or part of the name; both null = every customer. */
    String STAFF_FILTER = """
            c.institute_id = :instituteId
              AND (CAST(:phone AS VARCHAR) IS NULL AND CAST(:namePattern AS VARCHAR) IS NULL
                   OR c.phone = CAST(:phone AS VARCHAR)
                   OR LOWER(c.name) LIKE CAST(:namePattern AS VARCHAR))
            """;

    /** One page of the staff list: the latest buyers first, then the newest rows. */
    @Query(value = STAFF_ROW + " WHERE " + STAFF_FILTER
            + " ORDER BY a.last_order_at DESC NULLS LAST, c.created_at DESC, c.id LIMIT :limit OFFSET :offset",
            nativeQuery = true)
    java.util.List<StaffRow> staffSearch(@Param("instituteId") String instituteId, @Param("phone") String phone,
                                         @Param("namePattern") String namePattern, @Param("limit") int limit,
                                         @Param("offset") long offset);

    @Query(value = "SELECT COUNT(*) FROM commerce_customer c WHERE " + STAFF_FILTER, nativeQuery = true)
    long staffCount(@Param("instituteId") String instituteId, @Param("phone") String phone,
                    @Param("namePattern") String namePattern);

    /** One customer of the institute for the staff profile; empty for another institute's customer. */
    @Query(value = STAFF_ROW + " WHERE c.institute_id = :instituteId AND c.id = :id", nativeQuery = true)
    Optional<StaffRow> findStaffRow(@Param("instituteId") String instituteId, @Param("id") String id);
}
