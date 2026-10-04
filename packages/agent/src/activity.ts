/**
 * What Blocky is doing, in words the user sees while they wait — "Creating
 * your pot", not "create_pot". One per tool; anything unlisted reads as
 * "Thinking". Labels never carry amounts or names: they are shown before the
 * result exists, so they can only say what is being done, not how it went.
 */
const LABELS: Record<string, string> = {
  get_balance: 'Checking your balance',
  get_policy: 'Checking your limits',
  list_contacts: 'Looking through your contacts',
  get_supported_chains: 'Checking where your money can go',
  get_token_price: 'Checking prices',
  resolve_address: 'Looking up that address',
  save_contact: 'Saving the contact',
  delete_contact: 'Removing the contact',
  get_arc_ecosystem: "Looking at what's live on Arc",
  get_profile: 'Checking your profile',
  get_notifications: 'Checking your notifications',
  decline_request: 'Declining the request',
  block_requester: 'Blocking them',
  delete_pot: 'Deleting the pot',
  set_spending_limits: 'Updating your limits',
  request_money: 'Sending the request',
  list_requests: 'Checking your requests',
  set_price_alert: 'Setting the alert',
  list_price_alerts: 'Checking your alerts',
  cancel_price_alert: 'Cancelling the alert',
  get_insights: 'Looking at your spending',
  set_budget: 'Setting your budget',
  list_pots: 'Checking your pots',
  create_pot: 'Creating your pot',
  move_to_pot: 'Moving money into your pot',
  set_username: 'Claiming your name',
  lookup_token: 'Looking up that token',
  remember: 'Making a note',
  forget_memory: 'Forgetting that',
  get_market_overview: 'Checking the markets',
  get_recent_activity: 'Looking at your activity',
  set_appearance: 'Switching the theme',
  continue_after: 'Planning the next step',
  set_auto_save: 'Setting up auto-save',
  list_auto_saves: 'Checking your auto-saves',
  delete_auto_save: 'Stopping that auto-save',
  propose_intent: 'Working out the best way',
  web_search: 'Reading the news',
};

export const THINKING = 'Thinking';

export function activityFor(tool: string): string {
  return LABELS[tool] ?? THINKING;
}
