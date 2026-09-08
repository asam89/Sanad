#!/usr/bin/env bash
# Fetch GGUF models into /opt/models (SPEC §4.2). Never commit these files.
set -euo pipefail
sudo mkdir -p /opt/models && sudo chown "$USER" /opt/models
cd /opt/models
dl() { [ -f "$2" ] || curl -L --fail -o "$2" "$1"; }
dl https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf Qwen2.5-3B-Instruct-Q4_K_M.gguf
# 7B is published as a 2-part split; llama-server loads the first shard and finds the second automatically.
dl https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf Qwen2.5-7B-Instruct-Q4_K_M-00001-of-00002.gguf
dl https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf Qwen2.5-7B-Instruct-Q4_K_M-00002-of-00002.gguf
dl https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf bge-small-en-v1.5-q8_0.gguf
ls -lh /opt/models
