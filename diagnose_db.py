"""
diagnose_db.py — Run this to find exactly what's wrong with the DB connection.
Usage: python diagnose_db.py
"""
import asyncio
import os
import socket
import ssl
import sys
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("DATABASE_URL", "")

print("=" * 60)
print("AI-ATS Database Connection Diagnostic")
print("=" * 60)
print(f"\nDATABASE_URL: {DB_URL[:80]}...")

# ── Extract parts ─────────────────────────────────────────────────────────────
import re
m = re.match(
    r"postgresql\+asyncpg://([^:]+):([^@]+)@([^/]+)/([^?]+)",
    DB_URL
)
if not m:
    print("\n❌ Could not parse DATABASE_URL. Check your .env file.")
    sys.exit(1)

user, password, host, dbname = m.groups()
# Remove query string from dbname
dbname = dbname.split("?")[0]

# Neon pooler uses port 5432
port = 5432

print(f"\nParsed:")
print(f"  Host   : {host}")
print(f"  Port   : {port}")
print(f"  User   : {user}")
print(f"  DB     : {dbname}")
print(f"  Pooler : {'YES ✓' if '-pooler' in host else 'NO ✗ (add -pooler to hostname!)'}")

# ── Test 1: DNS resolution ────────────────────────────────────────────────────
print("\n── Test 1: DNS resolution ──")
try:
    ip = socket.gethostbyname(host)
    print(f"  ✅ Resolved {host} → {ip}")
except Exception as e:
    print(f"  ❌ DNS failed: {e}")
    print("  → Check your internet connection or VPN.")
    sys.exit(1)

# ── Test 2: TCP connection ────────────────────────────────────────────────────
print("\n── Test 2: TCP connection to port 5432 ──")
try:
    sock = socket.create_connection((host, port), timeout=10)
    sock.close()
    print(f"  ✅ TCP connection to {host}:{port} succeeded")
except Exception as e:
    print(f"  ❌ TCP connection failed: {e}")
    print("  → Port 5432 may be blocked by your firewall or ISP.")
    print("  → Try using the Neon HTTP proxy instead (see fix below).")

# ── Test 3: asyncpg direct ────────────────────────────────────────────────────
print("\n── Test 3: asyncpg connection ──")

async def test_asyncpg():
    try:
        import asyncpg
        conn = await asyncpg.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=dbname,
            ssl="require",
            timeout=15,
            command_timeout=15,
        )
        version = await conn.fetchval("SELECT version()")
        await conn.close()
        print(f"  ✅ asyncpg connected!")
        print(f"  PostgreSQL: {version[:50]}")
        return True
    except Exception as e:
        print(f"  ❌ asyncpg failed: {type(e).__name__}: {e}")
        return False

result = asyncio.run(test_asyncpg())

# ── Test 4: HTTP proxy (Neon serverless) ──────────────────────────────────────
print("\n── Test 4: Neon HTTP proxy ──")
try:
    import httpx
    # Neon serverless driver uses HTTPS on port 443 — never blocked
    neon_http_host = host.replace("-pooler", "")
    url = f"https://{neon_http_host}"
    r = httpx.get(url, timeout=10)
    print(f"  ✅ HTTPS reachable (status {r.status_code})")
    print("  → If Test 3 failed but Test 4 passed, port 5432 is blocked.")
    print("    Fix: use Neon's HTTP proxy driver (neon-serverless).")
except Exception as e:
    print(f"  ❌ HTTPS also failed: {e}")
    print("  → Full internet connectivity issue. Check network/VPN.")

print("\n" + "=" * 60)
if result:
    print("✅ Connection works! The issue is in the SQLAlchemy config.")
    print("   Run: uvicorn main:app --reload --port 8000")
    print("   It should connect now.")
else:
    print("❌ Connection failed.")
    print("\nMost likely cause on Windows corporate networks:")
    print("  Port 5432 (PostgreSQL) is blocked by firewall/ISP/VPN.")
    print("\nFixes:")
    print("  Option A: Connect from a different network (mobile hotspot)")
    print("  Option B: Switch DATABASE_URL to Neon HTTP proxy (port 443)")
    print("  Option C: Ask your network admin to allow port 5432 outbound")
print("=" * 60)