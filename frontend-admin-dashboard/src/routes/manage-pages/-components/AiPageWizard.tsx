/**
 * AI Page Wizard (Phase A) — "Create page with AI".
 * Brief + images → ai_service composes a full page as schema-bound JSON →
 * admin reviews the section list → Accept adds the page to the current
 * config (still a local change: user then saves the draft / publishes).
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Sparkle, CircleNotch, Trash, ArrowLeft, ArrowsClockwise, Plus } from '@phosphor-icons/react';
import { useToast } from '@/hooks/use-toast';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useEditorStore } from '../-stores/editor-store';
import { ImageUploadField } from './ImageUploadField';
import { AiIntakeChat, IntakeResult } from './AiIntakeChat';
import { FigmaLinkNotice } from './FigmaLinkNotice';
import { isFigmaUrl } from '../-utils/figma-link';
import { renderComponentPreview } from './ComponentPreviews';
import {
    generateAiPage, estimateAiPageCredits, generateAiImage, generateAiSite,
    AiPageImage, GeneratePageResponse, GenerateSiteResponse, MAX_INSPIRATION_IMAGES,
} from '../-services/ai-page-service';
import { Component, Page } from '../-types/editor-types';

// MUST cover every archetype the composer knows (_ARCHETYPE_RULES in
// page_builder.py). 'courses' was missing: the intake assistant returns it, but
// with no chip for it the brief step renders with nothing selected and the
// admin has to pick something else — silently swapping the archetype that
// guarantees every offering gets its own block for one that does not.
const buildPageTypes = (t: TFunction) => [
    { key: 'homepage', label: t('pageTypes.homepage') },
    { key: 'courses', label: t('pageTypes.courses') },
    { key: 'course-landing', label: t('pageTypes.courseLanding') },
    { key: 'about', label: t('pageTypes.about') },
    { key: 'admissions', label: t('pageTypes.admissions') },
    { key: 'contact', label: t('pageTypes.contact') },
];

/** "Try another direction" re-runs generation with a distinct design angle. */
const DIRECTIONS = [
    'Editorial and premium: serif-feeling hierarchy, generous whitespace, storytelling sections.',
    'Bold and conversion-focused: strong contrast, big stat chips, repeated CTAs, urgency.',
    'Minimal and calm: few colors, lots of air, short copy, quiet trust signals.',
];

type Step = 'chat' | 'brief' | 'assets' | 'confirm' | 'review';

/** Dialog width per step — these steps hold very different things, and one width
 *  made two of them cramped: the chat carries a conversation plus a row of
 *  screenshot thumbnails, and review renders a preview of the whole generated
 *  page.
 *
 *  These are w-* not max-w-*: DialogContent's base class pins a FIXED 400px
 *  width (with a 90vw cap), so a max-width only raises a ceiling the dialog
 *  never reaches — every dialog in the app is 400px wide no matter what max-w
 *  it passes. tailwind-merge replaces the fixed width; the small-screen guard
 *  is folded into each token's min(). */
const STEP_WIDTH: Record<Step, string> = {
    chat: 'w-dialog-xl',
    brief: 'w-dialog-md',
    assets: 'w-dialog-lg',
    confirm: 'w-dialog-md',
    review: 'w-dialog-xl',
};

