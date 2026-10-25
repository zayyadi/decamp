// Evidence quotes must be verbatim (AGENT.md §4.4, CLAUDE.md rule 4). Models
// and publishers disagree on quote marks, dashes and spacing, so compare a
// normalised form; anything else that differs means the quote was altered.

const QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;
const DASHES = /[‐‑‒–—―]/g;

export function normaliseForQuote(text: string): string {
  return text
    .normalize("NFC")
    .replace(QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVerbatim(quote: string, articleText: string): boolean {
  const q = normaliseForQuote(quote);
  return q.length > 0 && normaliseForQuote(articleText).includes(q);
}
