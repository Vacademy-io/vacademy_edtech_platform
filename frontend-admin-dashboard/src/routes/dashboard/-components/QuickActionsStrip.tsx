import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { quickActionsForRoles, type QuickAction } from '../-config/dashboard-quick-actions';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';

interface QuickActionsStripProps {
    roles: string[];
}

export default function QuickActionsStrip({ roles }: QuickActionsStripProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboardQuickActions');
    const { t: dashboardT } = useTranslation('dashboardIndex');
    const entitlement = useEntitlement();
    // Plan filter (MANAGED only; every action is entitled otherwise).
    const actions = quickActionsForRoles(roles, t).filter((a) =>
        entitlement.isQuickActionEntitled(a.id)
    );
    if (actions.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-medium text-neutral-500">
                {dashboardT('quickActions.title')}
            </span>
            <div className="flex flex-wrap gap-2">
                {actions.map((a: QuickAction) => {
                    const Icon = a.icon;
                    return (
                        <button
                            key={a.id}
                            type="button"
                            onClick={() =>
                                navigate(
                                    a.search
                                        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                          ({ to: a.to, search: a.search } as any)
                                        : { to: a.to }
                                )
                            }
                            className="group flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 active:bg-primary-100"
                        >
                            <span className="flex size-6 items-center justify-center rounded-lg bg-primary-50 text-primary-600 transition-colors group-hover:bg-primary-100">
                                <Icon size={14} weight="duotone" />
                            </span>
                            <span>{a.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
