# assets/icon.png dosyasindan cok boyutlu (16-256) gecerli bir assets/icon.ico uretir.
# Kullanim: powershell -ExecutionPolicy Bypass -File tools\make-ico.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root "assets\icon.png"
$dstPath = Join-Path $root "assets\icon.ico"
$sizes = @(16, 24, 32, 48, 64, 128, 256)

$src = [System.Drawing.Image]::FromFile($srcPath)

function Get-DibEntry([System.Drawing.Image]$src, [int]$s) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()

    $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $row = New-Object byte[] ($s * 4)
    $pixels = New-Object byte[] ($s * $s * 4)
    for ($y = 0; $y -lt $s; $y++) {
        # ICO DIB satirlari alttan uste dogru ve BGRA sirasinda tutar
        $srcPtr = [System.IntPtr]::Add($data.Scan0, $y * $stride)
        [System.Runtime.InteropServices.Marshal]::Copy($srcPtr, $row, 0, $s * 4)
        $dst = ($s - 1 - $y) * $s * 4
        for ($x = 0; $x -lt $s; $x++) {
            $pixels[$dst + $x * 4 + 0] = $row[$x * 4 + 2] # B
            $pixels[$dst + $x * 4 + 1] = $row[$x * 4 + 1] # G
            $pixels[$dst + $x * 4 + 2] = $row[$x * 4 + 0] # R
            $pixels[$dst + $x * 4 + 3] = $row[$x * 4 + 3] # A
        }
    }
    $bmp.UnlockBits($data)
    $bmp.Dispose()

    # AND maskesi (1bpp, satir basina 32 bitte hizalanmis, hep 0 = tam opak alfa kullaniliyor)
    $maskRow = [Math]::Ceiling($s / 32.0) * 4
    $mask = New-Object byte[] ($maskRow * $s)

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    # BITMAPINFOHEADER — biHeight XOR+AND toplami kadar (2x)
    $bw.Write([UInt32]40); $bw.Write([Int32]$s); $bw.Write([Int32]($s * 2))
    $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]0)
    $bw.Write([UInt32](($s * $s * 4) + $mask.Length)); $bw.Write([Int32]0); $bw.Write([Int32]0); $bw.Write([UInt32]0); $bw.Write([UInt32]0)
    $bw.Write($pixels)
    $bw.Write($mask)
    $bw.Flush()
    return $ms.ToArray()
}

$entries = @()
foreach ($s in $sizes) {
    $e = Get-DibEntry $src $s
    Write-Host "  boyut $s -> $($e.Length) bayt"
    $entries += , $e
}
$src.Dispose()

# ICO konteyneri
$out = New-Object System.IO.MemoryStream
$ow = New-Object System.IO.BinaryWriter($out)
$ow.Write([UInt16]0); $ow.Write([UInt16]1); $ow.Write([UInt16]$sizes.Count)
$offset = 6 + (16 * $sizes.Count)
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $byte = if ($s -ge 256) { 0 } else { $s }
    $ow.Write([Byte]$byte); $ow.Write([Byte]$byte)   # genislik, yukseklik
    $ow.Write([Byte]0); $ow.Write([Byte]0)           # renk sayisi, rezerve
    $ow.Write([UInt16]1); $ow.Write([UInt16]32)      # duzlem, bit derinligi
    $ow.Write([UInt32]$entries[$i].Length); $ow.Write([UInt32]$offset)
    $offset += $entries[$i].Length
}
foreach ($e in $entries) { $ow.Write([byte[]]$e) }
$ow.Flush()
[System.IO.File]::WriteAllBytes($dstPath, $out.ToArray())
Write-Host "OK: $dstPath ($([math]::Round($out.Length / 1KB, 1)) KB, $($sizes.Count) boyut)"
