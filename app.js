/* Anki PWA V3 - NO IMPORTS, INLINE, PRODUCTION-READY */
'use strict';

const DB_NAME = "anki_pwa_v3";
const DB_VERSION = 1;

const DEFAULTS = {
  newPerDay: 20,
  reviewsPerDay: 200,
  learningSteps: "10m,1d",
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  startingEase: 2.5,
  easyBonus: 1.3,
  intervalModifier: 1.0,
  maxIntervalDays: 36500,
  burySiblings: true,
  darkMode: "system"
};

const NOTE_TYPES = [
  { key: "basic", name: "Basic", fields: ["Front", "Back"] },
  { key: "basic_rev", name: "Basic (reversed)", fields: ["Front", "Back"] },
  { key: "cloze", name: "Cloze", fields: ["Text", "Extra"] }
];

const Rating = Object.freeze({ AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 });

/* ==================== UTILS ==================== */
function uid() {
  return "id_" + Math.random().toString(36).slice(2) + "_" + Date.now();
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function startOfTodayMs() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function startOfTomorrowMs() { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+1); return d.getTime(); }

function h(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v, { passive: false });
    } else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  });
  children.forEach(ch => {
    if (ch == null) return;
    if (typeof ch === "string") node.appendChild(document.createTextNode(ch));
    else node.appendChild(ch);
  });
  return node;
}

function toast(msg, ms = 1800) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.remove("show"), ms);
}

function applyTheme(mode) {
  const root = document.documentElement;
  const isDark = mode === "system"
    ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
    : mode === "dark";
  root.setAttribute("data-dark", isDark ? "1" : "0");
}

function parseSteps(str) {
  const parts = (str || "").split(",").map(s => s.trim()).filter(Boolean);
  const ms = [];
  for (const p of parts) {
    const m = /^(\d+)\s*([mhd])$/i.exec(p);
    if (!m) continue;
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    const mult = u === "m" ? 60e3 : u === "h" ? 3.6e6 : 86.4e6;
    ms.push(n * mult);
  }
  return ms.length ? ms : [10*60e3, 86.4e6];
}

/* ==================== IndexedDB (Safe) ==================== */
async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("DB open failed"));
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      try {
        [...db.objectStoreNames].forEach(s => {
          try { db.deleteObjectStore(s); } catch (_) {}
        });

        const decks = db.createObjectStore("decks", { keyPath: "id" });
        decks.createIndex("byParent", "parentId", { unique: false });

        const notes = db.createObjectStore("notes", { keyPath: "id" });
        notes.createIndex("byDeck", "deckId", { unique: false });

        const cards = db.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("byDeck", "deckId", { unique: false });
        cards.createIndex("byNote", "noteId", { unique: false });
        cards.createIndex("deckState", ["deckId", "state"], { unique: false });

        const revlog = db.createObjectStore("revlog", { keyPath: "id" });
        revlog.createIndex("byCard", "cardId", { unique: false });

        db.createObjectStore("kv", { keyPath: "key" });
      } catch (e) {
        console.error("Upgrade error:", e);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error || new Error("Req failed"));
    req.onsuccess = () => resolve(req.result);
  });
}

async function getKV(db, key) {
  try {
    const r = db.transaction(["kv"], "readonly").objectStore("kv").get(key);
    const res = await reqToPromise(r);
    return res?.value;
  } catch (e) {
    console.warn("getKV error:", e);
    return undefined;
  }
}

async function setKV(db, key, value) {
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(["kv"], "readwrite");
      t.onerror = () => reject(t.error);
      t.oncomplete = () => resolve();
      t.objectStore("kv").put({ key, value });
    });
  } catch (e) {
    console.warn("setKV error:", e);
  }
}

async function getAllNotes(db) {
  try {
    const r = db.transaction(["notes"], "readonly").objectStore("notes").getAll();
    return await reqToPromise(r);
  } catch (e) {
    console.warn("getAllNotes error:", e);
    return [];
  }
}

async function getAllCards(db) {
  try {
    const r = db.transaction(["cards"], "readonly").objectStore("cards").getAll();
    return await reqToPromise(r);
  } catch (e) {
    console.warn("getAllCards error:", e);
    return [];
  }
}

/* ==================== Seed ==================== */
async function ensureSeed(db) {
  try {
    const seeded = await getKV(db, "_seeded");
    if (seeded) return;

    const rootDeck = {
      id: uid(),
      name: "Default",
      parentId: null,
      sort: 0,
      createdAt: Date.now()
    };

    await new Promise((resolve, reject) => {
      const t = db.transaction(["decks", "kv"], "readwrite");
      t.onerror = () => reject(t.error);
      t.oncomplete = () => resolve();
      t.objectStore("decks").put(rootDeck);
      t.objectStore("kv").put({ key: "_seeded", value: true });
    });

    for (const [k, v] of Object.entries(DEFAULTS)) {
      await setKV(db, "s:" + k, v);
    }
  } catch (e) {
    console.error("Seed error:", e);
  }
}

