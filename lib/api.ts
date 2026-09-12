export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4174');
export type RadarPoint = { competency: string; current_score: number; required_benchmark: number };
export type QuizQuestion = { id: number | string; question: string; competency: string; options: { id: string; text: string }[] };
export type Course = { title: string; provider: string; duration_hours: number; direct_link: string };
export type Document = { id: string; name: string; topics: string[]; status: string };
async function request<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(`${API_BASE_URL}${path}`, init); if (!response.ok) { let message = `Request failed (${response.status})`; try { const data = await response.json(); message = data.detail ?? data.message ?? message; } catch {} throw new Error(message); } return response.json() as Promise<T>; }
export const api = {
  profile: async (officerId: string) => request<{ radar_data: RadarPoint[] }>(`/competencies/profile/${officerId}`),
  recommendations: (competency: string) => request<Course[]>(`/igot/recommendations/${encodeURIComponent(competency)}`),
  generateQuiz: (payload: { topic: string; competency: string; num_questions: number; sourceDocumentId?: string; sourceName?: string }) => request<QuizQuestion[] | { questions: QuizQuestion[] }>('/quiz/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  evaluateQuiz: (payload: { officer_id: string; competency: string; submissions: { question_id: number | string; selected_option_id: string }[] }) => request<{ competency: string; score_percentage: number; status: string }>('/quiz/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  getDocuments: () => request<Document[]>('/documents'),
  uploadManual: (file: File) => { const form = new FormData(); form.append('file', file); return request<{ document: Document }>('/documents/upload', { method: 'POST', body: form }); }
};
