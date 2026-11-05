import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WarningCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { CommentPlacementPicker } from '@/components/common/ai-copy-check/CommentPlacementPicker';
import {
    CopyCheckSettingsFields,
    EMPTY_COPY_CHECK_SETTINGS,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';
import {
    PenStylePicker,
    normalizePenStyle,
} from '@/components/common/ai-copy-check/PenStylePicker';
import { StudentMappingPicker } from '@/components/common/ai-copy-check/StudentMappingPicker';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import {
    loadAssessmentSettingsStrict,
    saveAssessmentSettings,
} from '@/services/assessment-settings';
import {
    mergeEvalezySettings,
    normalizeCommentPlacement,
    normalizeStudentMapping,
    type AiCopyCheckSettings,
    type AssessmentSettingsData,
} from '@/types/assessment-settings';
import { isUserAdmin } from '@/utils/userDetails';
import { EvalezyCopySettings } from './-components/EvalezyCopySettings';

export const Route = createFileRoute('/evalezy/settings')({
    component: EvalezySettings,
});

const Section = ({ children }: { children: React.ReactNode }) => (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
        {children}
    </section>
);

/**
 * The one place an Evalezy institute sets how its copies are checked. Nothing here is asked again
 * per batch: dispatch reads the pen, the instructions and the language check from these settings.
 */
function EvalezySettings() {
    const { t } = useTranslation('evalezy');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId() ?? '';
    const canEdit = isUserAdmin();
    // Strict: saving writes the whole settings document, so a failed read must never become a form
    // of defaults that one tap on Save would write over everything else the institute has set.
    const loaded = useQuery({
        queryKey: ['EVALEZY_EVALUATION_SETTINGS', instituteId],
        queryFn: loadAssessmentSettingsStrict,
        enabled: canEdit && !!instituteId,
        retry: false,
        refetchOnWindowFocus: false,
    });
    const [draft, setDraft] = useState<AssessmentSettingsData | null>(null);
    useEffect(() => {
        if (loaded.data) setDraft((current) => current ?? loaded.data);
    }, [loaded.data]);

    const save = useMutation({
        mutationFn: async (next: AssessmentSettingsData) => {
            // Read again just before writing, so settings changed elsewhere meanwhile survive.
            const latest = await loadAssessmentSettingsStrict();
            await saveAssessmentSettings({
                ...latest,
                aiCopyCheck: next.aiCopyCheck,
                evalezy: next.evalezy,
            });
        },
        onSuccess: (_, next) => {
            queryClient.setQueryData(['EVALEZY_EVALUATION_SETTINGS', instituteId], next);
            void queryClient.invalidateQueries({ queryKey: ['EVALEZY_SETTINGS'] });
            void queryClient.invalidateQueries({ queryKey: ['EVALEZY_CHECK_SETTINGS'] });
            toast.success(t('settings.saved'));
        },
        onError: () => toast.error(t('settings.saveFailed')),
    });

    if (!canEdit) {
        return (
            <Message>
                <h1 className="text-h3 font-semibold text-neutral-800">{t('settings.title')}</h1>
                <p className="text-body text-neutral-500">{t('settings.adminOnly')}</p>
            </Message>
        );
    }
    if (loaded.isError) {
        return (
            <Message>
                <WarningCircle size={28} className="text-danger-500" />
                <p className="text-body text-neutral-700">{t('settings.loadFailed')}</p>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => void loaded.refetch()}
                >
                    {t('common.retry')}
                </MyButton>
            </Message>
        );
    }
    if (!draft) return <DashboardLoader />;

    const ai: AiCopyCheckSettings = draft.aiCopyCheck ?? {
        commentPlacement: normalizeCommentPlacement(undefined),
    };
    const patchAi = (patch: Partial<AiCopyCheckSettings>) =>
        setDraft({ ...draft, aiCopyCheck: { ...ai, ...patch } });
    const dirty = JSON.stringify(draft) !== JSON.stringify(loaded.data);
    const busy = save.isPending;

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div>
                <h1 className="text-h3 font-semibold text-neutral-800">{t('settings.title')}</h1>
                <p className="text-body text-neutral-500">{t('settings.subtitle')}</p>
            </div>
            <Section>
                <PenStylePicker
                    disabled={busy}
                    value={normalizePenStyle(ai.penStyle)}
                    onChange={(penStyle) => patchAi({ penStyle })}
                />
            </Section>
            <Section>
                <CommentPlacementPicker
                    disabled={busy}
                    value={normalizeCommentPlacement(ai.commentPlacement)}
                    onChange={(commentPlacement) => patchAi({ commentPlacement })}
                />
            </Section>
            <Section>
                <CopyCheckSettingsFields
                    withPaper={false}
                    disabled={busy}
                    value={{
                        ...EMPTY_COPY_CHECK_SETTINGS,
                        instructions: ai.instructions ?? '',
                        languageFeedback: ai.languageFeedback ?? 'OFF',
                    }}
                    onChange={({ instructions, languageFeedback }) =>
                        patchAi({ instructions, languageFeedback })
                    }
                />
            </Section>
            <Section>
                <StudentMappingPicker
                    disabled={busy}
                    value={normalizeStudentMapping(ai.studentMapping)}
                    onChange={(studentMapping) => patchAi({ studentMapping })}
                />
            </Section>
            <Section>
                <EvalezyCopySettings
                    disabled={busy}
                    settings={mergeEvalezySettings(draft.evalezy)}
                    onChange={(evalezy) => setDraft({ ...draft, evalezy })}
                />
            </Section>
            <div className="pb-safe-3 sticky bottom-0 -mx-4 border-t border-neutral-200 bg-white px-4 py-3 sm:static sm:mx-0 sm:rounded-lg sm:border">
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    className="w-full"
                    disabled={!dirty || busy}
                    onClick={() => save.mutate(draft)}
                >
                    {busy ? t('settings.saving') : t('settings.save')}
                </MyButton>
            </div>
        </div>
    );
}

const Message = ({ children }: { children: React.ReactNode }) => (
    <div className="mt-10 flex flex-col items-center gap-3 rounded-lg border border-neutral-200 bg-white p-8 text-center">
        {children}
    </div>
);
