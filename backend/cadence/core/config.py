from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CADENCE_", env_file=".env")

    db_path: Path = REPO_ROOT / "backend" / "cadence.db"
    data_dir: Path = REPO_ROOT / "data"
    artifacts_dir: Path = REPO_ROOT / "artifacts" / "models"

    session_cookie: str = "cadence_session"
    session_ttl_s: int = 8 * 3600
    cookie_secure: bool = False  # localhost prototype; set true behind HTTPS

    challenge_ttl_s: int = 120
    # Sliding-window cap on challenges issued per session.
    challenge_rate_window_s: int = 600
    challenge_rate_collect: int = 24
    challenge_rate_verify: int = 5

    collect_rounds: int = 6  # scored rounds per collection session, after one warm-up
    split_salt: str = "cadence-split-v1"

    retention_days: int = 30
    max_body_bytes: int = 4_000_000


settings = Settings()
