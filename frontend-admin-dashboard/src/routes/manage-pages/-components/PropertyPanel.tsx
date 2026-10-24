import { useEditorStore } from '../-stores/editor-store';
import { useLocalizedEditing } from '../-hooks/use-localized-editing';
import { LanguagesSettingsCard } from './i18n/LanguagesSettingsCard';
import { CATALOGUE_FONTS } from '../-utils/catalogue-fonts';
import { buildComponentTemplates } from '../-utils/component-templates';
import { componentLabel } from '../-utils/component-labels';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    Plus,
    Trash as Trash2,
    CaretDown as ChevronDown,
    CaretUp as ChevronUp,
    Gear as Settings,
    Copy,
    ArrowUp,
    ArrowDown,
    SquaresFour as LayoutGrid,
    Clipboard,
    ClipboardText as ClipboardPaste,
    Anchor,
    Sparkle,
    Eye,
    EyeSlash,
    BracketsCurly,
    LinkSimple,
} from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AiSectionVariantsDialog } from './AiSectionVariantsDialog';
import { ColorPickerField } from './ColorPickerField';
import { ImageUploadField } from './ImageUploadField';
import { VideoUploadField } from './VideoUploadField';
import { DocumentUploadField } from './DocumentUploadField';
import { VariantSwitcher } from './VariantSwitcher';
import { RichTextField } from './RichTextField';
import { StyleEditor } from './StyleEditor';
import { useToast } from '@/hooks/use-toast';
import { HTML_PAGE_AI_PROMPT } from '../-utils/html-page-prompt';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllProductPages } from '../product-pages/-services/product-pages-service';
import { listBlogPosts } from '../-services/blog-service';
import { handleFetchCampaignsList } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { AUDIENCE_CAMPAIGN, GET_INVITE_LIST } from '@/constants/urls';
import axios from 'axios';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import createInviteLink from '@/routes/manage-students/invite/-utils/createInviteLink';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { SearchableSelect, type SearchableSelectOption } from '@/components/design-system/searchable-select';
import { CoursePagesEditor } from './CoursePagesEditor';
import { useBlogManagerStore } from '../-stores/blog-manager-store';
import { LinkPicker } from './LinkPicker';
import { CampaignPicker, websiteFormFields } from './CampaignPicker';
import { PromoPopupEditor } from './PromoPopupEditor';
import { FolderBrowserEditor } from './folders/FolderBrowserEditor';
import { JobOpeningsEditor } from './jobs/JobOpeningsEditor';
import { AccessPassGridEditor } from './access-pass/AccessPassGridEditor';
import { CatalogDiscoveryEditor } from './catalog/CatalogDiscoveryEditor';
import { CatalogDesignGroups } from './catalog/CatalogDesignGroups';
import { RowActions } from './catalog/design-fields';
import { CtaBandFields } from './chrome/CtaBandFields';
import { OptionalColorField, bandButtonShown } from './chrome/chrome-controls';
import { FooterBrandFields } from './chrome/FooterBrandFields';
import { HeroEditorialFields } from './chrome/HeroEditorialFields';
import { NavItemEditor } from './header/NavItemEditor';
import { AuthLinkStyleSelect } from './header/AuthLinkStyleSelect';
import { HeaderDisplayOptions } from './header/HeaderDisplayOptions';
import { HeaderLookGroup } from './header/HeaderLookGroup';
import { syncNavWithPages } from './header/header-editor-utils';
import { LearningPathEditor } from './learning-path/LearningPathEditor';
import { VisibleWhenEditor } from './settings/VisibleWhenEditor';
import { CourseLanguagesSettingsCard } from './settings/CourseLanguagesSettingsCard';
import { CourseFormatsCard } from './settings/CourseFormatsCard';
import { CoursePageSettingsCard } from './settings/CoursePageSettingsCard';
import { SitePaletteCard } from './settings/SitePaletteCard';
import { SiteCartSettingsCard } from './settings/SiteCartSettingsCard';
import { SiteAssistantSettingsCard } from './settings/SiteAssistantSettingsCard';
import { SectionJsonDialog } from './SectionJsonDialog';
import { describeKeptSettings, mergeSectionVersion } from '../-utils/section-edits';
import type { ComponentStyle } from '../-types/editor-types';

// Shared display labels for short enum-style tokens reused across many
// sub-editors below (alignment, size, style pickers, ...). The stored value
// passed to updateProp/onChange always stays the original English token —
// only the label shown in the UI is translated, so nothing persisted changes.
const optionLabel = (t: TFunction, key: string): string => t(`options.${key}`, { defaultValue: key });

// Read at edit time, and only while editing another language.
const latestStoreConfig = () => useEditorStore.getState().config;

export const PropertyPanel = () => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const {
        config: storeConfig,
        editingLocale,
        commitLocalizedEdit,
        selectedComponentId,
        selectedPageId,
        selectedGlobalSettings,
        selectedGlobalLayout,
        updateComponent: storeUpdateComponent,
        updateGlobalSettings: storeUpdateGlobalSettings,
        deleteComponent,
        duplicateComponent,
        reorderComponents,
        updatePageSeo: storeUpdatePageSeo,
        updatePageBackgroundColor,
        setPageHideSiteChrome,
        copyComponent,
        pasteComponent,
        clipboard,
    } = useEditorStore();
    // Editing another site language: editors render the localized view and
    // their text edits become translations. In the base language these are
    // the store's own config and functions, untouched.
    const localized = useLocalizedEditing({
        config: storeConfig,
        editingLocale,
        commitLocalizedEdit,
        updateComponent: storeUpdateComponent,
        updateGlobalSettings: storeUpdateGlobalSettings,
        updatePageSeo: storeUpdatePageSeo,
        getLatestConfig: latestStoreConfig,
    });
    const { config, updateComponent, updateGlobalSettings, updatePageSeo } = localized;
    // Declared before the early returns below — hooks cannot live behind a branch.
    const [variantsOpen, setVariantsOpen] = useState(false);
    const [jsonOpen, setJsonOpen] = useState(false);
    const { toast } = useToast();

    if (!config) return null;

    // Global Settings Editor — site settings are shared by every language, so
    // it always edits the base config.
    if (selectedGlobalSettings) {
        return (
            <GlobalSettingsEditor
                config={localized.baseConfig}
                updateGlobalSettings={storeUpdateGlobalSettings}
                editingLocale={localized.locale}
            />
        );
    }

    // Global Header / Footer Editor
    if (selectedGlobalLayout === 'header' || selectedGlobalLayout === 'footer') {
        return (
            <GlobalLayoutEditor
                config={config}
                section={selectedGlobalLayout}
                updateGlobalSettings={updateGlobalSettings}
                jsonDisabled={!!localized.locale}
            />
        );
    }

    if (selectedComponentId) {
        // Recursive find — searches top-level and inside columnLayout slots
        const findComponent = (components: any[]): any | null => {
            for (const c of components) {
                if (c.id === selectedComponentId) return c;
                if (Array.isArray(c.props?.slots)) {
                    for (const slot of c.props.slots as any[][]) {
                        const found = findComponent(slot);
                        if (found) return found;
                    }
                }
            }
            return null;
        };

        let component: (typeof config.pages)[number]['components'][number] | null = null;
        let pageId = '';
        // Component ids are only unique WITHIN a page (the server dedupes
        // per-page), so an id like "hero" can exist on several pages at once.
        // Resolve against the page the admin is actually editing first — a
        // first-match scan across all pages used to show (and WRITE TO) another
        // page's hero when ids collided. The global scan stays only as a
        // fallback for selections made outside a page context.
        const selectedPage = config.pages.find((p) => p.id === selectedPageId);
        const orderedPages = selectedPage
            ? [selectedPage, ...config.pages.filter((p) => p.id !== selectedPageId)]
            : config.pages;
        for (const p of orderedPages) {
            const c = findComponent(p.components);
            if (c) {
                component = c;
                pageId = p.id;
                break;
            }
        }

        if (!component) return <div className="p-4">{t('componentNotFound')}</div>;

        // Compute position within page for reorder. Read from the base config:
        // reorder writes this list back, and in another language `config` is
        // the localized view (same ids and order).
        const basePages = (localized.baseConfig ?? config).pages;
        const pageComponents = basePages.find((p) => p.id === pageId)?.components ?? [];
        const componentIndex = pageComponents.findIndex((c) => c.id === component!.id);
        // componentIndex === -1 means the selected component lives inside a slot (nested)
        const isNested = componentIndex === -1;
        const isFirst = componentIndex === 0;
        const isLast = componentIndex === pageComponents.length - 1;

        const moveUp = () => {
            if (isFirst) return;
            const next = [...pageComponents];
            [next[componentIndex - 1], next[componentIndex]] = [next[componentIndex]!, next[componentIndex - 1]!];
            reorderComponents(pageId, next);
        };

        const moveDown = () => {
            if (isLast) return;
            const next = [...pageComponents];
            [next[componentIndex], next[componentIndex + 1]] = [next[componentIndex + 1]!, next[componentIndex]!];
            reorderComponents(pageId, next);
        };

        return (
            <div className="flex flex-col gap-6 p-4">
                {/* Component Header + Action Bar */}
                <div className="border-b pb-4">
                    <div className="mb-2 flex items-start justify-between">
                        <div className="flex items-center gap-2">
                            {component.type === 'columnLayout' && (
                                <LayoutGrid className="size-4 text-teal-500" />
                            )}
                            <div>
                                <h3 className={`text-base font-semibold capitalize ${component.type === 'columnLayout' ? 'text-teal-700' : ''}`}>
                                    {component.type === 'columnLayout'
                                        ? t('columnLayoutTitle', { count: component.props?.slots?.length ?? 2 })
                                        : component.type.replace(/([A-Z])/g, ' $1').trim()}
                                </h3>
                                <div className="text-xs text-gray-400">ID: {component.id}</div>
                            </div>
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-0.5">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0 text-gray-500 hover:text-primary-500"
                                onClick={() => setVariantsOpen(true)}
                                // A whole-section swap rewrites every text at once:
                                // only offered while editing the base language.
                                disabled={!!localized.locale}
                                title={
                                    localized.locale
                                        ? 'Switch to the base language to try other versions'
                                        : t('actions.tryAnotherVersion')
                                }
                            >
                                <Sparkle className="size-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0 text-gray-500 hover:text-gray-900"
                                disabled={isFirst || isNested}
                                onClick={moveUp}
                                title={isNested ? t('actions.cannotReorderNested') : t('actions.moveUp')}
                            >
                                <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0 text-gray-500 hover:text-gray-900"
                                disabled={isLast || isNested}
                                onClick={moveDown}
                                title={isNested ? t('actions.cannotReorderNested') : t('actions.moveDown')}
                            >
                                <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0 text-gray-500 hover:text-blue-600"
                                disabled={isNested}
                                onClick={() => duplicateComponent(pageId, component!.id)}
                                title={isNested ? t('actions.cannotDuplicateNested') : t('actions.duplicate')}
                            >
                                <Copy className="size-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 p-0 text-gray-500 hover:text-red-600"
                                onClick={() => deleteComponent(pageId, component!.id)}
                                title={t('actions.delete')}
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </div>
                    </div>
                </div>

                <AiSectionVariantsDialog
                    open={variantsOpen}
                    onOpenChange={setVariantsOpen}
                    component={component}
                    page={{ id: pageId, components: pageComponents }}
                    globalSettings={config.globalSettings as Record<string, any>}
                    previewOf={(next) => {
                        const { patch, kept } = mergeSectionVersion(component!, next);
                        return { component: { ...component!, ...patch }, kept };
                    }}
                    onApply={(next) => {
                        // The new version replaces what it sets; settings it
                        // leaves out (a page hero, sidebar, card design… it has
                        // no field for) are kept, and the admin is told which.
                        // style is sent explicitly: updateComponent spreads
                        // top-level keys. Undo covers it.
                        const { patch, kept } = mergeSectionVersion(component!, next);
                        updateComponent(pageId, component!.id, patch);
                        if (kept.length) {
                            toast({
                                title: t('sectionVersion.keptTitle'),
                                description: t('sectionVersion.keptSettings', {
                                    count: describeKeptSettings(kept).length,
                                }),
                            });
                        }
                    }}
                />

                <SectionJsonDialog
                    open={jsonOpen}
                    onOpenChange={setJsonOpen}
                    value={component.props}
                    onApply={(props) => updateComponent(pageId, component!.id, { props })}
                />

                <div className="flex items-center justify-between">
                    <Label htmlFor="enabled-switch">{t('enabled')}</Label>
                    <Switch
                        id="enabled-switch"
                        checked={component.enabled}
                        onCheckedChange={(c) =>
                            updateComponent(pageId, component!.id, { enabled: c })
                        }
                    />
                </div>

                {/* Anchor ID */}
                <div className="space-y-1">
                    <Label className="flex items-center gap-1 text-xs text-gray-500">
                        <Anchor className="size-3" /> {t('anchorId.label')}
                    </Label>
                    <Input
                        value={component.anchorId || ''}
                        onChange={(e) => updateComponent(pageId, component!.id, { anchorId: e.target.value.replace(/[^a-zA-Z0-9-_]/g, '') })}
                        placeholder={t('anchorId.placeholder')}
                        className="h-7 text-xs"
                    />
                    {component.anchorId && (
                        <p className="text-caption text-gray-400">{t('anchorId.linkToThis')} <code className="rounded bg-gray-100 px-1">#{component.anchorId}</code></p>
                    )}
                </div>

                {/* Show only for certain addresses (component.visibleWhen) */}
                <VisibleWhenEditor
                    key={component.id}
                    idPrefix={component.id}
                    rules={component.visibleWhen}
                    onChange={(rules) => updateComponent(pageId, component!.id, { visibleWhen: rules })}
                />

                {/* Copy component / edit its settings as JSON */}
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => copyComponent(pageId, component!.id)}
                    >
                        <Clipboard className="me-1.5 size-3" /> {t('actions.copyToClipboard')}
                    </Button>
                    <SectionJsonButton
                        disabled={!!localized.locale}
                        onClick={() => setJsonOpen(true)}
                    />
                </div>

                {/* Component-specific editors */}
                <ComponentEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                    siteConfig={config}
                />

                {/* Universal style editor — spacing, background, border, typography, animation */}
                <div className="border-t border-gray-100 pt-4">
                    <StyleEditor
                        style={component.style || {}}
                        onChange={(newStyle: ComponentStyle) =>
                            updateComponent(pageId, component!.id, { style: newStyle })
                        }
                    />
                </div>
            </div>
        );
    }

    if (selectedPageId) {
        const page = config.pages.find((p) => p.id === selectedPageId);
        if (page) {
            return (
                <div className="flex flex-col gap-5 p-4">
                    <h3 className="text-base font-semibold">{t('pageSettings.title')}</h3>

                    {/* Per-page publish toggle removed: the flag was never
                        enforced learner-side ("Hidden from visitors" was
                        untrue). The site-level Draft/Publish in the editor
                        header is the single gate. */}
                    <div className="rounded-lg border bg-gray-50 p-3 text-xs text-gray-500">
                        {t('pageSettings.publishTogetherHint')}
                    </div>

                    {/* Basic info (read-only) */}
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>{t('pageSettings.pageTitle')}</Label>
                            <Input value={page.title || ''} readOnly disabled />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{t('pageSettings.routeSlug')}</Label>
                            <Input value={page.route} readOnly disabled />
                        </div>
                    </div>

                    {/* Page Background Color */}
                    <ColorPickerField
                        label={t('pageSettings.pageBackgroundColor')}
                        value={page.backgroundColor || '#ffffff'} // design-lint-ignore: color-editor swatch/seed value
                        onChange={(c) => updatePageBackgroundColor(page.id, c)}
                    />

                    <div className="flex items-center justify-between rounded border bg-gray-50 p-3">
                        <div className="pr-3">
                            <Label className="text-xs">{t('pageSettings.hideSiteChrome.label')}</Label>
                            <p className="text-caption text-gray-400">
                                {t('pageSettings.hideSiteChrome.hint')}
                            </p>
                        </div>
                        <Switch
                            checked={!!(page as any).hideSiteChrome}
                            onCheckedChange={(v) => setPageHideSiteChrome(page.id, v)}
                        />
                    </div>

                    {/* Paste component */}
                    {clipboard && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => pasteComponent(page.id)}
                        >
                            <ClipboardPaste className="me-1.5 size-3" /> {t('pageSettings.pasteType', { type: clipboard.type.replace(/([A-Z])/g, ' $1').trim() })}
                        </Button>
                    )}

                    {/* SEO */}
                    <div className="space-y-3 rounded-lg border bg-gray-50 p-3">
                        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('pageSettings.seo.heading')}</h4>
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs">{t('pageSettings.seo.metaTitle')}</Label>
                                <SeoLengthCounter value={page.seo?.metaTitle || ''} max={60} />
                            </div>
                            <Input
                                value={page.seo?.metaTitle || ''}
                                placeholder={page.title || page.route}
                                onChange={(e) => updatePageSeo(page.id, { metaTitle: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs">{t('pageSettings.seo.metaDescription')}</Label>
                                <SeoLengthCounter value={page.seo?.metaDescription || ''} max={160} />
                            </div>
                            <Textarea
                                rows={2}
                                value={page.seo?.metaDescription || ''}
                                placeholder={t('pageSettings.seo.metaDescriptionPlaceholder')}
                                onChange={(e) => updatePageSeo(page.id, { metaDescription: e.target.value })}
                            />
                        </div>
                        {/* How the page reads in a Google result — the copy the admin is
                            actually writing for. Pure display, from the same three fields. */}
                        <div className="rounded border bg-white p-3">
                            <p className="text-caption text-gray-400">{t('pageSettings.seo.previewHeading')}</p>
                            <p className="mt-1 truncate text-sm text-green-700">
                                …/{(page.route || '').replace(/^\//, '') || 'home'}
                            </p>
                            <p className="truncate text-base text-blue-700">
                                {page.seo?.metaTitle || page.title || page.route}
                            </p>
                            <p className="line-clamp-2 text-xs text-gray-600">
                                {page.seo?.metaDescription || t('pageSettings.seo.previewNoDescription')}
                            </p>
                        </div>
                        <ImageUploadField slot="social"
                            label={t('pageSettings.seo.ogImage')}
                            value={page.seo?.ogImage || ''}
                            onChange={(url) => updatePageSeo(page.id, { ogImage: url })}
                            placeholder={t('pageSettings.seo.ogImagePlaceholder')}
                        />
                    </div>
                </div>
            );
        }
    }

    return <div className="p-8 text-center text-gray-400">{t('selectItemToEdit')}</div>;
};

/**
 * Opens the section's settings as JSON. Only in the base language: the panel
 * shows translated text in another language, and the JSON would save it as
 * the base text.
 */
const SectionJsonButton = ({ disabled, onClick }: { disabled: boolean; onClick: () => void }) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const reasonId = useId();
    return (
        <div className="flex flex-1 flex-col gap-1">
            <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={onClick}
                disabled={disabled}
                title={disabled ? undefined : t('sectionJson.buttonHint')}
                aria-describedby={disabled ? reasonId : undefined}
            >
                <BracketsCurly className="me-1.5 size-3" /> {t('sectionJson.button')}
            </Button>
            {/* A disabled button gets no hover, so its tooltip never shows: say why here. */}
            {disabled && (
                <p id={reasonId} className="text-caption text-neutral-500">
                    {t('sectionJson.baseLanguageOnly')}
                </p>
            )}
        </div>
    );
};

