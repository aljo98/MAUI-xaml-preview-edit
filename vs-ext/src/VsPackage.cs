using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Task = System.Threading.Tasks.Task;

namespace MauiXamlPreviewVsix
{
  [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
  [InstalledProductRegistration("MAUI XAML Preview", "Tool Window for previewing MAUI XAML", "0.1")] // Info on this package for Help/About
  [ProvideMenuResource("Menus.ctmenu", 1)]
  [ProvideToolWindow(typeof(PreviewToolWindow))]
  [Guid(PackageGuidString)]
  public sealed class VsPackage : AsyncPackage
  {
    public const string PackageGuidString = "E5D37C7F-BD8A-4E6C-9E6A-9BB9DAD3F2B2";

    protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
    }

    public async Task ShowToolWindowAsync()
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var window = this.FindToolWindow(typeof(PreviewToolWindow), 0, true);
      if (window?.Frame == null)
      {
        throw new NotSupportedException("Cannot create tool window");
      }

      var windowFrame = (IVsWindowFrame)window.Frame;
      Microsoft.VisualStudio.ErrorHandler.ThrowOnFailure(windowFrame.Show());
    }
  }
}
