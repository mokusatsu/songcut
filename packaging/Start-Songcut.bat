@echo off
setlocal
set "APP_DIR=%~dp0"
set "SONGCUT_GUI_DIST=1"
set "SONGCUT_API_EXE=%APP_DIR%backend\songcut-api\songcut-api.exe"
set "SONGCUT_REPO_ROOT=%APP_DIR%"
set "SONGCUT_FFMPEG_DIR=%APP_DIR%third_party\ffmpeg\bin"
set "SONGCUT_BUNDLED_MODEL_DIR=%APP_DIR%models"
set "SONGCUT_MODEL_DIR=%LOCALAPPDATA%\songcut\models"
set "OV_CACHE_DIR=%LOCALAPPDATA%\songcut\ov-cache"
set "HF_HOME=%LOCALAPPDATA%\songcut\hf-home"
set "HF_HUB_DISABLE_TELEMETRY=1"
set "OV_TELEMETRY_ENABLE=NO"
"%APP_DIR%electron\songcut.exe" "%APP_DIR%app"
endlocal
