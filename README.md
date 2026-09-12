# Pragati AI — SIH MVP

Pragati AI is a local full-stack prototype for the Smart India Hackathon problem statement: an AI-enabled learning platform that identifies competency gaps, recommends personalised training, and generates quizzes from learning materials for officials working with official statistics.

## Run locally

Use the bundled Node runtime or any Node.js 18+ installation:

```powershell
node server.js
```

Open `http://localhost:4174` in your browser.

No complex setup or external databases required. The server provides the complete UI and a JSON-backed local API with zero dependencies.

## Working demo flows

1. **Dashboard (Overview)**: Real-time learner metrics (streak, learning hours, assessment score, skills mastered), responsive competency radar snapshot, active learning pathways with progress, and upcoming MoSPI training events.
2. **Competency Radar Profile**: High-resolution interactive SVG radar chart comparing current officer scores against required role benchmarks, competency breakdown with proficiency tags, and direct one-click course finding.
3. **My Learning Pathways**: In-progress and recommended iGOT Karmayogi courses with competency filters, external course links, and an interactive **Update Progress (+25%)** button that persists progress and learning hours to the backend.
4. **Skills Assessment**: 5-question Official Statistics assessment. Submitting answers dynamically scores the test, recalculates competency gaps, updates skills mastered, and refreshes course recommendations in real time.
5. **AI Quiz Studio**: Configurable MCQ generator supporting custom topics, competencies, question counts, and source document context. Includes an interactive test runner with real-time explanation reveals and scoring evaluation.
6. **Official Training Manuals Library**: Document ingestion zone supporting PDF manual uploads, indexing simulations, data governance/privacy advisory, and a library of available guidelines.
7. **Team Insights**: Administrative division analytics featuring total officials enrolled, division completion rates, average scores, priority competency gap distribution bars, and platform adoption trend graphs.
8. **Officer Settings**: Profile customization (name, designation, division, notification and digest preferences) with instant feedback.

## API Surface

- `GET /api/health` — Service health check and timestamp.
- `POST /api/auth/login` & `GET /api/me` — Mock officer session authentication.
- `GET /api/dashboard` — Complete dashboard payload (user, courses, recommendations, events, skills, radar).
- `GET /api/courses` — Full course catalog.
- `GET /api/assessment` & `POST /api/assessment/submit` — Skill assessment retrieval and dynamic scoring.
- `POST /api/progress` — Record course completion increment and learning hours.
- `GET /competencies/profile/:officerId` — Competency radar coordinates and role benchmarks.
- `GET /igot/recommendations/:competency` — Filtered iGOT Karmayogi course recommendations.
- `POST /quiz/generate` & `POST /quiz/evaluate` — AI MCQ generation and submission scoring.
- `GET /documents` & `POST /documents/upload` — Ingestion and listing of training manuals.
- `GET /api/admin/analytics` — Aggregated divisional capacity metrics.

## Mobile & Cross-Device Responsiveness

The interface is designed and tested for seamless responsiveness:
- **Desktop (>1024px)**: Full multi-column dashboard with fixed sidebar and side-by-side radar and analytics panels.
- **Tablet (768px – 1024px)**: Adaptive 2-column layouts and flexible card grids.
- **Mobile (<768px)**: Clean mobile header with brand badge, slide-in drawer navigation with backdrop overlay, full-width touch-friendly cards, responsive SVG radar chart scaling, and single-column form layouts.

## Production Integration Points

This runnable MVP uses an embedded JSON store and deterministic local generation for hackathon demonstration. For production deployment, connect:
- PostgreSQL or SQLite with Prisma/Drizzle for relational data and audit logs.
- OAuth2/SSO with Parichay/Jan Parichay or MoSPI central directory.
- Official iGOT Karmayogi API integration for real-time course catalogs and enrollments.
- Multi-modal document ingestion pipeline (OCR, chunking, vector embeddings) backed by an enterprise LLM (e.g. Gemini 1.5 Pro).
