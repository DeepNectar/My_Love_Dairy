import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase";
import Auth from "./components/Auth";
import {
  HEADING_CATEGORIES,
  defaultHeading,
  buildHeadingText,
  parseTemplateEntries,
  compareChronologically,
  dateRangeOf
} from "./lib/headings";
import { FIXED_USER_ID, ensureSupabaseSession } from "./lib/hardcodedAuth";
import { readLocalSession, clearLocalSession, writeLocalSessionItem, readLocalSessionItem } from "./lib/localSession";
import { exportDiaryToA4Pdf, renderSheetNode, CONTENT_W_CSS, CSS_PX_PER_MM, computeAvailableFlowHeightCss, resolveStickerPlacements } from "./lib/pdfExport";
import { resolveImageUrl, loadDataUrlCached, RobustImg } from "./lib/images";
import { LoveStoryHeader, LoveStoryFooter } from "./lib/loveStory";
const PX_PER_MM = CSS_PX_PER_MM;
function printClone(node) {
  const c = node.cloneNode(true);
  c.querySelectorAll("button").forEach((b) => b.remove());
  return c;
}
const STICKERS_KEY = "diary_stickers_v1";
// HARD-CODED sticker policy: stickers are disabled in the UI. The only way to
// add one is by editing HARDCODED_STICKERS below (links will be provided later).
// Set entries here and they will render on every page & appear in the PDF.
const HARDCODED_STICKER_LINKS = [];
const HARDCODED_STICKERS = HARDCODED_STICKER_LINKS.map((link, i) => ({
  id: `hardcoded-${i}`,
  url: resolveImageUrl(link),
  // page -2 = scatter across ALL pages at deterministic seeded positions
  page: -2,
  sizePct: 12,
  rotate: -4 + i * 7 % 9
}));
const SHEET_ASPECT_MM = 297 / 210;
const STICKER_MAX_Y_PCT = 86;
function App() {
  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([]);
  const [heading, setHeading] = useState(defaultHeading());
  const [senderName, setSenderName] = useState("");
  const [message, setMessage] = useState("");
  const [reflection, setReflection] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [sheetScale, setSheetScale] = useState(1);
  const sheetWrapRef = useRef(null);
  // Stickers are hard-coded only — any stickers previously saved from the (now
  // removed) UI are ignored on load.
  const [stickers, setStickers] = useState(HARDCODED_STICKERS);
  const [showStickerModal, setShowStickerModal] = useState(false);
  const [stickerUrl, setStickerUrl] = useState("");
  const [stickerSize, setStickerSize] = useState(25);
  const [stickerRotate, setStickerRotate] = useState(-3);
  const [placingMode, setPlacingMode] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(null);
  const [flipDir, setFlipDir] = useState("next");
  const pageNodeRef = useRef(null);
  useEffect(() => {
    let mounted = true;
    const initAuth = async () => {
      try {
        const session = await readLocalSession();
        if (!mounted) return;
        if (session) {
          const uid = await ensureSupabaseSession();
          if (!mounted) return;
          setUser({ id: uid, email: FIXED_USER_ID, name: FIXED_USER_ID });
          setSenderName("Deep");
          fetchEntries(uid);
        }
      } catch (err) {
        console.error("Auth check failed:", err);
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
    const uid = await ensureSupabaseSession();
    setUser({ id: uid, email: FIXED_USER_ID, name: FIXED_USER_ID });
    setSenderName("Deep");
    fetchEntries(uid);
  };
  const fetchEntries = async (_uid) => {
    try {
      const { data, error } = await supabase.from("diary_entries").select("*").order("created_at", { ascending: false });
      if (error) {
        console.error("Error fetching entries:", error);
        setImportStatus({ type: "error", message: "Failed to load entries" });
      } else {
        setEntries(data.map(mapSupabaseEntry));
      }
    } catch (err) {
      console.error("Error fetching entries:", err);
      setImportStatus({ type: "error", message: "Failed to load entries" });
    }
  };
  const mapSupabaseEntry = (entry) => ({
    id: entry.id,
    heading: entry.heading || defaultHeading(),
    dateTime: entry.date_time,
    senderName: entry.sender_name,
    message: entry.message,
    reflection: entry.reflection
  });
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  useEffect(() => {
    if (importStatus) {
      const timer = setTimeout(() => setImportStatus(null), 4e3);
      return () => clearTimeout(timer);
    }
  }, [importStatus]);
  const getCurrentDateTime = () => {
    const now = /* @__PURE__ */ new Date();
    return now.toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  const handleLogout = async () => {
    clearLocalSession();
    try {
      await supabase.auth.signOut();
    } catch {
    }
    setUser(null);
    setEntries([]);
    await import("./lib/hardcodedAuth").then((m) => m.resetCachedUserId());
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim() || !reflection.trim() || !user) return;
    const entryData = {
      user_id: user.id,
      heading: heading || defaultHeading(),
      date_time: getCurrentDateTime(),
      sender_name: (senderName === FIXED_USER_ID ? "Deep" : senderName) || "Deep",
      message: message.trim(),
      reflection: reflection.trim()
    };
    if (editingId) {
      const { error } = await supabase.from("diary_entries").update(entryData).eq("id", editingId);
      if (error) {
        setImportStatus({ type: "error", message: `Failed to update entry: ${error.message}` });
      } else {
        setImportStatus({ type: "success", message: "Entry updated successfully!" });
        fetchEntries();
      }
    } else {
      const { error } = await supabase.from("diary_entries").insert([entryData]);
      if (error) {
        setImportStatus({ type: "error", message: `Failed to save entry: ${error.message}` });
      } else {
        setImportStatus({ type: "success", message: "Entry saved successfully!" });
        fetchEntries();
      }
    }
    setMessage("");
    setReflection("");
    setShowForm(false);
    setEditingId(null);
  };
  const handleEdit = (entry) => {
    setHeading(entry.heading || defaultHeading());
    setSenderName(entry.senderName);
    setMessage(entry.message);
    setReflection(entry.reflection);
    setEditingId(entry.id);
    setShowForm(true);
  };
  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to delete this entry?")) {
      const { error } = await supabase.from("diary_entries").delete().eq("id", id);
      if (error) {
        setImportStatus({ type: "error", message: "Failed to delete entry" });
      } else {
        setImportStatus({ type: "success", message: "Entry deleted successfully!" });
        fetchEntries();
      }
    }
  };
  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setHeading(defaultHeading());
    setMessage("");
    setReflection("");
  };
  const buildCompleteDiary = (list) => {
    const chrono = [...list].sort(compareChronologically);
    const canonical = new Set(HEADING_CATEGORIES.map((c) => buildHeadingText(c.emoji, c.title)));
    const withHeading = chrono.map((e) => ({
      ...e,
      assignedHeading: canonical.has(e.heading || "") ? e.heading : autoClassifyHeading(e)
    }));
    const groups = [];
    const indexByHeading = /* @__PURE__ */ new Map();
    for (const e of withHeading) {
      let idx = indexByHeading.get(e.assignedHeading);
      if (idx === void 0) {
        idx = groups.length;
        indexByHeading.set(e.assignedHeading, idx);
        groups.push({ heading: e.assignedHeading, number: idx + 1, items: [] });
      }
      groups[idx].items.push(e);
    }
    return groups;
  };
  const autoClassifyHeading = (e) => {
    const t = `${e.message} ${e.reflection}`.toLowerCase();
    const has = (...words) => words.some((w) => t.includes(w));
    const isHer = /chota don/i.test(e.senderName);
    if (has("kesha")) return "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} About Kesha (Her Sister)";
    if (has("arya")) return "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} About Arya (Her Brother)";
    if (has("good morning", "gm ", "morning \u2600", "sunrise", "good night", "goodnight", "gn ", "night \u{1F319}", "sleep tight", "fell asleep"))
      return "\u{1F305} Morning & Night Greetings";
    if (has("no reply", "hasn", "didn't reply", "not replied", "waiting for reply", "still waiting", "left on read", "seen but no reply"))
      return "\u{1F4AD} My Messages To Her (No Reply Yet)";
    if (has("marry", "future", "plan", "dream", "goal", "someday", "life together", "kids", "house"))
      return "\u{1F3AF} Dreams & Future Plans";
    if (has("intimate", "private - intimate", "passionate", "spicy", "kiss", "hold you", "miss your touch", "desire", "attraction", "beautiful body", "crave"))
      return "\u{1F319} Intimate & Passionate Talks";
    if (has("love you", "i love", "love of my life", "forever yours", "confess", "yours only", "heart belongs"))
      return "\u{1F495} Romantic Confessions";
    if (has("flirt", "tease", "joke", "lol", "lmao", "haha", "funny", "\u{1F602}", "\u{1F923}", "silly", "bakchodi"))
      return "\u{1F604} Fun Moments & Jokes";
    if (has("sad", "cry", "crying", "upset", "angry", "fight", "argument", "worried", "anxious", "stress", "tired", "support", "care about", "take care", "eat something", "health"))
      return "\u{1F917} Emotional Support & Care";
    if (has("compliment", "pretty", "cute", "gorgeous", "smart", "best girl", "proud of you", "adorable", "sweet"))
      return "\u{1F496} Sweet Compliments & Love";
    if (isHer && !e.reflection) return "\u{1F48C} Her Messages To Me";
    return "\u{1F4AC} Daily Life & Important Updates";
  };
  const buildSummaryLines = (list) => {
    const total = list.length;
    const hers = list.filter((e) => /chota don/i.test(e.senderName)).length;
    const mine = total - hers;
    const sorted = [...list].sort(compareChronologically);
    const firstDate = sorted[0]?.dateTime || "the beginning";
    const lastDate = sorted[sorted.length - 1]?.dateTime || "today";
    const range = dateRangeOf(list.map((e) => e.dateTime)) || "dates not specified";
    return [
      `This diary holds ${total} precious moments between me (Deep) and \u{1FAF0}\u{1FAF6}\u{1F3FB}Chota Don\u2763\uFE0F\u2764\uFE0F\u{1F618}, spanning ${range}.`,
      `From ${firstDate} to ${lastDate}, every entry shows how our bond grows stronger day by day.`,
      `Our sweet morning and night greetings are the threads that tie each day together.`,
      `${mine} of my messages and ${hers} of her messages make up the daily rhythm of our connection.`,
      `The compliments, flirty banter, and romantic confessions keep the spark alive between us.`,
      `Even in the quiet moments when she hasn't replied, I choose patience because waiting for her feels worth it.`,
      `Her care \u2014 asking if I ate, wishing me good sleep \u2014 makes me feel truly loved and protected.`,
      `My dreams of a future with her give every single day a deeper meaning.`,
      `She makes me feel seen, cherished, and complete; this diary is proof of our beautiful journey.`,
      `I am grateful for every word we have shared, and for every one still to come.`
    ];
  };
  const handleExportJSON = () => {
    const data = JSON.stringify(entries, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diary-entries-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowMenu(false);
    setImportStatus({ type: "success", message: `Exported ${entries.length} entries successfully!` });
  };
  const handleExportText = () => {
    const groups = buildCompleteDiary(entries);
    const range = dateRangeOf(entries.map((e) => e.dateTime)) || "Dates not specified";
    const headingSections = groups.map((group) => {
      const lines = group.items.map(
        (entry) => `- Message: ${entry.dateTime} - ${entry.senderName}: "${entry.message}"
  What I felt: ${entry.reflection}`
      );
      return `#### HEADING ${group.number}: ${group.heading}

${lines.join("\n\n")}

---
`;
    }).join("\n");
    const total = entries.length;
    const hers = entries.filter((e) => /chota don/i.test(e.senderName)).length;
    const mine = total - hers;
    const sortedDates = [...entries].sort(compareChronologically);
    const firstDate = sortedDates[0]?.dateTime || "the beginning";
    const lastDate = sortedDates[sortedDates.length - 1]?.dateTime || "today";
    const summaryLines = [
      `This diary holds ${total} precious moments between me (Deep) and \u{1FAF0}\u{1FAF6}\u{1F3FB}Chota Don\u2763\uFE0F\u2764\uFE0F\u{1F618}, spanning ${range}.`,
      `From ${firstDate} to ${lastDate}, every entry shows how our bond grows stronger day by day.`,
      `Our sweet morning and night greetings are the threads that tie each day together.`,
      `${mine} of my messages and ${hers} of her messages make up the daily rhythm of our connection.`,
      `The compliments, flirty banter, and romantic confessions keep the spark alive between us.`,
      `Even in the quiet moments when she hasn't replied, I choose patience because waiting for her feels worth it.`,
      `Her care \u2014 asking if I ate, wishing me good sleep \u2014 makes me feel truly loved and protected.`,
      `My dreams of a future with her give every single day a deeper meaning.`,
      `She makes me feel seen, cherished, and complete; this diary is proof of our beautiful journey.`,
      `I am grateful for every word we have shared, and for every one still to come.`
    ];
    const summary = [
      `### \u{1F4CC} FINAL SUMMARY - COMPLETE DIARY`,
      ``,
      ...summaryLines,
      ``,
      `========================================`
    ].join("\n");
    const text = [
      `========================================`,
      `\u{1F4D6} COMPLETE DIARY - DEEP & \u{1FAF0}\u{1FAF6}\u{1F3FB}CHOTA DON\u2763\uFE0F\u2764\uFE0F\u{1F618}`,
      `========================================`,
      ``,
      `### Date: ${range}`,
      ``,
      `---`,
      ``,
      headingSections,
      summary
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diary-entries-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowMenu(false);
    setImportStatus({ type: "success", message: `Exported ${entries.length} entries as text!` });
  };
  const parseTextEntries = (text) => {
    const templated = parseTemplateEntries(text);
    if (templated.length > 0) {
      return templated.map((t) => ({
        heading: t.heading,
        dateTime: t.dateTime,
        senderName: t.senderName,
        message: t.message,
        reflection: t.reflection
      }));
    }
    const parsed = [];
    const blocks = text.split(/\n---\n|\n\n(?=Message:)/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const messageRegex = /Message:\s*(.+?)\s*-\s*(.+?):\s*"(.+?)"/s;
      const messageMatch = trimmed.match(messageRegex);
      if (messageMatch) {
        const dateTime = messageMatch[1].trim();
        const senderName2 = messageMatch[2].trim();
        const messageContent = messageMatch[3].trim();
        const reflectionRegex = /What I felt:\s*(.+)/s;
        const reflectionMatch = trimmed.match(reflectionRegex);
        const reflectionContent = reflectionMatch ? reflectionMatch[1].trim() : "";
        if (messageContent) {
          parsed.push({
            heading: defaultHeading(),
            dateTime,
            senderName: senderName2,
            message: messageContent,
            reflection: reflectionContent
          });
        }
      }
    }
    return parsed;
  };
  const handleFileImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result;
        let imported = [];
        if (file.name.endsWith(".json")) {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            imported = data.map((item) => ({
              heading: item.heading || item.date_heading || defaultHeading(),
              dateTime: item.dateTime || item.date_time || "Unknown date",
              senderName: item.senderName || item.sender_name || "Anonymous",
              message: item.message || "",
              reflection: item.reflection || ""
            }));
          } else {
            throw new Error("Invalid JSON format. Expected an array of entries.");
          }
        } else if (file.name.endsWith(".txt") || file.name.endsWith(".md")) {
          imported = parseTextEntries(content);
          if (imported.length === 0) {
            throw new Error("Could not parse any entries from this text file.");
          }
        } else {
          throw new Error("Unsupported file format. Please use .json or .txt files.");
        }
        if (imported.length === 0) {
          throw new Error("No valid entries found in the file.");
        }
        imported.sort(compareChronologically);
        const entriesToInsert = imported.map((entry) => ({
          user_id: user.id,
          heading: entry.heading || defaultHeading(),
          date_time: entry.dateTime,
          sender_name: entry.senderName,
          message: entry.message,
          reflection: entry.reflection
        }));
        const { error } = await supabase.from("diary_entries").insert(entriesToInsert);
        if (error) throw error;
        setShowImportModal(false);
        setImportStatus({ type: "success", message: `Successfully imported ${imported.length} ${imported.length === 1 ? "entry" : "entries"}!` });
        fetchEntries();
      } catch (err) {
        setImportStatus({ type: "error", message: err.message || "Failed to import file." });
      }
    };
    reader.onerror = () => {
      setImportStatus({ type: "error", message: "Failed to read the file." });
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  const handleImportClick = () => {
    setShowMenu(false);
    setShowImportModal(true);
  };
  const filteredEntries = entries.filter(
    (entry) => entry.message.toLowerCase().includes(searchQuery.toLowerCase()) || entry.reflection.toLowerCase().includes(searchQuery.toLowerCase()) || entry.senderName.toLowerCase().includes(searchQuery.toLowerCase()) || (entry.heading || "").toLowerCase().includes(searchQuery.toLowerCase())
  );
  const completeDiaryGroups = buildCompleteDiary(filteredEntries);
  const diaryDateRange = dateRangeOf(entries.map((e) => e.dateTime));
  const flowHostRef = useRef(null);
  const [flowPages, setFlowPages] = useState([]);
  const [flowTick, setFlowTick] = useState(0);
  const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const buildBlocksHtml = () => {
    const out = [];
    out.push({
      key: "cover",
      html: `
        <div class="pg-cover">
          <div class="pg-cover-emoji">\u{1F4D6}\u{1F495}</div>
          <h1 class="pg-cover-title">OUR LOVE STORY \u2014 COMPLETE DIARY</h1>
          <h2 class="pg-cover-sub">Deep &amp; Shinu (\u{1FAF0}\u{1FAF6}\u{1F3FB} Chota Don \u2763\uFE0F\u2764\uFE0F\u{1F618})</h2>
          <div class="pg-cover-rule">============================================================</div>
          <p class="pg-cover-date"><strong>Date:</strong> ${esc(diaryDateRange || "Date not specified \u2014 arranged by context")}</p>
          <p class="pg-cover-note">Oldest \u2192 newest \xB7 grouped under headings \xB7 nothing added, nothing removed</p>
        </div>`
    });
    for (const group of completeDiaryGroups) {
      out.push({
        key: `h-${group.number}-${out.length}`,
        html: `<h2 class="pg-heading"><span class="pg-hnum">${group.number}</span>${esc(group.heading)}<span class="pg-hcount">(${group.items.length})</span></h2>`
      });
      for (const entry of group.items) {
        out.push({
          key: `e-${entry.id}`,
          html: `
            <div class="pg-entry">
              <div class="pg-meta">\u{1F550} ${esc(entry.dateTime)}</div>
              <div class="pg-msg"><strong class="pg-sender-label">Message:</strong> <strong>${esc(entry.dateTime)}</strong> - <strong class="pg-sender">${esc(entry.senderName)}</strong>: <em>"${esc(entry.message)}"</em></div>
              <div class="pg-feel"><strong class="pg-feel-label">\u{1F4AD} What I felt:</strong> ${esc(entry.reflection)}</div>
            </div>`
        });
      }
    }
    if (filteredEntries.length > 0 && !searchQuery) {
      const summaryLines = buildSummaryLines(entries);
      out.push({ key: "summary-title", html: `<h2 class="pg-heading pg-summary-title">\u{1F4CC} FINAL SUMMARY \u2014 COMPLETE DIARY</h2>` });
      out.push({
        key: "summary-list",
        html: `<ul class="pg-summary-list">${summaryLines.map((l) => `<li><span class="pg-bullet">\u2022</span> ${esc(l)}</li>`).join("")}</ul>`
      });
      out.push({ key: "sum-end", html: `<p class="pg-sum-end">========================================</p>` });
    }
    return out;
  };
  useEffect(() => {
    if (!user || entries.length === 0) {
      setFlowPages([]);
      return;
    }
    const host = flowHostRef.current;
    if (!host) return;
    const raf = requestAnimationFrame(async () => {
      const blocks = buildBlocksHtml();
      host.innerHTML = blocks.map((b) => `<div data-k="${b.key}" style="width:${CONTENT_W_CSS}px;box-sizing:border-box;">${b.html}</div>`).join("");
      const imgs = Array.from(host.querySelectorAll("img"));
      await Promise.all(
        imgs.map(
          (img) => new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
        )
      );
      const measured = Array.from(host.children).map((el, i) => ({
        key: blocks[i].key,
        html: blocks[i].html,
        // scrollHeight is the TRUE content height even when a child is
        // constrained, so oversized blocks are detected reliably.
        height: Math.max(el.scrollHeight, el.offsetHeight)
      }));
      const headerEl = document.getElementById("ls-header-measure");
      const footerEl = document.getElementById("ls-footer-measure");
      if (headerEl) await Promise.all(
        Array.from(headerEl.querySelectorAll("img")).map(
          (img) => new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
        )
      );
      if (footerEl) await Promise.all(
        Array.from(footerEl.querySelectorAll("img")).map(
          (img) => new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
        )
      );
      const headerH = headerEl ? Math.max(headerEl.offsetHeight, headerEl.scrollHeight) : Math.round(34 * PX_PER_MM);
      const footerH = footerEl ? Math.max(footerEl.offsetHeight, footerEl.scrollHeight) : Math.round(22 * PX_PER_MM);
      const available = computeAvailableFlowHeightCss(headerH, footerH);
      const pages = [];
      let cur = [];
      let used = 0;
      const pushPage = () => {
        if (cur.length) {
          pages.push(cur);
          cur = [];
          used = 0;
        }
      };
      for (const m of measured) {
        if (m.height > available) {
          pushPage();
          let offset = 0;
          while (offset < m.height) {
            const sliceH = Math.min(available, m.height - offset);
            cur.push({ ...m, height: sliceH, sliceTop: offset });
            used += sliceH;
            if (used >= available) pushPage();
            offset += sliceH;
          }
          continue;
        }
        if (used + m.height > available) pushPage();
        cur.push(m);
        used += m.height;
      }
      pushPage();
      if (pages.length === 0) pages.push([]);
      setFlowPages(pages);
    });
    return () => cancelAnimationFrame(raf);
  }, [entries, searchQuery, flowTick, user]);
  useEffect(() => {
    let cancelled = false;
    let timer;
    const check = () => {
      if (cancelled) return;
      const imgs = [
        ...document.getElementById("ls-header-measure")?.querySelectorAll("img") ?? [],
        ...document.getElementById("ls-footer-measure")?.querySelectorAll("img") ?? []
      ];
      if (!imgs.length) return;
      const allSettled = imgs.every((im) => im.complete);
      if (allSettled) {
        setFlowTick((x) => x + 1);
      } else {
        timer = setTimeout(check, 500);
      }
    };
    timer = setTimeout(check, 600);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  const imgRepacksRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const seen = /* @__PURE__ */ new Set();
    const onImgDone = (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (cancelled || imgRepacksRef.current >= 6 || seen.has(img)) return;
      seen.add(img);
      imgRepacksRef.current += 1;
      setFlowTick((x) => x + 1);
    };
    document.addEventListener("load", onImgDone, true);
    document.addEventListener("error", onImgDone, true);
    return () => {
      cancelled = true;
      document.removeEventListener("load", onImgDone, true);
      document.removeEventListener("error", onImgDone, true);
    };
  }, []);
  const totalPages = Math.max(flowPages.length, 1);
  useEffect(() => {
    if (currentPage > totalPages - 1) setCurrentPage(Math.max(0, totalPages - 1));
  }, [totalPages, currentPage]);
  // Stickers are hard-coded only — nothing is persisted from the UI any more.
  useEffect(() => {
    try {
      localStorage.removeItem(STICKERS_KEY);
    } catch {
    }
  }, []);
  useEffect(() => {
    const el = sheetWrapRef.current;
    if (!el) return;
    const update = () => {
      const availW = el.clientWidth;
      const availH = window.innerHeight - 230;
      const s = Math.min(availW / (210 * PX_PER_MM), Math.max(150, availH) / (297 * PX_PER_MM), 1);
      setSheetScale(s > 0 ? s : 1);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (showForm || showImportModal || showStickerModal) return;
      if (e.key === "ArrowRight") flipTo(currentPage + 1);
      if (e.key === "ArrowLeft") flipTo(currentPage - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  function flipTo(target) {
    const t = Math.max(0, Math.min(totalPages - 1, target));
    if (t === currentPage) return;
    setFlipDir(t > currentPage ? "next" : "prev");
    setCurrentPage(t);
  }
  // Stickers are HARD-CODED only (see HARDCODED_STICKER_LINKS). The link-paste
  // UI has been removed intentionally — do not re-add it.
  const waitDiaryImagesSettled = async (timeoutMs = 3e4) => {
    const start = Date.now();
    const pending = () => Array.from(document.querySelectorAll("#ls-header-measure img, #ls-footer-measure img, .a4-page img, #pdf-blocks img")).filter((im) => !(im.complete && im.naturalWidth > 0));
    while (pending().length && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      await document.fonts?.ready;
    } catch {
    }
  };
  const handleSaveAsPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    setShowMenu(false);
    setPlacingMode(false);
    setPdfProgress(null);
    try {
      // Pre-warm the image cache ONCE (header photo, footer signatures, hard-coded
      // stickers) so no page render ever waits on a network fetch again.
      await Promise.allSettled(stickers.map((s) => loadDataUrlCached(s.url)));
      const node = pageNodeRef.current;
      if (node && flowPages.length > 0) {
        // Fast path: render every A4 page straight from the DOM data — no React
        // re-renders / forced page flips / repeated image-settled polling per page.
        const T = Math.max(flowPages.length, 1);
        const placementsByPage = Array.from({ length: T }, () => []);
        for (const s of stickers) {
          for (const pl of resolveStickerPlacements(stickerToPdf(s, T), T)) {
            if (pl.page >= 0 && pl.page < T) placementsByPage[pl.page].push(pl);
          }
        }
        const pages = [];
        let lastDone = 0;
        for (let p = 0; p < flowPages.length; p++) {
          const canvas = await renderSheetNode(node, {
            prepare: printClone,
            pageIndex: p,
            stickerPlacements: placementsByPage[p] ?? []
          });
          pages.push({ canvas });
          // Throttle progress updates to keep the main thread free for rendering.
          if (p + 1 === flowPages.length || p + 1 - lastDone >= 3) {
            lastDone = p + 1;
            setPdfProgress({ done: lastDone, total: flowPages.length });
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        const n2 = await exportDiaryToA4Pdf({
          blocksSelector: "#pdf-blocks",
          pages,
          fileName: `our-love-story-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.pdf`
        });
        setImportStatus({ type: "success", message: `Saved PDF with ${n2} A4 page${n2 === 1 ? "" : "s"} \u2014 identical to the preview! \u{1F495}` });
        return;
      }
      const n = await exportDiaryToA4Pdf({
        blocksSelector: "#pdf-blocks",
        bands: [
          { nodeId: "ls-header-print", position: "top" },
          { nodeId: "ls-footer-print", position: "bottom" }
        ],
        stickers: stickers.map((s) => stickerToPdf(s, Math.max(flowPages.length, 1))),
        // Rasterize clean clones (no hover/nudge buttons) so the PDF shows
        // exactly the visual preview of each page.
        prepareNode: printClone,
        fileName: `our-love-story-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.pdf`,
        onPageProgress: (done, total) => setPdfProgress({ done, total })
      });
      setImportStatus({ type: "success", message: `Saved PDF with ${n} A4 page${n === 1 ? "" : "s"}! \u{1F495}` });
    } catch (err) {
      console.error(err);
      setImportStatus({ type: "error", message: err?.message || "Failed to export PDF." });
    } finally {
      setExportingPdf(false);
      setPdfProgress(null);
    }
  };
  const stickersForCurrentPage = (() => {
    const T = Math.max(flowPages.length, 1);
    return stickers.filter((s) => {
      if (s.page >= 0) return s.page === currentPage;
      return resolveStickerPlacements(stickerToPdf(s, T), T).some((pl) => pl.page === currentPage);
    });
  })();
  const stickerToPdf = (s, _totalPages) => {
    const page = s.page === -2 ? void 0 : s.page;
    return { id: s.id, url: s.url, page, xPct: s.xPct, yPct: s.yPct, sizePct: s.sizePct, rotate: s.rotate };
  };
  const stickerStyle = (s) => {
    const T = Math.max(flowPages.length, 1);
    if (s.page >= 0) {
      return { left: `${s.xPct}%`, top: `${s.yPct}%`, width: `${s.sizePct}%`, transform: `rotate(${s.rotate}deg)` };
    }
    const placements = resolveStickerPlacements(stickerToPdf(s, T), T);
    const pl = placements.find((p) => p.page === currentPage) ?? placements[0];
    return { left: `${pl.xPct}%`, top: `${pl.yPct}%`, width: `${pl.sizePct}%`, transform: `rotate(${pl.rotate}deg)` };
  };
  if (loading) {
    return /* @__PURE__ */ jsx("div", { className: "min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex items-center justify-center", children: /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
      /* @__PURE__ */ jsx("div", { className: "text-5xl mb-4 animate-pulse", children: "\u{1F4D6}" }),
      /* @__PURE__ */ jsx("p", { className: "text-amber-700", children: "Loading your diary..." })
    ] }) });
  }
  if (!user) {
    return /* @__PURE__ */ jsx(Auth, { onAuthSuccess: handleAuthSuccess });
  }
  return /* @__PURE__ */ jsxs("div", { className: "min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50", children: [
    importStatus && /* @__PURE__ */ jsxs("div", { className: `fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-white font-medium flex items-center gap-2 animate-fade-in ${importStatus.type === "success" ? "bg-green-500" : "bg-red-500"}`, children: [
      /* @__PURE__ */ jsx("span", { children: importStatus.type === "success" ? "\u2705" : "\u274C" }),
      /* @__PURE__ */ jsx("span", { children: importStatus.message }),
      /* @__PURE__ */ jsx("button", { onClick: () => setImportStatus(null), className: "ml-2 opacity-70 hover:opacity-100", children: "\u2715" })
    ] }),
    /* @__PURE__ */ jsx("header", { className: "bg-white/80 backdrop-blur-sm border-b border-amber-200 sticky top-0 z-10", children: /* @__PURE__ */ jsxs("div", { className: "max-w-4xl mx-auto px-4 py-4 flex items-center justify-between", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
        /* @__PURE__ */ jsx("span", { className: "text-3xl", children: "\u{1F4D6}" }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h1", { className: "text-2xl font-bold text-amber-900 font-serif", children: "My Diary" }),
          /* @__PURE__ */ jsx("p", { className: "text-sm text-amber-700", children: "Cloud-synced journal" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsxs("div", { className: "relative", ref: menuRef, children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setShowMenu(!showMenu),
              className: "bg-white border border-amber-300 hover:bg-amber-50 text-amber-700 p-2.5 rounded-full transition-all shadow-sm hover:shadow-md",
              title: "More options",
              children: /* @__PURE__ */ jsx("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-5 w-5", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M4 6h16M4 12h16M4 18h16" }) })
            }
          ),
          showMenu && /* @__PURE__ */ jsxs("div", { className: "absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-amber-100 overflow-hidden animate-fade-in z-20", children: [
            /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: handleImportClick,
                className: "w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "text-lg", children: "\u{1F4E5}" }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsx("p", { className: "font-medium text-gray-800", children: "Import Entries" }),
                    /* @__PURE__ */ jsx("p", { className: "text-xs text-gray-500", children: "From JSON or text file" })
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ jsx("div", { className: "border-t border-amber-100" }),
            /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: handleExportJSON,
                disabled: entries.length === 0,
                className: "w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "text-lg", children: "\u{1F4E4}" }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsx("p", { className: "font-medium text-gray-800", children: "Export as JSON" }),
                    /* @__PURE__ */ jsx("p", { className: "text-xs text-gray-500", children: "Full backup with all data" })
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: handleExportText,
                disabled: entries.length === 0,
                className: "w-full px-4 py-3 text-left hover:bg-amber-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "text-lg", children: "\u{1F4C4}" }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsx("p", { className: "font-medium text-gray-800", children: "Export as Text" }),
                    /* @__PURE__ */ jsx("p", { className: "text-xs text-gray-500", children: "Readable diary format" })
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: handleSaveAsPdf,
                disabled: entries.length === 0 || exportingPdf,
                className: "w-full px-4 py-3 text-left hover:bg-red-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "text-lg", children: "\u{1F5A8}\uFE0F" }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsx("p", { className: "font-medium text-gray-800", children: exportingPdf ? "Generating PDF\u2026" : "Save as PDF (A4)" }),
                    /* @__PURE__ */ jsx("p", { className: "text-xs text-gray-500", children: "All pages, page numbers, narrow margins" })
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ jsx("div", { className: "border-t border-amber-100" }),
            /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: handleLogout,
                className: "w-full px-4 py-3 text-left hover:bg-red-50 flex items-center gap-3 transition-colors text-red-600",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "text-lg", children: "\u{1F6AA}" }),
                  /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsx("p", { className: "font-medium", children: "Log Out" }),
                    /* @__PURE__ */ jsx("p", { className: "text-xs text-gray-500", children: user.email })
                  ] })
                ]
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: () => {
              setShowForm(!showForm);
              setEditingId(null);
              setMessage("");
              setReflection("");
            },
            className: "bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2",
            children: [
              /* @__PURE__ */ jsx("span", { className: "text-lg", children: showForm ? "\u2715" : "+" }),
              /* @__PURE__ */ jsx("span", { className: "hidden sm:inline", children: showForm ? "Close" : "New Entry" })
            ]
          }
        )
      ] })
    ] }) }),
    showImportModal && /* @__PURE__ */ jsx("div", { className: "fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in", children: /* @__PURE__ */ jsxs("div", { className: "bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden", children: [
      /* @__PURE__ */ jsxs("div", { className: "bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center justify-between", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-white font-semibold text-lg flex items-center gap-2", children: "\u{1F4E5} Import Diary Entries" }),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => setShowImportModal(false),
            className: "text-white/80 hover:text-white text-xl transition",
            children: "\u2715"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "p-6 space-y-5", children: [
        /* @__PURE__ */ jsx("p", { className: "text-gray-600 text-sm", children: "Import your diary entries from a previously exported file. Supported formats:" }),
        /* @__PURE__ */ jsxs("div", { className: "space-y-3", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100", children: [
            /* @__PURE__ */ jsx("span", { className: "text-xl", children: "\u{1F4CB}" }),
            /* @__PURE__ */ jsxs("div", { className: "flex-1", children: [
              /* @__PURE__ */ jsx("p", { className: "font-medium text-amber-900", children: "JSON Format" }),
              /* @__PURE__ */ jsx("p", { className: "text-sm text-amber-700", children: "Full backup files with all entry data including heading, IDs and timestamps." }),
              /* @__PURE__ */ jsx(
                "a",
                {
                  href: "/templates/diary-template.json",
                  download: "diary-template.json",
                  className: "inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-amber-600 hover:text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors",
                  children: "\u2B07\uFE0F Download JSON Template"
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-start gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100", children: [
            /* @__PURE__ */ jsx("span", { className: "text-xl", children: "\u{1F4DD}" }),
            /* @__PURE__ */ jsxs("div", { className: "flex-1", children: [
              /* @__PURE__ */ jsx("p", { className: "font-medium text-orange-900", children: "Text / Markdown Format (.txt / .md)" }),
              /* @__PURE__ */ jsx("p", { className: "text-sm text-orange-700 mb-1", children: "Group entries under headings, one bullet per message:" }),
              /* @__PURE__ */ jsx("code", { className: "text-xs bg-orange-100 px-2 py-1 rounded block text-orange-800 whitespace-pre", children: `#### HEADING 1: [Topic Name]

- Message: [Date & Time] - [Sender]: "[Message]"
  What I felt: [Reflection]` }),
              /* @__PURE__ */ jsxs("div", { className: "mt-2 text-xs text-orange-800 bg-white/60 rounded-lg border border-orange-100 p-2 max-h-40 overflow-y-auto", children: [
                /* @__PURE__ */ jsx("p", { className: "font-semibold mb-1", children: "Allowed headings:" }),
                /* @__PURE__ */ jsx("ul", { className: "space-y-0.5", children: HEADING_CATEGORIES.map((c) => /* @__PURE__ */ jsxs("li", { children: [
                  buildHeadingText(c.emoji, c.title),
                  /* @__PURE__ */ jsxs("span", { className: "text-orange-500", children: [
                    " \u2014 ",
                    c.whenToUse
                  ] })
                ] }, c.title)) })
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap gap-2 mt-2", children: [
                /* @__PURE__ */ jsx(
                  "a",
                  {
                    href: "/templates/diary-template.txt",
                    download: "diary-template.txt",
                    className: "inline-flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-800 bg-orange-100 hover:bg-orange-200 px-3 py-1.5 rounded-lg transition-colors",
                    children: "\u2B07\uFE0F Download Text Template"
                  }
                ),
                /* @__PURE__ */ jsx(
                  "a",
                  {
                    href: "/templates/diary-template.md",
                    download: "diary-template.md",
                    className: "inline-flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-800 bg-orange-100 hover:bg-orange-200 px-3 py-1.5 rounded-lg transition-colors",
                    children: "\u2B07\uFE0F Download Markdown Template"
                  }
                )
              ] })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "bg-yellow-50 border border-yellow-200 rounded-xl p-3", children: /* @__PURE__ */ jsxs("p", { className: "text-sm text-yellow-800", children: [
          "\u26A0\uFE0F ",
          /* @__PURE__ */ jsx("strong", { children: "Note:" }),
          " Imported entries will be added to your existing entries (not replace them)."
        ] }) }),
        /* @__PURE__ */ jsxs("div", { className: "flex gap-3 pt-2", children: [
          /* @__PURE__ */ jsxs("label", { className: "flex-1 bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg text-center cursor-pointer", children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                ref: fileInputRef,
                type: "file",
                accept: ".json,.txt,.md",
                onChange: handleFileImport,
                className: "hidden"
              }
            ),
            "\u{1F4C2} Choose File to Import"
          ] }),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setShowImportModal(false),
              className: "px-6 py-3 border border-amber-300 text-amber-700 rounded-xl font-medium hover:bg-amber-50 transition-all",
              children: "Cancel"
            }
          )
        ] })
      ] })
    ] }) }),
    showStickerModal && /* @__PURE__ */ jsx("div", { className: "fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in", children: /* @__PURE__ */ jsxs("div", { className: "bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden", children: [
      /* @__PURE__ */ jsxs("div", { className: "bg-gradient-to-r from-pink-500 to-rose-500 px-6 py-4 flex items-center justify-between", children: [
        /* @__PURE__ */ jsxs("h2", { className: "text-white font-semibold text-lg flex items-center gap-2", children: [
          "\u{1F338} Add Image Sticker (Page ",
          currentPage + 1,
          ")"
        ] }),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => {
              setShowStickerModal(false);
              setPlacingMode(false);
            },
            className: "text-white/80 hover:text-white text-xl transition",
            children: "\u2715"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "p-6 space-y-5", children: [
        /* @__PURE__ */ jsx("p", { className: "text-gray-600 text-sm", children: "Paste a direct image link (ends with .jpg / .png / .gif / .webp\u2026). The sticker is added to the current A4 page and appears in the exported PDF too." }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "url",
            value: stickerUrl,
            onChange: (e) => setStickerUrl(e.target.value),
            placeholder: "https://example.com/my-photo.jpg",
            className: "w-full px-4 py-3 border border-pink-200 rounded-xl focus:ring-2 focus:ring-pink-400 focus:border-transparent outline-none"
          }
        ),
        stickerUrl && /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3 bg-pink-50 border border-pink-100 rounded-xl p-3", children: [
          /* @__PURE__ */ jsx(RobustImg, { src: resolveImageUrl(stickerUrl), alt: "preview", className: "w-16 h-16 object-cover rounded-lg border border-pink-200" }),
          /* @__PURE__ */ jsx("p", { className: "text-xs text-pink-700", children: "Preview \u2014 if it doesn't load here it won't load in the PDF either." })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-2 gap-4", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: [
              "Size: ",
              stickerSize,
              "% of page width"
            ] }),
            /* @__PURE__ */ jsx("input", { type: "range", min: 10, max: 60, value: stickerSize, onChange: (e) => setStickerSize(Number(e.target.value)), className: "w-full accent-pink-500" })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: [
              "Tilt: ",
              stickerRotate,
              "\xB0"
            ] }),
            /* @__PURE__ */ jsx("input", { type: "range", min: -20, max: 20, value: stickerRotate, onChange: (e) => setStickerRotate(Number(e.target.value)), className: "w-full accent-pink-500" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex gap-3 pt-2", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => addStickerAt({}),
              disabled: !stickerUrl.trim(),
              className: "flex-1 bg-pink-500 hover:bg-pink-600 disabled:opacity-40 text-white py-3 rounded-xl font-medium transition-all shadow-md",
              children: "\u{1F338} Add to ALL pages (random)"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => {
                if (!stickerUrl.trim()) return;
                setShowStickerModal(false);
                setPlacingMode(true);
              },
              disabled: !stickerUrl.trim(),
              className: "flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white py-3 rounded-xl font-medium transition-all shadow-md",
              children: "\u{1F3AF} Choose spot on page\u2026"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => {
                setShowStickerModal(false);
                setPlacingMode(false);
              },
              className: "px-5 py-3 border border-pink-300 text-pink-700 rounded-xl font-medium hover:bg-pink-50 transition-all",
              children: "Cancel"
            }
          )
        ] })
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs("main", { className: "max-w-4xl mx-auto px-4 py-8", children: [
      showForm && /* @__PURE__ */ jsxs("div", { className: "mb-8 bg-white rounded-2xl shadow-xl border border-amber-100 overflow-hidden animate-fade-in", children: [
        /* @__PURE__ */ jsxs("div", { className: "bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4", children: [
          /* @__PURE__ */ jsxs("h2", { className: "text-white font-semibold text-lg flex items-center gap-2", children: [
            "\u270D\uFE0F ",
            editingId ? "Edit Entry" : "Write a New Entry"
          ] }),
          /* @__PURE__ */ jsx("p", { className: "text-amber-100 text-sm mt-1", children: getCurrentDateTime() })
        ] }),
        /* @__PURE__ */ jsxs("form", { onSubmit: handleSubmit, className: "p-6 space-y-5", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("label", { className: "block text-sm font-medium text-amber-800 mb-1.5", children: "Heading (Topic)" }),
            /* @__PURE__ */ jsx(
              "select",
              {
                value: heading,
                onChange: (e) => setHeading(e.target.value),
                className: "w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50",
                children: HEADING_CATEGORIES.map((c) => /* @__PURE__ */ jsxs("option", { value: buildHeadingText(c.emoji, c.title), children: [
                  buildHeadingText(c.emoji, c.title),
                  " \u2014 ",
                  c.whenToUse
                ] }, c.title))
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("label", { className: "block text-sm font-medium text-amber-800 mb-1.5", children: "Who is this message from?" }),
            /* @__PURE__ */ jsxs(
              "select",
              {
                value: senderName,
                onChange: (e) => setSenderName(e.target.value),
                className: "w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-amber-50/50",
                children: [
                  /* @__PURE__ */ jsx("option", { value: "Deep", children: "Deep (me)" }),
                  /* @__PURE__ */ jsx("option", { value: "\u{1FAF0}\u{1FAF6}\u{1F3FB}Chota Don\u2763\uFE0F\u2764\uFE0F\u{1F618}", children: "\u{1FAF0}\u{1FAF6}\u{1F3FB}Chota Don\u2763\uFE0F\u2764\uFE0F\u{1F618} (her)" })
                ]
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("label", { className: "block text-sm font-medium text-amber-800 mb-1.5", children: "Message / What happened" }),
            /* @__PURE__ */ jsx(
              "textarea",
              {
                value: message,
                onChange: (e) => setMessage(e.target.value),
                placeholder: "Write about what happened, what was said, or what you experienced...",
                rows: 4,
                className: "w-full px-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition resize-none bg-amber-50/50",
                required: true
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("label", { className: "block text-sm font-medium text-amber-800 mb-1.5", children: "What I Felt (Reflection)" }),
            /* @__PURE__ */ jsx(
              "textarea",
              {
                value: reflection,
                onChange: (e) => setReflection(e.target.value),
                placeholder: "How did this make you feel? What are your thoughts about it?",
                rows: 3,
                className: "w-full px-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition resize-none bg-amber-50/50",
                required: true
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-3 pt-2", children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "submit",
                className: "flex-1 bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-all shadow-md hover:shadow-lg",
                children: editingId ? "\u{1F4BE} Update Entry" : "\u{1F4DD} Save Entry"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                onClick: handleCancel,
                className: "px-6 py-3 border border-amber-300 text-amber-700 rounded-xl font-medium hover:bg-amber-50 transition-all",
                children: "Cancel"
              }
            )
          ] })
        ] })
      ] }),
      entries.length > 0 && /* @__PURE__ */ jsx("div", { className: "mb-6", children: /* @__PURE__ */ jsxs("div", { className: "relative", children: [
        /* @__PURE__ */ jsx("span", { className: "absolute left-4 top-1/2 -translate-y-1/2 text-amber-400", children: "\u{1F50D}" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            placeholder: "Search your diary entries...",
            className: "w-full pl-12 pr-4 py-3 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none transition bg-white/80 backdrop-blur-sm"
          }
        )
      ] }) }),
      entries.length > 0 && /* @__PURE__ */ jsxs("p", { className: "text-amber-700 text-sm mb-4", children: [
        filteredEntries.length,
        " ",
        filteredEntries.length === 1 ? "entry" : "entries",
        searchQuery && ` matching "${searchQuery}"`
      ] }),
      entries.length === 0 && !showForm && /* @__PURE__ */ jsxs("div", { className: "text-center py-20", children: [
        /* @__PURE__ */ jsx("div", { className: "text-6xl mb-4", children: "\u{1F4D4}" }),
        /* @__PURE__ */ jsx("h3", { className: "text-xl font-semibold text-amber-800 mb-2", children: "Your diary is empty" }),
        /* @__PURE__ */ jsx("p", { className: "text-amber-600 mb-6", children: "Start writing your first entry or import existing ones." }),
        /* @__PURE__ */ jsxs("div", { className: "flex flex-col sm:flex-row gap-3 justify-center", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setShowForm(true),
              className: "bg-amber-600 hover:bg-amber-700 text-white px-8 py-3 rounded-full font-medium transition-all shadow-md hover:shadow-lg",
              children: "\u270D\uFE0F Write Your First Entry"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: handleImportClick,
              className: "border-2 border-amber-400 text-amber-700 hover:bg-amber-50 px-8 py-3 rounded-full font-medium transition-all",
              children: "\u{1F4E5} Import Entries"
            }
          )
        ] })
      ] }),
      entries.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center justify-center gap-2 mb-4", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: handleSaveAsPdf,
              disabled: exportingPdf,
              className: "bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2",
              title: "Save the whole diary as an A4-sized PDF",
              children: exportingPdf ? /* @__PURE__ */ jsxs("span", { className: "animate-pulse", children: [
                "\u23F3 Generating PDF (",
                totalPages,
                " pages)..."
              ] }) : /* @__PURE__ */ jsx(Fragment, { children: "\u{1F5A8}\uFE0F Save as PDF (A4)" })
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => {
                setShowStickerModal(true);
                setPlacingMode(false);
              },
              className: "bg-pink-500 hover:bg-pink-600 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2",
              title: "Add an image sticker from a link anywhere on the page",
              children: "\u{1F338} Add Image Sticker"
            }
          ),
          stickers.length > 0 && /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => {
                if (window.confirm("Remove all stickers from every page?")) setStickers([]);
              },
              className: "border border-red-300 text-red-600 hover:bg-red-50 px-4 py-2.5 rounded-full text-sm font-medium transition",
              children: [
                "\u{1F9F9} Clear stickers (",
                stickers.length,
                ")"
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsx("div", { ref: sheetWrapRef, className: "w-full flex justify-center", children: /* @__PURE__ */ jsx(
          "div",
          {
            className: "a4-sheet",
            style: { height: `${297 * sheetScale}mm` },
            onClick: (e) => {
              if (!placingMode) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const xPct = (e.clientX - rect.left) / rect.width * 100;
              const yPct = (e.clientY - rect.top) / rect.height * 100;
              addStickerAt({ page: currentPage, xPct, yPct });
            },
            children: /* @__PURE__ */ jsxs(
              "div",
              {
                ref: pageNodeRef,
                className: `a4-page page-flip-enter ${placingMode ? "cursor-crosshair ring-4 ring-pink-400" : ""}`,
                style: {
                  transform: `scale(${sheetScale})`,
                  ["--flip-from"]: flipDir === "next" ? "45%" : "-45%"
                },
                children: [
                  /* @__PURE__ */ jsx(LoveStoryHeader, {}),
                  /* @__PURE__ */ jsx("div", { className: "a4-print-area", children: (flowPages[currentPage] ?? []).map(
                    (b) => b.sliceTop !== void 0 ? (
                      // Oversized block sliced across pages: clip one window of it
                      /* @__PURE__ */ jsx(
                        "div",
                        {
                          style: { height: `${b.height}px`, overflow: "hidden" },
                          children: /* @__PURE__ */ jsx(
                            "div",
                            {
                              style: { position: "relative", top: `-${b.sliceTop}px` },
                              dangerouslySetInnerHTML: { __html: b.html }
                            }
                          )
                        },
                        `${b.key}-${b.sliceTop}`
                      )
                    ) : /* @__PURE__ */ jsx("div", { dangerouslySetInnerHTML: { __html: b.html } }, b.key)
                  ) }),
                  /* @__PURE__ */ jsx(LoveStoryFooter, {}),
                  stickersForCurrentPage.map((s) => /* @__PURE__ */ jsxs(
                    "div",
                    {
                      className: "diary-sticker",
                      style: stickerStyle(s),
                      onClick: (e) => e.stopPropagation(),
                      children: [
                        /* @__PURE__ */ jsx(RobustImg, { src: s.url, alt: "sticker", draggable: false }),
                        /* @__PURE__ */ jsx("button", { className: "sticker-remove", title: "Remove sticker", onClick: (e) => {
                          e.stopPropagation();
                          removeSticker(s.id);
                        }, children: "\u2715" }),
                        /* @__PURE__ */ jsxs("div", { className: "sticker-nudges", children: [
                          /* @__PURE__ */ jsx("button", { title: "Move left", onClick: (e) => {
                            e.stopPropagation();
                            moveSticker(s.id, -3, 0);
                          }, children: "\u25C0" }),
                          /* @__PURE__ */ jsx("button", { title: "Move up", onClick: (e) => {
                            e.stopPropagation();
                            moveSticker(s.id, 0, -3);
                          }, children: "\u25B2" }),
                          /* @__PURE__ */ jsx("button", { title: "Move down", onClick: (e) => {
                            e.stopPropagation();
                            moveSticker(s.id, 0, 3);
                          }, children: "\u25BC" }),
                          /* @__PURE__ */ jsx("button", { title: "Move right", onClick: (e) => {
                            e.stopPropagation();
                            moveSticker(s.id, 3, 0);
                          }, children: "\u25B6" }),
                          /* @__PURE__ */ jsx("button", { title: "Bigger", onClick: (e) => {
                            e.stopPropagation();
                            setStickers((prev) => prev.map((x) => x.id === s.id ? { ...x, sizePct: Math.min(60, x.sizePct + 4) } : x));
                          }, children: "\uFF0B" }),
                          /* @__PURE__ */ jsx("button", { title: "Smaller", onClick: (e) => {
                            e.stopPropagation();
                            setStickers((prev) => prev.map((x) => x.id === s.id ? { ...x, sizePct: Math.max(8, x.sizePct - 4) } : x));
                          }, children: "\uFF0D" })
                        ] })
                      ]
                    },
                    s.id
                  )),
                  /* @__PURE__ */ jsxs("div", { className: "a4-page-number", children: [
                    "Page ",
                    currentPage + 1,
                    " of ",
                    totalPages
                  ] })
                ]
              },
              currentPage
            )
          }
        ) }),
        placingMode && /* @__PURE__ */ jsx("p", { className: "text-center text-pink-600 font-medium mt-3 animate-pulse", children: "\u{1F3AF} Click anywhere on the A4 page to place your sticker!" }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-center gap-4 mt-5 mb-2", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => flipTo(currentPage - 1),
              disabled: currentPage === 0,
              className: "bg-amber-600 hover:bg-amber-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-md flex items-center gap-2",
              children: "\u2B05\uFE0F Prev"
            }
          ),
          /* @__PURE__ */ jsxs("div", { className: "text-amber-800 font-serif font-semibold", children: [
            "Page ",
            currentPage + 1,
            " / ",
            totalPages
          ] }),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => flipTo(currentPage + 1),
              disabled: currentPage >= totalPages - 1,
              className: "bg-amber-600 hover:bg-amber-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-md flex items-center gap-2",
              children: "Next \u27A1\uFE0F"
            }
          )
        ] }),
        /* @__PURE__ */ jsx("p", { className: "text-center text-xs text-amber-600 mb-4", children: "Tip: use \u2190 / \u2192 arrow keys to flip pages \xB7 A4 size \xB7 narrow margins" })
      ] }),
      entries.length > 0 && filteredEntries.length === 0 && searchQuery && /* @__PURE__ */ jsxs("div", { className: "text-center py-12", children: [
        /* @__PURE__ */ jsx("div", { className: "text-4xl mb-3", children: "\u{1F50D}" }),
        /* @__PURE__ */ jsxs("p", { className: "text-amber-700", children: [
          'No entries found matching "',
          searchQuery,
          '"'
        ] })
      ] })
    ] }),
    entries.length > 0 && /* @__PURE__ */ jsxs("div", { style: { position: "absolute", left: -99999, top: 0, width: `${CONTENT_W_CSS}px` }, "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("div", { id: "ls-header-measure", style: { width: `${CONTENT_W_CSS}px` }, children: /* @__PURE__ */ jsx(LoveStoryHeader, {}) }),
      /* @__PURE__ */ jsx("div", { id: "ls-footer-measure", style: { width: `${CONTENT_W_CSS}px` }, children: /* @__PURE__ */ jsx(LoveStoryFooter, {}) }),
      /* @__PURE__ */ jsx("div", { id: "ls-header-print", style: { width: `${CONTENT_W_CSS}px`, background: "#ffffff" }, children: /* @__PURE__ */ jsx(LoveStoryHeader, {}) }),
      /* @__PURE__ */ jsx("div", { id: "ls-footer-print", style: { width: `${CONTENT_W_CSS}px`, background: "#ffffff" }, children: /* @__PURE__ */ jsx(LoveStoryFooter, {}) }),
      /* @__PURE__ */ jsx("div", { id: "pdf-blocks", style: { width: `${CONTENT_W_CSS}px`, fontSize: "10pt", lineHeight: 1.45, color: "#3f2a12" }, children: flowPages.map((pageBlocks, pi) => /* @__PURE__ */ jsxs("div", { "data-page": pi, children: [
        pageBlocks.map(
          (b) => b.sliceTop !== void 0 ? /* @__PURE__ */ jsx(
            "div",
            {
              style: { width: `${CONTENT_W_CSS}px`, height: `${b.height}px`, overflow: "hidden", boxSizing: "border-box" },
              children: /* @__PURE__ */ jsx(
                "div",
                {
                  style: { position: "relative", top: `-${b.sliceTop}px`, width: `${CONTENT_W_CSS}px`, boxSizing: "border-box" },
                  dangerouslySetInnerHTML: { __html: b.html }
                }
              )
            },
            `p-${b.key}-${b.sliceTop}`
          ) : /* @__PURE__ */ jsx("div", { style: { width: `${CONTENT_W_CSS}px`, boxSizing: "border-box" }, dangerouslySetInnerHTML: { __html: b.html } }, `p-${b.key}`)
        ),
        stickers.filter((s) => s.page === pi).map((s) => /* @__PURE__ */ jsx(
          "div",
          {
            style: { width: `${s.sizePct / 100 * CONTENT_W_CSS}px`, margin: "4px auto", transform: `rotate(${s.rotate}deg)` },
            children: /* @__PURE__ */ jsx(RobustImg, { src: s.url, alt: "sticker", draggable: false, style: { width: "100%", display: "block", border: "3px solid #fff", borderRadius: "8px" } })
          },
          `p-sticker-${s.id}`
        ))
      ] }, `pp-${pi}`)) }),
      /* @__PURE__ */ jsx(
        "div",
        {
          ref: flowHostRef,
          style: { width: `${CONTENT_W_CSS}px`, fontSize: "10pt", lineHeight: 1.45, color: "#3f2a12", background: "#ffffff" }
        }
      )
    ] }),
    /* @__PURE__ */ jsx("footer", { className: "text-center py-6 text-amber-600 text-sm", children: /* @__PURE__ */ jsx("p", { children: "Your diary entries are synced to the cloud \u2601\uFE0F \u{1F512} \xB7 A4 pages \xB7 narrow margins" }) })
  ] });
}
var App_default = App;
export {
  App_default as default
};
