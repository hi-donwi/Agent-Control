/** Project management views that fill the main area, opened from the menu (ADR-0024, owner's D4). */
export type PmPage = 'today' | 'missions';

export const PM_PAGE_TITLE: Record<PmPage, string> = {
  today: 'Today',
  missions: 'Missions board',
};

/** Alerts the floor does not already show: dates and reminders (approvals and hands are on the floor). */
export const DATE_ALERTS = new Set(['overdue', 'due_today', 'reminder']);
