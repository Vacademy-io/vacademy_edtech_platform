package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Batch-resolves member identities into Subjects (name/phone/email) once per cohort.
 * Learners resolve from the student table; leads from audience_response.parent_* fields
 * (the same contact source the campaign-send path uses). A lead that also has a user_id
 * (converted) prefers the student row and falls back to lead contact fields.
 *
 * <p>Synthesized "name+phone@vacademy.com" addresses (leads that came in without an email) are
 * treated as no email: the brain must not pick a channel nobody can receive, and a send to one
 * is dropped by notification-service anyway.
 */
@Service
@RequiredArgsConstructor
public class ContactResolver {

    private final EngagementReadDao dao;
    private final PlaceholderEmailService placeholderEmailService;

    public List<Subject> resolve(List<EngagementMember> members) {
        List<String> userIds = members.stream()
                .map(EngagementMember::getUserId).filter(Objects::nonNull).distinct().toList();
        List<String> leadIds = members.stream()
                .map(EngagementMember::getAudienceResponseId).filter(Objects::nonNull).distinct().toList();

        Map<String, String[]> students = dao.studentContactsByUserIds(userIds);
        Map<String, String[]> leads = dao.leadContactsByResponseIds(leadIds);

        List<Subject> subjects = new ArrayList<>(members.size());
        for (EngagementMember m : members) {
            String[] s = m.getUserId() != null ? students.get(m.getUserId()) : null;
            String[] l = m.getAudienceResponseId() != null ? leads.get(m.getAudienceResponseId()) : null;
            subjects.add(Subject.builder()
                    .memberId(m.getId())
                    .userId(m.getUserId())
                    .audienceResponseId(m.getAudienceResponseId())
                    .name(first(s, 0, l, 0))
                    .phone(first(s, 1, l, 1))
                    .email(first(realEmail(s), 2, realEmail(l), 2))
                    .build());
        }
        return subjects;
    }

    /** The contact row with a placeholder email blanked, so first() falls through to the other source. */
    private String[] realEmail(String[] row) {
        if (row == null || row[2] == null || !placeholderEmailService.isPlaceholder(row[2])) return row;
        return new String[]{row[0], row[1], null};
    }

    private static String first(String[] a, int ai, String[] b, int bi) {
        if (a != null && a[ai] != null && !a[ai].isBlank()) return a[ai];
        if (b != null && b[bi] != null && !b[bi].isBlank()) return b[bi];
        return null;
    }
}
