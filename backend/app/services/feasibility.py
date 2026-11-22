"""Groq-backed feasibility assessment with a transient-error fallback cascade."""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any

import httpx

logger = logging.getLogger(__name__)

PRIMARY_MODEL = "openai/gpt-oss-120b"
SECONDARY_MODEL = "qwen/qwen3.8-27b"
TERTIARY_MODEL = "openai/gpt-oss-20b"
FALLBACK_MODELS = (SECONDARY_MODEL, TERTIARY_MODEL)

MAX_BODY_BYTES = 180_000
MAX_EVIDENCE_CHARS = 12_000

_semaphore = threading.BoundedSemaphore(1)


def _config() -> dict[str, str]:
    """Load feasibility configuration while preserving the existing environment contract."""
    return {
        "api_key": os.getenv("FEASIBILITY_GROQ_API_KEY", "").strip(),
        "model": os.getenv("FEASIBILITY_GROQ_MODEL", PRIMARY_MODEL).strip() or PRIMARY_MODEL,
        "base_url": os.getenv(
            "FEASIBILITY_GROQ_BASE_URL",
            "https://api.groq.com/openai/v1",
        ).strip().rstrip("/") or "https://api.groq.com/openai/v1",
    }


def _model_cascade(primary_model: str) -> tuple[str, ...]:
    models = [primary_model]
    models.extend(model for model in FALLBACK_MODELS if model != primary_model)
    return tuple(models)


def _validate_feasibility_report(report: dict[str, Any]) -> dict[str, Any]:
    required_keys = {
        "summary",
        "dimensions",
        "risks",
        "next_steps",
        "scope_adjustments",
        "missing_information",
    }
    if set(report) != required_keys:
        raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")

    if not isinstance(report["summary"], str):
        raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
    for key in ("risks", "next_steps", "scope_adjustments", "missing_information"):
        if not isinstance(report[key], list):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")

    dimensions = report["dimensions"]
    if not isinstance(dimensions, dict):
        raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")

    required_dimensions = {"scope", "method_fit", "access", "timeline", "resources", "ethics"}
    statuses = {"Looks workable", "Needs planning", "Needs clarification"}
    if set(dimensions) != required_dimensions:
        raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
    for dimension in dimensions.values():
        if not isinstance(dimension, dict):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        if not {"status", "assessment", "known", "unknown", "citations"} <= set(dimension):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        if dimension["status"] not in statuses:
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        if not all(isinstance(dimension[key], str) for key in ("assessment", "known", "unknown")):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        if not isinstance(dimension["citations"], list) or len(dimension["citations"]) > 3:
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")

    risks = report["risks"]
    if not isinstance(risks, list) or len(risks) > 8:
        raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
    for risk in risks:
        if not isinstance(risk, dict) or not {
            "title",
            "why_it_matters",
            "mitigation",
            "citations",
        } <= set(risk):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        if not all(isinstance(risk[key], str) for key in ("title", "why_it_matters", "mitigation")):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        if not isinstance(risk["citations"], list) or len(risk["citations"]) > 3:
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")

    if not isinstance(report["next_steps"], list) or len(report["next_steps"]) > 8:
        raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
    for step in report["next_steps"]:
        if not isinstance(step, dict) or not {"action", "reason"} <= set(step):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        if not isinstance(step["action"], str) or not isinstance(step["reason"], str):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        citations = step.get("citations", [])
        if not isinstance(citations, list) or len(citations) > 3:
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")

    return report


def _validate_evidence(evidence: str) -> str:
    if len(evidence) > MAX_EVIDENCE_CHARS:
        raise ValueError("Evidence text exceeds the maximum of 12,000 characters")
    return evidence


def _build_payload(student_plan: str, evidence: str) -> dict[str, Any]:
    return {
        "student_plan": student_plan,
        "evidence": _validate_evidence(evidence),
        "system": (
            "Assess the feasibility of the student's research plan and return a concise "
            "structured JSON feasibility report."
        ),
        "response_format": "json_object",
    }


def _groq_request(
    config: dict[str, str],
    model: str,
    payload: dict[str, Any],
) -> httpx.Response:
    url = f"{config['base_url'].rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": payload["system"]},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "student_plan": payload["student_plan"],
                        "evidence": payload["evidence"],
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "response_format": {"type": payload["response_format"]},
        "max_completion_tokens": 2200,
        "temperature": 0.2,
    }
    return httpx.post(url, headers=headers, json=body, timeout=40.0)


