# MAUI XAML Preview VSIX (Visual Studio)

This folder contains a minimal Visual Studio extension (VSIX) scaffold that adds a Tool Window named "MAUI XAML Preview" under View > Other Windows in Visual Studio Community edition (VS 2022+). It’s intended as a starting point for a future Visual Studio 2026 Community setup.

What’s included
- VSIX manifest targeting Community edition (VS 17.0+).
- AsyncPackage registration and a Tool Window.
- WPF control placeholder where preview UI can be implemented (e.g., WebView2-based renderer to reuse your VS Code preview HTML).

Build instructions (on Windows)
1) Open the solution `MauiXamlPreviewVsix.sln` in Visual Studio (Community 2022 or newer).
2) Ensure the Visual Studio extension development workload is installed.
3) Build the solution; press F5 to launch the experimental instance.
4) Open View > Other Windows > MAUI XAML Preview.

Notes
- This is a scaffold. You can bring over your parsing/HTML rendering logic and host it inside the WPF control (recommended: WebView2).
- The manifest targets VS 17.0+ and the Community edition explicitly; future 2026 builds should be supported once SDKs are available.
- To add commands under Tools or context menus, add a .vsct command table or use Community.VisualStudio.Toolkit for faster wiring.