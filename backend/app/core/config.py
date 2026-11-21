"""Application configuration loaded from environment variables."""
import os
from pathlib import Path
from typing import List, Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = REPO_ROOT / ".env"


class Settings(BaseSettings):
    """Application settings - reads from environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        case_sensitive=True,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "RalphGuard"
    APP_ENV: str = "development"
    APP_DEBUG: bool = True

    # API
    API_HOST: str = "0.0.0.0"
    LOGIN_ENABLED: bool = True
    API_PORT: int = 8000
    API_SECRET_KEY: str = "change-me"
    # In a combined Vercel project NextAuth and FastAPI share the same
    # environment. Explicit AUTH_SECRET still takes precedence elsewhere.
    AUTH_SECRET: str = os.environ.get("NEXTAUTH_SECRET", "") if os.environ.get("VERCEL") == "1" else ""
    # Comma-separated list of allowed origins, or "*" to allow every origin.
    CORS_ORIGINS: str = "*"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    # Database
    DATABASE_URL: str = "postgresql://ralphguard:ralphguard_dev@postgres:5432/ralphguard"

    # Redis / Queue
    REDIS_URL: str = "redis://redis:6379/0"
    QUEUE_STREAM_NAME: str = "ralphguard:jobs"
    ASSESSMENT_EXECUTION_MODE: Literal["disabled", "queue", "inline"] = "disabled"
    ASSESSMENT_WAIT_FOR_RESULT: bool = False

    # Models (read-only mount of scientific/models — used for the model card)
    MODELS_DIR: str = "/models"
    SCIENTIFIC_RUNTIME_DIR: str = "/scientific"

    # Chat uses Groq first and OpenAI as the fallback. Both keys stay on the server.
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-5.4-mini"


settings = Settings()
