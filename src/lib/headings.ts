// Diary heading categories — used by the app, templates, and export/import.
// Keep this list in sync with the `heading_categories` seed in Supabase (see supabase/schema.sql).

export interface HeadingCategory {
  emoji: string;
  title: string; // e.g. "Morning & Night Greetings"
  whenToUse: string;
  onlyIfMentioned?: boolean;
}

export const HEADING_CATEGORIES: HeadingCategory[] = [
  { emoji: '🌅', title: 'Morning & Night Greetings', whenToUse: 'For good mornings/nights' },
  { emoji: '💬', title: 'Daily Life & Important Updates', whenToUse: 'For daily conversations' },
  { emoji: '💖', title: 'Sweet Compliments & Love', whenToUse: 'For loving words' },
  { emoji: '👨‍👩‍👧‍👦', title: 'About Kesha (Her Sister)', whenToUse: 'ONLY if mentioned', onlyIfMentioned: true },
  { emoji: '👨‍👩‍👧‍👦', title: 'About Arya (Her Brother)', whenToUse: 'ONLY if mentioned', onlyIfMentioned: true },
  { emoji: '🎯', title: 'Dreams & Future Plans', whenToUse: 'For future goals' },
  { emoji: '🤗', title: 'Emotional Support & Care', whenToUse: 'For emotional talks' },
  { emoji: '😄', title: 'Fun Moments & Jokes', whenToUse: 'For funny moments' },
  { emoji: '🔥', title: 'Flirty Banter & Teasing', whenToUse: 'For flirty exchanges' },
  { emoji: '💕', title: 'Romantic Confessions', whenToUse: 'For romantic declarations' },
  { emoji: '💘', title: 'Attraction & Desire', whenToUse: 'For attraction talks' },
  { emoji: '🌙', title: 'Intimate & Passionate Talks', whenToUse: 'For intimate moments' },
  { emoji: '💝', title: 'Deep Chemistry & Connection', whenToUse: 'For deep connection' },
  { emoji: '💭', title: 'My Messages To Her (No Reply Yet)', whenToUse: "For Deep's messages without reply" },
  { emoji: '💌', title: 'Her Messages To Me', whenToUse: "For her messages without Deep's reply" },
];

export const DEFAULT_HEADING_EMOJI = '💬';
export const DEFAULT_HEADING_TITLE = 'Daily Life & Important Updates';

/** Full heading text as stored in the DB, e.g. "🌅 Morning & Night Greetings" */
export function buildHeadingText(emoji: string, title: string): string {
  return `${emoji} ${title}`.trim();
}

export function defaultHeading(): string {
  return buildHeadingText(DEFAULT_HEADING_EMOJI, DEFAULT_HEADING_TITLE);
}

/** Find a stored heading text -> category (tolerant of missing/extra emoji) */
export function findCategory(heading: string | null | undefined): HeadingCategory | undefined {
  if (!heading) return undefined;
  const normalized = heading.trim();
  return HEADING_CATEGORIES.find(
    (c) =>
      normalized === buildHeadingText(c.emoji, c.title) ||
      normalized === c.title ||
      normalized.endsWith(c.title)
  );
}

/** Parse "- Message: ..." bullet lines out of a markdown-ish template file.
 *  Handles multiple "#### HEADING N:" sections; entries fall back to the nearest heading above them. */
export function parseTemplateEntries(text: string): { heading: string; dateTime: string; senderName: string; message: string; reflection: string }[] {
  const parsed: { heading: string; dateTime: string; senderName: string; message: string; reflection: string }[] = [];

  // Split into blocks at every heading line or "- Message:" bullet, keeping the delimiter
  const parts = text.split(/(?=^#{2,6}\s*HEADING\s*\d+\s*:)|(?=^\s*-\s*Message:)/im);

  let currentHeading = defaultHeading();

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Heading section marker -> update current heading
    const headingMatch = trimmed.match(/^#{2,6}\s*HEADING\s*\d+\s*:\s*(.+?)(?:\r?\n[\s\S]*)?$/im);
    if (/^#{2,6}\s*HEADING/i.test(trimmed) && headingMatch) {
      currentHeading = normalizeHeadingFromTemplate(headingMatch[1].trim());
    }

    if (!/^-?\s*Message:/i.test(trimmed)) continue;

    const body = trimmed.replace(/^-\s*/, '');
    const messageRegex = /Message:\s*(.+?)\s*-\s*(.+?):\s*"([\s\S]+?)"\s*(?:\r?\n)\s*What I felt:\s*([\s\S]*?)(?=\r?\n\s*-\s*Message:|\r?\n---|$)/i;
    const m = body.match(messageRegex);
    if (m) {
      parsed.push({
        heading: currentHeading,
        dateTime: m[1].trim(),
        senderName: m[2].trim(),
        message: m[3].trim(),
        reflection: m[4].trim().replace(/\n---\s*$/, '').trim(),
      });
    }
  }
  return parsed;
}

export function normalizeHeadingFromTemplate(raw: string): string {
  // Template heading line looks like "[Topic Name]" or an actual topic
  const known = HEADING_CATEGORIES.find((c) => raw.includes(c.title));
  if (known) return buildHeadingText(known.emoji, known.title);
  return raw.replace(/^\[[^\]]*\]$/, defaultHeading());
}

/** Parse a date/time string written by a human into a sortable timestamp.
 *  Handles "January 15, 2026, 10:30 AM", "15 Jan 2026 10:30", ISO strings, etc.
 *  Returns null when unparseable. */
export function parseDateTimeToMillis(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Direct Date parsing works for "January 15, 2026, 10:30 AM" and ISO formats
  const direct = Date.parse(s);
  if (!Number.isNaN(direct)) return direct;

  // Normalize separators then retry ("15/01/2026 10:30", "15-01-2026")
  const normalized = s.replace(/\//g, '-');
  const retry = Date.parse(normalized);
  if (!Retry_isNaN(retry)) return retry;

  return null;
}

function Retry_isNaN(n: number): boolean {
  return Number.isNaN(n);
}

/** Chronological comparator (oldest first). Unparseable dates sink to the end,
 *  keeping their original relative order. */
export function compareChronologically<T>(
  a: T & { dateTime?: string },
  b: T & { dateTime?: string }
): number {
  const ma = parseDateTimeToMillis(a.dateTime);
  const mb = parseDateTimeToMillis(b.dateTime);
  if (ma === null && mb === null) return 0;
  if (ma === null) return 1;
  if (mb === null) return -1;
  return ma - mb;
}

/** Compute a human-readable date range covering all entries, e.g.
 *  "January 15, 2026 → January 17, 2026". Returns null if no parseable dates. */
export function dateRangeOf(dateTimes: (string | null | undefined)[]): string | null {
  const millis = dateTimes
    .map((d) => parseDateTimeToMillis(d ?? undefined))
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);
  if (millis.length === 0) return null;
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const first = fmt(millis[0]);
  const last = fmt(millis[millis.length - 1]);
  return first === last ? first : `${first} → ${last}`;
}
