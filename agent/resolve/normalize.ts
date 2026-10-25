import { applyVariants } from "./variants";

// Name normalisation (AGENT.md §5.1).

const TITLES = new Set(
  (
    "sen senator distinguished dist hon honourable honorable rt right deputy dr prof professor " +
    "engr engineer barr barrister arc architect alhaji alh hajiya haji chief otunba prince princess " +
    "sir mr mrs ms comrade comr mallam malam pastor bishop sheikh oba amb ambassador gen rtd col capt"
  ).split(" "),
);
// "High Chief" is a two-word title; "high" alone is not stripped.
const TWO_WORD_TITLES = new Set(["high chief"]);
// Senior Advocate and national honours follow the name, and only there are they titles.
const TRAILING_HONOURS = new Set(["san", "cfr", "ofr", "mfr", "oon", "mon", "con", "gcon", "fnse"]);

export function tokenize(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-‐‑–—_/]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function stripTitles(tokens: string[]): string[] {
  let out = tokens;
  let changed = true;
  while (changed) {
    changed = false;
    const next: string[] = [];
    for (let i = 0; i < out.length; i++) {
      if (i + 1 < out.length && TWO_WORD_TITLES.has(`${out[i]} ${out[i + 1]}`)) {
        i++;
        changed = true;
      } else if (TITLES.has(out[i])) {
        changed = true;
      } else {
        next.push(out[i]);
      }
    }
    while (next.length > 1 && TRAILING_HONOURS.has(next[next.length - 1])) {
      next.pop();
      changed = true;
    }
    // A name made only of titles is kept as written rather than erased.
    if (next.length === 0) return out;
    out = next;
  }
  return out;
}

/** Canonical tokens of a person's name. */
export function nameTokens(name: string): string[] {
  return applyVariants(stripTitles(tokenize(name)));
}

export const normalizeName = (name: string) => nameTokens(name).join(" ");
