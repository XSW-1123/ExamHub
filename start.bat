@echo off
chcp 65001 >nul
title MealNow 面试背题
cd /d "%~dp0"
echo 正在启动本地服务 http://127.0.0.1:8686/ ...
start "" "http://127.0.0.1:8686/"
python -m http.server 8686 --bind 127.0.0.1