/* ==================== Settings ==================== */
async function loadSettings(db) {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = await getKV(db, "s:" + k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function saveSettings(db, patch) {
  for (const [k, v] of Object.entries(patch)) {
    await setKV(db, "s:" + k, v);
  }
}

/* ==================== Cloze ==================== */
function extractCloze(text) {
  const src = String(text ?? "");
  const re = /{{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?}}/g;
  const map = new Map();
  let m;
  while ((m = re.exec(src)) !== null) {
    const n = Number(m[1]);
    const ans = m[2] ?? "";
    const hint = m[3] ?? "";
    if (!map.has(n)) map.set(n, { n, matches: [] });
    map.get(n).matches.push({ full: m[0], answer: ans, hint });
  }
  return map;
}

function renderClozeFront(text, clozeN) {
  const src = String(text ?? "");
  const re = /{{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?}}/g;
  return h(src).replace(re, (_, nStr, ans, hint) => {
    const n = Number(nStr);
    if (n === clozeN) {
      const hh = (hint ?? "").trim();
      return `<span class="hint">[${h(hh || "...")}]</span>`;
    }
    return h(ans ?? "");
  });
}

function renderClozeBack(text, clozeN) {
  const src = String(text ?? "");
  const re = /{{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?}}/g;
  return h(src).replace(re, (_, nStr, ans) => {
    const n = Number(nStr);
    if (n === clozeN) return `<mark>${h(ans ?? "")}</mark>`;
    return h(ans ?? "");
  });
}

/* ==================== Templates ==================== */
function templatesForNote(noteTypeKey, fields) {
  if (noteTypeKey === "basic") {
    return [{ templateKey: "basic_fwd", frontHtml: h(fields.Front || ""), backHtml: h(fields.Back || "") }];
  }
  if (noteTypeKey === "basic_rev") {
    return [
      { templateKey: "basic_fwd", frontHtml: h(fields.Front || ""), backHtml: h(fields.Back || "") },
      { templateKey: "basic_rev", frontHtml: h(fields.Back || ""), backHtml: h(fields.Front || "") }
    ];
  }
  if (noteTypeKey === "cloze") {
    const m = extractCloze(fields.Text || "");
    const out = [];
    for (const n of [...m.keys()].sort((a, b) => a - b)) {
      out.push({
        templateKey: "cloze_c" + n,
        clozeN: n,
        frontHtml: renderClozeFront(fields.Text || "", n),
        backHtml: renderClozeBack(fields.Text || "", n)
      });
    }
    return out.length ? out : [{
      templateKey: "cloze_c1",
      clozeN: 1,
      frontHtml: h(fields.Text || ""),
      backHtml: h(fields.Text || "")
    }];
  }
  return [];
}

/* ==================== Scheduler ==================== */
function calculateNext(card, rating, settings) {
  const now = Date.now();
  const steps = parseSteps(settings.learningSteps);

  const before = JSON.parse(JSON.stringify(card));
  let c = JSON.parse(JSON.stringify(card));

  c.reps = (c.reps ?? 0) + 1;

  const intervalMod = Number(settings.intervalModifier ?? 1.0);
  const maxI = Number(settings.maxIntervalDays ?? 36500);
  const easyBonus = Number(settings.easyBonus ?? 1.3);

  const dueInDays = (days) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + Math.max(1, Math.round(days)));
    return d.getTime();
  };

  const setReview = (intervalDays) => {
    c.state = "review";
    c.intervalDays = clamp(intervalDays, 1, maxI);
    c.dueMs = dueInDays(c.intervalDays);
    c.stepIndex = 0;
  };

  c.ease = Number.isFinite(c.ease) ? c.ease : Number(settings.startingEase ?? 2.5);
  c.intervalDays = Number.isFinite(c.intervalDays) ? c.intervalDays : 0;
  c.lapses = Number.isFinite(c.lapses) ? c.lapses : 0;
  c.stepIndex = Number.isFinite(c.stepIndex) ? c.stepIndex : 0;

  if (c.state === "new") {
    if (rating === Rating.EASY) {
      setReview(Number(settings.easyIntervalDays ?? 4));
    } else {
      c.state = "learning";
      c.stepIndex = 0;
      c.dueMs = now + steps[0];
    }
  } else if (c.state === "learning" || c.state === "relearning") {
    if (rating === Rating.AGAIN) {
      c.stepIndex = 0;
      c.dueMs = now + steps[0];
    } else if (rating === Rating.HARD) {
      const cur = steps[c.stepIndex] ?? steps[0];
      c.dueMs = now + Math.round(cur * 1.5);
    } else if (rating === Rating.GOOD) {
      c.stepIndex += 1;
      if (c.stepIndex >= steps.length) {
        setReview(Number(settings.graduatingIntervalDays ?? 1));
      } else {
        c.dueMs = now + steps[c.stepIndex];
      }
    } else if (rating === Rating.EASY) {
      setReview(Number(settings.easyIntervalDays ?? 4));
    }
  } else if (c.state === "review") {
    const oldI = Math.max(1, Number(c.intervalDays ?? 1));
    if (rating === Rating.AGAIN) {
      c.lapses += 1;
      c.ease = clamp(c.ease - 0.2, 1.3, 3.5);
      c.state = "relearning";
      c.stepIndex = 0;
      c.dueMs = now + steps[0];
      c.intervalDays = Math.max(1, Math.round(oldI * 0.5));
    } else if (rating === Rating.HARD) {
      c.ease = clamp(c.ease - 0.15, 1.3, 3.5);
      const ni = Math.round(oldI * 1.2 * intervalMod);
      setReview(ni);
    } else if (rating === Rating.GOOD) {
      const ni = Math.round(oldI * c.ease * intervalMod);
      setReview(ni);
    } else if (rating === Rating.EASY) {
      c.ease = clamp(c.ease + 0.15, 1.3, 3.5);
      const ni = Math.round(oldI * c.ease * easyBonus * intervalMod);
      setReview(ni);
    }
  }

  const after = JSON.parse(JSON.stringify(c));
  return { before, after };
}

/* ==================== QUERIES ==================== */
async function getDeck(db, id) {
  try {
    const r = db.transaction(["decks"], "readonly").objectStore("decks").get(id);
    return await reqToPromise(r);
  } catch (e) {
    console.warn("getDeck error:", e);
    return null;
  }
}

