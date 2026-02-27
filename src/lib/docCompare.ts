/**
 * 文档比对核心工具
 * 移植自 Python 脚本逻辑，实现条款切分、对齐、差异输出
 */

// ================== 类型定义 ==================
export interface Section {
  key: string
  content: string
}

export interface AlignedPair {
  keyA: string | null
  keyB: string | null
  status: 'both' | 'only_in_A' | 'only_in_B'
  similarity: number
  contentA: string
  contentB: string
}

export interface DiffItem {
  op: number // -1删除 0相等 1插入
  text: string
}

export interface SectionDiff {
  keyA: string | null
  keyB: string | null
  status: 'both' | 'only_in_A' | 'only_in_B'
  similarity: number
  diffs: DiffItem[]
  contentA: string
  contentB: string
}

// ================== 掩码模式（屏蔽必然变化字段） ==================
const MASK_PATTERNS: [RegExp, string][] = [
  [/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g, '<DATE>'],
  [/合同编号[:：]\s*[A-Za-z0-9\-_]+/g, '合同编号：<ID>'],
  [/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '<EMAIL>'],
  [/\b1\d{10}\b/g, '<PHONE>'],
]

function applyMask(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim()
  for (const [pat, rep] of MASK_PATTERNS) {
    t = t.replace(pat, rep)
  }
  return t
}

// ================== 文本规范化 ==================
export function normalizeText(raw: string): string {
  const lines: string[] = []
  for (const line of raw.split('\n')) {
    const l = line.trim()
    if (!l) continue
    if (l.startsWith('合同编号：') || l.startsWith('合同编号:')) continue
    if (/^\d+$/.test(l)) continue // 纯页码行
    lines.push(l)
  }
  let s = lines.join('\n')
  s = s.replace(/[ \t]+/g, ' ')
  return s.trim()
}

// ================== 条款/附件切分 ==================
const CN_NUM = '一二三四五六七八九十百千〇零'
const CLAUSE_PAT = new RegExp(`(第[${CN_NUM}]+条[^\\n]*)`, 'g')
const APPEND_PAT = /附件[一二三四五六七八九十]+[^\n]*/g

function extractMarkers(text: string): Array<{ pos: number; title: string }> {
  const markers: Array<{ pos: number; title: string }> = []

  let m: RegExpExecArray | null
  CLAUSE_PAT.lastIndex = 0
  while ((m = CLAUSE_PAT.exec(text)) !== null) {
    markers.push({ pos: m.index, title: m[1].trim() })
  }
  APPEND_PAT.lastIndex = 0
  while ((m = APPEND_PAT.exec(text)) !== null) {
    markers.push({ pos: m.index, title: m[0].trim() })
  }

  // 去重 + 按位置排序
  const seen = new Set<number>()
  return markers
    .filter((mk) => {
      if (seen.has(mk.pos)) return false
      seen.add(mk.pos)
      return true
    })
    .sort((a, b) => a.pos - b.pos)
}

function normalizeKey(title: string): string {
  const m1 = title.match(new RegExp(`^(第[${CN_NUM}]+条)`))
  if (m1) return m1[1]
  const m2 = title.match(/^(附件[一二三四五六七八九十]+)/)
  if (m2) return m2[1]
  return title
}

export function splitSections(text: string): Map<string, string> {
  const sections = new Map<string, string>()
  const markers = extractMarkers(text)

  if (markers.length === 0) {
    sections.set('全文', text)
    return sections
  }

  const pre = text.slice(0, markers[0].pos).trim()
  if (pre) sections.set('序言', pre)

  for (let i = 0; i < markers.length; i++) {
    const { pos, title } = markers[i]
    const end = i + 1 < markers.length ? markers[i + 1].pos : text.length
    const body = text.slice(pos, end).trim()
    const key = normalizeKey(title)
    sections.set(key, body)
  }

  return sections
}

// ================== 相似度计算（LCS比例） ==================
function similarity(a: string, b: string): number {
  const ma = applyMask(a)
  const mb = applyMask(b)
  if (ma.length === 0 && mb.length === 0) return 1
  if (ma.length === 0 || mb.length === 0) return 0
  // 使用 diff-match-patch 内置的levenshtein做近似相似度
  // 这里用简单的 Sørensen–Dice 系数（bigram）更快
  return diceCoefficient(ma, mb)
}

function bigrams(str: string): Set<string> {
  const bg = new Set<string>()
  for (let i = 0; i < str.length - 1; i++) {
    bg.add(str.slice(i, i + 2))
  }
  return bg
}

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bgA = bigrams(a)
  const bgB = bigrams(b)
  let intersection = 0
  for (const bg of bgA) {
    if (bgB.has(bg)) intersection++
  }
  return (2 * intersection) / (bgA.size + bgB.size)
}

// ================== 条款对齐 ==================
function fuzzyMatch(key: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null
  let best: string | null = null
  let bestScore = 0
  for (const c of candidates) {
    const score = diceCoefficient(key, c)
    if (score > bestScore && score >= 0.8) {
      bestScore = score
      best = c
    }
  }
  return best
}

