import { API_BASE_URL, backend } from './api-client.js';


// Application State
const state = {
  officer: {
    id: 'OFFICER_001',
    name: 'Vishnu',
    username: 'Vishnu',
    initials: 'VS',
    email: '',
    role: 'Statistical Officer',
    org: 'MoSPI Learning Hub',
    streak: 12,
    hours: 214.5,
    score: 68,
    skillsMastered: 16,
    gaps: ['Data Visualization', 'Statistical Methods', 'Data Interpretation']
  },
  currentPage: 'Overview',
  profile: [],
  selectedCompetency: 'Sampling Design & Weighting',
  courses: [],
  documents: [],
  selectedSourceDocumentId: '',
  analytics: null,
  assessmentData: null,
  assessmentAnswers: {},
  assessmentResult: null,
  activeQuiz: [],
  quizAnswers: {},
  quizResult: null,
  learningRecommendations: [],
  mobileMenuOpen: false,
  authenticatedUser: loadSession()
};

const app = document.getElementById('app');

function loadSession() {
  try { return JSON.parse(localStorage.getItem('pragati-session') || 'null'); } catch { return null; }
}

function applyAuthenticatedUser(user) {
  const name = String(user?.name || state.officer.name).trim();
  const username = String(user?.username || name).trim();
  state.authenticatedUser = user;
  state.officer = {
    ...state.officer,
    id: user?.id || state.officer.id,
    name,
    username,
    initials: user?.initials || username.slice(0, 2).toUpperCase(),
    email: user?.email || state.officer.email,
    role: user?.role || 'Statistical Officer',
    org: user?.organization || 'MoSPI Learning Hub'
  };
}

function renderAuthScreen(mode = 'login') {
  const signup = mode === 'signup';
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-card" aria-labelledby="auth-title">
        <div class="auth-brand"><span class="brand-mark">SK</span><b>StatKarm AI</b></div>
        <p class="eyebrow">AI-ENABLED CAPACITY BUILDING</p>
        <h1 id="auth-title">${signup ? 'Create your account' : 'Welcome back'}</h1>
        <p class="auth-copy">${signup ? 'Create a local learning profile to save your progress.' : 'Sign in to continue your competency learning journey.'}</p>
        <form id="authForm" class="auth-form" data-mode="${mode}">
          ${signup ? `<label>Username<input name="username" autocomplete="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9_.-]+" required placeholder="e.g. priya.sharma"></label>` : ''}
          <label>${signup ? 'Email' : 'Username or email'}<input name="${signup ? 'email' : 'identifier'}" type="${signup ? 'email' : 'text'}" autocomplete="username" required placeholder="${signup ? 'you@example.com' : 'Your username or email'}"></label>
          ${signup ? `<label>Role<input name="role" autocomplete="organization-title" value="Statistical Officer" required></label><label>Organization<input name="organization" autocomplete="organization" value="MoSPI Learning Hub" required></label>` : ''}
          <label>Password<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required placeholder="At least 8 characters"></label>
          ${signup ? `<label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label>` : ''}
          <p class="auth-error" id="authError" role="alert"></p>
          <button class="primary" type="submit">${signup ? 'Create account →' : 'Sign in →'}</button>
        </form>
        <p class="auth-switch">${signup ? 'Already have an account?' : 'New to Pragati?'} <button type="button" id="authSwitch">${signup ? 'Sign in' : 'Create an account'}</button></p>
      </section>
    </main>`;
  bindAuthEvents();
}

function bindAuthEvents() {
  document.getElementById('authSwitch')?.addEventListener('click', () => {
    renderAuthScreen(document.getElementById('authForm')?.dataset.mode === 'signup' ? 'login' : 'signup');
  });
  document.getElementById('authForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const error = document.getElementById('authError');
    const button = form.querySelector('button[type="submit"]');
    if (form.dataset.mode === 'signup' && values.password !== values.confirmPassword) {
      error.textContent = 'Passwords do not match.';
      return;
    }
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Please wait…';
    try {
      const session = form.dataset.mode === 'signup'
        ? await backend.signUp(values)
        : await backend.login(values);
      localStorage.setItem('pragati-session', JSON.stringify(session));
      applyAuthenticatedUser(session.user);
      await initApp();
    } catch (err) {
      error.textContent = err.message || 'Unable to sign in. Please try again.';
      button.disabled = false;
      button.textContent = form.dataset.mode === 'signup' ? 'Create account →' : 'Sign in →';
    }
  });
}

// Utility functions
const escapeHtml = str => String(str ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
})[char]);

function timeGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

const notify = (message, tone = 'info') => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${tone}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3500);
};

// Navigation definition
const NAV_ITEMS = [
  { id: 'Overview', label: 'Dashboard', icon: '⌂' },
  { id: 'Competency Profile', label: 'Competency Radar', icon: '◎' },
  { id: 'My Learning', label: 'My Learning', icon: '▣' },
  { id: 'Skills Assessment', label: 'Skills Assessment', icon: '✎' },
  { id: 'Quiz Studio', label: 'AI Quiz Studio', icon: '✦' },
  { id: 'Manual Library', label: 'Manual Library', icon: '▤' },
  { id: 'Team Insights', label: 'Team Insights', icon: '☵' },
  { id: 'Settings', label: 'Settings', icon: '⚙' }
];

// Responsive SVG Radar Chart
function renderRadarSvg(points) {
  const data = (points && points.length) ? points.slice(0, 6) : [
    { competency: 'Data Visualization', current_score: 55, required_benchmark: 85 },
    { competency: 'Statistical Methods', current_score: 60, required_benchmark: 90 },
    { competency: 'Data Interpretation', current_score: 65, required_benchmark: 80 },
    { competency: 'Sampling Design', current_score: 48, required_benchmark: 85 },
    { competency: 'Data Cleaning', current_score: 78, required_benchmark: 80 },
    { competency: 'Ethics & Standards', current_score: 88, required_benchmark: 85 }
  ];

  const center = 160;
  const radius = 95;
  const count = data.length;

  const polygonPoints = values => values.map((val, idx) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * idx / count);
    const r = radius * (Math.min(100, Math.max(0, val)) / 100);
    const x = (center + r * Math.cos(angle)).toFixed(1);
    const y = (center + r * Math.sin(angle)).toFixed(1);
    return `${x},${y}`;
  }).join(' ');

  const gridLevels = [20, 40, 60, 80, 100];
  const gridPolygons = gridLevels.map(lvl =>
    `<polygon class="${lvl === 100 ? 'radar-grid' : 'radar-ring'}" points="${polygonPoints(data.map(() => lvl))}"/>`
  ).join('');

  const benchmarkPoly = `<polygon class="radar-benchmark" points="${polygonPoints(data.map(d => Number(d.required_benchmark) || 80))}"/>`;
  const currentPoly = `<polygon class="radar-current" points="${polygonPoints(data.map(d => Number(d.current_score) || 0))}"/>`;

  const labels = data.map((d, idx) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * idx / count);
    const textRadius = radius + 32;
    const x = center + textRadius * Math.cos(angle);
    const y = center + textRadius * Math.sin(angle) + 3;
    const name = d.competency.length > 18 ? d.competency.slice(0, 17) + '…' : d.competency;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="radar-text-label">${escapeHtml(name)}</text>`;
  }).join('');

  return `
    <svg class="radar-svg" viewBox="0 0 320 320" aria-label="Competency Radar Chart">
      ${gridPolygons}
      ${benchmarkPoly}
      ${currentPoly}
      ${labels}
    </svg>
  `;
}

