import {
    User,
    GraduationCap,
    Phone,
    MapPin,
    Users,
    HandCoinsIcon,
    Tag,
    Folders,
    FileText,
    DownloadSimple,
} from '@phosphor-icons/react';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { buildOverviewData, OverviewDetailsType, OverviewFieldKey, OverviewSectionKey } from './overview';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudentCredentialsStore } from '@/stores/students/students-list/useStudentCredentialsStore';
import { useGetStudentDetails } from '@/services/get-student-details';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { StudentTable } from '@/types/student-table-types';
import { getFieldsForLocation, type FieldForLocation } from '@/lib/custom-fields/utils';
import { getCustomFieldSettingsFromCache } from '@/services/custom-field-settings';
import type { FieldGroup } from '@/services/custom-field-settings';
import { getPublicUrl } from '@/services/upload_file';
import { ProfileSectionCard, ProfileFieldRow, ProfileEmpty } from '../profile-ui';
import { ContactCallButton } from '@/components/shared/telephony/contact-call-button';
import { EditStudentDetails } from './EditStudentDetails';
import { EditLeadDetails } from './EditLeadDetails';
import { StudentAttribution } from '../student-attribution/student-attribution';
import { OverviewRemarks } from './overview-remarks';
import { OverviewOtherContacts } from './overview-other-contacts';

/**
 * Overview tab — intentionally simple: a clean stack of label/value section
 * cards (General Details, Contact Information, Location Details, Parent/Guardian's
 * Details, custom fields, Terms & Conditions) plus a single Edit Details action.
 * The richer dashboard widgets (needs-attention, stat tiles, continue-learning,
 * recent-activity) were removed in favour of this scannable, professional layout.
 */
