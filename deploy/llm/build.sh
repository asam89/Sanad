#!/usr/bin/env bash
# Build llama.cpp natively on the OCI Ampere VM at a pinned commit (SPEC §4.1).
# ARM64 Neoverse N1: has dotprod, no i8mm, no SVE. GGML_NATIVE=ON picks this up.
set -euo pipefail

LLAMA_CPP_COMMIT="${LLAMA_CPP_COMMIT:-$(cat "$(dirname "$0")/LLAMA_CPP_COMMIT")}"

sudo apt update && sudo apt install -y build-essential cmake git libcurl4-openssl-dev
if [ ! -d /opt/llama.cpp ]; then
  sudo git clone https://github.com/ggml-org/llama.cpp /opt/llama.cpp
  sudo chown -R "$USER" /opt/llama.cpp
fi
cd /opt/llama.cpp
git fetch --tags origin
git checkout --detach "$LLAMA_CPP_COMMIT"
cmake -B build -DGGML_NATIVE=ON -DLLAMA_CURL=ON
cmake --build build --config Release -j4
./build/bin/llama-server --version
