/**
 * 轻量级 PDF 纯文本提取器
 * 完全基于 Web API（DecompressionStream / TextDecoder），兼容 Cloudflare Workers
 * 
 * 流程：
 * 1. 扫描 PDF 文件，找到所有 stream/endstream 块
 * 2. 对 FlateDecode 流用 DecompressionStream 解压
 * 3. 从解压后的内容流中，用正则提取 BT...ET 块里的文本操作符
 */

export async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  const allText: string[] = []

  // 遍历 PDF 文件找所有 stream 对象
  const streams = await extractAllStreams(bytes)

  for (const { data, isFlate } of streams) {
    let content: string
    if (isFlate) {
      try {
        const decompressed = await inflate(data)
        content = new TextDecoder('latin1').decode(decompressed)
      } catch {
        content = new TextDecoder('latin1').decode(data)
      }
    } else {
      content = new TextDecoder('latin1').decode(data)
    }

    const text = extractTextFromContentStream(content)
    if (text.trim().length > 0) {
      allText.push(text)
    }
  }

  const result = allText.join('\n')
  return result.replace(/\r\n|\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── 解压 deflate 数据（Cloudflare Workers 原生支持） ──────────
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // PDF FlateDecode 使用 zlib 格式（带 2 字节 zlib 头），需要用 'deflate' 解压器
  // 如果 zlib 头失败，尝试 raw deflate
  try {
    return await decompress(data, 'deflate')
  } catch {
    // 某些 PDF 使用 raw deflate（无 zlib 头）
    return await decompress(data, 'deflate-raw')
  }
}

async function decompress(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  const ds = new DecompressionStream(format)
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()

  writer.write(data)
  writer.close()

  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const total = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    result.set(c, offset)
    offset += c.length
  }
  return result
}

// ── 扫描 PDF bytes，提取所有流 ───────────────────────────────
interface PdfStream {
  data: Uint8Array
  isFlate: boolean
}

async function extractAllStreams(bytes: Uint8Array): Promise<PdfStream[]> {
  const results: PdfStream[] = []
  const latin1 = new TextDecoder('latin1')
  const raw = latin1.decode(bytes)

  // 找所有 stream/endstream 对
  let searchFrom = 0
  while (true) {
    // 找 "stream" 关键字（后跟 \r\n 或 \n）
    const streamIdx = findKeyword(raw, 'stream', searchFrom)
    if (streamIdx === -1) break

    const afterStream = streamIdx + 6 // 跳过 "stream"
    // stream 后必须紧跟 CR+LF 或 LF
    let dataStart = afterStream
    if (raw[dataStart] === '\r' && raw[dataStart + 1] === '\n') dataStart += 2
    else if (raw[dataStart] === '\n') dataStart += 1
    else { searchFrom = afterStream; continue }

    // 找对应的 endstream
    const endIdx = raw.indexOf('endstream', dataStart)
    if (endIdx === -1) break

    // endstream 前可能有 \r\n 或 \n
    let dataEnd = endIdx
    if (dataEnd > 0 && raw[dataEnd - 1] === '\n') dataEnd--
    if (dataEnd > 0 && raw[dataEnd - 1] === '\r') dataEnd--

    // 提取流数据
    const streamData = bytes.slice(dataStart, dataEnd)

    // 判断是否是 FlateDecode
    // 向前查找最近的 << 字典
    const dictEnd = streamIdx
    const dictStart = raw.lastIndexOf('<<', dictEnd)
    const dict = dictStart >= 0 ? raw.slice(dictStart, Math.min(dictEnd, dictStart + 1000)) : ''
    const isFlate = /\/Filter\s*\/FlateDecode|\/Filter\s*\[.*\/FlateDecode/.test(dict) ||
      dict.includes('/Fl ')

    if (streamData.length > 0) {
      results.push({ data: streamData, isFlate })
    }

    searchFrom = endIdx + 9
  }

  return results
}

function findKeyword(text: string, keyword: string, from: number): number {
  return text.indexOf(keyword, from)
}

// ── 从内容流中提取文本 ──────────────────────────────────────
function extractTextFromContentStream(content: string): string {
  const lines: string[] = []

  // 找到所有 BT...ET 块
  let btIdx = 0
  while (true) {
    const bt = content.indexOf('BT', btIdx)
    if (bt === -1) break
    const et = content.indexOf('ET', bt + 2)
    if (et === -1) break

    const block = content.slice(bt + 2, et)
    const text = parseTextBlock(block)
    if (text.trim()) lines.push(text)

    btIdx = et + 2
  }

  return lines.join('\n')
}

// ── 解析单个 BT...ET 块 ──────────────────────────────────────
function parseTextBlock(block: string): string {
  const parts: string[] = []

  // 匹配所有文本相关操作符
  // Tj: (string) Tj
  // TJ: [(string) n (string) ...] TJ
  // ': (string) '   (move to next line then show text)
  // T*: move to next line
  const re = /\(([^)\\]*(?:\\(?:.|(?:\r\n|\r|\n))[^)\\]*)*)\)\s*([Tj'"])|(\[[\s\S]*?\])\s*TJ|(T\*)/g
  let m: RegExpExecArray | null

  let lineBuffer = ''

  while ((m = re.exec(block)) !== null) {
    if (m[4]) {
      // T* - 换行
      if (lineBuffer) { parts.push(lineBuffer); lineBuffer = '' }
    } else if (m[3]) {
      // TJ array
      lineBuffer += parseTJArray(m[3])
    } else if (m[1] !== undefined) {
      const str = decodePdfString(m[1])
      if (m[2] === "'") {
        // ' 操作符：换行后显示
        if (lineBuffer) { parts.push(lineBuffer); lineBuffer = '' }
        lineBuffer = str
      } else {
        lineBuffer += str
      }
    }
  }

  if (lineBuffer) parts.push(lineBuffer)
  return parts.filter(Boolean).join('\n')
}

// ── 解析 TJ 数组 ─────────────────────────────────────────────
function parseTJArray(arr: string): string {
  let result = ''
  const strRe = /\(([^)\\]*(?:\\(?:.|(?:\r\n|\r|\n))[^)\\]*)*)\)/g
  let m: RegExpExecArray | null
  while ((m = strRe.exec(arr)) !== null) {
    const decoded = decodePdfString(m[1])
    // 数字位移较大时（> 250）表示单词间距
    result += decoded
  }
  return result
}

