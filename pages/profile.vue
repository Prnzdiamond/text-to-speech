<template>
    <div class="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-4">
      <div class="max-w-4xl mx-auto">
        <div class="flex justify-between items-center mb-8">
          <h1 class="text-3xl font-bold text-gray-800">Profile Settings</h1>
          <NuxtLink to="/" class="text-purple-600 hover:text-purple-800">Back to App</NuxtLink>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <div v-if="isLoading" class="text-center py-8">
            <p>Loading your preferences...</p>
          </div>
          
          <form v-else @submit.prevent="savePreferences" class="space-y-6">
            <div>
              <h2 class="text-xl font-semibold mb-4">Account Information</h2>
              <div class="bg-gray-50 p-4 rounded-md">
                <p class="text-gray-700"><strong>Email:</strong> {{ user?.email }}</p>
              </div>
            </div>
            
            <div>
              <h2 class="text-xl font-semibold mb-4">Appearance</h2>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Theme</label>
                  <select
                    v-model="preferences.theme"
                    class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
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
                  </select>
                </div>
              </div>
            </div>
            
            <div>
              <h2 class="text-xl font-semibold mb-4">Speech Settings</h2>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Default Voice</label>
                  <select
                    v-model="preferences.voice_name"
                    class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="">System Default</option>
                    <option v-for="voice in availableVoices" :key="voice.name" :value="voice.name">
                      {{ voice.name }} ({{ voice.lang }})
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
              </div>
            </div>
            
            <div v-if="saveMessage" class="p-3 rounded-md text-sm" :class="saveMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">
              {{ saveMessage.text }}
            </div>
            
            <div class="flex justify-end">
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
  import { ref, onMounted } from 'vue'
  
  const router = useRouter()
  const { $supabase } = useNuxtApp()
  
  const user = ref(null)
  const preferences = ref({
    theme: 'light',
    font_size: 'medium',
    speech_rate: 1.0,
    voice_name: ''
  })
  const availableVoices = ref([])
  const isLoading = ref(true)
  const isSaving = ref(false)
  const saveMessage = ref(null)
  
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
  
  const loadVoices = () => {
    if (process.client && 'speechSynthesis' in window) {
      const voices = window.speechSynthesis.getVoices()
      availableVoices.value = voices.filter(voice => voice.lang.includes('en') || voice.default)
      if (availableVoices.value.length === 0) availableVoices.value = voices
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
          voice_name: data.voice_name || ''
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
          updated_at: new Date().toISOString()
        })
      
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
  
  onMounted(async () => {
    await checkAuth()
    if (user.value) {
      loadVoices()
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
  