// Unified API client for Pragati AI MVP
// Automatically connects to current host origin (e.g. http://localhost:4174) with graceful fallbacks.
export const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin && !window.location.origin.startsWith('file:'))
  ? window.location.origin
  : 'http://localhost:4174';

async function request(path, options = {}) {
  try {
    const url = `${API_BASE_URL}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      let detail = `Request failed (${response.status})`;
      try {
        const body = await response.json();
        detail = body.detail || body.error || body.message || detail;
      } catch {
        /* non-JSON error */
      }
      throw new Error(detail);
    }

    return await response.json();
  } catch (error) {
    console.warn(`[Pragati API] Notice on ${path}:`, error.message);
    throw error;
  }
}

export const backend = {
  getHealth: () => request('/api/health'),

  signUp: ({ username, email, password, role, organization }) =>
    request('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password, role, organization }) }),

  login: ({ identifier, password }) =>
    request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) }),

  getMe: () => request('/api/me'),

  getDashboard: () => request('/api/dashboard'),

  competencyProfile: (officerId = 'OFFICER_001') =>
    request(`/api/competencies/profile/${encodeURIComponent(officerId)}`),

  recommendations: (competency = '', topic = '') =>
  request(
    `/igot/recommendations/${encodeURIComponent(competency)}?topic=${encodeURIComponent(topic)}`
  ),

  getCourses: () => request('/api/courses'),

  getAssessment: () => request('/api/assessment'),

  submitAssessment: (answers = []) =>
    request('/api/assessment/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers })
    }),

  updateProgress: (courseId, progressIncrement = 25, minutes = 30) =>
    request('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, progressIncrement, minutes })
    }),

  generateQuiz: ({ topic = 'Official Statistics', competency = 'Statistical Methods', num_questions = 5, sourceName = 'Manual', sourceDocumentId } = {}) =>
    request('/api/quiz/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, competency, num_questions, sourceName, sourceDocumentId })
    }),

  evaluateQuiz: ({ officer_id = 'OFFICER_001', competency = 'Statistical Methods', submissions = [] }) =>
    request('/api/quiz/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ officer_id, competency, submissions })
    }),

  getDocuments: () => request('/api/documents'),

  clearDocuments: () => request('/api/documents', { method: 'DELETE' }),

  uploadManual: (file, topic = 'Official Statistics') => {
    const form = new FormData();
    form.append('file', file);
    form.append('topic', topic);
    return request('/api/documents/upload', { method: 'POST', body: form });
  },

  getAnalytics: () => request('/api/admin/analytics')
};
