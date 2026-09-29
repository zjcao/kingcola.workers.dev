# ============================================================================
# 后端冒烟测试：启动 wrangler dev（本地 D1），依次验证
#   1) /api/health
#   2) 初始化管理员 + 写入演示内容
#   3) 管理员登录 → 内容 CRUD → 操作日志
#   4) /api/public/bootstrap 公开只读
#   5) 教务网登录端点（login 跳转 / 伪造回调 / 登出）
#   6) /api/config/runtime 运行时配置
#
# 用法：powershell -File scripts/smoke-api.ps1
# 前置：已完成 npm install 与 npm run db:migrate:local
# ============================================================================

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($name) { Write-Host "`n== $name ==" -ForegroundColor Cyan }

# 记录本次启动前已存在的 workerd，收尾时只清理自己拉起来的，
# 避免把开发者手动 npm run local 起的服务一起杀掉。
$preWorkerd = @((Get-Process -Name 'workerd' -ErrorAction SilentlyContinue).Id)
$proc = Start-Process -FilePath 'node' `
    -ArgumentList '.\node_modules\wrangler\bin\wrangler.js', 'dev', '--port', '8787' `
    -PassThru -WindowStyle Hidden

try {
    Write-Host '正在启动本地服务（首次约需 30 秒）…' -ForegroundColor DarkGray
    # 等待服务就绪
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Seconds 2
        try {
            Invoke-RestMethod "$base/api/health" -TimeoutSec 3 | Out-Null
            $ready = $true
            break
        } catch { }
    }
    if (-not $ready) { throw 'wrangler dev 未在预期时间内就绪' }

    Step '1) /api/health'
    $health = Invoke-RestMethod "$base/api/health"
    Write-Host "database=$($health.data.database) ssoConfigured=$($health.data.ssoConfigured)" -ForegroundColor Green

    Step '2) 初始化管理员 + 演示内容'
    $bootstrap = Invoke-RestMethod "$base/api/admin/bootstrap" -Method Post -ContentType 'application/json' -Body (@{
            token       = 'dev-recovery-token-please-change'
            username    = 'admin'
            password    = 'kingcola-dev-2026'
            displayName = '工作室管理员'
            seedContent = $true
        } | ConvertTo-Json)
    Write-Host "created=$($bootstrap.data.created) seeded=$($bootstrap.data.seeded | ConvertTo-Json -Compress)" -ForegroundColor Green

    Step '3) 管理员登录'
    $login = Invoke-WebRequest "$base/api/admin/login" -Method Post -ContentType 'application/json' `
        -Body (@{ username = 'admin'; password = 'kingcola-dev-2026' } | ConvertTo-Json) -UseBasicParsing
    # 手动携带 Cookie：本地为 http，客户端可能拒绝发送 Secure Cookie
    $cookie = ($login.Headers['Set-Cookie'] -split ';')[0]
    $authHeaders = @{ Cookie = $cookie }
    Write-Host "cookie=$($cookie.Substring(0, [Math]::Min(24, $cookie.Length)))..." -ForegroundColor Green

    Step '4) 后台内容 CRUD（四类内容全覆盖，含自增主键）'
    $payloads = [ordered]@{
        members  = @{ name = '冒烟-成员'; nameEn = 'Smoke'; title = '前端开发'; joinYear = '2026'; status = 'current'; isPI = $false; direction = '自动化测试'; destination = '冒烟测试去向'; bio = '' }
        projects = @{ name = '冒烟-项目'; tagline = '自动化测试'; description = ''; tags = @('Test', 'Smoke'); year = '2026'; link = ''; honor = '冒烟测试荣誉'; featured = $true }
        news     = @{ title = '冒烟-新闻'; category = '通知公告'; date = '2026-01-01'; summary = ''; content = '自动化测试'; pinned = $false }
        slides   = @{ type = 'text'; kicker = 'SMOKE'; title = '冒烟-轮播'; subtitle = ''; ctaText = '测试'; ctaPage = 'home' }
    }
    foreach ($res in $payloads.Keys) {
        $before = Invoke-RestMethod "$base/api/admin/content/$res" -Headers $authHeaders

        $created = Invoke-RestMethod "$base/api/admin/content/$res" -Method Post -Headers $authHeaders `
            -ContentType 'application/json' -Body ($payloads[$res] | ConvertTo-Json -Depth 5)
        $id = $created.data.id
        if (-not $id) { throw "$res 新增后未返回 id" }

        # 改一个该资源真实存在的字段，再读回确认更新生效
        $patched = $payloads[$res].Clone()
        $labelKey = if ($patched.ContainsKey('name')) { 'name' } elseif ($patched.ContainsKey('title')) { 'title' } else { $null }
        if ($labelKey) { $patched[$labelKey] = "$($patched[$labelKey])-已改" }
        if ($patched.ContainsKey('sortOrder')) { $patched['sortOrder'] = 999 }

        Invoke-RestMethod "$base/api/admin/content/$res/$id" -Method Put -Headers $authHeaders `
            -ContentType 'application/json' -Body ($patched | ConvertTo-Json -Depth 5) | Out-Null

        $fetched = (Invoke-RestMethod "$base/api/admin/content/$res/$id" -Headers $authHeaders).data
        $updateOk = (-not $labelKey) -or ($fetched.$labelKey -eq $patched[$labelKey])

        Invoke-RestMethod "$base/api/admin/content/$res/$id" -Method Delete -Headers $authHeaders | Out-Null

        $after = Invoke-RestMethod "$base/api/admin/content/$res" -Headers $authHeaders
        $countOk = ($after.data.total -eq $before.data.total)
        $ok = $updateOk -and $countOk
        Write-Host ("{0,-9} id={1,-6} total {2} → {3}  更新={4} 删除={5}  {6}" -f `
                $res, $id, $before.data.total, $after.data.total,
            $(if ($updateOk) { 'OK' } else { '未生效!' }),
            $(if ($countOk) { 'OK' } else { '数量不一致!' }),
            $(if ($ok) { 'OK' } else { 'FAIL' })) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
    }

    # 自增主键专项：id 必须是正整数，且连续新增时递增
    $p1 = (Invoke-RestMethod "$base/api/admin/content/projects" -Method Post -Headers $authHeaders `
            -ContentType 'application/json' -Body (@{ name = '自增测试A'; year = '2026' } | ConvertTo-Json)).data
    $p2 = (Invoke-RestMethod "$base/api/admin/content/projects" -Method Post -Headers $authHeaders `
            -ContentType 'application/json' -Body (@{ name = '自增测试B'; year = '2026' } | ConvertTo-Json)).data
    if ($p1.id -isnot [int] -and $p1.id -isnot [long]) { throw "项目 id 应为整数，实际为 '$($p1.id)'" }
    if ($p2.id -le $p1.id) { throw "项目 id 未自增：$($p1.id) → $($p2.id)" }
    Invoke-RestMethod "$base/api/admin/content/projects/$($p1.id)" -Method Delete -Headers $authHeaders | Out-Null
    Invoke-RestMethod "$base/api/admin/content/projects/$($p2.id)" -Method Delete -Headers $authHeaders | Out-Null
    Write-Host "自增主键 OK：id 为整数且递增（$($p1.id) → $($p2.id)）" -ForegroundColor Green

    # 确认已删除的「状态 / 权重」字段确实不再存在，新字段确实存在
    $projectItems = (Invoke-RestMethod "$base/api/admin/content/projects" -Headers $authHeaders).data.items
    if (@($projectItems).Count -gt 0) {
        $projectKeys = @($projectItems)[0].PSObject.Properties.Name
        foreach ($gone in 'status', 'sortOrder') {
            if ($projectKeys -contains $gone) { throw "项目仍存在已删除字段：$gone" }
        }
        foreach ($added in 'honor', 'featured') {
            if ($projectKeys -notcontains $added) { throw "项目缺少新字段：$added" }
        }
        Write-Host "项目字段 OK：已移除 status/sortOrder，新增 honor/featured" -ForegroundColor Green
    }
    else {
        Write-Host '项目表为空，跳过字段检查' -ForegroundColor Yellow
    }

    # 轮播两种形态：字段存在 + 图片版允许不填标题（标题只对文字版必填）
    $slideItems = (Invoke-RestMethod "$base/api/admin/content/slides" -Headers $authHeaders).data.items
    if (@($slideItems).Count -gt 0) {
        $slideKeys = @($slideItems)[0].PSObject.Properties.Name
        foreach ($added in 'type', 'imageUrl') {
            if ($slideKeys -notcontains $added) { throw "轮播缺少新字段：$added" }
        }
        Write-Host '轮播字段 OK：新增 type/imageUrl' -ForegroundColor Green
    }

    $imageSlide = (Invoke-RestMethod "$base/api/admin/content/slides" -Method Post -Headers $authHeaders `
            -ContentType 'application/json' -Body (@{
                type = 'image'; title = ''; subtitle = ''; ctaText = ''; ctaPage = 'home'; imageUrl = ''
            } | ConvertTo-Json)).data
    if ($imageSlide.type -ne 'image') { throw "图片版轮播类型未正确回读：$($imageSlide.type)" }
    Invoke-RestMethod "$base/api/admin/content/slides/$($imageSlide.id)" -Method Delete -Headers $authHeaders | Out-Null

    # 文字版没标题应当被拒绝（条件必填生效）
    $blocked = $false
    try {
        Invoke-RestMethod "$base/api/admin/content/slides" -Method Post -Headers $authHeaders `
            -ContentType 'application/json' -Body (@{
                type = 'text'; title = ''; subtitle = ''; ctaText = ''; ctaPage = 'home'
            } | ConvertTo-Json) | Out-Null
    }
    catch {
        $blocked = $true
    }
    if (-not $blocked) { throw '文字版轮播缺标题竟然通过了校验' }
    Write-Host '轮播校验 OK：图片版可不填标题，文字版标题必填' -ForegroundColor Green

    Step '4b) 成员方向字典（运行时字典驱动「角色」白名单）'
    $rolesBefore = (Invoke-RestMethod "$base/api/admin/member-roles" -Headers $authHeaders).data.roles
    Write-Host "方向字典 $($rolesBefore.Count) 个：$((($rolesBefore | Select-Object -First 4).label) -join ' / ')" -ForegroundColor Green
    if (-not ($rolesBefore | Where-Object { $_.label -eq '指导老师' -and $_.kind -eq 'faculty' -and $_.selectableBySelf -eq $false })) {
        throw '默认字典里「指导老师」应当是 faculty 且不允许学生自助选择'
    }

    # 「角色」的合法取值来自运行时字典（shared/resources.ts 里的 options 只是兜底），
    # 所以写一个字典里不存在的方向**必须**被拒 —— 否则这份字典就形同虚设
    $badRoleBlocked = $false
    try {
        Invoke-RestMethod "$base/api/admin/content/members" -Method Post -Headers $authHeaders `
            -ContentType 'application/json' -Body (@{
                name = '冒烟-非法方向'; title = '不存在的方向'; joinYear = '2026'
                status = 'current'; direction = 'x'; isPI = $false; bio = ''
            } | ConvertTo-Json) | Out-Null
    }
    catch { $badRoleBlocked = $true }
    if (-not $badRoleBlocked) { throw '角色取值不在方向字典里，却通过了校验' }
    Write-Host '角色白名单 OK：字典外的方向被拒绝' -ForegroundColor Green

    # 非学生方向即使被提交成「允许自助选择」，后端也必须纠正为 false
    # （身份是组织授予的 —— 这是邀请函那条边界的根防线）
    $withProbe = @($rolesBefore) + @(@{
            label = '冒烟-方向'; kind = 'faculty'; selectableBySelf = $true; order = 999; retired = $false
        })
    $savedRoles = (Invoke-RestMethod "$base/api/admin/member-roles" -Method Put -Headers $authHeaders `
            -ContentType 'application/json' -Body (@{ roles = $withProbe } | ConvertTo-Json -Depth 6)).data.roles
    if (($savedRoles | Where-Object { $_.label -eq '冒烟-方向' }).selectableBySelf -ne $false) {
        throw '非学生方向的「学生可自选」没有被纠正为 false'
    }

    # 复原成进入时的样子（「冒烟-方向」没有被任何成员引用，所以移除不需要 confirmRemoval）
    $restoredRoles = (Invoke-RestMethod "$base/api/admin/member-roles" -Method Put -Headers $authHeaders `
            -ContentType 'application/json' -Body (@{ roles = $rolesBefore } | ConvertTo-Json -Depth 6)).data.roles
    if (@($restoredRoles).Count -ne @($rolesBefore).Count) { throw '方向字典没有复原' }
    Write-Host '方向字典读写 + 复原 OK（非学生方向的自选开关被强制关闭）' -ForegroundColor Green

    Step '5) 工作室信息全字段读写'
    $cfgBefore = Invoke-RestMethod "$base/api/admin/config" -Headers $authHeaders

    # 逐个字段写入再读回，确保后台能改的都真的存得下
    $probeSite = @{
        studioName       = '冒烟测试工作室'
        studioNameEn     = 'SMOKE STUDIO'
        slogan           = '冒烟测试定位语'
        contactEmail     = 'smoke@example.edu.cn'
        contactPhone     = '010-00000000'
        contactAddress   = '自动化测试地址'
        aboutTitle       = '冒烟测试简介标题'
        statLabels       = 'A,B,C,D'
        joinTitle        = '冒烟测试报名页'
        joinIntro        = '冒烟测试报名说明'
        joinSteps        = "第一步 | 描述一`n第二步 | 描述二"
        joinRequirements = "要求一`n要求二`n要求三"
        marqueeText      = 'SMOKE · TEST · '
        footerCopyright  = '© {year} 冒烟测试'
        recruitTitle     = '冒烟测试招新标题'
        logoUrl          = ''
    }

    Invoke-RestMethod "$base/api/admin/config" -Method Put -Headers $authHeaders -ContentType 'application/json' `
        -Body (@{ site = $probeSite } | ConvertTo-Json -Depth 5) | Out-Null

    $cfgAfter = Invoke-RestMethod "$base/api/admin/config" -Headers $authHeaders
    $mismatch = @()
    foreach ($key in $probeSite.Keys) {
        $actual = $cfgAfter.data.site.$key
        if ("$actual" -ne "$($probeSite[$key])") {
            $mismatch += "$key（期望 '$($probeSite[$key])'，实际 '$actual'）"
        }
    }
    if ($mismatch.Count -gt 0) { throw "站点字段写入异常：$($mismatch -join '; ')" }
    Write-Host "$($probeSite.Keys.Count) 个工作室信息字段全部可读写 OK" -ForegroundColor Green

    $publicSite = Invoke-RestMethod "$base/api/public/site-config"
    Write-Host "public/site-config -> studioName=$($publicSite.data.studioName)  copyright=$($publicSite.data.footerCopyright)" -ForegroundColor Green

    Step '5b) 报名通道切换'
    Invoke-RestMethod "$base/api/admin/config" -Method Put -Headers $authHeaders -ContentType 'application/json' -Body (@{
            runtime = @{ join = @{ mode = 'edgeone'; edgeone = 'https://join.example.cn' }; failover = $true; rolloutPercent = 25 }
        } | ConvertTo-Json -Depth 5) | Out-Null
    $rt = (Invoke-RestMethod "$base/api/config/runtime").data.config
    if ($rt.join.mode -ne 'edgeone' -or $rt.rolloutPercent -ne 25) {
        throw "报名通道切换未生效：mode=$($rt.join.mode) rollout=$($rt.rolloutPercent)"
    }
    Write-Host "报名通道 -> v$($rt.version) mode=$($rt.join.mode) base=$($rt.join.edgeone) rollout=$($rt.rolloutPercent)%" -ForegroundColor Green

    Step '5c) 教务网登录（后台开关 + 地址）'
    Invoke-RestMethod "$base/api/admin/config" -Method Put -Headers $authHeaders -ContentType 'application/json' -Body (@{
            runtime = @{ sso = @{ enabled = $true; authorizeBase = 'https://sso.example.cn' } }
        } | ConvertTo-Json -Depth 5) | Out-Null
    $sso = (Invoke-RestMethod "$base/api/config/runtime").data.config.sso
    if (-not $sso.enabled -or $sso.authorizeBase -ne 'https://sso.example.cn') {
        throw "教务网登录配置未生效：$($sso | ConvertTo-Json -Compress)"
    }

    # 接通后：/api/auth/login 应 302 跳去授权服务器（curl 不跟随重定向，只取响应头）
    $head = (& curl.exe -s -o NUL -D - "$base/api/auth/login") -join "`n"
    if ($head -notmatch ' 302' -or $head -notmatch 'sso\.example\.cn' -or $head -notmatch 'response_type=code') {
        throw "接通后 /api/auth/login 未跳转到授权服务器：$head"
    }
    Write-Host '教务网登录 -> 已接通，/api/auth/login 302 到授权服务器' -ForegroundColor Green

    # 关掉开关：应 302 回首页带 not_configured，而不是把 JSON 错误页甩给用户
    Invoke-RestMethod "$base/api/admin/config" -Method Put -Headers $authHeaders -ContentType 'application/json' `
        -Body (@{ runtime = @{ sso = @{ enabled = $false } } } | ConvertTo-Json -Depth 5) | Out-Null
    $head2 = (& curl.exe -s -o NUL -D - "$base/api/auth/login") -join "`n"
    if ($head2 -notmatch ' 302' -or $head2 -notmatch 'login=not_configured') {
        throw "关闭开关后 /api/auth/login 应 302 回首页带 not_configured：$head2"
    }
    Write-Host '教务网登录 -> 关闭后 302 回首页 not_configured（官网不再展示入口）' -ForegroundColor Green

    # 恢复原值，避免影响后续手工测试
    Invoke-RestMethod "$base/api/admin/config" -Method Put -Headers $authHeaders -ContentType 'application/json' `
        -Body (@{
            site    = $cfgBefore.data.site
            runtime = @{
                join           = @{ mode = $cfgBefore.data.runtime.join.mode; edgeone = $cfgBefore.data.runtime.join.edgeone }
                sso            = @{ enabled = $cfgBefore.data.runtime.sso.enabled; authorizeBase = $cfgBefore.data.runtime.sso.authorizeBase }
                rolloutPercent = $cfgBefore.data.runtime.rolloutPercent
            }
        } | ConvertTo-Json -Depth 5) | Out-Null
    $restoredCfg = (Invoke-RestMethod "$base/api/admin/config" -Headers $authHeaders).data
    Write-Host "配置已复原：studioName=$($restoredCfg.site.studioName) join=$($restoredCfg.runtime.join.mode) sso=$($restoredCfg.runtime.sso.enabled)" -ForegroundColor DarkGray

    Step '6) 公开只读接口'
    $boot = Invoke-RestMethod "$base/api/public/bootstrap"
    Write-Host ("bootstrap: members={0} projects={1} news={2} slides={3}" -f `
            $boot.data.members.Count, $boot.data.projects.Count, $boot.data.news.Count, $boot.data.slides.Count) -ForegroundColor Green

    Step '7) 教务网登录'
    $me = Invoke-RestMethod "$base/api/auth/me"
    Write-Host "auth/me -> authenticated=$($me.data.authenticated)（未登录时应为 false）" -ForegroundColor Green
    if ($me.data.authenticated) { throw '未携带 Cookie 却报告已登录' }

    # 登录入口是整页跳转：拿 Location 即可，不跟随（授权服务器可能不在本机）
    $loginLoc = (curl.exe -s -o NUL -w '%{redirect_url}' "$base/api/auth/login")
    Write-Host "auth/login -> $loginLoc" -ForegroundColor Green
    if (-not $loginLoc) { throw '登录入口没有返回跳转地址' }

    # 伪造的凭据必须被挡在门外，且只能回首页报告原因
    $cbLoc = (curl.exe -s -o NUL -w '%{redirect_url}' "$base/api/auth/callback?code=fake&state=fake")
    Write-Host "auth/callback（伪造凭据）-> $cbLoc" -ForegroundColor Green
    if ($cbLoc -notmatch 'login=(state_mismatch|denied|exchange_failed)') { throw "伪造回调未被拒绝：$cbLoc" }

    $out = Invoke-RestMethod "$base/api/auth/logout" -Method Post
    Write-Host "auth/logout -> loggedOut=$($out.data.loggedOut)" -ForegroundColor Green

    Step '8) 成员头像上传 / 读取 / 替换清理'
    # 一张 1x1 的合法 PNG，仅用于验证文件头嗅探与 R2 读写
    $pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    $tmpImage = Join-Path $env:TEMP 'smoke-avatar.png'
    [IO.File]::WriteAllBytes($tmpImage, [Convert]::FromBase64String($pngB64))

    # 用 curl.exe 上传：它的 multipart 形态与浏览器 FormData 一致
    Push-Location $env:TEMP
    $up = (& curl.exe -s -X POST "$base/api/admin/uploads" -H "Cookie: $($authHeaders['Cookie'])" `
            -F 'file=@smoke-avatar.png;type=image/png' -F 'scope=avatars') | ConvertFrom-Json
    Pop-Location
    if (-not $up.ok) { throw "头像上传失败: $($up.error.message)" }
    Write-Host "upload -> $($up.data.url)  $($up.data.contentType)  $($up.data.size)B" -ForegroundColor Green

    $target = (Invoke-RestMethod "$base/api/admin/content/members" -Headers $authHeaders).data.items | Select-Object -First 1
    function MemberBody($avatar) {
        return (@{
                name = $target.name; nameEn = $target.nameEn; title = $target.title
                direction = $target.direction; destination = $target.destination
                email = $target.email; joinYear = $target.joinYear
                status = $target.status; isPI = $target.isPI; bio = $target.bio; avatarUrl = $avatar
                homepageUrl = $target.homepageUrl
            } | ConvertTo-Json -Depth 5)
    }

    Invoke-RestMethod "$base/api/admin/content/members/$($target.id)" -Method Put -Headers $authHeaders `
        -ContentType 'application/json' -Body (MemberBody $up.data.url) | Out-Null

    $pub = Invoke-RestMethod "$base/api/public/bootstrap"
    $hit = @($pub.data.members | Where-Object { $_.avatarUrl -eq $up.data.url }).Count
    Write-Host "公开接口中带该头像的成员数 = $hit（应为 1）" -ForegroundColor Green

    $img = Invoke-WebRequest "$base$($up.data.url)" -UseBasicParsing
    Write-Host "GET 文件 -> HTTP $($img.StatusCode)  type=$($img.Headers['Content-Type'])  cache=$($img.Headers['Cache-Control'])" -ForegroundColor Green

    # 非法类型应被拒绝
    $fake = Join-Path $env:TEMP 'smoke-fake.png'
    [IO.File]::WriteAllText($fake, 'this is not an image')
    Push-Location $env:TEMP
    $fakeResp = (& curl.exe -s -X POST "$base/api/admin/uploads" -H "Cookie: $($authHeaders['Cookie'])" `
            -F 'file=@smoke-fake.png;type=image/png' -F 'scope=avatars') | ConvertFrom-Json
    Pop-Location
    if ($fakeResp.ok) {
        Write-Host '伪造图片竟然通过了校验！' -ForegroundColor Red
    } else {
        Write-Host "伪造扩展名的假图片已被拒绝：$($fakeResp.error.code)" -ForegroundColor Green
    }

    # 清空头像字段应连带删除 R2 里的旧文件
    Invoke-RestMethod "$base/api/admin/content/members/$($target.id)" -Method Put -Headers $authHeaders `
        -ContentType 'application/json' -Body (MemberBody '') | Out-Null
    try {
        Invoke-WebRequest "$base$($up.data.url)" -UseBasicParsing -ErrorAction Stop | Out-Null
        Write-Host '旧头像文件仍存在（预期应被清理）' -ForegroundColor Red
    } catch {
        Write-Host '旧头像已随字段清空一并从 R2 删除' -ForegroundColor Green
    }

    # 个人主页：后台写进去之后，公开接口要能读到（成员卡片用它渲染「个人主页」链接）
    $homeBody = @{
        name = $target.name; nameEn = $target.nameEn; title = $target.title
        direction = $target.direction; destination = $target.destination
        email = $target.email; homepageUrl = 'https://smoke.example.com/me'; joinYear = $target.joinYear
        status = $target.status; isPI = $target.isPI; bio = $target.bio; avatarUrl = ''
    } | ConvertTo-Json -Depth 5
    Invoke-RestMethod "$base/api/admin/content/members/$($target.id)" -Method Put -Headers $authHeaders `
        -ContentType 'application/json' -Body $homeBody | Out-Null
    $pubHome = Invoke-RestMethod "$base/api/public/bootstrap"
    $homeHit = @($pubHome.data.members | Where-Object { $_.homepageUrl -eq 'https://smoke.example.com/me' }).Count
    if ($homeHit -eq 1) {
        Write-Host '个人主页字段：写入成功且公开接口可读' -ForegroundColor Green
    } else {
        Write-Host "个人主页字段没写进去（公开接口命中 $homeHit，应为 1）" -ForegroundColor Red
    }
    # 恢复原值，别把冒烟数据留在库里
    Invoke-RestMethod "$base/api/admin/content/members/$($target.id)" -Method Put -Headers $authHeaders `
        -ContentType 'application/json' -Body (MemberBody '') | Out-Null

    Step '8b) 上传体积上限按子目录区分（头像 2MB / 轮播 50MB）'
    # 造一张 3MB 的图：文件头是合法 PNG，后面补零
    $bigImage = Join-Path $env:TEMP 'smoke-big.png'
    $pngBytes = [Convert]::FromBase64String($pngB64)
    $bigBytes = New-Object byte[] (3 * 1024 * 1024)
    [Array]::Copy($pngBytes, 0, $bigBytes, 0, $pngBytes.Length)
    [IO.File]::WriteAllBytes($bigImage, $bigBytes)

    # 头像上限 2MB：3MB 必须被拒
    Push-Location $env:TEMP
    $bigAvatar = (& curl.exe -s -X POST "$base/api/admin/uploads" -H "Cookie: $($authHeaders['Cookie'])" `
            -F 'file=@smoke-big.png;type=image/png' -F 'scope=avatars') | ConvertFrom-Json
    Pop-Location
    if ($bigAvatar.ok) { throw '头像的体积上限没生效：3MB 竟然上传成功' }
    Write-Host "头像上限生效：$($bigAvatar.error.message)" -ForegroundColor Green

    # 轮播上限 50MB：同一张图应当通过（顺带验证大文件也是按 Blob 直接进 R2）
    Push-Location $env:TEMP
    $bigSlide = (& curl.exe -s -X POST "$base/api/admin/uploads" -H "Cookie: $($authHeaders['Cookie'])" `
            -F 'file=@smoke-big.png;type=image/png' -F 'scope=slides') | ConvertFrom-Json
    Pop-Location
    if (-not $bigSlide.ok) { throw "轮播图上传失败（3MB 应当允许）: $($bigSlide.error.message)" }
    Write-Host "轮播上限生效：3MB 上传成功 $($bigSlide.data.url)" -ForegroundColor Green

    # 挂到一条图片版轮播上再删掉：图片版不需要任何文字，且删记录会顺手清理 R2 文件
    $imageSlide = Invoke-RestMethod "$base/api/admin/content/slides" -Method Post -Headers $authHeaders `
        -ContentType 'application/json' -Body (@{
            type = 'image'; imageUrl = $bigSlide.data.url
            kicker = ''; title = ''; subtitle = ''; ctaText = ''; ctaPage = 'home'
        } | ConvertTo-Json)
    Invoke-RestMethod "$base/api/admin/content/slides/$($imageSlide.data.id)" -Method Delete -Headers $authHeaders | Out-Null
    $afterDelete = & curl.exe -s -o NUL -w '%{http_code}' "$base$($bigSlide.data.url)"
    if ($afterDelete -eq '404') {
        Write-Host '图片版轮播 OK：无需文字字段，删记录后大图也被清理' -ForegroundColor Green
    } else {
        Write-Host "图片版轮播的大图未被清理（HTTP $afterDelete）" -ForegroundColor Red
    }

    Remove-Item $tmpImage, $fake, $bigImage -Force -ErrorAction SilentlyContinue

    Step '8c) 批量毕业 + 毕业去向填写页（凭证即密权）'
    # 走完整链路：批量毕业（顺带发信）→ 签发专属链接 → 打开 / 提交 → 链接一次性失效 → 去向写回成员档案
    $gradResp = Invoke-RestMethod "$base/api/admin/content/members" -Method Post -Headers $authHeaders `
        -ContentType 'application/json' -Body (@{
            name = '冒烟-毕业生'; nameEn = ''; title = '前端开发'; direction = '自动化测试'
            destination = ''; email = 'smoke-graduate@example.com'; joinYear = '2022'
            status = 'current'; isPI = $false; bio = ''; avatarUrl = ''; homepageUrl = ''; sortOrder = 0
        } | ConvertTo-Json -Depth 5)
    $gradId = $gradResp.data.id
    $graduated = Invoke-RestMethod "$base/api/admin/members/graduate" -Method Post -Headers $authHeaders `
        -ContentType 'application/json' -Body (@{ ids = @($gradId); sendMail = $true } | ConvertTo-Json)
    Write-Host "批量毕业 -> $($graduated.data.message)" -ForegroundColor Green

    # 链接是凭证，刻意不出现在任何接口的返回值里 —— 只能从库里取（这同时也是「没泄露」的证明）
    $wrangler = Join-Path $root 'node_modules\wrangler\bin\wrangler.js'
    $tokenRaw = node $wrangler d1 execute kingcola-db --local --json `
        --command="SELECT destination_token FROM members WHERE id = '$gradId'" | Out-String
    $gradToken = ([regex]::Match($tokenRaw, 'gd_[0-9a-z]+')).Value
    if (-not $gradToken) { throw '批量毕业没有签发毕业去向链接' }

    $form = Invoke-RestMethod "$base/api/members/destination/$gradToken"
    Write-Host "填写页（无需登录）-> $($form.data.name)  已有值='$($form.data.current)'" -ForegroundColor Green

    Invoke-RestMethod "$base/api/members/destination/$gradToken" -Method Post -ContentType 'application/json' `
        -Body (@{ destination = '冒烟测试去向' } | ConvertTo-Json) | Out-Null
    $reuse = & curl.exe -s -o NUL -w '%{http_code}' "$base/api/members/destination/$gradToken"
    if ($reuse -eq '404') {
        Write-Host '链接提交后立即失效（每条只能用一次）' -ForegroundColor Green
    } else {
        Write-Host "链接竟然还能重复提交（HTTP $reuse）" -ForegroundColor Red
    }

    $saved = (Invoke-RestMethod "$base/api/admin/content/members/$gradId" -Headers $authHeaders).data
    Write-Host "去向已写回成员档案：状态=$($saved.status)  加入年份=$($saved.joinYear)  去向=$($saved.destination)" -ForegroundColor Green
    Write-Host "token 是否泄露到公开接口：" -NoNewline
    $publicRaw = & curl.exe -s "$base/api/public/bootstrap"
    if ($publicRaw -match 'destination_token') {
        Write-Host ' 泄露了！' -ForegroundColor Red
    } else {
        Write-Host ' 没有（按字段表逐列回传）' -ForegroundColor Green
    }
    Invoke-RestMethod "$base/api/admin/content/members/$gradId" -Method Delete -Headers $authHeaders | Out-Null

    Step '9) 操作日志'
    $audit = Invoke-RestMethod "$base/api/admin/audit?limit=6" -Headers $authHeaders
    Write-Host "audit logs=$($audit.data.logs.Count)" -ForegroundColor Green
    $audit.data.logs | ForEach-Object { Write-Host ("  {0} {1} {2} {3}" -f $_.actor, $_.action, $_.resource, $_.detail) -ForegroundColor DarkGray }

    Write-Host "`n全部冒烟测试通过 ✔" -ForegroundColor Green
} finally {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Get-Process -Name 'workerd' -ErrorAction SilentlyContinue |
        Where-Object { $preWorkerd -notcontains $_.Id } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}
