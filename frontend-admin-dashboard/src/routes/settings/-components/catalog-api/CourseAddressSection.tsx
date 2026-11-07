import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleNotch, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { apiKeyErrorMessage } from '../../-services/evaluation-api-keys';
import {
    CATALOG_SETTINGS_QUERY_KEY,
    MAX_COURSE_BASE_URL_LENGTH,
    courseBaseUrlError,
    courseBaseUrlSource,
    fetchCatalogSettings,
    resetCourseBaseUrl,
    saveCourseBaseUrl,
    type CatalogApiSettings,
} from '../../-services/catalog-api';
import { CopyField } from './CopyField';

/**
 * "Course page address": where each course's `url` in the API points (the hosted course
 * site). Shows what the server resolved and why, and lets the admin override it.
 */
export function CourseAddressSection({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('settingsIntegration');
    const queryClient = useQueryClient();
    const queryKey = [CATALOG_SETTINGS_QUERY_KEY, instituteId];

    const [override, setOverride] = useState('');
    const [overrideError, setOverrideError] = useState<string | null>(null);

    const settingsQuery = useQuery({
        queryKey,
        queryFn: () => fetchCatalogSettings(instituteId),
        enabled: Boolean(instituteId),
        staleTime: 60_000,
        retry: false,
    });
    const settings = settingsQuery.data;
    const savedOverride = settings?.courseBaseUrl ?? '';

    // Load the saved override into the input once it arrives (and after save / reset).
    useEffect(() => {
        setOverride(savedOverride);
    }, [savedOverride]);

    const onSaved = (next: CatalogApiSettings) => {
        queryClient.setQueryData(queryKey, next);
        setOverrideError(null);
    };

    const saveMutation = useMutation({
        mutationFn: (value: string) => saveCourseBaseUrl(instituteId, value),
        onSuccess: (next) => {
            onSaved(next);
            toast.success(t('catalogApi.address.toasts.saved'));
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('catalogApi.address.toasts.saveFailed'));
        },
    });

    const resetMutation = useMutation({
        mutationFn: () => resetCourseBaseUrl(instituteId),
        onSuccess: (next) => {
            onSaved(next);
            setOverride('');
            toast.success(t('catalogApi.address.toasts.reset'));
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('catalogApi.address.toasts.resetFailed'));
        },
    });
    const busy = saveMutation.isPending || resetMutation.isPending;

    const submit = () => {
        const code = courseBaseUrlError(override);
        if (code) {
            setOverrideError(t(`catalogApi.address.errors.${code}`));
            return;
        }
        setOverrideError(null);
        saveMutation.mutate(override);
    };

    const source = settings ? courseBaseUrlSource(settings) : 'none';
    const resolvedUrl = settings?.resolved.courseBaseUrl ?? null;
    const resolvedTag = settings?.resolved.siteTag ?? null;

    return (
        <section className="flex flex-col gap-3">
            <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800">
                    {t('catalogApi.address.title')}
                </p>
                <p className="text-caption text-neutral-500">
                    {t('catalogApi.address.description')}
                </p>
            </div>

            {settingsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
                    <CircleNotch className="size-4 animate-spin text-primary-500" />
                    {t('catalogApi.loading')}
                </div>
            ) : settingsQuery.error || !settings ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-700">
                    <span>
                        {apiKeyErrorMessage(settingsQuery.error) ??
                            t('catalogApi.address.loadError')}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => void settingsQuery.refetch()}
                    >
                        {t('catalogApi.retry')}
                    </MyButton>
                </div>
            ) : (
                <div className="flex flex-col gap-4 rounded-lg border p-4">
                    {resolvedUrl ? (
                        <div className="flex flex-col gap-1">
                            <CopyField
                                label={t('catalogApi.address.current')}
                                value={resolvedUrl}
                            />
                            <p className="text-caption text-neutral-500">
                                {t(`catalogApi.address.source.${source}`)}
                                {resolvedTag && (
                                    <>
                                        {' · '}
                                        {t('catalogApi.address.site', { tag: resolvedTag })}
                                    </>
                                )}
                            </p>
                        </div>
                    ) : (
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                            <Warning className="mt-0.5 size-4 shrink-0" />
                            <span>
                                <span className="font-medium">
                                    {t('catalogApi.address.source.none')}
                                </span>
                                {'. '}
                                {t('catalogApi.address.noneHint')}
                            </span>
                        </div>
                    )}

                    <form
                        className="flex flex-col gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!busy) submit();
                        }}
                    >
                        <MyInput
                            inputType="text"
                            inputMode="url"
                            label={t('catalogApi.address.overrideLabel')}
                            inputPlaceholder={t('catalogApi.address.overridePlaceholder')}
                            input={override}
                            maxLength={MAX_COURSE_BASE_URL_LENGTH}
                            className="sm:w-full"
                            error={overrideError}
                            onChangeFunction={(e) => {
                                setOverride(e.target.value);
                                setOverrideError(null);
                            }}
                        />
                        <p className="text-caption text-neutral-500">
                            {t('catalogApi.address.overrideHint')}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                            <MyButton
                                type="submit"
                                buttonType="secondary"
                                scale="medium"
                                disable={busy || override.trim() === savedOverride}
                            >
                                {saveMutation.isPending && (
                                    <CircleNotch className="size-4 animate-spin" />
                                )}
                                {t('catalogApi.address.save')}
                            </MyButton>
                            {savedOverride && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="medium"
                                    disable={busy}
                                    onClick={() => resetMutation.mutate()}
                                >
                                    {resetMutation.isPending && (
                                        <CircleNotch className="size-4 animate-spin" />
                                    )}
                                    {t('catalogApi.address.reset')}
                                </MyButton>
                            )}
                        </div>
                    </form>
                </div>
            )}
        </section>
    );
}
