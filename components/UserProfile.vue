<template>
  <div class="relative user-profile">
    <button 
      @click="isMenuOpen = !isMenuOpen" 
      class="flex items-center space-x-2 p-2 rounded-full hover:bg-gray-100 focus:outline-none"
    >
      <div class="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white">
        {{ userInitials }}
      </div>
    </button>
    
    <div 
      v-if="isMenuOpen" 
      class="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-10"
    >
      <div class="px-4 py-2 border-b">
        <p class="text-sm font-medium">{{ user?.email }}</p>
      </div>
      <NuxtLink 
        to="/profile" 
        class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
        @click="isMenuOpen = false"
      >
        Profile Settings
      </NuxtLink>
      <NuxtLink 
        to="/history" 
        class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
        @click="isMenuOpen = false"
      >
        Reading History
      </NuxtLink>
      <button 
        @click="handleSignOut" 
        class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
      >
        Sign Out
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  user: {
    type: Object,
    required: true
  }
})

const router = useRouter()
const { $supabase } = useNuxtApp()
const isMenuOpen = ref(false)

const userInitials = computed(() => {
  if (!props.user || !props.user.email) return '?'
  return props.user.email.charAt(0).toUpperCase()
})

const handleSignOut = async () => {
  try {
    if ($supabase) {
      await $supabase.auth.signOut()
    }
    await router.push('/')
    if (process.client) {
      window.location.reload()
    }
  } catch (error) {
    console.error('Sign out error:', error)
  }
}

// Close menu when clicking outside
onMounted(() => {
  const handleClickOutside = (event) => {
    if (!event.target.closest('.user-profile')) {
      isMenuOpen.value = false
    }
  }
  
  if (process.client) {
    document.addEventListener('click', handleClickOutside)
    
    onBeforeUnmount(() => {
      document.removeEventListener('click', handleClickOutside)
    })
  }
})
</script>
