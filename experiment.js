/***********************
 * Perception Study (PNG/JPG images) — AVERAGE HEIGHT ONLY
 * Two blocks (Male / Female) — block order randomized
 * 6 trials per block (faces 1–6)
 *
 * REQUIRED LINKS:
 *   ?cb=1|2|3          (condition group; fixes identity->attractiveness->label mapping)
 *   ?sc=1|2|3|4        (sentence counterbalancing cell; to get 10 per cell within each cb group)
 *
 * If ?cb or ?sc missing/invalid: show error screen and DO NOT start.
 *
 * IMAGE RULES (THIS VERSION):
 *   - ONLY Average height code = 2
 *   - Filenames must be EXACTLY:
 *       all_images/M.F.<face>_2.png     (Attractive)
 *       all_images/M.F.<face>_2.2.png   (Average)
 *       all_images/M.F.<face>_2.3.png   (Unattractive)
 *     and the same for F.F
 *
 * DESIGN (FIXED WITHIN cb GROUP):
 *   Each face_id is tied to a specific attractiveness level AND label type (varies by cb group).
 *   ONLY the order of appearance is randomized (within each block).
 *
 * SENTENCE COUNTERBALANCING (within each cb group; n=10 per sc cell):
 *   Let odd faces = A,C,E = 1,3,5 and even faces = B,D,F = 2,4,6
 *
 *   sc=1: Male 1–2  (odd=S1, even=S2), Female 3–4 (odd=S3, even=S4)
 *   sc=2: Male 2–3  (odd=S2, even=S3), Female 4–1 (odd=S4, even=S1)
 *   sc=3: Male 3–4  (odd=S3, even=S4), Female 1–2 (odd=S1, even=S2)
 *   sc=4: Male 4–1  (odd=S4, even=S1), Female 2–3 (odd=S2, even=S3)
 *
 * CloudResearch ID:
 *   - Save once at end (saveGate)
 *   - Then ID screen updates the SAME Firebase record immediately
 *
 * IMPORTANT FIXES IN THIS VERSION:
 *   ✅ Prevents “Identifier ... has already been declared” by running in a private scope
 *   ✅ Firebase init guarded (won’t double-initialize; won’t fail if script loads twice)
 *   ✅ Description under the image is FORCED BOLD (HTML <strong> + inline font-weight)
 ***********************/

