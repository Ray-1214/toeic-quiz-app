import { getSettings } from './storage';

// Static fallbacks (used in browser-only mode; Electron reads live settings from store per call)
const LLM_API_BASE_DEFAULT = process.env.REACT_APP_LLM_BASE_URL || 'https://api.ithu.tw/v1';
const LLM_API_KEY_DEFAULT  = process.env.REACT_APP_LLM_API_KEY  || '';
const LLM_MODEL_DEFAULT    = process.env.REACT_APP_LLM_MODEL    || 'gpt-oss-120b';

const SYSTEM_PROMPT_BASE = `You are an expert TOEIC test designer with 20 years of experience.
You create authentic TOEIC-style questions that match the actual exam format and vocabulary level.
IMPORTANT: Return ONLY raw JSON — no markdown, no code fences, no explanation text before or after.`;

const DIFFICULTY_MAP = {
  easy:   '~600 score level (basic grammar, common vocabulary)',
  medium: '~730 score level (intermediate grammar, business vocabulary)',
  hard:   '~860 score level (advanced grammar, formal business language)',
};

const THEMES_LABEL = {
  business:   'office and business operations',
  finance:    'finance and accounting',
  hr:         'human resources and employment',
  travel:     'travel and transportation',
  dining:     'restaurants, events, and catering',
  facilities: 'real estate and facilities management',
  marketing:  'sales, marketing, and advertising',
  technology: 'technology and manufacturing',
};

// ── LLM call ─────────────────────────────────────────────────────────────────

async function callLLM(systemPrompt, userPrompt) {
  if (window.electronAPI) {
    // Electron: main process reads live settings from electron-store each call
    return window.electronAPI.llmChat({ systemPrompt, userPrompt });
  }
  // Browser fallback: read settings dynamically so changes take effect immediately
  const stored  = await getSettings();
  const apiBase = stored.apiBase || LLM_API_BASE_DEFAULT;
  const apiKey  = stored.apiKey  || LLM_API_KEY_DEFAULT;
  const model   = stored.model   || LLM_MODEL_DEFAULT;

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Robust JSON parser ────────────────────────────────────────────────────────
// Handles:  ```json ... ```  |  raw JSON  |  {"key": [...]}  |  extra text

function extractJSON(raw) {
  // 1. Strip markdown code fences
  let s = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g,      '')
    .trim();

  // 2. Find first [ or { and last ] or }
  const firstArr = s.indexOf('[');
  const firstObj = s.indexOf('{');

  let start, end, jsonStr;
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    // Outermost container is an array
    start   = firstArr;
    end     = s.lastIndexOf(']');
    jsonStr = s.slice(start, end + 1);
  } else if (firstObj !== -1) {
    // Outermost container is an object
    start   = firstObj;
    end     = s.lastIndexOf('}');
    jsonStr = s.slice(start, end + 1);
  } else {
    throw new Error(`No JSON found in LLM response: ${s.slice(0, 200)}`);
  }

  return JSON.parse(jsonStr);
}

// If we expect an array but LLM wrapped it in an object, unwrap it
function toArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  // e.g. {"questions":[...]} or {"data":[...]} or {"items":[...]}
  for (const v of Object.values(parsed)) {
    if (Array.isArray(v) && v.length > 0) return v;
  }
  throw new Error(`Expected JSON array, got object: ${JSON.stringify(parsed).slice(0, 200)}`);
}

function parseArray(raw)  { return toArray(extractJSON(raw)); }
function parseObject(raw) {
  const r = extractJSON(raw);
  if (Array.isArray(r)) throw new Error('Expected JSON object, got array');
  return r;
}

// ── Part 5 ───────────────────────────────────────────────────────────────────

