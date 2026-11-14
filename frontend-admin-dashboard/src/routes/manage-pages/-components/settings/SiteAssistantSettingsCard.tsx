import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowSquareOut, Plus, Sparkle, X } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { handleFetchCampaignsList } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { listKnowledgeBases } from '@/routes/knowledge-base/-services/knowledge-base-service';
import { CampaignPicker } from '../CampaignPicker';
import { ImageUploadField } from '../ImageUploadField';
import { OptionalColorField } from '../chrome/chrome-controls';
import { useCatalogStreams } from '../catalog/use-catalog-streams';
import type { SiteAssistantSettings } from '../../-types/editor-types';
import {
    KNOWLEDGE_SWITCHES,
    MAX_SUGGESTIONS,
    MAX_SUGGESTION_LENGTH,
    PERSONA_OPTIONS,
    PLACEMENT_OPTIONS,
    POSITION_OPTIONS,
    SITE_ASSISTANT_DEFAULTS,
    cleanSuggestions,
    enableSiteAssistant,
    isKnowledgeOn,
    parseDailyAnswers,
    patchNested,
    popularSearchesFromSite,
    siteAssistantPageHref,
    siteRoutes,
    siteTagFromPath,
    streamSectionProps,
} from './site-assistant-settings';

/**
 * Global Settings → Site Assistant (globalSettings.siteAssistant, Site Assistant SPEC §1).
 *
 * The AI helper that answers visitors on this site. Everything here is saved in
 * the draft and goes live when the site is published; it is public with the
 * site, so nothing secret belongs here. Only changed keys are stored: a missing
 * key is the engine default. FAQs, notices, conversations, the preview chat
 * and the embed snippet live on the Site Assistant page linked below.
 */

interface SiteAssistantSettingsCardProps {
    value: SiteAssistantSettings | undefined;
    onChange: (next: SiteAssistantSettings) => void;
    /** The whole site being edited (pages for routes, popular searches and stream tabs). */
    config?: unknown;
    /** This site's tag; read from the editor URL when not given. */
    siteTag?: string | null;
}

const SELECT_CLASS = 'mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs';

const SubHeading = ({ title, hint }: { title: string; hint?: string }) => (
    <div className="border-t border-neutral-200 pt-3">
        <p className="text-sm font-medium text-neutral-700">{title}</p>
        {hint && <p className="text-caption text-neutral-500">{hint}</p>}
    </div>
);

