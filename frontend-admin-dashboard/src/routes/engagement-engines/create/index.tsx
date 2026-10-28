import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/engagement-engines/create/')({
    // ?edit=<engineId> opens the same wizard to edit an existing engine.
    validateSearch: (search: Record<string, unknown>): { edit?: string } => ({
        edit: typeof search.edit === 'string' && search.edit ? search.edit : undefined,
    }),
});
