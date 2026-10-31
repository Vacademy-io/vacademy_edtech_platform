import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AdmissionFormData } from './AdmissionFormWizard';

interface AdmissionFormPrintTemplateProps {
    formData: AdmissionFormData;
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

const AdmissionFormPrintTemplate = React.forwardRef<HTMLDivElement, AdmissionFormPrintTemplateProps>(
    ({ formData, instituteName, instituteLogo, trackingLabel, trackingId }, ref) => {
        const { t } = useTranslation('admissionsAdmissionFormPrintTemplate');
        const today = new Date().toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });

        const formatDate = (dateStr: string) => {
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
                            alt={t('instituteLogoAlt')}
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
                            {instituteName || t('instituteNameFallback')}
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
                            {t('formTitle')}
                        </div>
                        <div style={{ fontSize: '8px', color: THEME.labelColor, marginTop: '4px' }}>
                            {trackingLabel && trackingId && (
                                <span><strong>{trackingLabel}:</strong> {trackingId}</span>
                            )}
                            <span style={{ marginLeft: '16px' }}><strong>{t('date')}:</strong> {today}</span>
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
                        {t('pastePhoto')}
                    </div>
                </div>

                {/* ── Section 1: Student Details ── */}
                <SectionHeader title={t('sections.studentDetails')} />
                <FieldRow
                    fields={[
                        { label: t('fields.firstName'), value: formData.studentFirstName },
                        { label: t('fields.middleName'), value: formData.studentMiddleName },
                        { label: t('fields.lastName'), value: formData.studentLastName },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.gender'), value: formData.gender },
                        { label: t('fields.dateOfBirth'), value: formatDate(formData.dateOfBirth) },
                        { label: t('fields.dateOfAdmission'), value: formatDate(formData.dateOfAdmission) },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.class'), value: formData.studentClass },
                        { label: t('fields.section'), value: formData.section },
                        { label: t('fields.group'), value: formData.classGroup },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.applicationNo'), value: formData.applicationNumber },
                        { label: t('fields.studentType'), value: formData.studentType },
                        { label: t('fields.admissionType'), value: formData.admissionType },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.residentialPhone'), value: formData.residentialPhone },
                        { label: t('fields.transport'), value: formData.transport },
                        { label: t('fields.aadhaarNumber'), value: formData.aadhaarNumber },
                    ]}
                />

                {/* ── Section 2: Previous School & Personal Details ── */}
                <SectionHeader title={t('sections.previousSchoolPersonalDetails')} />
                <FieldRow
                    fields={[
                        { label: t('fields.previousSchoolName'), value: formData.schoolName },
                        { label: t('fields.previousClass'), value: formData.previousClass },
                        { label: t('fields.board'), value: formData.board },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.yearOfPassing'), value: formData.yearOfPassing },
                        { label: t('fields.percentage'), value: formData.percentage },
                        { label: t('fields.previousAdmissionNo'), value: formData.previousAdmissionNo },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.religion'), value: formData.religion },
                        { label: t('fields.caste'), value: formData.caste },
                        { label: t('fields.motherTongue'), value: formData.motherTongue },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.bloodGroup'), value: formData.bloodGroup },
                        { label: t('fields.nationality'), value: formData.nationality },
                        { label: t('fields.howDidYouKnow'), value: formData.howDidYouKnow },
                    ]}
                />

                {/* ── Section 3: Parent / Guardian Details ── */}
                <SectionHeader title={t('sections.parentGuardianDetails')} />
                <FieldRow
                    fields={[
                        { label: t('fields.fatherName'), value: formData.fatherName },
                        { label: t('fields.fatherMobile'), value: formData.fatherMobile },
                        { label: t('fields.fatherEmail'), value: formData.fatherEmail },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.fatherAadhaar'), value: formData.fatherAadhaar },
                        { label: t('fields.fatherQualification'), value: formData.fatherQualification },
                        { label: t('fields.fatherOccupation'), value: formData.fatherOccupation },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.motherName'), value: formData.motherName },
                        { label: t('fields.motherMobile'), value: formData.motherMobile },
                        { label: t('fields.motherEmail'), value: formData.motherEmail },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.motherAadhaar'), value: formData.motherAadhaar },
                        { label: t('fields.motherQualification'), value: formData.motherQualification },
                        { label: t('fields.motherOccupation'), value: formData.motherOccupation },
                    ]}
                />
                <FieldRow
                    fields={[
                        { label: t('fields.guardianName'), value: formData.guardianName },
                        { label: t('fields.guardianMobile'), value: formData.guardianMobile },
                        { label: '', value: '' },
                    ]}
                />

                {/* ── Section 4: Address Details ── */}
                <SectionHeader title={t('sections.addressDetails')} />
                <FieldRow
                    fields={[{ label: t('fields.currentAddress'), value: formData.currentAddress }]}
                    minHeight="44px"
                />
                <FieldRow
                    fields={[
                        { label: t('fields.locality'), value: formData.currentLocality },
                        { label: t('fields.pinCode'), value: formData.currentPinCode },
                    ]}
                />
                <FieldRow
                    fields={[
                        {
                            label: t('fields.permanentAddress'),
                            value: formData.sameAsPermanent
                                ? formData.currentAddress
                                : formData.permanentAddress,
                        },
                    ]}
                    minHeight="44px"
                />
                <FieldRow
                    fields={[
                        {
                            label: t('fields.permanentLocality'),
                            value: formData.sameAsPermanent
                                ? formData.currentLocality
                                : formData.permanentLocality,
                        },
                        { label: '', value: '' },
                    ]}
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
                            {t('declaration.heading')}
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
                        {(['parentGuardian', 'student', 'principal'] as const).map((roleKey) => (
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
                                    {t(`signature.${roleKey}`)}
                                </div>
                            </div>
                        ))}
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
                        {t('footer', { date: today })}
                    </div>
                </div>
            </div>
        );
    }
);

AdmissionFormPrintTemplate.displayName = 'AdmissionFormPrintTemplate';

export default AdmissionFormPrintTemplate;