async function listDecks(db) {
  try {
    const r = db.transaction(["decks"], "readonly").objectStore("decks").getAll();
    const all = await reqToPromise(r);
    all.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
    return all;
  } catch (e) {
    console.warn("listDecks error:", e);
    return [];
  }
}

async function getSubdeckIds(db, deckId) {
  try {
    const decks = await listDecks(db);
    const children = new Map();
    for (const d of decks) {
      const p = d.parentId ?? null;
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(d);
    }
    const out = [];
    const stack = [deckId];
    while (stack.length) {
      const cur = stack.pop();
      out.push(cur);
      const kids = children.get(cur) || [];
      for (const k of kids) stack.push(k.id);
    }
    return out;
  } catch (e) {
    console.warn("getSubdeckIds error:", e);
    return [deckId];
  }
}

async function countDueForDeck(db, deckId, settings) {
  try {
    const now = Date.now();
    const deckIds = await getSubdeckIds(db, deckId);
    let newCount = 0, learnCount = 0, reviewCount = 0;

    const allCards = await getAllCards(db);

    for (const card of allCards) {
      if (!deckIds.includes(card.deckId)) continue;
      if (card.buriedUntilMs && card.buriedUntilMs > now) continue;

      if (card.state === "new") {
        newCount += 1;
      } else if ((card.state === "learning" || card.state === "relearning") && card.dueMs <= now) {
        learnCount += 1;
      } else if (card.state === "review" && card.dueMs <= now) {
        reviewCount += 1;
      }
    }

    return {
      newCount: Math.min(newCount, Number(settings.newPerDay ?? 20)),
      learnCount,
      reviewCount: Math.min(reviewCount, Number(settings.reviewsPerDay ?? 200))
    };
  } catch (e) {
    console.warn("countDue error:", e);
    return { newCount: 0, learnCount: 0, reviewCount: 0 };
  }
}

async function buildStudyQueue(db, deckId, settings) {
  try {
    const now = Date.now();
    const deckIds = await getSubdeckIds(db, deckId);

    const qLearn = [];
    const qReview = [];
    const qNew = [];

    const allCards = await getAllCards(db);

    for (const card of allCards) {
      if (!deckIds.includes(card.deckId)) continue;
      if (card.buriedUntilMs && card.buriedUntilMs > now) continue;

      if ((card.state === "learning" || card.state === "relearning") && card.dueMs <= now) {
        qLearn.push(card.id);
      } else if (card.state === "review" && card.dueMs <= now) {
        qReview.push(card.id);
      } else if (card.state === "new") {
        qNew.push(card.id);
      }
    }

    const reviewLimit = Number(settings.reviewsPerDay ?? 200);
    const newLimit = Number(settings.newPerDay ?? 20);

    return [
      ...qLearn,
      ...qReview.slice(0, reviewLimit),
      ...qNew.slice(0, newLimit)
    ];
  } catch (e) {
    console.warn("buildStudyQueue error:", e);
    return [];
  }
}

/* ==================== APP STATE ==================== */
const App = {
  db: null,
  settings: null,
  review: null
};

/* ==================== ROUTER ==================== */
function setRoute(hash) { location.hash = hash; }
function currentRoute() { const h = (location.hash || "#/decks").slice(2); const [route, ...rest] = h.split("/"); return [route, ...rest]; }

function navBar(active) {
  const mk = (label, to, key) =>
    el("button", {
      class: "nav-btn",
      type: "button",
      "aria-current": active === key ? "page" : "false",
      onclick: () => setRoute(to)
    }, label);

  return el("div", { class: "nav", role: "navigation" },
    mk("Decks", "#/decks", "decks"),
    mk("Add", "#/add", "add"),
    mk("Browse", "#/browse", "browse"),
    mk("Settings", "#/settings", "settings")
  );
}

function layout(title, activeKey, contentNode) {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const windowNode = el("div", { class: "window" },
    el("div", { class: "titlebar" },
      el("div", { class: "traffic", "aria-hidden": "true" },
        el("div", { class: "dot red" }),
        el("div", { class: "dot yellow" }),
        el("div", { class: "dot green" })
      ),
      el("div", { class: "toolbar" },
        el("div", { class: "app-title" }, title),
        navBar(activeKey)
      )
    ),
    el("main", { id: "main", class: "content", tabindex: "-1" },
      el("div", { class: "page" }, contentNode)
    )
  );

  app.appendChild(windowNode);

  setTimeout(() => {
    const main = document.getElementById("main");
    if (main) main.focus({ preventScroll: true });
  }, 50);
}

