package vacademy.io.admin_core_service.features.live_session.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/**
 * An instructor / presenter of a live session (V524).
 *
 * <p>Separate from {@link LiveSessionParticipants} on purpose — that table is
 * the <b>learner audience</b> and is read by every learner list, the
 * notification fan-out and the guest/paid join gates, all of which filter on
 * {@code source_type = 'USER'}. Staff added there would have leaked into all of
 * them.
 *
 * <p><b>Absence is meaningful.</b> A session with no ACTIVE row here is not an
 * instructor-less session: it falls back to {@code live_session.created_by_user_id}.
 * That is what lets every session created before V524 keep working without a
 * backfill. Anything reading instructors must go through
 * {@code LiveSessionInstructorService}, which applies that fallback, rather than
 * querying this table directly.
 */
@Entity
@Table(name = "live_session_instructors")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LiveSessionInstructor {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "session_id", nullable = false)
    private String sessionId;

    /** The instructor's user id (auth_service owns the user record). */
    @Column(name = "user_id", nullable = false)
    private String userId;

    /**
     * ACTIVE | DELETED. Removal is a soft delete so the (session_id, user_id)
     * unique index survives a remove-then-re-add.
     */
    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
