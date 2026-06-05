import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, IconButton, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import DeleteIcon from '@mui/icons-material/Delete'
import EventIcon from '@mui/icons-material/Event'
import FileUploadIcon from '@mui/icons-material/FileUpload'
import MicIcon from '@mui/icons-material/Mic'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import SaveIcon from '@mui/icons-material/Save'
import StopIcon from '@mui/icons-material/Stop'
import { useI18n, type TranslationKey } from '../i18n'
import { pageSx, pageTitleSx } from '../uiTokens'
import {
  createDraftMeetingNote,
  deleteMeetingNote,
  importMeetingMediaFile,
  listMeetingNotes,
  saveMeetingNote,
  subscribeMeetingNoteChanges,
  type MeetingNote,
} from '../services/meetingNotesStore'
import { getVoiceSession, subscribeVoiceSession, toggleMeetingNotesRecording } from '../services/recorder'

function formatDate(value: string, language: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(language)
}

function importErrorText(detail: string, t: (key: TranslationKey) => string) {
  if (detail === 'unsupported_media_type') return t('meeting.importUnsupported')
  if (detail === 'media_file_too_large') return t('meeting.importTooLarge')
  return detail || t('meeting.importFailed')
}

function noteMatches(note: MeetingNote, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return [note.title, note.transcript, note.summary].some((value) => value.toLowerCase().includes(keyword))
}

