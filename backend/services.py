"""RAG, document and LLM adapters. All heavyweight integrations are lazy-loaded."""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_name: str = "Pragati AI API"
    chroma_path: str = "./backend/.chroma"
    collection_name: str = "training_manuals"
    max_upload_mb: int = 15
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str = "meta-llama/Meta-Llama-3-8B-Instruct"


settings = Settings()


def chunk_text(text: str, size: int = 800, overlap: int = 120) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    return [text[start:start + size] for start in range(0, len(text), size - overlap)]


def topics_for(text: str, filename: str) -> list[str]:
    choices = ["stratified sampling", "sampling", "survey design", "weighting", "data quality", "data cleaning", "data visualization", "metadata", "confidentiality", "official statistics", "governance", "census"]
    source = f"{filename} {text}".lower()
    found = [choice for choice in choices if choice in source]
    return found[:5] or [Path(filename).stem.replace("_", " ").replace("-", " ")]


class Embeddings:
    """Sentence-Transformers with a deterministic offline fallback for development."""
    def __init__(self) -> None:
        self._model: Any = None

    def encode(self, values: list[str]) -> list[list[float]]:
        try:
            if self._model is None:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer("all-MiniLM-L6-v2")
            return self._model.encode(values, normalize_embeddings=True).tolist()
        except Exception:
            return [self._hash_embedding(value) for value in values]

    @staticmethod
    def _hash_embedding(value: str) -> list[float]:
        vector = [0.0] * 64
        for word in re.findall(r"\w+", value.lower()):
            vector[int(hashlib.sha256(word.encode()).hexdigest(), 16) % 64] += 1.0
        length = sum(item * item for item in vector) ** 0.5 or 1.0
        return [item / length for item in vector]


class DocumentStore:
    def __init__(self) -> None:
        self.embeddings = Embeddings()
        self._documents: dict[str, dict[str, Any]] = {}
        self._collection: Any = None

    def _chroma(self) -> Any:
        if self._collection is None:
            import chromadb
            client = chromadb.PersistentClient(path=settings.chroma_path)
            self._collection = client.get_or_create_collection(settings.collection_name, metadata={"hnsw:space": "cosine"})
        return self._collection

    def add(self, filename: str, content: bytes) -> dict[str, Any]:
        text = self._pdf_text(content)
        if not text:
            raise ValueError("No readable text was found in this PDF. Upload a text-based PDF, not a scanned image.")
        document_id = f"doc-{uuid.uuid4().hex[:12]}"
        topics = topics_for(text, filename)
        chunks = chunk_text(text)
        uploaded_at = datetime.now(UTC).isoformat()
        metadata = {"document_id": document_id, "name": filename, "topics": ", ".join(topics), "size": f"{len(content) / 1048576:.2f} MB", "uploaded_at": uploaded_at, "extracted_characters": len(text), "chunk_count": len(chunks)}
        self._chroma().add(
            ids=[f"{document_id}:{index}" for index in range(len(chunks))],
            documents=chunks,
            embeddings=self.embeddings.encode(chunks),
            metadatas=[metadata | {"chunk": index} for index in range(len(chunks))],
        )
        record = {"id": document_id, "name": filename, "size": f"{len(content) / 1048576:.2f} MB", "status": "indexed", "topics": topics, "extracted_characters": len(text), "chunk_count": len(chunks), "uploaded_at": uploaded_at}
        self._documents[document_id] = record
        return record

    def get(self, document_id: str) -> dict[str, Any] | None:
        record = self._documents.get(document_id)
        if record:
            return record
        result = self._chroma().get(where={"document_id": document_id}, include=["metadatas"])
        metadata = (result.get("metadatas") or [None])[0]
        if not metadata:
            return None
        record = {"id": document_id, "name": metadata["name"], "size": metadata["size"], "status": "indexed", "topics": metadata["topics"].split(", "), "extracted_characters": int(metadata["extracted_characters"]), "chunk_count": int(metadata["chunk_count"]), "uploaded_at": metadata["uploaded_at"]}
        self._documents[document_id] = record
        return record

    def list(self) -> list[dict[str, Any]]:
        result = self._chroma().get(include=["metadatas"])
        for metadata in result.get("metadatas") or []:
            if metadata and metadata["document_id"] not in self._documents:
                self.get(metadata["document_id"])
        return sorted(self._documents.values(), key=lambda item: item.get("uploaded_at", ""), reverse=True)

    def retrieve(self, query: str, document_id: str | None, limit: int = 4) -> list[str]:
        where = {"document_id": document_id} if document_id else None
        available = (self.get(document_id).get("chunk_count", limit) if document_id and self.get(document_id) else limit)
        result = self._chroma().query(query_embeddings=self.embeddings.encode([query]), n_results=min(limit, available), where=where, include=["documents"])
        return result.get("documents", [[]])[0]

    @staticmethod
    def _pdf_text(content: bytes) -> str:
        from io import BytesIO
        from pypdf import PdfReader
        reader = PdfReader(BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages).strip()


class LLMClient:
    async def complete(self, prompt: str, model: str | None, temperature: float, max_tokens: int) -> tuple[str, str, str]:
        selected_model = model or settings.llm_model
        if not settings.llm_base_url:
            raise RuntimeError("No LLM endpoint is configured. Set LLM_BASE_URL to a Llama 3 or Mistral OpenAI-compatible endpoint.")
        url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {settings.llm_api_key}"} if settings.llm_api_key else {}
        payload = {"model": selected_model, "messages": [{"role": "user", "content": prompt}], "temperature": temperature, "max_tokens": max_tokens}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"], selected_model, "openai-compatible"