export async function generatePart5(count, themes, difficulty, priorityWords) {
  const themeLabels = themes.map(t => THEMES_LABEL[t] || t).join(', ');
  const vocabHint   = priorityWords.length
    ? `Prioritize using these words naturally in sentences: ${priorityWords.slice(0, 10).join(', ')}.`
    : '';

  const prompt = `Generate exactly ${count} TOEIC Part 5 (Incomplete Sentences) questions.
Themes: ${themeLabels}
Difficulty: ${DIFFICULTY_MAP[difficulty]}
${vocabHint}

Return ONLY a JSON array (no wrapping object) of exactly ${count} items:
[
  {
    "question": "The director _____ the proposal before the board meeting.",
    "correct_answer": "reviewed",
    "incorrect_answers": ["reviews", "reviewing", "to review"],
    "explanation": "Past tense is required because the action was completed before another past event.",
    "grammar_point": "verb tense",
    "vocab_words": ["director", "proposal", "board"]
  }
]
Rules:
- Use exactly _____ (5 underscores) for the blank
- 1 correct + 3 plausible but wrong options
- Authentic business/office context only
- Concise explanations (1-2 sentences)`;

  const raw = await callLLM(SYSTEM_PROMPT_BASE, prompt);
  return parseArray(raw);
}

// ── Part 6 ───────────────────────────────────────────────────────────────────

export async function generatePart6(theme, difficulty) {
  const themeLabel = THEMES_LABEL[theme] || theme;

  const prompt = `Generate 1 TOEIC Part 6 passage with exactly 3 fill-in-the-blank questions.
Theme: ${themeLabel}
Difficulty: ${DIFFICULTY_MAP[difficulty]}

Passage: 4-6 sentences of a realistic business document (email, memo, notice, or letter).
Mark blanks as [1], [2], [3] in the passage text.

Return ONLY a JSON object:
{
  "passage_type": "email",
  "passage": "Dear Mr. Kim,\\n\\nThank you for your [1] about our product. We are pleased to [2] that shipping is free for orders placed before the 15th. Please do not hesitate to contact us if you need further [3].",
  "questions": [
    { "blank": 1, "correct_answer": "inquiry",   "incorrect_answers": ["inquire","inquired","inquiries"],  "explanation": "'Inquiry' is the noun form required after the possessive 'your'." },
    { "blank": 2, "correct_answer": "announce",  "incorrect_answers": ["announcement","announced","announcing"], "explanation": "'announce' follows 'to' as an infinitive." },
    { "blank": 3, "correct_answer": "assistance","incorrect_answers": ["assist","assisted","assisting"],   "explanation": "'assistance' is the noun form required after 'further'." }
  ]
}`;

  const raw = await callLLM(SYSTEM_PROMPT_BASE, prompt);
  return parseObject(raw);
}

// ── Part 7 ───────────────────────────────────────────────────────────────────

export async function generatePart7(theme, difficulty) {
  const themeLabel = THEMES_LABEL[theme] || theme;

  const prompt = `Generate 1 TOEIC Part 7 reading passage with exactly 3 comprehension questions.
Theme: ${themeLabel}
Difficulty: ${DIFFICULTY_MAP[difficulty]}

Passage: 80-120 words (email, notice, advertisement, memo, or article).

Return ONLY a JSON object:
{
  "passage_type": "notice",
  "passage": "OFFICE RENOVATION NOTICE\\n\\nThe third-floor conference rooms will be closed from July 10 to July 24. Meetings may be held in the first-floor boardroom, which accommodates up to 30 people. Contact the facilities team to reserve the room. We apologize for the inconvenience.",
  "questions": [
    {
      "question": "What is the purpose of this notice?",
      "correct_answer": "To inform staff about temporary room closures",
      "incorrect_answers": ["To announce renovation completion","To recruit volunteers","To change conference policies"],
      "explanation": "The notice states the rooms will be closed for renovation."
    },
    {
      "question": "How many people can the boardroom hold?",
      "correct_answer": "Up to 30",
      "incorrect_answers": ["Up to 10","Up to 20","Up to 50"],
      "explanation": "The notice states it 'accommodates up to 30 people'."
    },
    {
      "question": "How can staff book the boardroom?",
      "correct_answer": "By contacting the facilities team",
      "incorrect_answers": ["By emailing HR","By filling a form online","By calling reception"],
      "explanation": "The notice says to 'contact the facilities team to reserve the room'."
    }
  ]
}`;

  const raw = await callLLM(SYSTEM_PROMPT_BASE, prompt);
  return parseObject(raw);
}

