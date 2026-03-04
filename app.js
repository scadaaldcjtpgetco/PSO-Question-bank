/* Question Bank 2026
 * - Uses embedded data (generated once into docs/data.js).
 * - Day-wise dropdown, search, shuffle, timer, show answers, submit evaluation,
 *   and export selected questions (print / save as PDF).
 *
 * Notes:
 * - This app does NOT parse Excel at runtime. It works offline.
 * - To regenerate data, run: python source/tools/generate_question_data.py --root source --out docs/data.js
 */

(() => {
  "use strict";

  const DAYS = [1, 2, 3, 4, 5, 6];

  const state = {
    selectedDay: null,
    dayData: new Map(), // day -> { loaded, questions: [] }
    answers: new Map(), // questionId -> "A" | "B" | "C" | "D"
    revealAnswers: false,
    submission: null, // { stats, perQuestion: Map(questionId -> { chosen, verdict }) }
    shuffledOrder: new Map(), // day -> array<questionId>
    timer: {
      intervalId: null,
      endAt: null,
    },
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    els.loadStatus = document.getElementById("loadStatus");
    els.questionCount = document.getElementById("questionCount");
    els.timerText = document.getElementById("timerText");

    els.daySelect = document.getElementById("daySelect");
    els.searchInput = document.getElementById("searchInput");
    els.shuffleToggle = document.getElementById("shuffleToggle");
    els.timerMinutes = document.getElementById("timerMinutes");

    els.resetBtn = document.getElementById("resetBtn");
    els.showAnswersBtn = document.getElementById("showAnswersBtn");
    els.submitBtn = document.getElementById("submitBtn");

    els.summary = document.getElementById("summary");
    els.questions = document.getElementById("questions");
    els.emptyState = document.getElementById("emptyState");

    for (const day of DAYS) {
      state.dayData.set(day, { loaded: false, questions: [], error: null });
    }

    wireUi();
    setCounts();

    const embedded = window.questionData;
    if (!embedded || typeof embedded !== "object") {
      setStatus(
        "Missing embedded data. Ensure data.js is loaded before app.js.",
      );
      setControlsEnabled(false);
      return;
    }

    hydrateFromEmbeddedData(embedded);
    selectNoDay();
    setStatus("Ready");
  });

  function wireUi() {
    els.daySelect.addEventListener("change", () => {
      const raw = els.daySelect.value;
      if (!raw) {
        selectNoDay();
        return;
      }
      const day = Number(raw);
      selectDay(day);
    });

    els.searchInput.addEventListener("input", () => render());

    els.shuffleToggle.addEventListener("change", () => {
      if (state.selectedDay) {
        computeShuffleForDay(state.selectedDay);
        render();
      }
    });

    els.timerMinutes.addEventListener("change", () => {
      if (state.selectedDay) startTimerFromUi();
    });

    els.resetBtn.addEventListener("click", () => resetCurrentDayState());
    els.showAnswersBtn.addEventListener("click", () => {
      state.revealAnswers = true;
      render();
      scrollToTopSmooth();
    });
    els.submitBtn.addEventListener("click", () => {
      submitAndScore();
      scrollToTopSmooth();
    });

    // Event delegation for dynamically rendered questions.
    els.questions.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;

      if (target.classList.contains("ansRadio")) {
        const qid = target.dataset.qid;
        const val = normalizeOptionLetter(target.value);
        if (!qid || !val) return;
        state.answers.set(qid, val);
        // If the user changes answers after submit, remove submission results
        // without re-rendering (re-rendering can cause scroll-jumps).
        if (state.submission) {
          state.submission = null;
          els.summary.hidden = true;
          refreshVisibleCardsUi();
        }
      }
    });
  }

  function getDayKey(day) {
    return day === 6 ? "reliability" : `day${day}`;
  }

  function getDayLabel(day) {
    return day === 6 ? "Reliability" : `Day ${day}`;
  }

  function setStatus(text) {
    if (els.loadStatus) els.loadStatus.textContent = text;
  }

  function setControlsEnabled(enabled) {
    els.searchInput.disabled = !enabled;
    els.shuffleToggle.disabled = !enabled;
    els.timerMinutes.disabled = !enabled;
    els.resetBtn.disabled = !enabled;
    els.showAnswersBtn.disabled = !enabled;
    els.submitBtn.disabled = !enabled;
  }

  function setCounts(visibleCount = null) {
    els.questionCount.textContent =
      visibleCount == null ? "0" : String(visibleCount);
  }

  function selectNoDay() {
    state.selectedDay = null;
    state.revealAnswers = false;
    state.submission = null;
    stopTimer();
    els.timerText.textContent = "—";
    els.searchInput.value = "";
    setControlsEnabled(false);

    els.summary.hidden = true;
    els.questions.replaceChildren(els.emptyState);
    els.emptyState.hidden = false;
    setCounts(0);
    setStatus("Ready");
  }

  function selectDay(day) {
    state.selectedDay = day;
    state.revealAnswers = false;
    state.submission = null;
    els.summary.hidden = true;

    setControlsEnabled(true);
    els.searchInput.value = "";

    const meta = state.dayData.get(day);
    if (!meta?.loaded) {
      const msg = `No embedded data found for Day ${day}.`;
      setStatus(msg);
      setControlsEnabled(false);
      els.questions.replaceChildren();
      const err = document.createElement("div");
      err.className = "empty-state";
      err.innerHTML = `<h2>Could not load Day ${day}</h2><p>${escapeHtml(
        msg,
      )}</p>`;
      els.questions.appendChild(err);
      setCounts(0);
      stopTimer();
      els.timerText.textContent = "—";
      return;
    }

    computeShuffleForDay(day);
    startTimerFromUi();
    render();
  }

  function startTimerFromUi() {
    const minutes = clampInt(Number(els.timerMinutes.value), 1, 240);
    if (!minutes) {
      stopTimer();
      els.timerText.textContent = "—";
      return;
    }
    startTimer(minutes);
  }

  function startTimer(minutes) {
    stopTimer();

    const endAt = Date.now() + minutes * 60_000;
    state.timer.endAt = endAt;
    tickTimer();
    state.timer.intervalId = window.setInterval(tickTimer, 1000);
  }

  function stopTimer() {
    if (state.timer.intervalId) window.clearInterval(state.timer.intervalId);
    state.timer.intervalId = null;
    state.timer.endAt = null;
  }

  function tickTimer() {
    if (!state.timer.endAt) return;
    const remainingMs = Math.max(0, state.timer.endAt - Date.now());

    const totalSeconds = Math.floor(remainingMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    els.timerText.textContent = `${mm}:${ss}`;

    if (remainingMs <= 0) {
      stopTimer();
      els.timerText.textContent = "00:00";
      if (state.selectedDay && !state.submission) {
        state.revealAnswers = true;
        submitAndScore();
      }
    }
  }

  function hydrateFromEmbeddedData(embedded) {
    for (const day of DAYS) {
      const key = getDayKey(day);
      const raw = Array.isArray(embedded[key]) ? embedded[key] : [];
      const normalized = raw
        .map((q, idx) => normalizeEmbeddedQuestion(day, q, idx))
        .filter((q) => Boolean(q.text));

      state.dayData.set(day, {
        loaded: true,
        questions: normalized,
        error: null,
      });
    }
  }

  function normalizeEmbeddedQuestion(day, q, idx) {
    const number =
      (q && typeof q.number === "number" && Number.isFinite(q.number)
        ? q.number
        : Number.parseInt(String(q?.number ?? ""), 10)) || idx + 1;

    const id = String(q?.id ?? `D${day}-Q${number}-${idx + 1}`);
    const text = cleanText(q?.text ?? q?.question ?? "");

    const opt = q?.options && typeof q.options === "object" ? q.options : {};
    const options = {
      A: cleanText(opt.A ?? opt.a ?? q?.A ?? q?.a ?? ""),
      B: cleanText(opt.B ?? opt.b ?? q?.B ?? q?.b ?? ""),
      C: cleanText(opt.C ?? opt.c ?? q?.C ?? q?.c ?? ""),
      D: cleanText(opt.D ?? opt.d ?? q?.D ?? q?.d ?? ""),
    };

    return {
      id,
      day,
      number,
      text,
      options,
      correct: normalizeCorrectAnswer(q?.correct ?? q?.answer ?? ""),
    };
  }

  function computeShuffleForDay(day) {
    const meta = state.dayData.get(day);
    if (!meta || !meta.loaded) return;
    const qids = meta.questions.map((q) => q.id);
    state.shuffledOrder.set(day, shuffleCopy(qids));
  }

  function render() {
    const day = state.selectedDay;
    if (!day) return;

    const meta = state.dayData.get(day);
    if (!meta || !meta.loaded) return;

    els.emptyState.hidden = true;

    const query = cleanText(els.searchInput.value).toLowerCase();
    const useShuffle = Boolean(els.shuffleToggle.checked);

    const orderedQuestions = getOrderedQuestions(meta.questions, day, useShuffle);
    const visibleQuestions =
      query.length === 0
        ? orderedQuestions
        : orderedQuestions.filter((q) => matchesQuery(q, query));

    els.questions.replaceChildren();
    if (visibleQuestions.length === 0) {
      const none = document.createElement("div");
      none.className = "empty-state";
      none.innerHTML = `<h2>No results</h2><p>Try a different search term.</p>`;
      els.questions.appendChild(none);
      setCounts(0);
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < visibleQuestions.length; i += 1) {
      frag.appendChild(renderQuestionCard(visibleQuestions[i], i + 1));
    }
    els.questions.appendChild(frag);
    setCounts(visibleQuestions.length);

    if (state.submission) renderSummary(state.submission.stats);
  }

  function getOrderedQuestions(questions, day, useShuffle) {
    if (!useShuffle) return questions;
    const order = state.shuffledOrder.get(day);
    if (!order || order.length === 0) return questions;

    const byId = new Map(questions.map((q) => [q.id, q]));
    const shuffled = [];
    for (const id of order) {
      const q = byId.get(id);
      if (q) shuffled.push(q);
    }
    return shuffled.length ? shuffled : questions;
  }

  function matchesQuery(q, query) {
    if (q.text.toLowerCase().includes(query)) return true;
    for (const v of Object.values(q.options)) {
      if ((v || "").toLowerCase().includes(query)) return true;
    }
    return false;
  }

  function renderQuestionCard(q, displayNumber) {
    const card = document.createElement("article");
    card.className = "q-card";
    card.dataset.qid = q.id;
    card.dataset.correct = q.correct || "";

    const head = document.createElement("div");
    head.className = "q-head";

    const meta = document.createElement("div");
    meta.className = "q-meta";
    meta.textContent = getDayLabel(q.day);

    const qnum = document.createElement("div");
    qnum.className = "q-num";
    qnum.textContent = `Q. ${displayNumber}`;

    head.append(qnum, meta);

    const body = document.createElement("div");
    body.className = "q-body";

    const text = document.createElement("p");
    text.className = "q-text";
    text.textContent = q.text;

    const options = document.createElement("div");
    options.className = "options";
    options.setAttribute("role", "radiogroup");
    options.setAttribute("aria-label", `Options for question ${q.number}`);

    const chosen = state.answers.get(q.id) || "";
    const letters = ["A", "B", "C", "D"];
    for (const letter of letters) {
      options.appendChild(
        renderOption({
          qid: q.id,
          groupName: `ans-${q.id}`,
          letter,
          text: q.options[letter] ?? "",
          checked: chosen === letter,
          correct: q.correct,
        }),
      );
    }

    body.append(text, options);

    const foot = document.createElement("div");
    foot.className = "q-foot";

    const correctTag = document.createElement("span");
    correctTag.className = "tag";
    correctTag.textContent = q.correct
      ? `Correct: ${q.correct}`
      : "Correct: —";

    const statusTag = document.createElement("span");
    statusTag.className = "tag muted";
    statusTag.textContent = "Not submitted";

    const shouldShowCorrect = state.revealAnswers || Boolean(state.submission);
    if (!shouldShowCorrect) correctTag.hidden = true;

    if (state.submission) {
      const info = state.submission.perQuestion.get(q.id);
      if (info?.verdict === "correct") {
        statusTag.className = "tag success";
        statusTag.textContent = "Correct";
      } else if (info?.verdict === "wrong") {
        statusTag.className = "tag danger";
        statusTag.textContent = "Wrong";
      } else if (info?.verdict === "unattempted") {
        statusTag.className = "tag warning";
        statusTag.textContent = "Unattempted";
      }
      correctTag.hidden = false;
    } else if (state.revealAnswers) {
      statusTag.className = "tag muted";
      statusTag.textContent = "Answers shown";
    } else {
      statusTag.hidden = true;
    }

    foot.append(correctTag, statusTag);

    card.append(head, body, foot);

    // Apply highlighting (correct/wrong) based on current state.
    applyHighlights(card, q.id, q.correct);
    return card;
  }

  function renderOption({ qid, groupName, letter, text, checked, correct }) {
    const label = document.createElement("label");
    label.className = "opt";
    label.dataset.opt = letter;

    const input = document.createElement("input");
    input.type = "radio";
    input.name = groupName;
    input.value = letter;
    input.className = "ansRadio";
    input.dataset.qid = qid;
    input.checked = checked;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = letter;

    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = text || "—";

    label.append(input, badge, txt);

    // Correct highlighting is done after the card is mounted (applyHighlights),
    // but we keep this parameter here for clarity.
    void correct;
    return label;
  }

  function applyHighlights(card, qid, correct) {
    const correctLetter = normalizeOptionLetter(correct);
    const chosen = normalizeOptionLetter(state.answers.get(qid) || "");
    const optionEls = [...card.querySelectorAll(".opt")];

    const highlightCorrect = state.revealAnswers || Boolean(state.submission);
    if (highlightCorrect && correctLetter) {
      for (const optEl of optionEls) {
        if (optEl.dataset.opt === correctLetter) optEl.classList.add("is-correct");
      }
    }

    if (!state.submission) return;
    const info = state.submission.perQuestion.get(qid);
    if (!info) return;

    if (info.verdict === "wrong" && chosen) {
      for (const optEl of optionEls) {
        if (optEl.dataset.opt === chosen) optEl.classList.add("is-wrong");
      }
    }
  }

  function submitAndScore() {
    const day = state.selectedDay;
    if (!day) return;

    const meta = state.dayData.get(day);
    if (!meta || !meta.loaded) return;

    const perQuestion = new Map();
    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;

    for (const q of meta.questions) {
      const chosen = normalizeOptionLetter(state.answers.get(q.id) || "");
      const correct = normalizeOptionLetter(q.correct || "");
      let verdict = "unattempted";

      if (!chosen) {
        unattemptedCount += 1;
      } else if (correct && chosen === correct) {
        verdict = "correct";
        correctCount += 1;
      } else {
        verdict = "wrong";
        wrongCount += 1;
      }
      perQuestion.set(q.id, { chosen, verdict });
    }

    const total = meta.questions.length;
    const attempted = total - unattemptedCount;

    state.submission = {
      stats: {
        day,
        total,
        attempted,
        correct: correctCount,
        wrong: wrongCount,
        unattempted: unattemptedCount,
      },
      perQuestion,
    };

    state.revealAnswers = true;
    render();
    renderSummary(state.submission.stats);
  }

  function renderSummary(stats) {
    els.summary.hidden = false;
    const percent =
      stats.attempted === 0
        ? 0
        : Math.round((stats.correct / stats.attempted) * 100);

    els.summary.innerHTML = `
      <div>
        <strong>${getDayLabel(stats.day)} Result:</strong>
        ${stats.correct}/${stats.total} correct
        <span class="muted">(Attempted: ${stats.attempted}, ${percent}% accuracy)</span>
      </div>
      <div class="grid" role="list">
        <div class="stat" role="listitem"><div class="k">Total</div><div class="v">${stats.total}</div></div>
        <div class="stat" role="listitem"><div class="k">Correct</div><div class="v">${stats.correct}</div></div>
        <div class="stat" role="listitem"><div class="k">Wrong</div><div class="v">${stats.wrong}</div></div>
        <div class="stat" role="listitem"><div class="k">Unattempted</div><div class="v">${stats.unattempted}</div></div>
      </div>
    `;
  }

  function resetCurrentDayState() {
    state.revealAnswers = false;
    state.submission = null;
    state.answers.clear();
    els.searchInput.value = "";
    els.shuffleToggle.checked = false;
    stopTimer();
    els.timerText.textContent = "—";
    startTimerFromUi();
    els.summary.hidden = true;
    render();
  }

  function refreshVisibleCardsUi() {
    const cards = els.questions.querySelectorAll(".q-card");
    for (const card of cards) {
      const qid = card.dataset.qid || "";
      const correct = card.dataset.correct || "";

      const optionEls = card.querySelectorAll(".opt");
      for (const el of optionEls) el.classList.remove("is-correct", "is-wrong");

      const correctLetter = normalizeOptionLetter(correct);
      const chosen = normalizeOptionLetter(state.answers.get(qid) || "");

      const highlightCorrect = state.revealAnswers || Boolean(state.submission);
      if (highlightCorrect && correctLetter) {
        for (const el of optionEls) {
          if (el.dataset.opt === correctLetter) el.classList.add("is-correct");
        }
      }

      if (state.submission) {
        const info = state.submission.perQuestion.get(qid);
        if (info?.verdict === "wrong" && chosen) {
          for (const el of optionEls) {
            if (el.dataset.opt === chosen) el.classList.add("is-wrong");
          }
        }
      }

      const foot = card.querySelector(".q-foot");
      if (!foot) continue;
      const tags = foot.querySelectorAll("span.tag");
      const correctTag = tags.item(0);
      const statusTag = tags.item(1);
      if (!correctTag || !statusTag) continue;

      const shouldShowCorrect = state.revealAnswers || Boolean(state.submission);
      correctTag.hidden = !shouldShowCorrect;

      if (state.submission) {
        const info = state.submission.perQuestion.get(qid);
        if (info?.verdict === "correct") {
          statusTag.className = "tag success";
          statusTag.textContent = "Correct";
        } else if (info?.verdict === "wrong") {
          statusTag.className = "tag danger";
          statusTag.textContent = "Wrong";
        } else if (info?.verdict === "unattempted") {
          statusTag.className = "tag warning";
          statusTag.textContent = "Unattempted";
        }
        correctTag.hidden = false;
        statusTag.hidden = false;
      } else if (state.revealAnswers) {
        statusTag.className = "tag muted";
        statusTag.textContent = "Answers shown";
        statusTag.hidden = false;
      } else {
        statusTag.hidden = true;
      }
    }
  }

  function escapeHtml(str) {
    return str
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cleanText(v) {
    const s = String(v ?? "").replace(/\u00a0/g, " ").trim();
    return s;
  }

  function normalizeCorrectAnswer(v) {
    const s = String(v ?? "").trim().toUpperCase();
    if (!s) return "";
    const letter = s.match(/[ABCD]/)?.[0];
    if (letter) return letter;

    const num = Number.parseInt(s, 10);
    if (num === 1) return "A";
    if (num === 2) return "B";
    if (num === 3) return "C";
    if (num === 4) return "D";
    return "";
  }

  function normalizeOptionLetter(v) {
    const s = String(v ?? "").trim().toUpperCase();
    if (s === "A" || s === "B" || s === "C" || s === "D") return s;
    return "";
  }

  function clampInt(n, min, max) {
    if (!Number.isFinite(n)) return null;
    const x = Math.floor(n);
    if (x < min || x > max) return null;
    return x;
  }

  function shuffleCopy(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function scrollToTopSmooth() {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
  }
})();
