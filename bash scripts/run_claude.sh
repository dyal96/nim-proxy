#!/bin/bash
# Configuration for Local NIM Proxy
export ANTHROPIC_API_KEY="sk-ant-dummy"
export ANTHROPIC_BASE_URL="http://localhost:8082/v1"
export ANTHROPIC_MODEL="meta/llama-3.1-70b-instruct"

echo "========================================"
echo "  NIM Proxy - Claude Code Launcher"
echo "========================================"
echo "Base URL: $ANTHROPIC_BASE_URL"
echo "Model:    $ANTHROPIC_MODEL"
echo ""

# Launch claude with any arguments passed to this script
claude "$@"
