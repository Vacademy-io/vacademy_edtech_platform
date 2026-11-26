import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Info, Warning } from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
    getCourseCertificateTests,
    type CertificateCriteriaMode,
    type CertificatePassRule,
    type CertificateTestOption,
    type CertificateTestScope,
    type CertificateTestType,
} from '../../-services/course-certificates';
import {
    ALL_TEST_TYPES,
    criteriaDraftError,
    groupTestsByModule,
    testsCountedByRule,
    toggleId,
    type CriteriaDraft,
} from './certificate-criteria-utils';

interface CertificateCriteriaSectionProps {
    draft: CriteriaDraft;
    onChange: (next: CriteriaDraft) => void;
    instituteId: string;
    packageId: string;
    /** Only fetch the course's tests while the dialog is open. */
    active: boolean;
    disabled?: boolean;
}

const MODES: CertificateCriteriaMode[] = ['PROGRESS', 'SCORE', 'PROGRESS_AND_SCORE'];
const SCOPES: CertificateTestScope[] = ['ALL', 'CUSTOM'];
const LIVE_STATUSES = new Set(['PUBLISHED', 'UNSYNC']);

const clampPercent = (value: string) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

/**
 * The course certificate's earning rule: course progress (as before), marks in
 * chosen quizzes/assessments, or both. Controlled - the settings dialog owns the
 * draft and saves it with the rest of the course override.
 */
