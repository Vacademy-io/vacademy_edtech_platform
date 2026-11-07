import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import {
    SLIDE_TYPE_OPTIONS,
    defaultDownloadFor,
    type SlideDownloadPermissionData,
} from '@/constants/slide-download-permission';
import {
    getSlideDownloadPermission,
    saveSlideDownloadPermission,
} from '../../-services/slide-download-permission-service';

interface SlideDownloadCardProps {
    /** Canonical stored role key (e.g. ADMIN / TEACHER / LEARNER or a custom role name, uppercased). */
    roleKey: string;
    /** Display label for this role, used in the card copy (e.g. "learners", "teachers"). */
    roleLabel: string;
}

/**
 * SLIDE_TYPE_OPTIONS (imported from ../../../../constants/slide-download-permission,
 * outside this i18n pass) ships its own English `label`. Map each stored option
 * key to a translated-label lookup key here; unmapped keys (e.g. a slide type
 * added to that constant later) fall back to the constant's English label.
 */
const SLIDE_TYPE_LABEL_KEYS: Record<string, string> = {
    DOCUMENT_PDF: 'slideTypes.documentPdfDownload',
    DOCUMENT_PDF_PRINT: 'slideTypes.documentPdfPrint',
    DOCUMENT_CODE: 'slideTypes.documentCode',
    ASSIGNMENT: 'slideTypes.assignment',
    VIDEO: 'slideTypes.video',
    DOCUMENT_DOC: 'slideTypes.documentDoc',
    AUDIO: 'slideTypes.audio',
    IMAGE: 'slideTypes.image',
};

/**
 * Per-role "Slide Downloads" card, rendered inside each role's Display Settings
 * panel. It edits only this role's column of the shared
 * SLIDE_DOWNLOAD_PERMISSION_SETTING blob (other roles are preserved on save),
 * so the same setting powers every role panel and the learner-app enforcement.
 */
export default function SlideDownloadCard({ roleKey, roleLabel }: SlideDownloadCardProps) {
    const { t } = useTranslation('settingsSlideDownloadCard');
    const queryClient = useQueryClient();
    const [flags, setFlags] = useState<Record<string, boolean>>({});
    const [dirty, setDirty] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['slide-download-permission'],
        queryFn: getSlideDownloadPermission,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (!data) return;
        const next: Record<string, boolean> = {};
        for (const opt of SLIDE_TYPE_OPTIONS) {
            const stored = data.slideTypes?.[opt.key]?.roles?.[roleKey];
            next[opt.key] =
                typeof stored === 'boolean' ? stored : defaultDownloadFor(roleKey, opt.key);
        }
        setFlags(next);
        setDirty(false);
    }, [data, roleKey]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: async () => {
            // Merge this role's flags into the full blob, preserving every other
            // role's existing values and any slide types not shown here.
            const base: SlideDownloadPermissionData = data
                ? { version: data.version ?? 1, slideTypes: { ...data.slideTypes } }
                : { version: 1, slideTypes: {} };
            const slideTypes = { ...base.slideTypes };
            for (const opt of SLIDE_TYPE_OPTIONS) {
                const existingRoles = slideTypes[opt.key]?.roles ?? {};
                slideTypes[opt.key] = {
                    roles: { ...existingRoles, [roleKey]: !!flags[opt.key] },
                };
            }
            await saveSlideDownloadPermission({ version: base.version, slideTypes });
        },
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            setDirty(false);
            queryClient.invalidateQueries({ queryKey: ['slide-download-permission'] });
        },
        onError: () => {
            toast.error(t('toasts.saveError'));
        },
    });

    const toggle = (key: string) => {
        setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
        setDirty(true);
    };

    if (isLoading) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('header.title')}</CardTitle>
                <CardDescription>{t('header.description', { roleLabel })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {SLIDE_TYPE_OPTIONS.map((opt) => {
                    const id = `slide-dl-${roleKey}-${opt.key}`;
                    const labelKey = SLIDE_TYPE_LABEL_KEYS[opt.key];
                    const label = labelKey ? t(labelKey) : opt.label;
                    return (
                        <div key={opt.key} className="flex items-center justify-between gap-3">
                            <Label
                                htmlFor={id}
                                className="cursor-pointer text-sm font-medium text-neutral-800"
                            >
                                {label}
                            </Label>
                            <Switch
                                id={id}
                                checked={!!flags[opt.key]}
                                onCheckedChange={() => toggle(opt.key)}
                            />
                        </div>
                    );
                })}
                <div className="flex justify-end border-t pt-4">
                    <MyButton buttonType="primary" onClick={() => save()} disable={saving || !dirty}>
                        {saving ? t('footer.saving') : t('footer.save')}
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
}
