'use strict';

// Phrase matching for keyword triggers: case and accents folded, punctuation read
// as spaces, whole words with simple plurals. Nothing fuzzier: a match has to be
// explainable by reading the two phrases side by side.
function normalizeText(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const words = value => normalizeText(value).split(' ').filter(Boolean);

const sameWord = (a, b) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;

// Whether the word list `haystack` contains the word list `phrase`, in order.
function containsPhrase(haystack, phrase) {
  if (!phrase.length || phrase.length > haystack.length) return false;
  for (let i = 0; i + phrase.length <= haystack.length; i += 1) {
    if (phrase.every((word, j) => sameWord(haystack[i + j], word))) return true;
  }
  return false;
}

module.exports = { normalizeText, words, containsPhrase };
