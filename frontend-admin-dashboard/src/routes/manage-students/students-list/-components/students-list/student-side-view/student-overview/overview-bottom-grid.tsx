import { ClipboardText, Phone } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ProfileSectionCard, ProfileFieldRow } from '../profile-ui';
import { StudentTable } from '@/types/student-table-types';

/**
 * Overview Bottom Grid — the 2-column layout below Quick Actions per the
 * Vacademy design handoff.
 *
 * Phase A.2 ships the two data-driven cards we can fully populate today:
 *   Left  → Enrolment Details (Plan / Enrollment# / Session / Gender / School)
 *   Right → Contact (Mobile / Email with copy buttons)
 *
 * Continue Learning (left, with ProgressRing) and Recent Activity (right,
 * with lead timeline events) come in Phase A.3 once their react-query
 * loaders are wired in.
 *
 * Cards render only the rows with real values, and a card itself is hidden
 * when it has zero meaningful rows — never a wall of em-dashes.
 *
 * Responsive: 2-col on md+ screens, stacks to 1-col below md so the drawer
 * width settings (compact 640 / standard 780 / wide 960) all read well.
 */
interface CopyContext {
    onCopy: (value: string, label: string) => void;
    copiedField: string;
}

interface EnrolmentProps extends CopyContext {
    student: StudentTable | null;
    course?: string | null;
    level?: string | null;
    session?: string | null;
    plan?: string | null;
}

interface ContactProps extends CopyContext {
    student: StudentTable | null;
}

/**
 * Enrolment Details card — left column of the Overview 2-col grid in the
 * Vacademy design handoff. Hides itself when there are no meaningful rows.
 */
export const OverviewEnrolment = ({
    student,
    course,
    level,
    session,
    plan,
    onCopy,
    copiedField,
}: EnrolmentProps) => {
    const { t } = useTranslation('manageStudentsOverviewBottomGrid');

    if (!student) return null;

    const enrollmentNo = student.institute_enrollment_number;
    const gender = student.gender && student.gender.trim() !== '' ? student.gender : null;
    const school =
        student.linked_institute_name && student.linked_institute_name.trim() !== ''
            ? student.linked_institute_name
            : null;

    const planLine = plan || [course, level].filter(Boolean).join(' · ') || null;

    const rows: Array<{ label: string; value: string }> = [];
    if (planLine) rows.push({ label: t('enrolment.rows.plan'), value: planLine });
    if (enrollmentNo) rows.push({ label: t('enrolment.rows.enrollmentNo'), value: enrollmentNo });
    if (session) rows.push({ label: t('enrolment.rows.session'), value: session });
    if (gender) rows.push({ label: t('enrolment.rows.gender'), value: gender });
    if (school) rows.push({ label: t('enrolment.rows.school'), value: school });

    if (rows.length === 0) return null;

    return (
        <ProfileSectionCard icon={ClipboardText} heading={t('enrolment.heading')}>
            <dl className="divide-y divide-border">
                {rows.map((r) => (
                    <ProfileFieldRow
                        key={r.label}
                        label={r.label}
                        value={r.value}
                        copied={copiedField === r.label}
                        onCopy={() => onCopy(r.value, r.label)}
                    />
                ))}
            </dl>
        </ProfileSectionCard>
    );
};

/**
 * Contact card — right column of the Overview 2-col grid in the handoff.
 * Hides itself when neither phone nor email are set.
 */
export const OverviewContact = ({ student, onCopy, copiedField }: ContactProps) => {
    const { t } = useTranslation('manageStudentsOverviewBottomGrid');

    if (!student) return null;

    const mobile =
        student.mobile_number && student.mobile_number.trim() !== ''
            ? student.mobile_number
            : null;
    const email = student.email && student.email.trim() !== '' ? student.email : null;

    const rows: Array<{ label: string; value: string }> = [];
    if (mobile) rows.push({ label: t('contact.rows.mobileNo'), value: mobile });
    if (email) rows.push({ label: t('contact.rows.email'), value: email });

    if (rows.length === 0) return null;

    return (
        <ProfileSectionCard icon={Phone} heading={t('contact.heading')}>
            <dl className="divide-y divide-border">
                {rows.map((r) => (
                    <ProfileFieldRow
                        key={r.label}
                        label={r.label}
                        value={r.value}
                        copied={copiedField === r.label}
                        onCopy={() => onCopy(r.value, r.label)}
                    />
                ))}
            </dl>
        </ProfileSectionCard>
    );
};

/**
 * Back-compat wrapper — older callers can still mount the Enrolment + Contact
 * pair as a single 2-col grid. New callers should compose OverviewEnrolment
 * and OverviewContact individually inside the handoff's 4-card 2-col layout.
 */
export const OverviewBottomGrid = ({
    student,
    course,
    level,
    session,
    plan,
    onCopy,
    copiedField,
}: EnrolmentProps) => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <OverviewEnrolment
            student={student}
            course={course}
            level={level}
            session={session}
            plan={plan}
            onCopy={onCopy}
            copiedField={copiedField}
        />
        <OverviewContact student={student} onCopy={onCopy} copiedField={copiedField} />
    </div>
);
