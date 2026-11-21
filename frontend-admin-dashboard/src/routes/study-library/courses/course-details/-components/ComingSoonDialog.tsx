import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowSquareOut, BellRinging, Info, Megaphone, Sparkle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { getInstituteId } from '@/constants/helper';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import {
    type ComingSoonSetting,
    COMING_SOON_SETTING_KEY,
    createComingSoonAudience,
    getComingSoonLeadCount,
    getComingSoonSetting,
    saveComingSoonSetting,
} from '@/services/coming-soon';
import { SendMessageDialog } from '@/routes/audience-manager/list/-components/campaign-users/SendMessageDialog';

const NAMESPACE = 'studyLibraryComingSoonDialog';

const settingQueryKey = (packageId: string) => [
    'package-setting',
    COMING_SOON_SETTING_KEY,
    packageId,
];

interface ComingSoonButtonProps {
    packageId: string;
    courseName: string;
    /** A course that is not on the catalogue cannot show there, Coming Soon or not. */
    publishedToCatalogue: boolean;
}

/**
 * Course header → "Coming soon". Shows the current state on the button itself so an admin can
 * see at a glance that a course is not sellable on the website yet.
 */
export const ComingSoonButton: React.FC<ComingSoonButtonProps> = ({
    packageId,
    courseName,
    publishedToCatalogue,
}) => {
    const { t } = useTranslation(NAMESPACE);
    const [open, setOpen] = useState(false);
    const { data } = useQuery({
        queryKey: settingQueryKey(packageId),
        queryFn: () => getComingSoonSetting(packageId),
        staleTime: 60_000,
    });
    const enabled = data?.enabled === true;

    return (
        <>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                onClick={() => setOpen(true)}
                className={enabled ? 'border-primary-500 text-primary-500' : undefined}
            >
                <Sparkle size={16} weight={enabled ? 'fill' : 'regular'} />
                {enabled ? t('buttonOn') : t('buttonOff')}
            </MyButton>
            {open && (
                <ComingSoonDialog
                    open={open}
                    onOpenChange={setOpen}
                    packageId={packageId}
                    courseName={courseName}
                    publishedToCatalogue={publishedToCatalogue}
                />
            )}
        </>
    );
};

