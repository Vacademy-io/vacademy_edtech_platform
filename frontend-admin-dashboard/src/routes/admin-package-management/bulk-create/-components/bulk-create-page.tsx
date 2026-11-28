import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import {
    ArrowLeft,
    Eye,
    ArrowClockwise,
    CheckCircle,
    MagnifyingGlass,
    Rows,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ScreenHeader } from '@/components/shared/crm-enhance/screen-header';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useBulkCreate } from '../-hooks/useBulkCreate';
import { GlobalDefaultsSection } from './global-defaults-section';
import { BulkCreateTable } from './bulk-create-table';
import { CsvImportDialog } from './csv-import-dialog';
import { FileCsv } from '@phosphor-icons/react';
import { PreviewDialog } from './preview-dialog';
import { createLevel, createSession } from '../-services/bulk-create-service';
import { LevelOption, SessionOption } from '../-types/bulk-create-types';
import { SimilarPackagesDialog } from './similar-packages-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export function BulkCreatePage() {
    const { t } = useTranslation('adminPackageManagement');
    const { setNavHeading } = useNavHeadingStore();
    const queryClient = useQueryClient();
    const [localLevels, setLocalLevels] = useState<LevelOption[]>([]);
    const [localSessions, setLocalSessions] = useState<SessionOption[]>([]);
    const [showCsvImport, setShowCsvImport] = useState(false);
    const [showSimilarPackages, setShowSimilarPackages] = useState(false);

    const {
        courses,
        globalDefaults,
        levels,
        sessions,
        isLoadingPaymentOptions,
        validationErrors,
        showPreview,
        isValidating,
        isSubmitting,
        dryRunResult,
        submitResult,
        addCourse,
        importCourses,
        removeCourse,
        duplicateCourse,
        updateCourse,
        updateGlobalDefaults,
        handleValidate,
        handleSubmit,
        resetForm,
        setShowPreview,
        getErrorsForCourse,
    } = useBulkCreate();

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-2">
                <Link to="/admin-package-management">
                    <Button variant="ghost" size="sm" className="h-8">
                        <ArrowLeft className="mr-1 size-4" />
                        Back
                    </Button>
                </Link>
                <h1 className="text-lg font-semibold">Bulk Create {getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}</h1>
            </div>
        );
    }, [setNavHeading]);

    const allLevels = [...levels, ...localLevels];
    const allSessions = [...sessions, ...localSessions];

    const handleAddLevel = async (name: string): Promise<LevelOption> => {
        try {
            const newLevel = await createLevel(name);
            setLocalLevels((prev) => [...prev, newLevel]);
            queryClient.invalidateQueries({ queryKey: ['institute-details'] });
            return newLevel;
        } catch (error) {
            toast.error('Failed to create level');
            throw error;
        }
    };

    const handleAddSession = async (name: string): Promise<SessionOption> => {
        try {
            const newSession = await createSession(name);
            setLocalSessions((prev) => [...prev, newSession]);
            queryClient.invalidateQueries({ queryKey: ['institute-details'] });
            return newSession;
        } catch (error) {
            toast.error('Failed to create session');
            throw error;
        }
    };

    const handleReset = () => {
        if (window.confirm('Are you sure you want to reset? All unsaved changes will be lost.')) {
            resetForm();
            setLocalLevels([]);
            setLocalSessions([]);
            toast.info('Form reset');
        }
    };

    if (isLoadingPaymentOptions) {
        return (
            <div className="flex min-h-96 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    const hasErrors = validationErrors.length > 0;
    const courseCount = courses.length;

    return (
        <section className="animate-fadeIn flex max-w-full flex-col gap-4 p-3 sm:p-4">
            {/* Header Actions */}
            <ScreenHeader
                icon={Rows}
                back={
                    <Link
                        to="/admin-package-management"
                        className="inline-flex w-fit items-center gap-1.5 text-caption font-semibold text-neutral-500 hover:text-primary-500"
                    >
                        <ArrowLeft className="size-4" />
                        {t('title', {
                            package: getTerminology(ContentTerms.Package, SystemTerms.Package),
                        })}
                    </Link>
                }
                title={`Create Multiple ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}`}
                subtitle={`Add ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase()} quickly with global defaults and individual customization`}
                actions={
                    <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap lg:items-center">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowSimilarPackages(true)}
                            className="h-9 min-w-0 justify-center"
                        >
                            <MagnifyingGlass className="mr-1 size-4 shrink-0" />
                            <span className="truncate">
                                Search already added{' '}
                                {getTerminologyPlural(ContentTerms.Package, SystemTerms.Package)}
                            </span>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowCsvImport(true)}
                            className="h-9 min-w-0 justify-center"
                        >
                            <FileCsv className="mr-1 size-4 shrink-0" />
                            <span className="truncate">Import CSV</span>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleReset}
                            className="h-9 min-w-0 justify-center"
                        >
                            <ArrowClockwise className="mr-1 size-4 shrink-0" />
                            <span className="truncate">Reset</span>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleValidate}
                            disabled={isValidating || courseCount === 0}
                            className="h-9 min-w-0 justify-center"
                        >
                            <Eye className="mr-1 size-4 shrink-0" />
                            <span className="truncate">
                                {isValidating ? 'Validating...' : 'Validate & Preview'}
                            </span>
                        </Button>
                    </div>
                }
            />

            {/* Validation Errors Summary */}
            {hasErrors && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <h4 className="mb-2 text-sm font-medium text-red-800">
                        Validation Errors ({validationErrors.length})
                    </h4>
                    <ul className="space-y-1 text-sm text-red-600">
                        {validationErrors.slice(0, 5).map((error, idx) => (
                            <li key={idx}>
                                Row {error.rowIndex + 1}: {error.message}
                            </li>
                        ))}
                        {validationErrors.length > 5 && (
                            <li className="text-red-500">
                                ...and {validationErrors.length - 5} more errors
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {/* Success Result */}
            {submitResult && submitResult.success_count > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="size-5 text-green-600" weight="fill" />
                        <h4 className="text-sm font-medium text-green-800">
                            Successfully created {submitResult.success_count} {getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase()}(s)!
                        </h4>
                    </div>
                    <p className="mt-1 text-sm text-green-600">
                        <Link
                            to="/admin-package-management"
                            className="underline hover:text-green-700"
                        >
                            View in {getTerminology(ContentTerms.Package, SystemTerms.Package)} Management →
                        </Link>
                    </p>
                </div>
            )}

            {/* Global Defaults Section */}
            <GlobalDefaultsSection
                globalDefaults={globalDefaults}
                levels={allLevels}
                sessions={allSessions}
                onUpdate={updateGlobalDefaults}
                onAddLevel={handleAddLevel}
                onAddSession={handleAddSession}
            />

            {/* Courses Table */}
            <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <BulkCreateTable
                    courses={courses}
                    levels={allLevels}
                    sessions={allSessions}
                    validationErrors={validationErrors}
                    onAddCourse={addCourse}
                    onRemoveCourse={removeCourse}
                    onDuplicateCourse={duplicateCourse}
                    onUpdateCourse={updateCourse}
                    onAddLevel={handleAddLevel}
                    onAddSession={handleAddSession}
                    getErrorsForCourse={getErrorsForCourse}
                />
            </div>

            {/* Footer Actions */}
            <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:p-4">
                <span className="mr-auto text-xs text-neutral-500 sm:text-sm">
                    {courseCount} {courseCount !== 1 ? getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase() : getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase()} to create
                </span>
                <Button variant="outline" size="sm" asChild>
                    <Link to="/admin-package-management">Cancel</Link>
                </Button>
                <Button size="sm" onClick={handleValidate} disabled={isValidating || courseCount === 0}>
                    <Eye className="mr-1 size-4" />
                    {isValidating ? 'Validating...' : 'Preview & Create'}
                </Button>
            </div>

            {/* Preview Dialog */}
            <PreviewDialog
                open={showPreview}
                onOpenChange={setShowPreview}
                courses={courses}
                globalDefaults={globalDefaults}
                dryRunResult={dryRunResult}
                isSubmitting={isSubmitting}
                onConfirm={handleSubmit}
            />

            <CsvImportDialog
                open={showCsvImport}
                onOpenChange={setShowCsvImport}
                levels={allLevels}
                sessions={allSessions}
                onImport={importCourses}
            />

            <SimilarPackagesDialog
                open={showSimilarPackages}
                onOpenChange={setShowSimilarPackages}
            />
        </section>
    );
}