export const SiteAssistantSettingsCard = ({
    value,
    onChange,
    config,
    siteTag,
}: SiteAssistantSettingsCardProps) => {
    const instituteId = getCurrentInstituteId() || '';
    const instituteName = useInstituteDetailsStore((s) => s.instituteDetails?.institute_name);
    const tag =
        siteTag ??
        (typeof window !== 'undefined' ? siteTagFromPath(window.location.pathname) : null);

    const enabled = value?.enabled ?? SITE_ASSISTANT_DEFAULTS.enabled;
    const popular = popularSearchesFromSite(config);
    const suggestions = value?.suggestions ?? popular;
    const placementMode = value?.placement?.mode ?? SITE_ASSISTANT_DEFAULTS.placementMode;
    const placementRoutes = value?.placement?.routes ?? [];
    const linkedKbIds = value?.knowledge?.linkedKbIds ?? [];
    const streamCampaigns = value?.leads?.streamCampaigns ?? {};
    const routes = siteRoutes(config);

    const [newSuggestion, setNewSuggestion] = useState('');
    const [capDraft, setCapDraft] = useState<string | null>(null);

    const set = (patch: SiteAssistantSettings) => onChange({ ...value, ...patch });
    const setSuggestions = (list: string[]) => set({ suggestions: cleanSuggestions(list) });

    const kbQuery = useQuery({
        queryKey: ['SITE_ASSISTANT_KNOWLEDGE_BASES', instituteId],
        queryFn: listKnowledgeBases,
        enabled: !!instituteId,
        staleTime: 60_000,
    });
    const knowledgeBases = (Array.isArray(kbQuery.data) ? kbQuery.data : []).filter(
        (kb) => kb.status !== 'ARCHIVED' || linkedKbIds.includes(kb.id)
    );

    // Same list (and cache) as the campaign picker above it.
    const campaignsQuery = useQuery({
        ...handleFetchCampaignsList({
            institute_id: instituteId,
            status: 'ACTIVE',
            page: 0,
            size: 100,
        }),
        enabled: !!instituteId,
    });
    const campaigns = (campaignsQuery.data?.content || [])
        .map((c) => ({
            id: String(c.id || c.audience_id || c.campaign_id || ''),
            name: c.campaign_name || '',
        }))
        .filter((c) => c.id);

    const streamProps = streamSectionProps(config);
    const streams = useCatalogStreams(streamProps ?? {}, !!streamProps);

    const toggleKb = (id: string, on: boolean) =>
        onChange(
            patchNested(value, 'knowledge', {
                linkedKbIds: on
                    ? Array.from(new Set([...linkedKbIds, id]))
                    : linkedKbIds.filter((k) => k !== id),
            })
        );

    const setStreamCampaign = (slug: string, campaignId: string) => {
        const next = { ...streamCampaigns };
        if (campaignId) next[slug] = campaignId;
        else delete next[slug];
        onChange(patchNested(value, 'leads', { streamCampaigns: next }));
    };

    const addSuggestion = () => {
        if (!newSuggestion.trim()) return;
        setSuggestions([...suggestions, newSuggestion]);
        setNewSuggestion('');
    };

    const support = value?.support ?? {};
    const setSupport = (key: keyof NonNullable<SiteAssistantSettings['support']>, raw: string) =>
        onChange(patchNested(value, 'support', { [key]: raw.trim() ? raw : null }));

    return (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center justify-between gap-3">
                <h4 className="flex items-center gap-1.5 font-medium text-neutral-700">
                    <Sparkle className="size-4 text-primary-500" weight="fill" />
                    Site Assistant
                </h4>
                <Switch
                    checked={enabled}
                    onCheckedChange={(on) =>
                        onChange(
                            on
                                ? enableSiteAssistant(value, { instituteName, popular })
                                : { ...value, enabled: false }
                        )
                    }
                    aria-label="Site Assistant"
                />
            </div>
            <p className="text-caption text-neutral-500">
                An AI helper that answers visitors&rsquo; questions about your courses, prices,
                classes and pages, and passes interested visitors to your team. Each answer uses 1
                AI credit. Changes go live when you publish the site.
            </p>
            {!enabled && (
                <p className="text-caption text-neutral-500">
                    It is off: visitors don&rsquo;t see it yet. You can still set it up and try it
                    in the preview chat first.
                </p>
            )}
            <a
                href={siteAssistantPageHref(tag)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-caption font-medium text-primary-500 hover:underline"
            >
                Open Site Assistant (FAQs, conversations, preview, embed){' '}
                <ArrowSquareOut className="size-3.5" />
            </a>

            {/* ── Look and voice ── */}
            <SubHeading title="Look and voice" />
            <div>
                <Label htmlFor="sa-name" className="text-xs">
                    Name
                </Label>
                <Input
                    id="sa-name"
                    className="mt-1"
                    placeholder={instituteName ? `Ask ${instituteName}` : 'Ask us'}
                    value={value?.name ?? ''}
                    onChange={(e) => set({ name: e.target.value || undefined })}
                />
            </div>
            <ImageUploadField
                label="Picture (optional)"
                value={value?.avatarUrl ?? ''}
                onChange={(url) => set({ avatarUrl: url || null })}
            />
            <div>
                <Label htmlFor="sa-greeting" className="text-xs">
                    First message
                </Label>
                <Textarea
                    id="sa-greeting"
                    className="mt-1"
                    rows={2}
                    placeholder="Namaste! I can help you find a course, check prices or join a live class."
                    value={value?.greeting ?? ''}
                    onChange={(e) => set({ greeting: e.target.value || undefined })}
                />
            </div>
            <div>
                <Label htmlFor="sa-persona" className="text-xs">
                    Tone of voice
                </Label>
                <select
                    id="sa-persona"
                    className={SELECT_CLASS}
                    value={value?.persona ?? SITE_ASSISTANT_DEFAULTS.persona}
                    onChange={(e) =>
                        set({ persona: e.target.value as SiteAssistantSettings['persona'] })
                    }
                >
                    {PERSONA_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>
                            {p.label}: {p.hint}
                        </option>
                    ))}
                </select>
            </div>
            <OptionalColorField
                label="Colour"
                value={value?.accentColor ?? undefined}
                onChange={(color) => set({ accentColor: color ?? null })}
            />

            {/* ── Suggested questions ── */}
            <SubHeading
                title="Suggested questions"
                hint={`Buttons visitors can tap to start (up to ${MAX_SUGGESTIONS}).`}
            />
            {value?.suggestions === undefined && popular.length > 0 && (
                <p className="text-caption text-neutral-500">
                    Taken from the &ldquo;Popular&rdquo; searches on your courses page.
                </p>
            )}
            <ul className="space-y-1.5">
                {suggestions.map((s, i) => (
                    <li key={`${i}-${s}`} className="flex items-center gap-1.5">
                        <Input
                            aria-label={`Suggested question ${i + 1}`}
                            defaultValue={s}
                            maxLength={MAX_SUGGESTION_LENGTH}
                            onBlur={(e) => {
                                if (e.target.value === s) return;
                                const next = [...suggestions];
                                next[i] = e.target.value;
                                setSuggestions(next);
                            }}
                        />
                        <button
                            type="button"
                            aria-label={`Remove “${s}”`}
                            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-danger-600"
                            onClick={() => setSuggestions(suggestions.filter((_, j) => j !== i))}
                        >
                            <X className="size-4" />
                        </button>
                    </li>
                ))}
            </ul>
            {suggestions.length < MAX_SUGGESTIONS && (
                <div className="flex items-center gap-1.5">
                    <Input
                        aria-label="New suggested question"
                        placeholder="e.g. Any free class?"
                        maxLength={MAX_SUGGESTION_LENGTH}
                        value={newSuggestion}
                        onChange={(e) => setNewSuggestion(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                addSuggestion();
                            }
                        }}
                    />
                    <button
                        type="button"
                        aria-label="Add suggested question"
                        disabled={!newSuggestion.trim()}
                        className="rounded p-1 text-primary-500 hover:bg-primary-50 disabled:text-neutral-300"
                        onClick={addSuggestion}
                    >
                        <Plus className="size-4" />
                    </button>
                </div>
            )}
            {value?.suggestions !== undefined && popular.length > 0 && (
                <button
                    type="button"
                    className="text-caption font-medium text-primary-500 hover:underline"
                    onClick={() => setSuggestions(popular)}
                >
                    Use my &ldquo;Popular&rdquo; searches instead
                </button>
            )}

            {/* ── Where it shows ── */}
            <SubHeading title="Where it shows" hint="Never on login or checkout pages." />
            <div>
                <Label htmlFor="sa-placement" className="text-xs">
                    Pages
                </Label>
                <select
                    id="sa-placement"
                    className={SELECT_CLASS}
                    value={placementMode}
                    onChange={(e) =>
                        onChange(
                            patchNested(value, 'placement', {
                                mode: e.target.value as typeof placementMode,
                            })
                        )
                    }
                >
                    {PLACEMENT_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>
                            {p.label}
                        </option>
                    ))}
                </select>
            </div>
            {placementMode === 'routes' && (
                <div className="space-y-1">
                    {routes.length === 0 && (
                        <p className="text-caption text-neutral-500">This site has no pages yet.</p>
                    )}
                    {routes.map((r) => (
                        <label
                            key={r.route}
                            className="flex cursor-pointer items-center gap-2 text-caption text-neutral-600"
                        >
                            <Checkbox
                                checked={placementRoutes.includes(r.route)}
                                onCheckedChange={(v) =>
                                    onChange(
                                        patchNested(value, 'placement', {
                                            routes:
                                                v === true
                                                    ? [...placementRoutes, r.route]
                                                    : placementRoutes.filter((x) => x !== r.route),
                                        })
                                    )
                                }
                            />
                            {r.title}
                            <span className="text-neutral-400">{r.route}</span>
                        </label>
                    ))}
                    {routes.length > 0 && placementRoutes.length === 0 && (
                        <p className="text-caption text-warning-600">
                            Pick at least one page, or visitors won&rsquo;t see the assistant.
                        </p>
                    )}
                </div>
            )}
            <div>
                <Label htmlFor="sa-position" className="text-xs">
                    Button position
                </Label>
                <select
                    id="sa-position"
                    className={SELECT_CLASS}
                    value={value?.position ?? SITE_ASSISTANT_DEFAULTS.position}
                    onChange={(e) =>
                        set({ position: e.target.value as SiteAssistantSettings['position'] })
                    }
                >
                    {POSITION_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>
                            {p.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* ── What it knows ── */}
            <SubHeading
                title="What it can answer from"
                hint="It only states facts it finds here, never from guesswork."
            />
            <div className="space-y-1.5">
                {KNOWLEDGE_SWITCHES.map((k) => (
                    <label
                        key={k.key}
                        className="flex cursor-pointer items-start gap-2 text-caption text-neutral-600"
                    >
                        <Checkbox
                            className="mt-0.5"
                            checked={isKnowledgeOn(value, k.key)}
                            onCheckedChange={(v) =>
                                onChange(patchNested(value, 'knowledge', { [k.key]: v === true }))
                            }
                            aria-label={k.label}
                        />
                        <span>
                            <span className="font-medium text-neutral-700">{k.label}</span>
                            <span className="block text-neutral-400">{k.hint}</span>
                        </span>
                    </label>
                ))}
            </div>
            <div>
                <p className="text-xs font-medium text-neutral-700">Knowledge bases</p>
                <p className="text-caption text-neutral-400">
                    Documents you uploaded under Knowledge Base, e.g. a prospectus or a sitemap of
                    your own website.
                </p>
                {kbQuery.isLoading && (
                    <p className="mt-1 text-caption text-neutral-500">Loading knowledge bases…</p>
                )}
                {kbQuery.isError && (
                    <p className="mt-1 text-caption text-danger-600">
                        Could not load your knowledge bases. Close and reopen Global Settings to try
                        again.
                    </p>
                )}
                {!kbQuery.isLoading && !kbQuery.isError && knowledgeBases.length === 0 && (
                    <p className="mt-1 text-caption text-neutral-500">
                        No knowledge bases yet. You can add one under Knowledge Base.
                    </p>
                )}
                <div className="mt-1 space-y-1">
                    {knowledgeBases.map((kb) => (
                        <label
                            key={kb.id}
                            className="flex cursor-pointer items-center gap-2 text-caption text-neutral-600"
                        >
                            <Checkbox
                                checked={linkedKbIds.includes(kb.id)}
                                onCheckedChange={(v) => toggleKb(kb.id, v === true)}
                                aria-label={kb.name}
                            />
                            {kb.name}
                        </label>
                    ))}
                </div>
            </div>

            {/* ── Enquiries ── */}
            <SubHeading
                title="Enquiries"
                hint="When a visitor asks to be contacted, their details and a short summary of the chat go to this list. It only asks when the visitor wants help."
            />
            <CampaignPicker
                label="Send enquiries to"
                value={value?.leads?.campaignId ?? ''}
                onChange={(id) => onChange(patchNested(value, 'leads', { campaignId: id || null }))}
            />
            {streams.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-xs font-medium text-neutral-700">
                        Different list for a stream (optional)
                    </p>
                    {streams.map((s) => (
                        <div key={s.slug}>
                            <Label htmlFor={`sa-stream-${s.slug}`} className="text-caption">
                                {s.label}
                            </Label>
                            <select
                                id={`sa-stream-${s.slug}`}
                                className={SELECT_CLASS}
                                value={streamCampaigns[s.slug] ?? ''}
                                onChange={(e) => setStreamCampaign(s.slug, e.target.value)}
                            >
                                <option value="">Same as above</option>
                                {campaigns.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
            )}
            <div>
                <Label htmlFor="sa-consent" className="text-xs">
                    Consent text (optional)
                </Label>
                <Textarea
                    id="sa-consent"
                    className="mt-1"
                    rows={2}
                    placeholder="I agree to be contacted about courses by phone, WhatsApp or email."
                    value={value?.leads?.consentText ?? ''}
                    onChange={(e) =>
                        onChange(
                            patchNested(value, 'leads', {
                                consentText: e.target.value.trim() ? e.target.value : null,
                            })
                        )
                    }
                />
            </div>

            {/* ── Support ── */}
            <SubHeading
                title="Help for existing learners"
                hint="Shown to learners who can't log in or can't find their course, so they reach you instead of the sales team."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                    <Label htmlFor="sa-support-email" className="text-xs">
                        Support email
                    </Label>
                    <Input
                        id="sa-support-email"
                        type="email"
                        className="mt-1"
                        value={support.email ?? ''}
                        onChange={(e) => setSupport('email', e.target.value)}
                    />
                </div>
                <div>
                    <Label htmlFor="sa-support-phone" className="text-xs">
                        Support phone
                    </Label>
                    <Input
                        id="sa-support-phone"
                        className="mt-1"
                        placeholder="+91 …"
                        value={support.phone ?? ''}
                        onChange={(e) => setSupport('phone', e.target.value)}
                    />
                </div>
                <div>
                    <Label htmlFor="sa-support-whatsapp" className="text-xs">
                        WhatsApp number
                    </Label>
                    <Input
                        id="sa-support-whatsapp"
                        className="mt-1"
                        placeholder="919895603342"
                        value={support.whatsapp ?? ''}
                        onChange={(e) => setSupport('whatsapp', e.target.value)}
                    />
                </div>
                <div>
                    <Label htmlFor="sa-support-login" className="text-xs">
                        Login page link
                    </Label>
                    <Input
                        id="sa-support-login"
                        className="mt-1"
                        placeholder="https://…/login"
                        value={support.loginUrl ?? ''}
                        onChange={(e) => setSupport('loginUrl', e.target.value)}
                    />
                </div>
            </div>

            {/* ── Limits ── */}
            <SubHeading
                title="Daily limit"
                hint="The most answers per day for this site (1 credit each). When it is reached, visitors see your contact details instead."
            />
            <div>
                <Label htmlFor="sa-daily-cap" className="text-xs">
                    Answers per day
                </Label>
                <Input
                    id="sa-daily-cap"
                    type="number"
                    min={1}
                    className="mt-1"
                    placeholder={String(SITE_ASSISTANT_DEFAULTS.dailyAnswers)}
                    value={capDraft ?? (value?.limits?.dailyAnswers ?? '').toString()}
                    onChange={(e) => setCapDraft(e.target.value)}
                    onBlur={() => {
                        if (capDraft === null) return;
                        onChange(
                            patchNested(value, 'limits', {
                                dailyAnswers: parseDailyAnswers(capDraft),
                            })
                        );
                        setCapDraft(null);
                    }}
                />
            </div>

            {/* ── Embed ── */}
            <SubHeading title="Your own website" />
            <div className="flex items-start justify-between gap-3">
                <p className="text-caption text-neutral-600">
                    Allow the assistant on your own website (not built here) with a small code
                    snippet. It only works on websites you have verified.
                </p>
                <Switch
                    checked={value?.embed?.enabled ?? SITE_ASSISTANT_DEFAULTS.embed}
                    onCheckedChange={(on) => onChange(patchNested(value, 'embed', { enabled: on }))}
                    aria-label="Allow on my own website"
                />
            </div>
            {value?.embed?.enabled && (
                <p className="text-caption text-neutral-400">
                    Copy the snippet from Site Assistant → Embed, after you publish.
                </p>
            )}
        </div>
    );
};
