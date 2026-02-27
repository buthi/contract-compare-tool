import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { compareDocs } from './lib/docCompare'

const app = new Hono()

app.use('*', cors())

// ─── 健康检查 ───────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true }))

// ─── 内存存储（标准文档文本） ──────────────────────────────
// key: id → value: text
const store = new Map<string, string>()

// ─── 上传标准文档（前端已提取纯文本，这里只保存） ────────
// POST /api/upload/standard
// body: JSON { text: string, name: string }
// return: { id, name, preview }
app.post('/api/upload/standard', async (c) => {
  try {
    const { text, name } = await c.req.json<{ text: string; name: string }>()
    if (!text) return c.json({ error: '文档内容为空' }, 400)

    const id = 'std_' + Date.now()
    store.set(id, text)

    return c.json({ id, name, preview: text.slice(0, 300) })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── 对比文档（前端已提取纯文本，服务端做差异分析） ───────
// POST /api/compare
// body: JSON { standardId: string, text: string, name: string }
// return: CompareResult
app.post('/api/compare', async (c) => {
  try {
    const { standardId, text, name } =
      await c.req.json<{ standardId: string; text: string; name: string }>()

    if (!standardId) return c.json({ error: '缺少 standardId' }, 400)
    if (!text) return c.json({ error: '文档内容为空' }, 400)

    const standardText = store.get(standardId)
    if (!standardText) return c.json({ error: '标准文档不存在，请重新上传' }, 404)

    const result = compareDocs(standardText, text)
    return c.json({ name, ...result })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── 前端页面 ─────────────────────────────────────────────
app.get('/', (c) => c.html(HTML))

// ─── HTML 完整单页 ────────────────────────────────────────
const HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>合同文档比对工具</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
<!-- pdfjs-dist：在浏览器端解析 PDF，支持 CID/GBK/UTF-16BE 中文字体 -->
<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs" type="module"></script>
<style>
  .diff-del{background:#fee2e2;color:#991b1b;text-decoration:line-through;border-radius:2px;padding:0 2px;}
  .diff-ins{background:#dcfce7;color:#166534;border-radius:2px;padding:0 2px;}
  .diff-eq{color:#374151;}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:#f1f5f9}
  ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
  .drop-active{border-color:#6366f1!important;background:#eef2ff!important;}
  .section-card{animation:fadeIn .3s ease}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .badge-both{background:#fef3c7;color:#92400e;}
  .badge-onlyA{background:#fee2e2;color:#991b1b;}
  .badge-onlyB{background:#dcfce7;color:#166534;}
  .sim-bar{height:4px;border-radius:2px;background:#e5e7eb;overflow:hidden;}
  .sim-fill{height:100%;border-radius:2px;transition:width .4s;}
  .collapse-content{display:none;}
  .collapse-content.open{display:block;}
  .progress-ring{transition:stroke-dashoffset .4s ease}
</style>
</head>
<body class="bg-gray-50 min-h-screen">

<!-- 顶部导航 -->
<nav class="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 shadow-sm sticky top-0 z-50">
  <i class="fas fa-file-contract text-indigo-600 text-xl"></i>
  <span class="font-bold text-gray-800 text-lg">合同文档比对工具</span>
  <span class="ml-auto text-xs text-gray-400">支持 PDF / TXT · 逐条款差异分析 · 高亮变更</span>
</nav>

<div class="max-w-6xl mx-auto px-4 py-8 space-y-6">

  <!-- 两栏上传区 -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">

    <!-- 标准文档 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div class="flex items-center gap-2 mb-4">
        <span class="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm flex items-center justify-center font-bold">1</span>
        <h2 class="font-semibold text-gray-700">上传标准文档</h2>
        <span id="stdBadge" class="hidden ml-auto text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">✓ 已加载</span>
      </div>
      <div id="dropA" class="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all"
           onclick="document.getElementById('fileA').click()"
           ondragover="dragOver(event,'dropA')" ondragleave="dragLeave('dropA')" ondrop="dropFile(event,'fileA','dropA')">
        <i class="fas fa-cloud-upload-alt text-3xl text-gray-300 mb-2"></i>
        <p class="text-gray-500 text-sm">点击或拖拽上传 <strong>PDF / TXT</strong></p>
        <p class="text-gray-400 text-xs mt-1">作为所有对比的基准文档</p>
      </div>
      <input type="file" id="fileA" class="hidden" accept=".pdf,.txt,.text" onchange="uploadStandard(this)"/>
      <!-- 解析进度 -->
      <div id="stdProgress" class="hidden mt-3 space-y-1">
        <div class="flex justify-between text-xs text-gray-500">
          <span id="stdProgressLabel">正在解析…</span>
          <span id="stdProgressPct">0%</span>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-1.5">
          <div id="stdProgressBar" class="bg-indigo-500 h-1.5 rounded-full transition-all" style="width:0%"></div>
        </div>
      </div>
      <div id="stdInfo" class="hidden mt-3 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-700 flex items-start gap-2">
        <i class="fas fa-check-circle mt-0.5 flex-shrink-0"></i>
        <div>
          <p id="stdInfoName" class="font-medium"></p>
          <p id="stdInfoChars" class="text-xs text-indigo-500 mt-0.5"></p>
        </div>
      </div>
    </div>

    <!-- 对比文档 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div class="flex items-center gap-2 mb-4">
        <span class="w-7 h-7 rounded-full bg-purple-600 text-white text-sm flex items-center justify-center font-bold">2</span>
        <h2 class="font-semibold text-gray-700">上传对比文档</h2>
        <span class="text-xs text-gray-400 ml-auto">可多次上传</span>
      </div>
      <div id="dropB" class="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-all"
           onclick="triggerCompare()"
           ondragover="dragOver(event,'dropB')" ondragleave="dragLeave('dropB')" ondrop="dropFile(event,'fileB','dropB')">
        <i class="fas fa-file-search text-3xl text-gray-300 mb-2"></i>
        <p class="text-gray-500 text-sm">点击或拖拽上传待比对的 <strong>PDF / TXT</strong></p>
        <p class="text-gray-400 text-xs mt-1">与标准文档逐条款对比差异</p>
      </div>
      <input type="file" id="fileB" class="hidden" accept=".pdf,.txt,.text" onchange="doCompare(this)"/>
      <!-- 解析进度 -->
      <div id="cmpProgress" class="hidden mt-3 space-y-1">
        <div class="flex justify-between text-xs text-gray-500">
          <span id="cmpProgressLabel">正在解析…</span>
          <span id="cmpProgressPct">0%</span>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-1.5">
          <div id="cmpProgressBar" class="bg-purple-500 h-1.5 rounded-full transition-all" style="width:0%"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- 加载比对中 -->
  <div id="loading" class="hidden text-center py-10">
    <div class="inline-flex flex-col items-center gap-3">
      <svg class="animate-spin h-10 w-10 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      <p class="text-gray-500 text-sm">正在分析条款差异，请稍候…</p>
    </div>
  </div>

  <!-- 结果区 -->
  <div id="result" class="hidden space-y-4">

    <!-- 汇总栏 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div class="flex flex-wrap gap-5 items-center">
        <div>
          <p class="text-xs text-gray-400 mb-0.5">对比文档</p>
          <p id="rFileName" class="font-semibold text-gray-700 text-sm max-w-xs truncate"></p>
        </div>
        <div class="h-8 w-px bg-gray-200 hidden sm:block"></div>
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
        <div class="ml-auto flex items-center gap-2 flex-wrap">
          <input id="searchInput" type="text" placeholder="搜索条款…"
            class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-32"
            oninput="filterCards()"/>
          <button onclick="expandAll()" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600">全部展开</button>
          <button onclick="collapseAll()" class="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600">全部折叠</button>
        </div>
      </div>
    </div>

    <!-- 差异卡片 -->
    <div id="sectionList" class="space-y-3"></div>

    <div id="noDiff" class="hidden text-center py-16">
      <i class="fas fa-check-circle text-4xl text-green-400 mb-3 block"></i>
      <p class="text-gray-500">两份文档内容高度一致，未发现明显差异</p>
    </div>
  </div>

</div>

<script type="module">
// ─────────── pdfjs 初始化 ─────────────────────────────────────
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs'
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'

// 暴露到全局供非 module script 调用
window._pdfjsLib = pdfjsLib

// ─────────── PDF 文本提取（浏览器端，支持 CID/中文字体） ──────
window.extractPdfText = async function(buffer, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
  const total = pdf.numPages
  const pages = []
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // 合并同一页的文字，保持行顺序
    let pageText = ''
    let lastY = null
    for (const item of content.items) {
      if ('str' in item) {
        // 换行检测：Y 坐标变化超过字体大小
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
          pageText += '\\n'
        }
        pageText += item.str
        lastY = item.transform[5]
      }
    }
    pages.push(pageText)
    if (onProgress) onProgress(Math.round(i / total * 100))
  }
  return pages.join('\\n')
}

// ─────────── 文件 → 纯文本 ───────────────────────────────────
window.fileToText = async function(file, progressEls) {
  const { bar, pct, label, wrap } = progressEls || {}

  const lower = file.name.toLowerCase()
  if (lower.endsWith('.pdf')) {
    if (wrap) wrap.classList.remove('hidden')
    if (label) label.textContent = '正在解析 PDF…'

    const buffer = await file.arrayBuffer()
    const text = await window.extractPdfText(buffer, (p) => {
      if (bar) bar.style.width = p + '%'
      if (pct) pct.textContent = p + '%'
    })

    if (wrap) wrap.classList.add('hidden')
    return text
  } else {
    // txt
    return file.text()
  }
}
</script>

<script>
// ─────────── 全局状态 ─────────────────────────────────────────
let standardId = null

// ─────────── 拖拽 ─────────────────────────────────────────────
function dragOver(e, id){ e.preventDefault(); document.getElementById(id).classList.add('drop-active') }
function dragLeave(id){ document.getElementById(id).classList.remove('drop-active') }
function dropFile(e, inputId, dropId){
  e.preventDefault(); dragLeave(dropId)
  const file = e.dataTransfer.files[0]; if(!file) return
  const input = document.getElementById(inputId)
  const dt = new DataTransfer(); dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change'))
}

// ─────────── 上传标准文档 ────────────────────────────────────
async function uploadStandard(input){
  const file = input.files[0]; if(!file) return
  const drop = document.getElementById('dropA')
  drop.innerHTML = '<i class="fas fa-spinner fa-spin text-2xl text-indigo-400 mb-2"></i><p class="text-gray-400 text-sm">正在解析文档…</p>'

  const progressEls = {
    bar: document.getElementById('stdProgressBar'),
    pct: document.getElementById('stdProgressPct'),
    label: document.getElementById('stdProgressLabel'),
    wrap: document.getElementById('stdProgress'),
  }

  try {
    // 等待 pdfjs 加载完成
    await waitForPdfjs()
    const text = await window.fileToText(file, progressEls)

    if(!text || text.trim().length < 10) throw new Error('文档内容为空或无法解析')

    const res = await fetch('/api/upload/standard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, name: file.name })
    })
    const data = await res.json()
    if(data.error) throw new Error(data.error)

    standardId = data.id
    document.getElementById('stdBadge').classList.remove('hidden')
    document.getElementById('stdInfo').classList.remove('hidden')
    document.getElementById('stdInfoName').textContent = file.name
    document.getElementById('stdInfoChars').textContent = '已提取 ' + text.length.toLocaleString() + ' 个字符'
    drop.innerHTML = \`
      <i class="fas fa-file-alt text-3xl text-indigo-400 mb-2"></i>
      <p class="text-indigo-600 font-medium text-sm">\${escHtml(file.name)}</p>
      <p class="text-gray-400 text-xs mt-1">点击可重新上传</p>
    \`
  } catch(e) {
    alert('上传失败：' + e.message)
    drop.innerHTML = '<i class="fas fa-cloud-upload-alt text-3xl text-gray-300 mb-2"></i><p class="text-gray-500 text-sm">点击或拖拽上传 PDF / TXT 文件</p>'
    document.getElementById('stdProgress').classList.add('hidden')
  }
}

// ─────────── 触发对比文件选择 ────────────────────────────────
function triggerCompare(){
  if(!standardId){ alert('请先上传标准文档！'); return }
  document.getElementById('fileB').click()
}

// ─────────── 对比并显示结果 ──────────────────────────────────
async function doCompare(input){
  const file = input.files[0]; if(!file) return
  if(!standardId){ alert('请先上传标准文档！'); return }

  document.getElementById('result').classList.add('hidden')
  document.getElementById('loading').classList.remove('hidden')

  const progressEls = {
    bar: document.getElementById('cmpProgressBar'),
    pct: document.getElementById('cmpProgressPct'),
    label: document.getElementById('cmpProgressLabel'),
    wrap: document.getElementById('cmpProgress'),
  }

  try {
    await waitForPdfjs()
    const text = await window.fileToText(file, progressEls)
    if(!text || text.trim().length < 10) throw new Error('文档内容为空或无法解析')

    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standardId, text, name: file.name })
    })
    const data = await res.json()
    if(data.error) throw new Error(data.error)

    renderResult(data)
  } catch(e) {
    alert('比对失败：' + e.message)
  } finally {
    document.getElementById('loading').classList.add('hidden')
    document.getElementById('cmpProgress').classList.add('hidden')
    input.value = ''
  }
}

// ─────────── 等待 pdfjs 初始化 ───────────────────────────────
function waitForPdfjs(){ 
  return new Promise(resolve => {
    const check = () => window._pdfjsLib ? resolve() : setTimeout(check, 100)
    check()
  })
}

// ─────────── 渲染结果 ────────────────────────────────────────
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

  if(!sections.length){
    document.getElementById('noDiff').classList.remove('hidden')
  } else {
    document.getElementById('noDiff').classList.add('hidden')
    sections.forEach((s,idx) => list.appendChild(buildCard(s,idx)))
  }

  document.getElementById('result').classList.remove('hidden')
  document.getElementById('result').scrollIntoView({behavior:'smooth',block:'start'})
}

// ─────────── 构建差异卡片 ────────────────────────────────────
function buildCard(s, idx){
  const card = document.createElement('div')
  card.className = 'section-card bg-white rounded-2xl shadow-sm border overflow-hidden'
  card.dataset.key = ((s.keyA||'')+(s.keyB||'')).toLowerCase()

  let borderColor, badgeClass, badgeText, statusIcon
  if(s.status==='only_in_A'){
    borderColor='border-red-200'; badgeClass='badge-onlyA'; badgeText='仅标准文档存在'
    statusIcon='<i class="fas fa-minus-circle text-red-400"></i>'
  } else if(s.status==='only_in_B'){
    borderColor='border-green-200'; badgeClass='badge-onlyB'; badgeText='仅新文档存在'
    statusIcon='<i class="fas fa-plus-circle text-green-500"></i>'
  } else {
    const sim=s.similarity
    borderColor = sim<0.5?'border-red-200':sim<0.8?'border-amber-200':'border-yellow-100'
    badgeClass='badge-both'; badgeText='内容有变更'
    statusIcon='<i class="fas fa-exclamation-circle text-amber-400"></i>'
  }
  card.classList.add(borderColor)

  const simPct = Math.round(s.similarity*100)
  const simColor = simPct>=80?'#22c55e':simPct>=50?'#f59e0b':'#ef4444'
  const keyLabel = s.keyA||s.keyB||'未知条款'
  const keyLabelB = (s.keyB && s.keyB!==s.keyA)?
    \` <span class="text-gray-400 font-normal text-xs">/ \${escHtml(s.keyB)}</span>\`  : ''

  const header = document.createElement('div')
  header.className='flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50 select-none'
  header.innerHTML = \`
    \${statusIcon}
    <span class="font-semibold text-gray-700 text-sm">\${escHtml(keyLabel)}\${keyLabelB}</span>
    <span class="text-xs px-2 py-0.5 rounded-full font-medium \${badgeClass}">\${badgeText}</span>
    \${s.status==='both'?\`
      <div class="ml-2 flex items-center gap-1.5 text-xs text-gray-400">
        <div class="sim-bar w-16"><div class="sim-fill" style="width:\${simPct}%;background:\${simColor}"></div></div>
        <span>\${simPct}% 相似</span>
      </div>
    \`:''}
    <span class="ml-auto text-gray-300 toggle-icon"><i class="fas fa-chevron-down text-xs"></i></span>
  \`

  const content = document.createElement('div')
  content.className='collapse-content border-t border-gray-100'
  content.id='card-content-'+idx

  if(s.status==='both'){
    content.innerHTML = buildDiffView(s.diffs, s.contentA, s.contentB)
  } else if(s.status==='only_in_A'){
    content.innerHTML=\`<div class="bg-red-50 p-4 m-4 rounded-lg">
      <p class="text-xs text-red-500 font-medium mb-2"><i class="fas fa-times-circle mr-1"></i>该条款仅存在于标准文档中</p>
      <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">\${escHtml(s.contentA.slice(0,3000))}</pre>
    </div>\`
  } else {
    content.innerHTML=\`<div class="bg-green-50 p-4 m-4 rounded-lg">
      <p class="text-xs text-green-600 font-medium mb-2"><i class="fas fa-plus-circle mr-1"></i>该条款仅存在于新文档中</p>
      <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">\${escHtml(s.contentB.slice(0,3000))}</pre>
    </div>\`
  }

  // 前5张默认展开
  if(idx<5) content.classList.add('open')

  header.addEventListener('click',()=>{
    content.classList.toggle('open')
    const ic=header.querySelector('.toggle-icon i')
    ic.className=content.classList.contains('open')?'fas fa-chevron-up text-xs':'fas fa-chevron-down text-xs'
  })

  card.appendChild(header)
  card.appendChild(content)
  return card
}

// ─────────── diff 视图 ───────────────────────────────────────
function buildDiffView(diffs, contentA, contentB){
  if(!diffs||!diffs.length){
    return \`<div class="grid grid-cols-2 gap-0 divide-x divide-gray-100">
      <div class="p-4"><p class="text-xs text-gray-400 font-medium mb-2">标准文档</p>
        <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">\${escHtml(contentA.slice(0,3000))}</pre></div>
      <div class="p-4"><p class="text-xs text-gray-400 font-medium mb-2">新文档</p>
        <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">\${escHtml(contentB.slice(0,3000))}</pre></div>
    </div>\`
  }
  let viewA='', viewB=''
  for(const d of diffs){
    if(d.op===0){ viewA+=escHtml(d.text); viewB+=escHtml(d.text) }
    else if(d.op===-1){ viewA+=\`<mark class="diff-del">\${escHtml(d.text)}</mark>\` }
    else { viewB+=\`<mark class="diff-ins">\${escHtml(d.text)}</mark>\` }
  }
  return \`<div class="grid grid-cols-2 divide-x divide-gray-100">
    <div class="p-4 bg-red-50/30">
      <p class="text-xs text-red-500 font-medium mb-2 flex items-center gap-2">
        <i class="fas fa-file-alt"></i>标准文档
        <span class="ml-auto font-normal text-gray-400"><span class="diff-del px-1">红色</span>=删除</span>
      </p>
      <div class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">\${viewA}</div>
    </div>
    <div class="p-4 bg-green-50/30">
      <p class="text-xs text-green-600 font-medium mb-2 flex items-center gap-2">
        <i class="fas fa-file-alt"></i>新文档
        <span class="ml-auto font-normal text-gray-400"><span class="diff-ins px-1">绿色</span>=新增</span>
      </p>
      <div class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">\${viewB}</div>
    </div>
  </div>\`
}

// ─────────── 工具 ────────────────────────────────────────────
function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function filterCards(){
  const q=document.getElementById('searchInput').value.toLowerCase()
  document.querySelectorAll('.section-card').forEach(c=>{
    c.style.display=c.dataset.key.includes(q)?'':' none'
  })
}
function expandAll(){ document.querySelectorAll('.collapse-content').forEach(el=>el.classList.add('open')); document.querySelectorAll('.toggle-icon i').forEach(i=>i.className='fas fa-chevron-up text-xs') }
function collapseAll(){ document.querySelectorAll('.collapse-content').forEach(el=>el.classList.remove('open')); document.querySelectorAll('.toggle-icon i').forEach(i=>i.className='fas fa-chevron-down text-xs') }
</script>
</body>
</html>`

export default app