def _groq_review(student_plan: str, evidence: str) -> dict[str, Any]:
    if len(json.dumps({"student_plan": student_plan, "evidence": evidence}).encode()) > MAX_BODY_BYTES:
        raise ValueError("Feasibility request is too large. Reduce the form or source excerpts.")

    config = _config()
    if not config["api_key"]:
        raise RuntimeError("Add your Groq key to FEASIBILITY_GROQ_API_KEY in backend/.env.")

    payload = _build_payload(student_plan, evidence)
    models = _model_cascade(config["model"])
    last_5xx_status: int | None = None

    for index, model in enumerate(models):
        logger.info("Feasibility model attempt: model=%s", model)
        try:
            response = _groq_request(config, model, payload)
        except httpx.TimeoutException:
            logger.error("Feasibility model failed: model=%s reason=timeout", model)
            raise RuntimeError(
                "Groq feasibility review timed out. Your form is preserved; retry later."
            ) from None
        except httpx.RequestError:
            logger.error("Feasibility model failed: model=%s reason=request_error", model)
            raise RuntimeError(
                "Cannot reach Groq. Your form is preserved; check the connection and retry."
            ) from None

        if response.status_code in (401, 403):
            logger.error("Feasibility model failed: model=%s reason=authentication", model)
            raise RuntimeError(
                "Groq rejected the feasibility API key or access."
            )

        if response.status_code == 429:
            logger.warning(
                "Feasibility model failed: model=%s reason=rate_limit next=%s",
                model,
                models[index + 1] if index + 1 < len(models) else "none",
            )
            if index == len(models) - 1:
                raise RuntimeError(
                    "Groq rate limit reached for feasibility. Otto chat uses a separate provider; retry later."
                )
            continue

        if 500 <= response.status_code <= 599:
            last_5xx_status = response.status_code
            logger.warning(
                "Feasibility model failed: model=%s reason=server_error status=%s next=%s",
                model,
                response.status_code,
                models[index + 1] if index + 1 < len(models) else "none",
            )
            if index == len(models) - 1:
                raise RuntimeError(
                    "Groq feasibility request failed for all models "
                    f"(HTTP {last_5xx_status}). Check the configured models and retry."
                )
            continue

        if not response.is_success:
            raise RuntimeError(
                f"Groq feasibility request failed (HTTP {response.status_code}). "
                "Check the configured model and retry."
            )

        try:
            report = response.json()
        except (json.JSONDecodeError, ValueError):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.") from None
        if not isinstance(report, dict):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        report = _validate_feasibility_report(report)
        logger.info("Feasibility model succeeded: model=%s", model)
        return report

    raise RuntimeError("Groq feasibility request failed. Check the configured models and retry.")


def check_feasibility(student_plan: str, evidence: str) -> dict[str, Any]:
    """Run a feasibility review while enforcing the single-slot resource limit."""
    if not _semaphore.acquire(blocking=True):
        raise RuntimeError("Feasibility review is already in progress")
    try:
        return _groq_review(student_plan, evidence)
    finally:
        _semaphore.release()


def check_follow_up(
    dimension: str,
    question: str,
    inputs: dict[str, str],
    report: dict[str, Any],
    evidence: list[dict[str, Any]],
) -> str:
    """Answer a dimension-specific follow-up using the same fallback cascade."""
    config = _config()
    if not config["api_key"]:
        raise RuntimeError("Add your Groq key to FEASIBILITY_GROQ_API_KEY in backend/.env.")

    prompt = (
        "Answer the user's follow-up about one feasibility dimension. "
        "Use only the supplied plan, report, and evidence excerpts. "
        "Be specific, practical, and explain why your advice matters. "
        "If evidence is cited, identify it by filename and location. "
        'Return JSON with exactly this key: {"answer":"..."}'
    )
    payload = {
        "student_plan": json.dumps(
            {"dimension": dimension, "question": question, "inputs": inputs, "report": report},
            ensure_ascii=False,
        ),
        "evidence": json.dumps(evidence, ensure_ascii=False),
        "system": prompt,
        "response_format": "json_object",
    }
    models = _model_cascade(config["model"])

    for index, model in enumerate(models):
        logger.info("Feasibility follow-up attempt: model=%s dimension=%s", model, dimension)
        try:
            response = _groq_request(config, model, payload)
        except httpx.TimeoutException:
            raise RuntimeError(
                "Groq feasibility review timed out. Your form is preserved; retry later."
            ) from None
        except httpx.RequestError:
            raise RuntimeError(
                "Cannot reach Groq. Your form is preserved; check the connection and retry."
            ) from None

        if response.status_code in (401, 403):
            raise RuntimeError("Groq rejected the feasibility API key or access.")
        if response.status_code == 429:
            if index + 1 >= len(models):
                raise RuntimeError(
                    "Groq rate limit reached for feasibility. Otto chat uses a separate provider; retry later."
                )
            continue
        if 500 <= response.status_code <= 599:
            if index + 1 >= len(models):
                raise RuntimeError(
                    f"Groq feasibility request failed (HTTP {response.status_code}). "
                    "Check the configured models and retry."
                )
            continue
        if not response.is_success:
            raise RuntimeError(
                f"Groq feasibility request failed (HTTP {response.status_code}). "
                "Check the configured model and retry."
            )

        try:
            result = response.json()
        except (json.JSONDecodeError, ValueError):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.") from None
        if not isinstance(result, dict) or not isinstance(result.get("answer"), str):
            raise RuntimeError("Groq returned an invalid feasibility report. Please retry.")
        logger.info("Feasibility follow-up succeeded: model=%s dimension=%s", model, dimension)
        return result["answer"]

    raise RuntimeError("Groq feasibility request failed. Check the configured models and retry.")
