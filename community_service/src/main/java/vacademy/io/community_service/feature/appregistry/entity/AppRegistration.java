package vacademy.io.community_service.feature.appregistry.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.util.Date;

/**
 * One white-label application tracked by the App Registration &amp; Store Management module.
 *
 * <p>The whole client-side {@code AppRecord} is kept verbatim in {@link #payload} as jsonb rather
 * than normalised into a dozen child tables. That is deliberate: the record's shape is driven by
 * the platform-requirements catalogue, which changes every time Google, Apple or Microsoft move a
 * goalpost. Normalising it would mean a schema change per store policy update, for data that is
 * only ever read and written as a whole document.
 *
 * <p>The scalar columns beside it are the fields that are stable identity/search keys, denormalised
 * so listing and searching stay index-friendly. Note what is deliberately absent: no rolled-up
 * status column. That rollup is business logic the dashboard already owns, and duplicating it here
 * would only create two versions that drift apart.
 */
@Entity
@Table(name = "app_registration", schema = "public",
        indexes = {
                @Index(name = "idx_app_registration_package", columnList = "package_name"),
                @Index(name = "idx_app_registration_archived", columnList = "archived"),
                @Index(name = "idx_app_registration_institute", columnList = "institute_id")
        })
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(of = "id")
public class AppRegistration {

    /** Client-generated UUID; the dashboard owns app identity so records survive export/import. */
    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "name")
    private String name;

    @Column(name = "client_name")
    private String clientName;

    @Column(name = "package_name")
    private String packageName;

    /**
     * Owning institute, denormalised out of {@link #payload} the same way {@link #packageName} is —
     * nullable, because apps registered before this field existed (and any ops-only tooling app with
     * no single owning institute) have none. A null institute_id simply never matches an institute
     * filter; it is not an error state.
     */
    @Column(name = "institute_id")
    private String instituteId;

    @Column(name = "archived", nullable = false)
    private Boolean archived;

    /** The complete AppRecord document as sent by the dashboard. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", columnDefinition = "jsonb", nullable = false)
    private String payload;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
