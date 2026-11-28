import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { ExamCalculatorMode, ExamExperienceSettings } from '@/types/assessment-settings';

interface ExamExperienceSettingsCardProps {
    settings: ExamExperienceSettings;
    onChange: (next: ExamExperienceSettings) => void;
}

interface ToggleRowProps {
    label: string;
    description: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    children?: React.ReactNode;
}

const ToggleRow = ({ label, description, checked, onCheckedChange, children }: ToggleRowProps) => (
    <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
                <Label className="text-sm font-medium">{label}</Label>
                <p className="text-xs text-gray-500">{description}</p>
            </div>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
        {checked && children ? <div className="mt-4 border-t pt-4">{children}</div> : null}
    </div>
);

/**
 * Live-test experience toggles. These drive the learner app's exam shell —
 * which tools a learner gets, whether the question palette is available, and
 * how much app chrome survives on a phone.
 */
const ExamExperienceSettingsCard = ({ settings, onChange }: ExamExperienceSettingsCardProps) => {
    const { t } = useTranslation('settingsExamExperienceCard');
    const patch = (next: Partial<ExamExperienceSettings>) => onChange({ ...settings, ...next });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t('header.title')}</CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <ToggleRow
                    label={t('calculator.label')}
                    description={t('calculator.description')}
                    checked={settings.calculator.enabled}
                    onCheckedChange={(enabled) =>
                        patch({ calculator: { ...settings.calculator, enabled } })
                    }
                >
                    <div className="flex flex-col gap-2">
                        <Label className="text-sm font-medium">{t('calculator.typeLabel')}</Label>
                        <Select
                            value={settings.calculator.mode}
                            onValueChange={(mode) =>
                                patch({
                                    calculator: {
                                        ...settings.calculator,
                                        mode: mode as ExamCalculatorMode,
                                    },
                                })
                            }
                        >
                            <SelectTrigger className="w-full max-w-xs">
                                <SelectValue placeholder={t('calculator.typePlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="basic">{t('calculator.basic')}</SelectItem>
                                <SelectItem value="scientific">
                                    {t('calculator.scientific')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-gray-500">{t('calculator.hint')}</p>
                    </div>
                </ToggleRow>

                <ToggleRow
                    label={t('scratchpad.label')}
                    description={t('scratchpad.description')}
                    checked={settings.scratchpad.enabled}
                    onCheckedChange={(enabled) => patch({ scratchpad: { enabled } })}
                />

                <ToggleRow
                    label={t('questionPalette.label')}
                    description={t('questionPalette.description')}
                    checked={settings.questionPalette.enabled}
                    onCheckedChange={(enabled) =>
                        patch({ questionPalette: { ...settings.questionPalette, enabled } })
                    }
                >
                    <div className="flex flex-col gap-2">
                        <Label className="text-sm font-medium">
                            {t('questionPalette.viewLabel')}
                        </Label>
                        <Select
                            value={settings.questionPalette.defaultView}
                            onValueChange={(defaultView) =>
                                patch({
                                    questionPalette: {
                                        ...settings.questionPalette,
                                        defaultView: defaultView as 'grid' | 'list',
                                    },
                                })
                            }
                        >
                            <SelectTrigger className="w-full max-w-xs">
                                <SelectValue placeholder={t('questionPalette.viewPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="grid">{t('questionPalette.grid')}</SelectItem>
                                <SelectItem value="list">{t('questionPalette.list')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </ToggleRow>

                <ToggleRow
                    label={t('markingScheme.label')}
                    description={t('markingScheme.description')}
                    checked={settings.showMarkingScheme}
                    onCheckedChange={(showMarkingScheme) => patch({ showMarkingScheme })}
                />

                <ToggleRow
                    label={t('mobileNav.label')}
                    description={t('mobileNav.description')}
                    checked={settings.mobile.hideAppNavigation}
                    onCheckedChange={(hideAppNavigation) =>
                        patch({ mobile: { hideAppNavigation } })
                    }
                />
            </CardContent>
        </Card>
    );
};

export default ExamExperienceSettingsCard;
