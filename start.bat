@echo off
chcp 65001 >nul
title ExamHub 本地服务
cd /d "%~dp0"
echo ============================================================
echo   ExamHub 本地服务
echo ------------------------------------------------------------
echo   电脑本机      http://127.0.0.1:8686/
echo   手机(同 WiFi)  http://下方本机IP:8686/
echo.
echo   [!] 局域网 http 只能当网页看，浏览器不允许安装。
echo       手机上要「安装成 App」，请用 https 地址：
echo        https://xsw-1123.github.io/ExamHub/
echo ============================================================
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo   本机IP:%%a
echo.
start "" "http://127.0.0.1:8686/"
python -m http.server 8686 --bind 0.0.0.0
