import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from document_service import feasibility
from document_service.main import app


def report(evidence_ids=None):
    evidence_ids = evidence_ids or []
    return {
        "summary": "Plan needs more detail before feasibility can be judged.",
        "dimensions": {
            name: {
                "status": "Needs clarification",
                "assessment": "The plan does not provide enough detail yet.",
                "known": "The student supplied a topic.",
                "unknown": "The study design remains undecided.",
                "evidence_ids": evidence_ids,
            }
            for name in ("scope", "method_fit", "access", "timeline", "resources", "ethics")
        },
        "risks": [],
        "next_steps": [{"action": "Define a study design.", "reason": "The method is not yet known."}],
        "scope_adjustments": [],
        "missing_information": ["Proposed method"],
    }


def request_body():
    return {
        "project_id": "project-1",
        "inputs": {"topic": "Air quality and student attendance"},
        "evidence": [{
            "id": "E1", "source_id": "source-1", "filename": "study.pdf",
            "location": 2, "locator_type": "page", "text": "The study used interviews.",
        }],
    }


def test_report_rejects_unknown_citation_ids():
    raw = json.dumps(report(["E9"]))
    with pytest.raises(RuntimeError, match="invalid feasibility report"):
        feasibility._report(raw, [])


def test_report_resolves_model_ids_to_original_provenance():
    from document_service.feasibility import Evidence

    evidence = Evidence(**request_body()["evidence"][0])
    result = feasibility._report(json.dumps(report(["E1"])), [evidence])
    assert result["dimensions"]["ethics"]["citations"] == [evidence.model_dump()]


def test_groq_provider_is_configured_independently(monkeypatch):
    monkeypatch.setenv("FEASIBILITY_GROQ_API_KEY", "separate-key")
    monkeypatch.setenv("FEASIBILITY_GROQ_MODEL", "test-model")
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(report())}}],
        })

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            inputs = feasibility.StudentInputs(topic="A topic")
            return await feasibility.assess(inputs, [], client)

    result = asyncio.run(run())
    assert result["summary"].startswith("Plan needs")
    assert calls[0].headers["authorization"] == "Bearer separate-key"
    assert calls[0].url.path.endswith("/chat/completions")
    body = json.loads(calls[0].content)
    assert body["model"] == "test-model"
    assert body["response_format"] == {"type": "json_object"}


def test_feasibility_endpoint_uses_separate_provider_and_limits(monkeypatch):
    async def fake_assess(inputs, evidence, client):
        assert inputs.topic == "Air quality and student attendance"
        assert evidence[0].filename == "study.pdf"
        return report()

    monkeypatch.setattr(feasibility, "assess", fake_assess)
    with TestClient(app, headers={"origin": "http://127.0.0.1:3002"}) as client:
        response = client.post("/feasibility", json=request_body())
        invalid = request_body()
        invalid["evidence"][0]["id"] = "invented"
        invalid_response = client.post("/feasibility", json=invalid)
    assert response.status_code == 200
    assert response.json()["dimensions"]["ethics"]["status"] == "Needs clarification"
    assert invalid_response.status_code == 422
