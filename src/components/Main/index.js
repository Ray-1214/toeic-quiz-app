import React, { useState, useEffect } from 'react';
import baseVocab from '../../data/vocab.json';
import { generatePart5, generatePart6, generatePart7, generateVocabQuestions } from '../../services/llm';
import { getVocabStats, getExtendedVocab } from '../../services/storage';
import { shuffle } from '../../utils';

const MODES = [
  { id: 'quiz',  label: 'Part 5', title: 'Sentence Completion', desc: 'Fill in the blank — grammar & vocabulary' },
  { id: 'part6', label: 'Part 6', title: 'Paragraph Fill',      desc: 'Complete a business passage with 3 blanks' },
  { id: 'part7', label: 'Part 7', title: 'Reading Comprehension',desc: 'Read a short text and answer questions' },
  { id: 'vocab', label: 'Vocab',  title: 'Word Drill',          desc: 'Drill TOEIC vocabulary words (see Vocab Bank for count)' },
];

const THEMES = [
  { id: 'business',   label: 'Business' },
  { id: 'finance',    label: 'Finance' },
  { id: 'hr',         label: 'Human Resources' },
  { id: 'travel',     label: 'Travel' },
  { id: 'dining',     label: 'Dining' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'marketing',  label: 'Marketing' },
  { id: 'technology', label: 'Technology' },
];

const COUNT_OPTIONS = [5, 10, 15, 20];
const DIFFICULTY_OPTIONS = [
  { id: 'easy',   label: 'Easy (~600)' },
  { id: 'medium', label: 'Medium (~730)' },
  { id: 'hard',   label: 'Hard (~860)' },
];

// errorMsg / onError come from App (persist across loading cycles)
const Main = ({ onStart, onStartLoading, onError, errorMsg, onReview, onVocabManager, onSettings }) => {
  const [mode,       setMode]       = useState('quiz');
  const [themes,     setThemes]     = useState(['business']);
  const [count,      setCount]      = useState(10);
  const [difficulty, setDifficulty] = useState('medium');
  const [vocabBank,  setVocabBank]  = useState(baseVocab);

  useEffect(() => {
    getExtendedVocab().then(ext => {
      if (ext.length > 0) setVocabBank([...baseVocab, ...ext]);
    });
  }, []);

  const toggleTheme = (id) => {
    setThemes(prev =>
      prev.includes(id)
        ? prev.length > 1 ? prev.filter(t => t !== id) : prev
        : [...prev, id]
    );
  };

  const getPriorityWords = async () => {
    const stats = await getVocabStats();
    const relevant = vocabBank.filter(w => themes.includes(w.category));
    relevant.sort((a, b) => {
      const sa = stats[a.id] || { times_tested: 0, times_correct: 0 };
      const sb = stats[b.id] || { times_tested: 0, times_correct: 0 };
      if (sa.times_tested !== sb.times_tested) return sa.times_tested - sb.times_tested;
      const ra = sa.times_tested ? sa.times_correct / sa.times_tested : 0;
      const rb = sb.times_tested ? sb.times_correct / sb.times_tested : 0;
      return ra - rb;
    });
    return relevant.slice(0, 15).map(w => w.word);
  };

  const handleStart = async () => {
    onStartLoading('Generating questions with AI…');
    try {
      const config = { mode, themes, count, difficulty };

      if (mode === 'quiz') {
        const priority = await getPriorityWords();
        const questions = await generatePart5(count, themes, difficulty, priority);
        const shuffled = questions.map(q => ({
          ...q,
          options: shuffle([q.correct_answer, ...q.incorrect_answers]),
        }));
        onStart('quiz', shuffled, config);

      } else if (mode === 'part6') {
        const data = await generatePart6(themes[0], difficulty);
        onStart('part6', data, config);

      } else if (mode === 'part7') {
        const data = await generatePart7(themes[0], difficulty);
        data.questions = data.questions.map(q => ({
          ...q,
          options: shuffle([q.correct_answer, ...q.incorrect_answers]),
        }));
        onStart('part7', data, config);

      } else if (mode === 'vocab') {
        const stats = await getVocabStats();
        const relevant = vocabBank.filter(w => themes.includes(w.category));
        relevant.sort((a, b) => {
          const sa = stats[a.id] || { times_tested: 0, times_correct: 0 };
          const sb = stats[b.id] || { times_tested: 0, times_correct: 0 };
          if (sa.times_tested !== sb.times_tested) return sa.times_tested - sb.times_tested;
          const ra = sa.times_tested ? sa.times_correct / sa.times_tested : 1;
          const rb = sb.times_tested ? sb.times_correct / sb.times_tested : 1;
          return ra - rb;
        });
        const batch = relevant.slice(0, count);
        const questions = await generateVocabQuestions(batch, difficulty);
        const shuffled = questions.map((q, i) => ({
          ...q,
          wordId: batch[i] ? batch[i].id : null,
          options: shuffle([q.correct_answer, ...q.incorrect_answers]),
        }));
        onStart('vocab', shuffled, config);
      }
    } catch (e) {
      console.error('LLM error:', e);
      onError(`AI connection failed: ${e.message || 'Unknown error'}. Make sure you are running in Electron mode (npm run electron-dev).`);
    }
  };

  const showCount      = mode === 'quiz' || mode === 'vocab';
  const showThemeMulti = mode === 'quiz' || mode === 'vocab';

  return (
    <div className="app-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 32 }}>
        <div className="home-logo" style={{ padding: 0, textAlign: 'left' }}>
          <h1>TOEIC Drill</h1>
          <p>AI-powered practice · 多益備考</p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onSettings}
          style={{ marginTop: 8, fontSize: 18, padding: '4px 10px' }}
          title="Settings"
        >
          ⚙
        </button>
      </div>

      {errorMsg && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid #999' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{errorMsg}</p>
        </div>
      )}

      <div className="config-section">
        <span className="config-label">Mode</span>
        <div className="mode-grid">
          {MODES.map(m => (
            <button
              key={m.id}
              className={`mode-card${mode === m.id ? ' selected' : ''}`}
              onClick={() => setMode(m.id)}
            >
              <div className="mode-label">{m.label}</div>
              <div className="mode-title">{m.title}</div>
              <div className="mode-desc">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="config-section">
        <span className="config-label">
          {showThemeMulti ? 'Themes (multi-select)' : 'Theme'}
        </span>
        <div className="chip-group">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`chip${themes.includes(t.id) ? ' selected' : ''}`}
              onClick={() => showThemeMulti ? toggleTheme(t.id) : setThemes([t.id])}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="config-section">
        <span className="config-label">Difficulty</span>
        <div className="chip-group">
          {DIFFICULTY_OPTIONS.map(d => (
            <button
              key={d.id}
              className={`chip${difficulty === d.id ? ' selected' : ''}`}
              onClick={() => setDifficulty(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {showCount && (
        <div className="config-section">
          <span className="config-label">Questions</span>
          <div className="chip-group">
            {COUNT_OPTIONS.map(n => (
              <button
                key={n}
                className={`chip${count === n ? ' selected' : ''}`}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <hr className="divider" />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-lg" onClick={handleStart}>
          Start →
        </button>
        <button className="btn btn-ghost" onClick={onReview}>
          Review Notebook
        </button>
        <button className="btn btn-ghost" onClick={onVocabManager} title={`Vocab bank: ${vocabBank.length} words`}>
          Vocab Bank ({vocabBank.length})
        </button>
      </div>
    </div>
  );
};

export default Main;