// ── Vocab Drill ───────────────────────────────────────────────────────────────

export async function generateVocabQuestions(words, difficulty) {
  const wordList = words.map(w => `${w.word} (${w.pos}) - ${w.meaning_en}`).join('\n');

  const prompt = `Generate TOEIC vocabulary fill-in-the-blank questions for these words:
${wordList}

Difficulty: ${DIFFICULTY_MAP[difficulty]}

Return ONLY a JSON array with exactly ${words.length} items, one per word in the same order:
[
  {
    "word": "accomplish",
    "question": "The project team managed to _____ all milestones two weeks early.",
    "correct_answer": "accomplish",
    "incorrect_answers": ["accomplishment", "accomplished to", "accomplishing"],
    "meaning_zh": "完成；達成",
    "example": "She accomplished the task in record time.",
    "explanation": "'accomplish' is the bare infinitive required after 'to'. The other options are grammatically incorrect in this context."
  }
]`;

  const raw = await callLLM(SYSTEM_PROMPT_BASE, prompt);
  return parseArray(raw);
}

// ── Vocab Bank Expansion ──────────────────────────────────────────────────────
// Generates new TOEIC vocabulary entries to grow the word bank toward 5000-8000 words.

const VOCAB_LEVELS = {
  basic:    'TOEIC 400-600 level (everyday office and travel vocabulary)',
  mid:      'TOEIC 600-730 level (intermediate business and finance vocabulary)',
  advanced: 'TOEIC 730-860 level (formal business, legal, and academic vocabulary)',
  expert:   'TOEIC 860-990 level (sophisticated professional vocabulary, similar to CEEC Level 5-6)',
};

export async function generateVocabBatch(level, category, existingWords, batchSize = 50) {
  const categoryLabel = THEMES_LABEL[category] || category;
  const exclusion     = existingWords.length
    ? `Do NOT include any of these words: ${existingWords.slice(0, 200).join(', ')}.`
    : '';

  const prompt = `Generate exactly ${batchSize} new TOEIC vocabulary words.
Level: ${VOCAB_LEVELS[level] || VOCAB_LEVELS.mid}
Category: ${categoryLabel}
${exclusion}

Requirements:
- Words must be high-frequency TOEIC words relevant to ${categoryLabel}
- Include verbs, nouns, adjectives, adverbs, and useful phrases
- All words should appear in real business communications
- Traditional Chinese meaning must be accurate

Return ONLY a JSON array of exactly ${batchSize} objects:
[
  {
    "word": "corroborate",
    "pos": "v.",
    "meaning_zh": "確認；證實",
    "meaning_en": "to confirm or support a statement or theory with evidence",
    "example": "The audit results corroborated the manager's financial report.",
    "synonyms": ["confirm", "verify", "substantiate"],
    "category": "${category}",
    "difficulty": 3
  }
]
Notes:
- difficulty: 1=easy, 2=medium, 3=hard
- synonyms: 2-3 common synonyms
- example: must be a realistic business sentence`;

  const raw = await callLLM(SYSTEM_PROMPT_BASE, prompt);
  const words = parseArray(raw);

  // Normalize — add tracking fields expected by the rest of the app
  return words.map((w, i) => ({
    word:         w.word        || '',
    pos:          w.pos         || 'n.',
    meaning_zh:   w.meaning_zh  || '',
    meaning_en:   w.meaning_en  || '',
    example:      w.example     || '',
    synonyms:     Array.isArray(w.synonyms) ? w.synonyms : [],
    category:     w.category    || category,
    difficulty:   Number(w.difficulty) || 2,
    times_tested: 0,
    times_correct:0,
  }));
}