export const AiPageWizard = ({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('managePagesAiPageWizard');
    const instituteId = getCurrentInstituteId();
    const { instituteDetails } = useInstituteDetailsStore();
    const { config, addPage, updateGlobalSettings } = useEditorStore();
    const { toast } = useToast();
    const pageTypes = useMemo(() => buildPageTypes(t), [t]);

    const [step, setStep] = useState<Step>('chat');
    const [brief, setBrief] = useState('');
    const [pageType, setPageType] = useState('homepage');
    const [useRealData, setUseRealData] = useState(true);
    const [images, setImages] = useState<AiPageImage[]>([]);
    const [pendingUrl, setPendingUrl] = useState('');
    const [inspiration, setInspiration] = useState<string[]>([]);
    const [sourceUrl, setSourceUrl] = useState('');
    const [referenceUrl, setReferenceUrl] = useState('');
    // A figma.com link is Figma's sign-in page to our server: it is never sent
    // (the server would screenshot / scrape a login form) and the field says
    // what works instead.
    const sourceIsFigma = isFigmaUrl(sourceUrl);
    const referenceIsFigma = isFigmaUrl(referenceUrl);
    const sourceUrlToSend = sourceIsFigma ? undefined : sourceUrl.trim() || undefined;
    const referenceUrlToSend = referenceIsFigma ? undefined : referenceUrl.trim() || undefined;
    const [pendingInsp, setPendingInsp] = useState('');
    // The brief step was reached from the assistant rather than typed by hand,
    // so its fields are a proposal to review — chiefly the page type.
    const [fromAssistant, setFromAssistant] = useState(false);
    // Adding a page to a site that already has a look should match it. Default
    // ON whenever a theme exists, because "a new page, same theme" is the common
    // case and the alternative silently restyles every existing page.
    const [keepTheme, setKeepTheme] = useState(true);
    const [directionIdx, setDirectionIdx] = useState(-1); // -1 = model's own choice
    // Every generation lands as a variant tab; the admin flips between them
    // and accepts the one they like (regens never overwrite earlier drafts).
    const [variants, setVariants] = useState<GeneratePageResponse[]>([]);
    const [activeVariant, setActiveVariant] = useState(0);
    const result = variants[activeVariant] ?? null;
    const [applyTheme, setApplyTheme] = useState(true);
    const [autoImages, setAutoImages] = useState(true);
    const [logoPrompt, setLogoPrompt] = useState('');
    const [logoOptions, setLogoOptions] = useState<string[]>([]);
    const [wholeSite, setWholeSite] = useState(false);
    const [siteResult, setSiteResult] = useState<GenerateSiteResponse | null>(null);

    // Compact snapshot of real offerings from institute details (no new API).
    //
    // Aggregates EVERY level and session a package is offered in rather than
    // keeping only the first. On a directory page those are the spec values the
    // composer needs ("Level: Basic, Advanced"); previously it saw a single
    // arbitrary level per package and had nothing concrete to put in a spec
    // strip, so it invented details or omitted them.
    //
    // NOTE: batches_for_sessions carries no course description or tags (its
    // package_dto is just {id, package_name, thumbnail_id, package_type}), so
    // per-offering prose still has to come from the admin's brief. Feeding real
    // descriptions would need a separate course-detail call.
    const courseSnapshot = useMemo(() => {
        const batches = (instituteDetails as any)?.batches_for_sessions || [];
        const byName = new Map<string, { levels: Set<string>; sessions: Set<string> }>();
        for (const b of batches) {
            const name = b?.package_dto?.package_name;
            if (!name) continue;
            if (!byName.has(name)) byName.set(name, { levels: new Set(), sessions: new Set() });
            const entry = byName.get(name)!;
            const level = b?.level?.level_name;
            const session = b?.session?.session_name;
            // "default" is the platform's placeholder level, not a real one.
            if (level && level.toLowerCase() !== 'default') entry.levels.add(level);
            if (session && session.toLowerCase() !== 'default') entry.sessions.add(session);
        }
        return Array.from(byName.entries())
            .slice(0, 40)
            .map(([name, { levels, sessions }]) => ({
                name,
                level: levels.size ? Array.from(levels).join(', ') : undefined,
                tags: sessions.size ? Array.from(sessions) : undefined,
            }));
    }, [instituteDetails]);

    /** Only the look — never tracking ids, lead-capture or payment config. */
    const siteTheme = useMemo(() => {
        const gs = (config?.globalSettings ?? {}) as Record<string, any>;
        if (!gs.theme && !gs.fonts) return undefined;
        return { theme: gs.theme, fonts: gs.fonts, motion: gs.motion };
    }, [config?.globalSettings]);

    const terminology = useMemo(
        () => ({
            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
            level: getTerminology(ContentTerms.Level, SystemTerms.Level),
            session: getTerminology(ContentTerms.Session, SystemTerms.Session),
            batch: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
            learner: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
        }),
        []
    );

    const { data: estimate } = useQuery({
        queryKey: ['aiPageEstimate', instituteId],
        queryFn: () => estimateAiPageCredits(),
        enabled: open && step === 'confirm',
    });

    const generateMutation = useMutation({
        mutationFn: (direction?: string) =>
            generateAiPage({
                brief,
                page_type: pageType,
                institute_name: (instituteDetails as any)?.institute_name || undefined,
                images,
                inspiration_image_urls: inspiration,
                reference_url: referenceUrlToSend,
                global_settings: keepTheme ? siteTheme : undefined,
                source_url: sourceUrlToSend,
                courses: useRealData ? courseSnapshot : [],
                terminology,
                direction,
                auto_images: autoImages,
            }),
        onSuccess: (data) => {
            setVariants((v) => {
                setActiveVariant(v.length);
                return [...v, data];
            });
            setStep('review');
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail;
            toast({
                title: t('toast.generationFailedTitle'),
                description: typeof detail === 'string' ? detail : t('toast.tryAgain'),
                variant: 'destructive',
            });
        },
    });

    const logoMutation = useMutation({
        mutationFn: () => generateAiImage({ prompt: logoPrompt.trim(), kind: 'logo', count: 3 }),
        onSuccess: (res) => setLogoOptions(res.urls),
        onError: (err: any) => {
            const detail = err?.response?.data?.detail;
            toast({ title: t('toast.logoGenerationFailedTitle'), description: typeof detail === 'string' ? detail : t('toast.tryAgain'), variant: 'destructive' });
        },
    });

    const siteMutation = useMutation({
        mutationFn: () =>
            generateAiSite({
                brief,
                page_types: ['homepage', 'about', 'contact'],
                institute_name: (instituteDetails as any)?.institute_name || undefined,
                images,
                courses: useRealData ? courseSnapshot : [],
                terminology,
                source_url: sourceUrlToSend,
                // Same reference + theme contract as the single-page build: the
                // site call silently dropped both before, so a whole-site run
                // ignored the screenshots and always proposed a fresh theme.
                inspiration_image_urls: inspiration,
                reference_url: referenceUrlToSend,
                global_settings: keepTheme ? siteTheme : undefined,
                auto_images: autoImages,
            }),
        onSuccess: (data) => { setSiteResult(data); setStep('review'); },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail;
            toast({ title: t('toast.siteGenerationFailedTitle'), description: typeof detail === 'string' ? detail : t('toast.tryAgain'), variant: 'destructive' });
        },
    });

    const acceptSite = () => {
        if (!siteResult || !config) return;
        if (applyTheme && siteResult.global_settings) updateGlobalSettings(siteResult.global_settings);
        const routes = new Set(config.pages.map((p) => p.route));
        for (const sp of siteResult.pages) {
            let route = sp.page.route || sp.page_type;
            let n = 2;
            while (routes.has(route)) route = `${sp.page.route}-${n++}`;
            routes.add(route);
            addPage({ id: sp.page.id, route, title: sp.page.title || undefined, components: sp.page.components as Component[] } as Page);
        }
        toast({
            title: t('toast.pagesAddedTitle', { count: siteResult.pages.length }),
            description: t('toast.pagesAddedDescription'),
        });
        handleClose(false);
    };

    // Chat intake hands its gathered brief + assets to the classic pipeline.
    // It lands on the BRIEF step, not straight on confirm: page type is the
    // single most consequential choice in the whole flow (it selects the page
    // archetype, which governs structure), and jumping past it meant the
    // assistant's guess was applied invisibly — a directory archetype picked
    // for a marketing page produced dense spec tables and no way to tell why.
    // The same jump also skipped the assets step, so logo/photos could only
    // ever be attached inside the chat.
    const acceptIntake = (r: IntakeResult) => {
        setBrief(r.brief);
        setPageType(r.pageType);
        setFromAssistant(true);
        setWholeSite(r.wholeSite);
        if (r.images.length) {
            setImages((prev) => {
                const seen = new Set(prev.map((i) => i.url));
                return [...prev, ...r.images.filter((i) => !seen.has(i.url))];
            });
        }
        if (r.inspiration.length) {
            setInspiration((prev) => Array.from(new Set([...prev, ...r.inspiration])).slice(0, MAX_INSPIRATION_IMAGES));
        }
        setStep('brief');
    };

    const reset = () => {
        setStep('chat');
        setBrief('');
        setPageType('homepage');
        setImages([]);
        setInspiration([]);
        setSourceUrl('');
        setReferenceUrl('');
        setPendingInsp('');
        setFromAssistant(false);
        setDirectionIdx(-1);
        setVariants([]);
        setActiveVariant(0);
        setApplyTheme(true);
        setAutoImages(true);
        setLogoPrompt('');
        setLogoOptions([]);
        setWholeSite(false);
        setSiteResult(null);
    };

    const handleClose = (next: boolean) => {
        if (!next && !generateMutation.isPending) reset();
        onOpenChange(next);
    };

    const tryAnotherDirection = () => {
        const nextIdx = (directionIdx + 1) % DIRECTIONS.length;
        setDirectionIdx(nextIdx);
        generateMutation.mutate(DIRECTIONS[nextIdx]);
    };

    const acceptPage = () => {
        if (!result || !config) return;
        // Ensure a unique route among existing pages
        const routes = new Set(config.pages.map((p) => p.route));
        let route = result.page.route || 'ai-page';
        let n = 2;
        while (routes.has(route)) route = `${result.page.route}-${n++}`;

        // Apply the matching site theme first (a page renders premium only when
        // the theme/font/atmosphere are set) — opt-out via the review toggle.
        if (applyTheme && result.global_settings) {
            updateGlobalSettings(result.global_settings);
        }

        const page: Page = {
            id: result.page.id,
            route,
            title: result.page.title || undefined,
            components: result.page.components as Component[],
        } as Page;
        addPage(page);
        toast({
            title: t('toast.pageAddedTitle'),
            description: t('toast.pageAddedDescription'),
        });
        handleClose(false);
    };

    const busy = generateMutation.isPending || siteMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            {/* overflow-x-hidden: DialogContent is a grid; a wide child (the
                scaled preview's marquee) would otherwise expand the implicit
                column and shove the footer buttons off-screen. */}
            <DialogContent
                className={`${STEP_WIDTH[step]} flex max-h-dialog-tall flex-col overflow-x-hidden`}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkle className="size-4 text-primary-500" weight="duotone" />
                        {t('dialogTitle')}
                    </DialogTitle>
                </DialogHeader>

                {/* Steps scroll INSIDE the dialog: the assets step can now hold six
                    reference screenshots, and with no bound the footer was pushed off
                    the bottom of the viewport with no way to reach Next. */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                {/* Kept mounted (hidden) off-step so the transcript survives
                    hopping to the form/assets steps and back. */}
                <div className={step === 'chat' ? '' : 'hidden'}>
                    <AiIntakeChat
                        instituteName={(instituteDetails as any)?.institute_name || undefined}
                        courses={useRealData ? courseSnapshot : []}
                        terminology={terminology}
                        onComplete={acceptIntake}
                    />
                </div>

                {step === 'brief' && (
                    <div className="space-y-4">
                        {fromAssistant && (
                            /* text-primary-500, not 600: theme-provider only overrides --primary-50
                               through --primary-500, so 600 keeps index.css's orange default and
                               rendered orange-on-green for a green-branded institute. */
                            <p className="rounded-lg border border-primary-200 bg-primary-50 p-2.5 text-caption text-primary-500">
                                {t('brief.assistantBanner')}
                            </p>
                        )}
                        <div>
                            <Label className="text-xs">{t('brief.pageTypeQuestion')}</Label>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {pageTypes.map((pt) => (
                                    <button
                                        key={pt.key}
                                        onClick={() => setPageType(pt.key)}
                                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                            pageType === pt.key
                                                ? 'border-primary-400 bg-primary-50 text-primary-500'
                                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                        }`}
                                    >
                                        {pt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs">{t('brief.briefLabel')}</Label>
                            <Textarea
                                value={brief}
                                onChange={(e) => setBrief(e.target.value)}
                                rows={6}
                                placeholder={t('brief.briefPlaceholder')}
                                className="mt-1.5"
                            />
                            <p className="mt-1 text-caption text-gray-400">
                                {t('brief.anyLanguageHint')}
                            </p>
                            {/* The images step sits behind a Next button that is disabled until a
                                brief exists, so uploading looked impossible from this route. Say
                                where the uploads are, and why the button is greyed out. */}
                            <p className="mt-1 text-caption text-gray-400">
                                {brief.trim()
                                    ? t('brief.nextHintReady')
                                    : t('brief.nextHintEmpty')}
                            </p>
                        </div>
                        {siteTheme && (
                            <div className="flex items-center justify-between rounded border bg-gray-50 p-3">
                                <div>
                                    <Label className="text-xs">{t('brief.matchThemeLabel')}</Label>
                                    <p className="text-caption text-gray-400">
                                        {t('brief.matchThemeDescription')}
                                    </p>
                                </div>
                                <Switch checked={keepTheme} onCheckedChange={setKeepTheme} />
                            </div>
                        )}
                        <div className="flex items-center justify-between rounded border bg-gray-50 p-3">
                            <div>
                                <Label className="text-xs">{t('brief.useRealDataLabel', { course: terminology.course.toLowerCase() })}</Label>
                                <p className="text-caption text-gray-400">
                                    {t('brief.useRealDataDescription', { count: courseSnapshot.length })}
                                </p>
                            </div>
                            <Switch checked={useRealData} onCheckedChange={setUseRealData} />
                        </div>
                        <div className="flex items-center justify-between rounded border bg-gray-50 p-3">
                            <div>
                                <Label className="text-xs">{t('brief.wholeSiteLabel')}</Label>
                                <p className="text-caption text-gray-400">
                                    {t('brief.wholeSiteDescription')}
                                </p>
                            </div>
                            <Switch checked={wholeSite} onCheckedChange={setWholeSite} />
                        </div>
                    </div>
                )}

                {step === 'assets' && (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-500">
                            {t('assets.intro')}
                        </p>
                        {images.map((img, i) => (
                            <div key={i} className="flex items-center gap-2 rounded border bg-gray-50 p-2">
                                <img src={img.url} alt="" className="size-12 shrink-0 rounded object-cover" />
                                <Input
                                    className="flex-1"
                                    value={img.caption || ''}
                                    placeholder={t('assets.captionPlaceholder')}
                                    onChange={(e) => {
                                        const next = [...images];
                                        next[i] = { ...next[i]!, caption: e.target.value };
                                        setImages(next);
                                    }}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-8 p-0 text-red-500"
                                    onClick={() => setImages(images.filter((_, j) => j !== i))}
                                >
                                    <Trash className="size-4" />
                                </Button>
                            </div>
                        ))}
                        {images.length < 8 && (
                            <div className="space-y-2">
                                {/* Buffer the field (its onChange fires per keystroke for
                                    typed URLs) and append only on explicit Add. */}
                                <ImageUploadField
                                    label={t('assets.addImageLabel')}
                                    value={pendingUrl}
                                    onChange={setPendingUrl}
                                    aiKind="photo"
                                />
                                {pendingUrl && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setImages([...images, { url: pendingUrl, kind: 'photo' }]);
                                            setPendingUrl('');
                                        }}
                                    >
                                        <Plus className="me-1 size-4" /> {t('assets.addThisImage')}
                                    </Button>
                                )}
                            </div>
                        )}

                        {/* Logo generator */}
                        <div className="mt-4 space-y-2 rounded-lg border border-dashed border-gray-200 p-3">
                            <p className="text-xs font-medium text-gray-700">{t('assets.logoHeading')}</p>
                            <Input
                                value={logoPrompt}
                                onChange={(e) => setLogoPrompt(e.target.value)}
                                placeholder={t('assets.logoPromptPlaceholder')}
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => logoMutation.mutate()}
                                disabled={!logoPrompt.trim() || logoMutation.isPending}
                            >
                                {logoMutation.isPending
                                    ? <><CircleNotch className="me-1 size-4 animate-spin" /> {t('assets.generating')}</>
                                    : <><Sparkle className="me-1 size-4" weight="duotone" /> {t('assets.generateLogoOptions')}</>}
                            </Button>
                            {logoOptions.length > 0 && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {logoOptions.map((url, i) => (
                                        <button
                                            key={i}
                                            onClick={() => {
                                                setImages((im) => [...im, { url, kind: 'logo', caption: t('assets.logoCaption') }]);
                                                setLogoOptions([]);
                                                setLogoPrompt('');
                                            }}
                                            className="rounded border border-gray-200 p-1 hover:border-primary-400"
                                            title={t('assets.useThisLogo')}
                                        >
                                            <img src={url} alt="" className="size-16 rounded object-contain" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Rebuild from an existing website — import real copy */}
                        <div className="mt-4 space-y-2 rounded-lg border border-dashed border-gray-200 p-3">
                            <p className="text-xs font-medium text-gray-700">{t('assets.rebuildHeading')}</p>
                            <p className="text-caption text-gray-400">
                                {t('assets.rebuildDescription')}
                            </p>
                            <Input
                                value={sourceUrl}
                                onChange={(e) => setSourceUrl(e.target.value)}
                                placeholder={t('assets.rebuildUrlPlaceholder')}
                                aria-label={t('assets.rebuildHeading')}
                            />
                            {sourceIsFigma && <FigmaLinkNotice />}
                        </div>

                        {/* Reference website — "make mine look like THAT": captured server-side */}
                        <div className="mt-4 space-y-2 rounded-lg border border-dashed border-gray-200 p-3">
                            <p className="text-xs font-medium text-gray-700">{t('assets.referenceHeading')}</p>
                            <p className="text-caption text-gray-400">
                                {keepTheme && siteTheme
                                    ? t('assets.referenceDescriptionLocked')
                                    : t('assets.referenceDescriptionFree')}
                            </p>
                            <Input
                                value={referenceUrl}
                                onChange={(e) => setReferenceUrl(e.target.value)}
                                placeholder={t('assets.referenceUrlPlaceholder')}
                                aria-label={t('assets.referenceHeading')}
                            />
                            {referenceIsFigma && <FigmaLinkNotice />}
                        </div>

                        {/* Inspiration screenshots — analysed for layout/mood only */}
                        <div className="mt-4 space-y-2 rounded-lg border border-dashed border-gray-200 p-3">
                            <p className="text-xs font-medium text-gray-700">{t('assets.inspirationHeading')}</p>
                            <p className="text-caption text-gray-400">
                                {t('assets.inspirationDescription')}
                            </p>
                            {inspiration.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {inspiration.map((url, i) => (
                                        <div key={i} className="relative">
                                            <img src={url} alt="" className="size-16 rounded object-cover" />
                                            <button
                                                onClick={() => setInspiration(inspiration.filter((_, j) => j !== i))}
                                                className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-0.5 text-white"
                                            >
                                                <Trash className="size-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {inspiration.length < MAX_INSPIRATION_IMAGES && (
                                <div className="space-y-2">
                                    <ImageUploadField
                                        label={t('assets.addScreenshotLabel')}
                                        value={pendingInsp}
                                        onChange={setPendingInsp}
                                    />
                                    {pendingInsp && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                setInspiration((p) => (p.includes(pendingInsp) ? p : [...p, pendingInsp]));
                                                setPendingInsp('');
                                            }}
                                        >
                                            <Plus className="me-1 size-4" /> {t('assets.addThisScreenshot')}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {step === 'confirm' && (
                    <div className="space-y-4">
                        <div className="rounded border bg-gray-50 p-3 text-xs text-gray-600">
                            <p className="font-medium text-gray-800">{t('confirm.ready')}</p>
                            <p className="mt-1">
                                {pageTypes.find((pt) => pt.key === pageType)?.label} ·{' '}
                                {t('confirm.imageCount', { count: images.length })} ·{' '}
                                {useRealData
                                    ? t('confirm.realDataSummary', { course: terminology.course.toLowerCase() })
                                    : t('confirm.genericContentSummary')}
                            </p>
                        </div>
                        <div className="flex items-center justify-between rounded border bg-gray-50 p-3">
                            <div>
                                <Label className="text-xs">{t('confirm.generateImagesLabel')}</Label>
                                <p className="text-caption text-gray-400">
                                    {t('confirm.generateImagesDescription')}
                                </p>
                            </div>
                            <Switch checked={autoImages} onCheckedChange={setAutoImages} />
                        </div>
                        {estimate && (
                            <p className="text-xs text-gray-500">
                                {t('confirm.estimatedCostLabel')}{' '}
                                <span className="font-semibold text-gray-800">
                                    {typeof estimate.estimated_credits === 'number'
                                        ? t('confirm.estimatedCredits', { count: estimate.estimated_credits })
                                        : t('confirm.estimatedCreditsUnknown')}
                                </span>
                                {typeof estimate.current_balance === 'number' && (
                                    <> · {t('confirm.balance', { value: estimate.current_balance })}</>
                                )}
                                {estimate.sufficient === false && (
                                    <span className="ms-1 font-medium text-red-600">{t('confirm.insufficientBalance')}</span>
                                )}
                            </p>
                        )}
                        {busy && (
                            <div className="flex items-center gap-2 rounded border border-primary-100 bg-primary-50 p-3 text-xs text-primary-500">
                                <CircleNotch className="size-4 animate-spin" />
                                {t('confirm.generating')}
                            </div>
                        )}
                    </div>
                )}

                {step === 'review' && siteResult && (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-500">
                            {t('review.siteReady', { count: siteResult.pages.length })}
                        </p>
                        <ul className="space-y-1.5 rounded border bg-gray-50 p-3">
                            {siteResult.pages.map((sp) => (
                                <li key={sp.page_type} className="flex items-center justify-between text-xs text-gray-700">
                                    <span className="font-medium">
                                        {pageTypes.find((pt) => pt.key === sp.page_type)?.label ?? sp.page_type}
                                    </span>
                                    <span className="text-caption text-gray-400">
                                        {t('review.sectionsCount', { count: sp.page.components.length })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {siteResult.global_settings && (
                            <div className="flex items-center justify-between rounded-lg border border-primary-100 bg-primary-50 p-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-primary-600">{t('review.applyThemeLabel')}</p>
                                    <p className="text-caption text-gray-500">
                                        {t('review.themeCaption', {
                                            preset: (siteResult.global_settings as any)?.theme?.preset || t('review.defaultThemeLabel'),
                                            font: String((siteResult.global_settings as any)?.fonts?.headingFamily || (siteResult.global_settings as any)?.fonts?.family || '').split(',')[0],
                                        })}
                                    </p>
                                </div>
                                <Switch checked={applyTheme} onCheckedChange={setApplyTheme} />
                            </div>
                        )}
                        <p className="text-caption text-gray-400">
                            {t('review.siteAddNote')}
                        </p>
                    </div>
                )}

                {step === 'review' && result && !siteResult && (
                    <div className="min-w-0 max-w-full space-y-3">
                        {/* Variant tabs — every regeneration is kept for comparison */}
                        {variants.length > 1 && (
                            <div className="flex gap-1.5">
                                {variants.map((_, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setActiveVariant(i)}
                                        className={`rounded-full px-3 py-1 text-caption font-medium transition-colors ${
                                            i === activeVariant
                                                ? 'bg-primary-500 text-white'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                    >
                                        {t('review.optionTab', { index: i + 1 })}
                                    </button>
                                ))}
                            </div>
                        )}
                        <p className="text-xs text-gray-500">
                            {t('review.draftReady', {
                                title: result.page.title || t('review.untitledPage'),
                                sections: t('review.sectionsCount', { count: result.page.components.length }),
                            })}
                        </p>
                        {/* LIVE mini-preview: the actual component previews rendered
                            with the proposed theme, scaled to fit the dialog. */}
                        <div className="max-h-80 overflow-auto overflow-x-hidden rounded-lg border bg-gray-100 p-2">
                            <div className="origin-top-left" style={{ transform: 'scale(0.5)', width: '200%' /* design-lint-ignore: preview scaling */ }}>
                                <div
                                    className="bg-white shadow"
                                    data-catalogue-theme={(result.global_settings as any)?.theme?.preset || 'default'}
                                    data-heading-scale={(result.global_settings as any)?.theme?.headingScale || 'default'}
                                    data-catalogue-atmosphere={(result.global_settings as any)?.theme?.atmosphere?.canvas || 'flat'}
                                    data-catalogue-intensity={(result.global_settings as any)?.theme?.atmosphere?.intensity || 'subtle'}
                                    style={{
                                        fontFamily: (result.global_settings as any)?.fonts?.family,
                                        ...((result.global_settings as any)?.fonts?.headingFamily
                                            ? { ['--catalogue-heading-font' as any]: (result.global_settings as any).fonts.headingFamily }
                                            : {}),
                                        pointerEvents: 'none',
                                    }}
                                >
                                    {result.page.components.map((c) => (
                                        <React.Fragment key={c.id}>{renderComponentPreview(c as Component)}</React.Fragment>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {result.warnings.length > 0 && (
                            /* Warnings now carry the self-check's findings ("this
                               section is empty", "nothing to click"), not just
                               sanitiser cleanups — a bare count told the admin
                               nothing they could act on. */
                            <details className="rounded-lg border border-warning-200 bg-warning-50 p-3">
                                <summary className="cursor-pointer text-caption font-medium text-warning-700">
                                    {t('review.warningsSummary', { count: result.warnings.length })}
                                </summary>
                                <ul className="mt-2 list-disc space-y-1 pl-4 text-caption text-warning-700">
                                    {result.warnings.slice(0, 8).map((w, i) => (
                                        <li key={i}>{w}</li>
                                    ))}
                                </ul>
                                {result.warnings.length > 8 && (
                                    <p className="mt-1 pl-4 text-caption text-warning-600">
                                        {t('review.moreWarnings', { count: result.warnings.length - 8 })}
                                    </p>
                                )}
                            </details>
                        )}
                        {result.global_settings && (
                            <div className="flex items-center justify-between rounded-lg border border-primary-100 bg-primary-50 p-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-primary-600">{t('review.applyThemeLabel')}</p>
                                    <p className="text-caption text-gray-500">
                                        {t('review.themeSummaryFull', {
                                            preset: (result.global_settings as any)?.theme?.preset || t('review.defaultThemeLabel'),
                                            font: String((result.global_settings as any)?.fonts?.family || '').split(',')[0],
                                        })}
                                    </p>
                                </div>
                                <Switch checked={applyTheme} onCheckedChange={setApplyTheme} />
                            </div>
                        )}
                        <p className="text-caption text-gray-400">
                            {t('review.pageAddNote')}
                        </p>
                    </div>
                )}

                </div>

                <DialogFooter className="gap-2">
                    {step === 'chat' && (
                        <Button variant="ghost" className="text-gray-500" onClick={() => setStep('brief')}>
                            {t('footer.preferForm')}
                        </Button>
                    )}
                    {step === 'brief' && (
                        <>
                            <Button variant="ghost" onClick={() => setStep('chat')}>
                                <ArrowLeft className="me-1 size-4" /> {t('footer.assistantBack')}
                            </Button>
                            <Button onClick={() => setStep('assets')} disabled={!brief.trim()}>
                                {t('footer.nextImages')}
                            </Button>
                        </>
                    )}
                    {step === 'assets' && (
                        <>
                            <Button variant="ghost" onClick={() => setStep('brief')}>
                                <ArrowLeft className="me-1 size-4" /> {t('footer.back')}
                            </Button>
                            <Button onClick={() => setStep('confirm')}>{t('footer.nextGenerate')}</Button>
                        </>
                    )}
                    {step === 'confirm' && (
                        <>
                            <Button variant="ghost" onClick={() => setStep('assets')} disabled={busy}>
                                <ArrowLeft className="me-1 size-4" /> {t('footer.back')}
                            </Button>
                            <Button
                                onClick={() => (wholeSite ? siteMutation.mutate() : generateMutation.mutate(directionIdx >= 0 ? DIRECTIONS[directionIdx] : undefined))}
                                disabled={busy || estimate?.sufficient === false}
                            >
                                {busy ? (
                                    <CircleNotch className="mr-1 size-4 animate-spin" />
                                ) : (
                                    <Sparkle className="mr-1 size-4" />
                                )}
                                {wholeSite ? t('footer.generateSite') : t('footer.generatePage')}
                            </Button>
                        </>
                    )}
                    {step === 'review' && siteResult && (
                        <Button onClick={acceptSite} disabled={siteMutation.isPending}>
                            <Plus className="me-1 size-4" /> {t('footer.addPagesToSite', { count: siteResult.pages.length })}
                        </Button>
                    )}
                    {step === 'review' && !siteResult && (
                        <>
                            <Button variant="ghost" onClick={tryAnotherDirection} disabled={busy}>
                                {busy ? (
                                    <CircleNotch className="mr-1 size-4 animate-spin" />
                                ) : (
                                    <ArrowsClockwise className="mr-1 size-4" />
                                )}
                                {t('footer.tryAnotherDirection')}
                            </Button>
                            <Button onClick={acceptPage} disabled={busy}>
                                <Plus className="me-1 size-4" /> {t('footer.addToSite')}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