// Layout Shell
function layoutShell(pageId, contentHtml) {
  const currentNav = NAV_ITEMS.find(n => n.id === pageId) || NAV_ITEMS[0];
  const navButtons = NAV_ITEMS.map(item => `
    <button class="nav-item ${item.id === pageId ? 'active' : ''}" data-nav="${item.id}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
      ${item.id === 'Skills Assessment' && state.officer.gaps.length ? `<b>${state.officer.gaps.length} gaps</b>` : ''}
    </button>
  `).join('');

  return `
    <div class="app-layout">
      <!-- Mobile Drawer Backdrop -->
      <div class="sidebar-backdrop ${state.mobileMenuOpen ? 'show' : ''}" id="sidebarBackdrop"></div>

      <!-- Navigation Sidebar -->
      <aside class="sidebar ${state.mobileMenuOpen ? 'open' : ''}">
        <div class="brand">
          <span class="brand-mark">SK</span>
          <span class="brand-text">StatKarm <span class="brand-dot">AI</span></span>
          <button class="mobile-close-btn" id="mobileCloseBtn" aria-label="Close menu">✕</button>
        </div>

        <div class="org-pill">
          <span class="org-icon">◈</span>
          <div>
            <small>ORGANIZATION</small>
            <span>${escapeHtml(state.officer.org)}</span>
          </div>
        </div>

        <nav class="sidebar-nav">
          ${navButtons}
        </nav>

        <div class="side-bottom">
          <div class="user-profile-strip">
            <div class="avatar">${escapeHtml(state.officer.initials)}</div>
            <div class="user-details">
              <strong>${escapeHtml(state.officer.username)}</strong>
              <small>${escapeHtml(state.officer.name)} · ${escapeHtml(state.officer.role)}</small>
            </div>
            <button class="sign-out-btn" id="signOutBtn" type="button">Sign out</button>
          </div>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="main-content">
        <header class="app-header">
          <div class="header-titles">
            <p class="eyebrow">AI-ENABLED CAPACITY BUILDING · OFFICIAL STATISTICS</p>
            <h1>${pageId === 'Overview' ? `${timeGreeting()}, ${escapeHtml(state.officer.username)}` : escapeHtml(currentNav.label)} <span class="sparkle">✦</span></h1>
            <p class="subhead">Competency-led learning pathways aligned with iGOT Karmayogi.</p>
          </div>

          <div class="header-actions">
            <div class="avatar small" title="${escapeHtml(state.officer.name)}${state.officer.email ? ` · ${escapeHtml(state.officer.email)}` : ''}">${escapeHtml(state.officer.initials)}</div>
            <button class="mobile-menu-toggle" id="mobileMenuToggle" aria-label="Toggle navigation menu">
              ☰
            </button>
          </div>
        </header>

        <div class="page-container">
          ${contentHtml}
        </div>
      </main>

      <div class="toast" id="toast"></div>
    </div>
  `;
}

