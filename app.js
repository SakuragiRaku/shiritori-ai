// ============================================================
// しりとりAI - app.js
// ============================================================

const HISTORY_KEY = 'shiritori-ai-history';
const THEME_KEY = 'shiritori-ai-theme';

const LEVEL_NAMES = {
  1: 'Lv.1 フリー',
  2: 'Lv.2 日常語カット',
  3: 'Lv.3 一般語カット',
  4: 'Lv.4 教養語のみ',
  5: 'Lv.5 達人',
};

const LEVEL_COLORS = {
  1: '#00d2d3',
  2: '#54a0ff',
  3: '#feca57',
  4: '#ff9f43',
  5: '#ff6b6b',
};

const TURNS_TO_LEVELUP = 3;

// ============================================================
// State
// ============================================================

let gameState = null; // { level, turnsAtLevel, words, lastChar, turn }
let history = [];
let isProcessing = false;

// ============================================================
// Init
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  initTheme();
  initUI();
});

// ============================================================
// Data
// ============================================================

function loadHistory() {
  try {
    history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { history = []; }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// ============================================================
// Theme
// ============================================================

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  setTheme(saved);
  document.getElementById('theme-btn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'dark' : 'light');
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  document.getElementById('theme-btn').textContent = theme === 'light' ? '🌙' : '☀️';
}

// ============================================================
// UI Init
// ============================================================

function initUI() {
  // Start
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('retry-btn').addEventListener('click', startGame);

  // Send
  document.getElementById('send-btn').addEventListener('click', submitWord);
  document.getElementById('word-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) submitWord();
  });

  // History
  document.getElementById('history-btn').addEventListener('click', openHistory);
  document.getElementById('history-close').addEventListener('click', () => {
    document.getElementById('history-modal').classList.add('hidden');
  });
  document.getElementById('history-modal').addEventListener('click', (e) => {
    if (e.target.id === 'history-modal') document.getElementById('history-modal').classList.add('hidden');
  });

  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-cancel').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });
  document.getElementById('settings-save').addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
      AIConfig.setApiKey(key);
      document.getElementById('settings-modal').classList.add('hidden');
    }
  });
  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') document.getElementById('settings-modal').classList.add('hidden');
  });
}

// ============================================================
// Game Control
// ============================================================

function startGame() {
  if (!AIConfig.hasApiKey()) {
    openSettings();
    return;
  }

  gameState = {
    level: 1,
    turnsAtLevel: 0,
    words: [],
    lastChar: '',
    turn: 0,
  };

  showScreen('battle');
  updateLevelDisplay();
  document.getElementById('chat-log').innerHTML = '';
  document.getElementById('word-input').value = '';
  document.getElementById('word-input').disabled = false;
  document.getElementById('send-btn').disabled = false;

  addSystemMessage('ゲームスタート！しりとりの最初の単語を入力してください。');
  updateInputHint();
  document.getElementById('word-input').focus();
}

function endGame(reason) {
  const maxLevel = gameState.level;
  const turns = gameState.turn;

  // Save to history
  history.unshift({
    id: Date.now().toString(36),
    maxLevel,
    turns,
    words: gameState.words.slice(),
    result: reason,
    date: new Date().toISOString(),
  });
  if (history.length > 50) history = history.slice(0, 50);
  saveHistory();

  // Show result
  document.getElementById('result-emoji').textContent = maxLevel >= 4 ? '🏆' : maxLevel >= 2 ? '😤' : '😵';
  document.getElementById('result-title').textContent = maxLevel >= 4 ? 'すばらしい！' : maxLevel >= 2 ? 'おしい！' : 'ゲームオーバー';
  document.getElementById('result-reason').textContent = reason;
  document.getElementById('result-level').textContent = maxLevel;
  document.getElementById('result-turns').textContent = turns;
  document.getElementById('result-words').textContent = gameState.words.join(' → ');

  showScreen('result');
}

// ============================================================
// Word Submission
// ============================================================

