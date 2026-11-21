"""Exercise provider selection through the chat endpoint without network calls."""

import json
from collections import deque

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.chat import router
from app.core.config import settings

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_URL = "https://api.openai.com/v1/responses"
QUESTION = "ขอคำแนะนำสำหรับสูตรนี้"
FORMULA = {
    "name": "สูตรทดสอบ",
    "items": [
        {"name": "Water", "smiles": "O", "concentration": 95},
        {"name": "Glycerin", "smiles": "OCC(O)CO", "concentration": 5},
    ],
}


def groq_answer(text: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


def openai_answer(text: str) -> httpx.Response:
    return httpx.Response(200, json={
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
    })


def formula_answer(formula: dict) -> str:
    return f"ขอเสนอสูตรนี้ค่ะ\n<formula>{json.dumps(formula)}</formula>"


@pytest.fixture
def providers(monkeypatch):
    monkeypatch.setattr(settings, "GROQ_API_KEY", "groq-test-key")
    monkeypatch.setattr(settings, "GROQ_MODEL", "groq-test-model")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "openai-test-key")
    monkeypatch.setattr(settings, "OPENAI_MODEL", "openai-test-model")
    replies = deque()
    requests = []

    def respond(request):
        requests.append(request)
        reply = replies.popleft()
        if isinstance(reply, httpx.RequestError):
            raise reply
        return reply

    async_client = httpx.AsyncClient

    def client_with_mock_transport(*args, **kwargs):
        return async_client(*args, **kwargs, transport=httpx.MockTransport(respond))

    monkeypatch.setattr(httpx, "AsyncClient", client_with_mock_transport)
    app = FastAPI()
    app.include_router(router, prefix="/api/chat")
    with TestClient(app) as client:
        yield client, replies, requests


def test_successful_groq_call_does_not_use_openai(providers):
    client, replies, requests = providers
    replies.append(groq_answer("คำตอบจาก Groq"))

    response = client.post("/api/chat/", json={"question": QUESTION})

    assert response.status_code == 200
    assert response.json() == {"answer": "คำตอบจาก Groq"}
    assert [str(request.url) for request in requests] == [GROQ_URL]
    assert requests[0].headers["Authorization"] == "Bearer groq-test-key"
    payload = json.loads(requests[0].content)
    assert payload["model"] == "groq-test-model"
    assert payload["messages"][-1] == {"role": "user", "content": QUESTION}


@pytest.mark.parametrize("groq_failure", [
    httpx.Response(401, text="provider rejected authorization"),
    httpx.Response(429, headers={"Retry-After": "30"}),
    httpx.ConnectError("connection unavailable"),
    httpx.Response(200, json={"choices": []}),
    httpx.Response(200, text="not JSON"),
])
def test_openai_fallback_uses_responses_api(providers, groq_failure):
    client, replies, requests = providers
    replies.extend([groq_failure, openai_answer("คำตอบจาก OpenAI")])

    response = client.post("/api/chat/", json={"question": QUESTION, "context": "Water 95%"})

    assert response.status_code == 200
    assert response.json() == {"answer": "คำตอบจาก OpenAI"}
    assert [str(request.url) for request in requests] == [GROQ_URL, OPENAI_URL]
    assert requests[1].headers["Authorization"] == "Bearer openai-test-key"
    groq_payload, openai_payload = (json.loads(request.content) for request in requests)
    assert openai_payload["model"] == "openai-test-model"
    assert openai_payload["input"] == groq_payload["messages"]
    assert openai_payload["store"] is False
    assert openai_payload["max_output_tokens"] > 0


def test_openai_without_groq_can_offer_complete_lab_formula(providers, monkeypatch):
    client, replies, requests = providers
    monkeypatch.setattr(settings, "GROQ_API_KEY", "")
    replies.append(openai_answer(formula_answer(FORMULA)))

    response = client.post("/api/chat/", json={"question": QUESTION, "lab_role": "researcher"})

    assert response.status_code == 200
    assert [str(request.url) for request in requests] == [OPENAI_URL]
    assert response.json() == {"answer": "ขอเสนอสูตรนี้ค่ะ", "formula_proposals": [FORMULA]}


def test_lab_proposal_correction_keeps_fallback_provider(providers):
    client, replies, requests = providers
    incomplete = formula_answer({**FORMULA, "items": FORMULA["items"][:1]})
    replies.extend([httpx.Response(503), openai_answer(incomplete), openai_answer(formula_answer(FORMULA))])

    response = client.post("/api/chat/", json={"question": QUESTION, "lab_role": "director"})

    assert response.status_code == 200
    assert response.json()["formula_proposals"] == [FORMULA]
    assert [str(request.url) for request in requests] == [GROQ_URL, OPENAI_URL, OPENAI_URL]
    correction = json.loads(requests[2].content)["input"][-2:]
    assert correction[0] == {"role": "assistant", "content": incomplete}
    assert correction[1]["role"] == "user"


@pytest.mark.parametrize("groq_status,openai_status,expected_status", [(401, 503, 502), (429, 429, 429)])
def test_provider_failures_do_not_expose_upstream_details(providers, groq_status, openai_status, expected_status):
    client, replies, requests = providers
    replies.extend([
        httpx.Response(groq_status, text="private Groq error body"),
        httpx.Response(openai_status, text="private OpenAI error body"),
    ])

    response = client.post("/api/chat/", json={"question": QUESTION})

    assert response.status_code == expected_status
    assert [str(request.url) for request in requests] == [GROQ_URL, OPENAI_URL]
    assert response.json()["detail"]
    assert "private" not in response.text
    assert "test-key" not in response.text


def test_without_any_provider_returns_service_unavailable(providers, monkeypatch):
    client, _, requests = providers
    monkeypatch.setattr(settings, "GROQ_API_KEY", "")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")

    response = client.post("/api/chat/", json={"question": QUESTION})

    assert response.status_code == 503
    assert not requests


def test_groq_without_fallback_keeps_rate_limit_retry(providers, monkeypatch):
    client, replies, requests = providers
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    replies.extend([httpx.Response(429, headers={"Retry-After": "0"}), groq_answer("ลองใหม่สำเร็จค่ะ")])

    response = client.post("/api/chat/", json={"question": QUESTION})

    assert response.status_code == 200
    assert response.json() == {"answer": "ลองใหม่สำเร็จค่ะ"}
    assert [str(request.url) for request in requests] == [GROQ_URL, GROQ_URL]
