param([switch]$Test)
# 모던 윈도우 폴더 선택창(탐색기 스타일) — IFileOpenDialog + FOS_PICKFOLDERS
Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;
namespace NBFolder {
  [ComImport, ClassInterface(ClassInterfaceType.None), Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
  public class FileOpenDialogRCW { }

  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileOpenDialog {
    [PreserveSig] uint Show([In] IntPtr parent);
    void SetFileTypes([In] uint cFileTypes, [In] IntPtr rgFilterSpec);
    void SetFileTypeIndex([In] uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise([In] IntPtr pfde, out uint pdwCookie);
    void Unadvise([In] uint dwCookie);
    void SetOptions([In] uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder([In] IShellItem psi);
    void SetFolder([In] IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace([In] IShellItem psi, int alignment);
    void SetDefaultExtension([In, MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close([MarshalAs(UnmanagedType.Error)] int hr);
    void SetClientGuid([In] ref Guid guid);
    void ClearClientData();
    void SetFilter([MarshalAs(UnmanagedType.Interface)] IntPtr pFilter);
    void GetResults([MarshalAs(UnmanagedType.Interface)] out IntPtr ppenum);
    void GetSelectedItems([MarshalAs(UnmanagedType.Interface)] out IntPtr ppsai);
  }

  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler([In] IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName([In] uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes([In] uint sfgaoMask, out uint psfgaoAttribs);
    void Compare([In] IShellItem psi, [In] uint hint, out int piOrder);
  }

  public static class Picker {
    public static string Pick() {
      var dlg = (IFileOpenDialog)(new FileOpenDialogRCW());
      uint opts;
      dlg.GetOptions(out opts);
      dlg.SetOptions(opts | 0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
      dlg.SetTitle("Neulbeot - select your work folder");
      uint hr = dlg.Show(IntPtr.Zero);
      if (hr != 0) return null; // cancelled
      IShellItem item;
      dlg.GetResult(out item);
      string path;
      item.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
      return path;
    }
  }
}
"@
if ($Test) { [Console]::Out.Write('OK'); return }
$p = [NBFolder.Picker]::Pick()
if ($p) { [Console]::Out.Write($p) }
