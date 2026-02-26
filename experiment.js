/***********************
 * Perception Study (PNG/JPG images)
 * One image + two 1–7 sliders per trial
 * Two blocks (Male / Female) — block order randomized; trials randomized within blocks
 * Saves ONLY once at the very end (no streaming/partials)
 * Thank-You page has ONLY the CloudResearch link (no Finish button)
 *
 * IMPLEMENTED:
 * - 6 identities per block, each shown once
 * - balanced attractiveness per block: 2 Attractive, 2 Average, 2 Unattractive
 * - mapping randomized per participant
 * - NO 404s: probes which image files exist and only uses those
 * - Mandatory CloudResearch ID entry after save, then completion link
 *
 * NEW (Option 2 labels / domain primes):
 * - 3 label types: Chess / Basketball / Neutral
 * - balanced within each block: 2 Chess + 2 Basketball + 2 Neutral
 * - randomized assignment within each block
 * - label text shown ABOVE the sliders (so it is visible; not clipped)
 * - label_type and label_text saved in each trial
 ***********************/

/* ========= BASIC OPTIONS ========= */

const IMAGE_DIR = 'all_images';      // folder where images live
const FACE_IDS = [1, 2, 3, 4, 5, 6]; // the 6 identities per block

// Height codes in filenames (1=Tall, 2=Average, 3=Short)
const HEIGHT_CODES = ['1', '2', '3'];

// Attractiveness codes in filenames:
// ''   = Attractive
// '.2' = Average
// '.3' = Unattractive
const ATTR_CODES = ['', '.2', '.3'];

// Try multiple extensions so we don't 404 if your files are .PNG/.JPG/etc.
const EXT_CANDIDATES = ['.png', '.PNG', '.jpg', '.JPG', '.jpeg', '.JPEG'];

/* ========= LABELS (Option 2) =========
   Edit these sentences any time you want.
*/
const LABEL_TEXTS = {
  Chess: "Chess label.",
  Basketball: "Basketball label.",
  Neutral: "Neutral label."
};

// Balanced pool for 6 trials per block (2/2/2)
const LABEL_POOL_6 = ["Chess", "Chess", "Basketball", "Basketball", "Neutral", "Neutral"];

// Slider tick labels (1..7 with endpoint text)
const tickRowHTML = `
  <div class="slider-ticks">
    <span>1<br><small>Not at all</small></span>
    <span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
    <span>7<br><small>Very</small></span>
  </div>`;

// Questions (block-specific)
const maleQuestionTexts = [
  "How likely are you to choose this person for your college Men's basketball team?",
  "How likely are you to choose this person for your college Men's chess team?"
];

const femaleQuestionTexts = [
  "How likely are you to choose this person for your college Women's basketball team?",
  "How likely are you to choose this person for your college Women's chess team?"
];

// Optional: paste your CloudResearch completion URL (unused in this flow)
const CLOUDRESEARCH_COMPLETION_URL = "";

/* ========= UTILITIES ========= */

function safeUUID() {
  try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); }
  catch(_) {}
  return 'pid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getParam(name) {
  const m = new URLSearchParams(location.search).get(name);
  return m ? decodeURIComponent(m) : null;
}

