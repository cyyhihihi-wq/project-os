/**
 * fileExtractor.js
 * 统一文件内容提取入口
 *
 * 支持：txt / md / docx / pdf
 *
 * 统一返回结构（ExtractResult）：
 *   { success, fileType, contentHtml?, contentText?, error? }
 *   - success    : boolean
 *   - fileType   : 'docx' | 'pdf' | 'txt' | 'md' | string
 *   - contentHtml: 优先使用；含表格/标题/列表的 HTML（docx 有，pdf/txt/md 无）
 *   - contentText: 纯文本；供 AI prompt 或降级显示
 *   - error      : success=false 时的用户可读错误信息
 *
 * 不抛出异常——所有错误都收进 { success: false, error } 返回。
 * 使用 pdfjs-dist v3（不依赖 Promise.withResolvers，无浏览器兼容问题）。
 */

// ---------------------------------------------------------------------------
// 公开工具：纯文本 → HTML 段落
// 用于 v-html 预览（不经过 Tiptap），pdf / txt / md 提取结果使用。
// ---------------------------------------------------------------------------

/**
 * 把纯文本转为 HTML 段落供 v-html 渲染。
 * - 双换行分段 → <p>
 * - 单换行保留为 <br>
 * - 转义 & < > 防止 XSS
 *
 * @param {string} text
 * @returns {string}
 */
export function textToPreviewHtml(text) {
  if (!text) return ''
  return text
    .split(/\n{2,}/)
    .filter(p => p.trim())
    .map(p =>
      `<p>${p
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
      }</p>`
    )
    .join('')
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 从 File 对象提取内容。
 * 不抛出——所有错误返回 { success: false, error }。
 *
 * @param {File} file
 * @returns {Promise<{
 *   success: boolean,
 *   fileType: string,
 *   contentHtml?: string,
 *   contentText?: string,
 *   error?: string
 * }>}
 */
export async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  console.log('[fileExtractor] selected file:', file.name, 'size:', file.size, 'ext:', ext)

  let result
  try {
    if (ext === 'txt' || ext === 'md') {
      const text = await file.text()
      if (!text.trim()) {
        result = { success: false, fileType: ext, error: '文件内容为空' }
      } else {
        result = { success: true, fileType: ext, contentText: text }
      }
    } else if (ext === 'docx') {
      result = await _extractDocx(file, ext)
    } else if (ext === 'pdf') {
      result = await _extractPdf(file)
    } else {
      result = {
        success: false,
        fileType: ext,
        error: `不支持的文件类型 .${ext}（支持：txt、md、docx、pdf）`,
      }
    }
  } catch (err) {
    result = {
      success: false,
      fileType: ext,
      error: `文件解析失败：${_friendlyError(err)}`,
    }
  }

  console.log('[fileExtractor] extract result:', JSON.stringify({
    success: result.success,
    fileType: result.fileType,
    error: result.error,
    contentTextLen: result.contentText?.length,
    contentHtmlLen: result.contentHtml?.length,
  }))
  return result
}

// ---------------------------------------------------------------------------
// docx — mammoth convertToHtml（保留表格 / 标题 / 列表）
// ---------------------------------------------------------------------------

async function _extractDocx(file, ext) {
  // Vite 生产构建将 CJS 包的 module.exports 挂在 .default；
  // 开发模式直接作为具名 export。两者都兼容。
  const mod = await import('mammoth')
  const mammoth = (mod.default && typeof mod.default.convertToHtml === 'function')
    ? mod.default
    : mod

  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer })

  const contentHtml = result.value
  if (!contentHtml.trim()) {
    return { success: false, fileType: ext, error: 'Word 文档内容为空' }
  }

  const contentText = _htmlToPlain(contentHtml)
  return { success: true, fileType: ext, contentHtml, contentText }
}

// ---------------------------------------------------------------------------
// pdf — pdfjs-dist 文字层提取
// ---------------------------------------------------------------------------

async function _extractPdf(file) {
  const pdfjs = await import('pdfjs-dist')

  // Worker 路径：pdfjs-dist v3 使用 .js（非 .mjs）
  // Vite 通过 new URL(..., import.meta.url) 静态分析并 emit worker 文件
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.js',
        import.meta.url,
      ).href
    } catch {
      // fallback：在不支持 import.meta.url 分析的环境中禁用 worker（同步降级）
      pdfjs.GlobalWorkerOptions.workerSrc = ''
    }
  }

  const arrayBuffer = await file.arrayBuffer()
  let pdf
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  } catch (err) {
    return { success: false, fileType: 'pdf', error: `PDF 加载失败：${_friendlyError(err)}` }
  }

  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page  = await pdf.getPage(i)
    const tc    = await page.getTextContent()
    const text  = _extractPageText(tc)
    if (text.trim()) pages.push(text)
  }

  if (pages.length === 0) {
    return {
      success: false,
      fileType: 'pdf',
      error: '未检测到可提取的文字层，该 PDF 可能为扫描件或图片型 PDF',
    }
  }

  const contentText = pages.join('\n\n')
  return { success: true, fileType: 'pdf', contentText }
}

