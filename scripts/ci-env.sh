#!/usr/bin/env bash
# Writes backend/.env for CI from backend/.env.example: the job's PostgreSQL service and a throwaway HR_DATA_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."
key=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")
url="postgresql://hrtp_ci:hrtp_ci@localhost:5432/hrtp_ci?schema=public&connection_limit=5&connect_timeout=3&pool_timeout=3&socket_timeout=3"
grep -v -E '^(DATABASE_URL|HR_DATA_KEY)=' backend/.env.example > backend/.env
{ echo "DATABASE_URL=\"$url\""; echo "HR_DATA_KEY=$key"; } >> backend/.env
mkdir -p .local
