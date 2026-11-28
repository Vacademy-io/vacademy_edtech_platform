import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { AlertTriangle, Braces, Loader2, RotateCcw, Save, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    EMPTY_COURSE_SETTING,
    getPackageCourseSettingRaw,
    savePackageCourseSettingRaw,
    validateCourseSettingJson,
} from '@/services/package-settings';

interface PackageCourseSettingEditorProps {
    packageId: string;
    /** Notified after a successful save (e.g. to refresh the LMS badge). */
    onSaved?: () => void;
}

// Scaffolds for common keys workflows read. Admins tweak the values inline —
// these just remove the boilerplate of the double-`data` envelope shape.
function buildSnippets(t: TFunction): Record<string, { key: string; name: string; data: unknown }> {
    return {
        [t('snippets.moodleLabel')]: {
            key: 'MOODLE_SETTING',
            name: t('snippets.moodleName'),
            data: { data: { moodleToken: '', moodleBaseUrl: '', moodleCourseId: '' } },
        },
        [t('snippets.learnDashLabel')]: {
            key: 'LMS_SETTING',
            name: t('snippets.learnDashName'),
            data: { data: { activeLms: 'LEARNDASH', learndash_base_url: '' } },
        },
        [t('snippets.courseSettingsLabel')]: {
            key: 'COURSE_SETTING',
            name: t('snippets.courseSettingsName'),
            data: { retentionPeriod: 0, lmsUrl: '' },
        },
    };
}

export const PackageCourseSettingEditor: React.FC<PackageCourseSettingEditorProps> = ({
    packageId,
    onSaved,
}) => {
    const { t } = useTranslation('studyLibraryPackageCourseSettingEditor');
    const SNIPPETS = useMemo(() => buildSnippets(t), [t]);
    const [original, setOriginal] = useState<string>(EMPTY_COURSE_SETTING);
    const [value, setValue] = useState<string>(EMPTY_COURSE_SETTING);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    useEffect(() => {
        let active = true;
        setLoading(true);
        getPackageCourseSettingRaw(packageId)
            .then((raw) => {
                if (!active) return;
                let pretty = raw;
                try {
                    pretty = JSON.stringify(JSON.parse(raw), null, 2);
                } catch {
                    /* leave server string as-is if it isn't parseable */
                }
                setOriginal(pretty);
                setValue(pretty);
            })
            .catch((e) => {
                console.error('Failed to load course settings JSON', e);
                toast.error(t('errors.loadFailed'));
            })
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [packageId, t]);

    const validationError = useMemo<string | null>(() => {
        try {
            validateCourseSettingJson(value);
            return null;
        } catch (e) {
            return e instanceof Error ? e.message : t('errors.invalidJson');
        }
    }, [value, t]);

    const isValid = validationError === null;
    const hasChanges = value !== original;

    const handleFormat = () => {
        try {
            setValue(validateCourseSettingJson(value));
        } catch {
            toast.error(t('errors.formatFailed'));
        }
    };

    const handleInsertSnippet = (label: string) => {
        const snippet = SNIPPETS[label];
        if (!snippet) return;
        let root: { setting?: Record<string, unknown>; [k: string]: unknown } = { setting: {} };
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                root = parsed;
            }
        } catch {
            // start from an empty envelope if the current text isn't parseable
        }
        const settingObj: Record<string, unknown> =
            root.setting && typeof root.setting === 'object' && !Array.isArray(root.setting)
                ? (root.setting as Record<string, unknown>)
                : {};
        settingObj[snippet.key] = {
            key: snippet.key,
            name: snippet.name,
            data: snippet.data,
        };
        root.setting = settingObj;
        setValue(JSON.stringify(root, null, 2));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            const pretty = validateCourseSettingJson(value);
            await savePackageCourseSettingRaw(packageId, pretty);
            setOriginal(pretty);
            setValue(pretty);
            toast.success(t('saveSuccess'));
            onSaved?.();
        } catch (e) {
            console.error('Failed to save course settings JSON', e);
            toast.error(e instanceof Error ? e.message : t('errors.saveFailed'));
        } finally {
            setSaving(false);
            setConfirmOpen(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-4">
                    <CardTitle className="flex items-center gap-2">
                        <Braces className="size-5 text-primary-500" />
                        {t('advancedSettingsTitle')}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={handleFormat} disabled={loading || saving || !isValid}>
                            {t('actions.format')}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setValue(original)}
                            disabled={loading || saving || !hasChanges}
                        >
                            <RotateCcw className="me-2 size-4" />
                            {t('actions.reset')}
                        </Button>
                        <MyButton
                            onClick={() => setConfirmOpen(true)}
                            disabled={loading || saving || !isValid || !hasChanges}
                            className="bg-primary-500"
                        >
                            <Save className="me-2 size-4" />
                            {saving ? t('actions.saving') : t('actions.save')}
                        </MyButton>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    <Trans i18nKey="studyLibraryPackageCourseSettingEditor:description">
                        These settings are stored on this course and read by workflows (LMS config,
                        retention, completion thresholds, etc.). Edit the raw JSON below — it must
                        stay wrapped in a <code>{'{ "setting": { ... } }'}</code> envelope.
                    </Trans>
                </p>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{t('insertTemplate')}:</span>
                    {Object.keys(SNIPPETS).map((label) => (
                        <Button
                            key={label}
                            size="sm"
                            variant="outline"
                            onClick={() => handleInsertSnippet(label)}
                            disabled={loading || saving}
                        >
                            + {label}
                        </Button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                        <Loader2 className="me-2 size-5 animate-spin" /> {t('loading')}
                    </div>
                ) : (
                    <>
                        <Textarea
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            spellCheck={false}
                            className="min-h-[360px] font-mono text-xs leading-relaxed"
                        />
                        {validationError ? (
                            <Alert variant="destructive">
                                <AlertTriangle className="size-4" />
                                <AlertDescription>
                                    {t('invalidJson', { message: validationError })}
                                </AlertDescription>
                            </Alert>
                        ) : (
                            <p className="flex items-center gap-1.5 text-xs text-green-700">
                                <CheckCircle className="size-3.5" /> {t('validJson')}
                            </p>
                        )}
                    </>
                )}
            </CardContent>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent className="z-[10001]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('confirmDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('confirmDialog.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>{t('confirmDialog.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                handleSave();
                            }}
                            disabled={saving}
                            className="bg-primary-500"
                        >
                            {saving ? t('confirmDialog.saving') : t('confirmDialog.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
};
