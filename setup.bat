@echo off
echo ==================================================
echo   NIM-Claude Proxy Setup
echo ==================================================

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.8+ from https://python.org and try again.
    pause
    exit /b
)

echo [1/3] Installing uv (Fast Python Package Installer)...
pip install uv >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install uv.
    pause
    exit /b
)

echo [2/3] Installing required Python packages using uv...
uv pip install --system fastapi uvicorn requests
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies using uv.
    pause
    exit /b
)

echo [2/3] Setting up environment configuration...
if not exist .env (
    if exist .env.sample (
        copy .env.sample .env >nul
        echo [OK] Created .env from .env.sample.
        echo Opening .env in Notepad... Please add your NVIDIA_API_KEY and save the file.
        notepad .env
    ) else (
        echo [WARNING] .env.sample not found. Please manually create a .env file with your NVIDIA_API_KEY.
    )
) else (
    echo [OK] .env file already exists.
)

echo.
echo [3/3] Setup Complete!
echo.
echo You can now start the proxy server by running:
echo   start_proxy.bat
echo.
pause
