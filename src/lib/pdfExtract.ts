/**
 * 轻量级 PDF 纯文本提取器 v2
 * - 完全字节级扫描，不依赖 DOM/Node
 * - 用 pako 做 zlib/deflate 解压（纯 JS，兼容 Cloudflare Workers）
 * - 支持 UTF-16BE / GBK / Latin-1 编码
 */
import { inflate as pakoInflate } from 'pako'

export async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  const streams = locateStreams(bytes)
  const allText: string[] = []

  for (const { dataBytes, isFlate } of streams) {
    let contentBytes: Uint8Array

    if (isFlate) {
      try {
        // pako.inflate 自动处理 zlib 头（RFC 1950）和 raw deflate（RFC 1951）
        contentBytes = pakoInflate(dataBytes)
      } catch {
        try {
          // 跳过 2 字节 zlib 头，按 raw deflate 尝试
          contentBytes = pakoInflate(dataBytes.slice(2), { raw: true })
        } catch {
          continue
        }
      }
    } else {
      contentBytes = dataBytes
    }

    // 解码为字符串（先尝试 UTF-8，失败则用 Latin-1）
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes)
    } catch {
      content = new TextDecoder('latin1').decode(contentBytes)
    }

    const text = extractTextFromContentStream(content)
    if (text.trim().length > 2) {
      allText.push(text)
    }
  }

  const result = allText.join('\n')
  return cleanText(result)
}

// ── 字节级扫描，定位所有 stream...endstream 块 ────────────────
interface StreamInfo {
  dataBytes: Uint8Array
  isFlate: boolean
}

function locateStreams(bytes: Uint8Array): StreamInfo[] {
  const results: StreamInfo[] = []

  // PDF 关键词的字节序列
  const STREAM    = [115, 116, 114, 101, 97, 109]       // "stream"
  const ENDSTREAM = [101, 110, 100, 115, 116, 114, 101, 97, 109] // "endstream"

  let i = 0
  while (i < bytes.length - 10) {
    // 查找 "stream"
    const si = indexOfBytes(bytes, STREAM, i)
    if (si === -1) break

    // "stream" 之后必须跟 \n 或 \r\n
    let dataStart = si + 6
    if (dataStart < bytes.length && bytes[dataStart] === 0x0d) dataStart++ // \r
    if (dataStart < bytes.length && bytes[dataStart] === 0x0a) dataStart++ // \n
    else { i = si + 6; continue } // 不是合法流，跳过

    // 查找 "endstream"
    const ei = indexOfBytes(bytes, ENDSTREAM, dataStart)
    if (ei === -1) break

    // endstream 前可能有 \n 或 \r\n
    let dataEnd = ei
    if (dataEnd > 0 && bytes[dataEnd - 1] === 0x0a) dataEnd--
    if (dataEnd > 0 && bytes[dataEnd - 1] === 0x0d) dataEnd--

    if (dataEnd > dataStart) {
      const dataBytes = bytes.slice(dataStart, dataEnd)

      // 判断是否 FlateDecode：向前扫描字典区（最多 2KB）
      const dictBytes = bytes.slice(Math.max(0, si - 2048), si)
      const dictStr = new TextDecoder('latin1').decode(dictBytes)
      const isFlate = /\/Filter\s*\/FlateDecode|\/Filter\s*\[.*?\/FlateDecode|\/Fl\s/.test(dictStr)

      results.push({ dataBytes, isFlate })
    }

    i = ei + 9
  }

  return results
}

// 字节数组中查找子序列，返回索引（-1 表示未找到）
function indexOfBytes(haystack: Uint8Array, needle: number[], from: number): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

// ── 从内容流字符串中提取文本 ─────────────────────────────────
function extractTextFromContentStream(content: string): string {
  const lines: string[] = []
  let pos = 0

  while (true) {
    const bt = content.indexOf('BT', pos)
    if (bt === -1) break

    // 确保 BT 是一个独立操作符（前后是空白或行首）
    const charBefore = bt > 0 ? content[bt - 1] : '\n'
    if (!/[\s\n\r]/.test(charBefore)) { pos = bt + 2; continue }

    const et = content.indexOf('ET', bt + 2)
    if (et === -1) break

    const block = content.slice(bt + 2, et)
    const text = parseTextBlock(block)
    if (text.trim()) lines.push(text)

    pos = et + 2
  }

  // 如果没找到 BT...ET，做全文扫描
  if (lines.length === 0) {
    const direct = scanDirectText(content)
    if (direct) lines.push(direct)
  }

  return lines.join('\n')
}

// ── 解析 BT...ET 块内的操作符 ────────────────────────────────
function parseTextBlock(block: string): string {
  const parts: string[] = []
  let lineBuffer = ''
  let prevY = 0

  // 扫描位置移动操作（Td/TD/Tm）判断行距
  // 注意：Tm 格式为 a b c d e f Tm，e=x, f=y
  const re = new RegExp(
    // (string) Tj 或 (string) '
    '\\(([^)\\\\]*(?:\\\\(?:.|\\r?\\n)[^)\\\\]*)*)\\)\\s*([Tj\'"])|' +
    // [(...)...] TJ
    '(\\[(?:[^\\[\\]]*(?:\\((?:[^)\\\\]|\\\\.)*\\))?)*\\])\\s*TJ|' +
    // T*
    '(T\\*)|' +
    // n Td / TD
    '(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)\\s+(T[dD])',
    'g'
  )

  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    if (m[4]) {
      // T* 换行
      if (lineBuffer) { parts.push(lineBuffer); lineBuffer = '' }
    } else if (m[5] !== undefined) {
      // Td/TD 位移
      const dy = parseFloat(m[6])
      if (dy < -1 || (dy === 0 && lineBuffer)) {
        // 竖向位移表示换行
        if (lineBuffer) { parts.push(lineBuffer); lineBuffer = '' }
      }
    } else if (m[3]) {
      // TJ array
      lineBuffer += parseTJArray(m[3])
    } else if (m[1] !== undefined) {
      const str = decodePdfString(m[1])
      if (m[2] === "'") {
        if (lineBuffer) { parts.push(lineBuffer); lineBuffer = '' }
        lineBuffer = str
      } else {
        lineBuffer += str
      }
    }
  }
  if (lineBuffer) parts.push(lineBuffer)
  return parts.filter(s => s.trim()).join('\n')
}

