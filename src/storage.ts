import type { SavedDeck } from './types';

const KEY = 'ygoprob_decks';

export function loadDecks(): SavedDeck[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
  catch { return []; }
}

function saveAll(decks: SavedDeck[]): void {
  localStorage.setItem(KEY, JSON.stringify(decks));
}

export function upsertDeck(deck: SavedDeck): void {
  const decks = loadDecks();
  const idx = decks.findIndex(d => d.id === deck.id);
  if (idx >= 0) decks[idx] = deck; else decks.push(deck);
  saveAll(decks);
}

export function deleteDeck(id: string): void {
  saveAll(loadDecks().filter(d => d.id !== id));
}