export const StudentOverview = ({ isSubmissionTab }: { isSubmissionTab?: boolean }) => {
    const { t } = useTranslation('manageStudentsOverview');
    const { selectedStudent } = useStudentSidebar();

    const [overviewData, setOverviewData] = useState<OverviewDetailsType[] | null>(null);
    const [copiedField, setCopiedField] = useState<string>('');
    const [customFields, setCustomFields] = useState<FieldForLocation[]>([]);
    const [fieldGroups, setFieldGroups] = useState<FieldGroup[]>([]);
    const [tncFileUrl, setTncFileUrl] = useState<string | null>(null);
    const userId = isSubmissionTab ? selectedStudent?.id : selectedStudent?.user_id;
    const { data: studentDetails, isLoading, isError, error } = useGetStudentDetails(userId || '');

    const { getDetailsFromPackageSessionId, instituteDetails } = useInstituteDetailsStore();
    const { getCredentials } = useStudentCredentialsStore();
    const [password, setPassword] = useState(
        getCredentials(isSubmissionTab ? selectedStudent?.id || '' : selectedStudent?.user_id || '')
            ?.password || t('password.notFound')
    );

    // Load custom fields and groups for the side view. We gate on the "Learner's
    // List" toggle so a single switch hides a custom field consistently across the
    // side view, export, and import (all three read learnersList).
    useEffect(() => {
        // Get all fields visible in the Learner's List
        const fields = getFieldsForLocation("Learner's List");
        // Get the full settings to access groups
        const settings = getCustomFieldSettingsFromCache();

        if (settings) {
            // Single source of truth for these admin learner surfaces
            const visibilityKey = 'learnersList';

            // Filter groups that have at least one field visible in the Learner's List
            const visibleGroups = settings.fieldGroups.filter((group) => {
                return group.fields.some((field) => field.visibility[visibilityKey]);
            });

            // For each visible group, keep only the fields visible in the Learner's List
            const filteredGroups = visibleGroups.map((group) => ({
                ...group,
                fields: group.fields.filter((field) => field.visibility[visibilityKey]),
            }));

            // Get field IDs that are in groups
            const fieldIdsInGroups = new Set(
                filteredGroups.flatMap((group) => group.fields.map((f) => f.id))
            );

            // Filter out fields that are already in groups
            const individualFields = fields.filter((field) => !fieldIdsInGroups.has(field.id));

            setCustomFields(individualFields);
            setFieldGroups(filteredGroups);
        } else {
            setCustomFields(fields);
            setFieldGroups([]);
        }
    }, []);

    // Fetch signed TnC PDF URL when student changes
    useEffect(() => {
        setTncFileUrl(null);
        if (selectedStudent?.tnc_accepted && selectedStudent?.tnc_file_id) {
            getPublicUrl(selectedStudent.tnc_file_id).then((url) => {
                if (url) setTncFileUrl(url);
            });
        }
    }, [selectedStudent?.tnc_file_id]);

    // Copy function with feedback. `fieldKey` is the stable dispatch key used to
    // track which row shows the "copied" state; `displayLabel` is the translated
    // label shown in the toast message.
    const handleCopy = async (text: string, displayLabel: string, fieldKey: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldKey);
            toast.success(t('toast.copiedToClipboard', { field: displayLabel }));
            setTimeout(() => setCopiedField(''), 2000);
        } catch (error) {
            toast.error(t('toast.copyFailed', { field: displayLabel }));
        }
    };

    useEffect(() => {
        if (selectedStudent) {
            const credentials = getCredentials(
                isSubmissionTab ? selectedStudent.id : selectedStudent.user_id
            );
            setPassword(credentials?.password || t('password.notFound'));
        }
        // `t` is a dependency: it changes identity when the language switches, and
        // this effect bakes translated text into state, so without it the stored
        // string stays in the previous language.
    }, [selectedStudent, t]);

    useEffect(() => {
        const details = getDetailsFromPackageSessionId({
            packageSessionId: isSubmissionTab
                ? selectedStudent?.package_id || ''
                : selectedStudent?.package_session_id || '',
        });
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const student: StudentTable | null = {
            id: studentDetails?.id || selectedStudent?.id || '',
            username: studentDetails?.username || selectedStudent?.username || '',
            user_id: selectedStudent?.id || '',
            email: studentDetails?.email || selectedStudent?.email || '',
            full_name: studentDetails?.full_name || selectedStudent?.full_name || '',
            address_line: studentDetails?.address_line || selectedStudent?.address_line || '',
            region: studentDetails?.region || selectedStudent?.region || '',
            city: studentDetails?.city || selectedStudent?.city || '',
            pin_code: studentDetails?.pin_code || selectedStudent?.pin_code || '',
            mobile_number: studentDetails?.mobile_number || selectedStudent?.mobile_number || '',
            date_of_birth: studentDetails?.date_of_birth || selectedStudent?.date_of_birth || '',
            gender: studentDetails?.gender || selectedStudent?.gender || '',
            fathers_name: studentDetails?.fathers_name || selectedStudent?.fathers_name || '',
            mothers_name: studentDetails?.mothers_name || selectedStudent?.mothers_name || '',
            father_mobile_number: '',
            father_email: '',
            mother_mobile_number: '',
            mother_email: '',
            parents_mobile_number: studentDetails?.parents_mobile_number || selectedStudent?.parents_mobile_number || '',
            parents_email: studentDetails?.parents_email || selectedStudent?.parents_email || '',
            linked_institute_name: studentDetails?.linked_institute_name || selectedStudent?.linked_institute_name || '',
            created_at: studentDetails?.created_at || selectedStudent?.created_at || '',
            updated_at: studentDetails?.updated_at || selectedStudent?.updated_at || '',
            package_session_id: selectedStudent?.package_session_id || '',
            institute_enrollment_id: studentDetails?.institute_enrollment_id || selectedStudent?.institute_enrollment_id || '',
            institute_enrollment_number: studentDetails?.institute_enrollment_number || selectedStudent?.institute_enrollment_number || '',
            status: selectedStudent?.status || 'ACTIVE',
            session_expiry_days: selectedStudent?.session_expiry_days || 0,
            institute_id: selectedStudent?.institute_id || '',
            expiry_date: selectedStudent?.expiry_date || 0,
            face_file_id: studentDetails?.face_file_id || selectedStudent?.face_file_id || '',
            attempt_id: '',
            parents_to_mother_mobile_number: studentDetails?.parents_to_mother_mobile_number || selectedStudent?.parents_to_mother_mobile_number || '',
            parents_to_mother_email: studentDetails?.parents_to_mother_email || selectedStudent?.parents_to_mother_email || '',
            package_id: selectedStudent?.package_id || '',
            country: studentDetails?.country || selectedStudent?.country || '',
            attendance_percent: studentDetails?.attendance_percentage || studentDetails?.attendance_percent || selectedStudent?.attendance_percent || 0,
            referral_count: studentDetails?.referral_count || selectedStudent?.referral_count || 0,
            custom_fields: studentDetails?.custom_fields || selectedStudent?.custom_fields || {},
        };

        const learner = isSubmissionTab
            ? student
            : student
                ? { ...selectedStudent, ...student }
                : selectedStudent;
        setOverviewData(
            buildOverviewData(t, {
                selectedStudent: learner,
                packageSessionDetails: details,
                password: password,
            })
        );

    }, [selectedStudent, instituteDetails, password, studentDetails, t]);

    if (isLoading) {
        return <DashboardLoader />;
    }

    if (isError) {
        console.error(error);
        return <div>{t('errors.fetchStudentDetails')}</div>;
    }

    // Copy icon is intentionally limited to Mobile No. + Email Id only — every
    // other field (IDs, custom fields, address, etc.) shows no copy affordance.
    // Matched on overview.tsx's stable field keys, NOT the translated label, so
    // this keeps working in every locale.
    const COPYABLE_FIELD_KEYS = new Set<string>([OverviewFieldKey.MobileNo, OverviewFieldKey.EmailId]);

    // Click-to-call sits on the learner's OWN mobile row only. The guardian rows
    // are other people's numbers, and the backend dials the number on the
    // subject's record — offering a button there would silently dial the wrong
    // person. The button hides itself when the institute has no calling
    // configured, so this costs nothing for institutes that don't call.
    //
    // This sidebar is shared: Manage Students, the attendance tracker and an
    // assessment's participants all open it, and so do the lead surfaces. Leads
    // carry a `_response_id` and are usually not enrolled, so pass it through —
    // the backend then takes the lead path instead of the learner path.
    const leadResponseId = (selectedStudent as unknown as Record<string, unknown> | null)
        ?._response_id as string | undefined;

    // Enrolment-derived rows (Course / Level / Session) are intentionally hidden
    // from the Overview tab — they live on the Courses / enrolment surfaces.
    // Matched on the stable field keys so renamed/translated terms still filter.
    const HIDDEN_GENERAL_FIELD_KEYS = new Set<string>([
        OverviewFieldKey.Course,
        OverviewFieldKey.Level,
        OverviewFieldKey.Session,
    ]);

    // Section icon keyed by the section's stable key (the section order is
    // data-driven, so an index-based map would drift when toggles add/remove
    // sections, and the translated heading is locale-dependent).
    const SECTION_ICONS: Record<string, typeof User> = {
        [OverviewSectionKey.GeneralDetails]: GraduationCap,
        [OverviewSectionKey.ContactInformation]: Phone,
        [OverviewSectionKey.LocationDetails]: MapPin,
        [OverviewSectionKey.GuardianDetails]: Users,
        [OverviewSectionKey.ReferralDetails]: HandCoinsIcon,
    };

    return (
        <div className="flex flex-col gap-3 text-card-foreground">
            {/* Single primary action — edit the profile. This sidebar is shared between
                Manage Contacts (real students) and the lead surfaces, which feed it a
                lead mapped into StudentTable shape. A lead has no `student` row, so the
                learner-profile endpoint 404s for it; rows carrying a `_response_id`
                marker therefore get the lead-shaped editor instead. */}
            <div className="flex justify-end">
                {(selectedStudent as unknown as Record<string, unknown>)?._response_id ? (
                    <EditLeadDetails />
                ) : (
                    <EditStudentDetails />
                )}
            </div>

            {/* Remarks + Call — the academic-staff loop (call the learner, note the
                outcome) lives at the top so it is reachable without scrolling past
                the profile sections. */}
            <OverviewRemarks
                userId={userId}
                userName={selectedStudent?.full_name}
                phone={selectedStudent?.mobile_number || studentDetails?.mobile_number}
                leadResponseId={leadResponseId}
            />

            {/* Detail sections — clean label/value cards (General Details,
                Contact Information, Location Details, Parent/Guardian's Details, …).
                Account Credentials is intentionally skipped here; it lives on the
                Portal Access tab. */}
            {selectedStudent != null ? (
                overviewData?.map((studentDetail, key) => {
                    if (studentDetail.headingKey === OverviewSectionKey.AccountCredentials) return null;
                    const SectionIcon = SECTION_ICONS[studentDetail.headingKey] ?? User;
                    const rows = (studentDetail.content || []).filter(
                        (fieldRow) => !HIDDEN_GENERAL_FIELD_KEYS.has(fieldRow.key)
                    );
                    if (rows.length === 0) return null;

                    return (
                        <ProfileSectionCard
                            key={key}
                            icon={SectionIcon}
                            heading={studentDetail.heading}
                        >
                            <dl>
                                {rows.map((fieldRow, key2) => {
                                    const canCopy =
                                        COPYABLE_FIELD_KEYS.has(fieldRow.key) && !fieldRow.isEmpty;
                                    return (
                                        <ProfileFieldRow
                                            key={key2}
                                            label={fieldRow.label}
                                            value={fieldRow.value}
                                            copied={copiedField === fieldRow.key}
                                            onCopy={
                                                canCopy
                                                    ? () =>
                                                          handleCopy(
                                                              fieldRow.value,
                                                              fieldRow.label,
                                                              fieldRow.key
                                                          )
                                                    : undefined
                                            }
                                            action={
                                                fieldRow.key === OverviewFieldKey.MobileNo &&
                                                !fieldRow.isEmpty ? (
                                                    <ContactCallButton
                                                        userId={selectedStudent?.user_id}
                                                        responseId={leadResponseId}
                                                        phone={fieldRow.value}
                                                        name={selectedStudent?.full_name}
                                                    />
                                                ) : undefined
                                            }
                                        />
                                    );
                                })}
                            </dl>
                        </ProfileSectionCard>
                    );
                })
            ) : (
                <ProfileEmpty icon={User} title={t('empty.noOverviewData')} />
            )}

            {/* Other phones / emails this lead's person enquired with (leads only;
                renders nothing when there are none). */}
            {leadResponseId && (
                <OverviewOtherContacts
                    responseId={leadResponseId}
                    mainPhone={studentDetails?.mobile_number || selectedStudent?.mobile_number}
                    mainEmail={studentDetails?.email || selectedStudent?.email}
                    copiedField={copiedField}
                    onCopy={handleCopy}
                />
            )}

            {/* Custom field groups */}
            {fieldGroups.map((group) => (
                <ProfileSectionCard key={group.id} icon={Folders} heading={group.name}>
                    <dl>
                        {group.fields.map((field) => {
                            const value =
                                selectedStudent?.custom_fields?.[field.id] || t('fallback.notAvailable');
                            return (
                                <ProfileFieldRow
                                    key={field.id}
                                    label={field.name}
                                    value={value}
                                />
                            );
                        })}
                    </dl>
                </ProfileSectionCard>
            ))}

            {/* Individual custom fields */}
            {customFields.length > 0 && (
                <ProfileSectionCard icon={Tag} heading={t('sections.customFields')}>
                    <dl>
                        {customFields.map((field) => {
                            const value =
                                selectedStudent?.custom_fields?.[field.id] || t('fallback.notAvailable');
                            return (
                                <ProfileFieldRow
                                    key={field.id}
                                    label={field.name}
                                    value={value}
                                />
                            );
                        })}
                    </dl>
                </ProfileSectionCard>
            )}

            {/* Campaign source — renders only when this learner actually arrived
                on a tagged link; silent otherwise. */}
            <StudentAttribution
                userId={selectedStudent?.user_id}
                instituteId={instituteDetails?.id}
                email={selectedStudent?.email}
                mobileNumber={selectedStudent?.mobile_number}
            />

            {/* Terms & Conditions — always shown so admins can see signing status
                at a glance (Signed / Not Signed), with the signed date + PDF when
                available. */}
            <ProfileSectionCard icon={FileText} heading={t('sections.termsAndConditions')}>
                <dl>
                    <ProfileFieldRow
                        label={t('fields.status')}
                        value={
                            selectedStudent?.tnc_accepted ? (
                                <span className="inline-flex items-center rounded-full bg-success-50 px-2 py-0.5 text-caption font-semibold text-success-700 ring-1 ring-success-200">
                                    {t('status.signed')}
                                </span>
                            ) : (
                                <span className="inline-flex items-center rounded-full bg-warning-50 px-2 py-0.5 text-caption font-semibold text-warning-700 ring-1 ring-warning-200">
                                    {t('status.notSigned')}
                                </span>
                            )
                        }
                    />
                    {selectedStudent?.tnc_accepted && selectedStudent?.tnc_accepted_date && (
                        <ProfileFieldRow
                            label={t('fields.signedOn')}
                            value={new Date(
                                selectedStudent.tnc_accepted_date
                            ).toLocaleDateString()}
                        />
                    )}
                    {selectedStudent?.tnc_accepted && tncFileUrl && (
                        <ProfileFieldRow
                            label={t('fields.signedPdf')}
                            value={
                                <a
                                    href={tncFileUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-body font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                >
                                    <DownloadSimple className="size-3.5" />
                                    {t('actions.download')}
                                </a>
                            }
                        />
                    )}
                </dl>
            </ProfileSectionCard>
        </div>
    );
};