// ---------------------------------------------------------------------------
// PDF 文字层提取 + 简单表格检测
// ---------------------------------------------------------------------------

/**
 * 从 pdfjs TextContent 提取文字，行内大间距 > 30px 插入制表符。
 * 最后调用 _tabsToMarkdown 把连续 tab 行转为 Markdown 表格。
 */
function _extractPageText(content) {
  const { items } = content
  if (!items.length) return ''

  // 按 y 坐标（2px 精度）分组
  const rowMap = new Map()
  for (const item of items) {
    if (!item.str) continue
    const y = Math.round(item.transform[5] / 2) * 2
    if (!rowMap.has(y)) rowMap.set(y, [])
    rowMap.get(y).push(item)
  }

  // y 降序 = 页面从上到下
  const sortedRows = [...rowMap.entries()].sort((a, b) => b[0] - a[0])

  const lines = sortedRows.map(([, rowItems]) => {
    rowItems.sort((a, b) => a.transform[4] - b.transform[4])
    let line = ''
    for (let i = 0; i < rowItems.length; i++) {
      const item = rowItems[i]
      if (i > 0) {
        const prev    = rowItems[i - 1]
        const prevEnd = prev.transform[4] + (prev.width || 0)
        const gap     = item.transform[4] - prevEnd
        line += gap > 30 ? '\t' : ' '
      }
      line += item.str
    }
    return line.trim()
  }).filter(l => l)

  return _tabsToMarkdown(lines.join('\n'))
}

/**
 * 把 tab 分隔行转为 Markdown 表格。
 * 规则：连续 ≥ 2 行、列数相同（允许差 1）、≤ 8 列、单元格 ≤ 80 字符 → 简单表格。
 * 否则降级：tab 替换为两个空格。
 */
function _tabsToMarkdown(text) {
  const lines  = text.split('\n')
  const result = []
  let i = 0

  while (i < lines.length) {
    const parts = lines[i].split('\t')

    if (parts.length >= 2) {
      const colCount  = parts.length
      const tableRows = [parts.map(s => s.trim())]
      let j = i + 1

      while (j < lines.length) {
        const np = lines[j].split('\t')
        if (np.length >= 2 && Math.abs(np.length - colCount) <= 1) {
          while (np.length < colCount) np.push('')
          tableRows.push(np.slice(0, colCount).map(s => s.trim()))
          j++
        } else {
          break
        }
      }

      const isSimple =
        tableRows.length >= 2 &&
        colCount <= 8 &&
        tableRows.every(r => r.every(c => c.length <= 80))

      if (isSimple) {
        result.push('| ' + tableRows[0].join(' | ') + ' |')
        result.push('| ' + tableRows[0].map(() => '---').join(' | ') + ' |')
        for (let k = 1; k < tableRows.length; k++) {
          result.push('| ' + tableRows[k].join(' | ') + ' |')
        }
        result.push('')
      } else {
        for (let k = i; k < j; k++) result.push(lines[k].replace(/\t+/g, '  '))
      }
      i = j
    } else {
      result.push(lines[i])
      i++
    }
  }

  return result.join('\n')
}

// ---------------------------------------------------------------------------
// 工具：HTML → 纯文本（供 AI prompt）
// ---------------------------------------------------------------------------

function _htmlToPlain(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/th>/gi, '\t')
    .replace(/<\/td>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/\t\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---------------------------------------------------------------------------
// 工具：把底层错误转为用户可读文字
// ---------------------------------------------------------------------------

function _friendlyError(err) {
  const msg = err?.message || String(err)
  if (msg.includes('withResolvers'))    return '当前浏览器版本不支持 PDF 解析（请升级到 Chrome 119+ / Firefox 121+）'
  if (msg.includes('worker'))           return 'PDF Worker 加载失败，请刷新后重试'
  if (msg.includes('Invalid PDF'))      return '无效的 PDF 文件'
  if (msg.includes('Password'))         return '该 PDF 已加密，暂不支持'
  return msg.slice(0, 120)
}
