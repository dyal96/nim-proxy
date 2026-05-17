@echo off
:: Configuration for Local NIM Proxy
set ANTHROPIC_API_KEY=freecc
set ANTHROPIC_AUTH_TOKEN=
set ANTHROPIC_BASE_URL=http://localhost:8082
set ANTHROPIC_MODEL=meta/llama-3.1-70b-instruct
set CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1

echo ========================================
echo   NIM Proxy - Claude Code Launcher
echo ========================================
echo Base URL: %ANTHROPIC_BASE_URL%
echo Model:    %ANTHROPIC_MODEL%
echo.
echo Launching Claude Code...
echo ========================================
echo.

:: Launch claude with any arguments passed to this batch script
claude %*

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Claude exited with code %ERRORLEVEL%
    pause
)
