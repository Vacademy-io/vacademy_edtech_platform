package vacademy.io.assessment_service.features.assessment.omr.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.dto.batch_pending.EnrolledLearnerDto;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.omr.dto.OmrDtos;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetLayout;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentBatchRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient.EnrollmentNumberRow;

import java.util.*;
import java.util.regex.Pattern;

/**
 * Who sits an OMR assessment, and the roll number each of them bubbles.
 *
 * <p>The roll number is the learner's institute enrollment number (admin_core,
 * {@code student_session_institute_group_mapping.institute_enrollment_number}). A
 * learner enrolled in several batches may carry a different number in each; the one
 * on a batch this assessment was assigned to wins, and two different numbers there is
 * a conflict the admin has to fix before printing.
 *
 * <p>Matching pads every number with leading zeros to the grid width, so "123" on a
 * 6-digit grid is "000123". A student may fill a short number from the left or from
 * the right: blank columns at either end of what was read are dropped before padding
 * (see {@link #normalizeRead}).
 */
@Service
@RequiredArgsConstructor
public class OmrRollService {

    private static final List<String> ACTIVE = List.of("ACTIVE");
    private static final Pattern DIGITS = Pattern.compile("\\d+");

    private final AssessmentUserRegistrationRepository registrationRepository;
    private final AssessmentBatchRegistrationRepository batchRegistrationRepository;
    private final AdminCoreServiceClient adminCoreServiceClient;

    public record Participant(String userId, String registrationId, String name, String email, String batchId,
                              String enrollmentNumber) {
    }

    /** Everyone on the assessment, their roll numbers, and what is wrong with them. */
    public record RollIndex(List<Participant> participants, Map<String, Participant> byRoll, int rollDigits,
                            List<OmrDtos.RollIssueDto> issues) {

        public boolean ok() {
            return issues.isEmpty() && !participants.isEmpty();
        }

        public Optional<Participant> byUserId(String userId) {
            return participants.stream().filter(p -> p.userId().equals(userId)).findFirst();
        }
    }

    public RollIndex build(String assessmentId, String instituteId) {
        Map<String, Participant> byUser = new LinkedHashMap<>();
        for (AssessmentUserRegistration r : registrationRepository
                .findByInstituteIdAndAssessmentIdAndStatusIn(assessmentId, ACTIVE)) {
            if (r.getUserId() == null) continue;
            byUser.put(r.getUserId(), new Participant(r.getUserId(), r.getId(), r.getParticipantName(),
                    r.getUserEmail(), r.getSourceId(), null));
        }
        List<String> batchIds = batchRegistrationRepository
                .findBatchIdsByAssessmentAndInstitute(assessmentId, instituteId, ACTIVE);
        if (!batchIds.isEmpty()) {
            for (EnrolledLearnerDto l : adminCoreServiceClient.getEnrolledLearnersForBatches(instituteId, batchIds)) {
                if (l.getUserId() == null || byUser.containsKey(l.getUserId())) continue;
                byUser.put(l.getUserId(), new Participant(l.getUserId(), null, l.getFullName(), l.getEmail(),
                        l.getPackageSessionId(), null));
            }
        }

        Map<String, List<EnrollmentNumberRow>> rowsByUser = new HashMap<>();
        for (EnrollmentNumberRow row : adminCoreServiceClient.getEnrollmentNumbers(instituteId, new ArrayList<>(byUser.keySet()))) {
            if (row.userId() != null) rowsByUser.computeIfAbsent(row.userId(), k -> new ArrayList<>()).add(row);
        }
        Set<String> assessmentBatches = new HashSet<>(batchIds);

        List<OmrDtos.RollIssueDto> issues = new ArrayList<>();
        List<Participant> participants = new ArrayList<>();
        int digits = 0;
        for (Participant p : byUser.values()) {
            List<EnrollmentNumberRow> rows = rowsByUser.getOrDefault(p.userId(), List.of());
            Set<String> preferred = numbers(rows, r -> assessmentBatches.contains(r.packageSessionId())
                    || (p.batchId() != null && p.batchId().equals(r.packageSessionId())));
            Set<String> all = numbers(rows, r -> true);
            Set<String> candidates = preferred.isEmpty() ? all : preferred;

            String number = null;
            if (candidates.isEmpty()) {
                issues.add(issue("MISSING", p, null, "No enrollment number recorded"));
            } else if (candidates.size() > 1) {
                issues.add(issue("CONFLICTING", p, String.join(", ", candidates),
                        "Different enrollment numbers in different batches"));
            } else {
                number = candidates.iterator().next();
                if (!DIGITS.matcher(number).matches()) {
                    issues.add(issue("NOT_NUMERIC", p, number, "Only digits can be bubbled"));
                    number = null;
                } else if (number.length() > OmrSheetLayout.MAX_ROLL_DIGITS) {
                    issues.add(issue("TOO_LONG", p, number,
                            "At most " + OmrSheetLayout.MAX_ROLL_DIGITS + " digits fit on the sheet"));
                    number = null;
                } else {
                    digits = Math.max(digits, number.length());
                }
            }
            participants.add(new Participant(p.userId(), p.registrationId(), p.name(), p.email(), p.batchId(), number));
        }

        Map<String, Participant> byRoll = new HashMap<>();
        Map<String, List<Participant>> clashes = new LinkedHashMap<>();
        for (Participant p : participants) {
            if (p.enrollmentNumber() == null) continue;
            String key = pad(p.enrollmentNumber(), digits);
            Participant prior = byRoll.putIfAbsent(key, p);
            if (prior != null) {
                clashes.computeIfAbsent(key, k -> new ArrayList<>(List.of(prior))).add(p);
            }
        }
        for (Map.Entry<String, List<Participant>> e : clashes.entrySet()) {
            byRoll.remove(e.getKey());
            for (Participant p : e.getValue()) {
                issues.add(issue("DUPLICATE", p, p.enrollmentNumber(),
                        "Same roll number as " + e.getValue().stream().filter(o -> o != p)
                                .map(o -> o.name() == null ? o.userId() : o.name()).reduce((a, b) -> a + ", " + b).orElse("")));
            }
        }
        return new RollIndex(participants, byRoll, Math.max(digits, 1), issues);
    }