function choice(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

// Prefer HEAD; if server blocks HEAD, fall back to GET.
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

/* ========= META PARSER (supports png/jpg/jpeg) ========= */

function parseMeta(imgPath) {
  const name = imgPath.split('/').pop();
  // Example: M.F.3_1.2.png OR F.F.5_3.jpg
  const m = name.match(/^([FM]\.F)\.(\d+)_([123])(?:\.([23]))?\.(png|jpg|jpeg)$/i);

  const meta = { sex:null, face_id:null, height_code:null, height_label:null, attract_code:null, attract_label:null };
  if (!m) return meta;

  const tag = m[1];
  const face = parseInt(m[2], 10);
  const h = m[3];
  const a = m[4] || ''; // '' means Attractive

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

/* ========= FIREBASE INIT & AUTH ========= */

firebase.initializeApp(window.FIREBASE_CONFIG);

let fbUser = null;
function ensureFirebaseAuth() {
  return new Promise((resolve) => {
    firebase.auth().onAuthStateChanged((user) => { fbUser = user; resolve(user); });
    firebase.auth().signInAnonymously().catch((e) => {
      console.warn('Anonymous sign-in failed:', e);
      resolve(null);
    });
  });
}

const db = firebase.database();

/* ========= INIT JPSYCH ========= */

const jsPsych = initJsPsych({
  show_progress_bar: true,
  message_progress_bar: 'Progress',
});

/* ========= PARTICIPANT IDS ========= */

const participant_id =
  getParam('pid') || getParam('workerId') || getParam('PROLIFIC_PID') || safeUUID();
const participantId = getParam('participantId') || '';  // CR Connect
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
   STIMULUS BUILDER (NO 404s): probe what exists, then sample balanced 2/2/2
   ============================================================================ */

async function findExistingFile(sexTag, face_id, h, a) {
  for (const ext of EXT_CANDIDATES) {
    const filename = `${sexTag}.${face_id}_${h}${a}${ext}`;
    const url = `${IMAGE_DIR}/${filename}`;
    if (await urlExists(url)) return url;
  }
  return null;
}

async function buildAvailability(sexTag) {
  // availability[face_id][attrCode] = [list of existing file URLs]
  const availability = {};
  for (const face_id of FACE_IDS) {
    availability[face_id] = {};
    for (const a of ATTR_CODES) {
      availability[face_id][a] = [];
      for (const h of HEIGHT_CODES) {
        const found = await findExistingFile(sexTag, face_id, h, a);
        if (found) availability[face_id][a].push(found);
      }
    }
  }
  return availability;
}

function shuffle(arr) {
  return jsPsych.randomization.shuffle([...arr]);
}

async function selectBalancedBlockPaths(sexTag) {
  const availability = await buildAvailability(sexTag);

  const facesForAttr = {};
  for (const a of ATTR_CODES) {
    facesForAttr[a] = FACE_IDS.filter(face_id => (availability[face_id]?.[a] || []).length > 0);
  }

  // Need at least 2 faces per attr to satisfy 2/2/2
  for (const a of ATTR_CODES) {
    if (facesForAttr[a].length < 2) {
      const readable = (a === '') ? 'Attractive' : (a === '.2') ? 'Average' : 'Unattractive';
      throw new Error(
        `Not enough existing images for ${sexTag} at ${readable}. ` +
        `Need >=2 identities but found ${facesForAttr[a].length}. ` +
        `Check filenames in ${IMAGE_DIR}/`
      );
    }
  }

  // Randomized search for non-overlapping face assignment
  const MAX_TRIES = 500;
  for (let t = 0; t < MAX_TRIES; t++) {
    const used = new Set();
    const pick = {};

    const attrsOrder = shuffle(ATTR_CODES);
    let ok = true;

    for (const a of attrsOrder) {
      const candidates = shuffle(facesForAttr[a]).filter(f => !used.has(f));
      if (candidates.length < 2) { ok = false; break; }
      pick[a] = candidates.slice(0, 2);
      pick[a].forEach(f => used.add(f));
    }

    if (!ok) continue;

    const paths = [];
    for (const a of ATTR_CODES) {
      for (const face_id of pick[a]) {
        const files = availability[face_id][a];
        paths.push(choice(files)); // random height/extension among existing
      }
    }

    return shuffle(paths);
  }

  throw new Error(
    `Could not find a non-overlapping 2/2/2 assignment for ${sexTag}. ` +
    `Some identities may be missing certain attractiveness levels.`
  );
}

/* ========= FULLSCREEN SCREEN ========= */

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

/* ========= SCREENS ========= */

const welcome = {
  type: jsPsychInstructions,
  pages: [
    `<div class="center">
       <h2>Welcome</h2>
       <p>Welcome to the experiment. This experiment will take approximately 10 minutes to complete.</p>
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
       <p>'How likely are you to choose this person for your college basketball team?' and 'How likely are you to choose this person for your college chess team?'.</p> 
       </p><strong>Please answer the questions based on your perception of the presented image.</strong></p>
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
  const heading = isMale ? 'Male candidates for the male basketball and male chess teams' : 'Female candidates for the female basketball and female chess teams';
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

/* ========= SLIDER TRIAL (one screen with 2 sliders, both required) ========= */

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

/* ========= TRIAL BUILDER (UPDATED FOR Option 2 labels) ========= */

function makeImageTrial(blockLabel, imgPath, label_type) {
  const isMale = (blockLabel === 'Male');
  const qTexts = isMale ? maleQuestionTexts : femaleQuestionTexts;
  const questionNames = ['Q1', 'Q2'];

  const label_text = LABEL_TEXTS[label_type] || "";

  // Put LABEL ABOVE the questions (inside the form area)
  const htmlBlock = `
    <div class="image-label"
         style="text-align:center; margin: 0 auto 14px; max-width: 900px;
                font-size:18px; line-height:1.35;">
      ${label_text}
    </div>

    <div class="q-block">
      ${sliderHTML(questionNames[0], qTexts[0])}
      ${sliderHTML(questionNames[1], qTexts[1])}
    </div>`;

  // accumulators for "active manipulation" time (ms)
  const interact = {};
  const activeSince = {};
  questionNames.forEach(q => {
    interact[q] = 0;
    activeSince[q] = null;
  });

  return {
    type: jsPsychSurveyHtmlForm,

    // Keep ONLY the image inside preamble-wrap (40% area)
    preamble: `
      <div class="preamble-wrap" style="display:flex; align-items:center; justify-content:center;">
        <img class="stimulus-image" src="${imgPath}" alt="stimulus" style="display:block;">
      </div>
    `,

    // Label + sliders live in the form (60% area)
    html: htmlBlock,

    button_label: 'Continue',
    data: {
      block: blockLabel,
      image: imgPath,

      // NEW: store label info
      label_type: label_type,   // Chess / Basketball / Neutral
      label_text: label_text,

      ...parseMeta(imgPath)
    },

    on_load: () => {
      const btn =
        document.querySelector('#jspsych-survey-html-form-next') ||
        document.querySelector('form button[type="submit"]');
      if (!btn) return;

      // make sure instruction centering is off for rating trials
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
      sliders.forEach(s => {
        s.dataset.touched = '0';
        s.classList.remove('touched');
      });

      function checkAllTouched() {
        const ok = sliders.every(s => s.dataset.touched === '1');
        btn.disabled = !ok;
        msg.style.display = ok ? 'none' : 'block';
      }

      // ==== Active manipulation timers ====
      function startActive(name){ stopAll(); if (activeSince[name] == null) activeSince[name] = performance.now(); }
      function stopActive(name){ if (activeSince[name] != null){ interact[name] += performance.now() - activeSince[name]; activeSince[name] = null; } }
      function stopAll(){ questionNames.forEach(stopActive); }

      // === Mark slider as used + add .touched class ===
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

      // ==== keep your active-time tracking ====
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

      /* ====== HARD 40% IMAGE / 60% SCALES + AUTO SCALE-FIT FOR FORM ====== */
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
      /* ====== END STRICT SPLIT + FORM SCALE ====== */
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
      .then(() => {
        window.__saved__ = true;
        setTimeout(() => jsPsych.finishTrial(), 200);
      })
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

    if (participantId && participantId.trim().length > 0) {
      input.value = participantId.trim();
    }

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
    const v = (data.response?.cloudresearch_id_manual || '').trim();
    cloudresearch_id_manual = v;

    jsPsych.data.addProperties({ cloudresearch_id_manual: v });

    if (!participantId && v) {
      jsPsych.data.addProperties({ participantId_manual_fallback: v });
    }
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

       <p><strong>Thank you for participating! Your responses have been recorded.
       <br>Please click on the link below to be redirected to CloudResearch and then close this window.</strong></p>

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

      // NEW: label info saved
      label_type: row.label_type,
      label_text: row.label_text,

      sex: row.sex,
      face_id: row.face_id,
      height_label: row.height_label,
      attract_label: row.attract_label,

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
    trials,
    client_version: 'v3',
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };

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

  return db.ref(`responses/${key}`).update({
    cloudresearch_id_manual: v,
    cloudresearch_id_required_screen: true
  });
}

const _thankYouOnLoad = thankYou.on_load;
thankYou.on_load = () => {
  updateFirebaseWithManualCRID()
    .catch((e) => console.warn('Could not update manual CR ID:', e))
    .finally(() => {
      if (typeof _thankYouOnLoad === 'function') _thankYouOnLoad();
    });
};

/* ========= BOOTSTRAP (build stimuli -> preload -> build timeline -> run) ========= */

(async function bootstrap() {
  try {
    // Build block paths WITHOUT 404s (only from existing images)
    const malePaths   = await selectBalancedBlockPaths('M.F');
    const femalePaths = await selectBalancedBlockPaths('F.F');

    // Preload AFTER we know the real files
    const preload = {
      type: jsPsychPreload,
      images: [...malePaths, ...femalePaths]
    };

    // Block intros
    const maleIntro   = makeBlockIntro('Male');
    const femaleIntro = makeBlockIntro('Female');

    // NEW: balanced + randomized labels within each block
    const maleLabels   = jsPsych.randomization.shuffle([...LABEL_POOL_6]);
    const femaleLabels = jsPsych.randomization.shuffle([...LABEL_POOL_6]);

    // Trials (random order within block) + labels assigned per trial
    const maleTrials   = malePaths.map((p, i) => makeImageTrial('Male', p, maleLabels[i]));
    const femaleTrials = femalePaths.map((p, i) => makeImageTrial('Female', p, femaleLabels[i]));

    // Randomize block order
    const blocks = jsPsych.randomization.shuffle([
      { intro: maleIntro,   trials: maleTrials },
      { intro: femaleIntro, trials: femaleTrials }
    ]);

    // Timeline
    const timeline = [];
    timeline.push(fullscreen);
    timeline.push(preload, welcome, instructions);
    timeline.push(blocks[0].intro, ...blocks[0].trials);
    timeline.push(blocks[1].intro, ...blocks[1].trials);
    timeline.push(saveGate, requireCloudResearchId, thankYou);

    // Run
    await ensureFirebaseAuth();
    jsPsych.run(timeline);

  } catch (err) {
    console.error(err);
    document.body.innerHTML = `
      <div style="max-width:900px;margin:40px auto;font-family:Arial, sans-serif;">
        <h2 style="color:#b00;">Experiment setup error</h2>
        <p>Most likely cause: the script couldn't find enough existing images in <code>${IMAGE_DIR}/</code>
           to satisfy the required 2 Attractive / 2 Average / 2 Unattractive balance for one sex block.</p>
        <pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #ddd;padding:12px;border-radius:8px;">
${String(err && err.message ? err.message : err)}
        </pre>
      </div>
    `;
  }
})();