@echo off
echo Registriranje MAUI XAML Preview Extension...

:: Ugotovi Visual Studio installation path
for /f "usebackq tokens=1* delims=: " %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere" -latest -property installationPath`) do (
  if /i "%%i"=="installationPath" set InstallDir=%%j
)

:: Registracija extension
reg add "HKEY_CURRENT_USER\Software\Microsoft\VisualStudio\17.0_Config\InstalledProducts\MauiXamlPreviewVsix" /v "Package" /t REG_SZ /d "{guid-placeholder}" /f
reg add "HKEY_CURRENT_USER\Software\Microsoft\VisualStudio\17.0_Config\Packages\{guid-placeholder}" /v "InprocServer32" /t REG_SZ /d "J:\AF\maui-xaml-preview\MAUI-xaml-preview-edit\vs-ext\src\bin\Debug\MauiXamlPreviewVsix.dll" /f
reg add "HKEY_CURRENT_USER\Software\Microsoft\VisualStudio\17.0_Config\Packages\{guid-placeholder}" /v "Class" /t REG_SZ /d "MauiXamlPreviewVsix.VsPackage" /f
reg add "HKEY_CURRENT_USER\Software\Microsoft\VisualStudio\17.0_Config\Packages\{guid-placeholder}" /v "CodeBase" /t REG_SZ /d "J:\AF\maui-xaml-preview\MAUI-xaml-preview-edit\vs-ext\src\bin\Debug\MauiXamlPreviewVsix.dll" /f

echo Extension registriran!
echo Ponovno zaženite Visual Studio 2022 Community
pause