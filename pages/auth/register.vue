<template>
    <div class="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-4xl font-bold text-gray-800 mb-2">🎤 SpeakEasy</h1>
          <p class="text-gray-600">Create your account</p>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-8">
          <form @submit.prevent="handleRegister" class="space-y-6">
            <div>
              <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                id="email"
                v-model="email"
                type="email"
                required
                class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="your@email.com"
              />
            </div>
            
            <div>
              <label for="password" class="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                id="password"
                v-model="password"
                type="password"
                required
                minlength="6"
                class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="••••••••"
              />
              <p class="mt-1 text-xs text-gray-500">Password must be at least 6 characters</p>
            </div>
            
            <div v-if="errorMessage" class="p-3 bg-red-100 text-red-800 rounded-md text-sm">
              {{ errorMessage }}
            </div>
            
            <div v-if="successMessage" class="p-3 bg-green-100 text-green-800 rounded-md text-sm">
              {{ successMessage }}
            </div>
            
            <button
              type="submit"
              class="w-full py-2 px-4 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50"
              :disabled="isLoading"
            >
              {{ isLoading ? 'Creating account...' : 'Sign up' }}
            </button>
            
            <div class="text-center text-sm">
              <p class="text-gray-600">
                Already have an account?
                <NuxtLink to="/auth/login" class="text-purple-600 hover:text-purple-800">Sign in</NuxtLink>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  
  const router = useRouter()
  const { $supabase } = useNuxtApp()
  
  const email = ref('')
  const password = ref('')
  const errorMessage = ref('')
  const isLoading = ref(false)
  const successMessage = ref('')
  
  const handleRegister = async () => {
    isLoading.value = true
    errorMessage.value = ''
    
    try {
      if (!$supabase) {
        errorMessage.value = 'Authentication service not available'
        return
      }
  
      const { data, error } = await $supabase.auth.signUp({
        email: email.value,
        password: password.value
      })
      
      if (error) {
        errorMessage.value = error.message
        return
      }
      
      // Check if email confirmation is required
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        errorMessage.value = 'This email is already registered.'
        return
      }
      
      // Create user preferences record
      if (data.user) {
        await createUserPreferences(data.user.id)
      }
      
      // Show success message instead of immediate redirect
      successMessage.value = 'Registration successful! Please check your email for a confirmation link before signing in.'
      
      // Clear the form
      email.value = ''
      password.value = ''
      
      // Optional: redirect after a delay
      setTimeout(() => {
        router.push('/auth/login?registered=true')
      }, 3000)
      
    } catch (error) {
      errorMessage.value = 'An unexpected error occurred. Please try again.'
      console.error('Registration error:', error)
    } finally {
      isLoading.value = false
    }
  }
  
  const createUserPreferences = async (userId) => {
    try {
      await $supabase.from('user_preferences').insert({
        user_id: userId,
        theme: 'light',
        font_size: 'medium',
        speech_rate: 1.0,
        voice_name: ''
      })
    } catch (error) {
      console.error('Error creating user preferences:', error)
    }
  }
  </script>
  