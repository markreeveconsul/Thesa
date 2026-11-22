"""HTTP route for Groq feasibility assessments."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.feasibility import (
    MAX_BODY_BYTES,
    MAX_EVIDENCE_CHARS,
    check_feasibility,
    check_follow_up,
)

router = APIRouter()


class FeasibilityRequest(BaseModel):
    student_plan: str | None = None
    evidence: str | list[dict[str, object]] = Field(default="")
    project_id: str | None = None
    inputs: dict[str, str] | None = None


class FollowUpRequest(BaseModel):
    dimension: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=2000)
    inputs: dict[str, str] = Field(default_factory=dict)
    report: dict[str, object] = Field(default_factory=dict)
    evidence: list[dict[str, object]] = Field(default_factory=list)


@router.post("/feasibility")
def feasibility(request: FeasibilityRequest) -> dict[str, object]:
    if request.inputs is not None:
        student_plan = "\n".join(
            f"{key}: {value.strip()}" for key, value in request.inputs.items() if value.strip()
        )
    else:
        student_plan = request.student_plan or ""
    evidence_text = (
        request.evidence
        if isinstance(request.evidence, str)
        else "\n".join(
            f"{item.get('filename', 'Source')} {item.get('locator_type', '')} "
            f"{item.get('location', '')}: {item.get('text', '')}"
            for item in request.evidence
        )
    )
    if len(student_plan.encode("utf-8")) + len(evidence_text.encode("utf-8")) > MAX_BODY_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Feasibility request is too large. Reduce the form or source excerpts.",
        )
    if len(evidence_text) > MAX_EVIDENCE_CHARS:
        raise ValueError("Evidence text exceeds the maximum of 12,000 characters")
    try:
        return check_feasibility(student_plan, evidence_text)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/feasibility/follow-up")
def follow_up(request: FollowUpRequest) -> dict[str, str]:
    try:
        answer = check_follow_up(
            request.dimension,
            request.question,
            request.inputs,
            request.report,
            request.evidence,
        )
        return {"answer": answer}
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
