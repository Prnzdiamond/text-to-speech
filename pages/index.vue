<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useNuxtApp } from 'nuxt/app'

const route = useRoute()
const { $supabase} = useNuxtApp()

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
const speechSynthesis = ref(null)
const currentUtterance = ref(null)
const uploadStatus = ref(null)
const saveMessage = ref(null)
const isSaving = ref(false)
const stats = ref({ wordCount: 0, charCount: 0, readingTime: '0 min' })
const currentStoragePath = ref(null)

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

// Methods
const getStatusClass = (type) => {
  const classes = {
    success: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800'
  }
  return classes[type] || ''
}

const initializeSpeech = () => {
  if (process.client && 'speechSynthesis' in window) {
    speechSynthesis.value = window.speechSynthesis
    loadVoices()
    speechSynthesis.value.onvoiceschanged = loadVoices
  }
}

const loadVoices = () => {
  if (!speechSynthesis.value) return
  const voices = speechSynthesis.value.getVoices()
  availableVoices.value = voices.filter(voice => voice.lang.includes('en') || voice.default)
  if (availableVoices.value.length === 0) availableVoices.value = voices
  if (availableVoices.value.length > 0 && !selectedVoice.value) {
    selectedVoice.value = availableVoices.value.find(voice => voice.default) || availableVoices.value[0]
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
    
    console.log("Sending request to /api/process-file")
    
    const response = await $fetch('/api/process-file', {
      method: 'POST',
      body: formData,
      timeout: 30000,
    })
    
    console.log("Response received:", response)
    
    if (response.success) {
      textContent.value = response.text
      updateStats()
      documentName.value = file.name.split('.')[0]
      documentId.value = null
      
      // Save file to Supabase storage if user is logged in
      let storagePath = null
      if ($supabase && user.value) {
        uploadStatus.value = { type: 'info', message: 'Saving file to storage...' }
        storagePath = await saveFileToStorage(file)
      }
      
      if (storagePath) {
        currentStoragePath.value = storagePath
      }

      loadVoices()
      uploadStatus.value = { 
        type: 'success', 
        message: `File processed successfully! Extracted ${response.text.length} characters.${storagePath ? ' File saved to storage.' : ''}` 
      }
    } else {
      uploadStatus.value = { type: 'error', message: response.error || 'Failed to process file' }
    }
  } catch (error) {
    console.error("Upload error:", error)
    
    if (error.message.includes('fetch')) {
      uploadStatus.value = { type: 'error', message: 'Network error: Could not connect to server. Please check your connection.' }
    } else if (error.message.includes('timeout')) {
      uploadStatus.value = { type: 'error', message: 'Upload timeout: File processing took too long. Please try a smaller file.' }
    } else {
      uploadStatus.value = { type: 'error', message: `Upload failed: ${error.message}` }
    }
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

const playText = () => {
  if (!textContent.value.trim() || !speechSynthesis.value) return
  if (speechSynthesis.value.speaking || speechSynthesis.value.pending) {
    speechSynthesis.value.cancel()
    setTimeout(() => executePlayText(), 100)
    return
  }
  executePlayText()
}

const executePlayText = () => {
  if (isPaused.value && currentUtterance.value) {
    speechSynthesis.value.resume()
    isPlaying.value = true
    isPaused.value = false
    return
  }

  currentUtterance.value = new SpeechSynthesisUtterance(textContent.value)
  if (selectedVoice.value) currentUtterance.value.voice = selectedVoice.value
  currentUtterance.value.rate = parseFloat(speechRate.value)

  currentUtterance.value.onstart = () => { isPlaying.value = true; isPaused.value = false }
  currentUtterance.value.onend = () => { isPlaying.value = false; isPaused.value = false; currentUtterance.value = null }
  currentUtterance.value.onerror = () => { isPlaying.value = false; isPaused.value = false; currentUtterance.value = null }

  speechSynthesis.value.speak(currentUtterance.value)
}

const pauseText = () => {
  if (isPlaying.value && speechSynthesis.value) {
    speechSynthesis.value.pause()
    isPlaying.value = false
    isPaused.value = true
  }
}

const stopText = () => {
  if (speechSynthesis.value) {
    speechSynthesis.value.cancel()
    isPlaying.value = false
    isPaused.value = false
    currentUtterance.value = null
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
      updateStats()
    }
  } catch (error) {
    console.error('Error loading document:', error)
  }
}

const saveDocument = async () => {
  if (!$supabase || !user.value || !textContent.value.trim()) return
  
  isSaving.value = true
  saveMessage.value = null
  
  try {
    const docName = documentName.value.trim() || 'Untitled Document'
    
    if (documentId.value) {
      const { error } = await $supabase
        .from('reading_history')
        .update({
          document_name: docName,
          text_content: textContent.value,
          word_count: stats.value.wordCount,
          char_count: stats.value.charCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId.value)
        .eq('user_id', user.value.id)
      
      if (error) throw error
      saveMessage.value = { type: 'success', text: 'Document updated successfully!' }
    } else {
      const { data, error } = await $supabase
        .from('reading_history')
        .insert({
          user_id: user.value.id,
          document_name: docName,
          text_content: textContent.value,
          word_count: stats.value.wordCount,
          char_count: stats.value.charCount,
          storage_path: currentStoragePath.value // Add this line
        })
        .select()
      
      if (error) throw error
      if (data && data.length > 0) documentId.value = data[0].id
      saveMessage.value = { type: 'success', text: 'Document saved successfully!' }
    }
    
    setTimeout(() => { saveMessage.value = null }, 3000)
  } catch (error) {
    saveMessage.value = { type: 'error', text: 'Failed to save document. Please try again.' }
  } finally {
    isSaving.value = false
  }
}

// Lifecycle hooks
onMounted(async () => {
  // Check if user is authenticated
  if ($supabase) {
    try {
      const { data } = await $supabase.auth.getUser()
      user.value = data.user
    } catch (error) {
      console.error('Error getting user:', error)
    }
  }
  
  // Initialize speech synthesis (client-side only)
  initializeSpeech()
  updateStats()
  
  // Check for document in query params
  const { document_id, document_name } = route.query
  if (document_id && user.value) {
    documentId.value = document_id
    documentName.value = document_name || 'Untitled Document'
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
              <div v-if="documentName" class="text-sm text-gray-600">{{ documentName }}</div>
            </div>
            <textarea
              v-model="textContent"
              placeholder="Paste or type your text here..."
              class="w-full h-64 p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-purple-500"
              @input="updateStats"
            ></textarea>
          </div>

          <!-- Voice Controls -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4">🎛️ Voice Controls</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Voice Selection</label>
                <select v-model="selectedVoice" class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
                  <option value="">Select a voice...</option>
                  <option v-for="voice in availableVoices" :key="voice.name" :value="voice">
                    {{ voice.name }} ({{ voice.lang }})
                  </option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Speed: {{ speechRate }}x</label>
                <input v-model="speechRate" type="range" min="0.5" max="2" step="0.1" class="w-full slider" />
              </div>
            </div>
          </div>

          <!-- Playback Controls -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4">⏯️ Playback Controls</h2>
            <div class="flex justify-center space-x-4">
              <button @click="playText" :disabled="!textContent || isPlaying" class="btn btn-green">▶️ Play</button>
              <button @click="pauseText" :disabled="!isPlaying" class="btn btn-yellow">⏸️ Pause</button>
              <button @click="stopText" :disabled="!isPlaying && !isPaused" class="btn btn-red">⏹️ Stop</button>
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
            </div>
          </div>

          <!-- Status -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h3 class="text-lg font-semibold mb-4">🔊 Status</h3>
            <div class="space-y-3">
              <div>
                <span class="text-gray-600 block text-sm">Current Voice:</span>
                <span class="font-semibold text-sm">{{ selectedVoice?.name || 'None selected' }}</span>
              </div>
              <div>
                <span class="text-gray-600 block text-sm">Speed:</span>
                <span class="font-semibold">{{ speechRate }}x</span>
              </div>
              <div>
                <span class="text-gray-600 block text-sm">Playback State:</span>
                <span class="font-semibold" :class="getStatusColor">{{ getPlaybackStatus }}</span>
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
            </div>
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
