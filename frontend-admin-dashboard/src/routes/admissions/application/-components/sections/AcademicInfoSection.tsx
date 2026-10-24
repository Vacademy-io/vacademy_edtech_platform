import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Registration } from '../../../-types/registration-types';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { MAX_LENGTH } from '@/utils/form-validation';

interface SectionProps {
    formData: Partial<Registration>;
    updateFormData: (data: Partial<Registration>) => void;
}

// Board values (CBSE / ICSE / State Board / IB / IGCSE / Other) are stored/compared
// as these raw strings — the translated label is display-only, never the stored value.
const getBoardLabel = (t: TFunction, board: string): string => {
    switch (board) {
        case 'CBSE':
            return t('boardOptions.cbse');
        case 'ICSE':
            return t('boardOptions.icse');
        case 'State Board':
            return t('boardOptions.stateBoard');
        case 'IB':
            return t('boardOptions.ib');
        case 'IGCSE':
            return t('boardOptions.igcse');
        case 'Other':
            return t('boardOptions.other');
        default:
            return board;
    }
};

// Last-class-attended values (Kindergarten / Nursery / LKG / UKG) are stored/compared
// as these raw strings — the translated label is display-only, never the stored value.
const getClassLevelLabel = (t: TFunction, level: string): string => {
    switch (level) {
        case 'Kindergarten':
            return t('classLevelOptions.kindergarten');
        case 'Nursery':
            return t('classLevelOptions.nursery');
        case 'LKG':
            return t('classLevelOptions.lkg');
        case 'UKG':
            return t('classLevelOptions.ukg');
        default:
            return level;
    }
};

