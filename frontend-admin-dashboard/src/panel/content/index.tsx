/**
 * Lessons (#/lessons, sign-in required — PanelApp redirects to #/login first).
 *
 *   #/lessons?courseId&psId&subjectId&moduleId&chapterId   → LessonPicker step
 *   #/lessons?…&view=player&slideId=…                      → PanelPlayer
 *
 * Read-only: only GETs against the study library, slides, media signed URLs
 * and the AI-video render state. Lazy chunk (PanelApp imports './content').
 */
import { usePanelRoute } from '../router';
import { LessonPicker } from './LessonPicker';
import { PanelPlayer } from './PanelPlayer';

export default function LessonsScreen() {
    const { params } = usePanelRoute();
    if (params.view === 'player' && params.slideId) return <PanelPlayer params={params} />;
    return <LessonPicker params={params} />;
}
