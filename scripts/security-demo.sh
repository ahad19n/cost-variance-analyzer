#!/usr/bin/env bash
# Live security demonstration against a running instance (safe test data only).
# Usage: scripts/security-demo.sh [base_url]   (default http://localhost:3000, needs seeded demo users)
set -u
BASE=${1:-http://localhost:3000}
DIR=$(cd "$(dirname "$0")/.." && pwd)
J=$(mktemp)
trap 'rm -f "$J"' EXIT

csrf() { curl -s -c "$J" -b "$J" "$BASE$1" | grep -o 'name="csrf-token" content="[^"]*"' | sed 's/.*content="//;s/"$//'; }

echo "== Login as alice (seeded demo user)"
T=$(csrf /login)
curl -s -o /dev/null -w "POST /login -> %{http_code}\n" -c "$J" -b "$J" --data-urlencode "_csrf=$T" -d "username=alice&password=alice-demo-pass" "$BASE/login"
T=$(csrf /)

echo
echo "== TEST 1: Invalid file uploads"
echo "-- 1a. Windows executable renamed to invoice.csv"
curl -s -w "  -> HTTP %{http_code}\n" -b "$J" -H "X-CSRF-Token: $T" -H "Accept: application/json" -F "file=@$DIR/sample-data/fake-executable.csv;filename=invoice.csv" "$BASE/projects/1/upload"
echo "-- 1b. 3 MB file"
head -c 3145728 /dev/zero | tr '\0' 'a' > /tmp/big.csv
curl -s -w "  -> HTTP %{http_code}\n" -b "$J" -H "X-CSRF-Token: $T" -H "Accept: application/json" -F "file=@/tmp/big.csv" "$BASE/projects/1/upload"
echo "-- 1c. Disallowed type (.html)"
curl -s -w "  -> HTTP %{http_code}\n" -b "$J" -H "X-CSRF-Token: $T" -H "Accept: application/json" -F "file=@$DIR/sample-data/xss.csv;filename=page.html" "$BASE/projects/1/upload"
echo "-- 1d. Wrong columns"
curl -s -w "  -> HTTP %{http_code}\n" -b "$J" -H "X-CSRF-Token: $T" -H "Accept: application/json" -F "file=@$DIR/sample-data/missing-columns.csv" "$BASE/projects/1/upload"

echo
echo "== TEST 2: Unauthorized project access (alice -> bob's project #2)"
for p in /projects/2 /projects/2/data.json /projects/2/report.pdf /projects/2/report.csv; do
  curl -s -o /dev/null -w "GET $p -> %{http_code}\n" -b "$J" -H "Accept: application/json" "$BASE$p"
done
curl -s -o /dev/null -w "POST /projects/2/delete (valid CSRF token) -> %{http_code}\n" -b "$J" -H "X-CSRF-Token: $T" -X POST "$BASE/projects/2/delete"
curl -s -o /dev/null -w "GET /projects/1 (alice's own) -> %{http_code}\n" -b "$J" "$BASE/projects/1"
curl -s -o /dev/null -w "GET /projects/1 (no session) -> %{http_code} (redirect to login)\n" "$BASE/projects/1"

echo
echo "== TEST 3: Excessive requests (brute-force login)"
J2=$(mktemp)
T2=$(curl -s -c "$J2" -b "$J2" "$BASE/login" | grep -o 'name="csrf-token" content="[^"]*"' | sed 's/.*content="//;s/"$//')
for i in 1 2 3 4 5 6 7; do
  curl -s -o /dev/null -w "attempt $i -> %{http_code}\n" -c "$J2" -b "$J2" --data-urlencode "_csrf=$T2" -d "username=alice&password=wrong-$i" "$BASE/login"
done
echo "-- Rate-limit headers on the blocked response:"
curl -s -D - -o /dev/null -c "$J2" -b "$J2" --data-urlencode "_csrf=$T2" -d "username=alice&password=x" "$BASE/login" | grep -iE "^(HTTP|ratelimit|retry-after)"
rm -f "$J2" /tmp/big.csv
