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

    # What a collection session records. The no-game branch collects typing; "challenge" is main's game.
    collect_mode: str = "typing"
    collect_typing_windows: int = 6  # 50-key typing samples per collection session (about 300 keys)
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

    # Cadence setup on the Cadence site: click test, typing test, then a few separate sign-ins.
    setup_pointer_windows: int = 3  # 12-click samples from the click test
    setup_key_windows: int = 6  # 50-key samples from the typing test
    setup_sign_ins: int = 3  # sign-ins with typing recorded, the first one included

    # Third-party sites. The demo partner is registered on start-up; its secret is a local
    # development value and must be replaced anywhere real.
    demo_site_id: str = "northwind"
    demo_site_name: str = "Northwind CRM"
    demo_site_key: str = "pk_demo_northwind"
    demo_site_secret: str = "sk_demo_northwind_local_only"
    demo_site_origins: list[str] = ["http://localhost:5180", "http://127.0.0.1:5180"]
    demo_site_redirects: list[str] = ["http://localhost:5180/cadence/callback", "http://127.0.0.1:5180/cadence/callback"]
    cadence_web_url: str = "http://localhost:5173"  # where people are sent to link a site or verify another way
    evidence_ttl_s: int = 300
    site_check_ttl_s: int = 600
    link_code_ttl_s: int = 120
    evidence_rate_limit: int = 60  # evidence tokens per site per minute
    # Short typing (a sign-in) is scored by the login model; below this, typing is not used.
    min_login_keys: int = 12
    long_window_keys: int = 40  # from here a window is scored by the 50-key model

    retention_days: int = 30
    max_body_bytes: int = 4_000_000


settings = Settings()
