using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;

namespace MauiXamlPreviewVsix
{
  public partial class PreviewToolWindowControl : UserControl
  {
    public PreviewToolWindowControl()
    {
      InitializeComponent();
      Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
      try
      {
        await Web.EnsureCoreWebView2Async();
        var baseDir = AppContext.BaseDirectory ?? string.Empty;
        var htmlPath = Path.Combine(baseDir, "assets", "preview.html");
        if (File.Exists(htmlPath))
        {
          Web.Source = new Uri(htmlPath);
        }
        else
        {
          Web.NavigateToString("<!doctype html><html><body><div style='padding:12px;font-family:Segoe UI'>Missing preview.html</div></body></html>");
        }
      }
      catch (Exception ex)
      {
        MessageBox.Show(ex.Message, "WebView2 init error");
      }
    }

    private void OnOpenXamlClick(object sender, RoutedEventArgs e)
    {
      var dlg = new Microsoft.Win32.OpenFileDialog()
      {
        Filter = "XAML files (*.xaml)|*.xaml|All files (*.*)|*.*",
        CheckFileExists = true
      };
      if (dlg.ShowDialog() == true)
      {
        var xaml = File.ReadAllText(dlg.FileName);
        SendXamlToWebView(xaml);
      }
    }

    private void SendXamlToWebView(string xaml)
    {
      try
      {
        string msg = "{\"type\":\"renderXaml\",\"xaml\":" + ToJsonString(xaml) + "}";
        Web.CoreWebView2?.PostWebMessageAsString(msg);
      }
      catch { }
    }

    private static string ToJsonString(string s)
    {
      if (s == null) return "null";
      return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\"";
    }
  }
}
