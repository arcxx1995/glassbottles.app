#!/bin/bash
set -e

cd "$(dirname "$0")/.."
node apps/dashboard/server.mjs
