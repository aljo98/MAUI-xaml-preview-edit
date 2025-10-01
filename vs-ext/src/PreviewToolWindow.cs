using System;
using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace MauiXamlPreviewVsix
{
  [Guid("C1B0E946-5089-4214-89BA-55D978B26884")]
  public class PreviewToolWindow : ToolWindowPane
  {
    public PreviewToolWindow() : base(null)
    {
      Caption = "MAUI XAML Preview";
      Content = new PreviewToolWindowControl();
    }
  }
}