interface ComingSoonDialogProps extends ComingSoonButtonProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ComingSoonDialog: React.FC<ComingSoonDialogProps> = ({
    open,
    onOpenChange,
    packageId,
    courseName,
    publishedToCatalogue,
}) => {
    const { t } = useTranslation(NAMESPACE);
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const [saved, setSaved] = useState<ComingSoonSetting | null>(null);
    const [draft, setDraft] = useState<ComingSoonSetting>({ enabled: false });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [leadCount, setLeadCount] = useState<number | null>(null);
    // Shown right after the course goes live, when people are waiting on it.
    const [justWentLive, setJustWentLive] = useState(false);
    const [sendOpen, setSendOpen] = useState(false);

    useEffect(() => {
        let active = true;
        setLoading(true);
        getComingSoonSetting(packageId)
            .then((setting) => {
                if (!active) return;
                setSaved(setting);
                setDraft(setting);
                if (setting.audienceId) {
                    getComingSoonLeadCount(setting.audienceId)
                        .then((n) => active && setLeadCount(n))
                        .catch(() => active && setLeadCount(null));
                }
            })
            .catch(() => active && toast.error(t('loadFailed')))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [packageId, t]);

    const update = (patch: Partial<ComingSoonSetting>) => setDraft((d) => ({ ...d, ...patch }));

    const handleSave = async () => {
        setSaving(true);
        try {
            const next: ComingSoonSetting = {
                ...draft,
                launchDate: draft.launchDate || undefined,
                ribbonText: draft.ribbonText?.trim() || undefined,
                buttonText: draft.buttonText?.trim() || undefined,
            };
            // First switch-on: give the course its own lead list, so the launch message
            // later reaches exactly the people who asked about THIS course.
            if (next.enabled && !next.audienceId) {
                const listName = t('listName', { course: courseName });
                const token = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
                const userId = (token as { sub?: string } | null)?.sub;
                next.audienceId = await createComingSoonAudience(courseName, listName, userId);
                next.audienceName = listName;
                // Kept even if the save below fails, so a retry reuses this list
                // instead of creating a second one.
                update({ audienceId: next.audienceId, audienceName: listName });
                setLeadCount(0);
            }
            await saveComingSoonSetting(packageId, next);
            const wentLive = saved?.enabled === true && !next.enabled;
            setSaved(next);
            setDraft(next);
            queryClient.setQueryData(settingQueryKey(packageId), next);
            toast.success(next.enabled ? t('savedOn') : t('savedOff'));
            if (wentLive && next.audienceId && (leadCount ?? 0) > 0) {
                setJustWentLive(true);
            } else {
                onOpenChange(false);
            }
        } catch {
            toast.error(t('saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const openLeadList = () => {
        if (!draft.audienceId) return;
        navigate({
            to: '/audience-manager/list/campaign-users',
            search: { campaignId: draft.audienceId, campaignName: draft.audienceName || '' },
        });
    };

    const instituteId = getInstituteId() ?? '';
    const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

    if (justWentLive && draft.audienceId) {
        return (
            <>
                <MyDialog
                    heading={t('liveHeading')}
                    open={open && !sendOpen}
                    onOpenChange={onOpenChange}
                    dialogWidth="w-full max-w-lg"
                    footer={
                        <div className="flex w-full justify-end gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                onClick={() => onOpenChange(false)}
                            >
                                {t('notNow')}
                            </MyButton>
                            <MyButton type="button" onClick={() => setSendOpen(true)}>
                                <Megaphone size={16} />
                                {t('notifyThem', { count: leadCount ?? 0 })}
                            </MyButton>
                        </div>
                    }
                >
                    <div className="flex items-start gap-3 p-1">
                        <BellRinging className="mt-0.5 size-6 shrink-0 text-primary-500" />
                        <div className="space-y-1">
                            <p className="text-body font-semibold text-neutral-700">
                                {t('liveTitle', { count: leadCount ?? 0 })}
                            </p>
                            <p className="text-caption text-neutral-500">{t('liveBody')}</p>
                        </div>
                    </div>
                </MyDialog>
                <SendMessageDialog
                    open={sendOpen}
                    onOpenChange={(o) => {
                        setSendOpen(o);
                        if (!o) onOpenChange(false);
                    }}
                    campaignId={draft.audienceId}
                    campaignName={draft.audienceName || courseName}
                    instituteId={instituteId}
                    customFields={[]}
                    leadCount={leadCount ?? 0}
                />
            </>
        );
    }

    return (
        <>
            <MyDialog
                heading={t('heading')}
                open={open && !sendOpen}
                onOpenChange={onOpenChange}
                dialogWidth="w-full max-w-lg"
                footer={
                    <div className="flex w-full justify-end gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            onClick={() => onOpenChange(false)}
                            disabled={saving}
                        >
                            {t('cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            onClick={handleSave}
                            disabled={loading || saving || !dirty}
                        >
                            {saving ? t('saving') : t('save')}
                        </MyButton>
                    </div>
                }
            >
                {loading ? (
                    <div className="space-y-3 p-1">
                        <div className="h-10 animate-pulse rounded-md bg-neutral-100" />
                        <div className="h-24 animate-pulse rounded-md bg-neutral-100" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 p-1">
                        <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                                <Label
                                    htmlFor="course-coming-soon"
                                    className="flex items-center gap-2"
                                >
                                    <Sparkle className="size-4 text-primary-500" />
                                    {t('switchLabel')}
                                </Label>
                                <p className="text-caption text-neutral-500">{t('switchHelp')}</p>
                            </div>
                            <Switch
                                id="course-coming-soon"
                                checked={draft.enabled}
                                onCheckedChange={(v) => update({ enabled: v })}
                                disabled={saving}
                            />
                        </div>

                        {!publishedToCatalogue && (
                            <div className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-caption text-warning-700">
                                <Info className="mt-0.5 size-4 shrink-0" />
                                <span>{t('notPublishedWarning')}</span>
                            </div>
                        )}

                        {draft.enabled && (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <MyInput
                                    inputType="date"
                                    label={t('launchDate')}
                                    input={draft.launchDate ?? ''}
                                    onChangeFunction={(e) => update({ launchDate: e.target.value })}
                                    className="w-full sm:w-full"
                                />
                                <MyInput
                                    inputType="text"
                                    label={t('ribbonText')}
                                    inputPlaceholder={t('ribbonPlaceholder')}
                                    input={draft.ribbonText ?? ''}
                                    onChangeFunction={(e) => update({ ribbonText: e.target.value })}
                                    className="w-full sm:w-full"
                                    maxLength={24}
                                />
                                <MyInput
                                    inputType="text"
                                    label={t('buttonText')}
                                    inputPlaceholder={t('buttonPlaceholder')}
                                    input={draft.buttonText ?? ''}
                                    onChangeFunction={(e) => update({ buttonText: e.target.value })}
                                    className="w-full sm:w-full"
                                    maxLength={32}
                                />
                            </div>
                        )}

                        <div className="space-y-2 rounded-md bg-neutral-50 p-3 text-caption text-neutral-600">
                            {draft.audienceId ? (
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span>
                                        {t('leadsGoTo', { list: draft.audienceName || courseName })}
                                        {leadCount !== null && (
                                            <span className="ms-1 font-semibold text-neutral-700">
                                                {t('waitingCount', { count: leadCount })}
                                            </span>
                                        )}
                                    </span>
                                    <div className="flex gap-2">
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            onClick={openLeadList}
                                        >
                                            <ArrowSquareOut size={14} />
                                            {t('openList')}
                                        </MyButton>
                                        {(leadCount ?? 0) > 0 && (
                                            <MyButton
                                                type="button"
                                                buttonType="text"
                                                scale="small"
                                                onClick={() => setSendOpen(true)}
                                            >
                                                <Megaphone size={14} />
                                                {t('messageThem')}
                                            </MyButton>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <span>
                                    {t('listWillBeCreated', {
                                        list: t('listName', { course: courseName }),
                                    })}
                                </span>
                            )}
                            <p>{t('websiteHint')}</p>
                        </div>
                    </div>
                )}
            </MyDialog>
            {draft.audienceId && (
                <SendMessageDialog
                    open={sendOpen}
                    onOpenChange={setSendOpen}
                    campaignId={draft.audienceId}
                    campaignName={draft.audienceName || courseName}
                    instituteId={instituteId}
                    customFields={[]}
                    leadCount={leadCount ?? 0}
                />
            )}
        </>
    );
};