/* ==================== PAGE: DECKS ==================== */
async function renderDecks() {
  const decks = await listDecks(App.db);
  const settings = App.settings;

  const rows = [];
  for (const d of decks) {
    const counts = await countDueForDeck(App.db, d.id, settings);
    const sub = `${counts.newCount} new • ${counts.learnCount} learn • ${counts.reviewCount} review`;
    rows.push(
      el("li", { class: "row", tabindex: "0", role: "button",
        onclick: () => setRoute(`#/deck/${d.id}`),
        onkeydown: (e) => { if (e.key === "Enter") setRoute(`#/deck/${d.id}`); }
      },
        el("div", {},
          el("div", { class: "row-title" }, d.name),
          el("div", { class: "row-sub" }, sub)
        ),
        el("div", { class: `badge ${counts.learnCount + counts.reviewCount > 0 ? "learn" : ""}` },
          el("span", { class: "n" }, String(counts.learnCount + counts.reviewCount))
        )
      )
    );
  }

  const content = el("div", { class: "vstack" },
    el("div", { class: "card" },
      el("div", { class: "spread" },
        el("div", {},
          el("div", { style: "font-weight:800; font-size:16px;" }, "Decks"),
          el("div", { class: "small" }, "Tap to open")
        ),
        el("button", { class: "btn", type: "button", onclick: createDeckModal }, "+ Deck")
      )
    ),
    el("ul", { class: "list" }, ...rows)
  );

  layout("Anki PWA", "decks", content);

  async function createDeckModal() {
    const name = prompt("New deck name (use :: for subdecks):");
    if (!name) return;

    const decksAll = await listDecks(App.db);
    const parts = name.split("::").map(s => s.trim()).filter(Boolean);
    let parentId = null;
    let finalName = name.trim();

    if (parts.length > 1) {
      let curParent = null;
      for (let i = 0; i < parts.length - 1; i++) {
        const partName = parts.slice(0, i + 1).join("::");
        const existing = decksAll.find(x => x.name === partName);
        if (existing) {
          curParent = existing.id;
        } else {
          const nd = { id: uid(), name: partName, parentId: curParent, sort: Date.now(), createdAt: Date.now() };
          try {
            await new Promise((resolve, reject) => {
              const t = App.db.transaction(["decks"], "readwrite");
              t.onerror = () => reject(t.error);
              t.oncomplete = () => resolve();
              t.objectStore("decks").put(nd);
            });
          } catch (e) {
            console.error("Create subdeck error:", e);
            return;
          }
          decksAll.push(nd);
          curParent = nd.id;
        }
      }
      parentId = curParent;
      finalName = parts.join("::");
    }

    const newDeck = { id: uid(), name: finalName, parentId, sort: Date.now(), createdAt: Date.now() };
    try {
      await new Promise((resolve, reject) => {
        const t = App.db.transaction(["decks"], "readwrite");
        t.onerror = () => reject(t.error);
        t.oncomplete = () => resolve();
        t.objectStore("decks").put(newDeck);
      });
    } catch (e) {
      console.error("Create deck error:", e);
      toast("Error creating deck");
      return;
    }

    toast("Deck created");
    await render();
  }
}

/* ==================== PAGE: DECK DETAIL ==================== */
async function renderDeckDetail(deckId) {
  const deck = await getDeck(App.db, deckId);
  if (!deck) {
    toast("Deck not found");
    setRoute("#/decks");
    return;
  }

  const counts = await countDueForDeck(App.db, deckId, App.settings);

  const content = el("div", { class: "vstack" },
    el("div", { class: "card" },
      el("div", { class: "vstack" },
        el("div", { class: "spread" },
          el("div", {},
            el("div", { style: "font-weight:800; font-size:18px;" }, deck.name),
            el("div", { class: "small" }, `${counts.newCount} new • ${counts.learnCount} learn • ${counts.reviewCount} review`)
          ),
          el("div", { class: "hstack" },
            el("button", { class: "btn secondary", type: "button", onclick: () => renameDeck(deck) }, "Rename"),
            el("button", { class: "btn danger", type: "button", onclick: () => deleteDeck(deck) }, "Delete")
          )
        ),
        el("div", { class: "divider" }),
        el("div", { class: "stats-grid" },
          el("div", { class: "stat-box" },
            el("div", { class: "stat-number" }, counts.newCount),
            el("div", { class: "stat-label" }, "New")
          ),
          el("div", { class: "stat-box" },
            el("div", { class: "stat-number" }, counts.learnCount),
            el("div", { class: "stat-label" }, "Learning")
          ),
          el("div", { class: "stat-box" },
            el("div", { class: "stat-number" }, counts.reviewCount),
            el("div", { class: "stat-label" }, "Review")
          ),
          el("div", { class: "stat-box" },
            el("div", { class: "stat-number" }, counts.newCount + counts.learnCount + counts.reviewCount),
            el("div", { class: "stat-label" }, "Due")
          )
        ),
        el("div", { class: "divider" }),
        el("button", {
          class: "btn primary full",
          type: "button",
          onclick: () => setRoute(`#/review/${deckId}`),
          disabled: counts.learnCount + counts.reviewCount + counts.newCount === 0
        }, `Study (${counts.learnCount + counts.reviewCount + counts.newCount})`),
        el("button", { class: "btn full", type: "button", onclick: () => setRoute(`#/add/${deckId}`) }, "Add Note")
      )
    )
  );

  layout(deck.name, "decks", content);

  async function renameDeck(d) {
    const name = prompt("New name:", d.name);
    if (!name) return;
    d.name = name.trim();
    try {
      await new Promise((resolve, reject) => {
        const t = App.db.transaction(["decks"], "readwrite");
        t.onerror = () => reject(t.error);
        t.oncomplete = () => resolve();
        t.objectStore("decks").put(d);
      });
    } catch (e) {
      console.error("Rename error:", e);
      toast("Error renaming");
      return;
    }
    toast("Renamed");
    await render();
  }

  async function deleteDeck(d) {
    const ok = confirm("Delete deck and all cards?");
    if (!ok) return;

    const ids = await getSubdeckIds(App.db, d.id);
    const allCards = await getAllCards(App.db);
    const allNotes = await getAllNotes(App.db);

    const cardsToDelete = allCards.filter(c => ids.includes(c.deckId));
    const notesToDelete = allNotes.filter(n => ids.includes(n.deckId));

    try {
      await new Promise((resolve, reject) => {
        const t = App.db.transaction(["decks", "notes", "cards"], "readwrite");
        t.onerror = () => reject(t.error);
        t.oncomplete = () => resolve();

        const decksS = t.objectStore("decks");
        const notesS = t.objectStore("notes");
        const cardsS = t.objectStore("cards");

        for (const did of ids) decksS.delete(did);
        for (const n of notesToDelete) notesS.delete(n.id);
        for (const c of cardsToDelete) cardsS.delete(c.id);
      });
    } catch (e) {
      console.error("Delete error:", e);
      toast("Error deleting");
      return;
    }

    toast("Deleted");
    setRoute("#/decks");
  }
}

