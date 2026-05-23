/**
 * 快捷键设置区块
 *
 * 需要展示固定快捷键说明时看这里。
 */
import { Box, Typography } from '@mui/material'

const keybindChip = {
  borderRadius: '6px',
  border: '1px solid rgba(119,119,119,0.12)',
  padding: '4px 8px',
  fontSize: '13px',
  display: 'inline-block',
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { fontSize: 16, fontWeight: 500, mt: 3, mb: 1 }

function KeyChips({ keys }: { keys: string[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {keys.map((key) => (
        <Box key={key} component="span" sx={keybindChip}>{key}</Box>
      ))}
    </Box>
  )
}

export default function ShortcutSettingsSection() {
  return (
    <>
      <Typography sx={sectionTitle}>快捷键</Typography>
      <Box sx={rowSx}>
        <Typography>按下开始和停止语音输入。</Typography>
        <KeyChips keys={['Right Alt']} />
      </Box>
      <Box sx={rowSx}>
        <Typography>按下开始和停止自由提问。</Typography>
        <KeyChips keys={['Right Alt', 'Space']} />
      </Box>
      <Box sx={rowSx}>
        <Typography>按下开始和停止翻译。</Typography>
        <KeyChips keys={['Right Alt', 'Right Shift']} />
      </Box>
    </>
  )
}
