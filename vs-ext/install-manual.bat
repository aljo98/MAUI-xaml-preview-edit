@echo off
echo Kopiranje extension v Visual Studio Extensions folder...

set "VS_EXTENSIONS_PATH=%LOCALAPPDATA%\Microsoft\VisualStudio\17.0_e8c6c8d0\Extensions\MauiXamlPreview"

:: Ustvari directory
if not exist "%VS_EXTENSIONS_PATH%" mkdir "%VS_EXTENSIONS_PATH%"

:: Kopiraj DLL in podporne datoteke
copy "J:\AF\maui-xaml-preview\MAUI-xaml-preview-edit\vs-ext\src\bin\Debug\MauiXamlPreviewVsix.dll" "%VS_EXTENSIONS_PATH%\"
copy "J:\AF\maui-xaml-preview\MAUI-xaml-preview-edit\vs-ext\src\bin\Debug\MauiXamlPreviewVsix.pdb" "%VS_EXTENSIONS_PATH%\"
copy "J:\AF\maui-xaml-preview\MAUI-xaml-preview-edit\vs-ext\src\bin\Debug\MauiXamlPreviewVsix.pkgdef" "%VS_EXTENSIONS_PATH%\"

:: Kopiraj WebView2 datoteke
xcopy "J:\AF\maui-xaml-preview\MAUI-xaml-preview-edit\vs-ext\src\bin\Debug\Microsoft.Web.WebView2*" "%VS_EXTENSIONS_PATH%\" /Y
xcopy "J:\AF\maui-xaml-preview\MAUI-xaml-preview-edit\vs-ext\src\bin\Debug\runtimes" "%VS_EXTENSIONS_PATH%\runtimes" /E /I /Y

echo Extension kopiran!
echo Ponovno zaženite Visual Studio 2022 Community
pause