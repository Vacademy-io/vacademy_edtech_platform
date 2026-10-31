import React from 'react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { SidebarItemProps } from '../../../../types/layout-container/layout-container-types';
import { cn } from '@/lib/utils';
import { LockKey } from '@phosphor-icons/react';
import { getCategoryColors } from './sidebar-colors';
import { recordRecentTab } from './recent-tabs-store';
import { isSidebarLinkActive } from './helper';

export const NonCollapsibleItem = ({ icon, title, to, locked, category }: SidebarItemProps) => {
    const [hover, setHover] = useState<boolean>(false);
    const navigate = useNavigate();
    const { pathname: currentRoute, search: currentSearch } = useLocation();
    const colors = getCategoryColors(category as 'CRM' | 'LMS' | 'AI');
    const isActive = isSidebarLinkActive(
        to,
        currentRoute,
        currentSearch as Record<string, unknown>
    );

    const handleLockedClick = (e: React.MouseEvent) => {
        if (locked) {
            e.preventDefault();
            e.stopPropagation();
            navigate({ to: '/locked-feature', search: { feature: title } });
        }
    };

    const handleClick = () => {
        if (!locked && to) {
            recordRecentTab({
                id: title,
                label: title,
                route: to,
                category: (category as 'CRM' | 'LMS' | 'AI') || 'CRM',
            });
        }
    };

    // Locked state
    if (locked) {
        return (
            <div
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-full px-3 py-1.5 transition-colors hover:bg-neutral-100"
                onClick={handleLockedClick}
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
            >
                <LockKey className="size-[18px] text-neutral-400" weight="duotone" />
                <span className="text-[13px] text-neutral-400">{title}</span>
            </div>
        );
    }

    return (
        <Link
            to={to}
            className={cn(
                'flex w-full cursor-pointer items-center gap-2.5 rounded-full px-3 py-1.5 transition-all duration-150',
                isActive
                    ? cn(colors.pillBg, colors.pillText, 'font-medium')
                    : 'text-neutral-600 hover:bg-neutral-100'
            )}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={handleClick}
        >
            {/* Icon */}
            {icon &&
                React.createElement(icon, {
                    size: 18,
                    weight: hover || isActive ? 'fill' : 'regular',
                    className: cn(
                        'flex-shrink-0 transition-colors duration-150',
                        hover || isActive
                            ? isActive
                                ? colors.pillText
                                : colors.text
                            : 'text-neutral-500'
                    ),
                })}

            {/* Title */}
            <span
                className={cn(
                    'truncate text-[13px] transition-colors duration-150',
                    isActive
                        ? cn(colors.pillText, 'font-medium')
                        : hover
                          ? cn(colors.text, 'font-medium')
                          : 'text-neutral-600'
                )}
            >
                {title}
            </span>
        </Link>
    );
};
