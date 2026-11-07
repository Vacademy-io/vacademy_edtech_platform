import { createLazyFileRoute, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { StudentsListSection } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/students-list-section';
import { Helmet } from 'react-helmet';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const Route = createLazyFileRoute('/manage-students/students-list/')({
    component: StudentsList,
});

export function StudentsList() {
    const learnersLabel = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);

    // The list reads its filters (?batch=, ?status=, …) from the URL once, on
    // mount. Sidebar sub-tabs that open this same page with a different query
    // (all learners vs ?batch=[…]) therefore kept whatever filter loaded first.
    // Remount on every navigation into this page. The list's own filter edits
    // write the URL with a raw history.replaceState (a REPLACE), so they don't.
    //
    // History notifies before the router commits the new location, so a remount
    // straight from the history event re-read the previous tab's query (Enrolled
    // showed Flexi's batches and vice versa). Note the navigation there, and
    // remount once the router's href has actually moved.
    const router = useRouter();
    const href = useRouterState({ select: (s) => s.location.href });
    const pendingNav = useRef(false);
    const [navCount, setNavCount] = useState(0);
    useEffect(
        () =>
            router.history.subscribe(({ action, location }) => {
                pendingNav.current =
                    action.type !== 'REPLACE' &&
                    location.pathname.startsWith('/manage-students/students-list');
            }),
        [router]
    );
    useEffect(() => {
        if (!pendingNav.current) return;
        pendingNav.current = false;
        setNavCount((n) => n + 1);
    }, [href]);

    return (
        <LayoutContainer>
            {/* <EmptyDashboard /> */}
            <Helmet>
                <title>{learnersLabel}</title>
                <meta
                    name="description"
                    content={`This page shows all the ${learnersLabel.toLowerCase()} of the institute.`}
                />
            </Helmet>
            <StudentsListSection key={navCount} />
        </LayoutContainer>
    );
}
