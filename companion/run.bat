@echo off
cd /d "%~dp0"
echo ===================================================
echo DiipMynd Local GPU Accelerator Setup
echo ===================================================
echo.

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate

echo Installing / upgrading dependencies...
pip install -r requirements.txt --default-timeout=100

echo.
echo Starting DiipMynd FastAPI Engine on port 8000...
set PYTHONUNBUFFERED=1
python main.py
pause
