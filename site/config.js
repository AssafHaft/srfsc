// Where the refresh button starts the update workflow and reads the fresh data from.
export const CONFIG = {
  owner: 'AssafHaft',
  repo: 'srfsc',
  workflow: 'update.yml',
  branch: 'main',
  dataPath: 'site/data/schedule.json',
  historyPath: 'site/data/history',
};

// The code screen's 6-digit code, stored only as its SHA-256 hash. To change the code, put the output of
// node -e "console.log(require('crypto').createHash('sha256').update('123456').digest('hex'))"
// here, with your code in place of 123456.
export const CODE_HASH = '223d5abca6b9aa166a82aa2b17f5415d82c238907bd29a52f4b29de9eb3a7a51';

// List prices for one session, used for every revenue estimate (analysis spec section 3).
// From the park's single-session prices on 11.9.2026; edit here and all history is re-priced.
export const PRICES = {
  reef: 360, // reef L1–L4
  reefHigh: 390, // reef L5–L6
  bayAdult: 250,
  bayKids: 195,
};
