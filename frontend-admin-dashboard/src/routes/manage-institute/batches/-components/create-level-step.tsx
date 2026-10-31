// CreateLevelStep.tsx
import { AddLevelInput } from '@/components/design-system/add-level-input';
import { RadioGroup } from '@/components/ui/radio-group';
import { ChoiceCard } from './choice-card';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useEffect, useState } from 'react';
import { BatchItemSelect } from './batch-item-select';
import { useFormContext } from 'react-hook-form';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Plus, Stack, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LEVEL_ID, DEFAULT_SESSION_ID } from '../-utils/batch-defaults';

export const CreateLevelStep = () => {
    const { t } = useTranslation('manageInstituteCreateLevelStep');
    const { getLevelsFromPackage, instituteDetails, getSessionFromPackage, getPackageSessionId } =
        useInstituteDetailsStore();
    const [newLevelName, setNewLevelName] = useState('');
    const [newLevelDuration, setNewLevelDuration] = useState<number | null>(null);
    const [newLevelAdded, setNewLevelAdded] = useState(false);
    const [levelList, setLevelList] =
        useState<Array<{ id: string; name: string }>>(getLevelsFromPackage());
    const [sessionList, setSessionList] = useState<Array<{ id: string; name: string }>>([]);
    const form = useFormContext();
    const { watch } = form;

    /**
     * Every level of the institute. The level already used by this course and
     * session used to be dropped, so an institute with a single level had
     * nothing to pick and was forced to create one. A batch now has its own
     * name, so several batches can share the same course, session and level.
     */
    useEffect(() => {
        setLevelList(getLevelsFromPackage());
    }, [instituteDetails]);

    useEffect(() => {
        // Get all sessions except the currently selected one
        const allSessions = getSessionFromPackage({
            courseId: form.watch('selectedCourse')?.id,
            levelId: form.watch('selectedLevel')?.id,
        });
        const filteredSessions = allSessions.filter(
            (session) => session.id !== form.watch('selectedSession')?.id
        );
        setSessionList(filteredSessions);
    }, [form.watch('selectedCourse'), form.watch('selectedSession')]);

    const handleAddLevel = (levelName: string, durationInDays: number | null) => {
        setNewLevelName(levelName);
        setNewLevelDuration(durationInDays);
        setNewLevelAdded(true);
    };

    useEffect(() => {
        if (watch('levelCreationType') === 'new') {
            form.setValue('selectedLevel', { id: '', name: newLevelName });
            form.setValue('selectedLevelDuration', newLevelDuration);
        }
    }, [watch('levelCreationType'), newLevelName, newLevelDuration]);

    useEffect(() => {
        if (levelList.length === 0) {
            form.setValue('levelCreationType', 'new');
        }
    }, [levelList, form]);

    // When the course already uses the default level, start with it picked.
    const selectedCourseId = watch('selectedCourse')?.id;
    useEffect(() => {
        if (watch('levelCreationType') !== 'existing' || watch('selectedLevel')) return;
        const courseUsesDefault =
            !!selectedCourseId &&
            getLevelsFromPackage({ courseId: selectedCourseId }).some(
                (level) => level.id === DEFAULT_LEVEL_ID
            );
        const defaultLevel = levelList.find((level) => level.id === DEFAULT_LEVEL_ID);
        if (courseUsesDefault && defaultLevel) {
            form.setValue('selectedLevel', { id: defaultLevel.id, name: defaultLevel.name });
        }
    }, [levelList, selectedCourseId, watch('levelCreationType')]);

    // Copying needs to find the new batch by course + session + level, which is
    // only unambiguous when no batch has that combination yet.
    const selectedLevelId = watch('selectedLevel')?.id;
    const comboHasBatch =
        !!selectedLevelId &&
        !!getPackageSessionId({
            courseId: watch('selectedCourse')?.id || '',
            sessionId: watch('selectedSession')?.id || DEFAULT_SESSION_ID,
            levelId: selectedLevelId,
        });
    const shouldShowDuplicateOption =
        watch('courseCreationType') !== 'new' &&
        watch('levelCreationType') !== 'new' &&
        !!selectedLevelId &&
        !comboHasBatch &&
        sessionList.length > 0;

    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);
    const levelLower = levelTerm.toLocaleLowerCase();

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <p className="text-title font-semibold text-neutral-800">
                    {t('form.title', { term: levelTerm })}
                </p>
                <p className="text-body text-neutral-500">
                    {t('form.subtitle', { term: levelLower })}
                </p>
                <p className="text-caption text-neutral-500">
                    {t('form.optionalHint', { term: levelLower })}
                </p>
            </div>

            <FormField
                control={form.control}
                name="levelCreationType"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <RadioGroup
                                className="grid gap-4 md:grid-cols-2"
                                onValueChange={(value) => {
                                    field.onChange(value);
                                    form.setValue('selectedLevel', null); // Reset dependent field
                                    form.setValue('selectedLevelDuration', null);
                                    setNewLevelAdded(false); // Reset new level state
                                    setNewLevelName('');
                                    setNewLevelDuration(null);
                                }}
                                value={field.value}
                            >
                                <ChoiceCard
                                    id="existing-level"
                                    value="existing"
                                    selected={field.value === 'existing'}
                                    disabled={levelList.length === 0}
                                    icon={<Stack size={22} />}
                                    iconClassName="bg-primary-50 text-primary-500"
                                    title={t('form.selectExisting', { term: levelTerm })}
                                    description={t('form.selectExistingHint', { term: levelLower })}
                                />
                                <ChoiceCard
                                    id="new-level"
                                    value="new"
                                    selected={field.value === 'new'}
                                    icon={<Plus size={22} />}
                                    iconClassName="bg-success-50 text-success-600"
                                    title={t('form.createNew', { term: levelTerm })}
                                    description={t('form.createNewHint', { term: levelLower })}
                                />
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />

            {form.watch('levelCreationType') === 'existing' && (
                <FormField
                    control={form.control}
                    name="selectedLevel"
                    render={({ field }) => (
                        <FormItem className="flex flex-col gap-1.5">
                            <FormLabel className="text-subtitle font-semibold text-neutral-700">
                                {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                            </FormLabel>
                            <FormControl>
                                <BatchItemSelect
                                    items={levelList}
                                    value={field.value}
                                    onChange={field.onChange}
                                    placeholder={t('form.selectALevelPlaceholder', {
                                        term: getTerminology(
                                            ContentTerms.Level,
                                            SystemTerms.Level
                                        ).toLocaleLowerCase(),
                                    })}
                                    searchPlaceholder={t('form.searchLevel', {
                                        term: getTerminology(
                                            ContentTerms.Level,
                                            SystemTerms.Level
                                        ).toLocaleLowerCase(),
                                    })}
                                    emptyMessage={t('form.noLevelsYet', {
                                        term: getTerminology(
                                            ContentTerms.Level,
                                            SystemTerms.Level
                                        ).toLocaleLowerCase(),
                                    })}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}

            {form.watch('levelCreationType') === 'new' &&
                (newLevelAdded ? (
                    <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                        <div className="flex grow flex-col">
                            <p className="text-sm font-medium text-neutral-700">{newLevelName}</p>
                            {newLevelDuration && (
                                <p className="text-xs text-neutral-500">
                                    {t('form.durationDays', { count: newLevelDuration })}
                                </p>
                            )}
                        </div>
                        <MyButton
                            onClick={() => {
                                setNewLevelName('');
                                setNewLevelDuration(null);
                                setNewLevelAdded(false);
                                form.setValue('selectedLevel', null);
                                form.setValue('selectedLevelDuration', null);
                            }}
                            layoutVariant="icon"
                            buttonType="text"
                            className="p-1 text-neutral-500 hover:bg-danger-50 hover:text-danger-600"
                            scale="small"
                        >
                            <X size={18} />
                        </MyButton>
                    </div>
                ) : (
                    <AddLevelInput
                        newLevelName={newLevelName}
                        setNewLevelName={setNewLevelName}
                        newLevelDuration={newLevelDuration}
                        setNewLevelDuration={setNewLevelDuration}
                        handleAddLevel={handleAddLevel}
                        batchCreation={true}
                    />
                ))}

            {shouldShowDuplicateOption && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                    <FormField
                        control={form.control}
                        name="duplicateStudyMaterials"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 py-1">
                                <FormControl>
                                    <Checkbox
                                        checked={field.value}
                                        onCheckedChange={(checked) => {
                                            field.onChange(checked);
                                            if (!checked) {
                                                form.setValue('selectedDuplicateSession', null);
                                            }
                                        }}
                                        id="duplicate-materials"
                                    />
                                </FormControl>
                                <FormLabel
                                    htmlFor="duplicate-materials"
                                    className="cursor-pointer text-sm font-normal text-neutral-700"
                                >
                                    {t('form.duplicateFromPreExisting', {
                                        term: getTerminology(
                                            ContentTerms.Session,
                                            SystemTerms.Session
                                        ).toLocaleLowerCase(),
                                    })}
                                </FormLabel>
                            </FormItem>
                        )}
                    />

                    {form.watch('duplicateStudyMaterials') && (
                        <FormField
                            control={form.control}
                            name="selectedDuplicateSession"
                            rules={{ required: t('validation.pleaseSelectSessionToDuplicate') }}
                            render={({ field }) => (
                                <FormItem className="mt-3 flex flex-col gap-1.5">
                                    <FormLabel className="text-neutral-700">
                                        {t('form.duplicateFrom', {
                                            term: getTerminology(
                                                ContentTerms.Session,
                                                SystemTerms.Session
                                            ).toLocaleLowerCase(),
                                        })}{' '}
                                        <span className="text-danger-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <BatchItemSelect
                                            items={sessionList}
                                            value={field.value}
                                            onChange={field.onChange}
                                            placeholder={t('form.selectForDuplication', {
                                                term: getTerminology(
                                                    ContentTerms.Session,
                                                    SystemTerms.Session
                                                ).toLocaleLowerCase(),
                                            })}
                                            searchPlaceholder={t('form.searchSession', {
                                                term: getTerminology(
                                                    ContentTerms.Session,
                                                    SystemTerms.Session
                                                ).toLocaleLowerCase(),
                                            })}
                                            emptyMessage={t('form.noOtherSessions', {
                                                term: getTerminology(
                                                    ContentTerms.Session,
                                                    SystemTerms.Session
                                                ).toLocaleLowerCase(),
                                            })}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                </div>
            )}
        </div>
    );
};
