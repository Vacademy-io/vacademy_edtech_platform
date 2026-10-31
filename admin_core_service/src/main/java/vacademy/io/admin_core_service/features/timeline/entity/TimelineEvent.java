package vacademy.io.admin_core_service.features.timeline.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;

import java.sql.Timestamp;

/**
 * Entity representing an event in a timeline for an enquiry, applicant, or
 * student.
 *
 * category = JOURNEY → automated lead-lifecycle events (status changes, submission, score updates).
 * category = ACTIVITY → manual admin interactions (notes, call logs, meetings).
 */
@Entity
@Table(name = "timeline_event")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TimelineEvent {

        @Id
        @UuidGenerator
        @Column(name = "id", nullable = false, unique = true)
        private String id;

        @Column(name = "type", nullable = false)
        private String type;

        @Column(name = "type_id", nullable = false)
        private String typeId;

        @Column(name = "action_type", nullable = false)
        private String actionType;

        @Column(name = "actor_type", nullable = false)
        private String actorType;

        @Column(name = "actor_id")
        private String actorId;

        @Column(name = "actor_name")
        private String actorName;

        @Column(name = "title", nullable = false)
        private String title;

        @Column(name = "description", columnDefinition = "TEXT")
        private String description;

        @JdbcTypeCode(SqlTypes.JSON)
        @Column(name = "metadata_json", columnDefinition = "jsonb")
        private String metadataJson;

        /** Whether this event/note is pinned to the top of the timeline */
        @Column(name = "is_pinned")
        @Builder.Default
        private Boolean isPinned = false;

        /** Student user ID for cross-stage note continuity (query all notes for a student regardless of stage) */
        @Column(name = "student_user_id")
        private String studentUserId;

        /**
         * Separates automated lifecycle events (JOURNEY) from manual admin interactions (ACTIVITY).
         * Defaults to ACTIVITY so all existing notes/calls rows are unaffected.
         */
        @Enumerated(EnumType.STRING)
        @Column(name = "category", nullable = false, length = 20)
        @Builder.Default
        private TimelineCategory category = TimelineCategory.ACTIVITY;

        /**
         * Institute the event belongs to. Reads made for an institute skip other institutes'
         * events; null (rows from before this column, or no institute known) shows everywhere.
         */
        @Column(name = "institute_id")
        private String instituteId;

        @Column(name = "created_at", insertable = false, updatable = false)
        private Timestamp createdAt;
}
