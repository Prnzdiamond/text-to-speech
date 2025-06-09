<script setup>
import { ref, onMounted, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useNuxtApp, useRouter, useFetch } from 'nuxt/app'
import { 
  getAllVoices,
  generateSpeechForChunks, 
  splitTextIntoChunks,
  getAvailableLanguages,
  AudioQueueManager,
  TTS_ENGINES,
  getCacheStats,
  clearOldCache,
  audioCache,
  clearLocalCacheOnly
} from '~/services/tts-service'

const route = useRoute()
const router = useRouter()
const { $supabase } = useNuxtApp()

// State
const user = ref(null)
const textContent = ref('')
const documentName = ref('')
const documentId = ref(null)
const availableVoices = ref([])
const selectedVoice = ref(null)
const speechRate = ref(1.0)
const isPlaying = ref(false)
const isPaused = ref(false)
const uploadStatus = ref(null)
const saveMessage = ref(null)
const isSaving = ref(false)
const stats = ref({ wordCount: 0, charCount: 0, readingTime: '0 min' })
const currentStoragePath = ref(null)
const isLoadingVoices = ref(true)
const selectedLanguage = ref('en')
const availableLanguages = ref([])
const filteredVoices = ref([])
const isGeneratingSpeech = ref(false)
const currentSpeaker = ref(null)
const availableSpeakers = ref([])
const highlightedText = ref('')
const currentChunkIndex = ref(0)
const textChunks = ref([])
const focusMode = ref(false)
const readingProgress = ref(0)
const isCompleted = ref(false)
const lastReadPosition = ref(0)
const isEngineChanging = ref(false)
const audioUrls = ref([])
const currentAudioSettings = ref(null)
const hasGeneratedAudio = ref(false)
const audioManager = ref(new AudioQueueManager())
const generationProgress = ref({ current: 0, total: 0 })
const playbackProgress = ref({ current: 0, total: 0 })
const chunkSize = ref(500)
const selectedEngine = ref(TTS_ENGINES.WEB_SPEECH)
const engineOptions = [
  { value: TTS_ENGINES.WEB_SPEECH, label: 'Web Speech API (Fast)', icon: '⚡' },
  { value: TTS_ENGINES.OPEN_TTS, label: 'OpenTTS (High Quality)', icon: '🎯' }
]
const cacheStats = ref({ totalEntries: 0, totalSizeMB: '0', memoryEntries: 0 })
const userPreferences = ref({
  theme: 'light',
  font_size: 'medium',
  speech_rate: 1.0,
  voice_name: '',
  selected_engine: 'web-speech',
  selected_language: 'en',
  chunk_size: 500,
  focus_mode_enabled: false,
  auto_save_enabled: true,
  speaker_name: null
})

// NEW: Audio settings change detection
const showSettingsChangeModal = ref(false)
const pendingAudioSave = ref(null)
const savedAudioSettings = ref(null)
const initialLoadComplete = ref(false)

// Computed
const getPlaybackStatus = computed(() => {
  if (isPlaying.value) return 'Playing'
  if (isPaused.value) return 'Paused'
  return 'Stopped'
})

const getStatusColor = computed(() => {
  if (isPlaying.value) return 'text-green-600'
  if (isPaused.value) return 'text-yellow-600'
  return 'text-gray-600'
})

const getGenerationProgress = computed(() => {
  if (generationProgress.value.total === 0) return 0
  return Math.round((generationProgress.value.current / generationProgress.value.total) * 100)
})

const getPlaybackProgress = computed(() => {
  if (playbackProgress.value.total === 0) return 0
  return Math.round((playbackProgress.value.current / playbackProgress.value.total) * 100)
})

const currentEngine = computed(() => {
  if (!selectedVoice.value) return null
  return selectedVoice.value.engine
})

const isWebSpeechEngine = computed(() => {
  return currentEngine.value === TTS_ENGINES.WEB_SPEECH
})

const displayText = computed(() => {
  if (!textContent.value || !focusMode.value || textChunks.value.length === 0) {
    return textContent.value
  }
  
  const currentChunk = textChunks.value[currentChunkIndex.value] || ''
  const prevChunk = currentChunkIndex.value > 0 ? textChunks.value[currentChunkIndex.value - 1] : ''
  const nextChunk = currentChunkIndex.value < textChunks.value.length - 1 ? textChunks.value[currentChunkIndex.value + 1] : ''
  
  return `${prevChunk ? '...' + prevChunk.slice(-50) : ''}${currentChunk}${nextChunk ? nextChunk.slice(0, 50) + '...' : ''}`
})

// Navigation status
const canGoForward = computed(() => {
  return currentChunkIndex.value < textChunks.value.length - 1
})

const canGoBackward = computed(() => {
  return currentChunkIndex.value > 0
})

// Play/Pause button text
const playPauseButtonText = computed(() => {
  if (isGeneratingSpeech.value) return 'Generating...'
  if (isPlaying.value) return '⏸️ Pause'
  if (isPaused.value) return '▶️ Resume'
  return hasGeneratedAudio.value ? '▶️ Play' : '▶️ Generate & Play'
})

// Modified: Check if current audio settings differ from saved settings
// But only after initial document load is complete
const hasAudioSettingsChanged = computed(() => {
  if (!savedAudioSettings.value || !selectedVoice.value || !initialLoadComplete.value) return false
  
  const currentSettings = getCurrentAudioSettings()
  const saved = savedAudioSettings.value
  
  return (
    currentSettings.engine !== saved.engine ||
    currentSettings.voiceId !== saved.voiceId ||
    Math.abs(currentSettings.speed - saved.speed) >= 0.1 ||
    currentSettings.speaker !== saved.speaker ||
    currentSettings.chunkSize !== saved.chunkSize
  )
})

// NEW: Get current audio settings for comparison
const getCurrentAudioSettings = () => {
  if (!selectedVoice.value) return null
  
  return {
    engine: selectedVoice.value.engine,
    voiceId: selectedVoice.value.id,
    speed: parseFloat(speechRate.value),
    speaker: selectedVoice.value.multispeaker ? currentSpeaker.value : null,
    chunkSize: chunkSize.value
  }
}

// Methods
const getStatusClass = (type) => {
  const classes = {
    success: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    warning: 'bg-yellow-100 text-yellow-800'
  }
  return classes[type] || ''
}

