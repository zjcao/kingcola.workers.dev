# ============================================================================
# 本地自检（路由与静态资源）
#   验证前台、后台深层路由（/admin/content/:resource）都能加载页面，
#   且静态资源使用绝对路径 —— 这两点在 base 配置错误时会静默 404。
#
# 与 scripts/smoke-api.ps1 的分工：
#   smoke-api   只测接口（认证 / CRUD / 教务网登录 / 审计）
#   probe-local 只测页面与静态资源
#
# 用法：pwsh -NoProfile -File scripts/probe-local.ps1
# ============================================================================

$base = 'http://127.0.0.1:8787'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '正在启动本地服务（首次约需 30 秒）…' -ForegroundColor DarkGray
# 只清理本脚本拉起的 workerd，不影响开发者自己 npm run local 起的服务
$preWorkerd = @((Get-Process -Name 'workerd' -ErrorAction SilentlyContinue).Id)
$proc = Start-Process -FilePath 'node' `
    -ArgumentList '.\node_modules\wrangler\bin\wrangler.js', 'dev', '--port', '8787' `
    -PassThru -WindowStyle Hidden

function Line($ok, $text) {
    $color = if ($ok) { 'Green' } else { 'Red' }
    Write-Host $text -ForegroundColor $color
}

try {
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Seconds 2
        try { Invoke-RestMethod "$base/api/health" -TimeoutSec 3 | Out-Null; $ready = $true; break } catch { }
    }
    Line $ready "wrangler dev ready=$ready"

    $boot = Invoke-RestMethod "$base/api/public/bootstrap"
    Line ($boot.data.members.Count -gt 0) `
        ("public/bootstrap -> members={0} projects={1} news={2} slides={3}" -f $boot.data.members.Count, $boot.data.projects.Count, $boot.data.news.Count, $boot.data.slides.Count)

    # 前台每个板块都是独立路径（直接输地址 / 刷新 / 分享都能落到对应板块），
    # 后台深层路由与「未知路径」同样应当返回同一个 SPA 外壳
    # （wrangler.toml: not_found_handling = "single-page-application"）。
    $paths = @('/', '/members', '/projects', '/news', '/join')
    $newsId = @($boot.data.news)[0].id
    if ($newsId) { $paths += "/news/$newsId" }
    $paths += @('/admin', '/admin/content/members', '/admin/content/news', '/admin/roles', '/admin/settings', '/this-path-does-not-exist')

    foreach ($path in $paths) {
        try {
            $r = Invoke-WebRequest "$base$path" -UseBasicParsing
            $hasRoot = $r.Content -match 'id="root"'
            $absAsset = $r.Content -match 'src="/assets/'
            Line ($r.StatusCode -eq 200 -and $hasRoot -and $absAsset) `
                ("{0,-26} -> HTTP {1}  root={2}  absAsset={3}" -f $path, $r.StatusCode, $hasRoot, $absAsset)
        } catch {
            Line $false ("{0,-26} -> ERR {1}" -f $path, $_.Exception.Message)
        }
    }

    $asset = [regex]::Match((Invoke-WebRequest "$base/" -UseBasicParsing).Content, 'src="(/assets/[^"]+)"').Groups[1].Value
    try {
        $code = (Invoke-WebRequest "$base$asset" -UseBasicParsing).StatusCode
        Line ($code -eq 200) "asset $asset -> HTTP $code"
    } catch {
        Line $false "asset $asset -> ERR"
    }

    $cfg = Invoke-RestMethod "$base/api/config/runtime"
    Line $cfg.data.initialized ("config/runtime -> initialized={0} sso={1} join={2}" -f $cfg.data.initialized, $cfg.data.config.sso.enabled, $cfg.data.config.join.mode)
} finally {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Get-Process -Name 'workerd' -ErrorAction SilentlyContinue |
        Where-Object { $preWorkerd -notcontains $_.Id } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}
