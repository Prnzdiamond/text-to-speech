<template>
    <div class="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-4xl font-bold text-gray-800 mb-2">🎤 SpeakEasy</h1>
          <p class="text-gray-600">Sign in to your account</p>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-8">
          <form @submit.prevent="handleLogin" class="space-y-6">
            <div v-if="registrationSuccess" class="mb-4 p-3 bg-green-100 text-green-800 rounded-md text-sm">
              Registration successful! Please check your email for a confirmation link, then sign in below.
            </div>
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
                class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
            
            <div v-if="errorMessage" class="p-3 bg-red-100 text-red-800 rounded-md text-sm">
              {{ errorMessage }}
            </div>
            
            <button
              type="submit"
              class="w-full py-2 px-4 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50"
              :disabled="isLoading"
            >
              {{ isLoading ? 'Signing in...' : 'Sign in' }}
            </button>
            
            <div class="text-center text-sm">
              <p class="text-gray-600">
                Don't have an account?
                <NuxtLink to="/auth/register" class="text-purple-600 hover:text-purple-800">Sign up</NuxtLink>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue'
  
  const router = useRouter()
  const route = useRoute()
  const { $supabase } = useNuxtApp()
  
  const email = ref('')
  const password = ref('')
  const errorMessage = ref('')
  const isLoading = ref(false)
  const registrationSuccess = ref(false)
  
  onMounted(() => {
    // Check if user was redirected from registration
    if (route.query.registered === 'true') {
      registrationSuccess.value = true
    }
  })
  
  const handleLogin = async () => {
    isLoading.value = true
    errorMessage.value = ''
    
    try {
      if (!$supabase) {
        errorMessage.value = 'Authentication service not available'
        return
      }
  
      const { data, error } = await $supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value
      })
      
      if (error) {
        errorMessage.value = error.message
        return
      }
      
      // Redirect to home page after successful login
      await router.push('/')
    } catch (error) {
      errorMessage.value = 'An unexpected error occurred. Please try again.'
      console.error('Login error:', error)
    } finally {
      isLoading.value = false
    }
  }
  </script>
  