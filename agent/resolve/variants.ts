// Canonical spellings of common names (AGENT.md §5.1). Extend it from
// `wrong_person` review corrections (AGENT.md §8) and run the eval.

const GROUPS: Record<string, string[]> = {
  muhammad: ["muhammad", "mohammed", "muhammed", "mohammad", "mohamed", "mohamad"],
  suleiman: ["suleiman", "sulaiman", "suleman", "sulayman"],
  usman: ["usman", "uthman", "osman"],
  yusuf: ["yusuf", "yusuff", "yussuf", "yousuf"],
  ibrahim: ["ibrahim", "ibraheem"],
  abdulrahman: ["abdulrahman", "abdurrahman"],
  aminu: ["aminu", "amino"],
  abubakar: ["abubakar", "abubakr"],
  ahmad: ["ahmad", "ahmed"],
  tijjani: ["tijjani", "tijani"],
  jibril: ["jibril", "jibrin"],
  farouk: ["farouk", "faruk", "faruq"],
};

export const VARIANTS: ReadonlyMap<string, string> = new Map(
  Object.entries(GROUPS).flatMap(([canonical, spellings]) => spellings.map((s) => [s, canonical] as const)),
);

/**
 * `abdul` is a prefix written both joined and apart ("Abdul Rahman",
 * "Abdulrahman"), so it is joined to the next token before mapping.
 * `olu`/`oluwa` prefixes are deliberately left as written.
 */
export function applyVariants(tokens: string[]): string[] {
  const joined: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "abdul" && i + 1 < tokens.length) {
      joined.push(`abdul${tokens[++i]}`);
    } else {
      joined.push(tokens[i]);
    }
  }
  return joined.map((t) => VARIANTS.get(t) ?? t);
}
