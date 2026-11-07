import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ReferralManager } from './ReferralManager';
import {
    UnifiedReferralSettings,
    UnifiedReferralSettings as UnifiedReferralSettingsType,
} from './UnifiedReferralSettings';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Warning, CheckCircle, CircleNotch } from '@phosphor-icons/react';
import {
    addReferralOption,
    getReferralOptions,
    deleteReferralOption,
    updateReferralOption,
    convertFromApiFormat,
} from '@/services/referral';

const ReferralSettings = () => {
    const { t } = useTranslation('settingsReferral');
    const [showUnifiedReferralSettings, setShowUnifiedReferralSettings] = useState(false);
    const [editingUnifiedReferralSettings, setEditingUnifiedReferralSettings] =
        useState<UnifiedReferralSettingsType | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [referralPrograms, setReferralPrograms] = useState<UnifiedReferralSettingsType[]>([]);
    const [loading, setLoading] = useState(true);

    // Load referral programs on component mount
    useEffect(() => {
        loadReferralPrograms();
    }, []);

    const loadReferralPrograms = async () => {
        try {
            setLoading(true);
            const apiResponse = await getReferralOptions();
            const programs = apiResponse.map(convertFromApiFormat);
            setReferralPrograms(programs);
        } catch (error) {
            handleError(error, 'load referral programs', t('errors.loadPrograms'));
        } finally {
            setLoading(false);
        }
    };

    // Error handling for component operations
    const handleError = (error: unknown, operation: string, message: string) => {
        console.error(`Error in ${operation}:`, error);
        setError(message);
        setTimeout(() => setError(null), 5000);
    };

    const handleCreateProgram = () => {
        setEditingUnifiedReferralSettings(null);
        setShowUnifiedReferralSettings(true);
    };

    const handleEditProgram = (program: UnifiedReferralSettingsType) => {
        setEditingUnifiedReferralSettings(program);
        setShowUnifiedReferralSettings(true);
    };

    const handleSaveProgram = async (settings: UnifiedReferralSettingsType) => {
        try {
            if (editingUnifiedReferralSettings) {
                // Update existing program
                await updateReferralOption(editingUnifiedReferralSettings.id, settings);
                setSuccess(t('toasts.programUpdated'));
            } else {
                // Add new program
                await addReferralOption(settings);
                setSuccess(t('toasts.programCreated'));
            }
            // Reload programs to get updated data
            await loadReferralPrograms();
            setEditingUnifiedReferralSettings(null);
            setShowUnifiedReferralSettings(false);
            setTimeout(() => setSuccess(null), 5000);
        } catch (error) {
            handleError(error, 'save referral program', t('errors.saveProgram'));
        }
    };

    const handleDeleteProgram = async (programId: string) => {
        try {
            await deleteReferralOption(programId);
            // Reload programs to get updated data
            await loadReferralPrograms();
        } catch (error) {
            handleError(error, 'delete referral program', t('errors.deleteProgram'));
        }
    };

    const handleDuplicateProgram = async (program: UnifiedReferralSettingsType) => {
        try {
            const duplicatedProgram: UnifiedReferralSettingsType = {
                ...program,
                id: Date.now().toString(),
                label: t('program.duplicateLabel', { label: program.label }),
                isDefault: false,
            };
            await addReferralOption(duplicatedProgram);
            // Reload programs to get updated data
            await loadReferralPrograms();
        } catch (error) {
            handleError(error, 'duplicate referral program', t('errors.duplicateProgram'));
        }
    };

    return (
        <div>
            {/* Error Alert */}
            {error && (
                <Alert variant="destructive">
                    <Warning className="size-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Success Alert */}
            {success && (
                <Alert variant="default" className="border-green-200 bg-green-50 text-green-800">
                    <CheckCircle className="size-4" />
                    <AlertDescription>{success}</AlertDescription>
                </Alert>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                    <CircleNotch className="size-10 animate-spin text-primary-500" />

                    <p className="text-gray-600">{t('loading')}</p>
                </div>
            ) : (
                <ReferralManager
                    programs={referralPrograms}
                    onCreateProgram={handleCreateProgram}
                    onEditProgram={handleEditProgram}
                    onDeleteProgram={handleDeleteProgram}
                    onDuplicateProgram={handleDuplicateProgram}
                />
            )}

            <UnifiedReferralSettings
                isOpen={showUnifiedReferralSettings}
                onClose={() => {
                    setShowUnifiedReferralSettings(false);
                    setEditingUnifiedReferralSettings(null);
                }}
                onSave={handleSaveProgram}
                editingSettings={editingUnifiedReferralSettings}
            />
        </div>
    );
};

export default ReferralSettings;
