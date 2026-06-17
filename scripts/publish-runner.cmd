@echo off
REM Runner invoked by Windows Task Scheduler to publish the next blog draft.
REM Logs all output (with a timestamp header) to drafts\publish.log.
cd /d "C:\Users\User\Documents\Projects\myfreeimagetool"
echo. >> drafts\publish.log
echo ===== Run at %DATE% %TIME% ===== >> drafts\publish.log
"C:\Program Files\nodejs\node.exe" scripts\publish-next-draft.mjs >> drafts\publish.log 2>&1
