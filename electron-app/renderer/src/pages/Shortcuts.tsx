import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import KeyboardIcon from '@mui/icons-material/Keyboard'
import MicIcon from '@mui/icons-material/Mic'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import TerminalIcon from '@mui/icons-material/Terminal'
import TranslateIcon from '@mui/icons-material/Translate'
import { useI18n, type TranslationKey } from '../i18n'
import { pageSx, pageTitleSx } from '../uiTokens'
import {
  deleteShortcutCommand,
  getShortcutRegistrationStatus,
  listShortcutCommands,
  saveShortcutCommand,
  subscribeShortcutCommandChanges,
  type ShortcutCommand,
  type ShortcutCommandRegistrationStatus,
  type ShortcutCommandShortcut,
} from '../services/shortcutCommandStore'

const defaultCommandNames: Record<string, string> = {
  voice_input: 'Voice Input',
  smart_assistant: 'Smart Assistant',
  hands_free_mode: 'Hands-Free Mode',
  translate_to_english: 'Translate to English',
  terminal_assistant: 'Terminal Assistant',
  professional_polish: 'Professional Polish',
  abstract_mode: 'Abstract Mode',
  internet_dark: 'Corporate Jargon Mode',
}

const defaultCommandDescriptions: Record<string, string> = {
  voice_input: 'Hold to speak, release to transcribe and paste.',
  smart_assistant: 'Double-tap Right Alt to ask a question and show the answer in the floating panel.',
  hands_free_mode: 'Press once to start recording, then press again to stop.',
  translate_to_english: 'Translate spoken content into natural, fluent English.',
  terminal_assistant: 'Convert spoken requests into directly executable command-line text.',
  professional_polish: 'Rewrite spoken content into polished workplace communication.',
  abstract_mode: 'Rewrite text with abstract slang, expressive energy, and emoji-heavy style.',
  internet_dark: 'Turn casual speech into corporate buzzword-filled project language.',
}

const commandIconById: Record<string, React.ReactNode> = {
  voice_input: <MicIcon sx={{ fontSize: 18 }} />,
  smart_assistant: <SmartToyIcon sx={{ fontSize: 18 }} />,
  hands_free_mode: <KeyboardIcon sx={{ fontSize: 18 }} />,
  translate_to_english: <TranslateIcon sx={{ fontSize: 18 }} />,
  terminal_assistant: <TerminalIcon sx={{ fontSize: 18 }} />,
}

function commandText(command: ShortcutCommand, field: 'name' | 'description', t: (key: TranslationKey) => string) {
  const defaultValue = field === 'name' ? defaultCommandNames[command.id] : defaultCommandDescriptions[command.id]
  const key = `shortcuts.command.${command.id}.${field}` as TranslationKey
  if (defaultValue && command[field] === defaultValue) return t(key)
  return command[field]
}

function createEmptyCustomCommand(): Partial<ShortcutCommand> {
  return {
    name: '',
    description: '',
    prompt: '',
    category: 'custom',
    kind: 'custom',
    action: 'custom-command',
    enabled: true,
    editable: true,
    deletable: true,
    shortcut: { accelerator: '', keys: [], display: '', fixed: false },
    delivery: 'paste',
  }
}

function normalizeKeyName(key: string) {
  if (key === ' ') return 'Space'
  if (key === 'Esc') return 'Escape'
  if (key.length === 1) return key.toUpperCase()
  return key
}

function shortcutFromKeyboardEvent(event: React.KeyboardEvent): ShortcutCommandShortcut {
  const key = normalizeKeyName(event.key)
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : '',
  ].filter(Boolean)
  const isModifierOnly = ['Control', 'Shift', 'Alt', 'Meta'].includes(key)
  const keys = isModifierOnly ? modifiers : [...modifiers, key].filter((item, index, values) => values.indexOf(item) === index)
  const display = keys.join(' + ')
  return {
    accelerator: display,
    keys,
    display,
    fixed: false,
  }
}

function statusLabel(status: ShortcutCommandRegistrationStatus[string] | undefined, t: (key: TranslationKey) => string) {
  const value = status?.status || 'unassigned'
  return t(`shortcuts.registration.${value}` as TranslationKey)
}