export const CertificateCriteriaSection = ({
    draft,
    onChange,
    instituteId,
    packageId,
    active,
    disabled,
}: CertificateCriteriaSectionProps) => {
    const { t } = useTranslation('studyLibraryCertificateCriteria');
    const scoreRule = draft.mode !== 'PROGRESS';

    const {
        data: tests,
        isLoading,
        isError,
    } = useQuery({
        queryKey: ['course-certificate-tests', instituteId, packageId],
        queryFn: () => getCourseCertificateTests(instituteId, packageId),
        enabled: active && scoreRule && !!instituteId && !!packageId,
        staleTime: 60_000,
    });

    const counted = useMemo(() => testsCountedByRule(draft, tests ?? []), [draft, tests]);
    const error = criteriaDraftError(draft);
    const set = (patch: Partial<CriteriaDraft>) => onChange({ ...draft, ...patch });

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
                <Label className="text-subtitle font-medium">{t('earnHeading')}</Label>
                <RadioGroup
                    value={draft.mode}
                    onValueChange={(value) => set({ mode: value as CertificateCriteriaMode })}
                    disabled={disabled}
                    className="gap-3"
                >
                    {MODES.map((mode) => (
                        <label
                            key={mode}
                            htmlFor={`criteria-mode-${mode}`}
                            className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-md border p-3',
                                draft.mode === mode
                                    ? 'border-primary-300 bg-primary-50'
                                    : 'border-neutral-200 bg-white'
                            )}
                        >
                            <RadioGroupItem
                                id={`criteria-mode-${mode}`}
                                value={mode}
                                className="mt-0.5"
                            />
                            <span className="flex flex-col">
                                <span className="text-body font-medium text-neutral-700">
                                    {t(`mode.${mode}.label`)}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t(`mode.${mode}.description`)}
                                </span>
                            </span>
                        </label>
                    ))}
                </RadioGroup>
            </div>

            {scoreRule && (
                <>
                    <div className="flex flex-col gap-3">
                        <Label className="text-subtitle font-medium">{t('scopeHeading')}</Label>
                        <RadioGroup
                            value={draft.testScope}
                            onValueChange={(value) =>
                                set({ testScope: value as CertificateTestScope })
                            }
                            disabled={disabled}
                        >
                            {SCOPES.map((scope) => (
                                <div key={scope} className="flex items-center gap-2">
                                    <RadioGroupItem id={`criteria-scope-${scope}`} value={scope} />
                                    <Label
                                        htmlFor={`criteria-scope-${scope}`}
                                        className="text-body"
                                    >
                                        {t(`scope.${scope}`)}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label className="text-subtitle font-medium">{t('typesHeading')}</Label>
                        <div className="flex flex-wrap gap-4">
                            {ALL_TEST_TYPES.map((type) => (
                                <div key={type} className="flex items-center gap-2">
                                    <Checkbox
                                        id={`criteria-type-${type}`}
                                        checked={draft.testTypes.includes(type)}
                                        disabled={disabled}
                                        onCheckedChange={(checked) =>
                                            set({
                                                testTypes: toggleId(
                                                    draft.testTypes,
                                                    type,
                                                    checked === true
                                                ) as CertificateTestType[],
                                            })
                                        }
                                    />
                                    <Label htmlFor={`criteria-type-${type}`} className="text-body">
                                        {t(`typePlural.${type}`)}
                                    </Label>
                                </div>
                            ))}
                        </div>
                        <p className="text-caption text-neutral-500">{t('typesHint')}</p>
                    </div>

                    {draft.testScope === 'CUSTOM' && (
                        <TestPicker
                            draft={draft}
                            onChange={onChange}
                            tests={tests}
                            isLoading={isLoading}
                            isError={isError}
                            disabled={disabled}
                        />
                    )}

                    <div className="flex flex-col gap-3">
                        <Label className="text-subtitle font-medium">{t('ruleHeading')}</Label>
                        <RadioGroup
                            value={draft.passRule}
                            onValueChange={(value) =>
                                set({ passRule: value as CertificatePassRule })
                            }
                            disabled={disabled}
                        >
                            <div className="flex items-center gap-2">
                                <RadioGroupItem id="criteria-rule-ALL" value="ALL" />
                                <Label htmlFor="criteria-rule-ALL" className="text-body">
                                    {t('rule.ALL')}
                                </Label>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <RadioGroupItem id="criteria-rule-AT_LEAST" value="AT_LEAST" />
                                <Label htmlFor="criteria-rule-AT_LEAST" className="text-body">
                                    {t('rule.AT_LEAST')}
                                </Label>
                                <MyInput
                                    inputType="number"
                                    input={String(draft.minTestsToPass)}
                                    onChangeFunction={(e) =>
                                        set({
                                            passRule: 'AT_LEAST',
                                            minTestsToPass: Math.max(
                                                1,
                                                Math.round(Number(e.target.value) || 1)
                                            ),
                                        })
                                    }
                                    disabled={disabled}
                                    className="w-20 sm:w-20"
                                />
                                <span className="text-body text-neutral-600">
                                    {t('rule.AT_LEAST_SUFFIX')}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem id="criteria-rule-AVERAGE" value="AVERAGE" />
                                <Label htmlFor="criteria-rule-AVERAGE" className="text-body">
                                    {t('rule.AVERAGE')}
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-3">
                            <Label className="text-subtitle font-medium">
                                {draft.passRule === 'AVERAGE'
                                    ? t('averageLabel')
                                    : t('passMarkLabel')}
                            </Label>
                            <MyInput
                                inputType="number"
                                input={String(draft.passPercent)}
                                onChangeFunction={(e) =>
                                    set({ passPercent: clampPercent(e.target.value) })
                                }
                                disabled={disabled}
                                className="w-24 sm:w-24"
                            />
                            <span className="text-body text-neutral-500">{t('percentSuffix')}</span>
                        </div>
                        {draft.passRule !== 'AVERAGE' && (
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="criteria-own-pass"
                                    checked={draft.useOwnPassPercent}
                                    disabled={disabled}
                                    onCheckedChange={(checked) =>
                                        set({ useOwnPassPercent: checked === true })
                                    }
                                />
                                <Label htmlFor="criteria-own-pass" className="text-body">
                                    {t('useOwnPass')}
                                </Label>
                            </div>
                        )}
                    </div>

                    {error ? (
                        <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3">
                            <Warning className="mt-0.5 size-4 shrink-0 text-danger-500" />
                            <p className="text-caption text-danger-600">{t(`errors.${error}`)}</p>
                        </div>
                    ) : (
                        tests && (
                            <div
                                className={cn(
                                    'flex items-start gap-2 rounded-md border p-3',
                                    counted.length === 0
                                        ? 'border-warning-200 bg-warning-50'
                                        : 'border-neutral-200 bg-neutral-50'
                                )}
                            >
                                {counted.length === 0 ? (
                                    <Warning className="mt-0.5 size-4 shrink-0 text-warning-500" />
                                ) : (
                                    <Info className="mt-0.5 size-4 shrink-0 text-neutral-500" />
                                )}
                                <div className="flex flex-col gap-1">
                                    <p className="text-caption font-medium text-neutral-700">
                                        {counted.length === 0
                                            ? t('summary.none')
                                            : t('summary.count', { count: counted.length })}
                                    </p>
                                    <p className="text-caption text-neutral-500">{t('notes')}</p>
                                </div>
                            </div>
                        )
                    )}
                </>
            )}
        </div>
    );
};

interface TestPickerProps {
    draft: CriteriaDraft;
    onChange: (next: CriteriaDraft) => void;
    tests: CertificateTestOption[] | undefined;
    isLoading: boolean;
    isError: boolean;
    disabled?: boolean;
}

/**
 * Module → chapter → test tree. Ticking a module or chapter stores its id (so tests
 * added there later count too); the tests it covers show as ticked and locked.
 */
const TestPicker = ({ draft, onChange, tests, isLoading, isError, disabled }: TestPickerProps) => {
    const { t } = useTranslation('studyLibraryCertificateCriteria');
    const groups = useMemo(() => groupTestsByModule(tests ?? []), [tests]);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
                <span className="text-caption text-neutral-500">{t('picker.loading')}</span>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/5" />
            </div>
        );
    }
    if (isError) {
        return (
            <p className="rounded-md border border-danger-200 bg-danger-50 p-3 text-caption text-danger-600">
                {t('picker.error')}
            </p>
        );
    }
    if (!tests || tests.length === 0) {
        return (
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-caption text-neutral-500">
                {t('picker.empty')}
            </p>
        );
    }

    const types = new Set<string>(draft.testTypes);

    return (
        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-md border border-neutral-200 p-3">
            {groups.map((group) => {
                const moduleOn = !!group.moduleId && draft.moduleIds.includes(group.moduleId);
                return (
                    <div key={group.key} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            {group.moduleId ? (
                                <Checkbox
                                    id={`criteria-module-${group.key}`}
                                    checked={moduleOn}
                                    disabled={disabled}
                                    onCheckedChange={(checked) =>
                                        onChange({
                                            ...draft,
                                            moduleIds: toggleId(
                                                draft.moduleIds,
                                                group.moduleId as string,
                                                checked === true
                                            ),
                                        })
                                    }
                                />
                            ) : null}
                            <Label
                                htmlFor={`criteria-module-${group.key}`}
                                className="text-body font-semibold text-neutral-700"
                            >
                                {group.moduleName ?? t('picker.noModule')}
                            </Label>
                            {group.subjectName && (
                                <span className="text-caption text-neutral-400">
                                    {group.subjectName}
                                </span>
                            )}
                        </div>

                        {group.chapters.map((chapter) => {
                            const chapterCovered = moduleOn;
                            const chapterOn =
                                chapterCovered ||
                                (!!chapter.chapterId &&
                                    draft.chapterIds.includes(chapter.chapterId));
                            return (
                                <div key={chapter.key} className="ms-6 flex flex-col gap-2">
                                    <div className="flex items-center gap-2">
                                        {chapter.chapterId ? (
                                            <Checkbox
                                                id={`criteria-chapter-${chapter.key}`}
                                                checked={chapterOn}
                                                disabled={disabled || chapterCovered}
                                                onCheckedChange={(checked) =>
                                                    onChange({
                                                        ...draft,
                                                        chapterIds: toggleId(
                                                            draft.chapterIds,
                                                            chapter.chapterId as string,
                                                            checked === true
                                                        ),
                                                    })
                                                }
                                            />
                                        ) : null}
                                        <Label
                                            htmlFor={`criteria-chapter-${chapter.key}`}
                                            className="text-body text-neutral-700"
                                        >
                                            {chapter.chapterName ?? t('picker.noChapter')}
                                        </Label>
                                    </div>
                                    {chapter.tests.map((test) => {
                                        const coveredByGroup = chapterOn && types.has(test.type);
                                        const picked = draft.slideIds.includes(test.slide_id);
                                        const live =
                                            !!test.status && LIVE_STATUSES.has(test.status);
                                        return (
                                            <div
                                                key={test.slide_id}
                                                className="ms-6 flex flex-wrap items-center gap-2"
                                            >
                                                <Checkbox
                                                    id={`criteria-test-${test.slide_id}`}
                                                    checked={coveredByGroup || picked}
                                                    disabled={disabled || coveredByGroup}
                                                    onCheckedChange={(checked) =>
                                                        onChange({
                                                            ...draft,
                                                            slideIds: toggleId(
                                                                draft.slideIds,
                                                                test.slide_id,
                                                                checked === true
                                                            ),
                                                        })
                                                    }
                                                />
                                                <Label
                                                    htmlFor={`criteria-test-${test.slide_id}`}
                                                    className="text-body text-neutral-600"
                                                >
                                                    {test.title || t('picker.untitled')}
                                                </Label>
                                                <Badge variant="outline">
                                                    {t(`type.${test.type}`)}
                                                </Badge>
                                                {test.own_pass_percent !== null && (
                                                    <span className="text-caption text-neutral-400">
                                                        {t('picker.ownPass', {
                                                            pct: test.own_pass_percent,
                                                        })}
                                                    </span>
                                                )}
                                                {!live && (
                                                    <span className="text-caption text-warning-600">
                                                        {t('picker.draft')}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
};
