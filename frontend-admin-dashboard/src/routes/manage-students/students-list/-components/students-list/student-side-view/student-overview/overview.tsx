import type { TFunction } from 'i18next';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getSystemFieldColumnVisibility } from '@/components/design-system/utils/constants/system-field-columns';
import { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import { StudentTable } from '@/types/student-table-types';

// Stable, untranslated dispatch keys — NEVER localize these. student-overview.tsx
// (namespace `manageStudentsOverview`) matches against these keys (copy-button
// eligibility, hidden-field filtering, section icon lookup) instead of the
// translated display label/heading, so the matching stays locale-independent.
export const OverviewSectionKey = {
    AccountCredentials: 'ACCOUNT_CREDENTIALS',
    GeneralDetails: 'GENERAL_DETAILS',
    LiveSession: 'LIVE_SESSION',
    ReferralDetails: 'REFERRAL_DETAILS',
    ContactInformation: 'CONTACT_INFORMATION',
    LocationDetails: 'LOCATION_DETAILS',
    GuardianDetails: 'GUARDIAN_DETAILS',
} as const;

export const OverviewFieldKey = {
    Course: 'COURSE',
    Level: 'LEVEL',
    Session: 'SESSION',
    EnrollmentNo: 'ENROLLMENT_NO',
    Gender: 'GENDER',
    School: 'SCHOOL',
    Country: 'COUNTRY',
    State: 'STATE',
    City: 'CITY',
    Pincode: 'PINCODE',
    Address: 'ADDRESS',
    MobileNo: 'MOBILE_NO',
    EmailId: 'EMAIL_ID',
    FatherName: 'FATHER_NAME',
    FatherMobileNo: 'FATHER_MOBILE_NO',
    FatherEmailId: 'FATHER_EMAIL_ID',
    MotherName: 'MOTHER_NAME',
    MotherMobileNo: 'MOTHER_MOBILE_NO',
    MotherEmailId: 'MOTHER_EMAIL_ID',
    Username: 'USERNAME',
    Password: 'PASSWORD',
    Attendance: 'ATTENDANCE',
    ReferralCount: 'REFERRAL_COUNT',
} as const;

export interface OverviewFieldRow {
    /** Stable, untranslated key — match on this, never on `label`. */
    key: string;
    /** Translated display label. */
    label: string;
    /** Translated display value (may be the localized "N/A" fallback). */
    value: string;
    /**
     * True when the underlying data was missing and `value` is the localized
     * fallback text. Consumers must check this flag instead of comparing
     * `value` against a hardcoded/English "N/A" string, since `value` is
     * locale-dependent.
     */
    isEmpty: boolean;
}

export interface OverviewDetailsType {
    /** Stable, untranslated key — match on this, never on `heading`. */
    headingKey: string;
    /** Translated display heading. */
    heading: string;
    content: OverviewFieldRow[];
}

export const buildOverviewData = (
    t: TFunction,
    {
        selectedStudent,
        packageSessionDetails,
        password,
    }: {
        selectedStudent: StudentTable | null;
        packageSessionDetails: BatchForSessionType | null;
        password: string;
    }
): OverviewDetailsType[] => {
    if (selectedStudent == null) return [];

    const na = (value: any) => (value ? value : t('fallback.notAvailable'));

    // Honor the system-field toggle (Settings → Custom Fields): a field turned off
    // is omitted here. Derived rows (Course/Level/Session), Address, Pincode and
    // Password have no toggle and always show. Sections with no visible rows drop.
    //
    // NOTE: student-overview.tsx skips the General Details + Contact Information
    // sections at render-time because the rich OverviewHeader / OverviewEnrolment
    // / OverviewContact cards already surface that data. The data shape produced
    // here is still used by other surfaces (legacy drawer, exports) so we keep
    // the full set per main's toggle-aware shape.
    const visibility = getSystemFieldColumnVisibility();
    const show = (accessor: string) => visibility[accessor] !== false;

    const row = (key: string, label: string, value: any): OverviewFieldRow => ({
        key,
        label,
        value: `${na(value)}`,
        isEmpty: !value,
    });

    const generalDetailsContent: OverviewFieldRow[] = [
        row(
            OverviewFieldKey.Course,
            getTerminology(ContentTerms.Course, SystemTerms.Course),
            packageSessionDetails?.package_dto.package_name
        ),
        row(
            OverviewFieldKey.Level,
            getTerminology(ContentTerms.Level, SystemTerms.Level),
            packageSessionDetails?.level.level_name
        ),
        row(
            OverviewFieldKey.Session,
            getTerminology(ContentTerms.Session, SystemTerms.Session),
            packageSessionDetails?.session.session_name
        ),
        ...(show('institute_enrollment_number')
            ? [
                  row(
                      OverviewFieldKey.EnrollmentNo,
                      t('fields.enrollmentNo'),
                      selectedStudent.institute_enrollment_number
                  ),
              ]
            : []),
        ...(show('gender') ? [row(OverviewFieldKey.Gender, t('fields.gender'), selectedStudent.gender)] : []),
        ...(show('linked_institute_name')
            ? [row(OverviewFieldKey.School, t('fields.school'), selectedStudent.linked_institute_name)]
            : []),
    ];

    const locationDetailsContent: OverviewFieldRow[] = [
        ...(show('country') ? [row(OverviewFieldKey.Country, t('fields.country'), selectedStudent.country)] : []),
        ...(show('region') ? [row(OverviewFieldKey.State, t('fields.state'), selectedStudent.region)] : []),
        ...(show('city') ? [row(OverviewFieldKey.City, t('fields.city'), selectedStudent.city)] : []),
        ...(show('pin_code') ? [row(OverviewFieldKey.Pincode, t('fields.pincode'), selectedStudent.pin_code)] : []),
        ...(show('address_line')
            ? [row(OverviewFieldKey.Address, t('fields.address'), selectedStudent.address_line)]
            : []),
    ];

    const contactContent: OverviewFieldRow[] = [
        ...(show('mobile_number')
            ? [row(OverviewFieldKey.MobileNo, t('fields.mobileNo'), selectedStudent.mobile_number)]
            : []),
        ...(show('email') ? [row(OverviewFieldKey.EmailId, t('fields.emailId'), selectedStudent.email)] : []),
    ];

    const guardianContent: OverviewFieldRow[] = [
        ...(show('fathers_name')
            ? [row(OverviewFieldKey.FatherName, t('fields.fatherName'), selectedStudent.fathers_name)]
            : []),
        ...(show('parents_mobile_number')
            ? [
                  row(
                      OverviewFieldKey.FatherMobileNo,
                      t('fields.fatherMobileNo'),
                      selectedStudent.parents_mobile_number
                  ),
              ]
            : []),
        ...(show('parents_email')
            ? [row(OverviewFieldKey.FatherEmailId, t('fields.fatherEmailId'), selectedStudent.parents_email)]
            : []),
        ...(show('mothers_name')
            ? [row(OverviewFieldKey.MotherName, t('fields.motherName'), selectedStudent.mothers_name)]
            : []),
        ...(show('parents_to_mother_mobile_number')
            ? [
                  row(
                      OverviewFieldKey.MotherMobileNo,
                      t('fields.motherMobileNo'),
                      selectedStudent.parents_to_mother_mobile_number
                  ),
              ]
            : []),
        ...(show('parents_to_mother_email')
            ? [
                  row(
                      OverviewFieldKey.MotherEmailId,
                      t('fields.motherEmailId'),
                      selectedStudent.parents_to_mother_email
                  ),
              ]
            : []),
    ];

    const overviewSections: OverviewDetailsType[] = [
        {
            headingKey: OverviewSectionKey.AccountCredentials,
            heading: t('sections.accountCredentials'),
            content: [
                ...(show('username')
                    ? [row(OverviewFieldKey.Username, t('fields.username'), selectedStudent.username)]
                    : []),
                {
                    key: OverviewFieldKey.Password,
                    label: t('fields.password'),
                    value: password,
                    isEmpty: !password,
                },
            ],
        },
        {
            headingKey: OverviewSectionKey.GeneralDetails,
            heading: t('sections.generalDetails'),
            content: generalDetailsContent,
        },
        // Live Session attendance is also surfaced as the Attendance stat
        // tile in OverviewHeader; the section here adds a row-style view for
        // surfaces that don't render the rich header (drawer, exports).
        // Both are gated by the system-field toggle per main's pattern.
        ...(show('attendance_percent')
            ? [
                  {
                      headingKey: OverviewSectionKey.LiveSession,
                      heading: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession),
                      content: [
                          row(OverviewFieldKey.Attendance, t('fields.attendance'), selectedStudent.attendance_percent),
                      ],
                  },
              ]
            : []),
        ...(show('referral_count')
            ? [
                  {
                      headingKey: OverviewSectionKey.ReferralDetails,
                      heading: t('sections.referralDetails'),
                      content: [
                          row(OverviewFieldKey.ReferralCount, t('fields.count'), selectedStudent.referral_count),
                      ],
                  },
              ]
            : []),
        {
            headingKey: OverviewSectionKey.ContactInformation,
            heading: t('sections.contactInformation'),
            content: contactContent,
        },
        {
            headingKey: OverviewSectionKey.LocationDetails,
            heading: t('sections.locationDetails'),
            content: locationDetailsContent,
        },
        {
            headingKey: OverviewSectionKey.GuardianDetails,
            heading: t('sections.guardianDetails'),
            content: guardianContent,
        },
    ];

    // Drop sections whose rows were all toggled off.
    return overviewSections.filter((section) => section.content.length > 0);
};