async function submitWord() {
  if (isProcessing || !gameState) return;
  const input = document.getElementById('word-input');
  const word = input.value.trim();
  if (!word) return;

  // Basic client-side checks
  if (gameState.words.includes(word)) {
    addSystemMessage(`「${word}」はすでに使われています！`);
    return;
  }

  input.value = '';
  isProcessing = true;
  input.disabled = true;
  document.getElementById('send-btn').disabled = true;

  // Show user message
  addUserMessage(word);

  // Show typing indicator
  const typingEl = showTyping();

  try {
    const result = await judgeAndGetAIResponse(word);
    removeTyping(typingEl);

    if (!result.userWordValid) {
      // User loses
      addSystemMessage(`❌ ${result.userRejectReason}`);
      endGame(result.userRejectReason);
      return;
    }

    // User word is valid
    gameState.words.push(word);
    gameState.turn++;
    gameState.turnsAtLevel++;
    gameState.lastChar = getLastChar(word);

    // Show vocab level info
    addSubInfo(`語彙レベル: ${result.userVocabLevel} ✓`);

    // Check level up
    if (gameState.turnsAtLevel >= TURNS_TO_LEVELUP && gameState.level < 5) {
      gameState.level++;
      gameState.turnsAtLevel = 0;
      await showLevelUp();
      updateLevelDisplay();
    } else {
      updateLevelDisplay();
    }

    // AI response
    if (result.aiWord) {
      const aiWord = result.aiWord;

      // Check if AI word ends with "ん"
      if (aiWord.endsWith('ん')) {
        addAIMessage(aiWord);
        addSystemMessage('🎉 AIが「ん」で終わる単語を言った！あなたの勝ち！');
        endGame('AIが「ん」で終わる単語を出しました。あなたの勝利！');
        return;
      }

      gameState.words.push(aiWord);
      gameState.lastChar = getLastChar(aiWord);
      addAIMessage(aiWord);
      updateInputHint();
    } else {
      addSystemMessage('🎉 AIが単語を思いつけなかった！あなたの勝ち！');
      endGame('AIが降参しました。あなたの勝利！');
      return;
    }

  } catch (error) {
    removeTyping(typingEl);
    addSystemMessage(`⚠️ エラー: ${error.message}`);
  }

  isProcessing = false;
  input.disabled = false;
  document.getElementById('send-btn').disabled = false;
  input.focus();
}

// ============================================================
// AI Integration
// ============================================================

async function judgeAndGetAIResponse(userWord) {
  const expectedChar = gameState.lastChar;
  const usedWords = gameState.words.join(', ');
  const level = gameState.level;

  const prompt = `あなたは「しりとりAI」ゲームの審判兼対戦相手です。
以下の状況で、ユーザーの単語を判定し、あなたの返答の単語を生成してください。

【現在の状況】
語彙力レベル: ${level} (${LEVEL_NAMES[level]})
${expectedChar ? `前の単語の最後の文字: 「${expectedChar}」(ユーザーの単語は「${expectedChar}」で始まる必要があります)` : '最初のターンなので、どの文字で始めてもOK'}
使用済み単語: ${usedWords || 'なし'}

【語彙力レベルの基準】
レベル1 (フリー): すべての名詞OK
レベル2 (日常語カット): 小学校低学年で習う超基本語はNG (犬、猫、空、雨、手、目、耳、りんご、みかん等)
レベル3 (一般語カット): 日常会話で普通に使う一般的な語もNG (冷蔵庫、電車、携帯、テレビ、コンビニ等も含む)
レベル4 (教養語のみ): 教養・学術的な語彙以上のみ (形而上学、対数、弁証法、韜晦 等のレベル)
レベル5 (達人): 専門用語・稀少語のみ (狷介、蠱惑、贖宥、劈開 等のレベル)

【ユーザーの入力】${userWord}

【判定してほしいこと】
1. 実在する日本語の名詞かどうか
2. しりとりが正しく繋がっているか (最初のターンなら不要)
3. 「ん」で終わっていないか
4. 使用済みの単語でないか
5. 語彙レベルがレベル${level}の要件を満たしているか

上記すべてOKなら、あなた(AI)もしりとりを続ける単語を出してください。
AIの単語も以下のルールに従ってください:
- 前の単語(「${userWord}」)のひらがな読みの最後の文字で始まる名詞
- 使用済み単語と被らない
- 現在のレベル${level}に合った語彙レベルの単語
- 長音(ー)で終わる場合、その前の文字を次の頭文字にする。「ゃ」「ゅ」「ょ」等の小文字は大文字に変換して使う
- ユーザーの単語の読みの最後が「ん」以外の長音の場合、長音を省いた文字を頭文字とする

以下のJSON形式で回答してください:
{
  "userWordValid": true/false,
  "userRejectReason": "NG理由 (validならnull)",
  "userWordReading": "ユーザー単語のひらがな読み",
  "userVocabLevel": 1-5の数値,
  "aiWord": "AIの返答単語 (ユーザーがNGならnull)",
  "aiWordReading": "AI単語のひらがな読み (NGならnull)"
}`;

  const response = await AIConfig.callGemini(prompt, { jsonMode: true, temperature: 0.8 });
  return JSON.parse(response);
}

// ============================================================
// Chat UI
// ============================================================

function addUserMessage(word) {
  const log = document.getElementById('chat-log');
  const msg = document.createElement('div');
  msg.className = 'chat-msg user';
  msg.innerHTML = `<span class="chat-sender">あなた</span><div class="chat-bubble">${escHtml(word)}</div>`;
  log.appendChild(msg);
  scrollToBottom();
}

function addAIMessage(word) {
  const log = document.getElementById('chat-log');
  const msg = document.createElement('div');
  msg.className = 'chat-msg ai';
  msg.innerHTML = `<span class="chat-sender">🤖 AI</span><div class="chat-bubble">${escHtml(word)}</div>`;
  log.appendChild(msg);
  scrollToBottom();
}

function addSystemMessage(text) {
  const log = document.getElementById('chat-log');
  const msg = document.createElement('div');
  msg.className = 'chat-msg system';
  msg.innerHTML = `<div class="chat-bubble">${text}</div>`;
  log.appendChild(msg);
  scrollToBottom();
}