export const AcademicInfoSection: React.FC<SectionProps> = ({ formData, updateFormData }) => {
    const { t } = useTranslation('admissionsAcademicInfoSection');
    // Get package sessions from institute store
    const { instituteDetails } = useInstituteDetailsStore();
    const [packageSessions, setPackageSessions] = React.useState<
        Array<{
            id: string;
            name: string; // Format: "packageName - levelName"
            levelName: string;
        }>
    >([]);
    const [sessionName, setSessionName] = React.useState('');

    React.useEffect(() => {
        if (instituteDetails?.batches_for_sessions) {
            const sessions = instituteDetails.batches_for_sessions
                .filter((batch) => batch.is_parent === true || !batch.parent_id)
                .map((batch) => ({
                    id: batch.id,
                    name: `${batch.package_dto.package_name} - ${batch.level.level_name}${batch.name ? ` - ${batch.name}` : ''}`,
                    levelName: batch.level.level_name,
                }));
            setPackageSessions(sessions);
        }

        // Get session name from URL
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('sessionId');
        if (sessionId && instituteDetails?.sessions) {
            const session = instituteDetails.sessions.find((s) => s.id === sessionId);
            if (session) {
                setSessionName(session.session_name);
                updateFormData({ academicYear: session.session_name });
            }
        }
    }, [instituteDetails, updateFormData]);

    return (
        <div className="space-y-6">
            {/* Current/Previous School Details */}
            <div className="space-y-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold uppercase text-neutral-500">
                    <span className="i-ph-graduation-cap size-4" />
                    {t('sections.previousSchoolDetails')}
                </h4>

                <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">
                        {t('fields.previousSchoolName.label')}
                    </label>
                    <input
                        type="text"
                        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        placeholder={t('fields.previousSchoolName.placeholder')}
                        value={formData.previousSchoolName || ''}
                        onChange={(e) => updateFormData({ previousSchoolName: e.target.value })}
                        maxLength={MAX_LENGTH.SCHOOL_NAME}
                    />
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.previousSchoolBoard.label')}
                        </Label>
                        <Select
                            value={formData.previousSchoolBoard || ''}
                            onValueChange={(value) =>
                                updateFormData({ previousSchoolBoard: value })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.previousSchoolBoard.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="CBSE">{getBoardLabel(t, 'CBSE')}</SelectItem>
                                <SelectItem value="ICSE">{getBoardLabel(t, 'ICSE')}</SelectItem>
                                <SelectItem value="State Board">
                                    {getBoardLabel(t, 'State Board')}
                                </SelectItem>
                                <SelectItem value="IB">{getBoardLabel(t, 'IB')}</SelectItem>
                                <SelectItem value="IGCSE">{getBoardLabel(t, 'IGCSE')}</SelectItem>
                                <SelectItem value="Other">{getBoardLabel(t, 'Other')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-neutral-500">
                            {t('fields.previousSchoolBoard.hint')}
                        </p>
                    </div>
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.lastClassAttended.label')}
                        </Label>
                        <Select
                            value={formData.lastClassAttended || ''}
                            onValueChange={(value) => updateFormData({ lastClassAttended: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.lastClassAttended.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Kindergarten">
                                    {getClassLevelLabel(t, 'Kindergarten')}
                                </SelectItem>
                                <SelectItem value="Nursery">
                                    {getClassLevelLabel(t, 'Nursery')}
                                </SelectItem>
                                <SelectItem value="LKG">{getClassLevelLabel(t, 'LKG')}</SelectItem>
                                <SelectItem value="UKG">{getClassLevelLabel(t, 'UKG')}</SelectItem>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((cls) => (
                                    <SelectItem key={cls} value={cls.toString()}>
                                        {t('classNumber', { number: cls })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div>
                    <Label className="mb-1 block text-sm font-medium text-neutral-700">
                        {t('fields.academicYear.label')} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                        type="text"
                        value={sessionName || formData.academicYear || ''}
                        readOnly
                        disabled
                        className="bg-neutral-50"
                        placeholder={t('fields.academicYear.placeholder')}
                    />
                    <p className="mt-1 text-xs text-neutral-500">{t('fields.academicYear.hint')}</p>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.lastExamResult.label')}
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder={t('fields.lastExamResult.placeholder')}
                            value={formData.lastExamResult || ''}
                            onChange={(e) => updateFormData({ lastExamResult: e.target.value })}
                            maxLength={MAX_LENGTH.GENERAL}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.subjectsStudied.label')}
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder={t('fields.subjectsStudied.placeholder')}
                            value={formData.subjectsStudied || ''}
                            onChange={(e) => updateFormData({ subjectsStudied: e.target.value })}
                            maxLength={MAX_LENGTH.ADDRESS}
                        />
                    </div>
                </div>
            </div>

            {/* Transfer Certificate Details */}
            <div className="space-y-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold uppercase text-neutral-500">
                    <span className="i-ph-file-text size-4" />
                    {t('sections.transferCertificateDetails')}
                </h4>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.tcNumber.label')}
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder={t('fields.tcNumber.placeholder')}
                            value={formData.tcNumber || ''}
                            onChange={(e) => updateFormData({ tcNumber: e.target.value })}
                            maxLength={MAX_LENGTH.APPLICATION_NUMBER}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.tcIssueDate.label')}
                        </label>
                        <input
                            type="date"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            value={formData.tcIssueDate || ''}
                            onChange={(e) => updateFormData({ tcIssueDate: e.target.value })}
                        />
                    </div>
                </div>

                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4">
                    <label className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            className="mt-1 size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                            checked={formData.tcPending || false}
                            onChange={(e) => updateFormData({ tcPending: e.target.checked })}
                        />
                        <div>
                            <span className="block text-sm font-medium text-yellow-900">
                                {t('fields.tcPending.label')}
                            </span>
                            <span className="block text-xs text-yellow-700">
                                {t('fields.tcPending.hint')}
                            </span>
                        </div>
                    </label>
                </div>
            </div>

            {/* Applying For */}
            <div className="space-y-4 pt-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold uppercase text-neutral-500">
                    <span className="i-ph-student size-4" />
                    {t('sections.applyingFor')}
                </h4>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.applyingForClass.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={
                                formData.selectedPackageSessionId || formData.applyingForClass || ''
                            }
                            onValueChange={(value) => {
                                updateFormData({
                                    applyingForClass: value,
                                    selectedPackageSessionId: value,
                                });
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.applyingForClass.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {packageSessions.map((session) => (
                                    <SelectItem key={session.id} value={session.id}>
                                        {session.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-neutral-500">
                            {t('fields.applyingForClass.hint')}
                        </p>
                    </div>
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.preferredBoard.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={formData.preferredBoard || ''}
                            onValueChange={(value) => updateFormData({ preferredBoard: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.preferredBoard.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="CBSE">{getBoardLabel(t, 'CBSE')}</SelectItem>
                                <SelectItem value="ICSE">{getBoardLabel(t, 'ICSE')}</SelectItem>
                                <SelectItem value="State Board">
                                    {getBoardLabel(t, 'State Board')}
                                </SelectItem>
                                <SelectItem value="IB">{getBoardLabel(t, 'IB')}</SelectItem>
                                <SelectItem value="IGCSE">{getBoardLabel(t, 'IGCSE')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        </div>
    );
};
