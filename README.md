# NIM-Claude Proxy & Web UI

A high-performance translation layer that enables NVIDIA NIM models to perfectly emulate the Anthropic Claude API. Includes a premium, responsive Web UI for local testing and full compatibility with **Claude Code**, **Continue**, **Cline**, and more.

![NIM Proxy Interface](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/zap.svg)

## 🚀 Features

- **Claude Emulation**: Mimics Anthropic's `/v1/messages` endpoint for drop-in compatibility with almost any AI IDE.
- **Premium SPA Web UI**: A stunning, modern Single Page Application interface with glassmorphism, responsive design, and dynamic routing.
- **Advanced Dashboard**: Real-time analytics, token usage tracking, and model performance metrics stored locally via SQLite.
- **Live Benchmarking**: Built-in benchmarking tool to test and compare tokens-per-second (TPS) and Time To First Token (TTFT) across different models.
- **Persistent Chat**: Multi-session chat history, streaming responses, and DeepSeek-R1 reasoning support (parsing `<think>` tags).
- **In-App Configuration**: Update your NVIDIA API Key, active model, and generation parameters dynamically without restarting the proxy.
- **IDE Configurations**: One-click configuration snippets for popular tools like Claude Code, VS Code Continue, Cline, Crush, and Antigravity.

## 🛠️ Setup

### 1. Prerequisites
- Python 3.8+
- NVIDIA API Key ([Get one here](https://build.nvidia.com/))

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/dyal96/nim-proxy
cd nim-proxy

# Run the setup script (Windows)
# This will use `uv` for fast dependency installation and create a .env file
setup.bat
```

Alternatively, install manually:
```bash
pip install uv
uv pip install --system fastapi uvicorn requests
```

### 3. Configuration
The setup script will guide you to create a `.env` file in the root directory:
```env
NVIDIA_API_KEY="your_nvapi_key_here"
NIM_MODEL="meta/llama-3.1-70b-instruct"
DEFAULT_TEMPERATURE="1.0"
```
*(You can also configure these settings directly from the Web UI!)*

## 🏃 Running the Proxy

```bash
# Windows users can use the provided batch file:
start_proxy.bat

# Or run directly via Python:
python nim_proxy.py
```
The proxy will start on [http://localhost:8082](http://localhost:8082). Open this URL in your browser to access the Web UI.

## 🤖 Using with AI IDEs

You can find copy-paste configuration snippets for your favorite IDEs directly within the **IDE Configs** tab of the Web UI!

### 1. Claude Code (CLI)
```powershell
$env:ANTHROPIC_BASE_URL="http://localhost:8082/v1"
$env:ANTHROPIC_API_KEY="sk-ant-dummy"
claude
```

### 2. VS Code / Cline / Roo Code
1. Set **API Provider** to `Anthropic`.
2. Set **Base URL** to `http://localhost:8082`.
3. Set **API Key** to `sk-ant-dummy`.

### 3. VS Code / Continue
In your `config.json`:
```json
{
  "models": [
    {
      "title": "NVIDIA NIM (Local)",
      "provider": "openai",
      "model": "meta/llama-3.1-70b-instruct",
      "apiBase": "http://localhost:8082/v1",
      "apiKey": "sk-ant-dummy"
    }
  ]
}
```
Hybrid `.config.yaml` for continue :
```
name: My Config
version: 1.0.0
schema: v1
models:
  - name: "NVIDIA Nemotron Nano 9B V2"
    provider: nvidia
    model: nvidia/nvidia-nemotron-nano-9b-v2
    apiBase: "https://integrate.api.nvidia.com/v1"
    # Use an env var reference so you don't store keys in plaintext here.
    apiKey: "env:NVIDIA_API_KEY"
    roles:
      - chat
      - edit
      - apply
    defaultCompletionOptions:
      temperature: 0.7
      maxTokens: 1500

  - name: "Codestral"
    provider: mistral
    model: codestral-latest
    roles:
      - autocomplete
    autocompleteOptions:
      debounceDelay: 250
      maxPromptTokens: 1024
      onlyMyCode: true

  - name: "NIM Proxy (local)"
    provider: openai
    model: qwen/qwen3-coder-480b-a35b-instruct
    apiBase: "http://127.0.0.1:8082/v1"
    # Use an env var reference so you don't store keys in plaintext here.
    apiKey: "env:NVIDIA_API_KEY"
    capabilities:
      - tool_use
      - image_input
    roles:
      - chat
      - edit
    defaultCompletionOptions:
      temperature: 1.0
      maxTokens: 1024
```
### 4. Crush (Terminal AI)
Add to your `.crush.json`:
```json
{
  "providers": {
    "nim-local": {
      "name": "NVIDIA NIM (Local)",
      "base_url": "http://localhost:8082/v1/",
      "type": "openai-compat",
      "api_key": "sk-ant-dummy",
      "models": [
        {
          "id": "meta/llama-3.1-70b-instruct",
          "name": "Llama 3.1 70b"
        }
      ]
    }
  }
}
```
### 4. Crush (Antropic) (Terminal AI)
Add to your `.crush.json`:
```json
{
  "$schema": "https://charm.land/crush.json",
  "models": {
    "large": {
      "model": "qwen/qwen3-coder-480b-a35b-instruct",
      "provider": "nim-local"
    }
  },
  "providers": {
    "nim-local": {
      "name": "NVIDIA NIM (Local)",
      "base_url": "http://localhost:8082/v1/",
      "type": "openai-compat",
      "api_key": "sk-ant-dummy",
      "models": [
        {
          "id": "qwen/qwen3-coder-480b-a35b-instruct",
          "name": "qwen3-coder-480b-a35b-instruct",
          "context_window": 128000,
          "default_max_tokens": 8192
        }
      ]
    }
  },
  "options": {
    "debug": true
  }
}
```
## 📝 License
MIT
