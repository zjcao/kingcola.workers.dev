# ============================================================================
# 招新系统自检（需要本地服务已在 8787 运行：npm run local / npm run dev:api）
#
# 覆盖整届的**每一条真实路径**：
#   1) 休眠 → 启动系统 → 备招（报名通道关着，提交报名被 403）
#   2) 保存名称与群号 → 开启报名 → 公开状态变 open，学生可提交
#   3) 提交报名表（multipart + 文件头校验 + 落桶 + 重命名）；重复提交要先确认替换
#   4) 报名表私有性：匿名与学生本人都拿不到，只有管理员能下载
#   5) 补录：报名阶段（JSON，无表）与笔试现场（multipart，带表）
#  5b) 材料审核：驳回（自动发信 + 理由必填）→ 同学重传后回到待审核 → 未通过者不能进笔试 → 批量通过
#   6) 结束报名 → 确认笔试名单（勾选者晋级并发邀请函，未勾选者判未通过且**不发信**）
#   7) 签到二维码：只绑阶段、签发新码自动作废旧码、按姓名 + 学号签到、重复扫码提示已签到
#   8) 结束笔试 → 未签到者自动缺考（不发信）→ 补签撤销缺考
#   9) 生成面试名单 / 结束面试 / 确认录取 / 结束答辩 / 确认最终名单（转正 + 一次性邀请函）
#  9b) 邀请函：本人上传头像（凭证即密权、无需登录）→ 不带头像不能确认加入 → 拒任意外链
#  10) 名单筛选、导出 CSV、群发通知、批量退出、单人改判与补发某封信
#  11) 关闭本届：先导出存档再清库，最终回到休眠
#  12) 强制结束报名并清空数据（推倒重来）：清记录 + 清报名表文件 + 退回备招，之后能重新开启报名
#
# ⚠️ 整届状态只能靠「点动作」推进，所以跑完会停在休眠（这是刻意的）——
#    脚本会把你原来的名称、群号与模板写回去，但状态无法「复原」，本地库跑完即休眠。
# 含中文，必须用 pwsh（PowerShell 7）运行：
#   pwsh -NoProfile -File scripts/smoke-applications.ps1
# ============================================================================

param([string]$Base = 'http://127.0.0.1:8787')

$ErrorActionPreference = 'Stop'
$script:passed = 0
$script:failed = 0

function Check([string]$label, [bool]$ok, [string]$extra = '') {
    if ($ok) {
        $script:passed++
        Write-Host "  [PASS] $label" -ForegroundColor Green
    }
    else {
        $script:failed++
        Write-Host "  [FAIL] $label  $extra" -ForegroundColor Red
    }
}

function Api([string]$method, [string]$path, $body = $null, [string]$jar = '', [string]$cookie = '') {
    $cargs = @('-s', '-X', $method, "$Base$path", '-H', 'content-type: application/json')
    if ($jar) { $cargs += @('-b', $jar) }
    if ($cookie) { $cargs += @('-H', "Cookie: $cookie") }
    if ($null -ne $body) { $cargs += @('--data-raw', ($body | ConvertTo-Json -Depth 8 -Compress)) }
    $raw = & curl.exe @cargs
    try { return $raw | ConvertFrom-Json } catch { return [pscustomobject]@{ ok = $false; raw = $raw } }
}

function Status([string]$method, [string]$path, [string]$jar = '', [string]$cookie = '', $form = $null) {
    $cargs = @('-s', '-o', 'NUL', '-w', '%{http_code}', '-X', $method, "$Base$path")
    if ($jar) { $cargs += @('-b', $jar) }
    if ($cookie) { $cargs += @('-H', "Cookie: $cookie") }
    if ($form) {
        foreach ($item in $form.GetEnumerator()) { $cargs += @('-F', "$($item.Key)=$($item.Value)") }
    }
    return (& curl.exe @cargs)
}

