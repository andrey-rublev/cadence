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

    # Product: enrollment, trusted fallback and protected actions.
    enroll_min_sessions: int = 2
    enroll_min_rounds: int = 6
    enroll_rounds_per_session: int = 4  # scored rounds per enrollment session, after one practice round
    trust_ttl_s: int = 900  # how long a completed trusted verification stays fresh
    trust_code_ttl_s: int = 300
    grant_ttl_s: int = 120
    verify_max_rounds: int = 3  # one round, plus up to two more while the result is uncertain
    # Development only: lets a model trained on synthetic players gate actions.
    allow_synthetic_model: bool = False

    # Passive checks (no challenge): windows of ordinary pointer and keyboard use.
    passive_min_sessions: int = 2  # an enrollment must span this many sign-ins per modality
    passive_min_windows: int = 6  # and this many windows per modality
    passive_evidence_ttl_s: int = 600  # evidence older than this does not count towards a check
    passive_evidence_windows: int = 3  # the most recent windows per modality that a check uses
    passive_rate_window_s: int = 600
    passive_rate_limit: int = 40  # windows accepted per session per rate window
    passive_clock_slack_ms: int = 2000

    retention_days: int = 30
    max_body_bytes: int = 4_000_000


settings = Settings()