// ── 解析 TJ 数组 ─────────────────────────────────────────────
function parseTJArray(arr: string): string {
  // [(text1) -200 (text2) 150 (text3)] → text1text2text3
  let result = ''
  const strRe = /\(([^)\\]*(?:\\(?:.|(?:\r\n|\r|\n))[^)\\]*)*)\)/g
  let m: RegExpExecArray | null
  while ((m = strRe.exec(arr)) !== null) {
    result += decodePdfString(m[1])
  }
  return result
}

// ── 直接扫描全文（fallback） ──────────────────────────────────
function scanDirectText(content: string): string {
  const parts: string[] = []
  const re = /\(([^)\\]*(?:\\(?:.|(?:\r\n|\r|\n))[^)\\]*)*)\)\s*Tj|\[[\s\S]*?\]\s*TJ/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const s = m[0]
    if (s.endsWith('Tj')) {
      const inner = s.match(/^\(([^)\\]*(?:\\.[^)\\]*)*)\)/)
      if (inner) parts.push(decodePdfString(inner[1]))
    } else {
      parts.push(parseTJArray(s))
    }
  }
  return parts.join('')
}

// ── PDF 字符串解码 ────────────────────────────────────────────
function decodePdfString(raw: string): string {
  // 处理转义序列
  let s = ''
  let i = 0
  while (i < raw.length) {
    if (raw[i] !== '\\') { s += raw[i++]; continue }
    i++
    if (i >= raw.length) break
    const c = raw[i]
    if      (c === 'n')  { s += '\n'; i++ }
    else if (c === 'r')  { s += '\r'; i++ }
    else if (c === 't')  { s += '\t'; i++ }
    else if (c === '\\') { s += '\\'; i++ }
    else if (c === '(')  { s += '(';  i++ }
    else if (c === ')')  { s += ')';  i++ }
    else if (c >= '0' && c <= '7') {
      let oct = ''
      while (i < raw.length && raw[i] >= '0' && raw[i] <= '7' && oct.length < 3) oct += raw[i++]
      s += String.fromCharCode(parseInt(oct, 8))
    } else if (c === '\r') {
      if (raw[i + 1] === '\n') i++
      i++
    } else if (c === '\n') {
      i++
    } else { s += c; i++ }
  }

  // UTF-16BE BOM → \xFE\xFF
  if (s.length >= 2 && s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) {
    return decodeUtf16be(s.slice(2))
  }

  // 含高字节 → 尝试 GBK 解码（中文 PDF 常见）
  if (hasHighBytes(s)) {
    const gbk = tryDecode(s, 'gbk')
    if (gbk) return gbk
    const b5 = tryDecode(s, 'big5')
    if (b5) return b5
  }

  return s
}

function decodeUtf16be(s: string): string {
  let r = ''
  for (let i = 0; i + 1 < s.length; i += 2) {
    const code = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1)
    if (code > 0) r += String.fromCodePoint(code)
  }
  return r
}

function hasHighBytes(s: string): boolean {
  let n = 0
  for (let i = 0; i < Math.min(s.length, 200); i++) {
    if (s.charCodeAt(i) > 127) n++
  }
  return n > s.length * 0.1
}

function tryDecode(s: string, encoding: string): string | null {
  try {
    const bytes = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff
    const result = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    // 验证解码结果是否有意义（包含可打印字符）
    const printable = result.replace(/\s/g, '')
    if (printable.length > 0 && !/[\uFFFD]/.test(result)) return result
    return null
  } catch {
    return null
  }
}

// ── 清理文本 ─────────────────────────────────────────────────
function cleanText(text: string): string {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
