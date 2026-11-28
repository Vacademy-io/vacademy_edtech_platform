/**
 * Editable CBE spreadsheets register a "commit" here: save the cell being typed
 * in and emit the debounced change right away. A submit (manual, time-up or
 * proctoring) calls `commitCbeEditors()` before it reads the answers, so the
 * last edit is never left behind. Kept identical in both apps.
 */
type Commit = () => void;

const commits = new Set<Commit>();

/** Registers a commit; returns the unregister function. */
export function registerCbeCommit(commit: Commit): () => void {
  commits.add(commit);
  return () => {
    commits.delete(commit);
  };
}

/** Commits every mounted, editable CBE spreadsheet. Synchronous. */
export function commitCbeEditors(): void {
  commits.forEach((commit) => {
    try {
      commit();
    } catch (error) {
      console.warn("[cbe] committing an editor failed", error);
    }
  });
}
