from pydantic import computed_field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_user: str = "road_sight"
    postgres_password: str = "road_sight_secret"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "road_sight"
    backend_port: int = 8001
    frontend_port: int = 5173
    yolo_model: str = "yolo26n.pt"
    confidence_threshold: float = 0.25
    upload_dir: str = "videos"
    timezone: str = "Asia/Jakarta"
    ytdlp_cookies_file: str = ""  # path to cookies.txt for yt-dlp (used on VPS)
    ytdlp_cookies_browser: str = "firefox"  # browser to read cookies from (local dev)

    @computed_field
    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    class Config:
        env_file = ("../.env", ".env")


settings = Settings()
