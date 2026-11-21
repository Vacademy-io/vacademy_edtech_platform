import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { GearSix, Globe, Sparkle } from '@phosphor-icons/react';
import { StatusChip } from '@/components/design-system/status-chips';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getCatalogueTags } from '../../-services/catalogue-service';
import type { CatalogueTag } from '../../-types/catalogue-types';
import type { SiteAssistantSettings } from '../../-types/editor-types';
import { SITE_ASSISTANT_TABS, TAB_LABELS, type SiteAssistantTab } from '../-utils/tabs';
import { ConversationsTab } from './ConversationsTab';
import { EmbedTab } from './EmbedTab';
import { KnowledgeTab } from './KnowledgeTab';
import { PreviewTab } from './PreviewTab';
import { StatusTab } from './StatusTab';
import { EmptyState, ErrorState } from './TabStates';
import { UnansweredTab } from './UnansweredTab';

/** globalSettings.siteAssistant of a site's live (published) JSON; {} when unreadable. */
export const publishedSiteAssistant = (site: CatalogueTag | undefined): SiteAssistantSettings => {
    if (!site?.catalogueJson) return {};
    try {
        const json = JSON.parse(site.catalogueJson) as {
            globalSettings?: { siteAssistant?: unknown };
        };
        const sa = json?.globalSettings?.siteAssistant;
        return sa && typeof sa === 'object' && !Array.isArray(sa)
            ? (sa as SiteAssistantSettings)
            : {};
    } catch {
        return {};
    }
};

/** The site to open: the one in the URL, else the first live site, else the first. */
export const pickSite = (sites: CatalogueTag[], wanted: string | undefined) =>
    sites.find((s) => s.tagName === wanted) ?? sites.find((s) => s.status === 'ACTIVE') ?? sites[0];

/**
 * Manage Pages → Site Assistant: everything about a site's AI assistant
 * except its settings (those are in the site's Global Settings, so they are
 * published with the site). Pick a site, then its FAQs and notices,
 * conversations, unanswered questions, a preview chat, the embed code and
 * its status.
 */
export const SiteAssistantPage = () => {
    const instituteId = getCurrentInstituteId();
    const navigate = useNavigate();
    const search = useSearch({ strict: false }) as { site?: string; tab?: SiteAssistantTab };
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading('Site Assistant');
    }, [setNavHeading]);

    const sitesQuery = useQuery({
        queryKey: ['catalogueTags', instituteId],
        queryFn: () => getCatalogueTags(instituteId!),
        enabled: !!instituteId,
    });
    const sites = useMemo(
        () => (sitesQuery.data ?? []).filter((s) => s.status !== 'ARCHIVED'),
        [sitesQuery.data]
    );
    const site = pickSite(sites, search.site);
    const tab: SiteAssistantTab = search.tab ?? 'knowledge';
    const settings = publishedSiteAssistant(site);

    const setSearch = (next: { site?: string; tab?: SiteAssistantTab }) =>
        void navigate({
            to: '/manage-pages/site-assistant',
            search: { site: site?.tagName, tab, ...next },
            replace: true,
        });

    if (sitesQuery.isLoading) {
        return (
            <div className="flex flex-col gap-4 p-4">
                <Skeleton className="h-8 w-60" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-40 w-full" />
            </div>
        );
    }
    if (sitesQuery.isError) {
        return (
            <ErrorState
                message="Could not load your sites."
                onRetry={() => void sitesQuery.refetch()}
            />
        );
    }
    if (!site) {
        return (
            <EmptyState icon={<Globe className="size-8 text-neutral-400" />} title="No site yet">
                The assistant lives on a website made in Manage Pages.{' '}
                <Link to="/manage-pages" className="font-medium text-primary-500 hover:underline">
                    Create your first site
                </Link>
                .
            </EmptyState>
        );
    }

    const siteLabel = site.tagName;
    const on = settings.enabled === true;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                    <h1 className="flex items-center gap-2 text-h3 font-semibold text-neutral-800">
                        <Sparkle className="size-6 text-primary-500" weight="fill" />
                        Site Assistant
                    </h1>
                    <p className="max-w-2xl text-body text-neutral-600">
                        The AI helper on your website. It answers visitors from your pages, courses,
                        FAQs and notices, and passes interested visitors to your team.
                    </p>
                </div>
                <div className="flex flex-col gap-2 md:items-end">
                    <Select
                        value={site.tagName}
                        onValueChange={(tagName) => setSearch({ site: tagName })}
                    >
                        <SelectTrigger className="w-full md:w-64" aria-label="Site">
                            <SelectValue placeholder="Pick a site" />
                        </SelectTrigger>
                        <SelectContent>
                            {sites.map((s) => (
                                <SelectItem key={s.tagName} value={s.tagName}>
                                    {s.tagName}
                                    {s.status !== 'ACTIVE' ? ' (draft)' : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="flex flex-wrap items-center gap-3">
                        <StatusChip
                            text={on ? 'On for visitors' : 'Off for visitors'}
                            status={on ? 'SUCCESS' : 'INFO'}
                            textSize="text-caption"
                        />
                        <Link
                            to="/manage-pages/editor/$tagName"
                            params={{ tagName: site.tagName }}
                            className="inline-flex items-center gap-1 text-caption font-medium text-primary-500 hover:underline"
                        >
                            <GearSix className="size-3.5" />
                            Settings (in Global Settings)
                        </Link>
                    </div>
                </div>
            </header>

            <Tabs value={tab} onValueChange={(v) => setSearch({ tab: v as SiteAssistantTab })}>
                <div className="overflow-x-auto">
                    <TabsList>
                        {SITE_ASSISTANT_TABS.map((t) => (
                            <TabsTrigger key={t} value={t}>
                                {TAB_LABELS[t]}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
                {/* key: switching site starts every tab afresh (a new preview chat, page 1). */}
                <div key={site.tagName} className="pt-4">
                    <TabsContent value="knowledge">
                        <KnowledgeTab siteTag={site.tagName} siteLabel={siteLabel} />
                    </TabsContent>
                    <TabsContent value="conversations">
                        <ConversationsTab siteTag={site.tagName} />
                    </TabsContent>
                    <TabsContent value="unanswered">
                        <UnansweredTab siteTag={site.tagName} siteLabel={siteLabel} />
                    </TabsContent>
                    <TabsContent value="preview">
                        <PreviewTab siteTag={site.tagName} />
                    </TabsContent>
                    <TabsContent value="embed">
                        <EmbedTab
                            siteTag={site.tagName}
                            embedEnabled={settings.embed?.enabled === true}
                        />
                    </TabsContent>
                    <TabsContent value="status">
                        <StatusTab siteTag={site.tagName} />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
};
