@echo off
echo Starting NVIDIA NIM Proxy...
uv run --with fastapi --with requests --with uvicorn nim_proxy.py
pause
