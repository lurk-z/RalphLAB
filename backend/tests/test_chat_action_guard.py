"""LLM actions are checked before the frontend offers confirmation."""

import asyncio
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.chat import (
    ChatIn,
    chat,
    _gentle_toner_fallback,
    _has_action_markup,
    _is_sensitisation_ui_test_request,
    _is_toner_creation_request,
    _is_workspace_mutation_request,
    _lab_reply,
    _parse_actions,
    _sensitisation_ui_test_fallback,
    _strip_action_markup,
    _unsupported_action_ingredients,
    router,
)


def test_lab_chat_uses_provider_even_for_a_workspace_template(monkeypatch):
    monkeypatch.setattr("app.api.chat.settings.GROQ_API_KEY", "test-only")
    response = httpx.Response(200, json={"choices": [{"message": {"content": "คำตอบสำหรับแชต Lab"}}]})
    with patch("app.api.chat.httpx.AsyncClient.post", new_callable=AsyncMock, return_value=response) as post:
        result = asyncio.run(chat(ChatIn(surface="lab", question="make a gentle toner", context="Analyst")))
    assert result.answer == "คำตอบสำหรับแชต Lab"
    post.assert_awaited_once()
    assert "Analyst" in post.await_args.kwargs["json"]["messages"][-1]["content"]


def test_lab_without_key_reports_unavailable_while_editor_keeps_template(monkeypatch):
    monkeypatch.setattr("app.api.chat.settings.GROQ_API_KEY", "")
    monkeypatch.setattr("app.api.chat.settings.OPENAI_API_KEY", "")
    question = "make a gentle toner"
    with pytest.raises(HTTPException) as error:
        asyncio.run(chat(ChatIn(surface="lab", question=question)))
    assert error.value.status_code == 503
    assert _parse_actions(asyncio.run(chat(ChatIn(question=question))).answer)


def test_detects_extracts_in_created_formula():
    answer = """จัดให้ค่ะ
<action>[{"type":"create_formula","name":"toner","items":[
{"name":"Witch Hazel","smiles":"fake","concentration":10},
{"name":"Aloe Vera","smiles":"fake","concentration":5},
{"name":"Glycerin","smiles":"OCC(O)CO","concentration":5}
]}]</action>"""

    assert _unsupported_action_ingredients(answer) == ["Witch Hazel", "Aloe Vera"]


def test_toner_fallback_is_executable_and_totals_100_percent():
    answer = _gentle_toner_fallback("สร้าง node โทนเนอร์อ่อนโยนให้หน่อย")

    assert answer is not None
    assert not _unsupported_action_ingredients(answer)
    actions = _parse_actions(answer)
    assert [action["type"] for action in actions] == ["create_formula", "goto"]
    items = actions[0]["items"]
    assert sum(item["concentration"] for item in items) == 100
    assert all(item["smiles"] and item["name"] for item in items)
    assert actions[1] == {"type": "goto", "tab": "nodes"}


def test_only_creation_intent_uses_reviewed_toner_template():
    assert _is_toner_creation_request("สร้างโทนเนอร์เช็ดหน้าแบบปลอดภัยให้หน่อย")
    assert _is_toner_creation_request("make a gentle toner")
    assert not _is_toner_creation_request("ทำไมโทนเนอร์สูตรนี้คะแนนสูง")


def test_detects_explicit_high_sensitisation_ui_test_intent():
    assert _is_sensitisation_ui_test_request(
        "ฉันต้องการสูตรที่แพ้ผิวหนัง 50++ เพื่อทดสอบการแสดงผล"
    )
    assert _is_sensitisation_ui_test_request("make a skin sensitization 60 demo")
    assert not _is_sensitisation_ui_test_request("ทำไมคะแนนแพ้ผิวหนังเป็น 50")
    assert not _is_sensitisation_ui_test_request("ทดสอบการแพ้ผิวหนังระดับต่ำ 20")


