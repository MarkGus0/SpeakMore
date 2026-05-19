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
