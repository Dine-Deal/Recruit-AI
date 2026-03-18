"""
Database migration script to add missing columns to existing tables.
Run this once to update your Neon database schema.
"""

import asyncio
import asyncpg
from dotenv import load_dotenv
import os

load_dotenv('.env')  # or '_env' depending on your file name

DATABASE_URL = os.getenv('DATABASE_URL')

# Convert SQLAlchemy URL to asyncpg format
# postgresql+asyncpg://user:pass@host/db -> postgresql://user:pass@host/db
asyncpg_url = DATABASE_URL.replace('postgresql+asyncpg://', 'postgresql://')


async def add_missing_columns():
    """Add missing columns to candidates and job_roles tables."""
    
    print("Connecting to database...")
    conn = await asyncpg.connect(asyncpg_url, ssl='require')
    
    try:
        print("\n=== Adding missing columns ===\n")
        
        # 1. Add role_name to candidates table (if not exists)
        print("Adding 'role_name' to candidates table...")
        try:
            await conn.execute("""
                ALTER TABLE candidates 
                ADD COLUMN IF NOT EXISTS role_name VARCHAR(200);
            """)
            print("✓ Added role_name column")
        except Exception as e:
            print(f"⚠ role_name: {e}")
        
        # 2. Add folder_name to candidates table (if not exists)
        print("Adding 'folder_name' to candidates table...")
        try:
            await conn.execute("""
                ALTER TABLE candidates 
                ADD COLUMN IF NOT EXISTS folder_name VARCHAR(200);
            """)
            print("✓ Added folder_name column")
        except Exception as e:
            print(f"⚠ folder_name: {e}")
        
        # 3. Add custom_folder_path to job_roles table (if not exists)
        print("Adding 'custom_folder_path' to job_roles table...")
        try:
            await conn.execute("""
                ALTER TABLE job_roles 
                ADD COLUMN IF NOT EXISTS custom_folder_path VARCHAR(1000);
            """)
            print("✓ Added custom_folder_path column")
        except Exception as e:
            print(f"⚠ custom_folder_path: {e}")
        
        print("\n=== Migration completed! ===")
        print("Your database schema is now up to date.")
        print("Restart your FastAPI application.\n")
        
    finally:
        await conn.close()
        print("Database connection closed.")


if __name__ == "__main__":
    asyncio.run(add_missing_columns())
    