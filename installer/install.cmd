@echo off
rem 由 MoleClient-Setup.exe 自解压后调用。
rem 可选环境变量（供无人值守安装 / 自动化测试）：
rem   MOLE_SETUP_QUIET / MOLE_SETUP_TARGET / MOLE_SETUP_NOSHORTCUTS / MOLE_SETUP_NORUFFLE
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo 安装过程中出现错误，退出码 %errorlevel%。
  pause
)