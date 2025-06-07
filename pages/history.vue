<template>
    <div class="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-4">
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-8">
          <h1 class="text-3xl font-bold text-gray-800">Reading History</h1>
          <NuxtLink to="/" class="text-purple-600 hover:text-purple-800">Back to App</NuxtLink>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <div v-if="isLoading" class="text-center py-8">
            <p>Loading your reading history...</p>
          </div>
          
          <div v-else-if="history.length === 0" class="text-center py-12">
            <div class="text-5xl mb-4">📚</div>
            <h2 class="text-xl font-semibold text-gray-700 mb-2">No reading history yet</h2>
            <p class="text-gray-500">Your reading history will appear here once you start using the app.</p>
          </div>
          
          <div v-else>
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Document</th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Words</th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  <tr v-for="item in history" :key="item.id">
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="flex items-center">
                        <div class="text-sm font-medium text-gray-900">
                          {{ item.document_name || 'Untitled Document' }}
                        </div>
                      </div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm text-gray-500">
                        {{ formatDate(item.created_at) }}
                      </div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <div class="text-sm text-gray-500">
                        {{ item.word_count }} words
                      </div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                      <button 
                        @click="openDocument(item)" 
                        class="text-purple-600 hover:text-purple-900"
                      >
                        Open
                      </button>
                      <button 
                        v-if="item.storage_path"
                        @click="downloadFile(item)" 
                        class="text-blue-600 hover:text-blue-900"
                      >
                        Download
                      </button>
                      <button 
                        @click="deleteHistoryItem(item.id)" 
                        class="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue'
  
  const router = useRouter()
  const { $supabase } = useNuxtApp()
  
  const user = ref(null)
  const history = ref([])
  const isLoading = ref(true)
  
  const checkAuth = async () => {
    if (!$supabase) {
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
  
  const loadHistory = async () => {
    if (!user.value) return
    
    isLoading.value = true
    try {
      const { data, error } = await $supabase
        .from('reading_history')
        .select('*')
        .eq('user_id', user.value.id)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      history.value = data || []
    } catch (error) {
      console.error('Error loading history:', error)
    } finally {
      isLoading.value = false
    }
  }
  
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  
  const openDocument = async (item) => {
    // Navigate to home page with document data
    await router.push({
      path: '/',
      query: {
        document_id: item.id,
        document_name: item.document_name
      }
    })
  }
  
  const downloadFile = async (item) => {
    if (!item.storage_path) return
    
    try {
      const { data, error } = await $supabase.storage
        .from('documents')
        .download(item.storage_path)
      
      if (error) throw error
      
      // Create download link
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = item.document_name || 'document'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error downloading file:', error)
      alert('Failed to download file')
    }
  }
  
  const deleteHistoryItem = async (id) => {
    if (!confirm('Are you sure you want to delete this document?')) return
    
    try {
      // Get the item to delete the file from storage
      const item = history.value.find(h => h.id === id)
      
      // Delete from database
      const { error } = await $supabase
        .from('reading_history')
        .delete()
        .eq('id', id)
        .eq('user_id', user.value.id)
      
      if (error) throw error
      
      // Delete file from storage if it exists
      if (item?.storage_path) {
        await $supabase.storage
          .from('documents')
          .remove([item.storage_path])
      }
      
      // Remove from local array
      history.value = history.value.filter(item => item.id !== id)
    } catch (error) {
      console.error('Error deleting document:', error)
      alert('Failed to delete document')
    }
  }
  
  onMounted(async () => {
    await checkAuth()
    if (user.value) {
      await loadHistory()
    }
  })
  </script>
  