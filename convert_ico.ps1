Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::new("assets\logo_emercre.png")
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.FileStream]::new("assets\favicon.ico", [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
Write-Host "OK: favicon.ico creado en assets/"