export default function MeetingNotes() {
  const { language, t } = useI18n()
  const [notes, setNotes] = useState<MeetingNote[]>([])
  const [query, setQuery] = useState('')
  const [activeNote, setActiveNote] = useState<Partial<MeetingNote> | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [voiceSession, setVoiceSession] = useState(getVoiceSession())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const activeNoteRef = useRef<Partial<MeetingNote> | null>(activeNote)

  const refreshNotes = useCallback(() => {
    listMeetingNotes().then(setNotes).catch(() => setNotes([]))
  }, [])

  useEffect(() => {
    refreshNotes()
    return subscribeMeetingNoteChanges(() => refreshNotes())
  }, [refreshNotes])

  useEffect(() => {
    activeNoteRef.current = activeNote
  }, [activeNote])

  useEffect(() => {
    return subscribeVoiceSession((session) => {
      setVoiceSession(session)
      if (session.mode !== 'MeetingNotes') return
      const note = activeNoteRef.current
      if (!note) return

      if (session.status === 'recording' || session.status === 'connecting') {
        setActiveNote((current) => current ? { ...current, source: 'recording', status: 'recording', transcript: session.rawText } : current)
        return
      }

      if (session.status === 'transcribing' || session.status === 'stopping') {
        setActiveNote((current) => current ? { ...current, source: 'recording', status: 'processing', transcript: session.rawText } : current)
        return
      }

      if (session.status === 'completed') {
        const nextNote = {
          ...note,
          source: 'recording' as const,
          status: 'completed' as const,
          transcript: session.rawText,
          summary: session.refinedText,
          durationMs: session.durationMs,
        }
        setActiveNote(nextNote)
        void saveMeetingNote(nextNote).then((saved) => {
          if (saved) setActiveNote(saved)
          refreshNotes()
        })
        return
      }

      if (session.status === 'error') {
        const nextNote = {
          ...note,
          source: 'recording' as const,
          status: 'error' as const,
          transcript: session.rawText,
          summary: session.refinedText,
          error: session.error?.message || '',
        }
        setActiveNote(nextNote)
        void saveMeetingNote(nextNote).then((saved) => {
          if (saved) setActiveNote(saved)
          refreshNotes()
        })
      }
    })
  }, [refreshNotes])

  const visibleNotes = notes.filter((note) => noteMatches(note, query))
  const isRecording = voiceSession.mode === 'MeetingNotes' && voiceSession.status === 'recording'

  const handleNewNote = () => {
    setMessage('')
    setActiveNote(createDraftMeetingNote())
  }

  const handleSave = async () => {
    if (!activeNote) return
    setBusy(true)
    const saved = await saveMeetingNote(activeNote)
    if (saved) {
      setActiveNote(saved)
      refreshNotes()
    }
    setBusy(false)
  }

  const ensureActiveSavedNote = async () => {
    if (activeNote?.id) return activeNote
    const saved = await saveMeetingNote(activeNote || createDraftMeetingNote())
    if (saved) setActiveNote(saved)
    return saved
  }

  const handleToggleRecording = async () => {
    setMessage('')
    if (!isRecording) {
      const saved = await ensureActiveSavedNote()
      if (!saved) return
      const recordingNote = { ...saved, source: 'recording' as const, status: 'recording' as const }
      activeNoteRef.current = recordingNote
      setActiveNote(recordingNote)
    }
    await toggleMeetingNotesRecording()
  }

  const handleDelete = async () => {
    if (!activeNote?.id) {
      setActiveNote(null)
      return
    }
    await deleteMeetingNote(activeNote.id)
    setActiveNote(null)
    refreshNotes()
  }

  const handleImportFile = async (file: File) => {
    setMessage('')
    setBusy(true)
    const saved = await saveMeetingNote({
      ...(activeNote || createDraftMeetingNote()),
      source: 'import',
      status: 'processing',
      importFile: { name: file.name, size: file.size, type: file.type },
    })
    if (saved) setActiveNote(saved)

    const result = await importMeetingMediaFile(file)
    const nextNote = {
      ...(saved || activeNote || createDraftMeetingNote()),
      source: 'import' as const,
      status: result.success ? 'completed' as const : 'error' as const,
      transcript: result.transcript,
      summary: result.summary,
      error: result.success ? '' : importErrorText(result.detail, t),
      importFile: { name: file.name, size: file.size, type: file.type },
    }
    const finalNote = await saveMeetingNote(nextNote)
    if (finalNote) setActiveNote(finalNote)
    setMessage(result.success ? '' : importErrorText(result.detail, t))
    refreshNotes()
    setBusy(false)
  }

  return (
    <Box sx={{ ...pageSx, maxWidth: 1080, display: 'flex', flexDirection: 'column', gap: 2.5, minHeight: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography sx={pageTitleSx}>{t('meeting.title')}</Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>{t('meeting.subtitle')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button startIcon={<NoteAddIcon />} variant="contained" onClick={handleNewNote}>{t('meeting.newNote')}</Button>
          <Button startIcon={<FileUploadIcon />} variant="outlined" onClick={() => fileInputRef.current?.click()}>{t('meeting.importFile')}</Button>
        </Box>
      </Box>

      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept=".m4a,.mp3,.mp4,.wav,.ogg,.flac,.mov,.avi,.mkv,.webm,.opus,audio/*,video/*"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleImportFile(file)
        }}
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '340px minmax(0,1fr)' }, gap: 2, minHeight: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
          <TextField
            size="small"
            placeholder={t('meeting.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <Button startIcon={<MicIcon />} variant="outlined" onClick={handleToggleRecording}>
              {isRecording ? t('meeting.stopRecording') : t('meeting.liveNote')}
            </Button>
            <Button startIcon={<EventIcon />} variant="outlined" disabled>{t('meeting.localOnly')}</Button>
          </Box>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('meeting.calendarPlaceholder')}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'auto', minHeight: 0 }}>
            {visibleNotes.length ? visibleNotes.map((note) => (
              <Box
                key={note.id}
                onClick={() => {
                  setMessage('')
                  setActiveNote(note)
                }}
                sx={{
                  border: activeNote?.id === note.id ? '1px solid rgba(17,17,17,0.35)' : '1px solid rgba(119,119,119,0.10)',
                  borderRadius: '8px',
                  p: 1.5,
                  bgcolor: '#fff',
                  cursor: 'pointer',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.title}</Typography>
                  <Chip size="small" label={t(`meeting.status.${note.status}` as TranslationKey)} />
                </Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>{formatDate(note.updatedAt, language)}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {note.summary || note.transcript || '-'}
                </Typography>
              </Box>
            )) : (
              <Box sx={{ border: '1px dashed rgba(119,119,119,0.20)', borderRadius: '8px', p: 3, textAlign: 'center' }}>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{t('meeting.empty')}</Typography>
              </Box>
            )}
          </Box>
        </Box>

        <Box sx={{ border: '1px solid rgba(119,119,119,0.10)', borderRadius: '8px', bgcolor: '#fff', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
          {activeNote ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconButton size="small" onClick={() => setActiveNote(null)} aria-label={t('meeting.back')}>
                  <ArrowBackIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <TextField
                  size="small"
                  placeholder={t('meeting.titlePlaceholder')}
                  value={activeNote.title || ''}
                  onChange={(event) => setActiveNote((current) => current ? { ...current, title: event.target.value } : current)}
                  sx={{ flex: 1 }}
                />
                <Chip size="small" label={t(`meeting.status.${activeNote.status || 'draft'}` as TranslationKey)} />
              </Box>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button startIcon={isRecording ? <StopIcon /> : <MicIcon />} variant="outlined" onClick={handleToggleRecording} disabled={busy}>
                  {isRecording ? t('meeting.stopRecording') : t('meeting.startRecording')}
                </Button>
                <Button startIcon={<FileUploadIcon />} variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={busy}>{t('meeting.importFile')}</Button>
                <Button startIcon={<SaveIcon />} variant="contained" onClick={handleSave} disabled={busy}>{t('meeting.save')}</Button>
                <Button startIcon={<DeleteIcon />} color="error" onClick={handleDelete}>{t('meeting.delete')}</Button>
              </Box>

              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('meeting.importHint')}</Typography>
              {message || activeNote.error ? <Typography sx={{ fontSize: 13, color: 'error.main' }}>{message || activeNote.error}</Typography> : null}

              <TextField
                label={t('meeting.transcript')}
                value={activeNote.transcript || ''}
                onChange={(event) => setActiveNote((current) => current ? { ...current, transcript: event.target.value } : current)}
                multiline
                minRows={8}
                sx={{ flex: 1 }}
              />
              <TextField
                label={t('meeting.summary')}
                value={activeNote.summary || ''}
                onChange={(event) => setActiveNote((current) => current ? { ...current, summary: event.target.value } : current)}
                multiline
                minRows={5}
              />
            </>
          ) : (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <Box>
                <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{t('meeting.newNote')}</Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.75 }}>{t('meeting.importHint')}</Typography>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}