function ShortcutCommandDialog({
  command,
  onClose,
  onSave,
  onDelete,
}: {
  command: Partial<ShortcutCommand> | null
  onClose: () => void
  onSave: (command: Partial<ShortcutCommand>) => void
  onDelete: (id: string) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Partial<ShortcutCommand>>(command || createEmptyCustomCommand())
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    setDraft(command || createEmptyCustomCommand())
    setRecording(false)
  }, [command])

  if (!command) return null

  const isBuiltin = draft.kind === 'builtin'
  const canEditText = !isBuiltin
  const canEditShortcut = !draft.shortcut?.fixed
  const canDelete = Boolean(draft.id && draft.deletable)
  const shortcutDisplay = draft.shortcut?.display || t('shortcuts.shortcutUnset')

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{draft.id ? t('shortcuts.formTitleEdit') : t('shortcuts.formTitleNew')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {isBuiltin ? <Alert severity="info">{t('shortcuts.builtInLocked')}</Alert> : null}
        <TextField
          label={t('shortcuts.nameLabel')}
          value={draft.name || ''}
          disabled={!canEditText}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
        <TextField
          label={t('shortcuts.promptLabel')}
          value={draft.prompt || ''}
          disabled={!canEditText}
          multiline
          minRows={5}
          onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
        />
        <Box>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 0.75 }}>{t('shortcuts.shortcutLabel')}</Typography>
          <Button
            variant="outlined"
            disabled={!canEditShortcut}
            startIcon={<KeyboardIcon />}
            onClick={() => setRecording(true)}
            onKeyDown={(event) => {
              if (!recording) return
              event.preventDefault()
              event.stopPropagation()
              setDraft((current) => ({ ...current, shortcut: shortcutFromKeyboardEvent(event) }))
              setRecording(false)
            }}
            sx={{ justifyContent: 'flex-start', borderRadius: '8px', minWidth: 220 }}
          >
            {recording ? t('shortcuts.recordingShortcut') : shortcutDisplay}
          </Button>
        </Box>
        <TextField
          label={t('shortcuts.descriptionLabel')}
          value={draft.description || ''}
          disabled={!canEditText}
          multiline
          minRows={2}
          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {canDelete ? (
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => onDelete(String(draft.id))}>
            {t('shortcuts.delete')}
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('shortcuts.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!String(draft.name || '').trim() || (draft.action === 'custom-command' && !String(draft.prompt || '').trim())}
          onClick={() => onSave(draft)}
        >
          {t('shortcuts.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function CommandRow({
  command,
  status,
  onToggle,
  onEdit,
}: {
  command: ShortcutCommand
  status?: ShortcutCommandRegistrationStatus[string]
  onToggle: (command: ShortcutCommand) => void
  onEdit: (command: ShortcutCommand) => void
}) {
  const { t } = useI18n()
  const name = commandText(command, 'name', t)
  const description = commandText(command, 'description', t)
  const shortcut = command.shortcut?.display || t('shortcuts.shortcutUnset')

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto auto',
        alignItems: 'center',
        gap: 1.5,
        border: '1px solid rgba(119,119,119,0.10)',
        borderRadius: '8px',
        p: 1.5,
        bgcolor: '#fff',
      }}
    >
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '8px', bgcolor: 'rgba(119,119,119,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {commandIconById[command.id] || <KeyboardIcon sx={{ fontSize: 18 }} />}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{name}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {description}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
        <Chip size="small" label={shortcut} variant="outlined" />
        <Chip size="small" label={statusLabel(status, t)} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Switch checked={command.enabled} onChange={() => onToggle(command)} size="small" />
        <IconButton aria-label={`${t('shortcuts.edit')} ${name}`} onClick={() => onEdit(command)} size="small">
          <EditIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
    </Box>
  )
}

export default function Shortcuts() {
  const { t } = useI18n()
  const [commands, setCommands] = useState<ShortcutCommand[]>([])
  const [registrationStatus, setRegistrationStatus] = useState<ShortcutCommandRegistrationStatus>({})
  const [editingCommand, setEditingCommand] = useState<Partial<ShortcutCommand> | null>(null)

  const refresh = useCallback(async () => {
    const [nextCommands, nextStatus] = await Promise.all([
      listShortcutCommands(),
      getShortcutRegistrationStatus(),
    ])
    setCommands(nextCommands)
    setRegistrationStatus(nextStatus)
  }, [])

  useEffect(() => {
    void refresh()
    return subscribeShortcutCommandChanges(() => {
      void refresh()
    })
  }, [refresh])

  const commandsBySection = useMemo(() => ({
    default: commands.filter((command) => command.category === 'default'),
    recommended: commands.filter((command) => command.category === 'recommended'),
    custom: commands.filter((command) => command.category === 'custom'),
  }), [commands])

  const handleToggle = async (command: ShortcutCommand) => {
    await saveShortcutCommand({ id: command.id, enabled: !command.enabled })
    await refresh()
  }

  const handleSave = async (command: Partial<ShortcutCommand>) => {
    await saveShortcutCommand(command)
    setEditingCommand(null)
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await deleteShortcutCommand(id)
    setEditingCommand(null)
    await refresh()
  }

  const renderSection = (title: string, items: ShortcutCommand[], emptyText = '') => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.secondary' }}>{title}</Typography>
      {items.length ? items.map((command) => (
        <CommandRow
          key={command.id}
          command={command}
          status={registrationStatus[command.id]}
          onToggle={handleToggle}
          onEdit={setEditingCommand}
        />
      )) : (
        <Box sx={{ border: '1px dashed rgba(119,119,119,0.20)', borderRadius: '8px', p: 2 }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{emptyText}</Typography>
        </Box>
      )}
    </Box>
  )

  return (
    <Box sx={{ ...pageSx, maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography sx={pageTitleSx}>{t('shortcuts.title')}</Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>{t('shortcuts.subtitle')}</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditingCommand(createEmptyCustomCommand())}>
          {t('shortcuts.addCommand')}
        </Button>
      </Box>

      {renderSection(t('shortcuts.defaultSection'), commandsBySection.default)}
      {renderSection(t('shortcuts.recommendedSection'), commandsBySection.recommended)}
      {renderSection(t('shortcuts.customSection'), commandsBySection.custom, t('shortcuts.emptyCustom'))}

      <ShortcutCommandDialog
        command={editingCommand}
        onClose={() => setEditingCommand(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </Box>
  )
}
