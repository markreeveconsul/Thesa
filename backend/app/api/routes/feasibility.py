"""HTTP route for Groq feasibility assessments."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.feasibility import (
    MAX_BODY_BYTES,
    MAX_EVIDENCE_CHARS,
    check_feasibility,
)

router = APIRouter()


class FeasibilityRequest(BaseModel):
    student_plan: str = Field(min_length=1)
    evidence: str = Field(default="")


@router.post("/feasibility")
def feasibility(request: FeasibilityRequest) -> dict[str, object]:
    if len(request.student_plan.encode("utf-8")) + len(request.evidence.encode("utf-8")) > MAX_BODY_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Feasibility request is too large. Reduce the form or source excerpts.",
        )
    if len(request.evidence) > MAX_EVIDENCE_CHARS:
        raise ValueError("Evidence text exceeds the maximum of 12,000 characters")
    try:
        return check_feasibility(request.student_plan, request.evidence)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