export function alignSections(
  secA: Map<string, string>,
  secB: Map<string, string>
): AlignedPair[] {
  const keysA = Array.from(secA.keys())
  const keysB = Array.from(secB.keys())

  const aligned: AlignedPair[] = []
  const usedB = new Set<string>()

  // 同名直接对齐
  for (const k of keysA) {
    if (secB.has(k)) {
      const a = secA.get(k)!
      const b = secB.get(k)!
      aligned.push({
        keyA: k,
        keyB: k,
        status: 'both',
        similarity: similarity(a, b),
        contentA: a,
        contentB: b,
      })
      usedB.add(k)
    }
  }

  // A 里剩余 → 模糊匹配 B
  const remainA = keysA.filter((k) => !aligned.find((p) => p.keyA === k))
  const remainB = keysB.filter((k) => !usedB.has(k))

  for (const k of remainA) {
    const available = remainB.filter((b) => !usedB.has(b))
    const match = fuzzyMatch(k, available)
    if (match) {
      const a = secA.get(k)!
      const b = secB.get(match)!
      aligned.push({
        keyA: k,
        keyB: match,
        status: 'both',
        similarity: similarity(a, b),
        contentA: a,
        contentB: b,
      })
      usedB.add(match)
    } else {
      aligned.push({
        keyA: k,
        keyB: null,
        status: 'only_in_A',
        similarity: 0,
        contentA: secA.get(k)!,
        contentB: '',
      })
    }
  }

  // B 里多出的
  for (const k of keysB) {
    if (!usedB.has(k)) {
      aligned.push({
        keyA: null,
        keyB: k,
        status: 'only_in_B',
        similarity: 0,
        contentA: '',
        contentB: secB.get(k)!,
      })
    }
  }

  return aligned
}

// ================== 生成差异列表 ==================
export function computeDiff(a: string, b: string): DiffItem[] {
  const ma = applyMask(a)
  const mb = applyMask(b)

  // 将文本按段落切分，逐段对比，产生更可读的 diff
  const result: DiffItem[] = []
  diffTexts(ma, mb, result)
  return result
}

/**
 * 简单的 word-level diff（基于 Myers diff 算法简化版）
 * 将两段文字按"词/标点"切分后做 LCS diff，结果合并为连续 run
 */
function diffTexts(a: string, b: string, out: DiffItem[]): void {
  // 按字符（中文逐字）拆分
  const tokA = tokenize(a)
  const tokB = tokenize(b)

  const lcs = computeLCS(tokA, tokB)
  let ia = 0, ib = 0, il = 0

  while (il < lcs.length) {
    const [la, lb] = lcs[il]
    // 删除 tokA[ia..la-1]
    if (ia < la) {
      out.push({ op: -1, text: tokA.slice(ia, la).join('') })
    }
    // 插入 tokB[ib..lb-1]
    if (ib < lb) {
      out.push({ op: 1, text: tokB.slice(ib, lb).join('') })
    }
    // 相等
    let eq = ''
    while (il < lcs.length && lcs[il][0] === ia + (eq ? eq.split('').filter(Boolean).length : 0)) {
      // 合并连续相等 token
      break
    }
    // 找连续相等段
    let eqA = la, eqB = lb
    while (il < lcs.length && lcs[il][0] === eqA && lcs[il][1] === eqB) {
      eq += tokA[eqA]
      eqA++
      eqB++
      il++
    }
    if (eq) out.push({ op: 0, text: eq })
    ia = eqA
    ib = eqB
  }

  if (ia < tokA.length) out.push({ op: -1, text: tokA.slice(ia).join('') })
  if (ib < tokB.length) out.push({ op: 1, text: tokB.slice(ib).join('') })
}

function tokenize(text: string): string[] {
  // 按单词/中文字符/标点切分
  const tokens: string[] = []
  const re = /[\u4e00-\u9fa5]|[a-zA-Z0-9]+|[^\s\u4e00-\u9fa5a-zA-Z0-9]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[0])
  }
  return tokens
}

function computeLCS(a: string[], b: string[]): [number, number][] {
  const m = a.length, n = b.length
  // 对超长文本做截断以保证性能
  const MAX = 2000
  const aa = m > MAX ? a.slice(0, MAX) : a
  const bb = n > MAX ? b.slice(0, MAX) : b

  const M = aa.length, N = bb.length
  const dp: number[][] = Array.from({ length: M + 1 }, () => new Array(N + 1).fill(0))

  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      if (aa[i - 1] === bb[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 回溯
  const result: [number, number][] = []
  let i = M, j = N
  while (i > 0 && j > 0) {
    if (aa[i - 1] === bb[j - 1]) {
      result.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  return result.reverse()
}

// ================== 完整比对流程 ==================
export interface CompareResult {
  totalSections: number
  changedSections: number
  sections: SectionDiff[]
}

export function compareDocs(textA: string, textB: string): CompareResult {
  const normA = normalizeText(textA)
  const normB = normalizeText(textB)

  const secA = splitSections(normA)
  const secB = splitSections(normB)

  const pairs = alignSections(secA, secB)

  const sections: SectionDiff[] = []
  for (const pair of pairs) {
    const { keyA, keyB, status, similarity: sim, contentA, contentB } = pair

    // 只输出差异条款（相似度 < 0.98 或 only）
    if (status === 'both' && sim >= 0.98) continue

    const diffs = status === 'both' ? computeDiff(contentA, contentB) : []

    sections.push({
      keyA,
      keyB,
      status,
      similarity: Math.round(sim * 10000) / 10000,
      diffs,
      contentA: contentA.slice(0, 5000),
      contentB: contentB.slice(0, 5000),
    })
  }

  // 按相似度升序排列（差异最大的在前）
  sections.sort((a, b) => a.similarity - b.similarity)

  return {
    totalSections: pairs.length,
    changedSections: sections.length,
    sections,
  }
}
