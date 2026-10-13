import { useState, useEffect, useRef } from 'react';
import { supabase, DiaryEntry as SupabaseEntry } from './lib/supabase';
import Auth from './components/Auth';
import {
  HEADING_CATEGORIES,
  defaultHeading,
  buildHeadingText,
  parseTemplateEntries,
  compareChronologically,
  dateRangeOf,
} from './lib/headings';
import { FIXED_USER_ID, ensureSupabaseSession } from './lib/hardcodedAuth';
import { readLocalSession, clearLocalSession, writeLocalSessionItem, readLocalSessionItem } from './lib/localSession';
import { exportDiaryToA4Pdf, CONTENT_W_CSS } from './lib/pdfExport';
import { resolveImageUrl, loadDataUrlCached } from './lib/images';
import { LoveStoryHeader, LoveStoryFooter } from './lib/loveStory';

/** CSS px per mm at 96dpi — the sheet is laid out in real millimetres. */
const PX_PER_MM = 96 / 25.4;

// Sticker: an image (from a link) placed anywhere on an A4 page.
interface Sticker {
  id: string;
  url: string;
  page: number;   // 0-based page index it is pinned to
  xPct: number;   // horizontal position as % of page width
  yPct: number;   // vertical position as % of page height
  sizePct: number; // width as % of page width
  rotate: number;  // degrees
}

const STICKERS_KEY = 'diary_stickers_v1';

interface DiaryEntry {
  id: string;
  heading: string;
  dateTime: string;
  senderName: string;
  message: string;
  reflection: string;
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [heading, setHeading] = useState<string>(defaultHeading());
  const [senderName, setSenderName] = useState('');
  const [message, setMessage] = useState('');
  const [reflection, setReflection] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // --- A4 book view state ---
  const [currentPage, setCurrentPage] = useState(0);
  const [sheetScale, setSheetScale] = useState(1);
  const sheetWrapRef = useRef<HTMLDivElement>(null);

  // --- Stickers (images from links placed anywhere on the page) ---
  const [stickers, setStickers] = useState<Sticker[]>(() => readLocalSessionItem<Sticker[]>(STICKERS_KEY, []));
  const [showStickerModal, setShowStickerModal] = useState(false);
  const [stickerUrl, setStickerUrl] = useState('');
  const [stickerSize, setStickerSize] = useState(25); // % of page width
  const [stickerRotate, setStickerRotate] = useState(-3); // degrees
  const [placingMode, setPlacingMode] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
  const [flipDir, setFlipDir] = useState<'next' | 'prev'>('next');

