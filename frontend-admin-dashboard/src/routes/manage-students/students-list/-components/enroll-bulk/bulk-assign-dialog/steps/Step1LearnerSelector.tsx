import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, MagnifyingGlass, Upload, UserPlus, PencilSimple } from '@phosphor-icons/react';
import { useAutosuggestUsers } from '../../../../-hooks/useAutosuggestUsers';
import {
    AutosuggestUser,
    LearnerSourceMode,
    NewUserRow,
    ParentLinkChoice,
    SelectedLearner,
} from '../../../../-types/bulk-assign-types';
import { CsvUserImporter, CsvPaymentInfo } from '../../components/CsvUserImporter';
import { ManualUserEntry } from '../../components/ManualUserEntry';
import { FromCourseSelector } from '../../components/FromCourseSelector';
import { LearnerGuardianControls } from '../../components/LearnerGuardianControls';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useParentSettings } from '@/hooks/use-parent-settings';
import { cn } from '@/lib/utils';

interface Props {
    instituteId: string;
    selectedLearners: SelectedLearner[];
    onSelectedLearnersChange: (learners: SelectedLearner[]) => void;
    onPaymentInfoDetected?: (info: CsvPaymentInfo) => void;
    /** Inline errors from a failed guardian-link resolution, keyed by learner index (see BulkAssignDialog). */
    guardianLinkErrors?: Record<number, string>;
    /** Clears a chip's guardian-link error once the admin edits its sub-form again. */
    onClearGuardianLinkError?: (index: number) => void;
}