/* ==================== PAGE: ADD NOTE ==================== */
async function renderAdd(deckId) {
  const decks = await listDecks(App.db);
  const chosenDeck = deckId ? await getDeck(App.db, deckId) : decks[0];

  const state = {
    deckId: chosenDeck?.id || (decks[0]?.id),
    noteType: "basic",
    fields: { Front: "", Back: "", Text: "", Extra: "" },
    tags: ""
  };

  const deckSelect = el("select", {},
    ...decks.map(d => el("option", { value: d.id }, d.name))
  );
  if (state.deckId) deckSelect.value = state.deckId;
  deckSelect.addEventListener("change", () => { state.deckId = deckSelect.value; });

  const typeSelect = el("select", {},
    ...NOTE_TYPES.map(t => el("option", { value: t.key }, t.name))
  );
  typeSelect.addEventListener("change", () => {
    state.noteType = typeSelect.value;
    redrawFields();
  });

  const fieldsWrap = el("div", { class: "vstack" });
  const tagsInput = el("input", { type: "text", placeholder: "Tags (space-separated)" });
  tagsInput.addEventListener("input", () => { state.tags = tagsInput.value; });

  function redrawFields() {
    fieldsWrap.innerHTML = "";
    const nt = NOTE_TYPES.find(x => x.key === state.noteType);
    for (const f of nt.fields) {
      const isTextArea = ["Text", "Extra", "Back"].includes(f);
      const input = isTextArea
        ? el("textarea", { placeholder: f })
        : el("input", { type: "text", placeholder: f });

      input.addEventListener("input", () => { state.fields[f] = input.value; });

      const wrapper = el("div", { class: "field" },
        el("label", {}, f),
        input
      );

      if (state.noteType === "cloze" && f === "Text") {
        wrapper.appendChild(el("div", { class: "small" }, "Format: {{c1::answer}} or {{c1::answer::hint}}"));
      }

      fieldsWrap.appendChild(wrapper);
    }
  }

  redrawFields();

  const content = el("div", { class: "vstack" },
    el("div", { class: "card" },
      el("div", { class: "spread" },
        el("div", { style: "font-weight:800; font-size:16px;" }, "Add Note"),
        el("button", { class: "btn secondary", type: "button", onclick: () => history.back() }, "Back")
      ),
      el("div", { class: "vstack" },
        el("div", { class: "field" }, el("label", {}, "Deck"), deckSelect),
        el("div", { class: "field" }, el("label", {}, "Type"), typeSelect),
        el("div", { class: "field" }, el("label", {}, "Tags"), tagsInput)
      )
    ),
    el("div", { class: "card" }, fieldsWrap),
    el("button", { class: "btn primary full", type: "button", onclick: onSave }, "Save")
  );

  layout("Add", "add", content);

  async function onSave() {
    if (!state.deckId) {
      toast("No deck selected");
      return;
    }

    const nt = NOTE_TYPES.find(x => x.key === state.noteType);
    const fields = {};
    for (const f of nt.fields) {
      fields[f] = state.fields[f] || "";
    }

    if (!fields.Front?.trim() && !fields.Text?.trim()) {
      toast("Content required");
      return;
    }

    const note = {
      id: uid(),
      deckId: state.deckId,
      noteType: state.noteType,
      fields,
      tags: state.tags.split(/\s+/).map(s => s.trim()).filter(Boolean),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const cardsTpl = templatesForNote(note.noteType, note.fields);
    const now = Date.now();
    const cards = cardsTpl.map(tpl => ({
      id: uid(),
      noteId: note.id,
      deckId: note.deckId,
      templateKey: tpl.templateKey,
      state: "new",
      dueMs: now,
      intervalDays: 0,
      ease: Number(App.settings.startingEase ?? 2.5),
      reps: 0,
      lapses: 0,
      stepIndex: 0,
      buriedUntilMs: 0
    }));

    try {
      await new Promise((resolve, reject) => {
        const t = App.db.transaction(["notes", "cards"], "readwrite");
        t.onerror = () => reject(t.error);
        t.oncomplete = () => resolve();
        const cs = t.objectStore("cards");
        t.objectStore("notes").put(note);
        for (const c of cards) cs.put(c);
      });
    } catch (e) {
      console.error("Save note error:", e);
      toast("Error saving");
      return;
    }

    toast("Saved");
    setRoute(`#/deck/${state.deckId}`);
  }
}

/* ==================== PAGE: BROWSE ==================== */
async function renderBrowse() {
  const q = { text: "" };
  const input = el("input", { type: "text", placeholder: "Search (deck:NAME tag:TAG words)" });
  const list = el("ul", { class: "list", style: "margin-top:12px;" });

  input.addEventListener("input", async () => {
    q.text = input.value;
    await doSearch();
  });

  async function doSearch() {
    list.innerHTML = "";
    const query = (q.text || "").trim();

    const tokens = query.split(/\s+/).filter(Boolean);
    let deckFilter = null;
    let tagFilter = null;
    const free = [];

    for (const t of tokens) {
      if (t.startsWith("deck:")) deckFilter = t.slice(5);
      else if (t.startsWith("tag:")) tagFilter = t.slice(4);
      else free.push(t);
    }

    const decks = await listDecks(App.db);
    const deckMatch = deckFilter
      ? decks.find(d => d.name.toLowerCase().includes(deckFilter.toLowerCase()))
      : null;

    const notes = await getAllNotes(App.db);
    const filtered = notes
      .filter(n => {
        if (deckMatch && n.deckId !== deckMatch.id) return false;
        if (tagFilter && !(n.tags || []).some(x => x.toLowerCase() === tagFilter.toLowerCase())) return false;
        if (free.length) {
          const blob = JSON.stringify(n.fields || {}).toLowerCase();
          for (const f of free) if (!blob.includes(f.toLowerCase())) return false;
        }
        return true;
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 100);

    if (!filtered.length) {
      list.appendChild(
        el("li", { class: "row" },
          el("div", {},
            el("div", { class: "row-title" }, "No results")
          )
        )
      );
      return;
    }

    for (const n of filtered) {
      const d = decks.find(x => x.id === n.deckId);
      const title = n.noteType === "cloze"
        ? (String(n.fields?.Text || "").slice(0, 60) || "(empty)")
        : (String(n.fields?.Front || "").slice(0, 60) || "(empty)");

      list.appendChild(
        el("li", { class: "row", role: "button", tabindex: "0",
          onclick: () => openEdit(n.id),
          onkeydown: (e) => { if (e.key === "Enter") openEdit(n.id); }
        },
          el("div", {},
            el("div", { class: "row-title" }, title.replace(/\s+/g, " ")),
            el("div", { class: "row-sub" }, `${d?.name} • ${n.noteType} • ${(n.tags || []).slice(0, 2).join(" ")}`)
          ),
          el("div", { class: "badge" }, "Edit")
        )
      );
    }
  }

  async function openEdit(noteId) {
    const note = await reqToPromise(App.db.transaction(["notes"], "readonly").objectStore("notes").get(noteId));
    if (!note) {
      toast("Note not found");
      return;
    }

    const nt = NOTE_TYPES.find(x => x.key === note.noteType);
    const fieldNodes = {};

    const wrap = el("div", { class: "vstack" });

    wrap.appendChild(el("div", { class: "card" },
      el("div", { class: "spread" },
        el("div", { style: "font-weight:800; font-size:16px;" }, "Edit Note"),
        el("button", { class: "btn secondary", type: "button", onclick: () => setRoute("#/browse") }, "Close")
      )
    ));

    const cardDiv = el("div", { class: "card" });

    for (const f of nt.fields) {
      const isTextArea = ["Text", "Extra", "Back"].includes(f);
      const input = isTextArea
        ? el("textarea", {}, note.fields?.[f] || "")
        : el("input", { type: "text", value: note.fields?.[f] || "" });

      fieldNodes[f] = input;

      cardDiv.appendChild(el("div", { class: "field" },
        el("label", {}, f),
        input
      ));
    }

    const tags = el("input", { type: "text", value: (note.tags || []).join(" "), placeholder: "Tags" });
    cardDiv.appendChild(el("div", { class: "field" }, el("label", {}, "Tags"), tags));

    wrap.appendChild(cardDiv);

    wrap.appendChild(
      el("button", { class: "btn primary full", type: "button", onclick: async () => {
        const newFields = {};
        for (const f of nt.fields) newFields[f] = fieldNodes[f].value;
        const newTags = tags.value.split(/\s+/).map(s => s.trim()).filter(Boolean);

        const newTpl = templatesForNote(note.noteType, newFields);
        const existingCards = await reqToPromise(
          App.db.transaction(["cards"], "readonly").objectStore("cards").index("byNote").getAll(note.id)
        );

        const byKey = new Map(existingCards.map(c => [c.templateKey, c]));
        const create = [];
        for (const t of newTpl) {
          if (!byKey.has(t.templateKey)) {
            create.push({
              id: uid(),
              noteId: note.id,
              deckId: note.deckId,
              templateKey: t.templateKey,
              state: "new",
              dueMs: Date.now(),
              intervalDays: 0,
              ease: Number(App.settings.startingEase ?? 2.5),
              reps: 0,
              lapses: 0,
              stepIndex: 0,
              buriedUntilMs: 0
            });
          }
        }

        const newKeys = new Set(newTpl.map(x => x.templateKey));
        const removed = existingCards.filter(c => !newKeys.has(c.templateKey));

        if (removed.length > 0) {
          const ok = confirm(`${removed.length} cards will be deleted. Continue?`);
          if (!ok) return;
        }

        note.fields = newFields;
        note.tags = newTags;
        note.updatedAt = Date.now();

        try {
          await new Promise((resolve, reject) => {
            const t = App.db.transaction(["notes", "cards"], "readwrite");
            t.onerror = () => reject(t.error);
            t.oncomplete = () => resolve();
            t.objectStore("notes").put(note);
            const cs = t.objectStore("cards");
            for (const c of create) cs.put(c);
            for (const r of removed) cs.delete(r.id);
          });
        } catch (e) {
          console.error("Edit note error:", e);
          toast("Error saving");
          return;
        }

        toast("Saved");
        await render();
        setRoute("#/browse");
      }}, "Save Changes")
    );

    layout("Browse", "browse", wrap);
  }

  const content = el("div", { class: "vstack" },
    el("div", { class: "card" },
      el("div", { style: "font-weight:800; font-size:16px;" }, "Browse / Search"),
      input,
      el("div", { class: "small" }, "Filters: deck:NAME tag:NAME, or type to search content")
    ),
    list
  );

  layout("Browse", "browse", content);
  await doSearch();
}

/* ==================== PAGE: REVIEW ==================== */
async function renderReview(deckId) {
  const deck = await getDeck(App.db, deckId);
  if (!deck) {
    setRoute("#/decks");
    return;
  }

  const queue = await buildStudyQueue(App.db, deckId, App.settings);
  if (!queue.length) {
    layout("Review", "decks", el("div", { class: "card vstack" },
      el("div", { style: "font-weight:800; font-size:18px;" }, "All done! 🎉"),
      el("div", { class: "small" }, "No due cards today"),
      el("button", { class: "btn full", type: "button", onclick: () => setRoute(`#/deck/${deckId}`) }, "Back")
    ));
    return;
  }

  App.review = { deckId, queue, currentIndex: 0, showingBack: false };

  const cardNode = el("div", {
    class: "review-card",
    role: "button",
    tabindex: "0"
  });

  const answerBar = el("div", { class: "answer-bar" });

  const btnAgain = el("button", { class: "btn again", type: "button", onclick: () => answer(Rating.AGAIN) }, "Again");
  const btnHard = el("button", { class: "btn hard", type: "button", onclick: () => answer(Rating.HARD) }, "Hard");
  const btnGood = el("button", { class: "btn good", type: "button", onclick: () => answer(Rating.GOOD) }, "Good");
  const btnEasy = el("button", { class: "btn easy", type: "button", onclick: () => answer(Rating.EASY) }, "Easy");

  answerBar.append(btnAgain, btnHard, btnGood, btnEasy);

  const shell = el("div", { class: "review-shell" },
    el("div", { class: "card" },
      el("div", { class: "spread" },
        el("div", {},
          el("div", { style: "font-weight:800;" }, deck.name),
          el("div", { class: "small" }, `${App.review.queue.length} left • Tap to flip`)
        ),
        el("button", { class: "btn secondary", type: "button", onclick: () => setRoute(`#/deck/${deckId}`) }, "Exit")
      )
    ),
    cardNode,
    answerBar
  );

  layout("Review", "decks", shell);

  cardNode.addEventListener("click", () => {
    App.review.showingBack = !App.review.showingBack;
    void draw();
  });

  cardNode.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      App.review.showingBack = !App.review.showingBack;
      void draw();
    }
  });

  let startX = 0;
  cardNode.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
  });

  cardNode.addEventListener("pointerup", async (e) => {
    const dx = e.clientX - startX;
    if (Math.abs(dx) < 80) return;

    if (!App.review.showingBack) {
      App.review.showingBack = true;
      await draw();
      if (navigator.vibrate) navigator.vibrate(10);
      return;
    }

    if (dx < 0) await answer(Rating.GOOD);
    else await answer(Rating.EASY);
    if (navigator.vibrate) navigator.vibrate(10);
  });

  async function draw() {
    const cardId = App.review.queue[App.review.currentIndex];
    const card = await reqToPromise(App.db.transaction(["cards"], "readonly").objectStore("cards").get(cardId));
    if (!card) {
      toast("Card not found");
      return;
    }

    const note = await reqToPromise(App.db.transaction(["notes"], "readonly").objectStore("notes").get(card.noteId));
    if (!note) {
      toast("Note not found");
      return;
    }

    const tpl = templatesForNote(note.noteType, note.fields).find(t => t.templateKey === card.templateKey);
    if (!tpl) {
      toast("Template not found");
      return;
    }

    const front = tpl.frontHtml || "(empty)";
    const back = tpl.backHtml || "(empty)";
    const extra = (note.noteType === "cloze" && (note.fields?.Extra || "").trim())
      ? `<div style="margin-top:12px; border-top:1px solid var(--border); padding-top:12px;">${h(note.fields.Extra)}</div>`
      : "";

    const content = App.review.showingBack
      ? `<div class="review-card-content">${back}</div>${extra}`
      : `<div class="review-card-content">${front}</div>`;

    const footer = `<div class="small" style="margin-top:12px;">${App.review.queue.length - App.review.currentIndex} left</div>`;

    cardNode.innerHTML = content + footer;
  }

  async function answer(rating) {
    if (!App.review.showingBack) {
      App.review.showingBack = true;
      await draw();
      return;
    }

    const cardId = App.review.queue[App.review.currentIndex];
    const card = await reqToPromise(App.db.transaction(["cards"], "readonly").objectStore("cards").get(cardId));
    if (!card) return;

    const { before, after } = calculateNext(card, rating, App.settings);

    try {
      await new Promise((resolve, reject) => {
        const t = App.db.transaction(["cards", "revlog"], "readwrite");
        t.onerror = () => reject(t.error);
        t.oncomplete = () => resolve();
        t.objectStore("cards").put(after);
        t.objectStore("revlog").put({
          id: uid(),
          cardId: after.id,
          timeMs: Date.now(),
          rating,
          before,
          after
        });
      });
    } catch (e) {
      console.error("Answer error:", e);
      toast("Error saving answer");
      return;
    }

    if (App.settings.burySiblings) {
      try {
        const siblings = await reqToPromise(
          App.db.transaction(["cards"], "readonly").objectStore("cards").index("byNote").getAll(card.noteId)
        );
        const buryUntil = startOfTomorrowMs();
        await new Promise((resolve, reject) => {
          const t = App.db.transaction(["cards"], "readwrite");
          t.onerror = () => reject(t.error);
          t.oncomplete = () => resolve();
          const cs = t.objectStore("cards");
          for (const s of siblings) {
            if (s.id === after.id) continue;
            s.buriedUntilMs = buryUntil;
            cs.put(s);
          }
        });
      } catch (e) {
        console.warn("Bury error:", e);
      }
    }

    App.review.currentIndex += 1;
    App.review.showingBack = false;

    if (App.review.currentIndex >= App.review.queue.length) {
      toast("Session complete!");
      setTimeout(() => setRoute(`#/deck/${deckId}`), 500);
      return;
    }

    await draw();
  }

  await draw();
}

