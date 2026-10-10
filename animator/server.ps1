# Аниматор 2D — локальный сервер для Windows (без Python и без установки).
# Запуск: двойной клик по start.bat (или: powershell -ExecutionPolicy Bypass -File server.ps1)
param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) { $root += [System.IO.Path]::DirectorySeparatorChar }

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'
  '.ico' = 'image/x-icon'; '.wav' = 'audio/wav'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.txt' = 'text/plain; charset=utf-8'
}

# свободный порт: 8080, 8081, ...
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $Port = $p
    break
  } catch { }
}
if ($null -eq $listener) {
  Write-Host 'Не удалось запустить сервер: порты 8080-8099 заняты.' -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  Аниматор 2D запущен:' -ForegroundColor Green
Write-Host "  $url" -ForegroundColor Cyan
Write-Host ''
Write-Host '  Не закрывайте это окно, пока работаете в редакторе.'
Write-Host '  Чтобы остановить сервер — закройте окно или нажмите Ctrl+C.'
Write-Host ''
if (-not $env:ANIM2D_NO_BROWSER) { try { Start-Process $url } catch { Write-Host "  Откройте адрес в браузере вручную: $url" } }

function Send-Bytes($ctx, [int]$code, [string]$type, [byte[]]$bytes) {
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = $type
  $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

try {
  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(300)) { }
    $ctx = $task.Result
    try {
      $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($rel.EndsWith('/')) { $rel += 'index.html' }
      $parts = $rel.Split('/') | Where-Object { $_ -ne '' }
      $file = $root
      foreach ($part in $parts) { $file = [System.IO.Path]::Combine($file, $part) }
      $file = [System.IO.Path]::GetFullPath($file)
      if ($file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($file)) {
        $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        Send-Bytes $ctx 200 $type ([System.IO.File]::ReadAllBytes($file))
      } else {
        Send-Bytes $ctx 404 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('404: файл не найден'))
      }
    } catch {
      try { Send-Bytes $ctx 500 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('500')) } catch { }
    } finally {
      try { $ctx.Response.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}
