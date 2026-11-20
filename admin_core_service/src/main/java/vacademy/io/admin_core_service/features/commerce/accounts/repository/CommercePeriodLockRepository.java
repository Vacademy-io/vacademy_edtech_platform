package vacademy.io.admin_core_service.features.commerce.accounts.repository;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommercePeriodLock;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * The period lock row of an institute. Reads that decide anything are native and take a row lock,
 * so they answer the row as committed after any wait, never a copy held by the persistence context.
 */
public interface CommercePeriodLockRepository extends Repository<CommercePeriodLock, String> {

    /**
     * The lock date of a row (null = nothing closed). The queries select the id as well: a
     * one-column native result would be read as a bare value, and a null date would come back as a
     * null element instead of a row.
     */
    interface LockRow {
        LocalDate getLockedThrough();
    }

    /** The row under a share lock (posts); empty list = no row yet. Needs a transaction to hold the lock. */
    @Query(value = "SELECT id AS \"id\", locked_through AS \"lockedThrough\" FROM commerce_period_lock"
            + " WHERE institute_id = :instituteId FOR SHARE", nativeQuery = true)
    List<LockRow> readForShare(@Param("instituteId") String instituteId);

    /** The row as committed, without a lock (the unlock's first read, before its approval). */
    @Query(value = "SELECT id AS \"id\", locked_through AS \"lockedThrough\" FROM commerce_period_lock"
            + " WHERE institute_id = :instituteId", nativeQuery = true)
    List<LockRow> readPlain(@Param("instituteId") String instituteId);

    /** The row under an update lock (lock and unlock); waits for every post holding it FOR SHARE. */
    @Query(value = "SELECT id AS \"id\", locked_through AS \"lockedThrough\" FROM commerce_period_lock"
            + " WHERE institute_id = :instituteId FOR UPDATE", nativeQuery = true)
    List<LockRow> readForUpdate(@Param("instituteId") String instituteId);

    /** Creates the institute's row (nothing closed) unless it exists; answers 1 when created. */
    @Modifying
    @Query(value = "INSERT INTO commerce_period_lock (id, institute_id) VALUES (:id, :instituteId)"
            + " ON CONFLICT (institute_id) DO NOTHING", nativeQuery = true)
    int ensureRow(@Param("id") String id, @Param("instituteId") String instituteId);

    /** Sets the lock date ({@code lockedThrough} null = nothing closed); answers the rows changed. */
    @Modifying
    @Query(value = "UPDATE commerce_period_lock SET locked_through = CAST(:lockedThrough AS DATE),"
            + " locked_by = CAST(:userId AS VARCHAR), locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP"
            + " WHERE institute_id = :instituteId", nativeQuery = true)
    int setLockedThrough(@Param("instituteId") String instituteId, @Param("lockedThrough") LocalDate lockedThrough,
                         @Param("userId") String userId);

    /** Plain read for display; takes no lock. */
    Optional<CommercePeriodLock> findByInstituteId(String instituteId);
}