def test_high_sensitisation_ui_fixture_is_reviewed_and_totals_100_percent():
    answer = _sensitisation_ui_test_fallback(
        "ฉันต้องการสูตรที่แพ้ผิวหนัง 50++ เพื่อทดสอบการแสดงผล"
    )

    assert answer is not None
    assert "ห้ามผลิตหรือใช้กับผิว" in answer
    actions = _parse_actions(answer)
    assert [action["type"] for action in actions] == ["create_formula"]
    assert actions[0]["name"] == "TEST ONLY — แพ้ผิวหนัง 50+"
    items = actions[0]["items"]
    assert sum(item["concentration"] for item in items) == 100
    assert items[1] == {
        "name": "Cinnamaldehyde",
        "smiles": "O=C/C=C/c1ccccc1",
        "concentration": 65.0,
    }


def test_detects_formula_mutation_requests_that_require_actions():
    assert _is_workspace_mutation_request("ปรับสูตรให้ปลอดภัยกว่านี้หน่อย")
    assert _is_workspace_mutation_request("ลดความเข้มข้น Ethanol แล้วประเมินใหม่")
    assert _is_workspace_mutation_request("adjust the formula and run the assessment")
    assert not _is_workspace_mutation_request("สารตัวไหนเสี่ยงที่สุด")


def test_rejects_and_hides_a_truncated_action_block():
    answer = 'เตรียมรายการปรับแล้วค่ะ <action>[{"type":"set_concentration","name":"E'

    assert _has_action_markup(answer)
    assert _parse_actions(answer) == []
    assert _strip_action_markup(answer) == "เตรียมรายการปรับแล้วค่ะ"


def test_lab_reply_offers_only_complete_formula_proposals():
    glycerin = {"name": "Glycerin", "concentration": 5}
    water = {"name": "Water (Aqua)", "smiles": "O", "concentration": 95}
    complete = {"name": "สูตรเต็ม", "items": [water, glycerin]}
    partial = {"name": "สูตรยังไม่ครบ", "items": [glycerin]}
    mixture = {"name": "สารผสม", "items": [{**water, "name": "Aloe Vera"}, glycerin]}
    blocks = "\n".join(f"<formula>{json.dumps(item)}</formula>" for item in (complete, partial, mixture))

    reply = _lab_reply(f"เสนอสูตรค่ะ\n{blocks}\n<action>[{{\"type\":\"run\"}}]</action>")

    assert reply.answer == "เสนอสูตรค่ะ"
    assert reply.formula_proposals is not None
    assert [proposal.model_dump(exclude_none=True) for proposal in reply.formula_proposals] == [
        complete,
        {"name": "สารผสม", "items": [{"name": "Aloe Vera", "concentration": 95}, glycerin]},
    ]


def test_lab_chat_returns_proposals_for_other_roles_and_keeps_regular_chat_contract(monkeypatch):
    monkeypatch.setattr("app.api.chat.settings.GROQ_API_KEY", "test-only")
    app = FastAPI()
    app.include_router(router, prefix="/api/chat")
    client = TestClient(app)
    question = {"question": "create toner"}

    regular = client.post("/api/chat/", json=question)
    completion = httpx.Response(200, json={"choices": [{"message": {"content": regular.json()["answer"]}}]})
    with patch("app.api.chat.httpx.AsyncClient.post", new_callable=AsyncMock, return_value=completion) as post:
        lab = client.post("/api/chat/", json={**question, "surface": "lab", "lab_role": "formulator"})

    assert regular.status_code == lab.status_code == 200
    post.assert_awaited_once()
    assert "<formula>" in post.await_args.kwargs["json"]["messages"][0]["content"]
    assert set(regular.json()) == {"answer"}
    expected = _parse_actions(regular.json()["answer"])[0]
    assert "<action>" not in lab.json()["answer"]
    assert lab.json()["formula_proposals"] == [{"name": expected["name"], "items": expected["items"]}]
