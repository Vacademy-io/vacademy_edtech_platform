import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppleLogo, Info } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import type { CheckIssue, LinkKind, LinkTarget } from '../../-types/learner-home-types';
import {
    emptyLinkDraft,
    FEATURE_INFO,
    isFeatureKey,
    normalizeUrl,
    offeredFeatures,
    PICKER_LINK_KINDS,
    readerModeEffect,
    toLinkDraft,
    toLinkTarget,
    type LinkDraft,
} from '../../-utils/link-target';
import {
    useAssessmentOptions,
    useCourseOptions,
    useCourseTagOptions,
    useHasStoreSite,
    useLiveSessionOptions,
    useProductPageOptions,
} from '../../-hooks/usePickerOptions';
import type { PickerOption } from '../../-services/learner-home-service';
import { LIMITS } from '../../-utils/publish-checks';
import { FieldIssues } from './FieldIssues';
import { under } from './issues';

const NONE = '__none__';
const ALL_COURSES = '__all__';

interface LinkTargetPickerProps {
    id: string;
    label: string;
    value: LinkTarget | null;
    onChange: (next: LinkTarget | null) => void;
    /** Offer "No link" (slides, optional buttons). */
    allowNone?: boolean;
    issues: CheckIssue[];
    path: string;
}

const sameLink = (a: LinkTarget | null, b: LinkTarget | null) =>
    JSON.stringify(a) === JSON.stringify(b);

/**
 * The one link picker (spec 6.1, 8.3). It edits a flat draft and stores only
 * a complete link; while the admin is still choosing, the stored link is null.
 */
