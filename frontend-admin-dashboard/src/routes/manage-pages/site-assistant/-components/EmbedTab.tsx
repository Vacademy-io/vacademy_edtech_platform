import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from '@tanstack/react-router';
import { Check, CheckCircle, Copy, Key, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { copyTextToClipboard } from '@/lib/clipboard';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getLearnerPortalOrigin } from '@/lib/learner-portal-url';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    CATALOG_KEYS_QUERY_KEY,
    CATALOG_WEBSITES_QUERY_KEY,
    fetchCatalogKeys,
    fetchWebsites,
    issueCatalogKey,
    type IssuedCatalogKey,
} from '@/routes/settings/-services/catalog-api';
import {
    MAX_API_KEY_NAME_LENGTH,
    apiKeyDisplayStatus,
    apiKeyErrorMessage,
} from '@/routes/settings/-services/evaluation-api-keys';
import { buildEmbedSnippet, keyPlaceholder, snippetHasFullKey } from '../-utils/embed-snippet';
import { ErrorState } from './TabStates';

const SELECT_CLASS =
    'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-body sm:w-80';

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <section className="flex gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-body font-semibold text-primary-500">
            {n}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h3 className="text-subtitle font-semibold text-neutral-800">{title}</h3>
            {children}
        </div>
    </section>
);

/**
 * The script tag for the institute's own website (not built in Manage Pages).
 * It needs a publishable Catalogue API key, a verified website, and "Your own
 * website" switched on in this site's settings. Saved keys are only shown by
 * their prefix; the full key appears once, right after it is created here.
 */
