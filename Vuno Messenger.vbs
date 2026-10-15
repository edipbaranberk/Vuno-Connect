Set WshShell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = dir
WshShell.Run "cmd.exe /c """ & dir & "\node_modules\.bin\electron.cmd"" .", 0, False