// 1. Overview Page (Dashboard)
function renderOverviewPage() {
  const radarHtml = renderRadarSvg(state.profile);

  const statsHtml = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon amber">★</div>
        <div>
          <p>Learning Streak</p>
          <h3>${state.officer.streak} <small>days</small></h3>
          <span class="trend">+2 this week</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon teal">⏱</div>
        <div>
          <p>Learning Hours</p>
          <h3>${state.officer.hours} <small>hrs</small></h3>
          <span class="trend">+4.5 hrs this month</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple">🎯</div>
        <div>
          <p>Assessment Score</p>
          <h3>${state.officer.score}%</h3>
          <span class="trend ${state.officer.score >= 70 ? '' : 'neutral'}">${state.officer.score >= 70 ? 'Proficient' : 'Needs attention'}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon coral">🏆</div>
        <div>
          <p>Skills Mastered</p>
          <h3>${state.officer.skillsMastered} <small>/ 24</small></h3>
          <span class="trend">${state.officer.gaps.length} priority gaps</span>
        </div>
      </div>
    </div>
  `;

  // After a PDF-based quiz, show its tailored recommendations rather than
  // unrelated catalogue courses on the dashboard.
  const dashboardCourses = (state.learningRecommendations || []).length
    ? state.learningRecommendations
    : (state.courses || []);
  const topCourses = dashboardCourses.slice(0, 2).map(course => `
    <div class="course-card">
      <div class="course-art blue-art">
        <span>iGOT</span>
        <i>📖</i>
      </div>
      <div class="course-info">
        <div class="course-top">
          <span class="course-label">${escapeHtml(course.skills?.[0] || 'Official Statistics')}</span>
          <span class="time">${course.duration_hours || 2}h</span>
        </div>
        <h3>${escapeHtml(course.title)}</h3>
        <p>${escapeHtml(course.description)}</p>
        <div class="course-bottom">
          <span>${escapeHtml(course.provider)}</span>
          <div class="progress-wrap">
            <div class="mini-progress"><i style="width: ${course.progress || 0}%"></i></div>
            <b>${course.progress || 0}%</b>
          </div>
          <button class="play-btn" data-action="continue-course" data-course-id="${course.id}" title="Continue learning">▶</button>
        </div>
      </div>
    </div>
  `).join('');

  return `
    <section class="hero contract-hero">
      <div class="hero-copy">
        <span class="tag">LEARNER PROFILE · @${escapeHtml(state.officer.username)}</span>
        <h2>Learn for <em>better decisions.</em></h2>
        <p>Identify competency gaps, practice with AI-generated quizzes, and progress along tailored iGOT Karmayogi learning pathways.</p>
        <div class="hero-buttons">
          <button class="primary" data-nav="Competency Profile">View Competency Radar →</button>
          <button class="secondary-btn" data-nav="Skills Assessment">Take Skill Assessment</button>
        </div>
      </div>
      <div class="hero-visual">
        <div class="contract-orbit"></div>
        <div class="chart-card api-card">
          <span class="tiny-title">CAPACITY WORKFLOW</span>
          <b>Profile → Quiz → Learn</b>
          <small>MoSPI Competency Framework</small>
        </div>
        <div class="visual-person">👨🏽‍💼</div>
      </div>
    </section>

    ${statsHtml}

    <div class="content-grid">
      <div class="left-column">
        <div class="section-heading">
          <h2>Active Learning Pathways</h2>
          <button class="link-button" data-nav="My Learning">View all courses →</button>
        </div>
        <div class="course-list">
          ${topCourses}
        </div>

        <div class="workflow-grid mt-4">
          <article>
            <span>1</span>
            <h3>Upload Manuals</h3>
            <p>Index official survey guidelines and training PDFs.</p>
            <button class="text-btn" data-nav="Manual Library">Upload PDF →</button>
          </article>
          <article>
            <span>2</span>
            <h3>Generate Quiz</h3>
            <p>Generate 5 targeted MCQs by topic and competency.</p>
            <button class="text-btn" data-nav="Quiz Studio">Create Quiz →</button>
          </article>
          <article>
            <span>3</span>
            <h3>Track Gaps</h3>
            <p>Compare current scores against role benchmarks.</p>
            <button class="text-btn" data-nav="Competency Profile">Radar Profile →</button>
          </article>
          <article>
            <span>4</span>
            <h3>Team Insights</h3>
            <p>Inspect department-wide completion and adoption trends.</p>
            <button class="text-btn" data-nav="Team Insights">Analytics →</button>
          </article>
        </div>
      </div>

      <div class="right-column">
        <div class="radar-card">
          <div class="section-heading">
            <h2>Competency Snapshot</h2>
            <button class="link-button" data-nav="Competency Profile">Full Radar →</button>
          </div>
          <div class="radar-wrap">
            ${radarHtml}
          </div>
          <div class="legend">
            <span><i class="current"></i>Current Score</span>
            <span><i class="benchmark"></i>Benchmark</span>
          </div>
        </div>

        <div class="upcoming">
          <div class="section-heading">
            <h2>Upcoming Learning Events</h2>
          </div>
          <div class="event">
            <div class="date-box"><b>12</b><small>SEP</small></div>
            <div>
              <h3>National Statistics Competency Review</h3>
              <p>Friday · 10:30 AM · MoSPI Virtual</p>
            </div>
          </div>
          <div class="event">
            <div class="date-box purple-date"><b>18</b><small>SEP</small></div>
            <div>
              <h3>iGOT Micro-learning: Sampling In Practice</h3>
              <p>Thursday · 03:00 PM · Online</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// 2. Competency Profile Page
function renderProfilePage() {
  const radarSvg = renderRadarSvg(state.profile);

  const competencyListHtml = state.profile.map(row => {
    const isSelected = row.competency === state.selectedCompetency;
    const isProficient = Number(row.current_score) >= Number(row.required_benchmark);
    return `
      <div class="competency-row ${isSelected ? 'selected' : ''}" data-select-competency="${escapeHtml(row.competency)}">
        <div>
          <b>${escapeHtml(row.competency)}</b>
          <small>Current: ${row.current_score}% · Benchmark: ${row.required_benchmark}%</small>
        </div>
        <div class="competency-actions">
          <span class="score ${isProficient ? 'good' : ''}">
            ${isProficient ? 'Proficient' : 'Needs Focus'}
          </span>
          <button class="text-btn" data-find-courses="${escapeHtml(row.competency)}">Find Courses →</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <section class="page-hero">
      <span class="tag">COMPETENCY FRAMEWORK${state.officer.id}</span>
      <h2>Official Statistics Competency Radar</h2>
      <p>Compare current proficiency scores against the required role benchmarks. Focus on priority gaps to unlock advanced analytical tasks.</p>
      <p class="profile-identity">Signed in as <b>${escapeHtml(state.officer.username)}</b>${state.officer.email ? ` · ${escapeHtml(state.officer.email)}` : ''}</p>
    </section>

    <div class="profile-layout">
      <article class="radar-card">
        <div class="radar-wrap" id="radarArea">
          ${radarSvg}
        </div>
        <div class="legend">
          <span><i class="current"></i>Current Score</span>
          <span><i class="benchmark"></i>Required Benchmark</span>
        </div>
        <div class="radar-actions mt-4 text-center">
          <button class="primary" data-nav="Skills Assessment">Re-test Competencies (5 Questions) →</button>
        </div>
      </article>

      <article class="competency-list">
        <div class="flex-between mb-2">
          <p class="eyebrow">COMPETENCY STATUS &amp; GAP ANALYSIS</p>
          <span class="text-xs text-muted">${state.officer.gaps.length} Priority Gaps</span>
        </div>
        ${competencyListHtml}
      </article>
    </div>
  `;
}

// 3. My Learning Page
function renderLearningPage() {
  // Keep the recommendations generated from the just-completed PDF quiz at
  // the top of the learning page.  This is intentionally separate from the
  // general catalogue so an assessment result is not lost on navigation.
  const recommendedCourses = state.learningRecommendations || [];
  const recommendedIds = new Set(recommendedCourses.map(course => course.id || course.title));
  const learningCourses = [
    ...recommendedCourses,
    ...(state.courses || []).filter(course => !recommendedIds.has(course.id || course.title))
  ];
  const filterButtons = ['All Competencies', ...new Set(learningCourses.flatMap(c => c.skills || []))].map(skill => `
    <button class="filter-chip ${skill === 'All Competencies' ? 'active' : ''}" data-filter-course="${escapeHtml(skill)}">
      ${escapeHtml(skill)}
    </button>
  `).join('');

  const coursesHtml = learningCourses.map(course => `
    <div class="course-card learning-card" data-course-item data-skills="${(course.skills || []).join(',')}">
      <div class="course-art blue-art">
        <span>${escapeHtml(course.provider || 'iGOT')}</span>
        <i>📚</i>
      </div>
      <div class="course-info">
        <div class="course-top">
          <span class="course-label">${escapeHtml(course.skills?.[0] || 'Statistical Competency')}</span>
          <span class="time">${course.duration_hours || 2} hours</span>
        </div>
        <h3>${escapeHtml(course.title)}</h3>
        <p>${escapeHtml(course.description)}</p>
        <div class="course-meta-tags mt-2">
          ${(course.skills || []).map(s => `<span class="tag-small">${escapeHtml(s)}</span>`).join(' ')}
        </div>
        <div class="course-bottom">
          <span>Instructor: ${escapeHtml(course.instructor || 'Senior Statistical Officer')}</span>
          <div class="progress-wrap">
            <div class="mini-progress"><i style="width: ${course.progress || 0}%"></i></div>
            <b>${course.progress || 0}%</b>
          </div>
          <button class="action-button update-progress-btn" data-action="continue-course" data-course-id="${course.id}">
            ${course.progress >= 100 ? 'Completed ✓' : 'Update Progress (+25%)'}
          </button>
          <a href="${escapeHtml(course.direct_link || 'https://portal.igotkarmayogi.gov.in/page/home')}" target="_blank" rel="noopener noreferrer" class="direct-link-btn">
            Open official iGOT ↗
          </a>
        </div>
      </div>
    </div>
  `).join('');

  return `
    <section class="page-hero">
      <span class="tag">CAPACITY BUILDING · iGOT KARMAYOGI INTEGRATION</span>
      <h2>My Learning Pathways</h2>
      <p>Targeted courses mapped to official statistical competencies. Progress is tracked and logged in your capacity building record.</p>
    </section>

    ${recommendedCourses.length ? `
      <section class="igot-recommendations mb-4">
        <div class="recommendations-header">
          <p class="eyebrow">FROM YOUR PDF QUIZ &amp; ASSESSMENT</p>
          <h3>Recommended learning pathway</h3>
          <p>These courses were selected using the uploaded PDF topic and your assessed competency focus.</p>
        </div>
      </section>
    ` : ''}

    <div class="learning-filter-bar">
      ${filterButtons}
    </div>

    <div class="course-list mt-4" id="learningCourseList">
      ${coursesHtml}
    </div>
  `;
}

// 4. Skills Assessment Page
function renderAssessmentPage() {
  const questions = state.assessmentData?.questions || [];

  if (state.assessmentResult) {
    const res = state.assessmentResult;
    return `
      <section class="page-hero">
        <span class="tag">ASSESSMENT RESULT</span>
        <h2>Assessment Complete</h2>
        <p>Your results have been processed and your competency radar has been updated in real-time.</p>
      </section>

      <div class="assessment-result-panel">
        <div class="result-score-badge ${res.score >= 70 ? 'high' : 'medium'}">
          ${res.score}%
        </div>
        <h2>${res.score >= 70 ? 'Proficiency Benchmark Achieved!' : 'Competency Gaps Identified'}</h2>
        <p class="result-summary-text">
          You scored <b>${res.correctCount}</b> out of <b>${res.total}</b> questions correct.
        </p>

        <div class="gap-update-box">
          <p class="eyebrow">UPDATED COMPETENCY GAPS</p>
          <div class="gap-tags">
            ${res.gaps.map(g => `<span class="gap-pill">${escapeHtml(g)}</span>`).join('')}
          </div>
        </div>

        <div class="result-cta-group mt-4">
          <button class="primary" data-nav="Competency Profile">View Updated Radar Chart →</button>
          <button class="secondary-btn" data-nav="My Learning">Explore Targeted Courses</button>
          <button class="link-button" id="retakeAssessmentBtn">Retake Assessment</button>
        </div>
      </div>
    `;
  }

  const questionsHtml = questions.map((q, idx) => `
    <fieldset class="assessment-question-box">
      <legend>
        <span class="q-num">${idx + 1}</span>
        <b>${escapeHtml(q.question)}</b>
      </legend>
      <small class="q-skill">Mapped Competency: ${escapeHtml(q.skill)}</small>
      <div class="options-container">
        ${q.options.map((opt, oIdx) => `
          <label class="option-label">
            <input type="radio" name="q_${idx}" value="${oIdx}" ${state.assessmentAnswers[idx] === oIdx ? 'checked' : ''} required>
            <span>${escapeHtml(opt)}</span>
          </label>
        `).join('')}
      </div>
    </fieldset>
  `).join('');

  return `
    <section class="page-hero">
      <span class="tag">OFFICIAL STATISTICS SKILL CHECK · 5 QUESTIONS</span>
      <h2>Official Statistics Skills Assessment</h2>
      <p>Answer the 5 scenario-based questions below to evaluate your competency in Sampling, Data Visualization, Interpretation, and Ethics.</p>
    </section>

    <form class="assessment-form" id="assessmentForm">
      ${questionsHtml}
      <div class="assessment-submit-bar">
        <button class="primary" type="submit" id="submitAssessmentBtn">
          Submit Assessment &amp; Update Gaps →
        </button>
      </div>
    </form>
  `;
}

// 5. AI Quiz Studio Page
function renderQuizStudioPage() {
  const competencies = state.profile.length
    ? state.profile.map(p => p.competency)
    : ['Sampling Design & Weighting', 'Data Visualization', 'Data Interpretation', 'Survey Data Cleaning'];

  const competencyOptionsHtml = competencies.map(c =>
    `<option value="${escapeHtml(c)}" ${c === state.selectedCompetency ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');

  let quizDisplayHtml = `
    <div class="empty-state">
      <span>✦</span>
      <h3>Ready to Generate AI Quiz</h3>
      <p>Choose a topic and competency above, or select an indexed manual to generate 5 targeted explanatory MCQs.</p>
    </div>
  `;

  if (state.activeQuiz && state.activeQuiz.length) {
    if (state.quizResult) {
      quizDisplayHtml = `
        <div class="evaluation-card">
          <span class="result-score ${state.quizResult.score_percentage >= 70 ? 'high' : ''}">
            ${state.quizResult.score_percentage}%
          </span>
          <p class="eyebrow">${escapeHtml(state.quizResult.competency)}</p>
          <h2>${escapeHtml(state.quizResult.status)}</h2>
          <p>You scored <b>${state.quizResult.score_percentage}%</b> on this AI-generated quiz. Competency progress has been logged for officer <b>${escapeHtml(state.officer.id)}</b>.</p>
          ${(state.learningRecommendations || []).length ? `
  <div class="igot-recommendations">
    <div class="recommendations-header">
      <p class="eyebrow">RECOMMENDED FOR IMPROVEMENT</p>
      <h3>iGOT Karmayogi Learning Resources</h3>
      <p class="text-muted">
        Strengthen your ${escapeHtml(state.quizResult.competency)} skills with these targeted learning resources.
      </p>
    </div>

    <div class="recommendations-grid">
      ${state.learningRecommendations.slice(0, 3).map(course => `
        <article class="recommendation-card">
          <div class="recommendation-icon">📘</div>

          <div class="recommendation-content">
            <span class="course-label">
              ${escapeHtml(course.provider || 'iGOT Karmayogi')}
            </span>

            <h4>${escapeHtml(course.title)}</h4>

            <p>${escapeHtml(course.description || 'Targeted learning resource for competency development.')}</p>

            <div class="recommendation-meta">
              <span>⏱ ${escapeHtml(String(course.duration_hours || 1))} hours</span>
            </div>

            <a
              href="${escapeHtml(course.direct_link || 'https://portal.igotkarmayogi.gov.in/page/home')}"
              target="_blank"
              rel="noopener noreferrer"
              class="direct-link-btn"
            >
              Open on iGOT ↗
            </a>
          </div>
        </article>
      `).join('')}
    </div>
  </div>
          ` : `
            <div class="igot-recommendations">
              <div class="recommendations-header">
                <p class="eyebrow">LEARNING RECOMMENDATION</p>
                <h3>Explore relevant iGOT Karmayogi courses</h3>
                <p>We could not find an exact catalogue match yet. Browse iGOT Karmayogi for courses related to this uploaded PDF.</p>
              </div>
              <button type="button" data-nav="My Learning" class="direct-link-btn">View recommended courses →</button>
            </div>
          `}
          <div class="hero-buttons mt-4 justify-center">
            <button class="primary" data-nav="Competency Profile">View Competency Profile →</button>
            <button class="secondary-btn" id="generateNewQuizBtn">Generate Another Quiz</button>
          </div>
        </div>
      `;
    } else {
      quizDisplayHtml = `
        <form id="quizRunForm" class="question-list">
          <div class="quiz-run-header">
            <h3>Targeted Questions</h3>
            <p class="text-xs text-muted">Click an option to test your knowledge. Explanations reveal upon selection or submission.</p>
          </div>
          ${state.activeQuiz.map((q, qIdx) => `
            <fieldset class="quiz-q-block" data-q-id="${q.id}">
              <legend><span>${qIdx + 1}</span> ${escapeHtml(q.question)}</legend>
              <small class="text-muted ml-6 block mb-2">${escapeHtml(q.competency || 'Official Statistics')}</small>
              <div class="quiz-options-group">
                ${(q.options || []).map(opt => `
                  <label class="quiz-option-label">
                    <input type="radio" name="quiz_q_${q.id}" value="${escapeHtml(opt.id)}" required>
                    <b>${escapeHtml(opt.id)}.</b> ${escapeHtml(opt.text)}
                  </label>
                `).join('')}
              </div>
              <div class="explanation" id="exp_${q.id}">
                <b>Explanation:</b> ${escapeHtml(q.explanation)}
              </div>
            </fieldset>
          `).join('')}
          <div class="quiz-action-bar">
            <button class="primary" type="submit">Submit Answers for Evaluation →</button>
          </div>
        </form>
      `;
    }
  }

  return `
    <section class="page-hero">
      <span class="tag">AI GENERATION</span>
      <h2>AI Quiz Studio</h2>
      <p>Generate explainable competency MCQs from official manuals or topic prompts using the deterministic local generation service.</p>
    </section>

    <div class="quiz-studio quiz-studio-single">
      <form id="quizStudioConfigForm" class="quiz-config">
        <label>
          Subject / Topic
          <input name="topic" id="quizTopicInput" value="Stratified Sampling" required placeholder="e.g. Stratified Sampling">
        </label>

        <label>
          Competency Area
          <select name="competency" id="quizCompetencySelect">
            ${competencyOptionsHtml}
          </select>
        </label>

        <label>
          Number of Questions
          <select name="num_questions" id="quizNumSelect">
            <option value="5" selected>5 questions</option>
            <option value="10">10 questions</option>
          </select>
        </label>

        <label>
          Source Material
          <select name="sourceDoc" id="quizSourceDocSelect">
            <option value="">Official Statistics Framework (Default)</option>
            ${(state.documents || []).map(d => `<option value="${escapeHtml(d.id)}" ${d.id === state.selectedSourceDocumentId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </label>

        <button class="primary" type="submit" id="generateQuizBtn">
          Generate Quiz →
        </button>
      </form>

      <div class="quiz-area" id="quizArea">
        ${quizDisplayHtml}
      </div>
    </div>
  `;
}

// 6. Manual Library Page
function renderLibraryPage() {
  const documentsHtml = (state.documents || []).map(doc => `
    <div class="resource-card">
      <span>📄</span>
      <div class="resource-card-info">
        <small>${escapeHtml(doc.size || '2.0 MB')} · ${new Date(doc.uploadedAt).toLocaleDateString('en-GB')}</small>
        <h3>${escapeHtml(doc.name)}</h3>
        <p>Status: <b class="text-success">${escapeHtml(doc.status || 'Indexed')}</b></p>
        <div class="doc-topics mt-2">
          ${(doc.topics || []).map(t => `<span class="tag-small">${escapeHtml(t)}</span>`).join(' ')}
        </div>
        <button class="link-button mt-2" data-generate-from-doc="${escapeHtml(doc.name)}">
          Generate Quiz from this manual →
        </button>
      </div>
    </div>
  `).join('');

  return `
    <section class="page-hero">
      <h2>Official Training Manuals Library</h2>
      <p>Upload and manage approved statistical guidelines, survey manuals, and standard operating procedures to power AI quiz generation.</p>
    </section>

    <div class="upload-panel">
      <label class="drop-zone" for="manualFileInput" id="dropZone">
        <span>📁</span>
        <b>Select or Drop an Official PDF Manual</b>
        <small>PDF format · File validated, virus-scanned, and indexed for competency quizzes</small>
      </label>
      <input id="manualFileInput" type="file" accept="application/pdf,.pdf" hidden>

      <div id="uploadStatusText" class="upload-status">No manual selected.</div>
      <button id="uploadManualBtn" class="primary" disabled>Upload &amp; Index Manual →</button>
    </div>

    <div class="security-note">
      <b>Privacy, Security &amp; Data Governance</b>
      <p>Upload only approved, non-confidential official guidelines. All uploaded materials are chunked, validated, and retained in accordance with national public data protection standards.</p>
    </div>

    <div class="section-heading mt-6">
      <h2>Indexed Training Manuals (${state.documents.length})</h2>
      <button class="secondary-btn" id="clearDocumentsBtn" type="button" ${state.documents.length ? '' : 'disabled'}>Clear library</button>
    </div>
    <div class="resource-grid">
      ${documentsHtml}
    </div>
  `;
}

// 7. Team Insights Page
function renderInsightsPage() {
  const a = state.analytics || {
    department: 'MoSPI Statistics Division',
    officials: 124,
    completion: 72,
    averageScore: 74,
    priorityGaps: [
      { name: 'Data Visualization', officials: 61 },
      { name: 'Statistical Methods', officials: 44 },
      { name: 'Data Interpretation', officials: 32 },
      { name: 'Sampling Design', officials: 28 }
    ],
    adoption: [38, 46, 54, 63, 72, 81]
  };

  const gapBarsHtml = (a.priorityGaps || []).map(gap => {
    const pct = Math.round((gap.officials / a.officials) * 100);
    return `
      <div class="gap-row">
        <span>${escapeHtml(gap.name)}</span>
        <div><i style="width: ${pct}%"></i></div>
        <b>${gap.officials} officials (${pct}%)</b>
      </div>
    `;
  }).join('');

  const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
  const trendBarsHtml = (a.adoption || [40, 50, 60, 70, 75, 80]).map((val, idx) => `
    <div>
      <i style="height: ${val}%"></i>
      <span>${months[idx] || 'M'} (${val}%)</span>
    </div>
  `).join('');

  return `
    <section class="page-hero">
      <span class="tag">ADMINISTRATIVE ANALYTICS</span>
      <h2>Team Insights &amp; Capacity Analytics</h2>
      <p>Department-wide overview of competency growth, assessment scores, and training adoption across the statistical service.</p>
    </section>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon purple">👥</div>
        <div>
          <p>Total Officials</p>
          <h3>${a.officials}</h3>
          <span class="trend">Registered in division</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon teal">✓</div>
        <div>
          <p>Division Completion</p>
          <h3>${a.completion}%</h3>
          <span class="trend">+8% this quarter</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber">★</div>
        <div>
          <p>Average Score</p>
          <h3>${a.averageScore}%</h3>
          <span class="trend">Competency benchmark: 75%</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon coral">⚠</div>
        <div>
          <p>Top Priority Gap</p>
          <h3>${escapeHtml(a.priorityGaps?.[0]?.name || 'Visualization')}</h3>
          <span class="trend">${a.priorityGaps?.[0]?.officials || 61} officials need focus</span>
        </div>
      </div>
    </div>

    <div class="analytics-panel mt-4">
      <div>
        <h2>Priority Competency Gaps Across Division</h2>
        <p class="text-xs text-muted mb-3">Number and proportion of officials requiring targeted training.</p>
        ${gapBarsHtml}
      </div>

      <div>
        <h2>Capacity Platform Adoption Trend</h2>
        <p class="text-xs text-muted mb-3">Percentage of officials completing monthly modules over time.</p>
        <div class="bar-chart">
          ${trendBarsHtml}
        </div>
      </div>
    </div>
  `;
}

// 8. Settings Page
function renderSettingsPage() {
  return `
    <section class="page-hero">
      <span class="tag">USER PREFERENCES · OFFICER PROFILE</span>
      <h2>Officer Preferences &amp; Settings</h2>
      <p>Configure notifications, learning pace, and personal learning preferences.</p>
    </section>

    <div class="settings-card">
      <form id="settingsForm">
        <label>
          Officer Name
          <input type="text" value="${escapeHtml(state.officer.name)}" name="name" required>
        </label>

        <label>
          Role / Designation
          <input type="text" value="${escapeHtml(state.officer.role)}" name="role" required>
        </label>

        <label>
          Department / Division
          <input type="text" value="${escapeHtml(state.officer.org)}" name="org" required>
        </label>

        <div class="settings-toggle-group mt-3">
          <label class="toggle">
            <input type="checkbox" checked name="notifyEmail">
            <span>Receive weekly competency gap digest</span>
          </label>

          <label class="toggle">
            <input type="checkbox" checked name="notifyCourses">
            <span>Notify when new iGOT Karmayogi courses align with my gaps</span>
          </label>

          <label class="toggle">
            <input type="checkbox" checked name="autoQuiz">
            <span>Suggest AI quizzes following manual uploads</span>
          </label>
        </div>

        <button class="primary mt-4" type="submit">Save Preferences →</button>
      </form>
    </div>
  `;
}

// Render the active view
function renderView(pageId) {
  state.currentPage = pageId;
  state.mobileMenuOpen = false;

  let content = '';
  switch (pageId) {
    case 'Competency Profile':
      content = renderProfilePage();
      break;
    case 'My Learning':
      content = renderLearningPage();
      break;
    case 'Skills Assessment':
      content = renderAssessmentPage();
      break;
    case 'Quiz Studio':
      content = renderQuizStudioPage();
      break;
    case 'Manual Library':
      content = renderLibraryPage();
      break;
    case 'Team Insights':
      content = renderInsightsPage();
      break;
    case 'Settings':
      content = renderSettingsPage();
      break;
    case 'Overview':
    default:
      content = renderOverviewPage();
      break;
  }

  app.innerHTML = layoutShell(pageId, content);
  bindEvents();
}

// Bind DOM event listeners
function bindEvents() {
  // Navigation clicks
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = btn.getAttribute('data-nav');
      renderView(target);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Mobile drawer toggle
  const mobileToggle = document.getElementById('mobileMenuToggle');
  const mobileClose = document.getElementById('mobileCloseBtn');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      state.mobileMenuOpen = true;
      document.querySelector('.sidebar')?.classList.add('open');
      document.getElementById('sidebarBackdrop')?.classList.add('show');
    });
  }

  const closeMenu = () => {
    state.mobileMenuOpen = false;
    document.querySelector('.sidebar')?.classList.remove('open');
    document.getElementById('sidebarBackdrop')?.classList.remove('show');
  };

  if (mobileClose) mobileClose.addEventListener('click', closeMenu);
  if (backdrop) backdrop.addEventListener('click', closeMenu);

  // Competency click in profile
  document.querySelectorAll('[data-select-competency]').forEach(elem => {
    elem.addEventListener('click', () => {
      const comp = elem.getAttribute('data-select-competency');
      state.selectedCompetency = comp;
      renderView('Competency Profile');
    });
  });

  document.querySelectorAll('[data-find-courses]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const comp = btn.getAttribute('data-find-courses');
      state.selectedCompetency = comp;
      renderView('My Learning');
      notify(`Showing courses for ${comp}`);
    });
  });

  // Continue / Update Course Progress
  document.querySelectorAll('[data-action="continue-course"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const courseId = btn.getAttribute('data-course-id');
      btn.disabled = true;
      btn.textContent = 'Updating…';

      try {
        const res = await backend.updateProgress(courseId, 25, 30);
        // Update state locally
        const course = state.courses.find(c => c.id === courseId);
        if (course) {
          course.progress = Math.min(100, (course.progress || 0) + 25);
        }
        state.officer.hours = res.learningTime || state.officer.hours + 0.5;
        notify(`Progress logged: +25% & +30 min learning time.`, 'success');
        renderView(state.currentPage);
      } catch (err) {
        notify(`Failed to update progress: ${err.message}`, 'error');
      }
    });
  });

  // Course filter chips
  document.querySelectorAll('[data-filter-course]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-course]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.getAttribute('data-filter-course');
      const items = document.querySelectorAll('[data-course-item]');
      items.forEach(item => {
        const skills = item.getAttribute('data-skills') || '';
        if (filter === 'All Competencies' || skills.includes(filter)) {
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });
    });
  });

  // Skills Assessment Form Submission
  const assessmentForm = document.getElementById('assessmentForm');
  if (assessmentForm) {
    assessmentForm.addEventListener('change', (e) => {
      const fd = new FormData(assessmentForm);
      state.assessmentAnswers = {};
      for (const [key, val] of fd.entries()) {
        const idx = Number(key.replace('q_', ''));
        state.assessmentAnswers[idx] = Number(val);
      }
    });

    assessmentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitAssessmentBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Grading Assessment…';
      }

      const answersArray = [];
      const count = state.assessmentData?.questions?.length || 5;
      for (let i = 0; i < count; i++) {
        answersArray.push(state.assessmentAnswers[i] ?? 0);
      }

      try {
        const res = await backend.submitAssessment(answersArray);
        state.assessmentResult = res;
        state.officer.score = res.score;
        state.officer.gaps = res.gaps || state.officer.gaps;
        if (res.radar) state.profile = res.radar;
        notify(`Assessment complete! Score: ${res.score}%`, 'success');
        renderView('Skills Assessment');
      } catch (err) {
        notify(`Submission failed: ${err.message}`, 'error');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Submit Assessment & Update Gaps →';
        }
      }
    });
  }

  // Retake Assessment button
  document.getElementById('retakeAssessmentBtn')?.addEventListener('click', () => {
    state.assessmentResult = null;
    state.assessmentAnswers = {};
    renderView('Skills Assessment');
  });

  // AI Quiz Studio Generation Form
 const quizForm = document.getElementById('quizStudioConfigForm');

