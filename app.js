/* EDAIC Antigravity MCQ — client logic.
 * Local build: data comes from data/questions_data.js (window.FRCA_DATA) and works from file://.
 * Web build:   unlock.js decrypts the data and calls window.FRCA_BOOT(data).
 */
(function () {
  "use strict";

  function boot(DATA) {
  var STORE_KEY = "edaic-antigravity-mcq-v1";
  var PAGE_SIZE = 20;
  var LETTERS = ["a", "b", "c", "d", "e"];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ------------------------------------------------------------------ data
  var QS = DATA.questions;
  var CHAPTERS = DATA.chapters;
  var BY_ID = {};
  QS.forEach(function (q, i) {
    q.ord = i + 1;
    BY_ID[q.id] = q;
    q.search = (q.stem + " \n " + q.statements.join(" \n ") + " \n " + explanationText(q)).toLowerCase();
  });
  var CHAP_BY_NUM = {};
  CHAPTERS.forEach(function (c) { CHAP_BY_NUM[c.num] = c; });

  function explanationText(q) {
    return q.explanation.map(function (b) {
      if (b.type === "p") return b.text;
      if (b.type === "eq") return b.lines.join(" ");
      if (b.type === "table") return (b.caption || "") + " " + b.rows.map(function (r) { return r.join(" "); }).join(" ");
      return "";
    }).join(" ");
  }

  // ------------------------------------------------------------------ state
  var DEFAULT_SETTINGS = {
    theme: document.documentElement.getAttribute("data-theme") || "light",
    feedback: "instant",
    view: "focus",
    chapter: "all",
    filter: "all",
    search: "",
    current: null,
    page: 1
  };
  var storageOK = true;
  var lastSaved = null;
  var state = load();
  var openExpl = {};   // question ids with explanation shown (session only)
  var pinned = {};     // ids kept visible in the current list after an interaction

  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
    catch (e) { storageOK = false; }
    s = s && typeof s === "object" ? s : {};
    return {
      answers: s.answers && typeof s.answers === "object" ? s.answers : {},
      bookmarks: s.bookmarks && typeof s.bookmarks === "object" ? s.bookmarks : {},
      settings: Object.assign({}, DEFAULT_SETTINGS, s.settings || {})
    };
  }

  var saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    if (now) return doSave();
    saveTimer = setTimeout(doSave, 150);
  }
  function doSave() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        version: 1, answers: state.answers, bookmarks: state.bookmarks, settings: state.settings
      }));
      storageOK = true;
      lastSaved = new Date();
    } catch (e) {
      storageOK = false;
    }
    renderSaveInd();
    return storageOK;
  }

  // ------------------------------------------------------------------ question status
  function rec(id) { return state.answers[id] || null; }

  function getRec(id) {
    var r = state.answers[id];
    if (!r) {
      r = state.answers[id] = { sel: [null, null, null, null, null], ev: [false, false, false, false, false], checked: false };
    }
    return r;
  }

  function info(q) {
    var r = rec(q.id);
    var res = { score: 0, evaluated: 0, done: false, answered: 0, status: "new", correct: 0 };
    if (!r) return res;
    for (var i = 0; i < 5; i++) {
      if (r.sel[i] !== null) res.answered++;
      if (r.ev[i]) {
        res.evaluated++;
        if (r.sel[i] !== null && (r.sel[i] === "T") === q.answers[i]) res.correct++;
      }
    }
    res.score = res.correct;
    res.done = !!r.checked || res.evaluated === 5;
    if (res.done) res.status = res.score >= 4 ? "good" : "bad";
    else if (res.answered || res.evaluated) res.status = "started";
    return res;
  }

  var FILTERS = [
    { id: "all", label: "Все", test: function () { return true; } },
    { id: "unanswered", label: "Неотвеченные", test: function (q, s) { return !s.done; } },
    { id: "review", label: "Повторить ≤ 3/5", test: function (q, s) { return s.done && s.score <= 3; } },
    { id: "errors", label: "С ошибками", test: function (q, s) { return s.done && s.score < 5; } },
    { id: "perfect", label: "Идеально 5/5", test: function (q, s) { return s.done && s.score === 5; } },
    { id: "bookmarks", label: "★ Закладки", test: function (q) { return !!state.bookmarks[q.id]; } }
  ];
  function filterById(id) { return FILTERS.filter(function (f) { return f.id === id; })[0] || FILTERS[0]; }

  function inChapter(q) {
    var c = state.settings.chapter;
    return c === "all" || q.chapter === Number(c);
  }

  function searchQuery() {
    var s = (state.settings.search || "").trim().toLowerCase();
    if (!s) return null;
    var m = s.match(/^(\d+)\s*[.\-]\s*(\d+)$/);
    if (m) return { kind: "id", id: m[1] + "-" + m[2] };
    if (/^\d+$/.test(s)) return { kind: "num", num: Number(s) };
    return { kind: "text", text: s };
  }
  function matchesSearch(q, sq) {
    if (!sq) return true;
    if (sq.kind === "id") return q.id === sq.id;
    if (sq.kind === "num") return q.num === sq.num;
    return q.search.indexOf(sq.text) !== -1;
  }

  function currentList() {
    var f = filterById(state.settings.filter);
    var sq = searchQuery();
    return QS.filter(function (q) {
      if (!inChapter(q) || !matchesSearch(q, sq)) return false;
      return pinned[q.id] || f.test(q, info(q));
    });
  }

  function chapterTitle(num) { var c = CHAP_BY_NUM[num]; return c ? c.title : ""; }

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hl(text) {
    var out = esc(text);
    var sq = searchQuery();
    if (!sq || sq.kind !== "text" || sq.text.length < 2) return out;
    var needle = esc(sq.text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try { return out.replace(new RegExp("(" + needle + ")", "gi"), "<mark>$1</mark>"); }
    catch (e) { return out; }
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "—"; }
  function qLabel(q) { return q.chapter + "." + q.num; }

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  // ------------------------------------------------------------------ aggregate stats
  function aggregate(qs) {
    var a = { total: qs.length, done: 0, perfect: 0, low: 0, scoreSum: 0, evaluated: 0, correct: 0 };
    qs.forEach(function (q) {
      var s = info(q);
      a.evaluated += s.evaluated;
      a.correct += s.correct;
      if (s.done) {
        a.done++;
        a.scoreSum += s.score;
        if (s.score === 5) a.perfect++;
        if (s.score <= 3) a.low++;
      }
    });
    return a;
  }

  // ------------------------------------------------------------------ render: header
  function renderHeader() {
    var a = aggregate(QS);
    $("#hdrDone").textContent = a.done;
    $("#hdrTotal").textContent = a.total;
    $("#hdrBar").style.width = (a.total ? (a.done / a.total) * 100 : 0) + "%";
    $("#hdrAcc").textContent = pct(a.correct, a.evaluated);
    $("#hdrAvg").textContent = a.done ? (a.scoreSum / a.done).toFixed(2) : "—";
    $$("[data-feedback]").forEach(function (b) { b.classList.toggle("active", b.dataset.feedback === state.settings.feedback); });
    $$("[data-view]").forEach(function (b) { b.classList.toggle("active", b.dataset.view === state.settings.view); });
  }

  function renderSaveInd() {
    var el = $("#saveInd");
    if (!storageOK) {
      el.textContent = "⚠ localStorage недоступен — используйте экспорт";
      el.style.color = "var(--bad)";
    } else if (lastSaved) {
      el.textContent = "✓ Сохранено " + lastSaved.toLocaleTimeString("ru-RU");
      el.style.color = "";
    }
  }

  // ------------------------------------------------------------------ render: sidebar
  function renderSidebar() {
    var st = state.settings;
    // chapters
    var html = "";
    var all = aggregate(QS);
    html += chapBtn("all", "Все главы (" + QS.length + ")", all);
    CHAPTERS.forEach(function (c) {
      var a = aggregate(QS.filter(function (q) { return q.chapter === c.num; }));
      html += chapBtn(String(c.num), c.num + ". " + c.title + " (" + c.count + ")", a);
    });
    $("#chapterList").innerHTML = html;

    function chapBtn(val, label, a) {
      var w = a.total ? (a.done / a.total) * 100 : 0;
      return '<button class="chap-btn' + (String(st.chapter) === val ? " active" : "") + '" data-chapter="' + val + '">' +
        "<span>" + esc(label) + '</span><span class="cnt">' + a.done + "/" + a.total + "</span>" +
        '<span class="mini-bar"><i style="width:' + w.toFixed(1) + '%"></i></span></button>';
    }

    // filters (counted within the selected chapter)
    var scope = QS.filter(inChapter);
    var infos = scope.map(function (q) { return [q, info(q)]; });
    $("#filterList").innerHTML = FILTERS.map(function (f) {
      var n = infos.filter(function (p) { return f.test(p[0], p[1]); }).length;
      return '<button class="filter-btn' + (st.filter === f.id ? " active" : "") + '" data-filter="' + f.id + '">' +
        "<span>" + esc(f.label) + '</span><span class="cnt">' + n + "</span></button>";
    }).join("");

    var si = $("#searchInput");
    if (document.activeElement !== si) si.value = st.search || "";

    renderMap();
  }

  function renderMap() {
    var list = currentList();
    var cur = currentQuestion(list);
    var html = "";
    var lastChap = null;
    var multi = state.settings.chapter === "all";
    list.forEach(function (q) {
      if (multi && q.chapter !== lastChap) {
        lastChap = q.chapter;
        html += '<div class="map-more">Глава ' + q.chapter + " · " + esc(chapterTitle(q.chapter)) + "</div>";
      }
      var s = info(q);
      var cls = "tile " + (s.status !== "new" ? s.status : "") + (state.bookmarks[q.id] ? " bm" : "") +
        (cur && cur.id === q.id && state.settings.view === "focus" ? " current" : "");
      var title = "Глава " + q.chapter + ", вопрос " + q.num + (s.done ? " — " + s.score + "/5" : s.status === "started" ? " — начат" : "");
      html += '<button class="' + cls + '" data-goto="' + q.id + '" title="' + esc(title) + '">' + q.num + "</button>";
    });
    if (!list.length) html = '<div class="map-more">Нет вопросов для текущего фильтра</div>';
    $("#qmap").innerHTML = html;
    $("#mapCount").textContent = "(" + list.length + ")";
  }

  // ------------------------------------------------------------------ render: main
  function currentQuestion(list) {
    list = list || currentList();
    if (!list.length) return null;
    var id = state.settings.current;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  function renderMain() {
    var st = state.settings;
    var list = currentList();
    var content = $("#content");
    var f = filterById(st.filter);
    var crumb = (st.chapter === "all" ? "Все главы" : "Глава " + st.chapter + " · " + chapterTitle(Number(st.chapter))) +
      " · " + f.label + (st.search ? " · поиск «" + st.search + "»" : "") + " · " + list.length + " вопр.";
    $("#crumb").textContent = crumb;

    if (!list.length) {
      content.innerHTML = '<div class="empty"><b>Здесь пока пусто</b>Измените главу, фильтр или поисковый запрос.</div>';
      $("#focusNav").hidden = true;
      $("#pager").innerHTML = "";
      return;
    }

    if (st.view === "focus") {
      var q = currentQuestion(list);
      st.current = q.id;
      var idx = list.indexOf(q);
      content.innerHTML = cardHTML(q);
      $("#focusNav").hidden = false;
      $("#btnPrev").disabled = idx <= 0;
      $("#btnNext").disabled = idx >= list.length - 1;
      $("#navPos").textContent = "Вопрос " + (idx + 1) + " из " + list.length;
      $("#pager").innerHTML = "";
    } else {
      var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      st.page = Math.min(Math.max(1, st.page || 1), pages);
      var start = (st.page - 1) * PAGE_SIZE;
      content.innerHTML = list.slice(start, start + PAGE_SIZE).map(cardHTML).join("");
      $("#focusNav").hidden = true;
      renderPager(pages);
    }
  }

  function renderPager(pages) {
    var p = state.settings.page;
    if (pages <= 1) { $("#pager").innerHTML = ""; return; }
    var nums = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - p) <= 2) nums.push(i);
      else if (nums[nums.length - 1] !== "…") nums.push("…");
    }
    var html = '<button class="btn" data-page="' + (p - 1) + '"' + (p <= 1 ? " disabled" : "") + ">←</button>";
    nums.forEach(function (n) {
      html += n === "…" ? '<span class="gap">…</span>'
        : '<button class="btn' + (n === p ? " primary" : "") + '" data-page="' + n + '">' + n + "</button>";
    });
    html += '<button class="btn" data-page="' + (p + 1) + '"' + (p >= pages ? " disabled" : "") + ">→</button>";
    $("#pager").innerHTML = html;
  }

  function cardHTML(q) {
    var r = rec(q.id);
    var s = info(q);
    var exam = state.settings.feedback === "exam";
    var showExpl = !!openExpl[q.id];
    var bm = !!state.bookmarks[q.id];

    var h = '<article class="qcard" data-id="' + q.id + '">';
    h += '<div class="qhead"><span class="qid">Q ' + qLabel(q) + "</span>" +
      '<span class="qchap">Глава ' + q.chapter + " · " + esc(chapterTitle(q.chapter)) + " · вопрос " + q.num + "</span>" +
      '<span class="score ' + (s.status !== "new" ? s.status : "") + '" title="Баллы за вопрос">' + s.score + " / 5</span></div>";
    h += '<div class="qstem">' + hl(q.stem) + "</div>";
    h += '<div class="stmts">';
    for (var i = 0; i < 5; i++) {
      var sel = r ? r.sel[i] : null;
      var ev = r ? r.ev[i] : false;
      var key = q.answers[i] ? "T" : "F";
      var keyWord = q.answers[i] ? "TRUE" : "FALSE";
      var cls = "stmt", fb = "";
      if (ev) {
        if (sel === key) { cls += " ok"; fb = "✓ Верно"; }
        else if (sel === null) { cls += " no"; fb = "— Нет ответа · Правильно: " + keyWord; }
        else { cls += " no"; fb = "✗ Ошибка · Правильно: " + keyWord; }
      } else if (showExpl) {
        cls += " reveal"; fb = "Правильно: " + keyWord;
      }
      var locked = ev || (exam && r && r.checked);
      var showKey = ev || showExpl;
      h += '<div class="' + cls + '" data-i="' + i + '">' +
        '<span class="lbl">' + LETTERS[i] + "</span>" +
        '<div class="txt">' + hl(q.statements[i]) + "</div>" +
        '<div class="tf">' +
        tfBtn("T", "TRUE", sel, locked, showKey && key === "T") +
        tfBtn("F", "FALSE", sel, locked, showKey && key === "F") +
        "</div>" + (fb ? '<div class="fb">' + fb + "</div>" : "") + "</div>";
    }
    h += "</div>";

    h += '<div class="qactions">';
    if (exam && !(r && r.checked) && s.evaluated < 5) {
      h += '<button class="btn primary" data-act="check"' + (s.answered ? "" : " disabled") + ">✓ Проверить ответ</button>";
    }
    h += '<button class="btn" data-act="expl">' + (showExpl ? "📖 Скрыть объяснение" : "📖 Показать ответы и разбор") + "</button>";
    h += '<span class="spacer"></span>';
    h += '<button class="btn' + (bm ? " bm-on" : "") + '" data-act="bm" title="Клавиша B">' + (bm ? "★ В закладках" : "★ В закладки") + "</button>";
    h += '<button class="btn" data-act="reset"' + (r ? "" : " disabled") + ">↺ Сбросить</button>";
    h += "</div>";

    if (showExpl) h += explHTML(q);
    h += "</article>";
    return h;
  }

  function tfBtn(v, label, sel, locked, isKey) {
    return '<button data-act="ans" data-v="' + v + '" class="' + (sel === v ? "sel" : "") + (isKey ? " key" : "") + '"' +
      (locked ? " disabled" : "") + ' aria-pressed="' + (sel === v) + '">' + label + "</button>";
  }

  function explHTML(q) {
    var h = '<section class="expl"><div class="expl-key">Ответ:';
    for (var i = 0; i < 5; i++) {
      h += '<span class="keychip ' + (q.answers[i] ? "t" : "f") + '">' + LETTERS[i] + " " + (q.answers[i] ? "T" : "F") + "</span>";
    }
    h += "</div>";
    var figs = q.figures.slice();
    var placed = {};
    q.explanation.forEach(function (b) {
      if (b.type === "p") {
        h += "<p" + (/^•/.test(b.text) ? ' class="li"' : "") + ">" + hl(b.text) + "</p>";
        figs.forEach(function (f) {
          if (!placed[f.id] && b.text.indexOf("Figure " + f.id) !== -1) { placed[f.id] = true; h += figHTML(f); }
        });
      } else if (b.type === "eq") {
        h += '<pre class="eq">' + esc(b.lines.join("\n")) + "</pre>";
      } else if (b.type === "table") {
        h += '<div class="tbl-wrap"><table>' + (b.caption ? "<caption>" + esc(b.caption) + "</caption>" : "") +
          b.rows.map(function (row) {
            return "<tr>" + row.map(function (c) { return "<td>" + hl(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</table></div>";
      }
    });
    figs.forEach(function (f) { if (!placed[f.id]) h += figHTML(f); });
    h += "</section>";
    return h;
  }

  function figHTML(f) {
    return '<figure class="fig"><img src="' + esc(f.src) + '" alt="' + esc(f.caption) + '" data-lightbox="' +
      esc(f.src) + '" data-caption="' + esc(f.caption) + '" loading="lazy"><figcaption>🔍 Figure ' + esc(f.id) + " · нажмите, чтобы увеличить</figcaption></figure>";
  }

  function rerenderCard(id) {
    var el = document.querySelector('.qcard[data-id="' + id + '"]');
    if (!el) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = cardHTML(BY_ID[id]);
    el.parentNode.replaceChild(tmp.firstChild, el);
  }

  function renderAll() {
    renderHeader();
    renderSidebar();
    renderMain();
    syncTopbarHeight();
  }

  // after an answer-type change: card in place, header, sidebar
  function afterChange(id) {
    pinned[id] = true;
    save();
    rerenderCard(id);
    renderHeader();
    renderSidebar();
  }

  // ------------------------------------------------------------------ actions
  function answer(id, i, v) {
    var q = BY_ID[id];
    var r = getRec(id);
    if (r.ev[i]) return;
    if (state.settings.feedback === "exam") {
      if (r.checked) return;
      r.sel[i] = r.sel[i] === v ? null : v;
    } else {
      var wasDone = info(q).done;
      r.sel[i] = v;
      r.ev[i] = true;
      if (!wasDone && info(q).done) openExpl[id] = true; // all five answered → show explanation
    }
    afterChange(id);
  }

  function check(id) {
    var r = getRec(id);
    r.checked = true;
    r.ev = [true, true, true, true, true];
    openExpl[id] = true;
    afterChange(id);
  }

  function toggleExpl(id) {
    openExpl[id] = !openExpl[id];
    rerenderCard(id);
  }

  function toggleBookmark(id) {
    if (state.bookmarks[id]) delete state.bookmarks[id];
    else state.bookmarks[id] = true;
    toast(state.bookmarks[id] ? "★ Добавлено в закладки" : "Удалено из закладок");
    afterChange(id);
  }

  function resetQuestion(id) {
    delete state.answers[id];
    delete openExpl[id];
    afterChange(id);
  }

  function setSetting(key, val, opts) {
    state.settings[key] = val;
    if (!opts || !opts.keepPins) pinned = {};
    save();
  }

  function navigate(delta) {
    var list = currentList();
    if (state.settings.view === "list") {
      var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      var p = Math.min(Math.max(1, state.settings.page + delta), pages);
      if (p !== state.settings.page) gotoPage(p);
      return;
    }
    var q = currentQuestion(list);
    if (!q) return;
    var idx = list.indexOf(q) + delta;
    if (idx < 0 || idx >= list.length) return;
    pinned = {};
    state.settings.current = list[idx].id;
    save();
    renderSidebar();
    renderMain();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function gotoPage(p) {
    pinned = {};
    state.settings.page = p;
    save();
    renderSidebar();
    renderMain();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function showQuestion(id, opts) {
    var q = BY_ID[id];
    if (!q) return;
    var list = currentList();
    if (list.indexOf(q) === -1) {
      // make it visible: relax filter / search / chapter
      state.settings.filter = "all";
      state.settings.search = "";
      if (!inChapter(q)) state.settings.chapter = "all";
      pinned = {};
      list = currentList();
      if (opts && opts.notify) toast("Фильтры сброшены, чтобы показать вопрос " + qLabel(q));
    }
    state.settings.current = id;
    if (state.settings.view === "list") {
      state.settings.page = Math.floor(list.indexOf(q) / PAGE_SIZE) + 1;
    }
    save();
    renderSidebar();
    renderMain();
    var el = document.querySelector('.qcard[data-id="' + id + '"]');
    if (el) {
      if (state.settings.view === "list") el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0 });
    }
    closeSidebar();
  }

  function randomQuestion() {
    var list = currentList();
    if (!list.length) { toast("Нет вопросов для текущего фильтра"); return; }
    var cur = state.settings.current;
    var pool = list.length > 1 ? list.filter(function (q) { return q.id !== cur; }) : list;
    var q = pool[Math.floor(Math.random() * pool.length)];
    state.settings.view = "focus";
    showQuestion(q.id);
    renderHeader();
  }

  function jumpTo(raw) {
    var s = String(raw || "").trim();
    if (!s) return;
    var q = null, m;
    if ((m = s.match(/^(\d+)\s*[.\-]\s*(\d+)$/))) q = BY_ID[m[1] + "-" + m[2]];
    else if (/^\d+$/.test(s)) {
      var n = Number(s);
      if (state.settings.chapter !== "all") q = BY_ID[state.settings.chapter + "-" + n];
      else q = QS[n - 1] || null; // ordinal in the whole book (1–1000)
    }
    if (!q) { toast("Вопрос «" + s + "» не найден"); return; }
    showQuestion(q.id, { notify: true });
    $("#jumpInput").value = "";
  }

  // ------------------------------------------------------------------ modals
  function openModal(id) {
    if (id === "statsModal") renderStats();
    if (id === "abbrModal") renderAbbr();
    if (id === "dataModal") renderDataInfo();
    var m = document.getElementById(id);
    m.hidden = false;
    var focusEl = id === "abbrModal" ? $("#abbrSearch") : $("[data-close]", m);
    if (focusEl) setTimeout(function () { focusEl.focus(); }, 30);
  }
  function closeModals() {
    $$(".modal").forEach(function (m) { m.hidden = true; });
    $("#lightbox").hidden = true;
  }
  function anyModalOpen() {
    return $$(".modal").some(function (m) { return !m.hidden; }) || !$("#lightbox").hidden;
  }

  function renderStats() {
    var rows = "";
    CHAPTERS.forEach(function (c) {
      rows += statsRow(c.num + ". " + c.title, aggregate(QS.filter(function (q) { return q.chapter === c.num; })));
    });
    var total = aggregate(QS);
    $("#statsBody").innerHTML =
      '<table class="stats-table"><thead><tr><th>Глава</th><th>Завершено</th><th>Точность</th><th>Средний балл</th>' +
      "<th>5/5</th><th>≤ 3/5</th></tr></thead><tbody>" + rows + "</tbody><tfoot>" +
      statsRow("Итого", total, true) + "</tfoot></table>" +
      '<p class="muted small" style="margin-top:12px">Точность — доля верно отмеченных утверждений среди проверенных. ' +
      "Средний балл — по завершённым вопросам. Авторы книги советуют повторять вопросы с результатом 3/5 и ниже.</p>";

    function statsRow(name, a, isTotal) {
      var w = a.total ? (a.done / a.total) * 100 : 0;
      return (isTotal ? "<tr>" : "<tr>") + "<td>" + esc(name) + "</td>" +
        "<td>" + a.done + " / " + a.total + ' <span class="bar"><i style="width:' + w.toFixed(1) + '%"></i></span></td>' +
        "<td>" + pct(a.correct, a.evaluated) + "</td>" +
        "<td>" + (a.done ? (a.scoreSum / a.done).toFixed(2) : "—") + "</td>" +
        '<td class="c-ok">' + a.perfect + "</td>" +
        '<td class="c-bad">' + a.low + "</td></tr>";
    }
  }

  function renderAbbr() {
    var list = DATA.abbreviations || [];
    var s = ($("#abbrSearch").value || "").trim().toLowerCase();
    var items = s ? list.filter(function (a) {
      return a.abbr.toLowerCase().indexOf(s) !== -1 || a.def.toLowerCase().indexOf(s) !== -1;
    }) : list;
    // exact abbreviation matches first
    if (s) {
      items = items.slice().sort(function (x, y) {
        var ax = x.abbr.toLowerCase().indexOf(s) === 0 ? 0 : 1;
        var ay = y.abbr.toLowerCase().indexOf(s) === 0 ? 0 : 1;
        return ax - ay;
      });
    }
    $("#abbrCount").textContent = "(" + items.length + (s ? " из " + list.length : "") + ")";
    $("#abbrBody").innerHTML = items.length
      ? '<dl class="abbr-list">' + items.map(function (a) {
        return "<dt>" + esc(a.abbr) + "</dt><dd>" + esc(a.def) + "</dd>";
      }).join("") + "</dl>"
      : '<p class="muted">Ничего не найдено.</p>';
  }

  function renderDataInfo() {
    var n = Object.keys(state.answers).length;
    var b = Object.keys(state.bookmarks).length;
    var size = 0;
    try { size = (localStorage.getItem(STORE_KEY) || "").length; } catch (e) {}
    $("#dataInfo").textContent = "Вопросов с ответами: " + n + " · закладок: " + b +
      " · размер: " + (size / 1024).toFixed(1) + " КБ" +
      (lastSaved ? " · сохранено: " + lastSaved.toLocaleString("ru-RU") : "");
    var ch = state.settings.chapter;
    var btn = $("#btnResetChapter");
    btn.disabled = ch === "all";
    btn.title = ch === "all" ? "Сначала выберите главу в боковой панели" : "";
    btn.textContent = ch === "all" ? "↺ Сбросить главу (выберите главу)" : "↺ Сбросить главу " + ch + " (" + chapterTitle(Number(ch)) + ")";
  }

  function exportJSON() {
    var payload = {
      app: "EDAIC Antigravity MCQ",
      version: 1,
      exportedAt: new Date().toISOString(),
      answers: state.answers,
      bookmarks: state.bookmarks,
      settings: state.settings
    };
    var text = JSON.stringify(payload, null, 1);
    var d = new Date();
    var stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var name = "edaic-mcq-progress-" + stamp + ".json";
    var markDone = function () {
      state.settings.lastExport = new Date().toISOString();
      save(true);
      if (typeof renderBackupNote === "function") renderBackupNote();
    };
    // iPhone / iPad: share sheet → «Сохранить в Файлы» (iCloud Drive)
    var file = null;
    try { file = new File([text], name, { type: "application/json" }); } catch (e) {}
    var touchDevice = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    if (touchDevice && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).then(function () {
        markDone();
        toast("Файл прогресса сохранён");
      }).catch(function () { /* cancelled */ });
      return;
    }
    var blob = new Blob([text], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    markDone();
    toast("Файл прогресса сохранён");
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(reader.result); } catch (e) { toast("Не удалось прочитать JSON"); return; }
      if (!obj || typeof obj.answers !== "object") { toast("Файл не похож на экспорт прогресса"); return; }
      var answers = {};
      Object.keys(obj.answers).forEach(function (id) {
        var r = obj.answers[id];
        if (!BY_ID[id] || !r || !Array.isArray(r.sel) || r.sel.length !== 5) return;
        answers[id] = {
          sel: r.sel.map(function (v) { return v === "T" || v === "F" ? v : null; }),
          ev: Array.isArray(r.ev) && r.ev.length === 5 ? r.ev.map(Boolean) : [false, false, false, false, false],
          checked: !!r.checked
        };
      });
      var bms = {};
      Object.keys(obj.bookmarks || {}).forEach(function (id) { if (BY_ID[id] && obj.bookmarks[id]) bms[id] = true; });
      var n = Object.keys(answers).length;
      if (!confirm("Импортировать прогресс: " + n + " вопросов с ответами и " + Object.keys(bms).length +
        " закладок?\nТекущий прогресс в этом браузере будет заменён.")) return;
      state.answers = answers;
      state.bookmarks = bms;
      openExpl = {};
      pinned = {};
      save(true);
      renderAll();
      renderDataInfo();
      toast("Импортировано: " + n + " вопросов");
    };
    reader.readAsText(file);
  }

  function resetChapter() {
    var ch = state.settings.chapter;
    if (ch === "all") return;
    if (!confirm("Сбросить ответы по главе " + ch + " (" + chapterTitle(Number(ch)) + ")? Закладки сохранятся.")) return;
    QS.forEach(function (q) { if (q.chapter === Number(ch)) { delete state.answers[q.id]; delete openExpl[q.id]; } });
    pinned = {};
    save(true);
    renderAll();
    renderDataInfo();
    toast("Глава " + ch + " сброшена");
  }

  function resetAll() {
    if (!confirm("Удалить весь прогресс и закладки? Это действие нельзя отменить (если нет экспорта).")) return;
    state.answers = {};
    state.bookmarks = {};
    openExpl = {};
    pinned = {};
    save(true);
    renderAll();
    renderDataInfo();
    toast("Прогресс сброшен");
  }

  // ------------------------------------------------------------------ sidebar (mobile)
  function openSidebar() { $("#sidebar").classList.add("open"); $("#scrim").classList.add("open"); }
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("open"); }

  function syncTopbarHeight() {
    var root = document.documentElement;
    if (window.innerWidth > 900) root.style.setProperty("--topbar-h", $(".topbar").offsetHeight + "px");
    else root.style.removeProperty("--topbar-h");
  }

  // ------------------------------------------------------------------ events
  document.addEventListener("click", function (e) {
    var t = e.target;
    var el;

    if ((el = t.closest("[data-act]"))) {
      var card = el.closest(".qcard");
      if (!card) return;
      var id = card.dataset.id;
      var act = el.dataset.act;
      if (act === "ans") answer(id, Number(el.closest(".stmt").dataset.i), el.dataset.v);
      else if (act === "check") check(id);
      else if (act === "expl") toggleExpl(id);
      else if (act === "bm") toggleBookmark(id);
      else if (act === "reset") resetQuestion(id);
      return;
    }
    if ((el = t.closest("[data-lightbox]"))) {
      $("#lightboxImg").src = el.dataset.lightbox;
      $("#lightboxImg").alt = el.dataset.caption || "";
      $("#lightboxCap").textContent = el.dataset.caption || "";
      $("#lightbox").hidden = false;
      return;
    }
    if (t.closest("#lightbox")) { $("#lightbox").hidden = true; return; }
    if ((el = t.closest("[data-goto]"))) { showQuestion(el.dataset.goto); return; }
    if ((el = t.closest("[data-chapter]"))) {
      setSetting("chapter", el.dataset.chapter);
      state.settings.page = 1;
      renderAll();
      closeSidebar();
      return;
    }
    if ((el = t.closest("[data-filter]"))) {
      setSetting("filter", el.dataset.filter);
      state.settings.page = 1;
      renderAll();
      closeSidebar();
      return;
    }
    if ((el = t.closest("[data-page]"))) { if (!el.disabled) gotoPage(Number(el.dataset.page)); return; }
    if ((el = t.closest("[data-feedback]"))) {
      setSetting("feedback", el.dataset.feedback, { keepPins: true });
      renderHeader();
      renderMain();
      toast(el.dataset.feedback === "exam" ? "📝 Режим «Экзамен»: проверка по кнопке" : "⚡ Режим «Сразу»: проверка после каждого клика");
      return;
    }
    if ((el = t.closest("[data-view]"))) {
      var v = el.dataset.view;
      if (v === "list" && state.settings.view !== "list") {
        // open the page that contains the current question
        var list = currentList();
        var q = currentQuestion(list);
        state.settings.page = q ? Math.floor(list.indexOf(q) / PAGE_SIZE) + 1 : 1;
      }
      setSetting("view", v, { keepPins: true });
      renderAll();
      return;
    }
    if ((el = t.closest("[data-modal]"))) { openModal(el.dataset.modal); return; }
    if (t.closest("[data-close]")) { closeModals(); return; }
    if (t.classList.contains("modal")) { closeModals(); return; }
  });

  $("#btnPrev").addEventListener("click", function () { navigate(-1); });
  $("#btnNext").addEventListener("click", function () { navigate(1); });
  $("#btnRandom").addEventListener("click", randomQuestion);
  $("#btnTheme").addEventListener("click", function () {
    var t = state.settings.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    setSetting("theme", t, { keepPins: true });
  });
  $("#btnSidebar").addEventListener("click", openSidebar);
  $("#btnSidebarClose").addEventListener("click", closeSidebar);
  $("#scrim").addEventListener("click", closeSidebar);

  var searchTimer = null;
  $("#searchInput").addEventListener("input", function (e) {
    var v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      setSetting("search", v);
      state.settings.page = 1;
      renderSidebar();
      renderMain();
    }, 160);
  });
  $("#jumpForm").addEventListener("submit", function (e) { e.preventDefault(); jumpTo($("#jumpInput").value); });
  $("#abbrSearch").addEventListener("input", renderAbbr);

  $("#btnSaveNow").addEventListener("click", function () {
    toast(save(true) ? "✓ Прогресс сохранён в localStorage" : "⚠ Не удалось сохранить — используйте экспорт");
    renderDataInfo();
  });
  $("#btnExport").addEventListener("click", exportJSON);
  $("#importFile").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) importJSON(f);
    e.target.value = "";
  });
  $("#btnResetChapter").addEventListener("click", resetChapter);
  $("#btnResetAll").addEventListener("click", resetAll);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (anyModalOpen()) closeModals();
      else closeSidebar();
      return;
    }
    if (anyModalOpen()) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "ArrowRight") { e.preventDefault(); navigate(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); navigate(-1); }
    else if (e.code === "KeyB" || e.key === "b" || e.key === "B") {
      if (state.settings.view === "focus") { var q = currentQuestion(); if (q) toggleBookmark(q.id); }
    } else if (e.key === " " || e.code === "Space") {
      if (state.settings.view === "focus") {
        e.preventDefault();
        var cq = currentQuestion();
        if (cq) toggleExpl(cq.id);
      }
    }
  });

  window.addEventListener("resize", syncTopbarHeight);
  window.addEventListener("beforeunload", function () { save(true); });

  // ------------------------------------------------------------------ touch: swipe between questions
  var touch = null;
  var contentEl = document.getElementById("content");
  contentEl.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1 || e.target.closest(".tbl-wrap, pre, .fig")) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  contentEl.addEventListener("touchend", function (e) {
    if (!touch || state.settings.view !== "focus") return;
    var dx = e.changedTouches[0].clientX - touch.x;
    var dy = e.changedTouches[0].clientY - touch.y;
    var dt = Date.now() - touch.t;
    touch = null;
    if (dt < 600 && Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5) navigate(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ------------------------------------------------------------------ backup reminder
  function renderBackupNote() {
    var el = document.getElementById("backupNote");
    if (!el) return;
    var n = Object.keys(state.answers).length;
    var last = state.settings.lastExport ? new Date(state.settings.lastExport).getTime() : 0;
    var days = (Date.now() - last) / 86400000;
    el.hidden = sessionNoteClosed || n < 20 || days < 14;
  }
  var sessionNoteClosed = false;
  document.addEventListener("click", function (e) {
    if (e.target.closest("#backupNoteClose")) { sessionNoteClosed = true; renderBackupNote(); }
    else if (e.target.closest("#backupNoteExport")) { exportJSON(); }
  });

  // ------------------------------------------------------------------ start
  renderAll();
  renderBackupNote();
  if (!storageOK) renderSaveInd();
  window.__EDAIC_APP_READY__ = true;
  }

  window.FRCA_BOOT = boot;
  if (window.FRCA_DATA && window.FRCA_DATA.questions) {
    boot(window.FRCA_DATA);
  } else if (!document.getElementById("lockScreen")) {
    document.getElementById("content").innerHTML =
      '<div class="empty"><b>Не найдены данные вопросов</b>Файл <code>data/questions_data.js</code> отсутствует. ' +
      "Запустите <code>python scripts/parse_pdf.py</code>.</div>";
  }
})();
