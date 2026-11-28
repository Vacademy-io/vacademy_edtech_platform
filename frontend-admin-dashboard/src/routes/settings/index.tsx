import { createFileRoute } from '@tanstack/react-router';
import { validateSettingsSearch } from './-utils/settings-tab-aliases';

export const Route = createFileRoute('/settings/')({
    // Old tab ids (e.g. ?selectedTab=assistantTools / mcpServer) open the screen that replaced them.
    validateSearch: validateSettingsSearch,
});
