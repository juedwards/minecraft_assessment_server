Running the Minecraft Assessment Server (quick start)

1) Requirements
- Python 3.8+ (recommend 3.10/3.11/3.12)
- Git (optional)

2) Quick start (PowerShell)
Open PowerShell (pwsh.exe) in the project folder and run:

# Create venv, install packages, and run the server
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\run_server.ps1

3) Manual steps (if you prefer)
python -m venv .venv
.\.venv\Scripts\Activate.ps1  # in PowerShell
pip install -r requirements.txt
python .\app.py

4) Environment variables
- Copy `.env.example` to `.env` and fill in values for Azure OpenAI if you want the AI analysis feature.
- Important variables:
  - AZURE_OPENAI_API_KEY
  - AZURE_OPENAI_ENDPOINT
  - AZURE_OPENAI_DEPLOYMENT_NAME (default: gpt-4.1)

5) Ports
- HTTP static site: 8080
- WebSocket updates: 8081
- Minecraft WebSocket port (for the Education client): 19131

6) Verify
- Open http://localhost:8080 in your browser to view the web UI.
- Visit http://localhost:8080/api/server-info to see the server-info JSON.

7) Troubleshooting
- If the server doesn't start, check for missing packages with `pip list` inside the venv.
- If WebSocket clients cannot connect, ensure Windows Firewall allows inbound connections to ports 8081 and 19131.
- If you see Azure OpenAI warnings, confirm AZURE_OPENAI_API_KEY is set in `.env`.
