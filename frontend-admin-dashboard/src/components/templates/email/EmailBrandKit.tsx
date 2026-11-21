import React, { useEffect, useRef, useState } from 'react';
import { Palette, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorPicker } from '@/components/ui/color-picker';
import {
    EMPTY_EMAIL_BRAND,
    EmailBrandSettings,
    getEmailBrandSettings,
    googleFontHref,
    isValidHex,
    saveEmailBrandSettings,
} from '@/services/email-brand-settings';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { getInstituteId } from '@/constants/helper';

// Brand colours, font and logo the email editor offers to every template of this institute.
export const EmailBrandKit: React.FC = () => {
    const [brand, setBrand] = useState<EmailBrandSettings>(EMPTY_EMAIL_BRAND);
    const [fontName, setFontName] = useState('');
    const [fontHref, setFontHref] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        getEmailBrandSettings().then((data) => {
            setBrand(data);
            setFontName(data.font?.name || '');
            setFontHref(data.font?.href || '');
            setLoading(false);
        });
    }, []);

    const updateColor = (index: number, patch: Partial<{ name: string; hex: string }>) =>
        setBrand((prev) => ({
            ...prev,
            colors: prev.colors.map((c, i) => (i === index ? { ...c, ...patch } : c)),
        }));

    const addColor = () =>
        setBrand((prev) => ({ ...prev, colors: [...prev.colors, { name: '', hex: '#000000' }] }));

    const removeColor = (index: number) =>
        setBrand((prev) => ({ ...prev, colors: prev.colors.filter((_, i) => i !== index) }));

    const handleLogoUpload = async (file: File | undefined) => {
        if (!file) return;
        const userId = getUserId();
        const instituteId = getInstituteId();
        if (!userId || !instituteId) {
            toast.error('Missing user credentials');
            return;
        }
        setUploading(true);
        try {
            const fileId = await UploadFileInS3(file, () => {}, userId, 'EMAIL_TEMPLATES', instituteId, true);
            const url = fileId ? await getPublicUrl(fileId) : '';
            if (!url) throw new Error('Upload failed');
            setBrand((prev) => ({ ...prev, logoUrl: url }));
        } catch (err) {
            console.error(err);
            toast.error('Failed to upload logo');
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async () => {
        const invalid = brand.colors.find((c) => !isValidHex(c.hex));
        if (invalid) {
            toast.error(`Invalid colour: ${invalid.hex}`);
            return;
        }
        const trimmedFont = fontName.trim();
        const payload: EmailBrandSettings = {
            colors: brand.colors.map((c) => ({ name: c.name.trim(), hex: c.hex.trim().toLowerCase() })),
            font: trimmedFont
                ? { name: trimmedFont, href: fontHref.trim() || googleFontHref(trimmedFont) }
                : null,
            logoUrl: brand.logoUrl.trim(),
        };
        setSaving(true);
        try {
            await saveEmailBrandSettings(payload);
            setBrand(payload);
            setFontHref(payload.font?.href || '');
            toast.success('Email brand kit saved');
        } catch (err) {
            console.error(err);
            toast.error('Failed to save email brand kit');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                    <Palette className="size-4" />
                    Email Brand Kit
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                    Brand colours appear as swatches in every colour picker of the email editor. The
                    brand font is added to the font list and embedded in sent emails. New templates
                    start with the brand font and logo.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <>
                        <div className="space-y-2">
                            <Label>Brand colours</Label>
                            {brand.colors.length === 0 && (
                                <p className="text-xs text-muted-foreground">No brand colours yet.</p>
                            )}
                            {brand.colors.map((color, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <ColorPicker
                                        value={isValidHex(color.hex) ? color.hex : '#000000'}
                                        onChange={(hex) => updateColor(index, { hex })}
                                    />
                                    <Input
                                        className="w-28 font-mono"
                                        value={color.hex}
                                        onChange={(e) => updateColor(index, { hex: e.target.value })}
                                        placeholder="#000000"
                                    />
                                    <Input
                                        className="flex-1"
                                        value={color.name}
                                        onChange={(e) => updateColor(index, { name: e.target.value })}
                                        placeholder="Name (e.g. Orange Primary)"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => removeColor(index)}
                                        aria-label="Remove colour"
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                </div>
                            ))}
                            <Button variant="outline" size="sm" onClick={addColor}>
                                <Plus className="mr-1 size-4" /> Add colour
                            </Button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label>Brand font</Label>
                                <Input
                                    value={fontName}
                                    onChange={(e) => setFontName(e.target.value)}
                                    placeholder="e.g. Cairo"
                                    style={fontName ? { fontFamily: `'${fontName}', sans-serif` } : undefined}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label>Font stylesheet URL (optional)</Label>
                                <Input
                                    value={fontHref}
                                    onChange={(e) => setFontHref(e.target.value)}
                                    placeholder={
                                        fontName ? googleFontHref(fontName) : 'Defaults to Google Fonts'
                                    }
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Brand logo</Label>
                            <div className="flex flex-wrap items-center gap-3">
                                {brand.logoUrl && (
                                    <img
                                        src={brand.logoUrl}
                                        alt="Brand logo"
                                        className="h-12 max-w-[160px] rounded border object-contain p-1"
                                    />
                                )}
                                <Input
                                    className="min-w-[220px] flex-1"
                                    value={brand.logoUrl}
                                    onChange={(e) => setBrand((prev) => ({ ...prev, logoUrl: e.target.value }))}
                                    placeholder="https://… (or upload)"
                                />
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                        handleLogoUpload(e.target.files?.[0]);
                                        e.target.value = '';
                                    }}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={uploading}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Upload className="mr-1 size-4" />
                                    {uploading ? 'Uploading…' : 'Upload'}
                                </Button>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button onClick={handleSave} disabled={saving || uploading}>
                                {saving ? 'Saving…' : 'Save brand kit'}
                            </Button>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};
