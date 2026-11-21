from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from app.services.ingredient_registry import normalize_ingredient_name

Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1500)]
Endpoint = Literal["identity", "skin", "eye", "sens", "acute"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Brief(Input):
    id: UUID
    brief: Note
    source: Literal["attach", "example"] = "attach"
    endpoint: Endpoint = "identity"


class Ingredient(Input):
    name: Label
    percent: Decimal = Field(gt=0, le=100, max_digits=9, decimal_places=6)


class Revision(Input):
    version: Label
    ingredients: list[Ingredient] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def check_composition(self):
        names = [normalize_ingredient_name(i.name) for i in self.ingredients]
        if len(set(names)) != len(names):
            raise ValueError("รายการสารซ้ำในสูตรเดียวกัน")
        if sum(i.percent for i in self.ingredients) != 100:
            raise ValueError("สัดส่วนในแต่ละรุ่นต้องรวมเป็น 100%")
        return self


class OrderRequest(Input):
    id: UUID
    brief: Note
    baseline: Revision
    candidate: Revision
    locked: list[Label] = Field(default_factory=list, max_length=100)
    endpoint: Endpoint = "identity"

    @model_validator(mode="after")
    def check_versions(self):
        if self.baseline.version == self.candidate.version:
            raise ValueError("ระบุชื่อรุ่นต้นทางและรุ่นเสนอให้ต่างกัน")
        present = {normalize_ingredient_name(i.name) for i in self.baseline.ingredients}
        if any(normalize_ingredient_name(name) not in present for name in self.locked):
            raise ValueError("สารที่ล็อกต้องมีในสูตรต้นทาง")
        return self


class OrderAction(Input):
    id: UUID
    action: Literal["approve", "reject", "recheck"]
    expected_sequence: int = Field(ge=1)
    version: Label
    note: Note
