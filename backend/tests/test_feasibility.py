from unittest.mock import Mock, patch

import httpx
import pytest

from app.services import feasibility


def response(status_code: int, report: dict | None = None) -> httpx.Response:
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    if report is None:
        return httpx.Response(status_code, request=request)
    return httpx.Response(status_code, request=request, json=report)


def valid_report() -> dict:
    citation = {
        "id": "E1",
        "source_id": "source-1",
        "filename": "study.txt",
        "location": 1,
        "locator_type": "page",
        "text": "Evidence excerpt.",
    }
    return {
        "summary": "Workable",
        "dimensions": {
            "scope": {"status": "Looks workable", "assessment": "Clear", "known": "Clear", "unknown": "", "citations": [citation]},
            "method_fit": {"status": "Looks workable", "assessment": "Clear", "known": "Clear", "unknown": "", "citations": []},
            "access": {"status": "Needs planning", "assessment": "Needs access", "known": "", "unknown": "Access unclear", "citations": []},
            "timeline": {"status": "Looks workable", "assessment": "Clear", "known": "Clear", "unknown": "", "citations": []},
            "resources": {"status": "Needs clarification", "assessment": "Budget unclear", "known": "", "unknown": "Budget", "citations": []},
            "ethics": {"status": "Looks workable", "assessment": "Clear", "known": "Clear", "unknown": "", "citations": []},
        },
        "risks": [{"title": "Risk", "why_it_matters": "It matters", "mitigation": "Mitigate", "citations": [citation]}],
        "next_steps": [{"action": "Step", "reason": "It is actionable", "citations": [citation]}],
        "scope_adjustments": [],
        "missing_information": [],
    }


@patch.dict(
    "os.environ",
    {
        "FEASIBILITY_GROQ_API_KEY": "test-key",
        "FEASIBILITY_GROQ_MODEL": "openai/gpt-oss-120b",
        "FEASIBILITY_GROQ_BASE_URL": "https://api.groq.com/openai/v1",
    },
)
@patch("app.services.feasibility._groq_request")
def test_primary_success_does_not_fallback(mock_request: Mock) -> None:
    mock_request.return_value = response(200, valid_report())

    report = feasibility.check_feasibility("Plan", "Evidence")

    assert report["summary"] == "Workable"
    assert mock_request.call_count == 1


@patch.dict(
    "os.environ",
    {
        "FEASIBILITY_GROQ_API_KEY": "test-key",
        "FEASIBILITY_GROQ_MODEL": "openai/gpt-oss-120b",
    },
)
@patch("app.services.feasibility._groq_request")
def test_rate_limit_falls_back_to_secondary(mock_request: Mock) -> None:
    mock_request.side_effect = [response(429), response(200, valid_report())]

    report = feasibility.check_feasibility("Plan", "Evidence")

    assert report["summary"] == "Workable"
    assert mock_request.call_args_list[1].args[1] == "qwen/qwen3.8-27b"


@patch.dict(
    "os.environ",
    {
        "FEASIBILITY_GROQ_API_KEY": "test-key",
        "FEASIBILITY_GROQ_MODEL": "openai/gpt-oss-120b",
    },
)
@patch("app.services.feasibility._groq_request")
def test_server_error_falls_back_through_tertiary(mock_request: Mock) -> None:
    mock_request.side_effect = [response(503), response(502), response(200, valid_report())]

    report = feasibility.check_feasibility("Plan", "Evidence")

    assert report["summary"] == "Workable"
    assert mock_request.call_args_list[2].args[1] == "openai/gpt-oss-20b"


@patch.dict(
    "os.environ",
    {
        "FEASIBILITY_GROQ_API_KEY": "test-key",
        "FEASIBILITY_GROQ_MODEL": "openai/gpt-oss-120b",
    },
)
@patch("app.services.feasibility._groq_request")
def test_auth_error_is_not_retried(mock_request: Mock) -> None:
    mock_request.return_value = response(401)

    with pytest.raises(
        RuntimeError,
        match="Groq rejected the feasibility API key or access.",
    ):
        feasibility.check_feasibility("Plan", "Evidence")

    assert mock_request.call_count == 1


@patch.dict(
    "os.environ",
    {
        "FEASIBILITY_GROQ_API_KEY": "test-key",
        "FEASIBILITY_GROQ_MODEL": "openai/gpt-oss-120b",
    },
)
@patch("app.services.feasibility._groq_request")
def test_follow_up_uses_fallback_and_returns_answer(mock_request: Mock) -> None:
    mock_request.side_effect = [
        response(429),
        response(200, {"answer": "Add milestones to the timeline."}),
    ]

    answer = feasibility.check_follow_up(
        "timeline",
        "Why is timeline Needs planning?",
        {"timeline": "Two months"},
        valid_report(),
        [],
    )

    assert answer == "Add milestones to the timeline."
    assert mock_request.call_args_list[1].args[1] == "qwen/qwen3.8-27b"
