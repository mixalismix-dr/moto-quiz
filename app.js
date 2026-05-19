(function () {
  const STORAGE_KEY = "moto-ready-progress-v1";
  const QUIZ_SIZE = 10;
  const QUESTIONS = Array.isArray(window.MOTO_QUESTIONS) ? window.MOTO_QUESTIONS : [];

  const elements = {
    appRoot: document.getElementById("appRoot"),
    masteryPercent: document.getElementById("masteryPercent"),
    masteryFill: document.getElementById("masteryFill"),
    quizCount: document.getElementById("quizCount"),
    seenCount: document.getElementById("seenCount"),
    weakCount: document.getElementById("weakCount"),
    startAdaptiveBtn: document.getElementById("startAdaptiveBtn"),
    startWeakBtn: document.getElementById("startWeakBtn"),
    resetProgressBtn: document.getElementById("resetProgressBtn"),
  };

  const state = {
    progress: loadProgress(),
    currentQuiz: null,
  };

  function loadProgress() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!stored || typeof stored !== "object") {
        return createEmptyProgress();
      }

      return {
        quizCount: Number.isFinite(stored.quizCount) ? stored.quizCount : 0,
        statsById: stored.statsById && typeof stored.statsById === "object" ? stored.statsById : {},
      };
    } catch (error) {
      return createEmptyProgress();
    }
  }

  function createEmptyProgress() {
    return {
      quizCount: 0,
      statsById: {},
    };
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  }

  function getQuestionStat(questionId) {
    if (!state.progress.statsById[questionId]) {
      state.progress.statsById[questionId] = {
        attempts: 0,
        correct: 0,
        wrong: 0,
        mastery: 0,
        streak: 0,
        lastSeenQuiz: 0,
        lastResult: null,
      };
    }

    return state.progress.statsById[questionId];
  }

  function normalizeGreekLookalikes(text) {
    const map = {
      A: "Α",
      B: "Β",
      E: "Ε",
      H: "Η",
      I: "Ι",
      K: "Κ",
      M: "Μ",
      N: "Ν",
      O: "Ο",
      P: "Ρ",
      T: "Τ",
      X: "Χ",
      Y: "Υ",
      Z: "Ζ",
      a: "α",
      e: "ε",
      i: "ι",
      o: "ο",
      p: "ρ",
      v: "ν",
      x: "χ",
      y: "υ",
    };

    return text
      .split(/\s+/)
      .map((token) => {
        if (!/[A-Za-z]/.test(token) || !/[Α-Ωα-ωΆ-Ώά-ώ]/.test(token)) {
          return token;
        }

        return token.replace(/[ABEHIKMNOPTXYZaeiopvxy]/g, (char) => map[char] || char);
      })
      .join(" ");
  }

  function cleanQuestionText(text) {
    return normalizeGreekLookalikes(text.replace(/\s+\d{2,3}$/u, "").trim());
  }

  QUESTIONS.forEach((question) => {
    question.question = cleanQuestionText(question.question);
    question.options = question.options.map((option) => ({
      ...option,
      text: cleanQuestionText(option.text),
    }));
  });

  function computeMasteryPercent() {
    if (!QUESTIONS.length) {
      return 0;
    }

    const total = QUESTIONS.reduce((sum, question) => sum + getQuestionStat(question.id).mastery, 0);
    return Math.round((total / QUESTIONS.length) * 100);
  }

  function computeSeenCount() {
    return QUESTIONS.filter((question) => getQuestionStat(question.id).attempts > 0).length;
  }

  function computeWeakCount() {
    return QUESTIONS.filter((question) => getQuestionStat(question.id).mastery < 0.8).length;
  }

  function updateDashboard() {
    const mastery = computeMasteryPercent();
    const seenCount = computeSeenCount();
    const weakCount = computeWeakCount();

    elements.masteryPercent.textContent = `${mastery}%`;
    elements.masteryFill.style.width = `${mastery}%`;
    elements.quizCount.textContent = String(state.progress.quizCount);
    elements.seenCount.textContent = `${seenCount} / ${QUESTIONS.length}`;
    elements.weakCount.textContent = String(weakCount);
  }

  function getAdaptiveWeight(question, mode) {
    const stat = getQuestionStat(question.id);
    const nextQuizNumber = state.progress.quizCount + 1;
    const unseenBoost = stat.attempts === 0 ? 4.2 : 1;
    const weaknessBoost = (1 - stat.mastery) * 6.5;
    const mistakeBoost = Math.min(stat.wrong, 6) * 1.4;
    const recencyGap = stat.lastSeenQuiz ? nextQuizNumber - stat.lastSeenQuiz : 3;
    const recencyBoost = Math.max(Math.min(recencyGap, 10), 0) * 0.14;
    const latestMistakeBoost = stat.lastResult === false ? 2.4 : 0;
    let weight = unseenBoost + weaknessBoost + mistakeBoost + recencyBoost + latestMistakeBoost;

    if (mode === "weak") {
      weight += (1 - stat.mastery) * 4 + stat.wrong * 0.8;
    }

    if (stat.mastery > 0.92 && stat.correct >= 3) {
      weight *= 0.42;
    }

    return Math.max(weight, 0.2);
  }

  function weightedPick(pool, weights) {
    const total = weights.reduce((sum, value) => sum + value, 0);
    let threshold = Math.random() * total;

    for (let index = 0; index < pool.length; index += 1) {
      threshold -= weights[index];
      if (threshold <= 0) {
        return index;
      }
    }

    return pool.length - 1;
  }

  function buildQuiz(mode) {
    const selected = [];
    const pool = [...QUESTIONS];

    while (selected.length < Math.min(QUIZ_SIZE, QUESTIONS.length) && pool.length) {
      const weights = pool.map((question) => getAdaptiveWeight(question, mode));
      const pickIndex = weightedPick(pool, weights);
      selected.push(pool[pickIndex]);
      pool.splice(pickIndex, 1);
    }

    state.currentQuiz = {
      mode,
      startedAt: Date.now(),
      currentIndex: 0,
      questions: selected,
      answers: Array(selected.length).fill(null),
      result: null,
    };

    renderQuiz();
  }

  function answerCurrentQuestion(optionIndex) {
    if (!state.currentQuiz) {
      return;
    }

    state.currentQuiz.answers[state.currentQuiz.currentIndex] = optionIndex;
    renderQuiz();
  }

  function goToQuestion(index) {
    if (!state.currentQuiz) {
      return;
    }

    state.currentQuiz.currentIndex = Math.max(0, Math.min(index, state.currentQuiz.questions.length - 1));
    renderQuiz();
  }

  function finalizeQuiz() {
    if (!state.currentQuiz) {
      return;
    }

    const unanswered = state.currentQuiz.answers.findIndex((value) => value === null);
    if (unanswered !== -1) {
      goToQuestion(unanswered);
      window.alert("Απάντησε πρώτα και στις 10 ερωτήσεις.");
      return;
    }

    const details = state.currentQuiz.questions.map((question, index) => {
      const chosenIndex = state.currentQuiz.answers[index];
      const isCorrect = chosenIndex === question.correctIndex;
      return {
        question,
        chosenIndex,
        isCorrect,
      };
    });

    let correctCount = 0;

    details.forEach((detail) => {
      if (detail.isCorrect) {
        correctCount += 1;
      }

      const stat = getQuestionStat(detail.question.id);
      stat.attempts += 1;
      stat.lastSeenQuiz = state.progress.quizCount + 1;
      stat.lastResult = detail.isCorrect;

      if (detail.isCorrect) {
        stat.correct += 1;
        stat.streak += 1;
        stat.mastery = clamp(stat.mastery + (1 - stat.mastery) * 0.28 + (stat.streak > 1 ? 0.05 : 0), 0, 1);
      } else {
        stat.wrong += 1;
        stat.streak = 0;
        stat.mastery = clamp(stat.mastery * 0.45 - 0.02, 0, 1);
      }
    });

    state.progress.quizCount += 1;
    saveProgress();

    state.currentQuiz.result = {
      score: correctCount,
      wrongCount: details.length - correctCount,
      details,
    };

    updateDashboard();
    renderResults();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function renderHome() {
    const mastery = computeMasteryPercent();
    const weakCount = computeWeakCount();

    elements.appRoot.innerHTML = `
      <div class="empty-state">
        <span class="pill">Adaptive engine ενεργό</span>
        <h2>Στόχος: από το ${mastery}% στο 100%</h2>
        <p class="subtle">
          Το σύστημα επιλέγει 10 ερωτήσεις κάθε φορά και ξαναφέρνει πιο συχνά όσες δεν έχουν
          εμπεδωθεί. Αυτή τη στιγμή υπάρχουν <strong>${weakCount}</strong> ερωτήσεις που θέλουν
          ακόμα δουλειά.
        </p>
        <p class="subtle">
          Πάτησε <strong>Νέο adaptive τεστ</strong> για ισορροπημένο γύρο ή
          <strong>Τεστ στις αδυναμίες</strong> για πιο επιθετική επανάληψη.
        </p>
      </div>
    `;
  }

  function renderQuiz() {
    if (!state.currentQuiz) {
      renderHome();
      return;
    }

    const { questions, currentIndex, answers, mode } = state.currentQuiz;
    const currentQuestion = questions[currentIndex];
    const answeredCount = answers.filter((value) => value !== null).length;

    const optionMarkup = currentQuestion.options
      .map((option, index) => {
        const isSelected = answers[currentIndex] === index;
        return `
          <label class="option ${isSelected ? "selected" : ""}">
            <input
              type="radio"
              name="current-question"
              value="${index}"
              ${isSelected ? "checked" : ""}
              data-option-index="${index}"
            >
            <span class="option-label">${option.label.toUpperCase()}</span>
            <span>${option.text}</span>
          </label>
        `;
      })
      .join("");

    elements.appRoot.innerHTML = `
      <div class="quiz-header">
        <div>
          <span class="quiz-badge">${mode === "weak" ? "Τεστ αδυναμιών" : "Adaptive τεστ"}</span>
          <p class="question-index">Ερώτηση ${currentIndex + 1} από ${questions.length}</p>
        </div>
        <span class="pill">Απαντημένες: ${answeredCount}/${questions.length}</span>
      </div>

      <div class="mini-progress">
        ${questions
          .map((_, index) => {
            const classNames = [
              "mini-dot",
              answers[index] !== null ? "answered" : "",
              index === currentIndex ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `<button class="${classNames}" data-jump-index="${index}" aria-label="Μετάβαση στην ερώτηση ${index + 1}"></button>`;
          })
          .join("")}
      </div>

      <div class="question-card">
        <h3>${currentQuestion.question}</h3>
        <div class="option-list">${optionMarkup}</div>

        <div class="quiz-actions">
          <button class="action-btn ghost" id="prevBtn" ${currentIndex === 0 ? "disabled" : ""}>Προηγούμενη</button>
          ${
            currentIndex === questions.length - 1
              ? '<button class="action-btn primary" id="submitQuizBtn">Ολοκλήρωση τεστ</button>'
              : '<button class="action-btn primary" id="nextBtn">Επόμενη</button>'
          }
        </div>

      </div>
    `;

    elements.appRoot.querySelectorAll("[data-option-index]").forEach((input) => {
      input.addEventListener("change", (event) => {
        answerCurrentQuestion(Number(event.target.dataset.optionIndex));
      });
    });

    elements.appRoot.querySelectorAll("[data-jump-index]").forEach((button) => {
      button.addEventListener("click", () => goToQuestion(Number(button.dataset.jumpIndex)));
    });

    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const submitQuizBtn = document.getElementById("submitQuizBtn");

    if (prevBtn) {
      prevBtn.addEventListener("click", () => goToQuestion(currentIndex - 1));
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => goToQuestion(currentIndex + 1));
    }

    if (submitQuizBtn) {
      submitQuizBtn.addEventListener("click", finalizeQuiz);
    }
  }

  function renderResults() {
    if (!state.currentQuiz || !state.currentQuiz.result) {
      renderHome();
      return;
    }

    const { score, wrongCount, details } = state.currentQuiz.result;
    const wrongItems = details.filter((detail) => !detail.isCorrect);
    const mastery = computeMasteryPercent();

    elements.appRoot.innerHTML = `
      <div>
        <span class="quiz-badge">Αποτέλεσμα τεστ</span>
        <div class="score-callout">
          <h2>Σκορ: ${score} / ${details.length}</h2>
          <p class="subtle">
            Το συνολικό ποσοστό ετοιμότητας είναι τώρα <strong>${mastery}%</strong>. Συνέχισε με
            νέο τεστ για να ξαναδείς περιοδικά ό,τι πήγε λάθος.
          </p>
        </div>

        <div class="result-grid">
          <article class="result-card">
            <span>Σωστές</span>
            <strong>${score}</strong>
          </article>
          <article class="result-card">
            <span>Λάθος</span>
            <strong>${wrongCount}</strong>
          </article>
          <article class="result-card">
            <span>Ποσοστό γύρου</span>
            <strong>${Math.round((score / details.length) * 100)}%</strong>
          </article>
        </div>

        ${
          wrongItems.length
            ? `
              <h3>Λάθος απαντήσεις και σωστή λύση</h3>
              <div class="wrong-list">
                ${wrongItems
                  .map((detail) => {
                    const chosen =
                      detail.chosenIndex !== null ? detail.question.options[detail.chosenIndex] : null;
                    const correct = detail.question.options[detail.question.correctIndex];
                    return `
                      <article class="wrong-item">
                        <h4>${detail.question.id}. ${detail.question.question}</h4>
                        <p class="your-answer">
                          Δική σου απάντηση:
                          ${chosen ? `${chosen.label.toUpperCase()}. ${chosen.text}` : "Δεν απαντήθηκε"}
                        </p>
                        <p class="correct-answer">
                          Σωστή απάντηση:
                          ${correct.label.toUpperCase()}. ${correct.text}
                        </p>
                      </article>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `
              <div class="score-callout">
                <h3>Άψογος γύρος</h3>
                <p class="subtle">Κανένα λάθος. Το adaptive σύστημα θα ανεβάσει τώρα το επίπεδο εμπέδωσης αυτών των ερωτήσεων.</p>
              </div>
            `
        }

        <div class="result-actions">
          <button class="action-btn primary" id="nextAdaptiveFromResults">Νέο adaptive τεστ</button>
          <button class="action-btn secondary" id="nextWeakFromResults">Τεστ στις αδυναμίες</button>
        </div>
      </div>
    `;

    document.getElementById("nextAdaptiveFromResults").addEventListener("click", () => buildQuiz("adaptive"));
    document.getElementById("nextWeakFromResults").addEventListener("click", () => buildQuiz("weak"));
  }

  function resetProgress() {
    const shouldReset = window.confirm("Θέλεις σίγουρα να σβήσεις όλη την πρόοδο και το ποσοστό ετοιμότητας;");
    if (!shouldReset) {
      return;
    }

    state.progress = createEmptyProgress();
    state.currentQuiz = null;
    saveProgress();
    updateDashboard();
    renderHome();
  }

  elements.startAdaptiveBtn.addEventListener("click", () => buildQuiz("adaptive"));
  elements.startWeakBtn.addEventListener("click", () => buildQuiz("weak"));
  elements.resetProgressBtn.addEventListener("click", resetProgress);

  updateDashboard();
  renderHome();
})();
