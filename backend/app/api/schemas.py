from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.api.preview import validate_thumbnail


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class NameInput(Input):
    name: str = Field(min_length=1, max_length=100)


class ClassificationPatch(Input):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    archived: bool | None = None

    @model_validator(mode="after")
    def one_action(self):
        if self.model_fields_set not in ({"name"}, {"archived"}):
            raise ValueError("이름 변경 또는 보관 변경 중 하나만 요청해 주세요.")
        if ("name" in self.model_fields_set and self.name is None) or (
            "archived" in self.model_fields_set and self.archived is None
        ):
            raise ValueError("값을 입력해 주세요.")
        return self


class RegionNote(Input):
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)
    width: float = Field(gt=0, le=1, allow_inf_nan=False)
    height: float = Field(gt=0, le=1, allow_inf_nan=False)
    note: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def inside_image(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("영역은 이미지 안에 지정해 주세요.")
        return self


class DesignGuidance(Input):
    roles: list[Literal["mood", "layout", "color", "components", "typography", "icons", "imagery",
                        "spacing", "hierarchy", "density", "buttons", "navigation", "forms",
                        "tables", "charts", "surfaces"]] = Field(default_factory=list, max_length=16)
    regions: list[RegionNote] = Field(default_factory=list, max_length=6)
    image_version: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def valid_guidance(self):
        if len(self.roles) != len(set(self.roles)):
            raise ValueError("참고 역할을 중복 지정할 수 없습니다.")
        if self.regions and not self.image_version:
            raise ValueError("영역에 사용할 이미지 버전이 필요합니다.")
        return self


class NoteInput(Input):
    design_note: str | None = Field(default=None, max_length=5000)
    design_guidance: DesignGuidance | None = None

    @field_validator("design_note")
    @classmethod
    def empty_note(cls, value):
        return value or None


class ReferenceInput(NoteInput):
    project_id: UUID
    deliverable_type_id: UUID
    source_url: str = Field(min_length=1, max_length=4096)
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    preview_url: str | None = Field(default=None, max_length=400100)
    preview_source: Literal["page_metadata", "user_upload"] | None = None

    @field_validator("preview_url")
    @classmethod
    def valid_thumbnail(cls, value):
        return validate_thumbnail(value)

    @field_validator("source_url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        try:
            url = urlsplit(value)
            valid = (
                url.scheme in {"http", "https"}
                and url.hostname
                and not url.username
                and not url.password
                and not any(c.isspace() or ord(c) < 32 for c in value)
            )
            _ = url.port
        except ValueError as error:
            raise ValueError("올바른 HTTP/HTTPS 주소를 입력해 주세요.") from error
        if not valid:
            raise ValueError("올바른 HTTP/HTTPS 주소를 입력해 주세요.")
        return value

    @field_validator("title", "description")
    @classmethod
    def empty_optional(cls, value):
        return value or None


class PreviewInput(Input):
    source_url: str = Field(min_length=1, max_length=4096)
    refresh: bool = False
    _valid_url = field_validator("source_url")(ReferenceInput.valid_url.__func__)


class ThumbnailInput(Input):
    preview_url: str | None = Field(default=None, max_length=400100)
    preview_source: Literal["page_metadata", "user_upload"] | None = None
    _valid_thumbnail = field_validator("preview_url")(ReferenceInput.valid_thumbnail.__func__)
