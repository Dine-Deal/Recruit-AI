import asyncio
import os
import ssl
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from dotenv import load_dotenv

load_dotenv()

async def test():
    ssl_ctx = ssl.create_default_context()
    engine = create_async_engine(
        os.getenv("DATABASE_URL"),
        connect_args={"ssl": ssl_ctx}
    )
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT version()"))
        print("✅ Neon connected OK!")
        print("PostgreSQL:", result.scalar()[:50])
    await engine.dispose()

asyncio.run(test())