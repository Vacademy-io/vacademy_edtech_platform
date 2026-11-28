import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Registration } from '../../-types/registration-types';

interface ApplicationFormPrintTemplateProps {
    formData: Partial<Registration>;
    instituteName: string;
    instituteLogo: string;
    trackingLabel: string;
    trackingId: string;
}

const THEME = {
    primary: 'hsl(var(--info-700))',
    primaryLight: 'hsl(var(--info-600))',
    border: 'hsl(var(--border))',
    headerBg: 'hsl(var(--info-50))',
    labelColor: 'hsl(var(--muted-foreground))',
    valueColor: 'hsl(var(--foreground))',
};

function SectionHeader({ title }: { title: string }) {
    return (
        <div
            style={{
                background: THEME.primary,
                color: 'white',
                padding: '4px 12px',
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                marginTop: '8px',
                borderRadius: '3px',
            }}
        >
            {title}
        </div>
    );
}

function FieldRow({
    fields,
    minHeight,
}: {
    fields: { label: string; value: string }[];
    minHeight?: string;
}) {
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${fields.length}, 1fr)`,
                borderLeft: `1px solid ${THEME.border}`,
                borderRight: `1px solid ${THEME.border}`,
                borderBottom: `1px solid ${THEME.border}`,
            }}
        >
            {fields.map((field, idx) => (
                <div
                    key={idx}
                    style={{
                        padding: '4px 10px',
                        borderRight: idx < fields.length - 1 ? `1px solid ${THEME.border}` : 'none',
                        minHeight: minHeight || '24px',
                    }}
                >
                    <div
                        style={{
                            fontSize: '7px',
                            color: 'hsl(var(--muted-foreground))',
                            textTransform: 'uppercase',
                            letterSpacing: '0.6px',
                            marginBottom: '1px',
                            fontWeight: 400,
                        }}
                    >
                        {field.label}
                    </div>
                    <div
                        style={{
                            fontSize: '10.5px',
                            color: THEME.valueColor,
                            fontWeight: 700,
                            minHeight: '12px',
                        }}
                    >
                        {field.value || '\u00A0'}
                    </div>
                </div>
            ))}
        </div>
    );
}

const ApplicationFormPrintTemplate = React.forwardRef<
    HTMLDivElement,
    ApplicationFormPrintTemplateProps
>(({ formData, instituteName, instituteLogo, trackingLabel, trackingId }, ref) => {
    const { t } = useTranslation('admissionsApplicationFormPrintTemplate');
    const today = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '';
        try {
            return new Date(dateStr).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
            });
        } catch {
            return dateStr;
        }
    };

    const formatAddress = (addr?: Registration['currentAddress']) => {
        if (!addr) return '';
        return [addr.houseNo, addr.street, addr.area, addr.landmark, addr.city, addr.state, addr.pinCode || addr.pincode]
            .filter(Boolean)
            .join(', ');
    };

    return (
        <div
            ref={ref}
            style={{
                width: '210mm',
                minHeight: '297mm',
                padding: '12mm 14mm 10mm 14mm',
                fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
                color: THEME.valueColor,
                background: 'white',
                boxSizing: 'border-box',
                lineHeight: 1.3,
            }}
        >
            {/* ── Header ── */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    borderBottom: `3px solid ${THEME.primary}`,
                    paddingBottom: '8px',
                    marginBottom: '2px',
                }}
            >
                {instituteLogo && instituteLogo.startsWith('data:') && (
                    <img
                        src={instituteLogo}
                        alt={t('header.instituteLogoAlt')}
                        style={{
                            width: '48px',
                            height: '48px',
                            objectFit: 'contain',
                            marginRight: '12px',
                            borderRadius: '4px',
                        }}
                    />
                )}
                <div style={{ flex: 1 }}>
                    <div
                        style={{
                            fontSize: '16px',
                            fontWeight: 800,
                            color: THEME.primary,
                            letterSpacing: '0.5px',
                        }}
                    >
                        {instituteName || t('header.institutePlaceholder')}
                    </div>
                    <div
                        style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: THEME.primaryLight,
                            marginTop: '1px',
                            letterSpacing: '1.5px',
                            textTransform: 'uppercase',
                        }}
                    >
                        {t('header.applicationFormTitle')}
                    </div>
                    <div style={{ fontSize: '8px', color: THEME.labelColor, marginTop: '4px' }}>
                        <span>
                            {trackingLabel && trackingId && (
                                <>
                                    <strong>{trackingLabel}:</strong> {trackingId}
                                </>
                            )}
                        </span>
                        <span style={{ marginLeft: '16px' }}>
                            <strong>{t('header.dateLabel')}</strong> {today}
                        </span>
                        {formData.academicYear && (
                            <span style={{ marginLeft: '16px' }}>
                                <strong>{t('header.academicYearLabel')}</strong> {formData.academicYear}
                            </span>
                        )}
                    </div>
                </div>
                {/* Photo placeholder */}
                <div
                    style={{
                        width: '80px',
                        height: '100px',
                        border: `1.5px dashed ${THEME.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '8px',
                        color: 'hsl(var(--muted-foreground))',
                        borderRadius: '3px',
                        flexShrink: 0,
                    }}
                >
                    {t('header.pastePhoto')}
                </div>
            </div>

            {/* ── Section 1: Student Details ── */}
            <SectionHeader title={t('sections.studentDetails')} />
            <FieldRow
                fields={[
                    {
                        label: t('fields.fullNameBirthCertificate'),
                        value: formData.studentName || '',
                    },
                    { label: t('fields.dateOfBirth'), value: formatDate(formData.dateOfBirth) },
                    { label: t('fields.gender'), value: formData.gender || '' },
                ]}
            />
            <FieldRow
                fields={[
                    { label: t('fields.nationality'), value: formData.nationality || '' },
                    { label: t('fields.religion'), value: formData.religion || '' },
                    { label: t('fields.category'), value: formData.category || '' },
                ]}
            />
            <FieldRow
                fields={[
                    { label: t('fields.bloodGroup'), value: formData.bloodGroup || '' },
                    { label: t('fields.motherTongue'), value: formData.motherTongue || '' },
                    {
                        label: t('fields.languagesKnown'),
                        value: formData.languagesKnown?.filter(Boolean).join(', ') || '',
                    },
                ]}
            />
            <FieldRow
                fields={[
                    { label: t('fields.idType'), value: formData.idType || '' },
                    { label: t('fields.idNumber'), value: formData.idNumber || '' },
                    { label: '', value: '' },
                ]}
            />

            {/* ── Health Information ── */}
            <SectionHeader title={t('sections.healthInformation')} />
            <FieldRow
                fields={[
                    {
                        label: t('fields.medicalConditions'),
                        value: formData.medicalConditions || '',
                    },
                    {
                        label: t('fields.dietaryRestrictions'),
                        value: formData.dietaryRestrictions || '',
                    },
                ]}
                minHeight="36px"
            />
            <FieldRow
                fields={[
                    {
                        label: t('fields.specialEducationNeeds'),
                        value: formData.hasSpecialNeeds ? t('values.yes') : t('values.no'),
                    },
                    {
                        label: t('fields.physicallyChallenged'),
                        value: formData.isPhysicallyChallenged ? t('values.yes') : t('values.no'),
                    },
                    { label: '', value: '' },
                ]}
            />

            {/* ── Section 2: Academic Information ── */}
            <SectionHeader title={t('sections.academicInformation')} />
            <FieldRow
                fields={[
                    { label: t('fields.applyingForClass'), value: formData.applyingForClass || '' },
                    { label: t('fields.preferredBoard'), value: formData.preferredBoard || '' },
                    { label: t('fields.academicYear'), value: formData.academicYear || '' },
                ]}
            />
            <FieldRow
                fields={[
                    { label: t('fields.previousSchoolName'), value: formData.previousSchoolName || '' },
                    { label: t('fields.previousSchoolBoard'), value: formData.previousSchoolBoard || '' },
                    { label: t('fields.lastClassAttended'), value: formData.lastClassAttended || '' },
                ]}
            />
            <FieldRow
                fields={[
                    { label: t('fields.lastExamResult'), value: formData.lastExamResult || '' },
                    {
                        label: t('fields.subjectsStudied'),
                        value: formData.subjectsStudied || '',
                    },
                    { label: '', value: '' },
                ]}
            />
            <FieldRow
                fields={[
                    { label: t('fields.tcNumber'), value: formData.tcNumber || '' },
                    { label: t('fields.tcIssueDate'), value: formatDate(formData.tcIssueDate) },
                    {
                        label: t('fields.tcPending'),
                        value: formData.tcPending ? t('values.yes') : t('values.no'),
                    },
                ]}
            />

            {/* ── Section 3: Father's Details ── */}
            <SectionHeader title={t('sections.fathersDetails')} />
            <FieldRow
                fields={[
                    { label: t('fields.name'), value: formData.fatherInfo?.name || '' },
                    { label: t('fields.mobile'), value: formData.fatherInfo?.mobile || '' },
                    { label: t('fields.email'), value: formData.fatherInfo?.email || '' },
                ]}
            />
            <FieldRow
                fields={[
                    { label: t('fields.qualification'), value: formData.fatherInfo?.qualification || '' },
                    { label: t('fields.occupation'), value: formData.fatherInfo?.occupation || '' },
                    { label: t('fields.annualIncome'), value: formData.fatherInfo?.annualIncome || '' },
                ]}
            />

            {/* ── Section 4: Mother's Details ── */}
            <SectionHeader title={t('sections.mothersDetails')} />
            <FieldRow
                fields={[
                    { label: t('fields.name'), value: formData.motherInfo?.name || '' },
                    { label: t('fields.mobile'), value: formData.motherInfo?.mobile || '' },
                    { label: t('fields.email'), value: formData.motherInfo?.email || '' },
                ]}
            />
            <FieldRow
                fields={[
                    { label: t('fields.qualification'), value: formData.motherInfo?.qualification || '' },
                    { label: t('fields.occupation'), value: formData.motherInfo?.occupation || '' },
                    { label: t('fields.annualIncome'), value: formData.motherInfo?.annualIncome || '' },
                ]}
            />

            {/* ── Section 5: Guardian Details (if present) ── */}
            {formData.guardianInfo && (
                <>
                    <SectionHeader title={t('sections.guardianDetails')} />
                    <FieldRow
                        fields={[
                            { label: t('fields.name'), value: formData.guardianInfo.name || '' },
                            { label: t('fields.relation'), value: formData.guardianInfo.relation || '' },
                            { label: t('fields.mobile'), value: formData.guardianInfo.mobile || '' },
                        ]}
                    />
                </>
            )}

            {/* ── Section 6: Emergency Contact ── */}
            {formData.emergencyContact && (
                <>
                    <SectionHeader title={t('sections.emergencyContact')} />
                    <FieldRow
                        fields={[
                            { label: t('fields.name'), value: formData.emergencyContact.name || '' },
                            {
                                label: t('fields.relationship'),
                                value: formData.emergencyContact.relationship || '',
                            },
                            { label: t('fields.mobile'), value: formData.emergencyContact.mobile || '' },
                        ]}
                    />
                </>
            )}

            {/* ── Section 7: Address Details ── */}
            <SectionHeader title={t('sections.addressDetails')} />
            <FieldRow
                fields={[
                    {
                        label: t('fields.currentAddress'),
                        value: formatAddress(formData.currentAddress),
                    },
                ]}
                minHeight="44px"
            />
            <FieldRow
                fields={[
                    {
                        label: t('fields.permanentAddress'),
                        value: formData.sameAsCurrentAddress
                            ? t('fields.sameAsCurrentAddress')
                            : formatAddress(formData.permanentAddress),
                    },
                ]}
                minHeight="44px"
            />

            {/* ── Declaration + Signatures (kept together) ── */}
            <div style={{ pageBreakInside: 'avoid' }}>
                <div
                    style={{
                        marginTop: '12px',
                        padding: '8px 12px',
                        border: `1px solid ${THEME.border}`,
                        borderRadius: '3px',
                        background: THEME.headerBg,
                    }}
                >
                    <div
                        style={{
                            fontSize: '8px',
                            fontWeight: 700,
                            color: THEME.primary,
                            marginBottom: '3px',
                            textTransform: 'uppercase',
                        }}
                    >
                        {t('declaration.title')}
                    </div>
                    <div style={{ fontSize: '8px', color: THEME.labelColor, lineHeight: 1.4 }}>
                        {t('declaration.text')}
                    </div>
                </div>

                {/* ── Signatures ── */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '40px',
                        marginTop: '36px',
                    }}
                >
                    {(['roleParentGuardian', 'roleStudent', 'rolePrincipal'] as const).map(
                        (roleKey) => (
                            <div key={roleKey} style={{ textAlign: 'center' }}>
                                <div
                                    style={{
                                        borderTop: `1.5px solid ${THEME.primary}`,
                                        paddingTop: '5px',
                                        fontSize: '8.5px',
                                        fontWeight: 600,
                                        color: THEME.primary,
                                        letterSpacing: '0.5px',
                                    }}
                                >
                                    {t('signature.label', { role: t(`signature.${roleKey}`) })}
                                </div>
                            </div>
                        )
                    )}
                </div>

                {/* ── Footer ── */}
                <div
                    style={{
                        marginTop: '14px',
                        textAlign: 'center',
                        fontSize: '7px',
                        color: 'hsl(var(--muted-foreground))',
                        borderTop: `1px solid ${THEME.border}`,
                        paddingTop: '4px',
                    }}
                >
                    {t('footer.generatedOn', { date: today })}
                </div>
            </div>
        </div>
    );
});

ApplicationFormPrintTemplate.displayName = 'ApplicationFormPrintTemplate';

export default ApplicationFormPrintTemplate;
