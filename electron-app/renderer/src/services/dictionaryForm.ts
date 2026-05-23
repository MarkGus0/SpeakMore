/**
 * 词典表单解析工具
 *
 * 需要把别名输入拆成去重后的词条列表时看这里。
 */
export function splitDictionaryAliases(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(/[,\n，、;；]/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