export const EmbedTab = ({
    siteTag,
    embedEnabled,
}: {
    siteTag: string;
    /** globalSettings.siteAssistant.embed.enabled of the published site. */
    embedEnabled: boolean;
}) => {
    const instituteId = getCurrentInstituteId() || '';
    const portalBase = useInstituteDetailsStore((s) => s.instituteDetails?.learner_portal_base_url);
    const queryClient = useQueryClient();
    const [pickedId, setPickedId] = useState('');
    const [issued, setIssued] = useState<IssuedCatalogKey | null>(null);
    const [newName, setNewName] = useState('');
    const [copied, setCopied] = useState(false);

    const keysQuery = useQuery({
        queryKey: [CATALOG_KEYS_QUERY_KEY, instituteId],
        queryFn: () => fetchCatalogKeys(instituteId),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });
    const websitesQuery = useQuery({
        queryKey: [CATALOG_WEBSITES_QUERY_KEY, instituteId],
        queryFn: () => fetchWebsites(instituteId),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const activeKeys = useMemo(
        () => (keysQuery.data ?? []).filter((k) => apiKeyDisplayStatus(k) === 'ACTIVE'),
        [keysQuery.data]
    );
    const selectedId = pickedId || issued?.id || activeKeys[0]?.id || '';
    const selected = activeKeys.find((k) => k.id === selectedId);
    const verified = (websitesQuery.data ?? []).filter((w) => w.status === 'VERIFIED');

    const issue = useMutation({
        mutationFn: (name: string) => issueCatalogKey(instituteId, name),
        onSuccess: (key) => {
            setIssued(key);
            setPickedId(key.id);
            setNewName('');
            setCopied(false);
            void queryClient.invalidateQueries({ queryKey: [CATALOG_KEYS_QUERY_KEY] });
        },
        onError: (err: unknown) =>
            toast.error(apiKeyErrorMessage(err) ?? 'Could not create the key. Try again.'),
    });

    // The full key is known only for the key created on this page just now.
    const keyText =
        issued && issued.id === selectedId ? issued.key : keyPlaceholder(selected?.prefix);
    const snippet = buildEmbedSnippet({
        portalOrigin: getLearnerPortalOrigin(portalBase),
        key: keyText,
        siteTag,
    });
    const fullKey = snippetHasFullKey(keyText);

    const copy = async () => {
        if (await copyTextToClipboard(snippet)) {
            setCopied(true);
            toast.success('Copied.');
        } else {
            toast.error('Could not copy. Select the code and copy it by hand.');
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <p className="max-w-2xl text-body text-neutral-600">
                Put the same assistant on your own website (one not built here), such as a WordPress
                or Next.js site. Paste one line of code before the closing{' '}
                <code className="font-mono text-caption">&lt;/body&gt;</code> tag.
            </p>

            {!embedEnabled && (
                <Alert>
                    <WarningCircle className="size-4" />
                    <AlertTitle>Switched off for this site</AlertTitle>
                    <AlertDescription>
                        Turn on &ldquo;Your own website&rdquo; in this site&rsquo;s Global Settings
                        → Site Assistant, then publish. Until then the code below shows nothing.{' '}
                        <Link
                            to="/manage-pages/editor/$tagName"
                            params={{ tagName: siteTag }}
                            className="font-medium text-primary-500 hover:underline"
                        >
                            Open the site editor
                        </Link>
                    </AlertDescription>
                </Alert>
            )}

            <Step n={1} title="Pick a website key">
                <p className="text-caption text-neutral-500">
                    A publishable key (it starts with vak_pub_) only works on your verified
                    websites, so it is safe to put in a web page.
                </p>
                {keysQuery.isLoading && <Skeleton className="h-9 w-80" />}
                {keysQuery.isError && (
                    <ErrorState
                        message="Could not load your website keys."
                        onRetry={() => void keysQuery.refetch()}
                    />
                )}
                {keysQuery.isSuccess && activeKeys.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="sa-embed-key">Key</Label>
                        <select
                            id="sa-embed-key"
                            className={SELECT_CLASS}
                            value={selectedId}
                            onChange={(e) => setPickedId(e.target.value)}
                        >
                            {activeKeys.map((k) => (
                                <option key={k.id} value={k.id}>
                                    {k.name || 'Key'} ({k.prefix}…)
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                {keysQuery.isSuccess && activeKeys.length === 0 && (
                    <p className="text-body text-neutral-600">
                        You don&rsquo;t have a website key yet. Create one below.
                    </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <MyInput
                        label="New key name"
                        inputPlaceholder="e.g. Main website"
                        maxLength={MAX_API_KEY_NAME_LENGTH}
                        input={newName}
                        onChangeFunction={(e) => setNewName(e.target.value)}
                    />
                    <MyButton
                        buttonType="secondary"
                        disable={!newName.trim() || !instituteId}
                        onAsyncClick={async () => {
                            await issue.mutateAsync(newName.trim()).catch(() => undefined);
                        }}
                        loadingText="Creating…"
                    >
                        <Key className="size-4" />
                        Create key
                    </MyButton>
                </div>
            </Step>

            <Step n={2} title="Copy the code">
                <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    <code
                        data-testid="site-assistant-snippet"
                        className="break-all font-mono text-caption text-neutral-800"
                    >
                        {snippet}
                    </code>
                    <div>
                        <MyButton buttonType="primary" scale="small" onClick={() => void copy()}>
                            {copied ? (
                                <Check className="size-3.5" />
                            ) : (
                                <Copy className="size-3.5" />
                            )}
                            {copied ? 'Copied' : 'Copy code'}
                        </MyButton>
                    </div>
                </div>
                {fullKey ? (
                    <p className="text-caption text-warning-600">
                        This is the only time the full key is shown. Copy the code now and keep it
                        safe.
                    </p>
                ) : (
                    <p className="text-caption text-neutral-500">
                        For safety, saved keys are never shown in full. Replace the part after
                        &ldquo;…&rdquo; with the full key you copied when you created it. Lost it?
                        Create a new key above and the code fills itself in.
                    </p>
                )}
            </Step>

            <Step n={3} title="Make sure your website is verified">
                {websitesQuery.isLoading && <Skeleton className="h-6 w-60" />}
                {websitesQuery.isError && (
                    <p className="text-caption text-danger-600">
                        Could not check your verified websites.
                    </p>
                )}
                {websitesQuery.isSuccess && verified.length > 0 && (
                    <ul className="flex flex-col gap-1">
                        {verified.map((w) => (
                            <li
                                key={w.id}
                                className="flex items-center gap-1.5 text-body text-neutral-700"
                            >
                                <CheckCircle className="size-4 text-success-600" weight="fill" />
                                {w.host}
                            </li>
                        ))}
                    </ul>
                )}
                {websitesQuery.isSuccess && verified.length === 0 && (
                    <p className="flex items-center gap-1.5 text-body text-warning-600">
                        <WarningCircle className="size-4" />
                        No verified website yet: the assistant won&rsquo;t load anywhere until you
                        verify one.
                    </p>
                )}
                <p className="text-caption text-neutral-500">
                    The assistant only opens on websites you have verified (and on localhost for
                    testing). Add and verify them in{' '}
                    <Link
                        to="/settings"
                        search={{ selectedTab: 'integrations' }}
                        className="font-medium text-primary-500 hover:underline"
                    >
                        Settings → Integrations → Catalogue API &amp; websites
                    </Link>
                    .
                </p>
            </Step>
        </div>
    );
};