/* ==================== PAGE: SETTINGS ==================== */
async function renderSettings() {
  const s = App.settings;

  const darkModeSelect = el("select", {},
    el("option", { value: "system" }, "System"),
    el("option", { value: "light" }, "Light"),
    el("option", { value: "dark" }, "Dark")
  );
  darkModeSelect.value = s.darkMode ?? "system";

  const newPerDay = el("input", { type: "number", value: String(s.newPerDay), min: "0", max: "9999" });
  const reviewsPerDay = el("input", { type: "number", value: String(s.reviewsPerDay), min: "0", max: "99999" });
  const steps = el("input", { type: "text", value: String(s.learningSteps), placeholder: "10m,1d" });
  const grad = el("input", { type: "number", value: String(s.graduatingIntervalDays), min: "1" });
  const easyI = el("input", { type: "number", value: String(s.easyIntervalDays), min: "1" });

  const bury = el("select", {},
    el("option", { value: "true" }, "On"),
    el("option", { value: "false" }, "Off")
  );
  bury.value = String(!!s.burySiblings);

  const content = el("div", { class: "vstack" },
    el("div", { class: "card" },
      el("div", { style: "font-weight:800; font-size:16px;" }, "Settings"),
      el("div", { class: "vstack" },
        el("div", { class: "field" }, el("label", {}, "Theme"), darkModeSelect),
        el("div", { class: "field" }, el("label", {}, "New/day"), newPerDay),
        el("div", { class: "field" }, el("label", {}, "Reviews/day"), reviewsPerDay),
        el("div", { class: "field" }, el("label", {}, "Learning steps"), steps),
        el("div", { class: "field" }, el("label", {}, "Graduating interval (days)"), grad),
        el("div", { class: "field" }, el("label", {}, "Easy interval (days)"), easyI),
        el("div", { class: "field" }, el("label", {}, "Bury siblings"), bury)
      ),
      el("button", { class: "btn primary full", type: "button", onclick: async () => {
        const patch = {
          newPerDay: clamp(Number(newPerDay.value) || 0, 0, 9999),
          reviewsPerDay: clamp(Number(reviewsPerDay.value) || 0, 0, 99999),
          learningSteps: steps.value.trim() || "10m,1d",
          graduatingIntervalDays: clamp(Number(grad.value) || 1, 1, 36500),
          easyIntervalDays: clamp(Number(easyI.value) || 4, 1, 36500),
          burySiblings: bury.value === "true",
          darkMode: darkModeSelect.value
        };
        await saveSettings(App.db, patch);
        App.settings = await loadSettings(App.db);
        applyTheme(App.settings.darkMode);
        toast("Settings saved");
        await render();
      }}, "Save Settings")
    ),
    el("div", { class: "card" },
      el("div", { style: "font-weight:800; font-size:16px;" }, "Tools"),
      el("button", { class: "btn full", type: "button", onclick: async () => {
        const checks = runSelfChecks();
        alert(checks.join("\n"));
      }}, "Run Self-Checks"),
      el("button", { class: "btn danger full", type: "button", onclick: async () => {
        const ok = confirm("Reset all data? This cannot be undone.");
        if (!ok) return;
        try {
          await new Promise((resolve, reject) => {
            const t = App.db.transaction(["decks", "notes", "cards", "revlog", "kv"], "readwrite");
            t.onerror = () => reject(t.error);
            t.oncomplete = () => resolve();
            for (const s of ["decks", "notes", "cards", "revlog", "kv"]) {
              t.objectStore(s).clear();
            }
          });
          await ensureSeed(App.db);
          App.settings = await loadSettings(App.db);
          applyTheme(App.settings.darkMode);
          toast("Reset complete");
          setRoute("#/decks");
        } catch (e) {
          console.error("Reset error:", e);
          toast("Error resetting");
        }
      }}, "Reset All Data"),
      el("div", { class: "small" }, "All data is stored locally in your browser.")
    )
  );

  layout("Settings", "settings", content);
}

