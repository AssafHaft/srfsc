// Where the refresh button starts the update workflow and reads the fresh data from.
export const CONFIG = {
  owner: 'AssafHaft',
  repo: 'srfsc',
  workflow: 'update.yml',
  branch: 'main',
  dataPath: 'site/data/schedule.json',
  historyPath: 'site/data/history',
};

// List prices for one session, used for every revenue estimate (analysis spec section 3).
// From the park's single-session prices on 11.9.2026; edit here and all history is re-priced.
export const PRICES = {
  reef: 360, // reef L1–L4
  reefHigh: 390, // reef L5–L6
  bayAdult: 250,
  bayKids: 195,
};
