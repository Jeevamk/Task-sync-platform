/**
 * Headers of the sheet Taskvane creates for a project (sheet: "new").
 * Must match the columns written by delivery/messages.ts and read by apps-script/Import.gs.
 * scripts/test-multitenant.js checks that every column the delivery writes is here.
 */

export const TASKS_TAB = 'Tasks';
export const HISTORY_TAB = 'History';
export const IMPORT_TAB = 'Import';

export const TASKS_HEADERS = [
  'Task ID',
  'Title',
  'Status',
  'Assignee',
  'Labels / Priority',
  'Due Date',
  'Created At',
  'Picked Up At',
  'Started At',
  'Ready for Testing At',
  'Completed At',
  'Reopen Count',
  'Progress Notes',
  'Description',
  'Trello URL',
  'Trello Card ID',
  'Last Updated',
  'Last Updated By',
];

export const HISTORY_HEADERS = ['Timestamp', 'Task ID', 'Field', 'Old Value', 'New Value', 'Changed By', 'Source'];

/** Same list as IMPORT_HEADERS in apps-script/Import.gs. */
export const IMPORT_HEADERS = ['Title', 'Description', 'List', 'Assignee', 'Due Date', 'Labels', 'Status', 'Trello Card', 'Row Key'];

export const SHEET_TABS: { title: string; headers: string[] }[] = [
  { title: TASKS_TAB, headers: TASKS_HEADERS },
  { title: HISTORY_TAB, headers: HISTORY_HEADERS },
  { title: IMPORT_TAB, headers: IMPORT_HEADERS },
];
