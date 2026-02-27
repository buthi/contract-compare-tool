import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { extractTextFromPdf } from './lib/pdfExtract'
import { compareDocs } from './lib/docCompare'

const app = new Hono()

app.use('*', cors())

// ─── 健康检查 ───────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true }))

// ─── 上传标准文档（PDF 或纯文本） ────────────────────────────
// POST /api/upload/standard
// body: multipart/form-data  field "file"
// return: { id, name, preview }
const store = new Map<string, string>() // id -> text

app.post('/api/upload/standard', async (c) => {
  try {
    const body = await c.req.parseBody()
    const file = body['file'] as File | undefined
    if (!file) return c.json({ error: '未收到文件' }, 400)

    const text = await fileToText(file)
    const id = 'std_' + Date.now()
    store.set(id, text)

    return c.json({ id, name: file.name, preview: text.slice(0, 300) })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── 上传对比文档并立即比较 ──────────────────────────────────
// POST /api/compare
// body: multipart/form-data  fields: "standardId", "file"
// return: CompareResult
app.post('/api/compare', async (c) => {
  try {
    const body = await c.req.parseBody()
    const standardId = body['standardId'] as string | undefined
    const file = body['file'] as File | undefined

    if (!standardId) return c.json({ error: '缺少 standardId' }, 400)
    if (!file) return c.json({ error: '未收到对比文件' }, 400)

    const standardText = store.get(standardId)
    if (!standardText) return c.json({ error: '标准文档不存在，请重新上传' }, 404)

    const newText = await fileToText(file)
    const result = compareDocs(standardText, newText)

    return c.json({ name: file.name, ...result })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── 工具：File → 纯文本 ────────────────────────────────────
async function fileToText(file: File): Promise<string> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.pdf')) {
    const buf = await file.arrayBuffer()
    return extractTextFromPdf(buf)
  }
  // txt / 其他纯文本
  return file.text()
}

// ─── 前端页面（单页应用，内联在 Hono 中） ───────────────────
app.get('/', (c) => {
  return c.html(HTML)
})

// ─── HTML 页面（完整单页） ───────────────────────────────────
const HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>合同文档比对工具</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
<style>
  /* diff highlight */
  .diff-del{background:#fee2e2;color:#991b1b;text-decoration:line-through;border-radius:2px;padding:0 2px;}
  .diff-ins{background:#dcfce7;color:#166534;border-radius:2px;padding:0 2px;}
  .diff-eq{color:#374151;}
  /* 自定义滚动条 */
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:#f1f5f9}
  ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
  /* 上传区域拖拽高亮 */
  .drop-active{border-color:#6366f1!important;background:#eef2ff!important;}
  /* 卡片动画 */
  .section-card{animation:fadeIn .3s ease}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  /* 标签 */
  .badge-both{background:#fef3c7;color:#92400e;}
  .badge-onlyA{background:#fee2e2;color:#991b1b;}
  .badge-onlyB{background:#dcfce7;color:#166534;}
  /* 进度条 */
  .sim-bar{height:4px;border-radius:2px;background:#e5e7eb;overflow:hidden;}
  .sim-fill{height:100%;border-radius:2px;transition:width .4s;}
  /* 折叠内容 */
  .collapse-content{display:none;}
  .collapse-content.open{display:block;}
</style>
</head>
<body class="bg-gray-50 min-h-screen">

<!-- 顶部导航 -->
<nav class="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 shadow-sm sticky top-0 z-50">
  <i class="fas fa-file-contract text-indigo-600 text-xl"></i>
  <span class="font-bold text-gray-800 text-lg">合同文档比对工具</span>
  <span class="ml-auto text-xs text-gray-400">逐条款差异分析 · 高亮显示变更</span>
</nav>

<div class="max-w-6xl mx-auto px-4 py-8 space-y-8">

  <!-- 第一步：上传标准文档 -->
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
    <div class="flex items-center gap-2 mb-4">
      <span class="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm flex items-center justify-center font-bold">1</span>
      <h2 class="font-semibold text-gray-700 text-base">上传标准文档</h2>
      <span id="stdBadge" class="hidden ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium"></span>
    </div>
    <div id="dropA" class="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all"
         onclick="document.getElementById('fileA').click()"
         ondragover="dragOver(event,'dropA')" ondragleave="dragLeave('dropA')" ondrop="dropFile(event,'fileA','dropA')">
      <i class="fas fa-cloud-upload-alt text-3xl text-gray-300 mb-2"></i>
      <p class="text-gray-500 text-sm">点击或拖拽上传 <strong>PDF / TXT</strong> 文件</p>
      <p class="text-gray-400 text-xs mt-1">作为本次比对的基准文档</p>
    </div>
    <input type="file" id="fileA" class="hidden" accept=".pdf,.txt" onchange="uploadStandard(this)"/>
    <div id="stdInfo" class="hidden mt-3 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-700 flex items-center gap-2">
      <i class="fas fa-check-circle"></i>
      <span id="stdInfoText"></span>
    </div>
  </div>

  <!-- 第二步：上传对比文档 -->
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
    <div class="flex items-center gap-2 mb-4">
      <span class="w-7 h-7 rounded-full bg-purple-600 text-white text-sm flex items-center justify-center font-bold">2</span>
      <h2 class="font-semibold text-gray-700 text-base">上传对比文档</h2>
      <span class="text-xs text-gray-400 ml-1">（可多次上传，每次覆盖上一次结果）</span>
    </div>
    <div id="dropB" class="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-all"
         onclick="triggerCompare()"
         ondragover="dragOver(event,'dropB')" ondragleave="dragLeave('dropB')" ondrop="dropFile(event,'fileB','dropB')">
      <i class="fas fa-file-search text-3xl text-gray-300 mb-2"></i>
      <p class="text-gray-500 text-sm">点击或拖拽上传待比对的 <strong>PDF / TXT</strong> 文件</p>
      <p class="text-gray-400 text-xs mt-1">将与标准文档逐条款比对</p>
    </div>
    <input type="file" id="fileB" class="hidden" accept=".pdf,.txt" onchange="doCompare(this)"/>
  </div>

  <!-- 加载中 -->
  <div id="loading" class="hidden text-center py-12">
    <div class="inline-flex flex-col items-center gap-3">
      <svg class="animate-spin h-10 w-10 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      <p class="text-gray-500 text-sm">正在分析文档差异，请稍候…</p>
    </div>
  </div>

  <!-- 比对结果 -->
  <div id="result" class="hidden space-y-4">

    <!-- 汇总统计 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div class="flex flex-wrap gap-6 items-center">
        <div>
          <p class="text-xs text-gray-400 mb-0.5">对比文档</p>
          <p id="rFileName" class="font-semibold text-gray-700 text-sm"></p>
        </div>
        <div class="h-8 w-px bg-gray-200"></div>
        <div class="text-center">
          <p class="text-2xl font-bold text-gray-800" id="rTotal">0</p>
          <p class="text-xs text-gray-400">全部条款</p>
        </div>
        <div class="text-center">
          <p class="text-2xl font-bold text-amber-500" id="rChanged">0</p>
          <p class="text-xs text-gray-400">差异条款</p>
        </div>
        <div class="text-center">
          <p class="text-2xl font-bold text-red-500" id="rOnlyA">0</p>
          <p class="text-xs text-gray-400">仅标准有</p>
        </div>
        <div class="text-center">
          <p class="text-2xl font-bold text-green-600" id="rOnlyB">0</p>
          <p class="text-xs text-gray-400">仅新文档有</p>
        </div>
        <!-- 搜索 -->
        <div class="ml-auto flex items-center gap-2">
          <input id="searchInput" type="text" placeholder="搜索条款…" class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400" oninput="filterCards()"/>
          <button onclick="expandAll()" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600">全部展开</button>
          <button onclick="collapseAll()" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600">全部折叠</button>
        </div>
      </div>
    </div>

    <!-- 差异卡片列表 -->
    <div id="sectionList" class="space-y-3"></div>

    <!-- 无差异提示 -->
    <div id="noDiff" class="hidden text-center py-16">
      <i class="fas fa-check-circle text-4xl text-green-400 mb-3"></i>
      <p class="text-gray-500">两份文档内容高度一致，未发现明显差异</p>
    </div>
  </div>

</div><!-- /max-w -->

<script>
// ───── 全局状态 ─────
let standardId = null

// ───── 拖拽支持 ─────
function dragOver(e, id){e.preventDefault();document.getElementById(id).classList.add('drop-active')}
function dragLeave(id){document.getElementById(id).classList.remove('drop-active')}
function dropFile(e, inputId, dropId){
  e.preventDefault()
  dragLeave(dropId)
  const file = e.dataTransfer.files[0]
  if(!file) return
  const input = document.getElementById(inputId)
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change'))
}

// ───── 上传标准文档 ─────
async function uploadStandard(input){
  const file = input.files[0]
  if(!file) return
  const fd = new FormData()
  fd.append('file', file)
  
  // 显示上传中
  const drop = document.getElementById('dropA')
  drop.innerHTML = '<i class="fas fa-spinner fa-spin text-2xl text-indigo-400 mb-2"></i><p class="text-gray-400 text-sm">正在解析文档…</p>'
  
  try{
    const res = await fetch('/api/upload/standard', {method:'POST', body:fd})
    const data = await res.json()
    if(data.error) throw new Error(data.error)
    
    standardId = data.id
    
    // 更新 UI
    document.getElementById('stdBadge').textContent = '✓ 已加载'
    document.getElementById('stdBadge').classList.remove('hidden')
    document.getElementById('stdInfo').classList.remove('hidden')
    document.getElementById('stdInfoText').textContent = '标准文档：' + data.name
    drop.innerHTML = \`
      <i class="fas fa-file-alt text-3xl text-indigo-400 mb-2"></i>
      <p class="text-indigo-600 font-medium text-sm">\${data.name}</p>
      <p class="text-gray-400 text-xs mt-1">点击可重新上传</p>
    \`
  }catch(e){
    alert('上传失败：' + e.message)
    drop.innerHTML = '<i class="fas fa-cloud-upload-alt text-3xl text-gray-300 mb-2"></i><p class="text-gray-500 text-sm">点击或拖拽上传 PDF / TXT 文件</p>'
  }
}

// ───── 触发对比文档选择 ─────
function triggerCompare(){
  if(!standardId){ alert('请先上传标准文档！'); return }
  document.getElementById('fileB').click()
}

// ───── 上传对比文档并执行比对 ─────
async function doCompare(input){
  const file = input.files[0]
  if(!file) return
  if(!standardId){ alert('请先上传标准文档！'); return }
  
  // 显示加载
  document.getElementById('result').classList.add('hidden')
  document.getElementById('loading').classList.remove('hidden')
  
  const fd = new FormData()
  fd.append('standardId', standardId)
  fd.append('file', file)
  
  try{
    const res = await fetch('/api/compare', {method:'POST', body:fd})
    const data = await res.json()
    if(data.error) throw new Error(data.error)
    renderResult(data)
  }catch(e){
    alert('比对失败：' + e.message)
  }finally{
    document.getElementById('loading').classList.add('hidden')
    // 重置 input 以允许重复选择同一文件
    input.value = ''
  }
}

// ───── 渲染比对结果 ─────
function renderResult(data){
  const {name, totalSections, changedSections, sections} = data
  
  document.getElementById('rFileName').textContent = name
  document.getElementById('rTotal').textContent = totalSections
  document.getElementById('rChanged').textContent = changedSections
  
  let onlyA=0, onlyB=0
  sections.forEach(s=>{ if(s.status==='only_in_A') onlyA++; if(s.status==='only_in_B') onlyB++ })
  document.getElementById('rOnlyA').textContent = onlyA
  document.getElementById('rOnlyB').textContent = onlyB
  
  const list = document.getElementById('sectionList')
  list.innerHTML = ''
  
  if(sections.length === 0){
    document.getElementById('noDiff').classList.remove('hidden')
  } else {
    document.getElementById('noDiff').classList.add('hidden')
    sections.forEach((s, idx) => list.appendChild(buildCard(s, idx)))
  }
  
  document.getElementById('result').classList.remove('hidden')
  document.getElementById('result').scrollIntoView({behavior:'smooth', block:'start'})
}

// ───── 构建单个差异卡片 ─────
function buildCard(s, idx){
  const card = document.createElement('div')
  card.className = 'section-card bg-white rounded-2xl shadow-sm border overflow-hidden'
  card.dataset.key = ((s.keyA||'')+(s.keyB||'')).toLowerCase()
  
  // 确定颜色方案
  let borderColor, badgeClass, badgeText, statusIcon
  if(s.status === 'only_in_A'){
    borderColor = 'border-red-200'
    badgeClass = 'badge-onlyA'
    badgeText = '仅标准文档存在'
    statusIcon = '<i class="fas fa-minus-circle text-red-400"></i>'
  } else if(s.status === 'only_in_B'){
    borderColor = 'border-green-200'
    badgeClass = 'badge-onlyB'
    badgeText = '仅新文档存在'
    statusIcon = '<i class="fas fa-plus-circle text-green-500"></i>'
  } else {
    const sim = s.similarity
    if(sim < 0.5) borderColor = 'border-red-200'
    else if(sim < 0.8) borderColor = 'border-amber-200'
    else borderColor = 'border-yellow-100'
    badgeClass = 'badge-both'
    badgeText = '内容有变更'
    statusIcon = '<i class="fas fa-exclamation-circle text-amber-400"></i>'
  }
  card.classList.add(borderColor)
  
  const simPct = Math.round(s.similarity * 100)
  const simColor = simPct >= 80 ? '#22c55e' : simPct >= 50 ? '#f59e0b' : '#ef4444'
  const keyLabel = s.keyA || s.keyB || '未知条款'
  const keyLabelB = (s.keyB && s.keyB !== s.keyA) ? \` / \${s.keyB}\` : ''
  
  // 头部
  const header = document.createElement('div')
  header.className = 'flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50 select-none'
  header.innerHTML = \`
    \${statusIcon}
    <span class="font-semibold text-gray-700 text-sm">\${escHtml(keyLabel)}\${keyLabelB ? '<span class="text-gray-400 font-normal">'+escHtml(keyLabelB)+'</span>' : ''}</span>
    <span class="text-xs px-2 py-0.5 rounded-full font-medium \${badgeClass}">\${badgeText}</span>
    \${s.status==='both' ? \`
      <div class="ml-2 flex items-center gap-1.5 text-xs text-gray-400">
        <div class="sim-bar w-16"><div class="sim-fill" style="width:\${simPct}%;background:\${simColor}"></div></div>
        <span>\${simPct}% 相似</span>
      </div>
    \` : ''}
    <span class="ml-auto text-gray-300 toggle-icon"><i class="fas fa-chevron-down"></i></span>
  \`
  
  // 内容
  const content = document.createElement('div')
  content.className = 'collapse-content border-t border-gray-100 px-5 py-4'
  content.id = 'card-content-' + idx
  
  if(s.status === 'both'){
    content.innerHTML = buildDiffView(s.diffs, s.contentA, s.contentB)
  } else if(s.status === 'only_in_A'){
    content.innerHTML = \`
      <div class="bg-red-50 rounded-lg p-4">
        <p class="text-xs text-red-500 font-medium mb-2 flex items-center gap-1"><i class="fas fa-times-circle"></i> 该条款仅存在于标准文档中</p>
        <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">\${escHtml(s.contentA)}</pre>
      </div>
    \`
  } else {
    content.innerHTML = \`
      <div class="bg-green-50 rounded-lg p-4">
        <p class="text-xs text-green-600 font-medium mb-2 flex items-center gap-1"><i class="fas fa-plus-circle"></i> 该条款仅存在于新文档中</p>
        <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">\${escHtml(s.contentB)}</pre>
      </div>
    \`
  }
  
  // 默认展开前5个，其余折叠
  if(idx < 5) content.classList.add('open')
  
  header.addEventListener('click', () => {
    content.classList.toggle('open')
    const icon = header.querySelector('.toggle-icon i')
    icon.className = content.classList.contains('open') ? 'fas fa-chevron-up' : 'fas fa-chevron-down'
  })
  
  card.appendChild(header)
  card.appendChild(content)
  return card
}

// ───── 生成 diff 视图（字符级高亮） ─────
function buildDiffView(diffs, contentA, contentB){
  if(!diffs || diffs.length === 0){
    return \`<div class="grid grid-cols-2 gap-4">
      <div class="bg-gray-50 rounded-lg p-4">
        <p class="text-xs text-gray-400 mb-2 font-medium">标准文档</p>
        <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans">\${escHtml(contentA.slice(0,3000))}</pre>
      </div>
      <div class="bg-gray-50 rounded-lg p-4">
        <p class="text-xs text-gray-400 mb-2 font-medium">新文档</p>
        <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans">\${escHtml(contentB.slice(0,3000))}</pre>
      </div>
    </div>\`
  }
  
  // 分别构建 A 视图（删除高亮）和 B 视图（插入高亮）
  let viewA = '', viewB = ''
  for(const d of diffs){
    if(d.op === 0){
      viewA += escHtml(d.text)
      viewB += escHtml(d.text)
    } else if(d.op === -1){
      viewA += \`<mark class="diff-del">\${escHtml(d.text)}</mark>\`
    } else {
      viewB += \`<mark class="diff-ins">\${escHtml(d.text)}</mark>\`
    }
  }
  
  return \`
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-4">
      <div class="bg-red-50 rounded-lg p-4">
        <p class="text-xs text-red-500 font-medium mb-2 flex items-center gap-1">
          <i class="fas fa-file-alt"></i> 标准文档
          <span class="ml-auto text-gray-400 font-normal">删除内容 <span class="diff-del px-1">红色划线</span></span>
        </p>
        <div class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">\${viewA}</div>
      </div>
      <div class="bg-green-50 rounded-lg p-4">
        <p class="text-xs text-green-600 font-medium mb-2 flex items-center gap-1">
          <i class="fas fa-file-alt"></i> 新文档
          <span class="ml-auto text-gray-400 font-normal">新增内容 <span class="diff-ins px-1">绿色标注</span></span>
        </p>
        <div class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">\${viewB}</div>
      </div>
    </div>
  </div>
  \`
}

// ───── 工具函数 ─────
function escHtml(s){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
}

function filterCards(){
  const q = document.getElementById('searchInput').value.toLowerCase()
  document.querySelectorAll('.section-card').forEach(c=>{
    c.style.display = c.dataset.key.includes(q) ? '' : 'none'
  })
}

function expandAll(){
  document.querySelectorAll('.collapse-content').forEach(el=>el.classList.add('open'))
  document.querySelectorAll('.toggle-icon i').forEach(i=>i.className='fas fa-chevron-up')
}
function collapseAll(){
  document.querySelectorAll('.collapse-content').forEach(el=>el.classList.remove('open'))
  document.querySelectorAll('.toggle-icon i').forEach(i=>i.className='fas fa-chevron-down')
}
</script>
</body>
</html>`

export default app