export const Step1LearnerSelector = ({
    instituteId,
    selectedLearners,
    onSelectedLearnersChange,
    onPaymentInfoDetected,
    guardianLinkErrors,
    onClearGuardianLinkError,
}: Props) => {
    const { t } = useTranslation('manageStudentsStep1LearnerSelector');
    const { enabled: guardianLinkingEnabled, isLoading: guardianSettingsLoading } = useParentSettings();
    const showGuardianControls = guardianLinkingEnabled && !guardianSettingsLoading;
    const [searchQuery, setSearchQuery] = useState('');
    const [mode, setMode] = useState<LearnerSourceMode>('manual');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const editingRow =
        editingIndex !== null && selectedLearners[editingIndex]?.type === 'new'
            ? (selectedLearners[editingIndex] as { type: 'new'; newUser: NewUserRow }).newUser
            : undefined;

    const startEditing = (idx: number) => {
        setEditingIndex(idx);
        setMode('manual');
    };

    const handleEditSave = (updated: NewUserRow) => {
        if (editingIndex === null) return;
        const next = [...selectedLearners];
        next[editingIndex] = { type: 'new', newUser: updated };
        onSelectedLearnersChange(next);
        setEditingIndex(null);
    };

    const handleEditCancel = () => setEditingIndex(null);

    const { data: suggestedUsers, isFetching } = useAutosuggestUsers({
        instituteId,
        query: searchQuery,
        roles: ['STUDENT'],
        enabled: mode === 'search',
    });

    const addExistingUser = (user: AutosuggestUser) => {
        if (selectedLearners.some((l) => l.type === 'existing' && l.userId === user.id)) return;
        onSelectedLearnersChange([
            ...selectedLearners,
            {
                type: 'existing',
                userId: user.id,
                email: user.email,
                name: user.full_name || user.username,
            },
        ]);
        setSearchQuery('');
    };

    const addNewUsers = (rows: NewUserRow[]) => {
        const newLearners: SelectedLearner[] = rows.map((row) => ({ type: 'new', newUser: row }));
        onSelectedLearnersChange([...selectedLearners, ...newLearners]);
    };

    const removeLearner = (index: number) => {
        const next = [...selectedLearners];
        next.splice(index, 1);
        onSelectedLearnersChange(next);
    };

    const getLearnerLabel = (l: SelectedLearner) =>
        l.type === 'existing' ? l.name || l.email : l.newUser.full_name || l.newUser.email;

    const getLearnerSub = (l: SelectedLearner) =>
        l.type === 'existing' ? l.email : t('chip.newUser');

    const updateParentLink = (index: number, next: ParentLinkChoice) => {
        const nextLearners = [...selectedLearners];
        nextLearners[index] = { ...nextLearners[index], parentLink: next } as SelectedLearner;
        onSelectedLearnersChange(nextLearners);
        onClearGuardianLinkError?.(index);
    };

    return (
        <div className="flex h-full flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
            {/* Selected learners chip list */}
            {selectedLearners.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <p className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                        {t('summary.learnersSelected', { count: selectedLearners.length })}
                    </p>
                    <div className={cn(showGuardianControls ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2')}>
                        {selectedLearners.map((l, idx) => {
                            const isBeingEdited = editingIndex === idx;
                            const chipHeader = (
                                <div
                                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                                        isBeingEdited
                                            ? 'border-warning-400 bg-warning-50 text-warning-700'
                                            : 'border-primary-200 bg-primary-50 text-primary-700'
                                    } ${showGuardianControls ? 'w-fit' : ''}`}
                                >
                                    <div>
                                        <span className="font-medium">{getLearnerLabel(l)}</span>
                                        <span className={`ml-1 ${isBeingEdited ? 'text-warning-500' : 'text-primary-400'}`}>
                                            {isBeingEdited ? t('chip.editing') : getLearnerSub(l)}
                                        </span>
                                    </div>
                                    {l.type === 'new' && !isBeingEdited && (
                                        <button
                                            onClick={() => startEditing(idx)}
                                            className="ml-1 rounded-full text-primary-400 hover:text-primary-700"
                                            title={t('chip.editTitle')}
                                        >
                                            <PencilSimple size={12} weight="bold" />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (isBeingEdited) setEditingIndex(null);
                                            removeLearner(idx);
                                        }}
                                        className={`ml-1 rounded-full ${
                                            isBeingEdited
                                                ? 'text-warning-500 hover:text-warning-700'
                                                : 'text-primary-400 hover:text-primary-700'
                                        }`}
                                        title={t('chip.removeTitle')}
                                    >
                                        <X size={12} weight="bold" />
                                    </button>
                                </div>
                            );

                            if (!showGuardianControls) {
                                return <div key={idx}>{chipHeader}</div>;
                            }

                            return (
                                <div key={idx} className="rounded-lg border border-neutral-200 bg-white p-2">
                                    {chipHeader}
                                    <LearnerGuardianControls
                                        learner={l}
                                        index={idx}
                                        instituteId={instituteId}
                                        onChange={(next) => updateParentLink(idx, next)}
                                        error={guardianLinkErrors?.[idx]}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Source mode tabs — 2x2 grid on mobile, single row on sm+ */}
            <Tabs
                value={mode}
                onValueChange={(v) => {
                    const next = v as LearnerSourceMode;
                    if (editingIndex !== null && next !== 'manual') {
                        setEditingIndex(null);
                    }
                    setMode(next);
                }}
            >
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:flex sm:h-9 sm:gap-0">
                    <TabsTrigger value="search" className="min-w-0 justify-center text-xs sm:flex-1 sm:text-sm">
                        <MagnifyingGlass size={14} className="mr-1.5 shrink-0" />
                        <span className="truncate">{t('tabs.search')}</span>
                    </TabsTrigger>
                    <TabsTrigger value="from_course" className="min-w-0 justify-center text-xs sm:flex-1 sm:text-sm">
                        <UserPlus size={14} className="mr-1.5 shrink-0" />
                        <span className="truncate">
                            {t('tabs.fromCourse', {
                                term: getTerminology(ContentTerms.Course, SystemTerms.Course),
                            })}
                        </span>
                    </TabsTrigger>
                    <TabsTrigger value="csv" className="min-w-0 justify-center text-xs sm:flex-1 sm:text-sm">
                        <Upload size={14} className="mr-1.5 shrink-0" />
                        <span className="truncate">{t('tabs.csv')}</span>
                    </TabsTrigger>
                    <TabsTrigger value="manual" className="min-w-0 justify-center text-xs sm:flex-1 sm:text-sm">
                        <UserPlus size={14} className="mr-1.5 shrink-0" />
                        <span className="truncate">{t('tabs.manual')}</span>
                    </TabsTrigger>
                </TabsList>

                {/* TAB: Search existing students */}
                <TabsContent value="search" className="mt-4">
                    <div className="relative">
                        <MagnifyingGlass
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                        />
                        <Input
                            ref={searchRef}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('search.placeholder')}
                            className="pl-9"
                        />
                    </div>
                    {isFetching && (
                        <p className="mt-3 text-xs text-neutral-400">{t('search.searching')}</p>
                    )}
                    {!isFetching && suggestedUsers && suggestedUsers.length > 0 && (
                        <div className="mt-2 rounded-lg border border-neutral-200 bg-white shadow-sm">
                            {suggestedUsers.map((u: AutosuggestUser) => {
                                const alreadyAdded = selectedLearners.some(
                                    (l) => l.type === 'existing' && l.userId === u.id
                                );
                                return (
                                    <button
                                        key={u.id}
                                        onClick={() => addExistingUser(u)}
                                        disabled={alreadyAdded}
                                        className={`flex w-full items-center justify-between border-b border-neutral-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-primary-50 disabled:opacity-50 ${alreadyAdded ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                    >
                                        <div>
                                            <p className="font-medium text-neutral-800">
                                                {u.full_name || u.username}
                                            </p>
                                            <p className="text-xs text-neutral-400">{u.email}</p>
                                        </div>
                                        {alreadyAdded ? (
                                            <Badge variant="secondary">{t('search.added')}</Badge>
                                        ) : (
                                            <span className="text-xs font-medium text-primary-500">
                                                {t('search.addAction')}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {!isFetching && searchQuery.length >= 2 && (!suggestedUsers || suggestedUsers.length === 0) && (
                        <p className="mt-4 text-center text-sm text-neutral-400">
                            {t('search.noResults', { query: searchQuery })}
                        </p>
                    )}
                    {searchQuery.length < 2 && (
                        <p className="mt-4 text-center text-sm text-neutral-400">
                            {t('search.minChars')}
                        </p>
                    )}
                </TabsContent>

                {/* TAB: From another course */}
                <TabsContent value="from_course" className="mt-4">
                    <FromCourseSelector
                        instituteId={instituteId}
                        selectedLearners={selectedLearners}
                        onAdd={(newOnes: SelectedLearner[]) =>
                            onSelectedLearnersChange([...selectedLearners, ...newOnes])
                        }
                    />
                </TabsContent>

                {/* TAB: CSV import */}
                <TabsContent value="csv" className="mt-4">
                    <CsvUserImporter onImport={addNewUsers} onPaymentInfoDetected={onPaymentInfoDetected} />
                </TabsContent>

                {/* TAB: Manual entry */}
                <TabsContent value="manual" className="mt-4">
                    <ManualUserEntry
                        onAdd={addNewUsers}
                        editingRow={editingRow}
                        onEditSave={handleEditSave}
                        onEditCancel={handleEditCancel}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};
