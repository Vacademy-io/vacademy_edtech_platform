import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    PlugsConnected,
    Plugs,
    Sparkle,
    FloppyDisk,
    CircleNotch,
    CheckCircle,
    XCircle,
    Eye,
    EyeSlash,
    Info,
    ArrowSquareOut,
    Plus,
    PencilSimple,
    Trash,
    Star,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
    getLmsProviders,
    saveInstituteSettingKey,
    testLmsConnection,
    type LmsProviderField,
    type LmsProviderMeta,
    type LmsConnection,
    type LmsConnectionTestResult,
} from '@/services/package-settings';

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v.trim());
const newId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `conn-${Date.now()}`;

const typeIcon = (id: string) => (id === 'MOODLE' ? Plugs : PlugsConnected);

/**
 * Institute LMS connections — a library of external LMSes (LearnDash sites, Moodle sites). Built
 * for a non-technical admin: add a connection from a typed form (plain labels + help), test it
 * live, mark a default. Apply a connection to a course from that course's Settings tab.
 */
const LmsSettings = () => {
    const { t } = useTranslation('settingsLms');
    const [providers, setProviders] = useState<LmsProviderMeta[]>([]);
    const [connections, setConnections] = useState<LmsConnection[]>([]);
    const [defaultId, setDefaultId] = useState<string | null>(null);
    const [configSource, setConfigSource] = useState<'INSTITUTE' | 'COURSE' | 'NONE'>('NONE');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);

    // Editor state (adding or editing a single connection).
    const [draft, setDraft] = useState<LmsConnection | null>(null);
    const [draftIsNew, setDraftIsNew] = useState(false);
    const [revealed, setRevealed] = useState<Record<string, boolean>>({});
    const [showErrors, setShowErrors] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<LmsConnectionTestResult | null>(null);
    // Arbitrary custom key–value pairs for the connection being edited (beyond preset fields).
    const [draftExtras, setDraftExtras] = useState<Array<{ key: string; value: string }>>([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const prov = await getLmsProviders();
            setProviders(prov.providers ?? []);
            setConnections((prov.connections ?? []) as LmsConnection[]);
            setDefaultId(prov.defaultConnectionId ?? prov.connections?.[0]?.id ?? null);
            setConfigSource(prov.configSource ?? 'NONE');
        } catch (e) {
            console.error('Failed to load LMS settings', e);
            toast.error(t('toasts.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);

    const connectable = useMemo(() => providers.filter((p) => p.requiresConnection), [providers]);
    const meta = useCallback(
        (type: string): LmsProviderMeta | undefined => providers.find((p) => p.id === type),
        [providers]
    );
    const displayName = useCallback((type: string) => meta(type)?.displayName ?? type, [meta]);

    const draftFields = useMemo<LmsProviderField[]>(
        () => (draft ? meta(draft.type)?.fields ?? [] : []),
        [draft, meta]
    );

    const draftError = useCallback(
        (f: LmsProviderField): string | null => {
            if (!draft) return null;
            const val = (draft[f.key] ?? '').trim();
            if (f.required && !val) return t('validation.required');
            if (f.type === 'url' && val && !isHttpUrl(val)) return t('validation.invalidUrl');
            return null;
        },
        [draft, t]
    );
    const draftHasErrors = useMemo(
        () => !!draft && (!draft.name.trim() || draftFields.some((f) => draftError(f))),
        [draft, draftFields, draftError]
    );

    const startAdd = (type: string) => {
        setDraft({ id: newId(), type, name: displayName(type) });
        setDraftExtras([]);
        setDraftIsNew(true);
        setTestResult(null);
        setShowErrors(false);
    };
    const startEdit = (c: LmsConnection) => {
        setDraft({ ...c });
        // Seed the custom-field rows from any keys that aren't part of this type's preset schema.
        const schemaKeys = new Set((meta(c.type)?.fields ?? []).map((f) => f.key));
        setDraftExtras(
            Object.entries(c)
                .filter(([k]) => k !== 'id' && k !== 'type' && k !== 'name' && !schemaKeys.has(k))
                .map(([k, v]) => ({ key: k, value: String(v) }))
        );
        setDraftIsNew(false);
        setTestResult(null);
        setShowErrors(false);
    };
    const cancelDraft = () => {
        setDraft(null);
        setDraftExtras([]);
        setTestResult(null);
    };
    const setDraftField = (key: string, value: string) => {
        setDraft((d) => (d ? { ...d, [key]: value } : d));
        setTestResult(null);
    };
    const addDraftExtra = () => setDraftExtras((prev) => [...prev, { key: '', value: '' }]);
    const updateDraftExtra = (i: number, field: 'key' | 'value', val: string) =>
        setDraftExtras((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    const removeDraftExtra = (i: number) =>
        setDraftExtras((prev) => prev.filter((_, idx) => idx !== i));

    const commitDraft = () => {
        if (!draft) return;
        if (draftHasErrors) {
            setShowErrors(true);
            return;
        }
        // Rebuild from identity + preset field values + custom key–value pairs, so removed/renamed
        // custom fields are dropped cleanly.
        const finalConn: LmsConnection = { id: draft.id, type: draft.type, name: draft.name };
        draftFields.forEach((f) => {
            const v = draft[f.key];
            if (v !== undefined && String(v).trim() !== '') finalConn[f.key] = v;
        });
        draftExtras.forEach(({ key, value }) => {
            const k = key.trim();
            if (k) finalConn[k] = value;
        });
        setConnections((prev) => {
            const exists = prev.some((c) => c.id === finalConn.id);
            return exists
                ? prev.map((c) => (c.id === finalConn.id ? finalConn : c))
                : [...prev, finalConn];
        });
        setDefaultId((prev) => prev ?? finalConn.id); // first connection becomes default
        setDraft(null);
        setDraftExtras([]);
        setTestResult(null);
    };

    const removeConnection = (id: string) => {
        setConnections((prev) => {
            const next = prev.filter((c) => c.id !== id);
            setDefaultId((d) => (d === id ? next[0]?.id ?? null : d));
            return next;
        });
    };

    const handleTest = async () => {
        if (!draft) return;
        if (draftHasErrors) {
            setShowErrors(true);
            return;
        }
        setTesting(true);
        setTestResult(null);
        try {
            const fields: Record<string, string> = {};
            draftFields.forEach((f) => {
                fields[f.key] = draft[f.key] ?? '';
            });
            draftExtras.forEach(({ key, value }) => {
                const k = key.trim();
                if (k) fields[k] = value;
            });
            setTestResult(await testLmsConnection(draft.type, fields));
        } catch {
            setTestResult({
                ok: false,
                provider: draft.type,
                message: t('testResult.genericFailure'),
            });
        } finally {
            setTesting(false);
        }
    };

    const handleSaveAll = async () => {
        setSaving(true);
        try {
            const def = connections.find((c) => c.id === defaultId) ?? connections[0] ?? null;
            const data: Record<string, unknown> = {
                connections,
                defaultConnectionId: def?.id ?? null,
                activeLms: def?.type ?? 'VACADEMY',
            };
            // Mirror the default connection's flat fields for legacy readers (determineActiveLms, apply).
            // Skip the structural keys so a custom field named e.g. "activeLms"/"connections" can't
            // clobber the envelope above.
            if (def) {
                const reserved = new Set([
                    'id',
                    'type',
                    'name',
                    'activeLms',
                    'defaultConnectionId',
                    'connections',
                ]);
                Object.entries(def).forEach(([k, v]) => {
                    if (!reserved.has(k)) data[k] = v;
                });
            }
            await saveInstituteSettingKey('LMS_SETTING', data, 'LMS Setting');
            toast.success(t('toasts.saveSuccess'));
            await load();
        } catch (e) {
            console.error('Failed to save LMS settings', e);
            toast.error(t('toasts.saveFailed'));
        } finally {
            setSaving(false);
            setConfirmSaveOpen(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <h1 className="flex items-center gap-2 text-lg font-bold">
                    <PlugsConnected className="size-6 text-primary-500" weight="fill" />
                    {t('header.title')}
                </h1>
                <p className="text-sm text-neutral-500">{t('header.subtitle')}</p>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                    <CircleNotch className="size-10 animate-spin text-primary-500" />
                    <p className="mt-4 text-neutral-500">{t('loading')}</p>
                </div>
            ) : (
                <div className="space-y-5">
                    {configSource === 'COURSE' && (
                        <div className="flex items-start gap-3 rounded-lg border border-info-200 bg-info-50 p-4">
                            <Info className="mt-0.5 size-5 shrink-0 text-info-600" weight="fill" />
                            <p className="text-sm text-info-700">
                                <Trans i18nKey="settingsLms:banner.courseSourceInfo">
                                    We found an LMS connection already configured on one of your courses and listed it below. Review it and click <span className="font-semibold">Save</span> to keep it as an institute connection.
                                </Trans>
                            </p>
                        </div>
                    )}

                    {/* ── Existing connections ── */}
                    {connections.length === 0 && !draft ? (
                        <Card>
                            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                                <Sparkle className="size-8 text-neutral-300" weight="fill" />
                                <p className="text-sm font-medium text-neutral-600">
                                    {t('emptyState.title')}
                                </p>
                                <p className="max-w-md text-xs text-neutral-400">
                                    {t('emptyState.description')}
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-3">
                            {connections.map((c) => {
                                const Icon = typeIcon(c.type);
                                const isDefault = c.id === defaultId;
                                return (
                                    <div
                                        key={c.id}
                                        className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4"
                                    >
                                        <div className="flex min-w-0 items-center gap-3">
                                            <Icon
                                                className="size-6 shrink-0 text-primary-500"
                                                weight="fill"
                                            />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate font-semibold text-neutral-800">
                                                        {c.name}
                                                    </span>
                                                    {isDefault && (
                                                        <span className="flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-caption font-medium text-primary-700">
                                                            <Star
                                                                className="size-3"
                                                                weight="fill"
                                                            />{' '}
                                                            {t('connectionCard.defaultBadge')}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-neutral-500">
                                                    {displayName(c.type)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            {!isDefault && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setDefaultId(c.id)}
                                                    className="text-xs text-neutral-500"
                                                >
                                                    {t('connectionCard.makeDefault')}
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => startEdit(c)}
                                                aria-label={t('connectionCard.editAriaLabel')}
                                            >
                                                <PencilSimple className="size-4 text-neutral-500" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removeConnection(c.id)}
                                                aria-label={t('connectionCard.removeAriaLabel')}
                                            >
                                                <Trash className="size-4 text-danger-500" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── Add buttons ── */}
                    {!draft && (
                        <div className="flex flex-wrap gap-2">
                            {connectable.map((p) => (
                                <Button
                                    key={p.id}
                                    variant="outline"
                                    onClick={() => startAdd(p.id)}
                                    className="gap-2"
                                >
                                    <Plus className="size-4" />
                                    {t('addProvider', { name: p.displayName })}
                                </Button>
                            ))}
                        </div>
                    )}

                    {/* ── Connection editor ── */}
                    {draft && (
                        <Card>
                            <CardContent className="space-y-5 pt-6">
                                <div className="flex items-center justify-between">
                                    <h2 className="font-semibold text-neutral-800">
                                        {draftIsNew
                                            ? t('editor.addHeading', {
                                                  name: displayName(draft.type),
                                              })
                                            : t('editor.editHeading', {
                                                  name: displayName(draft.type),
                                              })}
                                    </h2>
                                    {meta(draft.type)?.docsUrl && (
                                        <a
                                            href={meta(draft.type)?.docsUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
                                        >
                                            {t('editor.docsLink')}{' '}
                                            <ArrowSquareOut className="size-3.5" />
                                        </a>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="conn-name" className="text-sm">
                                        {t('editor.connectionName.label')}{' '}
                                        <span className="text-danger-500">*</span>
                                    </Label>
                                    <Input
                                        id="conn-name"
                                        value={draft.name}
                                        onChange={(e) => setDraftField('name', e.target.value)}
                                        placeholder={t('editor.connectionName.placeholder')}
                                        className={cn(
                                            showErrors && !draft.name.trim() && 'border-danger-400'
                                        )}
                                    />
                                    <p className="text-caption text-neutral-400">
                                        {t('editor.connectionName.hint')}
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                                    {draftFields.map((f) => {
                                        const err = showErrors ? draftError(f) : null;
                                        const isSecret = f.type === 'secret';
                                        const show = revealed[f.key];
                                        return (
                                            <div key={f.key} className="space-y-1.5">
                                                <Label
                                                    htmlFor={`f-${f.key}`}
                                                    className="flex items-center gap-1 text-sm"
                                                >
                                                    {f.label}
                                                    {f.required ? (
                                                        <span className="text-danger-500">*</span>
                                                    ) : (
                                                        <span className="text-caption text-neutral-400">
                                                            {t('editor.optional')}
                                                        </span>
                                                    )}
                                                </Label>
                                                <div className="relative">
                                                    <Input
                                                        id={`f-${f.key}`}
                                                        type={
                                                            isSecret && !show ? 'password' : 'text'
                                                        }
                                                        value={draft[f.key] ?? ''}
                                                        onChange={(e) =>
                                                            setDraftField(f.key, e.target.value)
                                                        }
                                                        placeholder={f.placeholder}
                                                        className={cn(
                                                            isSecret && 'pr-9',
                                                            err &&
                                                                'border-danger-400 focus-visible:ring-danger-400'
                                                        )}
                                                    />
                                                    {isSecret && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setRevealed((p) => ({
                                                                    ...p,
                                                                    [f.key]: !p[f.key],
                                                                }))
                                                            }
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                                                            aria-label={
                                                                show
                                                                    ? t('editor.secretField.hide')
                                                                    : t('editor.secretField.show')
                                                            }
                                                        >
                                                            {show ? (
                                                                <EyeSlash className="size-4" />
                                                            ) : (
                                                                <Eye className="size-4" />
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                                {f.help && !err && (
                                                    <p className="text-caption text-neutral-400">
                                                        {f.help}
                                                    </p>
                                                )}
                                                {err && (
                                                    <p className="text-caption text-danger-500">
                                                        {err}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-sm">
                                        {t('editor.customFields.label')}
                                    </Label>
                                    {draftExtras.map((row, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <Input
                                                value={row.key}
                                                onChange={(e) =>
                                                    updateDraftExtra(i, 'key', e.target.value)
                                                }
                                                placeholder={t(
                                                    'editor.customFields.keyPlaceholder'
                                                )}
                                                className="md:max-w-xs"
                                            />
                                            <Input
                                                value={row.value}
                                                onChange={(e) =>
                                                    updateDraftExtra(i, 'value', e.target.value)
                                                }
                                                placeholder={t(
                                                    'editor.customFields.valuePlaceholder'
                                                )}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removeDraftExtra(i)}
                                                aria-label={t(
                                                    'editor.customFields.removeAriaLabel'
                                                )}
                                            >
                                                <Trash className="size-4 text-danger-500" />
                                            </Button>
                                        </div>
                                    ))}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={addDraftExtra}
                                        className="gap-1 text-primary-600"
                                    >
                                        <Plus className="size-4" /> {t('editor.customFields.addField')}
                                    </Button>
                                    <p className="text-caption text-neutral-400">
                                        {t('editor.customFields.hint')}
                                    </p>
                                </div>

                                {testResult && (
                                    <div
                                        className={cn(
                                            'flex items-start gap-3 rounded-lg border p-3',
                                            testResult.ok
                                                ? 'border-success-200 bg-success-50'
                                                : 'border-danger-200 bg-danger-50'
                                        )}
                                    >
                                        {testResult.ok ? (
                                            <CheckCircle
                                                className="mt-0.5 size-5 shrink-0 text-success-600"
                                                weight="fill"
                                            />
                                        ) : (
                                            <XCircle
                                                className="mt-0.5 size-5 shrink-0 text-danger-600"
                                                weight="fill"
                                            />
                                        )}
                                        <p
                                            className={cn(
                                                'text-sm font-medium',
                                                testResult.ok
                                                    ? 'text-success-700'
                                                    : 'text-danger-700'
                                            )}
                                        >
                                            {testResult.message}
                                        </p>
                                    </div>
                                )}

                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <Button
                                        variant="ghost"
                                        onClick={cancelDraft}
                                        disabled={testing}
                                    >
                                        {t('editor.cancel')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={handleTest}
                                        disabled={testing}
                                        className="gap-2"
                                    >
                                        {testing ? (
                                            <CircleNotch className="size-4 animate-spin" />
                                        ) : (
                                            <PlugsConnected className="size-4" />
                                        )}
                                        {testing ? t('editor.testing') : t('editor.testConnection')}
                                    </Button>
                                    <MyButton
                                        onClick={commitDraft}
                                        className="gap-2 bg-primary-500"
                                    >
                                        <CheckCircle className="size-4" />
                                        {draftIsNew ? t('editor.addSubmit') : t('editor.updateSubmit')}
                                    </MyButton>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* ── Save all ── */}
                    {!draft && (
                        <div className="flex justify-end">
                            <MyButton
                                onClick={() => setConfirmSaveOpen(true)}
                                disabled={saving}
                                className="gap-2 bg-primary-500"
                            >
                                <FloppyDisk className="size-4" />
                                {saving ? t('saving') : t('save')}
                            </MyButton>
                        </div>
                    )}
                </div>
            )}

            <AlertDialog open={confirmSaveOpen} onOpenChange={setConfirmSaveOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('confirmSaveDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            <Trans i18nKey="settingsLms:confirmSaveDialog.description">
                                Changes to an <span className="font-semibold">existing</span> connection (URL, credentials, token) apply to every course already using it — so an incorrect edit can break enrolment sync for those courses. New connections won&apos;t affect anything until you apply them to a course. Double-check before saving.
                            </Trans>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>
                            {t('confirmSaveDialog.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                void handleSaveAll();
                            }}
                            disabled={saving}
                            className="bg-primary-500"
                        >
                            {saving ? t('saving') : t('confirmSaveDialog.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default LmsSettings;
