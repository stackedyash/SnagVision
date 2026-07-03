from pydantic_settings import BaseSettings
from typing import List
import os 

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/siteiq"
    gemini_api_key : str = os.getenv("gemini_api_key")
    GCS_BUCKET_NAME: str = "siteiq-media"
    GCS_PROJECT_ID: str = ""
    GOOGLE_APPLICATION_CREDENTIALS: str = "./gcs-credentials.json"
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8001
    SECRET_KEY: str = "changeme"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()
