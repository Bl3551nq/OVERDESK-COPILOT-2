# Overdesk Copilot · Windows .EXE & Container Build Guide

## 1. Fast Windows .EXE Build
This repository is pre-configured with Electron and `electron-builder` to compile directly into a native standalone Windows `.exe` with stealth screen-capture protection (`WDA_EXCLUDEFROMCAPTURE`).

### Steps to Build on Windows:
```bash
# 1. Clone repository from GitHub
git clone https://github.com/your-username/overdesk-copilot.git
cd overdesk-copilot

# 2. Install dependencies (including electron-builder)
npm install
npm install -D electron electron-builder

# 3. Add your Gemini API Key in .env
echo GEMINI_API_KEY="your_api_key_here" > .env

# 4. Build the Windows EXE installer & portable app
npm run build:exe
```
The output `.exe` files will be in `/dist_electron/`:
- `Overdesk Copilot Setup 1.0.0.exe` (Installer)
- `Overdesk Copilot 1.0.0.exe` (Portable standalone executable)

---

## 2. Running as a Docker Container
A `Dockerfile` is included in this repository:

```bash
# Build the container
docker build -t overdesk-copilot .

# Run containerized server
docker run -p 3000:3000 -e GEMINI_API_KEY="your_api_key_here" overdesk-copilot
```

Visit `http://localhost:3000` in any browser.

---

## 3. How the Stealth Screen Cloaking Works
In `electron/main.cjs`, the native window activates:
```js
mainWindow.setContentProtection(true);
```
On Windows 10/11, this calls the Win32 Desktop Window Manager API `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`.

- **To you**: The floating glass panel is crystal clear and movable anywhere over your screen.
- **To Zoom / Microsoft Teams / Google Meet / Discord / OBS**: The window is excluded from the video stream and completely invisible to interviewers during screen sharing.