const clearText = () => {
  stopText()
  textContent.value = ''
  documentName.value = ''
  documentId.value = null
  currentStoragePath.value = null
  highlightedText.value = ''
  textChunks.value = []
  currentChunkIndex.value = 0
  readingProgress.value = 0
  isCompleted.value = false
  lastReadPosition.value = 0
  hasGeneratedAudio.value = false
  audioUrls.value = []
  currentAudioSettings.value = null
  savedAudioSettings.value = null
  audioManager.value.cleanup()
  updateStats()
  uploadStatus.value = { type: 'info', message: 'Text cleared successfully!' }
  setTimeout(() => { uploadStatus.value = null }, 2000)
}

const handleEngineSwitch = async () => {
  if (isEngineChanging.value) return
  
  isEngineChanging.value = true
  stopText()
  audioManager.value.cleanup()
  audioManager.value = new AudioQueueManager()
  
  hasGeneratedAudio.value = false
  audioUrls.value = []
  currentAudioSettings.value = null
  
  const engineVoices = filteredVoices.value.filter(v => v.engine === selectedEngine.value)
  if (engineVoices.length > 0) {
    selectedVoice.value = engineVoices[0]
  }
  
  uploadStatus.value = { 
    type: 'info', 
    message: `Switched to ${selectedEngine.value === TTS_ENGINES.WEB_SPEECH ? 'Web Speech API' : 'OpenTTS'}. Audio will be regenerated on next play.` 
  }
  
  setTimeout(() => { 
    uploadStatus.value = null
    isEngineChanging.value = false
  }, 3000)
}

const loadAllVoices = async () => {
  isLoadingVoices.value = true
  try {
    if ('speechSynthesis' in window) {
      await new Promise((resolve) => {
        const voices = window.speechSynthesis.getVoices()
        if (voices.length > 0) {
          resolve()
        } else {
          window.speechSynthesis.onvoiceschanged = resolve
        }
      })
    }

    const voices = await getAllVoices()
    availableVoices.value = voices
    availableLanguages.value = getAvailableLanguages(voices)
    
    filterVoicesByLanguage()
    
    if (filteredVoices.value.length > 0 && !selectedVoice.value) {
      const webSpeechVoices = filteredVoices.value.filter(v => v.engine === TTS_ENGINES.WEB_SPEECH)
      const openTTSVoices = filteredVoices.value.filter(v => v.engine === TTS_ENGINES.OPEN_TTS)
      
      if (selectedEngine.value === TTS_ENGINES.WEB_SPEECH && webSpeechVoices.length > 0) {
        selectedVoice.value = webSpeechVoices[0]
      } else if (selectedEngine.value === TTS_ENGINES.OPEN_TTS && openTTSVoices.length > 0) {
        const preferredEngines = ['coqui-tts', 'glow-speak', 'larynx']
        const preferredVoice = openTTSVoices.find(v => preferredEngines.includes(v.ttsEngine))
        selectedVoice.value = preferredVoice || openTTSVoices[0]
      } else {
        selectedVoice.value = filteredVoices.value[0]
      }
      
      updateAvailableSpeakers()
    }
  } catch (error) {
    console.error('Failed to load voices:', error)
    uploadStatus.value = { 
      type: 'error', 
      message: 'Failed to load voices. Please refresh the page.' 
    }
  } finally {
    isLoadingVoices.value = false
  }
}

const filterVoicesByLanguage = () => {
  filteredVoices.value = availableVoices.value.filter(voice => 
    voice.language === selectedLanguage.value
  )
}

const updateAvailableSpeakers = () => {
  availableSpeakers.value = []
  currentSpeaker.value = null
  
  if (selectedVoice.value?.multispeaker && selectedVoice.value?.speakers) {
    const speakers = selectedVoice.value.speakers
    availableSpeakers.value = Object.entries(speakers).map(([name, id]) => ({
      name: name.trim(),
      id
    })).filter(speaker => speaker.name !== 'ED')
    
    if (availableSpeakers.value.length > 0) {
      currentSpeaker.value = availableSpeakers.value[0].name
    }
  }
}

const updateCacheStats = async () => {
  try {
    cacheStats.value = await getCacheStats()
  } catch (error) {
    console.error('Failed to get cache stats:', error)
  }
}

// MODIFIED: Clear only local cache, not database audio
const clearCache = async () => {
  try {
    await clearLocalCacheOnly()
    await updateCacheStats()
    uploadStatus.value = { 
      type: 'success', 
      message: 'Local audio cache cleared successfully! Database audio preserved.' 
    }
    setTimeout(() => { uploadStatus.value = null }, 3000)
  } catch (error) {
    console.error('Failed to clear cache:', error)
    uploadStatus.value = { 
      type: 'error', 
      message: 'Failed to clear cache.' 
    }
  }
}

