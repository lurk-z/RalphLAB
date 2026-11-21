from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, HttpUrl, model_validator
from app.schemas.work_order import Input, Label, Note


Discipline = Literal[
    "synthesis", "discovery", "stability", "trace", "validation", "scale_up"
]


class StudyBrief(Input):
    id: UUID
    brief: Note
    discipline: Discipline
    case_template: Literal["insulin-lispro-v1"] | None = None
    reaction_steps: int = Field(default=10, ge=2, le=30)
    parallel: bool = False
    start_date: date | None = Field(
        default=None, ge=date(1900, 1, 1), le=date(2200, 1, 1)
    )
    months: list[Annotated[int, Field(ge=0, le=120)]] = Field(
        default_factory=lambda: [0, 3, 6, 12, 24, 36], min_length=2, max_length=36
    )

    @model_validator(mode="after")
    def check_schedule(self):
        if self.case_template and self.discipline != "discovery":
            raise ValueError("เคสอินซูลินใช้กับงานค้นคว้ายา")
        if self.discipline == "stability" and (
            not self.start_date
            or sorted(set(self.months)) != self.months
            or self.months[0] != 0
        ):
            raise ValueError("ระบุวันเริ่มและเดือนที่ติดตาม เรียงจาก 0 โดยไม่ซ้ำ")
        if self.parallel and (
            self.discipline != "synthesis" or self.reaction_steps < 3
        ):
            raise ValueError("งานสังเคราะห์คู่ขนานต้องมีอย่างน้อย 3 ขั้น")
        return self


class Literature(Input):
    title: Label
    url: HttpUrl = Field(max_length=1000)
    locator: Label
    application: Note


class StageResult(Input):
    id: UUID
    expected_sequence: int = Field(ge=1)
    disposition: Literal["record", "hold"]
    observed_on: date
    evidence: Note
    finding: Note
    unit: Label | None = None
    measurements: list[
        Annotated[float, Field(ge=-1e50, le=1e50, allow_inf_nan=False)]
    ] = Field(default_factory=list, max_length=1000)
    literature: list[Literature] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def validate_units(self):
        if bool(self.unit) != bool(self.measurements):
            raise ValueError("ระบุค่าที่วัดพร้อมหน่วย")
        return self
