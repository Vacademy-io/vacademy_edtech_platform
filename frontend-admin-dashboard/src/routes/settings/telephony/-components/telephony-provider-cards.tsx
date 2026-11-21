import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    AddressBook,
    GridNine,
    Phone,
    PhoneIncoming,
    Plug,
    Robot,
    Waveform,
    type Icon,
} from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchTelephonyConfig, fetchTelephonyProviders } from '../-services/telephony-admin';
import { TelephonyConfigCard } from './telephony-config-card';
import { TelephonyCounsellorMapCard } from './telephony-counsellor-map-card';
import { TelephonyNumbersCard } from './telephony-numbers-card';
import { InboundSetupGuideCard } from './inbound-setup-guide-card';
import { TelephonyCreditsCard } from './telephony-credits-card';
import { IvrBuilderCard } from './ivr-builder-card';
import { VacademyVoiceConfigCard } from './vacademy-voice-config-card';
import { AiVoiceCarrierCard } from './ai-voice-carrier-card';

type TelephonyTabKey =
    | 'provider'
    | 'numbers'
    | 'ivr'
    | 'ai-line'
    | 'voice'
    | 'extensions'
    | 'inbound';

interface TelephonyTab {
    key: TelephonyTabKey;
    label: string;
    icon: Icon;
    content: ReactNode;
}

/**
 * Provider-aware Calling settings, one tab per card. The Provider tab (the
 * Config card, where you pick + configure the provider) is ALWAYS shown. Every
 * other tab is gated by the ACTIVE provider's capability flags so each vendor
 * only sees what applies to it, instead of a one-size-fits-all stack:
 *
 *   • Exotel — `BALANCE` → wallet, `SYNC_INBOUND_APPLET` → inbound-flow guide,
 *     `NUMBER_POOL` → the ExoPhone number fleet.
 *   • Airtel — no pool (`OUTBOUND_CALL` && !`NUMBER_POOL`) → the per-counsellor
 *     extension map.
 *
 * The capabilities come from `GET /telephony/providers`; the active provider
 * from the institute's config. Both queries share the cache with the individual
 * cards, so there are no extra fetches. Until they load (or before a provider is
 * configured) only the Provider tab shows — the right tabs appear on resolve.
 *
 * Every tab stays mounted (`forceMount`, hidden while inactive) so switching
 * tabs never drops a card's unsaved edits or refetches its data.
 */
export function TelephonyProviderCards() {
    const instituteId = getCurrentInstituteId() ?? '';
    // A link can open a tab directly (e.g. /settings/telephony#ai-line from AI Calling);
    // a tab this institute does not have falls back to Provider below.
    const [activeTab, setActiveTab] = useState<TelephonyTabKey>(() =>
        typeof window !== 'undefined' && window.location.hash === '#ai-line'
            ? 'ai-line'
            : 'provider'
    );

    const configQuery = useQuery({
        queryKey: ['telephony-config', instituteId],
        queryFn: () => fetchTelephonyConfig(instituteId),
        enabled: !!instituteId,
    });
    const providersQuery = useQuery({
        queryKey: ['telephony-providers'],
        queryFn: fetchTelephonyProviders,
    });

    const providerType = configQuery.data?.providerType ?? '';
    const activeProvider = providersQuery.data?.find((p) => p.providerType === providerType);
    const capabilities = activeProvider?.capabilities ?? [];
    const has = (capability: string) => capabilities.includes(capability);

    const showWallet = has('BALANCE');
    const showNumberPool = has('NUMBER_POOL');
    // No-pool outbound providers (Airtel) dial from a per-counsellor extension.
    const showCounsellorMap = has('OUTBOUND_CALL') && !has('NUMBER_POOL');
    // Vacademy Voice (Plivo) routes inbound through an institute-authored IVR tree
    // and carries its own product-config + inbound guide, so the Exotel-shaped
    // App-Bazaar inbound guide is suppressed for it.
    const isManagedVoice = has('MANAGED_VOICE');
    const showInboundApplet = has('SYNC_INBOUND_APPLET') && !isManagedVoice;
    const showIvrBuilder = has('IVR_BUILDER');
    // The AI line is NOT capability-gated: it matters MOST when the active provider
    // can't carry AI (Airtel/Exotel), which is exactly when a capability gate would
    // have hidden it. Shown as soon as any provider is configured.
    const showAiCarrier = !!providerType;

    const tabs: TelephonyTab[] = [
        {
            key: 'provider',
            label: 'Provider',
            icon: Plug,
            content: (
                <>
                    <TelephonyConfigCard />
                    {showWallet && <TelephonyCreditsCard />}
                </>
            ),
        },
    ];
    if (showNumberPool) {
        tabs.push({
            key: 'numbers',
            label: 'Numbers',
            icon: Phone,
            content: <TelephonyNumbersCard />,
        });
    }
    if (showIvrBuilder) {
        tabs.push({ key: 'ivr', label: 'IVR menus', icon: GridNine, content: <IvrBuilderCard /> });
    }
    if (showAiCarrier) {
        tabs.push({
            key: 'ai-line',
            label: 'AI calling line',
            icon: Robot,
            content: <AiVoiceCarrierCard />,
        });
    }
    if (isManagedVoice) {
        tabs.push({
            key: 'voice',
            label: 'Vacademy Voice',
            icon: Waveform,
            content: <VacademyVoiceConfigCard />,
        });
    }
    if (showCounsellorMap) {
        tabs.push({
            key: 'extensions',
            label: 'User extensions',
            icon: AddressBook,
            content: <TelephonyCounsellorMapCard />,
        });
    }
    if (showInboundApplet) {
        tabs.push({
            key: 'inbound',
            label: 'Inbound setup',
            icon: PhoneIncoming,
            content: <InboundSetupGuideCard />,
        });
    }

    // A provider switch can drop the open tab — fall back to Provider.
    const currentTab = tabs.some((tab) => tab.key === activeTab) ? activeTab : 'provider';
    const providerName = activeProvider?.displayName || providerType;

    return (
        <div className="flex w-full flex-col gap-4">
            {providerType && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-body text-neutral-600">
                    <Plug className="size-4 shrink-0 text-primary-500" />
                    <span>
                        <span className="font-semibold text-neutral-800">{providerName}</span> is
                        your calling service{capabilities.length > 0 && ' · it supports'}
                    </span>
                    {capabilities.map((capability) => (
                        <span
                            key={capability}
                            className="rounded-sm border border-neutral-200 bg-white px-2 py-0.5 text-caption text-neutral-600"
                        >
                            {capability.replace(/_/g, ' ').toLowerCase()}
                        </span>
                    ))}
                </div>
            )}

            <Tabs
                value={currentTab}
                onValueChange={(value) => setActiveTab(value as TelephonyTabKey)}
                className="flex w-full flex-col gap-4"
            >
                {tabs.length > 1 && (
                    <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1 self-start">
                        {tabs.map(({ key, label, icon: TabIcon }) => (
                            <TabsTrigger key={key} value={key} className="gap-1.5">
                                <TabIcon className="size-4" />
                                {label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                )}
                {tabs.map(({ key, content }) => (
                    <TabsContent
                        key={key}
                        value={key}
                        forceMount
                        className="mt-0 flex flex-col gap-5 data-[state=inactive]:hidden"
                    >
                        {content}
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}
