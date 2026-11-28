import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookOpenText } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';

/**
 * Settings → AI → Curriculum library.
 *
 * Stored as institutes.setting_json → setting → CURRICULUM_LIBRARY_SETTING →
 * data = { enabled, boards[], classes[] }. ai_service reads this row directly
 * when it lists knowledge bases (V517): every published curriculum library
 * whose board and class are named here becomes usable by the institute — no
 * unlock, no per-library grant. Turning it off hides them again everywhere.
 */

const SETTING_KEY = 'CURRICULUM_LIBRARY_SETTING';
const SETTING_NAME = 'Curriculum Library';

// Boards with published libraries. Extend as libraries are loaded
// (CUET / state boards are overlays on the same NCERT corpus, coming next).
const BOARDS = ['NCERT'];
const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

interface CurriculumSetting {
    enabled: boolean;
    boards: string[];
    classes: string[];
}

const DEFAULT: CurriculumSetting = { enabled: false, boards: ['NCERT'], classes: [] };

const PRESETS: Array<{ key: string; classes: string[] }> = [
    { key: 'primary', classes: ['1', '2', '3', '4', '5'] },
    { key: 'middle', classes: ['6', '7', '8'] },
    { key: 'secondary', classes: ['9', '10'] },
    { key: 'senior', classes: ['11', '12'] },
];

const CurriculumLibrarySettings = () => {
    const { t } = useTranslation('settingsCurriculumLibrary');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const [setting, setSetting] = useState<CurriculumSetting>(DEFAULT);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    const load = useCallback(async () => {
        if (!instituteId) return;
        setLoading(true);
        try {
            const response = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
                params: { instituteId, settingKey: SETTING_KEY },
            });
            const data = response.data?.data;
            if (data && typeof data === 'object') {
                // Shown exactly as stored: coercing an empty boards list back
                // to NCERT here would make the card disagree with what the
                // server actually grants.
                setSetting({
                    enabled: Boolean(data.enabled),
                    boards: Array.isArray(data.boards) ? data.boards.map(String) : [],
                    classes: Array.isArray(data.classes) ? data.classes.map(String) : [],
                });
            }
        } catch {
            /* no setting yet — defaults apply */
        } finally {
            setLoading(false);
        }
    }, [instituteId]);

    useEffect(() => {
        void load();
    }, [load]);

    const update = (patch: Partial<CurriculumSetting>) => {
        setSetting((prev) => ({ ...prev, ...patch }));
        setDirty(true);
    };

    const toggleClass = (cls: string) => {
        const next = new Set(setting.classes);
        if (next.has(cls)) next.delete(cls);
        else next.add(cls);
        update({ classes: CLASSES.filter((c) => next.has(c)) });
    };

    const applyPreset = (classes: string[]) => {
        const next = new Set(setting.classes);
        const allOn = classes.every((c) => next.has(c));
        classes.forEach((c) => (allOn ? next.delete(c) : next.add(c)));
        update({ classes: CLASSES.filter((c) => next.has(c)) });
    };

    const save = async () => {
        if (!instituteId) return;
        setSaving(true);
        try {
            await authenticatedAxiosInstance.post(
                `${BASE_URL}/admin-core-service/institute/setting/v1/save-setting`,
                { setting_name: SETTING_NAME, setting_data: setting },
                { params: { instituteId, settingKey: SETTING_KEY } }
            );
            setDirty(false);
            // The knowledge-base list is computed from this setting server-side.
            void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
            toast.success(t('toast.saved'));
        } catch {
            toast.error(t('toast.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const chip = (active: boolean, disabled = false) =>
        cn(
            'rounded-full border px-3 py-1 text-caption transition-colors',
            active
                ? 'border-primary-500 bg-primary-50 text-primary-600'
                : 'border-neutral-200 text-neutral-600 hover:border-primary-300',
            disabled && 'cursor-not-allowed opacity-50'
        );

    return (
        <Card className="border-indigo-100 shadow-sm">
            <CardHeader className="border-b border-indigo-50 bg-indigo-50/30">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <BookOpenText className="size-5 text-indigo-600" />
                        <div>
                            <CardTitle className="text-subtitle">{t('title')}</CardTitle>
                            <CardDescription>{t('description')}</CardDescription>
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-body text-neutral-700">
                        <Switch
                            checked={setting.enabled}
                            onCheckedChange={(checked) => update({ enabled: checked })}
                            disabled={loading}
                        />
                        {setting.enabled ? t('enabled') : t('disabled')}
                    </label>
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 p-6">
                {loading && <Skeleton className="h-24 w-full rounded-md" />}

                {!loading && (
                    <>
                        <div className="flex flex-col gap-2">
                            <p className="text-body font-medium text-neutral-700">{t('boards')}</p>
                            <div className="flex flex-wrap gap-2">
                                {BOARDS.map((board) => {
                                    const on = setting.boards.includes(board);
                                    return (
                                        <button
                                            key={board}
                                            type="button"
                                            className={chip(on, !setting.enabled)}
                                            disabled={!setting.enabled}
                                            onClick={() =>
                                                update({
                                                    boards: on
                                                        ? setting.boards.filter((b) => b !== board)
                                                        : [...setting.boards, board],
                                                })
                                            }
                                        >
                                            {board}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-body font-medium text-neutral-700">
                                    {t('classes')}
                                </p>
                                <div className="flex flex-wrap gap-1">
                                    {PRESETS.map((preset) => (
                                        <MyButton
                                            key={preset.key}
                                            buttonType="text"
                                            scale="small"
                                            disable={!setting.enabled}
                                            onClick={() => applyPreset(preset.classes)}
                                        >
                                            {t(`presets.${preset.key}`)}
                                        </MyButton>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {CLASSES.map((cls) => (
                                    <button
                                        key={cls}
                                        type="button"
                                        className={chip(
                                            setting.classes.includes(cls),
                                            !setting.enabled
                                        )}
                                        disabled={!setting.enabled}
                                        onClick={() => toggleClass(cls)}
                                    >
                                        {t('classChip', { number: cls })}
                                    </button>
                                ))}
                            </div>
                            {setting.enabled &&
                                (setting.classes.length === 0 || setting.boards.length === 0) && (
                                    <p className="text-caption text-neutral-500">
                                        {t('pickAtLeastOne')}
                                    </p>
                                )}
                        </div>

                        <p className="text-caption text-neutral-500">{t('hint')}</p>

                        <div className="flex justify-end">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={save}
                                disable={saving || !dirty}
                            >
                                {saving ? t('saving') : t('save')}
                            </MyButton>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};

export default CurriculumLibrarySettings;