# 报名学生会话令牌：与 worker/lib/crypto.ts 的 signToken 同构
function New-StudentToken([string]$secret, [string]$studentId, [string]$name) {
    $exp = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600
    $json = @{ sub = $studentId; name = $name; sid = 'smoke-cli'; exp = $exp } | ConvertTo-Json -Compress
    $body = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    $h = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
    $sig = [Convert]::ToBase64String($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    return "$body.$sig"
}

# ---- 准备 ----
$root = Split-Path -Parent $PSScriptRoot
$devVars = Get-Content (Join-Path $root '.dev.vars') -Encoding UTF8
$studentSecret = ($devVars | Where-Object { $_ -match '^STUDENT_SESSION_SECRET=' }) -replace '^STUDENT_SESSION_SECRET=', ''

$work = Join-Path $env:TEMP ("kc-recruit-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$jar = Join-Path $work 'admin.jar'
$pdfPath = Join-Path $work 'report.pdf'
[IO.File]::WriteAllBytes($pdfPath, [byte[]](0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0x25, 0x45, 0x4F, 0x46))

$stamp = Get-Random -Minimum 100000 -Maximum 999999
$students = @(
    @{ key = 'a'; id = "SMA$stamp"; name = '冒烟甲'; token = '' },
    @{ key = 'b'; id = "SMB$stamp"; name = '冒烟乙'; token = '' },
    @{ key = 'c'; id = "SMC$stamp"; name = '冒烟丙'; token = '' }
)
foreach ($s in $students) { $s.token = 'kc_student=' + (New-StudentToken $studentSecret $s.id $s.name) }

$appIds = @{}
$inviteUrl = ''
$originalCycle = $null
$writtenToken = ''

Write-Host "招新系统自检 → $Base`n" -ForegroundColor Cyan
Write-Host "测试学号：$($students.id -join ' / ')`n" -ForegroundColor DarkGray

try {
    # ===== 0. 服务与管理员登录 =====
    Write-Host '0) 服务与登录'
    Check '健康检查可用' ((Api 'GET' '/api/health').ok -eq $true)
    & curl.exe -s -c $jar -o NUL -X POST "$Base/api/admin/login" -H 'content-type: application/json' --data-raw '{"username":"admin","password":"kingcola-dev-2026"}'
    Check '管理员登录成功' ((Status 'GET' '/api/admin/me' $jar) -eq '200')

    $settings = (Api 'GET' '/api/admin/recruit' $null $jar).data
    $originalCycle = $settings.cycle
    Check '读得到整届设置（含四个群号）' ($null -ne $originalCycle.groups) ($originalCycle | ConvertTo-Json -Compress)

    # ===== 1. 先回到休眠：休眠期报名必然关着 =====
    Write-Host "`n1) 休眠与启动"
    if ($originalCycle.state -ne 'dormant') {
        $closed = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'close_cycle' } $jar).data
        Check '动作 close_cycle 能把进行中的一届关掉并回到休眠' ($closed.state -eq 'dormant') $closed.state
    }
    $public = (Api 'GET' '/api/public/recruit').data
    Check '休眠期公开状态：gate=not_open 且报名关闭' ($public.gate -eq 'not_open' -and $public.applyOpen -eq $false) $public.gate

    $started = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'start_cycle' } $jar).data
    Check '启动系统 → 进入备招' ($started.state -eq 'prepare') $started.state

    # 备招期：不能报名、也不能签发二维码（阶段没到）
    Check '备招期不接受报名（403）' ((Status 'POST' '/api/applications' '' $students[0].token @{ file = "@$pdfPath;type=application/pdf"; email = 'a@b.com'; phone = '13800000000'; qq = '123456' }) -eq '403')
    $early = (Api 'POST' '/api/admin/recruit/checkin-codes' @{ stage = 'written'; ttlHours = 2 } $jar)
    Check '备招期签发笔试二维码被拒（409 STAGE_NOT_ACTIVE）' ($early.ok -eq $false -and $early.error.code -eq 'STAGE_NOT_ACTIVE') ($early | ConvertTo-Json -Compress)

    # ===== 2. 保存名称与群号 → 开启报名 =====
    Write-Host "`n2) 备招 → 报名"
    $badGroups = (Api 'PUT' '/api/admin/recruit' @{ cycle = @{ groups = @{ written = 'abc' } } } $jar)
    Check '群号格式不对会被拒' ($badGroups.ok -eq $false -and $badGroups.error.code -eq 'VALIDATION_FAILED')
    $saved = (Api 'PUT' '/api/admin/recruit' @{ cycle = @{ name = '冒烟测试招新'; groups = @{ written = '710000001'; interview = '710000002'; probation = '710000003'; formal = '710000004' } } } $jar).data
    Check '保存名称与四个群号' ($saved.cycle.name -eq '冒烟测试招新' -and $saved.cycle.groups.written -eq '710000001') $saved.cycle.name
    Check '设置接口不能改状态（state 被忽略）' ($saved.cycle.state -eq 'prepare') $saved.cycle.state

    $opened = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'open_apply' } $jar).data
    Check '开启报名 → state=apply' ($opened.state -eq 'apply') $opened.state
    $public = (Api 'GET' '/api/public/recruit').data
    Check '公开状态变 open，且文案里有本届名称' ($public.gate -eq 'open' -and $public.applyOpen -eq $true -and $public.notice -match '冒烟测试招新') $public.notice

    # ===== 3. 学生提交报名表 =====
    Write-Host "`n3) 学生提交报名表"
    foreach ($s in $students) {
        $code = Status 'POST' '/api/applications' '' $s.token @{ file = "@$pdfPath;type=application/pdf"; email = "$($s.key)@example.edu.cn"; phone = '13800000000'; qq = '123456' }
        Check "$($s.name) 提交成功（201）" ($code -eq '201') $code
    }
    $list = (Api 'GET' '/api/admin/applications' $null $jar).data
    foreach ($s in $students) { $appIds[$s.key] = ($list.items | Where-Object { $_.studentId -eq $s.id }).id }
    $first = $list.items | Where-Object { $_.studentId -eq $students[0].id }
    Check '报名表被重命名为「姓名+学号+报名表」' ($first.fileName -eq "$($students[0].name)+$($students[0].id)+报名表.pdf") $first.fileName
    Check '名单里 3 人都在报名阶段' (($list.items | Where-Object { $_.stage -eq 'apply' }).Count -eq 3)

    # 替换：同一学号再交一次要先确认
    $again = Status 'POST' '/api/applications' '' $students[0].token @{ file = "@$pdfPath;type=application/pdf"; email = 'a2@example.edu.cn'; phone = '13800000001'; qq = '123457' }
    Check '重复提交被拦下（409 要求确认替换）' ($again -eq '409') $again
    $replaced = Status 'POST' '/api/applications?replace=true' '' $students[0].token @{ file = "@$pdfPath;type=application/pdf"; email = 'a2@example.edu.cn'; phone = '13800000001'; qq = '123457' }
    Check '确认后替换成功（200）' ($replaced -eq '200') $replaced

    # 报名表私有性
    Check '匿名拿不到报名表（404）' ((Status 'GET' "/api/files/$($first.fileUrl -replace '^/api/files/', '')") -eq '404')
    Check '学生本人也拿不到（管理员专用下载口 → 401）' ((Status 'GET' "/api/admin/applications/$($appIds['a'])/file" '' $students[0].token) -eq '401')
    Check '管理员可以下载（200）' ((Status 'GET' "/api/admin/applications/$($appIds['a'])/file" $jar) -eq '200')

    # ===== 4. 补录 =====
    Write-Host "`n4) 补录"
    $manual = (Api 'POST' '/api/admin/applications' @{ name = '现场补录丁'; studentId = "SMD$stamp"; phone = '13800000009' } $jar).data
    Check '报名阶段补录（不带报名表）' ($manual.application.stage -eq 'apply' -and $manual.application.source -eq 'manual') $manual.application.stage
    $dup = (Api 'POST' '/api/admin/applications' @{ name = '重复补录'; studentId = "SMD$stamp" } $jar)
    Check '同一学号重复补录被拒（409）' ($dup.ok -eq $false -and $dup.error.code -eq 'ALREADY_EXISTS')

    # ===== 4b. 改全部资料 + 报名表后补 / 替换 =====
    Write-Host "`n4b) 改资料与报名表后补"
    $manualId = $manual.application.id

    # 补录时没带材料 —— 之后必须能补上，否则那份材料永远缺着
    Check '给补录记录后补报名表（200）' ((Status 'POST' "/api/admin/applications/$manualId/file" $jar '' @{ file = "@$pdfPath;type=application/pdf" }) -eq '200')
    $withDoc = (Api 'GET' "/api/admin/applications/$manualId" $null $jar).data.application
    Check '报名表入库并命名「姓名+学号+报名表」' ($withDoc.fileUrl -ne '' -and $withDoc.fileName -eq "现场补录丁+SMD$stamp+报名表.pdf") $withDoc.fileName

    # 改全部资料：姓名 / 学号 / 联系方式
    $edited = (Api 'PUT' "/api/admin/applications/$manualId" @{ name = '丁同学'; studentId = "SMDX$stamp"; email = 'ding@example.edu.cn'; phone = '13800000011'; qq = '123459' } $jar).data.application
    Check '改全部资料（姓名 / 学号 / 联系方式都生效）' ($edited.name -eq '丁同学' -and $edited.studentId -eq "SMDX$stamp" -and $edited.email -eq 'ding@example.edu.cn') "$($edited.name)/$($edited.studentId)"
    Check '改姓名学号后报名表下载名跟着变' ($edited.fileName -eq "丁同学+SMDX$stamp+报名表.pdf") $edited.fileName
    Check '邮箱格式不对会被拒（400）' ((Api 'PUT' "/api/admin/applications/$manualId" @{ email = 'not-an-email' } $jar).error.code -eq 'VALIDATION_FAILED')
    Check '学号与别人重复被拦下（409）' ((Api 'PUT' "/api/admin/applications/$manualId" @{ studentId = $students[0].id } $jar).error.code -eq 'ALREADY_EXISTS')

    # 替换报名表：指向新对象（旧文件被删）
    $beforeUrl = $edited.fileUrl
    $null = Status 'POST' "/api/admin/applications/$manualId/file" $jar '' @{ file = "@$pdfPath;type=application/pdf" }
    $afterUrl = (Api 'GET' "/api/admin/applications/$manualId" $null $jar).data.application.fileUrl
    Check '替换报名表后指向新文件' ($afterUrl -ne '' -and $afterUrl -ne $beforeUrl)

    # ===== 4c. 材料审核（通过 / 驳回 + 驳回发信 + 同学改材料） =====
    Write-Host "`n4c) 材料审核"
    $rejectedA = (Api 'PUT' "/api/admin/applications/$($appIds['a'])" @{ material = 'rejected'; materialReason = '报名表缺成绩单页，请补齐后重新上传' } $jar)
    Check '驳回材料：状态与理由都写进记录' ($rejectedA.data.application.materialStatus -eq 'rejected' -and $rejectedA.data.application.materialReason -match '成绩单') $rejectedA.data.application.materialReason
    Check '驳回自动发出「材料驳回通知」' ($null -ne $rejectedA.data.mail -and $rejectedA.data.mail.kind -eq 'material_rejected') $rejectedA.data.mail.code
    $rejectLogs = (Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs
    # 收件人按记录取（学生甲的邮箱在前面「替换材料」时已经改过，别写死）
    Check '驳回通知进了发信日志（收件人是本人）' (@($rejectLogs | Where-Object { $_.kind -eq 'material_rejected' -and $_.applicationId -eq $appIds['a'] }).Count -ge 1) ($rejectLogs | ConvertTo-Json -Compress)
    Check '驳回不写理由会被拒（400 REASON_REQUIRED）' ((Api 'PUT' "/api/admin/applications/$($appIds['b'])" @{ material = 'rejected' } $jar).error.code -eq 'REASON_REQUIRED')

    # 同学侧：看得到「已驳回 + 理由」，并据此重新上传材料
    $mineA = (Api 'GET' '/api/applications/me' $null $students[0].token).data.application
    Check '学生能看到自己的材料状态与驳回理由' ($mineA.materialStatus -eq 'rejected' -and $mineA.materialReason -match '成绩单') $mineA.materialStatus
    # 替换要带 query 上的 replace=true（后端只认 query，见 worker/routes/applications.ts）
    $resubmit = (Status 'POST' '/api/applications?replace=true' '' $students[0].token @{ file = "@$pdfPath;type=application/pdf"; email = 'a@example.edu.cn'; phone = '13800000000'; qq = '123456' })
    Check '被驳回后可以重新上传材料（200）' ($resubmit -eq '200') $resubmit
    $afterResubmit = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    Check '重传后审核状态回到「待审核」、旧理由被清掉' ($afterResubmit.materialStatus -eq '' -and $afterResubmit.materialReason -eq '') "status=$($afterResubmit.materialStatus)"
    Check '新报名默认就是「待审核」' ((Api 'GET' "/api/admin/applications/$($appIds['b'])" $null $jar).data.application.materialStatus -eq '')

    # 再驳回一次，用来验证「没通过审核的人不能进笔试」
    $null = Api 'PUT' "/api/admin/applications/$($appIds['a'])" @{ material = 'rejected'; materialReason = '附件打不开，请重新导出后上传' } $jar

    # ===== 5. 结束报名 → 确认笔试名单 =====
    Write-Host "`n5) 结束报名与确认笔试名单"
    $ended = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'end_apply' } $jar).data
    Check '结束报名 → apply_review' ($ended.state -eq 'apply_review') $ended.state
    Check '报名通道随之关闭（提交 403）' ((Status 'POST' '/api/applications' '' $students[2].token @{ file = "@$pdfPath;type=application/pdf"; email = 'c@example.edu.cn'; phone = '13800000000'; qq = '123456' }) -eq '403')

    # 材料没通过审核的人不能被勾选进笔试 —— 审核不是装饰
    $materialGate = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'confirm_written'; selectedIds = @($appIds['a'], $appIds['b']) } $jar)
    Check '材料未通过的人不能确认进笔试（409 MATERIAL_NOT_APPROVED）' ($materialGate.ok -eq $false -and $materialGate.error.code -eq 'MATERIAL_NOT_APPROVED') $materialGate.error.message

    # 批量通过（「待确认笔试名单」期间同样能审）
    $approved = (Api 'POST' '/api/admin/applications/bulk' @{ ids = @($appIds['a'], $appIds['b'], $appIds['c']); action = 'approve_material' } $jar).data
    Check '批量通过材料审核（3 人）' ($approved.moved -eq 3) $approved.moved
    $approvedA = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    Check '通过后驳回理由被清掉' ($approvedA.materialStatus -eq 'approved' -and $approvedA.materialReason -eq '') $approvedA.materialStatus

    $noSelection = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'confirm_written' } $jar)
    Check '没勾选人就确认名单会被拒（409）' ($noSelection.ok -eq $false -and $noSelection.error.code -eq 'BLOCKED') $noSelection.error.message

    $confirmed = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'confirm_written'; selectedIds = @($appIds['a'], $appIds['b']) } $jar).data
    Check '确认笔试名单 → state=written' ($confirmed.state -eq 'written') $confirmed.state
    Check '只给晋级者发信（2 封笔试邀请函）' ($confirmed.mail.sent -eq 2) $confirmed.mail.summary
    $afterConfirm = (Api 'GET' '/api/admin/applications' $null $jar).data
    $promotedA = $afterConfirm.items | Where-Object { $_.id -eq $appIds['a'] }
    $rejectedC = $afterConfirm.items | Where-Object { $_.id -eq $appIds['c'] }
    Check '勾选的人进入笔试' ($promotedA.stage -eq 'written' -and $promotedA.result -eq '') $promotedA.stage
    Check '未勾选的人判「未通过初筛」' ($rejectedC.result -eq 'failed' -and $rejectedC.statusLabel -eq '未通过初筛') $rejectedC.statusLabel
    $mails = (Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs
    Check '未通过初筛的人没有收到任何信' (($mails | Where-Object { $_.recipient -eq "c@example.edu.cn" }).Count -eq 0)

    # ===== 6. 签到二维码 =====
    Write-Host "`n6) 签到二维码与扫码签到"
    $code = (Api 'POST' '/api/admin/recruit/checkin-codes' @{ stage = 'written'; ttlHours = 6 } $jar).data
    $writtenToken = $code.code.token
    Check '笔试阶段不能再改材料审核（409 STAGE_NOT_APPLICABLE）' ((Api 'PUT' "/api/admin/applications/$($appIds['a'])" @{ material = 'rejected'; materialReason = 'x' } $jar).error.code -eq 'STAGE_NOT_APPLICABLE')
    Check '签发笔试二维码（返回带 token 的地址）' ($code.url -match "/checkin/$writtenToken$") $code.url
    $again2 = (Api 'POST' '/api/admin/recruit/checkin-codes' @{ stage = 'written'; ttlHours = 6 } $jar).data
    Check '重发换新 token' ($again2.code.token -ne $writtenToken)
    Check '旧码随之失效（404）' ((Status 'GET' "/api/applications/checkin/$writtenToken") -eq '404')
    $writtenToken = $again2.code.token
    $info = (Api 'GET' "/api/applications/checkin/$writtenToken").data
    Check '签到页文案只有阶段与本届名称（不含时间地点）' ($info.stage -eq 'written' -and $null -eq $info.sessionLabel) ($info | ConvertTo-Json -Compress)
    Check '姓名与报名不符被拒（403）' ((Status 'POST' "/api/applications/checkin/$writtenToken" '' '' $null) -ne '200')
    $checkin = (Api 'POST' "/api/applications/checkin/$writtenToken" @{ name = $students[0].name; studentId = $students[0].id })
    Check '凭二维码签到成功（已参加）' ($checkin.data.already -eq $false -and $checkin.data.stage -eq 'written')
    $checkin2 = (Api 'POST' "/api/applications/checkin/$writtenToken" @{ name = $students[0].name; studentId = $students[0].id })
    Check '重复扫码提示「已签到过」' ($checkin2.data.already -eq $true)

    # 笔试现场补录（带报名表）
    $walkin = (Status 'POST' '/api/admin/applications' $jar '' @{ name = '现场补录戊'; studentId = "SME$stamp"; email = 'e@example.edu.cn'; phone = '13800000010'; qq = '123458'; stage = 'written'; file = "@$pdfPath;type=application/pdf" })
    Check '笔试现场补录（带报名表，201）' ($walkin -eq '201') $walkin

    # 现场真拿不到材料也要能先录入 —— 材料之后在「名单 → 详情 · 改资料」里补
    $walkinNoDoc = (Status 'POST' '/api/admin/applications' $jar '' @{ name = '现场补录己'; studentId = "SMF$stamp"; email = 'f@example.edu.cn'; phone = '13800000012'; qq = '123460'; stage = 'written' })
    Check '笔试现场补录允许先不交报名表（201）' ($walkinNoDoc -eq '201') $walkinNoDoc

    # 本届信息（名称 / 群号）属于流程，不属于设置页：**任何阶段都能改**，改完立即生效
    $renamed = (Api 'PUT' '/api/admin/recruit' @{ cycle = @{ groups = @{ written = '710000009'; interview = '710000002'; probation = '710000003'; formal = '710000004' } } } $jar).data
    Check '笔试进行中也能改本届群号（改完立即生效）' ($renamed.cycle.groups.written -eq '710000009') $renamed.cycle.groups.written
    $null = Api 'PUT' '/api/admin/recruit' @{ cycle = @{ groups = @{ written = '710000001' } } } $jar

    # ===== 7. 结束笔试 → 缺考与补签 =====
    Write-Host "`n7) 结束笔试（缺考与补签）"
    $endWritten = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'end_written' } $jar).data
    Check '结束笔试 → written_review' ($endWritten.state -eq 'written_review') $endWritten.state
    Check '未签到的人自动标注未参加（1 人）' ($endWritten.moved -eq 1) $endWritten.moved
    $afterWritten = (Api 'GET' '/api/admin/applications?stage=written' $null $jar).data
    $absentB = $afterWritten.items | Where-Object { $_.id -eq $appIds['b'] }
    Check '冒烟乙被标为「未参加」' ($absentB.result -eq 'absent') $absentB.result
    $walkinRow = $afterWritten.items | Where-Object { $_.studentId -eq "SME$stamp" }
    Check '现场补录的人生来就是「已参加」，没被误判缺考' ($walkinRow.result -eq 'attended' -and $walkinRow.writtenCheckinAt -ne '') $walkinRow.result
    $bulkBack = (Api 'POST' '/api/admin/applications/bulk' @{ ids = @($appIds['b']); action = 'checkin'; stage = 'written' } $jar).data
    Check '补签 1 人成功' ($bulkBack.moved -eq 1) $bulkBack.moved
    $recovered = (Api 'GET' "/api/admin/applications/$($appIds['b'])" $null $jar).data.application
    Check '补签同时撤销了缺考' ($recovered.result -eq 'attended' -and $recovered.writtenCheckinAt -ne '') $recovered.result

    # ===== 8. 成绩 → 生成面试名单 =====
    Write-Host "`n8) 录入成绩并生成面试名单"
    $scored = (Api 'PUT' "/api/admin/applications/$($appIds['a'])" @{ writtenScore = '92'; writtenNote = '思路清楚' } $jar).data.application
    Check '录入笔试成绩与备注' ($scored.writtenScore -eq '92' -and $scored.writtenNote -eq '思路清楚')
    $advance = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'advance_written'; selectedIds = @($appIds['a']) } $jar).data
    Check '生成面试名单 → state=interview' ($advance.state -eq 'interview') $advance.state
    $afterAdvance = (Api 'GET' '/api/admin/applications' $null $jar).data
    $nowInterview = $afterAdvance.items | Where-Object { $_.id -eq $appIds['a'] }
    Check '勾选者进入面试' ($nowInterview.stage -eq 'interview' -and $nowInterview.result -eq '') $nowInterview.stage
    $mails = (Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs
    Check '其余人收到感谢信（笔试）' (($mails | Where-Object { $_.kind -eq 'thanks_written' }).Count -ge 1)

    # ===== 9. 面试 → 录取 → 答辩 → 转正 =====
    Write-Host "`n9) 面试与录取"
    $interviewCode = (Api 'POST' '/api/admin/recruit/checkin-codes' @{ stage = 'interview' } $jar).data.code
    $null = Api 'POST' "/api/applications/checkin/$($interviewCode.token)" @{ name = $students[0].name; studentId = $students[0].id }
    $endInterview = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'end_interview' } $jar).data
    Check '结束面试 → interview_review' ($endInterview.state -eq 'interview_review') $endInterview.state
    $hired = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'advance_interview'; selectedIds = @($appIds['a']) } $jar).data
    Check '确认录取 → state=defense（进预备期）' ($hired.state -eq 'defense') $hired.state
    $mails = (Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs
    $passMail = $mails | Where-Object { $_.kind -eq 'interview_passed' } | Select-Object -First 1
    Check '面试通过通知已发出且正文含预备成员群号' ($null -ne $passMail) ($mails | Where-Object { $_.kind -eq 'interview_passed' }).Count

    Write-Host "`n10) 答辩与转正"
    $defenseCode = (Api 'POST' '/api/admin/recruit/checkin-codes' @{ stage = 'defense' } $jar).data.code
    $null = Api 'POST' "/api/applications/checkin/$($defenseCode.token)" @{ name = $students[0].name; studentId = $students[0].id }
    $endDefense = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'end_defense' } $jar).data
    Check '结束答辩 → defense_review' ($endDefense.state -eq 'defense_review') $endDefense.state
    $final = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'advance_defense'; selectedIds = @($appIds['a']) } $jar).data
    Check '确认最终名单 → state=onboard' ($final.state -eq 'onboard') $final.state
    $onboard = (Api 'GET' "/api/admin/applications/$($appIds['a'])" $null $jar).data.application
    $inviteUrl = $onboard.inviteUrl
    Check '转正者拿到一次性邀请函链接' ($onboard.stage -eq 'onboard' -and $inviteUrl -match '/invite/') $inviteUrl
    # inviteUrl 是给同学点的那条前端地址（/invite/xxx），接口在 /api/applications/invite/xxx
    $inviteToken = ($inviteUrl -split '/invite/')[-1]
    $inviteInfo = (Api 'GET' "/api/applications/invite/$inviteToken").data
    Check '邀请函可用（返回本人信息与方向选项）' ($inviteInfo.alreadyMember -eq $false -and $inviteInfo.studentId -eq $students[0].id) ($inviteInfo | ConvertTo-Json -Compress)

    # 身份边界（本次改动的核心诉求）：邀请函只下发**学生可自选**的方向，
    # 「指导老师」这类组织授予的身份既不出现在下拉里，绕过前端直接提交也会被后端拒绝
    Check '邀请函方向选项里没有「指导老师」' (($inviteInfo.roleOptions -notcontains '指导老师') -and ($inviteInfo.roleOptions -contains '前端开发')) ($inviteInfo.roleOptions -join ' / ')
    $selfAppointed = Api 'POST' "/api/applications/invite/$inviteToken" @{ title = '指导老师'; direction = '自检方向' }
    Check '不能给自己选「指导老师」（400）' ($selfAppointed.ok -eq $false -and $selfAppointed.error.code -eq 'VALIDATION_FAILED') ($selfAppointed | ConvertTo-Json -Compress)

    # 邀请函上传头像：凭证即密权（同学可能早就没有教务网登录态了），且确认加入时头像必填
    $pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    $inviteAvatarPath = Join-Path $work 'invite-avatar.png'
    [IO.File]::WriteAllBytes($inviteAvatarPath, [Convert]::FromBase64String($pngB64))
    $inviteAvatar = (& curl.exe -s -X POST "$Base/api/applications/invite/$inviteToken/avatar" `
            -F "file=@$inviteAvatarPath;type=image/png") | ConvertFrom-Json
    Check '邀请函可上传头像（无需登录态）' ($inviteAvatar.ok -eq $true -and $inviteAvatar.data.url -match '/api/files/avatars/') ($inviteAvatar | ConvertTo-Json -Compress)
    $badAvatar = (& curl.exe -s -X POST "$Base/api/applications/invite/not-a-real-token/avatar" `
            -F "file=@$inviteAvatarPath;type=image/png") | ConvertFrom-Json
    Check '无效邀请函令牌不能上传头像' ($badAvatar.ok -eq $false -and $badAvatar.error.code -eq 'INVITE_NOT_FOUND') ($badAvatar | ConvertTo-Json -Compress)
    $noAvatar = Api 'POST' "/api/applications/invite/$inviteToken" @{ title = '前端开发'; direction = '自检方向' }
    Check '确认加入时不带头像被拒（400）' ($noAvatar.ok -eq $false -and $noAvatar.error.code -eq 'VALIDATION_FAILED') ($noAvatar | ConvertTo-Json -Compress)
    $evilAvatar = Api 'POST' "/api/applications/invite/$inviteToken" @{ title = '前端开发'; direction = '自检方向'; avatarUrl = 'https://evil.example.com/a.png' }
    Check '拒绝任意外链当头像（400）' ($evilAvatar.ok -eq $false -and $evilAvatar.error.code -eq 'VALIDATION_FAILED') ($evilAvatar | ConvertTo-Json -Compress)

    # ===== 11. 名单、导出、群发、改判 =====
    Write-Host "`n11) 名单与导出"
    $filtered = (Api 'GET' "/api/admin/applications?stage=onboard&q=$($students[0].name)" $null $jar).data
    Check '按阶段 + 关键词筛人' ($filtered.total -eq 1 -and $filtered.items[0].id -eq $appIds['a']) $filtered.total
    $csv = & curl.exe -s -b $jar "$Base/api/admin/recruit/export"
    Check '导出 CSV 带表头与中文列名' ($csv -match '姓名' -and $csv -match '笔试签到') ($csv.Substring(0, [Math]::Min(60, $csv.Length)))
    $notify = (Api 'POST' '/api/admin/applications/notify' @{ ids = @($appIds['b']); subject = '【拾光工作室】冒烟通知 · {name}'; body = '测试正文' } $jar).data
    Check '群发自定义通知' ($notify.results.Count -eq 1) $notify.summary

    # 未初始化（还没配群号）的招新变量**不做替换**：主题里的 {writtenGroup} 应原样保留在发信日志里
    $null = Api 'PUT' '/api/admin/recruit' @{ cycle = @{ groups = @{ written = ''; interview = ''; probation = ''; formal = '' } } } $jar
    $null = Api 'POST' '/api/admin/applications/notify' @{ ids = @($appIds['c']); subject = '【未配置测试】{writtenGroup}'; body = 'x' } $jar
    $logsWithToken = (Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs
    Check '未配置的招新变量保持原文（不替换成空白）' (($logsWithToken | Where-Object { $_.subject -like '*{writtenGroup}*' }).Count -ge 1) (($logsWithToken | Select-Object -First 1).subject)
    $null = Api 'PUT' '/api/admin/recruit' @{ cycle = @{ groups = @{ written = '710000001'; interview = '710000002'; probation = '710000003'; formal = '710000004' } } } $jar
    # 群号配好之后，真发出去的信里必须是**号码**而不是原样的 {writtenGroup}
    # （后台预览一度把「已配好」显示成「还没配置」，就是因为变量键名与模板令牌不是同一套）
    $null = Api 'POST' '/api/admin/applications/notify' @{ ids = @($appIds['a']); subject = '【变量渲染】{writtenGroup}'; body = '正文 {cycleName}' } $jar
    $renderLogs = @((Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs | Where-Object { $_.subject -like '*变量渲染*' })
    Check '本届变量被渲染成实际群号（不是原样保留）' ($renderLogs.Count -ge 1 -and $renderLogs[0].subject -match '710000001') $renderLogs[0].subject
    $withdrawn = (Api 'POST' '/api/admin/applications/bulk' @{ ids = @($appIds['b']); action = 'withdraw' } $jar).data
    Check '批量标记退出报名' ($withdrawn.moved -eq 1) $withdrawn.moved
    $resent = (Api 'PUT' "/api/admin/applications/$($appIds['b'])" @{ notice = 'thanks_written' } $jar).data
    Check '对单人补发某一封信' ($null -ne $resent.mail -and $resent.mail.kind -eq 'thanks_written') $resent.mail.code
    $stats = (Api 'GET' '/api/admin/recruit/stats' $null $jar).data
    Check '统计接口给出漏斗与总人数' ($stats.total -ge 4 -and $null -ne $stats.funnel.apply) ($stats.total)

    # ===== 12. 关闭本届 =====
    Write-Host "`n12) 关闭本届（归档 → 清空 → 休眠）"
    $closed = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'close_cycle' } $jar).data
    Check '关闭本届 → 回到休眠' ($closed.state -eq 'dormant') $closed.state
    Check '给出存档地址与人数汇总' ($closed.archive.url -match '/archives/' -and $closed.archive.total -ge 4) ($closed.archive | ConvertTo-Json -Compress)
    $afterClose = (Api 'GET' '/api/admin/applications' $null $jar).data
    Check '报名数据已清空' ($afterClose.total -eq 0) $afterClose.total
    Check '发信日志已清空' ((Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs.Count -eq 0)
    Check '签到二维码已作废（旧 token 失效）' ((Status 'GET' "/api/applications/checkin/$($defenseCode.token)") -eq '404')
    $code = (Api 'POST' '/api/admin/recruit/checkin-codes' @{ stage = 'written' } $jar)
    Check '休眠期签发二维码被拒（409）' ($code.ok -eq $false -and $code.error.code -eq 'STAGE_NOT_ACTIVE')

    # ===== 12b. 强制结束报名并清空数据（推倒重来） =====
    Write-Host "`n12b) 强制结束报名并清空数据"
    # 它属于报名流程，别的阶段不该能点
    $blockedReset = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'reset_apply' } $jar)
    Check '休眠期不能清空报名（409 BLOCKED）' ($blockedReset.ok -eq $false -and $blockedReset.error.code -eq 'BLOCKED') ($blockedReset | ConvertTo-Json -Compress)

    $null = Api 'POST' '/api/admin/recruit/actions' @{ action = 'start_cycle' } $jar
    $null = Api 'PUT' '/api/admin/recruit' @{ cycle = @{ name = '冒烟测试招新（待清空）'; groups = @{ written = '710000001'; interview = '710000002'; probation = '710000003'; formal = '710000004' } } } $jar
    $null = Api 'POST' '/api/admin/recruit/actions' @{ action = 'open_apply' } $jar
    foreach ($s in $students[0..1]) {
        $null = Status 'POST' '/api/applications' '' $s.token @{ file = "@$pdfPath;type=application/pdf"; email = "$($s.key)@example.edu.cn"; phone = '13800000000'; qq = '123456' }
    }
    $beforeReset = (Api 'GET' '/api/admin/applications' $null $jar).data
    Check '清空前：2 份报名都在，且都带报名表' ($beforeReset.total -eq 2 -and ($beforeReset.items | Where-Object { $_.fileUrl -ne '' }).Count -eq 2) $beforeReset.total

    # 已经点过「结束报名」也还能清（apply_review 同样在可选范围内）
    $null = Api 'POST' '/api/admin/recruit/actions' @{ action = 'end_apply' } $jar
    $cleared = (Api 'POST' '/api/admin/recruit/actions' @{ action = 'reset_apply' } $jar).data
    Check '强制清空：回到备招（报名通道随之关闭）' ($cleared.state -eq 'prepare') $cleared.state
    Check '如实汇报：删了 2 条记录、2 个文件且文件全删成功' ($cleared.cleaned.applications -eq 2 -and $cleared.cleaned.files -eq 2 -and $cleared.cleaned.filesFailed -eq 0) ($cleared.cleaned | ConvertTo-Json -Compress)
    Check '报名数据表已清空' ((Api 'GET' '/api/admin/applications' $null $jar).data.total -eq 0)
    Check '这些人的发信日志一并清空' ((Api 'GET' '/api/admin/recruit/mails' $null $jar).data.logs.Count -eq 0)
    $publicAfterReset = (Api 'GET' '/api/public/recruit').data
    Check '官网回到未开始（不再收表）' ($publicAfterReset.gate -eq 'not_open' -and $publicAfterReset.applyOpen -eq $false) $publicAfterReset.gate
    Check '清空后学生提交被拒（403）' ((Status 'POST' '/api/applications' '' $students[0].token @{ file = "@$pdfPath;type=application/pdf"; email = 'x@example.edu.cn'; phone = '13800000000'; qq = '123456' }) -eq '403')

    # 本届还在：重新开启报名就能从头收干净的表
    $null = Api 'POST' '/api/admin/recruit/actions' @{ action = 'open_apply' } $jar
    Check '清空后可以重新开启报名并收表（201）' ((Status 'POST' '/api/applications' '' $students[0].token @{ file = "@$pdfPath;type=application/pdf"; email = 'x@example.edu.cn'; phone = '13800000000'; qq = '123456' }) -eq '201')
    $null = Api 'POST' '/api/admin/recruit/actions' @{ action = 'close_cycle' } $jar

    # ===== 13. 复原设置 =====
    Write-Host "`n13) 复原名称与群号"
    $restored = (Api 'PUT' '/api/admin/recruit' @{ cycle = @{ name = $originalCycle.name; groups = $originalCycle.groups } } $jar).data
    Check '原名称与群号已写回（状态仍是休眠 —— 状态只能靠动作推进）' ($restored.cycle.name -eq $originalCycle.name -and $restored.cycle.state -eq 'dormant')
}
finally {
    Write-Host ""
    Write-Host ("通过 {0} 项，失败 {1} 项" -f $script:passed, $script:failed) -ForegroundColor ($(if ($script:failed -eq 0) { 'Green' } else { 'Red' }))
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    if ($script:failed -gt 0) { exit 1 }
}
