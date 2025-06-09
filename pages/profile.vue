<template>
  <div class="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-4">
    <div class="max-w-4xl mx-auto">
      <div class="flex justify-between items-center mb-8">
        <h1 class="text-3xl font-bold text-gray-800">⚙️ Profile Settings</h1>
        <NuxtLink to="/" class="text-purple-600 hover:text-purple-800">← Back to App</NuxtLink>
      </div>
      
      <div class="bg-white rounded-lg shadow-md p-6">
        <div v-if="isLoading" class="text-center py-8">
          <div class="text-4xl mb-4">⏳</div>
          <p>Loading your preferences...</p>
        </div>
        
        <form v-else @submit.prevent="savePreferences" class="space-y-8">
          <!-- Account Information -->
          <div>
            <h2 class="text-xl font-semibold mb-4">👤 Account Information</h2>
            <div class="bg-gray-50 p-4 rounded-md">
              <p class="text-gray-700"><strong>Email:</strong> {{ user?.email }}</p>
            </div>
          </div>
          
          <!-- Appearance Settings -->
          <div>
            <h2 class="text-xl font-semibold mb-4">🎨 Appearance</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Theme</label>
                <select
                  v-model="preferences.theme"
                  class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Font Size</label>
                <select
                  v-model="preferences.font_size"
                  class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                  <option value="extra-large">Extra Large</option>
                </select>
              </div>
            </div>
          </div>
          
          <!-- TTS Engine Settings -->
          <div>
            <h2 class="text-xl font-semibold mb-4">🎯 TTS Engine Preferences</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Default Engine</label>
                <select
                  v-model="preferences.selected_engine"
                  class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="web-speech">Web Speech API (Fast)</option>
                  <option value="open-tts">OpenTTS (High Quality)</option>
                </select>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Default Language</label>
                <select
                  v-model="preferences.selected_language"
                  class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option v-for="lang in availableLanguages" :key="lang.code" :value="lang.code">
                    {{ lang.name }}
                  </option>
                </select>
              </div>
            </div>
          </div>
          
          <!-- Speech Settings -->
          <div>
            <h2 class="text-xl font-semibold mb-4">🎤 Speech Settings</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Default Voice</label>
                <select
                  v-model="preferences.voice_name"
                  class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">System Default</option>
                  <option v-for="voice in filteredVoices" :key="voice.name" :value="voice.name">
                    {{ voice.name.replace(' - Web Speech', '').replace(' - OpenTTS', '') }}
                  </option>
                </select>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  Default Speed: {{ preferences.speech_rate }}x
                </label>
                <input
                  v-model="preferences.speech_rate"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                />
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  Chunk Size: {{ preferences.chunk_size }} characters
                </label>
                <input
                  v-model="preferences.chunk_size"
                  type="range"
                  min="200"
                  max="1000"
                  step="50"
                  class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                />
                <p class="text-xs text-gray-500 mt-1">Smaller chunks = more responsive, larger chunks = better flow</p>
              </div>
              
              <div v-if="preferences.voice_name && selectedVoiceHasSpeakers">
                <label class="block text-sm font-medium text-gray-700 mb-1">Default Speaker</label>
                <select
                  v-model="preferences.speaker_name"
                  class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Default Speaker</option>
                  <option v-for="speaker in availableSpeakers" :key="speaker.id" :value="speaker.name">
                    {{ speaker.name }}
                  </option>
                </select>
              </div>
            </div>
          </div>
          
          <!-- Reading Preferences -->
          <div>
            <h2 class="text-xl font-semibold mb-4">📖 Reading Preferences</h2>
            <div class="space-y-4">
              <label class="flex items-center">
                <input
                  v-model="preferences.focus_mode_enabled"
                  type="checkbox"
                  class="mr-3 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                />
                <div>
                  <span class="text-sm font-medium text-gray-700">Enable Focus Mode by Default</span>
                  <p class="text-xs text-gray-500">Shows only the current reading section</p>
                </div>
              </label>
              
              <label class="flex items-center">
                <input
                  v-model="preferences.auto_save_enabled"
                  type="checkbox"
                  class="mr-3 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                />
                <div>
                  <span class="text-sm font-medium text-gray-700">Auto-save Preferences</span>
                  <p class="text-xs text-gray-500">Automatically save changes as you make them</p>
                </div>
              </label>
            </div>
          </div>
          
          <!-- Save Message -->
          <div v-if="saveMessage" class="p-3 rounded-md text-sm" :class="saveMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">
            {{ saveMessage.text }}
          </div>
          
          <!-- Save Button -->
          <div class="flex justify-end space-x-4">
            <button
              type="button"
              @click="resetToDefaults"
              class="py-2 px-6 bg-gray-500 text-white rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              Reset to Defaults
            </button>
            <button
              type="submit"
              class="py-2 px-6 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50"
              :disabled="isSaving"
            >
              {{ isSaving ? 'Saving...' : 'Save Preferences' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { getAllVoices, getAvailableLanguages } from '~/services/tts-service'
import { useNuxtApp } from '#app'

const router = useRouter()
const { $supabase } = useNuxtApp()

const user = ref(null)
const preferences = ref({
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

const availableVoices = ref([])
const availableLanguages = ref([])
const availableSpeakers = ref([])
const isLoading = ref(true)
const isSaving = ref(false)
const saveMessage = ref(null)

// Computed
const filteredVoices = computed(() => {
  return availableVoices.value.filter(voice => 
    voice.language === preferences.value.selected_language &&
    voice.engine === preferences.value.selected_engine
  )
})

const selectedVoiceHasSpeakers = computed(() => {
  if (!preferences.value.voice_name) return false
  const voice = availableVoices.value.find(v => v.name === preferences.value.voice_name)
  return voice?.multispeaker && voice?.speakers
})

// Methods
const checkAuth = async () => {
  if (!$supabase) {
    saveMessage.value = {
      type: 'error',
      text: 'Authentication service not available.'
    }
    return
  }
  
  try {
    const { data } = await $supabase.auth.getUser()
    user.value = data.user
    
    if (!user.value) {
      await router.push('/auth/login')
    }
  } catch (error) {
    console.error('Auth check error:', error)
    await router.push('/auth/login')
  }
}

const loadVoices = async () => {
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
  } catch (error) {
    console.error('Error loading voices:', error)
  }
}

const updateAvailableSpeakers = () => {
  availableSpeakers.value = []
  
  if (preferences.value.voice_name) {
    const voice = availableVoices.value.find(v => v.name === preferences.value.voice_name)
    if (voice?.multispeaker && voice?.speakers) {
      const speakers = voice.speakers
      availableSpeakers.value = Object.entries(speakers).map(([name, id]) => ({
        name: name.trim(),
        id
      })).filter(speaker => speaker.name !== 'ED')
    }
  }
}

const loadUserPreferences = async () => {
  if (!user.value) return
  
  isLoading.value = true
  try {
    const { data, error } = await $supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.value.id)
      .single()
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      throw error
    }
    
    if (data) {
      preferences.value = {
        theme: data.theme || 'light',
        font_size: data.font_size || 'medium',
        speech_rate: data.speech_rate || 1.0,
        voice_name: data.voice_name || '',
        selected_engine: data.selected_engine || 'web-speech',
        selected_language: data.selected_language || 'en',
        chunk_size: data.chunk_size || 500,
        focus_mode_enabled: data.focus_mode_enabled || false,
        auto_save_enabled: data.auto_save_enabled !== false, // Default to true
        speaker_name: data.speaker_name || null
      }
    }
  } catch (error) {
    console.error('Error loading preferences:', error)
    saveMessage.value = {
      type: 'error',
      text: 'Failed to load preferences.'
    }
  } finally {
    isLoading.value = false
  }
}

const savePreferences = async () => {
  if (!user.value) return
  
  isSaving.value = true
  saveMessage.value = null
  
  try {
    const { error } = await $supabase
      .from('user_preferences')
      .upsert({
        user_id: user.value.id,
        theme: preferences.value.theme,
        font_size: preferences.value.font_size,
        speech_rate: preferences.value.speech_rate,
        voice_name: preferences.value.voice_name,
        selected_engine: preferences.value.selected_engine,
        selected_language: preferences.value.selected_language,
        chunk_size: preferences.value.chunk_size,
        focus_mode_enabled: preferences.value.focus_mode_enabled,
        auto_save_enabled: preferences.value.auto_save_enabled,
        speaker_name: preferences.value.speaker_name,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
    
    if (error) throw error
    
    saveMessage.value = {
      type: 'success',
      text: 'Preferences saved successfully!'
    }
    
    setTimeout(() => { saveMessage.value = null }, 3000)
  } catch (error) {
    console.error('Error saving preferences:', error)
    saveMessage.value = {
      type: 'error',
      text: 'Failed to save preferences.'
    }
  } finally {
    isSaving.value = false
  }
}

const resetToDefaults = () => {
  preferences.value = {
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
  }
  
  saveMessage.value = {
    type: 'info',
    text: 'Preferences reset to defaults. Click Save to apply changes.'
  }
}

// Watchers
watch(() => preferences.value.voice_name, () => {
  updateAvailableSpeakers()
})

watch(() => preferences.value.selected_language, () => {
  // Reset voice selection when language changes
  preferences.value.voice_name = ''
  preferences.value.speaker_name = null
})

watch(() => preferences.value.selected_engine, () => {
  // Reset voice selection when engine changes
  preferences.value.voice_name = ''
  preferences.value.speaker_name = null
})

onMounted(async () => {
  await checkAuth()
  if (user.value) {
    await loadVoices()
    await loadUserPreferences()
  }
})
</script>

<style scoped>
.slider::-webkit-slider-thumb {
  appearance: none;
  height: 20px;
  width: 20px;
  border-radius: 50%;
  background: #8b5cf6;
  cursor: pointer;
}

.slider::-moz-range-thumb {
  height: 20px;
  width: 20px;
  border-radius: 50%;
  background: #8b5cf6;
  cursor: pointer;
  border: none;
}
</style>