function addSubInfo(text) {
  const log = document.getElementById('chat-log');
  // Append to last user message
  const msgs = log.querySelectorAll('.chat-msg.user');
  const last = msgs[msgs.length - 1];
  if (last) {
    const sub = document.createElement('span');
    sub.className = 'chat-sub';
    sub.textContent = text;
    last.appendChild(sub);
  }
}

function showTyping() {
  const log = document.getElementById('chat-log');
  const el = document.createElement('div');
  el.className = 'typing-dots';
  el.innerHTML = '<span></span><span></span><span></span>';
  log.appendChild(el);
  scrollToBottom();
  return el;
}

function removeTyping(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function scrollToBottom() {
  const log = document.getElementById('chat-log');
  log.scrollTop = log.scrollHeight;
}

// ============================================================
// Level Display
// ============================================================

function updateLevelDisplay() {
  if (!gameState) return;
  const { level, turnsAtLevel } = gameState;

  document.getElementById('level-num').textContent = level;
  document.getElementById('level-name').textContent = LEVEL_NAMES[level];
  document.getElementById('level-badge').setAttribute('data-level', level);

  const remaining = level < 5 ? TURNS_TO_LEVELUP - turnsAtLevel : 0;
  const pct = level < 5 ? (turnsAtLevel / TURNS_TO_LEVELUP) * 100 : 100;
  document.getElementById('level-gauge').style.width = `${pct}%`;
  document.getElementById('level-progress').textContent =
    level < 5 ? `次のレベルまで: ${remaining}ターン` : '最高レベル到達！';
}

function updateInputHint() {
  const hint = document.getElementById('input-hint');
  if (!gameState) return;
  if (gameState.lastChar) {
    hint.textContent = `「${gameState.lastChar}」で始まる単語を入力`;
  } else {
    hint.textContent = '好きな単語を入力';
  }
}

async function showLevelUp() {
  const overlay = document.getElementById('levelup-overlay');
  document.getElementById('levelup-title').textContent = `LEVEL ${gameState.level}!`;
  document.getElementById('levelup-desc').textContent = LEVEL_NAMES[gameState.level];
  overlay.classList.remove('hidden');

  addSystemMessage(`⚡ レベルアップ！ ${LEVEL_NAMES[gameState.level]}`);

  return new Promise(resolve => {
    setTimeout(() => {
      overlay.classList.add('hidden');
      resolve();
    }, 1500);
  });
}

// ============================================================
// Screen Management
// ============================================================

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ============================================================
// History Modal
// ============================================================

function openHistory() {
  const modal = document.getElementById('history-modal');
  const statsEl = document.getElementById('history-stats');
  const listEl = document.getElementById('history-list');

  const maxLv = history.length ? Math.max(...history.map(h => h.maxLevel)) : 0;
  const totalGames = history.length;
  const avgTurns = totalGames ? Math.round(history.reduce((s, h) => s + h.turns, 0) / totalGames) : 0;

  statsEl.innerHTML = `
    <div class="history-stat">
      <span class="history-stat-value">${maxLv}</span>
      <span class="history-stat-label">最高レベル</span>
    </div>
    <div class="history-stat">
      <span class="history-stat-value">${totalGames}</span>
      <span class="history-stat-label">対戦数</span>
    </div>
    <div class="history-stat">
      <span class="history-stat-value">${avgTurns}</span>
      <span class="history-stat-label">平均ターン</span>
    </div>
  `;

  if (history.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;">まだ対戦履歴がありません</div>';
  } else {
    listEl.innerHTML = history.map(h => {
      const d = new Date(h.date);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `
        <div class="history-item">
          <span class="history-item-level" style="color:${LEVEL_COLORS[h.maxLevel]}">Lv.${h.maxLevel}</span>
          <span class="history-item-info">${h.turns}ターン | ${dateStr}</span>
        </div>
      `;
    }).join('');
  }

  modal.classList.remove('hidden');
}

// ============================================================
// Settings Modal
// ============================================================

function openSettings() {
  document.getElementById('api-key-input').value = AIConfig.getApiKey();
  document.getElementById('settings-modal').classList.remove('hidden');
}

// ============================================================
// Helpers
// ============================================================

function getLastChar(word) {
  // Get the last character for shiritori
  // Handle long vowel marks, small kana, etc.
  const reading = word; // We should use reading but simplify for now
  let last = reading[reading.length - 1];

  // Handle small kana
  const smallToLarge = { 'ぁ':'あ', 'ぃ':'い', 'ぅ':'う', 'ぇ':'え', 'ぉ':'お',
    'ゃ':'や', 'ゅ':'ゆ', 'ょ':'よ', 'っ':'つ',
    'ァ':'ア', 'ィ':'イ', 'ゥ':'ウ', 'ェ':'エ', 'ォ':'オ',
    'ャ':'ヤ', 'ュ':'ユ', 'ョ':'ヨ', 'ッ':'ツ' };

  if (last === 'ー' || last === '−' || last === '-') {
    last = reading[reading.length - 2] || last;
  }

  if (smallToLarge[last]) {
    last = smallToLarge[last];
  }

  return last;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
