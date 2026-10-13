const HEADING_CATEGORIES = [
  { emoji: "\u{1F305}", title: "Morning & Night Greetings", whenToUse: "For good mornings/nights" },
  { emoji: "\u{1F4AC}", title: "Daily Life & Important Updates", whenToUse: "For daily conversations" },
  { emoji: "\u{1F496}", title: "Sweet Compliments & Love", whenToUse: "For loving words" },
  { emoji: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", title: "About Kesha (Her Sister)", whenToUse: "ONLY if mentioned", onlyIfMentioned: true },
  { emoji: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", title: "About Arya (Her Brother)", whenToUse: "ONLY if mentioned", onlyIfMentioned: true },
  { emoji: "\u{1F3AF}", title: "Dreams & Future Plans", whenToUse: "For future goals" },
  { emoji: "\u{1F917}", title: "Emotional Support & Care", whenToUse: "For emotional talks" },
  { emoji: "\u{1F604}", title: "Fun Moments & Jokes", whenToUse: "For funny moments" },
  { emoji: "\u{1F525}", title: "Flirty Banter & Teasing", whenToUse: "For flirty exchanges" },
  { emoji: "\u{1F495}", title: "Romantic Confessions", whenToUse: "For romantic declarations" },
  { emoji: "\u{1F498}", title: "Attraction & Desire", whenToUse: "For attraction talks" },
  { emoji: "\u{1F319}", title: "Intimate & Passionate Talks", whenToUse: "For intimate moments" },
  { emoji: "\u{1F49D}", title: "Deep Chemistry & Connection", whenToUse: "For deep connection" },
  { emoji: "\u{1F4AD}", title: "My Messages To Her (No Reply Yet)", whenToUse: "For Deep's messages without reply" },
  { emoji: "\u{1F48C}", title: "Her Messages To Me", whenToUse: "For her messages without Deep's reply" }
];
const DEFAULT_HEADING_EMOJI = "\u{1F4AC}";
const DEFAULT_HEADING_TITLE = "Daily Life & Important Updates";
function buildHeadingText(emoji, title) {
  return `${emoji} ${title}`.trim();
}
function defaultHeading() {
  return buildHeadingText(DEFAULT_HEADING_EMOJI, DEFAULT_HEADING_TITLE);
}
function findCategory(heading) {
  if (!heading) return void 0;
  const normalized = heading.trim();
  return HEADING_CATEGORIES.find(
    (c) => normalized === buildHeadingText(c.emoji, c.title) || normalized === c.title || normalized.endsWith(c.title)
  );
}
function parseTemplateEntries(text) {
  const parsed = [];
  const parts = text.split(/(?=^#{2,6}\s*HEADING\s*\d+\s*:)|(?=^\s*-\s*Message:)/im);
  let currentHeading = defaultHeading();
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const headingMatch = trimmed.match(/^#{2,6}\s*HEADING\s*\d+\s*:\s*(.+?)(?:\r?\n[\s\S]*)?$/im);
    if (/^#{2,6}\s*HEADING/i.test(trimmed) && headingMatch) {
      currentHeading = normalizeHeadingFromTemplate(headingMatch[1].trim());
    }
    if (!/^-?\s*Message:/i.test(trimmed)) continue;
    const body = trimmed.replace(/^-\s*/, "");
    const messageRegex = /Message:\s*(.+?)\s*-\s*(.+?):\s*"([\s\S]+?)"\s*(?:\r?\n)\s*What I felt:\s*([\s\S]*?)(?=\r?\n\s*-\s*Message:|\r?\n---|$)/i;
    const m = body.match(messageRegex);
    if (m) {
      parsed.push({
        heading: currentHeading,
        dateTime: m[1].trim(),
        senderName: m[2].trim(),
        message: m[3].trim(),
        reflection: m[4].trim().replace(/\n---\s*$/, "").trim()
      });
    }
  }
  return parsed;
}
function normalizeHeadingFromTemplate(raw) {
  const known = HEADING_CATEGORIES.find((c) => raw.includes(c.title));
  if (known) return buildHeadingText(known.emoji, known.title);
  return raw.replace(/^\[[^\]]*\]$/, defaultHeading());
}
function parseDateTimeToMillis(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const direct = Date.parse(s);
  if (!Number.isNaN(direct)) return direct;
  const normalized = s.replace(/\//g, "-");
  const retry = Date.parse(normalized);
  if (!Retry_isNaN(retry)) return retry;
  return null;
}
function Retry_isNaN(n) {
  return Number.isNaN(n);
}
function compareChronologically(a, b) {
  const ma = parseDateTimeToMillis(a.dateTime);
  const mb = parseDateTimeToMillis(b.dateTime);
  if (ma === null && mb === null) return 0;
  if (ma === null) return 1;
  if (mb === null) return -1;
  return ma - mb;
}
function dateRangeOf(dateTimes) {
  const millis = dateTimes.map((d) => parseDateTimeToMillis(d ?? void 0)).filter((m) => m !== null).sort((a, b) => a - b);
  if (millis.length === 0) return null;
  const fmt = (ms) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const first = fmt(millis[0]);
  const last = fmt(millis[millis.length - 1]);
  return first === last ? first : `${first} \u2192 ${last}`;
}
export {
  DEFAULT_HEADING_EMOJI,
  DEFAULT_HEADING_TITLE,
  HEADING_CATEGORIES,
  buildHeadingText,
  compareChronologically,
  dateRangeOf,
  defaultHeading,
  findCategory,
  normalizeHeadingFromTemplate,
  parseDateTimeToMillis,
  parseTemplateEntries
};