export function LinkTargetPicker({
    id,
    label,
    value,
    onChange,
    allowNone = true,
    issues,
    path,
}: LinkTargetPickerProps) {
    const { t } = useTranslation('learnerHome');
    const [draft, setDraft] = useState<LinkDraft | null>(() => toLinkDraft(value));

    // A change from outside (undo of a block, a reload) wins over the local draft.
    useEffect(() => {
        if (!sameLink(toLinkTarget(draft), value) && (value !== null || draft === null)) {
            setDraft(toLinkDraft(value));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const update = (next: LinkDraft | null) => {
        setDraft(next);
        const target = toLinkTarget(next);
        if (!sameLink(target, value)) onChange(target);
    };

    const kind: LinkKind | typeof NONE = draft?.kind ?? NONE;
    const kinds: LinkKind[] =
        kind === 'APP_PATH' ? [...PICKER_LINK_KINDS, 'APP_PATH'] : [...PICKER_LINK_KINDS];
    const target = toLinkTarget(draft);
    const reader = readerModeEffect(target);

    return (
        <div className="space-y-2">
            <Label htmlFor={`${id}-kind`}>{label}</Label>
            <Select
                value={kind}
                onValueChange={(v) => update(v === NONE ? null : emptyLinkDraft(v as LinkKind))}
            >
                <SelectTrigger id={`${id}-kind`} aria-label={t('link.kind')}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {allowNone && <SelectItem value={NONE}>{t('link.none')}</SelectItem>}
                    {!allowNone && kind === NONE && (
                        <SelectItem value={NONE} disabled>
                            {t('link.kind')}
                        </SelectItem>
                    )}
                    {kinds.map((k) => (
                        <SelectItem key={k} value={k}>
                            {t(`link.kinds.${k}`)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {draft && <LinkValueField id={id} draft={draft} onChange={update} />}

            {reader !== 'none' && (
                <p className="flex items-start gap-1.5 text-caption text-neutral-600">
                    <AppleLogo className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {t(`link.reader.${reader}`)}
                </p>
            )}
            {target?.kind === 'FEATURE' && FEATURE_INFO[target.feature].condition !== 'always' && (
                <p className="flex items-start gap-1.5 text-caption text-neutral-600">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {t(`link.conditions.${FEATURE_INFO[target.feature].condition}`)}
                </p>
            )}
            <FieldIssues issues={under(issues, path)} />
        </div>
    );
}

function withMissing(options: PickerOption[], value: string, missingLabel: string): PickerOption[] {
    if (!value || options.some((o) => o.value === value)) return options;
    return [{ value, label: missingLabel }, ...options];
}

function LinkValueField({
    id,
    draft,
    onChange,
}: {
    id: string;
    draft: LinkDraft;
    onChange: (next: LinkDraft) => void;
}) {
    const { t } = useTranslation('learnerHome');
    const courses = useCourseOptions();
    const tags = useCourseTagOptions();
    const hasStoreSite = useHasStoreSite();
    const pages = useProductPageOptions(draft.kind === 'PRODUCT_PAGE');
    const sessions = useLiveSessionOptions(draft.kind === 'LIVE_CLASS');
    const assessments = useAssessmentOptions(draft.kind === 'ASSESSMENT');
    const set = (value: string) => onChange({ ...draft, value });
    const missing = t('link.unknownOption', { id: draft.value });

    const featureOptions = useMemo(() => {
        const list = offeredFeatures(hasStoreSite);
        if (isFeatureKey(draft.value) && !list.includes(draft.value)) list.push(draft.value);
        return list;
    }, [hasStoreSite, draft.value]);

    const searchable = (
        options: PickerOption[] | undefined,
        loading: boolean,
        placeholder: string
    ) => (
        <SearchableSelect
            options={withMissing(options ?? [], draft.value, missing).map((o) => ({
                value: o.value,
                label: o.hint ? `${o.label} · ${o.hint}` : o.label,
            }))}
            value={draft.value}
            onChange={set}
            placeholder={loading ? t('link.loading') : placeholder}
            emptyText={t('link.noOptions')}
        />
    );

    switch (draft.kind) {
        case 'COURSE':
            return searchable(courses, false, t('link.pickCourse'));
        case 'PRODUCT_PAGE':
            return searchable(pages.data, pages.isLoading, t('link.pickPage'));
        case 'LIVE_CLASS':
            return searchable(sessions.data, sessions.isLoading, t('link.pickSession'));
        case 'ASSESSMENT':
            return searchable(assessments.data, assessments.isLoading, t('link.pickAssessment'));
        case 'COURSE_LIST':
            return (
                <Select
                    value={draft.value || ALL_COURSES}
                    onValueChange={(v) => set(v === ALL_COURSES ? '' : v)}
                >
                    <SelectTrigger aria-label={t('link.pickTag')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL_COURSES}>{t('link.allCourses')}</SelectItem>
                        {withMissing(tags, draft.value, missing).map((tag) => (
                            <SelectItem key={tag.value} value={tag.value}>
                                {tag.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        case 'FEATURE':
            return (
                <Select value={draft.value} onValueChange={set}>
                    <SelectTrigger aria-label={t('link.pickFeature')}>
                        <SelectValue placeholder={t('link.pickFeature')} />
                    </SelectTrigger>
                    <SelectContent>
                        {featureOptions.map((f) => (
                            <SelectItem key={f} value={f}>
                                {t(`link.features.${f}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        case 'URL': {
            const res = draft.value.trim() ? normalizeUrl(draft.value) : null;
            const problem = res && 'problem' in res ? res.problem : null;
            return (
                <div className="space-y-2">
                    <Input
                        id={`${id}-url`}
                        type="url"
                        inputMode="url"
                        maxLength={LIMITS.url}
                        value={draft.value}
                        placeholder={t('link.urlPlaceholder')}
                        onChange={(e) => set(e.target.value)}
                        aria-invalid={!!problem}
                    />
                    {problem && (
                        <p className="text-caption text-danger-600">
                            {t(`link.urlProblems.${problem}`)}
                        </p>
                    )}
                    <div className="flex items-start gap-2">
                        <Checkbox
                            id={`${id}-sells`}
                            checked={draft.sellsSomething}
                            onCheckedChange={(v) =>
                                onChange({ ...draft, sellsSomething: v === true })
                            }
                            className="mt-0.5"
                        />
                        <Label htmlFor={`${id}-sells`} className="font-normal leading-snug">
                            {t('link.sellsSomething')}
                        </Label>
                    </div>
                </div>
            );
        }
        case 'APP_PATH':
            return (
                <p className="rounded-md bg-warning-50 px-3 py-2 text-caption text-warning-700">
                    {t('link.imported', { path: draft.value })}
                </p>
            );
    }
}
