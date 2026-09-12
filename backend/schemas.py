from datetime import datetime
from typing import Literal
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class APIModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class HealthResponse(APIModel):
    status: Literal["ok"] = "ok"
    service: str
    timestamp: datetime


class DocumentSummary(APIModel):
    id: str
    name: str
    size: str
    uploaded_at: datetime
    status: Literal["indexed", "processing", "failed"]
    topics: list[str] = Field(default_factory=list)
    extracted_characters: int = Field(ge=0)


class GenerateQuizRequest(APIModel):
    source_document_id: str | None = Field(default=None, min_length=1, max_length=100, validation_alias=AliasChoices("source_document_id", "sourceDocumentId"))
    source_name: str | None = Field(default=None, max_length=255, validation_alias=AliasChoices("source_name", "sourceName"))
    topic: str | None = Field(default=None, max_length=160)
    competency: str = Field(default="Statistical Methods", min_length=2, max_length=120)
    num_questions: int = Field(default=5, ge=1, le=10)

    @field_validator("topic", "source_name", mode="before")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        return value or None


class QuizOption(APIModel):
    id: Literal["A", "B", "C", "D"]
    text: str = Field(min_length=1, max_length=1000)


class QuizQuestion(APIModel):
    id: int
    question: str
    options: list[QuizOption] = Field(min_length=4, max_length=4)
    answer: Literal["A", "B", "C", "D"]
    explanation: str
    competency: str
    source_document_id: str | None = None
    source_name: str | None = None


class GenerateQuizResponse(APIModel):
    source_name: str
    source_document_id: str | None = None
    topic: str
    competency: str
    questions: list[QuizQuestion]


class QuizSubmission(APIModel):
    question_id: int
    selected_option_id: Literal["A", "B", "C", "D"]


class EvaluateQuizRequest(APIModel):
    officer_id: str = Field(min_length=1, max_length=100)
    competency: str = Field(min_length=2, max_length=120)
    submissions: list[QuizSubmission] = Field(min_length=1, max_length=10)


class LLMCompletionRequest(APIModel):
    prompt: str = Field(min_length=1, max_length=12000)
    model: str | None = Field(default=None, max_length=200)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=600, ge=16, le=2000)


class LLMCompletionResponse(APIModel):
    model: str
    content: str
    provider: str