const saveFileToStorage = async (file) => {
  if (!$supabase || !user.value) return null
  
  try {
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`
    const filePath = `${user.value.id}/${fileName}`
    
    const { data, error } = await $supabase.storage
      .from('documents')
      .upload(filePath, file)
    
    if (error) {
      console.error('Storage upload error:', error)
      return null
    }
    
    return filePath
  } catch (error) {
    console.error('Error saving file to storage:', error)
    return null
  }
}

const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return
  
  console.log("Starting file upload for:", file.name)
  
  const allowedTypes = ['.pdf', '.docx', '.txt']
  const fileExtension = '.' + file.name.split('.').pop().toLowerCase()
  
  if (!allowedTypes.includes(fileExtension)) {
    uploadStatus.value = { type: 'error', message: 'Please upload a PDF, DOCX, or TXT file only.' }
    event.target.value = ''
    return
  }
  
  if (file.size > 10 * 1024 * 1024) {
    uploadStatus.value = { type: 'error', message: 'File size must be less than 10MB.' }
    event.target.value = ''
    return
  }
  
  uploadStatus.value = { type: 'info', message: `Processing ${file.name}...` }
  
  try {
    const formData = new FormData()
    formData.append('file', file)
    
    const { data: response } = await useFetch('/api/process-file', {
      method: 'POST',
      body: formData,
      timeout: 30000,
    })
    
    if (response.value.success) {
      textContent.value = response.value.text
      updateStats()
      documentName.value = file.name.split('.')[0]
      documentId.value = null
      
      let storagePath = null
      if ($supabase && user.value) {
        uploadStatus.value = { type: 'info', message: 'Saving file to storage...' }
        storagePath = await saveFileToStorage(file)
      }
      
      if (storagePath) {
        currentStoragePath.value = storagePath
      }

      uploadStatus.value = { 
        type: 'success', 
        message: `File processed successfully! Extracted ${response.value.text.length} characters.${storagePath ? ' File saved to storage.' : ''}` 
      }
    } else {
      uploadStatus.value = { type: 'error', message: response.value.error || 'Failed to process file' }
    }
  } catch (error) {
    console.error("Upload error:", error)
    uploadStatus.value = { type: 'error', message: `Upload failed: ${error.message}` }
  }
  
  event.target.value = ''
  setTimeout(() => { uploadStatus.value = null }, 8000)
}

const handleFileDrop = (event) => {
  const files = event.dataTransfer.files
  if (files.length > 0) {
    handleFileUpload({ target: { files: files, value: '' } })
  }
}

const updateStats = () => {
  const text = textContent.value.trim()
  const words = text ? text.split(/\s+/).length : 0
  const chars = text.length
  const readingTime = Math.ceil(words / 200)
  
  stats.value = {
    wordCount: words,
    charCount: chars,
    readingTime: readingTime === 0 ? '0 min' : `${readingTime} min`
  }
}

const highlightCurrentChunk = () => {
  if (textChunks.value.length === 0 || currentChunkIndex.value >= textChunks.value.length) return
  
  const currentChunk = textChunks.value[currentChunkIndex.value]
  highlightedText.value = currentChunk
  
  if (textContent.value && currentChunk) {
    readingProgress.value = Math.round(((currentChunkIndex.value + 1) / textChunks.value.length) * 100)
    
    if (currentChunkIndex.value === textChunks.value.length - 1) {
      isCompleted.value = true
    }
    
    lastReadPosition.value = currentChunkIndex.value
    saveReadingProgress()
  }
}

const highlightAndScrollToChunk = async () => {
  if (textChunks.value.length === 0 || currentChunkIndex.value >= textChunks.value.length) return
  
  const currentChunk = textChunks.value[currentChunkIndex.value]
  if (!currentChunk || !textContent.value) return
  
  highlightedText.value = currentChunk
  
  if (focusMode.value) {
    highlightCurrentChunk()
    return
  }
  
  await nextTick()
  
  const textarea = document.querySelector('textarea')
  if (!textarea) return
  
  const chunkStart = textContent.value.indexOf(currentChunk)
  if (chunkStart >= 0) {
    textarea.setSelectionRange(chunkStart, chunkStart + currentChunk.length)
    
    const textareaHeight = textarea.clientHeight
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20
    const linesInTextarea = textareaHeight / lineHeight
    
    const textBefore = textContent.value.substring(0, chunkStart)
    const linesBefore = (textBefore.match(/\n/g) || []).length
    
    const scrollPosition = Math.max(0, (linesBefore - Math.floor(linesInTextarea / 2)) * lineHeight)
    textarea.scrollTop = scrollPosition
    
    highlightCurrentChunk()
  }
}

const saveReadingProgress = async () => {
  if (!$supabase || !user.value || !documentId.value) return
  
  try {
    await $supabase
      .from('reading_history')
      .update({
        last_read_position: lastReadPosition.value,
        reading_progress: readingProgress.value,
        is_completed: isCompleted.value,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId.value)
      .eq('user_id', user.value.id)
  } catch (error) {
    console.error('Error saving reading progress:', error)
  }
}

// MODIFIED: Enhanced audio saving with better error handling
const saveAudioToDatabase = async (audioBlobs, settings) => {
  if (!$supabase || !user.value || !documentId.value) {
    console.log('Cannot save audio: missing requirements', {
      hasSupabase: !!$supabase,
      hasUser: !!user.value,
      hasDocumentId: !!documentId.value
    })
    return false
  }
  
  try {
    console.log('Starting audio save process:', {
      userId: user.value.id,
      documentId: documentId.value,
      audioCount: audioBlobs.length,
      settings
    })
    
    const audioFilePaths = []
    
    for (let i = 0; i < audioBlobs.length; i++) {
      const blob = audioBlobs[i]
      const metadata = {
        engine: settings.engine,
        voiceId: settings.voiceId,
        textHash: settings.textHash,
        chunkIndex: i
      }
      
      console.log(`Saving audio chunk ${i + 1}/${audioBlobs.length}`)
      
      const result = await audioCache.saveAudioToSupabase(blob, metadata, $supabase, user.value.id, documentId.value)
      if (result && result.success) {
        audioFilePaths.push(result.path)
        console.log(`Chunk ${i + 1} saved successfully:`, result.path)
      } else {
        console.error(`Failed to save chunk ${i + 1}`)
        // Don't return early, continue with other chunks
      }
    }
    
    if (audioFilePaths.length > 0) {
      console.log('Updating database with audio file paths:', audioFilePaths.length)
      
      // Create a clean settings object for comparison
      const cleanSettings = {
        engine: settings.engine,
        voiceId: settings.voiceId,
        speed: settings.speed,
        speaker: settings.speaker || null,
        chunkSize: settings.chunkSize
      }
      
      const { error } = await $supabase
        .from('reading_history')
        .update({
          audio_file_paths: audioFilePaths,
          audio_chunk_count: audioFilePaths.length,
          audio_settings: cleanSettings,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId.value)
        .eq('user_id', user.value.id)
        
      if (error) {
        console.error('Database update error:', error)
        throw error
      }
      
      // Update saved settings for comparison
      savedAudioSettings.value = cleanSettings
        
      console.log('Audio file paths saved to database successfully:', audioFilePaths.length)
      return true
    } else {
      console.error('No audio file paths to save')
      return false
    }
      
  } catch (error) {
    console.error('Error saving audio to database:', error)
    return false
  }
}

const loadAudioFromDatabase = async () => {
  if (!$supabase || !user.value || !documentId.value) {
    console.log('Cannot load audio: missing requirements')
    return false
  }
  
  try {
    console.log('Loading audio from database for document:', documentId.value)
    
    const { data, error } = await $supabase
      .from('reading_history')
      .select('audio_file_paths, audio_settings, audio_chunk_count')
      .eq('id', documentId.value)
      .eq('user_id', user.value.id)
      .single()
    
    if (error) {
      console.error('Database query error:', error)
      return false
    }
    
    if (!data?.audio_file_paths || !data?.audio_settings || data.audio_file_paths.length === 0) {
      console.log('No audio data found in database')
      return false
    }
    
    console.log('Found audio data:', {
      pathCount: data.audio_file_paths.length,
      chunkCount: data.audio_chunk_count,
      settings: data.audio_settings
    })
    
    // Store saved settings for comparison
    savedAudioSettings.value = data.audio_settings
    
    // NEW: Adopt the saved settings instead of comparing them
    const savedSettings = data.audio_settings
    
    // Apply the saved settings to the current UI
    console.log('Adopting saved audio settings:', savedSettings)
    
    // Set the engine
    selectedEngine.value = savedSettings.engine
    
    // Find and set the voice
    const matchingVoice = availableVoices.value.find(v => 
      v.id === savedSettings.voiceId && v.engine === savedSettings.engine
    )
    
    if (matchingVoice) {
      selectedVoice.value = matchingVoice
      
      // Set speaker if applicable
      if (savedSettings.speaker && matchingVoice.multispeaker) {
        currentSpeaker.value = savedSettings.speaker
      }
    }
    
    // Set the speech rate
    speechRate.value = savedSettings.speed
    
    // Set chunk size
    chunkSize.value = savedSettings.chunkSize
    
    console.log('Settings adopted from saved audio')
    
    // Now load the audio blobs
    console.log('Loading audio blobs...')
    
    const audioBlobs = []
    for (let i = 0; i < data.audio_file_paths.length; i++) {
      const filePath = data.audio_file_paths[i]
      console.log(`Loading audio chunk ${i + 1}/${data.audio_file_paths.length} from:`, filePath)
      
      const blob = await audioCache.loadAudioFromSupabase(filePath, $supabase)
      if (blob) {
        audioBlobs.push(blob)
        console.log(`Chunk ${i + 1} loaded successfully, size:`, blob.size)
      } else {
        console.error(`Failed to load chunk ${i + 1}`)
        return false // If any audio fails to load, regenerate all
      }
    }
    
    console.log('All audio chunks loaded successfully, setting up audio manager')
    
    audioManager.value.cleanup()
    audioManager.value = new AudioQueueManager()
    setupAudioManagerCallbacks()
    
    audioManager.value.loadAudioQueue(audioBlobs, savedSettings.engine, textChunks.value, savedSettings.voiceId, savedSettings.speed)
    
    hasGeneratedAudio.value = true
    currentAudioSettings.value = savedSettings
    
    console.log('Audio loaded from database successfully')
    return true
  } catch (error) {
    console.error('Error loading audio from database:', error)
    return false
  }
}

const setupAudioManagerCallbacks = () => {
  audioManager.value.onPlaybackStart = () => {
    isPlaying.value = true
    isPaused.value = false
    uploadStatus.value = null
  }
  
  audioManager.value.onPlaybackEnd = () => {
    isPlaying.value = false
    isPaused.value = false
    playbackProgress.value = { current: 0, total: 0 }
    highlightedText.value = ''
  }
  
  audioManager.value.onChunkChange = (current, total) => {
    playbackProgress.value = { current: current + 1, total }
    currentChunkIndex.value = current
    highlightAndScrollToChunk()
  }
}

const togglePlayPause = async () => {
  if (isGeneratingSpeech.value || audioManager.value.getGenerationStatus()) {
    return
  }
  
  if (isPlaying.value) {
    // Currently playing, so pause
    audioManager.value.pause()
    isPlaying.value = false
    isPaused.value = true
  } else if (isPaused.value) {
    // Currently paused, so resume
    audioManager.value.resume()
    isPlaying.value = true
    isPaused.value = false
  } else {
    // Not playing or paused, so start playing
    await playText()
  }
}

const playText = async () => {
  if (!textContent.value.trim() || !selectedVoice.value) return
  
  if (isGeneratingSpeech.value || audioManager.value.getGenerationStatus()) {
    return
  }
  
  const engine = selectedVoice.value.engine
  const currentSettings = {
    engine,
    voiceId: selectedVoice.value.id,
    speed: parseFloat(speechRate.value),
    speaker: selectedVoice.value.multispeaker ? currentSpeaker.value : null,
    chunkSize: chunkSize.value
  }
  
  const needsRegeneration = !hasGeneratedAudio.value || 
    !currentAudioSettings.value ||
    currentSettings.engine !== currentAudioSettings.value.engine ||
    currentSettings.voiceId !== currentAudioSettings.value.voiceId ||
    Math.abs(currentSettings.speed - currentAudioSettings.value.speed) >= 0.1 ||
    currentSettings.speaker !== currentAudioSettings.value.speaker ||
    currentSettings.chunkSize !== currentAudioSettings.value.chunkSize
  
  if (needsRegeneration) {
    stopText()
    
    isGeneratingSpeech.value = true
    audioManager.value.setGenerationStatus(true)
    generationProgress.value = { current: 0, total: 0 }
    
    try {
      textChunks.value = splitTextIntoChunks(textContent.value.trim(), chunkSize.value, engine)
      
      const engineLabel = engine === TTS_ENGINES.WEB_SPEECH ? 'Web Speech API' : 'OpenTTS'
      uploadStatus.value = { 
        type: 'info', 
        message: `Generating speech using ${engineLabel} (${textChunks.value.length} chunks)...` 
      }
      
      const audioBlobs = await generateSpeechForChunks(
        textChunks.value,
        selectedVoice.value.id,
        parseFloat(speechRate.value),
        selectedVoice.value.multispeaker ? currentSpeaker.value : null,
        (current, total) => {
          generationProgress.value = { current, total }
        }
      )
      
      // NEW: Save audio immediately after generation if document exists
      if ($supabase && user.value && documentId.value) {
        const audioSaved = await saveAudioToDatabase(audioBlobs, currentSettings)
        if (audioSaved) {
          console.log('Audio automatically saved to database after generation')
        }
      } else {
        // Store for later saving when document is saved
        pendingAudioSave.value = { audioBlobs, settings: currentSettings }
        console.log('Audio generation complete, will save when document is saved')
      }
      
      audioManager.value.cleanup()
      audioManager.value = new AudioQueueManager()
      setupAudioManagerCallbacks()
      
      audioManager.value.loadAudioQueue(audioBlobs, engine, textChunks.value, selectedVoice.value.id, parseFloat(speechRate.value))
      
      hasGeneratedAudio.value = true
      currentAudioSettings.value = currentSettings
      
      await updateCacheStats()
      
    } catch (error) {
      console.error('Error generating speech:', error)
      uploadStatus.value = { 
        type: 'error', 
        message: `Failed to generate speech: ${error.message}` 
      }
      setTimeout(() => { uploadStatus.value = null }, 5000)
      return
    } finally {
      isGeneratingSpeech.value = false
      audioManager.value.setGenerationStatus(false)
      generationProgress.value = { current: 0, total: 0 }
    }
  }
  
  if (lastReadPosition.value > 0 && lastReadPosition.value < textChunks.value.length) {
    audioManager.value.seekToChunk(lastReadPosition.value)
  }
  
  await audioManager.value.play()
}

const stopText = () => {
  audioManager.value.stop()
  isPlaying.value = false
  isPaused.value = false
  playbackProgress.value = { current: 0, total: 0 }
  highlightedText.value = ''
}

const nextChunk = () => {
  if (!hasGeneratedAudio.value) return false
  
  const wasPlaying = isPlaying.value
  
  if (audioManager.value.next()) {
    if (!wasPlaying && isPaused.value) {
      setTimeout(() => {
        audioManager.value.pause()
        isPlaying.value = false
        isPaused.value = true
      }, 100)
    }
    return true
  }
  return false
}

const previousChunk = () => {
  if (!hasGeneratedAudio.value) return false
  
  const wasPlaying = isPlaying.value
  
  if (audioManager.value.previous()) {
    if (!wasPlaying && isPaused.value) {
      setTimeout(() => {
        audioManager.value.pause()
        isPlaying.value = false
        isPaused.value = true
      }, 100)
    }
    return true
  }
  return false
}

const loadUserPreferences = async () => {
  if (!$supabase || !user.value) return
  
  try {
    const { data, error } = await $supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.value.id)
      .single()
    
    if (error && error.code !== 'PGRST116') {
      throw error
    }
    
    if (data) {
      userPreferences.value = { ...userPreferences.value, ...data }
      
      speechRate.value = data.speech_rate || 1.0
      selectedEngine.value = data.selected_engine || TTS_ENGINES.WEB_SPEECH
      selectedLanguage.value = data.selected_language || 'en'
      chunkSize.value = data.chunk_size || 500
      focusMode.value = data.focus_mode_enabled || false
      
      if (data.voice_name && availableVoices.value.length > 0) {
        const voice = availableVoices.value.find(v => v.name === data.voice_name)
        if (voice) {
          selectedVoice.value = voice
        }
      }
      
      if (data.speaker_name) {
        currentSpeaker.value = data.speaker_name
      }
    }
  } catch (error) {
    console.error('Error loading user preferences:', error)
  }
}

const saveUserPreferences = async () => {
  if (!$supabase || !user.value) return
  
  try {
    const preferences = {
      user_id: user.value.id,
      theme: userPreferences.value.theme,
      font_size: userPreferences.value.font_size,
      speech_rate: speechRate.value,
      voice_name: selectedVoice.value?.name || '',
      selected_engine: selectedEngine.value,
      selected_language: selectedLanguage.value,
      chunk_size: chunkSize.value,
      focus_mode_enabled: focusMode.value,
      auto_save_enabled: userPreferences.value.auto_save_enabled,
      speaker_name: currentSpeaker.value,
      updated_at: new Date().toISOString()
    }
    
    const { error } = await $supabase
      .from('user_preferences')
      .upsert(preferences, { onConflict: 'user_id' })
    
    if (error) throw error
    
    console.log('User preferences saved successfully')
  } catch (error) {
    console.error('Error saving user preferences:', error)
  }
}

const loadDocument = async (documentId) => {
  if (!$supabase || !user.value) return
  
  try {
    const { data, error } = await $supabase
      .from('reading_history')
      .select('*')
      .eq('id', documentId)
      .eq('user_id', user.value.id)
      .single()
    
    if (error) throw error
    if (data) {
      textContent.value = data.text_content || ''
      documentName.value = data.document_name || 'Untitled Document'
      lastReadPosition.value = data.last_read_position || 0
      readingProgress.value = data.reading_progress || 0
      isCompleted.value = data.is_completed || false
      updateStats()
      
      // Split text into chunks for potential audio loading
      if (textContent.value) {
        textChunks.value = splitTextIntoChunks(textContent.value.trim(), chunkSize.value, selectedEngine.value)
      }
      
      const audioLoaded = await loadAudioFromDatabase()
      
      if (audioLoaded) {
        uploadStatus.value = { 
          type: 'success', 
          message: `Document loaded with saved audio. You were at ${readingProgress.value}% progress.` 
        }
      } else if (lastReadPosition.value > 0) {
        uploadStatus.value = { 
          type: 'info', 
          message: `Document loaded. You were at ${readingProgress.value}% progress. Audio will be regenerated on play.` 
        }
      }
      
      setTimeout(() => { uploadStatus.value = null }, 5000)
    }
  } catch (error) {
    console.error('Error loading document:', error)
  }

  // At the end of the loadDocument function, add:
  initialLoadComplete.value = true
}

// MODIFIED: Enhanced document saving with audio handling
const saveDocument = async () => {
  if (!$supabase || !user.value || !textContent.value.trim()) return
  
  // Check if audio settings have changed and we have saved audio
  if (documentId.value && savedAudioSettings.value && hasAudioSettingsChanged.value && hasGeneratedAudio.value) {
    showSettingsChangeModal.value = true
    return
  }
  
  await performDocumentSave()
}

const performDocumentSave = async () => {
  isSaving.value = true
  saveMessage.value = null
  
  try {
    const docName = documentName.value.trim() || 'Untitled Document'
    const estimatedTime = Math.ceil(stats.value.wordCount / 200)
    
    if (documentId.value) {
      // Update existing document
      const { error } = await $supabase
        .from('reading_history')
        .update({
          document_name: docName,
          text_content: textContent.value,
          word_count: stats.value.wordCount,
          char_count: stats.value.charCount,
          last_read_position: lastReadPosition.value,
          reading_progress: readingProgress.value,
          is_completed: isCompleted.value,
          total_chunks: textChunks.value.length,
          estimated_reading_time: estimatedTime,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId.value)
        .eq('user_id', user.value.id)
      
      if (error) throw error
      saveMessage.value = { type: 'success', text: 'Document updated successfully!' }
    } else {
      // Create new document
      const { data, error } = await $supabase
        .from('reading_history')
        .insert({
          user_id: user.value.id,
          document_name: docName,
          text_content: textContent.value,
          word_count: stats.value.wordCount,
          char_count: stats.value.charCount,
          storage_path: currentStoragePath.value,
          last_read_position: lastReadPosition.value,
          reading_progress: readingProgress.value,
          is_completed: isCompleted.value,
          total_chunks: textChunks.value.length,
          estimated_reading_time: estimatedTime
        })
        .select()
      
      if (error) throw error
      if (data && data.length > 0) {
        documentId.value = data[0].id
        console.log('New document created with ID:', documentId.value)
      }
      saveMessage.value = { type: 'success', text: 'Document saved successfully!' }
    }
    
    // NEW: Save pending audio if it exists
    if (pendingAudioSave.value && documentId.value) {
      console.log('Saving pending audio to database...')
      const audioSaved = await saveAudioToDatabase(
        pendingAudioSave.value.audioBlobs, 
        pendingAudioSave.value.settings
      )
      
      if (audioSaved) {
        console.log('Pending audio saved successfully')
        pendingAudioSave.value = null
        saveMessage.value = { type: 'success', text: 'Document and audio saved successfully!' }
      } else {
        console.error('Failed to save pending audio')
        saveMessage.value = { type: 'warning', text: 'Document saved, but audio save failed. Audio will be regenerated on next play.' }
      }
    }
    
    if (userPreferences.value.auto_save_enabled) {
      await saveUserPreferences()
    }
    
    setTimeout(() => { saveMessage.value = null }, 3000)
  } catch (error) {
    console.error('Error saving document:', error)
    saveMessage.value = { type: 'error', text: 'Failed to save document. Please try again.' }
  } finally {
    isSaving.value = false
  }
}

// NEW: Handle settings change confirmation
const handleSettingsChangeConfirm = async (replaceAudio) => {
  showSettingsChangeModal.value = false
  
  if (replaceAudio) {
    // User wants to replace the audio with new settings
    console.log('User confirmed to replace audio with new settings')
    await performDocumentSave()
    
    // If we have generated audio with new settings, save it
    if (hasGeneratedAudio.value && currentAudioSettings.value) {
      // The audio will be saved automatically in performDocumentSave if pendingAudioSave exists
      // or we can trigger a new save here if needed
    }
  } else {
    // User wants to keep existing audio, just save document without audio changes
    console.log('User chose to keep existing audio settings')
    await performDocumentSave()
  }
}

// NEW: Delete document audio when document is deleted
const deleteDocumentAudio = async (docId) => {
  if (!$supabase || !user.value || !docId) return
  
  try {
    console.log('Deleting audio for document:', docId)
    const success = await audioCache.deleteDocumentAudio($supabase, user.value.id, docId)
    if (success) {
      console.log('Document audio deleted successfully')
    } else {
      console.error('Failed to delete document audio')
    }
  } catch (error) {
    console.error('Error deleting document audio:', error)
  }
}

// Watchers
watch(selectedVoice, () => {
  updateAvailableSpeakers()
})

watch(selectedLanguage, () => {
  filterVoicesByLanguage()
  if (selectedVoice.value && !filteredVoices.value.includes(selectedVoice.value)) {
    selectedVoice.value = filteredVoices.value.length > 0 ? filteredVoices.value[0] : null
  }
})

watch(selectedEngine, () => {
  handleEngineSwitch()
})

watch([speechRate, selectedEngine, selectedLanguage, chunkSize, focusMode, selectedVoice, currentSpeaker], () => {
  if (userPreferences.value.auto_save_enabled && user.value) {
    clearTimeout(saveUserPreferences.timeoutId)
    saveUserPreferences.timeoutId = setTimeout(saveUserPreferences, 1000)
  }
})

// Cleanup
onBeforeUnmount(() => {
  audioManager.value.cleanup()
})

// Lifecycle
onMounted(async () => {
  if ($supabase) {
    try {
      const { data } = await $supabase.auth.getUser()
      user.value = data.user
      
      if (user.value) {
        await loadUserPreferences()
      }
    } catch (error) {
      console.error('Error getting user:', error)
    }
  }
  
  await loadAllVoices()
  await updateCacheStats()
  updateStats()
  
  const { document_id, document_name } = route.query
  if (document_id && user.value) {
    documentId.value = document_id
    await loadDocument(document_id)
  }
})
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-4">
    <div class="max-w-6xl mx-auto">
      <!-- Header -->
      <div class="flex justify-between items-center mb-8">
        <h1 class="text-4xl font-bold text-gray-800">🎤 SpeakEasy</h1>
        <div class="flex items-center space-x-4">
          <NuxtLink 
            v-if="user"
            to="/history"
            class="py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            📚 History
          </NuxtLink>
          <UserProfile v-if="user" :user="user" />
          <NuxtLink 
            v-else 
            to="/auth/login"
            class="py-2 px-4 bg-purple-600 text-white rounded-md hover:bg-purple-700"
          >
            Sign In
          </NuxtLink>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Main Content -->
        <div class="lg:col-span-2 space-y-6">
          <!-- File Upload -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4">📁 Upload File</h2>
            <div class="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-purple-400 transition-colors"
                 @dragover.prevent @drop.prevent="handleFileDrop">
              <input ref="fileInput" type="file" accept=".pdf,.docx,.txt" @change="handleFileUpload" class="hidden" />
              <div @click="$refs.fileInput.click()" class="cursor-pointer">
                <div class="text-4xl mb-2">📄</div>
                <p class="text-gray-600 mb-2">Click to upload or drag and drop</p>
                <p class="text-sm text-gray-500">Supports PDF, DOCX, and TXT files (max 10MB)</p>
              </div>
            </div>
            <div v-if="uploadStatus" class="mt-4 p-3 rounded-lg" :class="getStatusClass(uploadStatus.type)">
              {{ uploadStatus.message }}
            </div>
          </div>

          <!-- Text Input -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="flex justify-between items-center mb-4">
              <h2 class="text-xl font-semibold">✏️ Text Input</h2>
              <div class="flex items-center space-x-4">
                <div v-if="documentName" class="text-sm text-gray-600">{{ documentName }}</div>
                <button 
                  @click="clearText" 
                  class="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                >
                  🗑️ Clear
                </button>
              </div>
            </div>
            
            <!-- Reading Progress -->
            <div v-if="readingProgress > 0" class="mb-4">
              <div class="flex justify-between text-sm text-gray-600 mb-1">
                <span>Reading Progress</span>
                <span>{{ readingProgress }}% {{ isCompleted ? '(Completed)' : '' }}</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div 
                  class="h-2 rounded-full transition-all duration-300"
                  :class="isCompleted ? 'bg-green-600' : 'bg-blue-600'"
                  :style="{ width: `${readingProgress}%` }"
                ></div>
              </div>
            </div>
            
            <!-- Focus Mode Toggle -->
            <div class="mb-4 flex items-center space-x-4">
              <label class="flex items-center">
                <input 
                  v-model="focusMode" 
                  type="checkbox" 
                  class="mr-2"
                />
                <span class="text-sm font-medium">Focus Mode</span>
              </label>
              <span class="text-xs text-gray-500">
                {{ focusMode ? 'Shows only current reading section' : 'Shows full text' }}
              </span>
            </div>
            
            <!-- NEW: Audio Settings Change Warning -->
            <div v-if="hasAudioSettingsChanged && savedAudioSettings" class="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
              <div class="flex items-center">
                <div class="text-yellow-600 mr-2">⚠️</div>
                <div class="text-sm text-yellow-800">
                  <strong>Audio settings have changed!</strong> 
                  Saving will replace the existing audio with new settings.
                </div>
              </div>
            </div>
            
            <div class="relative">
              <textarea
                v-model="textContent"
                placeholder="Paste or type your text here..."
                class="w-full h-64 p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-purple-500"
                :class="{ 'opacity-50': focusMode }"
                @input="updateStats"
              ></textarea>
              
              <!-- Highlighted text overlay for focus mode -->
              <div 
                v-if="focusMode && highlightedText" 
                class="absolute inset-0 p-4 pointer-events-none bg-white bg-opacity-90 rounded-lg"
              >
                <div class="h-64 overflow-auto">
                  <div class="whitespace-pre-wrap text-gray-800 bg-yellow-200 p-2 rounded">
                    {{ displayText }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- TTS Engine Selection -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4">🎯 TTS Engine</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div v-for="engine in engineOptions" :key="engine.value" class="relative">
                <input 
                  :id="engine.value" 
                  v-model="selectedEngine" 
                  :value="engine.value" 
                  type="radio" 
                  class="sr-only"
                />
                <label 
                  :for="engine.value" 
                  class="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all"
                  :class="selectedEngine === engine.value ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-purple-300'"
                >
                  <span class="text-2xl mr-3">{{ engine.icon }}</span>
                  <div>
                    <div class="font-medium">{{ engine.label }}</div>
                    <div class="text-sm text-gray-500">
                      {{ engine.value === TTS_ENGINES.WEB_SPEECH ? 'Instant playback, browser voices' : 'High-quality voices, cached audio' }}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <!-- Voice Controls -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4">🎛️ Voice Controls</h2>
            
            <!-- Language Selection -->
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">Language</label>
              <select 
                v-model="selectedLanguage" 
                class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              >
                <option v-for="lang in availableLanguages" :key="lang.code" :value="lang.code">
                  {{ lang.name }}
                </option>
              </select>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Voice Selection -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Voice 
                  <span v-if="currentEngine" class="text-xs text-gray-500">
                    ({{ currentEngine === TTS_ENGINES.WEB_SPEECH ? 'Web Speech' : 'OpenTTS' }})
                  </span>
                </label>
                <select 
                  v-model="selectedVoice" 
                  class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  :disabled="isLoadingVoices || filteredVoices.length === 0"
                >
                  <option v-if="isLoadingVoices" value="">Loading voices...</option>
                  <option v-else-if="filteredVoices.length === 0" value="">No voices available</option>
                  <template v-else>
                    <option v-for="voice in filteredVoices.filter(v => v.engine === selectedEngine)" :key="voice.id" :value="voice">
                      {{ voice.name.replace(' - Web Speech', '').replace(' - OpenTTS', '') }}
                    </option>
                  </template>
                </select>
              </div>
              
              <!-- Speaker Selection (for multi-speaker voices) -->
              <div v-if="availableSpeakers.length > 0">
                <label class="block text-sm font-medium text-gray-700 mb-2">Speaker</label>
                <select 
                  v-model="currentSpeaker" 
                  class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                >
                  <option v-for="speaker in availableSpeakers" :key="speaker.id" :value="speaker.name">
                    {{ speaker.name }}
                  </option>
                </select>
              </div>
              
              <!-- Speed Control -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Speed: {{ speechRate }}x</label>
                <input v-model="speechRate" type="range" min="0.5" max="2" step="0.1" class="w-full slider" />
              </div>
              
              <!-- Chunk Size Control -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Chunk Size: {{ chunkSize }} chars
                  <span class="text-xs text-gray-500">({{ isWebSpeechEngine ? 'Auto-adjusted for Web Speech' : 'OpenTTS chunks' }})</span>
                </label>
                <input v-model="chunkSize" type="range" min="200" max="1000" step="50" class="w-full slider" />
              </div>
            </div>
          </div>

          <!-- Playback Controls -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4">⏯️ Playback Controls</h2>
            
            <!-- Progress Bars -->
            <div v-if="isGeneratingSpeech || isPlaying || isPaused" class="mb-4 space-y-2">
              <div v-if="isGeneratingSpeech" class="w-full">
                <div class="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Generating Speech</span>
                  <span>{{ getGenerationProgress }}%</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full transition-all duration-300" :style="{ width: `${getGenerationProgress}%` }"></div>
                </div>
              </div>
              
              <div v-if="(isPlaying || isPaused) && playbackProgress.total > 0" class="w-full">
                <div class="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Playback Progress</span>
                  <span>{{ playbackProgress.current }} / {{ playbackProgress.total }} chunks</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-green-600 h-2 rounded-full transition-all duration-300" :style="{ width: `${getPlaybackProgress}%` }"></div>
                </div>
              </div>
            </div>
            
            <!-- Main Controls -->
            <div class="flex justify-center space-x-4 mb-4">
              <button 
                @click="togglePlayPause" 
                :disabled="!textContent || isGeneratingSpeech || !selectedVoice || isEngineChanging" 
                class="btn btn-green"
              >
                {{ playPauseButtonText }}
              </button>
              <button 
                @click="stopText" 
                :disabled="!isPlaying && !isPaused" 
                class="btn btn-red"
              >
                ⏹️ Stop
              </button>
            </div>
            
            <!-- Navigation Controls -->
            <div v-if="hasGeneratedAudio && textChunks.length > 0" class="flex justify-center space-x-4">
              <button 
                @click="previousChunk" 
                :disabled="!canGoBackward" 
                class="btn btn-gray text-sm"
              >
                ⏮️ Previous
              </button>
              <span class="text-sm text-gray-600 flex items-center">
                {{ currentChunkIndex + 1 }} / {{ textChunks.length }}
              </span>
              <button 
                @click="nextChunk" 
                :disabled="!canGoForward" 
                class="btn btn-gray text-sm"
              >
                Next ⏭️
              </button>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="space-y-6">
          <!-- Text Stats -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-lg font-semibold mb-4">📊 Text Statistics</h3>
            <div class="space-y-3">
              <div class="flex justify-between">
                <span class="text-gray-600">Words:</span>
                <span class="font-semibold">{{ stats.wordCount }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Characters:</span>
                <span class="font-semibold">{{ stats.charCount }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Reading Time:</span>
                <span class="font-semibold">{{ stats.readingTime }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Chunks:</span>
                <span class="font-semibold">{{ Math.ceil(stats.charCount / (isWebSpeechEngine ? chunkSize * 2 : chunkSize)) }}</span>
              </div>
              <div v-if="readingProgress > 0" class="flex justify-between">
                <span class="text-gray-600">Progress:</span>
                <span class="font-semibold" :class="isCompleted ? 'text-green-600' : 'text-blue-600'">
                  {{ readingProgress }}%
                </span>
              </div>
            </div>
          </div>

          <!-- Status -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-lg font-semibold mb-4">🔊 Status</h3>
            <div class="space-y-3">
              <div>
                <span class="text-gray-600 block text-sm">Current Engine:</span>
                <span class="font-semibold text-sm">
                  {{ currentEngine === TTS_ENGINES.WEB_SPEECH ? '⚡ Web Speech API' : '🎯 OpenTTS' }}
                </span>
              </div>
              <div>
                <span class="text-gray-600 block text-sm">Current Voice:</span>
                <span class="font-semibold text-sm">{{ selectedVoice?.name?.replace(' - Web Speech', '').replace(' - OpenTTS', '') || 'None selected' }}</span>
              </div>
              <div v-if="currentSpeaker">
                <span class="text-gray-600 block text-sm">Speaker:</span>
                <span class="font-semibold">{{ currentSpeaker }}</span>
              </div>
              <div>
                <span class="text-gray-600 block text-sm">Speed:</span>
                <span class="font-semibold">{{ speechRate }}x</span>
              </div>
              <div>
                <span class="text-gray-600 block text-sm">Playback State:</span>
                <span class="font-semibold" :class="getStatusColor">{{ getPlaybackStatus }}</span>
              </div>
              <div>
                <span class="text-gray-600 block text-sm">Focus Mode:</span>
                <span class="font-semibold" :class="focusMode ? 'text-purple-600' : 'text-gray-600'">
                  {{ focusMode ? 'Enabled' : 'Disabled' }}
                </span>
              </div>
              <!-- NEW: Audio Status -->
              <div v-if="savedAudioSettings">
                <span class="text-gray-600 block text-sm">Saved Audio:</span>
                <span class="font-semibold text-green-600">Available</span>
                <div v-if="hasAudioSettingsChanged" class="text-xs text-yellow-600 mt-1">
                  ⚠️ Settings changed
                </div>
              </div>
            </div>
          </div>

          <!-- Cache Management -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-lg font-semibold mb-4">💾 Audio Cache</h3>
            <div class="space-y-3">
              <div class="flex justify-between">
                <span class="text-gray-600">Cached Files:</span>
                <span class="font-semibold">{{ cacheStats.totalEntries }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Cache Size:</span>
                <span class="font-semibold">{{ cacheStats.totalSizeMB }} MB</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Memory Cache:</span>
                <span class="font-semibold">{{ cacheStats.memoryEntries }} files</span>
              </div>
              <button 
                @click="clearCache" 
                class="w-full btn btn-red text-sm py-2"
              >
                🗑️ Clear Local Cache
              </button>
              <div class="text-xs text-gray-500 text-center">
                Database audio preserved
              </div>
            </div>
          </div>
          
          <!-- Save Document (for authenticated users) -->
          <div v-if="user" class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-lg font-semibold mb-4">💾 Save Document</h3>
            <div class="space-y-4">
              <input
                v-model="documentName"
                type="text"
                placeholder="Enter document name"
                class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500"
              />
              <button @click="saveDocument" :disabled="!textContent || isSaving" class="w-full btn btn-purple">
                {{ isSaving ? 'Saving...' : 'Save Document' }}
              </button>
              <div v-if="saveMessage" class="p-3 rounded-md text-sm" :class="getStatusClass(saveMessage.type)">
                {{ saveMessage.text }}
              </div>
              <!-- NEW: Pending Audio Indicator -->
              <div v-if="pendingAudioSave" class="p-2 bg-blue-100 rounded-md text-sm text-blue-800">
                🎵 Audio ready to save with document
              </div>
            </div>
          </div>
          
          <!-- User Preferences Quick Actions -->
          <div v-if="user" class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-lg font-semibold mb-4">⚙️ Quick Settings</h3>
            <div class="space-y-3">
              <button 
                @click="saveUserPreferences" 
                class="w-full btn btn-blue text-sm py-2"
              >
                💾 Save Preferences
              </button>
              <NuxtLink 
                to="/profile"
                class="w-full btn btn-gray text-sm py-2 text-center block"
              >
                🔧 Full Settings
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>

      <!-- NEW: Settings Change Modal -->
      <div v-if="showSettingsChangeModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 class="text-lg font-semibold text-gray-800 mb-4">⚠️ Audio Settings Changed</h3>
          <p class="text-gray-600 mb-4">
            You have changed the audio settings since the last audio generation. 
            What would you like to do?
          </p>
          <div class="space-y-3">
            <div class="text-sm text-gray-500">
              <strong>Current settings:</strong><br>
              Engine: {{ getCurrentAudioSettings()?.engine }}<br>
              Voice: {{ selectedVoice?.name?.replace(' - Web Speech', '').replace(' - OpenTTS', '') }}<br>
              Speed: {{ speechRate }}x<br>
              <span v-if="currentSpeaker">Speaker: {{ currentSpeaker }}<br></span>
              Chunk Size: {{ chunkSize }}
            </div>
            <div class="text-sm text-gray-500">
              <strong>Saved audio settings:</strong><br>
              Engine: {{ savedAudioSettings?.engine }}<br>
              Speed: {{ savedAudioSettings?.speed }}x<br>
              <span v-if="savedAudioSettings?.speaker">Speaker: {{ savedAudioSettings.speaker }}<br></span>
              Chunk Size: {{ savedAudioSettings?.chunkSize }}
            </div>
          </div>
          <div class="flex flex-col space-y-2 mt-6">
            <button
              @click="handleSettingsChangeConfirm(true)"
              class="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 transition-colors"
            >
              Replace Audio with New Settings
            </button>
            <button
              @click="handleSettingsChangeConfirm(false)"
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Keep Existing Audio & Save Document
            </button>
            <button
              @click="showSettingsChangeModal = false"
              class="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn {
  @apply px-6 py-3 rounded-lg font-medium transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed;
}
.btn-green { @apply bg-green-500 text-white hover:bg-green-600; }
.btn-yellow { @apply bg-yellow-500 text-white hover:bg-yellow-600; }
.btn-red { @apply bg-red-500 text-white hover:bg-red-600; }
.btn-purple { @apply bg-purple-600 text-white hover:bg-purple-700; }
.btn-blue { @apply bg-blue-600 text-white hover:bg-blue-700; }
.btn-gray { @apply bg-gray-500 text-white hover:bg-gray-600; }

.slider {
  @apply h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer;
}
.slider::-webkit-slider-thumb {
  @apply appearance-none h-5 w-5 rounded-full bg-purple-600 cursor-pointer;
}
.slider::-moz-range-thumb {
  @apply h-5 w-5 rounded-full bg-purple-600 cursor-pointer border-none;
}
</style>
