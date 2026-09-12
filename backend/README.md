# Pragati FastAPI backend

This backend exposes validated REST APIs, PDF ingestion with `pypdf`, ChromaDB retrieval, Sentence-Transformers embeddings, and a configurable OpenAI-compatible Llama 3 or Mistral endpoint. LangChain packages are included for agent/pipeline extensions; the runtime uses a small explicit adapter to keep the request path predictable.

## Run locally

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn main:app --reload --port 8000
```

Open [Swagger UI](http://localhost:8000/docs). Configure `LLM_BASE_URL` in `.env` for an OpenAI-compatible Llama 3 or Mistral serving endpoint. Without it, ingestion and source-grounded deterministic quiz generation remain available; `/api/llm/completions` returns a clear 503 configuration error.

## Main endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/documents` | Validated multipart PDF upload and ChromaDB indexing |
| `GET` | `/api/documents` | List indexed documents |
| `POST` | `/api/quizzes/generate` | Source-grounded quiz generation; requires `source_document_id` |
| `POST` | `/api/quizzes/evaluate` | Validated quiz submission scoring |
| `POST` | `/api/llm/completions` | Llama 3/Mistral endpoint proxy |
