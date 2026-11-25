import { createLazyFileRoute } from '@tanstack/react-router';
import { SyllabusProgressPage } from './-components/SyllabusProgressPage';

export const Route = createLazyFileRoute('/syllabus-progress/')({
    component: SyllabusProgressPage,
});