  // Check auth state on mount — hardcoded login gate (DeepNectar)
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const session = await readLocalSession();
        if (!mounted) return;
        if (session) {
          // Establish a real Supabase session so RLS policies accept our writes.
          const uid = await ensureSupabaseSession();
          if (!mounted) return;
          setUser({ id: uid, email: FIXED_USER_ID, name: FIXED_USER_ID });
          setSenderName('Deep');
          fetchEntries(uid);
        }
      } catch (err) {
        console.error('Auth check failed:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    return () => {
      mounted = false;
    };
  }, []);

  const handleAuthSuccess = async () => {
    // Establish a real Supabase session so RLS policies will accept writes.
    // Throws with a readable message on failure — Auth shows the error and
    // resets the button, so the user is never stuck on "Please wait...".
    const uid = await ensureSupabaseSession();
    setUser({ id: uid, email: FIXED_USER_ID, name: FIXED_USER_ID });
    setSenderName('Deep');
    fetchEntries(uid);
  };

  const fetchEntries = async (_uid?: string) => {
    try {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching entries:', error);
        setImportStatus({ type: 'error', message: 'Failed to load entries' });
      } else {
        setEntries(data.map(mapSupabaseEntry));
      }
    } catch (err) {
      console.error('Error fetching entries:', err);
      setImportStatus({ type: 'error', message: 'Failed to load entries' });
    }
  };

  const mapSupabaseEntry = (entry: SupabaseEntry): DiaryEntry => ({
    id: entry.id,
    heading: entry.heading || defaultHeading(),
    dateTime: entry.date_time,
    senderName: entry.sender_name,
    message: entry.message,
    reflection: entry.reflection,
  });

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-dismiss import status
  useEffect(() => {
    if (importStatus) {
      const timer = setTimeout(() => setImportStatus(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [importStatus]);

  const getCurrentDateTime = () => {
    const now = new Date();
    return now.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleLogout = async () => {
    clearLocalSession();
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore — hardcoded session is what matters */
    }
    setUser(null);
    setEntries([]);
    // Also reset the cached uid so a stale value isn't reused after logout.
    await import('./lib/hardcodedAuth').then((m) => m.resetCachedUserId());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !reflection.trim() || !user) return;

    const entryData = {
      user_id: user.id,
      heading: heading || defaultHeading(),
      date_time: getCurrentDateTime(),
      sender_name: (senderName === FIXED_USER_ID ? 'Deep' : senderName) || 'Deep',
      message: message.trim(),
      reflection: reflection.trim(),
    };

    if (editingId) {
      // Update existing entry
      const { error } = await supabase
        .from('diary_entries')
        .update(entryData)
        .eq('id', editingId);

      if (error) {
        setImportStatus({ type: 'error', message: `Failed to update entry: ${error.message}` });
      } else {
        setImportStatus({ type: 'success', message: 'Entry updated successfully!' });
        fetchEntries();
      }
    } else {
      // Insert new entry
      const { error } = await supabase
        .from('diary_entries')
        .insert([entryData]);

      if (error) {
        setImportStatus({ type: 'error', message: `Failed to save entry: ${error.message}` });
      } else {
        setImportStatus({ type: 'success', message: 'Entry saved successfully!' });
        fetchEntries();
      }
    }

    setMessage('');
    setReflection('');
    setShowForm(false);
    setEditingId(null);
  };

  const handleEdit = (entry: DiaryEntry) => {
    setHeading(entry.heading || defaultHeading());
    setSenderName(entry.senderName);
    setMessage(entry.message);
    setReflection(entry.reflection);
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this entry?')) {
      const { error } = await supabase
        .from('diary_entries')
        .delete()
        .eq('id', id);

      if (error) {
        setImportStatus({ type: 'error', message: 'Failed to delete entry' });
      } else {
        setImportStatus({ type: 'success', message: 'Entry deleted successfully!' });
        fetchEntries();
      }
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setHeading(defaultHeading());
    setMessage('');
    setReflection('');
  };

  // --- Build the COMPLETE DIARY view: one flat chronological stream, grouped under headings ---
  interface CompleteDiaryGroup {
    heading: string;
    number: number;
    items: DiaryEntry[];
  }

  const buildCompleteDiary = (list: DiaryEntry[]): CompleteDiaryGroup[] => {
    // 1. Sort ALL entries chronologically (oldest → newest) — mandatory per format
    const chrono = [...list].sort(compareChronologically);
    // 2. Assign each entry to exactly ONE heading: its stored heading when valid,
    //    otherwise auto-classify from content/sender.
    const canonical = new Set(HEADING_CATEGORIES.map((c) => buildHeadingText(c.emoji, c.title)));
    const withHeading = chrono.map((e) => ({
      ...e,
      assignedHeading: canonical.has(e.heading || '') ? e.heading! : autoClassifyHeading(e),
    }));
    // 3. Group in FIRST-APPEARANCE chronological order (keeps diary reading like a story)
    const groups: CompleteDiaryGroup[] = [];
    const indexByHeading = new Map<string, number>();
    for (const e of withHeading) {
      let idx = indexByHeading.get(e.assignedHeading);
      if (idx === undefined) {
        idx = groups.length;
        indexByHeading.set(e.assignedHeading, idx);
        groups.push({ heading: e.assignedHeading, number: idx + 1, items: [] });
      }
      groups[idx].items.push(e);
    }
    return groups;
  };

  // --- Auto-classify an entry into the most relevant heading ---
  const autoClassifyHeading = (e: DiaryEntry): string => {
    const t = `${e.message} ${e.reflection}`.toLowerCase();
    const has = (...words: string[]) => words.some((w) => t.includes(w));
    const isHer = /chota don/i.test(e.senderName);

    if (has('kesha')) return '👨‍👩‍👧‍👦 About Kesha (Her Sister)';
    if (has('arya')) return '👨‍👩‍👧‍👦 About Arya (Her Brother)';
    if (has('good morning', 'gm ', 'morning ☀', 'sunrise', 'good night', 'goodnight', 'gn ', 'night 🌙', 'sleep tight', 'fell asleep'))
      return '🌅 Morning & Night Greetings';
    if (has('no reply', 'hasn', "didn't reply", 'not replied', 'waiting for reply', 'still waiting', 'left on read', 'seen but no reply'))
      return '💭 My Messages To Her (No Reply Yet)';
    if (has('marry', 'future', 'plan', 'dream', 'goal', 'someday', 'life together', 'kids', 'house'))
      return '🎯 Dreams & Future Plans';
    if (has('intimate', 'private - intimate', 'passionate', 'spicy', 'kiss', 'hold you', 'miss your touch', 'desire', 'attraction', 'beautiful body', 'crave'))
      return '🌙 Intimate & Passionate Talks';
    if (has('love you', 'i love', 'love of my life', 'forever yours', 'confess', 'yours only', 'heart belongs'))
      return '💕 Romantic Confessions';
    if (has('flirt', 'tease', 'joke', 'lol', 'lmao', 'haha', 'funny', '😂', '🤣', 'silly', 'bakchodi'))
      return '😄 Fun Moments & Jokes';
    if (has('sad', 'cry', 'crying', 'upset', 'angry', 'fight', 'argument', 'worried', 'anxious', 'stress', 'tired', 'support', 'care about', 'take care', 'eat something', 'health'))
      return '🤗 Emotional Support & Care';
    if (has('compliment', 'pretty', 'cute', 'gorgeous', 'smart', 'best girl', 'proud of you', 'adorable', 'sweet'))
      return '💖 Sweet Compliments & Love';
    if (isHer && !e.reflection) return '💌 Her Messages To Me';
    return '💬 Daily Life & Important Updates';
  };

  // --- Auto-generated FINAL SUMMARY (8-10 lines) from all entries ---
  const buildSummaryLines = (list: DiaryEntry[]): string[] => {
    const total = list.length;
    const hers = list.filter((e) => /chota don/i.test(e.senderName)).length;
    const mine = total - hers;
    const sorted = [...list].sort(compareChronologically);
    const firstDate = sorted[0]?.dateTime || 'the beginning';
    const lastDate = sorted[sorted.length - 1]?.dateTime || 'today';
    const range = dateRangeOf(list.map((e) => e.dateTime)) || 'dates not specified';
    return [
      `This diary holds ${total} precious moments between me (Deep) and 🫰🫶🏻Chota Don❣️❤️😘, spanning ${range}.`,
      `From ${firstDate} to ${lastDate}, every entry shows how our bond grows stronger day by day.`,
      `Our sweet morning and night greetings are the threads that tie each day together.`,
      `${mine} of my messages and ${hers} of her messages make up the daily rhythm of our connection.`,
      `The compliments, flirty banter, and romantic confessions keep the spark alive between us.`,
      `Even in the quiet moments when she hasn't replied, I choose patience because waiting for her feels worth it.`,
      `Her care — asking if I ate, wishing me good sleep — makes me feel truly loved and protected.`,
      `My dreams of a future with her give every single day a deeper meaning.`,
      `She makes me feel seen, cherished, and complete; this diary is proof of our beautiful journey.`,
      `I am grateful for every word we have shared, and for every one still to come.`,
    ];
  };

  // --- Import/Export Functions ---

  const handleExportJSON = () => {
    const data = JSON.stringify(entries, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diary-entries-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowMenu(false);
    setImportStatus({ type: 'success', message: `Exported ${entries.length} entries successfully!` });
  };

  const handleExportText = () => {
    // Export in the COMPLETE DIARY format: chronological, grouped under numbered headings,
    // with date range at top and a final summary at the bottom.
    const groups = buildCompleteDiary(entries);
    const range = dateRangeOf(entries.map((e) => e.dateTime)) || 'Dates not specified';
    const headingSections = groups
      .map((group) => {
        const lines = group.items.map(
          (entry) =>
            `- Message: ${entry.dateTime} - ${entry.senderName}: "${entry.message}"\n  What I felt: ${entry.reflection}`
        );
        return `#### HEADING ${group.number}: ${group.heading}\n\n${lines.join('\n\n')}\n\n---\n`;
      })
      .join('\n');

    // Final summary — auto-generated from the reorganized entries (8-10 lines)
    const total = entries.length;
    const hers = entries.filter((e) => /chota don/i.test(e.senderName)).length;
    const mine = total - hers;
    const sortedDates = [...entries].sort(compareChronologically);
    const firstDate = sortedDates[0]?.dateTime || 'the beginning';
    const lastDate = sortedDates[sortedDates.length - 1]?.dateTime || 'today';
    const summaryLines = [
      `This diary holds ${total} precious moments between me (Deep) and 🫰🫶🏻Chota Don❣️❤️😘, spanning ${range}.`,
      `From ${firstDate} to ${lastDate}, every entry shows how our bond grows stronger day by day.`,
      `Our sweet morning and night greetings are the threads that tie each day together.`,
      `${mine} of my messages and ${hers} of her messages make up the daily rhythm of our connection.`,
      `The compliments, flirty banter, and romantic confessions keep the spark alive between us.`,
      `Even in the quiet moments when she hasn't replied, I choose patience because waiting for her feels worth it.`,
      `Her care — asking if I ate, wishing me good sleep — makes me feel truly loved and protected.`,
      `My dreams of a future with her give every single day a deeper meaning.`,
      `She makes me feel seen, cherished, and complete; this diary is proof of our beautiful journey.`,
      `I am grateful for every word we have shared, and for every one still to come.`,
    ];
    const summary = [
      `### 📌 FINAL SUMMARY - COMPLETE DIARY`,
      ``,
      ...summaryLines,
      ``,
      `========================================`,
    ].join('\n');

    const text = [
      `========================================`,
      `📖 COMPLETE DIARY - DEEP & 🫰🫶🏻CHOTA DON❣️❤️😘`,
      `========================================`,
      ``,
      `### Date: ${range}`,
      ``,
      `---`,
      ``,
      headingSections,
      summary,
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diary-entries-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowMenu(false);
    setImportStatus({ type: 'success', message: `Exported ${entries.length} entries as text!` });
  };

  const parseTextEntries = (text: string): Omit<DiaryEntry, 'id'>[] => {
    // New template format with "#### HEADING N:" sections and "- Message:" bullets
    const templated = parseTemplateEntries(text);
    if (templated.length > 0) {
      return templated.map((t) => ({
        heading: t.heading,
        dateTime: t.dateTime,
        senderName: t.senderName,
        message: t.message,
        reflection: t.reflection,
      }));
    }

    // Legacy plain format fallback
    const parsed: Omit<DiaryEntry, 'id'>[] = [];
    const blocks = text.split(/\n---\n|\n\n(?=Message:)/);

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      const messageRegex = /Message:\s*(.+?)\s*-\s*(.+?):\s*"(.+?)"/s;
      const messageMatch = trimmed.match(messageRegex);

      if (messageMatch) {
        const dateTime = messageMatch[1].trim();
        const senderName = messageMatch[2].trim();
        const messageContent = messageMatch[3].trim();

        const reflectionRegex = /What I felt:\s*(.+)/s;
        const reflectionMatch = trimmed.match(reflectionRegex);
        const reflectionContent = reflectionMatch ? reflectionMatch[1].trim() : '';

        if (messageContent) {
          parsed.push({
            heading: defaultHeading(),
            dateTime,
            senderName,
            message: messageContent,
            reflection: reflectionContent,
          });
        }
      }
    }
    return parsed;
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        let imported: Omit<DiaryEntry, 'id'>[] = [];

        if (file.name.endsWith('.json')) {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            imported = data.map((item: any) => ({
              heading: item.heading || item.date_heading || defaultHeading(),
              dateTime: item.dateTime || item.date_time || 'Unknown date',
              senderName: item.senderName || item.sender_name || 'Anonymous',
              message: item.message || '',
              reflection: item.reflection || '',
            }));
          } else {
            throw new Error('Invalid JSON format. Expected an array of entries.');
          }
        } else if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
          imported = parseTextEntries(content);
          if (imported.length === 0) {
            throw new Error('Could not parse any entries from this text file.');
          }
        } else {
          throw new Error('Unsupported file format. Please use .json or .txt files.');
        }

        if (imported.length === 0) {
          throw new Error('No valid entries found in the file.');
        }

        // Sort chronologically (oldest -> newest) so cloud order matches the diary format
        imported.sort(compareChronologically);

        // Insert all entries to Supabase
        const entriesToInsert = imported.map(entry => ({
          user_id: user.id,
          heading: entry.heading || defaultHeading(),
          date_time: entry.dateTime,
          sender_name: entry.senderName,
          message: entry.message,
          reflection: entry.reflection,
        }));

        const { error } = await supabase
          .from('diary_entries')
          .insert(entriesToInsert);

        if (error) throw error;

        setShowImportModal(false);
        setImportStatus({ type: 'success', message: `Successfully imported ${imported.length} ${imported.length === 1 ? 'entry' : 'entries'}!` });
        fetchEntries();
      } catch (err: any) {
        setImportStatus({ type: 'error', message: err.message || 'Failed to import file.' });
      }
    };
    reader.onerror = () => {
      setImportStatus({ type: 'error', message: 'Failed to read the file.' });
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImportClick = () => {
    setShowMenu(false);
    setShowImportModal(true);
  };

  const filteredEntries = entries.filter(entry =>
    entry.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.reflection.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.senderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (entry.heading || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const completeDiaryGroups = buildCompleteDiary(filteredEntries);
  const diaryDateRange = dateRangeOf(entries.map((e) => e.dateTime));

  // =====================================================================
  // EXACT A4 PAGINATION — one flat stream of atomic blocks, measured from
  // the live DOM at true print size. The SAME pages drive the on-screen
  // sheet and the exported PDF, so nothing overflows and no page is left
  // with big empty gaps.
  // =====================================================================
  const flowHostRef = useRef<HTMLDivElement>(null);
  const [flowPages, setFlowPages] = useState<{ key: string; html: string; height: number }[][]>([]);
  const [flowTick, setFlowTick] = useState(0);

  const esc = (s: string) =>
    (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const buildBlocksHtml = (): { key: string; html: string }[] => {
    const out: { key: string; html: string }[] = [];

    // Cover block — always first on page 1 (fills the top area nicely)
    out.push({
      key: 'cover',
      html: `
        <div class="pg-cover">
          <div class="pg-cover-emoji">📖💕</div>
          <h1 class="pg-cover-title">OUR LOVE STORY — COMPLETE DIARY</h1>
          <h2 class="pg-cover-sub">Deep &amp; Shinu (🫰🫶🏻 Chota Don ❣️❤️😘)</h2>
          <div class="pg-cover-rule">============================================================</div>
          <p class="pg-cover-date"><strong>Date:</strong> ${esc(diaryDateRange || 'Date not specified — arranged by context')}</p>
          <p class="pg-cover-note">Oldest → newest · grouped under headings · nothing added, nothing removed</p>
        </div>`,
    });

    for (const group of completeDiaryGroups) {
      out.push({
        key: `h-${group.number}-${out.length}`,
        html: `<h2 class="pg-heading"><span class="pg-hnum">${group.number}</span>${esc(group.heading)}<span class="pg-hcount">(${group.items.length})</span></h2>`,
      });
      for (const entry of group.items) {
        out.push({
          key: `e-${entry.id}`,
          html: `
            <div class="pg-entry">
              <div class="pg-meta">🕐 ${esc(entry.dateTime)}</div>
              <div class="pg-msg"><strong class="pg-sender-label">Message:</strong> <strong>${esc(entry.dateTime)}</strong> - <strong class="pg-sender">${esc(entry.senderName)}</strong>: <em>"${esc(entry.message)}"</em></div>
              <div class="pg-feel"><strong class="pg-feel-label">💭 What I felt:</strong> ${esc(entry.reflection)}</div>
            </div>`,
        });
      }
    }

    if (filteredEntries.length > 0 && !searchQuery) {
      const summaryLines = buildSummaryLines(entries);
      out.push({ key: 'summary-title', html: `<h2 class="pg-heading pg-summary-title">📌 FINAL SUMMARY — COMPLETE DIARY</h2>` });
      out.push({
        key: 'summary-list',
        html: `<ul class="pg-summary-list">${summaryLines.map((l) => `<li><span class="pg-bullet">•</span> ${esc(l)}</li>`).join('')}</ul>`,
      });
      out.push({ key: 'sum-end', html: `<p class="pg-sum-end">========================================</p>` });
    }

    return out;
  };

  // Measure every atomic block once, then pack them into exact A4 sheets.
  useEffect(() => {
    if (!user || entries.length === 0) {
      setFlowPages([]);
      return;
    }
    const host = flowHostRef.current;
    if (!host) return;

    const raf = requestAnimationFrame(() => {
      const blocks = buildBlocksHtml();
      host.innerHTML = blocks
        .map((b) => `<div data-k="${b.key}" style="width:${CONTENT_W_CSS}px;box-sizing:border-box;">${b.html}</div>`)
        .join('');

      const measured = Array.from(host.children as HTMLCollectionOf<HTMLElement>).map((el, i) => ({
        key: blocks[i].key,
        html: blocks[i].html,
        height: el.offsetHeight,
      }));

      // Available content height inside one A4 sheet:
      //   sheet − narrow margins − header band − footer band − page-number reserve
      const headerEl = document.getElementById('ls-header-measure');
      const footerEl = document.getElementById('ls-footer-measure');
      const headerH = headerEl ? headerEl.offsetHeight : Math.round(34 * PX_PER_MM);
      const footerH = footerEl ? footerEl.offsetHeight : Math.round(22 * PX_PER_MM);
      const MARGIN = Math.round(8 * PX_PER_MM);
      const PAGE_H = Math.round(297 * PX_PER_MM);
      const gap = Math.round(2 * PX_PER_MM);
      const pageNumberReserve = Math.round(10 * PX_PER_MM);
      const available = PAGE_H - MARGIN * 2 - (headerH + gap) - (footerH + gap) - pageNumberReserve;

      const pages: { key: string; html: string; height: number }[][] = [];
      let cur: { key: string; html: string; height: number }[] = [];
      let used = 0;
      for (const m of measured) {
        const h = Math.min(m.height, Math.max(available, 100));
        if (used + h > available && cur.length) {
          pages.push(cur);
          cur = [];
          used = 0;
        }
        cur.push({ ...m, height: h });
        used += h;
      }
      if (cur.length) pages.push(cur);
      if (pages.length === 0) pages.push([]);
      setFlowPages(pages);
    });

    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, searchQuery, flowTick, user]);

  // Re-pack once the header/footer images finish loading (their height depends on aspect ratio)
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const imgs = [
        ...(document.getElementById('ls-header-measure')?.querySelectorAll('img') ?? []),
        ...(document.getElementById('ls-footer-measure')?.querySelectorAll('img') ?? []),
      ] as HTMLImageElement[];
      if (!imgs.length) return;
      Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete && img.naturalWidth > 0) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
        )
      ).then(() => {
        if (!cancelled) setFlowTick((x) => x + 1);
      });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  const totalPages = Math.max(flowPages.length, 1);


  // Keep current page in range when content shrinks
  useEffect(() => {
    if (currentPage > totalPages - 1) setCurrentPage(Math.max(0, totalPages - 1));
  }, [totalPages, currentPage]);

  // Persist stickers
  useEffect(() => {
    writeLocalSessionItem(STICKERS_KEY, stickers);
  }, [stickers]);

  // Fit the A4 sheet to the viewport (site shows exactly ONE A4 page at a time)
  useEffect(() => {
    const el = sheetWrapRef.current;
    if (!el) return;
    const update = () => {
      const availW = el.clientWidth;                       // px
      const availH = window.innerHeight - 230;             // px: header + controls/footer space
      const s = Math.min(availW / (210 * PX_PER_MM), Math.max(150, availH) / (297 * PX_PER_MM), 1);
      setSheetScale(s > 0 ? s : 1);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Keyboard page flipping (← / →)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (showForm || showImportModal || showStickerModal) return;
      if (e.key === 'ArrowRight') flipTo(currentPage + 1);
      if (e.key === 'ArrowLeft') flipTo(currentPage - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function flipTo(target: number) {
    const t = Math.max(0, Math.min(totalPages - 1, target));
    if (t === currentPage) return;
    setFlipDir(t > currentPage ? 'next' : 'prev');
    setCurrentPage(t);
  }

  // --- Stickers ---
  const addStickerAt = (xPct: number, yPct: number) => {
    const raw = stickerUrl.trim();
    if (!raw) return;
    const url = resolveImageUrl(raw); // Google Drive share links → embeddable image URLs
    const s: Sticker = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      page: currentPage,
      xPct: Math.max(2, Math.min(xPct, 98 - stickerSize)),
      yPct: Math.max(2, Math.min(yPct, 95)),
      sizePct: stickerSize,
      rotate: stickerRotate,
    };
    setStickers((prev) => [...prev, s]);
    setPlacingMode(false);
    setShowStickerModal(false);
    setStickerUrl('');
    setImportStatus({ type: 'success', message: 'Sticker added! It will appear in the PDF too.' });
  };

  const removeSticker = (id: string) => setStickers((prev) => prev.filter((s) => s.id !== id));
  const moveSticker = (id: string, dxPct: number, dyPct: number) =>
    setStickers((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, xPct: Math.max(0, Math.min(100 - s.sizePct, s.xPct + dxPct)), yPct: Math.max(0, Math.min(97, s.yPct + dyPct)) }
          : s
      )
    );

  const handleSaveAsPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    setShowMenu(false);
    setPdfProgress(null);
    try {
      // Warm the image cache so the exporter never stalls on the network.
      await Promise.allSettled(stickers.map((s) => loadDataUrlCached(s.url)));

      const n = await exportDiaryToA4Pdf({
        blocksSelector: '#pdf-blocks',
        bands: [
          { nodeId: 'ls-header-print', position: 'top' },
          { nodeId: 'ls-footer-print', position: 'bottom' },
        ],
        fileName: `our-love-story-${new Date().toISOString().split('T')[0]}.pdf`,
        onPageProgress: (done, total) => setPdfProgress({ done, total }),
      });
      setImportStatus({ type: 'success', message: `Saved PDF with ${n} A4 page${n === 1 ? '' : 's'}! 💕` });
    } catch (err: any) {
      console.error(err);
      setImportStatus({ type: 'error', message: err?.message || 'Failed to export PDF.' });
    } finally {
      setExportingPdf(false);
      setPdfProgress(null);
    }
  };

  const stickersForCurrentPage = stickers.filter((s) => s.page === currentPage);

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">📖</div>
          <p className="text-amber-700">Loading your diary...</p>
        </div>
      </div>
    );
  }

  // Show auth if not logged in (hardcoded DeepNectar login gate)
  if (!user) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50">
      {/* Import Status Toast */}
      {importStatus && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-white font-medium flex items-center gap-2 animate-fade-in ${
          importStatus.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        }`}>
          <span>{importStatus.type === 'success' ? '✅' : '❌'}</span>
          <span>{importStatus.message}</span>
          <button onClick={() => setImportStatus(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-amber-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📖</span>
            <div>
              <h1 className="text-2xl font-bold text-amber-900 font-serif">My Diary</h1>
              <p className="text-sm text-amber-700">Cloud-synced journal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Menu Button */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="bg-white border border-amber-300 hover:bg-amber-50 text-amber-700 p-2.5 rounded-full transition-all shadow-sm hover:shadow-md"
                title="More options"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {showMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-amber-100 overflow-hidden animate-fade-in z-20">
                  <button
                    onClick={handleImportClick}
                    className="w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors"
                  >
                    <span className="text-lg">📥</span>
                    <div>
                      <p className="font-medium text-gray-800">Import Entries</p>
                      <p className="text-xs text-gray-500">From JSON or text file</p>
                    </div>
                  </button>
                  <div className="border-t border-amber-100"></div>
                  <button
                    onClick={handleExportJSON}
                    disabled={entries.length === 0}
                    className="w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-lg">📤</span>
                    <div>
                      <p className="font-medium text-gray-800">Export as JSON</p>
                      <p className="text-xs text-gray-500">Full backup with all data</p>
                    </div>
                  </button>
                  <button
                    onClick={handleExportText}
                    disabled={entries.length === 0}
                    className="w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-lg">📄</span>
                    <div>
                      <p className="font-medium text-gray-800">Export as Text</p>
                      <p className="text-xs text-gray-500">Readable diary format</p>
                    </div>
                  </button>
                  <button
                    onClick={handleSaveAsPdf}
                    disabled={entries.length === 0 || exportingPdf}
                    className="w-full px-4 py-3 text-left hover:bg-red-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-lg">🖨️</span>
                    <div>
                      <p className="font-medium text-gray-800">{exportingPdf ? 'Generating PDF…' : 'Save as PDF (A4)'}</p>
                      <p className="text-xs text-gray-500">All pages, page numbers, narrow margins</p>
                    </div>
                  </button>
                  <div className="border-t border-amber-100"></div>
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-3 text-left hover:bg-red-50 flex items-center gap-3 transition-colors text-red-600"
                  >
                    <span className="text-lg">🚪</span>
                    <div>
                      <p className="font-medium">Log Out</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* New Entry Button */}
            <button
              onClick={() => { setShowForm(!showForm); setEditingId(null); setMessage(''); setReflection(''); }}
              className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <span className="text-lg">{showForm ? '✕' : '+'}</span>
              <span className="hidden sm:inline">{showForm ? 'Close' : 'New Entry'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                📥 Import Diary Entries
              </h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-white/80 hover:text-white text-xl transition"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-gray-600 text-sm">
                Import your diary entries from a previously exported file. Supported formats:
              </p>

              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <span className="text-xl">📋</span>
                  <div className="flex-1">
                    <p className="font-medium text-amber-900">JSON Format</p>
                    <p className="text-sm text-amber-700">Full backup files with all entry data including heading, IDs and timestamps.</p>
                    <a
                      href="/templates/diary-template.json"
                      download="diary-template.json"
                      className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-amber-600 hover:text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      ⬇️ Download JSON Template
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                  <span className="text-xl">📝</span>
                  <div className="flex-1">
                    <p className="font-medium text-orange-900">Text / Markdown Format (.txt / .md)</p>
                    <p className="text-sm text-orange-700 mb-1">Group entries under headings, one bullet per message:</p>
                    <code className="text-xs bg-orange-100 px-2 py-1 rounded block text-orange-800 whitespace-pre">
{`#### HEADING 1: [Topic Name]

- Message: [Date & Time] - [Sender]: "[Message]"
  What I felt: [Reflection]`}
                    </code>
                    <div className="mt-2 text-xs text-orange-800 bg-white/60 rounded-lg border border-orange-100 p-2 max-h-40 overflow-y-auto">
                      <p className="font-semibold mb-1">Allowed headings:</p>
                      <ul className="space-y-0.5">
                        {HEADING_CATEGORIES.map((c) => (
                          <li key={c.title}>
                            {buildHeadingText(c.emoji, c.title)}
                            <span className="text-orange-500"> — {c.whenToUse}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <a
                        href="/templates/diary-template.txt"
                        download="diary-template.txt"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-800 bg-orange-100 hover:bg-orange-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        ⬇️ Download Text Template
                      </a>
                      <a
                        href="/templates/diary-template.md"
                        download="diary-template.md"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-800 bg-orange-100 hover:bg-orange-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        ⬇️ Download Markdown Template
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                <p className="text-sm text-yellow-800">
                  ⚠️ <strong>Note:</strong> Imported entries will be added to your existing entries (not replace them).
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <label className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg text-center cursor-pointer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.txt,.md"
                    onChange={handleFileImport}
                    className="hidden"
                  />
                  📂 Choose File to Import
                </label>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="px-6 py-3 border border-amber-300 text-amber-700 rounded-xl font-medium hover:bg-amber-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticker Modal — paste an image link, then click anywhere on the A4 page to place it */}
      {showStickerModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="bg-gradient-to-r from-pink-500 to-rose-500 px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                🌸 Add Image Sticker (Page {currentPage + 1})
              </h2>
              <button
                onClick={() => { setShowStickerModal(false); setPlacingMode(false); }}
                className="text-white/80 hover:text-white text-xl transition"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-gray-600 text-sm">
                Paste a direct image link (ends with .jpg / .png / .gif / .webp…). The sticker is added
                to the current A4 page and appears in the exported PDF too.
              </p>
              <input
                type="url"
                value={stickerUrl}
                onChange={(e) => setStickerUrl(e.target.value)}
                placeholder="https://example.com/my-photo.jpg"
                className="w-full px-4 py-3 border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-400 focus:border-transparent outline-none"
              />
              {stickerUrl && (
                <div className="flex items-center gap-3 bg-pink-50 border border-pink-100 rounded-xl p-3">
                  <img src={stickerUrl} alt="preview" crossOrigin="anonymous" className="w-16 h-16 object-cover rounded-lg border border-pink-200"
                       onError={(e) => { (e.currentTarget.style.display = 'none'); }} />
                  <p className="text-xs text-pink-700">Preview — if it doesn't load here it won't load in the PDF either.</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Size: {stickerSize}% of page width</label>
                  <input type="range" min={10} max={60} value={stickerSize} onChange={(e) => setStickerSize(Number(e.target.value))} className="w-full accent-pink-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tilt: {stickerRotate}°</label>
                  <input type="range" min={-20} max={20} value={stickerRotate} onChange={(e) => setStickerRotate(Number(e.target.value))} className="w-full accent-pink-500" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    if (!stickerUrl.trim()) return;
                    setShowStickerModal(false);
                    setPlacingMode(true);
                  }}
                  disabled={!stickerUrl.trim()}
                  className="flex-1 bg-pink-500 hover:bg-pink-600 disabled:opacity-40 text-white py-3 rounded-xl font-medium transition-all shadow-md"
                >
                  🎯 Choose spot on page…
                </button>
                <button
                  onClick={() => addStickerAt(35, 12)}
                  disabled={!stickerUrl.trim()}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white py-3 rounded-xl font-medium transition-all shadow-md"
                >
                  ➕ Place in center
                </button>
                <button
                  onClick={() => { setShowStickerModal(false); setPlacingMode(false); }}
                  className="px-5 py-3 border border-pink-300 text-pink-700 rounded-xl font-medium hover:bg-pink-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Writing Form */}
        {showForm && (
          <div className="mb-8 bg-white rounded-2xl shadow-xl border border-amber-100 overflow-hidden animate-fade-in">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
              <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                ✍️ {editingId ? 'Edit Entry' : 'Write a New Entry'}
              </h2>
              <p className="text-amber-100 text-sm mt-1">
                {getCurrentDateTime()}
              </p>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Heading Category */}
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1.5">
                  Heading (Topic)
                </label>
                <select
                  value={heading}
                  onChange={(e) => setHeading(e.target.value)}
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50"
                >
                  {HEADING_CATEGORIES.map((c) => (
                    <option key={c.title} value={buildHeadingText(c.emoji, c.title)}>
                      {buildHeadingText(c.emoji, c.title)} — {c.whenToUse}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sender Name — Deep or Chota Don, per diary format */}
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1.5">
                  Who is this message from?
                </label>
                <select
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50"
                >
                  <option value="Deep">Deep (me)</option>
                  <option value="🫰🫶🏻Chota Don❣️❤️😘">🫰🫶🏻Chota Don❣️❤️😘 (her)</option>
                </select>
              </div>

              {/* Message Content */}
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1.5">
                  Message / What happened
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write about what happened, what was said, or what you experienced..."
                  rows={4}
                  className="w-full px-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition resize-none bg-amber-50/50"
                  required
                />
              </div>

              {/* Reflection */}
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1.5">
                  What I Felt (Reflection)
                </label>
                <textarea
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                  placeholder="How did this make you feel? What are your thoughts about it?"
                  rows={3}
                  className="w-full px-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition resize-none bg-amber-50/50"
                  required
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg"
                >
                  {editingId ? '💾 Update Entry' : '📝 Save Entry'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-6 py-3 border border-amber-300 text-amber-700 rounded-xl font-medium hover:bg-amber-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Search Bar */}
        {entries.length > 0 && (
          <div className="mb-6">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-400">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your diary entries..."
                className="w-full pl-12 pr-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-white/80 backdrop-blur-sm"
              />
            </div>
          </div>
        )}

        {/* Entry Count */}
        {entries.length > 0 && (
          <p className="text-amber-700 text-sm mb-4">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        )}

        {/* Empty state */}
        {entries.length === 0 && !showForm && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📔</div>
            <h3 className="text-xl font-semibold text-amber-800 mb-2">Your diary is empty</h3>
            <p className="text-amber-600 mb-6">Start writing your first entry or import existing ones.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => setShowForm(true)}
                className="bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 rounded-full font-medium transition-all shadow-md hover:shadow-lg"
              >
                ✍️ Write Your First Entry
              </button>
              <button
                onClick={handleImportClick}
                className="border-2 border-amber-400 text-amber-700 hover:bg-amber-50 px-8 py-3 rounded-full font-medium transition-all"
              >
                📥 Import Entries
              </button>
            </div>
          </div>
        )}

        {/* ===== A4 BOOK VIEW — one A4 page at a time, flip to navigate ===== */}
        {entries.length > 0 && (
          <>
            {/* Toolbar above the sheet */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              <button
                onClick={handleSaveAsPdf}
                disabled={exportingPdf}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                title="Save the whole diary as an A4-sized PDF"
              >
                {exportingPdf ? (
                  <span className="animate-pulse">⏳ Generating PDF ({totalPages} pages)...</span>
                ) : (
                  <>🖨️ Save as PDF (A4)</>
                )}
              </button>
              <button
                onClick={() => { setShowStickerModal(true); setPlacingMode(false); }}
                className="bg-pink-500 hover:bg-pink-600 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                title="Add an image sticker from a link anywhere on the page"
              >
                🌸 Add Image Sticker
              </button>
              {stickers.length > 0 && (
                <button
                  onClick={() => { if (window.confirm('Remove all stickers from every page?')) setStickers([]); }}
                  className="border border-red-300 text-red-600 hover:bg-red-50 px-4 py-2.5 rounded-full text-sm font-medium transition"
                >
                  🧹 Clear stickers ({stickers.length})
                </button>
              )}
            </div>

            {/* The single visible A4 sheet */}
            <div ref={sheetWrapRef} className="w-full flex justify-center">
              <div
                className="a4-sheet"
                style={{ height: `${297 * sheetScale}mm` }}
                onClick={(e) => {
                  if (!placingMode) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const xPct = ((e.clientX - rect.left) / rect.width) * 100;
                  const yPct = ((e.clientY - rect.top) / rect.height) * 100;
                  addStickerAt(xPct, yPct);
                }}
              >
                <div
                  key={currentPage}
                  className={`a4-page page-flip-enter ${placingMode ? 'cursor-crosshair ring-4 ring-pink-400' : ''}`}
                  style={{
                    transform: `scale(${sheetScale})`,
                    ['--flip-from' as any]: flipDir === 'next' ? '45%' : '-45%',
                  }}
                >
                  {/* Header band on EVERY page — photo in the left corner + titles */}
                  <LoveStoryHeader />

                  <div className="a4-print-area">
                    {(flowPages[currentPage] ?? []).map((b) => (
                      <div key={b.key} dangerouslySetInnerHTML={{ __html: b.html }} />
                    ))}
                  </div>

                  {/* Footer band on EVERY page — both signatures */}
                  <LoveStoryFooter />

                  {/* Stickers pinned to this page */}
                  {stickersForCurrentPage.map((s) => (
                    <div
                      key={s.id}
                      className="diary-sticker"
                      style={{ left: `${s.xPct}%`, top: `${s.yPct}%`, width: `${s.sizePct}%`, transform: `rotate(${s.rotate}deg)` }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <img src={s.url} alt="sticker" crossOrigin="anonymous" draggable={false} />
                      <button className="sticker-remove" title="Remove sticker" onClick={(e) => { e.stopPropagation(); removeSticker(s.id); }}>✕</button>
                      {/* Nudge controls (appear on hover via CSS) */}
                      <div className="sticker-nudges">
                        <button title="Move left" onClick={(e) => { e.stopPropagation(); moveSticker(s.id, -3, 0); }}>◀</button>
                        <button title="Move up" onClick={(e) => { e.stopPropagation(); moveSticker(s.id, 0, -3); }}>▲</button>
                        <button title="Move down" onClick={(e) => { e.stopPropagation(); moveSticker(s.id, 0, 3); }}>▼</button>
                        <button title="Move right" onClick={(e) => { e.stopPropagation(); moveSticker(s.id, 3, 0); }}>▶</button>
                        <button title="Bigger" onClick={(e) => { e.stopPropagation(); setStickers((prev) => prev.map((x) => x.id === s.id ? { ...x, sizePct: Math.min(60, x.sizePct + 4) } : x)); }}>＋</button>
                        <button title="Smaller" onClick={(e) => { e.stopPropagation(); setStickers((prev) => prev.map((x) => x.id === s.id ? { ...x, sizePct: Math.max(8, x.sizePct - 4) } : x)); }}>－</button>
                      </div>
                    </div>
                  ))}

                  {/* Page number — bottom-right corner */}
                  <div className="a4-page-number">Page {currentPage + 1} of {totalPages}</div>
                </div>
              </div>
            </div>

            {placingMode && (
              <p className="text-center text-pink-600 font-medium mt-3 animate-pulse">
                🎯 Click anywhere on the A4 page to place your sticker!
              </p>
            )}

            {/* Page flip controls */}
            <div className="flex items-center justify-center gap-4 mt-5 mb-2">
              <button
                onClick={() => flipTo(currentPage - 1)}
                disabled={currentPage === 0}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-md flex items-center gap-2"
              >
                ⬅️ Prev
              </button>
              <div className="text-amber-800 font-serif font-semibold">
                Page {currentPage + 1} / {totalPages}
              </div>
              <button
                onClick={() => flipTo(currentPage + 1)}
                disabled={currentPage >= totalPages - 1}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-md flex items-center gap-2"
              >
                Next ➡️
              </button>
            </div>
            <p className="text-center text-xs text-amber-600 mb-4">
              Tip: use ← / → arrow keys to flip pages · A4 size · narrow margins
            </p>
          </>
        )}

        {/* No search results */}
        {entries.length > 0 && filteredEntries.length === 0 && searchQuery && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-amber-700">No entries found matching "{searchQuery}"</p>
          </div>
        )}
      </main>

      {/* ============================================================
          OFF-SCREEN PRINT DOM — the ONLY source for the PDF export.
          Same blocks the site paginates, laid out at true A4 content
          width with the header & signature bands. Hidden visually,
          present in the DOM so the exporter can measure & rasterize.
         ============================================================ */}
      {entries.length > 0 && (
        <div style={{ position: 'absolute', left: -99999, top: 0, width: `${CONTENT_W_CSS}px` }} aria-hidden="true">
          {/* measurement copies of the bands (their height feeds the paginator) */}
          <div id="ls-header-measure" style={{ width: `${CONTENT_W_CSS}px` }}>
            <LoveStoryHeader />
          </div>
          <div id="ls-footer-measure" style={{ width: `${CONTENT_W_CSS}px` }}>
            <LoveStoryFooter />
          </div>

          {/* exact bands stamped by the PDF exporter onto every A4 sheet */}
          <div id="ls-header-print" style={{ width: `${CONTENT_W_CSS}px`, background: '#ffffff' }}>
            <LoveStoryHeader />
          </div>
          <div id="ls-footer-print" style={{ width: `${CONTENT_W_CSS}px`, background: '#ffffff' }}>
            <LoveStoryFooter />
          </div>

          {/* flattened content blocks — packed into A4 sheets by the exporter,
              then each page's stickers appended right after its blocks */}
          <div id="pdf-blocks" style={{ width: `${CONTENT_W_CSS}px`, fontSize: '10pt', lineHeight: 1.45, color: '#3f2a12' }}>
            {flowPages.map((pageBlocks, pi) => (
              <div key={`pp-${pi}`} data-page={pi}>
                {pageBlocks.map((b) => (
                  <div key={`p-${b.key}`} dangerouslySetInnerHTML={{ __html: b.html }} />
                ))}
                {stickers.filter((s) => s.page === pi).map((s) => (
                  <div
                    key={`p-sticker-${s.id}`}
                    style={{ width: `${(s.sizePct / 100) * CONTENT_W_CSS}px`, margin: '4px auto', transform: `rotate(${s.rotate}deg)` }}
                  >
                    <img src={s.url} alt="sticker" draggable={false} style={{ width: '100%', display: 'block', border: '3px solid #fff', borderRadius: '8px' }} />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* live measurement host for the paginator */}
          <div ref={flowHostRef} style={{ width: `${CONTENT_W_CSS}px`, fontSize: '10pt', lineHeight: 1.45, color: '#3f2a12' }} />
        </div>
      )}

      {/* Footer */}
      <footer className="text-center py-6 text-amber-600 text-sm">
        <p>Your diary entries are synced to the cloud ☁️ 🔒 · A4 pages · narrow margins</p>
      </footer>
    </div>
  );
}

export default App;
