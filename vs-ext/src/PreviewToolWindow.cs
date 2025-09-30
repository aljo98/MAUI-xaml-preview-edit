using System;
using System.Runtime.InteropServices;
using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.Shell;

namespace MauiXamlPreviewVsix
{
  [Guid("C1B0E946-5089-4214-89BA-55D978B26884")]
  public class PreviewToolWindow : BaseToolWindow<PreviewToolWindow>
  {
    public override string GetTitle(int toolWindowId) => "MAUI XAML Preview";

    public override Type PaneType => typeof(Pane);

    public override System.Windows.FrameworkElement CreateControl() => new PreviewToolWindowControl();

    [Guid("F3D73EAD-5840-4A74-8F44-259B0E14E6B4")]
    public class Pane : ToolWindowPane
    {
      public Pane() : base(null)
      {
        Caption = "MAUI XAML Preview";
        Content = new PreviewToolWindowControl();
      }
    }
  }
}
