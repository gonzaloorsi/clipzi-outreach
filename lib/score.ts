// Language-agnostic channel scoring.
// Replaces the Spanish-keyword-based scoring in legacy/daily-outreach.mjs:881.
//
// Signals (in order of impact):
// 1. Subscriber count sweet spot (50K-10M = creators who self-edit but produce volume)
// 2. Video count (more content = more clips potential)
// 3. Topic categories (good niches via YouTube's own taxonomy, not keywords)
// 4. Professional email domain (not gmail/yahoo/etc — signals serious operation)

export const MIN_SUBSCRIBERS = 7_000;

export interface ScoreInput {
  subscribers: number | null;
  videoCount: number | null;
  topicCategories: string[] | null; // YouTube topic URIs
  primaryEmail: string | null;
  country: string | null;
}

// YouTube topic categories (from topicDetails.topicCategories). These are
// Wikipedia URIs that YT auto-tags. Multilingual by definition.
//
// Reference: https://developers.google.com/youtube/v3/docs/channels#topicDetails.topicCategories
const TOPIC_GOOD = [
  "/wiki/Lifestyle_(sociology)",
  "/wiki/Knowledge",
  "/wiki/Entertainment",
  "/wiki/Society",
  "/wiki/Hobby",
  "/wiki/Health",
  "/wiki/Physical_fitness",
  "/wiki/Sport",
  "/wiki/Food",
  "/wiki/Humour",
  "/wiki/Action_game",
  "/wiki/Action-adventure_game",
  "/wiki/Casual_game",
  "/wiki/Music_video_game", // creators commenting/playing, not labels
  "/wiki/Role-playing_video_game",
  "/wiki/Simulation_video_game",
  "/wiki/Sports_game",
  "/wiki/Strategy_video_game",
  "/wiki/Pet",
  "/wiki/Vehicle",
  "/wiki/Tourism",
  "/wiki/Performing_arts",
];

// Categories that are mostly major labels / news outlets / institutional
// content — not the kind of creator we want to email.
const TOPIC_BAD = [
  // Music as a topic mostly catches major labels / VEVO
  "/wiki/Music",
  "/wiki/Pop_music",
  "/wiki/Rock_music",
  "/wiki/Hip_hop_music",
  "/wiki/Electronic_music",
  "/wiki/Country_music",
  "/wiki/Classical_music",
  "/wiki/Independent_music",
  "/wiki/Jazz",
  "/wiki/Reggae",
  // Religion is dicey for cold outreach
  "/wiki/Religion",
  "/wiki/Christianity",
];

// Email domains that signal a personal/free address. Lower score, since it
// often means a small one-person op (less likely to convert) or a fan email.
const FREE_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "yahoo.es",
  "yahoo.com.mx",
  "yahoo.com.ar",
  "yahoo.com.br",
  "hotmail.com",
  "hotmail.es",
  "hotmail.com.ar",
  "outlook.com",
  "outlook.es",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
];

export function scoreChannel(c: ScoreInput): number {
  let score = 0;
  const subs = c.subscribers ?? 0;

  // Subscriber sweet spot
  if (subs >= 50_000 && subs <= 10_000_000) score += 30;
  else if (subs >= 10_000 && subs < 50_000) score += 15;
  else if (subs > 10_000_000) score += 20; // too big to convert easily but high value if they do
  else if (subs >= MIN_SUBSCRIBERS) score += 8;
  else score -= 20; // below threshold

  // Video count — more content = more raw material to clip
  const videoCount = c.videoCount ?? 0;
  if (videoCount > 500) score += 20;
  else if (videoCount > 100) score += 15;
  else if (videoCount > 30) score += 10;
  else if (videoCount > 10) score += 5;
  else score -= 5;

  // Topic categories
  if (c.topicCategories && c.topicCategories.length > 0) {
    const goodHits = c.topicCategories.filter((t) =>
      TOPIC_GOOD.some((g) => t.endsWith(g)),
    ).length;
    const badHits = c.topicCategories.filter((t) =>
      TOPIC_BAD.some((b) => t.endsWith(b)),
    ).length;
    score += goodHits * 8;
    score -= badHits * 15;
  }

  // Email domain
  if (c.primaryEmail) {
    const domain = c.primaryEmail.split("@")[1]?.toLowerCase() ?? "";
    if (domain && !FREE_EMAIL_DOMAINS.includes(domain)) score += 10;
  } else {
    // No email = can't send anyway, but score is still computed for refresh prio
    score -= 30;
  }

  return score;
}

export function meetsThreshold(c: ScoreInput): boolean {
  return (c.subscribers ?? 0) >= MIN_SUBSCRIBERS;
}
