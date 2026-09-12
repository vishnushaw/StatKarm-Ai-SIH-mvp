from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import re

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from schemas import (DocumentSummary, EvaluateQuizRequest, GenerateQuizRequest, GenerateQuizResponse, HealthResponse, LLMCompletionRequest, LLMCompletionResponse, QuizQuestion, QuizOption)
from services import DocumentStore, LLMClient, settings

app = FastAPI(title=settings.app_name, version="1.0.0", description="Validated REST API with ChromaDB retrieval and configurable Llama 3/Mistral inference.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4174", "http://127.0.0.1:4174"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
documents = DocumentStore()
llm = LLMClient()


def document_response(record: dict) -> DocumentSummary:
    return DocumentSummary(id=record["id"], name=record["name"], size=record["size"], uploaded_at=record.get("uploaded_at", datetime.now(UTC)), status=record["status"], topics=record["topics"], extracted_characters=record["extracted_characters"])


@app.get("/api/health", response_model=HealthResponse, tags=["System"])
async def health() -> HealthResponse:
    return HealthResponse(service=settings.app_name, timestamp=datetime.now(UTC))


@app.post("/api/documents", response_model=DocumentSummary, status_code=201, tags=["Documents"])
@app.post("/documents/upload", response_model=DocumentSummary, status_code=201, include_in_schema=False)
async def upload_document(file: UploadFile = File(...)) -> DocumentSummary:
    if Path(file.filename or "").suffix.lower() != ".pdf":
        raise HTTPException(415, "Only PDF files are accepted.")
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(415, "The uploaded file is not a valid PDF.")
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"PDF must not exceed {settings.max_upload_mb} MB.")
    try:
        record = documents.add(file.filename, content)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, "Unable to parse this PDF.") from exc
    record["uploaded_at"] = datetime.now(UTC)
    return document_response(record)


@app.get("/api/documents", response_model=list[DocumentSummary], tags=["Documents"])
@app.get("/documents", response_model=list[DocumentSummary], include_in_schema=False)
async def list_documents() -> list[DocumentSummary]:
    return [document_response(record) for record in documents.list()]


@app.get("/api/documents/{document_id}", response_model=DocumentSummary, tags=["Documents"])
async def get_document(document_id: str) -> DocumentSummary:
    record = documents.get(document_id)
    if not record:
        raise HTTPException(404, "Document not found.")
    return document_response(record)


def deterministic_questions(context: list[str], request: GenerateQuizRequest, name: str) -> list[QuizQuestion]:
    facts = [re.sub(r"\s+", " ", value).strip() for value in context if len(value.strip()) > 20] or [f"The source material is {name}."]
    questions = []
    for index in range(request.num_questions):
        fact = facts[index % len(facts)][:900]
        questions.append(QuizQuestion(id=index + 1, question=f"According to {name}, which statement best reflects the guidance related to {request.topic or 'the uploaded material'}?", options=[QuizOption(id="A", text=fact), QuizOption(id="B", text="It is unrelated to the source manual."), QuizOption(id="C", text="The documented procedure should be ignored."), QuizOption(id="D", text="It applies only when no evidence is available.")], answer="A", explanation=f"The answer is retrieved from {name}: {fact}", competency=request.competency, source_document_id=request.source_document_id, source_name=name))
    return questions


@app.post("/api/quizzes/generate", response_model=GenerateQuizResponse, tags=["Quizzes"])
@app.post("/quiz/generate", response_model=GenerateQuizResponse, include_in_schema=False)
async def generate_quiz(request: GenerateQuizRequest) -> GenerateQuizResponse:
    if not request.source_document_id:
        raise HTTPException(422, "source_document_id is required to generate a quiz from an uploaded PDF.")
    record = documents.get(request.source_document_id)
    if not record:
        raise HTTPException(404, "Source document not found. Upload the PDF before generating a quiz.")
    topic = request.topic or record["topics"][0]
    context = documents.retrieve(f"{topic} {request.competency}", request.source_document_id)
    return GenerateQuizResponse(source_name=record["name"], source_document_id=record["id"], topic=topic, competency=request.competency, questions=deterministic_questions(context, request, record["name"]))


@app.post("/api/quizzes/evaluate", tags=["Quizzes"])
@app.post("/quiz/evaluate", include_in_schema=False)
async def evaluate_quiz(request: EvaluateQuizRequest) -> dict:
    correct = sum(item.selected_option_id == "A" for item in request.submissions)
    total = len(request.submissions)
    score = round(correct / total * 100)
    return {"officer_id": request.officer_id, "competency": request.competency, "score_percentage": score, "correct_count": correct, "total": total, "status": "Proficient" if score >= 70 else "Needs Focus"}


@app.post("/api/llm/completions", response_model=LLMCompletionResponse, tags=["LLM"])
async def llm_completion(request: LLMCompletionRequest) -> LLMCompletionResponse:
    try:
        content, model, provider = await llm.complete(request.prompt, request.model, request.temperature, request.max_tokens)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, "The configured LLM endpoint did not return a valid completion.") from exc
    return LLMCompletionResponse(content=content, model=model, provider=provider)