(() => {
  'use strict';

  /* ========= FIREBASE INIT GUARD (prevents errors if loaded twice) ========= */
  try {
    if (window.firebase && window.FIREBASE_CONFIG) {
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
    }
  } catch (e) {
    console.warn("Firebase init guard warning:", e);
  }

  /* ========= BASIC OPTIONS ========= */

  const IMAGE_DIR = 'all_images';
  const FACE_IDS = [1, 2, 3, 4, 5, 6];
  const HEIGHT_CODE = '2';

  // Attractive: ''  => ..._2.png
  // Average:    '.2'=> ..._2.2.png
  // Unattractive:'.3'=> ..._2.3.png
  const ATTR_CODES = ['', '.2', '.3'];
  const EXT_CANDIDATES = ['.png', '.PNG', '.jpg', '.JPG', '.jpeg', '.JPEG'];

  /* ========= IDENTITY NAMES ========= */

  const MALE_NAMES_BY_FACE   = { 1:"George", 2:"John",   3:"Terry",  4:"Michael", 5:"Jack",     6:"Wilson" };
  const FEMALE_NAMES_BY_FACE = { 1:"Emma",   2:"Olivia", 3:"Mary",   4:"Emily",   5:"Samantha", 6:"Jessica" };

  /* ========= LABEL SENTENCES (4 per category) ========= */

  const LABEL_TEMPLATES = {
    Basketball: [
      "{NAME} volunteers as a part-time youth volleyball coach.",
      "{NAME} was on the football team in high school.",
      "{NAME} is a marathon runner.",
      "{NAME} competed in the Youth Olympic Games as a high jumper while in high school."
    ],
    Chess: [
      "{NAME} is an introvert who enjoys logic games and crossword puzzles.",
      "{NAME} competed in the National Mathematical Olympiad in high school and won 5th place.",
      "{NAME} is an A+ student and co-founder of the college math club.",
      "{NAME}'s favorite books are The Art of War by Sun Tzu and How to Think Logically by Seay and Nuccetelli."
    ],
    Neutral: [
      "{NAME} commutes to the college campus.",
      "{NAME} works part time at a retail store.",
      "{NAME} works part-time at a coffee shop.",
      "{NAME} lives in campus housing."
    ]
  };

  /* ========= SLIDER TICKS ========= */

  const tickRowHTML = `
    <div class="slider-ticks">
      <span>1<br><small>Not at all</small></span>
      <span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
      <span>7<br><small>Very</small></span>
    </div>`;

  const maleQuestionTexts = [
    "How likely are you to choose this person for your college Men's basketball team?",
    "How likely are you to choose this person for your college Men's chess team?"
  ];

  const femaleQuestionTexts = [
    "How likely are you to choose this person for your college Women's basketball team?",
    "How likely are you to choose this person for your college Women's chess team?"
  ];

  /* ========= UTILITIES ========= */

  function safeUUID() {
    try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); }
    catch(_) {}
    return 'pid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getParam(name) {
    const v = new URLSearchParams(location.search).get(name);
    return v ? decodeURIComponent(v) : null;
  }

  function choice(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

  async function urlExists(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (r.ok) return true;
    } catch(_) {}
    try {
      const r = await fetch(url, { method: 'GET', cache: 'no-store' });
      return r.ok;
    } catch(_) {
      return false;
    }
  }

  function isOddFace(face_id) { return (face_id % 2) === 1; } // 1,3,5 = A,C,E

  /* ========= META PARSER ========= */

  function parseMeta(imgPath) {
    const name = imgPath.split('/').pop();
    const m = name.match(/^([MF]\.F)\.(\d+)_([123])(?:\.(2|3))?\.(png|jpg|jpeg)$/i);

    const meta = { sex:null, face_id:null, height_code:null, height_label:null, attract_code:null, attract_label:null };
    if (!m) return meta;

    const tag  = m[1];
    const face = parseInt(m[2], 10);
    const h    = m[3];
    const a    = m[4] || '';

    meta.sex = (tag === 'F.F') ? 'Female' : 'Male';
    meta.face_id = face;

    meta.height_code = h;
    meta.height_label = (h === '1') ? 'Tall' : (h === '2') ? 'Average' : 'Short';

    meta.attract_code = a || null;
    meta.attract_label =
      (a === '')  ? 'Attractive' :
      (a === '2') ? 'Average' :
      (a === '3') ? 'Unattractive' :
      null;

    return meta;
  }

  /* ========= INSTRUCTION-PAGE CENTERING HELPERS ========= */

  function enterInstructionsMode() {
    const el = document.querySelector('.jspsych-content');
    if (el) el.classList.add('instructions-mode');
  }
  function exitInstructionsMode() {
    const el = document.querySelector('.jspsych-content');
    if (el) el.classList.remove('instructions-mode');
  }

  /* ========= FIREBASE AUTH ========= */

  const db = (window.firebase && firebase.database) ? firebase.database() : null;

  let fbUser = null;
  function ensureFirebaseAuth() {
    if (!window.firebase || !firebase.auth) return Promise.resolve(null);
    return new Promise((resolve) => {
      firebase.auth().onAuthStateChanged((user) => { fbUser = user; resolve(user); });
      firebase.auth().signInAnonymously().catch((e) => {
        console.warn('Anonymous sign-in failed:', e);
        resolve(null);
      });
    });
  }

  /* ========= INIT JPSYCH ========= */

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    message_progress_bar: 'Progress',
  });

  /* ========= REQUIRED: CB GROUP + SENTENCE CELL ========= */

  function showParamErrorAndStop(msgHTML) {
    document.body.innerHTML = `
      <div style="max-width:920px;margin:40px auto;font-family:Arial, sans-serif;line-height:1.4;">
        <h2 style="color:#b00;">Link error</h2>
        ${msgHTML}
      </div>
    `;
  }

  function getCBGroupOrStop() {
    const cbRaw = getParam('cb');
    const cb = parseInt(cbRaw, 10);

    if (![1,2,3].includes(cb)) {
      showParamErrorAndStop(`
        <p>This study must be opened with one of these URLs:</p>
        <ul>
          <li><code>?cb=1&amp;sc=1</code> … <code>?cb=1&amp;sc=4</code></li>
          <li><code>?cb=2&amp;sc=1</code> … <code>?cb=2&amp;sc=4</code></li>
          <li><code>?cb=3&amp;sc=1</code> … <code>?cb=3&amp;sc=4</code></li>
        </ul>
        <p>Example:</p>
        <pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #ddd;padding:12px;border-radius:8px;">${location.origin + location.pathname}?cb=1&sc=1</pre>
      `);
      throw new Error("Missing/invalid cb parameter.");
    }
    return cb;
  }

  function getSentenceCellOrStop() {
    const scRaw = getParam('sc');
    const sc = parseInt(scRaw, 10);

    if (![1,2,3,4].includes(sc)) {
      showParamErrorAndStop(`
        <p>This study must be opened with a sentence counterbalancing cell:</p>
        <ul>
          <li><code>&amp;sc=1</code></li>
          <li><code>&amp;sc=2</code></li>
          <li><code>&amp;sc=3</code></li>
          <li><code>&amp;sc=4</code></li>
        </ul>
        <p>Example:</p>
        <pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #ddd;padding:12px;border-radius:8px;">${location.origin + location.pathname}?cb=1&sc=1</pre>
      `);
      throw new Error("Missing/invalid sc parameter.");
    }
    return sc;
  }

  /* ========= PARTICIPANT IDS ========= */

  const participant_id =
    getParam('pid') || getParam('workerId') || getParam('PROLIFIC_PID') || safeUUID();

  const participantId = getParam('participantId') || '';
  const assignmentId  = getParam('assignmentId')  || '';
  const projectId     = getParam('projectId')     || '';

  let cloudresearch_id_manual = '';

  jsPsych.data.addProperties({
    participant_id,
    participantId,
    assignmentId,
    projectId
  });

  /* ========= PREVENT ACCIDENTAL EXITS ========= */

  const beforeUnloadHandler = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  /* ============================================================================
     FIXED IDENTITY -> (ATTRACTIVENESS, LABEL) MAPPING BY GROUP
     ============================================================================ */

  function attrCodeToLabel(attrCode) {
    if (attrCode === '') return 'Attractive';
    if (attrCode === '.2') return 'Average';
    return 'Unattractive';
  }

  // Group 1: 1-2 Attractive->Chess ; 3-4 Average->Basketball ; 5-6 Unattractive->Neutral
  // Group 2: 1-2 Unattractive->Basketball ; 3-4 Attractive->Neutral ; 5-6 Average->Chess
  // Group 3: 1-2 Average->Neutral ; 3-4 Unattractive->Chess ; 5-6 Attractive->Basketball
  const FIXED_MAP_BY_GROUP = {
    1: {
      1:{attr:'',   label:'Chess'},      2:{attr:'',   label:'Chess'},
      3:{attr:'.2', label:'Basketball'}, 4:{attr:'.2', label:'Basketball'},
      5:{attr:'.3', label:'Neutral'},    6:{attr:'.3', label:'Neutral'}
    },
    2: {
      1:{attr:'.3', label:'Basketball'}, 2:{attr:'.3', label:'Basketball'},
      3:{attr:'',   label:'Neutral'},    4:{attr:'',   label:'Neutral'},
      5:{attr:'.2', label:'Chess'},      6:{attr:'.2', label:'Chess'}
    },
    3: {
      1:{attr:'.2', label:'Neutral'},    2:{attr:'.2', label:'Neutral'},
      3:{attr:'.3', label:'Chess'},      4:{attr:'.3', label:'Chess'},
      5:{attr:'',   label:'Basketball'}, 6:{attr:'',   label:'Basketball'}
    }
  };

  /* ============================================================================
     SENTENCE CELL LOGIC (sc=1..4)
     ============================================================================ */

  function getSentenceVersion(face_id, sexTag, sc) {
    const odd = isOddFace(face_id);
    const isMaleBlock = (sexTag === 'M.F');

    const map = {
      1: { mO:1, mE:2, fO:3, fE:4 },
      2: { mO:2, mE:3, fO:4, fE:1 },
      3: { mO:3, mE:4, fO:1, fE:2 },
      4: { mO:4, mE:1, fO:2, fE:3 }
    }[sc];

    if (!map) return 1;
    if (isMaleBlock) return odd ? map.mO : map.mE;
    return odd ? map.fO : map.fE;
  }

  /* ============================================================================
     IMAGE LOOKUP (STRICT: ONLY _2 and your dot-codes)
     ============================================================================ */

  async function findExistingFile(sexTag, face_id, attrCode) {
    for (const ext of EXT_CANDIDATES) {
      const filename = `${sexTag}.${face_id}_${HEIGHT_CODE}${attrCode}${ext}`;
      const url = `${IMAGE_DIR}/${filename}`;
      if (await urlExists(url)) return url;
    }
    return null;
  }

  async function buildAvailability(sexTag) {
    const availability = {};
    for (const face_id of FACE_IDS) {
      availability[face_id] = {};
      for (const a of ATTR_CODES) {
        const found = await findExistingFile(sexTag, face_id, a);
        availability[face_id][a] = found ? [found] : [];
      }
    }
    return availability;
  }

  /* ============================================================================
     BUILD TRIAL SPECS (FIXED CONDITIONS PER GROUP; RANDOM ORDER)
     ============================================================================ */

  async function buildBlockTrialSpecsFixed(sexTag, group, sc, nameMap) {
    ["Chess","Basketball","Neutral"].forEach(cat => {
      const arr = LABEL_TEMPLATES[cat] || [];
      if (arr.length !== 4) throw new Error(`LABEL_TEMPLATES.${cat} must have exactly 4 sentences.`);
      const uniq = new Set(arr.map(s => s.trim()));
      if (uniq.size !== 4) throw new Error(`LABEL_TEMPLATES.${cat} must have 4 DIFFERENT sentences.`);
    });

    const availability = await buildAvailability(sexTag);
    const fixed = FIXED_MAP_BY_GROUP[group];
    if (!fixed) throw new Error(`Missing FIXED_MAP_BY_GROUP for cb=${group}.`);

    const specs = [];

    for (const face_id of FACE_IDS) {
      const name = nameMap[face_id] || "George";
      const cond = fixed[face_id];
      if (!cond) throw new Error(`Missing fixed mapping for cb=${group}, face_id=${face_id}.`);

      const attrCode = cond.attr;
      const labelCategory = cond.label;
      const attractLabel = attrCodeToLabel(attrCode);

      const options = availability?.[face_id]?.[attrCode] || [];
      if (!options.length) {
        throw new Error(
          `Missing image for ${sexTag} face_id=${face_id} at ${attractLabel}. ` +
          `Expected: ${IMAGE_DIR}/${sexTag}.${face_id}_${HEIGHT_CODE}${attrCode}<ext> (e.g., .png)`
        );
      }

      const imgPath = choice(options);

      const label_variant = getSentenceVersion(face_id, sexTag, sc);
      const template = LABEL_TEMPLATES[labelCategory][label_variant - 1];
      const labelText = template.replaceAll("{NAME}", name);

      specs.push({
        face_id,
        identity_name: name,
        counterbalance_group: group,
        sentence_cell: sc,

        attract_code_expected: attrCode,
        attract_label_fixed: attractLabel,

        label_category: labelCategory,
        label_variant,
        image_label_text: labelText,

        image: imgPath
      });
    }

    // Validate: exactly 2 per attr and 2 per label per block
    const attrCounts = { Attractive:0, Average:0, Unattractive:0 };
    const labelCounts = { Chess:0, Basketball:0, Neutral:0 };
    for (const s of specs) {
      attrCounts[s.attract_label_fixed] += 1;
      labelCounts[s.label_category] += 1;
    }
    const okAttr = (attrCounts.Attractive === 2 && attrCounts.Average === 2 && attrCounts.Unattractive === 2);
    const okLab  = (labelCounts.Chess === 2 && labelCounts.Basketball === 2 && labelCounts.Neutral === 2);
    if (!okAttr || !okLab) {
      throw new Error(`Fixed-map enforcement failed for ${sexTag} cb=${group}. Attr=${JSON.stringify(attrCounts)} Labels=${JSON.stringify(labelCounts)}`);
    }

    // Validate: within each label type, the 2 faces must have 2 different sentence variants
    for (const cat of ["Chess","Basketball","Neutral"]) {
      const vs = specs.filter(s => s.label_category === cat).map(s => s.label_variant);
      const uniq = new Set(vs);
      if (uniq.size !== 2) {
        throw new Error(`Sentence variants not distinct within ${sexTag} cb=${group} sc=${sc} label=${cat}. Got: ${vs.join(',')}`);
      }
    }

    // Randomize order within block
    return jsPsych.randomization.shuffle(specs);
  }

  /* ========= FULLSCREEN + SCREENS ========= */

  const fullscreen = {
    type: jsPsychFullscreen,
    fullscreen_mode: true,
    message: `
      <div class="fs-message">
        <p>The experiment will switch to full screen mode when you press the button below.</p>
        <p><strong>Please make sure to remain in full-screen mode for the entirety of the study.</strong></p>
        <p><strong>Please have your Connect/Cloud Research ID ready; you will need it to access the completion link at the end of the study.</strong></p>
      </div>
    `,
    button_label: "Continue",
    on_load: () => {
      const el = document.querySelector('.jspsych-content');
      if (el) el.classList.add('fullscreen-mode');
    },
    on_finish: () => {
      const el = document.querySelector('.jspsych-content');
      if (el) el.classList.remove('fullscreen-mode');
    }
  };

  const welcome = {
    type: jsPsychInstructions,
    pages: [
      `<div class="center">
         <h2>Welcome</h2>
         <p>Welcome to the experiment. This experiment will take approximately 5 minutes to complete.</p>
         <p>Please make sure you are in a quiet space and have a strong Wi-Fi connection while doing this experiment.</p>
         <p>If you wish to stop participating in this study at any point, simply press the "Esc" button on your keyboard and close the window; your data will not be recorded.</p>
       </div>`
    ],
    show_clickable_nav: true,
    button_label_next: 'Continue',
    on_load: enterInstructionsMode,
    on_finish: exitInstructionsMode
  };

  const instructions = {
    type: jsPsychInstructions,
    pages: [
      `<div class="center">
         <h2>Instructions</h2>
         <p><strong>In this experiment, we will ask you to put yourself in the position of a college basketball team captain and college chess team captain tasked with selecting new team members. There are male and female teams.</strong></p>
         <p>On each screen, you will see one image and two questions.</p>
         <p><strong>Please answer the questions based on your perception of the presented image.</strong></p>
         <p>Use the 1–7 scale for each question. <strong>The scale is pre-set to 4 by default. However, you must still click or tap on your chosen response — including 4 — to record your answer</strong>.</p>
         <p>Both answers are required.</p>
       </div>`
    ],
    show_clickable_nav: true,
    button_label_next: 'Start',
    on_load: enterInstructionsMode,
    on_finish: exitInstructionsMode
  };

  function blockIntroHTML(label) {
    const isMale = (label === 'Male');
    const heading = isMale
      ? 'Male candidates for the male basketball and male chess teams'
      : 'Female candidates for the female basketball and female chess teams';
    const line = isMale
      ? 'Please view and answer the questions about the following male candidates for the male basketball and male chess teams'
      : 'Please view and answer the questions about the following female candidates for the female basketball and female chess teams';
    return `<div class="center">
              <h2>${heading}</h2>
              <p>${line}.</p>
              <p>Click Continue to begin.</p>
            </div>`;
  }

  function makeBlockIntro(label){
    return {
      type: jsPsychInstructions,
      pages: [ blockIntroHTML(label) ],
      show_clickable_nav: true,
      button_label_next: 'Continue',
      on_load: enterInstructionsMode,
      on_finish: exitInstructionsMode
    };
  }

  /* ========= SLIDER TRIAL ========= */

  function sliderHTML(name, prompt) {
    return `
      <div class="q">
        <div class="q-title">${prompt}</div>
        <div class="slider-row">
          <input class="slider" type="range" min="1" max="7" step="1" value="4" name="${name}">
          ${tickRowHTML}
        </div>
      </div>`;
  }

  function makeImageTrial(blockLabel, spec) {
    const isMale = (blockLabel === 'Male');
    const qTexts = isMale ? maleQuestionTexts : femaleQuestionTexts;
    const questionNames = ['Q1', 'Q2'];

    // ✅ FORCE BOLD: <strong> + inline font-weight
    const htmlBlock = `
      <div class="stimulus-label"
           style="max-width:900px; margin: 0 auto 12px; padding: 0 16px;
                  text-align:center; font-size:18px; line-height:1.35; color:#111; font-weight:800;">
        <strong>${spec.image_label_text}</strong>
      </div>

      <div class="q-block">
        ${sliderHTML(questionNames[0], qTexts[0])}
        ${sliderHTML(questionNames[1], qTexts[1])}
      </div>`;

    const interact = {};
    const activeSince = {};
    questionNames.forEach(q => { interact[q] = 0; activeSince[q] = null; });

    return {
      type: jsPsychSurveyHtmlForm,
      preamble: `
        <div class="preamble-wrap" style="display:flex; align-items:center; justify-content:center;">
          <img class="stimulus-image" src="${spec.image}" alt="stimulus" style="display:block;">
        </div>
      `,
      html: htmlBlock,
      button_label: 'Continue',

      data: {
        block: blockLabel,
        image: spec.image,

        face_id: spec.face_id,
        identity_name: spec.identity_name,

        counterbalance_group: spec.counterbalance_group,
        sentence_cell: spec.sentence_cell,

        attract_code_expected: spec.attract_code_expected,
        attract_label_fixed: spec.attract_label_fixed,

        label_category: spec.label_category,
        label_variant: spec.label_variant,
        image_label_text: spec.image_label_text,

        ...parseMeta(spec.image)
      },

      on_load: () => {
        const btn =
          document.querySelector('#jspsych-survey-html-form-next') ||
          document.querySelector('form button[type="submit"]');
        if (!btn) return;

        exitInstructionsMode();
        btn.disabled = true;

        const msg = document.createElement('div');
        msg.id = 'move-all-sliders-msg';
        msg.style.textAlign = 'center';
        msg.style.color = '#b00';
        msg.style.margin = '6px 0 0';
        msg.textContent = 'Please answer both questions to continue.';
        btn.parentElement.insertBefore(msg, btn);

        const sliders = Array.from(document.querySelectorAll('input[type="range"]'));
        sliders.forEach(s => { s.dataset.touched = '0'; s.classList.remove('touched'); });

        function checkAllTouched() {
          const ok = sliders.every(s => s.dataset.touched === '1');
          btn.disabled = !ok;
          msg.style.display = ok ? 'none' : 'block';
        }

        function startActive(name){ stopAll(); if (activeSince[name] == null) activeSince[name] = performance.now(); }
        function stopActive(name){ if (activeSince[name] != null){ interact[name] += performance.now() - activeSince[name]; activeSince[name] = null; } }
        function stopAll(){ questionNames.forEach(stopActive); }

        sliders.forEach(s => {
          const markUsed = () => {
            if (s.dataset.touched === '1') return;
            s.dataset.touched = '1';
            s.classList.add('touched');
            checkAllTouched();
          };

          s.addEventListener('input',       markUsed, { once: true });
          s.addEventListener('change',      markUsed, { once: true });
          s.addEventListener('pointerdown', markUsed, { once: true });
          s.addEventListener('mousedown',   markUsed, { once: true });
          s.addEventListener('touchstart',  markUsed, { once: true });
          s.addEventListener('focus',       markUsed, { once: true });
          s.addEventListener('keydown',     markUsed, { once: true });
        });

        sliders.forEach(s => {
          const name = s.name;
          const onStart = () => { startActive(name); };
          const onStop  = ()  => { stopActive(name); };
          s.addEventListener('pointerdown', onStart);
          s.addEventListener('mousedown',   onStart);
          s.addEventListener('touchstart',  onStart, { passive: true });
          s.addEventListener('keydown',     onStart);
          s.addEventListener('focus',       onStart);
          s.addEventListener('pointerup',   onStop);
          s.addEventListener('mouseup',     onStop);
          s.addEventListener('touchend',    onStop);
          s.addEventListener('keyup',       onStop);
          s.addEventListener('blur',        onStop);
          s.addEventListener('mouseleave',  onStop);
        });

        document.addEventListener('visibilitychange', () => {
          if (document.hidden) questionNames.forEach(stopActive);
        });

        btn.addEventListener('click', () => {
          questionNames.forEach(stopActive);
          const times = {};
          questionNames.forEach(q => { times[q] = Math.round(interact[q]); });
          document.body.dataset.interactTimes = JSON.stringify(times);
        }, { once: true });

        /* ====== HARD 40% IMAGE / 60% FORM SCALE-FIT ====== */
        (function fitWithStrictSplitAndFormScale() {
          const stage   = document.querySelector('.jspsych-content');
          const preWrap = stage?.querySelector('.preamble-wrap');
          const form    = stage?.querySelector('form');
          if (!stage || !preWrap || !form) return;

          let inner = form.querySelector('.form-scale-wrap');
          if (!inner) {
            inner = document.createElement('div');
            inner.className = 'form-scale-wrap';
            while (form.firstChild) inner.appendChild(form.firstChild);
            form.appendChild(inner);
          }
          inner.style.transformOrigin = 'top center';
          inner.style.width = '100%';

          const SAFETY = 8;

          const compute = () => {
            const cs   = getComputedStyle(stage);
            const padT = parseFloat(cs.paddingTop) || 0;
            const padB = parseFloat(cs.paddingBottom) || 0;
            const H = window.innerHeight - padT - padB;

            const imgH = Math.floor(H * 0.40);
            preWrap.style.height = imgH + 'px';

            const formBoxH = H - imgH - SAFETY;

            inner.style.transform = 'scale(1)';
            const naturalH = inner.getBoundingClientRect().height;

            let scale = 1;
            if (naturalH > formBoxH) {
              scale = formBoxH / naturalH;
              const MIN_SCALE = 0.82;
              scale = Math.max(MIN_SCALE, scale);
            }
            inner.style.transform = `scale(${scale})`;

            form.style.overflow = 'hidden';
            form.style.height = formBoxH + 'px';
          };

          compute();
          setTimeout(compute, 0);
          setTimeout(compute, 60);
          setTimeout(compute, 200);

          const handler = () => compute();
          window.addEventListener('resize', handler);
          preWrap.__resizeHandler = handler;
        })();
      },

      on_finish: (data) => {
        try {
          const t = JSON.parse(document.body.dataset.interactTimes || '{}');
          questionNames.forEach(q => { data[`${q}_interact_ms`] = t[q] ?? null; });
        } catch (_) {
          data.Q1_interact_ms = data.Q2_interact_ms = null;
        }

        const preWrap = document.querySelector('.preamble-wrap');
        if (preWrap && preWrap.__resizeHandler) {
          window.removeEventListener('resize', preWrap.__resizeHandler);
          delete preWrap.__resizeHandler;
        }
      }
    };
  }

  /* ========= SAVE GATE + CR ID + THANK YOU ========= */

  const saveGate = {
    type: jsPsychInstructions,
    show_clickable_nav: false,
    pages: [
      `<div class="center" style="max-width:800px;margin:0 auto;">
         <h3>Saving your responses…</h3>
         <p>Please wait a moment.</p>
       </div>`
    ],
    on_load: () => {
      finalSave()
        .then(() => setTimeout(() => jsPsych.finishTrial(), 200))
        .catch((e) => {
          console.error('Save failed:', e);
          setTimeout(() => jsPsych.finishTrial(), 200);
        });
    }
  };

  const requireCloudResearchId = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<div class="center" style="max-width:800px;margin:0 auto;">
      <h2>CloudResearch ID Required</h2>
      <p><strong>Please enter your Connect/Cloud Research ID to access the completion link. This is a mandatory step for payment processing.</strong></p>
    </div>`,
    html: `
      <div class="q-block" style="max-width:800px;margin:0 auto;">
        <div class="q" style="text-align:left;">
          <label for="crid"><strong>CloudResearch ID</strong></label><br>
          <input id="crid" name="cloudresearch_id_manual" type="text"
                 style="width:100%;max-width:520px;padding:10px;margin-top:8px;font-size:16px;"
                 autocomplete="off" />
          <div id="crid_err" style="color:#b00;margin-top:8px;display:none;">
            Please enter your CloudResearch ID to continue.
          </div>
        </div>
      </div>
    `,
    button_label: 'Continue',
    on_load: () => {
      enterInstructionsMode();

      const btn =
        document.querySelector('#jspsych-survey-html-form-next') ||
        document.querySelector('form button[type="submit"]');

      const input = document.querySelector('#crid');
      const err = document.querySelector('#crid_err');

      if (!btn || !input) return;

      if (participantId && participantId.trim().length > 0) input.value = participantId.trim();

      const validate = () => {
        const v = (input.value || '').trim();
        const ok = v.length > 0;
        btn.disabled = !ok;
        if (err) err.style.display = ok ? 'none' : 'block';
      };

      btn.disabled = true;
      validate();
      input.addEventListener('input', validate);
      input.addEventListener('change', validate);
      input.focus();
    },
    on_finish: (data) => {
      exitInstructionsMode();
      cloudresearch_id_manual = (data.response?.cloudresearch_id_manual || '').trim();
      jsPsych.data.addProperties({ cloudresearch_id_manual });

      if (!participantId && cloudresearch_id_manual) {
        jsPsych.data.addProperties({ participantId_manual_fallback: cloudresearch_id_manual });
      }

      updateFirebaseWithManualCRID().catch(e => console.warn("CRID update failed:", e));
    }
  };

  const thankYou = {
    type: jsPsychInstructions,
    show_clickable_nav: false,
    pages: [
      `<div class="center" style="max-width:800px;margin:0 auto;">
         <h2>Thank you!</h2>
         <p>Your responses have been recorded.</p>
         <hr style="margin:18px 0; border:0; border-top:2px solid #d5d5d5;">
         <p><strong>Please click the link below to be redirected to CloudResearch and then close this window.</strong></p>
         <p style="margin-top:12px;">
           <a href="https://connect.cloudresearch.com/participant/project/FF4E356E38/complete"
              target="_blank" rel="noopener noreferrer"
              style="display:inline-block;padding:10px 16px;text-decoration:none;border-radius:8px;border:1px solid #2b6cb0;">
              Continue to CloudResearch
           </a>
         </p>
       </div>`
    ],
    on_load: () => {
      try { window.removeEventListener('beforeunload', beforeUnloadHandler); } catch(_) {}
      enterInstructionsMode();
      updateFirebaseWithManualCRID().catch(e => console.warn("CRID update failed on thank-you:", e));
    },
    on_finish: exitInstructionsMode
  };

  /* ========= SAVE LOGIC ========= */

  function finalSave() {
    const trials = jsPsych.data.get()
      .filter({ trial_type: 'survey-html-form' })
      .values()
      .map(row => ({
        block: row.block,
        image: row.image,

        face_id: row.face_id,
        identity_name: row.identity_name,

        counterbalance_group: row.counterbalance_group,
        sentence_cell: row.sentence_cell,

        label_category: row.label_category,
        label_variant: row.label_variant,
        image_label_text: row.image_label_text,

        sex: row.sex,
        height_label: row.height_label,
        attract_label: row.attract_label,

        attract_label_fixed: row.attract_label_fixed,
        attract_code_expected: row.attract_code_expected,

        rt: row.rt,
        Q1: Number(row.response?.Q1),
        Q2: Number(row.response?.Q2),

        Q1_interact_ms: row.Q1_interact_ms ?? null,
        Q2_interact_ms: row.Q2_interact_ms ?? null
      }));

    const payload = {
      participant_id,
      participantId,
      assignmentId,
      projectId,
      cb_group: jsPsych.data.get().select('counterbalance_group').values[0] ?? null,
      sentence_cell: jsPsych.data.get().select('sentence_cell').values[0] ?? null,
      trials,
      client_version: 'fixed_identity_cb_sc_avgHeightOnly_v3_bold_guarded',
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    if (!db) {
      console.warn("Firebase database not available; skipping save.");
      return Promise.resolve();
    }

    return db.ref('responses').push(payload).then((ref) => {
      window.__fb_response_key__ = ref.key;
      return ref;
    });
  }

  function updateFirebaseWithManualCRID() {
    const key = window.__fb_response_key__;
    if (!key) return Promise.resolve();

    const v = (cloudresearch_id_manual || '').trim();
    if (!v) return Promise.resolve();

    if (!db) return Promise.resolve();

    return db.ref(`responses/${key}`).update({
      cloudresearch_id_manual: v,
      cloudresearch_id_required_screen: true
    });
  }

  /* ========= BOOTSTRAP ========= */

  (async function bootstrap() {
    try {
      const group = getCBGroupOrStop();      // REQUIRED
      const sc    = getSentenceCellOrStop(); // REQUIRED

      jsPsych.data.addProperties({
        counterbalance_group: group,
        sentence_cell: sc
      });

      const maleSpecs   = await buildBlockTrialSpecsFixed('M.F', group, sc, MALE_NAMES_BY_FACE);
      const femaleSpecs = await buildBlockTrialSpecsFixed('F.F', group, sc, FEMALE_NAMES_BY_FACE);

      const preload = {
        type: jsPsychPreload,
        images: [...maleSpecs.map(s => s.image), ...femaleSpecs.map(s => s.image)]
      };

      const maleIntro   = makeBlockIntro('Male');
      const femaleIntro = makeBlockIntro('Female');

      const maleTrials   = maleSpecs.map(spec => makeImageTrial('Male', spec));
      const femaleTrials = femaleSpecs.map(spec => makeImageTrial('Female', spec));

      const blocks = jsPsych.randomization.shuffle([
        { intro: maleIntro,   trials: maleTrials },
        { intro: femaleIntro, trials: femaleTrials }
      ]);

      const timeline = [];
      timeline.push(fullscreen);
      timeline.push(preload, welcome, instructions);
      timeline.push(blocks[0].intro, ...blocks[0].trials);
      timeline.push(blocks[1].intro, ...blocks[1].trials);
      timeline.push(saveGate, requireCloudResearchId, thankYou);

      await ensureFirebaseAuth();
      jsPsych.run(timeline);

    } catch (err) {
      console.error(err);
    }
  })();

})();