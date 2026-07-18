@echo off
setlocal
set "APP_DIR=%~dp0"
set "SONGCUT_GUI_DIST=1"
set "SONGCUT_API_EXE=%APP_DIR%backend\songcut-api\songcut-api.exe"
set "SONGCUT_REPO_ROOT=%APP_DIR%"
set "SONGCUT_FFMPEG_DIR=%APP_DIR%third_party\ffmpeg\bin"
set "SONGCUT_MODEL_DIR=%APP_DIR%models"
set "OV_CACHE_DIR=%APP_DIR%ov-cache"
set "HF_HOME=%APP_DIR%hf-home"
set "HF_HUB_DISABLE_TELEMETRY=1"
set "OV_TELEMETRY_ENABLE=NO"
"%APP_DIR%electron\songcut.exe" "%APP_DIR%app"
endlocal
