import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/ui/color-picker';
import { UploadSimple, X, Eye, CircleNotch, Crop } from '@phosphor-icons/react';
import { ReportBrandingSettings, DEFAULT_REPORT_BRANDING } from '@/types/assessment-settings';
import { Slider } from '@/components/ui/slider';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getPublicUrl } from '@/services/upload_file';
import { UploadFileInS3 } from '@/services/upload_file';
import { toast } from 'sonner';
import { ImageCropperDialog } from '@/components/design-system/image-cropper-dialog';

interface Props {
    settings: ReportBrandingSettings;
    onChange: (updated: ReportBrandingSettings) => void;
}

const ReportBrandingSettingsSection = ({ settings, onChange }: Props) => {
    const { t } = useTranslation('settingsReportBranding');
    const [previewOpen, setPreviewOpen] = useState(false);
    const [logoUrl, setLogoUrl] = useState<string>('');
    const [letterheadUrl, setLetterheadUrl] = useState<string>('');
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [uploadingLetterhead, setUploadingLetterhead] = useState(false);
    const [cropperOpen, setCropperOpen] = useState(false);
    const [cropperSrc, setCropperSrc] = useState<string>('');
    const [cropperField, setCropperField] = useState<'letterhead_file_id' | 'logo_file_id'>('letterhead_file_id');
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);

    const update = (partial: Partial<ReportBrandingSettings>) => {
        onChange({ ...settings, ...partial });
    };

    const s = { ...DEFAULT_REPORT_BRANDING, ...settings };

    // Resolve file IDs to URLs for display
    useEffect(() => {
        const resolveUrls = async () => {
            // Resolve logo
            const logoId = s.logo_file_id || (instituteDetails as any)?.institute_logo_file_id;
            if (logoId && !logoId.startsWith('data:')) {
                const url = await getPublicUrl(logoId);
                if (url) setLogoUrl(url);
            } else if (logoId?.startsWith('data:')) {
                setLogoUrl(logoId);
            }

            // Resolve letterhead
            const lhId = s.letterhead_file_id || (instituteDetails as any)?.letter_head_file_id;
            if (lhId && !lhId.startsWith('data:')) {
                const url = await getPublicUrl(lhId);
                if (url) setLetterheadUrl(url);
            } else if (lhId?.startsWith('data:')) {
                setLetterheadUrl(lhId);
            }

            // If settings don't have file IDs yet but institute does, pre-fill them
            if (!s.logo_file_id && (instituteDetails as any)?.institute_logo_file_id) {
                update({ logo_file_id: (instituteDetails as any).institute_logo_file_id });
            }
            if (!s.letterhead_file_id && (instituteDetails as any)?.letter_head_file_id) {
                update({ letterhead_file_id: (instituteDetails as any).letter_head_file_id });
            }
        };
        resolveUrls();
    }, [s.logo_file_id, s.letterhead_file_id, instituteDetails]);

    const handleImageSelect = (
        field: 'letterhead_file_id' | 'logo_file_id',
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];
        if (!file) return;
        // Read file as data URL and open cropper
        const reader = new FileReader();
        reader.onloadend = () => {
            setCropperSrc(reader.result as string);
            setCropperField(field);
            setCropperOpen(true);
        };
        reader.readAsDataURL(file);
        // Reset input so the same file can be selected again
        event.target.value = '';
    };

    const handleCroppedUpload = async (croppedFile: File) => {
        const setUploading = cropperField === 'logo_file_id' ? setUploadingLogo : setUploadingLetterhead;
        setUploading(true);

        try {
            const fileId = await UploadFileInS3(
                croppedFile,
                () => {},
                'SYSTEM',
                'REPORT_BRANDING',
                'INSTITUTE'
            );
            if (fileId) {
                update({ [cropperField]: fileId });
                const url = await getPublicUrl(fileId);
                if (cropperField === 'logo_file_id') setLogoUrl(url);
                else setLetterheadUrl(url);
                toast.success(
                    cropperField === 'logo_file_id'
                        ? t('toasts.logoUploaded')
                        : t('toasts.letterheadUploaded')
                );
            }
        } catch {
            toast.error(t('toasts.uploadFailed'));
        } finally {
            setUploading(false);
        }
    };

    const handleRemoveImage = (field: 'letterhead_file_id' | 'logo_file_id') => {
        update({ [field]: null });
        if (field === 'logo_file_id') setLogoUrl('');
        else setLetterheadUrl('');
    };

    // Replace template placeholders for preview
    const resolveTemplate = (html: string) =>
        html.replace(/\{\{assessment_name\}\}/g, t('preview.sample.assessmentName'));

    return (
        <div className="flex flex-col gap-4">
            {/* Colors */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('colors.title')}</CardTitle>
                    <CardDescription>{t('colors.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-6">
                        <div className="flex flex-col gap-2">
                            <Label className="text-sm">{t('colors.primaryColor')}</Label>
                            <div className="flex items-center gap-3">
                                <ColorPicker
                                    value={s.primary_color}
                                    onChange={(val) => update({ primary_color: val })}
                                />
                                <Input
                                    value={s.primary_color}
                                    onChange={(e) =>
                                        update({ primary_color: e.target.value })
                                    }
                                    className="w-28"
                                    maxLength={7}
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className="text-sm">{t('colors.secondaryColor')}</Label>
                            <div className="flex items-center gap-3">
                                <ColorPicker
                                    value={s.secondary_color}
                                    onChange={(val) => update({ secondary_color: val })}
                                />
                                <Input
                                    value={s.secondary_color}
                                    onChange={(e) =>
                                        update({ secondary_color: e.target.value })
                                    }
                                    className="w-28"
                                    maxLength={7}
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Logo & Letterhead */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('logoLetterhead.title')}</CardTitle>
                    <CardDescription>{t('logoLetterhead.description')}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {/* Logo */}
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-1">
                                <Label className="text-sm font-medium">
                                    {t('logoLetterhead.logo.label')}
                                </Label>
                                <p className="text-xs text-gray-500">
                                    {t('logoLetterhead.logo.hint')}
                                </p>
                            </div>
                            {logoUrl ? (
                                <div className="relative">
                                    <img
                                        src={logoUrl}
                                        alt={t('logoLetterhead.logo.imageAlt')}
                                        className="h-12 w-12 rounded border object-contain p-0.5"
                                    />
                                    <button
                                        className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white"
                                        onClick={() => handleRemoveImage('logo_file_id')}
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed text-xs text-gray-400">
                                    {t('logoLetterhead.logo.none')}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <input
                                type="file"
                                id="report-logo-upload"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => handleImageSelect('logo_file_id', e)}
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={uploadingLogo}
                                onClick={() =>
                                    document.getElementById('report-logo-upload')?.click()
                                }
                            >
                                {uploadingLogo ? (
                                    <CircleNotch size={14} className="me-1 animate-spin" />
                                ) : (
                                    <UploadSimple size={14} className="me-1" />
                                )}
                                {logoUrl
                                    ? t('logoLetterhead.logo.change')
                                    : t('logoLetterhead.logo.upload')}
                            </Button>
                            <Switch
                                checked={s.show_logo_in_header}
                                onCheckedChange={(v) => update({ show_logo_in_header: v })}
                            />
                        </div>
                    </div>

                    {/* Letterhead */}
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-1">
                                <Label className="text-sm font-medium">
                                    {t('logoLetterhead.letterhead.label')}
                                </Label>
                                <p className="text-xs text-gray-500">
                                    {t('logoLetterhead.letterhead.hint')}
                                </p>
                            </div>
                            {letterheadUrl ? (
                                <div className="relative">
                                    <img
                                        src={letterheadUrl}
                                        alt={t('logoLetterhead.letterhead.imageAlt')}
                                        className="h-12 w-20 rounded border object-contain p-0.5"
                                    />
                                    <button
                                        className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white"
                                        onClick={() =>
                                            handleRemoveImage('letterhead_file_id')
                                        }
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex h-12 w-20 items-center justify-center rounded border border-dashed text-xs text-gray-400">
                                    {t('logoLetterhead.letterhead.none')}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <input
                                type="file"
                                id="report-letterhead-upload"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) =>
                                    handleImageSelect('letterhead_file_id', e)
                                }
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={uploadingLetterhead}
                                onClick={() =>
                                    document
                                        .getElementById('report-letterhead-upload')
                                        ?.click()
                                }
                            >
                                {uploadingLetterhead ? (
                                    <CircleNotch size={14} className="me-1 animate-spin" />
                                ) : (
                                    <UploadSimple size={14} className="me-1" />
                                )}
                                {letterheadUrl
                                    ? t('logoLetterhead.letterhead.change')
                                    : t('logoLetterhead.letterhead.upload')}
                            </Button>
                            {letterheadUrl && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setCropperSrc(letterheadUrl);
                                        setCropperField('letterhead_file_id');
                                        setCropperOpen(true);
                                    }}
                                >
                                    <Crop size={14} className="mr-1" />
                                    {t('logoLetterhead.letterhead.crop')}
                                </Button>
                            )}
                            <Switch
                                checked={s.show_letterhead}
                                onCheckedChange={(v) => update({ show_letterhead: v })}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Watermark */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('watermark.title')}</CardTitle>
                    <CardDescription>{t('watermark.description')}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="flex flex-col gap-1">
                            <Label className="text-sm font-medium">{t('watermark.enable')}</Label>
                        </div>
                        <Switch
                            checked={s.show_watermark}
                            onCheckedChange={(v) => update({ show_watermark: v })}
                        />
                    </div>
                    {s.show_watermark && (
                        <div className="flex flex-col gap-3 pl-2">
                            <div className="flex flex-col gap-1">
                                <Label className="text-sm">{t('watermark.textLabel')}</Label>
                                <Input
                                    value={s.watermark_text}
                                    onChange={(e) =>
                                        update({ watermark_text: e.target.value })
                                    }
                                    placeholder={t('watermark.textPlaceholder')}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label className="text-sm">
                                    {t('watermark.opacity', {
                                        percent: Math.round(s.watermark_opacity * 100),
                                    })}
                                </Label>
                                <Slider
                                    value={[s.watermark_opacity * 100]}
                                    onValueChange={([v = 5]) =>
                                        update({ watermark_opacity: v / 100 })
                                    }
                                    min={1}
                                    max={30}
                                    step={1}
                                    className="w-60"
                                />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Header & Footer */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('headerFooter.title')}</CardTitle>
                    <CardDescription>
                        {t('headerFooter.description.prefix')}{' '}
                        <code className="rounded bg-gray-100 px-1 text-xs">{'{{assessment_name}}'}</code>{' '}
                        {t('headerFooter.description.suffix')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <Label className="text-sm">{t('headerFooter.footerText.label')}</Label>
                        <Input
                            value={s.footer_text}
                            onChange={(e) => update({ footer_text: e.target.value })}
                            placeholder={t('headerFooter.footerText.placeholder')}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-sm">{t('headerFooter.headerHtml.label')}</Label>
                        <Textarea
                            value={s.header_html}
                            onChange={(e) => update({ header_html: e.target.value })}
                            placeholder={t('headerFooter.headerHtml.placeholder')}
                            rows={3}
                            className="font-mono text-xs"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-sm">{t('headerFooter.footerHtml.label')}</Label>
                        <Textarea
                            value={s.footer_html}
                            onChange={(e) => update({ footer_html: e.target.value })}
                            placeholder={t('headerFooter.footerHtml.placeholder')}
                            rows={3}
                            className="font-mono text-xs"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Preview */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('preview.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <Button
                        variant="outline"
                        onClick={() => setPreviewOpen(!previewOpen)}
                        className="flex items-center gap-2"
                    >
                        <Eye size={16} />
                        {previewOpen ? t('preview.hideButton') : t('preview.showButton')}
                    </Button>
                    {previewOpen && (
                        <div className="mt-4 rounded-lg border shadow-sm">
                            <div
                                className="relative mx-auto bg-white"
                                style={{
                                    width: '100%',
                                    maxWidth: 600,
                                    minHeight: 400,
                                    position: 'relative',
                                    overflow: 'hidden',
                                }}
                            >
                                {/* Letterhead background */}
                                {s.show_letterhead && letterheadUrl && (
                                    <img
                                        src={letterheadUrl}
                                        alt=""
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'cover',
                                            opacity: 0.15,
                                            pointerEvents: 'none',
                                        }}
                                    />
                                )}

                                {/* Watermark */}
                                {s.show_watermark && s.watermark_text && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: '50%',
                                            left: '50%',
                                            transform:
                                                'translate(-50%, -50%) rotate(-35deg)',
                                            fontSize: 48,
                                            fontWeight: 'bold',
                                            color: s.primary_color,
                                            opacity: s.watermark_opacity,
                                            pointerEvents: 'none',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {s.watermark_text}
                                    </div>
                                )}

                                {/* Content */}
                                <div
                                    style={{
                                        position: 'relative',
                                        zIndex: 1,
                                        padding: 24,
                                    }}
                                >
                                    {/* Header */}
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            marginBottom: 16,
                                            borderBottom: `2px solid ${s.primary_color}`,
                                            paddingBottom: 12,
                                        }}
                                    >
                                        {s.show_logo_in_header && logoUrl && (
                                            <img
                                                src={logoUrl}
                                                alt={t('logoLetterhead.logo.imageAlt')}
                                                style={{
                                                    height: 40,
                                                    width: 40,
                                                    objectFit: 'contain',
                                                }}
                                            />
                                        )}
                                        {s.header_html ? (
                                            <div
                                                dangerouslySetInnerHTML={{
                                                    __html: resolveTemplate(s.header_html),
                                                }}
                                                style={{ flex: 1 }}
                                            />
                                        ) : (
                                            <div style={{ flex: 1 }}>
                                                <div
                                                    style={{
                                                        fontSize: 18,
                                                        fontWeight: 'bold',
                                                        color: s.primary_color,
                                                    }}
                                                >
                                                    {t('preview.sample.assessmentName')}
                                                </div>
                                                <div
                                                    className="text-neutral-500"
                                                    style={{
                                                        fontSize: 12,
                                                    }}
                                                >
                                                    {t('preview.sample.subtitle')}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Sample content */}
                                    <div
                                        style={{
                                            display: 'flex',
                                            gap: 8,
                                            marginBottom: 16,
                                        }}
                                    >
                                        {[
                                            { label: t('preview.sample.score'), value: '72/100' },
                                            { label: t('preview.sample.rank'), value: '#3' },
                                            {
                                                label: t('preview.sample.percentile'),
                                                value: '85%',
                                            },
                                        ].map((stat) => (
                                            <div
                                                key={stat.label}
                                                style={{
                                                    flex: 1,
                                                    padding: '12px 8px',
                                                    background: `${s.primary_color}10`,
                                                    borderRadius: 8,
                                                    textAlign: 'center',
                                                    border: `1px solid ${s.primary_color}30`,
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        fontSize: 16,
                                                        fontWeight: 'bold',
                                                        color: s.primary_color,
                                                    }}
                                                >
                                                    {stat.value}
                                                </div>
                                                <div
                                                    className="text-neutral-500"
                                                    style={{
                                                        fontSize: 10,
                                                        marginTop: 2,
                                                    }}
                                                >
                                                    {stat.label}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Sample section header */}
                                    <div
                                        className="text-white"
                                        style={{
                                            background: s.secondary_color,
                                            padding: '6px 12px',
                                            borderRadius: 4,
                                            fontSize: 13,
                                            fontWeight: 600,
                                            marginBottom: 8,
                                        }}
                                    >
                                        {t('preview.sample.sectionPerformance')}
                                    </div>
                                    <div
                                        className="bg-neutral-50 text-neutral-300"
                                        style={{
                                            height: 60,
                                            borderRadius: 4,
                                            marginBottom: 16,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: 12,
                                        }}
                                    >
                                        {t('preview.sample.sectionTablePlaceholder')}
                                    </div>

                                    {/* Footer */}
                                    <div
                                        style={{
                                            borderTop: `1px solid ${s.primary_color}40`,
                                            paddingTop: 8,
                                            marginTop: 'auto',
                                        }}
                                    >
                                        {s.footer_html ? (
                                            <div
                                                dangerouslySetInnerHTML={{
                                                    __html: resolveTemplate(s.footer_html),
                                                }}
                                            />
                                        ) : (
                                            <div
                                                className="text-neutral-400"
                                                style={{
                                                    fontSize: 10,
                                                    textAlign: 'center',
                                                }}
                                            >
                                                {s.footer_text}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
            {/* Image Cropper Dialog */}
            <ImageCropperDialog
                open={cropperOpen}
                onOpenChange={setCropperOpen}
                src={cropperSrc}
                aspectRatio={cropperField === 'letterhead_file_id' ? 210 / 297 : 1}
                title={
                    cropperField === 'letterhead_file_id'
                        ? t('cropper.titleLetterhead')
                        : t('cropper.titleLogo')
                }
                onCropped={handleCroppedUpload}
                confirmLabel={t('cropper.confirmLabel')}
            />
        </div>
    );
};

export default ReportBrandingSettingsSection;
