// Feed registry (AGENT.md §2). Every source carries a tier and a note of its
// robots.txt and terms-of-service check (CLAUDE.md "Don'ts").
//
// Tiers feed the T factor of the confidence score (AGENT.md §6.2):
//   1  official National Assembly channels, and national outlets with a
//      dedicated politics desk and a public corrections record
//   2  national outlets whose focus is business or finance, and regional outlets
//   3  blogs, aggregators and outlets without clear editorial standards

export type Tier = 1 | 2 | 3;

export interface Source {
  key: string;
  name: string;
  feedUrl: string;
  homepage: string;
  tier: Tier;
  review: {
    /** ISO date of the last check. */
    checked: string;
    robots: string;
    terms: string;
  };
}

// Checked 2026-10-25 and left out:
// - The Cable, The Guardian Nigeria: feed and robots.txt answer 403 to our
//   User-Agent. We do not disguise the crawler to get past a block.
// - Leadership: robots.txt answers 403, which we treat as "disallow all".
// - ThisDay: the terms forbid copying or extracting content "by means of
//   robots, spiders, crawlers or other automatic devices" and use as a media
//   monitoring service.
// - Sahara Reporters: no working RSS feed found.
// - National Assembly (nass.gov.ng): no feed published.
export const sources: Source[] = [
  {
    key: "punch",
    name: "Punch",
    feedUrl: "https://rss.punchng.com/v1/category/latest_news",
    homepage: "https://punchng.com",
    tier: 1,
    review: {
      checked: "2026-10-25",
      robots: "rss.punchng.com and punchng.com allow all agents outside /search/",
      terms: "punchng.com/terms/ renders client-side; needs a manual read before launch",
    },
  },
  {
    key: "premium-times",
    name: "Premium Times",
    feedUrl: "https://www.premiumtimesng.com/feed",
    homepage: "https://www.premiumtimesng.com",
    tier: 1,
    review: {
      checked: "2026-10-25",
      robots: "allows all agents; Crawl-delay 10",
      terms: "/terms-of-use/ keyword scan found no clause on crawling, automated access or RSS",
    },
  },
  {
    key: "vanguard",
    name: "Vanguard",
    feedUrl: "https://www.vanguardngr.com/feed/",
    homepage: "https://www.vanguardngr.com",
    tier: 1,
    review: {
      checked: "2026-10-25",
      robots: "allows /feed/ and articles; Crawl-delay 10 and 30 in two groups",
      terms: "no terms page found at common paths; needs a manual read before launch",
    },
  },
  {
    key: "daily-trust",
    name: "Daily Trust",
    feedUrl: "https://dailytrust.com/feed/",
    homepage: "https://dailytrust.com",
    tier: 1,
    review: {
      checked: "2026-10-25",
      robots: "allows all agents outside plugin paths",
      terms: "/terms-of-use/ keyword scan found no clause on crawling, automated access or RSS",
    },
  },
  {
    key: "channels",
    name: "Channels TV",
    feedUrl: "https://www.channelstv.com/feed/",
    homepage: "https://www.channelstv.com",
    tier: 1,
    review: {
      checked: "2026-10-25",
      robots: "allows articles; Crawl-delay 30",
      terms: "no terms page found at common paths; needs a manual read before launch",
    },
  },
  {
    key: "businessday",
    name: "BusinessDay",
    feedUrl: "https://businessday.ng/feed/",
    homepage: "https://businessday.ng",
    tier: 2,
    review: {
      checked: "2026-10-25",
      robots: "allows articles outside /search/ and AMP variants",
      terms: "no terms page found (/legal/ is a short notice); needs a manual read before launch",
    },
  },
  {
    key: "nairametrics",
    name: "Nairametrics",
    feedUrl: "https://nairametrics.com/feed/",
    homepage: "https://nairametrics.com",
    tier: 2,
    review: {
      checked: "2026-10-25",
      robots: "allows all agents",
      terms: "/tos/ keyword scan found no clause on crawling, automated access or RSS",
    },
  },
];

const bareHost = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** The configured source whose homepage is on the same site as `url`. */
export function sourceForUrl(url: string, list: Source[] = sources): Source | undefined {
  const host = bareHost(url);
  return list.find((s) => {
    const home = bareHost(s.homepage);
    return host === home || host.endsWith(`.${home}`);
  });
}