function runSelfChecks() {
  const out = [];
  try {
    const m = extractCloze("Text {{c1::answer}} and {{c2::other::hint}}");
    out.push(m.has(1) && m.has(2) ? "✓ Cloze parsing" : "✗ Cloze parsing");

    const tpl = templatesForNote("basic", { Front: "Q", Back: "A" });
    out.push(tpl.length === 1 ? "✓ Basic templates" : "✗ Basic templates");

    const card = { id: "test", state: "new", dueMs: Date.now(), intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, stepIndex: 0 };
    const result = calculateNext(card, Rating.GOOD, DEFAULTS);
    out.push(result.after.state === "learning" ? "✓ Scheduler" : "✗ Scheduler");

    out.push("✓ All checks passed!");
  } catch (e) {
    out.push(`✗ Error: ${e.message}`);
  }
  return out;
}

/* ==================== ROUTER ==================== */
async function render() {
  try {
    const [route, a, b] = currentRoute();

    if (route === "decks") return await renderDecks();
    if (route === "deck" && a) return await renderDeckDetail(a);
    if (route === "add" && a) return await renderAdd(a);
    if (route === "add") return await renderAdd(null);
    if (route === "browse") return await renderBrowse();
    if (route === "settings") return await renderSettings();
    if (route === "review" && a) return await renderReview(a);

    setRoute("#/decks");
  } catch (e) {
    console.error("Render error:", e);
    toast("Error: " + e.message);
  }
}

/* ==================== BOOT ==================== */
async function boot() {
  try {
    App.db = await openDB();
    await ensureSeed(App.db);
    App.settings = await loadSettings(App.db);

    applyTheme(App.settings.darkMode ?? "system");

    window.addEventListener("hashchange", () => { void render(); });

    if (!location.hash) setRoute("#/decks");
    await render();
  } catch (e) {
    console.error("Boot error:", e);
    document.body.innerHTML = `<pre style="padding:20px; color:red;">Fatal Error:\n${e.message}\n\nRefresh the page.</pre>`;
  }
}

// Start
boot();
