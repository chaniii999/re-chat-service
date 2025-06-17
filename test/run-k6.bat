@echo off
set "SCRIPT_NAME=k6-v1-high-vus-scalability-test.js"
for %%f in ("%SCRIPT_NAME%") do set "BASE_NAME=%%~nf"
set "RESULT_FILE=%BASE_NAME%_result.txt"

echo Running test: %SCRIPT_NAME%

REM 임시 로그 파일을 사용해서 성공했을 때만 결과 저장
k6 run %SCRIPT_NAME% > temp_k6_output.txt 2>&1

if %ERRORLEVEL% EQU 0 (
    move /Y temp_k6_output.txt %RESULT_FILE%
    echo ✅ Test completed and saved to: %RESULT_FILE%
) else (
    echo ❌ k6 run failed. Check temp_k6_output.txt for details.
    notepad temp_k6_output.txt
)

pause