if (quizForm) {
  quizForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = document.getElementById('generateQuizBtn');
    const quizArea = document.getElementById('quizArea');
    const topic = document.getElementById('quizTopicInput').value;
    const competency = document.getElementById('quizCompetencySelect').value;
    const numQuestions = Number(document.getElementById('quizNumSelect').value);
    const sourceDocumentId = document.getElementById('quizSourceDocSelect').value;
    const sourceDocument = state.documents.find(doc => doc.id === sourceDocumentId);
    const sourceName = sourceDocument?.name || 'General Framework';

    // Preserve the chosen manual when the quiz page re-renders after generation.
    state.selectedSourceDocumentId = sourceDocumentId;

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generating with AI…';
    }

    if (quizArea) {
      quizArea.innerHTML = `<div class="loading-card"><div class="spinner"></div> Generating 5 explanatory MCQs for ${escapeHtml(topic)}…</div>`;
    }

    try {
      const res = await backend.generateQuiz({
        topic,
        competency,
        num_questions: numQuestions,
        sourceName,
        sourceDocumentId
      });

      state.activeQuiz = res.questions || res.quiz || [];
      state.quizResult = null;
      state.quizAnswers = {};

      notify(`Quiz generated on ${topic}!`, 'success');
      renderView('Quiz Studio');

    } catch (err) {
      console.error('Quiz generation error:', err);

      notify(`Quiz generation failed: ${err.message}`, 'error');

      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Generate AI Quiz →';
      }
    }
  });
}

  // Quiz Run / Answer Submission
  const quizRunForm = document.getElementById('quizRunForm');
  if (quizRunForm) {
    quizRunForm.addEventListener('change', (e) => {
      if (e.target.type === 'radio') {
        const fieldset = e.target.closest('fieldset');
        const qId = fieldset?.getAttribute('data-q-id');
        if (qId) {
          state.quizAnswers[qId] = e.target.value;
          // Show explanation on answer
          const exp = document.getElementById(`exp_${qId}`);
          if (exp) exp.classList.add('show');
        }
      }
    });

    quizRunForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const unanswered = state.activeQuiz.filter(q => !state.quizAnswers[q.id]);
      if (unanswered.length) {
        notify(`Answer all ${unanswered.length} remaining question${unanswered.length === 1 ? '' : 's'} before submitting.`, 'error');
        return;
      }
      const btn = quizRunForm.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Evaluating Answers…';
      }

      const submissions = state.activeQuiz.map(q => ({
        question_id: q.id,
        selected_option_id: state.quizAnswers[q.id],
        correct_option_id: q.answer
      }));

      try {
        const res = await backend.evaluateQuiz({
  officer_id: state.officer.id,
  competency: state.selectedCompetency,
  submissions
});

state.quizResult = res;
// The dashboard assessment card reflects the latest completed quiz.
state.officer.score = res.score_percentage;

// Find the PDF used for this quiz.
const recommendationDocument = state.documents.find(
  doc => doc.id === state.selectedSourceDocumentId
);

// Use the indexed PDF topic first.
// This prevents a Cyber Security PDF from being treated as
// an unrelated competency-only quiz.
const recommendationTopic =
  recommendationDocument?.topics?.[0] ||
  state.quizResult.topic ||
  document.getElementById('quizTopicInput')?.value ||
  '';

try {
  state.learningRecommendations = await backend.recommendations(
    state.quizResult.competency || state.selectedCompetency,
    recommendationTopic
  );
} catch (recommendationError) {
  console.warn('iGOT recommendations unavailable:', recommendationError);
  state.learningRecommendations = [];
}
        state.officer.streak += 1;
        notify(`Quiz evaluated! Score: ${res.score_percentage}%`, 'success');
        renderView('Quiz Studio');
      } catch (err) {
        notify(`Evaluation error: ${err.message}`, 'error');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Submit Answers for Evaluation →';
        }
      }
    });
  }

  // Generate new quiz button in evaluation card
  document.getElementById('generateNewQuizBtn')?.addEventListener('click', () => {
    state.quizResult = null;
    state.activeQuiz = [];
    renderView('Quiz Studio');
  });

  // Manual File Upload
  const fileInput = document.getElementById('manualFileInput');
  const uploadBtn = document.getElementById('uploadManualBtn');
  const uploadStatus = document.getElementById('uploadStatusText');

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        if (uploadStatus) uploadStatus.textContent = `${file.name} · ${sizeMb} MB ready to upload`;
        if (uploadBtn) uploadBtn.disabled = false;
      } else {
        if (uploadStatus) uploadStatus.textContent = 'No manual selected.';
        if (uploadBtn) uploadBtn.disabled = true;
      }
    });
  }

  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      const file = fileInput?.files?.[0];
      if (!file) return;

      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading & Scanning…';

      try {
        const res = await backend.uploadManual(file, 'Official Statistics');
        if (res.document) {
          state.documents.unshift(res.document);
          state.selectedSourceDocumentId = res.document.id;
        }
        notify(`${file.name} uploaded and indexed successfully.`, 'success');
        renderView('Manual Library');
      } catch (err) {
        notify(`Upload failed: ${err.message}`, 'error');
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Index Manual →';
      }
    });
  }

  document.getElementById('clearDocumentsBtn')?.addEventListener('click', async () => {
    if (!state.documents.length || !window.confirm('Remove all indexed manuals from this library? This cannot be undone.')) return;
    const button = document.getElementById('clearDocumentsBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Clearing…';
    }
    try {
      await backend.clearDocuments();
      state.documents = [];
      state.selectedSourceDocumentId = '';
      notify('All indexed manuals were removed.', 'success');
      renderView('Manual Library');
    } catch (err) {
      notify(`Could not clear the library: ${err.message}`, 'error');
      if (button) {
        button.disabled = false;
        button.textContent = 'Clear library';
      }
    }
  });

  // Generate quiz from document card
  document.querySelectorAll('[data-generate-from-doc]').forEach(btn => {
    btn.addEventListener('click', () => {
      const docName = btn.getAttribute('data-generate-from-doc');
      const doc = state.documents.find(item => item.name === docName);
      state.selectedSourceDocumentId = doc?.id || '';
      renderView('Quiz Studio');
      const topicInput = document.getElementById('quizTopicInput');
      if (topicInput) topicInput.value = docName.replace('.pdf', '').replaceAll('_', ' ');
      notify(`Configured quiz for ${docName}`);
    });
  });

  // Settings form
  const settingsForm = document.getElementById('settingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(settingsForm);
      state.officer.name = fd.get('name') || state.officer.name;
      state.officer.role = fd.get('role') || state.officer.role;
      state.officer.org = fd.get('org') || state.officer.org;
      notify('Preferences saved successfully.', 'success');
      renderView('Settings');
    });
  }

  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('pragati-session');
    state.authenticatedUser = null;
    renderAuthScreen();
  });
}

