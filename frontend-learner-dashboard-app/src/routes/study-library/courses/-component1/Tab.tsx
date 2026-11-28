// src/routes/study-library/-component/Tab.tsx
import { Link, useRouterState } from '@tanstack/react-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';

const getTabs = (t: (key: string, options?: Record<string, unknown>) => string, courses: string) => [
  { name: t('catalog.tab.all', { courses }), path: '/study-library/courses' },
  { name: t('catalog.tab.inProgress'), path: '/study-library/courses' },
  { name: t('catalog.tab.completed'), path: '/study-library/courses' },
];

const Tab: React.FC = () => {
  const { t } = useTranslation("study");
  const location = useRouterState({ select: (state) => state.location });
  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const tabs = getTabs(t, courses);

  return (
    <div className="flex items-center p-4 h-14 border-b border-gray-300">
      <ul className="flex space-x-6">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;

          return (
            <li key={tab.name}>
              <Link
                to={tab.path}
                className={`pb-2 text-bold text-black hover:text-blue-600 hover:border-b-2 hover:border-blue-600 
                  transition-colors duration-150 ease-in-out focus:outline-none
                  ${isActive
                    ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
                    : 'border-b-2 border-transparent'}`}
              >
                {tab.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default Tab;
