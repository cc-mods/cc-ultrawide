<#
.SYNOPSIS
    Installs (or uninstalls) the CrossCode Ultrawide mod by linking this repo into
    CrossCode/assets/mods via a directory junction.

.DESCRIPTION
    A junction lets you keep editing the mod in this repo while the game loads it live.
    Junctions to local paths do NOT require admin rights (symlinks would), so this should
    just work from a normal PowerShell prompt.

.PARAMETER GamePath
    Path to the CrossCode install folder. Defaults to the standard Steam location.

.PARAMETER Uninstall
    Remove the junction instead of creating it.

.EXAMPLE
    ./install.ps1
.EXAMPLE
    ./install.ps1 -GamePath "D:\Games\CrossCode"
.EXAMPLE
    ./install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$GamePath = "C:\Program Files (x86)\Steam\steamapps\common\CrossCode",
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$modName  = 'crosscode-ultrawide'
$source   = $PSScriptRoot
$modsDir  = Join-Path $GamePath 'assets\mods'
$target   = Join-Path $modsDir $modName

if (-not (Test-Path $GamePath)) {
    throw "CrossCode not found at '$GamePath'. Pass -GamePath with the correct location."
}
if (-not (Test-Path (Join-Path $GamePath 'ccloader'))) {
    Write-Warning "No 'ccloader' folder in '$GamePath'. Install CCLoader first: https://github.com/CCDirectLink/CCLoader"
}

if ($Uninstall) {
    if (Test-Path $target) {
        $item = Get-Item $target -Force
        if ($item.LinkType) {
            $item.Delete()
            Write-Host "Removed junction: $target" -ForegroundColor Green
        } else {
            throw "'$target' exists but is a real folder, not a junction. Refusing to delete it."
        }
    } else {
        Write-Host "Nothing to remove; '$target' does not exist." -ForegroundColor Yellow
    }
    return
}

if (-not (Test-Path $modsDir)) {
    New-Item -ItemType Directory -Path $modsDir -Force | Out-Null
}

if (Test-Path $target) {
    $item = Get-Item $target -Force
    if ($item.LinkType) {
        $item.Delete()
    } else {
        throw "'$target' already exists as a real folder. Remove it manually first."
    }
}

New-Item -ItemType Junction -Path $target -Target $source | Out-Null
Write-Host "Linked '$source'" -ForegroundColor Green
Write-Host "    ->  '$target'" -ForegroundColor Green
Write-Host ""
Write-Host "Done. Launch CrossCode, then set Display Type = Fit and Pixel Size = 4." -ForegroundColor Cyan
