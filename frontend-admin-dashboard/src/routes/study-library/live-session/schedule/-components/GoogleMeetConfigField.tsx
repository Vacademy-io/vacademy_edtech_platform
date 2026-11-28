import { useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { type Control, type UseFormSetValue, useWatch } from 'react-hook-form';
import { Info, Warning } from '@phosphor-icons/react';

import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { listGoogleAccounts } from '@/services/google-accounts';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';
import type { LiveSessionSettings } from '@/services/live-session-settings';
import { Section, ToggleField } from './ZoomMeetingConfigField';

/** Per-class Meet toggles pre-filled from Settings → Live Session → Google Meet Controls. */
const INSTITUTE_DEFAULTS: [string, keyof LiveSessionSettings][] = [
    ['googleTranscription', 'defaultGoogleMeetTranscription'],
    ['googleSmartNotes', 'defaultGoogleMeetSmartNotes'],
    ['googleAttendanceReport', 'defaultGoogleMeetAttendanceReport'],
    ['googleHostManagement', 'defaultGoogleMeetHostManagement'],
    ['googleChatHostsOnly', 'defaultGoogleMeetChatHostsOnly'],
    ['googleReactionsHostsOnly', 'defaultGoogleMeetReactionsHostsOnly'],
    ['googlePresentHostsOnly', 'defaultGoogleMeetPresentHostsOnly'],
    ['googleJoinAsViewer', 'defaultGoogleMeetJoinAsViewer'],
];

/**
 * Step-1 sub-form shown when the admin picks the Google Meet platform.
 *
 * Account picker + the per-class Meet space settings (backend GoogleMeetManager.buildSpaceConfig):
 * join access, auto recording / transcript / Gemini notes / attendance report, and host controls.
 * Recording and join access start from the account's defaults. When a connected account is chosen
 * the backend auto-generates a Meet space (no pasted link); when none is connected the admin
 * pastes a link as before. Mirrors {@code ZoomMeetingConfigField}.
 */
export function GoogleMeetConfigField({
    control,
    setValue,
}: {
    control: Control<any>;
    setValue: UseFormSetValue<any>;
}) {
    const { t } = useTranslation('studyLibraryGoogleMeetConfigField');
    const selectedAccountId = useWatch({ control, name: 'googleMeetAccountId' });

    const { data: accounts = [], isLoading } = useQuery({
        queryKey: ['google-accounts'],
        queryFn: listGoogleAccounts,
        staleTime: 60_000,
    });

    const activeAccounts = accounts.filter((a) => a.status === 'ACTIVE');

    // Preselect the default (or only) account once data loads.
    useEffect(() => {
        if (selectedAccountId || activeAccounts.length === 0) return;
        const preferred = activeAccounts.find((a) => a.isDefault)?.id ?? activeAccounts[0]?.id;
        if (preferred) {
            setValue('googleMeetAccountId', preferred, { shouldDirty: false });
        }
    }, [selectedAccountId, activeAccounts, setValue]);

    const record = useWatch({ control, name: 'googleRecord' });
    const accessType = useWatch({ control, name: 'googleAccessType' });
    const hostManagement = useWatch({ control, name: 'googleHostManagement' });

    // Recording and join access start from the chosen account's defaults. Fill them only while
    // unset or when the admin picks another account — coming back to step 1 remounts this
    // component with the saved step-1 values, which must be kept.
    const lastAccountId = useRef<string | undefined>(selectedAccountId);
    useEffect(() => {
        const account = activeAccounts.find((a) => a.id === selectedAccountId);
        if (!account) return;
        const switched = !!lastAccountId.current && lastAccountId.current !== account.id;
        lastAccountId.current = account.id;
        if (switched || record === undefined) {
            setValue('googleRecord', !!account.recordingEnabled, { shouldDirty: false });
        }
        if (switched || accessType === undefined) {
            setValue('googleAccessType', account.defaultAccessType || 'OPEN', {
                shouldDirty: false,
            });
        }
    }, [selectedAccountId, activeAccounts, record, accessType, setValue]);

    // Institute defaults fill only the toggles that are still unset, once the settings have
    // loaded — values saved in step 1 (coming back from step 2) are kept.
    const { settings: liveSessionSettings, isLoading: settingsLoading } = useLiveSessionSettings();
    const toggleValues = useWatch({ control, name: INSTITUTE_DEFAULTS.map(([field]) => field) });
    useEffect(() => {
        if (settingsLoading) return;
        INSTITUTE_DEFAULTS.forEach(([field, settingKey], i) => {
            if (toggleValues[i] === undefined) {
                setValue(field, !!liveSessionSettings[settingKey], { shouldDirty: false });
            }
        });
    }, [settingsLoading, liveSessionSettings, toggleValues, setValue]);

    if (isLoading) {
        return (
            <div className="rounded-lg border border-neutral-200 p-4 text-sm text-neutral-400">
                {t('loadingGoogleAccounts')}
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

    const selected = activeAccounts.find((a) => a.id === selectedAccountId);

    return (
        <div className="rounded-lg border border-primary-200 bg-primary-50/30 p-4">
            <h4 className="mb-3 text-sm font-semibold">{t('googleMeetSettings')}</h4>

            {/* Account picker */}
            <FormField
                control={control}
                name="googleMeetAccountId"
                render={({ field }) => (
                    <FormItem className="mb-3">
                        <FormLabel className="text-sm font-normal">{t('googleAccountOrganizer')}</FormLabel>
                        <FormControl>
                            <select
                                value={field.value ?? ''}
                                onChange={field.onChange}
                                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-72"
                            >
                                {activeAccounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.organizerEmail}
                                        {a.isDefault ? ` ${t('defaultSuffix')}` : ''}
                                    </option>
                                ))}
                            </select>
                        </FormControl>
                    </FormItem>
                )}
            />

            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-800">
                <Info size={14} className="mt-0.5 shrink-0" />
                <div className="leading-relaxed">
                    {t('linkCreatedOnAccount')} {t('settingsApplyToNewLinks')}
                </div>
            </div>

            <Section title={t('section.joinAccess')}>
                <FormField
                    control={control}
                    name="googleAccessType"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-sm font-normal">
                                {t('field.whoCanJoin')}
                            </FormLabel>
                            <FormControl>
                                <select
                                    value={field.value ?? 'OPEN'}
                                    onChange={field.onChange}
                                    className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-72"
                                >
                                    <option value="OPEN">{t('access.open')}</option>
                                    <option value="TRUSTED">{t('access.trusted')}</option>
                                    <option value="RESTRICTED">{t('access.restricted')}</option>
                                </select>
                            </FormControl>
                        </FormItem>
                    )}
                />
                <p className="mt-1 text-xs text-neutral-500">
                    {(accessType ?? 'OPEN') === 'OPEN'
                        ? t('anyoneWithLinkJoins')
                        : t('guestsMustKnock')}
                </p>
            </Section>

            <Section title={t('section.recordingAndNotes')}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <ToggleField
                        control={control}
                        name="googleRecord"
                        label={t('field.autoRecord')}
                        dflt={!!selected?.recordingEnabled}
                    />
                    <ToggleField
                        control={control}
                        name="googleTranscription"
                        label={t('field.autoTranscript')}
                        dflt={false}
                    />
                    <ToggleField
                        control={control}
                        name="googleSmartNotes"
                        label={t('field.geminiNotes')}
                        dflt={false}
                    />
                    <ToggleField
                        control={control}
                        name="googleAttendanceReport"
                        label={t('field.attendanceReport')}
                        dflt={false}
                    />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-neutral-500">{t('planHint')}</p>
            </Section>

            <Section title={t('section.hostControls')}>
                <ToggleField
                    control={control}
                    name="googleHostManagement"
                    label={t('field.hostManagement')}
                    dflt={false}
                />
                {hostManagement && (
                    <>
                        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <ToggleField
                                control={control}
                                name="googleChatHostsOnly"
                                label={t('field.chatHostsOnly')}
                                dflt={false}
                            />
                            <ToggleField
                                control={control}
                                name="googleReactionsHostsOnly"
                                label={t('field.reactionsHostsOnly')}
                                dflt={false}
                            />
                            <ToggleField
                                control={control}
                                name="googlePresentHostsOnly"
                                label={t('field.presentHostsOnly')}
                                dflt={false}
                            />
                            <ToggleField
                                control={control}
                                name="googleJoinAsViewer"
                                label={t('field.joinAsViewer')}
                                dflt={false}
                            />
                        </div>
                        <div className="mt-3 flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700">
                            <Warning size={14} className="mt-0.5 shrink-0" />
                            <div className="leading-relaxed">
                                {t('hostControlsWarning', {
                                    email: selected?.organizerEmail ?? '',
                                })}
                            </div>
                        </div>
                    </>
                )}
            </Section>
        </div>
    );
}