// ── PDF 字符串解码 ────────────────────────────────────────────
function decodePdfString(raw: string): string {
  // 处理转义序列
  let s = ''
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '\\') {
      i++
      if (i >= raw.length) break
      const c = raw[i]
      if (c === 'n') { s += '\n'; i++ }
      else if (c === 'r') { s += '\r'; i++ }
      else if (c === 't') { s += '\t'; i++ }
      else if (c === '\\') { s += '\\'; i++ }
      else if (c === '(') { s += '('; i++ }
      else if (c === ')') { s += ')'; i++ }
      else if (c >= '0' && c <= '7') {
        // 八进制转义
        let oct = ''
        while (i < raw.length && raw[i] >= '0' && raw[i] <= '7' && oct.length < 3) {
          oct += raw[i++]
        }
        s += String.fromCharCode(parseInt(oct, 8))
      } else if (c === '\r' || c === '\n') {
        // 续行
        if (c === '\r' && raw[i + 1] === '\n') i++
        i++
      } else {
        s += c; i++
      }
    } else {
      s += raw[i++]
    }
  }

  // 检测 UTF-16BE BOM（\xFE\xFF）
  if (s.length >= 2 && s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) {
    return decodeUtf16be(s.slice(2))
  }

  // 中文 PDF 常用 GBK/GB2312：尝试检测非 ASCII 字符组合
  // 如果包含大量高字节对，尝试 GBK 解码
  if (hasHighBytes(s)) {
    const gbkResult = tryGbkDecode(s)
    if (gbkResult) return gbkResult
  }

  return s
}

function decodeUtf16be(s: string): string {
  let result = ''
  for (let i = 0; i + 1 < s.length; i += 2) {
    const code = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1)
    if (code > 0) result += String.fromCodePoint(code)
  }
  return result
}

function hasHighBytes(s: string): boolean {
  let count = 0
  for (let i = 0; i < Math.min(s.length, 100); i++) {
    if (s.charCodeAt(i) > 127) count++
  }
  return count > 2
}

function tryGbkDecode(s: string): string | null {
  try {
    // 转为字节数组再用 GBK 解码
    const bytes = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff
    const decoder = new TextDecoder('gbk')
    return decoder.decode(bytes)
  } catch {
    return null
  }
}