// Global Layout Editor — edits globalSettings.layout.header or .footer
const GlobalLayoutEditor = ({
    config,
    section,
    updateGlobalSettings,
    jsonDisabled,
}: {
    config: any;
    section: 'header' | 'footer';
    updateGlobalSettings: (updates: any) => void;
    jsonDisabled: boolean;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const [jsonOpen, setJsonOpen] = useState(false);
    const layoutData = config.globalSettings?.layout?.[section];
    const props = layoutData?.props || {};

    const isEnabled = layoutData?.enabled !== false;

    // Wrap in a fake component shape for HeaderEditor / FooterEditor
    const fakeComponent = { id: '__global__', type: section, enabled: isEnabled, props };
    const fakeUpdateComponent = (_pageId: string, _id: string, patch: any) => {
        if (patch.props) {
            updateGlobalSettings({
                layout: {
                    ...config.globalSettings.layout,
                    [section]: { ...layoutData, props: { ...props, ...patch.props } },
                },
            });
        }
    };

    const toggleEnabled = (enabled: boolean) => {
        updateGlobalSettings({
            layout: {
                ...config.globalSettings.layout,
                [section]: { ...layoutData, enabled },
            },
        });
    };

    const removeSection = () => {
        const newLayout = { ...config.globalSettings.layout };
        delete newLayout[section];
        updateGlobalSettings({ layout: newLayout });
    };

    // The JSON editor replaces the props outright (a key deleted there is gone).
    const replaceProps = (nextProps: Record<string, unknown>) =>
        updateGlobalSettings({
            layout: {
                ...config.globalSettings.layout,
                [section]: { ...layoutData, props: nextProps },
            },
        });

    return (
        <div className="flex flex-col gap-6 p-4">
            <div className="border-b pb-3">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-base font-semibold capitalize">
                            {section === 'header' ? t('globalLayout.titleHeader') : t('globalLayout.titleFooter')}
                        </h3>
                        <p className="mt-0.5 text-xs text-purple-600">
                            {t('globalLayout.appearsOnEveryPage')}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0 text-gray-400 hover:text-red-600"
                        onClick={removeSection}
                        title={section === 'header' ? t('globalLayout.removeHeader') : t('globalLayout.removeFooter')}
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </div>
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
                <Label>{t('enabled')}</Label>
                <Switch checked={isEnabled} onCheckedChange={toggleEnabled} />
            </div>

            <div className="flex">
                <SectionJsonButton disabled={jsonDisabled} onClick={() => setJsonOpen(true)} />
            </div>
            <SectionJsonDialog
                open={jsonOpen}
                onOpenChange={setJsonOpen}
                value={props}
                onApply={replaceProps}
            />

            {isEnabled && (section === 'header' ? (
                <HeaderEditor
                    component={fakeComponent}
                    pageId="__global__"
                    updateComponent={fakeUpdateComponent}
                />
            ) : (
                <FooterEditor
                    component={fakeComponent}
                    pageId="__global__"
                    updateComponent={fakeUpdateComponent}
                />
            ))}
        </div>
    );
};

// Global Settings Editor Component
/**
 * Level grouping for the Course Finder's first step.
 *
 * The wizard lists whatever this catalogue's courses call their levels. On an
 * institute that names a level per subject — "English - Class 6",
 * "Mathematics - Class 6", "Cyber AI- Class 6" — that step turns into fifty
 * rows for a visitor who only ever wanted to say "Class 6". A group folds them
 * into one option; picking it selects every level inside it.
 *
 * Stored as `courseFinder.levelGroups`: { 'Class 6': ['English - Class 6', …] }.
 * Key order IS display order — the wizard renders Object.keys() unsorted — so
 * every edit rebuilds the object in order instead of mutating a key in place.
 *
 * Level names are offered from the institute's product pages, the same source
 * the catalogue's course blocks read: a group whose names match no real level
 * matches no courses either, and does so silently.
 */
const CourseFinderLevelGroups = ({
    groups,
    onChange,
}: {
    groups: Record<string, string[]>;
    onChange: (next: Record<string, string[]>) => void;
}) => {
    const instituteId = getCurrentInstituteId();
    const { getAllLevels } = useInstituteDetailsStore();
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [search, setSearch] = useState('');
    const [manualName, setManualName] = useState('');
    const [renameError, setRenameError] = useState<string | null>(null);

    // Same query key as the Product Page Offer editor, so opening both panels
    // costs one request.
    const { data: pages, isLoading } = useQuery({
        queryKey: ['PRODUCT_PAGES_FOR_CATALOGUE', instituteId],
        queryFn: () => getAllProductPages(instituteId!),
        enabled: !!instituteId,
        staleTime: 60_000,
    });

    // Two sources, because a catalogue can take its courses from either: a
    // `productPageOffer` block sells one product page's courses, while
    // `courseCatalog` lists the whole institute. Offering only one source would
    // leave the other kind of catalogue with an empty picker.
    const knownLevels: string[] = Array.from(
        new Set([
            ...((pages || []) as any[])
                .flatMap((p: any) => p.mappings || [])
                .map((m: any) => m.level_name),
            ...getAllLevels().map((l) => l.level_name),
        ].filter((v: any): v is string => typeof v === 'string' && v.trim() !== ''))
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const entries = Object.entries(groups) as [string, string[]][];
    const commit = (next: [string, string[]][]) => onChange(Object.fromEntries(next));

    const addGroup = () => {
        // Numbered rather than blank so two "Add" clicks cannot collide on the
        // same empty key and silently become one group.
        let n = entries.length + 1;
        while (entries.some(([label]) => label === `Group ${n}`)) n += 1;
        commit([...entries, [`Group ${n}`, []] as [string, string[]]]);
        setOpenIndex(entries.length);
    };

    const rename = (index: number, label: string) => {
        const trimmed = label.trim();
        const current = entries[index]?.[0];
        if (!trimmed || trimmed === current) return;
        if (entries.some(([existing], i) => i !== index && existing === trimmed)) {
            setRenameError(`There is already a group called “${trimmed}”.`);
            return;
        }
        setRenameError(null);
        commit(entries.map((e, i) => (i === index ? ([trimmed, e[1]] as [string, string[]]) : e)));
    };

    const move = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= entries.length) return;
        const next = [...entries];
        const [row] = next.splice(index, 1);
        next.splice(target, 0, row!);
        commit(next);
        setOpenIndex(target);
    };

    const setLevels = (index: number, levels: string[]) =>
        commit(entries.map((e, i) => (i === index ? ([e[0], levels] as [string, string[]]) : e)));

    const addManual = (index: number, levels: string[]) => {
        const name = manualName.trim();
        if (!name || levels.includes(name)) return;
        setLevels(index, [...levels, name]);
        setManualName('');
    };

    return (
        <div className="space-y-2 rounded border border-dashed border-gray-200 p-2">
            <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Group the options</Label>
                <Button variant="outline" size="sm" onClick={addGroup} className="h-7 gap-1 px-2">
                    <Plus className="size-3.5" /> Add group
                </Button>
            </div>
            <p className="text-2xs text-gray-400">
                Optional. Ask &ldquo;Class 6&rdquo; once instead of listing every subject&apos;s own
                level name. Visitors see the group names, in this order; picking one matches every
                level inside it.
            </p>

            {renameError && <p className="text-2xs text-danger-600">{renameError}</p>}

            {entries.length === 0 && (
                <p className="rounded bg-gray-50 p-2 text-2xs text-gray-500">
                    No groups — the wizard lists each level name on its own.
                </p>
            )}

            {entries.map(([label, levels], index) => {
                const open = openIndex === index;
                // Names that no course on any product page actually uses. They
                // match nothing, so they are worth calling out rather than
                // leaving to be discovered as an empty result page.
                const unknown = levels.filter((l) => !knownLevels.includes(l));
                const suggestion = knownLevels.filter(
                    (l) => !levels.includes(l) && l.toLowerCase().includes(label.trim().toLowerCase())
                );
                const visibleLevels = search.trim()
                    ? knownLevels.filter((l) => l.toLowerCase().includes(search.trim().toLowerCase()))
                    : knownLevels;

                return (
                    <div key={`${index}-${label}`} className="rounded border bg-white p-2">
                        <div className="flex items-center gap-1">
                            <Input
                                defaultValue={label}
                                onBlur={(e) => rename(index, e.target.value)}
                                className="h-7"
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => move(index, -1)}
                                disabled={index === 0}
                                className="size-7 shrink-0 p-0"
                                aria-label="Move group up"
                            >
                                <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => move(index, 1)}
                                disabled={index === entries.length - 1}
                                className="size-7 shrink-0 p-0"
                                aria-label="Move group down"
                            >
                                <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => commit(entries.filter((_, i) => i !== index))}
                                className="size-7 shrink-0 p-0 text-danger-600"
                                aria-label={`Delete group ${label}`}
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                setOpenIndex(open ? null : index);
                                setSearch('');
                                setManualName('');
                            }}
                            className="mt-1 flex w-full items-center justify-between gap-2 text-start text-2xs text-gray-500"
                        >
                            <span>
                                {levels.length === 0
                                    ? 'No levels yet — this option would match nothing'
                                    : `${levels.length} level${levels.length === 1 ? '' : 's'}`}
                                {unknown.length > 0 && ` · ${unknown.length} not found`}
                            </span>
                            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        </button>

                        {levels.length === 0 && (
                            <p className="text-2xs text-warning-600">
                                Add at least one level, or delete the group.
                            </p>
                        )}
                        {unknown.length > 0 && (
                            <p className="text-2xs text-warning-600">
                                No course uses {unknown.map((u) => `“${u}”`).join(', ')} — check the
                                spelling against the list below.
                            </p>
                        )}

                        {open && (
                            <div className="mt-2 space-y-2 border-t pt-2">
                                {suggestion.length > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setLevels(index, [...levels, ...suggestion])}
                                        className="h-7 w-full gap-1 px-2 text-2xs"
                                    >
                                        <Plus className="size-3.5" />
                                        Add the {suggestion.length} level
                                        {suggestion.length === 1 ? '' : 's'} containing “{label.trim()}”
                                    </Button>
                                )}

                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search levels"
                                    className="h-7"
                                />

                                {/* Escape hatch. An institute whose levels this
                                    panel cannot see — courses not on a product
                                    page, details not loaded — can still name one
                                    by hand; it is flagged as "not found" below
                                    until a course actually uses it. */}
                                <div className="flex items-center gap-1">
                                    <Input
                                        value={manualName}
                                        onChange={(e) => setManualName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                addManual(index, levels);
                                            }
                                        }}
                                        placeholder="Or type a level name"
                                        className="h-7"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => addManual(index, levels)}
                                        disabled={!manualName.trim() || levels.includes(manualName.trim())}
                                        className="h-7 shrink-0 px-2 text-2xs"
                                    >
                                        Add
                                    </Button>
                                </div>

                                <div className="max-h-48 space-y-1 overflow-y-auto pe-1">
                                    {isLoading && <p className="text-2xs text-gray-400">Loading levels…</p>}
                                    {!isLoading && knownLevels.length === 0 && (
                                        <p className="text-2xs text-gray-400">
                                            No levels found. They are read from this
                                            institute&apos;s courses and product pages — set one up
                                            first, or type the name into a group by hand.
                                        </p>
                                    )}
                                    {visibleLevels.map((level) => (
                                        <label
                                            key={level}
                                            className="flex items-center gap-2 text-2xs text-gray-700"
                                        >
                                            <Checkbox
                                                checked={levels.includes(level)}
                                                onCheckedChange={() =>
                                                    setLevels(
                                                        index,
                                                        levels.includes(level)
                                                            ? levels.filter((l) => l !== level)
                                                            : [...levels, level]
                                                    )
                                                }
                                            />
                                            {level}
                                        </label>
                                    ))}
                                    {/* Kept selectable even though no course uses them: they may
                                        be a typo the admin wants to uncheck, or a level on a page
                                        that is not ACTIVE yet. */}
                                    {unknown.map((level) => (
                                        <label
                                            key={level}
                                            className="flex items-center gap-2 text-2xs text-warning-600"
                                        >
                                            <Checkbox
                                                checked
                                                onCheckedChange={() =>
                                                    setLevels(index, levels.filter((l) => l !== level))
                                                }
                                            />
                                            {level}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

/** "58/60" next to a meta field — amber once past what Google displays. */
const SeoLengthCounter = ({ value, max }: { value: string; max: number }) => {
    const n = value.length;
    return (
        <span className={`text-caption ${n > max ? 'text-amber-600' : 'text-gray-400'}`}>
            {n}/{max}
        </span>
    );
};

/**
 * A list stored as string[] but edited as free text (comma- or line-separated).
 * Edits are committed on blur: committing per keystroke would strip the
 * separator the admin has just typed, making it impossible to add an item.
 */
const SeoListField = ({
    value,
    separator,
    placeholder,
    className,
    onCommit,
}: {
    value: string[];
    separator: 'comma' | 'line';
    placeholder?: string;
    className?: string;
    onCommit: (list: string[]) => void;
}) => {
    const join = separator === 'comma' ? ', ' : '\n';
    const stored = value.join(join);
    const [text, setText] = useState(stored);
    const [lastStored, setLastStored] = useState(stored);
    // Re-sync when the stored list changes underneath (undo, another editor).
    // Compared by CONTENT: the parent hands over a fresh `[]` on every render
    // while the list is empty, and a reference check would reset the admin's
    // uncommitted typing each time anything else in the panel re-rendered.
    if (lastStored !== stored) {
        setLastStored(stored);
        setText(stored);
    }
    const commit = () => {
        const list = text
            .split(separator === 'comma' ? /[,\n]/ : /\n/)
            .map((x) => x.trim())
            .filter(Boolean);
        onCommit(list);
    };
    return (
        <Textarea
            className={className}
            rows={separator === 'comma' ? 2 : 3}
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
        />
    );
};

const GlobalSettingsEditor = ({
    config,
    updateGlobalSettings,
    editingLocale,
}: {
    config: any;
    updateGlobalSettings: (updates: any) => void;
    /** The non-base language being edited, or null: base texts are then read-only. */
    editingLocale: string | null;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const gs = config.globalSettings || {};
    // A site with its own palette (theme.palette) colours its editorial parts
    // from it: the primary colour is written to the palette as well so both
    // stay in step. Only a palette that re-points the shared tokens
    // (applyToTokens) overrides the presets' colours (in light mode), so only
    // then are the presets greyed out.
    const palette = gs.theme?.palette;
    const hasPalette = !!palette && typeof palette === 'object' && !Array.isArray(palette);
    const paletteOwnsTokens = hasPalette && palette.applyToTokens === true;
    // The palette card also carries the content width, so a site with only a width gets it too.
    const hasThemeCard = hasPalette || gs.theme?.contentMaxWidth !== undefined;
    const setPrimaryColor = (color: string) =>
        updateGlobalSettings({
            theme: {
                ...gs.theme,
                primaryColor: color,
                ...(hasPalette ? { palette: { ...palette, primary: color } } : {}),
            },
        });

    const updateField = (path: string, value: any) => {
        const keys = path.split('.');
        const key0 = keys[0] as string;
        const key1 = keys[1] as string | undefined;
        const key2 = keys[2] as string | undefined;

        if (keys.length === 1) {
            updateGlobalSettings({ [key0]: value });
        } else if (keys.length === 2 && key1) {
            updateGlobalSettings({
                [key0]: {
                    ...gs[key0],
                    [key1]: value,
                },
            });
        } else if (keys.length === 3 && key1 && key2) {
            updateGlobalSettings({
                [key0]: {
                    ...gs[key0],
                    [key1]: {
                        ...gs[key0]?.[key1],
                        [key2]: value,
                    },
                },
            });
        }
    };

    return (
        <div className="flex flex-col gap-6 overflow-auto p-4">
            <div className="flex items-center gap-2 border-b pb-4">
                <Settings className="size-5 text-indigo-600" />
                <h3 className="text-lg font-semibold">{t('global.title')}</h3>
            </div>

            {/* Catalogue Type */}
            <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
                <h4 className="font-medium text-gray-700">{t('global.catalogueType.heading')}</h4>
                <div className="flex items-center justify-between">
                    <Label>{t('global.catalogueType.type')}</Label>
                    <select
                        className="rounded border px-3 py-1.5 text-sm"
                        value={gs.courseCatalogeType?.value || 'Course'}
                        onChange={(e) => updateField('courseCatalogeType.value', e.target.value)}
                    >
                        <option value="Course">{t('global.catalogueType.course')}</option>
                        <option value="Product">{t('global.catalogueType.product')}</option>
                    </select>
                </div>
            </div>

            {/* Theme Settings */}
            <div className="space-y-4 rounded-lg border bg-gray-50 p-4">
                <h4 className="font-medium text-gray-700">{t('global.theme.heading')}</h4>

                {/* Color Presets */}
                <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('global.theme.colorPreset')}</Label>
                    {paletteOwnsTokens && (
                        <p className="text-caption text-neutral-500">{t('global.theme.ownPaletteNote')}</p>
                    )}
                    <div
                        className={`grid grid-cols-3 gap-2 ${paletteOwnsTokens ? 'opacity-50' : ''}`}
                    >
                        {(
                            [
                                { key: 'default', color: '#3B82F6' }, // design-lint-ignore: color-editor swatch/seed value
                                { key: 'ocean',   color: '#0EA5E9' }, // design-lint-ignore: color-editor swatch/seed value
                                { key: 'forest',  color: '#16A34A' }, // design-lint-ignore: color-editor swatch/seed value
                                { key: 'sunset',  color: '#F97316' }, // design-lint-ignore: color-editor swatch/seed value
                                { key: 'midnight',color: '#7C3AED' }, // design-lint-ignore: color-editor swatch/seed value
                                { key: 'rose',    color: '#E11D48' }, // design-lint-ignore: color-editor swatch/seed value
                                { key: 'violet',  color: '#8B5CF6' }, // design-lint-ignore: color-editor swatch/seed value
                                { key: 'amber',   color: '#D97706' }, // design-lint-ignore: color-editor swatch/seed value
                                { key: 'slate',   color: '#334155' }, // design-lint-ignore: color-editor swatch/seed value
                            ] as const
                        ).map(({ key, color }) => {
                            const label = optionLabel(t, key);
                            const isActive = (gs.theme?.preset || 'default') === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    title={label}
                                    disabled={paletteOwnsTokens}
                                    onClick={() => updateField('theme.preset', key)}
                                    className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 text-caption font-medium transition-all ${
                                        isActive
                                            ? 'border-gray-800 bg-white shadow-sm'
                                            : 'border-transparent hover:border-gray-300'
                                    }`}
                                >
                                    <span
                                        className="size-6 rounded-full shadow-sm"
                                        style={{ backgroundColor: color }}
                                    />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Custom primary color override */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs text-gray-500">{t('global.theme.customColorOverride')}</Label>
                        {gs.theme?.primaryColor && (
                            <button
                                type="button"
                                onClick={() => updateField('theme.primaryColor', undefined)}
                                className="text-caption text-gray-400 hover:text-red-500"
                            >
                                {t('actions.clear')}
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="color"
                            value={gs.theme?.primaryColor || '#3B82F6'} // design-lint-ignore: color-editor swatch/seed value
                            onChange={(e) => setPrimaryColor(e.target.value)}
                            className="h-8 w-10 cursor-pointer rounded border bg-white p-0.5"
                        />
                        <span className="font-mono text-xs text-gray-500">
                            {gs.theme?.primaryColor || t('global.theme.usingPreset')}
                        </span>
                    </div>
                    <p className="text-caption text-gray-400">
                        {t('global.theme.customColorHint')}
                    </p>
                </div>

                {/* Border Radius */}
                <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('global.theme.cornerStyle')}</Label>
                    <div className="flex gap-2">
                        {(
                            [
                                { key: 'sharp',   preview: '2px'    },
                                { key: 'rounded', preview: '8px'    },
                                { key: 'pill',    preview: '9999px' },
                            ] as const
                        ).map(({ key, preview }) => {
                            const isActive = (gs.theme?.borderRadius || 'rounded') === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => updateField('theme.borderRadius', key)}
                                    className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border-2 py-2 text-caption font-medium transition-all ${
                                        isActive
                                            ? 'border-gray-800 bg-white shadow-sm'
                                            : 'border-transparent bg-white hover:border-gray-300'
                                    }`}
                                >
                                    <span
                                        className="h-4 w-8 border-2 border-gray-600 bg-transparent"
                                        style={{ borderRadius: preview }}
                                    />
                                    {optionLabel(t, key)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Heading Scale */}
                <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('global.theme.headingScale')}</Label>
                    <div className="flex gap-2">
                        {(
                            [
                                { key: 'compact' },
                                { key: 'default' },
                                { key: 'large' },
                                { key: 'display' },
                            ] as const
                        ).map(({ key }) => {
                            const isActive = (gs.theme?.headingScale || 'default') === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => updateField('theme.headingScale', key)}
                                    className={`flex-1 rounded-lg border-2 py-1.5 text-caption font-medium transition-all ${
                                        isActive
                                            ? 'border-gray-800 bg-white shadow-sm'
                                            : 'border-transparent bg-white hover:border-gray-300'
                                    }`}
                                >
                                    {optionLabel(t, key)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Atmosphere — page canvas treatment (data-catalogue-atmosphere) */}
                <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('global.theme.atmosphere')}</Label>
                    <div className="flex gap-2">
                        {(
                            [
                                { key: 'flat' },
                                { key: 'soft' },
                                { key: 'mesh' },
                                { key: 'aurora' },
                            ] as const
                        ).map(({ key }) => {
                            const label = optionLabel(t, key);
                            const isActive = (gs.theme?.atmosphere?.canvas || 'flat') === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() =>
                                        updateField('theme.atmosphere', {
                                            ...(gs.theme?.atmosphere || {}),
                                            canvas: key,
                                        })
                                    }
                                    className={`flex-1 rounded-lg border-2 py-1.5 text-caption font-medium transition-all ${
                                        isActive
                                            ? 'border-gray-800 bg-white shadow-sm'
                                            : 'border-transparent bg-white hover:border-gray-300'
                                    }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    {(gs.theme?.atmosphere?.canvas || 'flat') !== 'flat' && (
                        <div className="flex gap-2">
                            {(
                                [
                                    { key: 'subtle' },
                                    { key: 'medium' },
                                    { key: 'bold' },
                                ] as const
                            ).map(({ key }) => {
                                const label = optionLabel(t, key);
                                const isActive = (gs.theme?.atmosphere?.intensity || 'subtle') === key;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() =>
                                            updateField('theme.atmosphere', {
                                                ...(gs.theme?.atmosphere || { canvas: 'mesh' }),
                                                intensity: key,
                                            })
                                        }
                                        className={`flex-1 rounded-lg border-2 py-1 text-caption font-medium transition-all ${
                                            isActive
                                                ? 'border-gray-800 bg-white shadow-sm'
                                                : 'border-transparent bg-white hover:border-gray-300'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Motion personality — entrance duration/easing site-wide */}
                <div className="space-y-2">
                    <Label className="text-xs text-gray-500">{t('global.theme.motion')}</Label>
                    <div className="flex gap-2">
                        {(
                            [
                                { key: 'none' },
                                { key: 'calm' },
                                { key: 'balanced' },
                                { key: 'dynamic' },
                            ] as const
                        ).map(({ key }) => {
                            const label = optionLabel(t, key);
                            // Unset ≠ Balanced: legacy configs omit the attribute and keep
                            // the :root motion fallbacks, so no button is pre-lit.
                            const isActive = gs.motion?.personality === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => updateField('motion', { personality: key })}
                                    className={`flex-1 rounded-lg border-2 py-1.5 text-caption font-medium transition-all ${
                                        isActive
                                            ? 'border-gray-800 bg-white shadow-sm'
                                            : 'border-transparent bg-white hover:border-gray-300'
                                    }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Back to Top Button */}
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-gray-500">{t('global.theme.backToTopButton')}</Label>
                    <Switch
                        checked={gs.backToTop || false}
                        onCheckedChange={(c) => updateField('backToTop', c)}
                    />
                </div>

                {/* Mode */}
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-gray-500">{t('global.theme.mode')}</Label>
                    <div className="flex overflow-hidden rounded-lg border">
                        {(['light', 'dark'] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => updateField('mode', m)}
                                className={`px-3 py-1 text-xs font-medium capitalize transition-colors ${
                                    (gs.mode || 'light') === m
                                        ? 'bg-gray-800 text-white'
                                        : 'bg-white text-gray-500 hover:bg-gray-50'
                                }`}
                            >
                                {optionLabel(t, m)}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <Label className="text-xs text-gray-500">{t('global.theme.compactness')}</Label>
                    <select
                        className="rounded border px-3 py-1.5 text-sm"
                        value={gs.compactness || 'medium'}
                        onChange={(e) => updateField('compactness', e.target.value)}
                    >
                        <option value="small">{optionLabel(t, 'small')}</option>
                        <option value="medium">{optionLabel(t, 'medium')}</option>
                        <option value="large">{optionLabel(t, 'large')}</option>
                    </select>
                </div>
            </div>

            {/* Site palette + content width — only on a site that has its own palette or width */}
            {hasThemeCard && (
                <SitePaletteCard theme={gs.theme} onThemeChange={(next) => updateField('theme', next)} />
            )}

            {/* Fonts */}
            <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
                <h4 className="font-medium text-gray-700">{t('global.fonts.heading')}</h4>
                <div className="flex items-center justify-between">
                    <Label>{t('global.fonts.customFonts')}</Label>
                    <Switch
                        checked={gs.fonts?.enabled || false}
                        onCheckedChange={(c) => updateField('fonts.enabled', c)}
                    />
                </div>
                {gs.fonts?.enabled && (
                    <div className="space-y-2">
                        <Label className="text-xs">{t('global.fonts.bodyFont')}</Label>
                        <select
                            className="w-full rounded border px-3 py-1.5 text-sm"
                            value={gs.fonts?.family || 'Inter, sans-serif'}
                            onChange={(e) => updateField('fonts.family', e.target.value)}
                        >
                            {CATALOGUE_FONTS.map((f) => (
                                <option key={f.label} value={f.stack}>{f.label}</option>
                            ))}
                        </select>
                        <Label className="text-xs">{t('global.fonts.headingFont')}</Label>
                        <select
                            className="w-full rounded border px-3 py-1.5 text-sm"
                            value={gs.fonts?.headingFamily || ''}
                            onChange={(e) => updateField('fonts.headingFamily', e.target.value || undefined)}
                        >
                            <option value="">{t('global.fonts.sameAsBody')}</option>
                            {CATALOGUE_FONTS.map((f) => (
                                <option key={f.label} value={f.stack}>
                                    {f.label}{f.serif ? ` ${t('global.fonts.serifSuffix')}` : ''}
                                </option>
                            ))}
                        </select>
                        <p className="text-caption text-gray-400">
                            {t('global.fonts.pairingHint')}
                        </p>
                    </div>
                )}
            </div>

            {/* Site languages (हिन्दी / EN) */}
            <LanguagesSettingsCard
                config={config}
                i18n={gs.i18n}
                onChange={(next) => updateField('i18n', next)}
            />

            {/* Payment Settings */}
            <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
                <h4 className="font-medium text-gray-700">{t('global.payment.heading')}</h4>
                <div className="flex items-center justify-between">
                    <Label>{t('global.payment.enable')}</Label>
                    <Switch
                        checked={gs.payment?.enabled || false}
                        onCheckedChange={(c) => updateField('payment.enabled', c)}
                    />
                </div>
                {gs.payment?.enabled && (
                    <div className="space-y-2">
                        <Label className="text-xs">{t('global.payment.provider')}</Label>
                        <select
                            className="w-full rounded border px-3 py-1.5 text-sm"
                            value={gs.payment?.provider || 'razorpay'}
                            onChange={(e) => updateField('payment.provider', e.target.value)}
                        >
                            {/* Payment provider names are real brand names — never translated. */}
                            <option value="razorpay">Razorpay</option>
                            <option value="stripe">Stripe</option>
                            <option value="PHONEPE">PhonePe</option>
                            <option value="paypal">PayPal</option>
                        </select>
                    </div>
                )}
            </div>

            {/* WhatsApp — the highest-intent contact channel in this market;
                a floating button on every page, tracked as a conversion. */}
            <div className="space-y-3 border-b pb-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-700">{t('global.whatsapp.heading')}</h4>
                    <Switch
                        checked={gs.whatsapp?.enabled || false}
                        onCheckedChange={(c) => updateField('whatsapp.enabled', c)}
                    />
                </div>
                <p className="text-caption text-gray-400">
                    {t('global.whatsapp.hint')}
                </p>
                {gs.whatsapp?.enabled && (
                    <>
                        <div>
                            <Label className="text-xs">{t('global.whatsapp.numberLabel')}</Label>
                            <Input className="mt-1" placeholder="919895603342" value={gs.whatsapp?.phone || ''} onChange={(e) => updateField('whatsapp.phone', e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-xs">{t('global.whatsapp.prefilledMessage')}</Label>
                            <Input className="mt-1" placeholder={t('global.whatsapp.prefilledMessagePlaceholder')} value={gs.whatsapp?.message || ''} onChange={(e) => updateField('whatsapp.message', e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-xs">{t('global.whatsapp.buttonLabelOptional')}</Label>
                            <Input className="mt-1" placeholder={t('global.whatsapp.buttonLabelPlaceholder')} value={gs.whatsapp?.label || ''} onChange={(e) => updateField('whatsapp.label', e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-xs">{t('global.whatsapp.position')}</Label>
                            <div className="mt-1 flex gap-1">
                                {(['right', 'left'] as const).map((pos) => (
                                    <button key={pos} onClick={() => updateField('whatsapp.position', pos)}
                                        className={`rounded px-2.5 py-1 text-caption font-medium capitalize ${(gs.whatsapp?.position || 'right') === pos ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, pos)}</button>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Tracking & Analytics — the measurement layer for the whole site.
                Stored in the catalogue JSON, injected on learner catalogue
                routes only; lead submissions fire a standard Lead event. */}
            <div className="space-y-3 border-b pb-4">
                <h4 className="font-medium text-gray-700">{t('global.tracking.heading')}</h4>
                <p className="text-caption text-gray-400">
                    {t('global.tracking.hint')}
                </p>
                <div>
                    <Label className="text-xs">{t('global.tracking.ga4Label')}</Label>
                    <Input className="mt-1" placeholder="G-XXXXXXXXXX" value={gs.tracking?.ga4MeasurementId || ''} onChange={(e) => updateField('tracking.ga4MeasurementId', e.target.value.trim())} />
                </div>
                <div>
                    <Label className="text-xs">{t('global.tracking.metaPixelLabel')}</Label>
                    <Input className="mt-1" placeholder="1234567890" value={gs.tracking?.metaPixelId || ''} onChange={(e) => updateField('tracking.metaPixelId', e.target.value.trim())} />
                </div>
                <div>
                    <Label className="text-xs">{t('global.tracking.gtmLabel')}</Label>
                    <Input className="mt-1" placeholder="GTM-XXXXXXX" value={gs.tracking?.gtmId || ''} onChange={(e) => updateField('tracking.gtmId', e.target.value.trim())} />
                    <p className="mt-1 text-caption text-gray-400">{t('global.tracking.gtmHint')}</p>
                </div>
            </div>

            {/* Search engine optimisation. Read by the learner edge middleware
                for crawlers: keywords/verification → <head>, organization →
                schema.org JSON-LD. Footer social links join sameAs on their own. */}
            <div className="space-y-3 border-b pb-4">
                <h4 className="font-medium text-gray-700">{t('global.seo.heading')}</h4>
                <p className="text-caption text-gray-400">{t('global.seo.hint')}</p>
                <div>
                    <Label className="text-xs">{t('global.seo.keywordsLabel')}</Label>
                    <SeoListField
                        className="mt-1"
                        value={gs.seo?.keywords || []}
                        separator="comma"
                        placeholder={t('global.seo.keywordsPlaceholder')}
                        onCommit={(list) => updateField('seo.keywords', list)}
                    />
                    <p className="mt-1 text-caption text-gray-400">{t('global.seo.keywordsHint')}</p>
                </div>
                <div>
                    <Label className="text-xs">{t('global.seo.verificationLabel')}</Label>
                    <Input
                        className="mt-1"
                        placeholder="abc123…"
                        value={gs.seo?.googleSiteVerification || ''}
                        onChange={(e) => updateField('seo.googleSiteVerification', e.target.value.trim())}
                    />
                    <p className="mt-1 text-caption text-gray-400">{t('global.seo.verificationHint')}</p>
                </div>
                <div className="space-y-2 rounded-lg border bg-gray-50 p-3">
                    <p className="text-xs font-semibold text-gray-600">{t('global.seo.organizationHeading')}</p>
                    <p className="text-caption text-gray-400">{t('global.seo.organizationHint')}</p>
                    <div>
                        <Label className="text-xs">{t('global.seo.orgName')}</Label>
                        <Input className="mt-1" value={gs.seo?.organization?.name || ''} onChange={(e) => updateField('seo.organization.name', e.target.value)} />
                    </div>
                    <div>
                        <Label className="text-xs">{t('global.seo.orgDescription')}</Label>
                        <Textarea className="mt-1" rows={2} value={gs.seo?.organization?.description || ''} onChange={(e) => updateField('seo.organization.description', e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-xs">{t('global.seo.orgFounder')}</Label>
                            <Input className="mt-1" value={gs.seo?.organization?.founder || ''} onChange={(e) => updateField('seo.organization.founder', e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-xs">{t('global.seo.orgFoundingDate')}</Label>
                            <Input className="mt-1" placeholder="2024" value={gs.seo?.organization?.foundingDate || ''} onChange={(e) => updateField('seo.organization.foundingDate', e.target.value.trim())} />
                        </div>
                        <div>
                            <Label className="text-xs">{t('global.seo.orgEmail')}</Label>
                            <Input className="mt-1" type="email" value={gs.seo?.organization?.email || ''} onChange={(e) => updateField('seo.organization.email', e.target.value.trim())} />
                        </div>
                        <div>
                            <Label className="text-xs">{t('global.seo.orgTelephone')}</Label>
                            <Input className="mt-1" placeholder="+91 …" value={gs.seo?.organization?.telephone || ''} onChange={(e) => updateField('seo.organization.telephone', e.target.value.trim())} />
                        </div>
                    </div>
                    <div>
                        <Label className="text-xs">{t('global.seo.orgAddress')}</Label>
                        <Input className="mt-1" value={gs.seo?.organization?.address || ''} onChange={(e) => updateField('seo.organization.address', e.target.value)} />
                    </div>
                    <ImageUploadField slot="logo"
                        label={t('global.seo.orgLogo')}
                        value={gs.seo?.organization?.logo || ''}
                        onChange={(url) => updateField('seo.organization.logo', url)}
                        placeholder="https://…/logo.png"
                    />
                    <p className="text-caption text-gray-400">{t('global.seo.orgLogoHint')}</p>
                    <div>
                        <Label className="text-xs">{t('global.seo.sameAsLabel')}</Label>
                        <SeoListField
                            className="mt-1"
                            value={gs.seo?.organization?.sameAs || []}
                            separator="line"
                            placeholder={'https://www.facebook.com/…\nhttps://www.instagram.com/…'}
                            onCommit={(list) => updateField('seo.organization.sameAs', list)}
                        />
                        <p className="mt-1 text-caption text-gray-400">{t('global.seo.sameAsHint')}</p>
                    </div>
                </div>
                <p className="text-caption text-gray-400">{t('global.seo.sitemapHint')}</p>
            </div>

            {/* Lead Collection */}
            <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
                <h4 className="font-medium text-gray-700">{t('global.leadCollection.heading')}</h4>
                <div className="flex items-center justify-between">
                    <Label>{t('global.leadCollection.enable')}</Label>
                    <Switch
                        checked={gs.leadCollection?.enabled || false}
                        onCheckedChange={(c) => updateField('leadCollection.enabled', c)}
                    />
                </div>
                {gs.leadCollection?.enabled && (
                    <>
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">{t('global.leadCollection.mandatory')}</Label>
                            <Switch
                                checked={gs.leadCollection?.mandatory || false}
                                onCheckedChange={(c) => updateField('leadCollection.mandatory', c)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">{t('global.leadCollection.inviteLink')}</Label>
                            <Input
                                value={gs.leadCollection?.inviteLink || ''}
                                onChange={(e) =>
                                    updateField('leadCollection.inviteLink', e.target.value)
                                }
                                placeholder={t('global.leadCollection.inviteLinkPlaceholder')}
                            />
                        </div>
                    </>
                )}
            </div>

            {/* Course Finder */}
            <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
                <h4 className="font-medium text-gray-700">{t('global.courseFinder.heading')}</h4>
                <p className="text-caption text-gray-500">
                    {t('global.courseFinder.hint')}
                </p>
                <div className="flex items-center justify-between">
                    <Label>{t('global.courseFinder.enable')}</Label>
                    <Switch
                        checked={gs.courseFinder?.enabled || false}
                        onCheckedChange={(c) => updateField('courseFinder.enabled', c)}
                    />
                </div>
                {gs.courseFinder?.enabled && (
                    <>
                        <div className="space-y-2">
                            <Label className="text-xs">{t('global.courseFinder.stepsToAsk')}</Label>
                            <div className="flex flex-col gap-2">
                                {(
                                    [
                                        { key: 'level', term: [ContentTerms.Level, SystemTerms.Level] },
                                        { key: 'session', term: [ContentTerms.Session, SystemTerms.Session] },
                                        { key: 'tag', term: [ContentTerms.PopularTag, SystemTerms.PopularTag] },
                                    ] as const
                                ).map(({ key, term }) => {
                                    const steps: string[] = gs.courseFinder?.steps || [];
                                    const checked = steps.includes(key);
                                    return (
                                        <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                                            <Checkbox
                                                checked={checked}
                                                onCheckedChange={() => {
                                                    const next = checked
                                                        ? steps.filter((s) => s !== key)
                                                        : [...steps, key];
                                                    updateField('courseFinder.steps', next);
                                                }}
                                            />
                                            {getTerminology(term[0], term[1])}
                                        </label>
                                    );
                                })}
                            </div>
                            <p className="text-2xs text-gray-400">
                                {t('global.courseFinder.stepsOrderHint')}
                            </p>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">{t('global.courseFinder.requireCompletion')}</Label>
                            <Switch
                                checked={gs.courseFinder?.mandatory || false}
                                onCheckedChange={(c) => updateField('courseFinder.mandatory', c)}
                            />
                        </div>

                        {/* Step titles. The wizard otherwise asks "Choose your
                            Level", which is platform vocabulary — a parent is
                            looking for a Class, a college for a Semester. */}
                        <div className="space-y-2">
                            <Label className="text-xs">What each step is called</Label>
                            {(
                                [
                                    ['level', ContentTerms.Level, SystemTerms.Level, 'Class'],
                                    ['session', ContentTerms.Session, SystemTerms.Session, 'Batch'],
                                    ['tag', ContentTerms.PopularTag, SystemTerms.PopularTag, 'Board'],
                                ] as const
                            )
                                .filter(([key]) => (gs.courseFinder?.steps || []).includes(key))
                                .map(([key, contentTerm, systemTerm, example]) => (
                                    <div key={key} className="flex items-center gap-2">
                                        <span className="w-20 shrink-0 text-caption text-gray-500">
                                            {getTerminology(contentTerm, systemTerm)}
                                        </span>
                                        <Input
                                            value={gs.courseFinder?.stepLabels?.[key] || ''}
                                            onChange={(e) =>
                                                updateField(`courseFinder.stepLabels.${key}`, e.target.value)
                                            }
                                            placeholder={`e.g. ${example}`}
                                        />
                                    </div>
                                ))}
                            <p className="text-2xs text-gray-400">
                                Leave blank to use the platform wording. Only the steps you ticked
                                above are asked, so only those are listed here.
                            </p>
                        </div>

                        {(gs.courseFinder?.steps || []).includes('level') && (
                            <CourseFinderLevelGroups
                                groups={gs.courseFinder?.levelGroups || {}}
                                onChange={(next) => updateField('courseFinder.levelGroups', next)}
                            />
                        )}
                    </>
                )}
            </div>

            {/* Course pages */}
            <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
                <h4 className="font-medium text-gray-700">{t('global.coursePages.heading')}</h4>
                <p className="text-caption text-gray-500">{t('global.coursePages.hint')}</p>
                <div className="flex items-center justify-between">
                    <Label>{t('global.coursePages.enable')}</Label>
                    <Switch
                        checked={gs.coursePages?.enabled || false}
                        onCheckedChange={(c) => updateField('coursePages.enabled', c)}
                    />
                </div>
                {gs.coursePages?.enabled && (
                    <CoursePagesEditor
                        courses={gs.coursePages?.courses || {}}
                        pages={config.pages || []}
                        onChange={(next) => updateField('coursePages.courses', next)}
                    />
                )}
            </div>

            {/* Course languages + site cart (each card in its own file) */}
            <CourseLanguagesSettingsCard
                value={gs.courseLanguages}
                onChange={(next) => updateField('courseLanguages', next)}
            />
            {gs.courseFormats &&
                typeof gs.courseFormats === 'object' &&
                !Array.isArray(gs.courseFormats) && (
                    <CourseFormatsCard
                        formats={gs.courseFormats}
                        order={
                            Array.isArray(gs.courseFormatOrder) ? gs.courseFormatOrder : undefined
                        }
                        onChange={(next) => updateGlobalSettings(next)}
                        fromTags={gs.courseFormatsFromTags}
                        onFromTagsChange={(next) => updateField('courseFormatsFromTags', next)}
                        i18n={gs.i18n}
                        readOnlyNames={!!editingLocale}
                    />
            )}
            <CoursePageSettingsCard
                value={gs.courseDetails}
                onChange={(next) => updateField('courseDetails', next)}
            />
            <SiteCartSettingsCard value={gs.siteCart} onChange={(next) => updateField('siteCart', next)} />
            <SiteAssistantSettingsCard
                value={gs.siteAssistant}
                onChange={(next) => updateField('siteAssistant', next)}
                config={config}
            />

            {/* Enquiry */}
            <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
                <h4 className="font-medium text-gray-700">{t('global.enquiry.heading')}</h4>
                <div className="flex items-center justify-between">
                    <Label>{t('global.enquiry.enable')}</Label>
                    <Switch
                        checked={gs.enrquiry?.enabled || false}
                        onCheckedChange={(c) => updateField('enrquiry.enabled', c)}
                    />
                </div>
            </div>
        </div>
    );
};

// ── Column Layout Editor ──────────────────────────────────────────────────────
const ColumnLayoutEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { selectComponent, deleteFromSlot } = useEditorStore();
    const { slots = [] as any[][], columnWidths = [] as string[], gap = 'md', align = 'top', stackOnMobile = true } = component.props;

    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...component.props, [key]: value } });

    // Default width fraction for a given column count
    const defaultWidthForCount: Record<number, string> = { 2: '1/2', 3: '1/3', 4: '1/4' };
    const defaultWidth = defaultWidthForCount[slots.length] || '1/2';

    const changeColumnCount = (newCount: number) => {
        if (newCount === slots.length) return;
        const def = defaultWidthForCount[newCount] || '1/2';
        const newSlots = Array.from({ length: newCount }, (_, i) => slots[i] ?? []);
        const newWidths = Array.from({ length: newCount }, (_, i) => columnWidths[i] ?? def);
        updateComponent(pageId, component.id, {
            // columnFr is a per-count precise ratio — clear it on count change or a
            // stale 2-column ratio silently re-activates when switching back to 2.
            props: { ...component.props, columns: newCount, slots: newSlots, columnWidths: newWidths, columnFr: undefined },
        });
    };

    const TYPE_LABEL: Record<string, string> = {
        heroSection: t('componentTypes.heroSection'), courseCatalog: t('componentTypes.courseCatalog'), bookCatalogue: t('componentTypes.bookCatalogue'),
        statsHighlights: t('componentTypes.statsHighlights'), testimonialSection: t('componentTypes.testimonialSection'), mediaShowcase: t('componentTypes.mediaShowcase'),
        faqSection: t('componentTypes.faqSection'), ctaBanner: t('componentTypes.ctaBanner'), pricingTable: t('componentTypes.pricingTable'), contactForm: t('componentTypes.contactForm'),
        teamSection: t('componentTypes.teamSection'), announcementFeed: t('componentTypes.announcementFeed'), imageGallery: t('componentTypes.imageGallery'),
        videoEmbed: t('componentTypes.videoEmbed'), buyRentSection: t('componentTypes.buyRentSection'), policyRenderer: t('componentTypes.policyRenderer'),
        cartComponent: t('componentTypes.cartComponent'), courseDetails: t('componentTypes.courseDetails'), bookDetails: t('componentTypes.bookDetails'),
        spacer: t('componentTypes.spacer'), tabsAccordion: t('componentTypes.tabsAccordion'), logoCloud: t('componentTypes.logoCloud'), trustChip: t('componentTypes.trustChip'),
        sectionHeading: t('componentTypes.sectionHeading'),
        mapEmbed: t('componentTypes.mapEmbed'), countdownTimer: t('componentTypes.countdownTimer'), textBlock: t('componentTypes.textBlock'),
        featureGrid: t('componentTypes.featureGrid'), imageBlock: t('componentTypes.imageBlock'), buttonBlock: t('componentTypes.buttonBlock'),
        newsletterSignup: t('componentTypes.newsletterSignup'), stepsProcess: t('componentTypes.stepsProcess'),
        marquee: t('componentTypes.marquee'),
    };

    return (
        <div className="flex flex-col gap-5">
            {/* Layout Settings */}
            <div className="rounded-lg border p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">{t('columnLayout.layoutSettings')}</p>

                {/* Column count */}
                <div>
                    <Label className="text-xs">{t('columnLayout.columns')}</Label>
                    <div className="mt-1 flex gap-1.5">
                        {[2, 3, 4].map((n) => (
                            <button
                                key={n}
                                onClick={() => changeColumnCount(n)}
                                className={`flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${slots.length === n ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Gap */}
                <div>
                    <Label className="text-xs">{t('columnLayout.columnGap')}</Label>
                    <div className="mt-1 flex gap-1.5">
                        {(['none', 'sm', 'md', 'lg', 'xl', '2xl'] as const).map((g) => (
                            <button
                                key={g}
                                onClick={() => updateProp('gap', g)}
                                className={`flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${gap === g ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                            >
                                {optionLabel(t, g)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Align */}
                <div>
                    <Label className="text-xs">{t('columnLayout.verticalAlign')}</Label>
                    <div className="mt-1 flex gap-1.5">
                        {(['top', 'center', 'bottom', 'stretch'] as const).map((a) => (
                            <button
                                key={a}
                                onClick={() => updateProp('align', a)}
                                className={`flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${align === a ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                            >
                                {optionLabel(t, a)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Column widths */}
                <div>
                    <Label className="text-xs">{t('columnLayout.columnWidths')}</Label>
                    <div className="mt-1 flex gap-1.5">
                        {slots.map((_: any, i: number) => (
                            <div key={i} className="flex-1">
                                <Label className="text-caption text-gray-400">{t('columnLayout.colN', { n: i + 1 })}</Label>
                                <select
                                    value={columnWidths[i] || defaultWidth}
                                    onChange={(e) => {
                                        const updated = [...columnWidths];
                                        updated[i] = e.target.value;
                                        // Last-touched control wins: columnFr overrides these
                                        // widths on both renderers, so clear it in the SAME update
                                        updateComponent(pageId, component.id, {
                                            props: { ...component.props, columnWidths: updated, columnFr: undefined },
                                        });
                                    }}
                                    className="mt-0.5 w-full rounded border px-1.5 py-1 text-xs"
                                >
                                    <option value="1/4">1/4</option>
                                    <option value="1/3">1/3</option>
                                    <option value="1/2">1/2</option>
                                    <option value="2/3">2/3</option>
                                    <option value="3/4">3/4</option>
                                </select>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Precise 2-column ratio — writes columnFr (true track sizes),
                    which beats the legacy width fractions on both renderers */}
                {slots.length === 2 && (
                    <div>
                        <Label className="text-xs">{t('columnLayout.widthRatioPrecise')}</Label>
                        <div className="mt-1 flex gap-1.5">
                            {[
                                { label: optionLabel(t, 'auto'), fr: undefined as string[] | undefined },
                                { label: '50/50', fr: ['1fr', '1fr'] },
                                { label: '60/40', fr: ['3fr', '2fr'] },
                                { label: '40/60', fr: ['2fr', '3fr'] },
                                { label: '66/33', fr: ['2fr', '1fr'] },
                                { label: '33/66', fr: ['1fr', '2fr'] },
                            ].map((o) => {
                                const active = o.fr
                                    ? JSON.stringify(component.props.columnFr) === JSON.stringify(o.fr)
                                    : !component.props.columnFr;
                                return (
                                    <button
                                        key={o.label}
                                        onClick={() => updateProp('columnFr', o.fr)}
                                        className={`flex-1 rounded border px-1 py-1 text-caption font-medium transition-colors ${active ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                                    >
                                        {o.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Stack on mobile */}
                <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('columnLayout.stackOnMobile')}</Label>
                    <Switch
                        checked={stackOnMobile}
                        onCheckedChange={(v) => updateProp('stackOnMobile', v)}
                    />
                </div>
                {stackOnMobile && (
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">{t('columnLayout.reverseOrderOnMobile')}</Label>
                        <Switch
                            checked={component.props.reverseOnMobile || false}
                            onCheckedChange={(v) => updateProp('reverseOnMobile', v || undefined)}
                        />
                    </div>
                )}
            </div>

            {/* Slot Contents */}
            {slots.map((slotComps: any[], slotIdx: number) => (
                <div key={slotIdx} className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">
                        {t('columnLayout.slotN', { n: slotIdx + 1 })}
                        <span className="ml-2 normal-case font-normal text-gray-400">
                            {t('columnLayout.componentCount', { count: slotComps.length })}
                        </span>
                    </p>
                    {slotComps.length === 0 ? (
                        <p className="text-xs text-gray-300">{t('columnLayout.slotEmpty')}</p>
                    ) : (
                        slotComps.map((child: any) => (
                            <div
                                key={child.id}
                                className="flex items-center gap-2 rounded border bg-gray-50 px-2 py-1.5"
                            >
                                <button
                                    className="flex-1 text-left text-xs font-medium text-gray-700 hover:text-blue-600 truncate"
                                    onClick={() => selectComponent(child.id)}
                                    title={t('columnLayout.clickToEdit')}
                                >
                                    {TYPE_LABEL[child.type] || child.type.replace(/([A-Z])/g, ' $1').trim()}
                                </button>
                                <button
                                    onClick={() => deleteFromSlot(pageId, component.id, slotIdx, child.id)}
                                    className="shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                                    title={t('columnLayout.removeFromSlot')}
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            ))}
        </div>
    );
};
// ─────────────────────────────────────────────────────────────────────────────

// Component-specific editor
const ComponentEditor = ({ component, pageId, updateComponent, siteConfig }: any) => {
    const { type } = component;

    switch (type) {
        case 'header':
            return (
                <HeaderEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'footer':
            return (
                <FooterEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'heroSection':
            return (
                <HeroSectionEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'MediaShowcaseComponent':
        case 'mediaShowcase':
            return (
                <MediaShowcaseEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'bookCatalogue':
        case 'courseCatalog':
            return (
                <BookCatalogueEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                    siteConfig={siteConfig}
                />
            );

        case 'bookDetails':
            return (
                <BookDetailsEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'cartComponent':
            return (
                <CartComponentEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'buyRentSection':
            return (
                <BuyRentEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'statsHighlights':
            return (
                <StatsHighlightsEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'testimonialSection':
            return (
                <TestimonialsEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'policyRenderer':
            return (
                <PolicyRendererEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );

        case 'faqSection':
            return <FaqSectionEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'videoEmbed':
            return <VideoEmbedEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'documentViewer':
            return <DocumentViewerEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'ctaBanner':
            return <CtaBannerEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'pricingTable':
            return <PricingTableEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'contactForm':
            return <ContactFormEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'teamSection':
            return <TeamSectionEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'announcementFeed':
            return <AnnouncementFeedEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'blog':
            return <BlogEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'jobOpenings':
            return <JobOpeningsEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'imageGallery':
            return <ImageGalleryEditor component={component} pageId={pageId} updateComponent={updateComponent} />;

        case 'columnLayout':
            return <ColumnLayoutEditor component={component} pageId={pageId} updateComponent={updateComponent} />;

        case 'trustChip':
            return <TrustChipEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'sectionHeading':
            return <SectionHeadingEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'spacer':
            return <SpacerEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'htmlBlock':
            return <HtmlBlockEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'htmlPage':
            return <HtmlPageEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'productPageOffer':
            return <ProductPageOfferEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'folderBrowser':
            return <FolderBrowserEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'accessPassGrid':
            return <AccessPassGridEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'learningPath':
            return <LearningPathEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'leadForm':
            return <LeadFormEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'productCourseGrid':
            return <ProductCourseGridEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'courseShowcase':
            return <CourseShowcaseEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'tabsAccordion':
            return <TabsAccordionEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'logoCloud':
            return <LogoCloudEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'mapEmbed':
            return <MapEmbedEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'countdownTimer':
            return <CountdownTimerEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'promoPopup':
            return <PromoPopupEditor component={component} pageId={pageId} updateComponent={updateComponent} />;

        case 'textBlock':
            return <TextBlockEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'featureGrid':
            return <FeatureGridEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'detailBlocks':
            return <DetailBlocksEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'imageBlock':
            return <ImageBlockEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'buttonBlock':
            return <ButtonBlockEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'newsletterSignup':
            return <NewsletterSignupEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'stepsProcess':
            return <StepsProcessEditor component={component} pageId={pageId} updateComponent={updateComponent} />;
        case 'marquee':
            return <MarqueeEditor component={component} pageId={pageId} updateComponent={updateComponent} />;

        default:
            return (
                <GenericEditor
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                />
            );
    }
};

// Media Showcase Editor with slide management
const MediaShowcaseEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const [expandedSlide, setExpandedSlide] = useState<number | null>(null);
    const [expandedMedia, setExpandedMedia] = useState<number | null>(null);

    const layout = props.layout || 'slider';
    const isSliderMode = layout === 'slider';

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };

    // ── Slider slide helpers ────────────────────────────────────────────
    const addSlide = () => {
        const newSlide = {
            backgroundImage: 'https://images.unsplash.com/photo-1512820790803-83ca734da794',
            heading: t('mediaShowcase.defaults.slideHeading'),
            description: t('mediaShowcase.defaults.slideDescription'),
            button: { enabled: false, text: t('mediaShowcase.defaults.slideButtonText'), action: 'navigate', target: 'homepage' },
        };
        updateProp('slides', [...(props.slides || []), newSlide]);
    };

    const deleteSlide = (index: number) => {
        const newSlides = (props.slides || []).filter((_: any, i: number) => i !== index);
        updateProp('slides', newSlides);
        if (expandedSlide === index) setExpandedSlide(null);
    };

    const updateSlide = (index: number, field: string, value: any) => {
        const newSlides = [...(props.slides || [])];
        if (field.startsWith('button.')) {
            const buttonField = field.split('.')[1] as string;
            newSlides[index] = { ...newSlides[index], button: { ...newSlides[index].button, [buttonField]: value } };
        } else {
            newSlides[index] = { ...newSlides[index], [field]: value };
        }
        updateProp('slides', newSlides);
    };

    // ── Media item helpers (carousel / grid) ───────────────────────────
    const addMediaItem = () => {
        const newItem = { type: 'video', url: '', caption: t('mediaShowcase.defaults.mediaCaption') };
        updateProp('media', [...(props.media || []), newItem]);
    };

    const deleteMediaItem = (index: number) => {
        const newMedia = (props.media || []).filter((_: any, i: number) => i !== index);
        updateProp('media', newMedia);
        if (expandedMedia === index) setExpandedMedia(null);
    };

    const updateMediaItem = (index: number, field: string, value: any) => {
        const newMedia = [...(props.media || [])];
        newMedia[index] = { ...newMedia[index], [field]: value };
        updateProp('media', newMedia);
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('mediaShowcase.heading')}</h4>

            <VariantSwitcher
                componentType="mediaShowcase"
                currentProps={props}
                onApply={(newProps) => updateComponent(pageId, component.id, { props: newProps })}
            />

            <div className="space-y-2">
                <Label>{t('mediaShowcase.layout')}</Label>
                <select
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={layout}
                    onChange={(e) => updateProp('layout', e.target.value)}
                >
                    <option value="slider">{t('mediaShowcase.layoutSlider')}</option>
                    <option value="carousel">{t('mediaShowcase.layoutCarousel')}</option>
                    <option value="grid">{t('mediaShowcase.layoutGrid')}</option>
                </select>
            </div>

            {isSliderMode && (
                <div className="flex items-center justify-between">
                    <Label>{t('mediaShowcase.autoplay')}</Label>
                    <Switch
                        checked={props.autoplay || false}
                        onCheckedChange={(c) => updateProp('autoplay', c)}
                    />
                </div>
            )}

            {isSliderMode && props.autoplay && (
                <div className="space-y-2">
                    <Label>{t('mediaShowcase.autoplayInterval')}</Label>
                    <Input
                        type="number"
                        value={props.autoplayInterval || 3000}
                        onChange={(e) => updateProp('autoplayInterval', parseInt(e.target.value))}
                    />
                </div>
            )}

            {/* ── Slider mode: manage slides ── */}
            {isSliderMode && (
                <div className="border-t pt-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-medium">{t('mediaShowcase.slidesCount', { count: props.slides?.length || 0 })}</h4>
                        <Button size="sm" onClick={addSlide}>
                            <Plus className="mr-1 size-4" />
                            {t('mediaShowcase.addSlide')}
                        </Button>
                    </div>

                    <div className="space-y-2">
                        {(props.slides || []).map((slide: any, index: number) => (
                            <div key={index} className="rounded border bg-gray-50 p-3">
                                <div className="flex items-center justify-between">
                                    <button
                                        onClick={() => setExpandedSlide(expandedSlide === index ? null : index)}
                                        className="flex flex-1 items-center gap-2 text-left text-sm font-medium"
                                    >
                                        {expandedSlide === index ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                                        {t('mediaShowcase.slideNTitle', { n: index + 1, heading: slide.heading })}
                                    </button>
                                    <Button size="sm" variant="ghost" onClick={() => deleteSlide(index)}
                                        className="size-8 p-0 text-red-600 hover:text-red-700">
                                        <Trash2 className="size-4" />
                                    </Button>
                                </div>

                                {expandedSlide === index && (
                                    <div className="mt-3 space-y-3 border-t pt-3">
                                        <ImageUploadField slot="background"
                                            label={t('mediaShowcase.backgroundImage')}
                                            value={slide.backgroundImage || ''}
                                            onChange={(url) => updateSlide(index, 'backgroundImage', url)}
                                        />
                                        <div className="space-y-2">
                                            <Label className="text-xs">{t('mediaShowcase.headingLabel')}</Label>
                                            <Input value={slide.heading} onChange={(e) => updateSlide(index, 'heading', e.target.value)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs">{t('mediaShowcase.description')}</Label>
                                            <Textarea value={slide.description} onChange={(e) => updateSlide(index, 'description', e.target.value)} rows={2} />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs">{t('mediaShowcase.button')}</Label>
                                                <Switch checked={slide.button?.enabled || false} onCheckedChange={(c) => updateSlide(index, 'button.enabled', c)} />
                                            </div>
                                            {slide.button?.enabled && (
                                                <div className="ml-4 space-y-2">
                                                    <Input placeholder={t('mediaShowcase.buttonTextPlaceholder')} value={slide.button.text} onChange={(e) => updateSlide(index, 'button.text', e.target.value)} />
                                                    <LinkPicker
                                                        label={t('mediaShowcase.buttonLink')}
                                                        value={slide.button.target || ''}
                                                        onChange={(v) => updateSlide(index, 'button.target', v)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Carousel / Grid mode: manage media items ── */}
            {!isSliderMode && (
                <div className="border-t pt-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-medium">{t('mediaShowcase.mediaItemsCount', { count: (props.media || []).length })}</h4>
                        <Button size="sm" onClick={addMediaItem}>
                            <Plus className="mr-1 size-4" />
                            {t('mediaShowcase.addItem')}
                        </Button>
                    </div>

                    <div className="space-y-2">
                        {(props.media || []).map((item: any, index: number) => (
                            <div key={index} className="rounded border bg-gray-50 p-3">
                                <div className="flex items-center justify-between">
                                    <button
                                        onClick={() => setExpandedMedia(expandedMedia === index ? null : index)}
                                        className="flex flex-1 items-center gap-2 text-left text-sm font-medium"
                                    >
                                        {expandedMedia === index ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                                        <span className="capitalize text-gray-500">{item.type ? optionLabel(t, item.type) : optionLabel(t, 'media')}</span>
                                        <span className="truncate">{item.caption || t('mediaShowcase.itemN', { n: index + 1 })}</span>
                                    </button>
                                    <Button size="sm" variant="ghost" onClick={() => deleteMediaItem(index)}
                                        className="size-8 p-0 text-red-600 hover:text-red-700">
                                        <Trash2 className="size-4" />
                                    </Button>
                                </div>

                                {expandedMedia === index && (
                                    <div className="mt-3 space-y-3 border-t pt-3">
                                        <div className="space-y-2">
                                            <Label className="text-xs">{t('mediaShowcase.typeLabel')}</Label>
                                            <select
                                                className="w-full rounded border px-3 py-2 text-sm"
                                                value={item.type || 'video'}
                                                onChange={(e) => updateMediaItem(index, 'type', e.target.value)}
                                            >
                                                <option value="video">{optionLabel(t, 'video')}</option>
                                                <option value="image">{optionLabel(t, 'image')}</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs">{t('mediaShowcase.urlLabel')}</Label>
                                            <Input
                                                placeholder={item.type === 'image' ? t('mediaShowcase.imageUrlPlaceholder') : t('mediaShowcase.videoUrlPlaceholder')}
                                                value={item.url || ''}
                                                onChange={(e) => updateMediaItem(index, 'url', e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs">{t('mediaShowcase.captionLabel')}</Label>
                                            <Input
                                                value={item.caption || ''}
                                                onChange={(e) => updateMediaItem(index, 'caption', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {(props.media || []).length === 0 && (
                            <p className="text-xs text-gray-400 text-center py-3">{t('mediaShowcase.noMediaItems')}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Book Catalogue Editor
// Sort modes the learner catalogue understands. The stored value IS the label —
// it must stay byte-identical to COURSE_CATALOG_SORT_OPTIONS in the learner app
// (frontend-learner-dashboard-app .../-types/course-catalogue-types.ts), which
// falls back to "Newest" for anything it does not recognise.
const COURSE_CATALOG_SORT_OPTIONS = [
    'Newest',
    'Oldest',
    'Price: Low to High',
    'Price: High to Low',
    'Rating',
    'Name A-Z',
    'Name Z-A',
    'Popular',
];

// Display-only labels for COURSE_CATALOG_SORT_OPTIONS — the <option> VALUE
// stays the exact English string above (stored as `defaultSort` and matched
// byte-for-byte by the learner app), only the visible text is translated.
const buildCourseCatalogSortLabels = (t: TFunction): Record<string, string> => ({
    Newest: t('bookCatalogue.sort.newest'),
    Oldest: t('bookCatalogue.sort.oldest'),
    'Price: Low to High': t('bookCatalogue.sort.priceLowToHigh'),
    'Price: High to Low': t('bookCatalogue.sort.priceHighToLow'),
    Rating: t('bookCatalogue.sort.rating'),
    'Name A-Z': t('bookCatalogue.sort.nameAZ'),
    'Name Z-A': t('bookCatalogue.sort.nameZA'),
    Popular: t('bookCatalogue.sort.popular', { defaultValue: 'Popular (most enrolled)' }),
});


/**
 * Order of the options inside one filter group (levels or tags) on the public
 * courses page. Writes the full name list; options not in it (new tags) fall
 * in after, in natural order. Reset clears it, so the site's default order
 * (levels A–Z, tags as before) applies again.
 */
const FilterOptionOrder = ({
    label,
    names,
    order,
    onChange,
}: {
    label: string;
    names: string[];
    order: unknown;
    onChange: (next: string[] | undefined) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const saved = Array.isArray(order) ? order.map(String) : [];
    const key = (n: string) => n.trim().toLowerCase();
    const known = new Set(names.map(key));
    const listed = saved.filter((n) => known.has(key(n)));
    const listedKeys = new Set(listed.map(key));
    const rest = names
        .filter((n) => !listedKeys.has(key(n)))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const effective = [...listed, ...rest];
    if (effective.length < 2) return null;
    const move = (index: number, delta: number) => {
        const next = [...effective];
        const [item] = next.splice(index, 1);
        next.splice(index + delta, 0, item as string);
        onChange(next);
    };
    return (
        <div className="space-y-1 rounded border border-dashed border-gray-200 p-2">
            <div className="flex items-center justify-between">
                <p className="text-caption font-medium text-gray-500">{t('bookCatalogue.optionOrder', { group: label })}</p>
                {saved.length > 0 && (
                    <button type="button" className="text-caption text-primary-500 hover:underline" onClick={() => onChange(undefined)}>
                        {t('bookCatalogue.optionOrderReset')}
                    </button>
                )}
            </div>
            {saved.length === 0 && <p className="text-caption text-gray-400">{t('bookCatalogue.optionOrderHint')}</p>}
            {effective.map((name, i) => (
                <div key={name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{name}</span>
                    <RowActions index={i} count={effective.length} item={name} onMove={(d) => move(i, d)} />
                </div>
            ))}
        </div>
    );
};

const BookCatalogueEditor = ({ component, pageId, updateComponent, siteConfig }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    // Whole-store read on purpose (no selector): render tests mock the store as a plain function.
    const { config } = useEditorStore();
    // Level / tag names for the filter option order lists.
    const { instituteDetails } = useInstituteDetailsStore();
    const { props } = component;

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };
    const patchProps = (next: Record<string, unknown>) =>
        updateComponent(pageId, component.id, { props: { ...props, ...next } });
    const setNested = (key: string, next: Record<string, unknown>) =>
        patchProps({ [key]: { ...(props[key] && typeof props[key] === 'object' ? props[key] : {}), ...next } });

    // The courses-page design: its heading lives in the hero, and its sidebar
    // has its own filter groups. The legacy fields below then do something
    // other than what they seem to, so they are relabelled or tucked away.
    const heroOn = props.hero?.enabled === true;
    const ownSidebarFilters = !!props.filterSidebar || !!props.customFilters;

    const sortLabels = buildCourseCatalogSortLabels(t);
    const catalogueFilters = [
        {
            id: 'level',
            field: 'level_name',
            label: getTerminology(ContentTerms.Level, SystemTerms.Level),
        },
        {
            id: 'session',
            field: 'session_name',
            label: getTerminology(ContentTerms.Session, SystemTerms.Session),
        },
        {
            id: 'tags',
            field: 'comma_separeted_tags',
            label: getTerminology(ContentTerms.PopularTag, SystemTerms.PopularTag),
        },
        // The public catalogue already renders an "Authors" section for an
        // `instructors` entry; it just could not be switched on from here.
        {
            id: 'instructors',
            field: 'instructors',
            label: t('bookCatalogue.filterAuthors'),
        },
    ] as const;
    const selectedFilterIds = new Set(
        Array.isArray(props.filtersConfig)
            ? props.filtersConfig.map((filter: { id?: string }) => filter.id)
            : catalogueFilters.map((filter) => filter.id),
    );
    const toggleCatalogueFilter = (filter: (typeof catalogueFilters)[number]) => {
        const next = new Set(selectedFilterIds);
        if (next.has(filter.id)) next.delete(filter.id);
        else next.add(filter.id);
        // Only the checkbox filters above are managed here. Anything else in
        // filtersConfig (the price range, a hand-authored
        // filter) must survive a toggle — rebuilding the array from those
        // alone silently deleted a catalogue's Price Range on the first click.
        const managedIds = new Set<string>(catalogueFilters.map((item) => item.id));
        const unmanaged = (Array.isArray(props.filtersConfig) ? props.filtersConfig : []).filter(
            (item: { id?: string }) => !item.id || !managedIds.has(item.id)
        );
        updateProp('filtersConfig', [
            ...catalogueFilters
                .filter((item) => next.has(item.id))
                .map(({ id, field }) => ({ id, type: 'checkbox', field })),
            ...unmanaged,
        ]);
    };

    const catalogueFilterBoxes = catalogueFilters.map((filter) => (
        <label key={filter.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
                checked={selectedFilterIds.has(filter.id)}
                onCheckedChange={() => toggleCatalogueFilter(filter)}
            />
            {filter.label}
        </label>
    ));
    const filterOrderFields = (
        <>
            {selectedFilterIds.has('level') && (
                <FilterOptionOrder
                    label={catalogueFilters[0].label}
                    names={[...new Set((instituteDetails?.levels ?? []).map((l: { level_name?: string }) => l.level_name || '').filter((n: string) => n && n.toUpperCase() !== 'DEFAULT'))]}
                    order={props.levelOrder}
                    onChange={(next) => updateProp('levelOrder', next)}
                />
            )}
            {selectedFilterIds.has('tags') && (
                <FilterOptionOrder
                    label={catalogueFilters[2].label}
                    names={[...new Set((instituteDetails?.tags ?? []).map((n: string) => n.trim()).filter(Boolean))]}
                    order={props.tagOrder}
                    onChange={(next) => updateProp('tagOrder', next)}
                />
            )}
        </>
    );

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('bookCatalogue.heading')}</h4>

            <VariantSwitcher
                componentType={component.type}
                currentProps={props}
                onApply={(newProps) => updateComponent(pageId, component.id, { props: newProps })}
            />

            <div className="space-y-2">
                <Label>{heroOn ? t('bookCatalogue.titleWithHero') : t('bookCatalogue.title')}</Label>
                <Input
                    value={props.title || ''}
                    onChange={(e) => updateProp('title', e.target.value)}
                />
                {heroOn && (
                    <p className="text-xs text-neutral-500">{t('bookCatalogue.titleWithHeroHint')}</p>
                )}
            </div>

            <div className="flex items-center justify-between">
                <Label>{t('bookCatalogue.showFilters')}</Label>
                <Switch
                    checked={props.showFilters || false}
                    onCheckedChange={(c) => updateProp('showFilters', c)}
                />
            </div>

            {component.type === 'courseCatalog' &&
                (ownSidebarFilters ? (
                    <details className="rounded border p-3">
                        <summary className="cursor-pointer text-sm font-medium">
                            {t('bookCatalogue.legacyFiltersSummary')}
                        </summary>
                        <div className="mt-2 space-y-2">
                            <p className="text-xs text-neutral-500">{t('bookCatalogue.legacyFiltersHint')}</p>
                            {catalogueFilterBoxes}
                            {filterOrderFields}
                        </div>
                    </details>
                ) : (
                    <div className="space-y-2 rounded border p-3">
                        <Label>
                            {t('bookCatalogue.filterOptions', {
                                defaultValue: 'Filter options',
                            })}
                        </Label>
                        {catalogueFilterBoxes}
                        {filterOrderFields}
                    </div>
                ))}

            {/* How a preview image sits in the card's image band. `cover` fills
                it but crops the edges — which eats the logo/headline on wide
                marketing banners. `contain` shows the whole artwork. */}
            <div className="space-y-2">
                <Label>{t('bookCatalogue.courseImageFit')}</Label>
                <select
                    className="w-full rounded border px-3 py-1.5 text-sm"
                    value={props.render?.styles?.imageFit || 'cover'}
                    onChange={(e) =>
                        updateProp('render', {
                            ...(props.render || {}),
                            styles: { ...(props.render?.styles || {}), imageFit: e.target.value },
                        })
                    }
                >
                    <option value="cover">{t('bookCatalogue.imageFitCover')}</option>
                    <option value="contain">{t('bookCatalogue.imageFitContain')}</option>
                </select>
                <p className="text-xs text-gray-500">
                    {t('bookCatalogue.imageFitHint')}
                </p>
            </div>

            {component.type === 'courseCatalog' && (
                <div className="space-y-2">
                    <Label>{t('bookCatalogue.defaultSort')}</Label>
                    <select
                        className="w-full rounded border px-3 py-1.5 text-sm"
                        value={props.defaultSort || 'Newest'}
                        onChange={(e) => updateProp('defaultSort', e.target.value)}
                    >
                        {COURSE_CATALOG_SORT_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                                {sortLabels[option]}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-neutral-500">
                        {t('bookCatalogue.defaultSortHint')}
                    </p>
                </div>
            )}

            {component.type === 'courseCatalog' && (
                <CatalogDiscoveryEditor component={component} pageId={pageId} updateComponent={updateComponent} />
            )}

            {component.type === 'courseCatalog' && (
                <CatalogDesignGroups
                    component={component}
                    pageId={pageId}
                    updateComponent={updateComponent}
                    patch={patchProps}
                    setNested={setNested}
                    // The site in the language being edited (Hindi text in Hindi mode).
                    catalogue={siteConfig ?? config}
                />
            )}
        </div>
    );
};

// Buy/Rent Section Editor
const BuyRentEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    const updateProp = (path: string, value: any) => {
        const keys = path.split('.');
        const key0 = keys[0] as string;
        const key1 = keys[1] as string | undefined;
        let newProps = { ...props };

        if (keys.length === 2 && key1) {
            newProps = {
                ...newProps,
                [key0]: {
                    ...newProps[key0],
                    [key1]: value,
                },
            };
        } else {
            newProps[path] = value;
        }

        updateComponent(pageId, component.id, { props: newProps });
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('buyRent.heading')}</h4>

            <div className="space-y-2">
                <Label>{t('buyRent.headingField')}</Label>
                <Input
                    value={props.heading || ''}
                    onChange={(e) => updateProp('heading', e.target.value)}
                />
            </div>

            <div className="border-t pt-4">
                <h5 className="mb-2 text-xs font-semibold">{t('buyRent.buyOption')}</h5>
                <div className="space-y-2">
                    <Input
                        placeholder={t('buyRent.buttonLabelPlaceholder')}
                        value={props.buy?.buttonLabel || ''}
                        onChange={(e) => updateProp('buy.buttonLabel', e.target.value)}
                    />
                    <Input
                        placeholder={t('buyRent.levelFilterValuePlaceholder')}
                        value={props.buy?.levelFilterValue || ''}
                        onChange={(e) => updateProp('buy.levelFilterValue', e.target.value)}
                    />
                </div>
            </div>

            <div className="border-t pt-4">
                <h5 className="mb-2 text-xs font-semibold">{t('buyRent.rentOption')}</h5>
                <div className="space-y-2">
                    <Input
                        placeholder={t('buyRent.buttonLabelPlaceholder')}
                        value={props.rent?.buttonLabel || ''}
                        onChange={(e) => updateProp('rent.buttonLabel', e.target.value)}
                    />
                    <Input
                        placeholder={t('buyRent.levelFilterValuePlaceholder')}
                        value={props.rent?.levelFilterValue || ''}
                        onChange={(e) => updateProp('rent.levelFilterValue', e.target.value)}
                    />
                </div>
            </div>
        </div>
    );
};

// Generic editor for other components
const GenericEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('generic.properties')}</h4>
            {Object.entries(props).map(([key, value]) => {
                if (typeof value === 'string' || typeof value === 'number') {
                    return (
                        <div key={key} className="space-y-2">
                            <Label className="capitalize">
                                {key.replace(/([A-Z])/g, ' $1').trim()}
                            </Label>
                            <Input
                                value={value}
                                onChange={(e) =>
                                    updateComponent(pageId, component.id, {
                                        props: {
                                            ...props,
                                            [key]: e.target.value,
                                        },
                                    })
                                }
                            />
                        </div>
                    );
                }
                if (typeof value === 'boolean') {
                    return (
                        <div key={key} className="flex items-center justify-between">
                            <Label className="capitalize">
                                {key.replace(/([A-Z])/g, ' $1').trim()}
                            </Label>
                            <Switch
                                checked={value}
                                onCheckedChange={(c) =>
                                    updateComponent(pageId, component.id, {
                                        props: {
                                            ...props,
                                            [key]: c,
                                        },
                                    })
                                }
                            />
                        </div>
                    );
                }
                return null;
            })}
            {Object.values(props).some((v) => typeof v === 'object') && (
                <div className="rounded border border-yellow-100 bg-yellow-50 p-4 text-xs text-yellow-800">
                    {t('generic.complexPropertiesHidden')}
                </div>
            )}
        </div>
    );
};

// Header Editor
const HeaderEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const [expandedNav, setExpandedNav] = useState<number | null>(null);
    const [expandedAuth, setExpandedAuth] = useState<number | null>(null);

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };

    const addNavItem = () => {
        const newItem = { label: t('header.defaults.newLink'), route: '/', openInSameTab: true };
        updateProp('navigation', [...(props.navigation || []), newItem]);
    };

    const updateNavItem = (index: number, field: string, value: any) => {
        const newNav = [...(props.navigation || [])];
        newNav[index] = { ...newNav[index], [field]: value };
        updateProp('navigation', newNav);
    };

    // Several fields in one write (a nav item turned into a mega menu sets its
    // type and settings together; two updateNavItem calls would each start
    // from the same props, so the second would drop the first).
    const patchNavItem = (index: number, patch: Record<string, unknown>) => {
        const newNav = [...(props.navigation || [])];
        newNav[index] = { ...newNav[index], ...patch };
        updateProp('navigation', newNav);
    };

    const deleteNavItem = (index: number) => {
        updateProp('navigation', (props.navigation || []).filter((_: any, i: number) => i !== index));
    };

    /** Hide a link from the live site without losing its label and route.
     *  Absent means visible, so every site authored before this existed keeps
     *  showing every link. */
    const toggleNavItem = (index: number) => {
        const current = (props.navigation || [])[index];
        updateNavItem(index, 'enabled', current?.enabled === false);
    };

    const addAuthLink = () => {
        updateProp('authLinks', [...(props.authLinks || []), { label: t('header.defaults.login'), route: 'login' }]);
    };

    // 'get-started' is the canonical route the learner header recognises as the
    // lead-collection / enrollment CTA (see isLeadFormLink in the learner HeaderComponent).
    const addGetStartedLink = () => {
        updateProp('authLinks', [...(props.authLinks || []), { label: t('header.defaults.getStarted'), route: 'get-started' }]);
    };

    const updateAuthLink = (index: number, field: string, value: any) => {
        const updated = [...(props.authLinks || [])];
        updated[index] = { ...updated[index], [field]: value };
        updateProp('authLinks', updated);
    };

    const deleteAuthLink = (index: number) => {
        updateProp('authLinks', (props.authLinks || []).filter((_: any, i: number) => i !== index));
    };

    const config = useEditorStore((s) => s.config);
    const updateGlobalSettings = useEditorStore((s) => s.updateGlobalSettings);

    // Adds, removes and orders the PAGE links only: existing page links keep
    // their label and hidden flag; mega menus, external and filtered links stay.
    const syncNavFromPages = () => {
        if (!config) return;
        updateProp('navigation', syncNavWithPages(props.navigation, config.pages));
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('header.heading')}</h4>

            <VariantSwitcher
                componentType="header"
                currentProps={props}
                onApply={(newProps) => updateComponent(pageId, component.id, { props: newProps })}
            />

            <ImageUploadField slot="logo"
                label={t('header.logo')}
                value={props.logo || ''}
                onChange={(url) => updateProp('logo', url)}
                placeholder="https://example.com/logo.png"
            />

            <div className="space-y-2">
                <Label>{t('header.title')}</Label>
                <Input
                    value={props.title || ''}
                    onChange={(e) => updateProp('title', e.target.value)}
                />
            </div>

            <ColorPickerField
                label={t('header.backgroundColor')}
                value={props.backgroundColor || '#ffffff'} // design-lint-ignore: color-editor swatch/seed value
                onChange={(c) => updateProp('backgroundColor', c)}
            />

            <ColorPickerField
                label={t('header.textColor')}
                value={props.textColor || '#000000'} // design-lint-ignore: color-editor swatch/seed value
                onChange={(c) => updateProp('textColor', c)}
            />

            <HeaderDisplayOptions props={props} onChange={updateProp} />
            <HeaderLookGroup props={props} onChange={updateProp} />

{/* Sticky Header toggle REMOVED (2026-07-29): it wrote
                globalSettings.stickyHeader, which nothing ever read — the learner
                header is unconditionally `fixed`, and both the page offset
                (pt-16 md:pt-20) and the mobile action bar are built around that.
                Wiring it was the wrong fix: every existing site has the toggle
                reading "off" while being sticky, so honouring the value would
                silently un-stick every live header. The header is sticky by
                design; offering a switch that does nothing was the bug. */}

            {/* Navigation Links */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>{t('header.navigationLinks')}</Label>
                    <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={syncNavFromPages} title={t('header.syncPagesTitle')} className="text-xs text-blue-600">
                            {t('header.syncPages')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={addNavItem}>
                            <Plus className="me-1 size-3" /> {t('actions.add')}
                        </Button>
                    </div>
                </div>
                {(props.navigation || []).map((item: any, index: number) => (
                    <div key={index} className="rounded border bg-gray-50 p-2">
                        <div className="flex items-center justify-between gap-1">
                            <button
                                onClick={() => setExpandedNav(expandedNav === index ? null : index)}
                                className={`flex-1 truncate text-left text-sm font-medium ${
                                    item.enabled === false ? 'text-gray-400 line-through' : ''
                                }`}
                            >
                                {expandedNav === index ? (
                                    <ChevronUp className="mr-1 inline size-3" />
                                ) : (
                                    <ChevronDown className="mr-1 inline size-3" />
                                )}
                                {item.label}
                            </button>
                            {item.type === 'megaMenu' && (
                                <span className="shrink-0 rounded bg-primary-100 px-1.5 py-0.5 text-caption text-primary-500">
                                    {t('header.megaMenuBadge', 'Mega menu')}
                                </span>
                            )}
                            {item.type === 'dropdown' && (
                                <span className="shrink-0 rounded bg-primary-100 px-1.5 py-0.5 text-caption text-primary-500">
                                    {t('header.dropdownBadge', 'Dropdown')}
                                </span>
                            )}
                            {item.enabled === false && (
                                <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-caption text-gray-600">
                                    {t('header.hiddenBadge')}
                                </span>
                            )}
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => toggleNavItem(index)}
                                className="size-6 shrink-0 p-0 text-gray-500 hover:text-gray-800"
                                title={
                                    item.enabled === false
                                        ? t('header.showLink')
                                        : t('header.hideLink')
                                }
                                aria-label={
                                    item.enabled === false
                                        ? t('header.showLink')
                                        : t('header.hideLink')
                                }
                                aria-pressed={item.enabled === false}
                            >
                                {item.enabled === false ? (
                                    <EyeSlash className="size-3" />
                                ) : (
                                    <Eye className="size-3" />
                                )}
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteNavItem(index)}
                                className="size-6 shrink-0 p-0 text-red-600"
                                title={t('actions.delete')}
                                aria-label={t('actions.delete')}
                            >
                                <Trash2 className="size-3" />
                            </Button>
                        </div>
                        {expandedNav === index && (
                            <div className="mt-2 space-y-2">
                                <Input
                                    placeholder={t('header.labelPlaceholder')}
                                    value={item.label}
                                    onChange={(e) => updateNavItem(index, 'label', e.target.value)}
                                />
                                <LinkPicker
                                    label={t('header.route')}
                                    value={item.route || ''}
                                    onChange={(v) => updateNavItem(index, 'route', v)}
                                />
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">{t('header.openInSameTab')}</Label>
                                    <Switch
                                        checked={!!item.openInSameTab}
                                        onCheckedChange={(c) =>
                                            updateNavItem(index, 'openInSameTab', c)
                                        }
                                    />
                                </div>
                                <NavItemEditor
                                    item={item}
                                    onPatch={(patch) => patchNavItem(index, patch)}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Auth / CTA Buttons */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>{t('header.authCtaButtons')}</Label>
                    <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" onClick={addGetStartedLink}>
                            <Plus className="me-1 size-3" /> {t('header.defaults.getStarted')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateProp('authLinks', [...(props.authLinks || []), { label: t('header.defaults.enquireNow'), route: '', audienceId: ' ', formTitle: '' }])}>
                            <Plus className="me-1 size-3" /> {t('header.enquireForm')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={addAuthLink}>
                            <Plus className="me-1 size-3" /> {t('actions.add')}
                        </Button>
                    </div>
                </div>
                <p className="text-caption text-gray-400">
                    {t('header.authCtaHint')}
                </p>
                {(props.authLinks || []).map((link: any, index: number) => (
                    <div key={index} className="rounded border bg-gray-50 p-2">
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => setExpandedAuth(expandedAuth === index ? null : index)}
                                className="flex-1 text-left text-sm font-medium"
                            >
                                {expandedAuth === index ? (
                                    <ChevronUp className="mr-1 inline size-3" />
                                ) : (
                                    <ChevronDown className="mr-1 inline size-3" />
                                )}
                                {link.label || t('header.buttonN', { n: index + 1 })}
                            </button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteAuthLink(index)}
                                className="size-6 p-0 text-red-600"
                            >
                                <Trash2 className="size-3" />
                            </Button>
                        </div>
                        {expandedAuth === index && (
                            <div className="mt-2 space-y-2">
                                <Input
                                    placeholder={t('header.labelWithExamplePlaceholder')}
                                    value={link.label || ''}
                                    onChange={(e) => updateAuthLink(index, 'label', e.target.value)}
                                />
                                <AuthLinkStyleSelect
                                    value={link.style}
                                    onChange={(style) => updateAuthLink(index, 'style', style)}
                                />
                                <div>
                                    <Label className="text-xs">{t('header.onClick')}</Label>
                                    <div className="mt-1 flex gap-1">
                                        {([['route', t('options.openLink')], ['openForm', t('options.openFormPopup')]] as const).map(([v, l]) => (
                                            <button key={v}
                                                onClick={() => updateAuthLink(index, 'audienceId', v === 'openForm' ? (link.audienceId || ' ') : '')}
                                                className={`rounded px-2.5 py-1 text-caption font-medium ${(link.audienceId ? 'openForm' : 'route') === v ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}>{l}</button>
                                        ))}
                                    </div>
                                </div>
                                {link.audienceId ? (
                                    <>
                                        <CampaignPicker
                                            label={t('header.formToOpen')}
                                            allowEmpty={false}
                                            value={(link.audienceId || '').trim()}
                                            onChange={(id) => updateAuthLink(index, 'audienceId', id)}
                                        />
                                        <Input
                                            placeholder={t('header.popupTitlePlaceholder')}
                                            value={link.formTitle || ''}
                                            onChange={(e) => updateAuthLink(index, 'formTitle', e.target.value)}
                                        />
                                    </>
                                ) : (
                                    <LinkPicker
                                        label={t('header.route')}
                                        value={link.route || ''}
                                        onChange={(v) => updateAuthLink(index, 'route', v)}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// Footer Editor
const FooterEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };

    const updateLeftSection = (field: string, value: any) => {
        updateProp('leftSection', { ...props.leftSection, [field]: value });
    };

    // Footer social links (Column 1 — Brand). platform drives both the label
    // and the icon the learner footer renders (icon = platform lowercased).
    const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'Twitter', 'Telegram'];

    const updateSocial = (index: number, field: string, value: any) => {
        const socials = [...(props.leftSection?.socials || [])];
        socials[index] = { ...socials[index], [field]: value };
        updateLeftSection('socials', socials);
    };

    const updateSocialPlatform = (index: number, platform: string) => {
        const socials = [...(props.leftSection?.socials || [])];
        socials[index] = { ...socials[index], platform, icon: platform.toLowerCase() };
        updateLeftSection('socials', socials);
    };

    const addSocial = () => {
        const socials = [
            ...(props.leftSection?.socials || []),
            { platform: 'Facebook', icon: 'facebook', url: '', openInSameTab: false },
        ];
        updateLeftSection('socials', socials);
    };

    const deleteSocial = (index: number) => {
        const socials = (props.leftSection?.socials || []).filter(
            (_: any, i: number) => i !== index,
        );
        updateLeftSection('socials', socials);
    };

    // Helper to update a right section's field
    const updateRightSection = (sectionKey: string, field: string, value: any) => {
        updateProp(sectionKey, { ...(props[sectionKey] || {}), [field]: value });
    };

    // Helper to update a specific link within a right section
    const updateRightSectionLink = (sectionKey: string, linkIndex: number, field: string, value: any) => {
        const section = props[sectionKey] || { title: '', links: [] };
        const links = [...(section.links || [])];
        links[linkIndex] = { ...links[linkIndex], [field]: value };
        updateProp(sectionKey, { ...section, links });
    };

    // One link row open at a time, keyed "<section>:<index>". The row used to
    // put the label box, the whole LinkPicker (page search + page list) and
    // the delete button side by side in the 320px panel: the picker took the
    // width, the label shrank to a ~26px sliver with its text hidden and the
    // delete button was pushed off-screen — admins could not rename a link at
    // all (one typed "h" blind and published it). Same collapsed-row pattern
    // as the header's navigation links.
    const [expandedLink, setExpandedLink] = useState<string | null>(null);

    const addRightSectionLink = (sectionKey: string) => {
        const section = props[sectionKey] || { title: '', links: [] };
        const links = [...(section.links || []), { label: t('header.defaults.newLink'), route: '/' }];
        updateProp(sectionKey, { ...section, links });
        // Open the new row so the label box is the next thing the admin sees.
        setExpandedLink(`${sectionKey}:${links.length - 1}`);
    };

    const deleteRightSectionLink = (sectionKey: string, linkIndex: number) => {
        const section = props[sectionKey] || { title: '', links: [] };
        const links = (section.links || []).filter((_: any, i: number) => i !== linkIndex);
        updateProp(sectionKey, { ...section, links });
        setExpandedLink(null);
    };

    const patchProps = (next: Record<string, unknown>) =>
        updateComponent(pageId, component.id, { props: { ...props, ...next } });

    // The "brand" footer has its own design: it always shows four link
    // columns and ignores the layout and the presets, so those are hidden.
    const isBrand = props.variant === 'brand';
    const layout = props.layout || 'four-column';
    // Determine which right sections to show based on layout
    const rightSectionKeys = isBrand
        ? ['rightSection1', 'rightSection2', 'rightSection3', 'rightSection4']
        : layout === 'two-column'
        ? ['rightSection1']
        : layout === 'three-column'
        ? ['rightSection1', 'rightSection2']
        : ['rightSection1', 'rightSection2', 'rightSection3'];

    const sectionLabels: Record<string, string> = {
        rightSection1: t('footer.column2'),
        rightSection2: t('footer.column3'),
        rightSection3: t('footer.column4'),
        rightSection4: t('footer.column5'),
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('footer.heading')}</h4>

            {isBrand ? (
                <div className="space-y-2 rounded border bg-gray-50 p-3">
                    <p className="text-xs text-neutral-600">{t('footer.brandDesignNote')}</p>
                    <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={() => {
                            if (window.confirm(t('footer.useStandardConfirm'))) {
                                patchProps({ variant: undefined });
                            }
                        }}
                    >
                        {t('footer.useStandard')}
                    </Button>
                </div>
            ) : (
                <>
                    <VariantSwitcher
                        componentType="footer"
                        currentProps={props}
                        onApply={(newProps) => updateComponent(pageId, component.id, { props: newProps })}
                    />

                    <div className="space-y-2">
                        <Label>{t('footer.layout')}</Label>
                        <select
                            className="w-full rounded border px-3 py-2 text-sm"
                            value={layout}
                            onChange={(e) => updateProp('layout', e.target.value)}
                        >
                            <option value="two-column">{t('footer.layoutTwoColumn')}</option>
                            <option value="three-column">{t('footer.layoutThreeColumn')}</option>
                            <option value="four-column">{t('footer.layoutFourColumn')}</option>
                        </select>
                    </div>
                </>
            )}

            {/* Left Section */}
            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('footer.column1Brand')}</h5>
                <div className="space-y-2">
                    <Label className="text-xs">{t('footer.titleField')}</Label>
                    <Input
                        value={props.leftSection?.title || ''}
                        onChange={(e) => updateLeftSection('title', e.target.value)}
                    />
                </div>
                <RichTextField
                    label={t('footer.description')}
                    value={props.leftSection?.text || ''}
                    onChange={(html) => updateLeftSection('text', html)}
                    placeholder={t('footer.descriptionPlaceholder')}
                />

                {/* Social Links */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">{t('footer.socialLinks')}</Label>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            onClick={addSocial}
                        >
                            <Plus className="me-1 size-3" /> {t('actions.add')}
                        </Button>
                    </div>
                    {(props.leftSection?.socials || []).map((social: any, si: number) => (
                        <div key={si} className="flex items-center gap-1.5">
                            <select
                                className="h-7 shrink-0 rounded border px-2 text-xs"
                                value={social.platform || 'Facebook'}
                                onChange={(e) => updateSocialPlatform(si, e.target.value)}
                            >
                                {/* Social platform names are brand names — never translated. */}
                                {SOCIAL_PLATFORMS.map((p) => (
                                    <option key={p} value={p}>
                                        {p}
                                    </option>
                                ))}
                            </select>
                            <Input
                                className="h-7 text-xs"
                                placeholder="https://..."
                                value={social.url || ''}
                                onChange={(e) => updateSocial(si, 'url', e.target.value)}
                            />
                            <Button
                                size="sm"
                                variant="ghost"
                                className="size-7 shrink-0 p-0 text-red-500"
                                onClick={() => deleteSocial(si)}
                            >
                                <Trash2 className="size-3" />
                            </Button>
                        </div>
                    ))}
                    {(props.leftSection?.socials || []).length === 0 && (
                        <p className="text-xs text-gray-400">
                            {t('footer.noSocialLinks')}
                        </p>
                    )}
                </div>
            </div>

            {/* Right Sections (link columns) */}
            {rightSectionKeys.map((sectionKey) => {
                const section = props[sectionKey] || { title: '', links: [] };
                return (
                    <div key={sectionKey} className="space-y-3 rounded border bg-gray-50 p-3">
                        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {sectionLabels[sectionKey]}
                        </h5>
                        <div className="space-y-2">
                            <Label className="text-xs">{t('footer.sectionTitle')}</Label>
                            <Input
                                value={section.title || ''}
                                placeholder={t('footer.sectionTitlePlaceholder')}
                                onChange={(e) => updateRightSection(sectionKey, 'title', e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs">{t('footer.links')}</Label>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => addRightSectionLink(sectionKey)}
                                >
                                    <Plus className="me-1 size-3" /> {t('actions.add')}
                                </Button>
                            </div>
                            {(section.links || []).map((link: any, li: number) => {
                                const rowKey = `${sectionKey}:${li}`;
                                const isOpen = expandedLink === rowKey;
                                return (
                                    <div key={li} className="rounded border bg-white p-2">
                                        <div className="flex items-center justify-between gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setExpandedLink(isOpen ? null : rowKey)}
                                                className="flex-1 truncate text-left text-sm font-medium"
                                                aria-expanded={isOpen}
                                            >
                                                {isOpen ? (
                                                    <ChevronUp className="mr-1 inline size-3" />
                                                ) : (
                                                    <ChevronDown className="mr-1 inline size-3" />
                                                )}
                                                {link.label || t('header.labelPlaceholder')}
                                            </button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="size-6 shrink-0 p-0 text-red-500"
                                                onClick={() => deleteRightSectionLink(sectionKey, li)}
                                                title={t('actions.delete')}
                                                aria-label={t('actions.delete')}
                                            >
                                                <Trash2 className="size-3" />
                                            </Button>
                                        </div>
                                        {isOpen && (
                                            <div className="mt-2 space-y-2">
                                                <Input
                                                    className="h-8 text-xs"
                                                    placeholder={t('header.labelPlaceholder')}
                                                    value={link.label || ''}
                                                    onChange={(e) => updateRightSectionLink(sectionKey, li, 'label', e.target.value)}
                                                />
                                                <LinkPicker
                                                    label={t('header.route')}
                                                    value={link.route || ''}
                                                    onChange={(v) => updateRightSectionLink(sectionKey, li, 'route', v)}
                                                />
                                                {/* The learner footer already honours openInSameTab
                                                    for external links; the editor never exposed it. */}
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-xs">{t('header.openInSameTab')}</Label>
                                                    <Switch
                                                        checked={!!link.openInSameTab}
                                                        onCheckedChange={(c) => updateRightSectionLink(sectionKey, li, 'openInSameTab', c)}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {isBrand && (
                <FooterBrandFields props={props} updateProp={updateProp} patchProps={patchProps} />
            )}

            {/* Bottom Note */}
            <div className="space-y-2">
                <Label>{t('footer.bottomNote')}</Label>
                <Input
                    value={props.bottomNote || ''}
                    placeholder={t('footer.bottomNotePlaceholder')}
                    onChange={(e) => updateProp('bottomNote', e.target.value)}
                />
            </div>
        </div>
    );
};

// Hero Section Editor
// Mirrors the live hero's isHeroButtonEnabled: true, "true" (any case) or a non-zero number.
const isTruthyFlag = (v: unknown) =>
    v === true || (typeof v === 'string' && v.toLowerCase() === 'true') || (typeof v === 'number' && v !== 0);

/** Click action for a hero CTA: go to a page / a section below / a URL, or open a form. */
const HeroButtonActionFields = ({
    button,
    onChange,
}: {
    button: { action?: string; target?: string; audienceId?: string };
    onChange: (patch: Record<string, unknown>) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const action = button.action || 'navigate';
    return (
        <div className="space-y-2">
            <div>
                <Label className="text-xs">{t('hero.onClick')}</Label>
                <select
                    className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
                    value={action}
                    onChange={(e) => onChange({ action: e.target.value })}
                >
                    <option value="navigate">{t('hero.actionNavigate')}</option>
                    <option value="openLeadCollection">{t('hero.actionOpenLeadCollection')}</option>
                    <option value="openForm">{t('hero.actionOpenCampaignForm')}</option>
                </select>
            </div>
            {action === 'navigate' && (
                <LinkPicker
                    label={t('hero.navigateTo')}
                    value={button.target || ''}
                    onChange={(v) => onChange({ target: v })}
                />
            )}
            {action === 'openForm' && (
                <CampaignPicker
                    label={t('hero.audienceListLabel')}
                    allowEmpty={false}
                    value={button.audienceId || ''}
                    onChange={(id) => onChange({ audienceId: id })}
                />
            )}
        </div>
    );
};

const HeroSectionEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };

    const updateLeft = (field: string, value: any) => {
        updateProp('left', { ...props.left, [field]: value });
    };

    const updateRight = (field: string, value: any) => {
        updateProp('right', { ...props.right, [field]: value });
    };

    // Hero carousel images. 2+ → the learner hero renders an auto-playing
    // carousel; 1 → single image; 0 → falls back to the single "Right Image".
    const updateRightImage = (index: number, field: string, value: any) => {
        const images = [...(props.right?.images || [])];
        images[index] = { ...images[index], [field]: value };
        updateRight('images', images);
    };
    const addRightImage = () => {
        updateRight('images', [...(props.right?.images || []), { image: '', alt: '' }]);
    };
    const deleteRightImage = (index: number) => {
        updateRight(
            'images',
            (props.right?.images || []).filter((_: any, i: number) => i !== index),
        );
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('hero.heading')}</h4>

            <VariantSwitcher
                componentType="heroSection"
                currentProps={props}
                onApply={(newProps) => updateComponent(pageId, component.id, { props: newProps })}
            />

            <div className="space-y-2">
                <Label>{t('hero.layout')}</Label>
                <select
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={props.layout || 'split'}
                    onChange={(e) => updateProp('layout', e.target.value)}
                >
                    <option value="split">{t('hero.layoutSplit')}</option>
                    <option value="centered">{t('hero.layoutCentered')}</option>
                    <option value="fullwidth">{t('hero.layoutFullWidth')}</option>
                </select>
            </div>

            <ImageUploadField slot="background"
                label={t('hero.backgroundImage')}
                value={props.backgroundImage || ''}
                onChange={(url) => updateProp('backgroundImage', url)}
            />
            <p className="-mt-2 text-caption text-neutral-500">
                {t('hero.backgroundImageHint')}
            </p>

            <ColorPickerField
                label={t('hero.backgroundColor')}
                value={props.backgroundColor || '#ffffff'} // design-lint-ignore: color-editor swatch/seed value
                onChange={(c) => updateProp('backgroundColor', c)}
            />

            {/* ── Eyebrow (badge above the title) ── */}
            <div className="space-y-2 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold">{t('hero.eyebrowBadge')}</h5>
                <Input
                    placeholder={t('hero.eyebrowPlaceholder')}
                    value={props.eyebrow?.text || ''}
                    onChange={(e) => {
                        // Clearing the text keeps the eyebrow's other settings
                        // (e.g. style 'rule'), so retyping does not turn it into a badge.
                        const keepsSettings = Object.keys(props.eyebrow || {}).some(
                            (k) => k !== 'text'
                        );
                        updateProp(
                            'eyebrow',
                            e.target.value || keepsSettings
                                ? { ...(props.eyebrow || {}), text: e.target.value }
                                : undefined
                        );
                    }}
                />
                {props.eyebrow?.text && (
                    <select
                        className="w-full rounded border px-3 py-2 text-sm"
                        value={props.eyebrow?.style || 'badge'}
                        onChange={(e) => updateProp('eyebrow', { ...props.eyebrow, style: e.target.value })}
                    >
                        <option value="badge">{t('hero.eyebrowStyleBadge')}</option>
                        <option value="plain">{t('hero.eyebrowStylePlain')}</option>
                        {/* "rule" (a line before the text) is the editorial hero's look. */}
                        {(props.variant === 'editorial' || props.eyebrow?.style === 'rule') && (
                            <option value="rule">{t('hero.eyebrowStyleRule')}</option>
                        )}
                        {/* Any other stored style stays selected instead of reading as "Badge". */}
                        {props.eyebrow?.style &&
                            !['badge', 'plain', 'rule'].includes(props.eyebrow.style) && (
                                <option value={props.eyebrow.style}>
                                    {t('options.customValue', { value: props.eyebrow.style })}
                                </option>
                            )}
                    </select>
                )}
            </div>

            {/* ── Stat chips row ── */}
            <div className="space-y-2 rounded border bg-gray-50 p-3">
                <div className="flex items-center justify-between">
                    <h5 className="text-xs font-semibold">{t('hero.statChips')}</h5>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        disabled={(props.statChips || []).length >= 4}
                        onClick={() =>
                            updateProp('statChips', [
                                ...(props.statChips || []),
                                { value: '', label: '' },
                            ])
                        }
                    >
                        + {t('actions.add')}
                    </Button>
                </div>
                <p className="text-caption text-gray-400">{t('hero.statChipsHint')}</p>
                {(props.statChips || []).map((chip: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                        <Input
                            className="flex-1"
                            placeholder="20,000+"
                            value={chip.value || ''}
                            onChange={(e) => {
                                const next = [...(props.statChips || [])];
                                next[i] = { ...next[i], value: e.target.value };
                                updateProp('statChips', next);
                            }}
                        />
                        <Input
                            className="flex-1"
                            placeholder={t('hero.statChipLabelPlaceholder')}
                            value={chip.label || ''}
                            onChange={(e) => {
                                const next = [...(props.statChips || [])];
                                next[i] = { ...next[i], label: e.target.value };
                                updateProp('statChips', next);
                            }}
                        />
                        <button
                            type="button"
                            aria-label={t('hero.removeStatChip')}
                            className="text-xs text-red-500 hover:text-red-700"
                            onClick={() =>
                                updateProp(
                                    'statChips',
                                    (props.statChips || []).filter((_: any, j: number) => j !== i),
                                )
                            }
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>

            {/* ── Trust chip ── */}
            <div className="space-y-2 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold">{t('hero.trustChip')}</h5>
                <Input
                    placeholder={t('hero.trustChipPlaceholder')}
                    value={props.trust?.text || ''}
                    onChange={(e) =>
                        updateProp(
                            'trust',
                            e.target.value || props.trust?.rating
                                ? { ...(props.trust || {}), text: e.target.value }
                                : undefined,
                        )
                    }
                />
                <div className="flex items-center gap-2">
                    <Label className="text-xs">{t('hero.ratingLabel')}</Label>
                    <Input
                        type="number"
                        min={0}
                        max={5}
                        step={0.1}
                        className="w-24"
                        value={props.trust?.rating ?? 0}
                        onChange={(e) => {
                            const rating = Math.min(5, Math.max(0, Number(e.target.value) || 0));
                            updateProp('trust', {
                                ...(props.trust || {}),
                                rating: rating > 0 ? rating : undefined,
                            });
                        }}
                    />
                </div>
            </div>

            {/* ── CTA buttons (multi) ── */}
            <div className="space-y-2 rounded border bg-gray-50 p-3">
                <div className="flex items-center justify-between">
                    <h5 className="text-xs font-semibold">{t('hero.ctaButtonsMulti')}</h5>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        disabled={(props.left?.buttons || []).length >= 3}
                        onClick={() =>
                            updateLeft('buttons', [
                                ...(props.left?.buttons || []),
                                { text: '', action: 'navigate', target: '', variant: (props.left?.buttons || []).length === 0 ? 'primary' : 'secondary' },
                            ])
                        }
                    >
                        + {t('actions.add')}
                    </Button>
                </div>
                <p className="text-caption text-gray-400">
                    {t('hero.ctaButtonsHint')}
                </p>
                {(props.left?.buttons || []).map((b: any, i: number) => (
                    <div key={i} className="space-y-1 rounded border bg-white p-2">
                        <div className="flex items-center gap-2">
                            <Input
                                className="flex-1"
                                placeholder={t('hero.buttonTextPlaceholder')}
                                value={b.text || ''}
                                onChange={(e) => {
                                    const next = [...(props.left?.buttons || [])];
                                    next[i] = { ...next[i], text: e.target.value };
                                    updateLeft('buttons', next);
                                }}
                            />
                            <select
                                className="rounded border px-2 py-1.5 text-xs"
                                value={b.variant || 'secondary'}
                                onChange={(e) => {
                                    const next = [...(props.left?.buttons || [])];
                                    next[i] = { ...next[i], variant: e.target.value };
                                    updateLeft('buttons', next);
                                }}
                            >
                                <option value="primary">{t('hero.variantPrimary')}</option>
                                <option value="secondary">{t('hero.variantSecondary')}</option>
                            </select>
                            <button
                                type="button"
                                aria-label={t('hero.removeButton')}
                                className="text-xs text-red-500 hover:text-red-700"
                                onClick={() =>
                                    updateLeft(
                                        'buttons',
                                        (props.left?.buttons || []).filter((_: any, j: number) => j !== i),
                                    )
                                }
                            >
                                ✕
                            </button>
                        </div>
                        <HeroButtonActionFields
                            button={b}
                            onChange={(patch) => {
                                const next = [...(props.left?.buttons || [])];
                                next[i] = { ...next[i], ...patch };
                                updateLeft('buttons', next);
                            }}
                        />
                    </div>
                ))}
            </div>

            {/* ── Legacy single button ── Older heroes (and the page templates) carry
                left.button instead of left.buttons. The live hero shows it whenever no
                multi-CTA has text, so it must stay editable here. */}
            {!(props.left?.buttons || []).some((b: any) => b?.text?.trim()) &&
                props.left?.button &&
                isTruthyFlag(props.left.button.enabled) && (
                    <div className="space-y-2 rounded border bg-gray-50 p-3">
                        <div className="flex items-center justify-between">
                            <h5 className="text-xs font-semibold">{t('hero.mainButton')}</h5>
                            <Switch
                                aria-label={t('hero.mainButton')}
                                checked
                                onCheckedChange={(c) => updateLeft('button', { ...props.left.button, enabled: c })}
                            />
                        </div>
                        <Input
                            placeholder={t('hero.buttonTextPlaceholder')}
                            value={props.left.button.text || ''}
                            onChange={(e) => updateLeft('button', { ...props.left.button, text: e.target.value })}
                        />
                        <HeroButtonActionFields
                            button={props.left.button}
                            onChange={(patch) => updateLeft('button', { ...props.left.button, ...patch })}
                        />
                    </div>
                )}

            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold">{t('hero.leftContent')}</h5>
                <div className="space-y-2">
                    <Label className="text-xs">{t('hero.titleField')}</Label>
                    <Input
                        value={props.left?.title || ''}
                        onChange={(e) => updateLeft('title', e.target.value)}
                    />
                </div>
                <RichTextField
                    label={t('hero.description')}
                    value={props.left?.description || ''}
                    onChange={(html) => updateLeft('description', html)}
                    placeholder={t('hero.descriptionPlaceholder')}
                />
            </div>

            <HeroEditorialFields
                props={props}
                updateProp={updateProp}
                patchProps={(next) => updateComponent(pageId, component.id, { props: { ...props, ...next } })}
                updateLeft={updateLeft}
            />

            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold">{t('hero.rightImage')}</h5>
                <ImageUploadField
                    label={t('hero.imageField')}
                    value={props.right?.image || ''}
                    onChange={(url) => updateRight('image', url)}
                />
                <div className="space-y-2">
                    <Label className="text-xs">{t('hero.altText')}</Label>
                    <Input
                        value={props.right?.alt || ''}
                        onChange={(e) => updateRight('alt', e.target.value)}
                    />
                </div>
            </div>

            {/* Right Video — a YouTube/Vimeo link or an uploaded file. When set
                it replaces the image/carousel in the hero media slot. */}
            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold">{t('hero.rightVideo')}</h5>
                <VideoUploadField
                    label={t('hero.videoField')}
                    value={props.right?.video || ''}
                    onChange={(url) => updateRight('video', url)}
                />
                <p className="text-xs text-gray-500">
                    {t('hero.videoHint')}
                </p>
                {props.right?.video && (
                    <ImageUploadField slot="card"
                        label={t('hero.posterField')}
                        value={props.right?.videoPoster || ''}
                        onChange={(url) => updateRight('videoPoster', url)}
                    />
                )}
            </div>

            {/* Carousel Images */}
            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <div className="flex items-center justify-between">
                    <h5 className="text-xs font-semibold">{t('hero.carouselImages')}</h5>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={addRightImage}
                    >
                        <Plus className="me-1 size-3" /> {t('actions.add')}
                    </Button>
                </div>
                <p className="text-xs text-gray-500">
                    {t('hero.carouselImagesHint')}
                </p>
                {(props.right?.images || []).map((img: any, i: number) => (
                    <div key={i} className="space-y-2 rounded border bg-white p-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-500">
                                {t('hero.slideN', { n: i + 1 })}
                            </span>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="size-6 shrink-0 p-0 text-red-500"
                                onClick={() => deleteRightImage(i)}
                            >
                                <Trash2 className="size-3" />
                            </Button>
                        </div>
                        <ImageUploadField
                            label={t('hero.imageField')}
                            value={img.image || ''}
                            onChange={(url) => updateRightImage(i, 'image', url)}
                        />
                        <Input
                            className="h-7 text-xs"
                            placeholder={t('hero.altTextPlaceholder')}
                            value={img.alt || ''}
                            onChange={(e) => updateRightImage(i, 'alt', e.target.value)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

// Book Details Editor
const BookDetailsEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('bookDetails.heading')}</h4>

            <div className="flex items-center justify-between">
                <Label>{t('bookDetails.showEnquiry')}</Label>
                <Switch
                    checked={props.showEnquiry || false}
                    onCheckedChange={(c) => updateProp('showEnquiry', c)}
                />
            </div>

            <div className="flex items-center justify-between">
                <Label>{t('bookDetails.showPayment')}</Label>
                <Switch
                    checked={props.showPayment || false}
                    onCheckedChange={(c) => updateProp('showPayment', c)}
                />
            </div>

            <div className="flex items-center justify-between">
                <Label>{t('bookDetails.showAddToCart')}</Label>
                <Switch
                    checked={props.showAddToCart || false}
                    onCheckedChange={(c) => updateProp('showAddToCart', c)}
                />
            </div>
        </div>
    );
};

// Cart Component Editor
const CartComponentEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('cart.heading')}</h4>

            <div className="flex items-center justify-between">
                <Label>{t('cart.showItemImage')}</Label>
                <Switch
                    checked={props.showItemImage ?? true}
                    onCheckedChange={(c) => updateProp('showItemImage', c)}
                />
            </div>

            <div className="flex items-center justify-between">
                <Label>{t('cart.showItemTitle')}</Label>
                <Switch
                    checked={props.showItemTitle ?? true}
                    onCheckedChange={(c) => updateProp('showItemTitle', c)}
                />
            </div>

            <div className="flex items-center justify-between">
                <Label>{t('cart.showQuantitySelector')}</Label>
                <Switch
                    checked={props.showQuantitySelector ?? true}
                    onCheckedChange={(c) => updateProp('showQuantitySelector', c)}
                />
            </div>

            <div className="flex items-center justify-between">
                <Label>{t('cart.showRemoveButton')}</Label>
                <Switch
                    checked={props.showRemoveButton ?? true}
                    onCheckedChange={(c) => updateProp('showRemoveButton', c)}
                />
            </div>

            <div className="flex items-center justify-between">
                <Label>{t('cart.showPrice')}</Label>
                <Switch
                    checked={props.showPrice ?? true}
                    onCheckedChange={(c) => updateProp('showPrice', c)}
                />
            </div>

            <div className="space-y-2">
                <Label>{t('cart.emptyStateMessage')}</Label>
                <Input
                    value={props.emptyStateMessage || ''}
                    onChange={(e) => updateProp('emptyStateMessage', e.target.value)}
                />
            </div>
        </div>
    );
};

// Stats Highlights Editor
const StatsHighlightsEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };

    const addStat = () => {
        const newStat = { label: t('stats.defaults.newStat'), value: '0' };
        updateProp('stats', [...(props.stats || []), newStat]);
    };

    const updateStat = (index: number, field: string, value: string) => {
        const newStats = [...(props.stats || [])];
        newStats[index] = { ...newStats[index], [field]: value };
        updateProp('stats', newStats);
    };

    const deleteStat = (index: number) => {
        updateProp(
            'stats',
            props.stats.filter((_: any, i: number) => i !== index)
        );
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('stats.heading')}</h4>

            <div className="space-y-2">
                <Label>{t('stats.headerText')}</Label>
                <Input
                    value={props.headerText || ''}
                    onChange={(e) => updateProp('headerText', e.target.value)}
                />
            </div>

            <div className="space-y-2">
                <Label>{t('stats.style')}</Label>
                <select
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={props.style || 'card'}
                    onChange={(e) => updateProp('style', e.target.value)}
                >
                    <option value="circle">{t('stats.styleCircle')}</option>
                    <option value="card">{optionLabel(t, 'card')}</option>
                    <option value="minimal">{optionLabel(t, 'minimal')}</option>
                </select>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>{t('stats.stats')}</Label>
                    <Button size="sm" variant="outline" onClick={addStat}>
                        <Plus className="me-1 size-3" /> {t('actions.add')}
                    </Button>
                </div>
                {props.stats?.map((stat: any, index: number) => (
                    <div
                        key={index}
                        className="flex items-center gap-2 rounded border bg-gray-50 p-2"
                    >
                        <Input
                            placeholder={t('header.labelPlaceholder')}
                            value={stat.label}
                            onChange={(e) => updateStat(index, 'label', e.target.value)}
                            className="flex-1"
                        />
                        <Input
                            placeholder={t('stats.valuePlaceholder')}
                            value={stat.value}
                            onChange={(e) => updateStat(index, 'value', e.target.value)}
                            className="w-24"
                        />
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteStat(index)}
                            className="size-8 p-0 text-red-600"
                        >
                            <Trash2 className="size-3" />
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Testimonials Editor
const TestimonialsEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    const updateProp = (key: string, value: any) => {
        updateComponent(pageId, component.id, {
            props: { ...props, [key]: value },
        });
    };

    const addTestimonial = () => {
        const newItem = {
            name: t('testimonials.defaults.customerName'),
            role: t('testimonials.defaults.role'),
            feedback: t('testimonials.defaults.feedback'),
            avatar: '',
        };
        updateProp('testimonials', [...(props.testimonials || []), newItem]);
    };

    const updateTestimonial = (index: number, field: string, value: string) => {
        const newItems = [...(props.testimonials || [])];
        newItems[index] = { ...newItems[index], [field]: value };
        updateProp('testimonials', newItems);
    };

    const deleteTestimonial = (index: number) => {
        updateProp(
            'testimonials',
            props.testimonials.filter((_: any, i: number) => i !== index)
        );
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('testimonials.heading')}</h4>

            <div className="space-y-2">
                <Label>{t('stats.headerText')}</Label>
                <Input
                    value={props.headerText || ''}
                    onChange={(e) => updateProp('headerText', e.target.value)}
                />
            </div>

            <div className="space-y-2">
                <Label>{t('testimonials.layout')}</Label>
                <select
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={props.layout || 'carousel'}
                    onChange={(e) => updateProp('layout', e.target.value)}
                >
                    <option value="carousel">{t('testimonials.layoutCarousel')}</option>
                    <option value="grid-scroll">{t('testimonials.layoutGridScroll')}</option>
                    <option value="static-grid">{t('testimonials.layoutStaticGrid')}</option>
                </select>
            </div>

            {(props.layout || 'carousel') === 'carousel' && (
                <div className="space-y-3 rounded border p-3">
                    <div className="space-y-2">
                        <Label>{t('testimonials.cardsPerView')}</Label>
                        <select
                            className="w-full rounded border px-3 py-2 text-sm"
                            value={String(props.cardsPerView || 1)}
                            onChange={(e) => {
                                const n = Number(e.target.value);
                                // 1 is the renderer's default — drop the key so old sites stay byte-identical
                                updateProp('cardsPerView', n > 1 ? n : undefined);
                            }}
                        >
                            {[1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500">{t('testimonials.cardsPerViewHint')}</p>
                    </div>
                    <div className="flex items-center justify-between">
                        <Label>{t('testimonials.autoplay')}</Label>
                        <Switch
                            checked={!!props.autoplay}
                            onCheckedChange={(c) => updateProp('autoplay', c || undefined)}
                        />
                    </div>
                    {props.autoplay && (
                        <div className="space-y-2">
                            <Label>{t('testimonials.autoplaySeconds')}</Label>
                            <Input
                                type="number"
                                min={1.5}
                                max={30}
                                step={0.5}
                                className="w-24"
                                value={(props.autoplayIntervalMs || 5000) / 1000}
                                onChange={(e) => {
                                    // The live carousel floors the interval at 1.5s; half-second steps up to 30s
                                    const s = Math.min(30, Math.max(1.5, Math.round((Number(e.target.value) || 5) * 2) / 2));
                                    updateProp('autoplayIntervalMs', s === 5 ? undefined : s * 1000);
                                }}
                            />
                        </div>
                    )}
                </div>
            )}

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>{t('testimonials.testimonials')}</Label>
                    <Button size="sm" variant="outline" onClick={addTestimonial}>
                        <Plus className="me-1 size-3" /> {t('actions.add')}
                    </Button>
                </div>
                {props.testimonials?.map((item: any, index: number) => (
                    <div key={index} className="space-y-2 rounded border bg-gray-50 p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">{t('testimonials.testimonialN', { n: index + 1 })}</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteTestimonial(index)}
                                className="size-6 p-0 text-red-600"
                            >
                                <Trash2 className="size-3" />
                            </Button>
                        </div>
                        <Input
                            placeholder={t('testimonials.namePlaceholder')}
                            value={item.name}
                            onChange={(e) => updateTestimonial(index, 'name', e.target.value)}
                        />
                        <Input
                            placeholder={t('testimonials.rolePlaceholder')}
                            value={item.role}
                            onChange={(e) => updateTestimonial(index, 'role', e.target.value)}
                        />
                        {/* The live card reads feedback || text || quote || content, and sites
                            written by the AI/MCP store `quote` — show whichever is set, and on edit
                            write `feedback` alone so a stale key can't shadow the new text. */}
                        <Textarea
                            placeholder={t('testimonials.feedbackPlaceholder')}
                            rows={3}
                            value={item.feedback || item.text || item.quote || item.content || ''}
                            onChange={(e) => {
                                const next = [...(props.testimonials || [])];
                                next[index] = {
                                    ...next[index],
                                    feedback: e.target.value,
                                    text: undefined,
                                    quote: undefined,
                                    content: undefined,
                                };
                                updateProp('testimonials', next);
                            }}
                        />
                        <ImageUploadField
                            slot="avatar"
                            label={t('testimonials.photo')}
                            value={item.avatar || ''}
                            onChange={(url) => updateTestimonial(index, 'avatar', url)}
                        />
                        <div className="flex items-center gap-3">
                            <Label className="text-xs">{t('hero.ratingLabel')}</Label>
                            <Input
                                type="number"
                                min={0}
                                max={5}
                                step={1}
                                className="w-20"
                                value={item.rating ?? 0}
                                onChange={(e) => {
                                    const next = [...(props.testimonials || [])];
                                    // Integer stars, clamped — the live card rounds and caps at 5
                                    const r = Math.round(Math.min(5, Math.max(0, Number(e.target.value) || 0)));
                                    next[index] = { ...next[index], rating: r > 0 ? r : undefined };
                                    updateProp('testimonials', next);
                                }}
                            />
                            <Label className="text-xs">{t('testimonials.featured')}</Label>
                            <Switch
                                checked={item.highlight || false}
                                onCheckedChange={(c) => {
                                    const next = [...(props.testimonials || [])];
                                    next[index] = { ...next[index], highlight: c || undefined };
                                    updateProp('testimonials', next);
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Policy Renderer Editor
const PolicyRendererEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;

    const updatePolicy = (policyKey: string, field: string, value: string) => {
        const policies = props.policies || {};
        updateComponent(pageId, component.id, {
            props: {
                ...props,
                policies: {
                    ...policies,
                    [policyKey]: {
                        ...policies[policyKey],
                        [field]: value,
                    },
                },
            },
        });
    };

    const addPolicy = () => {
        const key = `policy_${Date.now()}`;
        const policies = props.policies || {};
        updateComponent(pageId, component.id, {
            props: {
                ...props,
                policies: {
                    ...policies,
                    [key]: { title: t('policy.defaults.title'), content: t('policy.defaults.content') },
                },
            },
        });
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('policy.heading')}</h4>

            <div className="flex items-center justify-between">
                <Label>{t('policy.policies')}</Label>
                <Button size="sm" variant="outline" onClick={addPolicy}>
                    <Plus className="me-1 size-3" /> {t('actions.add')}
                </Button>
            </div>

            {Object.entries(props.policies || {}).map(([key, policy]: [string, any]) => (
                <div key={key} className="space-y-2 rounded border bg-gray-50 p-3">
                    <div className="space-y-2">
                        <Label className="text-xs">{t('header.title')}</Label>
                        <Input
                            value={policy.title || ''}
                            onChange={(e) => updatePolicy(key, 'title', e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">{t('policy.contentHtml')}</Label>
                        <Textarea
                            rows={4}
                            value={policy.content || ''}
                            onChange={(e) => updatePolicy(key, 'content', e.target.value)}
                            className="font-mono text-xs"
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};

// FAQ Section Editor
const FaqSectionEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addFaq = () => updateProp('faqs', [...(props.faqs || []), { question: t('faq.defaults.question'), answer: t('faq.defaults.answer') }]);
    const deleteFaq = (i: number) => updateProp('faqs', props.faqs.filter((_: any, idx: number) => idx !== i));
    const updateFaq = (i: number, field: string, value: string) => {
        const next = [...(props.faqs || [])];
        next[i] = { ...next[i], [field]: value };
        updateProp('faqs', next);
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('faq.heading')}</h4>
            <div className="space-y-2">
                <Label>{t('stats.headerText')}</Label>
                <Input value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('faq.subheading')}</Label>
                <Input value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} />
            </div>
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#F9FAFB' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
            <div className="border-t pt-4">
                <div className="mb-3 flex items-center justify-between">
                    <Label>{t('faq.questionsCount', { count: props.faqs?.length || 0 })}</Label>
                    <Button size="sm" onClick={addFaq}><Plus className="me-1 size-3" />{t('actions.add')}</Button>
                </div>
                {props.faqs?.map((faq: any, i: number) => (
                    <div key={i} className="mb-2 rounded border bg-gray-50 p-3">
                        <div className="flex items-center justify-between">
                            <button onClick={() => setExpandedFaq(expandedFaq === i ? null : i)} className="flex flex-1 items-center gap-2 text-left text-sm font-medium">
                                {expandedFaq === i ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                                {faq.question}
                            </button>
                            <Button size="sm" variant="ghost" onClick={() => deleteFaq(i)} className="size-7 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                        </div>
                        {expandedFaq === i && (
                            <div className="mt-3 space-y-2 border-t pt-3">
                                <Input placeholder={t('faq.questionPlaceholder')} value={faq.question} onChange={(e) => updateFaq(i, 'question', e.target.value)} />
                                <Textarea placeholder={t('faq.answerPlaceholder')} rows={2} value={faq.answer} onChange={(e) => updateFaq(i, 'answer', e.target.value)} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// Video Embed Editor
const VideoEmbedEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('videoEmbed.heading')}</h4>
            <div className="space-y-2">
                <Label>{t('videoEmbed.url')}</Label>
                <Input value={props.url || ''} placeholder="https://youtu.be/..." onChange={(e) => updateProp('url', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('header.title')}</Label>
                <Input value={props.title || ''} onChange={(e) => updateProp('title', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('videoEmbed.caption')}</Label>
                <Input value={props.caption || ''} placeholder={t('videoEmbed.captionPlaceholder')} onChange={(e) => updateProp('caption', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('videoEmbed.aspectRatio')}</Label>
                <select className="w-full rounded border px-3 py-2 text-sm" value={props.aspectRatio || '16:9'} onChange={(e) => updateProp('aspectRatio', e.target.value)}>
                    <option value="16:9">{t('videoEmbed.aspect169')}</option>
                    <option value="4:3">{t('videoEmbed.aspect43')}</option>
                    <option value="1:1">{t('videoEmbed.aspect11')}</option>
                    <option value="9:16">{t('videoEmbed.aspect916')}</option>
                </select>
            </div>
            <div className="flex items-center justify-between">
                <Label>{t('mediaShowcase.autoplay')}</Label>
                <Switch checked={props.autoplay || false} onCheckedChange={(c) => updateProp('autoplay', c)} />
            </div>
        </div>
    );
};

// Document Viewer Editor
const DocumentViewerEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    const display = props.display || 'button';
    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('documentViewer.heading')}</h4>
            <DocumentUploadField
                label={t('documentViewer.file')}
                value={props.documentUrl || ''}
                onChange={(url) => updateProp('documentUrl', url)}
            />
            <div className="space-y-2">
                <Label>{t('documentViewer.fileName')}</Label>
                <Input
                    value={props.fileName || ''}
                    placeholder={t('documentViewer.fileNamePlaceholder')}
                    onChange={(e) => updateProp('fileName', e.target.value)}
                />
                <p className="text-xs text-gray-500">{t('documentViewer.fileNameHelp')}</p>
            </div>
            <div className="space-y-2">
                <Label>{t('ctaBanner.headingField')}</Label>
                <Input value={props.heading || ''} onChange={(e) => updateProp('heading', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('faq.subheading')}</Label>
                <Textarea rows={2} value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('documentViewer.display')}</Label>
                <select className="w-full rounded border px-3 py-2 text-sm" value={display} onChange={(e) => updateProp('display', e.target.value)}>
                    <option value="button">{t('documentViewer.displayButton')}</option>
                    <option value="inline">{t('documentViewer.displayInline')}</option>
                </select>
                <p className="text-xs text-gray-500">
                    {display === 'inline' ? t('documentViewer.displayInlineHelp') : t('documentViewer.displayButtonHelp')}
                </p>
            </div>
            {display === 'button' ? (
                <>
                    <div className="space-y-2">
                        <Label>{t('documentViewer.buttonText')}</Label>
                        <Input value={props.buttonText || ''} placeholder={t('mediaShowcase.buttonTextPlaceholder')} onChange={(e) => updateProp('buttonText', e.target.value)} />
                    </div>
                    <ImageUploadField slot="gallery"
                        label={t('documentViewer.coverImage')}
                        value={props.coverImage || ''}
                        onChange={(url) => updateProp('coverImage', url)}
                    />
                </>
            ) : (
                <div className="space-y-2">
                    <Label>{t('documentViewer.frameHeight')}</Label>
                    <select className="w-full rounded border px-3 py-2 text-sm" value={props.height || '70vh'} onChange={(e) => updateProp('height', e.target.value)}>
                        <option value="480px">{t('documentViewer.heightShort')}</option>
                        <option value="70vh">{t('documentViewer.heightMedium')}</option>
                        <option value="85vh">{t('documentViewer.heightTall')}</option>
                    </select>
                </div>
            )}
            <div className="flex items-center justify-between">
                <Label>{t('documentViewer.showDownload')}</Label>
                <Switch checked={props.showDownload !== false} onCheckedChange={(c) => updateProp('showDownload', c)} />
            </div>
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || ''} onChange={(c) => updateProp('backgroundColor', c)} />
            <ColorPickerField label={t('header.textColor')} value={props.textColor || ''} onChange={(c) => updateProp('textColor', c)} />
        </div>
    );
};

// CTA Banner Editor
const CtaBannerEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    // A band shows its button unless enabled is false and, with no colour set,
    // uses the site palette; a classic banner needs enabled: true and has
    // blue / white defaults.
    const isBand = props.variant === 'band';
    const buttonShown = isBand ? bandButtonShown(props.button) : !!props.button?.enabled;
    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('ctaBanner.heading')}</h4>
            <div className="space-y-2">
                <Label>{t('ctaBanner.headingField')}</Label>
                <Input value={props.heading || ''} onChange={(e) => updateProp('heading', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('faq.subheading')}</Label>
                <Textarea rows={2} value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('ctaBanner.layout')}</Label>
                <select className="w-full rounded border px-3 py-2 text-sm" value={props.layout || 'centered'} onChange={(e) => updateProp('layout', e.target.value)}>
                    <option value="centered">{optionLabel(t, 'center')}</option>
                    <option value="split">{t('ctaBanner.layoutSplit')}</option>
                </select>
            </div>
            {isBand ? (
                <>
                    <OptionalColorField label={t('faq.backgroundColor')} value={props.backgroundColor} onChange={(c) => updateProp('backgroundColor', c)} />
                    <OptionalColorField label={t('header.textColor')} value={props.textColor} onChange={(c) => updateProp('textColor', c)} />
                </>
            ) : (
                <>
                    <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#3B82F6' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
                    <ColorPickerField label={t('header.textColor')} value={props.textColor || '#FFFFFF' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('textColor', c)} />
                </>
            )}
            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold">{t('mediaShowcase.button')}</h5>
                <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('ctaBanner.showButton')}</Label>
                    <Switch aria-label={t('ctaBanner.showButton')} checked={buttonShown} onCheckedChange={(c) => updateProp('button', { ...props.button, enabled: c })} />
                </div>
                {buttonShown && (
                    <>
                        <Input placeholder={t('mediaShowcase.buttonTextPlaceholder')} value={props.button?.text || ''} onChange={(e) => updateProp('button', { ...props.button, text: e.target.value })} />
                        <div>
                            <Label className="text-xs">{t('header.onClick')}</Label>
                            <div className="mt-1 flex gap-1">
                                {([['navigate', t('options.openLink')], ['openForm', t('options.openFormPopup')]] as const).map(([v, l]) => (
                                    <button key={v} onClick={() => updateProp('button', { ...props.button, action: v })}
                                        className={`rounded px-2.5 py-1 text-caption font-medium ${(props.button?.action || 'navigate') === v ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}>{l}</button>
                                ))}
                            </div>
                        </div>
                        {props.button?.action === 'openForm' ? (
                            <CampaignPicker
                                label={t('header.formToOpen')}
                                allowEmpty={false}
                                value={props.button?.audienceId || ''}
                                onChange={(id) => updateProp('button', { ...props.button, audienceId: id })}
                            />
                        ) : (
                            <LinkPicker
                                label={t('mediaShowcase.buttonLink')}
                                value={props.button?.target || ''}
                                onChange={(v) => updateProp('button', { ...props.button, target: v })}
                            />
                        )}
                        {!isBand && (
                            <>
                                <OptionalColorField label={t('ctaBanner.buttonTextColor')} value={props.button?.textColor} onChange={(c) => updateProp('button', { ...props.button, textColor: c })} />
                                <OptionalColorField label={t('ctaBanner.buttonBackground')} value={props.button?.backgroundColor} onChange={(c) => updateProp('button', { ...props.button, backgroundColor: c })} />
                            </>
                        )}
                    </>
                )}
            </div>
            <CtaBandFields
                key={component.id}
                props={props}
                updateProp={updateProp}
                patchProps={(next) => updateComponent(pageId, component.id, { props: { ...props, ...next } })}
            />
        </div>
    );
};

// Pricing Table Editor
const PricingTableEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const [expandedPlan, setExpandedPlan] = useState<number | null>(null);
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addPlan = () => updateProp('plans', [...(props.plans || []), { name: t('pricingTable.defaults.planName'), price: '₹0', period: '/month', description: '', features: [t('pricingTable.defaults.feature1')], highlighted: false, buttonText: t('header.defaults.getStarted'), buttonTarget: '' }]);
    const deletePlan = (i: number) => updateProp('plans', props.plans.filter((_: any, idx: number) => idx !== i));
    const updatePlan = (i: number, field: string, value: any) => {
        const next = [...(props.plans || [])];
        next[i] = { ...next[i], [field]: value };
        updateProp('plans', next);
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('pricingTable.heading')}</h4>
            <div className="space-y-2"><Label>{t('stats.headerText')}</Label><Input value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('faq.subheading')}</Label><Input value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} /></div>
            <div className="border-t pt-4">
                <div className="mb-3 flex items-center justify-between">
                    <Label>{t('pricingTable.plansCount', { count: props.plans?.length || 0 })}</Label>
                    <Button size="sm" onClick={addPlan}><Plus className="me-1 size-3" />{t('pricingTable.addPlan')}</Button>
                </div>
                {props.plans?.map((plan: any, i: number) => (
                    <div key={i} className="mb-2 rounded border bg-gray-50 p-3">
                        <div className="flex items-center justify-between">
                            <button onClick={() => setExpandedPlan(expandedPlan === i ? null : i)} className="flex flex-1 items-center gap-2 text-left text-sm font-medium">
                                {expandedPlan === i ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                                {plan.name} — {plan.price}{plan.period}
                            </button>
                            <Button size="sm" variant="ghost" onClick={() => deletePlan(i)} className="size-7 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                        </div>
                        {expandedPlan === i && (
                            <div className="mt-3 space-y-2 border-t pt-3">
                                <Input placeholder={t('pricingTable.planNamePlaceholder')} value={plan.name} onChange={(e) => updatePlan(i, 'name', e.target.value)} />
                                <div className="flex gap-2">
                                    <Input placeholder={t('pricingTable.pricePlaceholder')} value={plan.price} onChange={(e) => updatePlan(i, 'price', e.target.value)} className="flex-1" />
                                    <Input placeholder="/month" value={plan.period} onChange={(e) => updatePlan(i, 'period', e.target.value)} className="w-24" />
                                </div>
                                <Input placeholder={t('pricingTable.descriptionPlaceholder')} value={plan.description || ''} onChange={(e) => updatePlan(i, 'description', e.target.value)} />
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('pricingTable.featuresOnePerLine')}</Label>
                                    <Textarea rows={3} value={(plan.features || []).join('\n')} onChange={(e) => updatePlan(i, 'features', e.target.value.split('\n').filter(Boolean))} />
                                </div>
                                <Input placeholder={t('mediaShowcase.buttonTextPlaceholder')} value={plan.buttonText || ''} onChange={(e) => updatePlan(i, 'buttonText', e.target.value)} />
                                <LinkPicker label={t('mediaShowcase.buttonLink')} value={plan.buttonTarget || ''} onChange={(v) => updatePlan(i, 'buttonTarget', v)} />
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">{t('pricingTable.highlighted')}</Label>
                                    <Switch checked={plan.highlighted || false} onCheckedChange={(c) => updatePlan(i, 'highlighted', c)} />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// Contact Form Editor
const ContactFormEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('contactForm.heading')}</h4>
            <div className="space-y-2"><Label>{t('ctaBanner.headingField')}</Label><Input value={props.heading || ''} onChange={(e) => updateProp('heading', e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('faq.subheading')}</Label><Input value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('contactForm.submitButtonLabel')}</Label><Input value={props.submitLabel || t('contactForm.defaultSubmitLabel')} onChange={(e) => updateProp('submitLabel', e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('contactForm.successMessage')}</Label><Input value={props.successMessage || ''} onChange={(e) => updateProp('successMessage', e.target.value)} /></div>
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#FFFFFF' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
            <CampaignPicker
                value={props.audienceId || ''}
                onChange={(id, name) => updateComponent(pageId, component.id, { props: { ...props, audienceId: id, audienceName: name } })}
            />
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-caption text-gray-500">
                {t('contactForm.submissionsHint')}
            </div>
        </div>
    );
};

// Team Section Editor
const TeamSectionEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const [expandedMember, setExpandedMember] = useState<number | null>(null);
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addMember = () => updateProp('members', [...(props.members || []), { name: t('team.defaults.name'), role: t('testimonials.defaults.role'), bio: '', avatar: '' }]);
    const deleteMember = (i: number) => updateProp('members', props.members.filter((_: any, idx: number) => idx !== i));
    const updateMember = (i: number, field: string, value: string) => {
        const next = [...(props.members || [])];
        next[i] = { ...next[i], [field]: value };
        updateProp('members', next);
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('team.heading')}</h4>
            <div className="space-y-2"><Label>{t('stats.headerText')}</Label><Input value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('faq.subheading')}</Label><Input value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} /></div>
            <div className="space-y-2">
                <Label>{t('columnLayout.columns')}</Label>
                <select className="w-full rounded border px-3 py-2 text-sm" value={props.columns || 3} onChange={(e) => updateProp('columns', parseInt(e.target.value))}>
                    <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                </select>
            </div>
            <div className="border-t pt-4">
                <div className="mb-3 flex items-center justify-between">
                    <Label>{t('team.membersCount', { count: props.members?.length || 0 })}</Label>
                    <Button size="sm" onClick={addMember}><Plus className="me-1 size-3" />{t('actions.add')}</Button>
                </div>
                {props.members?.map((m: any, i: number) => (
                    <div key={i} className="mb-2 rounded border bg-gray-50 p-3">
                        <div className="flex items-center justify-between">
                            <button onClick={() => setExpandedMember(expandedMember === i ? null : i)} className="flex flex-1 items-center gap-2 text-left text-sm font-medium">
                                {expandedMember === i ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                                {m.name} — {m.role}
                            </button>
                            <Button size="sm" variant="ghost" onClick={() => deleteMember(i)} className="size-7 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                        </div>
                        {expandedMember === i && (
                            <div className="mt-3 space-y-2 border-t pt-3">
                                <ImageUploadField slot="avatar" label={t('team.avatar')} value={m.avatar || ''} onChange={(url) => updateMember(i, 'avatar', url)} />
                                <Input placeholder={t('testimonials.namePlaceholder')} value={m.name} onChange={(e) => updateMember(i, 'name', e.target.value)} />
                                <Input placeholder={t('team.roleTitlePlaceholder')} value={m.role} onChange={(e) => updateMember(i, 'role', e.target.value)} />
                                <Textarea placeholder={t('team.shortBioPlaceholder')} rows={2} value={m.bio || ''} onChange={(e) => updateMember(i, 'bio', e.target.value)} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// Announcement Feed Editor
/** Auto-advance for a horizontal card row (featureGrid / productPageOffer 'carousel'). */
const AutoScrollControls = ({ props, updateProp }: { props: any; updateProp: (key: string, value: any) => void }) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    return (
        <div className="space-y-2 rounded border border-dashed border-gray-200 p-2">
            <div className="flex items-center justify-between">
                <Label className="text-xs">{t('autoScroll.label')}</Label>
                <Switch checked={!!props.autoScroll} onCheckedChange={(c) => updateProp('autoScroll', c || undefined)} />
            </div>
            {props.autoScroll && (
                <div className="flex items-center gap-2">
                    <Input
                        type="number"
                        min={1.5}
                        max={30}
                        step={0.5}
                        className="w-24"
                        value={(props.autoScrollIntervalMs || 3000) / 1000}
                        onChange={(e) => {
                            // The live rail floors the interval at 1.5s.
                            const s = Math.min(30, Math.max(1.5, Math.round((Number(e.target.value) || 3) * 2) / 2));
                            updateProp('autoScrollIntervalMs', s * 1000);
                        }}
                    />
                    <span className="text-caption text-gray-500">{t('autoScroll.seconds')}</span>
                </div>
            )}
            {props.autoScroll && (
                <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('autoScroll.loop')}</Label>
                    <Switch checked={!!props.autoScrollLoop} onCheckedChange={(c) => updateProp('autoScrollLoop', c || undefined)} />
                </div>
            )}
            <p className="text-caption text-gray-400">
                {t('autoScroll.hint')} {props.autoScroll && t(props.autoScrollLoop ? 'autoScroll.loopOnHint' : 'autoScroll.loopOffHint')}
            </p>
        </div>
    );
};

/**
 * Blog section. Only the LOOK of the list is authored here — the posts
 * themselves are rows, not page JSON, written in the blog manager dialog
 * (Manage posts below), so publishing an article never means republishing
 * the site. The category picker reads the categories in use so the admin
 * never types one that matches nothing.
 */
const BlogEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const instituteId = getCurrentInstituteId();
    const openBlog = useBlogManagerStore((s) => s.open);
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    const { data: postsPage } = useQuery({
        queryKey: ['catalogue-blog-posts', instituteId, 'editor-picker'],
        queryFn: () => listBlogPosts(instituteId!, { status: 'ALL', size: 1 }),
        enabled: !!instituteId,
        staleTime: 60_000,
    });
    const categories = postsPage?.categories ?? [];
    const publishedHint = postsPage ? t('blog.postCount', { count: postsPage.total_elements }) : '';
    // Whole-store read on purpose (no selector): render tests mock the store as a plain function.
    const { config } = useEditorStore();
    // Sections of this page that stay under an open article (the rest hide).
    const otherSections: any[] = (config?.pages?.find((p: any) => p.id === pageId)?.components ?? []).filter(
        (c: any) => c?.id && c.id !== component.id
    );
    const articleSectionIds: string[] = Array.isArray(props.articleSectionIds) ? props.articleSectionIds : [];
    const toggleArticleSection = (id: string, on: boolean) =>
        updateProp(
            'articleSectionIds',
            on ? [...articleSectionIds.filter((x) => x !== id), id] : articleSectionIds.filter((x) => x !== id)
        );
    const sectionName = (c: any) => {
        const title = c.props?.heading || c.props?.title || c.props?.headerText || c.props?.headline;
        return typeof title === 'string' && title.trim()
            ? `${componentLabel(c.type)} · ${title.trim()}`
            : componentLabel(c.type);
    };
    const toggles: Array<[string, string]> = [
        ['showCoverImage', t('blog.showCoverImage')],
        ['showExcerpt', t('blog.showExcerpt')],
        ['showDate', t('blog.showDate')],
        ['showAuthor', t('blog.showAuthor')],
        ['showCategory', t('blog.showCategory')],
        ['showReadingTime', t('blog.showReadingTime')],
        ['showCategoryFilter', t('blog.showCategoryFilter')],
    ];
    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('blog.heading')}</h4>
            <div className="space-y-2 rounded border bg-gray-50 p-3">
                <p className="text-xs text-gray-600">{t('blog.managePostsHint')}</p>
                {publishedHint && <p className="text-xs text-gray-500">{publishedHint}</p>}
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => openBlog()}
                >
                    {t('blog.managePosts')}
                </Button>
            </div>
            <div className="space-y-2">
                <Label>{t('ctaBanner.headingField')}</Label>
                <Input value={props.heading || ''} onChange={(e) => updateProp('heading', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('faq.subheading')}</Label>
                <Textarea rows={2} value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                    <Label>{t('blog.layout')}</Label>
                    <select className="w-full rounded border px-3 py-2 text-sm" value={props.layout || 'grid'} onChange={(e) => updateProp('layout', e.target.value)}>
                        <option value="grid">{t('blog.layoutGrid')}</option>
                        <option value="list">{t('blog.layoutList')}</option>
                    </select>
                </div>
                {(props.layout || 'grid') === 'grid' && (
                    <div className="space-y-2">
                        <Label>{t('blog.columns')}</Label>
                        <select className="w-full rounded border px-3 py-2 text-sm" value={String(props.columns || 3)} onChange={(e) => updateProp('columns', Number(e.target.value))}>
                            <option value="2">2</option>
                            <option value="3">3</option>
                        </select>
                    </div>
                )}
            </div>
            <div className="space-y-2">
                <Label>{t('blog.pageSize')}</Label>
                <Input
                    type="number"
                    min={1}
                    max={50}
                    value={props.pageSize ?? 9}
                    onChange={(e) => updateProp('pageSize', Math.max(1, Math.min(50, Number(e.target.value) || 9)))}
                />
                <p className="text-xs text-gray-500">{t('blog.pageSizeHelp')}</p>
            </div>
            <div className="space-y-2">
                <Label>{t('blog.viewMoreRoute')}</Label>
                <Input value={props.viewMoreRoute || ''} onChange={(e) => updateProp('viewMoreRoute', e.target.value.trim())} placeholder="blog" />
                <p className="text-xs text-gray-500">{t('blog.viewMoreRouteHelp')}</p>
                {props.viewMoreRoute && (
                    <Input
                        value={props.viewMoreLabel || ''}
                        onChange={(e) => updateProp('viewMoreLabel', e.target.value)}
                        placeholder={t('blog.viewMoreLabelPlaceholder')}
                        aria-label={t('blog.viewMoreLabel')}
                    />
                )}
            </div>
            <div className="space-y-2">
                <Label>{t('blog.category')}</Label>
                <select className="w-full rounded border px-3 py-2 text-sm" value={props.category || ''} onChange={(e) => updateProp('category', e.target.value)}>
                    <option value="">{t('blog.allCategories')}</option>
                    {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                    {props.category && !categories.includes(props.category) && (
                        <option value={props.category}>{props.category}</option>
                    )}
                </select>
                <p className="text-xs text-gray-500">{t('blog.categoryHelp')}</p>
            </div>
            <div className="space-y-3 rounded border bg-gray-50 p-3">
                {toggles.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                        <Label className="text-xs">{label}</Label>
                        <Switch checked={props[key] !== false} onCheckedChange={(c) => updateProp(key, c)} />
                    </div>
                ))}
            </div>
            <div className="space-y-2">
                <Label>{t('blog.readMoreLabel')}</Label>
                <Input value={props.readMoreLabel || ''} onChange={(e) => updateProp('readMoreLabel', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('blog.backLabel')}</Label>
                <Input value={props.backLabel || ''} onChange={(e) => updateProp('backLabel', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label>{t('blog.emptyMessage')}</Label>
                <Input value={props.emptyMessage || ''} onChange={(e) => updateProp('emptyMessage', e.target.value)} />
            </div>
            <div className="space-y-2 rounded border border-dashed border-gray-200 p-2">
                <p className="text-caption font-medium text-gray-500">{t('blog.gateHeading')}</p>
                <CampaignPicker
                    label={t('featureGrid.gateList')}
                    value={props.gateAudienceId || ''}
                    onChange={(id, name) => updateComponent(pageId, component.id, { props: { ...props, gateAudienceId: id, gateAudienceName: name } })}
                />
                <Input value={props.gateTitle || ''} onChange={(e) => updateProp('gateTitle', e.target.value)} placeholder={t('blog.gateTitlePlaceholder')} />
                <p className="text-caption text-gray-400">{t('blog.gateHint')}</p>
            </div>
            {otherSections.length > 0 && (
                <div className="space-y-2 rounded border border-dashed border-gray-200 p-2">
                    <p className="text-caption font-medium text-gray-500">{t('blog.articleSectionsHeading')}</p>
                    {otherSections.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 text-xs">
                            <Checkbox
                                checked={articleSectionIds.includes(c.id)}
                                onCheckedChange={(v) => toggleArticleSection(c.id, v === true)}
                            />
                            <span className={c.enabled === false ? 'text-gray-400 line-through' : ''}>{sectionName(c)}</span>
                        </label>
                    ))}
                    <p className="text-caption text-gray-400">{t('blog.articleSectionsHint')}</p>
                </div>
            )}
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || ''} onChange={(c) => updateProp('backgroundColor', c)} />
            <ColorPickerField label={t('header.textColor')} value={props.textColor || ''} onChange={(c) => updateProp('textColor', c)} />
        </div>
    );
};

const AnnouncementFeedEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const [expandedItem, setExpandedItem] = useState<number | null>(null);
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addAnnouncement = () => updateProp('announcements', [...(props.announcements || []), { title: t('announcement.defaults.title'), date: new Date().toISOString().slice(0, 10), summary: t('announcement.defaults.summary'), tag: t('announcement.defaults.tag') }]);
    const deleteAnnouncement = (i: number) => updateProp('announcements', props.announcements.filter((_: any, idx: number) => idx !== i));
    const updateAnnouncement = (i: number, field: string, value: string) => {
        const next = [...(props.announcements || [])];
        next[i] = { ...next[i], [field]: value };
        updateProp('announcements', next);
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('announcement.heading')}</h4>
            <div className="space-y-2"><Label>{t('stats.headerText')}</Label><Input value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('ctaBanner.layout')}</Label>
                <select className="w-full rounded border px-3 py-2 text-sm" value={props.layout || 'list'} onChange={(e) => updateProp('layout', e.target.value)}>
                    <option value="list">{t('announcement.layoutList')}</option><option value="grid">{optionLabel(t, 'grid')}</option>
                </select>
            </div>
            <div className="flex items-center justify-between"><Label>{t('announcement.showDate')}</Label><Switch checked={props.showDate ?? true} onCheckedChange={(c) => updateProp('showDate', c)} /></div>
            <div className="flex items-center justify-between"><Label>{t('announcement.showTag')}</Label><Switch checked={props.showTag ?? true} onCheckedChange={(c) => updateProp('showTag', c)} /></div>
            <div className="border-t pt-4">
                <div className="mb-3 flex items-center justify-between">
                    <Label>{t('announcement.announcementsCount', { count: props.announcements?.length || 0 })}</Label>
                    <Button size="sm" onClick={addAnnouncement}><Plus className="me-1 size-3" />{t('actions.add')}</Button>
                </div>
                {props.announcements?.map((a: any, i: number) => (
                    <div key={i} className="mb-2 rounded border bg-gray-50 p-3">
                        <div className="flex items-center justify-between">
                            <button onClick={() => setExpandedItem(expandedItem === i ? null : i)} className="flex flex-1 items-center gap-2 text-left text-sm font-medium">
                                {expandedItem === i ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                                {a.title}
                            </button>
                            <Button size="sm" variant="ghost" onClick={() => deleteAnnouncement(i)} className="size-7 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                        </div>
                        {expandedItem === i && (
                            <div className="mt-3 space-y-2 border-t pt-3">
                                <Input placeholder={t('header.title')} value={a.title} onChange={(e) => updateAnnouncement(i, 'title', e.target.value)} />
                                <Input type="date" value={a.date || ''} onChange={(e) => updateAnnouncement(i, 'date', e.target.value)} />
                                <Input placeholder={t('announcement.tagPlaceholder')} value={a.tag || ''} onChange={(e) => updateAnnouncement(i, 'tag', e.target.value)} />
                                <Textarea placeholder={t('announcement.summaryPlaceholder')} rows={2} value={a.summary || ''} onChange={(e) => updateAnnouncement(i, 'summary', e.target.value)} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// Image Gallery Editor
const ImageGalleryEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addImage = () => updateProp('images', [...(props.images || []), { src: '', alt: '', caption: '' }]);
    const deleteImage = (i: number) => updateProp('images', props.images.filter((_: any, idx: number) => idx !== i));
    const updateImage = (i: number, field: string, value: string) => {
        const next = [...(props.images || [])];
        next[i] = { ...next[i], [field]: value };
        updateProp('images', next);
    };

    return (
        <div className="space-y-4">
            <h4 className="text-sm font-medium">{t('imageGallery.heading')}</h4>
            <div className="space-y-2"><Label>{t('stats.headerText')}</Label><Input value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} /></div>
            <div className="space-y-2">
                <Label>{t('columnLayout.columns')}</Label>
                <select className="w-full rounded border px-3 py-2 text-sm" value={props.columns || 3} onChange={(e) => updateProp('columns', parseInt(e.target.value))}>
                    <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                </select>
            </div>
            <div className="flex items-center justify-between"><Label>{t('imageGallery.showCaptions')}</Label><Switch checked={props.showCaptions || false} onCheckedChange={(c) => updateProp('showCaptions', c)} /></div>
            <div className="border-t pt-4">
                <div className="mb-3 flex items-center justify-between">
                    <Label>{t('imageGallery.imagesCount', { count: props.images?.length || 0 })}</Label>
                    <Button size="sm" onClick={addImage}><Plus className="me-1 size-3" />{t('imageGallery.addImage')}</Button>
                </div>
                {props.images?.map((img: any, i: number) => (
                    <div key={i} className="mb-2 space-y-2 rounded border bg-gray-50 p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">{t('imageGallery.imageN', { n: i + 1 })}</span>
                            <Button size="sm" variant="ghost" onClick={() => deleteImage(i)} className="size-6 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                        </div>
                        <ImageUploadField slot="gallery" label={t('hero.imageField')} value={img.src || ''} onChange={(url) => updateImage(i, 'src', url)} aiKind="photo" />
                        <Input placeholder={t('hero.altTextPlaceholder')} value={img.alt || ''} onChange={(e) => updateImage(i, 'alt', e.target.value)} />
                        {props.showCaptions && <Input placeholder={t('videoEmbed.caption')} value={img.caption || ''} onChange={(e) => updateImage(i, 'caption', e.target.value)} />}
                    </div>
                ))}
            </div>
        </div>
    );
};

/* ─── Spacer Editor ────────────────────────────────────────────────────── */

/** Name of the one institute-wide list every freebie form collects into. */
const FREEBIES_LIST_NAME = 'Freebies';
// One creation at a time: two sections switched to Resource in quick
// succession must end up on the same list, not two lists named Freebies.
let freebiesListInFlight: Promise<{ id: string; name: string }> | null = null;

/**
 * Finds the institute's "Freebies" list, creating it (Name / Email / Phone, all
 * required) the first time. Resource sections attach to it automatically so an
 * admin never has to build a list before gating a freebie, and every freebie
 * lead lands in one place.
 */
const useFreebiesList = () => {
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId();
    return (): Promise<{ id: string; name: string }> => {
        if (freebiesListInFlight) return freebiesListInFlight;
        freebiesListInFlight = (async () => {
            const data: any = await queryClient.fetchQuery(
                handleFetchCampaignsList({ institute_id: instituteId || '', status: 'ACTIVE', page: 0, size: 100, campaign_name: FREEBIES_LIST_NAME })
            );
            const existing = ((data?.content || []) as any[]).find(
                (c) => String(c.campaign_name || '').trim().toLowerCase() === FREEBIES_LIST_NAME.toLowerCase()
            );
            if (existing) return { id: existing.id || existing.audience_id || existing.campaign_id, name: existing.campaign_name };
            const { data: newId } = await axios.post(
                AUDIENCE_CAMPAIGN,
                {
                    institute_id: instituteId,
                    campaign_name: FREEBIES_LIST_NAME,
                    campaign_type: 'WEBSITE',
                    campaign_objective: 'LEAD_GENERATION',
                    description: 'Free resources on the website. Created by the website builder.',
                    status: 'ACTIVE',
                    institute_custom_fields: websiteFormFields(instituteId, true),
                },
                { headers: { Authorization: `Bearer ${getTokenFromCookie(TokenKey.accessToken)}` } },
            );
            queryClient.invalidateQueries({ queryKey: ['campaignsList'] });
            return { id: String(newId).replace(/^"|"$/g, ''), name: FREEBIES_LIST_NAME };
        })().finally(() => {
            freebiesListInFlight = null;
        });
        return freebiesListInFlight;
    };
};

/**
 * Editor for `leadForm` — an Audience campaign's form embedded on the page.
 * The FIELDS are not edited here by design: they live on the campaign in
 * Audience Manager, so one definition serves every placement (inline, popup,
 * standalone /audience-response page).
 */
const LeadFormEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    return (
        <div className="space-y-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-caption text-gray-500">
                {t('leadForm.hint')}
            </div>
            <CampaignPicker
                label={t('leadForm.campaignLabel')}
                allowEmpty={false}
                value={props.audienceId || ''}
                onChange={(id, name) => updateComponent(pageId, component.id, { props: { ...props, audienceId: id, audienceName: name } })}
            />
            <div>
                <Label className="text-xs">{t('header.title')}</Label>
                <Input className="mt-1" value={props.title || ''} onChange={(e) => updateProp('title', e.target.value)} placeholder={t('leadForm.titlePlaceholder')} />
            </div>
            <div>
                <Label className="text-xs">{t('leadForm.subtitle')}</Label>
                <Textarea className="mt-1" rows={2} value={props.subtitle || ''} onChange={(e) => updateProp('subtitle', e.target.value)} />
            </div>
            <div>
                <Label className="text-xs">{t('leadForm.submitButtonLabel')}</Label>
                <Input className="mt-1" value={props.submitLabel || ''} onChange={(e) => updateProp('submitLabel', e.target.value)} placeholder={t('leadForm.submitPlaceholder')} />
            </div>
            <div>
                <Label className="text-xs">{t('contactForm.successMessage')}</Label>
                <Input className="mt-1" value={props.successMessage || ''} onChange={(e) => updateProp('successMessage', e.target.value)} placeholder={t('leadForm.successMessagePlaceholder')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label className="text-xs">{t('stats.style')}</Label>
                    <div className="mt-1 flex gap-1">
                        {(['card', 'bare'] as const).map((v) => (
                            <button key={v} onClick={() => updateProp('layout', v)}
                                className={`rounded px-2.5 py-1 text-caption font-medium capitalize ${(props.layout || 'card') === v ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, v)}</button>
                        ))}
                    </div>
                </div>
                <div>
                    <Label className="text-xs">{t('leadForm.headerAlign')}</Label>
                    <div className="mt-1 flex gap-1">
                        {(['center', 'left'] as const).map((v) => (
                            <button key={v} onClick={() => updateProp('align', v)}
                                className={`rounded px-2.5 py-1 text-caption font-medium capitalize ${(props.align || 'center') === v ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, v)}</button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const ProductPageOfferEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const instituteId = getCurrentInstituteId();
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    // Only ACTIVE/DRAFT pages come back; a DRAFT page will not render publicly,
    // so it is labelled rather than hidden (admins often build both together).
    const { data: pages, isLoading } = useQuery({
        queryKey: ['PRODUCT_PAGES_FOR_CATALOGUE', instituteId],
        queryFn: () => getAllProductPages(instituteId!),
        enabled: !!instituteId,
        staleTime: 60_000,
    });

    const selected = (pages || []).find((p: any) => p.code === props.productPageCode);
    // Backend status codes (ACTIVE/DRAFT/...) are never shown raw — always through
    // this label map, falling back to the raw code for a status this map doesn't know.
    const statusLabel = (status: string) => t(`productPageOffer.status.${status}`, { defaultValue: status });

    return (
        <div className="space-y-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-caption text-gray-500">
                {t('productPageOffer.hint')}
            </div>

            <div>
                <Label className="text-xs">{t('productPageOffer.productPage')}</Label>
                <select
                    className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
                    value={props.productPageCode || ''}
                    onChange={(e) => {
                        const page = (pages || []).find((p: any) => p.code === e.target.value);
                        updateComponent(pageId, component.id, {
                            props: {
                                ...props,
                                productPageCode: e.target.value,
                                productPageName: page?.name || '',
                            },
                        });
                    }}
                >
                    <option value="">{isLoading ? t('productPageOffer.loadingProductPages') : t('productPageOffer.selectProductPage')}</option>
                    {(pages || []).map((p: any) => (
                        <option key={p.id} value={p.code}>
                            {p.name}{p.status !== 'ACTIVE' ? ` (${statusLabel(p.status)})` : ''}
                        </option>
                    ))}
                </select>
                {selected && selected.status !== 'ACTIVE' && (
                    <p className="mt-1 text-caption text-warning-600">
                        {t('productPageOffer.pageNotActiveWarning', { status: statusLabel(selected.status), activeStatus: statusLabel('ACTIVE') })}
                    </p>
                )}
                {selected && (
                    <p className="mt-1 text-caption text-gray-400">
                        {t('productPageOffer.coursesWillRender', { count: selected.mappings?.filter((m: any) => (m.status ?? 'ACTIVE') === 'ACTIVE').length ?? 0 })}
                    </p>
                )}
                {!isLoading && (pages || []).length === 0 && (
                    <p className="mt-1 text-caption text-gray-400">
                        {t('productPageOffer.noProductPages')}
                    </p>
                )}
            </div>

            <div>
                <Label className="text-xs">{t('header.title')}</Label>
                <Input className="mt-1" value={props.title || ''} onChange={(e) => updateProp('title', e.target.value)} placeholder={t('productPageOffer.titlePlaceholder')} />
            </div>
            <div>
                <Label className="text-xs">{t('leadForm.subtitle')}</Label>
                <Textarea className="mt-1" rows={2} value={props.subtitle || ''} onChange={(e) => updateProp('subtitle', e.target.value)} placeholder={t('productPageOffer.subtitlePlaceholder')} />
            </div>
            {/* Checkout mode. This is the one setting that changes what the
                card's main button DOES, so it sits above the label fields that
                depend on it rather than in the cosmetic groups further down. */}
            <div className="space-y-3 rounded border border-dashed border-gray-200 p-2">
                <p className="text-caption font-medium text-gray-500">
                    {t('productPageOffer.checkoutModeSectionTitle')}
                </p>

                <div className="flex items-center justify-between gap-3">
                    <Label className="text-xs">{t('productPageOffer.checkoutModeToggleLabel')}</Label>
                    <Switch
                        checked={!!props.enableCart}
                        onCheckedChange={(c) => updateProp('enableCart', c)}
                    />
                </div>
                <p className="-mt-1 text-caption text-gray-400">
                    {props.enableCart
                        ? t('productPageOffer.checkoutModeCartHint')
                        : t('productPageOffer.checkoutModeSingleHint')}
                </p>

                {props.enableCart ? (
                    <>
                        <div>
                            <Label className="text-xs">{t('productPageOffer.cartCtaLabelField')}</Label>
                            <Input
                                className="mt-1"
                                value={props.cartCtaLabel || ''}
                                onChange={(e) => updateProp('cartCtaLabel', e.target.value)}
                                placeholder={t('productPageOffer.cartCtaPlaceholder')}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('productPageOffer.checkoutCtaLabelField')}</Label>
                            <Input
                                className="mt-1"
                                value={props.checkoutCtaLabel || ''}
                                onChange={(e) => updateProp('checkoutCtaLabel', e.target.value)}
                                placeholder={t('productPageOffer.checkoutCtaPlaceholder')}
                            />
                            <p className="mt-1 text-caption text-gray-400">
                                {t('productPageOffer.checkoutCtaHint')}
                            </p>
                        </div>
                    </>
                ) : (
                    <div>
                        <Label className="text-xs">{t('productPageOffer.buttonLabel')}</Label>
                        <Input
                            className="mt-1"
                            value={props.ctaLabel || ''}
                            onChange={(e) => updateProp('ctaLabel', e.target.value)}
                            placeholder={t('productPageOffer.enrolNow')}
                        />
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between">
                <Label className="text-xs">{t('productPageOffer.viewCourseButtonToggle')}</Label>
                <Switch
                    checked={props.showViewCourse !== false}
                    onCheckedChange={(c) => updateProp('showViewCourse', c)}
                />
            </div>
            {props.showViewCourse !== false && (
                <div>
                    <Label className="text-xs">{t('productPageOffer.viewCourseLabelField')}</Label>
                    <Input className="mt-1" value={props.viewCourseLabel || ''} onChange={(e) => updateProp('viewCourseLabel', e.target.value)} placeholder={t('productPageOffer.viewCoursePlaceholder')} />
                    <p className="mt-1 text-caption text-gray-400">
                        {t('productPageOffer.viewCourseHint')}
                    </p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label className="text-xs">{t('productPageOffer.headerAlignment')}</Label>
                    <div className="mt-1 flex gap-1">
                        {(['left', 'center'] as const).map((value) => (
                            <button
                                key={value}
                                onClick={() => updateProp('align', value)}
                                className={`rounded px-2.5 py-1 text-caption font-medium ${(props.align || 'center') === value ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}
                            >
                                {optionLabel(t, value)}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <Label className="text-xs">{t('productPageOffer.headerSize')}</Label>
                    <div className="mt-1 flex gap-1">
                        {([
                            ['md', t('options.compact')],
                            ['lg', t('options.large')],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                onClick={() => updateProp('headerScale', value)}
                                className={`rounded px-2.5 py-1 text-caption font-medium ${(props.headerScale || 'lg') === value ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between">
                <Label className="text-xs">{t('productPageOffer.seeAllToggle')}</Label>
                <Switch checked={!!props.showViewAll} onCheckedChange={(c) => updateProp('showViewAll', c)} />
            </div>
            {props.showViewAll && (
                <div>
                    <Label className="text-xs">{t('productPageOffer.linkLabel')}</Label>
                    <Input className="mt-1" value={props.viewAllLabel || ''} onChange={(e) => updateProp('viewAllLabel', e.target.value)} placeholder={t('productPageOffer.seeAllPlaceholder')} />
                </div>
            )}

            <div>
                <Label className="text-xs">{t('ctaBanner.layout')}</Label>
                <div className="mt-1 grid grid-cols-2 gap-1">
                    {([
                        ['grid', t('options.grid'), t('productPageOffer.layoutGridHint')],
                        ['carousel', t('productPageOffer.layoutHorizontal'), t('productPageOffer.layoutCarouselHint')],
                    ] as const).map(([value, label, hint]) => (
                        <button
                            key={value}
                            onClick={() => updateProp('layout', value)}
                            title={hint}
                            className={`rounded px-2 py-1.5 text-caption font-medium ${(props.layout || 'grid') === value ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {(props.layout || 'grid') === 'carousel' && (
                    <p className="mt-1 text-caption text-gray-400">
                        {t('productPageOffer.carouselDescription')}
                    </p>
                )}
            </div>

            <div>
                <Label className="text-xs">{(props.layout || 'grid') === 'carousel' ? t('productPageOffer.columnsVisible') : t('columnLayout.columns')}</Label>
                <div className="mt-1 flex gap-1">
                    {[2, 3, 4].map((c) => (
                        <button key={c} onClick={() => updateProp('columns', c)}
                            className={`rounded px-3 py-1 text-caption font-medium ${(props.columns || 3) === c ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}>{c}</button>
                    ))}
                </div>
            </div>

            <div className="space-y-3 rounded border border-dashed border-gray-200 p-2">
                <p className="text-caption font-medium text-gray-500">{t('productPageOffer.browsing')}</p>

                <div>
                    <Label className="text-xs">{t('productPageOffer.coursesPerPage')}</Label>
                    <div className="mt-1 flex flex-wrap gap-1">
                        {[6, 9, 12, 24, 0].map((n) => (
                            <button
                                key={n}
                                onClick={() => updateProp('pageSize', n)}
                                className={`rounded px-2.5 py-1 text-caption font-medium ${(props.pageSize ?? 9) === n ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}
                            >
                                {n === 0 ? t('options.all') : n}
                            </button>
                        ))}
                    </div>
                    <p className="mt-1 text-caption text-gray-400">
                        {(props.pageSize ?? 9) === 0
                            ? t('productPageOffer.pageSizeAllHint')
                            : t('productPageOffer.pageSizePagedHint')}
                    </p>
                </div>

                {(props.layout || 'grid') === 'carousel' && (props.pageSize ?? 9) === 0 && (
                    <div>
                        <Label className="text-xs">{t('productPageOffer.cardsInRow')}</Label>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {[8, 12, 20, 0].map((n) => (
                                <button
                                    key={n}
                                    onClick={() => updateProp('railMaxCards', n)}
                                    className={`rounded px-2.5 py-1 text-caption font-medium ${(props.railMaxCards ?? 12) === n ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}
                                >
                                    {n === 0 ? t('options.all') : n}
                                </button>
                            ))}
                        </div>
                        <p className="mt-1 text-caption text-gray-400">
                            {(props.railMaxCards ?? 12) === 0
                                ? t('productPageOffer.railAllHint')
                                : t('productPageOffer.railCappedHint')}
                        </p>
                    </div>
                )}

                {(props.layout || 'grid') === 'carousel' && <AutoScrollControls props={props} updateProp={updateProp} />}

                <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('productPageOffer.searchBox')}</Label>
                    <Switch checked={props.showSearch !== false} onCheckedChange={(c) => updateProp('showSearch', c)} />
                </div>
                <p className="-mt-1 text-caption text-gray-400">
                    {t('productPageOffer.searchBoxHint')}
                </p>

                {/* Vertical scroll is a grid-only concern — a carousel already
                    scrolls, sideways. */}
                {(props.layout || 'grid') !== 'carousel' && (
                    <>
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">{t('productPageOffer.scrollInsideSection')}</Label>
                            <Switch checked={!!props.scrollable} onCheckedChange={(c) => updateProp('scrollable', c)} />
                        </div>
                        {props.scrollable && (
                            <div>
                                <Label className="text-xs">{t('productPageOffer.maxHeightPx')}</Label>
                                <Input
                                    className="mt-1"
                                    type="number"
                                    min={240}
                                    step={40}
                                    value={props.scrollMaxHeight ?? 640}
                                    onChange={(e) => updateProp('scrollMaxHeight', Number(e.target.value) || 640)}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="space-y-2 rounded border border-dashed border-gray-200 p-2">
                <p className="text-caption font-medium text-gray-500">{t('productPageOffer.showOnEachCard')}</p>
                {([
                    ['showImage', t('productPageOffer.previewImage')],
                    ['showChips', t('productPageOffer.levelSessionChips')],
                    ['showDescription', t('productPageOffer.shortDescription')],
                    ['showValidity', t('productPageOffer.accessPeriod')],
                    ['showPrice', t('productPageOffer.priceAndDiscount')],
                ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                        <Label className="text-xs">{label}</Label>
                        <Switch checked={props[key] !== false} onCheckedChange={(c) => updateProp(key, c)} />
                    </div>
                ))}
            </div>
        </div>
    );
};

/**
 * Catalogue-side editor for `productCourseGrid`.
 *
 * This type is inherited from the product-pages designer, where the page itself
 * IS the product context. On a catalogue page there is no such context, so the
 * learner renderer aliases it to the full institute course catalog — which is
 * why it has no "product page" field and never could. Admins reasonably expect
 * one, so the editor says so plainly and offers a one-click switch to
 * `productPageOffer`, which is the product-page-scoped component.
 */
const ProductCourseGridEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { t: tTemplates } = useTranslation('managePagesComponentTemplates');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const convertToOffer = () =>
        updateComponent(pageId, component.id, {
            type: 'productPageOffer',
            props: {
                ...(buildComponentTemplates(tTemplates).productPageOffer?.props ?? {}),
                title: props.title || '',
                columns: props.columns ?? 3,
                showPrice: props.showPrice !== false,
            },
        });

    return (
        <div className="space-y-4">
            <div className="rounded border border-warning-200 bg-warning-50 p-2 text-caption text-warning-700">
                <Trans
                    t={t}
                    i18nKey="productCourseGrid.wholeCatalogueHint"
                    components={{ strong: <strong /> }}
                />
            </div>
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={convertToOffer}>
                {t('productCourseGrid.switchToOffer')}
            </Button>

            <div>
                <Label className="text-xs">{t('header.title')}</Label>
                <Input className="mt-1" value={props.title || ''} onChange={(e) => updateProp('title', e.target.value)} placeholder={t('productCourseGrid.titlePlaceholder')} />
            </div>

            <div>
                <Label className="text-xs">{t('columnLayout.columns')}</Label>
                <div className="mt-1 flex gap-1">
                    {[2, 3, 4].map((c) => (
                        <button key={c} onClick={() => updateProp('columns', c)}
                            className={`rounded px-3 py-1 text-caption font-medium ${(props.columns || 3) === c ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}>{c}</button>
                    ))}
                </div>
            </div>

            <div className="space-y-2 rounded border border-dashed border-gray-200 p-2">
                {([
                    ['showFilters', t('productCourseGrid.filtersSidebar')],
                    ['showPrice', t('productCourseGrid.price')],
                    ['showBadge', t('productCourseGrid.badges')],
                ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                        <Label className="text-xs">{label}</Label>
                        <Switch checked={props[key] !== false} onCheckedChange={(c) => updateProp(key, c)} />
                    </div>
                ))}
            </div>

            <CatalogDiscoveryEditor component={component} pageId={pageId} updateComponent={updateComponent} />
        </div>
    );
};

/** Pick one of the institute's live enrolment invite links.
 *
 *  An invite URL can already be pasted as a plain web address — that is how the
 *  first real page was wired — but it makes the admin go and find the code in
 *  another screen first. This lists the real invitations by name and builds the
 *  canonical URL with createInviteLink, the same helper the invite screens use,
 *  so the institute's white-label learner domain is honoured instead of
 *  hardcoding one. */
const InviteLinkPicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
    const instituteId = getCurrentInstituteId();
    const { instituteDetails } = useInstituteDetailsStore();
    const { data, isLoading, isError } = useQuery({
        queryKey: ['htmlPageInviteLinks', instituteId],
        queryFn: async () => {
            const res = await authenticatedAxiosInstance.post(
                `${GET_INVITE_LIST}?instituteId=${instituteId}&pageNo=0&pageSize=100`,
                { status: ['ACTIVE'], name: '' }
            );
            return (res.data?.content ?? []) as { id: string; name: string; invite_code: string }[];
        },
        enabled: !!instituteId,
    });

    if (isLoading) return <p className="text-caption text-gray-400">Loading invite links…</p>;
    if (isError) return <p className="text-caption text-danger-600">Could not load invite links.</p>;
    if (!data?.length) {
        return (
            <p className="text-caption text-gray-500">
                No active invite links yet. Create one under Students → Invite, then come back — or
                use &quot;Web address&quot; to paste a link by hand.
            </p>
        );
    }
    return (
        <div className="space-y-1">
            {data.map((inv) => {
                const url = createInviteLink(inv.invite_code, instituteDetails?.learner_portal_base_url);
                return (
                    <button
                        key={inv.id}
                        onClick={() => onChange(url)}
                        className={`block w-full rounded border p-1.5 text-start text-caption ${
                            value === url
                                ? 'border-primary-400 bg-primary-50 text-primary-500'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                    >
                        <span className="block font-medium">{inv.name || inv.invite_code}</span>
                        <span className="font-mono text-gray-400">{inv.invite_code}</span>
                    </button>
                );
            })}
        </div>
    );
};

/* ─── HTML-page link manager ─────────────────────────────────────────────
   Wiring a pasted page's buttons previously meant editing raw HTML — the enrol
   CTAs on a real import could only be pointed at the invitation flow by hand.
   This scans the blob, lists every link with a plain-language destination,
   flags ones that go nowhere, and writes edits back STRUCTURALLY via
   DOMParser (regex rewrites of attributes created an injection once already). */

type HtmlLinkKind = 'page' | 'section' | 'url' | 'invite' | 'lead' | 'none';

interface HtmlLinkRow {
    index: number;
    tag: string;
    label: string;
    kind: HtmlLinkKind;
    value: string;
}

const HTML_LINK_HOOK_ATTRS = ['data-vacademy', 'data-route', 'data-target', 'data-audience', 'data-course'];

const parseHtmlLinks = (html: string): { rows: HtmlLinkRow[]; sectionIds: string[] } => {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const rows: HtmlLinkRow[] = [];
    const els = doc.querySelectorAll('a, button');
    els.forEach((el, index) => {
        const verb = el.getAttribute('data-vacademy');
        const href = el.getAttribute('href') || '';
        let kind: HtmlLinkKind = 'none';
        let value = '';
        if (verb === 'lead-form') { kind = 'lead'; value = el.getAttribute('data-audience') || ''; }
        else if (verb === 'scroll') { kind = 'section'; value = el.getAttribute('data-target') || ''; }
        else if (verb === 'route') { kind = 'page'; value = el.getAttribute('data-route') || ''; }
        else if (/learner-invitation-response\?/i.test(href)) { kind = 'invite'; value = href; }
        else if (/^(https?:|mailto:|tel:)/i.test(href)) { kind = 'url'; value = href; }
        else if (href.startsWith('#') && href.length > 1) { kind = 'section'; value = href.slice(1); }
        const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44);
        // Rows with no text and no action are decoration, not links to manage.
        if (label || kind !== 'none') rows.push({ index, tag: el.tagName.toLowerCase(), label: label || '(no text)', kind, value });
    });
    const sectionIds = [...doc.querySelectorAll('[id]')].map((n) => n.id).filter(Boolean);
    return { rows, sectionIds };
};

const applyHtmlLink = (html: string, index: number, kind: HtmlLinkKind, value: string): string => {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const el = doc.querySelectorAll('a, button')[index];
    if (!el) return html;
    HTML_LINK_HOOK_ATTRS.forEach((a) => el.removeAttribute(a));
    if (kind === 'page') {
        el.setAttribute('data-vacademy', 'route');
        el.setAttribute('data-route', value);
        if (el.tagName === 'A') el.setAttribute('href', value ? `${value}/` : './');
    } else if (kind === 'section') {
        el.setAttribute('data-vacademy', 'scroll');
        el.setAttribute('data-target', value);
        if (el.tagName === 'A') el.setAttribute('href', `#${value}`);
    } else if (kind === 'url') {
        if (el.tagName === 'A') el.setAttribute('href', value);
        else { el.setAttribute('data-vacademy', 'link'); el.setAttribute('data-href', value); }
    } else if (kind === 'invite') {
        // A plain absolute link: enrolment lives outside the catalogue router,
        // so the binder must NOT intercept it.
        if (el.tagName === 'A') el.setAttribute('href', value);
        else { el.setAttribute('data-vacademy', 'link'); el.setAttribute('data-href', value); }
    } else if (kind === 'lead') {
        el.setAttribute('data-vacademy', 'lead-form');
        if (value) el.setAttribute('data-audience', value);
        if (el.tagName === 'A') el.removeAttribute('href');
    } else if (el.tagName === 'A') {
        el.removeAttribute('href');
    }
    return doc.body.innerHTML;
};

const HTML_LINK_KIND_LABELS: Record<HtmlLinkKind, string> = {
    page: 'Page on this site',
    section: 'Scroll to section',
    url: 'Web address',
    invite: 'Enrol / invite link',
    lead: 'Lead form',
    none: 'No action',
};

const HtmlLinkRowEditor = ({
    row, pages, sectionIds, onApply,
}: {
    row: HtmlLinkRow;
    pages: { route: string; title?: string }[];
    sectionIds: string[];
    onApply: (kind: HtmlLinkKind, value: string) => void;
}) => {
    const [editing, setEditing] = useState(false);
    const [kind, setKind] = useState<HtmlLinkKind>(row.kind);
    const [value, setValue] = useState(row.value);
    const pageMissing = row.kind === 'page' && row.value !== '' && !pages.some((pg) => pg.route === row.value);
    const leadUnbound = row.kind === 'lead' && !row.value;
    const summary =
        row.kind === 'page' ? `→ ${row.value || 'home'}` :
        row.kind === 'section' ? `↓ #${row.value}` :
        row.kind === 'invite' ? '→ enrolment invite' :
        row.kind === 'url' ? `→ ${row.value.slice(0, 40)}` :
        row.kind === 'lead' ? '→ lead form' : 'no action';
    return (
        <div className="rounded border border-gray-200 p-2">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <p className="truncate text-caption font-medium text-gray-700">{row.label}</p>
                    <p className="truncate text-caption text-gray-400">
                        {summary}
                        {pageMissing && <span className="ms-1.5 text-warning-700">— page doesn&apos;t exist</span>}
                        {leadUnbound && <span className="ms-1.5 text-warning-700">— no campaign chosen</span>}
                    </p>
                </div>
                <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => setEditing(!editing)}>
                    {editing ? 'Close' : 'Edit'}
                </Button>
            </div>
            {editing && (
                <div className="mt-2 space-y-2 border-t pt-2">
                    <div className="flex flex-wrap gap-1">
                        {(Object.keys(HTML_LINK_KIND_LABELS) as HtmlLinkKind[]).map((k) => (
                            <button
                                key={k}
                                onClick={() => { setKind(k); setValue(''); }}
                                className={`rounded-full border px-2.5 py-0.5 text-caption ${
                                    kind === k ? 'border-primary-400 bg-primary-50 text-primary-500' : 'border-gray-200 text-gray-600'
                                }`}
                            >
                                {HTML_LINK_KIND_LABELS[k]}
                            </button>
                        ))}
                    </div>
                    {kind === 'page' && (
                        <div className="flex flex-wrap gap-1">
                            {pages.map((pg) => (
                                <button
                                    key={pg.route}
                                    onClick={() => setValue(pg.route)}
                                    className={`rounded border px-2 py-0.5 text-caption ${
                                        value === pg.route ? 'border-primary-400 bg-primary-50 text-primary-500' : 'border-gray-200 text-gray-600'
                                    }`}
                                >
                                    {pg.title || pg.route || 'home'}
                                </button>
                            ))}
                        </div>
                    )}
                    {kind === 'section' && (
                        <div className="flex flex-wrap gap-1">
                            {sectionIds.map((sid) => (
                                <button
                                    key={sid}
                                    onClick={() => setValue(sid)}
                                    className={`rounded border px-2 py-0.5 font-mono text-caption ${
                                        value === sid ? 'border-primary-400 bg-primary-50 text-primary-500' : 'border-gray-200 text-gray-600'
                                    }`}
                                >
                                    #{sid}
                                </button>
                            ))}
                        </div>
                    )}
                    {kind === 'url' && (
                        <Input
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder="https://… (any address, e.g. an invite link)"
                            className="h-7 text-caption"
                        />
                    )}
                    {kind === 'invite' && <InviteLinkPicker value={value} onChange={setValue} />}
                    {kind === 'lead' && (
                        <CampaignPicker value={value} onChange={setValue} label="Campaign" allowEmpty={false} />
                    )}
                    <Button
                        size="sm"
                        className="text-xs"
                        disabled={!value && kind !== 'none' && kind !== 'page'}
                        onClick={() => { onApply(kind, value); setEditing(false); }}
                    >
                        Apply
                    </Button>
                </div>
            )}
        </div>
    );
};

/** The whole-page paste editor. Deliberately not a canvas: an HTML page is
 *  someone else's markup and we do not pretend to understand its structure. */
const HtmlPageEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { toast } = useToast();
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    // Paste a whole document and the parts that silently disappear are the ones
    // you would blame us for: <style> is not an allowed tag, so ALL styling is
    // lost with no visible cause. Detect and offer to move it rather than
    // leaving a note the admin reads after the page looks broken.
    const html: string = props.html || '';

    // Every <a>/<button> in the pasted markup, plus the ids available to scroll
    // to. Re-parsed only when the HTML changes — this walks the whole document
    // through DOMParser, and the editor re-renders on unrelated prop edits.
    const { rows: linkRows, sectionIds } = useMemo(() => parseHtmlLinks(html), [html]);

    // Link targets for the "page" kind. Every page is offered, including
    // unpublished ones: you routinely wire up a link while the destination is
    // still a draft, and HtmlLinkRowEditor already flags a route that resolves
    // to nothing. (Contrast syncNavFromPages, which filters to published —
    // that builds the public menu, this picks a build-time target.)
    const config = useEditorStore((s) => s.config);
    const sitePages = useMemo(
        () => (config?.pages ?? []).map((p) => ({ route: p.route, title: p.title })),
        [config]
    );

    const styleBlocks = html.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) || [];
    const scriptCount = (html.match(/<script\b/gi) || []).length;
    const linkedCss = (html.match(/<link\b[^>]*stylesheet/gi) || []).length;

    const moveStylesToCss = () => {
        const extracted = styleBlocks
            .map((b) => b.replace(/<style\b[^>]*>/i, '').replace(/<\/style\s*>/i, ''))
            .join('\n');
        updateComponent(pageId, component.id, {
            props: {
                ...props,
                html: html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ''),
                css: [props.css || '', extracted].filter(Boolean).join('\n'),
            },
        });
    };

    return (
        <div className="space-y-4">
            {(styleBlocks.length > 0 || scriptCount > 0 || linkedCss > 0) && (
                <div className="space-y-2 rounded border border-warning-200 bg-warning-50 p-2.5">
                    <p className="text-caption font-medium text-warning-700">
                        {t('htmlPage.someWontRender')}
                    </p>
                    <ul className="list-disc space-y-0.5 pl-4 text-caption text-warning-700">
                        {styleBlocks.length > 0 && (
                            <li>
                                {t('htmlPage.styleBlocksLost', { count: styleBlocks.length })}
                            </li>
                        )}
                        {linkedCss > 0 && (
                            <li>
                                {t('htmlPage.linkedStylesheets', { count: linkedCss })}
                            </li>
                        )}
                        {scriptCount > 0 && (
                            <li>
                                {t('htmlPage.scriptsRemoved', { count: scriptCount })}
                            </li>
                        )}
                    </ul>
                    {styleBlocks.length > 0 && (
                        <Button size="sm" variant="outline" onClick={moveStylesToCss}>
                            {t('htmlPage.moveStylesToCss')}
                        </Button>
                    )}
                </div>
            )}
            <div className="rounded border border-primary-200 bg-primary-50 p-2 text-caption text-primary-500">
                <Trans
                    t={t}
                    i18nKey="htmlPage.pasteHint"
                    components={{ code: <code />, styletag: <code>&lt;style&gt;</code> }}
                />
            </div>
            {/* Placed ABOVE the paste fields: someone who has no page yet needs
                this before they need anywhere to paste. */}
            <details className="rounded border border-primary-200 bg-primary-50 p-2.5">
                <summary className="cursor-pointer text-caption font-medium text-primary-500">
                    {t('htmlPage.aiHelpTitle')}
                </summary>
                <ol className="mt-2 list-decimal space-y-1 ps-4 text-caption text-gray-600">
                    <li>{t('htmlPage.aiStep1')}</li>
                    <li>{t('htmlPage.aiStep2')}</li>
                    <li>{t('htmlPage.aiStep3')}</li>
                    <li>{t('htmlPage.aiStep4')}</li>
                </ol>
                <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => {
                        navigator.clipboard.writeText(HTML_PAGE_AI_PROMPT);
                        toast({
                            title: t('htmlPage.aiCopiedTitle'),
                            description: t('htmlPage.aiCopiedBody'),
                        });
                    }}
                >
                    <Copy className="me-1.5 size-3.5" />
                    {t('htmlPage.aiCopyPrompt')}
                </Button>
                <p className="mt-1.5 text-caption text-gray-400">{t('htmlPage.aiPromptHint')}</p>
            </details>

            <div>
                <Label className="text-xs">{t('htmlPage.html')}</Label>
                <Textarea
                    value={props.html || ''}
                    onChange={(e) => updateProp('html', e.target.value)}
                    rows={16}
                    className="mt-1 font-mono text-caption"
                    placeholder="<section>…</section>"
                />
            </div>
            <div>
                <Label className="text-xs">{t('htmlPage.css')}</Label>
                <Textarea
                    value={props.css || ''}
                    onChange={(e) => updateProp('css', e.target.value)}
                    rows={12}
                    className="mt-1 font-mono text-caption"
                    placeholder=".hero { background: var(--catalogue-bg); }"
                />
                <p className="mt-1 text-caption text-gray-400">
                    {t('htmlPage.cssSharedHint')}
                </p>
            </div>
            {linkRows.length > 0 && (
                <div>
                    <Label className="text-xs">Buttons &amp; links on this page ({linkRows.length})</Label>
                    <p className="mb-2 mt-0.5 text-caption text-gray-400">
                        Point each one at a page, a section, a lead form, or any web address — no
                        HTML editing needed.
                    </p>
                    <div className="space-y-1.5">
                        {linkRows.map((row) => (
                            <HtmlLinkRowEditor
                                key={`${row.index}-${row.kind}-${row.value}`}
                                row={row}
                                pages={sitePages}
                                sectionIds={sectionIds}
                                onApply={(kind, value) =>
                                    updateProp('html', applyHtmlLink(props.html || '', row.index, kind, value))
                                }
                            />
                        ))}
                    </div>
                </div>
            )}
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-caption text-gray-600">
                <p className="font-medium text-gray-700">{t('htmlPage.makingLinksWork')}</p>
                <p className="mt-1">
                    <Trans
                        t={t}
                        i18nKey="htmlPage.linksHint"
                        components={{ code: <code /> }}
                    />
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li><code>data-vacademy=&quot;route&quot; data-route=&quot;pricing&quot;</code> — {t('htmlPage.anotherPage')}</li>
                    <li><code>data-vacademy=&quot;scroll&quot; data-target=&quot;faq&quot;</code> — {t('htmlPage.scrollOnThisPage')}</li>
                    <li><code>data-vacademy=&quot;lead-form&quot; data-audience=&quot;…&quot;</code> — {t('htmlPage.openCampaignForm')}</li>
                    <li><code>data-vacademy=&quot;enrol&quot; data-course=&quot;…&quot;</code> — {t('htmlPage.openCourse')}</li>
                    <li>{t('htmlPage.externalLinks')} <code>&lt;a href=&quot;https://…&quot;&gt;</code></li>
                </ul>
            </div>
        </div>
    );
};

const HtmlBlockEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-caption text-gray-500">
                <Trans
                    t={t}
                    i18nKey="htmlBlock.hint"
                    components={{
                        code1: <code>var(--primary-500)</code>,
                        code2: <code>var(--catalogue-text-primary)</code>,
                        code3: <code>var(--catalogue-heading-font)</code>,
                    }}
                />
            </div>
            {props.prompt && (
                <div>
                    <Label className="text-xs">{t('htmlBlock.aiSectionBrief')}</Label>
                    <p className="mt-1 rounded border border-gray-200 bg-white p-2 text-caption text-gray-600">
                        {props.prompt}
                    </p>
                    <p className="mt-1 text-caption text-gray-400">
                        {t('htmlBlock.aiSectionBriefTip')}
                    </p>
                </div>
            )}
            <div>
                <Label className="text-xs">{t('htmlPage.html')}</Label>
                <Textarea
                    value={props.html || ''}
                    onChange={(e) => updateProp('html', e.target.value)}
                    rows={10}
                    className="mt-1 font-mono text-caption"
                    placeholder="<section class='my-band'>…</section>"
                />
            </div>
            <div>
                <Label className="text-xs">{t('htmlBlock.cssScoped')}</Label>
                <Textarea
                    value={props.css || ''}
                    onChange={(e) => updateProp('css', e.target.value)}
                    rows={8}
                    className="mt-1 font-mono text-caption"
                    placeholder=".my-band { background: var(--primary-50); }"
                />
            </div>
        </div>
    );
};

/**
 * Curated course strip. `productCourseGrid` always renders the WHOLE catalogue
 * with filters; this one shows a chosen few, so the only real decisions are
 * where the courses come from and how many.
 */
const CourseShowcaseEditor = ({ component, pageId, updateComponent }: any) => {
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const courseLower = courseTerm.toLocaleLowerCase();
    const coursesTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const coursesLower = coursesTerm.toLocaleLowerCase();
    const SOURCES: Array<{ id: string; label: string; hint: string }> = [
        { id: 'newest', label: 'Newest', hint: `The most recently created ${coursesLower}.` },
        {
            id: 'onSale',
            label: 'On sale',
            hint: `Only ${coursesLower} with a discount (a struck-through price).`,
        },
        { id: 'tag', label: 'By tag', hint: `${coursesTerm} carrying the tag you type below.` },
        {
            id: 'picked',
            label: 'Hand-picked',
            hint: `Exactly the ${courseLower} IDs you list, in that order.`,
        },
        {
            id: 'comingSoon',
            label: 'Coming soon',
            hint: `Every ${courseLower} switched to Coming Soon (on the ${courseLower} page). They show a ribbon and a Notify me button that collects leads; a ${courseLower} drops out of this strip by itself once it goes live.`,
        },
    ];
    const source = props.source || 'newest';
    const { getCourseFromPackage } = useInstituteDetailsStore();
    const allCourses = getCourseFromPackage();

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label className="text-xs">Title</Label>
                <Input value={props.title || ''} placeholder="Hot right now"
                    onChange={(e) => updateProp('title', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label className="text-xs">Subtitle</Label>
                <Input value={props.subtitle || ''} placeholder="Optional line under the title"
                    onChange={(e) => updateProp('subtitle', e.target.value)} />
            </div>

            <div>
                <Label className="text-xs">Which {coursesLower}</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                    {SOURCES.map((s) => (
                        <button key={s.id} onClick={() => updateProp('source', s.id)}
                            className={`rounded px-2.5 py-1 text-caption font-medium ${source === s.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {s.label}
                        </button>
                    ))}
                </div>
                <p className="mt-1 text-caption text-gray-400">
                    {SOURCES.find((s) => s.id === source)?.hint}
                </p>
            </div>

            {source === 'tag' && (
                <div className="space-y-2">
                    <Label className="text-xs">Tag</Label>
                    <Input value={props.tag || ''} placeholder="e.g. 2 year old"
                        onChange={(e) => updateProp('tag', e.target.value)} />
                    <p className="text-caption text-gray-400">
                        Must match the {courseLower}&apos;s tag exactly (capitalisation is ignored).
                    </p>
                </div>
            )}

            {source === 'picked' && (
                <div className="space-y-2">
                    <Label className="text-xs">{coursesTerm}</Label>
                    {(props.courseIds || []).map((id: string, i: number) => {
                        const badges = props.courseBadges || {};
                        // Picked by name from the institute's courses (the package
                        // id is what the catalogue's cards carry); a course picked on
                        // another row is not offered twice. An id no longer among the
                        // institute's courses stays listed under its id, or the row
                        // would render blank and the next pick would silently move it.
                        const taken = new Set(
                            (props.courseIds || []).filter((x: string, j: number) => j !== i && x)
                        );
                        const options: SearchableSelectOption[] = allCourses
                            .filter((c) => !taken.has(c.id))
                            .map((c) => ({ label: c.name, value: c.id }));
                        if (id && !allCourses.some((c) => c.id === id)) {
                            options.unshift({ label: id, value: id });
                        }
                        // A keystroke that leaves the id as it was (a space, trimmed
                        // away) writes nothing; courseBadges is only written when a
                        // ribbon really moves to the new id.
                        const setId = (next: string) => {
                            const ids = [...(props.courseIds || [])];
                            const prevId = ids[i];
                            if (next === prevId) return;
                            ids[i] = next;
                            // '' is a real key here: clearing the field moves the ribbon to ''.
                            if (prevId === undefined || badges[prevId] === undefined) {
                                updateProp('courseIds', ids);
                                return;
                            }
                            const nextBadges = { ...badges, [next]: badges[prevId] };
                            delete nextBadges[prevId];
                            updateComponent(pageId, component.id, {
                                props: { ...props, courseIds: ids, courseBadges: nextBadges },
                            });
                        };
                        const setBadge = (patch: Record<string, unknown>) =>
                            updateComponent(pageId, component.id, {
                                props: { ...props, courseBadges: { ...badges, [id]: { ...(badges[id] || {}), ...patch } } },
                            });
                        return (
                            <div key={i} className="space-y-1 rounded border border-gray-100 p-2">
                                <div className="flex items-center gap-1">
                                    <div className="min-w-0 flex-1">
                                        <SearchableSelect
                                            options={options}
                                            value={id}
                                            onChange={(v) => setId(v.trim())}
                                            placeholder={`Choose a ${courseLower}`}
                                            searchPlaceholder={`Search ${coursesLower}…`}
                                            emptyText={`No ${coursesLower} found`}
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            const ids = (props.courseIds || []).filter((_: string, j: number) => j !== i);
                                            if (!badges[id]) {
                                                updateProp('courseIds', ids);
                                                return;
                                            }
                                            const nextBadges = { ...badges };
                                            delete nextBadges[id];
                                            updateComponent(pageId, component.id, {
                                                props: { ...props, courseIds: ids, courseBadges: nextBadges },
                                            });
                                        }}
                                        className="rounded px-2 text-caption text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                                        Remove
                                    </button>
                                </div>
                                <div className="flex gap-1">
                                    <Input
                                        value={badges[id]?.text || ''}
                                        placeholder={`ribbon for this ${courseLower} (optional)`}
                                        onChange={(e) => setBadge({ text: e.target.value })}
                                    />
                                    <select value={badges[id]?.tone || 'hot'}
                                        onChange={(e) => setBadge({ tone: e.target.value })}
                                        className="rounded border border-gray-200 px-1 text-caption text-gray-600">
                                        <option value="hot">Red</option>
                                        <option value="new">Green</option>
                                        <option value="limited">Amber</option>
                                        <option value="neutral">Dark</option>
                                    </select>
                                </div>
                            </div>
                        );
                    })}
                    <Button size="sm" variant="outline"
                        onClick={() => updateProp('courseIds', [...(props.courseIds || []), ''])}>
                        Add a {courseLower}
                    </Button>
                    <p className="text-caption text-gray-400">
                        Shown in this order. A per-{courseLower} ribbon overrides the section ribbon
                        below.
                    </p>
                </div>
            )}

            <div>
                <Label className="text-xs">How many to show</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                    {[2, 3, 4, 6, 8].map((n) => (
                        <button key={n} onClick={() => updateProp('limit', n)}
                            className={`rounded px-2.5 py-1 text-caption font-medium ${(props.limit || 3) === n ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{n}</button>
                    ))}
                </div>
            </div>

            <div>
                <Label className="text-xs">Layout</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                    {[{ id: 'row', label: '3 across' }, { id: 'grid', label: '4 across' }].map((l) => (
                        <button key={l.id} onClick={() => updateProp('layout', l.id)}
                            className={`rounded px-2.5 py-1 text-caption font-medium ${(props.layout || 'row') === l.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{l.label}</button>
                    ))}
                </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
                <Label className="text-xs">Ribbon (optional)</Label>
                <p className="mt-0.5 text-caption text-gray-400">
                    Shown on the top-right of every card, opposite the discount badge.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                    {[
                        { text: 'Hot', tone: 'hot' },
                        { text: 'Latest', tone: 'new' },
                        { text: 'Limited', tone: 'limited' },
                        { text: 'Fast-track', tone: 'neutral' },
                    ].map((preset) => (
                        <button key={preset.text}
                            onClick={() => updateComponent(pageId, component.id, {
                                props: { ...props, badgeText: preset.text, badgeTone: preset.tone },
                            })}
                            className={`rounded px-2.5 py-1 text-caption font-medium ${props.badgeText === preset.text ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {preset.text}
                        </button>
                    ))}
                    {props.badgeText ? (
                        <button onClick={() => updateProp('badgeText', '')}
                            className="rounded px-2.5 py-1 text-caption font-medium text-gray-500 hover:bg-gray-100">
                            Clear
                        </button>
                    ) : null}
                </div>
                <Input className="mt-2" value={props.badgeText || ''}
                    placeholder="Or type your own — e.g. Only 5 seats"
                    onChange={(e) => updateProp('badgeText', e.target.value)} />
                {props.badgeText ? (
                    <div className="mt-2">
                        <Label className="text-xs">Ribbon colour</Label>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {[
                                { id: 'hot', label: 'Red' },
                                { id: 'new', label: 'Green' },
                                { id: 'limited', label: 'Amber' },
                                { id: 'neutral', label: 'Dark' },
                            ].map((tone) => (
                                <button key={tone.id} onClick={() => updateProp('badgeTone', tone.id)}
                                    className={`rounded px-2.5 py-1 text-caption font-medium ${(props.badgeTone || 'hot') === tone.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {tone.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>

            <p className="rounded bg-gray-50 px-2 py-1.5 text-caption text-gray-500">
                Prices, discount badges and images come live from the {courseLower} catalogue —
                nothing to keep in sync here. An empty result hides the whole section.
            </p>
        </div>
    );
};

const SpacerEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <div>
                <Label className="text-xs">{t('spacer.height')}</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                    {['16px', '24px', '32px', '48px', '64px', '80px', '120px'].map((v) => (
                        <button key={v} onClick={() => updateProp('height', v)}
                            className={`rounded px-2 py-1 text-caption font-medium ${props.height === v ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{v}</button>
                    ))}
                </div>
            </div>
            <div className="flex items-center justify-between">
                <Label className="text-xs">{t('spacer.showDivider')}</Label>
                <Switch checked={props.showDivider || false} onCheckedChange={(c) => updateProp('showDivider', c)} />
            </div>
            {props.showDivider && (
                <>
                    <div>
                        <Label className="text-xs">{t('spacer.dividerStyle')}</Label>
                        <div className="flex gap-1 mt-1">
                            {['solid', 'dashed', 'dotted'].map((s) => (
                                <button key={s} onClick={() => updateProp('dividerStyle', s)}
                                    className={`rounded px-2 py-1 text-caption font-medium capitalize ${props.dividerStyle === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, s)}</button>
                            ))}
                        </div>
                    </div>
                    <ColorPickerField label={t('spacer.dividerColor')} value={props.dividerColor || '#E5E7EB' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('dividerColor', c)} />
                    <div>
                        <Label className="text-xs">{t('spacer.dividerWidth')}</Label>
                        <div className="flex gap-1 mt-1">
                            {['1px', '2px', '3px', '4px'].map((w) => (
                                <button key={w} onClick={() => updateProp('dividerWidth', w)}
                                    className={`rounded px-2 py-1 text-caption font-medium ${props.dividerWidth === w ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{w}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <Label className="text-xs">{t('spacer.maxWidth')}</Label>
                        <div className="flex gap-1 mt-1">
                            {['40%', '60%', '80%', '100%'].map((w) => (
                                <button key={w} onClick={() => updateProp('maxWidth', w)}
                                    className={`rounded px-2 py-1 text-caption font-medium ${props.maxWidth === w ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{w}</button>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

/* ─── Tabs / Accordion Editor ──────────────────────────────────────────── */
const TabsAccordionEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const items = props.items || [];
    const [expandedItem, setExpandedItem] = useState<number | null>(null);

    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addItem = () => updateProp('items', [...items, { title: t('tabsAccordion.itemN', { n: items.length + 1 }), content: t('tabsAccordion.defaults.content') }]);
    const deleteItem = (i: number) => { updateProp('items', items.filter((_: any, idx: number) => idx !== i)); if (expandedItem === i) setExpandedItem(null); };
    const updateItem = (i: number, field: string, value: any) => {
        const newItems = [...items];
        newItems[i] = { ...newItems[i], [field]: value };
        updateProp('items', newItems);
    };

    return (
        <div className="space-y-4">
            <div>
                <Label className="text-xs">{t('global.theme.mode')}</Label>
                <div className="flex gap-1 mt-1">
                    {['tabs', 'accordion'].map((m) => (
                        <button key={m} onClick={() => updateProp('mode', m)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.mode === m ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, m)}</button>
                    ))}
                </div>
            </div>
            {props.mode === 'accordion' && (
                <>
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">{t('tabsAccordion.allowMultipleOpen')}</Label>
                        <Switch checked={props.allowMultiple || false} onCheckedChange={(c) => updateProp('allowMultiple', c)} />
                    </div>
                    <div>
                        <Label className="text-xs">{t('tabsAccordion.accordionStyle')}</Label>
                        <div className="flex gap-1 mt-1">
                            {[
                                { key: 'plain', label: optionLabel(t, 'plain') },
                                { key: 'boxed', label: t('tabsAccordion.styleBoxed') },
                                { key: 'split', label: t('tabsAccordion.styleSplitPanel') },
                            ].map((v) => (
                                <button key={v.key} onClick={() => updateProp('variant', v.key)}
                                    className={`rounded px-3 py-1 text-caption font-medium ${(props.variant || 'plain') === v.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{v.label}</button>
                            ))}
                        </div>
                        {(props.variant || 'plain') === 'split' && (
                            <p className="mt-1 text-caption text-gray-400">
                                {t('tabsAccordion.splitHint')}
                            </p>
                        )}
                    </div>
                </>
            )}
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#FFFFFF' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
            <div>
                <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium">{t('tabsAccordion.itemsCount', { count: items.length })}</Label>
                    <Button variant="ghost" size="sm" onClick={addItem} className="h-6 text-xs"><Plus className="size-3 me-1" /> {t('actions.add')}</Button>
                </div>
                <div className="space-y-2">
                    {items.map((item: any, i: number) => (
                        <div key={i} className="rounded border bg-gray-50 p-2 space-y-2">
                            <div className="flex items-center justify-between">
                                <button onClick={() => setExpandedItem(expandedItem === i ? null : i)} className="text-xs font-medium text-left flex-1">
                                    {item.title || t('tabsAccordion.itemN', { n: i + 1 })}
                                </button>
                                <Button variant="ghost" size="sm" onClick={() => deleteItem(i)} className="size-6 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                            </div>
                            {expandedItem === i && (
                                <div className="space-y-2">
                                    <Input value={item.title || ''} onChange={(e) => updateItem(i, 'title', e.target.value)} placeholder={t('header.title')} />
                                    <div className="flex gap-2">
                                        <Input className="flex-1" value={item.icon || ''} onChange={(e) => updateItem(i, 'icon', e.target.value)} placeholder={t('tabsAccordion.iconPlaceholder')} />
                                        <Input className="flex-1" value={item.meta || ''} onChange={(e) => updateItem(i, 'meta', e.target.value)} placeholder={t('tabsAccordion.metaPlaceholder')} />
                                    </div>
                                    <RichTextField label={t('tabsAccordion.content')} value={item.content || ''} onChange={(html) => updateItem(i, 'content', html)} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ─── Trust Chip Editor ────────────────────────────────────────────────── */
const TrustChipEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    const avatars: string[] = props.avatars || [];

    return (
        <div className="space-y-4">
            <Input
                value={props.text || ''}
                onChange={(e) => updateProp('text', e.target.value)}
                placeholder={t('trustChip.textPlaceholder')}
            />
            <div className="flex items-center gap-3">
                <Label className="text-xs">{t('hero.ratingLabel')}</Label>
                <Input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    className="w-24"
                    value={props.rating ?? 0}
                    onChange={(e) => {
                        const r = Math.min(5, Math.max(0, Number(e.target.value) || 0));
                        updateProp('rating', r > 0 ? r : undefined);
                    }}
                />
            </div>
            <div>
                <Label className="text-xs">{t('trustChip.alignment')}</Label>
                <div className="flex gap-1 mt-1">
                    {['left', 'center', 'right'].map((a) => (
                        <button key={a} onClick={() => updateProp('alignment', a)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${(props.alignment || 'center') === a ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, a)}</button>
                    ))}
                </div>
            </div>
            <div>
                <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium">{t('trustChip.avatarsCount', { count: avatars.length })}</Label>
                    <Button variant="ghost" size="sm" disabled={avatars.length >= 4} onClick={() => updateProp('avatars', [...avatars, ''])} className="h-6 text-xs"><Plus className="size-3 me-1" /> {t('actions.add')}</Button>
                </div>
                <div className="space-y-2">
                    {avatars.map((src: string, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                            <div className="flex-1">
                                <ImageUploadField slot="avatar" label="" value={src} onChange={(url) => {
                                    const next = [...avatars];
                                    next[i] = url;
                                    updateProp('avatars', next);
                                }} />
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => updateProp('avatars', avatars.filter((_: string, j: number) => j !== i))} className="size-6 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ─── Section Heading Editor ───────────────────────────────────────────── */
const SectionHeadingEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <div>
                <Label className="text-xs">{t('sectionHeading.eyebrow')}</Label>
                <Input value={props.eyebrow || ''} onChange={(e) => updateProp('eyebrow', e.target.value || undefined)} placeholder={t('sectionHeading.eyebrowPlaceholder')} />
            </div>
            <div>
                <Label className="text-xs">{t('header.title')}</Label>
                <Input value={props.title || ''} onChange={(e) => updateProp('title', e.target.value)} placeholder={t('sectionHeading.titlePlaceholder')} />
            </div>
            <div className="rounded border bg-gray-50 p-3 space-y-2">
                <Label className="text-xs font-medium">{t('sectionHeading.highlightPhrase')}</Label>
                <Input
                    value={props.highlight?.text || ''}
                    onChange={(e) =>
                        updateProp(
                            'highlight',
                            e.target.value
                                ? { ...(props.highlight || {}), text: e.target.value, style: props.highlight?.style || 'gradient' }
                                : undefined,
                        )
                    }
                    placeholder={t('sectionHeading.highlightPlaceholder')}
                />
                {props.highlight?.text && (
                    <div className="flex gap-1">
                        {['gradient', 'underline', 'mark'].map((s) => (
                            <button
                                key={s}
                                onClick={() => updateProp('highlight', { ...props.highlight, style: s })}
                                className={`rounded px-3 py-1 text-caption font-medium capitalize ${(props.highlight?.style || 'gradient') === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                            >
                                {optionLabel(t, s)}
                            </button>
                        ))}
                    </div>
                )}
                {props.highlight?.text && !(typeof props.title === 'string' && props.title.includes(props.highlight.text)) && (
                    <p className="text-caption text-warning-600">{t('sectionHeading.highlightNotFound')}</p>
                )}
            </div>
            <div>
                <Label className="text-xs">{t('sectionHeading.lead')}</Label>
                <Textarea value={props.lead || ''} onChange={(e) => updateProp('lead', e.target.value || undefined)} rows={2} placeholder={t('sectionHeading.leadPlaceholder')} />
            </div>
            <div>
                <Label className="text-xs">{t('trustChip.alignment')}</Label>
                <div className="flex gap-1 mt-1">
                    {['center', 'left'].map((a) => (
                        <button key={a} onClick={() => updateProp('align', a === 'center' ? undefined : a)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${(props.align || 'center') === a ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, a)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('stats.style')}</Label>
                <div className="flex gap-1 mt-1">
                    {['md', 'lg', 'xl'].map((s) => (
                        <button key={s} onClick={() => updateProp('size', s === 'lg' ? undefined : s)}
                            className={`rounded px-3 py-1 text-caption font-medium uppercase ${(props.size || 'lg') === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, s)}</button>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ─── Logo Cloud Editor ────────────────────────────────────────────────── */
const LogoCloudEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const logos = props.logos || [];

    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addLogo = () => updateProp('logos', [...logos, { image: '', alt: t('logoCloud.logoN', { n: logos.length + 1 }), url: '' }]);
    const deleteLogo = (i: number) => updateProp('logos', logos.filter((_: any, idx: number) => idx !== i));
    const updateLogo = (i: number, field: string, value: any) => {
        const newLogos = [...logos];
        newLogos[i] = { ...newLogos[i], [field]: value };
        updateProp('logos', newLogos);
    };

    return (
        <div className="space-y-4">
            <Input value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} placeholder={t('logoCloud.headerTextPlaceholder')} />
            <Input value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} placeholder={t('faq.subheading')} />
            <div>
                <Label className="text-xs">{t('ctaBanner.layout')}</Label>
                <div className="flex gap-1 mt-1">
                    {['grid', 'marquee'].map((l) => (
                        <button key={l} onClick={() => updateProp('layout', l)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.layout === l ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, l)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('columnLayout.columns')}</Label>
                <div className="flex gap-1 mt-1">
                    {[3, 4, 5, 6].map((c) => (
                        <button key={c} onClick={() => updateProp('columns', c)}
                            className={`rounded px-3 py-1 text-caption font-medium ${props.columns === c ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{c}</button>
                    ))}
                </div>
            </div>
            <div className="flex items-center justify-between">
                <Label className="text-xs">{t('logoCloud.grayscale')}</Label>
                <Switch checked={props.grayscale !== false} onCheckedChange={(c) => updateProp('grayscale', c)} />
            </div>
            <div>
                <Label className="text-xs">{t('logoCloud.display')}</Label>
                <div className="flex gap-1 mt-1">
                    {[
                        { key: 'logo', label: optionLabel(t, 'logo') },
                        { key: 'logo+label', label: t('logoCloud.displayLogoLabel') },
                        { key: 'label-pill', label: t('logoCloud.displayLabelPills') },
                    ].map((d) => (
                        <button key={d.key} onClick={() => updateProp('display', d.key)}
                            className={`rounded px-3 py-1 text-caption font-medium ${(props.display || 'logo') === d.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{d.label}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('logoCloud.tile')}</Label>
                <div className="flex gap-1 mt-1">
                    {['none', 'card', 'pill'].map((tl) => (
                        <button key={tl} onClick={() => updateProp('tile', tl)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${(props.tile || 'none') === tl ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, tl)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('logoCloud.logoHeight')}</Label>
                <div className="flex gap-1 mt-1">
                    {['sm', 'md', 'lg'].map((h) => (
                        <button key={h} onClick={() => updateProp('logoHeight', h)}
                            className={`rounded px-3 py-1 text-caption font-medium uppercase ${(props.logoHeight || 'md') === h ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, h)}</button>
                    ))}
                </div>
            </div>
            {props.layout === 'marquee' && (
                <div>
                    <Label className="text-xs">{t('logoCloud.marqueeSpeed')}</Label>
                    <div className="flex gap-1 mt-1">
                        {['slow', 'medium', 'fast'].map((sp) => (
                            <button key={sp} onClick={() => updateProp('marqueeSpeed', sp)}
                                className={`rounded px-3 py-1 text-caption font-medium capitalize ${(props.marqueeSpeed || 'medium') === sp ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, sp)}</button>
                        ))}
                    </div>
                </div>
            )}
            {props.display === 'label-pill' ? (
                // Text ticker (no images) — fast add/edit of sliding points.
                <div>
                    <Label className="text-xs font-medium">{t('logoCloud.tickerItemsCount', { count: logos.length })}</Label>
                    <p className="mb-1 text-caption text-gray-400">{t('logoCloud.tickerHint')}</p>
                    <ListField
                        value={logos.map((l: any) => l.label).filter((s: any) => s != null)}
                        onCommit={(items) => updateProp('logos', items.map((label: string) => ({ label })))}
                        separator="newline"
                        placeholder={t('logoCloud.tickerPlaceholder')}
                        rows={5}
                    />
                </div>
            ) : (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs font-medium">{t('logoCloud.logosCount', { count: logos.length })}</Label>
                        <Button variant="ghost" size="sm" onClick={addLogo} className="h-6 text-xs"><Plus className="size-3 me-1" /> {t('actions.add')}</Button>
                    </div>
                    <div className="space-y-2">
                        {logos.map((logo: any, i: number) => (
                            <div key={i} className="rounded border bg-gray-50 p-2 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium">{t('logoCloud.logoN', { n: i + 1 })}</span>
                                    <Button variant="ghost" size="sm" onClick={() => deleteLogo(i)} className="size-6 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                                </div>
                                <ImageUploadField slot="logo" label={t('hero.imageField')} value={logo.image || ''} onChange={(url) => updateLogo(i, 'image', url)} aiKind="logo" />
                                <Input placeholder={t('hero.altTextPlaceholder')} value={logo.alt || ''} onChange={(e) => updateLogo(i, 'alt', e.target.value)} />
                                <Input placeholder={t('logoCloud.labelPlaceholder')} value={logo.label || ''} onChange={(e) => updateLogo(i, 'label', e.target.value)} />
                                <Input placeholder={t('logoCloud.linkUrlPlaceholder')} value={logo.url || ''} onChange={(e) => updateLogo(i, 'url', e.target.value)} />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

/* ─── Map Embed Editor ─────────────────────────────────────────────────── */
const MapEmbedEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <div>
                <Label className="text-xs">{t('header.title')}</Label>
                <Input value={props.title || ''} onChange={(e) => updateProp('title', e.target.value)} placeholder={t('mapEmbed.titlePlaceholder')} />
            </div>
            <div>
                <Label className="text-xs">{t('mapEmbed.embedUrl')}</Label>
                <Textarea value={props.embedUrl || ''} onChange={(e) => updateProp('embedUrl', e.target.value)} placeholder="https://www.google.com/maps/embed?pb=..." rows={3} />
            </div>
            <div>
                <Label className="text-xs">{t('spacer.height')}</Label>
                <div className="flex gap-1 mt-1">
                    {['300px', '400px', '500px', '600px'].map((h) => (
                        <button key={h} onClick={() => updateProp('height', h)}
                            className={`rounded px-2 py-1 text-caption font-medium ${props.height === h ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{h}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('mapEmbed.borderRadius')}</Label>
                <div className="flex gap-1 mt-1">
                    {['0', '4px', '8px', '16px', '24px'].map((r) => (
                        <button key={r} onClick={() => updateProp('borderRadius', r)}
                            className={`rounded px-2 py-1 text-caption font-medium ${props.borderRadius === r ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{r || '0'}</button>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ─── Countdown Timer Editor ───────────────────────────────────────────── */
const CountdownTimerEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <div>
                <Label className="text-xs">{t('ctaBanner.headingField')}</Label>
                <Input value={props.heading || ''} onChange={(e) => updateProp('heading', e.target.value)} placeholder={t('countdown.headingPlaceholder')} />
            </div>
            <div>
                <Label className="text-xs">{t('countdown.targetDate')}</Label>
                <Input type="datetime-local" value={props.targetDate || ''} onChange={(e) => updateProp('targetDate', e.target.value)} />
            </div>
            <div>
                <Label className="text-xs">{t('countdown.expiredMessage')}</Label>
                <Input value={props.expiredMessage || ''} onChange={(e) => updateProp('expiredMessage', e.target.value)} placeholder={t('countdown.expiredMessagePlaceholder')} />
            </div>
            <div>
                <Label className="text-xs">{t('stats.style')}</Label>
                <div className="flex gap-1 mt-1">
                    {['cards', 'minimal'].map((s) => (
                        <button key={s} onClick={() => updateProp('style', s)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.style === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, s)}</button>
                    ))}
                </div>
            </div>
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#1E293B' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
            <ColorPickerField label={t('header.textColor')} value={props.textColor || '#FFFFFF' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('textColor', c)} />
        </div>
    );
};

/* ─── Text Block Editor ────────────────────────────────────────────────── */
const TextBlockEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <RichTextField
                label={t('tabsAccordion.content')}
                value={props.content || ''}
                onChange={(html) => updateProp('content', html)}
            />
            <div>
                <Label className="text-xs">{t('spacer.maxWidth')}</Label>
                <div className="flex gap-1 mt-1">
                    {['600px', '800px', '1000px', '100%'].map((w) => (
                        <button key={w} onClick={() => updateProp('maxWidth', w)}
                            className={`rounded px-2 py-1 text-caption font-medium ${props.maxWidth === w ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{w}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('trustChip.alignment')}</Label>
                <div className="flex gap-1 mt-1">
                    {['left', 'center', 'right'].map((a) => (
                        <button key={a} onClick={() => updateProp('alignment', a)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.alignment === a ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, a)}</button>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ─── List Field (raw-buffer editor for string[] props) ────────────────── */
/* Parsing on every keystroke resets the input to the normalized join — a
   trailing comma/newline/space gets stripped before the next item can be
   typed. Buffer the raw text locally and commit the parsed array on blur. */
const ListField = ({
    value,
    onCommit,
    separator,
    placeholder,
    rows,
}: {
    value: string[] | undefined;
    onCommit: (items: string[]) => void;
    separator: 'comma' | 'newline';
    placeholder?: string;
    rows?: number;
}) => {
    const sep = separator === 'comma' ? ', ' : '\n';
    const joined = (value || []).join(sep);
    const [raw, setRaw] = useState<string | null>(null);
    const commit = () => {
        const text = raw ?? joined;
        const items = text
            .split(separator === 'comma' ? ',' : '\n')
            .map((s) => s.trim())
            .filter(Boolean);
        onCommit(items);
        setRaw(null);
    };
    const shared = {
        value: raw ?? joined,
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setRaw(e.target.value),
        onBlur: commit,
        placeholder,
    };
    return separator === 'comma' ? <Input {...shared} /> : <Textarea {...shared} rows={rows ?? 3} />;
};

/* ─── Feature Grid Editor ──────────────────────────────────────────────── */
/**
 * Editor for `detailBlocks`.
 *
 * A fully-populated block is ~1 title + 1 description + 6 items × 2 fields +
 * 4 specs × 2 fields, so eight programmes would be ~160 inputs. Items and specs
 * are therefore edited as BULK TEXT (one per line) and parsed, which is also how
 * an admin naturally has this content to hand — pasted from a prospectus.
 *
 * Without this editor the component would be permanently uneditable by a human:
 * GenericEditor only renders string/number/boolean props, so array props get no
 * UI at all.
 */
const DetailBlocksEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const blocks: any[] = Array.isArray(props.blocks) ? props.blocks : [];
    const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    const setBlocks = (next: any[]) => updateProp('blocks', next);
    const updateBlock = (i: number, key: string, value: any) =>
        setBlocks(blocks.map((b, idx) => (idx === i ? { ...b, [key]: value } : b)));

    const addBlock = () =>
        setBlocks([...blocks, { title: t('detailBlocks.defaults.newProgram'), tag: '', description: '', items: [], specs: [] }]);
    const deleteBlock = (i: number) => {
        setBlocks(blocks.filter((_, idx) => idx !== i));
        if (expandedIdx === i) setExpandedIdx(null);
    };
    const moveBlock = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= blocks.length) return;
        const next = [...blocks];
        [next[i], next[j]] = [next[j], next[i]];
        setBlocks(next);
        setExpandedIdx(j);
    };

    // "Title — Description" per line. Accepts em dash, en dash or a pipe so a
    // paste from a doc or a spreadsheet both work.
    const itemsToText = (items: any[]) =>
        (items || []).map((it) => (it?.description ? `${it.title} — ${it.description}` : it?.title || '')).join('\n');
    const textToItems = (text: string) =>
        text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const m = line.match(/^(.*?)\s*[—–|]\s*(.*)$/);
                return m ? { title: m[1]!.trim(), description: m[2]!.trim() } : { title: line };
            });

    // "Label: Value" per line — split on the FIRST colon only, so values
    // containing colons survive.
    const specsToText = (specs: any[]) =>
        (specs || []).map((s) => `${s?.label || ''}: ${s?.value || ''}`).join('\n');
    const textToSpecs = (text: string) =>
        text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const idx = line.indexOf(':');
                return idx === -1
                    ? { label: line, value: '' }
                    : { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
            });

    const pill = (active: boolean) =>
        `rounded px-2.5 py-1 text-caption font-medium ${active ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`;

    return (
        <div className="space-y-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-caption text-gray-500">
                {t('detailBlocks.hint')}
            </div>

            <div>
                <Label className="text-xs">{t('detailBlocks.sectionHeading')}</Label>
                <Input className="mt-1" value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} placeholder={t('detailBlocks.optional')} />
            </div>
            <div>
                <Label className="text-xs">{t('detailBlocks.sectionSubheading')}</Label>
                <Textarea className="mt-1" rows={2} value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} placeholder={t('detailBlocks.optional')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label className="text-xs">{t('detailBlocks.detailColumns')}</Label>
                    <div className="mt-1 flex gap-1">
                        {[1, 2, 3].map((c) => (
                            <button key={c} onClick={() => updateProp('columns', c)} className={pill((props.columns ?? 3) === c)}>{c}</button>
                        ))}
                    </div>
                </div>
                <div>
                    <Label className="text-xs">{t('detailBlocks.specColumns')}</Label>
                    <div className="mt-1 flex gap-1">
                        {[2, 3, 4].map((c) => (
                            <button key={c} onClick={() => updateProp('specColumns', c)} className={pill((props.specColumns ?? 4) === c)}>{c}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('detailBlocks.blocksCount', { count: blocks.length })}</Label>
                    <Button variant="outline" size="sm" className="h-7 text-caption" onClick={addBlock}>+ {t('detailBlocks.addBlock')}</Button>
                </div>

                {blocks.map((b, i) => (
                    <div key={i} className="rounded border border-gray-200">
                        <div className="flex items-center gap-1 bg-gray-50 px-2 py-1.5">
                            <button onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} className="flex-1 truncate text-left text-xs font-medium">
                                {b?.title || t('detailBlocks.blockN', { n: i + 1 })}
                            </button>
                            <Button variant="ghost" size="sm" className="size-6 p-0" disabled={i === 0} onClick={() => moveBlock(i, -1)} title={t('actions.moveUp')}>↑</Button>
                            <Button variant="ghost" size="sm" className="size-6 p-0" disabled={i === blocks.length - 1} onClick={() => moveBlock(i, 1)} title={t('actions.moveDown')}>↓</Button>
                            <Button variant="ghost" size="sm" className="size-6 p-0 text-danger-600" onClick={() => deleteBlock(i)} title={t('actions.delete')}>×</Button>
                        </div>

                        {expandedIdx === i && (
                            <div className="space-y-3 p-2">
                                <div>
                                    <Label className="text-xs">{t('header.title')}</Label>
                                    <Input className="mt-1" value={b?.title || ''} onChange={(e) => updateBlock(i, 'title', e.target.value)} />
                                </div>
                                <div>
                                    <Label className="text-xs">{t('detailBlocks.tagEyebrow')}</Label>
                                    <Input className="mt-1" value={b?.tag || ''} onChange={(e) => updateBlock(i, 'tag', e.target.value)} placeholder={t('detailBlocks.flagshipProgramPlaceholder')} />
                                </div>
                                <div>
                                    <Label className="text-xs">{t('mediaShowcase.description')}</Label>
                                    <Textarea className="mt-1" rows={3} value={b?.description || ''} onChange={(e) => updateBlock(i, 'description', e.target.value)} />
                                </div>

                                <div>
                                    <Label className="text-xs">{t('detailBlocks.headerStyle')}</Label>
                                    <div className="mt-1 flex gap-1">
                                        {(['subtle', 'tint', 'solid'] as const).map((v) => (
                                            <button key={v} onClick={() => updateBlock(i, 'headerVariant', v)} className={pill((b?.headerVariant || 'subtle') === v)}>{optionLabel(t, v)}</button>
                                        ))}
                                    </div>
                                    <p className="mt-1 text-caption text-gray-400">{t('detailBlocks.headerStyleHint')}</p>
                                </div>

                                <div>
                                    <Label className="text-xs">{t('detailBlocks.detailItemsLabel')}</Label>
                                    <Textarea
                                        className="mt-1 font-mono text-caption"
                                        rows={6}
                                        value={itemsToText(b?.items)}
                                        onChange={(e) => updateBlock(i, 'items', textToItems(e.target.value))}
                                        placeholder={'Complete Syllabus Coverage — Every topic with structured notes\n200+ Test Series — Topic, subject and full-length mocks'}
                                    />
                                </div>

                                <div>
                                    <Label className="text-xs">{t('detailBlocks.specsLabel')}</Label>
                                    <Textarea
                                        className="mt-1 font-mono text-caption"
                                        rows={4}
                                        value={specsToText(b?.specs)}
                                        onChange={(e) => updateBlock(i, 'specs', textToSpecs(e.target.value))}
                                        placeholder={'Eligibility: Any engineering graduate\nMode: Classroom + online'}
                                    />
                                </div>

                                <div>
                                    <Label className="text-xs">{t('detailBlocks.noteStrip')}</Label>
                                    <Textarea className="mt-1" rows={2} value={b?.note || ''} onChange={(e) => updateBlock(i, 'note', e.target.value)} placeholder={t('detailBlocks.optional')} />
                                    {b?.note && (
                                        <div className="mt-1 flex gap-1">
                                            {(['warn', 'info', 'plain'] as const).map((tone) => (
                                                <button key={tone} onClick={() => updateBlock(i, 'noteTone', tone)} className={pill((b?.noteTone || 'warn') === tone)}>{optionLabel(t, tone)}</button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <Label className="text-xs">{t('detailBlocks.deepLinkAnchor')}</Label>
                                    <Input className="mt-1" value={b?.anchor || ''} onChange={(e) => updateBlock(i, 'anchor', e.target.value)} placeholder={t('detailBlocks.autoFromTitle')} />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

const FeatureGridEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const features = props.features || [];
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    // Latest props, including an update not yet re-rendered: the Freebies list
    // arrives after a network call (or a cache hit, before React re-renders),
    // and must merge into what the admin just chose, not a stale copy.
    const propsRef = useRef(props);
    propsRef.current = props;
    const commitProps = (next: any) => {
        propsRef.current = next;
        updateComponent(pageId, component.id, { props: next });
    };

    const updateProp = (key: string, value: any) => commitProps({ ...props, [key]: value });

    const addFeature = () => updateProp('features', [...features, { icon: '⭐', title: t('featureGrid.defaults.title'), description: t('featureGrid.defaults.description') }]);
    const deleteFeature = (i: number) => { updateProp('features', features.filter((_: any, idx: number) => idx !== i)); if (expandedIdx === i) setExpandedIdx(null); };
    const updateFeature = (i: number, field: string, value: any) => {
        const updated = [...features];
        updated[i] = { ...updated[i], [field]: value };
        updateProp('features', updated);
    };
    // Card order is the display order on the live page.
    const moveFeature = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= features.length) return;
        const updated = [...features];
        [updated[i], updated[j]] = [updated[j], updated[i]];
        updateProp('features', updated);
        if (expandedIdx === i) setExpandedIdx(j);
    };
    const duplicateFeature = (i: number) => {
        const updated = [...features];
        updated.splice(i + 1, 0, JSON.parse(JSON.stringify(features[i])));
        updateProp('features', updated);
        setExpandedIdx(i + 1);
    };
    const isResource = props.style === 'resource';

    // Resource sections collect into the institute's Freebies list without the
    // admin picking one.
    const ensureFreebiesList = useFreebiesList();
    const { toast } = useToast();
    const [attachingList, setAttachingList] = useState(false);
    const attachFreebiesList = async () => {
        if (propsRef.current.gateAudienceId || attachingList) return;
        setAttachingList(true);
        try {
            const list = await ensureFreebiesList();
            if (propsRef.current.gateAudienceId) return;
            commitProps({ ...propsRef.current, gateAudienceId: list.id, gateAudienceName: list.name });
        } catch {
            toast({ title: t('featureGrid.freebiesListError'), variant: 'destructive' });
        } finally {
            setAttachingList(false);
        }
    };
    // Switching a section to Resource gates every card by default; an existing
    // resource section keeps whatever it had.
    const chooseStyle = (style: string) => {
        if (style === 'resource' && props.style !== 'resource' && !props.gateAudienceId) {
            commitProps({ ...props, style, gateAll: true });
            void attachFreebiesList();
            return;
        }
        updateProp('style', style);
    };

    return (
        <div className="space-y-4">
            <Input value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} placeholder={t('logoCloud.headerTextPlaceholder')} />
            <Input value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} placeholder={t('faq.subheading')} />
            <div>
                <Label className="text-xs">{t('columnLayout.columns')}</Label>
                <div className="flex gap-1 mt-1">
                    {[2, 3, 4].map((c) => (
                        <button key={c} onClick={() => updateProp('columns', c)}
                            className={`rounded px-3 py-1 text-caption font-medium ${props.columns === c ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{c}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('stats.style')}</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                    {['cards', 'minimal', 'bordered', 'glass', 'gradient-border', 'tinted', 'panel', 'photo', 'resource', 'categoryTiles'].map((s) => (
                        <button key={s} onClick={() => chooseStyle(s)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.style === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, s)}</button>
                    ))}
                </div>
                {props.style === 'categoryTiles' && (
                    <div className="mt-1 space-y-1">
                        <Label className="text-xs">{t('featureGrid.categoryParam')}</Label>
                        <Input
                            value={props.filterParam || ''}
                            onChange={(e) => updateProp('filterParam', e.target.value.trim() || undefined)}
                            placeholder="cat"
                        />
                        <p className="text-caption text-gray-400">{t('featureGrid.categoryParamHint')}</p>
                    </div>
                )}
                {(props.style === 'photo' || props.style === 'resource') && (
                    <div className="mt-1 space-y-1">
                        {props.style === 'photo' && (
                            <p className="text-caption text-gray-400">
                                {t('featureGrid.photoStyleHint')}
                            </p>
                        )}
                        <label className="flex items-center gap-2 text-caption text-gray-600">
                            <input
                                type="checkbox"
                                checked={props.layout === 'carousel'}
                                onChange={(e) => updateProp('layout', e.target.checked ? 'carousel' : undefined)}
                            />
                            {t('featureGrid.swipeableRow')}
                        </label>
                        {props.layout === 'carousel' && <AutoScrollControls props={props} updateProp={updateProp} />}
                    </div>
                )}
                {props.style === 'panel' && (
                    <p className="mt-1 text-caption text-gray-400">
                        {t('featureGrid.panelStyleHint')}
                    </p>
                )}
                {isResource && (
                    <p className="mt-1 text-caption text-gray-400">
                        {t('featureGrid.resourceStyleHint')}
                    </p>
                )}
            </div>
            {isResource && (
                <div className="space-y-2 rounded border border-dashed border-gray-200 p-2">
                    <p className="text-caption font-medium text-gray-500">{t('featureGrid.gateHeading')}</p>
                    <CampaignPicker
                        label={t('featureGrid.gateList')}
                        value={props.gateAudienceId || ''}
                        onChange={(id, name) => commitProps({ ...props, gateAudienceId: id, gateAudienceName: name })}
                    />
                    <Input value={props.gateTitle || ''} onChange={(e) => updateProp('gateTitle', e.target.value)} placeholder={t('featureGrid.gateTitlePlaceholder')} />
                    <label className="flex items-center gap-2 text-caption text-gray-600">
                        <input
                            type="checkbox"
                            checked={!!props.gateAll}
                            onChange={(e) => {
                                updateProp('gateAll', e.target.checked || undefined);
                                if (e.target.checked) void attachFreebiesList();
                            }}
                        />
                        {t('featureGrid.gateAll')}
                    </label>
                    <p className="text-caption text-gray-400">{t('featureGrid.gateHint')}</p>
                </div>
            )}
            <div>
                <Label className="text-xs">{t('featureGrid.textAlignment')}</Label>
                <div className="flex gap-1 mt-1">
                    {['center', 'left'].map((a) => (
                        <button key={a} onClick={() => updateProp('align', a)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${(props.align || 'center') === a ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, a)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('featureGrid.iconSize')}</Label>
                <div className="flex gap-1 mt-1">
                    {['small', 'medium', 'large'].map((s) => (
                        <button key={s} onClick={() => updateProp('iconSize', s)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.iconSize === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, s)}</button>
                    ))}
                </div>
            </div>
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#FFFFFF' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
            <div>
                <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium">{t('featureGrid.featuresCount', { count: features.length })}</Label>
                    <Button variant="ghost" size="sm" onClick={addFeature} className="h-6 text-xs"><Plus className="size-3 me-1" /> {t('actions.add')}</Button>
                </div>
                <div className="space-y-2">
                    {features.map((f: any, i: number) => (
                        <div key={i} className="rounded border bg-gray-50 p-2 space-y-2">
                            <div className="flex items-center justify-between">
                                <button onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} className="text-xs font-medium text-left flex-1 truncate">
                                    {f.icon} {f.title || t('featureGrid.featureN', { n: i + 1 })}
                                </button>
                                <Button variant="ghost" size="sm" onClick={() => moveFeature(i, -1)} disabled={i === 0} title={t('actions.moveUp')} aria-label={t('actions.moveUp')} className="size-6 p-0"><ArrowUp className="size-3" /></Button>
                                <Button variant="ghost" size="sm" onClick={() => moveFeature(i, 1)} disabled={i === features.length - 1} title={t('actions.moveDown')} aria-label={t('actions.moveDown')} className="size-6 p-0"><ArrowDown className="size-3" /></Button>
                                <Button variant="ghost" size="sm" onClick={() => duplicateFeature(i)} title={t('actions.duplicate')} aria-label={t('actions.duplicate')} className="size-6 p-0"><Copy className="size-3" /></Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteFeature(i)} title={t('actions.delete')} aria-label={t('actions.delete')} className="size-6 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                            </div>
                            {expandedIdx === i && (
                                <div className="space-y-2">
                                    <Input value={f.icon || ''} onChange={(e) => updateFeature(i, 'icon', e.target.value)} placeholder={t('featureGrid.iconPlaceholder')} />
                                    <select
                                        className="w-full rounded border px-2 py-1.5 text-xs"
                                        value={f.iconName || ''}
                                        onChange={(e) => updateFeature(i, 'iconName', e.target.value || undefined)}
                                    >
                                        <option value="">{t('featureGrid.iconLibraryNone')}</option>
                                        {/* Icon identifiers — internal component names, not translated. */}
                                        {['GraduationCap','Rocket','Target','UsersThree','Code','Brain','Trophy','Lightbulb','ShieldCheck','ChartLineUp','Clock','Star','BookOpen','Certificate','ChatsCircle','Wrench','Sparkle','Medal','Briefcase','Globe','Train','Bank','Newspaper','Exam','Books','FileText','SquaresFour','Fire','Student','ChalkboardTeacher'].map((n) => (
                                            <option key={n} value={n}>{n}</option>
                                        ))}
                                    </select>
                                    <Input value={f.title || ''} onChange={(e) => updateFeature(i, 'title', e.target.value)} placeholder={t('header.title')} />
                                    {props.style === 'categoryTiles' && (
                                        <Input
                                            value={f.value || ''}
                                            onChange={(e) => updateFeature(i, 'value', e.target.value.trim().toLowerCase() || undefined)}
                                            placeholder={t('featureGrid.categoryValuePlaceholder')}
                                        />
                                    )}
                                    <Textarea value={f.description || ''} onChange={(e) => updateFeature(i, 'description', e.target.value)} placeholder={t('mediaShowcase.description')} rows={2} />
                                    <ImageUploadField slot="card" label={t('featureGrid.cardImage')} value={f.image || ''} onChange={(url) => updateFeature(i, 'image', url || undefined)} aiKind="image" />
                                    {isResource && (
                                        <Input value={f.badge || ''} onChange={(e) => updateFeature(i, 'badge', e.target.value)} placeholder={t('featureGrid.resourceBadgePlaceholder')} />
                                    )}
                                    {props.style === 'panel' && (
                                        <div className="space-y-2 rounded border border-dashed border-gray-200 p-2">
                                            <p className="text-caption font-medium text-gray-500">{t('featureGrid.panelHeader')}</p>
                                            <Input value={f.badge || ''} onChange={(e) => updateFeature(i, 'badge', e.target.value)} placeholder={t('featureGrid.badgePlaceholder')} />
                                            <div className="flex gap-1">
                                                {['tint', 'solid'].map((v) => (
                                                    <button key={v} onClick={() => updateFeature(i, 'headerVariant', v)}
                                                        className={`rounded px-3 py-1 text-caption font-medium capitalize ${(f.headerVariant || 'tint') === v && !f.headerColor ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, v)}</button>
                                                ))}
                                            </div>
                                            <ColorPickerField label={t('featureGrid.headerColorOverride')} value={f.headerColor || ''} onChange={(c) => updateFeature(i, 'headerColor', c || undefined)} />
                                        </div>
                                    )}
                                    <ListField
                                        value={f.chips}
                                        onCommit={(items) => updateFeature(i, 'chips', items)}
                                        separator="comma"
                                        placeholder={t('featureGrid.chipsPlaceholder')}
                                    />
                                    <ListField
                                        value={f.bullets}
                                        onCommit={(items) => updateFeature(i, 'bullets', items)}
                                        separator="newline"
                                        placeholder={t('featureGrid.bulletsPlaceholder')}
                                        rows={3}
                                    />
                                    <div className="flex gap-2">
                                        <Input className="flex-1" value={f.link?.text || ''} onChange={(e) => updateFeature(i, 'link', { ...(f.link || {}), text: e.target.value })} placeholder={t('featureGrid.linkTextPlaceholder')} />
                                        <Input className="flex-1" value={f.link?.url || ''} onChange={(e) => updateFeature(i, 'link', { ...(f.link || {}), url: e.target.value })} placeholder={t('featureGrid.linkUrlPlaceholder')} />
                                    </div>
                                    {isResource && (
                                        <>
                                            <DocumentUploadField
                                                label={t('featureGrid.uploadPdf')}
                                                value={/\.pdf($|\?)/i.test(f.link?.url || '') ? f.link.url : ''}
                                                onChange={(url) => updateFeature(i, 'link', { ...(f.link || {}), url })}
                                            />
                                            <label className="flex items-center gap-2 text-caption text-gray-600">
                                                <input
                                                    type="checkbox"
                                                    disabled={!!props.gateAll}
                                                    checked={!!props.gateAll || !!f.link?.gated}
                                                    onChange={(e) => {
                                                        updateFeature(i, 'link', { ...(f.link || {}), gated: e.target.checked || undefined });
                                                        if (e.target.checked) void attachFreebiesList();
                                                    }}
                                                />
                                                {t('featureGrid.gateToggle')}
                                            </label>
                                            {(props.gateAll || f.link?.gated) && !props.gateAudienceId && (
                                                <div className="space-y-1">
                                                    <p className="text-caption text-amber-600">{t('featureGrid.gateNeedsList')}</p>
                                                    <button
                                                        type="button"
                                                        disabled={attachingList}
                                                        onClick={() => void attachFreebiesList()}
                                                        className="text-caption font-medium text-primary-500 hover:underline disabled:opacity-60"
                                                    >
                                                        {attachingList ? t('featureGrid.attachingFreebiesList') : t('featureGrid.useFreebiesList')}
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ─── Image Block Editor ───────────────────────────────────────────────── */
const ImageBlockEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <ImageUploadField label={t('hero.imageField')} value={props.src || ''} onChange={(url) => updateProp('src', url)} aiKind="image" />
            <Input value={props.alt || ''} onChange={(e) => updateProp('alt', e.target.value)} placeholder={t('hero.altTextPlaceholder')} />
            <Input value={props.caption || ''} onChange={(e) => updateProp('caption', e.target.value)} placeholder={t('imageBlock.captionOptional')} />
            <LinkPicker
                label={t('imageBlock.linkOptional')}
                value={props.linkUrl || ''}
                onChange={(v) => updateProp('linkUrl', v)}
                showTarget
                target={props.linkTarget}
                onTargetChange={(tgt) => updateProp('linkTarget', tgt)}
                placeholder={t('imageBlock.linkPlaceholder')}
            />
            <div>
                <Label className="text-xs">{t('trustChip.alignment')}</Label>
                <div className="flex gap-1 mt-1">
                    {['left', 'center', 'right'].map((a) => (
                        <button key={a} onClick={() => updateProp('alignment', a)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.alignment === a ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, a)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('spacer.maxWidth')}</Label>
                <div className="flex gap-1 mt-1">
                    {['300px', '500px', '800px', '100%'].map((w) => (
                        <button key={w} onClick={() => updateProp('maxWidth', w)}
                            className={`rounded px-2 py-1 text-caption font-medium ${props.maxWidth === w ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{w}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('mapEmbed.borderRadius')}</Label>
                <div className="flex gap-1 mt-1">
                    {['0', '4px', '8px', '16px', '9999px'].map((r) => (
                        <button key={r} onClick={() => updateProp('borderRadius', r)}
                            className={`rounded px-2 py-1 text-caption font-medium ${props.borderRadius === r ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{r === '9999px' ? t('options.full') : r}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('imageBlock.aspectRatio')}</Label>
                <div className="flex gap-1 mt-1">
                    {['auto', '16/9', '4/3', '1/1', '3/4'].map((r) => (
                        <button key={r} onClick={() => updateProp('aspectRatio', r)}
                            className={`rounded px-2 py-1 text-caption font-medium ${props.aspectRatio === r ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{r === 'auto' ? t('options.auto') : r}</button>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ─── Button Block Editor ──────────────────────────────────────────────── */
const ButtonBlockEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <Input value={props.text || ''} onChange={(e) => updateProp('text', e.target.value)} placeholder={t('mediaShowcase.buttonTextPlaceholder')} />
            <div>
                <Label className="text-xs">{t('header.onClick')}</Label>
                <div className="mt-1 flex gap-1">
                    {([['link', t('options.openLink')], ['openForm', t('options.openFormPopup')], ['whatsapp', t('buttonBlock.whatsappChat')]] as const).map(([v, l]) => (
                        <button key={v} onClick={() => updateProp('action', v)}
                            className={`rounded px-2.5 py-1 text-caption font-medium ${(props.action || 'link') === v ? 'bg-primary-100 text-primary-500' : 'bg-gray-100 text-gray-600'}`}>{l}</button>
                    ))}
                </div>
            </div>
            {(props.action || 'link') === 'whatsapp' ? (
                <>
                    <div>
                        <Label className="text-xs">{t('global.whatsapp.numberLabel')}</Label>
                        <Input className="mt-1" value={props.whatsappPhone || ''} onChange={(e) => updateProp('whatsappPhone', e.target.value)} placeholder="919895603342" />
                        <p className="mt-1 text-caption text-gray-400">{t('buttonBlock.whatsappNumberHint')}</p>
                    </div>
                    <div>
                        <Label className="text-xs">{t('global.whatsapp.prefilledMessage')}</Label>
                        <Input className="mt-1" value={props.whatsappMessage || ''} onChange={(e) => updateProp('whatsappMessage', e.target.value)} placeholder={t('buttonBlock.whatsappMessagePlaceholder')} />
                    </div>
                </>
            ) : (props.action || 'link') === 'openForm' ? (
                <>
                    <CampaignPicker
                        label={t('header.formToOpen')}
                        allowEmpty={false}
                        value={props.audienceId || ''}
                        onChange={(id) => updateProp('audienceId', id)}
                    />
                    <div>
                        <Label className="text-xs">{t('buttonBlock.popupTitle')}</Label>
                        <Input className="mt-1" value={props.formTitle || ''} onChange={(e) => updateProp('formTitle', e.target.value)} placeholder={t('buttonBlock.popupTitlePlaceholder')} />
                    </div>
                </>
            ) : (
                <LinkPicker
                    label={t('buttonBlock.linkDestination')}
                    value={props.url || ''}
                    onChange={(v) => updateProp('url', v)}
                    showTarget
                    target={props.target}
                    onTargetChange={(tgt) => updateProp('target', tgt)}
                />
            )}
            <div>
                <Label className="text-xs">{t('buttonBlock.variant')}</Label>
                <div className="flex gap-1 mt-1">
                    {['filled', 'outline', 'ghost'].map((v) => (
                        <button key={v} onClick={() => updateProp('variant', v)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.variant === v ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, v)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('buttonBlock.size')}</Label>
                <div className="flex gap-1 mt-1">
                    {['small', 'medium', 'large'].map((s) => (
                        <button key={s} onClick={() => updateProp('size', s)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.size === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, s)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('trustChip.alignment')}</Label>
                <div className="flex gap-1 mt-1">
                    {['left', 'center', 'right'].map((a) => (
                        <button key={a} onClick={() => updateProp('alignment', a)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.alignment === a ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, a)}</button>
                    ))}
                </div>
            </div>
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#3B82F6' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
            <ColorPickerField label={t('header.textColor')} value={props.textColor || '#FFFFFF' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('textColor', c)} />
            <div>
                <Label className="text-xs">{t('mapEmbed.borderRadius')}</Label>
                <div className="flex gap-1 mt-1">
                    {['4px', '8px', '12px', '9999px'].map((r) => (
                        <button key={r} onClick={() => updateProp('borderRadius', r)}
                            className={`rounded px-2 py-1 text-caption font-medium ${props.borderRadius === r ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{r === '9999px' ? t('options.pill') : r}</button>
                    ))}
                </div>
            </div>
            <div className="flex items-center justify-between">
                <Label className="text-xs">{t('buttonBlock.fullWidth')}</Label>
                <Switch checked={props.fullWidth || false} onCheckedChange={(c) => updateProp('fullWidth', c)} />
            </div>
        </div>
    );
};

/* ─── Newsletter Signup Editor ─────────────────────────────────────────── */
const NewsletterSignupEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="space-y-4">
            <Input value={props.heading || ''} onChange={(e) => updateProp('heading', e.target.value)} placeholder={t('ctaBanner.headingField')} />
            <Input value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} placeholder={t('faq.subheading')} />
            <Input value={props.placeholder || ''} onChange={(e) => updateProp('placeholder', e.target.value)} placeholder={t('newsletter.inputPlaceholder')} />
            <Input value={props.buttonText || ''} onChange={(e) => updateProp('buttonText', e.target.value)} placeholder={t('mediaShowcase.buttonTextPlaceholder')} />
            <Input value={props.successMessage || ''} onChange={(e) => updateProp('successMessage', e.target.value)} placeholder={t('newsletter.successMessagePlaceholder')} />
            <CampaignPicker
                value={props.audienceId || ''}
                onChange={(id, name) => updateComponent(pageId, component.id, { props: { ...props, audienceId: id, audienceName: name } })}
            />
            <div>
                <Label className="text-xs">{t('ctaBanner.layout')}</Label>
                <div className="flex gap-1 mt-1">
                    {['inline', 'stacked'].map((l) => (
                        <button key={l} onClick={() => updateProp('layout', l)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.layout === l ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, l)}</button>
                    ))}
                </div>
            </div>
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#F8FAFC' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
        </div>
    );
};

/* ─── Steps / Process Editor ───────────────────────────────────────────── */
const StepsProcessEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const steps = props.steps || [];
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addStep = () => updateProp('steps', [...steps, { number: String(steps.length + 1), title: t('steps.stepN', { n: steps.length + 1 }), description: t('featureGrid.defaults.description') }]);
    const deleteStep = (i: number) => { updateProp('steps', steps.filter((_: any, idx: number) => idx !== i)); if (expandedIdx === i) setExpandedIdx(null); };
    const updateStep = (i: number, field: string, value: any) => {
        const updated = [...steps];
        updated[i] = { ...updated[i], [field]: value };
        updateProp('steps', updated);
    };

    const variant = props.variant || 'plain';
    const variants = [
        { key: 'plain', label: optionLabel(t, 'plain') },
        { key: 'timeline-cards', label: t('steps.variantTimelineCards') },
        { key: 'alternating', label: t('steps.variantAlternating') },
        { key: 'cards', label: t('steps.variantCards') },
    ];
    // A stored variant this list does not know stays visible as the active one.
    if (!variants.some((v) => v.key === variant)) {
        variants.push({ key: variant, label: t('options.customValue', { value: variant }) });
    }
    // The cards look has no nodes or connector rail.
    const isCards = variant === 'cards';

    return (
        <div className="space-y-4">
            <Input value={props.headerText || ''} onChange={(e) => updateProp('headerText', e.target.value)} placeholder={t('logoCloud.headerTextPlaceholder')} />
            <Input value={props.subheading || ''} onChange={(e) => updateProp('subheading', e.target.value)} placeholder={t('faq.subheading')} />
            <div>
                <Label className="text-xs">{t('ctaBanner.layout')}</Label>
                <div className="flex gap-1 mt-1">
                    {['horizontal', 'vertical'].map((l) => (
                        <button key={l} onClick={() => updateProp('layout', l)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${props.layout === l ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, l)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('buttonBlock.variant')}</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                    {variants.map((v) => (
                        <button key={v.key} onClick={() => updateProp('variant', v.key)} aria-pressed={variant === v.key}
                            className={`rounded px-2 py-1 text-caption font-medium ${variant === v.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{v.label}</button>
                    ))}
                </div>
            </div>
            {variant !== 'plain' && !isCards && (
                <>
                    <div>
                        <Label className="text-xs">{t('steps.nodeStyle')}</Label>
                        <div className="flex gap-1 mt-1">
                            {['number', 'icon', 'dot'].map((n) => (
                                <button key={n} onClick={() => updateProp('nodeStyle', n)}
                                    className={`rounded px-2 py-1 text-caption font-medium capitalize ${(props.nodeStyle || 'number') === n ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, n)}</button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">{t('steps.gradientRail')}</Label>
                        <Switch checked={props.connectorGradient || false} onCheckedChange={(c) => updateProp('connectorGradient', c)} />
                    </div>
                </>
            )}
            {!isCards && (
                <div>
                    <Label className="text-xs">{t('steps.connectorStyle')}</Label>
                    <div className="flex gap-1 mt-1">
                        {['line', 'dashed', 'dots', 'none'].map((s) => (
                            <button key={s} onClick={() => updateProp('connectorStyle', s)}
                                className={`rounded px-2 py-1 text-caption font-medium capitalize ${props.connectorStyle === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, s)}</button>
                        ))}
                    </div>
                </div>
            )}
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#FFFFFF' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
            <ColorPickerField label={t('steps.accentColor')} value={props.accentColor || '#3B82F6' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('accentColor', c)} />
            <div>
                <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium">{t('steps.stepsCount', { count: steps.length })}</Label>
                    <Button variant="ghost" size="sm" onClick={addStep} className="h-6 text-xs"><Plus className="size-3 me-1" /> {t('actions.add')}</Button>
                </div>
                <div className="space-y-2">
                    {steps.map((step: any, i: number) => (
                        <div key={i} className="rounded border bg-gray-50 p-2 space-y-2">
                            <div className="flex items-center justify-between">
                                <button onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} className="text-xs font-medium text-left flex-1 truncate">
                                    {step.number || i + 1}. {step.title || t('steps.stepN', { n: i + 1 })}
                                </button>
                                <Button variant="ghost" size="sm" onClick={() => deleteStep(i)} className="size-6 p-0 text-red-600"><Trash2 className="size-3" /></Button>
                            </div>
                            {expandedIdx === i && (
                                <div className="space-y-2">
                                    <Input value={step.number || ''} onChange={(e) => updateStep(i, 'number', e.target.value)} placeholder={t('steps.numberLabelPlaceholder')} />
                                    <Input value={step.title || ''} onChange={(e) => updateStep(i, 'title', e.target.value)} placeholder={t('header.title')} />
                                    <Textarea value={step.description || ''} onChange={(e) => updateStep(i, 'description', e.target.value)} placeholder={t('mediaShowcase.description')} rows={2} />
                                    <Input value={step.meta || ''} onChange={(e) => updateStep(i, 'meta', e.target.value)} placeholder={t('steps.metaPlaceholder')} />
                                    <ListField
                                        value={step.chips}
                                        onCommit={(items) => updateStep(i, 'chips', items)}
                                        separator="comma"
                                        placeholder={t('steps.chipsPlaceholder')}
                                    />
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs">{t('steps.highlightThisStep')}</Label>
                                        <Switch
                                            checked={step.state === 'highlight'}
                                            onCheckedChange={(c) => updateStep(i, 'state', c ? 'highlight' : undefined)}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ─── Marquee (announcement ticker) Editor ─────────────────────────────── */
const MarqueeEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { props } = component;
    const items: Array<{ icon?: string; text?: string; link?: string }> = Array.isArray(props.items) ? props.items : [];
    // The item whose link picker is open; the row stays compact otherwise.
    const [linkOpen, setLinkOpen] = useState<number | null>(null);

    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    const addItem = () => updateProp('items', [...items, { icon: props.defaultIcon ?? '', text: t('marquee.newItem') }]);
    const deleteItem = (i: number) => {
        setLinkOpen(null);
        updateProp('items', items.filter((_, idx) => idx !== i));
    };
    const updateItem = (i: number, field: 'icon' | 'text' | 'link', value: string) => {
        const updated = [...items];
        updated[i] = { ...updated[i], [field]: value };
        updateProp('items', updated);
    };
    const moveItem = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= items.length) return;
        const updated = [...items];
        [updated[i], updated[j]] = [updated[j]!, updated[i]!];
        if (linkOpen === i) setLinkOpen(j);
        else if (linkOpen === j) setLinkOpen(i);
        updateProp('items', updated);
    };

    return (
        <div className="space-y-4">
            <div>
                <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium">{t('marquee.itemsCount', { count: items.length })}</Label>
                    <Button variant="ghost" size="sm" onClick={addItem} className="h-6 text-xs"><Plus className="size-3 me-1" /> {t('actions.add')}</Button>
                </div>
                <div className="space-y-2">
                    {items.map((item, i) => (
                        <div key={i} className="space-y-2">
                            <div className="flex items-center gap-1">
                                <Input
                                    value={item.icon ?? ''}
                                    onChange={(e) => updateItem(i, 'icon', e.target.value)}
                                    placeholder={props.defaultIcon || '⭐'}
                                    aria-label={t('marquee.iconLabel')}
                                    className="w-12 shrink-0 px-1 text-center"
                                />
                                <Input
                                    value={item.text ?? ''}
                                    onChange={(e) => updateItem(i, 'text', e.target.value)}
                                    placeholder={t('marquee.itemTextPlaceholder')}
                                    className="flex-1"
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setLinkOpen(linkOpen === i ? null : i)}
                                    className={`size-6 p-0 ${item.link ? 'text-blue-600' : ''}`}
                                    aria-label={t('marquee.itemLink')}
                                    aria-expanded={linkOpen === i}
                                    title={item.link ? t('marquee.linkedTo', { link: item.link }) : t('marquee.itemLink')}
                                >
                                    <LinkSimple className="size-3" weight={item.link ? 'bold' : 'regular'} />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => moveItem(i, -1)} disabled={i === 0} className="size-6 p-0" aria-label={t('actions.moveUp')}><ChevronUp className="size-3" /></Button>
                                <Button variant="ghost" size="sm" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} className="size-6 p-0" aria-label={t('actions.moveDown')}><ChevronDown className="size-3" /></Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteItem(i)} className="size-6 p-0 text-red-600" aria-label={t('actions.delete')}><Trash2 className="size-3" /></Button>
                            </div>
                            {linkOpen === i && (
                                <div className="rounded border border-gray-200 p-2">
                                    {/* Page, a section on this page (#anchor) or an external URL;
                                        stored as item.link and opened by the site's CatalogueLink. */}
                                    <LinkPicker
                                        label={t('marquee.itemLink')}
                                        value={item.link ?? ''}
                                        onChange={(v) => updateItem(i, 'link', v)}
                                    />
                                    {item.link && (
                                        <Button variant="ghost" size="sm" onClick={() => updateItem(i, 'link', '')} className="mt-1 h-6 text-xs text-red-600">
                                            {t('marquee.removeLink')}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    {items.length === 0 && <p className="text-caption text-gray-500">{t('marquee.noItems')}</p>}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('marquee.defaultIcon')}</Label>
                <Input className="mt-1" value={props.defaultIcon ?? ''} onChange={(e) => updateProp('defaultIcon', e.target.value)} placeholder="⭐" />
                <p className="mt-1 text-caption text-gray-500">{t('marquee.defaultIconHint')}</p>
            </div>
            <div>
                <Label className="text-xs">{t('marquee.textSize')}</Label>
                <select className="mt-1 w-full rounded border px-3 py-2 text-sm" value={props.fontSize || 'sm'} onChange={(e) => updateProp('fontSize', e.target.value)}>
                    {['xs', 'sm', 'base', 'lg', 'xl'].map((s) => (
                        <option key={s} value={s}>{t(`marquee.size.${s}`)}</option>
                    ))}
                </select>
            </div>
            <ColorPickerField label={t('faq.backgroundColor')} value={props.backgroundColor || '#1e1b4b' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('backgroundColor', c)} />
            <ColorPickerField label={t('header.textColor')} value={props.textColor || '#ffffff' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('textColor', c)} />
            <ColorPickerField label={t('marquee.iconColor')} value={props.iconColor || '#facc15' /* design-lint-ignore: page-builder default color */} onChange={(c) => updateProp('iconColor', c)} />
            <div>
                <Label className="text-xs">{t('marquee.speed')}</Label>
                <div className="flex gap-1 mt-1">
                    {['slow', 'medium', 'fast'].map((sp) => (
                        <button key={sp} onClick={() => updateProp('speed', sp)}
                            className={`rounded px-3 py-1 text-caption font-medium capitalize ${(props.speed || 'medium') === sp ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{optionLabel(t, sp)}</button>
                    ))}
                </div>
            </div>
            <div>
                <Label className="text-xs">{t('marquee.direction')}</Label>
                <div className="flex gap-1 mt-1">
                    {['left', 'right'].map((d) => (
                        <button key={d} onClick={() => updateProp('direction', d)}
                            className={`rounded px-3 py-1 text-caption font-medium ${(props.direction || 'left') === d ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{d === 'left' ? '← ' : '→ '}{optionLabel(t, d)}</button>
                    ))}
                </div>
            </div>
            <div className="flex items-center justify-between">
                <Label className="text-xs">{t('marquee.pauseOnHover')}</Label>
                <Switch checked={props.pauseOnHover !== false} onCheckedChange={(c) => updateProp('pauseOnHover', c)} />
            </div>
        </div>
    );
};