    public OmrDtos.RollCheckDto check(String assessmentId, String instituteId) {
        RollIndex index = build(assessmentId, instituteId);
        return OmrDtos.RollCheckDto.builder()
                .participantCount(index.participants().size())
                .rollDigits(index.rollDigits())
                .ok(index.ok())
                .issues(index.issues())
                .build();
    }

    /** Result of reading one sheet's roll grid. */
    public record ReadRoll(String key, String problem) {
    }

    /**
     * Turn what OMRChecker read in each roll column ("4", "" = blank, "47" = two
     * bubbles) into a lookup key padded to {@code digits}, or say why it cannot be one.
     */
    public static ReadRoll normalizeRead(List<String> columns, int digits) {
        List<String> cols = new ArrayList<>(columns);
        while (!cols.isEmpty() && cols.get(0).isEmpty()) cols.remove(0);
        while (!cols.isEmpty() && cols.get(cols.size() - 1).isEmpty()) cols.remove(cols.size() - 1);
        if (cols.isEmpty()) return new ReadRoll(null, "ROLL_BLANK");
        StringBuilder b = new StringBuilder();
        for (String c : cols) {
            if (c.isEmpty()) return new ReadRoll(null, "ROLL_BLANK");
            if (c.length() > 1) return new ReadRoll(null, "ROLL_MULTI");
            b.append(c);
        }
        return new ReadRoll(pad(b.toString(), digits), null);
    }

    /** As printed for a column: what was read, '?' for a blank and '*' for several bubbles. */
    public static String display(List<String> columns) {
        StringBuilder b = new StringBuilder();
        for (String c : columns) b.append(c.isEmpty() ? "?" : c.length() > 1 ? "*" : c);
        return b.toString();
    }

    static String pad(String number, int digits) {
        String n = number.trim();
        if (n.length() >= digits) return n;
        return "0".repeat(digits - n.length()) + n;
    }

    private static Set<String> numbers(List<EnrollmentNumberRow> rows, java.util.function.Predicate<EnrollmentNumberRow> keep) {
        Set<String> out = new LinkedHashSet<>();
        for (EnrollmentNumberRow r : rows) {
            if (keep.test(r) && StringUtils.hasText(r.instituteEnrollmentNumber())) {
                out.add(r.instituteEnrollmentNumber().trim());
            }
        }
        return out;
    }

    private static OmrDtos.RollIssueDto issue(String problem, Participant p, String number, String detail) {
        return OmrDtos.RollIssueDto.builder().problem(problem).userId(p.userId()).name(p.name())
                .enrollmentNumber(number).detail(detail).build();
    }
}