// Initial Data Bootstrapper
async function initApp() {
  if (!state.authenticatedUser) {
    renderAuthScreen();
    return;
  }

  applyAuthenticatedUser(
    state.authenticatedUser.user || state.authenticatedUser
  );

  // Show the application immediately.
  renderView('Overview');

  // Load dashboard data in the background.
  try {
    const dash = await backend.getDashboard();

    if (dash.courses) state.courses = dash.courses;
    if (dash.radar) state.profile = dash.radar;
    if (dash.analytics) state.analytics = dash.analytics;

    if (dash.user) {
      state.officer = {
        ...state.officer,
        id: dash.user.id || state.officer.id,
        name: dash.user.name || state.officer.name,
        initials: dash.user.initials || state.officer.initials,
        role: dash.user.role || state.officer.role,
        org: dash.user.organization || state.officer.org,
        streak: dash.user.learningStreak ?? state.officer.streak,
        hours: dash.user.learningTime ?? state.officer.hours,
        score: dash.user.assessmentScore ?? state.officer.score,
        skillsMastered: dash.user.skillsMastered ?? state.officer.skillsMastered,
        gaps: dash.user.gaps || state.officer.gaps
      };
    }

    renderView('Overview');
  } catch (e) {
    console.warn('Dashboard fetch notice:', e);
  }

  // Load other data independently.
  try {
    const prof = await backend.competencyProfile(state.officer.id);

    if (prof.radar_data) {
      state.profile = prof.radar_data;
    }

    if (state.profile[0]) {
      state.selectedCompetency = state.profile[0].competency;
    }
  } catch (e) {
    console.warn('Profile fetch notice:', e);
  }

  try {
    state.assessmentData = await backend.getAssessment();
  } catch (e) {
    console.warn('Assessment fetch notice:', e);
  }

  try {
    state.documents = await backend.getDocuments();
  } catch (e) {
    console.warn('Documents fetch notice:', e);
  }

  // Refresh the currently visible page with loaded data.
  renderView(state.currentPage || 'Overview');
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  initApp().catch(err => {
    console.error('Pragati AI startup error:', err);

    const app = document.getElementById('app');

    if (app) {
      app.innerHTML = `
        <div style="padding:40px;text-align:center;font-family:Arial">
          <h2>Pragati AI could not start</h2>
          <p>${escapeHtml(err?.message || 'Unknown startup error')}</p>
          <button onclick="location.reload()">Reload</button>
        </div>
      `;
    }
  });
});
