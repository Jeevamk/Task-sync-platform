import { Provider } from '../../database/types';

/**
 * Where a brand-new user creates a free account before connecting it.
 * We can't create accounts for them (no provider offers that), so we point them to the right page.
 */
export const SIGNUP: Record<Provider, { signupUrl: string; howTo: string }> = {
  TRELLO: {
    signupUrl: 'https://trello.com/signup',
    howTo: 'No Trello account? Create one free at the signup link, then open authorizeUrl and click Allow.',
  },
  SLACK: {
    signupUrl: 'https://slack.com/get-started#/createnew',
    howTo: 'No Slack workspace? Create one free at the signup link, then open authorizeUrl and click Allow.',
  },
  GOOGLE: {
    signupUrl: 'https://accounts.google.com/signup',
    howTo: 'No Google account? Create one free at the signup link, then open authorizeUrl and click Allow.',
  },
};
