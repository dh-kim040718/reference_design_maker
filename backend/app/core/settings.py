from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "Reference Design Maker API"
    environment: str = "development"
    database_url: str = "sqlite:///./local.db"
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    openai_api_key: SecretStr | None = None
    image_generation_enabled: bool = False
    image_editing_enabled: bool = False
    generation_budget_usd: Decimal = Field(default=Decimal("0"), ge=0, le=1_000_000,
                                           decimal_places=6)
    generation_reservation_usd: Decimal = Field(default=Decimal("1"), gt=0, le=1000,
                                                decimal_places=6)

    model_config = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
