import { createContext } from 'react';

/**
 * True while the report is being fetched again, so every "Try again" button on the page can
 * show that the retry is running instead of looking unresponsive.
 */
export const ReportRetryingContext = createContext(false);
