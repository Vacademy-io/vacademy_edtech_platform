import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Control, type UseFormSetValue, useWatch } from 'react-hook-form';
import { Info } from '@phosphor-icons/react';
import { Trans, useTranslation } from 'react-i18next';

import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { listZoomAccounts } from '@/services/zoom-accounts';

/**
 * Step-1 sub-form shown when the admin picks the Zoom platform.
 *
 * Renders the full set of Zoom create-meeting settings, grouped:
 *  - Account picker
 *  - Entry & security (waiting room, join before host, auth, approval, alt-hosts)
 *  - Audio / Video defaults
 *  - In-meeting features (recording, breakout, focus mode, watermark, multi-device)
 *
 * Field names mirror the Zoom REST API "settings" object — the backend's
 * ZoomMeetingManager.buildSettings re-keys to snake_case before sending.
 */
export function ZoomMeetingConfigField({
    control,
    setValue,
}: {
    control: Control<any>;
    setValue: UseFormSetValue<any>;
}) {
    const { t } = useTranslation('studyLibraryZoomMeetingConfigField');
    const selectedAccountId = useWatch({ control, name: 'zoomAccountId' });

    const { data: accounts = [], isLoading } = useQuery({
        queryKey: ['zoom-accounts'],
        queryFn: listZoomAccounts,
        staleTime: 60_000,
    });

    const activeAccounts = accounts.filter((a) => a.status === 'ACTIVE');

    // Preselect the default account once data loads.
    useEffect(() => {
        if (selectedAccountId || activeAccounts.length === 0) return;
        const preferred =
            activeAccounts.find((a) => a.isDefault)?.id ?? activeAccounts[0]?.id;
        if (preferred) {
            setValue('zoomAccountId', preferred, { shouldDirty: false });
        }
    }, [selectedAccountId, activeAccounts, setValue]);

    if (isLoading) {
        return (
            <div className="rounded-lg border border-neutral-200 p-4 text-sm text-neutral-400">
                {t('loadingAccounts')}
            </div>
        );
    }

    if (activeAccounts.length === 0) {
        return (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-800">
                <Info size={16} className="mt-0.5 shrink-0" />
                <div>
                    <Trans
                        t={t}
                        i18nKey="notSetUpMessage"
                        components={{ strong: <strong /> }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-primary-200 bg-primary-50/30 p-4">
            <h4 className="mb-3 text-sm font-semibold">{t('zoomMeetingSettings')}</h4>

            {/* Account picker */}
            <FormField
                control={control}
                name="zoomAccountId"
                render={({ field }) => (
                    <FormItem className="mb-4">
                        <FormLabel className="text-sm font-normal">{t('zoomAccount')}</FormLabel>
                        <FormControl>
                            <select
                                value={field.value ?? ''}
                                onChange={field.onChange}
                                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-72"
                            >
                                {activeAccounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.label}
                                        {a.isDefault ? ` ${t('defaultSuffix')}` : ''}
                                    </option>
                                ))}
                            </select>
                        </FormControl>
                    </FormItem>
                )}
            />

            <Section title={t('section.entrySecurity')}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <ToggleField
                        control={control}
                        name="zoomWaitingRoom"
                        label={t('field.enableWaitingRoom')}
                        dflt={true}
                    />
                    <ToggleField
                        control={control}
                        name="zoomJoinBeforeHost"
                        label={t('field.allowJoinBeforeHost')}
                        dflt={false}
                    />
                    <ToggleField
                        control={control}
                        name="zoomMeetingAuthentication"
                        label={t('field.requireZoomLogin')}
                        dflt={false}
                    />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                        control={control}
                        name="zoomApprovalType"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-normal">
                                    {t('field.registrationApproval')}
                                </FormLabel>
                                <FormControl>
                                    <select
                                        value={field.value ?? '2'}
                                        onChange={field.onChange}
                                        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                    >
                                        <option value="2">{t('approval.noneRequired')}</option>
                                        <option value="0">{t('approval.automatic')}</option>
                                        <option value="1">{t('approval.manual')}</option>
                                    </select>
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name="zoomAlternativeHosts"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-normal">
                                    {t('field.alternativeHosts')}
                                </FormLabel>
                                <FormControl>
                                    <input
                                        type="text"
                                        value={field.value ?? ''}
                                        onChange={field.onChange}
                                        placeholder={t('field.alternativeHostsPlaceholder')}
                                        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </div>
            </Section>

            <Section title={t('section.audioVideoDefaults')}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <ToggleField
                        control={control}
                        name="zoomMuteUponEntry"
                        label={t('field.muteOnEntry')}
                        dflt={true}
                    />
                    <ToggleField
                        control={control}
                        name="zoomHostVideo"
                        label={t('field.startHostVideoOn')}
                        dflt={false}
                    />
                    <ToggleField
                        control={control}
                        name="zoomParticipantVideo"
                        label={t('field.startParticipantVideoOn')}
                        dflt={false}
                    />
                </div>
                <div className="mt-3">
                    <FormField
                        control={control}
                        name="zoomAudio"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-normal">{t('field.audio')}</FormLabel>
                                <FormControl>
                                    <select
                                        value={field.value ?? 'both'}
                                        onChange={field.onChange}
                                        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-64"
                                    >
                                        <option value="both">{t('audio.computerAndTelephony')}</option>
                                        <option value="voip">{t('audio.computerOnly')}</option>
                                        <option value="telephony">{t('audio.telephonyOnly')}</option>
                                    </select>
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </div>
            </Section>

            <Section title={t('section.inMeetingFeatures')}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <ToggleField
                        control={control}
                        name="zoomBreakoutRoom"
                        label={t('field.enableBreakoutRooms')}
                        dflt={false}
                    />
                    <ToggleField
                        control={control}
                        name="zoomFocusMode"
                        label={t('field.startInFocusMode')}
                        dflt={false}
                    />
                    <ToggleField
                        control={control}
                        name="zoomAllowMultipleDevices"
                        label={t('field.allowMultipleDevices')}
                        dflt={false}
                    />
                    <ToggleField
                        control={control}
                        name="zoomWatermark"
                        label={t('field.addIdentityWatermark')}
                        dflt={false}
                    />
                </div>
                <div className="mt-3">
                    <FormField
                        control={control}
                        name="zoomAutoRecording"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-normal">
                                    {t('field.automaticRecording')}
                                </FormLabel>
                                <FormControl>
                                    <select
                                        value={field.value ?? 'cloud'}
                                        onChange={field.onChange}
                                        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-64"
                                    >
                                        <option value="cloud">{t('recording.cloud')}</option>
                                        <option value="local">
                                            {t('recording.local')}
                                        </option>
                                        <option value="none">{t('recording.none')}</option>
                                    </select>
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </div>
            </Section>
        </div>
    );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="mt-4 rounded-md border border-neutral-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {title}
            </div>
            {children}
        </div>
    );
}

export function ToggleField({
    control,
    name,
    label,
    dflt,
}: {
    control: Control<any>;
    name: string;
    label: string;
    dflt: boolean;
}) {
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                        <input
                            type="checkbox"
                            checked={field.value ?? dflt}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="size-4 rounded border-gray-300"
                        />
                    </FormControl>
                    <FormLabel className="text-sm font-normal">{label}</FormLabel>
                </FormItem>
            )}
        />
    );
}
