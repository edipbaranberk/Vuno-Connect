param(
    [string]$Notes = "",
    [string]$Version = "",
    [switch]$NoNotes,
    [switch]$SkipBuild,
    [switch]$SkipUpload
)

# Vuno Connect — electron-builder + Cloudflare R2 yayin akisi
# Kullanim: release\Yayinla.bat  (veya: powershell -File publish.ps1 [-Version 1.0.1] [-Notes "..."])
# Konsolda Türkçe karakterlerin doğru görünmesi (UTF-8)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ErrorActionPreference = "Stop"

# ── Ayarlar ──────────────────────────────────────────────────────────────────
$ProjectRoot = Split-Path -Parent $PSScriptRoot          # release'in bir üstü = proje kökü
$R2Bucket    = "vuno-loop-videos"
$R2Prefix    = "vuno-connect"
$R2Base      = "https://pub-2579a8d7f18148d39d5d10db5046ddfe.r2.dev"

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  [HATA] $msg" -ForegroundColor Red; exit 1 }

# ── 1) Sürüm belirle: package.json'dan oku, otomatik artır ──────────────────
Step "1/5  Sürüm belirleniyor"
$pkgPath = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path $pkgPath)) { Fail "package.json bulunamadı: $pkgPath" }
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$current = $pkg.version

if ($Version) {
    $version = $Version
} else {
    $parts = @($current -split '\.')
    while ($parts.Count -lt 3) { $parts += '0' }
    $parts[2] = [string]([int]$parts[2] + 1)
    $version = ($parts[0..2] -join '.')
}

if ($version -ne $current) {
    # package.json'u node ile guvenli yaz (PowerShell BOM/encoding riski yok)
    & node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));p.version=process.argv[2];fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2)+'\n');" $pkgPath $version
    if ($LASTEXITCODE -ne 0) { Fail "package.json sürümü güncellenemedi." }
}
Ok "Sürüm: v$version  (önceki: v$current)"

# ── 1.5) Sürüm notları (opsiyonel, "yaz-gönder") ─────────────────────────────
if (-not $NoNotes -and -not $Notes) {
    Write-Host ""
    Write-Host "  Bu sürümdeki yenilikleri yazın (her satıra bir madde)." -ForegroundColor Cyan
    Write-Host "  Bitirmek icin BOS satir birakip Enter'a basin. (Atlamak icin direkt Enter)" -ForegroundColor DarkGray
    $lines = @()
    while ($true) {
        $l = Read-Host "  Yenilik"
        if ([string]::IsNullOrWhiteSpace($l)) { break }
        $lines += $l.Trim()
    }
    if ($lines.Count -gt 0) {
        $Notes = ($lines -join "`n")
        Ok "Notlar alındı ($($lines.Count) satır)"
    }
}

# ── 2) electron-builder ile derle (NSIS kurulum) ─────────────────────────────
if (-not $SkipBuild) {
    Step "2/5  Uygulama derleniyor (electron-builder)"
    Push-Location $ProjectRoot
    try {
        Remove-Item -Recurse -Force (Join-Path $ProjectRoot "dist") -ErrorAction SilentlyContinue
        npx electron-builder --win --publish never
        if ($LASTEXITCODE -ne 0) { Fail "electron-builder başarısız." }
    } finally { Pop-Location }
    Ok "dist hazır"
} else {
    Step "2/5  Derleme atlandı (-SkipBuild)"
}

# ── 3) Kurulum dosyasını bul ─────────────────────────────────────────────────
Step "3/5  Kurulum dosyası kontrol ediliyor"
$setup = Join-Path $ProjectRoot "dist\Vuno-Connect-Setup-$version.exe"
if (-not (Test-Path $setup)) {
    # electron-builder sürümü dosya adına yazmayabilir; dist içindeki tek Setup'ı al
    $cands = Get-ChildItem (Join-Path $ProjectRoot "dist") -Filter "*Setup*.exe" -ErrorAction SilentlyContinue
    if ($cands.Count -eq 1) { $setup = $cands[0].FullName }
}
if (-not (Test-Path $setup)) { Fail "Kurulum dosyası oluşmadı: $setup" }
Ok "Bulundu: $setup"

# ── 4) version.json (hash + boyut otomatik) ──────────────────────────────────
Step "4/5  version.json hazırlanıyor"
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $setup).Length
$manifest = [ordered]@{
    version   = $version
    url       = "$R2Base/$R2Prefix/Vuno-Connect-Setup-$version.exe"
    sha256    = $hash
    size      = $size
    notes     = $Notes
    mandatory = $false
}
$manifestPath = Join-Path $PSScriptRoot "version.json"
$json = $manifest | ConvertTo-Json
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Ok "SHA-256: $hash"
Ok "Boyut  : $([math]::Round($size / 1MB, 1)) MB"

# ── 5) R2'ye yükle ───────────────────────────────────────────────────────────
if (-not $SkipUpload) {
    Step "5/5  R2'ye yükleniyor"
    npx wrangler r2 object put "$R2Bucket/$R2Prefix/Vuno-Connect-Setup-$version.exe" --file="$setup" --content-type="application/octet-stream" --remote
    if ($LASTEXITCODE -ne 0) { Fail "wrangler yüklemesi başarısız. 'npx wrangler whoami' ile girişi kontrol et." }
    npx wrangler r2 object put "$R2Bucket/$R2Prefix/Vuno-Connect-Setup-latest.exe" --file="$setup" --content-type="application/octet-stream" --remote
    npx wrangler r2 object put "$R2Bucket/$R2Prefix/version.json" --file="$manifestPath" --content-type="application/json" --cache-control="no-cache" --remote
    if ($LASTEXITCODE -ne 0) { Fail "version.json yüklenemedi." }
    Ok "Yükleme tamam"

    # Yeni sürüm yüklendi -> önceki sürümlü dosyayı sil (R2'de tek sürüm kalsın)
    if ($current -and $current -ne $version) {
        npx wrangler r2 object delete "$R2Bucket/$R2Prefix/Vuno-Connect-Setup-$current.exe" --remote *> $null
        Write-Host "  Önceki sürüm silindi: $current" -ForegroundColor DarkGray
    }
} else {
    Step "5/5  Yükleme atlandı (-SkipUpload)"
}

Write-Host "`n✅ Tamam kanka! Sürüm v$version yayında." -ForegroundColor Green
Write-Host "   Manifest: $R2Base/$R2Prefix/version.json`n" -ForegroundColor Green
