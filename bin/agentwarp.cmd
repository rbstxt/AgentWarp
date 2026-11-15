@echo off
rem AgentWarp CLI for Windows (agents running in cmd or PowerShell). In the desktop app the engine
rem sets AGENTWARP_NODE to its own Node (Electron run as Node), so no Node install is needed.
setlocal
if defined AGENTWARP_NODE (
  set ELECTRON_RUN_AS_NODE=1
  "%AGENTWARP_NODE%" "%~dp0..\packages\cli\agentwarp.ts" %*
) else (
  node "%~dp0..\packages\cli\agentwarp.ts" %*
)
exit /b %ERRORLEVEL%
