using System;
using System.Runtime.InteropServices;
using System.Threading;
using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.Shell;
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
      await this.RegisterCommandsAsync();
    }

    private async Task RegisterCommandsAsync()
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var cmd = new Community.VisualStudio.Toolkit.ToolkitCommand(new Guid("7B0F8A5A-4B0C-4E6A-9B1B-5A1F3F86B5E1"), 0);
      cmd.Executed += async (s, e) => await ShowToolWindowAsync();
    }

    public async Task ShowToolWindowAsync()
    {
      await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
      var window = await this.ShowToolWindowAsync(typeof(PreviewToolWindow), 0, true, DisposalToken);
    }
  }
}
