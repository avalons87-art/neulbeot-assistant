@echo off
title Neulbeot Assistant - Firewall Setup
REM ============================================================
REM  Allow other teachers on the school network to reach this
REM  server. RUN THIS ONCE, as Administrator (right-click > Run as admin).
REM  Opens TCP port 4000 for inbound connections.
REM ============================================================
set PORT=4000

netsh advfirewall firewall delete rule name="Neulbeot Assistant" >nul 2>&1
netsh advfirewall firewall add rule name="Neulbeot Assistant" dir=in action=allow protocol=TCP localport=%PORT%

echo.
echo Done. Port %PORT% is now open for inbound connections.
echo Other teachers can connect at:  http://THIS-PC-IP:%PORT%
echo (Run start-server.bat to see this PC's IP addresses.)
echo.
pause
