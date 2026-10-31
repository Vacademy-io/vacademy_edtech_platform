import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Circle, ArrowRight } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';

interface FreshInstituteEmptyStateProps {
    studentCount: number;
    batchCount: number;
    courseCount: number;
    levelCount: number;
    profileCompletionPercentage: number;
    onEditProfile?: () => void;
}

interface ChecklistItem {
    /** Catalogue `setup_steps` id (level/course/batch/learner); profile is ungoverned. */
    id: 'profile' | 'level' | 'course' | 'batch' | 'learner';
    label: string;
    description: string;
    done: boolean;
    cta: { label: string; to?: string; onClick?: () => void };
}

export default function FreshInstituteEmptyState({
    studentCount,
    batchCount,
    courseCount,
    levelCount,
    profileCompletionPercentage,
    onEditProfile,
}: FreshInstituteEmptyStateProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboardFreshInstituteEmptyState');
    const entitlement = useEntitlement();

    const allItems: ChecklistItem[] = [
        {
            id: 'profile',
            label: t('items.profile.label'),
            description: t('items.profile.description'),
            done: profileCompletionPercentage >= 100,
            cta: { label: t('items.profile.cta'), onClick: onEditProfile },
        },
        {
            id: 'level',
            label: t('items.level.label'),
            description: t('items.level.description'),
            done: levelCount > 0,
            cta: { label: t('items.level.cta'), to: '/manage-institute' },
        },
        {
            id: 'course',
            label: t('items.course.label'),
            description: t('items.course.description'),
            done: courseCount > 0,
            cta: { label: t('items.course.cta'), to: '/study-library/courses' },
        },
        {
            id: 'batch',
            label: t('items.batch.label'),
            description: t('items.batch.description'),
            done: batchCount > 0,
            cta: { label: t('items.batch.cta'), to: '/manage-institute' },
        },
        {
            id: 'learner',
            label: t('items.learner.label'),
            description: t('items.learner.description'),
            done: studentCount > 0,
            cta: { label: t('items.learner.cta'), to: '/manage-students' },
        },
    ];
    // Steps outside the institute's plan are left out (MANAGED only).
    const items = allItems.filter(
        (item) => item.id === 'profile' || entitlement.isSetupStepEntitled(item.id)
    );

    const completed = items.filter((i) => i.done).length;
    const total = items.length;

    return (
        <Card className="grow border-primary-200 bg-gradient-to-br from-primary-50/60 to-white shadow-none">
            <CardHeader className="p-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <CardTitle className="text-sm font-semibold">
                            {t('header.title')}
                        </CardTitle>
                        <CardDescription className="mt-0.5 text-2xs text-neutral-600 sm:text-xs">
                            {t('header.subtitle')}
                        </CardDescription>
                    </div>
                    <span className="shrink-0 rounded-full border border-primary-200 bg-white px-2 py-0.5 text-2xs font-semibold text-primary-700">
                        {t('progress', { completed, total })}
                    </span>
                </div>
            </CardHeader>
            <ol className="space-y-1 px-3 pb-4">
                {items.map((item, i) => (
                    <li
                        key={item.id}
                        className="flex items-center gap-3 rounded-md p-2 hover:bg-white/60"
                    >
                        {item.done ? (
                            <CheckCircle
                                size={18}
                                weight="fill"
                                className="shrink-0 text-emerald-500"
                            />
                        ) : (
                            <Circle size={18} className="shrink-0 text-neutral-300" />
                        )}
                        <div className="flex flex-1 flex-col">
                            <span
                                className={`text-xs font-medium ${
                                    item.done ? 'text-neutral-400 line-through' : 'text-neutral-800'
                                }`}
                            >
                                {i + 1}. {item.label}
                            </span>
                            {!item.done && (
                                <span className="text-2xs text-neutral-500">
                                    {item.description}
                                </span>
                            )}
                        </div>
                        {!item.done && (
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="secondary"
                                onClick={() => {
                                    if (item.cta.onClick) item.cta.onClick();
                                    else if (item.cta.to) navigate({ to: item.cta.to });
                                }}
                                className="shrink-0 text-xs"
                            >
                                {item.cta.label}
                                <ArrowRight size={12} className="ml-1" />
                            </MyButton>
                        )}
                    </li>
                ))}
            </ol>
        </Card>
    );
}
