package vacademy.io.notification_service.features.announcements.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus;

import java.time.LocalDateTime;
import java.util.List;

@Entity
@Table(name = "announcements")
@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
public class Announcement {
    @UuidGenerator
    @Id
    private String id;
    
    @Column(nullable = false, length = 500)
    private String title;
    
    @Column(name = "rich_text_id", nullable = false)
    private String richTextId;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "rich_text_id", insertable = false, updatable = false)
    private RichTextData richTextData;
    
    @Column(name = "institute_id", nullable = false)
    private String instituteId;
    
    @Column(name = "created_by", nullable = false)
    private String createdBy;
    
    @Column(name = "created_by_name")
    private String createdByName;
    
    @Column(name = "created_by_role", length = 100)
    private String createdByRole;
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AnnouncementStatus status = AnnouncementStatus.ACTIVE;
    
    @Column(nullable = false)
    private String timezone = "UTC";

    /**
     * What this announcement is ABOUT, so it can be found again later — e.g. a
     * lead-assignment alert that has to be cleared once the counsellor works the
     * lead. The columns have existed since the table was created and were never
     * written; nothing else reads them, so leaving them null stays valid.
     */
    @Column(name = "entity")
    private String entity;

    @Column(name = "entity_id")
    private String entityId;
    
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
    
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt = LocalDateTime.now();
    
    // Relationships
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementRecipient> recipients;
    
    // Mode-specific relationships
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementSystemAlert> systemAlerts;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementDashboardPin> dashboardPins;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementDM> directMessages;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementStream> streams;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementResource> resources;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementCommunity> communityPosts;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementTask> tasks;

    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementAppOverlay> appOverlays;

    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<AnnouncementMedium> mediums;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<ScheduledMessage> scheduledMessages;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<RecipientMessage> recipientMessages;
    
    @OneToMany(mappedBy = "announcement", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<MessageReply> replies;
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}