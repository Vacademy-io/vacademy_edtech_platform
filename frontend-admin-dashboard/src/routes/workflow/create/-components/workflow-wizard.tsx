import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { getWorkflowTemplatesQuery } from '@/services/workflow-service';
import { MagicWand, ArrowRight, ArrowLeft } from '@phosphor-icons/react';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    onApplyTemplate: (templateJson: string, name: string) => void;
}

const buildGoals = (t: TFunction) => [
    { id: 'notifications', label: t('goals.notifications.label'), icon: '\u{1F4E7}', description: t('goals.notifications.description') },
    { id: 'enrollments', label: t('goals.enrollments.label'), icon: '\u{1F393}', description: t('goals.enrollments.description') },
    { id: 'reminders', label: t('goals.reminders.label'), icon: '\u{23F0}', description: t('goals.reminders.description') },
    { id: 'reports', label: t('goals.reports.label'), icon: '\u{1F4CA}', description: t('goals.reports.description') },
    { id: 'custom', label: t('goals.custom.label'), icon: '\u{1F527}', description: t('goals.custom.description') },
];

const GOAL_CATEGORIES: Record<string, string[]> = {
    notifications: ['Notification', 'Communication'],
    enrollments: ['Onboarding', 'Enrollment'],
    reminders: ['Reminder', 'Payment'],
    reports: ['Report', 'Analytics'],
    custom: [],
};

export function WorkflowWizard({ open, onOpenChange, instituteId, onApplyTemplate }: Props) {
    const { t } = useTranslation('workflowWizard');
    const [step, setStep] = useState(0);
    const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
    const GOALS = buildGoals(t);

    const { data: templates } = useQuery({
        ...getWorkflowTemplatesQuery(instituteId),
        enabled: open,
    });

    const filteredTemplates = templates?.filter((t) => {
        if (!selectedGoal || selectedGoal === 'custom') return true;
        const cats = GOAL_CATEGORIES[selectedGoal] ?? [];
        return cats.some((cat) => t.category?.toLowerCase().includes(cat.toLowerCase()));
    }) ?? [];

    const reset = () => {
        setStep(0);
        setSelectedGoal(null);
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MagicWand size={20} />
                        {step === 0 ? t('stepGoalTitle') : t('stepTemplateTitle')}
                    </DialogTitle>
                </DialogHeader>

                {step === 0 && (
                    <div className="space-y-2 mt-2">
                        {GOALS.map((goal) => (
                            <button
                                key={goal.id}
                                onClick={() => {
                                    setSelectedGoal(goal.id);
                                    if (goal.id === 'custom') {
                                        onOpenChange(false);
                                        reset();
                                    } else {
                                        setStep(1);
                                    }
                                }}
                                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-start"
                            >
                                <span className="text-2xl">{goal.icon}</span>
                                <div>
                                    <div className="font-medium text-sm">{goal.label}</div>
                                    <div className="text-xs text-muted-foreground">{goal.description}</div>
                                </div>
                                <ArrowRight size={16} className="ms-auto text-muted-foreground" />
                            </button>
                        ))}
                    </div>
                )}

                {step === 1 && (
                    <div className="space-y-3 mt-2">
                        <Button variant="ghost" size="sm" onClick={() => setStep(0)} className="gap-1">
                            <ArrowLeft size={14} /> {t('back')}
                        </Button>
                        {filteredTemplates.length === 0 ? (
                            <div className="text-center py-8 text-sm text-muted-foreground">
                                {t('noTemplatesForCategory')}
                                <div className="mt-2">
                                    <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); reset(); }}>
                                        {t('startFromBlankCanvas')}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            filteredTemplates.map((tpl) => (
                                <button
                                    key={tpl.id}
                                    onClick={() => {
                                        onApplyTemplate(tpl.template_json, tpl.name);
                                        onOpenChange(false);
                                        reset();
                                    }}
                                    className="w-full flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-start"
                                >
                                    <div className="flex-1">
                                        <div className="font-medium text-sm">{tpl.name}</div>
                                        <div className="text-xs text-muted-foreground mt-0.5">{tpl.description}</div>
                                    </div>
                                    <Badge variant="outline" className="text-[10px] shrink-0">{tpl.category}</Badge>
                                </button>
                            ))
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
