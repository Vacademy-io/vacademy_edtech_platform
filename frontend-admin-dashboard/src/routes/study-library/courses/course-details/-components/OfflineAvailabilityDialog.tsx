import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WarningCircle, WifiSlash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { getOfflineEffective, getOfflineRules, saveOfflineRules } from '@/services/offline-access';
import { computeOnlineOnlyWarning } from '@/utils/offline-access-tree';
import type {
    OfflineManifestDTO,
    OfflineSourceType,
    OfflineTriState,
} from '@/types/offline-access';

interface OfflineAvailabilityDialogProps {
    open: boolean;
    onClose: () => void;
    sourceType: OfflineSourceType;
    sourceId: string;
    /** Always required — even for PACKAGE-level rules it resolves the batch used to fetch context. */
    packageSessionId: string;
    nodeName: string;
}

function buildNodeLabel(t: TFunction): Record<OfflineSourceType, string> {
    return {
        PACKAGE: t('nodeLabel.package'),
        PACKAGE_SESSION: t('nodeLabel.packageSession'),
        SUBJECT: t('nodeLabel.subject'),
        MODULE: t('nodeLabel.module'),
        CHAPTER: t('nodeLabel.chapter'),
        SLIDE: t('nodeLabel.slide'),
    };
}

export function OfflineAvailabilityDialog({
    open,
    onClose,
    sourceType,
    sourceId,
    packageSessionId,
    nodeName,
}: OfflineAvailabilityDialogProps) {
    const { t } = useTranslation('studyLibraryOfflineAvailabilityDialog');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [value, setValue] = useState<OfflineTriState>('INHERIT');
    const [manifest, setManifest] = useState<OfflineManifestDTO | null>(null);
    const nodeLabel = buildNodeLabel(t);

    useEffect(() => {
        if (!open || !packageSessionId) return;
        let active = true;
        setLoading(true);
        Promise.all([getOfflineRules(packageSessionId), getOfflineEffective(packageSessionId)])
            .then(([rules, effective]) => {
                if (!active) return;
                const rule = rules.find(
                    (r) => r.source_type === sourceType && r.source_id === sourceId
                );
                setValue(rule ? (rule.allow ? 'ALLOW' : 'BLOCK') : 'INHERIT');
                setManifest(effective);
            })
            .catch(() => {
                if (active) toast.error(t('loadFailed'));
            })
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [open, packageSessionId, sourceType, sourceId]);

    const warning = computeOnlineOnlyWarning(manifest, sourceType, sourceId);

    const handleSave = async () => {
        try {
            setSaving(true);
            await saveOfflineRules([
                {
                    source_type: sourceType,
                    source_id: sourceId,
                    package_session_id: sourceType === 'PACKAGE' ? undefined : packageSessionId,
                    allow: value === 'INHERIT' ? null : value === 'ALLOW',
                },
            ]);
            toast.success(t('saved'));
            onClose();
        } catch {
            toast.error(t('saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onClose}
            heading={t('offlineAvailabilityFor', { name: nodeName })}
        >
            <div className="space-y-4 p-1">
                {loading ? (
                    <div className="py-8 text-center text-sm text-neutral-500">
                        {t('loadingEllipsis')}
                    </div>
                ) : (
                    <>
                        <p className="text-caption text-neutral-500">
                            {t('canLearnersDownload', { node: nodeLabel[sourceType] })}
                        </p>

                        <RadioGroup
                            value={value}
                            onValueChange={(v) => setValue(v as OfflineTriState)}
                            className="gap-3"
                        >
                            <div className="flex items-start gap-2">
                                <RadioGroupItem
                                    value="INHERIT"
                                    id="offline-inherit"
                                    className="mt-0.5"
                                />
                                <div>
                                    <Label htmlFor="offline-inherit">
                                        {t('inheritDefault')}
                                    </Label>
                                    <p className="text-caption text-neutral-400">
                                        {t('inheritDescription')}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <RadioGroupItem
                                    value="ALLOW"
                                    id="offline-allow"
                                    className="mt-0.5"
                                />
                                <div>
                                    <Label htmlFor="offline-allow">{t('allow')}</Label>
                                    <p className="text-caption text-neutral-400">
                                        {t('allowDescription')}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <RadioGroupItem
                                    value="BLOCK"
                                    id="offline-block"
                                    className="mt-0.5"
                                />
                                <div>
                                    <Label htmlFor="offline-block">{t('block')}</Label>
                                    <p className="text-caption text-neutral-400">
                                        {t('blockDescription')}
                                    </p>
                                </div>
                            </div>
                        </RadioGroup>

                        {warning && warning.onlineOnlyCount > 0 && (
                            <Alert className="border-warning-200 bg-warning-50">
                                <WifiSlash className="size-4 text-warning-600" />
                                <AlertDescription className="text-caption text-warning-700">
                                    {sourceType === 'SLIDE'
                                        ? t('onlineOnlyWarningSlide', {
                                              online: warning.onlineOnlyCount,
                                              total: warning.totalSlides,
                                              count: warning.totalSlides,
                                          })
                                        : t('onlineOnlyWarningSection', {
                                              online: warning.onlineOnlyCount,
                                              total: warning.totalSlides,
                                              count: warning.totalSlides,
                                          })}
                                </AlertDescription>
                            </Alert>
                        )}

                        {manifest === null && (
                            <Alert className="border-neutral-200 bg-neutral-50">
                                <WarningCircle className="size-4 text-neutral-500" />
                                <AlertDescription className="text-caption text-neutral-500">
                                    {t('noPreviewWarning')}
                                </AlertDescription>
                            </Alert>
                        )}
                    </>
                )}

                <div className="flex justify-end gap-2 border-t pt-4">
                    <MyButton buttonType="secondary" onClick={onClose} disabled={saving}>
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        onClick={handleSave}
                        disabled={loading || saving}
                        className="bg-primary-500"
                    >
                        {saving ? t('savingEllipsis') : t('save')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}
